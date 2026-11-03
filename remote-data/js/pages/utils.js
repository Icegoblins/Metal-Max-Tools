/**
 * 渲染人类装备的职业适配矩阵
 * @param {Object} item - 包含“职业_XXX”键值对的装备数据对象
 * @returns {string} - 生成的 HTML 字符串
 */
function renderCommonJobMatrix(item) {
    // 1. 筛选出所有职业相关的字段 (例如：职业_猎人, 职业_犬)
    const jobKeys = Object.keys(item).filter(key => key.startsWith("职业_"));

    // 如果没有职业数据，则不渲染此模块
    if (jobKeys.length === 0) return "";

    // 2. 特殊职业颜色映射表 (配置化管理)
    // 只要职业名或内容包含键名(Key)，就会应用对应的 CSS 类名
    const specialJobMap = {
        "犬": "dog-limit",       // 金棕色
        "食金虫": "insect-limit", // 青绿色
        "机器人": "special-limit" // 预留紫色
    };

    let html = '<div class="group-title">【职业适配】</div>';
    html += '<div class="stats-grid detail-field-grid">';
    // 容器使用 job-grid 类，配合 CSS 的 display: grid 形成矩阵
    html += '<div class="job-grid">';


    jobKeys.forEach(key => {
        // 提取基础职业名，例如 "职业_机械师" -> "机械师"
        const jobBaseName = key.replace("职业_", "");
        const val = item[key]; // 获取单元格内容，如 "○", "-", "男机械师"

        // 判断该装备是否对该职业可用 (排除 "-" 和空值)
        const isActive = (val !== "-" && val !== "");

        let displayContent = jobBaseName; // 默认显示职业名
        let colorClass = "";              // 存储对应的颜色类名

        if (isActive) {
            // 优先逻辑 A: 检测单元格内容是否包含特定的限定文字
            if (val.includes("男")) {
                colorClass = "male-limit";
                displayContent = val;
            } else if (val.includes("女")) {
                colorClass = "female-limit";
                displayContent = val;
            } else {
                // 优先逻辑 B: 匹配特殊职业配置表 (犬、食金虫等)
                // 同时检查职业底名 (jobBaseName) 和 单元格内容 (val)
                for (let keyword in specialJobMap) {
                    if (jobBaseName.includes(keyword) || val.includes(keyword)) {
                        colorClass = specialJobMap[keyword];
                        break;
                    }
                }

                // 如果是通用标记 "○"，显示职业底名；否则显示具体描述
                displayContent = (val === "○") ? jobBaseName : val;
            }
        }

        // 生成单个职业格子的 HTML
        // active/disabled 控制亮起或灰掉，colorClass 控制具体颜色
        html += `
            <div class="job-tag ${isActive ? 'active' : 'disabled'} ${colorClass}">
                ${displayContent}
            </div>`;
    });

    html += '</div>';
    return html;
}

/** 统一读取售价：优先 价格(G)，兼容旧字段 价格 */
function getItemPrice(item) {
    if (!item) return undefined;
    const v = item["价格(G)"] ?? item.价格;
    if (v === undefined || v === null || v === "" || v === "-") return undefined;
    return v;
}

function formatPrice(value) {
    if (!value || value === "-" || value === "暂无") {
        return "非卖品";
    }

    const num = parseFloat(value);
    if (isNaN(num)) {
        return value + " G"; // 非数字，直接添加单位
    }

    // 格式化数字并添加单位
    return num.toLocaleString('zh-CN') + " G";
}

/** 链装 L2 部位池（与 链装.json 分类+部位 一致） */
const CHAIN_PARTS_BY_CAT = {
    "嵌能": ["头部链装备", "上肢链装备", "躯干链装备", "下肢链装备"],
    "相阵": ["中控链装备", "机动链装备", "主位链装备", "副位链装备", "特位链装备"],
};

const CHAIN_DROP_ALIASES = {
    "嵌能链装": () => CHAIN_PARTS_BY_CAT["嵌能"],
    "人类链装": () => CHAIN_PARTS_BY_CAT["嵌能"],
    "相阵链装": () => CHAIN_PARTS_BY_CAT["相阵"],
    "战车链装": () => CHAIN_PARTS_BY_CAT["相阵"],
    "全部链装": () => [...CHAIN_PARTS_BY_CAT["嵌能"], ...CHAIN_PARTS_BY_CAT["相阵"]],
};

