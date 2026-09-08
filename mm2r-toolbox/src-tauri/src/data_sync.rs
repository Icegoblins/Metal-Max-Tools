//! 从 GitHub Pages / Releases 拉取游戏数据到本地缓存。

use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use zip::read::ZipArchive;

use crate::paths::{cache_dir, cache_file, ensure_parent};

const LOCAL_MANIFEST: &str = "manifest.local.json";
const REMOTE_CONFIG_ASSET: &str = "data-remote.json";

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct SyncStatus {
    pub enabled: bool,
    pub phase: String,
    pub message: String,
    pub percent: f64,
    #[serde(rename = "localVersion")]
    pub local_version: Option<String>,
    #[serde(rename = "remoteVersion")]
    pub remote_version: Option<String>,
    #[serde(rename = "lastSyncAt")]
    pub last_sync_at: Option<u64>,
    #[serde(rename = "lastError")]
    pub last_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub skipped: bool,
    pub up_to_date: bool,
    pub downloaded: u32,
    pub version: Option<String>,
    pub message: Option<String>,
    pub reload_suggested: bool,
}

#[derive(Deserialize)]
struct RemoteConfig {
    enabled: Option<bool>,
    #[serde(rename = "pagesBase")]
    pages_base: Option<String>,
    release: Option<ReleaseBlock>,
}

#[derive(Deserialize)]
struct ReleaseBlock {
    tag: Option<String>,
    assets: Option<std::collections::HashMap<String, ReleaseAsset>>,
}

#[derive(Deserialize, Clone, Serialize)]
struct ReleaseAsset {
    url: String,
    sha256: Option<String>,
    size: Option<u64>,
}

#[derive(Deserialize, Serialize, Clone)]
struct Manifest {
    version: String,
    #[serde(rename = "pagesBase")]
    pages_base: String,
    files: std::collections::HashMap<String, FileEntry>,
    release: Option<ManifestRelease>,
}

#[derive(Deserialize, Serialize, Clone)]
struct ManifestRelease {
    tag: String,
    assets: std::collections::HashMap<String, ReleaseAsset>,
}

#[derive(Deserialize, Serialize, Clone)]
struct FileEntry {
    sha256: String,
    size: u64,
}

pub struct SyncState(pub Mutex<SyncStatus>);

impl Default for SyncState {
    fn default() -> Self {
        SyncState(Mutex::new(SyncStatus {
            enabled: false,
            phase: "idle".into(),
            message: "就绪".into(),
            ..Default::default()
        }))
    }
}

