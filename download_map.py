import os
import requests
from PIL import Image
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed


# =========================
# 配置
# =========================

BASE_URL = (
    "https://mtra.dnof.net/maps/"
    "maps_world_map_20260905_155221_tiles"
)

# 12 行：0000 ~ 0012
ROWS = 13

# 每行 16 张：0000 ~ 0015
COLS = 16

# 单张尺寸
TILE_SIZE = 2048

# 下载线程
MAX_WORKERS = 12

# 重试次数
RETRY_COUNT = 3

# 保存目录
TILE_DIR = "tiles"

# 最终地图
OUTPUT_FILE = "world_map.png"


# =========================
# 创建目录
# =========================

os.makedirs(TILE_DIR, exist_ok=True)


# =========================
# 文件名
# =========================

def filename(row, col):
    return f"tile_{row:04d}_{col:04d}.png"


def filepath(row, col):
    return os.path.join(
        TILE_DIR,
        filename(row, col)
    )


def url(row, col):
    return f"{BASE_URL}/{filename(row, col)}"


# =========================
# 下载单张
# =========================

def download_tile(row, col):

    path = filepath(row, col)

    # 已经存在，并且图片正常
    if os.path.exists(path):

        try:
            with Image.open(path) as img:
                img.verify()

            return True, row, col, "已存在"

        except Exception:
            print(
                f"文件损坏，重新下载："
                f"{filename(row, col)}"
            )

            try:
                os.remove(path)
            except:
                pass

    # 下载 + 重试
    for attempt in range(1, RETRY_COUNT + 1):

        try:

            r = requests.get(
                url(row, col),
                timeout=20
            )

            if r.status_code != 200:
                raise Exception(
                    f"HTTP {r.status_code}"
                )

            # 验证图片
            img = Image.open(
                BytesIO(r.content)
            )

            img.verify()

            # 写入磁盘
            with open(path, "wb") as f:
                f.write(r.content)

            return True, row, col, "下载成功"

        except Exception as e:

            if attempt == RETRY_COUNT:

                return (
                    False,
                    row,
                    col,
                    str(e)
                )


# =========================
# 批量下载
# =========================

def download_all():

    total = ROWS * COLS

    print()
    print("=" * 60)
    print("MTRA 地图瓦片下载器")
    print("=" * 60)

    print(f"地图：{ROWS} 行 × {COLS} 列")
    print(f"总图片：{total}")
    print(f"单张尺寸：{TILE_SIZE} × {TILE_SIZE}")
    print(
        f"最终尺寸："
        f"{COLS * TILE_SIZE} × "
        f"{ROWS * TILE_SIZE}"
    )

    print("=" * 60)
    print()

    failed = []
    completed = 0

    tasks = []

    for row in range(ROWS):

        for col in range(COLS):

            tasks.append(
                (row, col)
            )

    with ThreadPoolExecutor(
        max_workers=MAX_WORKERS
    ) as executor:

        futures = [
            executor.submit(
                download_tile,
                row,
                col
            )
            for row, col in tasks
        ]

        for future in as_completed(futures):

            ok, row, col, message = (
                future.result()
            )

            completed += 1

            if ok:

                print(
                    f"[{completed:3d}/{total}] "
                    f"✓ {filename(row, col)} "
                    f"{message}"
                )

            else:

                print(
                    f"[{completed:3d}/{total}] "
                    f"✗ {filename(row, col)} "
                    f"{message}"
                )

                failed.append(
                    (row, col)
                )

    print()
    print("=" * 60)
    print("下载结束")
    print("=" * 60)

    print(
        f"成功：{total - len(failed)}"
    )

    print(
        f"失败：{len(failed)}"
    )

    if failed:

        print()
        print("失败图片：")

        for row, col in failed:
            print(
                f"  {filename(row, col)}"
            )

        with open(
            "failed_tiles.txt",
            "w",
            encoding="utf-8"
        ) as f:

            for row, col in failed:

                f.write(
                    filename(row, col)
                    + "\n"
                )

    return failed


# =========================
# 拼接地图
# =========================

