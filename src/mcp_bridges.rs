use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::social::SocialError;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct McpBridgeConnection {
    pub id: Uuid,
    pub provider: String,
    pub display_name: String,
    pub bridge_ref: String,
    pub status: String,
    pub capabilities: Vec<String>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct McpBridgeGrant {
    pub connection_id: Uuid,
    pub agent_profile_id: Uuid,
    pub tool_patterns: Vec<String>,
    pub approval_policy: String,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct PgMcpBridgeStore {
    pool: PgPool,
}

impl PgMcpBridgeStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list_connections(
        &self,
        owner: Uuid,
    ) -> Result<Vec<McpBridgeConnection>, SocialError> {
        let rows = sqlx::query("SELECT id,provider,display_name,bridge_ref,status,capabilities,created_at,updated_at FROM mcp_bridge_connections WHERE owner_account_id=$1 AND status<>'revoked' ORDER BY created_at,id")
            .bind(owner).fetch_all(&self.pool).await?;
        rows.into_iter().map(connection_from_row).collect()
    }

    pub async fn register_connection(
        &self,
        owner: Uuid,
        provider: &str,
        display_name: &str,
        bridge_ref: &str,
        capabilities: &[String],
    ) -> Result<McpBridgeConnection, SocialError> {
        let display_name = display_name.trim();
        let bridge_ref = bridge_ref.trim();
        if !matches!(provider, "fpl" | "tardy_managed" | "composio" | "external")
            || display_name.is_empty()
            || display_name.chars().count() > 120
            || !valid_bridge_ref(bridge_ref)
            || !valid_capabilities(capabilities)
        {
            return Err(SocialError::Invalid("invalid MCP bridge connection"));
        }
        let row = sqlx::query("INSERT INTO mcp_bridge_connections (id,owner_account_id,provider,display_name,bridge_ref,capabilities) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (owner_account_id,bridge_ref) DO UPDATE SET provider=excluded.provider,display_name=excluded.display_name,capabilities=excluded.capabilities,status='connected',updated_at=now() RETURNING id,provider,display_name,bridge_ref,status,capabilities,created_at,updated_at")
            .bind(Uuid::new_v4()).bind(owner).bind(provider).bind(display_name).bind(bridge_ref).bind(capabilities).fetch_one(&self.pool).await?;
        connection_from_row(row)
    }

    pub async fn revoke_connection(&self, owner: Uuid, id: Uuid) -> Result<(), SocialError> {
        let mut tx = self.pool.begin().await?;
        let changed = sqlx::query("UPDATE mcp_bridge_connections SET status='revoked',updated_at=now() WHERE id=$1 AND owner_account_id=$2 AND status<>'revoked'")
            .bind(id).bind(owner).execute(&mut *tx).await?;
        if changed.rows_affected() == 1 {
            sqlx::query("DELETE FROM mcp_bridge_agent_grants WHERE connection_id=$1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            Ok(())
        } else {
            Err(SocialError::NotFound)
        }
    }

    pub async fn list_grants(
        &self,
        owner: Uuid,
        connection_id: Uuid,
    ) -> Result<Vec<McpBridgeGrant>, SocialError> {
        self.require_connection_owner(owner, connection_id).await?;
        let rows = sqlx::query("SELECT connection_id,agent_profile_id,tool_patterns,approval_policy,updated_at FROM mcp_bridge_agent_grants WHERE connection_id=$1 ORDER BY agent_profile_id")
            .bind(connection_id).fetch_all(&self.pool).await?;
        rows.into_iter().map(grant_from_row).collect()
    }

    pub async fn grant_agent(
        &self,
        owner: Uuid,
        connection_id: Uuid,
        agent: Uuid,
        tool_patterns: &[String],
        approval_policy: &str,
    ) -> Result<McpBridgeGrant, SocialError> {
        if !matches!(approval_policy, "read_auto" | "ask" | "always_ask")
            || tool_patterns.is_empty()
            || tool_patterns.len() > 128
            || tool_patterns
                .iter()
                .any(|value| value.is_empty() || value.len() > 160 || !valid_tool_pattern(value))
        {
            return Err(SocialError::Invalid("invalid MCP bridge grant"));
        }
        let row = sqlx::query("INSERT INTO mcp_bridge_agent_grants (connection_id,agent_profile_id,tool_patterns,approval_policy) SELECT c.id,s.profile_id,$4,$5 FROM mcp_bridge_connections c JOIN profile_ownership o ON o.owner_account_id=c.owner_account_id JOIN social_identities s ON s.profile_id=o.profile_id AND s.kind='agent' WHERE c.id=$1 AND c.owner_account_id=$2 AND c.status='connected' AND s.profile_id=$3 ON CONFLICT (connection_id,agent_profile_id) DO UPDATE SET tool_patterns=excluded.tool_patterns,approval_policy=excluded.approval_policy,updated_at=now() RETURNING connection_id,agent_profile_id,tool_patterns,approval_policy,updated_at")
            .bind(connection_id).bind(owner).bind(agent).bind(tool_patterns).bind(approval_policy).fetch_optional(&self.pool).await?.ok_or(SocialError::Forbidden)?;
        grant_from_row(row)
    }

    pub async fn revoke_agent(
        &self,
        owner: Uuid,
        connection_id: Uuid,
        agent: Uuid,
    ) -> Result<(), SocialError> {
        self.require_connection_owner(owner, connection_id).await?;
        let changed = sqlx::query(
            "DELETE FROM mcp_bridge_agent_grants WHERE connection_id=$1 AND agent_profile_id=$2",
        )
        .bind(connection_id)
        .bind(agent)
        .execute(&self.pool)
        .await?;
        if changed.rows_affected() == 1 {
            Ok(())
        } else {
            Err(SocialError::NotFound)
        }
    }

    async fn require_connection_owner(&self, owner: Uuid, id: Uuid) -> Result<(), SocialError> {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM mcp_bridge_connections WHERE id=$1 AND owner_account_id=$2 AND status<>'revoked')")
            .bind(id).bind(owner).fetch_one(&self.pool).await?;
        if exists {
            Ok(())
        } else {
            Err(SocialError::NotFound)
        }
    }
}

fn valid_bridge_ref(value: &str) -> bool {
    value.strip_prefix("binding://mcp/").is_some_and(|tail| {
        !tail.is_empty()
            && tail.len() <= 480
            && tail.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'~' | b'/' | b'-')
            })
    })
}

