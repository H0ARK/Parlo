use futures_util::StreamExt;
use hyper::body::Bytes;
use hyper::service::{make_service_fn, service_fn};
use hyper::{Body, Request, Response, Server, StatusCode};
use parlo_utils::{extract_host_from_origin, is_cors_header, is_valid_host, remove_prefix};
use reqwest::Client;
use serde_json;
use std::collections::HashMap;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri_plugin_llamacpp::state::LlamacppState;
use tokio::sync::Mutex;

use crate::core::{
    mcp::models::McpSettings,
    state::{ProviderConfig, ProviderCustomHeader, ServerHandle, SharedMcpServers},
};

const SCHEMA_PRIMITIVE_TYPES: &[&str] = &[
    "string", "number", "integer", "boolean", "null", "array", "object",
];

// llama.cpp's json-schema-to-grammar emits PCRE `\d` for these formats,
// which GBNF rejects; the failed grammar silently disables tool-call JSON.
const LLAMACPP_BROKEN_STRING_FORMATS: &[&str] = &["date", "time", "date-time"];

fn pattern_has_pcre_shorthand(pattern: &str) -> bool {
    let bytes = pattern.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'\\' && matches!(bytes[i + 1], b'd' | b'D' | b'w' | b'W' | b's' | b'S') {
            return true;
        }
        i += 1;
    }
    false
}

/// If `value` is a bare string naming a JSON-schema primitive type (e.g.
/// `"string"`), expand it to `{ "type": <that> }`. Some tool generators emit
/// shorthand like `{ "properties": { "foo": "string" } }`; llama.cpp's
/// json-schema-to-grammar rejects that with `Unrecognized schema: "string"`.
fn coerce_schema_node(value: &mut serde_json::Value) {
    if let serde_json::Value::String(s) = value {
        if SCHEMA_PRIMITIVE_TYPES.contains(&s.as_str()) {
            let mut obj = serde_json::Map::new();
            obj.insert(
                "type".to_string(),
                serde_json::Value::String(std::mem::take(s)),
            );
            *value = serde_json::Value::Object(obj);
        }
    }
    normalize_openai_tool_parameters_schema(value);
}

/// Some OpenAI tool schema generators (and some MCP servers) may emit schemas where
/// a property schema only contains `description` but omits `type`, or where a
/// schema-node slot holds a bare type-name string instead of a sub-schema object.
///
/// A strict JSON schema converter inside the upstream server rejects those schemas.
/// To be robust, we default `type` to `"string"` for description-only leaf schemas
/// and expand bare-string sub-schemas to `{ "type": <name> }`.
/// Keep this behavior aligned with `normalizeToolInputSchema` in the frontend.
pub(crate) fn normalize_openai_tool_parameters_schema(schema: &mut serde_json::Value) {
    match schema {
        serde_json::Value::Object(map) => {
            let has_description = map.contains_key("description");
            let has_type = map.contains_key("type");
            let is_object_type = map.get("type").and_then(|v| v.as_str()) == Some("object");
            let has_nested_schema_keywords = map.contains_key("properties")
                || map.contains_key("items")
                || map.contains_key("anyOf")
                || map.contains_key("oneOf")
                || map.contains_key("allOf")
                || map.contains_key("$ref");

            if is_object_type && !map.contains_key("properties") {
                map.insert(
                    "properties".to_string(),
                    serde_json::Value::Object(serde_json::Map::new()),
                );
            }

            // Only patch leaf nodes (description without `type` AND without nested schema keywords).
            if has_description && !has_type && !has_nested_schema_keywords {
                map.insert(
                    "type".to_string(),
                    serde_json::Value::String("string".to_string()),
                );
            }

            let drop_format = map
                .get("format")
                .and_then(|v| v.as_str())
                .map(|f| LLAMACPP_BROKEN_STRING_FORMATS.contains(&f))
                .unwrap_or(false);
            if drop_format {
                map.remove("format");
            }

            let drop_pattern = map
                .get("pattern")
                .and_then(|v| v.as_str())
                .map(pattern_has_pcre_shorthand)
                .unwrap_or(false);
            if drop_pattern {
                map.remove("pattern");
            }

            // Recurse, with shorthand expansion for keys whose direct children
            // are schema nodes.
            for (key, v) in map.iter_mut() {
                match key.as_str() {
                    "properties" | "patternProperties" | "definitions" | "$defs" => {
                        if let serde_json::Value::Object(inner) = v {
                            for (_, child) in inner.iter_mut() {
                                coerce_schema_node(child);
                            }
                        } else {
                            normalize_openai_tool_parameters_schema(v);
                        }
                    }
                    "anyOf" | "oneOf" | "allOf" | "prefixItems" => {
                        if let serde_json::Value::Array(arr) = v {
                            for child in arr.iter_mut() {
                                coerce_schema_node(child);
                            }
                        } else {
                            normalize_openai_tool_parameters_schema(v);
                        }
                    }
                    "items" => match v {
                        serde_json::Value::Array(arr) => {
                            for child in arr.iter_mut() {
                                coerce_schema_node(child);
                            }
                        }
                        _ => coerce_schema_node(v),
                    },
                    _ => normalize_openai_tool_parameters_schema(v),
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr.iter_mut() {
                normalize_openai_tool_parameters_schema(v);
            }
        }
        _ => {}
    }
}

pub(crate) fn normalize_openai_tools_in_chat_body(body: &mut serde_json::Value) {
    let tools = match body.get_mut("tools") {
        Some(t) => t,
        None => return,
    };

    let tools_arr = match tools.as_array_mut() {
        Some(a) => a,
        None => return,
    };

    for tool in tools_arr.iter_mut() {
        let function = match tool.get_mut("function") {
            Some(f) => f,
            None => continue,
        };
        let parameters = match function.get_mut("parameters") {
            Some(p) => p,
            None => continue,
        };

        normalize_openai_tool_parameters_schema(parameters);
    }
}

pub(crate) fn sanitize_xai_responses_body(body: &mut serde_json::Value) {
    let Some(tools) = body.get_mut("tools") else {
        return;
    };
    let Some(tools_arr) = tools.as_array_mut() else {
        return;
    };

    tools_arr.retain_mut(|tool| {
        let tool_type = tool.get("type").and_then(|v| v.as_str());
        if tool_type != Some("function") {
            return false;
        }

        if let Some(parameters) = tool.get_mut("parameters") {
            normalize_openai_tool_parameters_schema(parameters);
        }
        if let Some(parameters) = tool
            .get_mut("function")
            .and_then(|function| function.get_mut("parameters"))
        {
            normalize_openai_tool_parameters_schema(parameters);
        }

        true
    });

    if tools_arr.is_empty() {
        if let Some(map) = body.as_object_mut() {
            map.remove("tools");
        }
    }
}

pub(crate) fn http_status_indicates_api_key_retry(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS
    )
}

/// Transform Anthropic /messages API body to OpenAI /chat/completions body
pub(crate) fn transform_anthropic_to_openai(body: &serde_json::Value) -> Option<serde_json::Value> {
    let model = body.get("model")?.as_str()?;
    let messages = body.get("messages")?;

    let openai_messages = convert_messages(messages, body.get("system"))?;

    let stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut result = serde_json::json!({
        "model": model,
        "messages": openai_messages,
        "stream": stream
    });

    // Transform Anthropic tools to OpenAI format
    if let Some(tools) = body.get("tools").and_then(|t| t.as_array()) {
        let openai_tools: Vec<serde_json::Value> = tools
            .iter()
            .filter_map(|tool| {
                let name = tool.get("name")?.as_str()?;
                let description = tool
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("");
                let input_schema = tool
                    .get("input_schema")
                    .cloned()
                    .unwrap_or(serde_json::json!({}));

                Some(serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": description,
                        "parameters": input_schema
                    }
                }))
            })
            .collect();

        if !openai_tools.is_empty() {
            result["tools"] = serde_json::Value::Array(openai_tools);
        }
    }

    // Pass through common parameters
    for key in &[
        // "max_tokens",
        "temperature",
        "top_p",
        "top_k",
        "frequency_penalty",
        "presence_penalty",
    ] {
        if let Some(val) = body.get(*key) {
            result[*key] = val.clone();
        }
    }
    if let Some(stop) = body.get("stop_sequences") {
        result["stop"] = stop.clone();
    }

    Some(result)
}

