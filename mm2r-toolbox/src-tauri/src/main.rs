#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// METAL MAX 工具箱：用户标记持久化 + 远程数据同步 + 托盘常驻

mod data_sync;
mod paths;
mod static_server;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::fs;
use std::path::Path;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State, WindowEvent,
};

use data_sync::{get_sync_status, spawn_auto_sync, sync_data_now, SyncResult, SyncState, SyncStatus};
use paths::{resource_dir, sanitize_rel, user_data_file};

fn mime_of(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/png",
    }
}

fn decode_image_payload(data: &str) -> Result<Vec<u8>, String> {
    let b64 = if let Some(i) = data.find("base64,") {
        &data[i + 7..]
    } else {
        data
    };
    STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("图片解码失败: {}", e))
}

#[tauri::command]
fn load_data(name: String) -> String {
    let path = user_data_file(&name);
    match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => String::new(),
    }
}

#[tauri::command]
fn save_data(name: String, data: String) -> Result<String, String> {
    let path = user_data_file(&name);
    fs::write(&path, data).map_err(|e| format!("写入失败: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn save_resource_file(rel_path: String, data: String) -> Result<String, String> {
    let rel = sanitize_rel(&rel_path)?;
    let path = resource_dir().join(&rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let bytes = decode_image_payload(&data)?;
    fs::write(&path, bytes).map_err(|e| format!("写入失败: {}", e))?;
    let stored = Path::new("资源").join(&rel);
    Ok(stored.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
fn load_resource_file(rel_path: String) -> Result<String, String> {
    let rel = sanitize_rel(&rel_path)?;
    let path = resource_dir().join(&rel);
    let bytes = fs::read(&path).map_err(|e| format!("读取失败: {}", e))?;
    Ok(format!(
        "data:{};base64,{}",
        mime_of(&path),
        STANDARD.encode(bytes)
    ))
}

#[tauri::command]
fn sync_data_now_cmd(app: tauri::AppHandle, state: State<SyncState>) -> Result<SyncResult, String> {
    sync_data_now(app, state.inner())
}

#[tauri::command]
fn get_sync_status_cmd(app: tauri::AppHandle, state: State<SyncState>) -> Result<SyncStatus, String> {
    Ok(get_sync_status(state.inner(), &app))
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .manage(SyncState::default())
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            save_resource_file,
            load_resource_file,
            sync_data_now_cmd,
            get_sync_status_cmd
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            let _port = static_server::start(app.handle().clone());
            #[cfg(not(debug_assertions))]
            static_server::navigate_main_window(app.handle(), _port);

            spawn_auto_sync(app.handle().clone());

            let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("METAL MAX 工具箱")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
