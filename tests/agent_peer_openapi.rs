#[test]
fn peer_chat_contract_is_available_to_generated_clients() {
    let document = tardy::openapi::document();
    for (path, method) in [
        ("/v1/agents/{id}/peer-questions", "post"),
        ("/v1/agents/{id}/peer-permissions/{sender}", "put"),
        ("/v1/agents/{id}/peer-permissions/{sender}", "delete"),
    ] {
        let operation = &document["paths"][path][method];
        assert!(operation.is_object(), "missing {method} {path}");
        assert!(operation["security"].is_array());
        assert!(operation["operationId"].is_string());
    }
    let request = &document["components"]["schemas"]["AskAgentPeer"];
    assert_eq!(request["properties"]["client_request_id"]["format"], "uuid");
    assert_eq!(request["properties"]["body"]["type"], "string");
    assert!(
        request["required"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("client_request_id"))
    );
}
