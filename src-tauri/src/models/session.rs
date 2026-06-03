use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
  pub id: String,
  pub name: String,
  pub host: String,
  pub port: i64,
  pub username: String,
  pub environment: String,
  pub group_name: String,
  pub color: String,
  pub description: String,
  pub last_connection: String,
  pub favorite: bool,
  pub auth_kind: String,
  pub credential_id: Option<String>,
  pub credential_label: Option<String>,
  pub has_password: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUpsertInput {
  pub id: Option<String>,
  pub name: String,
  pub host: String,
  pub port: i64,
  pub username: String,
  pub environment: String,
  pub group_name: String,
  pub color: String,
  pub description: String,
  pub favorite: bool,
  pub auth_kind: String,
  pub credential_id: Option<String>,
  pub password: Option<String>,
}
