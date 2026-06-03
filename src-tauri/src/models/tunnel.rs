use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelRecord {
  pub id: String,
  pub session_id: String,
  pub name: String,
  pub local_port: i64,
  pub remote_host: String,
  pub remote_port: i64,
  pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelUpsertInput {
  pub id: Option<String>,
  pub session_id: String,
  pub name: String,
  pub local_port: i64,
  pub remote_host: String,
  pub remote_port: i64,
  pub status: String,
}
