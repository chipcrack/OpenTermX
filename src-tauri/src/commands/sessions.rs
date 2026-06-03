use crate::models::{SessionRecord, SessionUpsertInput};
use crate::storage::DatabaseState;

#[tauri::command]
pub fn list_sessions(state: tauri::State<'_, DatabaseState>) -> Result<Vec<SessionRecord>, String> {
  state.list_sessions().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_session(
  input: SessionUpsertInput,
  state: tauri::State<'_, DatabaseState>,
) -> Result<SessionRecord, String> {
  state.save_session(input).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_session(id: &str, state: tauri::State<'_, DatabaseState>) -> Result<(), String> {
  state.delete_session(id).map_err(|error| error.to_string())
}
