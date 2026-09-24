use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use ssh2::{HashType, Session};

const ERROR_PREFIX: &str = "SSH_HOST_KEY:";
const PENDING_LIFETIME: Duration = Duration::from_secs(600);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostKeyNotice {
  code: &'static str,
  host: String,
  port: u16,
  algorithm: String,
  fingerprint: String,
  expected_fingerprint: Option<String>,
  token: Option<String>,
}

struct PendingKey {
  notice: HostKeyNotice,
  key: Vec<u8>,
  created_at: Instant,
}

struct TrustState {
  connection: Connection,
  pending: HashMap<String, PendingKey>,
  next_token: u64,
}

/// App-owned trust store: no OS-specific paths, shell commands or secret data.
pub struct HostKeyStore(Mutex<TrustState>);

impl HostKeyStore {
  pub fn open(path: &Path) -> Result<Self, String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    Self::from_connection(connection)
  }

  fn from_connection(connection: Connection) -> Result<Self, String> {
    connection.busy_timeout(Duration::from_secs(5)).map_err(|error| error.to_string())?;
    connection.execute_batch(
      "CREATE TABLE IF NOT EXISTS trusted_host_keys (
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        key BLOB NOT NULL,
        fingerprint TEXT NOT NULL,
        PRIMARY KEY (host, port)
      );",
    ).map_err(|error| error.to_string())?;
    Ok(Self(Mutex::new(TrustState {
      connection,
      pending: HashMap::new(),
      next_token: 0,
    })))
  }

  /// Must run after the handshake and before any authentication attempt.
  pub fn verify(&self, ssh: &Session, host: &str, port: i64) -> Result<(), String> {
    let (key, algorithm) = ssh.host_key()
      .ok_or_else(|| "El servidor no presento una clave SSH".to_string())?;
    let hash = ssh.host_key_hash(HashType::Sha256)
      .ok_or_else(|| "No se pudo calcular la huella SHA-256 del servidor".to_string())?;
    self.verify_key(host, port, key, &format!("{algorithm:?}"),
      &format!("SHA256:{}", STANDARD_NO_PAD.encode(hash)))
  }

  fn verify_key(
    &self, host: &str, port: i64, key: &[u8], algorithm: &str, fingerprint: &str,
  ) -> Result<(), String> {
    let port = u16::try_from(port).ok().filter(|port| *port != 0)
      .ok_or_else(|| "Puerto SSH invalido".to_string())?;
    // Normalize DNS case and bracketed IPv6 without conflating distinct ports.
    let host = host.trim().trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    let mut state = self.0.lock().map_err(|_| "No se pudo acceder a las claves SSH".to_string())?;
    let known = lookup(&state.connection, &host, port)?;
    if let Some((ref known_key, _)) = known {
      if known_key == key {
        return Ok(());
      }
    }

    let mut notice = HostKeyNotice {
      code: if known.is_some() { "changed" } else { "unknown" },
      host,
      port,
      algorithm: algorithm.to_string(),
      fingerprint: fingerprint.to_string(),
      expected_fingerprint: known.map(|(_, fingerprint)| fingerprint),
      token: None,
    };

    if notice.code == "unknown" {
      state.pending.retain(|_, pending| pending.created_at.elapsed() < PENDING_LIFETIME);
      let existing = state.pending.iter().find(|(_, pending)| {
        pending.notice.host == notice.host && pending.notice.port == port && pending.key == key
      }).map(|(token, _)| token.clone());
      let token = if let Some(token) = existing {
        token
      } else {
        if state.pending.len() >= 128 {
          return Err("Hay demasiadas verificaciones SSH pendientes; cierra conexiones y reintenta".to_string());
        }
        state.next_token += 1;
        let token = state.next_token.to_string();
        state.pending.insert(token.clone(), PendingKey {
          notice: notice.clone(), key: key.to_vec(), created_at: Instant::now(),
        });
        token
      };
      notice.token = Some(token);
    }
    Err(format!("{ERROR_PREFIX}{}", serde_json::to_string(&notice).map_err(|error| error.to_string())?))
  }

  pub fn resolve(&self, token: &str, accept: bool) -> Result<(), String> {
    let mut state = self.0.lock().map_err(|_| "No se pudo acceder a las claves SSH".to_string())?;
    let pending = state.pending.remove(token)
      .ok_or_else(|| "La verificacion SSH ya no esta pendiente; vuelve a conectar".to_string())?;
    if !accept {
      return Ok(());
    }
    if pending.created_at.elapsed() >= PENDING_LIFETIME {
      return Err("La verificacion SSH expiro; vuelve a conectar".to_string());
    }
    // Never replace an existing key, including racing confirmations/connections.
    let transaction = state.connection.transaction().map_err(|error| error.to_string())?;
    if let Some((key, _)) = lookup(&transaction, &pending.notice.host, pending.notice.port)? {
      if key != pending.key {
        return Err("La clave SSH guardada cambio durante la confirmacion. Conexion bloqueada".to_string());
      }
    } else {
      transaction.execute(
        "INSERT INTO trusted_host_keys (host, port, key, fingerprint) VALUES (?1, ?2, ?3, ?4)",
        params![pending.notice.host, pending.notice.port, pending.key, pending.notice.fingerprint],
      ).map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
  }
}

