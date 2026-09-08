import pandas as pd
import json
import os
import re


# 链装系统的附属表：不单独导出为前端 Tab，只并入 链装.json
# （链装套装 例外：它是页面按分类浏览的套装库，作为独立 JSON 导出）
CHAIN_SHEET = '链装'
CHAIN_AUX_SHEETS = ['链装词缀库']


def _load_aux_df(excel_file, sheet_name):
    if sheet_name not in excel_file.sheet_names:
        return None
    return pd.read_excel(excel_file, sheet_name=sheet_name, header=0).fillna("-")


def _star_num(v):
    s = str(v)
    if s in ('-', '0', '通常', ''):
        return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def _merge_chain_data(records, excel_file):
    """并入词缀池与强化数值（2024 新表结构）：
    - 词缀按分类整池挂载：人类链装分类=嵌能、战车链装分类=相阵，
      每件链装显示其分类在「链装词缀库」中的全部词缀；
    - 若行内（或同名称通常行）填了 词缀1~4，则只显示填写的词缀（覆盖整池）；
    - 强化数值取词缀库的 +1/+2/+3 列（该词缀强化到对应等级时的数值）；
    - 「链装强化」表按名称并入 强化数据（强化等级 → 词条1~3）。"""
    affix_df = _load_aux_df(excel_file, '链装词缀库')
    pools = {}  # 分类 -> [词缀...]
    if affix_df is not None:
        seen = set()
        for _, r in affix_df.iterrows():
            cat = str(r['分类']).strip()
            name = str(r['词缀名']).strip()
            if cat in ('-', '') or name in ('-', ''):
                continue
            key = (cat, name, str(r['最小值']))
            if key in seen:  # 去掉表里的重复行
                continue
            seen.add(key)
            affix = {'名称': name, '效果': str(r['效果']),
                     '最小值': r['最小值'], '最大值': r['最大值']}
            enh = []
            for col in ('+1', '+2', '+3'):
                if col in r and str(r[col]) not in ('-', ''):
                    enh.append({'等级': col, '数值': r[col]})
            if enh:
                affix['强化'] = enh
            pools.setdefault(cat, []).append(affix)

    # 链装强化表：名称 -> [{等级, 词条1~3}]
    enh_df = _load_aux_df(excel_file, '链装强化')
    enhance_map = {}
    if enh_df is not None:
        for _, r in enh_df.iterrows():
            name = str(r.get('名称', '-')).strip()
            if name in ('-', ''):
                continue
            enhance_map.setdefault(name, []).append({
                '等级': r['强化等级'],
                '词条1': r.get('词条1', '-'), '词条2': r.get('词条2', '-'),
                '词条3': r.get('词条3', '-'),
            })

    # 过滤整行为空的分隔行
    records = [rec for rec in records
               if str(rec.get('名称', '-')).strip() not in ('-', '')]

    base_rows = {rec.get('名称'): rec for rec in records
                 if _star_num(rec.get('星级', '-')) == 0}
    lib_map = {a['名称']: a for pool in pools.values() for a in pool}

    for rec in records:
        name = rec.get('名称')
        cat = str(rec.get('分类', '-')).strip()

        # 词缀1~4 有值（含继承通常行）→ 只显示这些；否则挂分类整池
        src = base_rows.get(name, rec)
        picked = []
        for i in (1, 2, 3, 4):
            v = str(rec.get(f'词缀{i}', '-'))
            if v in ('-', ''):
                v = str(src.get(f'词缀{i}', '-'))
            if v not in ('-', ''):
                picked.append(v)
        if picked:
            rec['词缀列表'] = [dict(lib_map.get(v, {'名称': v, '效果': '-',
                                                   '最小值': '-', '最大值': '-'}))
                              for v in picked]
        elif cat in pools:
            rec['词缀列表'] = [dict(a) for a in pools[cat]]

        if name in enhance_map:
            rec['强化数据'] = enhance_map[name]

    return records


