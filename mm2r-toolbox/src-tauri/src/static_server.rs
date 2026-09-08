//! 本地 loopback 静态服务：数据缓存优先，否则 dist 目录 / Tauri 内嵌资源。

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use std::thread;

use tauri::{AppHandle, Manager};
use tiny_http::{Header, Response, Server};

use crate::paths::cache_dir;

const DEFAULT_PORT: u16 = 18765;

/// 开发时 dist 目录（编译期路径，release 若源码仍在则也可用）
fn dist_fallback_dir() -> Option<PathBuf> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../dist");
        p.canonicalize().ok().filter(|d| d.is_dir())
    })
    .clone()
}

pub fn start(app: AppHandle) -> u16 {
    let port = DEFAULT_PORT;
    let cache = cache_dir();
    thread::spawn(move || {
        let addr = format!("127.0.0.1:{}", port);
        let server = match Server::http(&addr) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[static_server] 无法监听 {}: {}", addr, e);
                return;
            }
        };
        eprintln!("[static_server] 监听 {}", addr);
        for request in server.incoming_requests() {
            let app = app.clone();
            let cache = cache.clone();
            if let Err(e) = handle_request(request, &cache, &app) {
                eprintln!("[static_server] {}", e);
            }
        }
    });
    // 给服务线程一点时间完成 bind
    thread::sleep(std::time::Duration::from_millis(50));
    port
}

fn decode_url_path(raw: &str) -> String {
    let decoded = urlencoding::decode(raw).unwrap_or_else(|_| raw.into());
    decoded.replace('\\', "/")
}

fn handle_request(
    request: tiny_http::Request,
    cache: &Path,
    app: &AppHandle,
) -> Result<(), String> {
    let url_path = request.url().split('?').next().unwrap_or("/");
    let rel = url_path.trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    let rel = decode_url_path(rel);

    if rel.contains("..") {
        let _ = request.respond(Response::from_string("Forbidden").with_status_code(403));
        return Ok(());
    }

    let rel_path = Path::new(&rel);
    if !is_safe_rel(rel_path) {
        let _ = request.respond(Response::from_string("Forbidden").with_status_code(403));
        return Ok(());
    }

    let cache_file = cache.join(rel_path);
    let (bytes, mime) = if cache_file.is_file() {
        let data = fs::read(&cache_file).map_err(|e| e.to_string())?;
        (data, mime_of(rel_path))
    } else if let Some(dist) = dist_fallback_dir() {
        let disk = dist.join(rel_path);
        if disk.is_file() {
            let data = fs::read(&disk).map_err(|e| e.to_string())?;
            (data, mime_of(rel_path))
        } else if let Some(asset) = app.asset_resolver().get(rel.clone()) {
            (asset.bytes, mime_of(rel_path))
        } else {
            eprintln!("[static_server] 404 {}", rel);
            let _ = request.respond(Response::from_string("Not Found").with_status_code(404));
            return Ok(());
        }
    } else if let Some(asset) = app.asset_resolver().get(rel.clone()) {
        (asset.bytes, mime_of(rel_path))
    } else {
        eprintln!("[static_server] 404 {}", rel);
        let _ = request.respond(Response::from_string("Not Found").with_status_code(404));
        return Ok(());
    };

    let mut response = Response::from_data(bytes);
    if let Ok(h) = Header::from_bytes(&b"Content-Type"[..], mime.as_bytes()) {
        response = response.with_header(h);
    }
    if let Ok(h) = Header::from_bytes(&b"Cache-Control"[..], b"no-cache") {
        response = response.with_header(h);
    }
    request.respond(response).map_err(|e| e.to_string())?;
    Ok(())
}

fn is_safe_rel(path: &Path) -> bool {
    for c in path.components() {
        match c {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return false,
            _ => {}
        }
    }
    true
}

fn mime_of(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "bin" => "application/octet-stream",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

pub fn navigate_main_window(app: &AppHandle, port: u16) {
    if let Some(win) = app.get_webview_window("main") {
        let url = format!("http://127.0.0.1:{}/index.html", port);
        if let Ok(parsed) = url.parse() {
            let _ = win.navigate(parsed);
        }
    }
}