/// Convert Anthropic message format to OpenAI format
pub(crate) fn convert_messages(
    anth_messages: &serde_json::Value,
    system_prompt: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let messages_array = anth_messages.as_array()?;
    let mut openai_messages: Vec<serde_json::Value> = Vec::new();

    // Anthropic system prompt is a top-level field, convert to system message
    if let Some(system) = system_prompt {
        if let Some(text) = system.as_str() {
            openai_messages.push(serde_json::json!({
                "role": "system",
                "content": text
            }));
        } else if let Some(blocks) = system.as_array() {
            let text: String = blocks
                .iter()
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("\n");
            if !text.is_empty() {
                openai_messages.push(serde_json::json!({
                    "role": "system",
                    "content": text
                }));
            }
        }
    }

    for msg in messages_array {
        let role = msg.get("role")?.as_str()?;
        let content = msg.get("content")?;

        if content.is_string() {
            let openai_role = match role {
                "user" => "user",
                "assistant" => "assistant",
                "system" => "system",
                "developer" => "developer",
                _ => continue,
            };
            openai_messages.push(serde_json::json!({
                "role": openai_role,
                "content": content
            }));
            continue;
        }

        let content_array = content.as_array()?;

        match role {
            "assistant" => {
                // Split content into text/image parts and tool_calls
                let mut text_parts: Vec<serde_json::Value> = Vec::new();
                let mut tool_calls: Vec<serde_json::Value> = Vec::new();

                for block in content_array {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    match block_type {
                        "text" => {
                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                text_parts.push(serde_json::json!({
                                    "type": "text",
                                    "text": text
                                }));
                            }
                        }
                        "tool_use" => {
                            if let (Some(id), Some(name), Some(input)) = (
                                block.get("id").and_then(|v| v.as_str()),
                                block.get("name").and_then(|v| v.as_str()),
                                block.get("input"),
                            ) {
                                tool_calls.push(serde_json::json!({
                                    "id": id,
                                    "type": "function",
                                    "function": {
                                        "name": name,
                                        "arguments": input.to_string()
                                    }
                                }));
                            }
                        }
                        _ => {
                            convert_media_block(block, &mut text_parts);
                        }
                    }
                }

                let mut msg_obj = serde_json::json!({ "role": "assistant" });

                if tool_calls.is_empty() {
                    // No tool calls: set content normally
                    msg_obj["content"] = text_parts_to_content(&text_parts);
                } else {
                    // Has tool calls: content can be null or text string
                    msg_obj["content"] = if text_parts.is_empty() {
                        serde_json::Value::Null
                    } else {
                        text_parts_to_content(&text_parts)
                    };
                    msg_obj["tool_calls"] = serde_json::Value::Array(tool_calls);
                }

                openai_messages.push(msg_obj);
            }
            "user" => {
                // Separate tool_result blocks from regular content
                let mut text_parts: Vec<serde_json::Value> = Vec::new();
                let mut tool_results: Vec<(String, String)> = Vec::new();

                for block in content_array {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    match block_type {
                        "tool_result" => {
                            let tool_use_id = block
                                .get("tool_use_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let result_content = extract_tool_result_content(block.get("content"));
                            tool_results.push((tool_use_id, result_content));
                        }
                        "text" => {
                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                text_parts.push(serde_json::json!({
                                    "type": "text",
                                    "text": text
                                }));
                            }
                        }
                        _ => {
                            convert_media_block(block, &mut text_parts);
                        }
                    }
                }

                // Tool results become role:"tool" messages (must come before user text)
                for (tool_call_id, result) in tool_results {
                    openai_messages.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": result
                    }));
                }

                // Remaining user content
                if !text_parts.is_empty() {
                    openai_messages.push(serde_json::json!({
                        "role": "user",
                        "content": text_parts_to_content(&text_parts)
                    }));
                }
            }
            "system" | "developer" => {
                let text: String = content_array
                    .iter()
                    .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("\n");
                openai_messages.push(serde_json::json!({
                    "role": role,
                    "content": text
                }));
            }
            _ => continue,
        }
    }

    Some(serde_json::Value::Array(openai_messages))
}

/// Convert text parts to OpenAI content value (string for single text, array for mixed)
pub(crate) fn text_parts_to_content(parts: &[serde_json::Value]) -> serde_json::Value {
    if parts.is_empty() {
        serde_json::Value::String(String::new())
    } else if parts.len() == 1 && parts[0].get("type").and_then(|t| t.as_str()) == Some("text") {
        serde_json::Value::String(
            parts[0]
                .get("text")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string(),
        )
    } else {
        serde_json::Value::Array(parts.to_vec())
    }
}

/// Convert image/media blocks to OpenAI format
pub(crate) fn convert_media_block(block: &serde_json::Value, parts: &mut Vec<serde_json::Value>) {
    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if block_type == "image" {
        if let Some(source) = block.get("source") {
            if let (Some(data), Some(media_type)) = (
                source.get("data").and_then(|v| v.as_str()),
                source
                    .get("media_type")
                    .or(block.get("media_type"))
                    .and_then(|v| v.as_str()),
            ) {
                parts.push(serde_json::json!({
                    "type": "image_url",
                    "image_url": {
                        "url": format!("data:{media_type};base64,{data}")
                    }
                }));
            }
        }
    } else if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
        parts.push(serde_json::json!({
            "type": "text",
            "text": text
        }));
    }
}

/// Extract text content from a tool_result content field
pub(crate) fn extract_tool_result_content(content: Option<&serde_json::Value>) -> String {
    match content {
        Some(c) if c.is_string() => c.as_str().unwrap_or("").to_string(),
        Some(c) if c.is_array() => c
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|b| {
                if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                    b.get("text").and_then(|t| t.as_str())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Some(c) => c.to_string(),
        None => String::new(),
    }
}

/// Transform OpenAI non-streaming response to Anthropic /messages format
pub(crate) fn transform_openai_response_to_anthropic(
    response: &serde_json::Value,
) -> serde_json::Value {
    let choice = response
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first());
    let message = choice.and_then(|c| c.get("message"));

    let mut content_blocks: Vec<serde_json::Value> = Vec::new();

    // Add text content
    if let Some(text) =
        message
            .and_then(|m| m.get("content"))
            .and_then(|c| if c.is_null() { None } else { c.as_str() })
    {
        if !text.is_empty() {
            content_blocks.push(serde_json::json!({
                "type": "text",
                "text": text
            }));
        }
    }

    // Add tool_use blocks from tool_calls
    if let Some(tool_calls) = message
        .and_then(|m| m.get("tool_calls"))
        .and_then(|tc| tc.as_array())
    {
        for tc in tool_calls {
            let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let name = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let arguments = tc
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|a| a.as_str())
                .unwrap_or("{}");
            let input: serde_json::Value =
                serde_json::from_str(arguments).unwrap_or(serde_json::json!({}));

            content_blocks.push(serde_json::json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": input
            }));
        }
    }

    let finish_reason = choice
        .and_then(|c| c.get("finish_reason"))
        .and_then(|fr| fr.as_str())
        .unwrap_or("end_turn");

    let stop_reason = match finish_reason {
        "stop" => "end_turn",
        "length" => "max_tokens",
        "tool_calls" => "tool_use",
        _ => finish_reason,
    };

    serde_json::json!({
        "id": response.get("id").unwrap_or(&serde_json::json!("")).clone(),
        "type": "message",
        "role": "assistant",
        "content": content_blocks,
        "model": response.get("model").unwrap_or(&serde_json::json!("")).clone(),
        "stop_reason": stop_reason,
        "stop_sequence": serde_json::Value::Null,
        "usage": response.get("usage").cloned().unwrap_or(serde_json::json!({
            "input_tokens": 0,
            "output_tokens": 0
        }))
    })
}

/// Configuration for the proxy server
#[derive(Clone)]
pub struct ProxyConfig {
    pub prefix: String,
    pub proxy_api_key: String,
    pub trusted_hosts: Vec<Vec<String>>,
    pub host: String,
    pub port: u16,
}

/// Determines the final destination path based on the original request path
pub fn get_destination_path(original_path: &str, prefix: &str) -> String {
    remove_prefix(original_path, prefix)
}

pub(crate) fn format_gateway_model_id(provider: &str, model_id: &str) -> String {
    let prefix = format!("{provider}/");
    if model_id.starts_with(&prefix) {
        model_id.to_string()
    } else {
        format!("{provider}/{model_id}")
    }
}

pub(crate) fn gateway_provider_prefix(model_id: &str) -> Option<&str> {
    let sep_pos = model_id.find('/')?;
    let provider = &model_id[..sep_pos];
    let bare = &model_id[sep_pos + 1..];
    if provider.is_empty() || bare.is_empty() {
        None
    } else {
        Some(provider)
    }
}

pub(crate) fn gateway_bare_model_id(model_id: &str) -> &str {
    gateway_provider_prefix(model_id)
        .map(|_| &model_id[model_id.find('/').unwrap() + 1..])
        .unwrap_or(model_id)
}

fn gateway_model_registered(configured: &str, requested: &str) -> bool {
    configured == requested
        || (gateway_bare_model_id(configured) == gateway_bare_model_id(requested)
            && gateway_provider_prefix(configured) == gateway_provider_prefix(requested))
}

fn is_grok_model_id(model_id: &str) -> bool {
    let bare = gateway_bare_model_id(model_id);
    bare.starts_with("grok-") || bare.eq_ignore_ascii_case("grok")
}

fn provider_for_gateway_model(
    model_id: &str,
    pc: &HashMap<String, ProviderConfig>,
) -> Option<String> {
    if is_grok_model_id(model_id) && pc.contains_key("xai") {
        return Some("xai".to_string());
    }
    if let Some((_, config)) = pc
        .iter()
        .find(|(_, config)| config.models.iter().any(|m| gateway_model_registered(m, model_id)))
    {
        return Some(config.provider.clone());
    }

    if let Some(prefix) = gateway_provider_prefix(model_id) {
        if pc.contains_key(prefix) {
            return Some(prefix.to_string());
        }
    }

    let bare = gateway_bare_model_id(model_id);
    let matching: Vec<_> = pc
        .iter()
        .filter(|(_, config)| {
            config
                .models
                .iter()
                .any(|m| gateway_bare_model_id(m) == bare)
        })
        .collect();
    if matching.len() == 1 {
        return Some(matching[0].1.provider.clone());
    }

    pc.get(model_id).map(|c| c.provider.clone())
}

