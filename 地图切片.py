# -*- coding: utf-8 -*-
"""
地图登记：傻瓜窗口或命令行。自动写入 dist/data/地图.json，不用手改登记。

支持两种模式：
  - 单图：复制到 dist/img/地图/<id>.<ext>，登记「图片」字段（适合洞穴等小图）
  - 瓦片：切片到 dist/img/地图/tiles/<id>/，登记「瓦片」+ 宽/高（适合大地图）

双击 / 无参数：
    python 地图切片.py

命令行（瓦片，默认）：
    python 地图切片.py 大地图.png
    python 地图切片.py 大地图.png --format png

命令行（单图）：
    python 地图切片.py 洞穴.png --single
    python 地图切片.py 洞穴.png --mode single --id D01洞穴 --name 某洞穴
"""
import argparse
import json
import math
import os
import shutil
import sys
import threading
import traceback

from PIL import Image

TILE = 512
SINGLE_MAX_SIDE = 8192
ROOT = os.path.dirname(os.path.abspath(__file__))
MAP_IMG_DIR = os.path.join(ROOT, "dist", "img", "地图")
DEFAULT_IMAGE = os.path.join(MAP_IMG_DIR, "world.png")
DEFAULT_JSON = os.path.join(ROOT, "dist", "data", "地图.json")
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def web_tile_path(out_dir):
    tile_dir = os.path.abspath(out_dir).replace("\\", "/")
    dist = os.path.join(ROOT, "dist").replace("\\", "/")
    if tile_dir.lower().startswith(dist.lower() + "/"):
        return tile_dir[len(dist) + 1:]
    if tile_dir.lower().startswith("dist/"):
        return tile_dir[5:]
    return tile_dir.lstrip("/")


def _read_map_registry(json_path=DEFAULT_JSON):
    if not os.path.isfile(json_path):
        return []
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, list) else []


def _write_map_registry(data, json_path=DEFAULT_JSON):
    os.makedirs(os.path.dirname(json_path), exist_ok=True)
    with open(json_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent="\t")
        f.write("\n")


def _find_map_entry(data, map_id):
    for item in data:
        if item and item.get("id") == map_id:
            return item
    return None


def register_tile_map(map_id, name, tile_web, w, h, json_path=DEFAULT_JSON):
    data = _read_map_registry(json_path)
    entry = _find_map_entry(data, map_id)
    if entry is None:
        entry = {"id": map_id}
        data.append(entry)
    entry["名称"] = name or entry.get("名称") or map_id
    entry["瓦片"] = tile_web
    entry["宽"] = w
    entry["高"] = h
    entry.pop("图片", None)
    _write_map_registry(data, json_path)
    return json_path


def register_single_map(map_id, name, image_web, json_path=DEFAULT_JSON):
    data = _read_map_registry(json_path)
    entry = _find_map_entry(data, map_id)
    if entry is None:
        entry = {"id": map_id}
        data.append(entry)
    entry["名称"] = name or entry.get("名称") or map_id
    entry["图片"] = image_web
    entry.pop("瓦片", None)
    entry.pop("宽", None)
    entry.pop("高", None)
    _write_map_registry(data, json_path)
    return json_path


def image_size(image_path):
    Image.MAX_IMAGE_PIXELS = None
    with Image.open(image_path) as img:
        return img.size


def suggest_mode(image_path):
    try:
        w, h = image_size(image_path)
        return "single" if max(w, h) <= SINGLE_MAX_SIDE else "tile"
    except Exception:
        return "tile"


def normalize_image_ext(image_path):
    ext = os.path.splitext(image_path)[1].lower()
    if ext == ".jpeg":
        return ".jpg"
    if ext in IMAGE_EXTS:
        return ext
    return ".png"


