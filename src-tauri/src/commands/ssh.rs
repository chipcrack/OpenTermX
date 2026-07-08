use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use ssh2::{Channel, ExtendedData, Session};

use crate::storage::{DatabaseState, SessionAuth};

static NEXT_SHELL_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalBootstrap {
  pub shell_id: String,
  pub banner: String,
  pub connected: bool,
  pub initial_output: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
  pub data: String,
  pub closed: bool,
}

struct LiveTerminal {
  ssh: Session,
  channel: Channel,
}

#[derive(Default)]
pub struct TerminalManager {
  terminals: Mutex<HashMap<String, LiveTerminal>>,
}

pub(crate) fn connect_authenticated_session(auth: &SessionAuth) -> Result<Session, String> {
  let address = format!("{}:{}", auth.host, auth.port);
  let socket_address = address
    .to_socket_addrs()
    .map_err(|error| format!("No se pudo resolver {address}: {error}"))?
    .next()
    .ok_or_else(|| format!("No se encontro una direccion valida para {address}"))?;

  let tcp = TcpStream::connect_timeout(&socket_address, Duration::from_secs(8))
    .map_err(|error| format!("No se pudo conectar a {address}: {error}"))?;
  let _ = tcp.set_read_timeout(Some(Duration::from_secs(8)));
  let _ = tcp.set_write_timeout(Some(Duration::from_secs(8)));

  let mut ssh = Session::new().map_err(|error| format!("No se pudo iniciar SSH: {error}"))?;
  ssh.set_tcp_stream(tcp);
  ssh.handshake()
    .map_err(|error| format!("Handshake SSH fallido: {error}"))?;
  ssh.userauth_password(&auth.username, &auth.password)
    .map_err(|error| format!("Autenticacion SSH fallida: {error}"))?;

  if !ssh.authenticated() {
    return Err("Autenticacion SSH rechazada por el servidor".to_string());
  }

  Ok(ssh)
}

fn close_live_terminal(terminal: &mut LiveTerminal) {
  let _ = terminal.channel.send_eof();
  let _ = terminal.channel.close();
  let _ = terminal.channel.wait_close();
  let _ = terminal.ssh.disconnect(None, "OpenTermX terminal closed", None);
}

#[tauri::command]
pub fn open_terminal(
  session_id: &str,
  cols: Option<u32>,
  rows: Option<u32>,
  state: tauri::State<'_, DatabaseState>,
  terminals: tauri::State<'_, TerminalManager>,
) -> Result<TerminalBootstrap, String> {
  let auth = state
    .resolve_session_auth(session_id)
    .map_err(|error| error.to_string())?;

  let ssh = connect_authenticated_session(&auth)?;
  ssh.set_timeout(1500);
  ssh.set_keepalive(true, 30);

  let mut channel = ssh
    .channel_session()
    .map_err(|error| format!("No se pudo abrir el canal SSH: {error}"))?;
  channel
    .handle_extended_data(ExtendedData::Merge)
    .map_err(|error| format!("No se pudo preparar stderr del canal: {error}"))?;
  channel
    .request_pty(
      "xterm-256color",
      None,
      Some((cols.unwrap_or(120).max(40), rows.unwrap_or(32).max(10), 0, 0)),
    )
    .map_err(|error| format!("No se pudo solicitar el PTY remoto: {error}"))?;
  channel
    .shell()
    .map_err(|error| format!("No se pudo iniciar la shell remota: {error}"))?;
  let _ = channel.write_all(b"\n");
  let _ = channel.flush();
  thread::sleep(Duration::from_millis(180));

  let mut initial_buffer = Vec::new();
  let mut read_buffer = [0_u8; 4096];

  loop {
    match channel.read(&mut read_buffer) {
      Ok(0) => break,
      Ok(read) => {
        initial_buffer.extend_from_slice(&read_buffer[..read]);
        if read < read_buffer.len() {
          break;
        }
      }
      Err(error)
        if matches!(
          error.kind(),
          ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted
        ) =>
      {
        break;
      }
      Err(error) => return Err(format!("No se pudo leer la salida inicial de la shell: {error}")),
    }
  }

  ssh.set_blocking(false);
  ssh.set_timeout(0);

  state
    .touch_session_connection(session_id)
    .map_err(|error| error.to_string())?;

  let shell_id = format!("shell-{}", NEXT_SHELL_ID.fetch_add(1, Ordering::Relaxed));
  let mut guard = terminals
    .terminals
    .lock()
    .map_err(|_| "No se pudo bloquear el administrador de terminales".to_string())?;
  guard.insert(shell_id.clone(), LiveTerminal { ssh, channel });

  Ok(TerminalBootstrap {
    shell_id,
    banner: format!("SSH conectado con {}@{}", auth.username, auth.host),
    connected: true,
    initial_output: Some(String::from_utf8_lossy(&initial_buffer).into_owned()),
  })
}