const ALL_CHAIN_PART_SET = new Set(
    Object.values(CHAIN_PARTS_BY_CAT).flat()
);

const DROP_KEY_LIST = ["掉落物1", "掉落物2", "掉落物3", "掉落物4", "掉落物5"];

/** 拆分掉落格并展开链装别名 → L2 部位 token 列表 */
function expandDropTokens(raw) {
    if (raw === undefined || raw === null) return [];
    const s = String(raw).trim();
    if (!s || s === "-") return [];

    const out = [];
    const seen = new Set();
    const add = (t) => {
        const v = String(t).trim();
        if (!v || v === "-" || seen.has(v)) return;
        seen.add(v);
        out.push(v);
    };

    s.split(/[、，,]/).forEach(part => {
        const token = part.trim();
        if (!token || token === "-") return;
        const aliasFn = CHAIN_DROP_ALIASES[token];
        if (aliasFn) {
            aliasFn().forEach(add);
        } else {
            add(token);
        }
    });
    return out;
}

/** 从怪物/赏金首条目收集展开后的全部掉落 token（去重保序） */
function collectDropTokensFromItem(item) {
    const seen = new Set();
    const out = [];
    DROP_KEY_LIST.forEach(k => {
        expandDropTokens(item[k]).forEach(t => {
            if (!seen.has(t)) {
                seen.add(t);
                out.push(t);
            }
        });
    });
    return out;
}

/** 渲染掉落物标签 HTML（跨分类定位跳转，不写入搜索筛选） */
function renderDropTagsHtml(tokens) {
    if (!tokens || tokens.length === 0) return "";
    const escAttr = s => String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const escHtml = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return tokens.map(t => {
        const click = `globalSearchAndJump('${escAttr(t)}')`;
        return `<span class="drop-item" onclick="${click}">${escHtml(t)}</span>`;
    }).join("");
}

/**
 * 把文本中的地图引用渲染为可点击的跳转标签：
 *   [[标记名]]        → globalMapJump 全局解析（区域 → 标记 → 地图）
 *   [[地图id/标记名]]  → MapBridge.jumpToMarker 精确跳到该地图的标记
 * 其余文本转义原样输出；空值 / "nan" 统一显示 "-"
 */
function renderSourceRichText(sourceInfo) {
    let s = sourceInfo == null ? "" : String(sourceInfo).trim();
    if (!s || s.toLowerCase() === "nan") return "-";
    const escHtml = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const escAttr = t => escHtml(t).replace(/'/g, "&#39;");
    const re = /\[\[([^\[\]]+?)\]\]/g;
    let out = "", last = 0, m;
    while ((m = re.exec(s)) !== null) {
        out += escHtml(s.slice(last, m.index));
        const inner = m[1];
        const sep = inner.indexOf("/");
        const mapId = sep > 0 ? inner.slice(0, sep).trim() : "";
        const name = (sep > 0 ? inner.slice(sep + 1) : inner).trim();
        if (name) {
            const click = mapId
                ? `MapBridge.jumpToMarker('${escAttr(mapId)}','${escAttr(name)}','preset')`
                : `globalMapJump('${escAttr(name)}')`;
            out += `<span class="drop-item" style="cursor:pointer" onclick="${click}">📍${escHtml(name)}</span>`;
        } else {
            out += escHtml(m[0]);
        }
        last = re.lastIndex;
    }
    out += escHtml(s.slice(last));
    return out;
}

/** 获得途径区块（与 effect-box 同宽同样式） */
function renderSourceSection(sourceInfo) {
    const raw = sourceInfo == null ? "" : String(sourceInfo).trim();
    if (!raw || raw === "-" || raw.toLowerCase() === "nan") return "";
    return `<div class="group-title">【获得途径】</div>
        <div class="stats-grid detail-field-grid">
            <div class="detail-source-box" style="grid-column: 1 / -1; padding:15px; background:rgba(80,255,125,0.05); border:1px solid #333; color:var(--mm-green); font-size:18px; line-height:1.6;">
                ${renderSourceRichText(raw)}
            </div>
        </div>`;
}

/**
 * 渲染战车星级切换模块
 * @param {Array} starsData - 该装备的星级属性数组
 * @param {number} currentIdx - 当前选中的星级索引 (0-3)
 * @param {Function} onSwitch - 点击切换时的回调
 */
function renderStarSelector(starsData, currentIdx, onSwitch) {
    if (!starsData || starsData.length <= 1) return "";

    let html = '<div class="star-selector-container">';
    const starLabels = ["通常", "★", "★★", "★★★"];

    starLabels.forEach((label, idx) => {
        const isActive = idx === currentIdx ? "active" : "";
        const exists = starsData[idx] ? "" : "disabled";
        // 绑定一个全局临时函数来处理点击，或者在渲染后通过 JS 绑定
        html += `<div class="star-btn ${isActive} ${exists}" onclick="window.switchVehicleStar(${idx})">${label}</div>`;
    });

    html += '</div>';
    return html;
}

/**
 * 计算差值并格式化 HTML
 * @param {number} current - 当前值
 * @param {number} base - 0星基准值
 * @param {boolean} isWeight - 是否是重量（重量降低是绿色，升高是红色）
 */
function formatStatDiff(current, base, isWeight = false) {
    if (current === base) return "";
    const diff = (current - base).toFixed(2);
    const numDiff = parseFloat(diff);

    let color = numDiff > 0 ? "#00ff00" : "#ff3333";
    let sign = numDiff > 0 ? "↑" : "↓";

    // 重量逻辑反转：重量轻了（负数）显示绿色
    if (isWeight) {
        color = numDiff < 0 ? "#00ff00" : "#ff3333";
    }

    return `<span class="stat-diff" style="color:${color};">[${sign}${Math.abs(numDiff)}]</span>`;
}

window.searchAndJump = function(targetName) {
    // 1. 切换到“战车底盘”分类
    const navButtons = document.querySelectorAll('.nav-btn');
    const tankNav = Array.from(navButtons).find(btn => btn.innerText.includes("战车"));

    if (tankNav) {
        tankNav.click(); // 触发分类切换

        // 2. 延迟执行搜索，等待列表渲染
        setTimeout(() => {
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.value = targetName;
                searchInput.dispatchEvent(new Event('input')); // 触发列表过滤

                // 3. 自动点击搜索结果中的第一项
                const firstResult = document.querySelector('.list-item');
                if (firstResult) firstResult.click();
            }
        }, 100);
    }
};

