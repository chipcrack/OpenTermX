use crate::models::{CredentialRecord, CredentialUpsertInput};
use crate::storage::DatabaseState;

#[tauri::command]
pub fn list_credentials(
  state: tauri::State<'_, DatabaseState>,
) -> Result<Vec<CredentialRecord>, String> {
  state.list_credentials().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_credential(
  input: CredentialUpsertInput,
  state: tauri::State<'_, DatabaseState>,
) -> Result<CredentialRecord, String> {
  state.save_credential(input).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_credential(
  id: &str,
  state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
  state.delete_credential(id).map_err(|error| error.to_string())
}
