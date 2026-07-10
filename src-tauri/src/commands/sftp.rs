use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDownloadResult {
  pub cancelled: bool,
  pub files_downloaded: u32,
  pub directories_prepared: u32,
  pub files_skipped: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpUploadResult {
  pub cancelled: bool,
  pub files_uploaded: u32,
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

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
fn run_hidden_powershell(script: &str, error_context: &str) -> Result<String, String> {
  let output = Command::new("powershell")
    .args([
      "-NoProfile",
      "-NonInteractive",
      "-STA",
      "-WindowStyle",
      "Hidden",
      "-Command",
      script,
    ])
    .creation_flags(CREATE_NO_WINDOW)
    .output()
    .map_err(|error| format!("{error_context}: {error}"))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      error_context.to_string()
    } else {
      format!("{error_context}: {stderr}")
    });
  }

  Ok(String::from_utf8_lossy(&output.stdout).to_string())
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

fn normalize_remote_path(path: &str) -> String {
  let replaced = path.trim().replace('\\', "/");

  if replaced.is_empty() || replaced == "/" {
    return "/".to_string();
  }

  let mut normalized = String::with_capacity(replaced.len() + 1);
  if !replaced.starts_with('/') {
    normalized.push('/');
  }
  normalized.push_str(&replaced);

  while normalized.contains("//") {
    normalized = normalized.replace("//", "/");
  }

  if normalized.len() > 1 {
    normalized.truncate(normalized.trim_end_matches('/').len());
  }

  if normalized.is_empty() {
    "/".to_string()
  } else {
    normalized
  }
}

fn join_remote_path(base: &str, child: &str) -> String {
  let normalized_child = child.trim().replace('\\', "/");

  if normalized_child.starts_with('/') {
    return normalize_remote_path(&normalized_child);
  }

  let normalized_base = normalize_remote_path(base);
  normalize_remote_path(&format!("{normalized_base}/{normalized_child}"))
}

fn resolve_remote_home(username: &str) -> String {
  let normalized_user = username.trim();

  if normalized_user.is_empty() {
    return "/".to_string();
  }

  if normalized_user == "root" {
    return "/root".to_string();
  }

  normalize_remote_path(&format!("/home/{normalized_user}"))
}

fn remote_file_name(path: &str) -> String {
  normalize_remote_path(path)
    .split('/')
    .rev()
    .find(|value| !value.trim().is_empty())
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| "descarga".to_string())
}