fn maybe_rewrite_gateway_model_body(body: &Bytes, model_id: &str) -> Option<Bytes> {
    let bare = gateway_bare_model_id(model_id);
    if bare == model_id {
        None
    } else {
        rewrite_model_in_body(body, bare)
    }
}

fn find_mlx_session(
    mlx_sessions: &HashMap<i32, MlxBackendSession>,
    model_id: &str,
) -> Option<SessionInfo> {
    if let Some(prefix) = gateway_provider_prefix(model_id) {
        if prefix != "mlx" {
            return None;
        }
    }
    let bare = gateway_bare_model_id(model_id);
    mlx_sessions
        .values()
        .find(|s| s.info.model_id == bare)
        .map(|s| s.info.clone())
}

fn should_route_llamacpp(model_id: &str) -> bool {
    match gateway_provider_prefix(model_id) {
        Some(prefix) => prefix == "llamacpp",
        None => true,
    }
}

fn join_upstream_url(base_url: &str, path: &str) -> String {
    format!("{}{}", base_url.trim_end_matches('/'), path)
}

fn provider_wire_api(config: &ProviderConfig) -> &str {
    config.wire_api.as_deref().unwrap_or("chat")
}

pub(crate) fn upstream_path_for_wire_api(incoming: &str, wire_api: &str) -> String {
    match (incoming, wire_api) {
        ("/chat/completions" | "/completions", "responses") => "/responses".to_string(),
        ("/responses", "chat") => "/chat/completions".to_string(),
        (path, _) => path.to_string(),
    }
}

pub(crate) fn transform_openai_chat_to_responses(
    body: &mut serde_json::Value,
    provider: &str,
) {
    let Some(map) = body.as_object_mut() else {
        return;
    };
    if map.contains_key("messages") && !map.contains_key("input") {
        if let Some(messages) = map.remove("messages") {
            map.insert("input".to_string(), messages);
        }
    }
    if let Some(max_tokens) = map.remove("max_tokens") {
        map.insert("max_output_tokens".to_string(), max_tokens);
    }
    if provider == "xai" {
        map.insert("store".to_string(), serde_json::json!(false));
        map.remove("previous_response_id");
        for key in [
            "reasoning_effort",
            "reasoningEffort",
            "reasoning",
        ] {
            map.remove(key);
        }
        sanitize_xai_responses_body(body);
    }
}

pub(crate) fn transform_responses_json_to_chat(body: &serde_json::Value) -> serde_json::Value {
    if body.get("choices").is_some() {
        return body.clone();
    }

    let model = body.get("model").cloned().unwrap_or(serde_json::json!(""));
    let mut text = String::new();
    if let Some(output) = body.get("output").and_then(|v| v.as_array()) {
        for item in output {
            if item.get("type").and_then(|v| v.as_str()) != Some("message") {
                continue;
            }
            if let Some(content) = item.get("content").and_then(|v| v.as_array()) {
                for part in content {
                    if part.get("type").and_then(|v| v.as_str()) == Some("output_text") {
                        if let Some(t) = part.get("text").and_then(|v| v.as_str()) {
                            text.push_str(t);
                        }
                    }
                }
            }
        }
    }

    serde_json::json!({
        "id": body.get("id").cloned().unwrap_or(serde_json::json!("")),
        "object": "chat.completion",
        "created": body.get("created_at").and_then(|v| v.as_u64()).unwrap_or(0),
        "model": model,
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": text
            },
            "finish_reason": body.get("status").and_then(|v| v.as_str()).unwrap_or("stop")
        }],
        "usage": body.get("usage").cloned().unwrap_or(serde_json::json!({}))
    })
}

fn prepare_remote_provider_upstream(
    provider_cfg: &ProviderConfig,
    provider: &str,
    incoming_path: &str,
    body_bytes: &Bytes,
    model_id: &str,
) -> Result<(String, Vec<String>, Bytes, bool), String> {
    let wire_api = provider_wire_api(provider_cfg);
    let upstream_path = upstream_path_for_wire_api(incoming_path, wire_api);
    let api_url = provider_cfg
        .base_url
        .clone()
        .ok_or_else(|| format!("Missing base_url for provider '{provider}'"))?;
    let url = join_upstream_url(&api_url, &upstream_path);
    let keys = provider_cfg.bearer_key_chain();
    let mut outbound_body = body_bytes.clone();
    let mut rewrite_to_chat = false;

    if wire_api == "responses"
        && matches!(
            incoming_path,
            "/chat/completions" | "/completions" | "/responses"
        )
    {
        let mut json_body: serde_json::Value =
            serde_json::from_slice(&outbound_body).map_err(|e| e.to_string())?;
        transform_openai_chat_to_responses(&mut json_body, provider);
        let bare = gateway_bare_model_id(model_id);
        if let Some(obj) = json_body.as_object_mut() {
            obj.insert("model".to_string(), serde_json::json!(bare));
        }
        outbound_body = Bytes::from(serde_json::to_vec(&json_body).map_err(|e| e.to_string())?);
        rewrite_to_chat =
            incoming_path == "/chat/completions" || incoming_path == "/completions";
    } else if let Some(rewritten) = maybe_rewrite_gateway_model_body(body_bytes, model_id) {
        outbound_body = rewritten;
    }

    Ok((url, keys, outbound_body, rewrite_to_chat))
}

fn responses_sse_data_to_chat_line(data: &str) -> Option<String> {
    let payload = data.trim();
    if payload.is_empty() || payload == "[DONE]" {
        return Some("data: [DONE]\n\n".to_string());
    }
    let json: serde_json::Value = serde_json::from_str(payload).ok()?;
    let event_type = json.get("type").and_then(|v| v.as_str())?;
    match event_type {
        "response.output_text.delta" => {
            let delta = json.get("delta").and_then(|v| v.as_str()).unwrap_or("");
            let chat = serde_json::json!({
                "choices": [{"delta": {"content": delta}}]
            });
            Some(format!("data: {chat}\n\n"))
        }
        "response.completed" => Some("data: [DONE]\n\n".to_string()),
        _ => None,
    }
}

