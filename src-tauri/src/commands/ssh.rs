use std::collections::HashMap;
use std::env;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::mpsc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use ssh2::{Channel, ExtendedData, KeyboardInteractivePrompt, Prompt, Session as SshSession};
use tauri::{AppHandle, Emitter};

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

#[derive(Debug)]
pub(crate) struct OpensshCommandResult {
  pub(crate) output: String,
  pub(crate) success: bool,
}

struct LiveTerminal {
  session_id: String,
  buffer: Mutex<Vec<u8>>,
  control_tx: mpsc::Sender<TerminalControl>,
  stream_enabled: AtomicBool,
  closed: AtomicBool,
}

#[derive(Default)]
pub struct TerminalManager {
  terminals: Mutex<HashMap<String, Arc<LiveTerminal>>>,
}

enum TerminalControl {
  Input(Vec<u8>),
  Resize { cols: u32, rows: u32 },
  Close,
}

struct PasswordPrompter {
  password: String,
}

impl KeyboardInteractivePrompt for PasswordPrompter {
  fn prompt<'a>(
    &mut self,
    _username: &str,
    _instructions: &str,
    prompts: &[Prompt<'a>],
  ) -> Vec<String> {
    prompts
      .iter()
      .map(|prompt| {
        if prompt.echo {
          String::new()
        } else {
          self.password.clone()
        }
      })
      .collect()
  }
}

fn close_live_terminal(terminal: &Arc<LiveTerminal>) {
  if terminal.closed.swap(true, Ordering::SeqCst) {
    return;
  }

  let _ = terminal.control_tx.send(TerminalControl::Close);
}

pub(crate) fn openssh_program_name(binary_name: &str) -> String {
  if cfg!(target_os = "windows") {
    if let Some(windir) = env::var_os("WINDIR") {
      let candidate = std::path::Path::new(&windir)
        .join("System32")
        .join("OpenSSH")
        .join(binary_name);
      if candidate.is_file() {
        return candidate.to_string_lossy().into_owned();
      }
    }

    binary_name.to_string()
  } else {
    binary_name
      .strip_suffix(".exe")
      .unwrap_or(binary_name)
      .to_string()
  }
}

fn build_pty_size(cols: Option<u32>, rows: Option<u32>) -> PtySize {
  PtySize {
    rows: rows.unwrap_or(32).max(10) as u16,
    cols: cols.unwrap_or(120).max(40) as u16,
    pixel_width: 0,
    pixel_height: 0,
  }
}

fn looks_like_password_prompt(tail: &str) -> bool {
  let normalized = tail.to_ascii_lowercase();
  normalized.contains("password:")
    || normalized.ends_with("password")
    || normalized.contains("password for")
}

fn is_auth_or_hostkey_prompt(output: &str) -> bool {
  let normalized = output.to_ascii_lowercase();
  looks_like_password_prompt(&normalized)
    || normalized.contains("are you sure you want to continue connecting")
    || normalized.contains("(yes/no")
}

fn connect_authenticated_terminal_session(auth: &SessionAuth) -> Result<SshSession, String> {
  let address = format!("{}:{}", auth.host, auth.port);
  let socket_address = address
    .to_socket_addrs()
    .map_err(|error| format!("No se pudo resolver {address}: {error}"))?
    .next()
    .ok_or_else(|| format!("No se encontro una direccion valida para {address}"))?;

  let tcp = TcpStream::connect_timeout(&socket_address, Duration::from_secs(8))
    .map_err(|error| format!("No se pudo conectar a {address}: {error}"))?;
  let _ = tcp.set_read_timeout(Some(Duration::from_millis(250)));
  let _ = tcp.set_write_timeout(Some(Duration::from_millis(250)));

  let mut ssh = SshSession::new()
    .map_err(|error| format!("No se pudo iniciar la sesion SSH nativa: {error}"))?;
  ssh.set_timeout(8_000);
  ssh.set_tcp_stream(tcp);
  ssh.handshake()
    .map_err(|error| format!("Handshake SSH fallido: {error}"))?;
  ssh.set_keepalive(true, 30);

  if let Err(password_error) = ssh.userauth_password(&auth.username, &auth.password) {
    let mut prompter = PasswordPrompter {
      password: auth.password.clone(),
    };
    ssh.userauth_keyboard_interactive(&auth.username, &mut prompter)
      .map_err(|interactive_error| {
        format!(
          "Autenticacion SSH fallida: {password_error}. Reintento keyboard-interactive fallido: {interactive_error}"
        )
      })?;
  }

  if !ssh.authenticated() {
    return Err("Autenticacion SSH rechazada por el servidor".to_string());
  }

  Ok(ssh)
}