fn now_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn sha256_bytes(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    format!("{:x}", h.finalize())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 1024 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

fn load_remote_config(app: &AppHandle) -> RemoteConfig {
    if let Some(asset) = app.asset_resolver().get(REMOTE_CONFIG_ASSET.to_string()) {
        if let Ok(cfg) = serde_json::from_slice::<RemoteConfig>(&asset.bytes) {
            return cfg;
        }
    }
    let cache_cfg = cache_file(REMOTE_CONFIG_ASSET);
    if cache_cfg.is_file() {
        if let Ok(text) = fs::read_to_string(&cache_cfg) {
            if let Ok(cfg) = serde_json::from_str::<RemoteConfig>(&text) {
                return cfg;
            }
        }
    }
    RemoteConfig {
        enabled: Some(false),
        pages_base: None,
        release: None,
    }
}

fn pages_base(cfg: &RemoteConfig) -> Option<String> {
    let base = cfg.pages_base.as_deref().unwrap_or("").trim();
    if base.is_empty() || base.contains("YOUR_USER") {
        return None;
    }
    let mut s = base.to_string();
    if !s.ends_with('/') {
        s.push('/');
    }
    Some(s)
}

fn emit_progress(app: &AppHandle, state: &SyncState, phase: &str, percent: f64, message: &str, detail: &str) {
    {
        let mut st = state.0.lock().expect("sync state");
        st.phase = phase.to_string();
        st.percent = percent;
        st.message = message.to_string();
    }
    let _ = app.emit(
        "data-sync-progress",
        serde_json::json!({
            "phase": phase,
            "percent": percent,
            "message": message,
            "detail": detail,
        }),
    );
}

fn fetch_text(client: &Client, url: &str) -> Result<String, String> {
    client
        .get(url)
        .send()
        .map_err(|e| format!("网络请求失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("HTTP 错误: {}", e))?
        .text()
        .map_err(|e| e.to_string())
}

fn fetch_bytes(client: &Client, url: &str) -> Result<Vec<u8>, String> {
    client
        .get(url)
        .send()
        .map_err(|e| format!("下载失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("HTTP 错误: {}", e))?
        .bytes()
        .map(|b| b.to_vec())
        .map_err(|e| e.to_string())
}

fn load_local_manifest() -> Option<Manifest> {
    let path = cache_file(LOCAL_MANIFEST);
    if !path.is_file() {
        return None;
    }
    let text = fs::read_to_string(&path).map_err(|_| ()).ok()?;
    serde_json::from_str(&text).ok()
}

fn save_local_manifest(m: &Manifest) -> Result<(), String> {
    let path = cache_file(LOCAL_MANIFEST);
    ensure_parent(&path)?;
    let text = serde_json::to_string_pretty(m).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    ensure_parent(path)?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn extract_music_zip(bytes: &[u8], dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|e| format!("zip 解析失败: {}", e))?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().replace('\\', "/");
        if name.contains("..") {
            continue;
        }
        let out = dest.join(name);
        if file.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        } else {
            ensure_parent(&out)?;
            let mut buf = Vec::new();
            file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            write_atomic(&out, &buf)?;
        }
    }
    Ok(())
}

pub fn sync_data_now(app: AppHandle, state: &SyncState) -> Result<SyncResult, String> {
    let cfg = load_remote_config(&app);
    let enabled = cfg.enabled.unwrap_or(false);
    {
        let mut st = state.0.lock().expect("sync state");
        st.enabled = enabled;
    }
    if !enabled {
        return Ok(SyncResult {
            skipped: true,
            up_to_date: true,
            downloaded: 0,
            version: None,
            message: Some("请在 dist/data-remote.json 中设置 enabled 与 pagesBase".into()),
            reload_suggested: false,
        });
    }

    let base = pages_base(&cfg).ok_or_else(|| {
        "未配置有效的 pagesBase（dist/data-remote.json）".to_string()
    })?;

    emit_progress(&app, state, "manifest", 2.0, "拉取 manifest…", "");
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let manifest_url = format!("{}manifest.json", base);
    let remote_text = fetch_text(&client, &manifest_url)?;
    let remote: Manifest = serde_json::from_str(&remote_text)
        .map_err(|e| format!("manifest 解析失败: {}", e))?;

    let _local = load_local_manifest();
    let mut to_fetch: Vec<(String, FileEntry)> = Vec::new();

    for (rel, entry) in &remote.files {
        let cache_path = cache_file(rel);
        let need = if cache_path.is_file() {
            match sha256_file(&cache_path) {
                Ok(h) => h != entry.sha256,
                Err(_) => true,
            }
        } else {
            true
        };
        if need {
            to_fetch.push((rel.clone(), entry.clone()));
        }
    }

    let total_steps = to_fetch.len() as f64 + if remote.release.is_some() { 1.0 } else { 0.0 };
    let mut done = 0u32;

    for (rel, entry) in to_fetch {
        let url = format!("{}{}", base, rel.replace('\\', "/"));
        emit_progress(
            &app,
            state,
            "download",
            5.0 + (done as f64 / total_steps.max(1.0)) * 85.0,
            &format!("下载 {}", rel),
            &url,
        );
        let bytes = fetch_bytes(&client, &url)?;
        if sha256_bytes(&bytes) != entry.sha256 {
            return Err(format!("校验失败: {}", rel));
        }
        let out = cache_file(&rel);
        write_atomic(&out, &bytes)?;
        done += 1;
    }

    // music.zip
    if let Some(rel) = remote.release.as_ref() {
        if let Some(asset) = rel.assets.get("music.zip") {
            let music_marker = cache_dir().join(".music.zip.sha256");
            let prev = fs::read_to_string(&music_marker).ok();
            let need_music = asset.sha256.as_ref().map(|h| prev.as_deref() != Some(h)).unwrap_or(true);
            if need_music {
                emit_progress(&app, state, "music", 92.0, "下载 music.zip…", &asset.url);
                let bytes = fetch_bytes(&client, &asset.url)?;
                if let Some(expected) = &asset.sha256 {
                    if sha256_bytes(&bytes) != *expected {
                        return Err("music.zip 校验失败".into());
                    }
                }
                let music_dir = cache_dir().join("music");
                extract_music_zip(&bytes, &music_dir)?;
                if let Some(h) = &asset.sha256 {
                    fs::write(&music_marker, h).map_err(|e| e.to_string())?;
                }
                done += 1;
            }
        }
    }

    save_local_manifest(&remote)?;

    {
        let mut st = state.0.lock().expect("sync state");
        st.phase = "idle".into();
        st.percent = 100.0;
        st.message = "同步完成".into();
        st.local_version = Some(remote.version.clone());
        st.remote_version = Some(remote.version.clone());
        st.last_sync_at = Some(now_ts());
        st.last_error = None;
    }

    emit_progress(&app, state, "done", 100.0, "同步完成", &remote.version);

    let up_to_date = done == 0;
    Ok(SyncResult {
        skipped: false,
        up_to_date,
        downloaded: done,
        version: Some(remote.version.clone()),
        message: None,
        reload_suggested: !up_to_date,
    })
}

pub fn get_sync_status(state: &SyncState, app: &AppHandle) -> SyncStatus {
    let cfg = load_remote_config(app);
    let mut st = state.0.lock().expect("sync state").clone();
    st.enabled = cfg.enabled.unwrap_or(false);
    if st.local_version.is_none() {
        if let Some(m) = load_local_manifest() {
            st.local_version = Some(m.version);
        }
    }
    st
}

pub fn spawn_auto_sync(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let cfg = load_remote_config(&app);
        if !cfg.enabled.unwrap_or(false) {
            return;
        }
        let state = app.state::<SyncState>();
        if let Err(e) = sync_data_now(app.clone(), state.inner()) {
            eprintln!("[data_sync] auto sync failed: {}", e);
            if let Ok(mut st) = state.inner().0.lock() {
                st.last_error = Some(e);
                st.phase = "error".into();
            }
        }
    });
}