async fn forward_responses_stream_as_chat<S>(mut stream: S, mut sender: hyper::body::Sender)
where
    S: futures_util::Stream<Item = Result<Bytes, reqwest::Error>> + Unpin,
{
    let mut buffer = String::new();
    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(pos) = buffer.find("\n\n") {
                    let frame = buffer[..pos].to_string();
                    buffer.drain(..pos + 2);
                    for line in frame.lines() {
                        if let Some(rest) = line.strip_prefix("data: ") {
                            if let Some(chat_line) = responses_sse_data_to_chat_line(rest) {
                                if sender.send_data(Bytes::from(chat_line)).await.is_err() {
                                    return;
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("Responses stream error: {e}");
                break;
            }
        }
    }
}

fn rewrite_model_in_body(body: &Bytes, upstream_model: &str) -> Option<Bytes> {
    let mut json_body: serde_json::Value = serde_json::from_slice(body).ok()?;
    let obj = json_body.as_object_mut()?;
    obj.insert(
        "model".to_string(),
        serde_json::Value::String(upstream_model.to_string()),
    );
    serde_json::to_vec(&json_body).ok().map(Bytes::from)
}

use crate::core::server::{MlxBackendSession, SessionInfo};

async fn router_upstream(
    llama_state: &LlamacppState,
    destination_path: &str,
) -> Option<(String, String)> {
    let guard = llama_state.router.lock().await;
    guard.as_ref().map(|h| {
        (
            format!("http://127.0.0.1:{}/v1{}", h.port, destination_path),
            h.api_key.clone(),
        )
    })
}

async fn router_list_models(llama_state: &LlamacppState, client: &Client) -> Vec<String> {
    let (url, key) = {
        let guard = llama_state.router.lock().await;
        match guard.as_ref() {
            Some(h) => (
                format!("http://127.0.0.1:{}/v1/models", h.port),
                h.api_key.clone(),
            ),
            None => return Vec::new(),
        }
    };
    let resp = match client
        .get(&url)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            log::warn!("Failed to query router /v1/models: {e}");
            return Vec::new();
        }
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let json: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    json.get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|v| v.as_str()).map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// Handles the proxy request logic
#[allow(clippy::too_many_arguments)]
async fn proxy_request(
    req: Request<Body>,
    client: Client,
    streaming_client: Client,
    config: ProxyConfig,
    llama_state: Arc<LlamacppState>,
    mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    _mcp_servers: SharedMcpServers,
    _mcp_settings: Arc<Mutex<McpSettings>>,
    _parlo_data_folder: String,
) -> Result<Response<Body>, hyper::Error> {
    if req.method() == hyper::Method::OPTIONS {
        log::debug!(
            "Handling CORS preflight request from {:?} {:?}",
            req.headers().get(hyper::header::HOST),
            req.headers()
                .get(hyper::header::ACCESS_CONTROL_REQUEST_METHOD)
        );

        let host = req
            .headers()
            .get(hyper::header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let origin = req
            .headers()
            .get(hyper::header::ORIGIN)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let requested_method = req
            .headers()
            .get("Access-Control-Request-Method")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let allowed_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"];
        let method_allowed = requested_method.is_empty()
            || allowed_methods
                .iter()
                .any(|&method| method.eq_ignore_ascii_case(requested_method));

        if !method_allowed {
            log::warn!("CORS preflight: Method '{requested_method}' not allowed");
            return Ok(Response::builder()
                .status(StatusCode::METHOD_NOT_ALLOWED)
                .body(Body::from("Method not allowed"))
                .unwrap());
        }

        let request_path = req.uri().path();
        let whitelisted_paths = ["/", "/openapi.json", "/favicon.ico"];
        let is_whitelisted_path = whitelisted_paths.contains(&request_path);

        let is_trusted = if is_whitelisted_path {
            log::debug!(
                "CORS preflight: Bypassing host check for whitelisted path: {request_path}"
            );
            true
        } else if !host.is_empty() {
            log::debug!(
                "CORS preflight: Host is '{host}', trusted hosts: {:?}",
                &config.trusted_hosts
            );
            is_valid_host(host, &config.trusted_hosts)
        } else {
            log::warn!("CORS preflight: No Host header present");
            false
        };

        if !is_trusted {
            log::warn!("CORS preflight: Host '{host}' not trusted for path '{request_path}'");
            return Ok(Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::from("Host not allowed"))
                .unwrap());
        }

        let requested_headers = req
            .headers()
            .get("Access-Control-Request-Headers")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let allowed_headers = [
            "accept",
            "accept-language",
            "authorization",
            "cache-control",
            "connection",
            "content-type",
            "dnt",
            "host",
            "if-modified-since",
            "keep-alive",
            "origin",
            "user-agent",
            "x-api-key",
            "x-csrf-token",
            "x-forwarded-for",
            "x-forwarded-host",
            "x-forwarded-proto",
            "x-requested-with",
            "x-stainless-arch",
            "x-stainless-lang",
            "x-stainless-os",
            "x-stainless-package-version",
            "x-stainless-retry-count",
            "x-stainless-runtime",
            "x-stainless-runtime-version",
            "x-stainless-timeout",
        ];

        let headers_valid = if requested_headers.is_empty() {
            true
        } else {
            requested_headers
                .split(',')
                .map(|h| h.trim())
                .all(|header| {
                    allowed_headers
                        .iter()
                        .any(|&allowed| allowed.eq_ignore_ascii_case(header))
                })
        };

        if !headers_valid {
            log::warn!("CORS preflight: Some requested headers not allowed: {requested_headers}");
            return Ok(Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::from("Headers not allowed"))
                .unwrap());
        }

        let mut response = Response::builder()
            .status(StatusCode::OK)
            .header("Access-Control-Allow-Methods", allowed_methods.join(", "))
            .header("Access-Control-Allow-Headers", allowed_headers.join(", "))
            .header("Access-Control-Max-Age", "86400")
            .header(
                "Vary",
                "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
            );

        if !origin.is_empty() {
            let origin_host = extract_host_from_origin(origin);
            if is_valid_host(&origin_host, &config.trusted_hosts) {
                response = response
                    .header("Access-Control-Allow-Origin", origin)
                    .header("Access-Control-Allow-Credentials", "true");
            } else {
                log::warn!(
                    "CORS preflight: Origin '{origin}' is not trusted, not reflecting origin"
                );
            }
        }

        log::debug!("CORS preflight response: host_trusted={is_trusted}, origin='{origin}'");
        return Ok(response.body(Body::empty()).unwrap());
    }

    let (parts, body) = req.into_parts();

    let origin_header = parts
        .headers
        .get(hyper::header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let host_header = parts
        .headers
        .get(hyper::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let original_path = parts.uri.path();
    let headers = parts.headers.clone();

    let path = get_destination_path(original_path, &config.prefix);
    let method = parts.method.clone();

    let whitelisted_paths = [
        "/",
        "/openapi.json",
        "/favicon.ico",
        "/docs/swagger-ui.css",
        "/docs/swagger-ui-bundle.js",
        "/docs/swagger-ui-standalone-preset.js",
    ];
    let is_whitelisted_path = whitelisted_paths.contains(&path.as_str());

    if !is_whitelisted_path {
        if !host_header.is_empty() {
            if !is_valid_host(&host_header, &config.trusted_hosts) {
                let mut error_response = Response::builder().status(StatusCode::FORBIDDEN);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response
                    .body(Body::from("Invalid host header"))
                    .unwrap());
            }
        } else {
            let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response
                .body(Body::from("Missing host header"))
                .unwrap());
        }
    } else {
        log::debug!("Bypassing host validation for whitelisted path: {path}");
    }

    if !is_whitelisted_path && !config.proxy_api_key.is_empty() {
        // Check Authorization header (Bearer token)
        let auth_valid = parts
            .headers
            .get(hyper::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| token == config.proxy_api_key)
            .unwrap_or(false);

        // Check X-Api-Key header
        let api_key_valid = parts
            .headers
            .get("X-Api-Key")
            .and_then(|v| v.to_str().ok())
            .map(|key| key == config.proxy_api_key)
            .unwrap_or(false);

        if !auth_valid && !api_key_valid {
            let mut error_response = Response::builder().status(StatusCode::UNAUTHORIZED);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response
                .body(Body::from("Invalid or missing authorization token"))
                .unwrap());
        }
    } else if is_whitelisted_path {
        log::debug!("Bypassing authorization check for whitelisted path: {path}");
    }

    if path.contains("/configs") {
        let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
        error_response = add_cors_headers_with_host_and_origin(
            error_response,
            &host_header,
            &origin_header,
            &config.trusted_hosts,
        );
        return Ok(error_response.body(Body::from("Not Found")).unwrap());
    }

    let original_path = parts.uri.path();
    let destination_path = get_destination_path(original_path, &config.prefix);

    // Initialize variables that will be set in the match
    let mut session_api_keys: Vec<String> = Vec::new();
    #[allow(unused_assignments)]
    let mut buffered_body: Option<Bytes> = None;
    let mut target_base_url: Option<String> = None;
    let mut upstream_custom_headers: Vec<ProviderCustomHeader> = Vec::new();
    let mut is_anthropic_messages = false;
    let mut rewrite_responses_to_chat = false;

    match (method.clone(), destination_path.as_str()) {
        // Anthropic /messages endpoint - tries /messages first, falls back to /chat/completions on error
        (hyper::Method::POST, "/messages") => {
            is_anthropic_messages = true;
            log::info!(
                "Handling POST request to /messages with chat/completions fallback on error",
            );
            let body_bytes = match hyper::body::to_bytes(body).await {
                Ok(bytes) => bytes,
                Err(_) => {
                    let mut error_response =
                        Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response
                        .body(Body::from("Failed to read request body"))
                        .unwrap());
                }
            };
            buffered_body = Some(body_bytes.clone());

            // Parse body to get model_id for routing (don't transform yet)
            match serde_json::from_slice::<serde_json::Value>(&body_bytes) {
                Ok(json_body) => {
                    if let Some(model_id) = json_body.get("model").and_then(|v| v.as_str()) {
                        let pc = provider_configs.lock().await;

                        // Try to find a provider for this model
                        let provider_name = provider_for_gateway_model(model_id, &pc);

                        drop(pc);

                        if let Some(ref p) = provider_name {
                            log::info!("Using remote provider '{p}' for model '{model_id}'");
                            let pc2 = provider_configs.lock().await;
                            let provider_config = pc2.get(p.as_str()).cloned();
                            drop(pc2);

                            if let Some(provider_cfg) = provider_config {
                                target_base_url = provider_cfg.base_url.clone().map(|url| {
                                    format!("{}{}", url.trim_end_matches('/'), "/messages")
                                });
                                session_api_keys = provider_cfg.bearer_key_chain();
                            }
                        } else {
                            let mlx_session_info = {
                                let mlx_guard = mlx_sessions.lock().await;
                                find_mlx_session(&mlx_guard, model_id)
                            };

                            if let Some(info) = mlx_session_info {
                                let target_port = info.port;
                                session_api_keys = vec![info.api_key.clone()];
                                target_base_url =
                                    Some(format!("http://127.0.0.1:{}/v1/messages", target_port));
                                if let Some(rewritten) =
                                    maybe_rewrite_gateway_model_body(&body_bytes, model_id)
                                {
                                    buffered_body = Some(rewritten);
                                }
                            } else if should_route_llamacpp(model_id) {
                                if let Some((url, key)) =
                                    router_upstream(&llama_state, "/messages").await
                                {
                                    if let Some(rewritten) =
                                        maybe_rewrite_gateway_model_body(&body_bytes, model_id)
                                    {
                                        buffered_body = Some(rewritten);
                                    }
                                    session_api_keys = vec![key];
                                    target_base_url = Some(url);
                                } else {
                                    log::warn!("No running session found for model_id: {model_id}");
                                    let mut error_response =
                                        Response::builder().status(StatusCode::NOT_FOUND);
                                    error_response = add_cors_headers_with_host_and_origin(
                                        error_response,
                                        &host_header,
                                        &origin_header,
                                        &config.trusted_hosts,
                                    );
                                    return Ok(error_response
                                        .body(Body::from(format!(
                                            "No running session found for model '{model_id}'"
                                        )))
                                        .unwrap());
                                }
                            } else {
                                log::warn!("No running session found for model_id: {model_id}");
                                let mut error_response =
                                    Response::builder().status(StatusCode::NOT_FOUND);
                                error_response = add_cors_headers_with_host_and_origin(
                                    error_response,
                                    &host_header,
                                    &origin_header,
                                    &config.trusted_hosts,
                                );
                                return Ok(error_response
                                    .body(Body::from(format!(
                                        "No running session found for model '{model_id}'"
                                    )))
                                    .unwrap());
                            }
                        }
                    } else {
                        let error_msg = "Request body must contain a 'model' field";
                        log::warn!("POST body for /messages missing 'model' field");
                        let mut error_response =
                            Response::builder().status(StatusCode::BAD_REQUEST);
                        error_response = add_cors_headers_with_host_and_origin(
                            error_response,
                            &host_header,
                            &origin_header,
                            &config.trusted_hosts,
                        );
                        return Ok(error_response.body(Body::from(error_msg)).unwrap());
                    }
                }
                Err(e) => {
                    log::warn!("Failed to parse POST body for /messages as JSON: {e}");
                    let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    let error_msg = format!("Invalid JSON body: {}", e);
                    return Ok(error_response.body(Body::from(error_msg)).unwrap());
                }
            }
        }
        (hyper::Method::POST, "/orchestrations") => {
            let mut response_builder = Response::builder().status(StatusCode::GONE);
            response_builder = add_cors_headers_with_host_and_origin(
                response_builder,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            let response = response_builder.body(Body::from(
                "This endpoint is no longer supported on the local server.",
            ));
            return Ok(response.unwrap());
        }
        (hyper::Method::POST, "/chat/completions")
        | (hyper::Method::POST, "/completions")
        | (hyper::Method::POST, "/embeddings")
        | (hyper::Method::POST, "/responses")
        | (hyper::Method::POST, "/messages/count_tokens") => {
            log::info!(
                "Handling POST request to {destination_path} requiring model lookup in body",
            );
            let body_bytes = match hyper::body::to_bytes(body).await {
                Ok(bytes) => bytes,
                Err(_) => {
                    let mut error_response =
                        Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response
                        .body(Body::from("Failed to read request body"))
                        .unwrap());
                }
            };
            buffered_body = Some(body_bytes.clone());

            match serde_json::from_slice::<serde_json::Value>(&body_bytes) {
                Ok(mut json_body) => {
                    // Work around strict JSON-schema converters that reject property schemas
                    // of the form `{ "description": "..." }` (missing `type`).
                    // This happens for OpenAI-style tool schemas used with /chat/completions.
                    if destination_path == "/chat/completions" {
                        normalize_openai_tools_in_chat_body(&mut json_body);
                        if let Ok(normalized_bytes) = serde_json::to_vec(&json_body) {
                            buffered_body = Some(normalized_bytes.into());
                        }
                    }

                    if let Some(model_id) = json_body.get("model").and_then(|v| v.as_str()) {
                        log::debug!("Extracted model_id: {model_id}");

                        // First, check if there's a registered remote provider for this model
                        let pc = provider_configs.lock().await;

                        let provider_name = provider_for_gateway_model(model_id, &pc);

                        drop(pc);

                        if let Some(ref provider) = provider_name {
                            // Found a remote provider, stream the response directly
                            log::info!("Found remote provider '{provider}' for model '{model_id}'");

                            // Get the provider config
                            let pc2 = provider_configs.lock().await;
                            let provider_config = pc2.get(provider.as_str()).cloned();

                            // Log registered providers for debugging
                            log::debug!(
                                "Registered providers: {:?}",
                                pc2.keys().collect::<Vec<_>>()
                            );

                            drop(pc2);

                            if let Some(provider_cfg) = provider_config {
                                let body_for_upstream = buffered_body.clone().unwrap_or(body_bytes);
                                match prepare_remote_provider_upstream(
                                    &provider_cfg,
                                    provider,
                                    &destination_path,
                                    &body_for_upstream,
                                    model_id,
                                ) {
                                    Ok((url, keys, outbound, rewrite)) => {
                                        log::info!(
                                            "Routing '{model_id}' via {} wire API to {url}",
                                            provider_wire_api(&provider_cfg)
                                        );
                                        target_base_url = Some(url);
                                        session_api_keys = keys;
                                        upstream_custom_headers = provider_cfg.custom_headers.clone();
                                        buffered_body = Some(outbound);
                                        rewrite_responses_to_chat = rewrite;
                                    }
                                    Err(e) => {
                                        log::error!("{e}");
                                        target_base_url = None;
                                    }
                                }
                            } else {
                                log::error!("Provider config not found for '{provider}'");
                            }
                        } else {
                            let mlx_session_info = {
                                let mlx_guard = mlx_sessions.lock().await;
                                find_mlx_session(&mlx_guard, model_id)
                            };

                            let router_up = if should_route_llamacpp(model_id) {
                                router_upstream(&llama_state, &destination_path).await
                            } else {
                                None
                            };

                            if mlx_session_info.is_none() && router_up.is_none() {
                                log::warn!(
                                    "Request for model '{model_id}' but no models are running."
                                );
                                let mut error_response =
                                    Response::builder().status(StatusCode::SERVICE_UNAVAILABLE);
                                error_response = add_cors_headers_with_host_and_origin(
                                    error_response,
                                    &host_header,
                                    &origin_header,
                                    &config.trusted_hosts,
                                );
                                return Ok(error_response
                                    .body(Body::from("No models are available"))
                                    .unwrap());
                            }

                            if let Some(info) = mlx_session_info {
                                let target_port = info.port;
                                session_api_keys = vec![info.api_key.clone()];
                                log::debug!("Found MLX session for model_id {model_id}");
                                target_base_url = Some(format!(
                                    "http://127.0.0.1:{target_port}/v1{destination_path}"
                                ));
                                if let Some(rewritten) =
                                    maybe_rewrite_gateway_model_body(&body_bytes, model_id)
                                {
                                    buffered_body = Some(rewritten);
                                }
                            } else if let Some((url, key)) = router_up {
                                log::debug!("Routing model_id {model_id} via llamacpp router");
                                session_api_keys = vec![key];
                                target_base_url = Some(url);
                                if let Some(rewritten) =
                                    maybe_rewrite_gateway_model_body(&body_bytes, model_id)
                                {
                                    buffered_body = Some(rewritten);
                                }
                            } else {
                                log::warn!("No running session found for model_id: {model_id}");
                                let mut error_response =
                                    Response::builder().status(StatusCode::NOT_FOUND);
                                error_response = add_cors_headers_with_host_and_origin(
                                    error_response,
                                    &host_header,
                                    &origin_header,
                                    &config.trusted_hosts,
                                );
                                return Ok(error_response
                                    .body(Body::from(format!(
                                        "No running session found for model '{model_id}'"
                                    )))
                                    .unwrap());
                            }
                        }
                    } else {
                        let error_msg = "Request body must contain a 'model' field";
                        log::warn!(
                            "POST body for {destination_path} is missing 'model' field or it's not a string"
                        );
                        let mut error_response =
                            Response::builder().status(StatusCode::BAD_REQUEST);
                        error_response = add_cors_headers_with_host_and_origin(
                            error_response,
                            &host_header,
                            &origin_header,
                            &config.trusted_hosts,
                        );
                        return Ok(error_response.body(Body::from(error_msg)).unwrap());
                    }
                }
                Err(e) => {
                    log::warn!("Failed to parse POST body for {destination_path} as JSON: {e}");
                    let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    let error_msg = format!("Invalid JSON body: {}", e);
                    return Ok(error_response.body(Body::from(error_msg)).unwrap());
                }
            }
        }
        (hyper::Method::GET, "/models") => {
            log::debug!("Handling GET /v1/models request");

            let local_models: Vec<_> = router_list_models(&llama_state, &client)
                .await
                .into_iter()
                .map(|id| {
                    serde_json::json!({
                        "id": format_gateway_model_id("llamacpp", &id),
                        "object": "model",
                        "created": 1,
                        "owned_by": "llamacpp"
                    })
                })
                .collect();

            // Get MLX sessions
            let mlx_models: Vec<_> = {
                let mlx_guard = mlx_sessions.lock().await;
                mlx_guard
                    .values()
                    .map(|session| {
                        serde_json::json!({
                            "id": format_gateway_model_id("mlx", &session.info.model_id),
                            "object": "model",
                            "created": 1,
                            "owned_by": "mlx"
                        })
                    })
                    .collect()
            };

            // Get remote provider models
            let pc = provider_configs.lock().await;
            let remote_models: Vec<_> = pc
                .values()
                .flat_map(|provider_cfg| {
                    let provider = provider_cfg.provider.clone();
                    provider_cfg.models.iter().cloned().map(move |model_id| {
                        serde_json::json!({
                            "id": model_id,
                            "object": "model",
                            "created": 1,
                            "owned_by": provider
                        })
                    })
                })
                .collect();

            // Store counts before moving
            let local_count = local_models.len();
            let mlx_count = mlx_models.len();
            let remote_count = remote_models.len();

            // Combine all models
            let mut all_models = Vec::with_capacity(local_count + mlx_count + remote_count);
            all_models.extend(local_models);
            all_models.extend(mlx_models);
            all_models.extend(remote_models);

            let response_json = serde_json::json!({
                "object": "list",
                "data": all_models
            });

            let body_str =
                serde_json::to_string(&response_json).unwrap_or_else(|_| "{}".to_string());

            let mut response_builder = Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "application/json");

            response_builder = add_cors_headers_with_host_and_origin(
                response_builder,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );

            log::debug!(
                "Returning {} models ({} llama.cpp, {} MLX, {} remote)",
                all_models.len(),
                local_count,
                mlx_count,
                remote_count
            );

            return Ok(response_builder.body(Body::from(body_str)).unwrap());
        }

        (hyper::Method::GET, "/openapi.json") => {
            let static_body = include_str!("../../../static/openapi.json"); // relative to src-tauri/src/
                                                                            // Parse the static OpenAPI JSON and update the server URL with actual host and port
            match serde_json::from_str::<serde_json::Value>(static_body) {
                Ok(mut openapi_spec) => {
                    // Update the servers array with the actual host and port
                    if let Some(servers) = openapi_spec
                        .get_mut("servers")
                        .and_then(|s| s.as_array_mut())
                    {
                        for server in servers {
                            if let Some(server_obj) = server.as_object_mut() {
                                if let Some(url) = server_obj.get_mut("url") {
                                    let base_url = format!(
                                        "http://{}:{}{}",
                                        config.host, config.port, config.prefix
                                    );
                                    *url = serde_json::Value::String(base_url);
                                }
                            }
                        }
                    }
                    let body = serde_json::to_string(&openapi_spec)
                        .unwrap_or_else(|_| static_body.to_string());
                    return Ok(Response::builder()
                        .status(StatusCode::OK)
                        .header(hyper::header::CONTENT_TYPE, "application/json")
                        .body(Body::from(body))
                        .unwrap());
                }
                Err(_) => {
                    // If parsing fails, return the static file as fallback
                    return Ok(Response::builder()
                        .status(StatusCode::OK)
                        .header(hyper::header::CONTENT_TYPE, "application/json")
                        .body(Body::from(static_body))
                        .unwrap());
                }
            }
        }

        // DOCS route
        (hyper::Method::GET, "/") => {
            let html = r#"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>API Docs</title>
  <link rel="stylesheet" type="text/css" href="/docs/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/swagger-ui-bundle.js"></script>
  <script>
  window.onload = () => {
    SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
    });
  };
  </script>