/** 阻止浏览器「保存的信息」候选框（Chrome/Edge 常忽略 autocomplete=off） */
window.mmDisableInputAutofill = function (el) {
    if (!el) return;
    el.setAttribute("autocomplete", "off");
    el.setAttribute("autocorrect", "off");
    el.setAttribute("autocapitalize", "off");
    el.setAttribute("spellcheck", "false");
    el.setAttribute("data-lpignore", "true");
    el.setAttribute("data-form-type", "other");
    if (el.type === "text") {
        try { el.type = "search"; } catch (_) { /* ignore */ }
    }
    el.readOnly = true;
    el.addEventListener("focus", function () {
        el.readOnly = false;
    });
};

function isShinyRow(item) {
    return String(item?.闪光 ?? "-") === "闪光";
}

function filterNormalRows(data) {
    return (data || []).filter(it => !isShinyRow(it));
}

function findMonsterVariant(name, shiny, data) {
    return (data || []).find(it => it.名称 === name && isShinyRow(it) === shiny);
}

function hasShinyVariant(name, data) {
    return (data || []).some(it => it.名称 === name && isShinyRow(it));
}

/** 区域遇敌表：地区列之外的列均为遇敌分组 */
const ENCOUNTER_REGION_KEY = "地区";
const ENCOUNTER_COLUMN_FALLBACK = ["全天", "昼", "夜"];
const ENCOUNTER_COLUMN_LABELS = { "全天": "全天", "昼": "白天", "夜": "夜间" };
const FIXED_ENCOUNTER_COLUMNS = {
    "全天": "all",
    "昼": "day",
    "夜": "night",
    "赏金首": "bounty"
};
const ENCOUNTER_EXTRA_PALETTE_SIZE = 8;

let _encounterColumnKeys = ENCOUNTER_COLUMN_FALLBACK.slice();

/** 按 Excel 列顺序识别遇敌分组列（排除「地区」） */
function getEncounterColumnKeys(rows) {
    const list = rows || [];
    const first = list.find(r => r && String(r[ENCOUNTER_REGION_KEY] || "").trim());
    if (!first) return ENCOUNTER_COLUMN_FALLBACK.slice();
    const keys = Object.keys(first).filter(k => {
        const name = String(k || "").trim();
        if (!name || name === ENCOUNTER_REGION_KEY) return false;
        if (name.startsWith("Unnamed")) return false;
        return true;
    });
    return keys.length ? keys : ENCOUNTER_COLUMN_FALLBACK.slice();
}

