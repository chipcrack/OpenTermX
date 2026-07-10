use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::Serialize;
use ssh2::{RenameFlags, Session};

use crate::commands::ssh::TerminalManager;
use crate::storage::{DatabaseState, SessionAuth};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
  pub id: String,
  pub name: String,
  pub path: String,
  #[serde(rename = "type")]
  pub entry_type: String,
  pub size: String,
  pub modified_at: String,
}

struct PersistentSftpSession {
  auth_signature: String,
  ssh: Session,
  sftp: ssh2::Sftp,
}

#[derive(Default)]
pub struct SftpManager {
  sessions: Mutex<HashMap<String, PersistentSftpSession>>,
}

fn auth_signature(auth: &SessionAuth) -> String {
  format!("{}:{}:{}:{}", auth.host, auth.port, auth.username, auth.password.len())
}

fn connect_authenticated_session(auth: &SessionAuth) -> Result<Session, String> {
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

  let mut ssh = Session::new().map_err(|error| format!("No se pudo iniciar SSH para SFTP: {error}"))?;
  ssh.set_timeout(8_000);
  ssh.set_tcp_stream(tcp);
  ssh.handshake()
    .map_err(|error| format!("Handshake SSH fallido para SFTP: {error}"))?;
  ssh.set_keepalive(true, 30);
  ssh.userauth_password(&auth.username, &auth.password)
    .map_err(|error| format!("Autenticacion SSH fallida para SFTP: {error}"))?;

  if !ssh.authenticated() {
    return Err("Autenticacion SSH rechazada por el servidor para SFTP".to_string());
  }

  Ok(ssh)
}

fn connect_persistent_sftp_session(auth: &SessionAuth) -> Result<PersistentSftpSession, String> {
  let ssh = connect_authenticated_session(auth)?;
  let sftp = ssh
    .sftp()
    .map_err(|error| format!("No se pudo abrir el canal SFTP persistente: {error}"))?;

  Ok(PersistentSftpSession {
    auth_signature: auth_signature(auth),
    ssh,
    sftp,
  })
}

fn format_size(size: Option<u64>) -> String {
  let Some(bytes) = size else {
    return "--".to_string();
  };

  const KB: f64 = 1024.0;
  const MB: f64 = KB * 1024.0;
  const GB: f64 = MB * 1024.0;

  let bytes_f64 = bytes as f64;

  if bytes_f64 >= GB {
    format!("{:.1} GB", bytes_f64 / GB)
  } else if bytes_f64 >= MB {
    format!("{:.1} MB", bytes_f64 / MB)
  } else if bytes_f64 >= KB {
    format!("{:.1} KB", bytes_f64 / KB)
  } else {
    format!("{bytes} B")
  }
}

fn format_modified(timestamp: Option<u64>) -> String {
  let Some(seconds) = timestamp else {
    return "--".to_string();
  };

  DateTime::<Utc>::from_timestamp(seconds as i64, 0)
    .map(|value| value.format("%Y-%m-%d %H:%M").to_string())
    .unwrap_or_else(|| "--".to_string())
}

fn with_session_auth<T>(
  session_id: &str,
  state: tauri::State<'_, DatabaseState>,
  callback: impl FnOnce(&SessionAuth) -> Result<T, String>,
) -> Result<T, String> {
  let auth = state
    .resolve_session_auth(session_id)
    .map_err(|error| error.to_string())?;

  callback(&auth)
}

fn with_persistent_sftp<T>(
  session_id: &str,
  auth: &SessionAuth,
  manager: tauri::State<'_, SftpManager>,
  callback: impl Fn(&ssh2::Sftp) -> Result<T, String>,
) -> Result<T, String> {
  let signature = auth_signature(auth);
  let mut sessions = manager
    .sessions
    .lock()
    .map_err(|_| "No se pudo bloquear el administrador SFTP".to_string())?;

  let needs_reconnect = sessions
    .get(session_id)
    .map(|session| session.auth_signature != signature)
    .unwrap_or(true);

  if needs_reconnect {
    sessions.insert(session_id.to_string(), connect_persistent_sftp_session(auth)?);
  }

  let attempt = |session: &PersistentSftpSession| -> Result<T, String> {
    session
      .ssh
      .keepalive_send()
      .map_err(|error| format!("La sesion SFTP no responde: {error}"))?;
    callback(&session.sftp)
  };

  match sessions.get(session_id) {
    Some(session) => match attempt(session) {
      Ok(result) => Ok(result),
      Err(first_error) => {
        sessions.insert(session_id.to_string(), connect_persistent_sftp_session(auth)?);

        match sessions.get(session_id) {
          Some(session) => attempt(session).map_err(|second_error| {
            format!("{first_error}\nReintento SFTP fallido: {second_error}")
          }),
          None => Err("No se pudo restablecer la sesion SFTP".to_string()),
        }
      }
    },
    None => Err("No se pudo preparar la sesion SFTP".to_string()),
  }
}