#[cfg(target_os = "windows")]
fn pick_download_directory() -> Result<Option<PathBuf>, String> {
  let script = concat!(
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ",
    "Add-Type -AssemblyName System.Windows.Forms; ",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog; ",
    "$dialog.Description = 'Selecciona la carpeta de destino'; ",
    "$dialog.ShowNewFolderButton = $true; ",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { ",
    "Write-Output $dialog.SelectedPath ",
    "}"
  );

  let selected_path = run_hidden_powershell(script, "No se pudo abrir el selector nativo de carpeta")?
    .trim()
    .to_string();
  if selected_path.is_empty() {
    return Ok(None);
  }

  Ok(Some(PathBuf::from(selected_path)))
}

#[cfg(target_os = "windows")]
fn pick_upload_files() -> Result<Vec<PathBuf>, String> {
  let script = concat!(
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ",
    "Add-Type -AssemblyName System.Windows.Forms; ",
    "$dialog = New-Object System.Windows.Forms.OpenFileDialog; ",
    "$dialog.Title = 'Selecciona archivo(s) para subir'; ",
    "$dialog.Multiselect = $true; ",
    "$dialog.CheckFileExists = $true; ",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { ",
    "$dialog.FileNames | ForEach-Object { Write-Output $_ } ",
    "}"
  );

  let output = run_hidden_powershell(script, "No se pudo abrir el selector nativo de archivos")?;
  let files = output
    .lines()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(PathBuf::from)
    .collect::<Vec<_>>();

  Ok(files)
}

#[cfg(not(target_os = "windows"))]
fn pick_download_directory() -> Result<Option<PathBuf>, String> {
  Err("La seleccion nativa de carpeta solo esta implementada para Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
fn pick_upload_files() -> Result<Vec<PathBuf>, String> {
  Err("La seleccion nativa de archivos solo esta implementada para Windows".to_string())
}

fn ensure_local_directory(path: &Path, result: &mut SftpDownloadResult) -> Result<(), String> {
  if path.exists() {
    return Ok(());
  }

  fs::create_dir_all(path)
    .map_err(|error| format!("No se pudo preparar la carpeta local {}: {error}", path.display()))?;
  result.directories_prepared += 1;
  Ok(())
}

fn download_remote_file(
  sftp: &ssh2::Sftp,
  remote_path: &Path,
  local_path: &Path,
  result: &mut SftpDownloadResult,
) -> Result<(), String> {
  if local_path.exists() {
    result.files_skipped += 1;
    return Ok(());
  }

  if let Some(parent) = local_path.parent() {
    ensure_local_directory(parent, result)?;
  }

  let mut remote_file = sftp
    .open(remote_path)
    .map_err(|error| format!("No se pudo abrir el archivo remoto {}: {error}", remote_path.display()))?;

  let mut buffer = Vec::new();
  remote_file
    .read_to_end(&mut buffer)
    .map_err(|error| format!("No se pudo descargar el archivo remoto {}: {error}", remote_path.display()))?;

  fs::write(local_path, buffer)
    .map_err(|error| format!("No se pudo escribir el archivo local {}: {error}", local_path.display()))?;

  result.files_downloaded += 1;
  Ok(())
}

fn download_remote_entry_recursive(
  sftp: &ssh2::Sftp,
  remote_path: &Path,
  local_path: &Path,
  result: &mut SftpDownloadResult,
) -> Result<(), String> {
  let stat = sftp
    .stat(remote_path)
    .map_err(|error| format!("No se pudo consultar {}: {error}", remote_path.display()))?;

  if stat.is_dir() {
    ensure_local_directory(local_path, result)?;

    let entries = sftp
      .readdir(remote_path)
      .map_err(|error| format!("No se pudo listar {}: {error}", remote_path.display()))?;

    for (entry_path, _) in entries {
      let Some(name) = entry_path.file_name().map(|value| value.to_string_lossy().to_string()) else {
        continue;
      };

      if name == "." || name == ".." {
        continue;
      }

      let child_remote_path = if entry_path.is_absolute() {
        entry_path
      } else {
        remote_path.join(&entry_path)
      };
      let child_local_path = local_path.join(&name);

      download_remote_entry_recursive(sftp, &child_remote_path, &child_local_path, result)?;
    }

    return Ok(());
  }

  download_remote_file(sftp, remote_path, local_path, result)
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
        .map(normalize_remote_path)
        .unwrap_or_else(|| resolve_remote_home(&auth.username));
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

          let entry_path_str = entry_path.to_string_lossy().to_string();
          let full_path = if entry_path_str.starts_with('/') || entry_path.is_absolute() {
            normalize_remote_path(&entry_path_str)
          } else {
            join_remote_path(&target_path, &entry_path_str)
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
pub fn upload_entries(
  session_id: &str,
  remote_directory: &str,
  state: tauri::State<'_, DatabaseState>,
  sftp_manager: tauri::State<'_, SftpManager>,
) -> Result<SftpUploadResult, String> {
  let selected_files = pick_upload_files()?;

  if selected_files.is_empty() {
    return Ok(SftpUploadResult {
      cancelled: true,
      files_uploaded: 0,
    });
  }

  let normalized_remote_directory = normalize_remote_path(remote_directory);

  with_session_auth(session_id, state, |auth| {
    with_persistent_sftp(session_id, auth, sftp_manager, |sftp| {
      let mut files_uploaded = 0;

      for local_path in &selected_files {
        let file_name = local_path
          .file_name()
          .map(|value| value.to_string_lossy().trim().to_string())
          .filter(|value| !value.is_empty())
          .ok_or_else(|| format!("No se pudo resolver el nombre del archivo {}", local_path.display()))?;

        let remote_path = join_remote_path(&normalized_remote_directory, &file_name);
        let contents = fs::read(local_path)
          .map_err(|error| format!("No se pudo leer el archivo local {}: {error}", local_path.display()))?;

        let mut remote_file = sftp
          .create(Path::new(&remote_path))
          .map_err(|error| format!("No se pudo crear el archivo remoto {remote_path}: {error}"))?;

        remote_file.write_all(&contents).map_err(|error| {
          format!("No se pudo escribir el archivo remoto {remote_path}: {error}")
        })?;

        files_uploaded += 1;
      }

      Ok(SftpUploadResult {
        cancelled: false,
        files_uploaded,
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

#[tauri::command]
pub fn download_entries(
  session_id: &str,
  paths: Vec<String>,
  state: tauri::State<'_, DatabaseState>,
  sftp_manager: tauri::State<'_, SftpManager>,
) -> Result<SftpDownloadResult, String> {
  if paths.is_empty() {
    return Ok(SftpDownloadResult {
      cancelled: false,
      files_downloaded: 0,
      directories_prepared: 0,
      files_skipped: 0,
    });
  }

  let Some(destination_root) = pick_download_directory()? else {
    return Ok(SftpDownloadResult {
      cancelled: true,
      files_downloaded: 0,
      directories_prepared: 0,
      files_skipped: 0,
    });
  };

  with_session_auth(session_id, state, |auth| {
    with_persistent_sftp(session_id, auth, sftp_manager, |sftp| {
      let mut result = SftpDownloadResult {
        cancelled: false,
        files_downloaded: 0,
        directories_prepared: 0,
        files_skipped: 0,
      };

      for remote_path in &paths {
        let local_target = destination_root.join(remote_file_name(remote_path));
        download_remote_entry_recursive(sftp, Path::new(remote_path), &local_target, &mut result)?;
      }

      Ok(result)
    })
  })
}