</body>
</html>
    "#;

            let mut response_builder = Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "text/html");

            response_builder = add_cors_headers_with_host_and_origin(
                response_builder,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );

            return Ok(response_builder.body(Body::from(html)).unwrap());
        }

        (hyper::Method::GET, "/docs/swagger-ui.css") => {
            let css = include_str!("../../../static/swagger-ui/swagger-ui.css");
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "text/css")
                .body(Body::from(css))
                .unwrap());
        }

        (hyper::Method::GET, "/docs/swagger-ui-bundle.js") => {
            let js = include_str!("../../../static/swagger-ui/swagger-ui-bundle.js");
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "application/javascript")
                .body(Body::from(js))
                .unwrap());
        }

        (hyper::Method::GET, "/favicon.ico") => {
            let icon = include_bytes!("../../../static/swagger-ui/favicon.ico");
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "image/x-icon")
                .body(Body::from(icon.as_ref()))
                .unwrap());
        }

        _ => {
            let is_explicitly_whitelisted_get = method == hyper::Method::GET
                && whitelisted_paths.contains(&destination_path.as_str());
            if is_explicitly_whitelisted_get {
                log::debug!("Handled whitelisted GET path: {destination_path}");
                let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response.body(Body::from("Not Found")).unwrap());
            } else {
                log::warn!(
                    "Unhandled method/path for dynamic routing: {method} {destination_path}"
                );
                let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response.body(Body::from("Not Found")).unwrap());
            }
        }
    }

    let upstream_url = match target_base_url.clone() {
        Some(p) => p,
        None => {
            log::error!(
                "Internal API server routing error: target is None after successful lookup"
            );
            let mut error_response = Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response
                .body(Body::from("Internal routing error"))
                .unwrap());
        }
    };
    log::info!(
        "Proxying request to model server at base URL {upstream_url}, path: {destination_path}"
    );

    let body_bytes_for_proxy = match buffered_body.clone() {
        Some(b) => b,
        None => {
            log::error!(
                "Internal logic error: Request reached proxy stage without a buffered body."
            );
            let mut error_response = Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response
                .body(Body::from("Internal server error: unhandled request path"))
                .unwrap());
        }
    };

    let key_attempts: Vec<Option<String>> = if session_api_keys.is_empty() {
        vec![None]
    } else {
        session_api_keys.iter().cloned().map(Some).collect()
    };

    // For Anthropic /messages, we need to track if we should transform the response
    let destination_path = path.clone();

    let is_streaming_request = serde_json::from_slice::<serde_json::Value>(&body_bytes_for_proxy)
        .ok()
        .and_then(|j| j.get("stream").and_then(|v| v.as_bool()))
        .unwrap_or(false);
    let upstream_client = if is_streaming_request || rewrite_responses_to_chat {
        &streaming_client
    } else {
        &client
    };

    for (key_idx, key_opt) in key_attempts.iter().enumerate() {
        let mut outbound_req = upstream_client.request(method.clone(), upstream_url.clone());

        outbound_req = outbound_req.header("Accept-Encoding", "identity");

        if method == hyper::Method::POST || method == hyper::Method::PUT || method == hyper::Method::PATCH
        {
            outbound_req = outbound_req.header("Content-Type", "application/json");
        }

        for custom in &upstream_custom_headers {
            if !custom.header.is_empty() {
                outbound_req = outbound_req.header(&custom.header, &custom.value);
            }
        }

        for (name, value) in headers.iter() {
            if name != hyper::header::HOST
                && name != hyper::header::AUTHORIZATION
                && name != hyper::header::ACCEPT_ENCODING
                && name != hyper::header::CONTENT_LENGTH
                && name != hyper::header::TRANSFER_ENCODING
                && name.as_str() != "content-type"
            {
                outbound_req = outbound_req.header(name, value);
            }
        }

        if let Some(key) = key_opt {
            outbound_req = outbound_req.header("Authorization", format!("Bearer {key}"));
        } else {
            log::debug!("No session API key for this attempt");
        }

        let outbound_req_with_body = outbound_req.body(body_bytes_for_proxy.clone());

        match outbound_req_with_body.send().await {
            Ok(response) => {
                let status = response.status();

                let is_error = !status.is_success();

                if is_error
                    && http_status_indicates_api_key_retry(status)
                    && key_idx + 1 < key_attempts.len()
                {
                    let _ = response.text().await;
                    log::warn!("Upstream {status} for API key index {key_idx}, trying next key");
                    continue;
                }

                // For Anthropic /messages requests with errors, try /chat/completions
                if is_error && is_anthropic_messages {
                    log::warn!("Request failed for /messages with status {status}, trying /chat/completions...");

                    // Read the error body to return to client if fallback fails
                    let error_body = response
                        .text()
                        .await
                        .unwrap_or_else(|e| format!("Failed to read error body: {}", e));

                    // Clone what we need for the fallback request
                    let fallback_url = target_base_url.clone().map(|url| {
                        url.trim_end_matches("/messages")
                            .trim_end_matches('/')
                            .to_string()
                    });
                    let fallback_api_key = key_opt.clone();
                    let fallback_body = Some(body_bytes_for_proxy.clone());

                    // Transform body to OpenAI format for fallback
                    if let Some((url, openai_body)) = fallback_url.zip(fallback_body).and_then(|(url, body)| {
                    let json_body = serde_json::from_slice::<serde_json::Value>(&body).ok()?;
                    match transform_anthropic_to_openai(&json_body) {
                        Some(transformed) => Some((url, transformed)),
                        None => {
                            log::error!("transform_anthropic_to_openai returned None for body: {json_body}");
                            None
                        }
                    }
                }) {
                    let chat_url = format!("{}/chat/completions", url);
                    log::info!("Fallback to chat completions: {chat_url}");

                    // Create a fresh client for the fallback to avoid connection pool issues
                    let fallback_client = Client::builder()
                        .build()
                        .expect("Failed to create fallback client");

                    let mut fallback_req = fallback_client.post(&chat_url);

                    // Ensure Content-Type is set and prevent compression
                    fallback_req = fallback_req.header("Content-Type", "application/json");
                    fallback_req = fallback_req.header("Accept-Encoding", "identity");

                    for (name, value) in headers.iter() {
                        if name != hyper::header::HOST
                            && name != hyper::header::AUTHORIZATION
                            && name != "content-type"
                            && name != hyper::header::CONTENT_LENGTH
                            && name != hyper::header::ACCEPT_ENCODING
                        {
                            fallback_req = fallback_req.header(name, value);
                        }
                    }
                    if let Some(key) = fallback_api_key {
                        fallback_req = fallback_req.header("Authorization", format!("Bearer {key}"));
                    }

                    let fallback_body_str = openai_body.to_string();

                    let fallback_response = fallback_req.body(fallback_body_str).send().await;

                    if let Ok(res) = fallback_response {
                        let fallback_status = res.status();

                        if !fallback_status.is_success() {
                            // Return fallback error to client
                            let fallback_error = res.text().await.unwrap_or_else(|e| format!("Failed to read error: {}", e));

                            // Return the error to client
                            let mut error_response = Response::builder().status(fallback_status);
                            error_response = add_cors_headers_with_host_and_origin(
                                error_response,
                                &host_header,
                                &origin_header,
                                &config.trusted_hosts,
                            );
                            return Ok(error_response
                                .body(Body::from(fallback_error))
                                .unwrap());
                        }

                        let mut builder = Response::builder().status(fallback_status);
                        for (name, value) in res.headers() {
                            if !is_cors_header(name.as_str()) && name != hyper::header::CONTENT_LENGTH {
                                builder = builder.header(name, value);
                            }
                        }
                        builder = add_cors_headers_with_host_and_origin(
                            builder,
                            &host_header,
                            &origin_header,
                            &config.trusted_hosts,
                        );

                        let is_streaming = openai_body
                            .get("stream")
                            .and_then(|s| s.as_bool())
                            .unwrap_or(false);

                        let (sender, body) = hyper::Body::channel();
                        let dest_path = destination_path.clone();

                        tokio::spawn(async move {
                            if is_streaming {
                                let stream = res.bytes_stream();
                                transform_and_forward_stream(stream, sender, &dest_path).await;
                            } else {
                                let response_body = res.bytes().await;
                                forward_non_streaming(
                                    response_body,
                                    sender,
                                    &dest_path,
                                )
                                .await;
                            }
                        });

                        return Ok(builder.body(body).unwrap());
                    } else if let Err(ref err) = fallback_response {
                        log::error!("Chat completions fallback failed: {}", err);
                    }
                }

                    // If fallback failed or wasn't attempted, return error to client
                    let mut error_response = Response::builder().status(status);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response.body(Body::from(error_body)).unwrap());
                } else if is_error {
                    // Non-/messages error - return error response with body
                    let error_body = response
                        .text()
                        .await
                        .unwrap_or_else(|e| format!("Failed to read error body: {}", e));

                    let mut error_response = Response::builder().status(status);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response.body(Body::from(error_body)).unwrap());
                }

                // Success case - stream the response
                let mut builder = Response::builder().status(status);

                for (name, value) in response.headers() {
                    if !is_cors_header(name.as_str()) && name != hyper::header::CONTENT_LENGTH {
                        builder = builder.header(name, value);
                    }
                }

                builder = add_cors_headers_with_host_and_origin(
                    builder,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );

                let (mut sender, body) = hyper::Body::channel();
                let rewrite_chat = rewrite_responses_to_chat;
                let stream_upstream = is_streaming_request;

                tokio::spawn(async move {
                    if rewrite_chat && stream_upstream {
                        forward_responses_stream_as_chat(response.bytes_stream(), sender).await;
                    } else if rewrite_chat {
                        match response.bytes().await {
                            Ok(bytes) => {
                                if let Ok(json) =
                                    serde_json::from_slice::<serde_json::Value>(&bytes)
                                {
                                    let chat = transform_responses_json_to_chat(&json);
                                    if let Ok(out) = serde_json::to_vec(&chat) {
                                        let _ = sender.send_data(Bytes::from(out)).await;
                                    }
                                }
                            }
                            Err(e) => log::error!("Failed to read responses body: {e}"),
                        }
                    } else {
                        let mut stream = response.bytes_stream();
                        while let Some(chunk_result) = stream.next().await {
                            match chunk_result {
                                Ok(chunk) => {
                                    if sender.send_data(chunk).await.is_err() {
                                        log::debug!("Client disconnected during streaming");
                                        break;
                                    }
                                }
                                Err(e) => {
                                    log::error!("Stream error: {e}");
                                    break;
                                }
                            }
                        }
                    }
                    log::debug!("Streaming complete to client");
                });

                return Ok(builder.body(body).unwrap());
            }
            Err(e) => {
                let error_msg = format!("Proxy request to model failed: {e}");
                log::error!("{error_msg}");
                let mut error_response = Response::builder().status(StatusCode::BAD_GATEWAY);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response.body(Body::from(error_msg)).unwrap());
            }
        }
    }

    log::error!("Internal error: proxy key loop exited without a response");
    let mut error_response = Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
    error_response = add_cors_headers_with_host_and_origin(
        error_response,
        &host_header,
        &origin_header,
        &config.trusted_hosts,
    );
    Ok(error_response
        .body(Body::from("Internal proxy error"))
        .unwrap())
}