def install_single_image(image_path, map_id, log=print):
    image_path = os.path.abspath(image_path)
    if not os.path.isfile(image_path):
        raise FileNotFoundError("找不到地图图片：" + image_path)

    ext = normalize_image_ext(image_path)
    os.makedirs(MAP_IMG_DIR, exist_ok=True)
    dest = os.path.join(MAP_IMG_DIR, map_id + ext)
    if os.path.normcase(image_path) != os.path.normcase(dest):
        shutil.copy2(image_path, dest)
        log(f"已复制到 dist/img/地图/{map_id}{ext}")
    else:
        log("图片已在 dist/img/地图/，跳过复制。")

    w, h = image_size(dest)
    image_web = f"img/地图/{map_id}{ext}"
    return image_web, w, h, dest


def slice_map(image_path, out_dir, fmt="jpg", quality=88, log=print):
    image_path = os.path.abspath(image_path)
    out_dir = os.path.abspath(out_dir)
    if not os.path.isfile(image_path):
        raise FileNotFoundError("找不到地图图片：" + image_path)

    Image.MAX_IMAGE_PIXELS = None
    img = Image.open(image_path)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    w, h = img.size
    levels = max(0, math.ceil(math.log2(max(w, h) / TILE)))

    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
        log("已清空旧瓦片目录，避免 jpg/png 混在一起。")

    total = 0
    for z in range(levels + 1):
        div = 2 ** (levels - z)
        zw, zh = math.ceil(w / div), math.ceil(h / div)
        level_img = img.resize((zw, zh), Image.LANCZOS) if div > 1 else img
        cols, rows = math.ceil(zw / TILE), math.ceil(zh / TILE)
        zdir = os.path.join(out_dir, str(z))
        os.makedirs(zdir, exist_ok=True)
        for ry in range(rows):
            for rx in range(cols):
                box = (rx * TILE, ry * TILE, min((rx + 1) * TILE, zw), min((ry + 1) * TILE, zh))
                tile = level_img.crop(box)
                path = os.path.join(zdir, f"{rx}_{ry}.{fmt}")
                if fmt == "jpg":
                    tile.save(path, quality=quality)
                else:
                    tile.save(path)
                total += 1
        log(f"层级 {z}/{levels}: {zw}x{zh} → {cols}×{rows} 块")

    size_mb = 0
    for root, _, files in os.walk(out_dir):
        for fn in files:
            size_mb += os.path.getsize(os.path.join(root, fn))
    log(f"完成：{total} 块，约 {size_mb / 1024 / 1024:.1f} MB")
    return w, h, total, size_mb


def run_tile_job(image_path, map_id, name, fmt, quality=88, log=print):
    map_id = (map_id or "").strip() or os.path.splitext(os.path.basename(image_path))[0]
    name = (name or "").strip() or map_id
    out_dir = os.path.join(ROOT, "dist", "img", "地图", "tiles", map_id)
    w, h, total, _ = slice_map(image_path, out_dir, fmt=fmt, quality=quality, log=log)
    tile_web = web_tile_path(out_dir)
    register_tile_map(map_id, name, tile_web, w, h)
    log("已自动登记 dist/data/地图.json（瓦片模式）")
    log(f"  id={map_id}  瓦片={tile_web}  尺寸={w}×{h}  格式={fmt}")
    log("刷新 BS 控制器即可。")
    return {"id": map_id, "模式": "瓦片", "宽": w, "高": h, "瓦片": tile_web, "块数": total}


def run_single_job(image_path, map_id, name, log=print):
    map_id = (map_id or "").strip() or os.path.splitext(os.path.basename(image_path))[0]
    name = (name or "").strip() or map_id
    image_web, w, h, dest = install_single_image(image_path, map_id, log=log)
    register_single_map(map_id, name, image_web)
    log("已自动登记 dist/data/地图.json（单图模式）")
    log(f"  id={map_id}  图片={image_web}  尺寸={w}×{h}")
    log("刷新 BS 控制器即可。")
    return {"id": map_id, "模式": "单图", "宽": w, "高": h, "图片": image_web, "路径": dest}


def run_job(image_path, map_id, name, mode, fmt="jpg", quality=88, log=print):
    if mode == "single":
        return run_single_job(image_path, map_id, name, log=log)
    return run_tile_job(image_path, map_id, name, fmt, quality=quality, log=log)