def stitch():

    print()
    print("=" * 60)
    print("开始拼接地图")
    print("=" * 60)

    # ========================================================
    # 第一遍：
    # 读取所有图片的实际尺寸
    # ========================================================

    images = {}

    missing = []

    for row in range(ROWS):

        for col in range(COLS):

            path = filepath(row, col)

            if not os.path.exists(path):

                print(
                    f"⚠ 缺失："
                    f"{filename(row, col)}"
                )

                missing.append(
                    (row, col)
                )

                continue

            try:

                with Image.open(path) as img:

                    # 只记录实际尺寸
                    images[(row, col)] = img.size

            except Exception as e:

                print(
                    f"⚠ 无法读取："
                    f"{filename(row, col)}"
                )

                print(f"  {e}")

                missing.append(
                    (row, col)
                )

    if not images:

        print("错误：没有找到任何有效图片")
        return

    # ========================================================
    # 计算每一列的宽度
    #
    # 正常情况下：
    # 0~14 = 2048
    # 15    = 512
    # ========================================================

    column_widths = []

    for col in range(COLS):

        max_width = 0

        for row in range(ROWS):

            if (row, col) in images:

                w, h = images[(row, col)]

                max_width = max(
                    max_width,
                    w
                )

        column_widths.append(max_width)

    # ========================================================
    # 计算每一行的高度
    #
    # 正常情况下可能都是 2048，
    # 但最下面也允许出现非 2048 高度。
    # ========================================================

    row_heights = []

    for row in range(ROWS):

        max_height = 0

        for col in range(COLS):

            if (row, col) in images:

                w, h = images[(row, col)]

                max_height = max(
                    max_height,
                    h
                )

        row_heights.append(max_height)

    # ========================================================
    # 最终图片尺寸
    # ========================================================

    final_width = sum(column_widths)
    final_height = sum(row_heights)

    print()
    print(
        f"最终尺寸："
        f"{final_width} × {final_height}"
    )

    print(
        f"列数：{COLS}"
    )

    print(
        f"行数：{ROWS}"
    )

    # ========================================================
    # 打印实际尺寸
    # ========================================================

    print()
    print("瓦片尺寸：")

    for row in range(ROWS):

        info = []

        for col in range(COLS):

            if (row, col) in images:

                w, h = images[(row, col)]

                info.append(
                    f"{col:04d}={w}x{h}"
                )

        print(
            f"第 {row:04d} 行："
            + "  ".join(info)
        )

    # ========================================================
    # 创建大画布
    # ========================================================

    print()
    print("创建地图画布...")

    canvas = Image.new(
        "RGB",
        (
            final_width,
            final_height
        )
    )

    # ========================================================
    # 计算每一列的 X 起始位置
    # ========================================================

    column_x = []

    x = 0

    for width in column_widths:

        column_x.append(x)

        x += width

    # ========================================================
    # 计算每一行的 Y 起始位置
    # ========================================================

    row_y = []

    y = 0

    for height in row_heights:

        row_y.append(y)

        y += height

    # ========================================================
    # 正式拼接
    # ========================================================

    for row in range(ROWS):

        print(
            f"正在拼接第 "
            f"{row + 1}/{ROWS} 行..."
        )

        for col in range(COLS):

            if (row, col) not in images:

                continue

            path = filepath(row, col)

            try:

                with Image.open(path) as tile:

                    # 实际位置
                    x = column_x[col]
                    y = row_y[row]

                    # 如果是 RGBA，
                    # 需要正确处理透明通道
                    if tile.mode == "RGBA":

                        canvas.paste(
                            tile,
                            (x, y),
                            tile
                        )

                    else:

                        if tile.mode != "RGB":

                            tile = tile.convert(
                                "RGB"
                            )

                        canvas.paste(
                            tile,
                            (x, y)
                        )

            except Exception as e:

                print(
                    f"⚠ 拼接失败："
                    f"{filename(row, col)}"
                )

                print(f"  {e}")

                if (row, col) not in missing:

                    missing.append(
                        (row, col)
                    )

    # ========================================================
    # 保存
    # ========================================================

    print()
    print("正在保存 PNG...")

    canvas.save(
        OUTPUT_FILE,
        format="PNG",
        compress_level=6
    )

    canvas.close()

    # ========================================================
    # 完成
    # ========================================================

    print()
    print("=" * 60)
    print("拼接完成")
    print("=" * 60)

    print(
        f"输出文件：{OUTPUT_FILE}"
    )

    print(
        f"图片尺寸："
        f"{final_width} × {final_height}"
    )

    if missing:

        print()
        print(
            f"⚠ 有 {len(missing)} 张图片缺失/读取失败"
        )

        with open(
            "missing_tiles.txt",
            "w",
            encoding="utf-8"
        ) as f:

            for row, col in missing:

                f.write(
                    filename(row, col)
                    + "\n"
                )

        print(
            "详细列表：missing_tiles.txt"
        )

    else:

        print()
        print(
            f"✓ {ROWS * COLS} 张图片全部成功拼接"
        )

    print("=" * 60)


# =========================
# 主程序
# =========================

if __name__ == "__main__":

    failed = download_all()

    stitch()

    print()
    print("全部完成。")