pub(crate) fn add_cors_headers_with_host_and_origin(
    builder: hyper::http::response::Builder,
    _host: &str,
    origin: &str,
    trusted_hosts: &[Vec<String>],
) -> hyper::http::response::Builder {
    let mut builder = builder;

    let origin_trusted = if !origin.is_empty() {
        let origin_host = extract_host_from_origin(origin);
        is_valid_host(&origin_host, trusted_hosts)
    } else {
        false
    };

    builder = builder
        .header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
        .header("Access-Control-Allow-Headers", "Authorization, Content-Type, Host, Accept, Accept-Language, Cache-Control, Connection, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, X-CSRF-Token, X-Forwarded-For, X-Forwarded-Proto, X-Forwarded-Host, authorization, content-type, x-api-key")
        .header("Vary", "Origin");

    if origin_trusted {
        builder = builder
            .header("Access-Control-Allow-Origin", origin)
            .header("Access-Control-Allow-Credentials", "true");
    } else if !origin.is_empty() {
        // Empty origin is normal for non-browser clients (curl, SDKs); CORS does not apply.
        log::warn!(
            "CORS: Origin '{origin}' is not trusted, not reflecting origin"
        );
    }

    builder
}

pub async fn is_server_running(server_handle: Arc<Mutex<Option<ServerHandle>>>) -> bool {
    let handle_guard = server_handle.lock().await;
    handle_guard.is_some()
}

