use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialRecord {
  pub id: String,
  pub label: String,
  pub username: String,
  pub password: String,
  pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialUpsertInput {
  pub id: Option<String>,
  pub label: String,
  pub username: String,
  pub password: String,
  pub note: String,
}
