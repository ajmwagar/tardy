use crate::api::{ApiError, AppState, authenticated_account, selected_profile, social_store};
use crate::social::PostVisibility;
use axum::{Json, extract::State, http::HeaderMap, response::IntoResponse};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct McpRequest {
    #[serde(default)]
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Deserialize)]
struct PostUpdateArguments {
    client_request_id: Uuid,
    caption: String,
    #[serde(default)]
    shared_link_id: Option<Uuid>,
    #[serde(default = "private_visibility")]
    visibility: PostVisibility,
}

fn private_visibility() -> PostVisibility {
    PostVisibility::Private
}

pub async fn endpoint(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<McpRequest>,
) -> impl IntoResponse {
    let id = request.id.clone();
    let result = dispatch(&state, &headers, request).await;
    Json(match result {
        Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
        Err(error) => json!({
            "jsonrpc":"2.0",
            "id":id,
            "error":{"code":error.0,"message":error.1}
        }),
    })
}

async fn dispatch(
    state: &AppState,
    headers: &HeaderMap,
    request: McpRequest,
) -> Result<Value, (i64, String)> {
    match request.method.as_str() {
        "initialize" => Ok(json!({
            "protocolVersion":"2025-06-18",
            "capabilities":{"tools":{}},
            "serverInfo":{"name":"tardy","version":env!("CARGO_PKG_VERSION")}
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools":[
            {
                "name":"tardy_status",
                "description":"Verify the configured Tardy API key and acting profile before doing work.",
                "inputSchema":{"type":"object","properties":{},"additionalProperties":false},
                "annotations":{"readOnlyHint":true,"idempotentHint":true}
            },
            {
                "name":"tardy_post_update",
                "description":"Post one verified milestone update (text only, at most 200 characters) as this Tardy. Reuse client_request_id when retrying. Defaults to private; choose followers or public only with explicit human intent.",
                "inputSchema":{
                    "type":"object",
                    "properties":{
                        "client_request_id":{"type":"string","format":"uuid","description":"Stable UUID persisted before the first attempt and reused on retries."},
                        "caption":{"type":"string","minLength":1,"maxLength":crate::social::TEXT_POST_MAX_CHARS,"description":"Text only, at most 200 characters."},
                        "shared_link_id":{"type":["string","null"],"format":"uuid"},
                        "visibility":{"type":"string","enum":["private","followers","public"],"default":"private"}
                    },
                    "required":["client_request_id","caption"],
                    "additionalProperties":false
                },
                "annotations":{"destructiveHint":false,"idempotentHint":true,"openWorldHint":true}
            }
        ]})),
        "tools/call" => call_tool(state, headers, request.params).await,
        _ => Err((-32601, format!("method not found: {}", request.method))),
    }
}

async fn call_tool(
    state: &AppState,
    headers: &HeaderMap,
    params: Value,
) -> Result<Value, (i64, String)> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| (-32602, "tool name is required".into()))?;
    let actor = mcp_actor(state, headers).await.map_err(tool_auth_error)?;
    match name {
        "tardy_status" => Ok(tool_result(
            json!({"profile_id":actor,"authenticated":true}),
        )),
        "tardy_post_update" => {
            let arguments: PostUpdateArguments = serde_json::from_value(
                params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            )
            .map_err(|error| {
                (
                    -32602,
                    format!("invalid tardy_post_update arguments: {error}"),
                )
            })?;
            let post = social_store(state)
                .map_err(tool_auth_error)?
                .publish_post(
                    actor,
                    arguments.client_request_id,
                    &arguments.caption,
                    arguments.shared_link_id,
                    arguments.visibility,
                )
                .await
                .map_err(|error| (-32000, error.to_string()))?;
            tool_result_serializable(&post)
        }
        _ => Err((-32602, format!("unknown tool: {name}"))),
    }
}

fn tool_result(value: Value) -> Value {
    json!({
        "content":[{"type":"text","text":value.to_string()}],
        "structuredContent":value
    })
}

fn tool_result_serializable(value: &impl serde::Serialize) -> Result<Value, (i64, String)> {
    serde_json::to_value(value)
        .map(tool_result)
        .map_err(|error| (-32603, format!("could not encode tool result: {error}")))
}

fn tool_auth_error(error: ApiError) -> (i64, String) {
    (-32001, error.to_string())
}

async fn mcp_actor(state: &AppState, headers: &HeaderMap) -> Result<Uuid, ApiError> {
    let account = authenticated_account(state, headers).await?;
    if let Some(profile) = selected_profile(headers)? {
        let allowed = state
            .pg_accounts
            .as_ref()
            .ok_or_else(|| ApiError::internal("PostgreSQL accounts are not configured"))?
            .can_act(account, profile)
            .await?;
        return allowed
            .then_some(profile)
            .ok_or_else(|| ApiError::forbidden("account cannot act as selected profile"));
    }
    let profiles = state
        .pg_accounts
        .as_ref()
        .ok_or_else(|| ApiError::internal("PostgreSQL accounts are not configured"))?
        .actor_profiles(account)
        .await?;
    match profiles.as_slice() {
        [profile] => Ok(*profile),
        [] => Err(ApiError::unauthorized("API key has no acting profile")),
        _ => Err(ApiError::unauthorized(
            "x-tardy-profile-id is required when an API key can act as multiple profiles",
        )),
    }
}