#[allow(clippy::too_many_arguments)]
pub async fn start_server(
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
    server_listen_port: Arc<Mutex<Option<u16>>>,
    llama_state: Arc<LlamacppState>,
    mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    host: String,
    port: u16,
    prefix: String,
    proxy_api_key: String,
    trusted_hosts: Vec<Vec<String>>,
    proxy_timeout: u64,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    mcp_servers: SharedMcpServers,
    mcp_settings: Arc<Mutex<McpSettings>>,
    parlo_data_folder: String,
) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    start_server_internal(
        server_handle,
        server_listen_port,
        llama_state,
        mlx_sessions,
        host,
        port,
        prefix,
        proxy_api_key,
        trusted_hosts,
        proxy_timeout,
        provider_configs,
        mcp_servers,
        mcp_settings,
        parlo_data_folder,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn start_server_internal(
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
    server_listen_port: Arc<Mutex<Option<u16>>>,
    llama_state: Arc<LlamacppState>,
    mlx_sessions: Arc<Mutex<HashMap<i32, MlxBackendSession>>>,
    host: String,
    port: u16,
    prefix: String,
    proxy_api_key: String,
    trusted_hosts: Vec<Vec<String>>,
    proxy_timeout: u64,
    provider_configs: Arc<Mutex<HashMap<String, ProviderConfig>>>,
    mcp_servers: SharedMcpServers,
    mcp_settings: Arc<Mutex<McpSettings>>,
    parlo_data_folder: String,
) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let mut handle_guard = server_handle.lock().await;
    if handle_guard.is_some() {
        let stored_port = server_listen_port.lock().await.unwrap_or(port);
        log::debug!("Parlo API server already running on port {stored_port}");
        return Ok(stored_port);
    }

    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .map_err(|e| format!("Invalid address: {e}"))?;

    // When binding to all interfaces (0.0.0.0), the user explicitly wants the server
    // reachable from any network interface. Allow any host header so LAN clients
    // (e.g. 192.168.x.x) are not rejected with "Invalid host header".
    let effective_trusted_hosts = if host == "0.0.0.0" {
        vec![vec!["*".to_string()]]
    } else {
        trusted_hosts
    };

    let config = ProxyConfig {
        prefix,
        proxy_api_key,
        trusted_hosts: effective_trusted_hosts,
        host: host.clone(),
        port,
    };

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(proxy_timeout))
        .http1_only()
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(std::time::Duration::from_secs(30))
        .build()?;

    let streaming_client = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .tcp_keepalive(std::time::Duration::from_secs(60))
        .http1_only()
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(std::time::Duration::from_secs(30))
        .build()?;

    let make_svc = make_service_fn(move |_conn| {
        let client = client.clone();
        let streaming_client = streaming_client.clone();
        let config = config.clone();
        let llama_state = llama_state.clone();
        let mlx_sessions = mlx_sessions.clone();
        let provider_configs = provider_configs.clone();
        let mcp_servers = mcp_servers.clone();
        let mcp_settings = mcp_settings.clone();
        let parlo_data_folder = parlo_data_folder.clone();

        async move {
            Ok::<_, Infallible>(service_fn(move |req| {
                proxy_request(
                    req,
                    client.clone(),
                    streaming_client.clone(),
                    config.clone(),
                    llama_state.clone(),
                    mlx_sessions.clone(),
                    provider_configs.clone(),
                    mcp_servers.clone(),
                    mcp_settings.clone(),
                    parlo_data_folder.clone(),
                )
            }))
        }
    });

    let server = match Server::try_bind(&addr) {
        Ok(builder) => builder.serve(make_svc),
        Err(e) => {
            log::error!("Failed to bind to {addr}: {e}");
            return Err(Box::new(e));
        }
    };
    log::info!("Parlo API server started on http://{addr}");

    let server_task = tokio::spawn(async move {
        if let Err(e) = server.await {
            log::error!("Server error: {e}");
            return Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>);
        }
        Ok(())
    });

    *handle_guard = Some(server_task);
    let actual_port = addr.port();
    *server_listen_port.lock().await = Some(actual_port);
    log::info!("Parlo API server started successfully on port {actual_port}");
    Ok(actual_port)
}

pub async fn stop_server(
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
    server_listen_port: Arc<Mutex<Option<u16>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut handle_guard = server_handle.lock().await;

    if let Some(handle) = handle_guard.take() {
        handle.abort();
        *handle_guard = None;
        *server_listen_port.lock().await = None;
        log::info!("Parlo API server stopped");
    } else {
        log::debug!("Server was not running");
    }

    Ok(())
}

/// Helper to format an Anthropic SSE event with proper event type and delimiters
pub(crate) fn sse_event(data: &serde_json::Value) -> Bytes {
    let event_type = data
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("message");
    Bytes::from(format!("event: {event_type}\ndata: {data}\n\n"))
}