fn valid_capabilities(values: &[String]) -> bool {
    values.len() <= 256
        && values
            .iter()
            .all(|value| !value.is_empty() && value.len() <= 160 && valid_tool_pattern(value))
}

fn valid_tool_pattern(value: &str) -> bool {
    value.bytes().all(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'/' | b'-' | b'*')
    })
}

fn connection_from_row(row: sqlx::postgres::PgRow) -> Result<McpBridgeConnection, SocialError> {
    Ok(McpBridgeConnection {
        id: row.try_get("id")?,
        provider: row.try_get("provider")?,
        display_name: row.try_get("display_name")?,
        bridge_ref: row.try_get("bridge_ref")?,
        status: row.try_get("status")?,
        capabilities: row.try_get("capabilities")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn grant_from_row(row: sqlx::postgres::PgRow) -> Result<McpBridgeGrant, SocialError> {
    Ok(McpBridgeGrant {
        connection_id: row.try_get("connection_id")?,
        agent_profile_id: row.try_get("agent_profile_id")?,
        tool_patterns: row.try_get("tool_patterns")?,
        approval_policy: row.try_get("approval_policy")?,
        updated_at: row.try_get("updated_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_opaque_bridge_refs() {
        assert!(valid_bridge_ref("binding://mcp/tardy/user-1/composio"));
        assert!(!valid_bridge_ref(
            "https://connect.composio.dev/mcp?key=secret"
        ));
        assert!(!valid_bridge_ref("binding://storage/tardy/media"));
        assert!(!valid_bridge_ref("binding://mcp/../secret?token=x"));
    }
}