fn append_terminal_chunk(
  app_handle: &AppHandle,
  event_name: &str,
  terminal: &Arc<LiveTerminal>,
  chunk: &[u8],
) {
  if terminal.stream_enabled.load(Ordering::SeqCst) {
    let _ = app_handle.emit(event_name, chunk.to_vec());
  } else if let Ok(mut output) = terminal.buffer.lock() {
    output.extend_from_slice(chunk);
  }
}

fn write_channel_all(channel: &mut Channel, payload: &[u8]) -> Result<(), std::io::Error> {
  let mut written = 0usize;

  while written < payload.len() {
    match channel.write(&payload[written..]) {
      Ok(0) => {
        return Err(std::io::Error::new(
          ErrorKind::WriteZero,
          "el canal SSH dejo de aceptar datos",
        ));
      }
      Ok(count) => {
        written += count;
      }
      Err(error) if error.kind() == ErrorKind::WouldBlock => {
        thread::sleep(Duration::from_millis(6));
      }
      Err(error) if error.kind() == ErrorKind::Interrupted => continue,
      Err(error) => return Err(error),
    }
  }

  channel.flush()
}

fn spawn_terminal_reader(
  app_handle: AppHandle,
  shell_id: String,
  terminal: Arc<LiveTerminal>,
  ssh: SshSession,
  channel: Channel,
  control_rx: mpsc::Receiver<TerminalControl>,
) {
  thread::spawn(move || {
    let mut buffer = [0_u8; 8192];
    let output_event = format!("ssh-output-{shell_id}");
    let close_event = format!("ssh-closed-{shell_id}");
    let mut last_keepalive = Instant::now();
    let writer_terminal = terminal.clone();
    let writer_output_event = output_event.clone();
    let writer_app_handle = app_handle.clone();
    let mut writer_channel = channel.clone();

    ssh.set_blocking(false);

    let writer_thread = thread::spawn(move || {
      loop {
        if writer_terminal.closed.load(Ordering::SeqCst) {
          break;
        }

        match control_rx.recv_timeout(Duration::from_millis(25)) {
          Ok(TerminalControl::Input(data)) => {
            if let Err(error) = write_channel_all(&mut writer_channel, &data) {
              let message =
                format!("\r\nOpenTermX detecto un error al escribir en SSH: {error}\r\n");
              append_terminal_chunk(
                &writer_app_handle,
                &writer_output_event,
                &writer_terminal,
                message.as_bytes(),
              );
              writer_terminal.closed.store(true, Ordering::SeqCst);
              break;
            }
          }
          Ok(TerminalControl::Resize { cols, rows }) => {
            if let Err(error) =
              writer_channel.request_pty_size(cols.max(40), rows.max(10), None, None)
            {
              let message =
                format!("\r\nOpenTermX no pudo redimensionar el PTY remoto: {error}\r\n");
              append_terminal_chunk(
                &writer_app_handle,
                &writer_output_event,
                &writer_terminal,
                message.as_bytes(),
              );
            }
          }
          Ok(TerminalControl::Close) | Err(mpsc::RecvTimeoutError::Disconnected) => {
            writer_terminal.closed.store(true, Ordering::SeqCst);
            break;
          }
          Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
      }
    });

    let mut reader_channel = channel;
    loop {
      if terminal.closed.load(Ordering::SeqCst) {
        break;
      }

      match reader_channel.read(&mut buffer) {
        Ok(0) => {
          if reader_channel.eof() {
            terminal.closed.store(true, Ordering::SeqCst);
            break;
          }
        }
        Ok(read) => {
          append_terminal_chunk(&app_handle, &output_event, &terminal, &buffer[..read]);
        }
        Err(error) if error.kind() == ErrorKind::WouldBlock => {}
        Err(error) if error.kind() == ErrorKind::Interrupted => continue,
        Err(error) => {
          let message = format!("\r\nOpenTermX detecto un error del canal SSH: {error}\r\n");
          append_terminal_chunk(&app_handle, &output_event, &terminal, message.as_bytes());
          terminal.closed.store(true, Ordering::SeqCst);
          break;
        }
      }

      if last_keepalive.elapsed() >= Duration::from_secs(20) {
        if ssh.keepalive_send().is_err() {
          terminal.closed.store(true, Ordering::SeqCst);
          break;
        }
        last_keepalive = Instant::now();
      }

      thread::sleep(Duration::from_millis(6));
    }

    terminal.closed.store(true, Ordering::SeqCst);
    let _ = writer_thread.join();

    let mut close_channel = reader_channel;
    let _ = close_channel.close();
    let _ = close_channel.wait_close();
    let _ = ssh.disconnect(None, "OpenTermX", None);

    if terminal.stream_enabled.load(Ordering::SeqCst) {
      let _ = app_handle.emit(&close_event, true);
    }
  });
}

fn apply_shared_ssh_options(command: &mut CommandBuilder, auth: &SessionAuth) {
  command.arg("-p");
  command.arg(auth.port.to_string());
  command.arg("-o");
  command.arg("ConnectTimeout=8");
  command.arg("-o");
  command.arg("ConnectionAttempts=1");
  command.arg("-o");
  command.arg("GSSAPIAuthentication=no");
  command.arg("-o");
  command.arg("ServerAliveInterval=30");
  command.arg("-o");
  command.arg("ServerAliveCountMax=3");
  command.arg("-o");
  command.arg("NumberOfPasswordPrompts=1");
  command.arg("-o");
  command.arg("PreferredAuthentications=password,keyboard-interactive");
  command.arg("-o");
  command.arg("PubkeyAuthentication=no");
  command.arg("-o");
  command.arg("StrictHostKeyChecking=accept-new");
}

fn build_ssh_command(auth: &SessionAuth) -> CommandBuilder {
  let mut command = CommandBuilder::new(openssh_program_name(if cfg!(target_os = "windows") {
    "ssh.exe"
  } else {
    "ssh"
  }));
  command.arg("-tt");
  apply_shared_ssh_options(&mut command, auth);
  command.arg(format!("{}@{}", auth.username, auth.host));
  command
}

fn drain_terminal_buffer(terminal: &Arc<LiveTerminal>) -> Vec<u8> {
  match terminal.buffer.lock() {
    Ok(mut buffer) => std::mem::take(&mut *buffer),
    Err(_) => Vec::new(),
  }
}

pub(crate) fn build_ssh_exec_command(
  auth: &SessionAuth,
  remote_command: &str,
) -> CommandBuilder {
  let mut command = CommandBuilder::new(openssh_program_name(if cfg!(target_os = "windows") {
    "ssh.exe"
  } else {
    "ssh"
  }));
  command.arg("-T");
  apply_shared_ssh_options(&mut command, auth);
  command.arg(format!("{}@{}", auth.username, auth.host));
  command.arg(remote_command);
  command
}

pub(crate) fn build_scp_command(
  auth: &SessionAuth,
  source: &str,
  target: &str,
) -> CommandBuilder {
  let mut command = CommandBuilder::new(openssh_program_name(if cfg!(target_os = "windows") {
    "scp.exe"
  } else {
    "scp"
  }));
  command.arg("-q");
  command.arg("-P");
  command.arg(auth.port.to_string());
  command.arg("-o");
  command.arg("ConnectTimeout=8");
  command.arg("-o");
  command.arg("ConnectionAttempts=1");
  command.arg("-o");
  command.arg("GSSAPIAuthentication=no");
  command.arg("-o");
  command.arg("ServerAliveInterval=30");
  command.arg("-o");
  command.arg("ServerAliveCountMax=3");
  command.arg("-o");
  command.arg("NumberOfPasswordPrompts=1");
  command.arg("-o");
  command.arg("PreferredAuthentications=password,keyboard-interactive");
  command.arg("-o");
  command.arg("PubkeyAuthentication=no");
  command.arg("-o");
  command.arg("StrictHostKeyChecking=accept-new");
  command.arg(source);
  command.arg(target);
  command
}

pub(crate) fn ensure_active_terminal_session(
  terminals: &TerminalManager,
  shell_id: &str,
  session_id: &str,
) -> Result<(), String> {
  let guard = terminals
    .terminals
    .lock()
    .map_err(|_| "No se pudo bloquear el administrador de terminales".to_string())?;
  let terminal = guard
    .get(shell_id)
    .cloned()
    .ok_or_else(|| "La terminal activa ya no esta disponible para SFTP".to_string())?;
  drop(guard);

  if terminal.closed.load(Ordering::SeqCst) {
    return Err("La terminal activa ya no esta disponible para SFTP".to_string());
  }

  if terminal.session_id != session_id {
    return Err("La terminal activa no coincide con la sesion seleccionada".to_string());
  }

  Ok(())
}

pub(crate) fn run_openssh_command(
  command: CommandBuilder,
  password: &str,
  timeout: Duration,
) -> Result<OpensshCommandResult, String> {
  let pty_system = native_pty_system();
  let pair = pty_system
    .openpty(PtySize {
      rows: 24,
      cols: 80,
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|error| format!("No se pudo abrir un PTY local para OpenSSH: {error}"))?;
  let reader = pair
    .master
    .try_clone_reader()
    .map_err(|error| format!("No se pudo preparar la lectura de OpenSSH: {error}"))?;
  let writer = pair
    .master
    .take_writer()
    .map_err(|error| format!("No se pudo preparar la escritura de OpenSSH: {error}"))?;
  let mut child = pair
    .slave
    .spawn_command(command)
    .map_err(|error| format!("No se pudo iniciar OpenSSH: {error}"))?;

  let captured_output = Arc::new(Mutex::new(Vec::new()));
  let (sender, receiver) = mpsc::channel();
  let password_value = password.to_string();
  let captured_output_for_thread = captured_output.clone();
  thread::spawn(move || {
    let mut prompt_tail = String::new();
    let mut password_sent = false;
    let mut reader = reader;
    let mut writer = writer;
    let mut buffer = [0_u8; 4096];

    loop {
      match reader.read(&mut buffer) {
        Ok(0) => break,
        Ok(read) => {
          let chunk = &buffer[..read];
          if let Ok(mut captured) = captured_output_for_thread.lock() {
            captured.extend_from_slice(chunk);
          }
          let chunk_text = String::from_utf8_lossy(chunk);
          prompt_tail.push_str(&chunk_text);
          if prompt_tail.len() > 512 {
            let drain_until = prompt_tail.len().saturating_sub(512);
            prompt_tail.drain(..drain_until);
          }

          if !password_sent && looks_like_password_prompt(&prompt_tail) {
            if writer
              .write_all(format!("{password_value}\r").as_bytes())
              .and_then(|_| writer.flush())
              .is_ok()
            {
              password_sent = true;
            }
          }
        }
        Err(error) if error.kind() == ErrorKind::Interrupted => continue,
        Err(error) => {
          if let Ok(mut captured) = captured_output_for_thread.lock() {
            captured.extend_from_slice(
              format!("\nOpenTermX detecto un error al leer OpenSSH: {error}\n").as_bytes(),
            );
          }
          break;
        }
      }
    }

    let _ = sender.send(());
  });

  let deadline = Instant::now() + timeout;
  let status = loop {
    match child.try_wait() {
      Ok(Some(status)) => break status,
      Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
      Ok(None) => {
        let _ = child.kill();
        break child
          .wait()
          .map_err(|error| format!("El comando OpenSSH excedio el tiempo de espera: {error}"))?;
      }
      Err(error) => return Err(format!("No se pudo consultar el estado de OpenSSH: {error}")),
    }
  };

  let _ = receiver.recv_timeout(Duration::from_millis(750));
  let output = captured_output
    .lock()
    .map(|captured| captured.clone())
    .unwrap_or_default();
  let output_text = String::from_utf8_lossy(&output).trim().to_string();

  Ok(OpensshCommandResult {
    output: output_text,
    success: status.success(),
  })
}

#[tauri::command]
pub fn open_terminal(
  session_id: &str,
  cols: Option<u32>,
  rows: Option<u32>,
  app: tauri::AppHandle,
  state: tauri::State<'_, DatabaseState>,
  terminals: tauri::State<'_, TerminalManager>,
) -> Result<TerminalBootstrap, String> {
  let auth = state
    .resolve_session_auth(session_id)
    .map_err(|error| error.to_string())?;
  let shell_id = format!("shell-{}", NEXT_SHELL_ID.fetch_add(1, Ordering::Relaxed));

  let ssh = connect_authenticated_terminal_session(&auth)?;
  let mut channel = ssh
    .channel_session()
    .map_err(|error| format!("No se pudo abrir el canal SSH: {error}"))?;
  channel
    .handle_extended_data(ExtendedData::Merge)
    .map_err(|error| format!("No se pudo unir stdout/stderr del canal SSH: {error}"))?;
  let size = build_pty_size(cols, rows);
  channel
    .request_pty(
      "xterm-256color",
      None,
      Some((size.cols as u32, size.rows as u32, 0, 0)),
    )
    .map_err(|error| format!("No se pudo solicitar el PTY remoto: {error}"))?;
  channel
    .shell()
    .map_err(|error| format!("No se pudo iniciar la shell remota: {error}"))?;

  let (control_tx, control_rx) = mpsc::channel();

  let terminal = Arc::new(LiveTerminal {
    session_id: session_id.to_string(),
    buffer: Mutex::new(Vec::new()),
    control_tx,
    stream_enabled: AtomicBool::new(false),
    closed: AtomicBool::new(false),
  });

  spawn_terminal_reader(
    app.clone(),
    shell_id.clone(),
    terminal.clone(),
    ssh,
    channel,
    control_rx,
  );

  let mut guard = terminals
    .terminals
    .lock()
    .map_err(|_| "No se pudo bloquear el administrador de terminales".to_string())?;
  guard.insert(shell_id.clone(), terminal.clone());
  drop(guard);

  let startup_deadline = Instant::now() + Duration::from_secs(3);
  let quiet_period = Duration::from_millis(140);
  let mut initial_output = Vec::new();
  let mut last_activity_at = Instant::now();
  let initial_output = loop {
    let buffered = drain_terminal_buffer(&terminal);
    if !buffered.is_empty() {
      last_activity_at = Instant::now();
      initial_output.extend_from_slice(&buffered);
    }

    let now = Instant::now();
    if terminal.closed.load(Ordering::SeqCst) {
      break initial_output;
    }

    if !initial_output.is_empty()
      && now >= last_activity_at + quiet_period
      && !is_auth_or_hostkey_prompt(&String::from_utf8_lossy(&initial_output))
    {
      break initial_output;
    }

    if now >= startup_deadline {
      break initial_output;
    }

    thread::sleep(Duration::from_millis(60));
  };

  if terminal.closed.load(Ordering::SeqCst) {
    let mut guard = terminals
      .terminals
      .lock()
      .map_err(|_| "No se pudo bloquear el administrador de terminales".to_string())?;
    if let Some(terminal) = guard.remove(&shell_id) {
      let message = String::from_utf8_lossy(&initial_output).trim().to_string();
      close_live_terminal(&terminal);

      return Err(if message.is_empty() {
        "La sesion SSH termino durante el arranque".to_string()
      } else {
        message
      });
    }
  }

  state
    .touch_session_connection(session_id)
    .map_err(|error| error.to_string())?;

  Ok(TerminalBootstrap {
    shell_id,
    banner: format!("{}@{}", auth.username, auth.host),
    connected: true,
    initial_output: Some(String::from_utf8_lossy(&initial_output).into_owned()),
  })
}

#[tauri::command]
pub fn enable_terminal_stream(
  shell_id: &str,
  terminals: tauri::State<'_, TerminalManager>,
) -> Result<TerminalOutput, String> {
  let mut guard = terminals
    .terminals
    .lock()
    .map_err(|_| "No se pudo bloquear el administrador de terminales".to_string())?;
  let terminal = guard
    .get(shell_id)
    .cloned()
    .ok_or_else(|| "La terminal remota ya no esta disponible".to_string())?;

  terminal.stream_enabled.store(true, Ordering::SeqCst);
  let collected = drain_terminal_buffer(&terminal);
  let closed = terminal.closed.load(Ordering::SeqCst);
  let data = String::from_utf8_lossy(&collected).into_owned();

  if closed {
    if let Some(terminal) = guard.remove(shell_id) {
      close_live_terminal(&terminal);
    }
  }

  Ok(TerminalOutput { data, closed })
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
  let Some(terminal) = guard.get(shell_id).cloned() else {
    return Ok(TerminalOutput {
      data: String::new(),
      closed: true,
    });
  };

  let collected = drain_terminal_buffer(&terminal);
  let closed = terminal.closed.load(Ordering::SeqCst);
  let data = String::from_utf8_lossy(&collected).into_owned();

  if closed {
    if let Some(terminal) = guard.remove(shell_id) {
      close_live_terminal(&terminal);
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
  let guard = terminals
    .terminals
    .lock()
    .map_err(|_| "No se pudo bloquear el administrador de terminales".to_string())?;
  let terminal = guard
    .get(shell_id)
    .cloned()
    .ok_or_else(|| "La terminal remota ya no esta disponible".to_string())?;
  drop(guard);

  if terminal.closed.load(Ordering::SeqCst) {
    return Err("La terminal remota ya no esta disponible".to_string());
  }

  terminal
    .control_tx
    .send(TerminalControl::Input(input.as_bytes().to_vec()))
    .map_err(|_| "La terminal remota ya no esta disponible".to_string())
}

#[tauri::command]
pub fn resize_terminal(
  shell_id: &str,
  cols: u32,
  rows: u32,
  terminals: tauri::State<'_, TerminalManager>,
) -> Result<(), String> {
  let guard = terminals
    .terminals
    .lock()
    .map_err(|_| "No se pudo bloquear el administrador de terminales".to_string())?;
  let terminal = guard
    .get(shell_id)
    .cloned()
    .ok_or_else(|| "La terminal remota ya no esta disponible".to_string())?;
  drop(guard);

  terminal
    .control_tx
    .send(TerminalControl::Resize { cols, rows })
    .map_err(|_| "La terminal remota ya no esta disponible".to_string())
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

  if let Some(terminal) = guard.remove(shell_id) {
    close_live_terminal(&terminal);
  }

  Ok(())
}