/// Transform and forward streaming OpenAI response as Anthropic /messages chunks.
/// Handles both text content and tool_calls streaming.
async fn transform_and_forward_stream<S>(
    mut stream: S,
    mut sender: hyper::body::Sender,
    _destination_path: &str,
) where
    S: futures_util::Stream<Item = Result<Bytes, reqwest::Error>> + Unpin,
{
    let mut is_first = true;
    let mut accumulated_content = String::new();

    // Track active Anthropic content blocks
    let mut text_block_index: Option<usize> = None;
    let mut tool_blocks: HashMap<usize, usize> = HashMap::new(); // OAI tool index -> Anthropic block index
    let mut next_block_index: usize = 0;

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                let chunk_str = String::from_utf8_lossy(&chunk);

                for line in chunk_str.lines() {
                    if !line.starts_with("data:") {
                        continue;
                    }
                    let data = line.trim_start_matches("data:").trim();

                    if data == "[DONE]" {
                        // Close any remaining open blocks
                        if let Some(idx) = text_block_index.take() {
                            let stop =
                                serde_json::json!({"type": "content_block_stop", "index": idx});
                            if sender.send_data(sse_event(&stop)).await.is_err() {
                                return;
                            }
                        }
                        let mut tool_indices: Vec<usize> = tool_blocks.values().copied().collect();
                        tool_indices.sort();
                        for idx in tool_indices {
                            let stop =
                                serde_json::json!({"type": "content_block_stop", "index": idx});
                            if sender.send_data(sse_event(&stop)).await.is_err() {
                                return;
                            }
                        }

                        let stop_reason = if tool_blocks.is_empty() {
                            "end_turn"
                        } else {
                            "tool_use"
                        };
                        let output_tokens = accumulated_content.split_whitespace().count() as u64;

                        let delta_event = serde_json::json!({
                            "type": "message_delta",
                            "delta": {
                                "stop_reason": stop_reason,
                                "stop_sequence": serde_json::Value::Null
                            },
                            "usage": { "output_tokens": output_tokens }
                        });
                        if sender.send_data(sse_event(&delta_event)).await.is_err() {
                            return;
                        }

                        let final_stop = serde_json::json!({"type": "message_stop"});
                        if sender.send_data(sse_event(&final_stop)).await.is_err() {
                            return;
                        }
                        log::debug!("Sent Anthropic final events");
                        return;
                    }

                    let json_chunk = match serde_json::from_str::<serde_json::Value>(data) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    let choice = json_chunk
                        .get("choices")
                        .and_then(|c| c.as_array())
                        .and_then(|c| c.first());
                    let delta = match choice.and_then(|c| c.get("delta")) {
                        Some(d) => d,
                        None => continue,
                    };
                    let finish_reason = choice.and_then(|c| c.get("finish_reason"));
                    let has_finish = finish_reason.is_some() && !finish_reason.unwrap().is_null();

                    // First chunk: send message_start
                    if is_first {
                        let role = delta
                            .get("role")
                            .and_then(|r| r.as_str())
                            .unwrap_or("assistant");
                        let message_id = json_chunk
                            .get("id")
                            .unwrap_or(&serde_json::json!(""))
                            .clone();
                        let model = json_chunk
                            .get("model")
                            .unwrap_or(&serde_json::json!(""))
                            .clone();

                        let start_event = serde_json::json!({
                            "type": "message_start",
                            "message": {
                                "id": message_id,
                                "type": "message",
                                "role": role,
                                "content": [],
                                "model": model,
                                "stop_reason": serde_json::Value::Null,
                                "stop_sequence": serde_json::Value::Null,
                                "usage": { "input_tokens": 0, "output_tokens": 0 }
                            }
                        });
                        if sender.send_data(sse_event(&start_event)).await.is_err() {
                            return;
                        }
                        is_first = false;
                    }

                    // Handle text content
                    if let Some(text) =
                        delta
                            .get("content")
                            .and_then(|c| if c.is_null() { None } else { c.as_str() })
                    {
                        if !text.is_empty() {
                            // Open text block if needed
                            if text_block_index.is_none() {
                                let idx = next_block_index;
                                next_block_index += 1;
                                text_block_index = Some(idx);

                                let block_start = serde_json::json!({
                                    "type": "content_block_start",
                                    "index": idx,
                                    "content_block": { "type": "text", "text": "" }
                                });
                                if sender.send_data(sse_event(&block_start)).await.is_err() {
                                    return;
                                }
                            }

                            accumulated_content.push_str(text);
                            let delta_event = serde_json::json!({
                                "type": "content_block_delta",
                                "index": text_block_index.unwrap(),
                                "delta": { "type": "text_delta", "text": text }
                            });
                            if sender.send_data(sse_event(&delta_event)).await.is_err() {
                                return;
                            }
                        }
                    }

                    // Handle tool calls
                    if let Some(tool_calls) = delta.get("tool_calls").and_then(|tc| tc.as_array()) {
                        // Close text block before tool blocks
                        if let Some(idx) = text_block_index.take() {
                            let stop = serde_json::json!(
                                {"type": "content_block_stop", "index": idx}
                            );
                            if sender.send_data(sse_event(&stop)).await.is_err() {
                                return;
                            }
                        }

                        for tc in tool_calls {
                            let tc_index =
                                tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;

                            // New tool call (has id + function.name)
                            if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                                let name = tc
                                    .get("function")
                                    .and_then(|f| f.get("name"))
                                    .and_then(|n| n.as_str())
                                    .unwrap_or("");

                                let idx = next_block_index;
                                next_block_index += 1;
                                tool_blocks.insert(tc_index, idx);

                                let block_start = serde_json::json!({
                                    "type": "content_block_start",
                                    "index": idx,
                                    "content_block": {
                                        "type": "tool_use",
                                        "id": id,
                                        "name": name,
                                        "input": {}
                                    }
                                });
                                if sender.send_data(sse_event(&block_start)).await.is_err() {
                                    return;
                                }
                            }

                            // Argument delta
                            if let Some(args) = tc
                                .get("function")
                                .and_then(|f| f.get("arguments"))
                                .and_then(|a| a.as_str())
                            {
                                if !args.is_empty() {
                                    if let Some(&idx) = tool_blocks.get(&tc_index) {
                                        let delta_event = serde_json::json!({
                                            "type": "content_block_delta",
                                            "index": idx,
                                            "delta": {
                                                "type": "input_json_delta",
                                                "partial_json": args
                                            }
                                        });
                                        if sender.send_data(sse_event(&delta_event)).await.is_err()
                                        {
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Handle finish
                    if has_finish {
                        // Close text block
                        if let Some(idx) = text_block_index.take() {
                            let stop = serde_json::json!(
                                {"type": "content_block_stop", "index": idx}
                            );
                            if sender.send_data(sse_event(&stop)).await.is_err() {
                                return;
                            }
                        }
                        // Close all tool blocks
                        let mut tool_indices: Vec<usize> = tool_blocks.values().copied().collect();
                        tool_indices.sort();
                        for idx in tool_indices {
                            let stop = serde_json::json!(
                                {"type": "content_block_stop", "index": idx}
                            );
                            if sender.send_data(sse_event(&stop)).await.is_err() {
                                return;
                            }
                        }

                        let reason = finish_reason
                            .and_then(|fr| fr.as_str())
                            .unwrap_or("end_turn");
                        let stop_reason = match reason {
                            "stop" => "end_turn",
                            "length" => "max_tokens",
                            "tool_calls" => "tool_use",
                            _ => reason,
                        };
                        let output_tokens = accumulated_content.split_whitespace().count() as u64;

                        let delta_event = serde_json::json!({
                            "type": "message_delta",
                            "delta": {
                                "stop_reason": stop_reason,
                                "stop_sequence": serde_json::Value::Null
                            },
                            "usage": { "output_tokens": output_tokens }
                        });
                        if sender.send_data(sse_event(&delta_event)).await.is_err() {
                            return;
                        }

                        let final_stop = serde_json::json!({"type": "message_stop"});
                        if sender.send_data(sse_event(&final_stop)).await.is_err() {
                            return;
                        }
                        return;
                    }
                }
            }
            Err(e) => {
                log::error!("Stream error: {e}");
                break;
            }
        }
    }
    log::debug!("Streaming complete (Anthropic format)");
}

/// Forward non-streaming OpenAI response as Anthropic /messages response
async fn forward_non_streaming(
    response_body: Result<Bytes, reqwest::Error>,
    mut sender: hyper::body::Sender,
    destination_path: &str,
) {
    let bytes = match response_body {
        Ok(bytes) => bytes,
        Err(e) => {
            log::error!("Failed to get response body: {e}");
            return;
        }
    };

    if let Ok(json_response) = serde_json::from_slice::<serde_json::Value>(&bytes) {
        if destination_path == "/messages" {
            // Transform to Anthropic format
            let anthropic_response = transform_openai_response_to_anthropic(&json_response);
            if sender
                .send_data(Bytes::from(anthropic_response.to_string()))
                .await
                .is_err()
            {
                log::debug!("Client disconnected");
            }
        } else {
            // Pass through as-is
            if sender.send_data(bytes).await.is_err() {
                log::debug!("Client disconnected");
            }
        }
    } else {
        // Pass through raw response
        if sender.send_data(bytes).await.is_err() {
            log::debug!("Client disconnected");
        }
    }
}
