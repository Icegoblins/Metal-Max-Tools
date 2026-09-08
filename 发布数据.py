#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""将 dist/music/ 打成 music.zip，并可选创建 GitHub Release。

用法:
    python 发布数据.py                  # 仅打 zip 到 release-assets/music.zip
    python 发布数据.py --release        # 打 zip 后 gh release create（需已安装 gh）
    python 发布数据.py --tag data-2026.09.08

打 zip 后请运行 生成数据清单.py 更新 manifest 中的 music.zip hash。
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
MUSIC = DIST / "music"
OUT_DIR = ROOT / "release-assets"
ZIP_PATH = OUT_DIR / "music.zip"
CONFIG_PATH = DIST / "data-remote.json"


def pack_music_zip() -> Path:
    if not MUSIC.is_dir():
        raise SystemExit(f"未找到音乐目录: {MUSIC}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    count = 0
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(MUSIC.rglob("*")):
            if not path.is_file():
                continue
            if path.name == "song_groups.json":
                continue
            rel = path.relative_to(MUSIC).as_posix()
            zf.write(path, rel)
            count += 1
    print(f"已打包 {ZIP_PATH} （{count} 个文件, {ZIP_PATH.stat().st_size / 1024 / 1024:.1f} MB）")
    return ZIP_PATH


def update_config_tag(tag: str) -> None:
    cfg: dict = {}
    if CONFIG_PATH.is_file():
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    release = cfg.setdefault("release", {})
    release["tag"] = tag
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent="\t") + "\n", encoding="utf-8")
    print(f"已更新 {CONFIG_PATH} release.tag = {tag}")


def gh_release(tag: str, zip_path: Path) -> None:
    notes = f"METAL MAX 工具箱数据包 music.zip ({tag})"
    cmd = [
        "gh", "release", "create", tag,
        str(zip_path),
        "--title", f"数据 {tag}",
        "--notes", notes,
    ]
    print("执行:", " ".join(cmd))
    subprocess.run(cmd, check=True, cwd=ROOT)


def main() -> None:
    parser = argparse.ArgumentParser(description="打包并发布 music.zip")
    parser.add_argument("--tag", help="Release tag，默认 data-YYYY.MM.DD")
    parser.add_argument("--release", action="store_true", help="调用 gh release create 上传")
    args = parser.parse_args()

    tag = args.tag or f"data-{date.today().strftime('%Y.%m.%d')}"
    zip_path = pack_music_zip()
    update_config_tag(tag)

    if args.release:
        gh_release(tag, zip_path)
        print("Release 已创建。请运行: python 生成数据清单.py && git push")
    else:
        print("下一步: python 生成数据清单.py")
        print("上传 Release: python 发布数据.py --release --tag", tag)


if __name__ == "__main__":
    main()
