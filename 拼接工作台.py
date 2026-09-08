# -*- coding: utf-8 -*-
"""截图拼接可视化工作台（PyQt6 桌面版）。

运行：
    python 拼接工作台.py [截图目录]

功能：
  - 打开目录只入库；刷新 / 目录监控自动发现新截图（不自动置入）；
  - 逐张置入 / 锚点对应（单张快速） / 对应拼接（多对区域批量对齐）；
  - 拖动：拖图块移动连通组；Alt 拖单张微调；拖空白/中键平移画布；Ctrl+Z 撤销；
  - 修正取样：框选区域，从源图盖章贴回；
  - 去除：框选对象，从其它截图中自动挑选「最干净」的一帧真实像素盖章覆盖
    （不做 inpaint / 中值糊图）；
  - 画布网格：可设间距（1–512px），显示/吸附独立开关；
  - 瓦片库：框选画布区域存为瓦片，从库中贴回修补；
  - 会话保存到截图目录下的 拼接工作台.json。
"""
import copy
import json
import math
import os
import shutil
import sys
from collections import Counter, defaultdict

import cv2
import numpy as np

from PyQt6.QtCore import Qt, QPointF, QRectF, QSize, QThread, pyqtSignal, QFileSystemWatcher, QTimer
from PyQt6.QtGui import (
    QImage, QPixmap, QPainter, QPen, QColor, QWheelEvent, QMouseEvent, QIcon,
    QKeySequence, QShortcut, QPainterPath,
)
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLineEdit, QPushButton, QListWidget, QListWidgetItem, QLabel,
    QSplitter, QInputDialog, QMessageBox, QFileDialog, QGroupBox,
    QGraphicsView, QGraphicsScene, QGraphicsPixmapItem, QGraphicsRectItem,
    QGraphicsItem, QMenu, QDialog, QDialogButtonBox, QProgressDialog,
    QCheckBox, QSpinBox, QListView, QColorDialog,
)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from 截图拼接 import (  # noqa: E402
    match_to_canvas, natural_key, place_by_anchor, refine_by_patches,
)

RING_MARGIN = 4  # 去除打分：目标框外扩环带宽度（像素）
CONNECT_GAP = 0  # 须包围盒重叠才算同一组（仅相邻不算已拼接）
PLACE_GAP = 200  # 新置入图与现有画布的间距，避免被当成已拼在一起
SKIP_IMPORT_NAMES = {"拼接结果.png"}
MAX_CANVAS_SIDE = 65536  # 合成图单边上限，防止异常坐标撑爆内存


def bgr_to_qpixmap(img):
    if img is None or img.size == 0:
        return QPixmap(1, 1)
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w, ch = rgb.shape
    qimg = QImage(rgb.data, w, h, ch * w, QImage.Format.Format_RGB888).copy()
    return QPixmap.fromImage(qimg)


def quantize(img):
    """像素风友好：色量化后比较色差。"""
    return (img.astype(np.int16) // 8).astype(np.int16)


def thumb_icon(img, max_w=120, max_h=80):
    """列表缩略图（setIcon 需要 QIcon，不是 QPixmap）。"""
    pix = bgr_to_qpixmap(img)
    scaled = pix.scaled(max_w, max_h, Qt.AspectRatioMode.KeepAspectRatio,
                        Qt.TransformationMode.FastTransformation)
    return QIcon(scaled)


class TaskWorker(QThread):
    done = pyqtSignal(object)
    failed = pyqtSignal(str)

    def __init__(self, fn, parent=None):
        super().__init__(parent)
        self._fn = fn

    def run(self):
        try:
            self.done.emit(self._fn())
        except Exception as e:
            self.failed.emit(str(e))


def selection_pen(color):
    pen = QPen(color)
    pen.setWidth(1)
    pen.setCosmetic(True)
    return pen


class AnchorPreviewView(QGraphicsView):
    """锚点弹窗画布：滚轮放大、中键拖移、左键框选。"""

    def __init__(self, img, parent=None):
        super().__init__(parent)
        self.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, False)
        self.setDragMode(QGraphicsView.DragMode.NoDrag)
        self.setBackgroundBrush(QColor(20, 20, 20))
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.NoAnchor)
        self.setResizeAnchor(QGraphicsView.ViewportAnchor.NoAnchor)
        scene = QGraphicsScene(self)
        scene.addItem(QGraphicsPixmapItem(bgr_to_qpixmap(img)))
        ih, iw = img.shape[:2]
        scene.setSceneRect(0, 0, iw, ih)
        self.setScene(scene)
        self._sel = None
        self._drag = None
        self._sel_item = None
        self._panning = False
        self._pan_press = None
        self._pan_scroll = None
        self._zoom = 1.0
        self._fitted = False

    def showEvent(self, event):
        super().showEvent(event)
        if not self._fitted and self.scene().sceneRect().isValid():
            self._fitted = True
            self.resetTransform()
            self.fitInView(self.scene().sceneRect(), Qt.AspectRatioMode.KeepAspectRatio)
            self._zoom = self.transform().m11() or 1.0

    def wheelEvent(self, event: QWheelEvent):
        if event.angleDelta().y() == 0:
            return
        event.accept()
        mouse = event.position()
        scene_anchor = self.mapToScene(mouse.toPoint())
        step = 1.15 if event.angleDelta().y() > 0 else 1 / 1.15
        new_zoom = max(0.2, min(16.0, self._zoom * step))
        if abs(new_zoom - self._zoom) < 1e-9:
            return
        self._zoom = new_zoom
        self.resetTransform()
        self.scale(self._zoom, self._zoom)
        view_anchor = self.mapFromScene(scene_anchor)
        adjust = QPointF(view_anchor) - mouse
        self.horizontalScrollBar().setValue(int(self.horizontalScrollBar().value() + adjust.x()))
        self.verticalScrollBar().setValue(int(self.verticalScrollBar().value() + adjust.y()))

    def mousePressEvent(self, event: QMouseEvent):
        if event.button() == Qt.MouseButton.MiddleButton:
            self._panning = True
            self._pan_press = event.position()
            self._pan_scroll = QPointF(
                self.horizontalScrollBar().value(),
                self.verticalScrollBar().value(),
            )
            self.setCursor(Qt.CursorShape.ClosedHandCursor)
            return
        if event.button() != Qt.MouseButton.LeftButton:
            return
        pos = self.mapToScene(event.position().toPoint())
        self._drag = {"x0": pos.x(), "y0": pos.y()}
        if self._sel_item:
            self.scene().removeItem(self._sel_item)
        self._sel_item = QGraphicsRectItem()
        self._sel_item.setPen(selection_pen(QColor(255, 80, 80)))
        self._sel_item.setBrush(QColor(255, 80, 80, 25))
        self._sel_item.setZValue(20)
        self.scene().addItem(self._sel_item)

    def mouseMoveEvent(self, event: QMouseEvent):
        if self._panning and self._pan_press is not None and self._pan_scroll is not None:
            d = event.position() - self._pan_press
            self.horizontalScrollBar().setValue(int(self._pan_scroll.x() - d.x()))
            self.verticalScrollBar().setValue(int(self._pan_scroll.y() - d.y()))
            return
        if not self._drag or not self._sel_item:
            return
        pos = self.mapToScene(event.position().toPoint())
        x0 = min(self._drag["x0"], pos.x())
        y0 = min(self._drag["y0"], pos.y())
        self._sel_item.setRect(x0, y0, abs(pos.x() - self._drag["x0"]),
                               abs(pos.y() - self._drag["y0"]))

    def mouseReleaseEvent(self, event: QMouseEvent):
        if self._panning and event.button() == Qt.MouseButton.MiddleButton:
            self._panning = False
            self._pan_press = None
            self._pan_scroll = None
            self.setCursor(Qt.CursorShape.ArrowCursor)
        if not self._drag:
            return
        self._drag = None
        if not self._sel_item:
            return
        r = self._sel_item.sceneBoundingRect()
        if r.width() >= 4 and r.height() >= 4:
            self._sel = {
                "x": max(0, int(r.x())), "y": max(0, int(r.y())),
                "w": int(r.width()), "h": int(r.height()),
            }

    def selected_rect(self):
        return self._sel


class AnchorPreviewDialog(QDialog):
    """在新图上框选与画布对应的同一块地貌。"""

    def __init__(self, img, parent=None):
        super().__init__(parent)
        self.setWindowTitle("在新图上框选对应区域")
        self.resize(900, 680)
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel(
            "滚轮放大（对准光标），中键拖移画面；左键框选与画布上相同的一块，然后确定。"
        ))
        self.view = AnchorPreviewView(img)
        layout.addWidget(self.view, 1)
        btns = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        btns.accepted.connect(self._accept)
        btns.rejected.connect(self.reject)
        layout.addWidget(btns)

    def _accept(self):
        if not self.view.selected_rect():
            QMessageBox.information(self, "锚点对应", "请先在图上框选对应区域")
            return
        self.accept()

    def selected_rect(self):
        return self.view.selected_rect()


class ImagePreviewDialog(QDialog):
    """图层列表大图预览（只看不框选）。"""

    def __init__(self, img, title, parent=None):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.resize(960, 720)
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("滚轮放大，中键拖移画面。"))
        scene = QGraphicsScene(self)
        scene.addItem(QGraphicsPixmapItem(bgr_to_qpixmap(img)))
        ih, iw = img.shape[:2]
        scene.setSceneRect(0, 0, iw, ih)
        view = QGraphicsView(scene)
        view.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, False)
        view.setBackgroundBrush(QColor(20, 20, 20))
        layout.addWidget(view, 1)
        btns = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        btns.rejected.connect(self.reject)
        btns.accepted.connect(self.accept)
        layout.addWidget(btns)
        self._view = view

    def showEvent(self, event):
        super().showEvent(event)
        if self._view.scene().sceneRect().isValid():
            self._view.fitInView(self._view.scene().sceneRect(),
                                 Qt.AspectRatioMode.KeepAspectRatio)


