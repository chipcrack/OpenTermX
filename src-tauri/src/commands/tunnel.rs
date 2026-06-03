use crate::models::{TunnelRecord, TunnelUpsertInput};
use crate::storage::DatabaseState;

#[tauri::command]
pub fn list_tunnels(state: tauri::State<'_, DatabaseState>) -> Result<Vec<TunnelRecord>, String> {
  state.list_tunnels().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_tunnel(
  input: TunnelUpsertInput,
  state: tauri::State<'_, DatabaseState>,
) -> Result<TunnelRecord, String> {
  state.save_tunnel(input).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_tunnel(id: &str, state: tauri::State<'_, DatabaseState>) -> Result<(), String> {
  state.delete_tunnel(id).map_err(|error| error.to_string())
}