def export_mm2r_unnamed_pro(excel_path, output_dir='dist'):
    data_dir = os.path.join(output_dir, 'data')
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)

    try:
        excel_file = pd.ExcelFile(excel_path)
        for sheet_name in excel_file.sheet_names:
            if sheet_name.startswith('Sheet') or '隐藏' in sheet_name or '战车装备' in sheet_name:
                print(f"⏩ 跳过不需要转换的工作表: {sheet_name}")
                continue
            if sheet_name in CHAIN_AUX_SHEETS:
                print(f"⏩ 链装附属表（并入链装JSON）: {sheet_name}")
                continue

            print(f"📡 正在处理工作表: {sheet_name}")
            df = pd.read_excel(excel_path, sheet_name=sheet_name, header=0)

            raw_cols = list(df.columns)
            new_cols = list(df.columns)

            # --- 步骤 1: 定位职业区域起点 ---
            job_start_idx = -1
            for i, col in enumerate(raw_cols):
                col_str = str(col)
                if "职业" in col_str and "Unnamed" not in col_str:
                    job_start_idx = i
                    break

            # --- 步骤 2: 基于 Unnamed 标识符处理职业列名 ---
            if job_start_idx != -1:
                print(f"   🎯 职业区起点列: [{raw_cols[job_start_idx]}]")
                for j in range(job_start_idx, len(raw_cols)):
                    col_name = str(raw_cols[j])
                    if j == job_start_idx or "Unnamed" in col_name:
                        column_series = df.iloc[:, j].dropna().astype(str)
                        column_data = column_series.tolist()
                        valid_names = [n.strip() for n in column_data if
                                       len(n.strip()) >= 1 and n.strip() not in ["-", "○", "×", "nan"]]

                        if valid_names:
                            most_common = max(set(valid_names), key=valid_names.count)
                            core_name = re.sub(r'^[男女]', '', most_common)
                            job_label = core_name
                        else:
                            job_label = f"未知职业{j - job_start_idx + 1}"

                        new_cols[j] = f"职业_{job_label}"
                    else:
                        break
                df.columns = new_cols

            # --- 步骤 3: 数据清洗与导出 (注意：这里不再缩进在 if 内部) ---

            # 1. 绝对不允许任何列自动向下填充 (ffill)
            # 除非你以后发现某些列（如“名称”）确实需要合并，再填入这个列表
            need_ffill_cols = []

            for col in need_ffill_cols:
                if col in df.columns:
                    df[col] = df[col].ffill()

            # 2. 职业列处理 (职业在Excel里几乎全是合并单元格，所以通常保留填充)
            job_cols = [c for c in df.columns if c.startswith("职业_")]
            for col in job_cols:
                df[col] = df[col].ffill()

            # 3. 关键修复：防止属性/掉落物填充
            # 将所有 NaN 直接填充为 "-"，不使用 ffill
            df = df.fillna("-")

            # 4. 字段名映射：前端列表/详情统一读“名称”，称号表的“汉译名”在此改名
            records = df.to_dict(orient='records')
            for rec in records:
                if '汉译名' in rec:
                    rec['名称'] = rec.pop('汉译名')

            # 5. 链装表并入套装效果/词缀区间/强化等级后再导出
            if sheet_name == CHAIN_SHEET:
                records = _merge_chain_data(records, excel_file)

            # 6. 执行导出
            json_path = os.path.join(data_dir, f"{sheet_name}.json")
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump({"data": records}, f, ensure_ascii=False, indent=2)

            print(f"   ✅ 已生成: {sheet_name}.json (记录数: {len(records)})")

        print("\n✨ 转换任务全部完成！")

    except Exception as e:
        import traceback
        print(f"❌ 运行过程中发生崩溃: {e}")
        traceback.print_exc()


if __name__ == "__main__":
    EXCEL_NAME = 'mm2r_database.xlsx'
    if os.path.exists(EXCEL_NAME):
        export_mm2r_unnamed_pro(EXCEL_NAME)
    else:
        print(f"错误：在当前目录下找不到 '{EXCEL_NAME}'")