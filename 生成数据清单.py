#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""扫描 dist/ 中需远程同步的资源，生成 manifest.json（供桌面端增量更新）。

用法（项目根目录）:
    python 生成数据清单.py
    python 生成数据清单.py --pages-base https://user.github.io/repo/

输出: dist/manifest.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
MANIFEST_PATH = DIST / "manifest.json"
CONFIG_PATH = DIST / "data-remote.json"

# 纳入 manifest 的相对路径前缀（相对于 dist/）
INCLUDE_PREFIXES = (
    "config.json",
    "data/",
    "img/",
    "audio/",
    "fonts/",
)

# 排除（构建期配置 / 由 Release 单独分发）
EXCLUDE_REL = {
    "music/song_groups.json",
}

SKIP_NAMES = {".gitkeep", "README.md", "manifest.json", "data-remote.json"}


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def should_include(rel: str) -> bool:
    rel = rel.replace("\\", "/")
    if rel in EXCLUDE_REL:
        return False
    name = Path(rel).name
    if name in SKIP_NAMES:
        return False
    if rel.startswith("music/"):
        return False
    return any(rel == p or rel.startswith(p) for p in INCLUDE_PREFIXES)


def collect_files() -> dict[str, dict]:
    files: dict[str, dict] = {}
    for dirpath, _, filenames in os.walk(DIST):
        for name in filenames:
            full = Path(dirpath) / name
            rel = full.relative_to(DIST).as_posix()
            if not should_include(rel):
                continue
            files[rel] = {
                "sha256": file_sha256(full),
                "size": full.stat().st_size,
            }
    return files


def load_pages_base(cli_base: str | None) -> str:
    if cli_base:
        return cli_base.rstrip("/") + "/"
    if CONFIG_PATH.is_file():
        try:
            cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            base = (cfg.get("pagesBase") or "").strip()
            if base:
                return base.rstrip("/") + "/"
        except json.JSONDecodeError:
            pass
    return "https://YOUR_USER.github.io/YOUR_REPO/"


def load_release_info() -> dict | None:
    if not CONFIG_PATH.is_file():
        return None
    try:
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    release = cfg.get("release")
    if not isinstance(release, dict):
        return None
    tag = release.get("tag")
    if not tag:
        return None
    repo = (cfg.get("githubRepo") or "YOUR_USER/YOUR_REPO").strip()
    music_zip = DIST / "music" 
    asset: dict = {
        "url": f"https://github.com/{repo}/releases/download/{tag}/music.zip",
        "encrypted": False,
    }
    # 若本地已有打包好的 music.zip（发布脚本生成），写入 hash
    zip_path = ROOT / "release-assets" / "music.zip"
    if zip_path.is_file():
        asset["sha256"] = file_sha256(zip_path)
        asset["size"] = zip_path.stat().st_size
    return {"tag": tag, "assets": {"music.zip": asset}}


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 dist/manifest.json")
    parser.add_argument("--pages-base", help="GitHub Pages 根 URL")
    parser.add_argument("--version", help="数据版本号，默认今天 YYYY.MM.DD")
    args = parser.parse_args()

    if not DIST.is_dir():
        raise SystemExit(f"未找到 dist 目录: {DIST}")

    version = args.version or date.today().strftime("%Y.%m.%d")
    manifest = {
        "version": version,
        "pagesBase": load_pages_base(args.pages_base),
        "files": collect_files(),
    }
    release = load_release_info()
    if release:
        manifest["release"] = release

    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent="\t") + "\n",
        encoding="utf-8",
    )
    print(f"已写入 {MANIFEST_PATH}  （{len(manifest['files'])} 个文件, version={version}）")


if __name__ == "__main__":
    main()
