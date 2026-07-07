pub mod commands;
pub mod models;
pub mod storage;

use storage::DatabaseState;
use commands::ssh::TerminalManager;
use tauri::Manager;

pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      let database_state =
        DatabaseState::initialize(app.handle()).map_err(|error| -> Box<dyn std::error::Error> {
          Box::new(error)
        })?;

      app.manage(database_state);
      app.manage(TerminalManager::default());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::credentials::list_credentials,
      commands::credentials::save_credential,
      commands::credentials::delete_credential,
      commands::sessions::list_sessions,
      commands::sessions::save_session,
      commands::sessions::delete_session,
      commands::tunnel::list_tunnels,
      commands::tunnel::save_tunnel,
      commands::tunnel::delete_tunnel,
      commands::ssh::open_terminal,
      commands::ssh::read_terminal_output,
      commands::ssh::write_terminal_input,
      commands::ssh::resize_terminal,
      commands::ssh::close_terminal,
      commands::sftp::list_directory,
      commands::sftp::create_directory,
      commands::sftp::rename_entry,
      commands::sftp::delete_entry,
      commands::sftp::upload_file,
      commands::sftp::download_file
    ])
    .run(tauri::generate_context!())
    .expect("error while running OpenTermX");
}
