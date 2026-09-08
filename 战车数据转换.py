import pandas as pd
import json
import os

# 配置路径
EXCEL_PATH = r"C:\Users\wy272\Desktop\MM\mm2r_database.xlsx"
OUTPUT_DIR = r"C:\Users\wy272\Desktop\MM\dist\data"


# --- 通用工具函数 ---

def safe_val(val):
    s = str(val).strip()
    if s in ["∞", "无限制", "无限"]: return "∞"
    if s.lower() in ["nan", "-", "—", "", "none", "×"]: return 0
    for char in ["（", "）", "(", ")", "+", "G", "t", "%", " "]:
        s = s.replace(char, "")
    try:
        num = float(s)
        return int(num) if num == int(num) else num
    except:
        return s


def get_star(row):
    val = str(row.get('星级', 0)).strip().lower()
    if val in ["nan", "-", "—", "", "none", "×"]: return 0
    try:
        return int(float(val))
    except:
        return 0


# --- 独立解析逻辑 ---

def parse_main_gun(row):
    """1. 主炮解析"""
    name = str(row.get('名称', '')).strip()
    if name == 'nan' or not name: return None
    return {
        "名称": name, "星级": get_star(row), "分类": "主炮",
        "部位": str(row.get('部位', "-")), "价格": safe_val(row.get('价格(G)', 0)),
        "特殊炮弹": str(row.get('特殊炮弹', "-")), "范围": str(row.get('范围', "-")),
        "属性": str(row.get('属性', "-")), "获取方式": str(row.get('获取方式', "-")),
        "stats": {
            "攻击力": [safe_val(row.get('攻击力初期', 0)), safe_val(row.get('攻击力最大', 0))],
            "守备力": [safe_val(row.get('守备力初期', 0)), safe_val(row.get('守备力最大', 0))],
            "重量": [safe_val(row.get('重量(t)初期', 0)), safe_val(row.get('重量(t)最大', 0))],
            "弹仓": [safe_val(row.get('弹仓初期', 0)), safe_val(row.get('弹仓最大', 0))]
        }
    }


def parse_sub_gun(row):
    """2. 副炮解析"""
    name = str(row.get('名称', '')).strip()
    if name == 'nan' or not name: return None
    return {
        "名称": name, "星级": get_star(row), "分类": "副炮",
        "部位": str(row.get('部位', "-")), "价格": safe_val(row.get('价格(G)', 0)),
        "可否迎击": str(row.get('可否迎击', "-")), "范围": str(row.get('范围', "-")),
        "属性": str(row.get('属性', "-")), "获取方式": str(row.get('获取方式', "-")),
        "stats": {
            "攻击力": [safe_val(row.get('攻击力初期', 0)), safe_val(row.get('攻击力最大', 0))],
            "守备力": [safe_val(row.get('守备力初期', 0)), safe_val(row.get('守备力最大', 0))],
            "重量": [safe_val(row.get('重量(t)初期', 0)), safe_val(row.get('重量(t)最大', 0))],
            "弹仓": [safe_val(row.get('弹仓初期', 0)), safe_val(row.get('弹仓最大', 0))]
        }
    }


def parse_se(row):
    """3. S-E解析"""
    name = str(row.get('名称', '')).strip()
    if name == 'nan' or not name: return None
    return {
        "名称": name, "星级": get_star(row), "分类": "S-E",
        "部位": str(row.get('部位', "-")), "价格": safe_val(row.get('价格(G)', 0)),
        "范围": str(row.get('范围', "-")), "属性": str(row.get('属性', "-")),
        "获取方式": str(row.get('获取方式', "-")),
        "stats": {
            "攻击力": [safe_val(row.get('攻击力初期', 0)), safe_val(row.get('攻击力最大', 0))],
            "守备力": [safe_val(row.get('守备力初期', 0)), safe_val(row.get('守备力最大', 0))],
            "重量": [safe_val(row.get('重量(t)初期', 0)), safe_val(row.get('重量(t)最大', 0))],
            "弹仓": [safe_val(row.get('弹仓初期', 0)), safe_val(row.get('弹仓最大', 0))]
        }
    }


def parse_c_unit(row):
    """4. C装置解析"""
    name = str(row.get('名称', '')).strip()
    if name == 'nan' or not name: return None
    return {
        "名称": name, "星级": get_star(row), "分类": "C装置",
        "部位": str(row.get('部位', "-")), "价格": safe_val(row.get('价格(G)', 0)),
        "特性": str(row.get('特性', "-")), "获取方式": str(row.get('获得方式', "-")),
        "stats": {
            "命中": [safe_val(row.get('命中(%)初期', 0)), safe_val(row.get('命中(%)最大', 0))],
            "回避": [safe_val(row.get('回避(%)初期', 0)), safe_val(row.get('回避(%)最大', 0))],
            "守备力": [safe_val(row.get('守备力初期', 0)), safe_val(row.get('守备力最大', 0))],
            "重量": [safe_val(row.get('重量(t)初期', 0)), safe_val(row.get('重量(t)最大', 0))]
        }
    }


def parse_engine(row):
    """5. 引擎解析"""
    name = str(row.get('名称', '')).strip()
    if name == 'nan' or not name: return None
    # 载重处理为 [载重, 载重] 格式以对齐 UI 展示
    load_val = safe_val(row.get('载重(t)', 0))
    return {
        "名称": name, "星级": get_star(row), "分类": "引擎",
        "部位": str(row.get('部位', "-")), "价格": safe_val(row.get('价格(G)', 0)),
        "改造费": safe_val(row.get('改造(G)', 0)), "改造支系": str(row.get('改造支系', "-")),
        "改造分支": str(row.get('改造分支', "-")), "类型": str(row.get('类型', "-")),
        "获取方式": str(row.get('获得方法', "-")),
        "stats": {
            "载重": [load_val, load_val],
            "守备力": [safe_val(row.get('守备力初期', 0)), safe_val(row.get('守备力最大', 0))],
            "重量": [safe_val(row.get('重量(t)初期', 0)), safe_val(row.get('重量(t)最大', 0))]
        }
    }


# --- 主程序 ---

if __name__ == "__main__":
    xl = pd.ExcelFile(EXCEL_PATH)
    final_output = []

    # 定义处理流程
    tasks = [
        ("战车装备_主炮", parse_main_gun),
        ("战车装备_副炮", parse_sub_gun),
        ("战车装备_S-E", parse_se),
        ("战车装备_C装置", parse_c_unit),
        ("战车装备_引擎", parse_engine)
    ]

    for sheet_name, parse_func in tasks:
        if sheet_name in xl.sheet_names:
            print(f"🚀 正在解析: {sheet_name}")
            df = pd.read_excel(xl, sheet_name=sheet_name)

            # 自动填充合并单元格
            fill_cols = [c for c in ['名称', '部位', '改造支系', '改造分支'] if c in df.columns]
            df[fill_cols] = df[fill_cols].ffill()

            for _, row in df.iterrows():
                item = parse_func(row)
                if item:
                    final_output.append(item)

    # 保存
    if not os.path.exists(OUTPUT_DIR): os.makedirs(OUTPUT_DIR)
    with open(os.path.join(OUTPUT_DIR, "战车装备.json"), 'w', encoding='utf-8') as f:
        json.dump(final_output, f, ensure_ascii=False, indent=2)

    print(f"✨ 转换完成！总计: {len(final_output)} 条数据。")