#[tauri::command]
pub fn read_terminal_output(
  shell_id: &str,
  terminals: tauri::State<'_, TerminalManager>,
) -> Result<TerminalOutput, String> {
  let mut guard = terminals
    .terminals
    .lock()
    .map_err(|_| "No se pudo bloquear el administrador de terminales".to_string())?;
  let Some(terminal) = guard.get_mut(shell_id) else {
    return Ok(TerminalOutput {
      data: String::new(),
      closed: true,
    });
  };

  let _ = terminal.ssh.keepalive_send();

  let mut collected = Vec::new();
  let mut buffer = [0_u8; 4096];

  loop {
    match terminal.channel.read(&mut buffer) {
      Ok(0) => break,
      Ok(read) => collected.extend_from_slice(&buffer[..read]),
      Err(error)
        if matches!(
          error.kind(),
          ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted
        ) =>
      {
        break;
      }
      Err(error) => {
        if terminal.channel.eof() {
          break;
        }
        return Err(format!("No se pudo leer desde la terminal remota: {error}"));
      }
    }
  }

  let closed = terminal.channel.eof();
  let data = String::from_utf8_lossy(&collected).into_owned();

  if closed {
    if let Some(mut terminal) = guard.remove(shell_id) {
      close_live_terminal(&mut terminal);
    }
  }

  Ok(TerminalOutput { data, closed })
}

#[tauri::command]
pub fn write_terminal_input(
  shell_id: &str,
  input: &str,
  terminals: tauri::State<'_, TerminalManager>,
) -> Result<(), String> {
  let mut guard = terminals
    .terminals
    .lock()
    .map_err(|_| "No se pudo bloquear el administrador de terminales".to_string())?;
  let terminal = guard
    .get_mut(shell_id)
    .ok_or_else(|| "La terminal remota ya no esta disponible".to_string())?;

  if terminal.channel.eof() {
    return Err("La terminal remota ya no esta disponible".to_string());
  }

  let _ = terminal.ssh.keepalive_send();

  terminal.ssh.set_blocking(true);
  terminal.ssh.set_timeout(900);

  let write_result = terminal
    .channel
    .write_all(input.as_bytes())
    .and_then(|_| terminal.channel.flush());

  terminal.ssh.set_blocking(false);
  terminal.ssh.set_timeout(0);

  match write_result {
    Ok(()) => Ok(()),
    Err(error)
      if matches!(
        error.kind(),
        ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted
      ) && !terminal.channel.eof() =>
    {
      Ok(())
    }
    Err(error) => Err(format!("No se pudo enviar datos a la terminal remota: {error}")),
  }
}

#[tauri::command]
pub fn resize_terminal(
  shell_id: &str,
  cols: u32,
  rows: u32,
  terminals: tauri::State<'_, TerminalManager>,
) -> Result<(), String> {
  let mut guard = terminals
    .terminals
    .lock()
    .map_err(|_| "No se pudo bloquear el administrador de terminales".to_string())?;
  let terminal = guard
    .get_mut(shell_id)
    .ok_or_else(|| "La terminal remota ya no esta disponible".to_string())?;

  terminal
    .channel
    .request_pty_size(cols.max(40), rows.max(10), None, None)
    .map_err(|error| format!("No se pudo redimensionar el PTY remoto: {error}"))
}

#[tauri::command]
pub fn close_terminal(
  shell_id: &str,
  terminals: tauri::State<'_, TerminalManager>,
) -> Result<(), String> {
  let mut guard = terminals
    .terminals
    .lock()
    .map_err(|_| "No se pudo bloquear el administrador de terminales".to_string())?;

  if let Some(mut terminal) = guard.remove(shell_id) {
    close_live_terminal(&mut terminal);
  }

  Ok(())
}
