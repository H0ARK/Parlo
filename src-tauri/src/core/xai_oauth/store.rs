use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const TOKEN_FILE_NAME: &str = "xai_oauth_tokens.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredXaiTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

impl StoredXaiTokens {
    pub fn is_expiring_soon(&self, skew_ms: i64) -> bool {
        self.expires_at <= chrono::Utc::now().timestamp_millis() + skew_ms
    }
}

pub fn token_file_path(data_folder: &Path) -> PathBuf {
    data_folder.join(TOKEN_FILE_NAME)
}

/// Legacy Jan data folder (pre-Parlo rebrand) that may still hold SSO tokens.
fn legacy_jan_token_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(home) = dirs::home_dir() {
        // macOS / Linux app-support layout
        paths.push(
            home.join("Library/Application Support/Jan/data")
                .join(TOKEN_FILE_NAME),
        );
        paths.push(home.join(".config/Jan/data").join(TOKEN_FILE_NAME));
        paths.push(home.join(".local/share/Jan/data").join(TOKEN_FILE_NAME));
    }
    // Windows: %APPDATA%\Jan\data
    if let Ok(appdata) = std::env::var("APPDATA") {
        paths.push(PathBuf::from(appdata).join("Jan").join("data").join(TOKEN_FILE_NAME));
    }
    paths
}

fn read_tokens_file(path: &Path) -> Result<Option<StoredXaiTokens>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let raw = std::fs::read_to_string(path)
        .map_err(|err| format!("Failed to read xAI OAuth tokens: {err}"))?;
    if raw.trim().is_empty() {
        return Ok(None);
    }

    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|err| format!("Failed to parse xAI OAuth tokens: {err}"))
}

pub fn load_tokens(data_folder: &Path) -> Result<Option<StoredXaiTokens>, String> {
    let path = token_file_path(data_folder);
    if let Some(tokens) = read_tokens_file(&path)? {
        return Ok(Some(tokens));
    }

    // Migrate SSO tokens from legacy Jan data folder into Parlo data folder.
    for legacy in legacy_jan_token_paths() {
        if let Some(tokens) = read_tokens_file(&legacy)? {
            log::info!(
                "Migrating xAI OAuth tokens from legacy path {} → {}",
                legacy.display(),
                path.display()
            );
            // Best-effort copy into Parlo data so subsequent reads hit the new path.
            let _ = save_tokens(data_folder, &tokens);
            return Ok(Some(tokens));
        }
    }

    Ok(None)
}

pub fn save_tokens(data_folder: &Path, tokens: &StoredXaiTokens) -> Result<(), String> {
    let path = token_file_path(data_folder);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create xAI OAuth token directory: {err}"))?;
    }

    let raw = serde_json::to_string_pretty(tokens)
        .map_err(|err| format!("Failed to serialize xAI OAuth tokens: {err}"))?;
    std::fs::write(&path, raw)
        .map_err(|err| format!("Failed to write xAI OAuth tokens: {err}"))
}

pub fn clear_tokens(data_folder: &Path) -> Result<(), String> {
    let path = token_file_path(data_folder);
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|err| format!("Failed to remove xAI OAuth tokens: {err}"))?;
    }
    Ok(())
}