def launch_gui():
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    win = tk.Tk()
    win.title("地图登记")
    win.geometry("580x480")
    win.minsize(500, 420)

    img_var = tk.StringVar(value=DEFAULT_IMAGE if os.path.isfile(DEFAULT_IMAGE) else "")
    id_var = tk.StringVar(value="world")
    name_var = tk.StringVar(value="世界地图")
    mode_var = tk.StringVar(value="tile")
    fmt_var = tk.StringVar(value="jpg")

    def apply_suggested_mode(image_path):
        if not image_path or not os.path.isfile(image_path):
            return
        suggested = suggest_mode(image_path)
        mode_var.set(suggested)
        update_mode_ui()

    def on_img_change(*_):
        p = img_var.get().strip()
        stem = os.path.splitext(os.path.basename(p))[0] if p else ""
        if stem and (not id_var.get() or id_var.get() in ("world", stem)):
            id_var.set(stem)
        if stem == "world" and not name_var.get():
            name_var.set("世界地图")
        if p and os.path.isfile(p):
            apply_suggested_mode(p)

    def browse():
        p = filedialog.askopenfilename(
            title="选择地图图片",
            filetypes=[("图片", "*.png;*.jpg;*.jpeg;*.webp;*.bmp"), ("全部", "*.*")],
            initialdir=MAP_IMG_DIR,
        )
        if p:
            img_var.set(p)
            stem = os.path.splitext(os.path.basename(p))[0]
            id_var.set(stem)
            if stem == "world":
                name_var.set("世界地图")
            apply_suggested_mode(p)

    frm = ttk.Frame(win, padding=12)
    frm.pack(fill="both", expand=True)

    ttk.Label(frm, text="地图图片").grid(row=0, column=0, sticky="w")
    ttk.Entry(frm, textvariable=img_var).grid(row=0, column=1, sticky="ew", padx=6)
    ttk.Button(frm, text="浏览…", command=browse).grid(row=0, column=2)

    ttk.Label(frm, text="地图 id（和点位数据一致）").grid(row=1, column=0, sticky="w", pady=(8, 0))
    ttk.Entry(frm, textvariable=id_var).grid(row=1, column=1, columnspan=2, sticky="ew", padx=6, pady=(8, 0))

    ttk.Label(frm, text="显示名称").grid(row=2, column=0, sticky="w", pady=(8, 0))
    ttk.Entry(frm, textvariable=name_var).grid(row=2, column=1, columnspan=2, sticky="ew", padx=6, pady=(8, 0))

    ttk.Label(frm, text="登记方式").grid(row=3, column=0, sticky="w", pady=(8, 0))
    mode_row = ttk.Frame(frm)
    mode_row.grid(row=3, column=1, columnspan=2, sticky="w", padx=6, pady=(8, 0))
    ttk.Radiobutton(
        mode_row, text="单图（小图，复制到 dist/img/地图/）", variable=mode_var, value="single",
        command=lambda: update_mode_ui(),
    ).pack(anchor="w")
    ttk.Radiobutton(
        mode_row, text="瓦片（大图切片，适合世界地图）", variable=mode_var, value="tile",
        command=lambda: update_mode_ui(),
    ).pack(anchor="w")

    fmt_label = ttk.Label(frm, text="瓦片格式")
    fmt_label.grid(row=4, column=0, sticky="w", pady=(8, 0))
    fmt_row = ttk.Frame(frm)
    fmt_row.grid(row=4, column=1, columnspan=2, sticky="w", padx=6, pady=(8, 0))
    fmt_jpg = ttk.Radiobutton(fmt_row, text="JPG（体积小，推荐）", variable=fmt_var, value="jpg")
    fmt_png = ttk.Radiobutton(fmt_row, text="PNG（无损）", variable=fmt_var, value="png")
    fmt_jpg.pack(side="left")
    fmt_png.pack(side="left", padx=(16, 0))

    hint_var = tk.StringVar()
    hint = ttk.Label(frm, textvariable=hint_var)
    hint.grid(row=5, column=0, columnspan=3, sticky="w", pady=(10, 4))

    log_box = tk.Text(frm, height=12, wrap="word", font=("Consolas", 10))
    log_box.grid(row=6, column=0, columnspan=3, sticky="nsew", pady=(4, 8))
    frm.rowconfigure(6, weight=1)
    frm.columnconfigure(1, weight=1)

    btn = ttk.Button(frm, text="开始登记")

    def update_mode_ui():
        is_tile = mode_var.get() == "tile"
        state = "normal" if is_tile else "disabled"
        fmt_label.grid() if is_tile else fmt_label.grid_remove()
        fmt_row.grid() if is_tile else fmt_row.grid_remove()
        fmt_jpg.config(state=state)
        fmt_png.config(state=state)
        if is_tile:
            hint_var.set("瓦片模式会写入 dist/img/地图/tiles/<id>/ 并自动改 地图.json。切换格式会清空该地图旧瓦片。")
        else:
            hint_var.set("单图模式会复制到 dist/img/地图/<id>.<ext> 并自动改 地图.json。原图可在任意目录。")

    def log(msg):
        def _():
            log_box.insert("end", str(msg) + "\n")
            log_box.see("end")
        win.after(0, _)

    def work():
        try:
            run_job(
                img_var.get().strip(), id_var.get(), name_var.get(),
                mode_var.get(), fmt_var.get(), log=log,
            )
            win.after(0, lambda: messagebox.showinfo("完成", "地图登记成功。\n刷新 BS 控制器即可。"))
        except Exception as e:
            err = str(e)
            log(traceback.format_exc())
            win.after(0, lambda msg=err: messagebox.showerror("失败", msg))
        finally:
            win.after(0, lambda: btn.config(state="normal"))

    def start():
        if not img_var.get().strip():
            messagebox.showwarning("提示", "请先选择地图图片。")
            return
        if not id_var.get().strip():
            messagebox.showwarning("提示", "请填写地图 id。")
            return
        btn.config(state="disabled")
        log_box.delete("1.0", "end")
        threading.Thread(target=work, daemon=True).start()

    btn.config(command=start)
    btn.grid(row=7, column=0, columnspan=3, sticky="ew")

    update_mode_ui()
    img_var.trace_add("write", on_img_change)
    win.mainloop()


