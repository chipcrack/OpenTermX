use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;

use crate::models::WorkspaceTransferData;
use crate::storage::DatabaseState;

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

#[cfg(target_os = "windows")]
fn pick_export_file_path() -> Result<Option<PathBuf>, String> {
  let script = concat!(
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ",
    "Add-Type -AssemblyName System.Windows.Forms; ",
    "$dialog = New-Object System.Windows.Forms.SaveFileDialog; ",
    "$dialog.Title = 'Guardar exportacion de credenciales y sesiones'; ",
    "$dialog.Filter = 'Archivos JSON (*.json)|*.json'; ",
    "$dialog.DefaultExt = 'json'; ",
    "$dialog.AddExtension = $true; ",
    "$dialog.OverwritePrompt = $true; ",
    "$dialog.FileName = 'opentermx-credenciales-sesiones.json'; ",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { ",
    "Write-Output $dialog.FileName ",
    "}"
  );

  let selected_path = run_hidden_powershell(script, "No se pudo abrir el selector nativo para guardar")?
    .trim()
    .to_string();
  if selected_path.is_empty() {
    return Ok(None);
  }

  Ok(Some(PathBuf::from(selected_path)))
}

#[cfg(not(target_os = "windows"))]
fn pick_export_file_path() -> Result<Option<PathBuf>, String> {
  Err("La exportacion con selector nativo solo esta implementada para Windows".to_string())
}

#[tauri::command]
pub fn export_workspace_data(
  state: tauri::State<'_, DatabaseState>,
) -> Result<WorkspaceTransferData, String> {
  state.export_workspace_data().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn export_workspace_data_to_file(
  state: tauri::State<'_, DatabaseState>,
) -> Result<Option<String>, String> {
  let data = state.export_workspace_data().map_err(|error| error.to_string())?;
  let Some(target_path) = pick_export_file_path()? else {
    return Ok(None);
  };

  let payload = serde_json::to_string_pretty(&data)
    .map_err(|error| format!("No se pudo serializar la exportacion: {error}"))?;
  fs::write(&target_path, payload)
    .map_err(|error| format!("No se pudo guardar el archivo {}: {error}", target_path.display()))?;

  Ok(Some(target_path.display().to_string()))
}

#[tauri::command]
pub fn import_workspace_data(
  input: WorkspaceTransferData,
  state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
  state.import_workspace_data(input).map_err(|error| error.to_string())
}
