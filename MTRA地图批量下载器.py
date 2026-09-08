import math
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, urljoin

import requests
from PIL import Image, ImageFile
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

ImageFile.LOAD_TRUNCATED_IMAGES = False

API_URL = "https://mtra.dnof.net/api/maps.json"
MAP_ROOT = "https://mtra.dnof.net/maps/"
UA = "MTRA-Map-Downloader/2.0"


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            for k, v in attrs:
                if k.lower() == "href" and v:
                    self.hrefs.append(v)


class MTRAApp:
    def __init__(self, root):
        self.root = root
        self.root.title("MTRA 地图批量下载器")
        self.root.geometry("1120x720")
        self.root.minsize(920, 620)

        self.stop_event = threading.Event()
        self.worker = None
        self.maps = []
        self.map_items = {}

        self.output_dir = tk.StringVar(value=str(Path.cwd() / "MTRA地图"))
        self.threads = tk.IntVar(value=12)
        self.retries = tk.IntVar(value=3)
        self.search = tk.StringVar()
        self.group_filter = tk.StringVar(value="全部")
        self.status = tk.StringVar(value="准备就绪")
        self.progress = tk.DoubleVar(value=0)

        self._build_ui()
        self.refresh_maps()

    # ---------------- UI ----------------

    def _build_ui(self):
        top = ttk.Frame(self.root, padding=10)
        top.pack(fill="x")

        ttk.Label(top, text="地图 API:").pack(side="left")
        self.api_entry = ttk.Entry(top)
        self.api_entry.insert(0, API_URL)
        self.api_entry.pack(side="left", fill="x", expand=True, padx=8)
        ttk.Button(top, text="刷新地图", command=self.refresh_maps).pack(side="left")

        opts = ttk.Frame(self.root, padding=(10, 0, 10, 8))
        opts.pack(fill="x")

        ttk.Label(opts, text="搜索:").pack(side="left")
        e = ttk.Entry(opts, textvariable=self.search, width=24)
        e.pack(side="left", padx=(5, 15))
        e.bind("<KeyRelease>", lambda _: self.filter_maps())

        ttk.Label(opts, text="分组:").pack(side="left")
        self.group_box = ttk.Combobox(
            opts, textvariable=self.group_filter, state="readonly", width=18
        )
        self.group_box["values"] = ("全部",)
        self.group_box.pack(side="left", padx=5)
        self.group_box.bind("<<ComboboxSelected>>", lambda _: self.filter_maps())

        ttk.Button(opts, text="全选", command=self.select_all).pack(side="left", padx=8)
        ttk.Button(opts, text="全不选", command=self.select_none).pack(side="left")

        frame = ttk.Frame(self.root, padding=(10, 0, 10, 8))
        frame.pack(fill="both", expand=True)

        cols = ("sel", "title", "group", "size", "tiles", "state")
        self.tree = ttk.Treeview(frame, columns=cols, show="headings", selectmode="none")
        headings = {
            "sel": "选择",
            "title": "地图",
            "group": "分组",
            "size": "API尺寸",
            "tiles": "资源",
            "state": "状态",
        }
        widths = {"sel": 60, "title": 260, "group": 150, "size": 120, "tiles": 100, "state": 170}
        for c in cols:
            self.tree.heading(c, text=headings[c])
            self.tree.column(c, width=widths[c], anchor="center" if c != "title" else "w")

        y = ttk.Scrollbar(frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=y.set)
        self.tree.pack(side="left", fill="both", expand=True)
        y.pack(side="right", fill="y")
        self.tree.bind("<Button-1>", self.tree_click)

        bottom = ttk.Frame(self.root, padding=10)
        bottom.pack(fill="x")

        ttk.Label(bottom, text="保存目录:").grid(row=0, column=0, sticky="w")
        ttk.Entry(bottom, textvariable=self.output_dir).grid(row=0, column=1, sticky="ew", padx=6)
        ttk.Button(bottom, text="选择", command=self.choose_dir).grid(row=0, column=2)

        ttk.Label(bottom, text="下载线程:").grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Spinbox(bottom, from_=1, to=32, textvariable=self.threads, width=7).grid(
            row=1, column=1, sticky="w", padx=6, pady=(8, 0)
        )
        ttk.Label(bottom, text="重试:").grid(row=1, column=1, padx=(90, 0), pady=(8, 0), sticky="w")
        ttk.Spinbox(bottom, from_=1, to=10, textvariable=self.retries, width=7).grid(
            row=1, column=1, padx=(130, 0), pady=(8, 0), sticky="w"
        )

        self.pb = ttk.Progressbar(bottom, variable=self.progress, maximum=100)
        self.pb.grid(row=2, column=0, columnspan=3, sticky="ew", pady=(12, 4))
        ttk.Label(bottom, textvariable=self.status).grid(row=3, column=0, columnspan=3, sticky="w")

        buttons = ttk.Frame(self.root, padding=(10, 0, 10, 10))
        buttons.pack(fill="x")
        ttk.Button(buttons, text="开始下载并拼接", command=self.start).pack(side="left")
        ttk.Button(buttons, text="停止", command=self.stop).pack(side="left", padx=8)
        ttk.Button(buttons, text="打开保存目录", command=self.open_output).pack(side="left")

        bottom.columnconfigure(1, weight=1)

    def _set_state(self, m, state):
        m["state"] = state
        self.filter_maps()

    def refresh_maps(self):
        self.status.set("正在读取地图列表…")
        threading.Thread(target=self._load_maps, daemon=True).start()

    def _load_maps(self):
        try:
            s = requests.Session()
            s.headers["User-Agent"] = UA
            r = s.get(self.api_entry.get().strip(), timeout=20)
            r.raise_for_status()
            data = r.json()

            clean = []
            for m in data.get("maps", []):
                try:
                    mid = str(m.get("id", "")).strip()
                    title = str(m.get("title", "")).strip() or mid
                    group = str(m.get("group", "未分类")).strip() or "未分类"
                    w = int(m.get("width", 0) or 0)
                    h = int(m.get("height", 0) or 0)
                    if mid:
                        clean.append({
                            "id": mid,
                            "title": title,
                            "group": group,
                            "width": w,
                            "height": h,
                            "checked": False,
                            "state": "待下载",
                            "resource": "",
                        })
                except Exception:
                    continue

            self.maps = clean
            self.root.after(0, self._populate)
        except Exception as ex:
            self.root.after(0, lambda ex=ex: messagebox.showerror("读取失败", str(ex)))
            self.root.after(0, lambda: self.status.set("读取地图列表失败"))

    def _populate(self):
        groups = ["全部"] + sorted({m["group"] for m in self.maps})
        self.group_box["values"] = groups
        self.group_filter.set("全部")
        self.filter_maps()
        self.status.set(f"已读取 {len(self.maps)} 张地图")

    def filter_maps(self):
        self.tree.delete(*self.tree.get_children())
        self.map_items.clear()

        q = self.search.get().strip().lower()
        g = self.group_filter.get()

        for m in self.maps:
            if q and q not in (m["title"] + " " + m["id"]).lower():
                continue
            if g != "全部" and m["group"] != g:
                continue

            if m.get("resource"):
                tiles_text = m["resource"]
            else:
                tiles_text = "自动探测"

            iid = self.tree.insert(
                "", "end",
                values=(
                    "☑" if m["checked"] else "☐",
                    m["title"],
                    m["group"],
                    f"{m['width']} × {m['height']}" if m["width"] and m["height"] else "-",
                    tiles_text,
                    m["state"],
                )
            )
            self.map_items[iid] = m

    def tree_click(self, event):
        iid = self.tree.identify_row(event.y)
        col = self.tree.identify_column(event.x)
        if iid and col == "#1":
            m = self.map_items.get(iid)
            if m:
                m["checked"] = not m["checked"]
                self.filter_maps()

    def select_all(self):
        q = self.search.get().strip().lower()
        g = self.group_filter.get()
        for m in self.maps:
            if (not q or q in (m["title"] + " " + m["id"]).lower()) and (
                g == "全部" or m["group"] == g
            ):
                m["checked"] = True
        self.filter_maps()

    def select_none(self):
        for m in self.maps:
            m["checked"] = False
        self.filter_maps()

    def choose_dir(self):
        p = filedialog.askdirectory(initialdir=self.output_dir.get())
        if p:
            self.output_dir.set(p)

    def open_output(self):
        os.makedirs(self.output_dir.get(), exist_ok=True)
        os.startfile(self.output_dir.get())

    # ---------------- URLs ----------------

    @staticmethod
    def _base_id(map_id):
        return map_id[:-7] if map_id.endswith("_viewer") else map_id

    def _full_map_url(self, map_id):
        base = self._base_id(map_id)
        return MAP_ROOT + quote(base + ".png")

    def _tile_dir_url(self, map_id):
        base = self._base_id(map_id)
        return MAP_ROOT + quote(base + "_tiles/")

    def _tile_url(self, map_id, row, col):
        return self._tile_dir_url(map_id) + quote(f"tile_{row:04d}_{col:04d}.png")

    # ---------------- Download helpers ----------------

    def _request(self, url, stream=False):
        last = None
        retries = max(1, int(self.retries.get()))
        for attempt in range(retries):
            if self.stop_event.is_set():
                raise InterruptedError("用户停止")
            try:
                r = requests.get(
                    url,
                    headers={"User-Agent": UA},
                    timeout=(10, 60),
                    stream=stream,
                )
                return r
            except Exception as ex:
                last = ex
                time.sleep(0.4 * (attempt + 1))
        raise RuntimeError(f"请求失败：{last}")

    def _download_file(self, url, dest):
        tmp = dest.with_suffix(dest.suffix + ".part")
        retries = max(1, int(self.retries.get()))

        for attempt in range(retries):
            if self.stop_event.is_set():
                return False, "用户停止"

            try:
                r = requests.get(
                    url,
                    headers={"User-Agent": UA},
                    timeout=(10, 120),
                    stream=True,
                )

                if r.status_code == 404:
                    return False, "404"

                if r.status_code != 200:
                    last = f"HTTP {r.status_code}"
                    r.close()
                    time.sleep(0.5 * (attempt + 1))
                    continue

                dest.parent.mkdir(parents=True, exist_ok=True)
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1024 * 1024):
                        if self.stop_event.is_set():
                            r.close()
                            try:
                                tmp.unlink()
                            except OSError:
                                pass
                            return False, "用户停止"
                        if chunk:
                            f.write(chunk)
                r.close()

                # Validate the downloaded image before replacing the destination.
                with Image.open(tmp) as im:
                    im.verify()

                os.replace(tmp, dest)
                return True, "OK"

            except Exception as ex:
                last = str(ex)
                try:
                    tmp.unlink()
                except OSError:
                    pass
                time.sleep(0.5 * (attempt + 1))

        return False, last or "未知错误"

    # ---------------- Main task ----------------

    def start(self):
        selected = [m for m in self.maps if m["checked"]]
        if not selected:
            messagebox.showwarning("提示", "请至少选择一张地图。")
            return
        if self.worker and self.worker.is_alive():
            messagebox.showinfo("提示", "任务正在运行。")
            return

        os.makedirs(self.output_dir.get(), exist_ok=True)
        self.stop_event.clear()
        self.progress.set(0)
        self.worker = threading.Thread(
            target=self._download_all, args=(selected,), daemon=True
        )
        self.worker.start()

    def stop(self):
        self.stop_event.set()
        self.status.set("正在停止…")

    def _download_all(self, selected):
        total_maps = len(selected)
        success = 0

        for idx, m in enumerate(selected, 1):
            if self.stop_event.is_set():
                break

            try:
                self.root.after(
                    0,
                    lambda m=m: self._set_state(m, "处理中")
                )
                self.root.after(
                    0,
                    lambda idx=idx, total_maps=total_maps, m=m:
                    self.status.set(f"[{idx}/{total_maps}] {m['title']}")
                )

                self._download_map(m)

                if not self.stop_event.is_set():
                    success += 1
                    self.root.after(0, lambda m=m: self._set_state(m, "完成"))

            except InterruptedError:
                break
            except Exception as ex:
                m["error"] = str(ex)
                self.root.after(0, lambda m=m: self._set_state(m, "失败"))
                self.root.after(
                    0,
                    lambda ex=ex: self.status.set(f"失败：{ex}")
                )

        final = "已停止" if self.stop_event.is_set() else f"全部完成：{success}/{total_maps}"
        self.root.after(0, lambda: self.status.set(final))

    def _map_folder(self, m):
        group = self._safe_name(m["group"])
        title = self._safe_name(m["title"])
        return Path(self.output_dir.get()) / group / title

    def _safe_name(self, name):
        return re.sub(r'[<>:"/\\|?*]', "_", name).strip() or "未命名地图"

    def _download_map(self, m):
        out = self._map_folder(m)
        out.mkdir(parents=True, exist_ok=True)

        # IMPORTANT:
        # Do NOT use API width/height to decide tile count.
        # First try the server's complete PNG.
        full_url = self._full_map_url(m["id"])
        full_png = out / f"{self._safe_name(m['title'])}.png"

        self.root.after(
            0,
            lambda: self.status.set(f"检查完整地图：{m['title']}")
        )

        if full_png.exists() and full_png.stat().st_size > 0:
            try:
                with Image.open(full_png) as im:
                    im.verify()
                m["resource"] = "完整 PNG"
                self.root.after(0, self.filter_maps)
                return
            except Exception:
                try:
                    full_png.unlink()
                except OSError:
                    pass

        ok, reason = self._download_file(full_url, full_png)
        if ok:
            with Image.open(full_png) as im:
                actual = im.size
            m["resource"] = f"完整 PNG {actual[0]}×{actual[1]}"
            self.root.after(0, self.filter_maps)
            self.root.after(
                0,
                lambda: self.status.set(
                    f"直接下载完成：{m['title']}  {actual[0]}×{actual[1]}"
                )
            )
            return

        # No complete PNG. Discover and download the actual tile grid.
        tile_dir = out / "tiles"
        tile_dir.mkdir(parents=True, exist_ok=True)

        self.root.after(
            0,
            lambda: self.status.set(f"未找到完整 PNG，开始探测 Tile：{m['title']}")
        )

        tiles = self._discover_tiles(m["id"])
        if not tiles:
            raise RuntimeError(
                f"没有找到地图资源\n完整 PNG：{reason}\nTile：tile_0000_0000.png 也不存在"
            )

        # Download discovered tiles. Existing valid files are kept.
        total = len(tiles)
        done = 0
        failures = []

        def download_one(rc):
            r, c = rc
            dest = tile_dir / f"tile_{r:04d}_{c:04d}.png"
            if dest.exists() and dest.stat().st_size > 0:
                try:
                    with Image.open(dest) as im:
                        im.verify()
                    return rc, True, "已存在"
                except Exception:
                    try:
                        dest.unlink()
                    except OSError:
                        pass

            return rc, *self._download_file(self._tile_url(m["id"], r, c), dest)

        workers = max(1, min(32, int(self.threads.get())))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = [ex.submit(download_one, rc) for rc in tiles]
            for f in as_completed(futures):
                if self.stop_event.is_set():
                    break
                rc, ok, reason = f.result()
                done += 1
                if not ok:
                    failures.append((rc, reason))
                pct = done / total * 100
                self.root.after(0, lambda p=pct: self.progress.set(p))
                self.root.after(
                    0,
                    lambda d=done, t=total:
                    self.status.set(f"下载 Tile：{d}/{t}")
                )

        if self.stop_event.is_set():
            raise InterruptedError("用户停止")

        if failures:
            raise RuntimeError(
                f"Tile 下载失败 {len(failures)}/{total}，例如："
                + ", ".join(
                    f"{r:04d}_{c:04d}:{reason}" for (r, c), reason in failures[:5]
                )
            )

        m["resource"] = f"{len(tiles)} 个 Tile"
        self.root.after(0, self.filter_maps)

        output = out / f"{self._safe_name(m['title'])}.png"
        self._stitch_tiles(tile_dir, tiles, output)

    # ---------------- Tile discovery ----------------

    def _discover_tiles(self, map_id):
        # 1) Prefer directory listing if the server exposes one.
        directory = self._tile_dir_url(map_id)
        try:
            r = requests.get(directory, headers={"User-Agent": UA}, timeout=15)
            if r.status_code == 200 and "text/html" in r.headers.get("content-type", "").lower():
                parser = LinkParser()
                parser.feed(r.text)
                found = set()
                for href in parser.hrefs:
                    name = href.rsplit("/", 1)[-1]
                    mm = re.fullmatch(r"tile_(\d+)_(\d+)\.png", name, re.I)
                    if mm:
                        found.add((int(mm.group(1)), int(mm.group(2))))
                if found:
                    return sorted(found)
        except Exception:
            pass

        # 2) No listing: probe the actual grid.
        # No API dimensions, no 2048 assumption, no artificial map-size limit.
        #
        # Assumption is only that tiles form a normal contiguous grid starting
        # at tile_0000_0000, which matches the resource layout observed on MTRA.
        found = []
        row = 0

        while not self.stop_event.is_set():
            col = 0
            row_found = False

            while not self.stop_event.is_set():
                url = self._tile_url(map_id, row, col)
                exists = self._tile_exists(url)

                if not exists:
                    break

                found.append((row, col))
                row_found = True
                col += 1

            if not row_found:
                break

            row += 1

        return found

    def _tile_exists(self, url):
        retries = max(1, min(3, int(self.retries.get())))
        for attempt in range(retries):
            if self.stop_event.is_set():
                return False
            try:
                r = requests.get(
                    url,
                    headers={"User-Agent": UA},
                    timeout=(8, 30),
                    stream=True,
                )
                code = r.status_code
                r.close()
                if code == 200:
                    return True
                if code == 404:
                    return False
            except Exception:
                pass
            time.sleep(0.25 * (attempt + 1))
        return False

    # ---------------- Stitch ----------------

    def _stitch_tiles(self, tile_dir, tiles, output):
        self.root.after(0, lambda: self.status.set("正在分析 Tile 实际尺寸…"))

        images = {}
        col_widths = {}
        row_heights = {}
        has_alpha = False

        for r, c in tiles:
            if self.stop_event.is_set():
                raise InterruptedError("用户停止")

            p = tile_dir / f"tile_{r:04d}_{c:04d}.png"
            if not p.exists():
                raise RuntimeError(f"缺少 Tile：{p.name}")

            with Image.open(p) as src:
                mode = "RGBA" if "A" in src.getbands() else "RGB"
                im = src.convert(mode).copy()

            images[(r, c)] = im
            col_widths[c] = max(col_widths.get(c, 0), im.width)
            row_heights[r] = max(row_heights.get(r, 0), im.height)
            has_alpha |= im.mode == "RGBA"

        if not images:
            raise RuntimeError("没有有效 Tile，无法拼接")

        columns = sorted(col_widths)
        rows = sorted(row_heights)

        # Use actual dimensions only. No resize, crop, or expected-size check.
        total_w = sum(col_widths[c] for c in columns)
        total_h = sum(row_heights[r] for r in rows)

        mode = "RGBA" if has_alpha else "RGB"
        bg = (0, 0, 0, 0) if mode == "RGBA" else (0, 0, 0)
        canvas = Image.new(mode, (total_w, total_h), bg)

        x_pos = {}
        x = 0
        for c in columns:
            x_pos[c] = x
            x += col_widths[c]

        y_pos = {}
        y = 0
        for r in rows:
            y_pos[r] = y
            y += row_heights[r]

        for (r, c), im in images.items():
            if mode == "RGBA" and im.mode != "RGBA":
                im = im.convert("RGBA")
            elif mode == "RGB" and im.mode != "RGB":
                im = im.convert("RGB")
            canvas.paste(im, (x_pos[c], y_pos[r]))
            im.close()

        output.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(output, "PNG", compress_level=6)
        canvas.close()

        self.root.after(
            0,
            lambda: self.status.set(
                f"拼接完成：{output.name}  {total_w}×{total_h}"
            )
        )


if __name__ == "__main__":
    root = tk.Tk()
    try:
        root.call("tk", "scaling", 1.0)
    except Exception:
        pass
    app = MTRAApp(root)
    root.mainloop()
