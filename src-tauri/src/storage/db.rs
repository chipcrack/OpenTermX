use std::fs;
use std::collections::HashSet;
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{params, Connection, Transaction};
use tauri::{AppHandle, Manager};
use thiserror::Error;

use crate::models::{
  CredentialRecord,
  CredentialUpsertInput,
  SessionRecord,
  SessionUpsertInput,
  TunnelRecord,
  TunnelUpsertInput,
  WorkspaceTransferData,
};

#[derive(Debug, Error)]
pub enum StorageError {
  #[error("database error: {0}")]
  Database(#[from] rusqlite::Error),
  #[error("io error: {0}")]
  Io(#[from] std::io::Error),
  #[error("path error: {0}")]
  Path(String),
  #[error("validation error: {0}")]
  Validation(String),
  #[error("state lock poisoned")]
  StatePoisoned,
}

pub(crate) struct SessionAuth {
  pub(crate) host: String,
  pub(crate) port: i64,
  pub(crate) username: String,
  pub(crate) password: String,
}

pub struct DatabaseState {
  connection: Mutex<Connection>,
}

impl DatabaseState {
  pub fn initialize(app: &AppHandle) -> Result<Self, StorageError> {
    let app_data_dir = app
      .path()
      .app_data_dir()
      .map_err(|error| StorageError::Path(error.to_string()))?;

    fs::create_dir_all(&app_data_dir)?;

    let connection = Connection::open(app_data_dir.join("opentermx.sqlite3"))?;
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;
    let state = Self {
      connection: Mutex::new(connection),
    };

    state.migrate()?;
    state.seed()?;

    Ok(state)
  }

  pub fn list_sessions(&self) -> Result<Vec<SessionRecord>, StorageError> {
    let connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;
    let mut statement = connection.prepare(
      "SELECT
         sessions.id,
         sessions.name,
         sessions.host,
         sessions.port,
         COALESCE(credentials.username, sessions.username),
         sessions.environment,
         sessions.group_name,
         sessions.color,
         sessions.description,
         COALESCE(sessions.last_connection, ''),
         sessions.favorite,
         sessions.auth_kind,
         sessions.credential_id,
         credentials.label,
         CASE WHEN sessions.password IS NOT NULL AND length(sessions.password) > 0 THEN 1 ELSE 0 END
       FROM sessions
       LEFT JOIN credentials ON credentials.id = sessions.credential_id
       ORDER BY favorite DESC, group_name ASC, name ASC",
    )?;

    let rows = statement.query_map([], |row| {
      Ok(SessionRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        host: row.get(2)?,
        port: row.get(3)?,
        username: row.get(4)?,
        environment: row.get(5)?,
        group_name: row.get(6)?,
        color: row.get(7)?,
        description: row.get(8)?,
        last_connection: row.get(9)?,
        favorite: row.get::<_, i64>(10)? == 1,
        auth_kind: row.get(11)?,
        credential_id: row.get(12)?,
        credential_label: row.get(13)?,
        has_password: row.get::<_, i64>(14)? == 1,
      })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(StorageError::from)
  }

  pub fn export_workspace_data(&self) -> Result<WorkspaceTransferData, StorageError> {
    let connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;

    let mut credential_statement = connection.prepare(
      "SELECT id, label, username, password, COALESCE(note, '')
       FROM credentials
       ORDER BY label ASC",
    )?;
    let credentials = credential_statement
      .query_map([], |row| {
        Ok(CredentialUpsertInput {
          id: Some(row.get(0)?),
          label: row.get(1)?,
          username: row.get(2)?,
          password: row.get(3)?,
          note: row.get(4)?,
        })
      })?
      .collect::<Result<Vec<_>, _>>()?;

    let mut session_statement = connection.prepare(
      "SELECT
         id,
         name,
         host,
         port,
         username,
         environment,
         group_name,
         color,
         COALESCE(description, ''),
         favorite,
         auth_kind,
         credential_id,
         password
       FROM sessions
       ORDER BY favorite DESC, group_name ASC, name ASC",
    )?;
    let sessions = session_statement
      .query_map([], |row| {
        Ok(SessionUpsertInput {
          id: Some(row.get(0)?),
          name: row.get(1)?,
          host: row.get(2)?,
          port: row.get(3)?,
          username: row.get(4)?,
          environment: row.get(5)?,
          group_name: row.get(6)?,
          color: row.get(7)?,
          description: row.get(8)?,
          favorite: row.get::<_, i64>(9)? == 1,
          auth_kind: row.get(10)?,
          credential_id: row.get(11)?,
          password: row.get(12)?,
        })
      })?
      .collect::<Result<Vec<_>, _>>()?;

    Ok(WorkspaceTransferData {
      version: 1,
      exported_at: Utc::now().to_rfc3339(),
      credentials,
      sessions,
    })
  }

  pub fn import_workspace_data(&self, input: WorkspaceTransferData) -> Result<(), StorageError> {
    Self::validate_workspace_transfer(&input)?;

    let mut connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;
    let transaction = connection.transaction()?;

    for credential in &input.credentials {
      Self::upsert_credential_in_transaction(&transaction, credential)?;
    }

    for session in &input.sessions {
      Self::upsert_session_in_transaction(&transaction, session)?;
    }

    transaction.commit()?;
    Ok(())
  }

  pub fn list_tunnels(&self) -> Result<Vec<TunnelRecord>, StorageError> {
    let connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;
    let mut statement = connection.prepare(
      "SELECT id, session_id, name, local_port, remote_host, remote_port, status
       FROM tunnels
       ORDER BY name ASC",
    )?;

    let rows = statement.query_map([], |row| {
      Ok(TunnelRecord {
        id: row.get(0)?,
        session_id: row.get(1)?,
        name: row.get(2)?,
        local_port: row.get(3)?,
        remote_host: row.get(4)?,
        remote_port: row.get(5)?,
        status: row.get(6)?,
      })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(StorageError::from)
  }

  pub fn get_session(&self, id: &str) -> Result<SessionRecord, StorageError> {
    let connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;

    connection.query_row(
      "SELECT
         sessions.id,
         sessions.name,
         sessions.host,
         sessions.port,
         COALESCE(credentials.username, sessions.username),
         sessions.environment,
         sessions.group_name,
         sessions.color,
         sessions.description,
         COALESCE(sessions.last_connection, ''),
         sessions.favorite,
         sessions.auth_kind,
         sessions.credential_id,
         credentials.label,
         CASE WHEN sessions.password IS NOT NULL AND length(sessions.password) > 0 THEN 1 ELSE 0 END
       FROM sessions
       LEFT JOIN credentials ON credentials.id = sessions.credential_id
       WHERE sessions.id = ?1",
      params![id],
      |row| {
        Ok(SessionRecord {
          id: row.get(0)?,
          name: row.get(1)?,
          host: row.get(2)?,
          port: row.get(3)?,
          username: row.get(4)?,
          environment: row.get(5)?,
          group_name: row.get(6)?,
          color: row.get(7)?,
          description: row.get(8)?,
          last_connection: row.get(9)?,
          favorite: row.get::<_, i64>(10)? == 1,
          auth_kind: row.get(11)?,
          credential_id: row.get(12)?,
          credential_label: row.get(13)?,
          has_password: row.get::<_, i64>(14)? == 1,
        })
      },
    )
    .map_err(StorageError::from)
  }

  pub fn save_session(&self, input: SessionUpsertInput) -> Result<SessionRecord, StorageError> {
    let session_id = input
      .id
      .clone()
      .unwrap_or_else(|| format!("session-{}", Utc::now().timestamp_millis()));
    let connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;
    let auth_kind = input.auth_kind.trim();

    let (username, password, credential_id) = match auth_kind {
      "credential" => {
        let credential_id = input
          .credential_id
          .clone()
          .ok_or_else(|| StorageError::Validation("Selecciona una credencial guardada".to_string()))?;
        let (credential_username,): (String,) = connection.query_row(
          "SELECT username FROM credentials WHERE id = ?1",
          params![credential_id],
          |row| Ok((row.get(0)?,)),
        )?;

        (credential_username, None::<String>, Some(credential_id))
      }
      "manual" => {
        let next_password = match input.password.clone() {
          Some(value) if !value.trim().is_empty() => Some(value),
          _ => connection
            .query_row(
              "SELECT password FROM sessions WHERE id = ?1",
              params![session_id],
              |row| row.get(0),
            )
            .ok(),
        };

        (input.username.clone(), next_password, None::<String>)
      }
      _ => {
        return Err(StorageError::Validation(
          "El tipo de autenticacion debe ser manual o credential".to_string()
        ));
      }
    };

    connection.execute(
      "INSERT INTO sessions (id, name, host, port, username, password, auth_kind, credential_id, environment, group_name, color, description, last_connection, favorite, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, COALESCE((SELECT last_connection FROM sessions WHERE id = ?1), 'Nunca'), ?13, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         host = excluded.host,
         port = excluded.port,
         username = excluded.username,
         password = excluded.password,
         auth_kind = excluded.auth_kind,
         credential_id = excluded.credential_id,
         environment = excluded.environment,
         group_name = excluded.group_name,
         color = excluded.color,
         description = excluded.description,
         favorite = excluded.favorite,
         updated_at = CURRENT_TIMESTAMP",
      params![
        session_id,
        input.name,
        input.host,
        input.port,
        username,
        password,
        auth_kind,
        credential_id,
        input.environment,
        input.group_name,
        input.color,
        input.description,
        if input.favorite { 1 } else { 0 },
      ],
    )?;

    drop(connection);
    self.get_session(&session_id)
  }

  pub fn list_credentials(&self) -> Result<Vec<CredentialRecord>, StorageError> {
    let connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;
    let mut statement = connection.prepare(
      "SELECT id, label, username, password, COALESCE(note, '')
       FROM credentials
       ORDER BY label ASC",
    )?;

    let rows = statement.query_map([], |row| {
      Ok(CredentialRecord {
        id: row.get(0)?,
        label: row.get(1)?,
        username: row.get(2)?,
        password: row.get(3)?,
        note: row.get(4)?,
      })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(StorageError::from)
  }

  pub fn save_credential(&self, input: CredentialUpsertInput) -> Result<CredentialRecord, StorageError> {
    let credential_id = input
      .id
      .clone()
      .unwrap_or_else(|| format!("credential-{}", Utc::now().timestamp_millis()));
    let connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;

    connection.execute(
      "INSERT INTO credentials (id, label, username, password, note, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label,
         username = excluded.username,
         password = excluded.password,
         note = excluded.note,
         updated_at = CURRENT_TIMESTAMP",
      params![
        credential_id,
        input.label,
        input.username,
        input.password,
        input.note
      ],
    )?;

    connection.query_row(
      "SELECT id, label, username, password, COALESCE(note, '')
       FROM credentials
       WHERE id = ?1",
      params![credential_id],
      |row| {
        Ok(CredentialRecord {
          id: row.get(0)?,
          label: row.get(1)?,
          username: row.get(2)?,
          password: row.get(3)?,
          note: row.get(4)?,
        })
      },
    )
    .map_err(StorageError::from)
  }

  pub fn delete_credential(&self, id: &str) -> Result<(), StorageError> {
    let connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;
    let linked_count: i64 = connection.query_row(
      "SELECT COUNT(*) FROM sessions WHERE credential_id = ?1",
      params![id],
      |row| row.get(0),
    )?;

    if linked_count > 0 {
      return Err(StorageError::Validation(
        "No puedes eliminar una credencial que sigue asignada a sesiones".to_string()
      ));
    }

    connection.execute("DELETE FROM credentials WHERE id = ?1", params![id])?;
    Ok(())
  }

  pub fn delete_session(&self, id: &str) -> Result<(), StorageError> {
    let connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;
    connection.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
    Ok(())
  }

  pub fn save_tunnel(&self, input: TunnelUpsertInput) -> Result<TunnelRecord, StorageError> {
    let tunnel_id = input
      .id
      .clone()
      .unwrap_or_else(|| format!("tunnel-{}", Utc::now().timestamp_millis()));
    let connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;

    connection.execute(
      "INSERT INTO tunnels (id, session_id, name, local_port, remote_host, remote_port, status, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         session_id = excluded.session_id,
         name = excluded.name,
         local_port = excluded.local_port,
         remote_host = excluded.remote_host,
         remote_port = excluded.remote_port,
         status = excluded.status,
         updated_at = CURRENT_TIMESTAMP",
      params![
        tunnel_id,
        input.session_id,
        input.name,
        input.local_port,
        input.remote_host,
        input.remote_port,
        input.status
      ],
    )?;

    connection.query_row(
      "SELECT id, session_id, name, local_port, remote_host, remote_port, status
       FROM tunnels
       WHERE id = ?1",
      params![tunnel_id],
      |row| {
        Ok(TunnelRecord {
          id: row.get(0)?,
          session_id: row.get(1)?,
          name: row.get(2)?,
          local_port: row.get(3)?,
          remote_host: row.get(4)?,
          remote_port: row.get(5)?,
          status: row.get(6)?,
        })
      },
    )
    .map_err(StorageError::from)
  }

  pub fn delete_tunnel(&self, id: &str) -> Result<(), StorageError> {
    let connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;
    connection.execute("DELETE FROM tunnels WHERE id = ?1", params![id])?;
    Ok(())
  }

  pub(crate) fn resolve_session_auth(&self, id: &str) -> Result<SessionAuth, StorageError> {
    let connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;

    connection
      .query_row(
        "SELECT
           sessions.host,
           sessions.port,
           CASE
             WHEN sessions.auth_kind = 'credential' THEN credentials.username
             ELSE sessions.username
           END,
           CASE
             WHEN sessions.auth_kind = 'credential' THEN credentials.password
             ELSE sessions.password
           END
         FROM sessions
         LEFT JOIN credentials ON credentials.id = sessions.credential_id
         WHERE sessions.id = ?1",
        params![id],
        |row| {
          let username: Option<String> = row.get(2)?;
          let password: Option<String> = row.get(3)?;

          Ok(SessionAuth {
            host: row.get(0)?,
            port: row.get(1)?,
            username: username.ok_or_else(|| {
              rusqlite::Error::InvalidColumnType(
                2,
                "username".to_string(),
                rusqlite::types::Type::Null,
              )
            })?,
            password: password.ok_or_else(|| {
              rusqlite::Error::InvalidColumnType(
                3,
                "password".to_string(),
                rusqlite::types::Type::Null,
              )
            })?,
          })
        },
      )
      .map_err(|error| match error {
        rusqlite::Error::InvalidColumnType(..) => StorageError::Validation(
          "La sesion no tiene credenciales completas para autenticarse".to_string()
        ),
        other => StorageError::Database(other),
      })
  }

  pub fn touch_session_connection(&self, id: &str) -> Result<(), StorageError> {
    let connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;
    let now = Utc::now().format("%Y-%m-%d %H:%M").to_string();
    connection.execute(
      "UPDATE sessions
       SET last_connection = ?2, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1",
      params![id, now],
    )?;
    Ok(())
  }

  fn migrate(&self) -> Result<(), StorageError> {
    let schema = include_str!("../../../database/schema.sql");
    let connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;
    let sessions_exists = Self::table_exists(&connection, "sessions")?;

    if sessions_exists {
      Self::ensure_credentials_table(&connection)?;
      Self::ensure_session_columns(&connection)?;
    }

    connection.execute_batch(schema)?;
    Self::ensure_credentials_table(&connection)?;
    Self::ensure_session_columns(&connection)?;
    Ok(())
  }

  fn seed(&self) -> Result<(), StorageError> {
    let connection = self.connection.lock().map_err(|_| StorageError::StatePoisoned)?;
    let session_count: i64 =
      connection.query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))?;
    let tunnel_count: i64 =
      connection.query_row("SELECT COUNT(*) FROM tunnels", [], |row| row.get(0))?;

    if session_count == 0 && tunnel_count == 0 {
      connection.execute(
        "INSERT INTO sessions (id, name, host, port, username, environment, group_name, color, description, last_connection, favorite)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
          "prod-api",
          "Production API",
          "api.prod.internal",
          22,
          "deploy",
          "production",
          "Core Platform",
          "#ef4444",
          "Servicios críticos del API principal",
          "Hace 18 min",
          1
        ],
      )?;

      connection.execute(
        "INSERT INTO sessions (id, name, host, port, username, environment, group_name, color, description, last_connection, favorite)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
          "staging-web",
          "Staging Web",
          "web.staging.internal",
          22,
          "frontend",
          "staging",
          "Web Experience",
          "#f59e0b",
          "Entorno de validación para QA",
          "Hace 2 h",
          0
        ],
      )?;

      connection.execute(
        "INSERT INTO sessions (id, name, host, port, username, environment, group_name, color, description, last_connection, favorite)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
          "dev-db",
          "Dev Database",
          "db.dev.internal",
          22,
          "postgres",
          "development",
          "Data Services",
          "#22c55e",
          "Base de datos de desarrollo local remota",
          "Ayer",
          0
        ],
      )?;

      connection.execute(
        "INSERT INTO tunnels (id, session_id, name, local_port, remote_host, remote_port, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
          "tunnel-admin",
          "prod-api",
          "Admin Dashboard",
          8080,
          "127.0.0.1",
          3000,
          "active"
        ],
      )?;

      connection.execute(
        "INSERT INTO tunnels (id, session_id, name, local_port, remote_host, remote_port, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
          "tunnel-pg",
          "dev-db",
          "PostgreSQL Forward",
          5433,
          "127.0.0.1",
          5432,
          "inactive"
        ],
      )?;
    }

    Ok(())
  }