#[tauri::command]
pub fn list_directory(
  session_id: &str,
  shell_id: Option<&str>,
  path: Option<&str>,
  state: tauri::State<'_, DatabaseState>,
  terminals: tauri::State<'_, TerminalManager>,
  sftp_manager: tauri::State<'_, SftpManager>,
) -> Result<Vec<SftpEntry>, String> {
  let _ = shell_id;
  let _ = terminals;

  with_session_auth(session_id, state, |auth| {
    with_persistent_sftp(session_id, auth, sftp_manager, |sftp| {
      let target_path = path
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("/home/{}", auth.username));
      let root = Path::new(&target_path);

      let entries = sftp
        .readdir(root)
        .map_err(|error| format!("No se pudo listar {target_path}: {error}"))?;

      let mut mapped = entries
        .into_iter()
        .filter_map(|(entry_path, stat)| {
          let name = entry_path.file_name()?.to_string_lossy().to_string();

          if name == "." || name == ".." {
            return None;
          }

          let full_path = if entry_path.is_absolute() {
            entry_path.to_string_lossy().to_string()
          } else {
            root.join(&entry_path).to_string_lossy().to_string()
          };

          Some(SftpEntry {
            id: full_path.clone(),
            name,
            path: full_path,
            entry_type: if stat.is_dir() {
              "directory".to_string()
            } else {
              "file".to_string()
            },
            size: if stat.is_dir() {
              "--".to_string()
            } else {
              format_size(stat.size)
            },
            modified_at: format_modified(stat.mtime),
          })
        })
        .collect::<Vec<_>>();

      mapped.sort_by(|left, right| {
        left
          .entry_type
          .cmp(&right.entry_type)
          .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
      });

      Ok(mapped)
    })
  })
}

#[tauri::command]
pub fn create_directory(
  session_id: &str,
  shell_id: Option<&str>,
  path: &str,
  state: tauri::State<'_, DatabaseState>,
  terminals: tauri::State<'_, TerminalManager>,
  sftp_manager: tauri::State<'_, SftpManager>,
) -> Result<(), String> {
  let _ = shell_id;
  let _ = terminals;

  with_session_auth(session_id, state, |auth| {
    with_persistent_sftp(session_id, auth, sftp_manager, |sftp| {
      sftp
        .mkdir(Path::new(path), 0o755)
        .map_err(|error| format!("No se pudo crear la carpeta {path}: {error}"))
    })
  })
}

#[tauri::command]
pub fn rename_entry(
  session_id: &str,
  shell_id: Option<&str>,
  from_path: &str,
  to_path: &str,
  state: tauri::State<'_, DatabaseState>,
  terminals: tauri::State<'_, TerminalManager>,
  sftp_manager: tauri::State<'_, SftpManager>,
) -> Result<(), String> {
  let _ = shell_id;
  let _ = terminals;

  with_session_auth(session_id, state, |auth| {
    with_persistent_sftp(session_id, auth, sftp_manager, |sftp| {
      sftp
        .rename(
          Path::new(from_path),
          Path::new(to_path),
          Some(RenameFlags::OVERWRITE | RenameFlags::NATIVE),
        )
        .map_err(|error| format!("No se pudo renombrar {from_path}: {error}"))
    })
  })
}

#[tauri::command]
pub fn delete_entry(
  session_id: &str,
  shell_id: Option<&str>,
  path: &str,
  entry_type: &str,
  state: tauri::State<'_, DatabaseState>,
  terminals: tauri::State<'_, TerminalManager>,
  sftp_manager: tauri::State<'_, SftpManager>,
) -> Result<(), String> {
  let _ = shell_id;
  let _ = terminals;

  with_session_auth(session_id, state, |auth| {
    with_persistent_sftp(session_id, auth, sftp_manager, |sftp| match entry_type {
      "directory" => sftp
        .rmdir(Path::new(path))
        .map_err(|error| format!("No se pudo eliminar la carpeta {path}: {error}")),
      _ => sftp
        .unlink(Path::new(path))
        .map_err(|error| format!("No se pudo eliminar el archivo {path}: {error}")),
    })
  })
}

#[tauri::command]
pub fn upload_file(
  session_id: &str,
  shell_id: Option<&str>,
  remote_path: &str,
  contents: Vec<u8>,
  state: tauri::State<'_, DatabaseState>,
  terminals: tauri::State<'_, TerminalManager>,
  sftp_manager: tauri::State<'_, SftpManager>,
) -> Result<(), String> {
  let _ = shell_id;
  let _ = terminals;

  with_session_auth(session_id, state, |auth| {
    with_persistent_sftp(session_id, auth, sftp_manager, |sftp| {
      let mut remote_file = sftp
        .create(Path::new(remote_path))
        .map_err(|error| format!("No se pudo crear el archivo remoto {remote_path}: {error}"))?;

      remote_file.write_all(&contents).map_err(|error| {
        format!("No se pudo escribir el archivo remoto {remote_path}: {error}")
      })
    })
  })
}

#[tauri::command]
pub fn download_file(
  session_id: &str,
  shell_id: Option<&str>,
  path: &str,
  state: tauri::State<'_, DatabaseState>,
  terminals: tauri::State<'_, TerminalManager>,
  sftp_manager: tauri::State<'_, SftpManager>,
) -> Result<Vec<u8>, String> {
  let _ = shell_id;
  let _ = terminals;

  with_session_auth(session_id, state, |auth| {
    with_persistent_sftp(session_id, auth, sftp_manager, |sftp| {
      let mut remote_file = sftp
        .open(Path::new(path))
        .map_err(|error| format!("No se pudo abrir el archivo remoto {path}: {error}"))?;

      let mut buffer = Vec::new();
      remote_file
        .read_to_end(&mut buffer)
        .map_err(|error| format!("No se pudo descargar el archivo remoto {path}: {error}"))?;

      Ok(buffer)
    })
  })
}
