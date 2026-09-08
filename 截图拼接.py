# -*- coding: utf-8 -*-
"""游戏截图自动拼接工具：把一组互相重叠的地图截图拼成一张大图。

原理：
  1. 第一张截图放在画布 (0,0)；
  2. 其余截图在新图上取若干候选区块（覆盖四边与中部），用 OpenCV 模板匹配
     在当前画布里找最佳对齐位置；匹配分高于阈值即认为定位成功并粘贴；
  3. 反复扫剩余截图直到没有新进展；仍失败的会在结束时列出（可手动补拍重叠
     更多的过渡截图后重跑）。

用法：
    python 截图拼接.py 截图目录 -o 拼接结果.png
    python 截图拼接.py 01.png 02.png 03.png -o 拼接结果.png
可选：
    --threshold 0.90   匹配置信度阈值（0~1，越高越严格）
    --format png/jpg   输出格式
注意：
  - 截图须为同一分辨率、同一缩放（同一模拟器设置即可）；
  - 文件名顺序即参考顺序，但算法不依赖严格顺序（多轮自动尝试）；
  - 截图里的 NPC / 动画元素可能有细微差异，匹配用的是区块整体相似度，通常不受影响。
"""
import argparse
import os
import re
import sys

import cv2
import numpy as np


def natural_key(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def candidate_rects(w, h):
    """在新图上生成候选区块：位置覆盖四角/四边/中部，尺寸取短边的 35% 左右。"""
    size = min(w, h) * 0.35
    tw, th = int(size), int(size)
    xs = [0, (w - tw) // 2, w - tw]
    ys = [0, (h - th) // 2, h - th]
    # 加一组更靠边内侧的候选，适配重叠较窄的情况
    xs += [int(w * 0.12), w - tw - int(w * 0.12)]
    ys += [int(h * 0.12), h - th - int(h * 0.12)]
    rects = []
    for x in xs:
        for y in ys:
            rects.append((x, y, tw, th))
    return sorted(set(rects))


def match_to_canvas(canvas, img, threshold):
    """在画布上为 img 寻找最佳位置。返回 (score, x, y) 或 None。"""
    ih, iw = img.shape[:2]
    ch, cw = canvas.shape[:2]
    if ih > ch * 4 or iw > cw * 4:  # 新图远大于画布且几乎无重叠时跳过极端情况
        pass
    best = None
    for (x, y, tw, th) in candidate_rects(iw, ih):
        tpl = img[y:y + th, x:x + tw]
        if tpl.shape[0] > ch or tpl.shape[1] > cw:
            continue
        res = cv2.matchTemplate(canvas, tpl, cv2.TM_CCOEFF_NORMED)
        _, maxv, _, maxloc = cv2.minMaxLoc(res)
        if maxv < threshold:
            continue
        # 模板在 img 中的偏移反推出 img 左上角在画布上的位置
        px, py = maxloc[0] - x, maxloc[1] - y
        cand = (maxv, px, py)
        if best is None or maxv > best[0]:
            best = cand
    return best


def place_by_anchor(wx, wy, bx, by):
    """画布框左上角 (wx, wy) 与新图内框左上角 (bx, by) 对齐后，新图原点位置。"""
    return int(wx - bx), int(wy - by)


def refine_by_patches(canvas, img, canvas_rect, local_rect, search=8):
    """用两块同尺寸 patch 在预估位置附近微调。返回 (score, px, py) 或 None。

    canvas_rect / local_rect: (x, y, w, h)，px/py 为 img 原点在 canvas 上的坐标。
    """
    wx, wy, cw, ch = canvas_rect
    bx, by, bw, bh = local_rect
    tw = min(int(cw), int(bw))
    th = min(int(ch), int(bh))
    if tw < 8 or th < 8:
        return None
    ih, iw = img.shape[:2]
    chh, cww = canvas.shape[:2]
    if bx < 0 or by < 0 or bx + tw > iw or by + th > ih:
        return None
    tpl = img[by:by + th, bx:bx + tw]
    x0 = max(0, int(wx) - search)
    y0 = max(0, int(wy) - search)
    x1 = min(cww, int(wx) + tw + search)
    y1 = min(chh, int(wy) + th + search)
    roi = canvas[y0:y1, x0:x1]
    if tpl.shape[0] > roi.shape[0] or tpl.shape[1] > roi.shape[1]:
        return None
    res = cv2.matchTemplate(roi, tpl, cv2.TM_CCOEFF_NORMED)
    _, maxv, _, maxloc = cv2.minMaxLoc(res)
    nwx = x0 + maxloc[0]
    nwy = y0 + maxloc[1]
    return float(maxv), nwx - bx, nwy - by


def stitch(images, threshold):
    """images: [(文件名, ndarray)]。返回 (画布, 已放置信息, 失败列表)。"""
    canvas = images[0][1].copy()
    placed = [(images[0][0], 0, 0, 1.0)]
    pending = list(images[1:])

    progress = True
    while progress and pending:
        progress = False
        still_pending = []
        for name, img in pending:
            hit = match_to_canvas(canvas, img, threshold)
            if hit is None:
                still_pending.append((name, img))
                continue
            score, px, py = hit
            ih, iw = img.shape[:2]
            # 画布扩边以容纳新图
            top = max(0, -py); left = max(0, -px)
            bottom = max(0, py + ih - canvas.shape[0])
            right = max(0, px + iw - canvas.shape[1])
            if top or left or bottom or right:
                canvas = cv2.copyMakeBorder(canvas, top, bottom, left, right,
                                            cv2.BORDER_CONSTANT, value=(0, 0, 0))
                px += left; py += top
            canvas[py:py + ih, px:px + iw] = img
            placed.append((name, px, py, score))
            print(f"  ✅ {name} -> ({px}, {py})  置信度 {score:.4f}")
            progress = True
        pending = still_pending

    return canvas, placed, [n for n, _ in pending]


def main():
    ap = argparse.ArgumentParser(description="游戏截图自动拼接（模板匹配定位）")
    ap.add_argument("inputs", nargs="+", help="截图目录，或多个图片文件")
    ap.add_argument("-o", "--out", default="拼接结果.png", help="输出大图路径（默认 拼接结果.png）")
    ap.add_argument("--threshold", type=float, default=0.90, help="匹配置信度阈值，默认 0.90")
    ap.add_argument("--format", choices=["png", "jpg"], default=None,
                    help="输出格式（默认按扩展名推断）")
    args = ap.parse_args()

    files = []
    for p in args.inputs:
        if os.path.isdir(p):
            files += [os.path.join(p, f) for f in os.listdir(p)
                      if f.lower().endswith((".png", ".jpg", ".jpeg", ".bmp", ".webp"))]
        else:
            files.append(p)
    files = sorted(set(files), key=natural_key)
    if len(files) < 2:
        print("至少需要 2 张截图"); return 1

    images = []
    for f in files:
        img = cv2.imread(f, cv2.IMREAD_COLOR)
        if img is None:
            print(f"⚠️ 跳过无法读取的文件: {f}"); continue
        images.append((os.path.basename(f), img))
    base_shape = images[0][1].shape
    images = [(n, im) for n, im in images if im.shape == base_shape]
    if len(images) < 2:
        print("有效截图不足 2 张（或分辨率不一致）"); return 1
    print(f"共 {len(images)} 张截图，分辨率 {base_shape[1]}x{base_shape[0]}")

    canvas, placed, failed = stitch(images, args.threshold)

    out = args.out
    fmt = args.format or ("jpg" if out.lower().endswith((".jpg", ".jpeg")) else "png")
    if fmt == "jpg":
        cv2.imwrite(out, canvas, [cv2.IMWRITE_JPEG_QUALITY, 92])
    else:
        cv2.imwrite(out, canvas)
    print(f"\n完成：{len(placed)} 张已拼接 -> {out}（画布 {canvas.shape[1]}x{canvas.shape[0]}）")
    if failed:
        print("以下截图未能定位（重叠不足或差异过大）：")
        for n in failed:
            print(f"  ❌ {n}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
