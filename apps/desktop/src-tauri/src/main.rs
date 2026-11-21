#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod hardware;
mod security;

use api::{Api, Command};
use hardware::printing;
use serde_json::Value;
use tauri::{Manager, State};

#[tauri::command]
async fn pos_request(state: State<'_, Api>, command: Command) -> Result<Value, String> {
    state.execute(command).await
}

#[tauri::command]
async fn receipt_printers(state: State<'_, Api>) -> Result<Vec<String>, String> {
    if !state.has_access().await {
        return Err("SESSION_LOCKED".into());
    }
    tauri::async_runtime::spawn_blocking(printing::printers)
        .await
        .map_err(|_| "PRINT_FAILED")?
        .map_err(str::to_owned)
}

#[tauri::command]
async fn print_receipt(
    state: State<'_, Api>,
    job: printing::PrintJob,
) -> Result<(), String> {
    if !state.has_access().await {
        return Err("SESSION_LOCKED".into());
    }
    tauri::async_runtime::spawn_blocking(move || job.print())
        .await
        .map_err(|_| "PRINT_FAILED")?
        .map_err(str::to_owned)
}

#[tauri::command]
async fn brand_logo(state: State<'_, Api>) -> Result<Option<String>, String> {
    Ok(state.read_brand_logo().await)
}

#[tauri::command]
fn is_fullscreen(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_fullscreen(window: tauri::WebviewWindow, fullscreen: bool) -> Result<bool, String> {
    window.set_fullscreen(fullscreen).map_err(|e| e.to_string())?;
    window.is_fullscreen().map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let path = app.path().app_config_dir()?.join("server-url");
            app.manage(Api::new(path)?);
            if let Some(bytes) = Api::read_local_logo_png() {
                if let (Some(window), Ok(icon)) = (
                    app.get_webview_window("main"),
                    tauri::image::Image::from_bytes(&bytes),
                ) {
                    let _ = window.set_icon(icon);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pos_request,
            receipt_printers,
            print_receipt,
            brand_logo,
            is_fullscreen,
            set_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run the desktop application");
}
