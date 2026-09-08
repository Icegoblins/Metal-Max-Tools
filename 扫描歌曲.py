import os
import json
from mutagen.mp4 import MP4
from mutagen.mp3 import MP3
from mutagen.id3 import ID3

# 配置路径
MUSIC_DIR = './dist/music'
OUTPUT_JSON = './dist/data/点唱机.json'
# 分组配置文件（相对 music 目录）：传入新歌时在这里划分分组，改完重新运行本脚本即可
GROUPS_CONFIG = os.path.join(MUSIC_DIR, 'song_groups.json')

# 首次运行自动生成的配置模板：
#   rules：批量规则，按顺序匹配，命中即归组
#     match = 匹配内容   type = prefix(文件名前缀) / contains(文件名包含) / regex(正则)
#     group = 分组名称（可自由命名，前端自动按它分组）
#   songs：单曲精确指定分组（可选，优先级高于 rules）
DEFAULT_GROUPS_CONFIG = {
    "rules": [
        {"match": "1.", "type": "prefix", "group": "初代曲目"},
        # {"match": "2.", "type": "prefix", "group": "二代曲目"},
        # {"match": "Crying", "type": "contains", "group": "欧美曲目"},
    ],
    "songs": {
        # "1.03. エンドレス・レイン.m4a": "初代曲目",
    }
}


def load_groups_config():
    """读取分组配置；文件不存在时自动生成模板"""
    if not os.path.exists(GROUPS_CONFIG):
        with open(GROUPS_CONFIG, 'w', encoding='utf-8') as f:
            json.dump(DEFAULT_GROUPS_CONFIG, f, ensure_ascii=False, indent=2)
        print(f"已生成分组配置模板: {GROUPS_CONFIG} （可自行编辑规则后重新运行）")
    try:
        with open(GROUPS_CONFIG, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"分组配置解析失败（{e}），本次不划分分组")
        return {}


def get_track_group(filename, config):
    """单曲指定优先，其次按规则顺序匹配，都没有则返回空（前端归入“未分组”）"""
    if filename in config.get('songs', {}):
        return config['songs'][filename]
    import re
    for rule in config.get('rules', []):
        match_text = rule.get('match', '')
        rule_type = rule.get('type', 'prefix')
        group_name = rule.get('group', '')
        if not match_text or not group_name:
            continue
        if rule_type == 'prefix' and filename.startswith(match_text):
            return group_name
        if rule_type == 'contains' and match_text in filename:
            return group_name
        if rule_type == 'regex' and re.search(match_text, filename):
            return group_name
    return ""


def get_detailed_metadata(file_path):
    # 基础信息模板
    data = {
        "标题": "未知",
        "名称": os.path.basename(file_path).rsplit('.', 1)[0],
        "参与创作的艺术家": "未知",
        "唱片集艺术家": "未知",
        "唱片集": "未知",
        "年": "未知",
        "流派": "未知",
        "时长": "--:--",
        "比特率": "0 kbps",
        "频道": "未知",
        "音频采样频率": "0 Hz",
        "红心": 0
    }

    try:
        if file_path.endswith('.m4a'):
            audio = MP4(file_path)
            # 标签提取
            tags = audio.tags if audio.tags else {}
            data["标题"] = tags.get('\xa9nam', ["未知"])[0]
            data["参与创作的艺术家"] = tags.get('\xa9ART', ["未知"])[0]
            data["唱片集艺术家"] = tags.get('aART', ["未知"])[0]
            data["唱片集"] = tags.get('\xa9alb', ["未知"])[0]
            data["年"] = tags.get('\xa9day', ["未知"])[0]
            data["流派"] = tags.get('\xa9gen', ["未知"])[0]

            # 属性提取
            data["时长"] = format_time(audio.info.length)
            data["比特率"] = f"{int(audio.info.bitrate / 1000)} kbps"
            data["频道"] = "立体声" if audio.info.channels >= 2 else "单声道"
            data["音频采样频率"] = f"{audio.info.sample_rate} Hz"

        elif file_path.endswith('.mp3'):
            audio = MP3(file_path)
            # 标签提取 (ID3)
            data["标题"] = str(audio.get('TIT2', "未知"))
            data["参与创作的艺术家"] = str(audio.get('TPE1', "未知"))
            data["唱片集艺术家"] = str(audio.get('TPE2', "未知"))
            data["唱片集"] = str(audio.get('TALB', "未知"))
            data["年"] = str(audio.get('TDRC', audio.get('TYER', "未知")))
            data["流派"] = str(audio.get('TCON', "未知"))

            # 属性提取
            data["时长"] = format_time(audio.info.length)
            data["比特率"] = f"{int(audio.info.bitrate / 1000)} kbps"
            data["频道"] = "立体声" if audio.info.channels >= 2 else "单声道"
            data["音频采样频率"] = f"{audio.info.sample_rate} Hz"

    except Exception as e:
        print(f"解析 {file_path} 出错: {e}")

    return data


def format_time(seconds):
    mins, secs = divmod(int(seconds), 60)
    return f"{mins:02d}:{secs:02d}"


def main():
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    music_list = []
    groups_config = load_groups_config()

    files = [f for f in os.listdir(MUSIC_DIR) if f.endswith(('.m4a', '.mp3'))]
    files.sort()

    print(f"正在提取详细元数据...")

    for filename in files:
        full_path = os.path.join(MUSIC_DIR, filename)
        item_data = get_detailed_metadata(full_path)

        # 补充文件名，方便前端引用
        item_data["文件名"] = filename
        # 分组：由上方 GROUP_RULES / SONG_GROUPS 划分，写入“分组”字段
        item_data["分组"] = get_track_group(filename, groups_config)

        music_list.append(item_data)
        print(f"已处理: {item_data['标题']} ({filename})")

    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(music_list, f, ensure_ascii=False, indent=4)

    print(f"\n完成！JSON 已生成，包含 {len(music_list)} 首曲目。")


if __name__ == "__main__":
    main()