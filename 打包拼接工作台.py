# -*- coding: utf-8 -*-
"""把拼接工作台打成独立 exe（封装 PyInstaller，不用手敲长命令）。

用法（在项目根目录）：
    python 打包拼接工作台.py

首次请先装依赖：
    pip install -r requirements.txt pyinstaller

产物：工具箱打包/拼接工作台.exe
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SPEC = ROOT / "拼接工作台.spec"
DIST = ROOT / "工具箱打包"
WORK = ROOT / "build" / "工作台"
STAGING = WORK / "dist"  # 先打到临时目录，避免覆盖被锁定的旧 exe
EXE_NAME = "拼接工作台.exe"


def _pyinstaller_exe() -> str | None:
    for candidate in (
        ROOT / ".venv" / "Scripts" / "pyinstaller.exe",
        ROOT / ".venv" / "bin" / "pyinstaller",
    ):
        if candidate.is_file():
            return str(candidate)
    return shutil.which("pyinstaller")


def _install_exe(staged: Path, final: Path) -> Path:
    """把临时目录里的 exe 放到发布目录；旧文件被占用时另存为 _新。"""
    final.parent.mkdir(parents=True, exist_ok=True)
    if not final.is_file():
        shutil.move(str(staged), str(final))
        return final
    try:
        final.unlink()
        shutil.move(str(staged), str(final))
        return final
    except OSError:
        alt = final.with_name("拼接工作台_新.exe")
        if alt.is_file():
            alt.unlink()
        shutil.move(str(staged), str(alt))
        print(f"\n无法覆盖 {final}")
        print("（常见原因：资源管理器预览、杀毒扫描、旧 exe 仍被系统占用）")
        print(f"已另存为 → {alt}")
        print("确认无占用后，可删掉旧的再改名，或直接使用 _新 版本。")
        return alt


def main() -> int:
    pyinstaller = _pyinstaller_exe()
    if not pyinstaller:
        print("未找到 pyinstaller。请先执行：")
        print("  pip install -r requirements.txt pyinstaller")
        return 1

    if not SPEC.is_file():
        print(f"缺少配置文件：{SPEC}")
        return 1

    WORK.mkdir(parents=True, exist_ok=True)
    if STAGING.is_dir():
        shutil.rmtree(STAGING, ignore_errors=True)
    STAGING.mkdir(parents=True, exist_ok=True)

    cmd = [
        pyinstaller,
        str(SPEC),
        "--distpath",
        str(STAGING),
        "--workpath",
        str(WORK),
        "--noconfirm",
    ]

    print("正在打包拼接工作台（约 1–3 分钟）…")
    print(" ".join(cmd))
    try:
        subprocess.run(cmd, cwd=ROOT, check=True)
    except subprocess.CalledProcessError:
        print("打包失败，请检查上方报错。")
        return 1

    staged = STAGING / EXE_NAME
    if not staged.is_file():
        print("打包结束但未找到 exe，请检查 PyInstaller 输出。")
        return 1

    final = _install_exe(staged, DIST / EXE_NAME)
    print(f"\n完成 → {final}")
    print("可直接双击运行，或拷到别的电脑（无需 Python）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