function getCachedEncounterColumnKeys() {
    return _encounterColumnKeys;
}

function getExtraEncounterColumns(allKeys) {
    const keys = allKeys && allKeys.length ? allKeys : _encounterColumnKeys;
    return (keys || []).filter(k => !FIXED_ENCOUNTER_COLUMNS[k]);
}

function spawnColumnKind(col, extraCols) {
    if (FIXED_ENCOUNTER_COLUMNS[col]) return FIXED_ENCOUNTER_COLUMNS[col];
    const extras = extraCols || getExtraEncounterColumns();
    const idx = extras.indexOf(col);
    const n = idx >= 0 ? idx % ENCOUNTER_EXTRA_PALETTE_SIZE : 0;
    return "extra-" + n;
}

function spawnColumnTitle(col) {
    if (col === "夜") return "仅夜间出现";
    if (col === "昼") return "仅白天出现";
    if (col === "全天") return "全天出现";
    if (col === "赏金首") return "赏金首出没地点";
    return String(col || "遇敌");
}

function spawnLocationLabel(region, col, opts) {
    if (!col || col === "全天") return region;
    if (opts && opts.omitBountySuffix && col === "赏金首") return region;
    return region + "（" + col + "）";
}

function spawnLocationTagClass(col) {
    const kind = spawnColumnKind(col);
    if (kind === "night") return " map-loc-tag--night";
    if (kind === "day") return " map-loc-tag--day";
    if (kind === "bounty") return " map-loc-tag--bounty";
    if (kind && kind.indexOf("extra-") === 0) return " map-loc-tag--" + kind;
    if (kind === "extra") return " map-loc-tag--extra-0";
    return "";
}

/** 解析遇敌单元格「A、B」→ 名称数组 */
function parseEncounterCell(raw) {
    if (raw === undefined || raw === null) return [];
    const s = String(raw).trim();
    if (!s || s === "-" || s === "未知") return [];
    const out = [];
    const seen = new Set();
    s.split(/[、，,]/).forEach(part => {
        const name = part.trim();
        if (!name || name === "-" || seen.has(name)) return;
        seen.add(name);
        out.push(name);
    });
    return out;
}

/** 区域遇敌行 → { 地区: { 列名: [怪物名] } } */
function buildRegionEncounterMap(regionRows, columnKeys) {
    const keys = columnKeys && columnKeys.length ? columnKeys : getEncounterColumnKeys(regionRows);
    const map = Object.create(null);
    (regionRows || []).forEach(row => {
        const region = String(row?.[ENCOUNTER_REGION_KEY] || "").trim();
        if (!region) return;
        const entry = {};
        keys.forEach(col => {
            entry[col] = parseEncounterCell(row[col]);
        });
        map[region] = entry;
    });
    return map;
}

/** 反向索引：怪物名 → [{ 地区, 类别, 时段 }] */
function buildMonsterSpawnIndex(regionRows, columnKeys) {
    const keys = columnKeys && columnKeys.length ? columnKeys : getEncounterColumnKeys(regionRows);
    const index = Object.create(null);
    (regionRows || []).forEach(row => {
        const region = String(row?.[ENCOUNTER_REGION_KEY] || "").trim();
        if (!region) return;
        keys.forEach(col => {
            parseEncounterCell(row[col]).forEach(name => {
                if (!index[name]) index[name] = [];
                index[name].push({ 地区: region, 类别: col, 时段: col });
            });
        });
    });
    return index;
}

/** 格式化出没地点为可读文本（打字机日志等） */
function formatSpawnLocationsText(monsterName, index) {
    const entries = (index && index[monsterName]) || [];
    if (!entries.length) return "未知";
    const omitBountySuffix = isBountyMonster(monsterName);
    return entries.map(e => spawnLocationLabel(e.地区, e.类别 || e.时段, { omitBountySuffix })).join("、");
}

let _spawnIndexPromise = null;
let _monsterSpawnIndex = null;
let _bountyNameSet = null;

function isBountyMonster(name) {
    return !!(_bountyNameSet && _bountyNameSet.has(name));
}

