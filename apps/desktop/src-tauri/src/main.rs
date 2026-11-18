#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod printing;
mod vault;

use api::{Api, Command};
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
async fn open_web(state: State<'_, Api>) -> Result<(), String> {
    if !state.has_access().await {
        return Err("SESSION_LOCKED".into());
    }
    let url = state.current_url().await?;
    open_url(&url)
}

#[tauri::command]
async fn brand_logo(state: State<'_, Api>) -> Result<Option<String>, String> {
    Ok(state.read_brand_logo().await)
}

#[cfg(target_os = "windows")]
fn open_url(url: &str) -> Result<(), String> {
    use std::ffi::c_void;
    use std::ptr::null;

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show_cmd: i32,
        ) -> isize;
    }

    let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
    let op = wide("open");
    let target = wide(url);
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), op.as_ptr(), target.as_ptr(), null(), null(), 1) };
    if result <= 32 {
        return Err("NETWORK_ERROR".into());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn open_url(_url: &str) -> Result<(), String> {
    Err("UNAVAILABLE".into())
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
            open_web,
            brand_logo
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run the desktop application");
}