class Workbench:
    def __init__(self):
        self.dir = ""
        self.sources = []
        self.patches = []
        self.tiles = []
        self.grid = dict(DEFAULT_GRID)
        self.version = 0
        self.failed = []
        self._erase_cache = {}
        self._tile_cache = {}
        self._composite_cache = None
        self._undo = []
        self._redo = []
        self._suspend_undo = False
        self.exports = []
        self.origin_x = None
        self.origin_y = None

    def _reset_origin(self):
        self.origin_x = None
        self.origin_y = None

    def _origin_dict(self):
        if self.origin_x is None or self.origin_y is None:
            return None
        return {"x": int(self.origin_x), "y": int(self.origin_y)}

    def _apply_origin(self, origin):
        if origin and "x" in origin and "y" in origin:
            self.origin_x = int(origin["x"])
            self.origin_y = int(origin["y"])
        else:
            self._reset_origin()

    def session_file(self):
        return os.path.join(self.dir, "拼接工作台.json")

    def session_bak_file(self):
        return self.session_file() + ".bak"

    def save_session(self):
        if not self.dir:
            return
        path = self.session_file()
        data = {
            "sources": [{"name": s["name"], "x": s["x"], "y": s["y"],
                         "order": s["order"], "placed": s["placed"],
                         "manual": s.get("manual", False)} for s in self.sources],
            "patches": self.patches,
            "exports": list(self.exports),
            "grid": dict(self.grid),
        }
        origin = self._origin_dict()
        if origin:
            data["origin"] = origin
        self._backup_session_if_needed(data)
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
        except OSError:
            pass

    def _session_placed_hits(self, sess, disk_names):
        if not sess:
            return 0
        return sum(1 for s in sess.get("sources", [])
                   if s.get("placed") and s.get("name") in disk_names)

    def _read_json(self, path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def _backup_session_if_needed(self, new_data):
        path = self.session_file()
        bak = self.session_bak_file()
        if not os.path.isfile(path):
            return
        old = self._read_json(path)
        if not old:
            return
        disk = {s["name"] for s in self.sources}
        old_n = self._session_placed_hits(old, disk)
        new_n = self._session_placed_hits(new_data, disk)
        bak_n = self._session_placed_hits(self._read_json(bak), disk) if os.path.isfile(bak) else -1
        if old_n >= new_n and old_n >= bak_n:
            try:
                shutil.copy2(path, bak)
            except OSError:
                pass

    def _skip_names(self, extra=None):
        names = {n.lower() for n in SKIP_IMPORT_NAMES}
        names.update(n.lower() for n in self.exports)
        if extra:
            names.update(n.lower() for n in extra)
        return names

    def _collect_session_exports(self):
        found = []
        for path in (self.session_file(), self.session_bak_file()):
            sess = self._read_json(path) if os.path.isfile(path) else None
            if sess:
                found.extend(sess.get("exports") or [])
        # 去重保序
        out, seen = [], set()
        for n in found:
            if n and n not in seen:
                seen.add(n)
                out.append(n)
        return out

    def _pick_session(self, disk_names):
        ranked = []
        for path in (self.session_file(), self.session_bak_file()):
            if not os.path.isfile(path):
                continue
            sess = self._read_json(path)
            if not sess:
                continue
            placed = self._session_placed_hits(sess, disk_names)
            total = sum(1 for s in sess.get("sources", []) if s.get("name") in disk_names)
            ranked.append((placed, total, sess))
        if not ranked:
            return None
        ranked.sort(key=lambda t: (t[0], t[1]))
        return ranked[-1][2]

    def load_dir(self, directory, keep_session=True, progress=None):
        self.dir = directory
        self.exports = self._collect_session_exports()
        self.grid = dict(DEFAULT_GRID)
        self._reset_origin()
        self._tile_cache = {}
        skip = self._skip_names()
        files = sorted(
            (os.path.join(directory, f) for f in os.listdir(directory)
             if f.lower().endswith((".png", ".jpg", ".jpeg", ".bmp", ".webp"))
             and f.lower() not in skip),
            key=natural_key,
        )
        imgs = []
        for i, f in enumerate(files):
            img = cv2.imread(f, cv2.IMREAD_COLOR)
            if img is not None:
                imgs.append((os.path.basename(f), img))
            if progress and i % 3 == 0:
                progress()
        if not imgs:
            return {"error": "目录中没有可读取的截图（导出大图不会当作素材）"}
        counts = Counter(im.shape[:2] for _, im in imgs)
        base_hw = counts.most_common(1)[0][0]
        imgs = [(n, im) for n, im in imgs if im.shape[:2] == base_hw]
        if not imgs:
            return {"error": "没有统一分辨率的截图"}

        self.sources = [{"name": n, "img": im, "x": 0, "y": 0,
                         "order": i, "placed": False, "manual": False}
                        for i, (n, im) in enumerate(imgs)]
        self.patches = []
        self.failed = []
        self._erase_cache = {}

        disk_names = {s["name"] for s in self.sources}
        if keep_session:
            sess = self._pick_session(disk_names)
            if sess:
                try:
                    by_name = {s["name"]: s for s in self.sources}
                    for s in sess.get("sources", []):
                        t = by_name.get(s["name"])
                        if t:
                            t.update(x=s["x"], y=s["y"], order=s["order"],
                                     placed=s["placed"], manual=s.get("manual", False))
                    self.patches = sess.get("patches", [])
                    for n in sess.get("exports") or []:
                        if n not in self.exports:
                            self.exports.append(n)
                    g = sess.get("grid")
                    if isinstance(g, dict):
                        self.grid = normalize_grid(g)
                    self._apply_origin(sess.get("origin"))
                except (ValueError, KeyError, TypeError):
                    pass

        self.load_tiles()
        self.failed = [s["name"] for s in self.sources if not s["placed"]]
        self._undo.clear()
        self._redo.clear()
        self._touch()
        return {"ok": True, "count": len(self.sources), "failed": len(self.failed)}

    def _auto_stitch(self):
        if not self.sources:
            return
        first = self.sources[0]
        first.update(x=0, y=0, placed=True)
        canvas = first["img"].copy()
        pending = [s for s in self.sources[1:]]
        progress = True
        while progress and pending:
            progress = False
            rest = []
            for s in pending:
                hit = match_to_canvas(canvas, s["img"], 0.90)
                if hit is None:
                    rest.append(s)
                    continue
                _, px, py = hit
                ih, iw = s["img"].shape[:2]
                top = max(0, -py)
                left = max(0, -px)
                bottom = max(0, py + ih - canvas.shape[0])
                right = max(0, px + iw - canvas.shape[1])
                if top or left or bottom or right:
                    canvas = cv2.copyMakeBorder(canvas, top, bottom, left, right,
                                                cv2.BORDER_CONSTANT, value=(0, 0, 0))
                    px += left
                    py += top
                canvas[py:py + ih, px:px + iw] = s["img"]
                s.update(x=px, y=py, placed=True)
                progress = True
            pending = rest
        self.failed = [s["name"] for s in self.sources if not s["placed"]]

    def _layout_snapshot(self):
        snap = {
            "sources": [{"name": s["name"], "x": s["x"], "y": s["y"],
                         "order": s["order"], "placed": s["placed"],
                         "manual": s.get("manual", False)} for s in self.sources],
            "patches": copy.deepcopy(self.patches),
            "failed": list(self.failed),
        }
        origin = self._origin_dict()
        if origin:
            snap["origin"] = origin
        return snap

    def _apply_layout(self, snap):
        by_name = {s["name"]: s for s in self.sources}
        keep = {r["name"] for r in snap["sources"]}
        self.sources = [s for s in self.sources if s["name"] in keep]
        by_name = {s["name"]: s for s in self.sources}
        for rec in snap["sources"]:
            t = by_name.get(rec["name"])
            if t:
                t.update(x=rec["x"], y=rec["y"], order=rec["order"],
                         placed=rec["placed"], manual=rec.get("manual", False))
        self.patches = copy.deepcopy(snap["patches"])
        self.failed = list(snap["failed"])
        self._apply_origin(snap.get("origin"))
        self._erase_cache = {}
        self._tile_cache = {}
        self._touch()

    def push_undo(self):
        if self._suspend_undo:
            return
        self._undo.append(self._layout_snapshot())
        if len(self._undo) > 40:
            self._undo.pop(0)
        self._redo.clear()

    def undo(self):
        if not self._undo:
            return False
        self._redo.append(self._layout_snapshot())
        snap = self._undo.pop()
        self._suspend_undo = True
        self._apply_layout(snap)
        self._suspend_undo = False
        return True

    def redo(self):
        if not self._redo:
            return False
        self._undo.append(self._layout_snapshot())
        snap = self._redo.pop()
        self._suspend_undo = True
        self._apply_layout(snap)
        self._suspend_undo = False
        return True

    def _find_source(self, name):
        return next((s for s in self.sources if s["name"] == name), None)

    def place_source(self, name, x=None, y=None, manual=False):
        src = self._find_source(name)
        if src is None:
            return False
        self.push_undo()
        if x is None or y is None:
            if any(s["placed"] for s in self.sources):
                x0, y0, w, _h = self.canvas_size()
                x, y = x0 + w + PLACE_GAP, y0
            else:
                x, y = 0, 0
        src.update(x=int(x), y=int(y), placed=True, manual=bool(manual))
        self.failed = [n for n in self.failed if n != name]
        self._touch()
        return True

    def unplace_source(self, name):
        src = self._find_source(name)
        if src is None:
            return False
        self.push_undo()
        src.update(placed=False, manual=False, x=0, y=0)
        if name not in self.failed:
            self.failed.append(name)
        if not any(s["placed"] for s in self.sources):
            self._reset_origin()
        self._touch()
        return True

    def match_single_source(self, name, threshold=0.90):
        src = self._find_source(name)
        if src is None:
            return {"error": f"找不到 {name}"}
        if not any(s["placed"] for s in self.sources if s["name"] != name):
            return {"error": "请先置入至少一张图作为参考"}
        was_placed = src["placed"]
        old = (src["x"], src["y"], src.get("manual", False))
        src["placed"] = False
        self._composite_cache = None
        canvas = self.composite()
        src["placed"] = was_placed
        src["x"], src["y"], src["manual"] = old
        if canvas is None:
            return {"error": "画布为空"}
        hit = match_to_canvas(canvas, src["img"], threshold)
        if hit is None:
            return {"error": f"未能拟合「{name}」，可改用锚点对应"}
        self.push_undo()
        _, px, py = hit
        x0, y0, _, _ = self.canvas_size()
        src.update(x=int(px) + x0, y=int(py) + y0, placed=True, manual=False)
        self.failed = [n for n in self.failed if n != name]
        self._touch()
        return {"ok": True, "x": src["x"], "y": src["y"]}

    def place_from_anchor(self, name, canvas_rect, local_rect):
        src = self._find_source(name)
        if src is None:
            return {"error": f"找不到 {name}"}
        if not any(s["placed"] for s in self.sources if s["name"] != name):
            return {"error": "请先置入至少一张图作为参考"}
        x0, y0, _, _ = self.canvas_size()
        wx, wy = int(canvas_rect["x"]) - x0, int(canvas_rect["y"]) - y0
        bx, by = int(local_rect["x"]), int(local_rect["y"])
        px_local, py_local = place_by_anchor(wx, wy, bx, by)
        canvas = self.composite()
        if canvas is not None:
            hit = refine_by_patches(
                canvas, src["img"],
                (wx, wy, int(canvas_rect["w"]), int(canvas_rect["h"])),
                (bx, by, int(local_rect["w"]), int(local_rect["h"])),
            )
            if hit is not None:
                _, px_local, py_local = hit
        self.push_undo()
        src.update(x=int(px_local) + x0, y=int(py_local) + y0,
                   placed=True, manual=True)
        self.failed = [n for n in self.failed if n != name]
        self._touch()
        return {"ok": True, "x": src["x"], "y": src["y"]}

    def import_new_files(self):
        """扫描目录中新截图，仅入库不自动置入。"""
        if not self.dir or not self.sources:
            return {"added": 0, "msg": "请先打开目录"}
        skip = self._skip_names()
        known = {s["name"] for s in self.sources}
        base_hw = self.sources[0]["img"].shape[:2]
        new_imgs = []
        for f in sorted(os.listdir(self.dir), key=natural_key):
            if not f.lower().endswith((".png", ".jpg", ".jpeg", ".bmp", ".webp")):
                continue
            if f.lower() in skip or f in known:
                continue
            img = cv2.imread(os.path.join(self.dir, f), cv2.IMREAD_COLOR)
            if img is not None and img.shape[:2] == base_hw:
                new_imgs.append((f, img))
        if not new_imgs:
            return {"added": 0, "msg": "没有新截图"}
        order = max((s["order"] for s in self.sources), default=0) + 1
        for name, img in new_imgs:
            self.sources.append({
                "name": name, "img": img, "x": 0, "y": 0,
                "order": order, "placed": False, "manual": False,
            })
            self.failed.append(name)
            order += 1
        self._touch()
        return {"added": len(new_imgs), "msg": f"新增 {len(new_imgs)} 张（未置入）"}

    def rect_to_local(self, local_x, local_y, w, h):
        """画布局部坐标框 → 主覆盖源图的局部坐标。"""
        cov = self.covering_sources(local_x, local_y, w, h)
        if not cov:
            return None
        top = cov[0]
        return {
            "name": top["name"],
            "lx": top["sx"], "ly": top["sy"],
            "w": int(w), "h": int(h),
        }

    def align_from_pairs(self, pairs, reference_name=None):
        """按对应区域对齐：参照侧保持当前位置，只移动对应（move）侧。

        增量拼接时以画布上已拼好的图为锚，不强制固定 order 最小图。
        """
        del reference_name
        placed = {s["name"]: s for s in self.sources if s["placed"]}
        if not placed:
            return {"error": "请先置入至少一张图"}
        if not pairs:
            return {"error": "没有对应区域"}

        valid = []
        for pair in pairs:
            ref, move = pair["ref"], pair["move"]
            rn, mn = ref["name"], move["name"]
            if rn == mn:
                continue
            if rn not in placed or mn not in placed:
                continue
            valid.append(pair)
        if not valid:
            return {"error": "对应区域未能解析到可移动的图，请确认框选在已置入截图上"}

        positions = {name: (s["x"], s["y"]) for name, s in placed.items()}
        move_targets = {p["move"]["name"] for p in valid}
        hints = defaultdict(list)
        for _ in range(len(valid) + 1):
            hints = defaultdict(list)
            for pair in valid:
                ref, move = pair["ref"], pair["move"]
                rx, ry = positions[ref["name"]]
                hints[move["name"]].append((
                    rx + ref["lx"] - move["lx"],
                    ry + ref["ly"] - move["ly"],
                ))
            for name, pts in hints.items():
                if name in move_targets:
                    positions[name] = (
                        int(np.median([p[0] for p in pts])),
                        int(np.median([p[1] for p in pts])),
                    )

        moved = []
        unsettled = []
        updates = []
        for name in move_targets:
            src = placed[name]
            if name not in hints or not hints[name]:
                unsettled.append(name)
                continue
            nx, ny = positions[name]
            if (src["x"], src["y"]) != (nx, ny):
                updates.append((src, nx, ny))
                moved.append(name)
        if not updates:
            return {"ok": True, "moved": [], "unsettled": unsettled}
        self.push_undo()
        for src, nx, ny in updates:
            src.update(x=nx, y=ny, manual=True)
        self._touch()
        return {"ok": True, "moved": moved, "unsettled": unsettled}

    def rescan(self):
        if not self.sources:
            return {"added": 0, "msg": "请先打开目录"}
        skip = self._skip_names()
        known = {s["name"] for s in self.sources}
        new_imgs = []
        for f in sorted(os.listdir(self.dir), key=natural_key):
            if not f.lower().endswith((".png", ".jpg", ".jpeg", ".bmp", ".webp")):
                continue
            if f.lower() in skip or f in known:
                continue
            img = cv2.imread(os.path.join(self.dir, f), cv2.IMREAD_COLOR)
            if img is not None and img.shape[:2] == self.sources[0]["img"].shape[:2]:
                new_imgs.append((f, img))
        if not new_imgs:
            return {"added": 0, "msg": "目录中没有新截图"}
        self.push_undo()
        order = max((s["order"] for s in self.sources), default=0) + 1
        added = 0
        canvas = self.composite()
        for name, img in new_imgs:
            s = {"name": name, "img": img, "x": 0, "y": 0,
                 "order": order, "placed": False, "manual": False}
            order += 1
            hit = match_to_canvas(canvas, img, 0.90) if canvas is not None else None
            if hit is not None:
                _, px, py = hit
                x0, y0, _, _ = self.canvas_size()
                s.update(x=px + x0, y=py + y0, placed=True)
                added += 1
            else:
                self.failed.append(name)
            self.sources.append(s)
        self._touch()
        n_new = len(new_imgs)
        return {"added": added, "failed": self.failed,
                "msg": f"新导入 {n_new} 张，其中自动定位 {added} 张"}

    def restitch(self):
        self.push_undo()
        for s in self.sources:
            s.update(placed=False, manual=False)
        self.patches = []
        self.failed = []
        self._erase_cache = {}
        self._auto_stitch()
        self._touch()
        return {"ok": True, "placed": sum(1 for s in self.sources if s["placed"]),
                "failed": len(self.failed)}

    def canvas_size(self):
        pts = [(s["x"], s["y"], s["img"].shape[1], s["img"].shape[0])
               for s in self.sources if s["placed"]]
        if not pts:
            return 0, 0, 0, 0
        min_x = min(p[0] for p in pts)
        min_y = min(p[1] for p in pts)
        if self.origin_x is None or self.origin_y is None:
            self.origin_x = min_x
            self.origin_y = min_y
        else:
            if min_x < self.origin_x:
                self.origin_x = min_x
            if min_y < self.origin_y:
                self.origin_y = min_y
        x0, y0 = int(self.origin_x), int(self.origin_y)
        x1 = max(p[0] + p[2] for p in pts)
        y1 = max(p[1] + p[3] for p in pts)
        return x0, y0, x1 - x0, y1 - y0

    def composite(self):
        if self._composite_cache is not None:
            return self._composite_cache
        x0, y0, w, h = self.canvas_size()
        if w <= 0 or h <= 0 or w > MAX_CANVAS_SIDE or h > MAX_CANVAS_SIDE:
            return None
        canvas = np.zeros((h, w, 3), np.uint8)
        for s in sorted((s for s in self.sources if s["placed"]), key=lambda s: s["order"]):
            sx, sy = s["x"] - x0, s["y"] - y0
            ih, iw = s["img"].shape[:2]
            canvas[sy:sy + ih, sx:sx + iw] = s["img"]
        for p in self.patches:
            if not p.get("visible", True):
                continue
            tx, ty = p["x"] - x0, p["y"] - y0
            h2, w2 = p["h"], p["w"]
            tx = max(0, tx)
            ty = max(0, ty)
            w2 = min(w2, w - tx)
            h2 = min(h2, h - ty)
            if w2 <= 0 or h2 <= 0:
                continue
            if p.get("kind") == "erase":
                key = p.get("data", "")
                img = self._erase_cache.get(key)
                if img is None and key:
                    import base64
                    arr = np.frombuffer(base64.b64decode(key), np.uint8)
                    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                    if img is not None:
                        self._erase_cache[key] = img
                if img is None:
                    continue
                ih, iw = img.shape[:2]
                h2 = min(h2, ih)
                w2 = min(w2, iw)
                canvas[ty:ty + h2, tx:tx + w2] = img[:h2, :w2]
            elif p.get("kind") == "tile":
                tile = self.get_tile(p.get("tile_id"))
                if tile is None:
                    continue
                path = os.path.join(self.tiles_dir(), tile["file"])
                img = self._tile_cache.get(tile["id"])
                if img is None:
                    img = cv2.imread(path, cv2.IMREAD_COLOR)
                    if img is not None:
                        self._tile_cache[tile["id"]] = img
                if img is None:
                    continue
                ih, iw = img.shape[:2]
                h2 = min(h2, ih)
                w2 = min(w2, iw)
                canvas[ty:ty + h2, tx:tx + w2] = img[:h2, :w2]
            else:
                src = next((s for s in self.sources if s["name"] == p["name"]), None)
                if src is None:
                    continue
                ih, iw = src["img"].shape[:2]
                h2 = min(h2, ih - p["sy"])
                w2 = min(w2, iw - p["sx"])
                canvas[ty:ty + h2, tx:tx + w2] = \
                    src["img"][p["sy"]:p["sy"] + h2, p["sx"]:p["sx"] + w2]
        self._composite_cache = canvas
        return canvas

    def move_source(self, name, world_x, world_y):
        src = next((s for s in self.sources if s["name"] == name), None)
        if not src:
            return False
        self.push_undo()
        src.update(x=int(world_x), y=int(world_y),
                   placed=True, manual=True)
        self.failed = [n for n in self.failed if n != name]
        self._touch()
        return True

    def nudge_placed(self, dx, dy):
        """所有已置入图（及补丁）一起平移。相对位置不变。"""
        names = [s["name"] for s in self.sources if s["placed"]]
        return self.nudge_group(names, dx, dy)

    def _source_bbox(self, src):
        ih, iw = src["img"].shape[:2]
        return src["x"], src["y"], iw, ih

    def _rects_connected(self, a, b, gap=CONNECT_GAP):
        """包围盒重叠（或间距 <= gap）则视为连通。gap=0 时仅重叠/相接不算：须有正面积重叠。"""
        ax, ay, aw, ah = a
        bx, by, bw, bh = b
        ow = min(ax + aw, bx + bw) - max(ax, bx)
        oh = min(ay + ah, by + bh) - max(ay, by)
        if gap <= 0:
            return ow > 0 and oh > 0
        dx = max(0, -ow)
        dy = max(0, -oh)
        return dx <= gap and dy <= gap

    def connected_group(self, start_name, gap=CONNECT_GAP):
        """与 start_name 包围盒重叠的已置入图（已对齐拼在一起的才成组）。"""
        start = self._find_source(start_name)
        if start is None or not start["placed"]:
            return []
        placed = [s for s in self.sources if s["placed"]]
        boxes = {s["name"]: self._source_bbox(s) for s in placed}
        seen = {start_name}
        queue = [start_name]
        while queue:
            cur = queue.pop(0)
            cb = boxes[cur]
            for s in placed:
                n = s["name"]
                if n in seen:
                    continue
                if self._rects_connected(cb, boxes[n], gap):
                    seen.add(n)
                    queue.append(n)
        return list(seen)

    def _patch_overlaps_rects(self, patch, rects):
        px, py = int(patch.get("x", 0)), int(patch.get("y", 0))
        pw, ph = int(patch.get("w", 0)), int(patch.get("h", 0))
        pb = (px, py, pw, ph)
        return any(self._rects_connected(pb, r, gap=0) for r in rects)

    def nudge_group(self, names, dx, dy):
        """只平移指定已置入图，以及归属/覆盖到该组的补丁。"""
        dx, dy = int(dx), int(dy)
        if dx == 0 and dy == 0:
            return True
        name_set = set(names)
        srcs = [s for s in self.sources if s["placed"] and s["name"] in name_set]
        if not srcs:
            return False
        orig_rects = [self._source_bbox(s) for s in srcs]
        self.push_undo()
        for s in srcs:
            s["x"] += dx
            s["y"] += dy
            s["manual"] = True
        for p in self.patches:
            if p.get("name") in name_set or self._patch_overlaps_rects(p, orig_rects):
                p["x"] = int(p.get("x", 0)) + dx
                p["y"] = int(p.get("y", 0)) + dy
        self._touch()
        return True

    def align_canvas_anchors(self, ref_rect, move_rect, prefer_name=None):
        """把第二框所在源图平移，使第二框左上角对齐第一框左上角。"""
        dx = int(ref_rect["x"]) - int(move_rect["x"])
        dy = int(ref_rect["y"]) - int(move_rect["y"])
        name = None
        src = self._find_source(prefer_name) if prefer_name else None
        if src is not None and src["placed"]:
            name = prefer_name
        if not name:
            cov = self.covering_sources(
                move_rect["x"], move_rect["y"], move_rect["w"], move_rect["h"]
            )
            if not cov:
                return {"error": "第二块没有覆盖的源图"}
            name = cov[0]["name"]
            src = self._find_source(name)
        if src is None:
            return {"error": "找不到要对齐的源图"}
        self.move_source(name, src["x"] + dx, src["y"] + dy)
        return {"ok": True, "name": name, "dx": dx, "dy": dy}

    def stamp(self, name, world_x, world_y, w, h, sx, sy, record=True):
        if record:
            self.push_undo()
        self.patches.append({
            "x": int(world_x), "y": int(world_y),
            "w": int(w), "h": int(h),
            "name": name, "sx": int(sx), "sy": int(sy),
            "visible": True,
        })
        self._touch()

    def set_patch_visible(self, index, visible):
        if 0 <= index < len(self.patches):
            self.push_undo()
            self.patches[index]["visible"] = bool(visible)
            self._composite_cache = None
            self.save_session()
            return True
        return False

    def unstamp(self, index):
        if 0 <= index < len(self.patches):
            self.push_undo()
            self.patches.pop(index)
            self._touch()
            return True
        return False

    def covering_sources(self, world_x, world_y, w, h):
        wx, wy = int(world_x), int(world_y)
        items = []
        for s in (s for s in self.sources if s["placed"]):
            ih, iw = s["img"].shape[:2]
            ix0, iy0 = wx - s["x"], wy - s["y"]
            sx0, sy0 = max(0, ix0), max(0, iy0)
            sx1, sy1 = min(iw, ix0 + w), min(ih, iy0 + h)
            if sx1 > sx0 and sy1 > sy0:
                items.append({
                    "name": s["name"], "sx": int(sx0), "sy": int(sy0),
                    "cover": (sx1 - sx0) * (sy1 - sy0),
                })
        items.sort(key=lambda it: -it["cover"])
        return items

    def crop_source(self, name, sx, sy, w, h):
        src = next((s for s in self.sources if s["name"] == name), None)
        if src is None:
            return None
        ih, iw = src["img"].shape[:2]
        return src["img"][max(0, sy):min(ih, sy + h), max(0, sx):min(iw, sx + w)]

    def _world_target(self, target):
        x0, y0, w, h = self.canvas_size()
        tx = int(target["x"])
        ty = int(target["y"])
        tw = int(target["w"])
        th = int(target["h"])
        if tw <= 0 or th <= 0:
            return None
        return tx, ty, tw, th, x0, y0, w, h

    def _extract_patch(self, src_img, src_x, src_y, tw, th):
        ih, iw = src_img.shape[:2]
        sx0 = max(0, src_x)
        sy0 = max(0, src_y)
        sx1 = min(iw, src_x + tw)
        sy1 = min(ih, src_y + th)
        if sx1 <= sx0 or sy1 <= sy0:
            return None, 0, 0
        return src_img[sy0:sy1, sx0:sx1].copy(), sx0, sy0

    def _ring_and_inner_score(self, src_img, src_x, src_y, tw, th, margin=RING_MARGIN):
        """目标块与同源图外环背景的色差；越小越像干净地面（向量化，避免 Python 逐像素循环）。"""
        ih, iw = src_img.shape[:2]
        ox0 = max(0, src_x - margin)
        oy0 = max(0, src_y - margin)
        ox1 = min(iw, src_x + tw + margin)
        oy1 = min(ih, src_y + th + margin)
        if ox1 <= ox0 or oy1 <= oy0:
            return None
        block = src_img[oy0:oy1, ox0:ox1]
        by, bx = block.shape[:2]
        ix0, iy0 = src_x - ox0, src_y - oy0
        if iy0 + th > by or ix0 + tw > bx:
            return None
        mask = np.ones((by, bx), dtype=bool)
        mask[iy0:iy0 + th, ix0:ix0 + tw] = False
        ring = block[mask]
        if ring.size == 0:
            return None
        inner = block[iy0:iy0 + th, ix0:ix0 + tw]
        ring_ref = np.median(ring.reshape(-1, 3), axis=0)
        diff = np.abs(quantize(inner) - quantize(ring_ref.reshape(1, 1, 3)))
        return float(np.mean(diff))

    def erase_candidates(self, target):
        """列出可覆盖目标框的各源图及干净程度得分（越低越好）。"""
        wt = self._world_target(target)
        if wt is None:
            return []
        tx, ty, tw, th, x0, y0, w, h = wt
        if tx < x0 or ty < y0 or tx + tw > x0 + w or ty + th > y0 + h:
            return []
        cur = self.composite()
        if cur is None:
            return []
        lx, ly = tx - x0, ty - y0
        comp_inner = cur[ly:ly + th, lx:lx + tw]
        candidates = []
        for s in (s for s in self.sources if s["placed"]):
            src_x, src_y = tx - s["x"], ty - s["y"]
            inner, sx, sy = self._extract_patch(s["img"], src_x, src_y, tw, th)
            if inner is None or inner.shape[0] != th or inner.shape[1] != tw:
                continue
            score = self._ring_and_inner_score(s["img"], src_x, src_y, tw, th)
            if score is None:
                continue
            comp_diff = float(np.mean(np.abs(quantize(inner) - quantize(comp_inner))))
            candidates.append({
                "name": s["name"], "sx": sx, "sy": sy,
                "w": tw, "h": th, "score": round(score, 2),
                "comp_diff": round(comp_diff, 2),
                "preview": inner,
            })
        candidates.sort(key=lambda c: c["score"])
        return candidates

    def erase(self, target, source_name=None, candidates=None):
        """从多帧源图中选最干净的一帧，对目标区域盖章（真实像素，不 inpaint）。"""
        if candidates is None:
            candidates = self.erase_candidates(target)
        if not candidates:
            return {"error": "没有源图完整覆盖该区域，请扩大框选或补拍截图"}
        pick = None
        if source_name:
            pick = next((c for c in candidates if c["name"] == source_name), None)
            if pick is None:
                return {"error": f"源图 {source_name} 无法覆盖该区域"}
        else:
            pick = candidates[0]
        self.push_undo()
        self.stamp(pick["name"], target["x"], target["y"],
                   pick["w"], pick["h"], pick["sx"], pick["sy"], record=False)
        return {
            "ok": True, "name": pick["name"], "score": pick["score"],
            "candidates": len(candidates),
        }

    # ---------- 瓦片库 ----------

    def tiles_dir(self):
        return os.path.join(self.dir, "瓦片库") if self.dir else ""

    def tiles_index_path(self):
        return os.path.join(self.tiles_dir(), "index.json")

    def load_tiles(self):
        self.tiles = []
        path = self.tiles_index_path()
        if not path or not os.path.isfile(path):
            return
        data = self._read_json(path)
        if not isinstance(data, list):
            return
        self.tiles = [t for t in data if isinstance(t, dict) and t.get("id") and t.get("file")]

    def save_tiles_index(self):
        td = self.tiles_dir()
        if not td:
            return
        os.makedirs(td, exist_ok=True)
        try:
            with open(self.tiles_index_path(), "w", encoding="utf-8") as f:
                json.dump(self.tiles, f, ensure_ascii=False, indent=1)
        except OSError:
            pass

    def get_tile(self, tile_id):
        if not tile_id:
            return None
        return next((t for t in self.tiles if t["id"] == tile_id), None)

    def _next_tile_id(self):
        used = {t["id"] for t in self.tiles}
        n = 1
        while True:
            tid = f"tile_{n:03d}"
            if tid not in used:
                return tid
            n += 1

    def save_tile_from_canvas(self, world_x, world_y, w, h, name):
        comp = self.composite()
        if comp is None:
            return {"error": "画布为空"}
        x0, y0, cw, ch = self.canvas_size()
        lx, ly = int(world_x) - x0, int(world_y) - y0
        w, h = int(w), int(h)
        if w <= 0 or h <= 0:
            return {"error": "选区无效"}
        if lx < 0 or ly < 0 or lx + w > cw or ly + h > ch:
            return {"error": "选区超出画布范围"}
        crop = comp[ly:ly + h, lx:lx + w].copy()
        td = self.tiles_dir()
        if not td:
            return {"error": "未打开目录"}
        os.makedirs(td, exist_ok=True)
        tid = self._next_tile_id()
        fname = f"{tid}.png"
        path = os.path.join(td, fname)
        if not cv2.imwrite(path, crop):
            return {"error": "写入瓦片文件失败"}
        entry = {"id": tid, "name": name or tid, "w": w, "h": h, "file": fname}
        self.tiles.append(entry)
        self._tile_cache[tid] = crop
        self.save_tiles_index()
        return {"ok": True, "id": tid, "name": entry["name"]}

    def stamp_tile(self, tile_id, world_x, world_y, record=True):
        tile = self.get_tile(tile_id)
        if tile is None:
            return False
        if record:
            self.push_undo()
        self.patches.append({
            "kind": "tile",
            "tile_id": tile["id"],
            "x": int(world_x),
            "y": int(world_y),
            "w": int(tile["w"]),
            "h": int(tile["h"]),
            "visible": True,
        })
        self._touch()
        return True

    def delete_tile(self, tile_id):
        tile = self.get_tile(tile_id)
        if tile is None:
            return False
        path = os.path.join(self.tiles_dir(), tile["file"])
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass
        self.tiles = [t for t in self.tiles if t["id"] != tile_id]
        self._tile_cache.pop(tile_id, None)
        self.save_tiles_index()
        return True

    def rename_tile(self, tile_id, new_name):
        tile = self.get_tile(tile_id)
        if tile is None or not new_name.strip():
            return False
        tile["name"] = new_name.strip()
        self.save_tiles_index()
        return True

    def crop_canvas(self, world_x, world_y, w, h):
        """从合成图裁切区域（世界坐标）。"""
        comp = self.composite()
        if comp is None:
            return None
        x0, y0, _, _ = self.canvas_size()
        lx, ly = int(world_x) - x0, int(world_y) - y0
        w, h = int(w), int(h)
        ch, cw = comp.shape[:2]
        if lx < 0 or ly < 0 or lx + w > cw or ly + h > ch:
            return None
        return comp[ly:ly + h, lx:lx + w].copy()

    def patch_image(self, p):
        """补丁像素（BGR），供画布叠层显示。"""
        if not p.get("visible", True):
            return None
        if p.get("kind") == "erase":
            key = p.get("data", "")
            img = self._erase_cache.get(key)
            if img is None and key:
                import base64
                arr = np.frombuffer(base64.b64decode(key), np.uint8)
                img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                if img is not None:
                    self._erase_cache[key] = img
            return img
        if p.get("kind") == "tile":
            tile = self.get_tile(p.get("tile_id"))
            if tile is None:
                return None
            img = self._tile_cache.get(tile["id"])
            if img is None:
                path = os.path.join(self.tiles_dir(), tile["file"])
                img = cv2.imread(path, cv2.IMREAD_COLOR)
                if img is not None:
                    self._tile_cache[tile["id"]] = img
            return img
        src = next((s for s in self.sources if s["name"] == p.get("name")), None)
        if src is None:
            return None
        return self.crop_source(p["name"], p.get("sx", 0), p.get("sy", 0), p["w"], p["h"])

    def export(self, filename=None):
        out = os.path.join(self.dir, filename or "拼接结果.png")
        img = self.composite()
        if img is None:
            return {"error": "画布为空"}
        cv2.imwrite(out, img)
        name = os.path.basename(out)
        if name not in self.exports:
            self.exports.append(name)
        self.save_session()
        return {"path": out}

    def _touch(self):
        self.version += 1
        self._composite_cache = None
        self.save_session()

    def state(self):
        x0, y0, w, h = self.canvas_size()
        return {
            "dir": self.dir,
            "version": self.version,
            "canvas": {"x": x0, "y": y0, "w": w, "h": h},
            "sources": [
                {"name": s["name"], "x": s["x"], "y": s["y"],
                 "w": s["img"].shape[1], "h": s["img"].shape[0],
                 "placed": s["placed"], "manual": s.get("manual", False),
                 "order": s["order"]}
                for s in sorted(self.sources, key=lambda s: s["order"])
            ],
            "failed": self.failed,
            "patches": list(enumerate(self.patches)),
            "tiles": list(self.tiles),
            "grid": dict(self.grid),
        }


SNAP_THRESH = 8  # 边缘距网格线小于此像素才磁吸
DEFAULT_GRID = {"visible": False, "step": 64, "snap": False, "color": "#ffffff", "alpha": 200}


def normalize_grid(grid):
    g = dict(DEFAULT_GRID)
    if isinstance(grid, dict):
        g["visible"] = bool(grid.get("visible", g["visible"]))
        g["step"] = max(1, min(512, int(grid.get("step", g["step"]))))
        g["snap"] = bool(grid.get("snap", g["snap"]))
        color = str(grid.get("color", g["color"]))
        qc = QColor(color)
        g["color"] = color if qc.isValid() else g["color"]
        g["alpha"] = max(0, min(255, int(grid.get("alpha", g["alpha"]))))
    return g


def grid_qcolor(grid):
    g = normalize_grid(grid)
    c = QColor(g["color"])
    if not c.isValid():
        c = QColor(DEFAULT_GRID["color"])
    c.setAlpha(g["alpha"])
    return c


class GridOverlayItem(QGraphicsItem):
    """无限世界网格：视口内按世界坐标绘制单色线，叠在图层上方。"""

    def __init__(self):
        super().__init__()
        self._step = 64
        self._show = False
        self._color = grid_qcolor(DEFAULT_GRID)
        self.setZValue(4500)
        self.setAcceptedMouseButtons(Qt.MouseButton.NoButton)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsSelectable, False)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsFocusable, False)

    def set_options(self, visible, step, color=None):
        self._show = bool(visible)
        self._step = max(1, int(step))
        if color is not None:
            self._color = color
        self.update()

    def shape(self):
        return QPainterPath()

    def boundingRect(self):
        if self.scene():
            return self.scene().sceneRect()
        return QRectF(-20000, -20000, 40000, 40000)

    def paint(self, painter, option, _widget=None):
        if not self._show:
            return
        step = self._step
        rect = option.exposedRect
        if rect.isEmpty():
            return
        x0 = int(math.floor(rect.left()))
        y0 = int(math.floor(rect.top()))
        x1 = int(math.ceil(rect.right())) + 1
        y1 = int(math.ceil(rect.bottom())) + 1
        tf = painter.transform()
        scale = max(abs(tf.m11()), abs(tf.m22()), 1e-6)
        eff = step * scale
        skip = 1
        if step == 1 and scale < 8:
            skip = max(1, int(8 / scale))
        elif eff < 2:
            skip = max(1, int(2 / eff))
        pen = QPen(self._color)
        pen.setWidth(1)
        pen.setCosmetic(True)
        painter.setPen(pen)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, False)
        start_x = (x0 // step) * step
        start_y = (y0 // step) * step
        for x in range(start_x, x1 + step, step * skip):
            painter.drawLine(x, y0, x, y1)
        for y in range(start_y, y1 + step, step * skip):
            painter.drawLine(x0, y, x1, y)


class CanvasView(QGraphicsView):
    """无限画布：每张截图独立图层，网格铺满世界坐标。"""

    selection_done = pyqtSignal(int, int, int, int)
    source_moved = pyqtSignal(str, int, int)
    group_moved = pyqtSignal(list, int, int)
    tile_place = pyqtSignal(int, int)
    cursor_scene = pyqtSignal(float, float)
    selection_changed = pyqtSignal(list)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.setScene(QGraphicsScene(self))
        self.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, False)
        self.setDragMode(QGraphicsView.DragMode.NoDrag)
        self.setBackgroundBrush(QColor(20, 20, 20))
        self.setMouseTracking(True)
        self._wb = None
        self._mode = "view"
        self._grid_item = None
        self._layer_items = {}
        self._patch_items = []
        self._sel_item = None
        self._tile_preview = None
        self._pending_tile = None
        self._drag = None
        self._panning = False
        self._pan_press = None
        self._pan_scroll = None
        self._fit_pending = False
        self._zoom = 1.0
        self._corr_overlays = []
        self._corr_items = []
        self._grid_visible = False
        self._grid_step = 64
        self._grid_color = grid_qcolor(DEFAULT_GRID)
        self._snap_enabled = False
        self._selected_names = set()
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.NoAnchor)
        self.setResizeAnchor(QGraphicsView.ViewportAnchor.NoAnchor)
        self.setViewportUpdateMode(QGraphicsView.ViewportUpdateMode.MinimalViewportUpdate)
        self.horizontalScrollBar().setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.verticalScrollBar().setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self._ensure_grid()
        self._expand_scene()

    def set_grid_options(self, visible, step, snap, color=None):
        self._grid_visible = bool(visible)
        self._grid_step = max(1, min(512, int(step)))
        self._snap_enabled = bool(snap)
        if color is not None:
            self._grid_color = color
        if self._grid_item:
            self._grid_item.set_options(self._grid_visible, self._grid_step, self._grid_color)
        self.viewport().update()

    def selected_names(self):
        return list(self._selected_names)

    def select_group(self, names):
        self._selected_names = set(names) if names else set()
        self.selection_changed.emit(self.selected_names())

    def set_pending_tile(self, tile):
        self._pending_tile = tile
        self._clear_tile_preview()

    def _snap_thresh(self):
        return min(SNAP_THRESH, max(1, self._grid_step // 2))

    def magnetic_pos(self, x, y, w, h, origin=None):
        """靠近网格线时磁吸；不会把已贴齐的边拉回原网格（便于挪开一点点）。"""
        x, y = float(x), float(y)
        w, h = float(w), float(h)
        if not self._snap_enabled or self._grid_step < 1:
            return int(round(x)), int(round(y))
        step = self._grid_step
        thresh = self._snap_thresh()
        ox = oy = ow = oh = None
        if origin is not None:
            ox, oy, ow, oh = origin

        def edge_delta(v, start_v):
            g = round(v / step) * step
            d = g - v
            if abs(d) > thresh:
                return None
            if start_v is not None and abs(start_v - g) <= 1:
                return None
            return d

        dx = None
        for edge, start_e in ((x, ox), (x + w, None if ox is None else ox + ow)):
            d = edge_delta(edge, start_e)
            if d is not None and (dx is None or abs(d) < abs(dx)):
                dx = d
        dy = None
        for edge, start_e in ((y, oy), (y + h, None if oy is None else oy + oh)):
            d = edge_delta(edge, start_e)
            if d is not None and (dy is None or abs(d) < abs(dy)):
                dy = d
        return int(round(x + (0 if dx is None else dx))), int(round(y + (0 if dy is None else dy)))

    def snap_point(self, x, y):
        """放置点：靠近网格才吸附，否则自由。"""
        if not self._snap_enabled:
            return int(round(x)), int(round(y))
        nx, ny = self.magnetic_pos(x, y, 1, 1)
        return nx, ny

    def snap_selection_rect(self, x0, y0, x1, y1):
        """框选：两角对齐网格线，尺寸为网格整数倍。"""
        if self._snap_enabled and self._grid_step >= 1:
            step = self._grid_step
            x0 = int(round(x0 / step) * step)
            y0 = int(round(y0 / step) * step)
            x1 = int(round(x1 / step) * step)
            y1 = int(round(y1 / step) * step)
        else:
            x0, y0 = int(round(x0)), int(round(y0))
            x1, y1 = int(round(x1)), int(round(y1))
        left, right = sorted((x0, x1))
        top, bottom = sorted((y0, y1))
        w = right - left
        h = bottom - top
        if w == 0:
            w = self._grid_step if self._snap_enabled else 1
        if h == 0:
            h = self._grid_step if self._snap_enabled else 1
        return left, top, w, h

    def set_workbench(self, wb):
        self._wb = wb
        self._zoom = 1.0
        self._fit_pending = True
        self._clear_layers()
        if wb:
            g = wb.grid
            self.set_grid_options(
                g.get("visible", False), g.get("step", 64), g.get("snap", False),
                grid_qcolor(g),
            )
        self.refresh()

    def fit_view(self):
        items = [it for it in self._layer_items.values() if it.scene()]
        if not items:
            return
        br = items[0].sceneBoundingRect()
        for it in items[1:]:
            br = br.united(it.sceneBoundingRect())
        self.resetTransform()
        self.fitInView(br.adjusted(-40, -40, 40, 40), Qt.AspectRatioMode.KeepAspectRatio)
        self._zoom = self.transform().m11() or 1.0

    def set_mode(self, mode):
        self._mode = mode
        self._clear_selection_rect()
        self._clear_tile_preview()
        if mode != "place_tile":
            self._pending_tile = None

    def set_corr_overlays(self, overlays):
        self._corr_overlays = overlays or []
        self.refresh()

    def _ensure_grid(self):
        if self._grid_item is None:
            self._grid_item = GridOverlayItem()
            self.scene().addItem(self._grid_item)
        return self._grid_item

    def _expand_scene(self):
        xs, ys = [], []
        for it in self._layer_items.values():
            r = it.sceneBoundingRect()
            xs.extend([r.left(), r.right()])
            ys.extend([r.top(), r.bottom()])
        if xs:
            min_x, max_x = min(xs), max(xs)
            min_y, max_y = min(ys), max(ys)
            span = max(max_x - min_x, max_y - min_y, 800)
            pad = max(8000, span * 2)
            self.scene().setSceneRect(min_x - pad, min_y - pad,
                                      (max_x - min_x) + 2 * pad,
                                      (max_y - min_y) + 2 * pad)
        else:
            self.scene().setSceneRect(-20000, -20000, 40000, 40000)
        grid = self._ensure_grid()
        grid.prepareGeometryChange()
        grid.set_options(self._grid_visible, self._grid_step, self._grid_color)

    def _clear_layers(self):
        for it in self._layer_items.values():
            self.scene().removeItem(it)
        self._layer_items = {}
        for it in self._patch_items:
            self.scene().removeItem(it)
        self._patch_items = []

    def _source_item_at(self, pos):
        hits = []
        for item in self._layer_items.values():
            if item.sceneBoundingRect().contains(pos):
                hits.append(item)
        if not hits:
            return None
        hits.sort(key=lambda it: it.zValue(), reverse=True)
        return hits[0]

    def _clear_tile_preview(self):
        if self._tile_preview:
            self.scene().removeItem(self._tile_preview)
            self._tile_preview = None

    def _update_tile_preview(self, pos):
        if self._mode != "place_tile" or not self._pending_tile:
            self._clear_tile_preview()
            return
        tw = self._pending_tile.get("w", 0)
        th = self._pending_tile.get("h", 0)
        if tw <= 0 or th <= 0:
            return
        x, y = self.magnetic_pos(pos.x(), pos.y(), tw, th)
        if self._tile_preview is None:
            self._tile_preview = QGraphicsRectItem()
            self._tile_preview.setPen(QPen(QColor(180, 120, 255), 2))
            self._tile_preview.setBrush(QColor(180, 120, 255, 50))
            self._tile_preview.setZValue(5000)
            self.scene().addItem(self._tile_preview)
        self._tile_preview.setRect(x, y, tw, th)

    def refresh(self, rebuild_pixmap=True):
        del rebuild_pixmap
        if not self._wb:
            return
        st = self._wb.state()
        self._ensure_grid()
        placed = {s["name"]: s for s in st["sources"] if s["placed"]}
        by_src = {s["name"]: s for s in self._wb.sources}
        for name in list(self._layer_items):
            if name not in placed:
                self.scene().removeItem(self._layer_items.pop(name))
        for s in st["sources"]:
            if not s["placed"]:
                continue
            src = by_src.get(s["name"])
            if src is None:
                continue
            item = self._layer_items.get(s["name"])
            if item is None:
                item = QGraphicsPixmapItem(bgr_to_qpixmap(src["img"]))
                item.setOffset(0, 0)
                item.setTransformationMode(Qt.TransformationMode.FastTransformation)
                item.setData(0, s["name"])
                item.setShapeMode(QGraphicsPixmapItem.ShapeMode.BoundingRectShape)
                self.scene().addItem(item)
                self._layer_items[s["name"]] = item
            item.setPos(s["x"], s["y"])
            item.setZValue(int(s.get("order", 0)) + 1)
        for it in self._patch_items:
            self.scene().removeItem(it)
        self._patch_items = []
        for i, p in enumerate(self._wb.patches):
            img = self._wb.patch_image(p)
            if img is None:
                continue
            it = QGraphicsPixmapItem(bgr_to_qpixmap(img))
            it.setOffset(0, 0)
            it.setTransformationMode(Qt.TransformationMode.FastTransformation)
            it.setPos(int(p.get("x", 0)), int(p.get("y", 0)))
            it.setZValue(2000 + i)
            it.setAcceptedMouseButtons(Qt.MouseButton.NoButton)
            self.scene().addItem(it)
            self._patch_items.append(it)
        for r in self._corr_items:
            self.scene().removeItem(r)
        self._corr_items = []
        for ov in self._corr_overlays:
            r = QGraphicsRectItem(ov["x"], ov["y"], ov["w"], ov["h"])
            is_ref = ov.get("kind") == "ref"
            color = QColor(255, 80, 80) if is_ref else QColor(80, 160, 255)
            pen = QPen(color)
            pen.setWidth(2)
            r.setPen(pen)
            r.setBrush(QColor(color.red(), color.green(), color.blue(), 35))
            r.setZValue(4000)
            self.scene().addItem(r)
            self._corr_items.append(r)
        self._expand_scene()
        if self._grid_item and self._grid_visible:
            self._grid_item.update()
        if self._fit_pending:
            self._fit_pending = False
            self.fit_view()

    def _clear_selection_rect(self):
        if self._sel_item:
            self.scene().removeItem(self._sel_item)
            self._sel_item = None

    def wheelEvent(self, event: QWheelEvent):
        if event.angleDelta().y() == 0:
            return
        event.accept()
        mouse = event.position()
        scene_anchor = self.mapToScene(mouse.toPoint())
        step = 1.12 if event.angleDelta().y() > 0 else 1 / 1.12
        new_zoom = max(0.05, min(8.0, self._zoom * step))
        if abs(new_zoom - self._zoom) < 1e-9:
            return
        self._zoom = new_zoom
        self.resetTransform()
        self.scale(self._zoom, self._zoom)
        view_anchor = self.mapFromScene(scene_anchor)
        adjust = QPointF(view_anchor) - mouse
        self.horizontalScrollBar().setValue(int(self.horizontalScrollBar().value() + adjust.x()))
        self.verticalScrollBar().setValue(int(self.verticalScrollBar().value() + adjust.y()))
        if self._grid_item:
            self._grid_item.update()

    def mousePressEvent(self, event: QMouseEvent):
        if not self._wb:
            super().mousePressEvent(event)
            return
        pos = self.mapToScene(event.position().toPoint())
        if event.button() == Qt.MouseButton.MiddleButton:
            self._start_pan(event)
            return
        if event.button() != Qt.MouseButton.LeftButton:
            return
        if self._mode == "place_tile":
            if not self._pending_tile:
                return
            tw = self._pending_tile.get("w", 1)
            th = self._pending_tile.get("h", 1)
            x, y = self.magnetic_pos(pos.x(), pos.y(), tw, th)
            self.tile_place.emit(x, y)
            return
        if self._mode == "move":
            self.setFocus()
            alt = bool(event.modifiers() & Qt.KeyboardModifier.AltModifier)
            item = self._source_item_at(pos)
            if item and item.data(0):
                name = item.data(0)
                ip = item.pos()
                src = self._wb._find_source(name)
                iw = src["img"].shape[1] if src is not None else item.pixmap().width()
                ih = src["img"].shape[0] if src is not None else item.pixmap().height()
                if alt:
                    self.select_group([name])
                    self._drag = {
                        "kind": "move_single", "name": name,
                        "ox": pos.x() - ip.x(), "oy": pos.y() - ip.y(),
                        "sx": int(round(ip.x())), "sy": int(round(ip.y())),
                        "sw": iw, "sh": ih, "item": item,
                    }
                    return
                group = self._wb.connected_group(name)
                self.select_group(group)
                rects = {}
                for n in group:
                    it = self._layer_items.get(n)
                    srcn = self._wb._find_source(n)
                    if it is None or srcn is None:
                        continue
                    p = it.pos()
                    rects[n] = (p.x(), p.y(), srcn["img"].shape[1], srcn["img"].shape[0])
                self._drag = {
                    "kind": "move_group", "names": group,
                    "start": QPointF(pos),
                    "dx": 0, "dy": 0, "rects": rects,
                }
                return
            self.select_group([])
            self._start_pan(event)
            return
        if self._mode in ("fix", "remove", "anchor", "correspondence", "save_tile"):
            if self._snap_enabled and self._grid_step >= 1:
                step = self._grid_step
                x0 = int(round(pos.x() / step) * step)
                y0 = int(round(pos.y() / step) * step)
            else:
                x0, y0 = int(round(pos.x())), int(round(pos.y()))
            self._drag = {"kind": "sel", "x0": x0, "y0": y0}
            self._sel_item = QGraphicsRectItem()
            if self._mode == "anchor":
                pen_color = QColor(255, 80, 80)
            elif self._mode == "correspondence":
                pen_color = QColor(255, 120, 60)
            elif self._mode == "save_tile":
                pen_color = QColor(180, 120, 255)
            else:
                pen_color = QColor(255, 215, 0)
            self._sel_item.setPen(selection_pen(pen_color))
            self._sel_item.setBrush(QColor(pen_color.red(), pen_color.green(), pen_color.blue(), 25))
            self._sel_item.setZValue(5000)
            self.scene().addItem(self._sel_item)
            return
        self._start_pan(event)

    def _start_pan(self, event: QMouseEvent):
        self._panning = True
        self._pan_press = event.position()
        self._pan_scroll = QPointF(
            self.horizontalScrollBar().value(),
            self.verticalScrollBar().value(),
        )
        self.setCursor(Qt.CursorShape.ClosedHandCursor)

    def mouseMoveEvent(self, event: QMouseEvent):
        pos = self.mapToScene(event.position().toPoint())
        self.cursor_scene.emit(pos.x(), pos.y())
        if self._panning and self._pan_press is not None and self._pan_scroll is not None:
            d = event.position() - self._pan_press
            self.horizontalScrollBar().setValue(int(self._pan_scroll.x() - d.x()))
            self.verticalScrollBar().setValue(int(self._pan_scroll.y() - d.y()))
            if self._grid_item:
                self._grid_item.update()
            return
        if self._mode == "place_tile":
            self._update_tile_preview(pos)
            self.setCursor(Qt.CursorShape.CrossCursor)
            return
        if not self._drag:
            if self._mode == "move":
                if self._source_item_at(pos):
                    self.setCursor(Qt.CursorShape.SizeAllCursor)
                else:
                    self.setCursor(Qt.CursorShape.OpenHandCursor)
            return
        if self._drag["kind"] == "move_single":
            item = self._drag["item"]
            nx = pos.x() - self._drag["ox"]
            ny = pos.y() - self._drag["oy"]
            nx, ny = self.magnetic_pos(
                nx, ny, self._drag["sw"], self._drag["sh"],
                origin=(self._drag["sx"], self._drag["sy"], self._drag["sw"], self._drag["sh"]),
            )
            item.setPos(nx, ny)
            self._drag["nx"] = nx
            self._drag["ny"] = ny
        elif self._drag["kind"] == "move_group":
            d = pos - self._drag["start"]
            dx, dy = int(round(d.x())), int(round(d.y()))
            rects = self._drag["rects"]
            if rects:
                min_x = min(rx + dx for rx, _ry, _rw, _rh in rects.values())
                min_y = min(ry + dy for _rx, ry, _rw, _rh in rects.values())
                max_x = max(rx + rw + dx for rx, _ry, rw, _rh in rects.values())
                max_y = max(ry + rh + dy for _rx, ry, _rw, rh in rects.values())
                o_min_x = min(rx for rx, _ry, _rw, _rh in rects.values())
                o_min_y = min(ry for _rx, ry, _rw, _rh in rects.values())
                o_max_x = max(rx + rw for rx, _ry, rw, _rh in rects.values())
                o_max_y = max(ry + rh for _rx, ry, _rw, rh in rects.values())
                sx, sy = self.magnetic_pos(
                    min_x, min_y, max_x - min_x, max_y - min_y,
                    origin=(o_min_x, o_min_y, o_max_x - o_min_x, o_max_y - o_min_y),
                )
                dx += sx - min_x
                dy += sy - min_y
            self._drag["dx"] = dx
            self._drag["dy"] = dy
            for n, (rx, ry, _rw, _rh) in rects.items():
                item = self._layer_items.get(n)
                if item is not None:
                    item.setPos(rx + dx, ry + dy)
        elif self._drag["kind"] == "sel" and self._sel_item:
            x, y, w, h = self.snap_selection_rect(
                self._drag["x0"], self._drag["y0"], pos.x(), pos.y(),
            )
            self._sel_item.setRect(x, y, w, h)

    def mouseReleaseEvent(self, event: QMouseEvent):
        if self._panning and event.button() in (Qt.MouseButton.LeftButton, Qt.MouseButton.MiddleButton):
            self._panning = False
            self._pan_press = None
            self._pan_scroll = None
            self.setCursor(Qt.CursorShape.ArrowCursor)
        if not self._drag:
            return
        d = self._drag
        self._drag = None
        if d["kind"] == "move_single" and "nx" in d:
            nx, ny = d["nx"], d["ny"]
            if d.get("sx") == nx and d.get("sy") == ny:
                return
            self.source_moved.emit(d["name"], nx, ny)
            self.refresh()
        elif d["kind"] == "move_group":
            dx, dy = int(round(d.get("dx", 0))), int(round(d.get("dy", 0)))
            if dx == 0 and dy == 0:
                self.refresh()
                return
            self.group_moved.emit(list(d.get("names") or []), dx, dy)
            self.refresh()
        elif d["kind"] == "sel" and self._sel_item:
            r = self._sel_item.rect()
            x, y, w, h = int(r.x()), int(r.y()), int(r.width()), int(r.height())
            self._clear_selection_rect()
            if w >= 8 and h >= 8:
                self.selection_done.emit(x, y, w, h)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.wb = Workbench()
        self._mode = "view"
        self._pending_rect = None
        self._anchor_first = None
        self._corr_pairs = []
        self._corr_pending_ref = None
        self._corr_step = "ref"
        self._pending_tile_id = None
        self._status_base = ""
        self._worker = None
        self._dir_watcher = QFileSystemWatcher(self)
        self._watch_timer = QTimer(self)
        self._watch_timer.setSingleShot(True)
        self._watch_timer.setInterval(400)
        self._watch_timer.timeout.connect(self._on_dir_changed_debounced)
        self._dir_watcher.directoryChanged.connect(self._on_dir_watch_event)
        self.setWindowTitle("截图拼接工作台")
        self.resize(1280, 800)
        self._build_ui()
        self.canvas.source_moved.connect(self._on_source_moved)
        self.canvas.group_moved.connect(self._on_group_moved)
        self.canvas.selection_done.connect(self._on_selection)
        self.canvas.tile_place.connect(self._on_tile_place)
        self.canvas.cursor_scene.connect(self._on_cursor_scene)
        self.canvas.selection_changed.connect(self._on_canvas_selection_changed)
        for seq, slot in (("Ctrl+Z", self._undo), ("Ctrl+Y", self._redo),
                          ("Ctrl+Shift+Z", self._redo)):
            sc = QShortcut(QKeySequence(seq), self)
            sc.activated.connect(slot)
        sc_preview = QShortcut(QKeySequence(Qt.Key.Key_Space), self.src_list)
        sc_preview.activated.connect(self._preview_selected_source)
        sc_esc = QShortcut(QKeySequence(Qt.Key.Key_Escape), self)
        sc_esc.setContext(Qt.ShortcutContext.ApplicationShortcut)
        sc_esc.activated.connect(self._on_escape)
        self._setup_arrow_nudge_shortcuts()

    def _on_escape(self):
        if self._mode == "place_tile":
            self._set_mode("view")

    def _setup_arrow_nudge_shortcuts(self):
        for key, dx, dy in (
            (Qt.Key.Key_Up, 0, -1), (Qt.Key.Key_Down, 0, 1),
            (Qt.Key.Key_Left, -1, 0), (Qt.Key.Key_Right, 1, 0),
        ):
            sc = QShortcut(QKeySequence(key), self)
            sc.setContext(Qt.ShortcutContext.WidgetWithChildrenShortcut)
            sc.activated.connect(lambda dx=dx, dy=dy: self._arrow_nudge(dx, dy))

    def _arrow_nudge(self, dx, dy):
        if self._mode != "move":
            return
        fw = QApplication.focusWidget()
        if fw is not None and fw in (self.dir_edit, self.spin_grid):
            return
        names = self.canvas.selected_names()
        if not names:
            return
        self._on_group_moved(names, dx, dy)

    def _on_canvas_selection_changed(self, names):
        if not names:
            return
        if len(names) == 1:
            msg = f"已选 1 张：{names[0]}"
        else:
            msg = f"已选 {len(names)} 张连通组"
        msg += "（方向键 ±1px 微调）"
        self._status_base = msg
        self.status.setText(msg)

    def _nudge_from_list_click(self, item):
        if self._mode != "move":
            return
        name = item.data(Qt.ItemDataRole.UserRole)
        src = self.wb._find_source(name) if name else None
        if src and src.get("placed"):
            self.canvas.select_group(self.wb.connected_group(name))
            self.canvas.setFocus()

    def _build_ui(self):
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)

        top = QHBoxLayout()
        self.dir_edit = QLineEdit()
        self.dir_edit.setPlaceholderText("截图目录路径")
        top.addWidget(self.dir_edit, 1)
        for text, slot in [
            ("打开目录", self._pick_dir),
            ("刷新", self._refresh_dir),
            ("置入画布", self._place_selected),
            ("锚点对应", lambda: self._set_mode("anchor")),
            ("对应拼接", lambda: self._set_mode("correspondence")),
            ("执行对齐", self._execute_align),
            ("移动", lambda: self._set_mode("move")),
            ("修正取样", lambda: self._set_mode("fix")),
            ("去除", lambda: self._set_mode("remove")),
            ("存为瓦片", lambda: self._set_mode("save_tile")),
            ("贴瓦片", lambda: self._set_mode("place_tile")),
            ("撤销", self._undo),
            ("重做", self._redo),
            ("导出", self._export),
        ]:
            b = QPushButton(text)
            b.clicked.connect(slot)
            top.addWidget(b)
        self.chk_grid = QCheckBox("网格")
        self.chk_grid.toggled.connect(self._on_grid_toggled)
        top.addWidget(self.chk_grid)
        top.addWidget(QLabel("间距"))
        self.spin_grid = QSpinBox()
        self.spin_grid.setRange(1, 512)
        self.spin_grid.setValue(64)
        self.spin_grid.setSuffix("px")
        self.spin_grid.valueChanged.connect(self._on_grid_step_changed)
        top.addWidget(self.spin_grid)
        self.btn_grid_color = QPushButton()
        self.btn_grid_color.setFixedSize(28, 24)
        self.btn_grid_color.setToolTip("网格线颜色（含透明度）")
        self.btn_grid_color.clicked.connect(self._pick_grid_color)
        top.addWidget(self.btn_grid_color)
        self.chk_snap = QCheckBox("吸附")
        self.chk_snap.toggled.connect(self._on_snap_toggled)
        top.addWidget(self.chk_snap)
        layout.addLayout(top)

        split = QSplitter(Qt.Orientation.Horizontal)
        left = QWidget()
        left_l = QVBoxLayout(left)
        left_l.addWidget(QLabel("截图图层（双击置入/移出，空格预览，右键更多）"))
        self.src_list = QListWidget()
        self.src_list.setIconSize(QSize(96, 64))
        self.src_list.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        left_l.addWidget(self.src_list, 1)
        corr_hdr = QHBoxLayout()
        corr_hdr.addWidget(QLabel("对应区域（右键删除）"))
        self.btn_clear_corr = QPushButton("清空")
        self.btn_clear_corr.clicked.connect(self._clear_correspondence)
        corr_hdr.addWidget(self.btn_clear_corr)
        left_l.addLayout(corr_hdr)
        self.corr_list = QListWidget()
        self.corr_list.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        left_l.addWidget(self.corr_list, 1)
        tile_hdr = QHBoxLayout()
        tile_hdr.addWidget(QLabel("瓦片库（双击贴图，ESC 退出）"))
        left_l.addLayout(tile_hdr)
        self.tile_list = QListWidget()
        self.tile_list.setViewMode(QListView.ViewMode.IconMode)
        self.tile_list.setFlow(QListView.Flow.LeftToRight)
        self.tile_list.setWrapping(True)
        self.tile_list.setResizeMode(QListView.ResizeMode.Adjust)
        self.tile_list.setMovement(QListView.Movement.Static)
        self.tile_list.setSpacing(6)
        self.tile_list.setIconSize(QSize(64, 64))
        self.tile_list.setGridSize(QSize(72, 72))
        self.tile_list.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        left_l.addWidget(self.tile_list, 1)
        left_l.addWidget(QLabel("修正补丁（勾选=显示，取消=隐藏，右键删除）"))
        self.patch_list = QListWidget()
        self.patch_list.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        left_l.addWidget(self.patch_list, 1)
        self.cand_group = QGroupBox("候选源")
        cand_l = QVBoxLayout(self.cand_group)
        cand_l.addWidget(QLabel(
            "框选区域后出现：修正模式点选盖章；去除模式点选换用其它截图。"
        ))
        cand_l.addWidget(QLabel("得分越低表示该帧越像干净背景。"))
        self.cand_list = QListWidget()
        cand_l.addWidget(self.cand_list)
        left_l.addWidget(self.cand_group, 1)
        split.addWidget(left)

        self.canvas = CanvasView()
        split.addWidget(self.canvas)
        split.setStretchFactor(1, 1)
        layout.addWidget(split, 1)

        self.status = QLabel("就绪")
        layout.addWidget(self.status)

        self.cand_list.itemClicked.connect(self._on_candidate_click)
        self.patch_list.customContextMenuRequested.connect(self._patch_context_menu)
        self.patch_list.itemChanged.connect(self._on_patch_visibility)
        self.src_list.itemDoubleClicked.connect(self._on_src_double_click)
        self.src_list.itemClicked.connect(self._nudge_from_list_click)
        self.src_list.customContextMenuRequested.connect(self._src_context_menu)
        self.corr_list.customContextMenuRequested.connect(self._corr_context_menu)
        self.tile_list.itemDoubleClicked.connect(self._on_tile_double_click)
        self.tile_list.customContextMenuRequested.connect(self._tile_context_menu)
        self._update_grid_color_btn()

    def _grid_color_style(self, color):
        return (
            f"background-color: rgba({color.red()},{color.green()},{color.blue()},{color.alpha()});"
            "border: 1px solid #888;"
        )

    def _update_grid_color_btn(self, color=None):
        c = color or grid_qcolor(self.wb.grid)
        self.btn_grid_color.setStyleSheet(self._grid_color_style(c))

    def _pick_grid_color(self):
        initial = grid_qcolor(self.wb.grid)
        picked = QColorDialog.getColor(
            initial, self, "网格线颜色",
            QColorDialog.ColorDialogOption.ShowAlphaChannel,
        )
        if not picked.isValid():
            return
        self.wb.grid["color"] = picked.name(QColor.NameFormat.HexRgb)
        self.wb.grid["alpha"] = picked.alpha()
        self._update_grid_color_btn(picked)
        self._apply_grid()

    def _sync_grid_ui(self):
        g = self.wb.grid
        g = normalize_grid(g)
        self.wb.grid = g
        self.chk_grid.blockSignals(True)
        self.spin_grid.blockSignals(True)
        self.chk_snap.blockSignals(True)
        self.chk_grid.setChecked(bool(g.get("visible")))
        self.spin_grid.setValue(int(g.get("step", 64)))
        self.chk_snap.setChecked(bool(g.get("snap")))
        self.chk_grid.blockSignals(False)
        self.spin_grid.blockSignals(False)
        self.chk_snap.blockSignals(False)
        self._update_grid_color_btn()
        self.canvas.set_grid_options(
            g.get("visible", False), g.get("step", 64), g.get("snap", False), grid_qcolor(g),
        )

    def _apply_grid(self):
        color = self.wb.grid.get("color", DEFAULT_GRID["color"])
        alpha = int(self.wb.grid.get("alpha", DEFAULT_GRID["alpha"]))
        self.wb.grid = {
            "visible": self.chk_grid.isChecked(),
            "step": self.spin_grid.value(),
            "snap": self.chk_snap.isChecked(),
            "color": color,
            "alpha": alpha,
        }
        self.canvas.set_grid_options(
            self.wb.grid["visible"], self.wb.grid["step"], self.wb.grid["snap"],
            grid_qcolor(self.wb.grid),
        )
        self.wb.save_session()

    def _on_grid_toggled(self, _on):
        self._apply_grid()

    def _on_grid_step_changed(self, _v):
        self._apply_grid()

    def _on_snap_toggled(self, _on):
        self._apply_grid()

    def _on_cursor_scene(self, x, y):
        step = self.wb.grid.get("step", 64) or 64
        gx = int(x // step)
        gy = int(y // step)
        base = self._status_base or self.status.text().split("  |  ")[0]
        self.status.setText(f"{base}  |  坐标 ({int(x)},{int(y)})  格 ({gx},{gy})")

    def _on_tile_place(self, x, y):
        tid = self._pending_tile_id
        if not tid:
            QMessageBox.information(self, "贴瓦片", "请先在瓦片库选中一个瓦片")
            return
        if self.wb.stamp_tile(tid, x, y):
            self.canvas.refresh()
            self._refresh_lists()
            tile = self.wb.get_tile(tid)
            name = tile["name"] if tile else tid
            self.status.setText(f"已贴瓦片「{name}」@ ({x},{y})")
        else:
            QMessageBox.warning(self, "贴瓦片", "贴图失败")

    def _on_tile_double_click(self, item):
        tid = item.data(Qt.ItemDataRole.UserRole)
        if not tid:
            return
        self._select_tile_for_place(tid)
        self._set_mode("place_tile")

    def _select_tile_for_place(self, tile_id):
        tile = self.wb.get_tile(tile_id)
        if not tile:
            return
        self._pending_tile_id = tile_id
        self.canvas.set_pending_tile(tile)
        self.tile_list.blockSignals(True)
        for i in range(self.tile_list.count()):
            it = self.tile_list.item(i)
            if it.data(Qt.ItemDataRole.UserRole) == tile_id:
                self.tile_list.setCurrentItem(it)
                break
        self.tile_list.blockSignals(False)

    def _tile_context_menu(self, pos):
        item = self.tile_list.itemAt(pos)
        if not item:
            return
        tid = item.data(Qt.ItemDataRole.UserRole)
        tile = self.wb.get_tile(tid) if tid else None
        if not tile:
            return
        menu = QMenu(self)
        place_act = menu.addAction("贴到画布")
        rename_act = menu.addAction("重命名")
        delete_act = menu.addAction("删除瓦片")
        chosen = menu.exec(self.tile_list.mapToGlobal(pos))
        if chosen == place_act:
            self._select_tile_for_place(tid)
            self._set_mode("place_tile")
        elif chosen == rename_act:
            name, ok = QInputDialog.getText(self, "重命名瓦片", "名称：", text=tile["name"])
            if ok and name.strip():
                self.wb.rename_tile(tid, name.strip())
                self._refresh_tile_list()
        elif chosen == delete_act:
            if QMessageBox.question(
                self, "删除瓦片", f"确定删除瓦片「{tile['name']}」？\n（已贴到画布的补丁不会自动删除）",
            ) == QMessageBox.StandardButton.Yes:
                self.wb.delete_tile(tid)
                if self._pending_tile_id == tid:
                    self._pending_tile_id = None
                    self.canvas.set_pending_tile(None)
                self._refresh_tile_list()

    def _refresh_tile_list(self):
        self.tile_list.clear()
        for t in self.wb.tiles:
            li = QListWidgetItem()
            li.setData(Qt.ItemDataRole.UserRole, t["id"])
            li.setToolTip(f"{t['name']}  {t['w']}×{t['h']}")
            li.setSizeHint(QSize(72, 72))
            path = os.path.join(self.wb.tiles_dir(), t["file"])
            if os.path.isfile(path):
                img = cv2.imread(path, cv2.IMREAD_COLOR)
                if img is not None:
                    li.setIcon(thumb_icon(img, 64, 64))
            self.tile_list.addItem(li)

    def _patch_context_menu(self, pos):
        item = self.patch_list.itemAt(pos)
        if not item:
            return
        menu = QMenu(self)
        delete_act = menu.addAction("删除此补丁")
        if menu.exec(self.patch_list.mapToGlobal(pos)) == delete_act:
            self._delete_patch(item)

    def _on_patch_visibility(self, item):
        if not (item.flags() & Qt.ItemFlag.ItemIsUserCheckable):
            return
        idx = item.data(Qt.ItemDataRole.UserRole)
        if idx is None:
            return
        visible = item.checkState() == Qt.CheckState.Checked
        if self.wb.patches[idx].get("visible", True) == visible:
            return
        self.wb.set_patch_visible(idx, visible)
        self.canvas.refresh()

    def _set_mode(self, mode):
        if mode == self._mode and mode != "view":
            mode = "view"
        self._mode = mode
        self.canvas.set_mode(mode)
        self._anchor_first = None
        hints = {
            "view": "查看：滚轮缩放，左键/中键拖空白处平移画布",
            "move": "移动：点击选中连通组（Alt+点击=单张）；拖图层（吸附=靠近网格线才贴边）；方向键±1px 不吸附；拖空白/中键平移。Ctrl+Z 撤销",
            "fix": "修正取样：框选区域，点击下方候选源盖章",
            "remove": "去除：框选要去掉的对象，自动选最干净源图盖章",
            "anchor": "锚点：未置入图→画布框选再弹窗框选。已拼的图→在画布连续框两处相同地貌对齐",
            "correspondence": "对应拼接：交替框选参照区（红）与对应区（蓝，须在不同截图上）→ 点「执行对齐」",
            "save_tile": "存为瓦片：框选画布区域 → 输入名称保存到瓦片库（吸附开时对齐网格）",
            "place_tile": "贴瓦片：双击瓦片库缩略图进入 → 画布点击放置（吸附开时对齐网格）→ ESC 退出",
        }
        self._status_base = hints.get(mode, "")
        self.status.setText(self._status_base)
        self.cand_list.clear()
        if mode != "move":
            self.canvas.select_group([])
        if mode == "place_tile":
            item = self.tile_list.currentItem()
            if item:
                tid = item.data(Qt.ItemDataRole.UserRole)
                if tid:
                    self._select_tile_for_place(tid)
            elif self._pending_tile_id:
                self._select_tile_for_place(self._pending_tile_id)
        elif mode != "place_tile":
            self._pending_tile_id = None
            self.canvas.set_pending_tile(None)
        if mode != "correspondence":
            self._corr_step = "ref"
            self._corr_pending_ref = None

    def _setup_dir_watcher(self, directory):
        paths = self._dir_watcher.directories()
        if paths:
            self._dir_watcher.removePaths(paths)
        if directory and os.path.isdir(directory):
            self._dir_watcher.addPath(directory)

    def _on_dir_watch_event(self, _path):
        self._watch_timer.start()

    def _on_dir_changed_debounced(self):
        if not self.wb.dir:
            return
        r = self.wb.import_new_files()
        if r.get("added", 0) > 0:
            self._refresh_lists()
            self.status.setText(r.get("msg", "发现新截图"))

    def _pick_dir(self):
        d = QFileDialog.getExistingDirectory(self, "选择截图目录")
        if not d:
            return
        self.dir_edit.setText(d)
        self._load_directory(d)

    def _refresh_dir(self):
        d = self.dir_edit.text().strip().strip('"')
        if not d or not os.path.isdir(d):
            QMessageBox.information(self, "刷新", "请先输入或选择有效的截图目录")
            return
        self._load_directory(d)

    def _load_directory(self, d):
        r = self.wb.load_dir(d, progress=QApplication.processEvents)
        if r.get("error"):
            QMessageBox.warning(self, "错误", r["error"])
            return
        self._setup_dir_watcher(d)
        self._corr_pairs.clear()
        self._corr_pending_ref = None
        self._corr_step = "ref"
        self.canvas.set_corr_overlays([])
        self.canvas.set_workbench(self.wb)
        self._sync_grid_ui()
        self._refresh_lists()
        self._refresh_tile_list()
        placed = sum(1 for s in self.wb.sources if s["placed"])
        n = len(self.wb.sources)
        if placed:
            self.status.setText(f"已加载 {n} 张（会话恢复 {placed} 张已置入）")
        else:
            self.status.setText(f"已导入 {n} 张，尚未置入。双击一张作为起点。")

    def _preview_selected_source(self):
        name = self._selected_source_name()
        if not name:
            return
        src = self.wb._find_source(name)
        if src is None:
            return
        ImagePreviewDialog(src["img"], name, self).exec()

    def _selected_source_name(self):
        item = self.src_list.currentItem()
        if not item:
            return None
        return item.data(Qt.ItemDataRole.UserRole)

    def _on_src_double_click(self, item):
        name = item.data(Qt.ItemDataRole.UserRole)
        src = self.wb._find_source(name) if name else None
        if not src:
            return
        if src["placed"]:
            self._unplace_named(name)
        else:
            self._place_named(name)

    def _src_context_menu(self, pos):
        item = self.src_list.itemAt(pos)
        if not item:
            return
        name = item.data(Qt.ItemDataRole.UserRole)
        src = self.wb._find_source(name) if name else None
        if not src:
            return
        menu = QMenu(self)
        if src["placed"]:
            act = menu.addAction("移出画布")
        else:
            act = menu.addAction("置入画布")
        fit_act = menu.addAction("自动拟合此图")
        preview_act = menu.addAction("预览大图")
        chosen = menu.exec(self.src_list.mapToGlobal(pos))
        if chosen == act:
            if src["placed"]:
                self._unplace_named(name)
            else:
                self._place_named(name)
        elif chosen == fit_act:
            self._match_named(name)
        elif chosen == preview_act:
            ImagePreviewDialog(src["img"], name, self).exec()

    def _place_selected(self):
        name = self._selected_source_name()
        if not name:
            QMessageBox.information(self, "置入", "请先在左侧列表选一张图")
            return
        self._place_named(name)

    def _place_named(self, name):
        src = self.wb._find_source(name)
        if not src:
            return
        if src["placed"]:
            self.status.setText(f"「{name}」已在画布上")
            return
        first = not any(s["placed"] for s in self.wb.sources)
        self.wb.place_source(name, manual=first)
        self.canvas._fit_pending = first
        self.canvas.refresh()
        self._refresh_lists()
        self.status.setText(f"已置入「{name}」" + ("（起点）" if first else "，可用移动微调"))

    def _unplace_named(self, name):
        self.wb.unplace_source(name)
        self.canvas.refresh()
        self._refresh_lists()
        self.status.setText(f"已移出「{name}」")

    def _match_selected(self):
        name = self._selected_source_name()
        if not name:
            QMessageBox.information(self, "拟合", "请先在左侧列表选一张图")
            return
        self._match_named(name)

    def _match_named(self, name):
        self._run_busy("正在拟合…", lambda: self.wb.match_single_source(name),
                       lambda r: self._after_match(name, r))

    def _after_match(self, name, r):
        if r.get("error"):
            QMessageBox.warning(self, "拟合", r["error"])
            return
        self.canvas.refresh()
        self._refresh_lists()
        self.status.setText(f"已拟合「{name}」")
        self._set_mode("move")

    def _on_correspondence_rect(self, rect):
        local = self.wb.rect_to_local(rect["x"], rect["y"], rect["w"], rect["h"])
        if local is None:
            QMessageBox.information(self, "对应拼接", "框选区域没有覆盖已置入的截图")
            return
        if self._corr_step == "ref":
            self._corr_pending_ref = {**rect, **local}
            self._corr_step = "move"
            self._update_corr_overlays()
            self.status.setText(
                f"已记 #{len(self._corr_pairs) + 1} 参照区（{local['name']}）。"
                "请框选另一张图上的对应区域"
            )
            return
        ref = self._corr_pending_ref
        if ref is None:
            self._corr_step = "ref"
            return
        if local["name"] == ref["name"]:
            QMessageBox.information(self, "对应拼接", "对应区域须在另一张截图上，请重新框选")
            return
        pair = {
            "ref": {"name": ref["name"], "lx": ref["lx"], "ly": ref["ly"],
                    "w": ref["w"], "h": ref["h"]},
            "move": {"name": local["name"], "lx": local["lx"], "ly": local["ly"],
                     "w": local["w"], "h": local["h"]},
            "_canvas": {
                "ref": {"x": ref["x"], "y": ref["y"], "w": ref["w"], "h": ref["h"]},
                "move": {"x": rect["x"], "y": rect["y"], "w": rect["w"], "h": rect["h"]},
            },
        }
        self._corr_pairs.append(pair)
        self._corr_pending_ref = None
        self._corr_step = "ref"
        self._refresh_corr_list()
        self._update_corr_overlays()
        self.status.setText(
            f"已添加对应 #{len(self._corr_pairs)}：{ref['name']} ↔ {local['name']}。"
            "可继续框选或点「执行对齐」"
        )

    def _update_corr_overlays(self):
        overlays = []
        idx = len(self._corr_pairs) + 1
        if self._corr_pending_ref:
            r = self._corr_pending_ref
            overlays.append({"x": r["x"], "y": r["y"], "w": r["w"], "h": r["h"],
                             "kind": "ref", "idx": idx})
        for i, pair in enumerate(self._corr_pairs, 1):
            cr = pair["_canvas"]["ref"]
            cm = pair["_canvas"]["move"]
            overlays.append({**cr, "kind": "ref", "idx": i})
            overlays.append({**cm, "kind": "move", "idx": i})
        self.canvas.set_corr_overlays(overlays)

    def _refresh_corr_list(self):
        self.corr_list.clear()
        for i, pair in enumerate(self._corr_pairs, 1):
            ref, move = pair["ref"], pair["move"]
            li = QListWidgetItem(f"#{i}  {ref['name']} ↔ {move['name']}")
            li.setData(Qt.ItemDataRole.UserRole, i - 1)
            self.corr_list.addItem(li)

    def _corr_context_menu(self, pos):
        item = self.corr_list.itemAt(pos)
        if not item:
            return
        menu = QMenu(self)
        delete_act = menu.addAction("删除此对应")
        if menu.exec(self.corr_list.mapToGlobal(pos)) == delete_act:
            idx = item.data(Qt.ItemDataRole.UserRole)
            if idx is not None and 0 <= idx < len(self._corr_pairs):
                self._corr_pairs.pop(idx)
                self._refresh_corr_list()
                self._update_corr_overlays()

    def _clear_correspondence(self):
        if not self._corr_pairs and not self._corr_pending_ref:
            return
        self._corr_pairs.clear()
        self._corr_pending_ref = None
        self._corr_step = "ref"
        self._refresh_corr_list()
        self._update_corr_overlays()
        self.status.setText("已清空对应区域")

    def _execute_align(self):
        if not self._corr_pairs:
            QMessageBox.information(self, "执行对齐", "请先在「对应拼接」模式下框选至少一对对应区域")
            return
        pairs = [{"ref": p["ref"], "move": p["move"]} for p in self._corr_pairs]
        r = self.wb.align_from_pairs(pairs)
        if r.get("error"):
            QMessageBox.warning(self, "执行对齐", r["error"])
            return
        moved = r.get("moved") or []
        if not moved:
            QMessageBox.information(
                self, "执行对齐",
                "对应区域未能让任何图移动。请确认第二框选在要对齐的那张已置入截图上，"
                "且与参照框不在同一张图。",
            )
            return
        self._corr_pairs.clear()
        self._corr_pending_ref = None
        self._corr_step = "ref"
        self._refresh_corr_list()
        self.canvas.set_corr_overlays([])
        self.canvas.refresh()
        self._refresh_lists()
        unsettled = r.get("unsettled") or []
        msg = f"已对齐并移动：{', '.join(moved)}"
        if unsettled:
            msg += f"；未连通：{', '.join(unsettled)}"
        self.status.setText(msg)
        self._set_mode("move")

    def _run_busy(self, title, fn, on_done):
        if self._worker is not None and self._worker.isRunning():
            QMessageBox.information(self, "请稍候", "已有任务在运行")
            return
        dlg = QProgressDialog(title, None, 0, 0, self)
        dlg.setWindowModality(Qt.WindowModality.WindowModal)
        dlg.setCancelButton(None)
        dlg.setMinimumDuration(0)
        dlg.show()
        worker = TaskWorker(fn, self)
        self._worker = worker

        def finish(result):
            dlg.close()
            worker.deleteLater()
            if self._worker is worker:
                self._worker = None
            on_done(result)

        def fail(msg):
            dlg.close()
            worker.deleteLater()
            if self._worker is worker:
                self._worker = None
            QMessageBox.warning(self, "错误", msg)

        worker.done.connect(finish)
        worker.failed.connect(fail)
        worker.start()

    def _on_anchor_canvas_rect(self, rect):
        name = self._selected_source_name()
        src = self.wb._find_source(name) if name else None
        if src is not None and not src["placed"]:
            if not any(s["placed"] for s in self.wb.sources):
                QMessageBox.information(self, "锚点对应", "请先置入第一张图作为起点")
                return
            dlg = AnchorPreviewDialog(src["img"], self)
            if dlg.exec() != QDialog.DialogCode.Accepted:
                return
            local = dlg.selected_rect()
            if not local:
                return
            r = self.wb.place_from_anchor(name, rect, local)
            if r.get("error"):
                QMessageBox.warning(self, "锚点对应", r["error"])
                return
            self.canvas.refresh()
            self._refresh_lists()
            self.status.setText(f"已按锚点置入「{name}」，可拖动微调")
            self._set_mode("move")
            return
        if self._anchor_first is None:
            self._anchor_first = rect
            self.status.setText("已记下参照框。再框选要对齐的另一处（会移动覆盖第二框的那张图）")
            return
        prefer = name if (src is not None and src["placed"]) else None
        r = self.wb.align_canvas_anchors(self._anchor_first, rect, prefer)
        self._anchor_first = None
        if r.get("error"):
            QMessageBox.warning(self, "锚点对应", r["error"])
            return
        self.canvas.refresh()
        self._refresh_lists()
        self.status.setText(f"已对齐并移动「{r['name']}」")
        self._set_mode("move")

    def _export(self):
        name, ok = QInputDialog.getText(self, "导出", "文件名：", text="拼接结果.png")
        if not ok or not name:
            return
        r = self.wb.export(name)
        if r.get("error"):
            QMessageBox.warning(self, "错误", r["error"])
        else:
            self.status.setText(f"已导出：{r['path']}")

    def _on_source_moved(self, name, x, y):
        self.wb.move_source(name, x, y)
        self._refresh_lists()

    def _on_group_moved(self, names, dx, dy):
        if not names or (dx == 0 and dy == 0):
            self.canvas.refresh()
            return
        if not self.wb.nudge_group(names, dx, dy):
            self.canvas.refresh()
            self.status.setText("没有可移动的图层")
            return
        self.canvas.select_group(names)
        self.canvas.refresh()
        self._refresh_lists()

    def _on_selection(self, x, y, w, h):
        rect = {"x": x, "y": y, "w": w, "h": h}
        QApplication.setOverrideCursor(Qt.CursorShape.WaitCursor)
        try:
            if self._mode == "fix":
                self._pending_rect = rect
                items = self.wb.covering_sources(x, y, w, h)
                self.cand_list.clear()
                for it in items:
                    preview = self.wb.crop_source(it["name"], it["sx"], it["sy"], w, h)
                    label = f"{it['name']}  ({it['sx']},{it['sy']})"
                    li = QListWidgetItem(label)
                    li.setData(Qt.ItemDataRole.UserRole, {**it, "w": w, "h": h, "rect": rect})
                    if preview is not None:
                        li.setIcon(thumb_icon(preview))
                    self.cand_list.addItem(li)
                self.status.setText(f"框选 {w}×{h} @ {x},{y} — 点击候选源盖章")
            elif self._mode == "anchor":
                QApplication.restoreOverrideCursor()
                self._on_anchor_canvas_rect(rect)
                return
            elif self._mode == "correspondence":
                QApplication.restoreOverrideCursor()
                self._on_correspondence_rect(rect)
                return
            elif self._mode == "remove":
                cands = self.wb.erase_candidates(rect)
                if not cands:
                    QMessageBox.information(self, "去除", "没有源图覆盖该区域")
                    return
                r = self.wb.erase(rect, candidates=cands)
                if r.get("error"):
                    QMessageBox.warning(self, "去除", r["error"])
                    return
                self.canvas.refresh()
                self._refresh_lists()
                self._fill_erase_candidates(rect, cands)
                self.status.setText(
                    f"已用「{r['name']}」盖章去除（得分 {r['score']}）；可点其它候选换帧"
                )
            elif self._mode == "save_tile":
                step = self.wb.grid.get("step", 64)
                hint = ""
                if w % step or h % step:
                    hint = f"（当前 {w}×{h}，网格 {step}×{step}）"
                name, ok = QInputDialog.getText(
                    self, "存为瓦片", f"瓦片名称{hint}：", text=f"tile_{w}x{h}",
                )
                if not ok or not name.strip():
                    return
                r = self.wb.save_tile_from_canvas(x, y, w, h, name.strip())
                if r.get("error"):
                    QMessageBox.warning(self, "存为瓦片", r["error"])
                    return
                self._refresh_tile_list()
                self.status.setText(f"已保存瓦片「{r['name']}」→ 瓦片库/{r['id']}.png")
        finally:
            QApplication.restoreOverrideCursor()

    def _fill_erase_candidates(self, rect, cands):
        self.cand_list.clear()
        for c in cands:
            label = f"{c['name']}  得分{c['score']}  (越低越干净)"
            li = QListWidgetItem(label)
            li.setData(Qt.ItemDataRole.UserRole, {"rect": rect, "name": c["name"]})
            li.setIcon(thumb_icon(c["preview"]))
            self.cand_list.addItem(li)

    def _on_candidate_click(self, item):
        data = item.data(Qt.ItemDataRole.UserRole)
        if not data:
            return
        if self._mode == "fix" and self._pending_rect:
            rect = data["rect"]
            self.wb.stamp(data["name"], rect["x"], rect["y"],
                          data["w"], data["h"], data["sx"], data["sy"])
            self.canvas.refresh()
            self._refresh_lists()
            self.status.setText(f"已盖章：{data['name']}")
        elif self._mode == "remove" and "rect" in data:
            r = self.wb.erase(data["rect"], data["name"])
            if r.get("error"):
                QMessageBox.warning(self, "去除", r["error"])
            else:
                self.canvas.refresh()
                self._refresh_lists()
                self.status.setText(f"已换用「{r['name']}」去除（得分 {r['score']}）")

    def _undo(self):
        if not self.wb.undo():
            self.status.setText("没有可撤销的操作")
            return
        self.canvas.refresh()
        self._refresh_lists()
        self.status.setText("已撤销")

    def _redo(self):
        if not self.wb.redo():
            self.status.setText("没有可重做的操作")
            return
        self.canvas.refresh()
        self._refresh_lists()
        self.status.setText("已重做")

    def _refresh_lists(self):
        keep = self._selected_source_name()
        st = self.wb.state()
        self.src_list.clear()
        by_name = {s["name"]: s for s in self.wb.sources}
        restore = None
        for s in st["sources"]:
            flag = "已置入" if s["placed"] else "未置入"
            extra = " ✋" if s.get("manual") else ""
            pos = f"  ({s['x']},{s['y']})" if s["placed"] else ""
            li = QListWidgetItem(f"{flag}{extra}  {s['name']}{pos}")
            li.setData(Qt.ItemDataRole.UserRole, s["name"])
            src = by_name.get(s["name"])
            if src is not None:
                li.setIcon(thumb_icon(src["img"]))
            if not s["placed"]:
                li.setForeground(QColor(160, 160, 160))
            self.src_list.addItem(li)
            if keep and s["name"] == keep:
                restore = li
        if restore:
            self.src_list.setCurrentItem(restore)
        self.patch_list.blockSignals(True)
        self.patch_list.clear()
        for i, p in st["patches"]:
            if p.get("kind") == "erase":
                label = f"#{i} 旧版去除 ({p['x']},{p['y']})"
            elif p.get("kind") == "tile":
                tile = self.wb.get_tile(p.get("tile_id"))
                tname = tile["name"] if tile else p.get("tile_id", "?")
                label = f"#{i} 瓦片:{tname} ({p['x']},{p['y']})"
            else:
                label = f"#{i} {p.get('name', '')} ({p['x']},{p['y']})"
            item = QListWidgetItem(label)
            item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            vis = p.get("visible", True)
            item.setCheckState(Qt.CheckState.Checked if vis else Qt.CheckState.Unchecked)
            if not vis:
                item.setForeground(QColor(120, 120, 120))
            item.setData(Qt.ItemDataRole.UserRole, i)
            self.patch_list.addItem(item)
        self.patch_list.blockSignals(False)

    def _delete_patch(self, item):
        idx = item.data(Qt.ItemDataRole.UserRole)
        if idx is not None:
            self.wb.unstamp(idx)
            self.canvas.refresh()
            self._refresh_lists()


def main():
    directory = sys.argv[1] if len(sys.argv) > 1 else ""
    app = QApplication(sys.argv)
    win = MainWindow()
    if directory and os.path.isdir(directory):
        win.dir_edit.setText(directory)
        win._load_directory(directory)
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
