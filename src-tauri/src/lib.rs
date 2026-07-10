pub mod commands;
pub mod models;
pub mod storage;

use storage::DatabaseState;
use commands::ssh::TerminalManager;
use commands::sftp::SftpManager;
use tauri::{Manager, WebviewWindowBuilder};

pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      let main_window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .ok_or_else(|| "No se encontro la configuracion de la ventana principal".to_string())?;

      WebviewWindowBuilder::from_config(app, &main_window_config)?
        .enable_clipboard_access()
        .build()?;

      let database_state =
        DatabaseState::initialize(app.handle()).map_err(|error| -> Box<dyn std::error::Error> {
          Box::new(error)
        })?;

      app.manage(database_state);
      app.manage(TerminalManager::default());
      app.manage(SftpManager::default());
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
      commands::ssh::enable_terminal_stream,
      commands::ssh::read_terminal_output,
      commands::ssh::write_terminal_input,
      commands::ssh::resize_terminal,
      commands::ssh::close_terminal,
      commands::sftp::list_directory,
      commands::sftp::create_directory,
      commands::sftp::rename_entry,
      commands::sftp::delete_entry,
      commands::sftp::upload_file,
      commands::sftp::upload_entries,
      commands::sftp::download_file,
      commands::sftp::download_entries
    ])
    .run(tauri::generate_context!())
    .expect("error while running OpenTermX");
}