fn lookup(connection: &Connection, host: &str, port: u16) -> Result<Option<(Vec<u8>, String)>, String> {
  connection.query_row(
    "SELECT key, fingerprint FROM trusted_host_keys WHERE host = ?1 AND port = ?2",
    params![host, port], |row| Ok((row.get(0)?, row.get(1)?)),
  ).optional().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn resolve_host_key(
  token: &str, accept: bool, host_keys: tauri::State<'_, HostKeyStore>,
) -> Result<(), String> {
  host_keys.resolve(token, accept)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn store() -> HostKeyStore {
    HostKeyStore::from_connection(Connection::open_in_memory().unwrap()).unwrap()
  }

  fn challenge(store: &HostKeyStore, host: &str, port: i64, key: &[u8]) -> serde_json::Value {
    let error = store.verify_key(host, port, key, "Ed25519", "SHA256:test").unwrap_err();
    serde_json::from_str(error.strip_prefix(ERROR_PREFIX).unwrap()).unwrap()
  }

  #[test]
  fn trust_requires_confirmation_and_matches_exact_key_and_port() {
    let store = store();
    let notice = challenge(&store, "Server.Example", 22, b"key-a");
    assert_eq!(notice["code"], "unknown");
    let token = notice["token"].as_str().unwrap();
    assert_eq!(challenge(&store, "server.example", 22, b"key-a")["token"], token);
    store.resolve(token, true).unwrap();
    assert!(store.verify_key("server.example", 22, b"key-a", "Ed25519", "SHA256:test").is_ok());
    let changed = challenge(&store, "server.example", 22, b"key-b");
    assert_eq!(changed["code"], "changed");
    assert!(changed["token"].is_null());
    assert_eq!(challenge(&store, "server.example", 2222, b"key-a")["code"], "unknown");
    assert!(store.resolve(token, true).is_err());
  }

  #[test]
  fn cancellation_expiry_and_competing_keys_cannot_replace_trust() {
    let store = store();
    let a = challenge(&store, "host", 22, b"a");
    let b = challenge(&store, "host", 22, b"b");
    store.resolve(a["token"].as_str().unwrap(), false).unwrap();
    assert!(store.resolve(a["token"].as_str().unwrap(), true).is_err());
    let a = challenge(&store, "host", 22, b"a");
    store.resolve(b["token"].as_str().unwrap(), true).unwrap();
    assert!(store.resolve(a["token"].as_str().unwrap(), true).is_err());
    assert!(store.verify_key("host", 22, b"b", "Ed25519", "SHA256:test").is_ok());
    let c = challenge(&store, "other", 22, b"c");
    let token = c["token"].as_str().unwrap();
    store.0.lock().unwrap().pending.get_mut(token).unwrap().created_at = Instant::now() - PENDING_LIFETIME;
    assert!(store.resolve(token, true).is_err());
  }

  #[test]
  fn trust_survives_reopening_and_invalid_ports_are_rejected() {
    let path = std::env::temp_dir().join(format!("opentermx-host-keys-test-{}-{}.sqlite3", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    {
      let store = HostKeyStore::open(&path).unwrap();
      let notice = challenge(&store, "[::1]", 22, b"ipv6-key");
      store.resolve(notice["token"].as_str().unwrap(), true).unwrap();
    }
    let store = HostKeyStore::open(&path).unwrap();
    assert!(store.verify_key("::1", 22, b"ipv6-key", "Ed25519", "SHA256:test").is_ok());
    for port in [-1, 0, 65536] {
      assert!(store.verify_key("host", port, b"key", "Ed25519", "SHA256:test").is_err());
    }
    // Keep the temporary fixture: test execution never deletes user files.
  }
}
