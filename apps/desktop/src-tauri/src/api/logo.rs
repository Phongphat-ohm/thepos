use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::Client;
use std::{fs, path::PathBuf, time::Duration};

const MAX_LOGO_BYTES: usize = 1024 * 1024;

fn candidate_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.to_path_buf());
        }
    }
    if cfg!(debug_assertions) {
        if let Ok(mut dir) = std::env::current_dir() {
            for _ in 0..4 {
                dirs.push(dir.clone());
                if !dir.pop() {
                    break;
                }
            }
        }
    }
    dirs
}

fn is_valid_image_bytes(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "image/png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/webp" => bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

pub fn read_local_logo_png() -> Option<Vec<u8>> {
    for dir in candidate_dirs() {
        let path = dir.join("logo.png");
        if let Ok(bytes) = fs::read(&path) {
            if !bytes.is_empty() && bytes.len() <= MAX_LOGO_BYTES && is_valid_image_bytes("image/png", &bytes) {
                return Some(bytes);
            }
        }
    }
    None
}

pub async fn read_brand_logo(client: &Client, server_url: Option<String>) -> Option<String> {
    const CANDIDATES: [(&str, &str); 4] = [
        ("logo.png", "image/png"),
        ("logo.webp", "image/webp"),
        ("logo.jpg", "image/jpeg"),
        ("logo.jpeg", "image/jpeg"),
    ];

    for dir in candidate_dirs() {
        for (name, mime) in CANDIDATES {
            let path = dir.join(name);
            if let Ok(bytes) = fs::read(&path) {
                if !bytes.is_empty() && bytes.len() <= MAX_LOGO_BYTES && is_valid_image_bytes(mime, &bytes) {
                    return Some(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)));
                }
            }
        }
    }

    if let Some(url) = server_url {
        if let Ok(mut resp) = client
            .get(format!("{}/brand-logo", url.trim_end_matches('/')))
            .timeout(Duration::from_millis(1500))
            .send()
            .await
        {
            if resp.status().is_success() {
                if resp
                    .content_length()
                    .is_some_and(|len| len > MAX_LOGO_BYTES as u64)
                {
                    return None;
                }
                let raw_mime = resp
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.split(';').next())
                    .map(str::trim)
                    .unwrap_or("image/png");
                let mime = match raw_mime {
                    "image/png" | "image/jpeg" | "image/webp" => raw_mime.to_owned(),
                    _ => return None,
                };
                let mut bytes = Vec::new();
                while let Ok(Some(chunk)) = resp.chunk().await {
                    if bytes.len().saturating_add(chunk.len()) > MAX_LOGO_BYTES {
                        return None;
                    }
                    bytes.extend_from_slice(&chunk);
                }
                if !bytes.is_empty() && is_valid_image_bytes(&mime, &bytes) {
                    return Some(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)));
                }
            }
        }
    }
    None
}