  fn ensure_session_columns(connection: &Connection) -> Result<(), StorageError> {
    let columns = Self::table_columns(connection, "sessions")?;

    if !columns.contains("password") {
      connection.execute("ALTER TABLE sessions ADD COLUMN password TEXT", [])?;
    }
    if !columns.contains("auth_kind") {
      connection.execute(
        "ALTER TABLE sessions ADD COLUMN auth_kind TEXT NOT NULL DEFAULT 'manual'",
        [],
      )?;
    }
    if !columns.contains("credential_id") {
      connection.execute("ALTER TABLE sessions ADD COLUMN credential_id TEXT", [])?;
    }

    Ok(())
  }

  fn ensure_credentials_table(connection: &Connection) -> Result<(), StorageError> {
    connection.execute_batch(
      "CREATE TABLE IF NOT EXISTS credentials (
         id TEXT PRIMARY KEY,
         label TEXT NOT NULL,
         username TEXT NOT NULL,
         password TEXT NOT NULL,
         note TEXT,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       );
       CREATE INDEX IF NOT EXISTS idx_credentials_label ON credentials(label);",
    )?;

    Ok(())
  }

  fn table_columns(connection: &Connection, table: &str) -> Result<HashSet<String>, StorageError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
    let columns = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(columns.into_iter().collect())
  }

  fn table_exists(connection: &Connection, table: &str) -> Result<bool, StorageError> {
    let exists: i64 = connection.query_row(
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
      params![table],
      |row| row.get(0),
    )?;

    Ok(exists > 0)
  }

  fn validate_workspace_transfer(input: &WorkspaceTransferData) -> Result<(), StorageError> {
    if input.version != 1 {
      return Err(StorageError::Validation(
        "La version del archivo no es compatible con esta importacion".to_string(),
      ));
    }

    let mut credential_ids = HashSet::new();
    for credential in &input.credentials {
      let credential_id = credential.id.as_ref().ok_or_else(|| {
        StorageError::Validation("Cada credencial importada debe incluir un id".to_string())
      })?;

      if !credential_ids.insert(credential_id.clone()) {
        return Err(StorageError::Validation(format!(
          "La credencial importada '{credential_id}' aparece duplicada"
        )));
      }
    }

    let mut session_ids = HashSet::new();
    for session in &input.sessions {
      let session_id = session.id.as_ref().ok_or_else(|| {
        StorageError::Validation("Cada sesion importada debe incluir un id".to_string())
      })?;

      if !session_ids.insert(session_id.clone()) {
        return Err(StorageError::Validation(format!(
          "La sesion importada '{session_id}' aparece duplicada"
        )));
      }

      match session.auth_kind.trim() {
        "manual" => {}
        "credential" => {
          if session
            .credential_id
            .as_ref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
          {
            return Err(StorageError::Validation(format!(
              "La sesion '{session_id}' requiere una credencial valida"
            )));
          }
        }
        _ => {
          return Err(StorageError::Validation(format!(
            "La sesion '{session_id}' tiene un tipo de autenticacion invalido"
          )));
        }
      }
    }

    Ok(())
  }

  fn upsert_credential_in_transaction(
    transaction: &Transaction<'_>,
    input: &CredentialUpsertInput,
  ) -> Result<(), StorageError> {
    let credential_id = input.id.as_ref().ok_or_else(|| {
      StorageError::Validation("Cada credencial importada debe incluir un id".to_string())
    })?;

    transaction.execute(
      "INSERT INTO credentials (id, label, username, password, note, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label,
         username = excluded.username,
         password = excluded.password,
         note = excluded.note,
         updated_at = CURRENT_TIMESTAMP",
      params![
        credential_id,
        input.label,
        input.username,
        input.password,
        input.note
      ],
    )?;

    Ok(())
  }

  fn upsert_session_in_transaction(
    transaction: &Transaction<'_>,
    input: &SessionUpsertInput,
  ) -> Result<(), StorageError> {
    let session_id = input.id.as_ref().ok_or_else(|| {
      StorageError::Validation("Cada sesion importada debe incluir un id".to_string())
    })?;
    let auth_kind = input.auth_kind.trim();

    let (username, password, credential_id) = match auth_kind {
      "credential" => {
        let credential_id = input
          .credential_id
          .clone()
          .ok_or_else(|| StorageError::Validation("Selecciona una credencial guardada".to_string()))?;
        let (credential_username,): (String,) = transaction.query_row(
          "SELECT username FROM credentials WHERE id = ?1",
          params![credential_id],
          |row| Ok((row.get(0)?,)),
        )?;

        (credential_username, None::<String>, Some(credential_id))
      }
      "manual" => {
        let next_password = match input.password.clone() {
          Some(value) if !value.trim().is_empty() => Some(value),
          _ => transaction
            .query_row(
              "SELECT password FROM sessions WHERE id = ?1",
              params![session_id],
              |row| row.get(0),
            )
            .ok(),
        };

        (input.username.clone(), next_password, None::<String>)
      }
      _ => {
        return Err(StorageError::Validation(
          "El tipo de autenticacion debe ser manual o credential".to_string(),
        ));
      }
    };

    transaction.execute(
      "INSERT INTO sessions (id, name, host, port, username, password, auth_kind, credential_id, environment, group_name, color, description, last_connection, favorite, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, COALESCE((SELECT last_connection FROM sessions WHERE id = ?1), 'Nunca'), ?13, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         host = excluded.host,
         port = excluded.port,
         username = excluded.username,
         password = excluded.password,
         auth_kind = excluded.auth_kind,
         credential_id = excluded.credential_id,
         environment = excluded.environment,
         group_name = excluded.group_name,
         color = excluded.color,
         description = excluded.description,
         favorite = excluded.favorite,
         updated_at = CURRENT_TIMESTAMP",
      params![
        session_id,
        input.name,
        input.host,
        input.port,
        username,
        password,
        auth_kind,
        credential_id,
        input.environment,
        input.group_name,
        input.color,
        input.description,
        if input.favorite { 1 } else { 0 },
      ],
    )?;

    Ok(())
  }
}