def main():
    if len(sys.argv) == 1:
        launch_gui()
        return 0

    ap = argparse.ArgumentParser(description="地图登记（单图 / 瓦片切片，自动写入 地图.json）")
    ap.add_argument("image", nargs="?", default=DEFAULT_IMAGE, help="地图图片路径")
    ap.add_argument("-o", "--out", default="", help="瓦片目录，默认 dist/img/地图/tiles/<id>")
    ap.add_argument("--id", default="", help="地图 id，默认用文件名")
    ap.add_argument("--name", default="", help="显示名称")
    ap.add_argument("--mode", choices=["single", "tile"], default="", help="登记方式（默认瓦片）")
    ap.add_argument("--single", action="store_true", help="单图登记（等同 --mode single）")
    ap.add_argument("--format", choices=["jpg", "png"], default="jpg")
    ap.add_argument("--quality", type=int, default=88)
    ap.add_argument("--no-register", action="store_true", help="瓦片模式：只切片，不改 地图.json")
    args = ap.parse_args()

    map_id = args.id.strip() or os.path.splitext(os.path.basename(args.image))[0]
    name = args.name.strip() or ("世界地图" if map_id == "world" else map_id)
    mode = "single" if args.single or args.mode == "single" else "tile"

    if mode == "single":
        if args.out:
            print("警告：单图模式忽略 --out 参数。", file=sys.stderr)
        run_single_job(args.image, map_id, name)
        return 0

    if args.out:
        w, h, _, _ = slice_map(args.image, args.out, fmt=args.format, quality=args.quality)
        if not args.no_register:
            register_tile_map(map_id, name, web_tile_path(args.out), w, h)
            print("已自动登记 dist/data/地图.json（瓦片模式）")
    else:
        run_tile_job(args.image, map_id, name, args.format, args.quality)
    return 0


# 兼容旧代码中的函数名
register_map_json = register_tile_map


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(e, file=sys.stderr)
        sys.exit(1)
