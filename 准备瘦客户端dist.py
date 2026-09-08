#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 dist-shell/（Tauri frontendDist 打包目录）。

  python 准备瘦客户端dist.py          # 瘦客户端：仅 UI，数据走 GitHub → 数据缓存/
  python 准备瘦客户端dist.py --full   # 完整包：等同整个 dist/（离线出厂数据）
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "dist"
OUT = ROOT / "dist-shell"

ROOT_FILES = (
    "index.html",
    "map.html",
    "app.html",
    "style.css",
    "config.json",
    "data-remote.json",
    "LOGO.png",
    "LOGO_1.png",
    "LOGO_2.png",
)
COPY_DIRS = ("js", "fonts", "audio")


def thin() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    for name in ROOT_FILES:
        src = SRC / name
        if src.is_file():
            shutil.copy2(src, OUT / name)
    for d in COPY_DIRS:
        src = SRC / d
        if src.is_dir():
            shutil.copytree(src, OUT / d)
    print(f"[瘦客户端] {OUT} — 不含 data/ img/ music/")


def full() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(SRC, OUT)
    print(f"[完整包] {OUT} — 含全部 dist/")


def main() -> None:
    if not SRC.is_dir():
        raise SystemExit(f"未找到 {SRC}")
    if "--full" in sys.argv:
        full()
    else:
        thin()
        print("打包前请确认 dist/data-remote.json 已配置 pagesBase 且 enabled: true")


if __name__ == "__main__":
    main()
