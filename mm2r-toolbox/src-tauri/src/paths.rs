use std::fs;
use std::path::{Path, PathBuf};

pub fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .expect("无法定位程序")
        .parent()
        .expect("无法定位程序目录")
        .to_path_buf()
}

pub fn user_data_dir() -> PathBuf {
    let dir = exe_dir().join("用户数据");
    fs::create_dir_all(&dir).expect("无法创建用户数据目录");
    dir
}

pub fn cache_dir() -> PathBuf {
    let dir = exe_dir().join("数据缓存");
    fs::create_dir_all(&dir).ok();
    dir
}

pub fn resource_dir() -> PathBuf {
    let dir = exe_dir().join("资源");
    fs::create_dir_all(&dir).expect("无法创建资源目录");
    dir
}

pub fn user_data_file(name: &str) -> PathBuf {
    user_data_dir().join(name)
}

pub fn cache_file(rel: &str) -> PathBuf {
    cache_dir().join(rel.replace('/', std::path::MAIN_SEPARATOR_STR))
}

pub fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    Ok(())
}

pub fn sanitize_rel(rel: &str) -> Result<PathBuf, String> {
    let rel = rel.replace('\\', "/");
    if rel.is_empty() || rel.contains("..") {
        return Err("非法路径".into());
    }
    let mut out = PathBuf::new();
    for part in rel.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains(':') {
            return Err("非法路径".into());
        }
        out.push(part);
    }
    if out.as_os_str().is_empty() {
        return Err("非法路径".into());
    }
    Ok(out)
}
