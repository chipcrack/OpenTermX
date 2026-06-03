use std::path::Path;

use chrono::{DateTime, Utc};
use serde::Serialize;
use ssh2::RenameFlags;

use crate::commands::ssh::connect_authenticated_session;
use crate::storage::DatabaseState;

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

fn format_size(size: Option<u64>) -> String {
  let Some(bytes) = size else {
    return "—".to_string();
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
    return "—".to_string();
  };

  DateTime::<Utc>::from_timestamp(seconds as i64, 0)
    .map(|value| value.format("%Y-%m-%d %H:%M").to_string())
    .unwrap_or_else(|| "—".to_string())
}

fn with_sftp<T>(
  session_id: &str,
  state: tauri::State<'_, DatabaseState>,
  callback: impl FnOnce(&ssh2::Sftp, &str) -> Result<T, String>,
) -> Result<T, String> {
  let auth = state
    .resolve_session_auth(session_id)
    .map_err(|error| error.to_string())?;
  let ssh = connect_authenticated_session(&auth)?;
  let sftp = ssh
    .sftp()
    .map_err(|error| format!("No se pudo iniciar SFTP: {error}"))?;

  callback(&sftp, &auth.username)
}

#[tauri::command]
pub fn list_directory(
  session_id: &str,
  path: Option<&str>,
  state: tauri::State<'_, DatabaseState>,
) -> Result<Vec<SftpEntry>, String> {
  with_sftp(session_id, state, |sftp, username| {
    let target_path = path
      .filter(|value| !value.trim().is_empty())
      .map(str::to_string)
      .unwrap_or_else(|| format!("/home/{username}"));
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
            "—".to_string()
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
}

#[tauri::command]
pub fn create_directory(
  session_id: &str,
  path: &str,
  state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
  with_sftp(session_id, state, |sftp, _| {
    sftp
      .mkdir(Path::new(path), 0o755)
      .map_err(|error| format!("No se pudo crear la carpeta {path}: {error}"))
  })
}

#[tauri::command]
pub fn rename_entry(
  session_id: &str,
  from_path: &str,
  to_path: &str,
  state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
  with_sftp(session_id, state, |sftp, _| {
    sftp
      .rename(
        Path::new(from_path),
        Path::new(to_path),
        Some(RenameFlags::OVERWRITE | RenameFlags::NATIVE),
      )
      .map_err(|error| format!("No se pudo renombrar {from_path}: {error}"))
  })
}

#[tauri::command]
pub fn delete_entry(
  session_id: &str,
  path: &str,
  entry_type: &str,
  state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
  with_sftp(session_id, state, |sftp, _| {
    match entry_type {
      "directory" => sftp
        .rmdir(Path::new(path))
        .map_err(|error| format!("No se pudo eliminar la carpeta {path}: {error}")),
      _ => sftp
        .unlink(Path::new(path))
        .map_err(|error| format!("No se pudo eliminar el archivo {path}: {error}")),
    }
  })
}