/** 加载并缓存区域遇敌反向索引 */
function ensureMonsterSpawnIndex() {
    if (_monsterSpawnIndex && _bountyNameSet) return Promise.resolve(_monsterSpawnIndex);
    if (_spawnIndexPromise) return _spawnIndexPromise;
    _spawnIndexPromise = Promise.all([
        fetch("data/" + encodeURIComponent("区域遇敌") + ".json?v=" + (window.mmDataVer ? window.mmDataVer() : "0")),
        fetch("data/" + encodeURIComponent("赏金首") + ".json?v=" + (window.mmDataVer ? window.mmDataVer() : "0"))
    ])
        .then(([encRes, bountyRes]) => {
            if (!encRes.ok) throw new Error("HTTP " + encRes.status);
            if (!bountyRes.ok) throw new Error("赏金首 HTTP " + bountyRes.status);
            return Promise.all([encRes.json(), bountyRes.json()]);
        })
        .then(([encJson, bountyJson]) => {
            const rows = Array.isArray(encJson) ? encJson : (encJson.data || []);
            const bountyRows = Array.isArray(bountyJson) ? bountyJson : (bountyJson.data || []);
            _bountyNameSet = new Set(
                bountyRows
                    .filter(it => it && it.名称 && String(it.闪光 ?? "-") !== "闪光")
                    .map(it => it.名称)
            );
            _encounterColumnKeys = getEncounterColumnKeys(rows);
            window._encounterColumnKeys = _encounterColumnKeys;
            _monsterSpawnIndex = buildMonsterSpawnIndex(rows, _encounterColumnKeys);
            return _monsterSpawnIndex;
        })
        .catch(err => {
            _spawnIndexPromise = null;
            console.warn("区域遇敌表加载失败，出没地点将显示为未知", err);
            _monsterSpawnIndex = Object.create(null);
            _bountyNameSet = new Set();
            return _monsterSpawnIndex;
        });
    return _spawnIndexPromise;
}

function getMonsterSpawnIndex() {
    return _monsterSpawnIndex;
}

/** 渲染出没地点标签 HTML（主站详情） */
function renderSpawnLocationTagsHtml(monsterName) {
    const escAttr = s => String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const escHtml = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const index = getMonsterSpawnIndex();
    const entries = (index && index[monsterName]) || [];
    if (!entries.length) return "未知";
    const bountyPage = isBountyMonster(monsterName);
    return entries.map(e => {
        const col = e.类别 || e.时段;
        const periodClass = bountyPage || col === "赏金首"
            ? " map-loc-tag--bounty"
            : spawnLocationTagClass(col);
        const title = bountyPage || col === "赏金首" ? "赏金首出没地点" : spawnColumnTitle(col);
        const label = spawnLocationLabel(e.地区, col, { omitBountySuffix: bountyPage });
        return `<span class="drop-item map-loc-tag${periodClass}" title="${escAttr(title)}" onclick="globalMapJump('${escAttr(e.地区)}')">${escHtml(label)}</span>`;
    }).join("");
}

window.ensureMonsterSpawnIndex = ensureMonsterSpawnIndex;
window.getMonsterSpawnIndex = getMonsterSpawnIndex;
window.getEncounterColumnKeys = getEncounterColumnKeys;
window.getCachedEncounterColumnKeys = getCachedEncounterColumnKeys;
window.getExtraEncounterColumns = getExtraEncounterColumns;
window.renderSpawnLocationTagsHtml = renderSpawnLocationTagsHtml;
window.formatSpawnLocationsText = formatSpawnLocationsText;
window.buildRegionEncounterMap = buildRegionEncounterMap;
window.buildMonsterSpawnIndex = buildMonsterSpawnIndex;
window.parseEncounterCell = parseEncounterCell;
window.spawnColumnKind = spawnColumnKind;
window.isBountyMonster = isBountyMonster;
window.ENCOUNTER_COLUMN_LABELS = ENCOUNTER_COLUMN_LABELS;

/** 物品详情：地图道具点位标签（无点位则不渲染整块） */
function renderItemMapLocationsSection(cat, name) {
    if (!window.ItemBridge || typeof ItemBridge.renderItemMapMarkersHtml !== "function") return "";
    const tags = ItemBridge.renderItemMapMarkersHtml(cat, name);
    if (!tags) return "";
    return `<div class="group-title">【地图点位】</div>
        <div class="stats-grid detail-field-grid">
            <div class="stat-card" style="grid-column: 1 / -1;">
                <span class="stat-value loc-tags">${tags}</span>
            </div>
        </div>`;
}
window.renderItemMapLocationsSection = renderItemMapLocationsSection;