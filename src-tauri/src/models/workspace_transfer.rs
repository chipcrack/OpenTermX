use serde::{Deserialize, Serialize};

use super::{CredentialUpsertInput, SessionUpsertInput};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTransferData {
  pub version: u32,
  pub exported_at: String,
  pub credentials: Vec<CredentialUpsertInput>,
  pub sessions: Vec<SessionUpsertInput>,
}
