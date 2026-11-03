/**
 * 地图点位 ↔ 主站数据库：物品/赏金首/怪物 catalog、关联解析、摘要、反向索引
 */
(function () {
    "use strict";

    const ITEM_CATEGORIES = ["人类武器", "人类防具", "人类道具", "战车装备", "战车道具", "特殊炮弹"];
    const ENTITY_CATEGORIES = ITEM_CATEGORIES.concat(["赏金首", "怪物数据", "冒险指南", "称号"]);
    const MARKER_TYPE_CATEGORIES = {
        "道具": ITEM_CATEGORIES,
        "隐藏道具": ITEM_CATEGORIES,
        "赏金首": ["赏金首"],
        "怪物": ["怪物数据"],
        "事件": ["冒险指南"]
    };
    const LINKED_MARKER_TYPES = new Set(["道具", "隐藏道具", "赏金首", "怪物", "事件"]);
    const CURRENCY_MARKER_TYPE = "货币";
    /** 商店类标记：点击可查看本店商品（自动贩卖机独立实现，不在此列） */
    const SHOP_MARKER_TYPES = new Set(["人类商店", "战车商店", "酒吧"]);
    /** 商店类型 → 展示的商品分类（null = 不过滤） */
    const SHOP_TYPE_CATEGORIES = {
        "人类商店": ["人类武器", "人类防具", "人类道具"],
        "战车商店": ["战车装备", "战车道具", "特殊炮弹"],
        "酒吧": null
    };
    /** 各物品文件里承担"购买地点"职责的字段名（值为 "/" 分隔的商店名） */
    const SHOP_SOURCE_FIELDS = ["获得方式", "获得方法", "获取方式", "获得途径"];

    let _catalog = null;
    let _catalogPromise = null;
    let _markerIndex = null;
    let _markerIndexPromise = null;
    let _shopIndex = null;

    function escHtml(s) {
        return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    }
    function escAttr(s) {
        return String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
    }
    function entityMarkerTypes() {
        if (window.MapBridge && MapBridge.ENTITY_MARKER_TYPES) return MapBridge.ENTITY_MARKER_TYPES;
        return LINKED_MARKER_TYPES;
    }
    function isItemMarkerType(typeName) {
        return typeName === "道具" || typeName === "隐藏道具";
    }
    function isEntityMarkerType(typeName) {
        return entityMarkerTypes().has(typeName);
    }
    function isCurrencyMarkerType(typeName) {
        return typeName === CURRENCY_MARKER_TYPE;
    }
    function categoriesForMarkerType(typeName) {
        return MARKER_TYPE_CATEGORIES[typeName] || ITEM_CATEGORIES;
    }
    function defaultCategoryForMarkerType(typeName) {
        const cats = categoriesForMarkerType(typeName);
        return cats[0] || "人类道具";
    }
    function flattenRows(raw) {
        if (Array.isArray(raw)) {
            if (raw.length && raw[0] && Array.isArray(raw[0].items)) {
                return raw.flatMap(g => g.items || []);
            }
            return raw;
        }
        if (raw && typeof raw === "object" && Array.isArray(raw.data)) {
            if (raw.data.length && raw.data[0] && Array.isArray(raw.data[0].items)) {
                return raw.data.flatMap(g => g.items || []);
            }
            return raw.data;
        }
        return [];
    }
    function isShinyRow(item) {
        return String(item && item.闪光 ? item.闪光 : "-") === "闪光";
    }
    function starRank(item) {
        const n = Number(item && item.星级);
        return Number.isFinite(n) ? n : 0;
    }
    function getPrice(item) {
        if (!item) return undefined;
        const v = item["价格(G)"] ?? item.价格;
        if (v === undefined || v === null || v === "" || v === "-") return undefined;
        return v;
    }
    function fmtPrice(value) {
        if (value === undefined || value === null || value === "" || value === "-") return "非卖品";
        const num = parseFloat(value);
        if (isNaN(num)) return String(value) + " G";
        return num.toLocaleString("zh-CN") + " G";
    }
    function fmtStatPair(pair) {
        if (!Array.isArray(pair) || pair.length === 0) return "";
        const min = pair[0];
        const max = pair.length > 1 ? pair[1] : pair[0];
        if (max === undefined || max === null || min === max) return String(min);
        return min + " ▶ " + max;
    }
    function hasVal(v) {
        return v !== undefined && v !== null && String(v).trim() !== "" && v !== "-";
    }
    function linkKey(cat, name) {
        return String(cat || "") + "\0" + String(name || "");
    }
    function parseLink(link) {
        if (!link || typeof link !== "object") return null;
        const cat = String(link.分类 || "").trim();
        const name = String(link.名称 || "").trim();
        if (!cat || !name || ENTITY_CATEGORIES.indexOf(cat) < 0) return null;
        return { 分类: cat, 名称: name };
    }

    async function loadItemCatalog(force) {
        if (!force && _catalog) return _catalog;
        if (!force && _catalogPromise) return _catalogPromise;
        _catalogPromise = (async () => {
            const byCat = Object.create(null);
            const lists = Object.create(null);
            const shopIndex = Object.create(null);
            await Promise.all(ENTITY_CATEGORIES.map(async cat => {
                const map = Object.create(null);
                try {
                    const r = await fetch("data/" + encodeURIComponent(cat) + ".json?v=" + (window.mmDataVer ? window.mmDataVer() : "0"));
                    if (!r.ok) {
                        byCat[cat] = map;
                        lists[cat] = [];
                        return;
                    }
                    flattenRows(await r.json()).forEach(it => {
                        if (!it || !it.名称) return;
                        if ((cat === "赏金首" || cat === "怪物数据") && isShinyRow(it)) return;
                        const name = String(it.名称);
                        const prev = map[name];
                        if (!prev) {
                            map[name] = it;
                            return;
                        }
                        if (cat === "战车装备" && starRank(it) < starRank(prev)) {
                            map[name] = it;
                        }
                    });
                } catch (e) {
                    console.warn("数据库分类读取失败", cat, e);
                }
                byCat[cat] = map;
                lists[cat] = Object.keys(map).sort((a, b) => a.localeCompare(b, "zh"));
            }));
            _shopIndex = buildShopIndex(byCat);
            _catalog = { byCat, lists };
            return _catalog;
        })().catch(err => {
            _catalogPromise = null;
            throw err;
        });
        return _catalogPromise;
    }

    function getCatalog() {
        return _catalog;
    }

    /** 由最终 catalog 反向构建 商店名 → {分类: [{名称, item}]} 索引 */
    function buildShopIndex(byCat) {
        const shopIndex = Object.create(null);
        ITEM_CATEGORIES.forEach(cat => {
            Object.keys(byCat[cat] || {}).forEach(name => {
                const it = byCat[cat][name];
                SHOP_SOURCE_FIELDS.forEach(f => {
                    const v = it[f];
                    if (!hasVal(v)) return;
                    String(v).split("/").forEach(raw => {
                        const shop = String(raw).trim();
                        if (!shop) return;
                        const perShop = shopIndex[shop] || (shopIndex[shop] = Object.create(null));
                        const bucket = perShop[cat] || (perShop[cat] = []);
                        if (!bucket.some(e => e.名称 === name)) bucket.push({ 名称: name, item: it });
                    });
                });
            });
        });
        return shopIndex;
    }

    function isShopMarkerType(typeName) {
        return SHOP_MARKER_TYPES.has(typeName);
    }

    function shopCategoriesForMarkerType(typeName) {
        const cats = SHOP_TYPE_CATEGORIES[typeName];
        return Array.isArray(cats) ? cats : null;
    }

    /** 标记对应的商店名：显式 商店 字段（"/" 分隔多个）优先，缺省 {地图id}商店 */
    function shopNamesForMarker(marker, mapId) {
        const explicit = String(marker && marker.商店 || "")
            .split("/").map(s => s.trim()).filter(Boolean);
        if (explicit.length) return explicit;
        // 酒吧不参与自动关联：只认手动商品清单或显式 商店 字段
        if (marker && marker.类型 === "酒吧") return [];
        const mid = String(mapId || "").trim();
        return mid ? [mid + "商店"] : [];
    }

    /** 从商店索引收集商品：按 ITEM_CATEGORIES 顺序分组、去重 */
    function getShopInventory(shopNames, allowedCats) {
        const out = [];
        if (!_shopIndex || !Array.isArray(shopNames)) return out;
        const seen = new Set();
        const cats = Array.isArray(allowedCats) && allowedCats.length
            ? ITEM_CATEGORIES.filter(c => allowedCats.indexOf(c) >= 0)
            : ITEM_CATEGORIES;
        cats.forEach(cat => {
            shopNames.forEach(shop => {
                const perShop = _shopIndex[shop];
                ((perShop && perShop[cat]) || []).forEach(e => {
                    const k = linkKey(cat, e.名称);
                    if (seen.has(k)) return;
                    seen.add(k);
                    out.push({ 分类: cat, 名称: e.名称, item: e.item, label: itemLabel(cat, e.item) });
                });
            });
        });
        return out;
    }

    /**
     * 解析商店类标记的商品清单：手动 商品 覆盖 > 自动索引，再应用 排除
     * 分类优先级：标记 分类 字段（数组，建筑内按 NPC 分工筛选）> 标记类型的默认分类
     * 返回 {shops, items, mode: "manual"|"auto", cats}
     */
    function resolveShopInventory(marker, mapId) {
        const shops = shopNamesForMarker(marker, mapId);
        const manualCats = Array.isArray(marker && marker.分类)
            ? marker.分类.map(s => String(s).trim()).filter(c => ITEM_CATEGORIES.indexOf(c) >= 0)
            : null;
        const allowed = (manualCats && manualCats.length)
            ? manualCats
            : shopCategoriesForMarkerType(marker && marker.类型);
        const exclude = new Set((Array.isArray(marker && marker.排除) ? marker.排除 : [])
            .map(s => String(s).trim()).filter(Boolean));
        const manual = Array.isArray(marker && marker.商品) ? marker.商品 : null;
        if (manual && manual.length) {
            // 手动清单是逐条从数据库挑选的，不再按分类过滤
            const items = [];
            manual.forEach(entry => {
                let hit = null;
                if (entry && typeof entry === "object" && String(entry.名称 || "").trim()) {
                    hit = resolveLinkedItem(entry);
                } else if (typeof entry === "string" && entry.trim()) {
                    // 支持 "分类:名称" 或纯 "名称"（自动全库匹配）
                    const txt = entry.trim();
                    const ci = txt.indexOf(":");
                    if (ci > 0) {
                        const cat = txt.slice(0, ci).trim();
                        const nm = txt.slice(ci + 1).trim();
                        hit = ITEM_CATEGORIES.indexOf(cat) >= 0 && nm
                            ? resolveByNameInCat(cat, nm)
                            : null;
                    } else {
                        hit = suggestEntityByName(txt);
                    }
                }
                if (!hit) return;
                if (exclude.has(hit.item.名称)) return;
                if (items.some(e => linkKey(e.分类, e.名称) === linkKey(hit.分类, hit.item.名称))) return;
                items.push({ 分类: hit.分类, 名称: hit.item.名称, item: hit.item, label: itemLabel(hit.分类, hit.item) });
            });
            return { shops, items, mode: "manual", cats: allowed || [] };
        }
        const items = getShopInventory(shops, allowed).filter(it => !exclude.has(it.名称));
        return { shops, items, mode: "auto", cats: allowed || [] };
    }

    /** 弹窗用：确保 catalog 已加载后解析商店清单 */
    async function ensureShopInventory(marker, mapId) {
        await loadItemCatalog();
        return resolveShopInventory(marker, mapId);
    }

    function listItems(cat, query) {
        if (!_catalog) return [];
        const names = _catalog.lists[cat] || [];
        const map = _catalog.byCat[cat] || Object.create(null);
        const q = String(query || "").trim().toLowerCase();
        const out = [];
        names.forEach(name => {
            if (q && name.toLowerCase().indexOf(q) < 0) return;
            const item = map[name];
            if (!item) return;
            out.push({ 分类: cat, 名称: name, item, label: itemLabel(cat, item) });
        });
        return out;
    }

    function itemLabel(cat, item) {
        if (!item) return "";
        if (cat === "战车装备") {
            const star = starRank(item);
            const starTxt = star > 0 ? "★".repeat(star) : "通常";
            const kind = item.分类 || item.部位 || "";
            return kind ? item.名称 + " · " + kind + " · " + starTxt : item.名称 + " · " + starTxt;
        }
        if (cat === "赏金首" || cat === "怪物数据") {
            const lv = item.等级;
            return lv && lv !== "-" ? item.名称 + " · Lv" + lv : item.名称;
        }
        const extra = item.类型 || item.部位 || "";
        return extra ? item.名称 + " · " + extra : item.名称;
    }

    function resolveLinkedItem(link) {
        const parsed = parseLink(link);
        if (!parsed || !_catalog) return null;
        const item = _catalog.byCat[parsed.分类] && _catalog.byCat[parsed.分类][parsed.名称];
        if (!item) return null;
        return { 分类: parsed.分类, item };
    }

    function resolveByNameInCat(cat, name) {
        const q = String(name || "").trim();
        if (!q || !_catalog) return null;
        const item = _catalog.byCat[cat] && _catalog.byCat[cat][q];
        if (!item) return null;
        return { 分类: cat, 名称: q, item };
    }

    /** 从点位解析关联实体：显式 关联物品 优先，赏金首/怪物/道具可按名称回退 */
    function resolveMarkerEntity(marker) {
        if (!marker) return null;
        const explicit = parseLink(marker.关联物品);
        if (explicit) return resolveLinkedItem(explicit);

        const type = marker.类型;
        const name = String(marker.名称 || "").trim();
        if (!name) return null;

        if (type === "赏金首") return resolveByNameInCat("赏金首", name);
        if (type === "怪物") return resolveByNameInCat("怪物数据", name);
        // 事件标记用于冒险指南点位：按名称精确匹配 冒险指南 分类（名称不一致则不强行关联）
        if (type === "事件") return resolveByNameInCat("冒险指南", name);
        if (isItemMarkerType(type)) {
            const hit = suggestEntityByName(name);
            return hit ? { 分类: hit.分类, item: hit.item } : null;
        }
        return null;
    }

    function suggestEntityByName(name, preferredCat) {
        const q = String(name || "").trim();
        if (!q || !_catalog) return null;

        if (preferredCat && _catalog.byCat[preferredCat] && _catalog.byCat[preferredCat][q]) {
            return { 分类: preferredCat, 名称: q, item: _catalog.byCat[preferredCat][q] };
        }

        const hits = [];
        ENTITY_CATEGORIES.forEach(cat => {
            const item = _catalog.byCat[cat] && _catalog.byCat[cat][q];
            if (item) hits.push({ 分类: cat, 名称: q, item });
        });
        if (hits.length === 1) return hits[0];
        if (hits.length > 1) {
            const pref = hits.find(h => h.分类 === preferredCat)
                || hits.find(h => h.分类 === "人类道具")
                || hits.find(h => h.分类 === "赏金首")
                || hits[0];
            return pref;
        }

        const qn = q.toLowerCase();
        const fuzzy = [];
        const searchCats = preferredCat ? [preferredCat] : ENTITY_CATEGORIES;
        searchCats.forEach(cat => {
            (_catalog.lists[cat] || []).forEach(n => {
                if (n.toLowerCase() === qn || n.toLowerCase().indexOf(qn) >= 0) {
                    fuzzy.push({ 分类: cat, 名称: n, item: _catalog.byCat[cat][n] });
                }
            });
        });
        return fuzzy.length === 1 ? fuzzy[0] : null;
    }

    function suggestItemByName(name) {
        return suggestEntityByName(name);
    }

    function sumRow(k, v, fmt) {
        if (!hasVal(v) && k !== "价格" && k !== "金额") return "";
        let display = String(v);
        if (fmt === "price") display = fmtPrice(v);
        else if (fmt === "money") {
            const num = parseFloat(v);
            display = isNaN(num) ? String(v) : num.toLocaleString("zh-CN") + " G";
        }
        return `<div class="item-sum-row"><span>${escHtml(k)}</span><b>${escHtml(display)}</b></div>`;
    }

    function dropsText(item) {
        if (!item) return "";
        return ["掉落物1", "掉落物2", "掉落物3", "掉落物4", "掉落物5"]
            .map(k => item[k])
            .filter(v => hasVal(v))
            .join("、");
    }

    /** 解析一行攻略步骤 → { icon, text, img } */
    function parseGuideStep(line) {
        let s = String(line || "").trim();
        let icon = null;
        const iconMatch = s.match(/^\[(战斗|对话|收集|BOSS|交付|调查|移动)\]\s*/);
        if (iconMatch) {
            icon = iconMatch[1];
            s = s.slice(iconMatch[0].length);
        }
        let img = null;
        const pipeIdx = s.lastIndexOf("|");
        if (pipeIdx >= 0) {
            const tail = s.slice(pipeIdx + 1).trim();
            if (tail && !tail.includes(" ") && /\.(png|jpe?g|webp|gif|bmp)$/i.test(tail)) {
                img = tail;
                s = s.slice(0, pipeIdx);
            }
        }
        return { icon, text: s.trim(), img };
    }

    /** 解析攻略步骤：一行一步；# 开头为结局分支头 */
    function parseGuide(raw) {
        const lines = String(raw || "").split(/\r?\n/).map(s => s.trim()).filter(s => s && s !== "-");
        const common = [];
        const branches = [];
        let cur = null;
        lines.forEach(line => {
            if (line.startsWith("#")) {
                let head = line.slice(1).trim();
                let reward = "";
                const pipeIdx = head.lastIndexOf("|");
                if (pipeIdx >= 0) {
                    const tail = head.slice(pipeIdx + 1).trim();
                    if (/^奖励[:：]/.test(tail)) {
                        reward = tail.replace(/^奖励[:：]/, "").trim();
                        head = head.slice(0, pipeIdx).trim();
                    }
                }
                cur = { title: head, reward, steps: [] };
                branches.push(cur);
                return;
            }
            const step = parseGuideStep(line);
            if (step.text || step.img) {
                if (cur) cur.steps.push(step);
                else common.push(step);
            }
        });
        return { common, branches };
    }

    function branchShortLabel(title) {
        const t = String(title || "").trim();
        const m = t.match(/^([^：:]+)/);
        const short = m ? m[1].trim() : t;
        return short.length > 16 ? short.slice(0, 16) + "…" : short;
    }

    function buildGuideStepSections(guide) {
        const g = guide || { common: [], branches: [] };
        const sections = [];
        if (g.common && g.common.length) {
            sections.push({ 段: "common", 标签: "通用流程", 短标签: "通用", 步骤列表: g.common });
        }
        (g.branches || []).forEach((b, i) => {
            if (!b.steps || !b.steps.length) return;
            sections.push({
                段: "branch",
                分支: i,
                标签: b.title,
                短标签: branchShortLabel(b.title),
                步骤列表: b.steps
            });
        });
        return sections;
    }

    function encodeStepRef(ref) {
        if (!ref) return "";
        if (ref.段 === "branch") return "branch:" + ref.分支 + ":" + ref.步骤;
        return "common:" + ref.步骤;
    }

    function decodeStepRef(s) {
        if (!s) return null;
        const str = String(s);
        if (str.startsWith("branch:")) {
            const parts = str.split(":");
            const 分支 = parseInt(parts[1], 10);
            const 步骤 = parseInt(parts[2], 10);
            if (isNaN(分支) || isNaN(步骤) || 步骤 < 1) return null;
            return { 段: "branch", 分支, 步骤 };
        }
        if (str.startsWith("common:")) {
            const 步骤 = parseInt(str.split(":")[1], 10);
            if (isNaN(步骤) || 步骤 < 1) return null;
            return { 段: "common", 步骤 };
        }
        return null;
    }

    function findGuideSection(sections, ref) {
        if (!ref || !sections) return null;
        if (ref.段 === "branch") {
            return sections.find(s => s.段 === "branch" && s.分支 === ref.分支) || null;
        }
        return sections.find(s => s.段 === "common") || null;
    }

    function normalizeStepRef(ref, guideItem) {
        if (!ref) return null;
        let parsed = null;
        if (typeof ref === "number" || (typeof ref === "string" && /^\d+$/.test(String(ref).trim()))) {
            parsed = { 段: "common", 步骤: parseInt(ref, 10) };
        } else if (typeof ref === "object") {
            const 步骤 = parseInt(ref.步骤, 10);
            if (!步骤 || 步骤 < 1) return null;
            if (ref.段 === "branch") {
                const 分支 = parseInt(ref.分支, 10);
                if (isNaN(分支) || 分支 < 0) return null;
                parsed = { 段: "branch", 分支, 步骤 };
            } else {
                parsed = { 段: "common", 步骤 };
            }
        }
        if (!parsed || !guideItem) return parsed;
        const sections = buildGuideStepSections(parseGuide(guideItem.攻略步骤));
        const sec = findGuideSection(sections, parsed);
        if (!sec || parsed.步骤 > sec.步骤列表.length) return null;
        return parsed;
    }

    function formatGuideStepLabel(guideItem, stepRef) {
        const ref = normalizeStepRef(stepRef, guideItem);
        if (!ref || !guideItem) return "";
        const guide = parseGuide(guideItem.攻略步骤);
        const sections = buildGuideStepSections(guide);
        const sec = findGuideSection(sections, ref);
        if (!sec) return "";
        const total = sec.步骤列表.length;
        const hasBranches = guide.branches && guide.branches.length > 0;
        if (hasBranches) {
            if (ref.段 === "common") return "通用 · " + ref.步骤 + "/" + total;
            return (sec.短标签 || branchShortLabel(sec.标签)) + " · " + ref.步骤 + "/" + total;
        }
        return "步骤 " + ref.步骤 + "/" + total;
    }

    function formatGuideOverview(guideItem) {
        if (!guideItem) return "";
        const guide = parseGuide(guideItem.攻略步骤);
        const commonN = guide.common.length;
        const branchN = guide.branches.reduce((n, b) => n + (b.steps ? b.steps.length : 0), 0);
        const total = commonN + branchN;
        if (!total) return "";
        if (guide.branches.length) return "通用 " + commonN + " 步 · " + guide.branches.length + " 种结局";
        return "共 " + total + " 步";
    }

    function stripStepMarkup(text) {
        return String(text || "")
            .replace(/\[\[[^\]]+\]\]/g, "")
            .replace(/\{\{[^}]+\}\}/g, "")
            .replace(/\[[^\]]+\]\s*/g, "")
            .trim();
    }

    function getGuideStepText(guideItem, stepRef) {
        const ref = normalizeStepRef(stepRef, guideItem);
        if (!ref || !guideItem) return "";
        const sections = buildGuideStepSections(parseGuide(guideItem.攻略步骤));
        const sec = findGuideSection(sections, ref);
        if (!sec) return "";
        const step = sec.步骤列表[ref.步骤 - 1];
        if (!step) return "";
        let t = stripStepMarkup(step.text);
        if (t.length > 80) t = t.slice(0, 80) + "…";
        return t;
    }

    function mapNamesMatch(mapId, coordMapName) {
        const a = String(mapId || "").trim();
        const b = String(coordMapName || "").trim();
        if (!a || !b) return false;
        if (a === b) return true;
        const MB = window.MapBridge;
        if (MB && typeof MB.getMapDisplayName === "function") {
            const disp = MB.getMapDisplayName(a);
            if (disp === b) return true;
        }
        return false;
    }

    const GUIDE_COORD_RE = /\[\[([^@\]|]+)@(\d+)\s*,\s*(\d+)(?:\|[^\]]*)?\]\]/g;

    function suggestGuideStepByCoords(guideRaw, mapId, x, y) {
        const sections = buildGuideStepSections(parseGuide(guideRaw));
        const tol = 5;
        const mx = parseInt(x, 10);
        const my = parseInt(y, 10);
        if (isNaN(mx) || isNaN(my)) return { stepRef: null, matches: [] };
        const matches = [];
        sections.forEach(sec => {
            (sec.步骤列表 || []).forEach((step, i) => {
                const text = step.text || "";
                let m;
                GUIDE_COORD_RE.lastIndex = 0;
                while ((m = GUIDE_COORD_RE.exec(text)) !== null) {
                    const mapName = m[1].trim();
                    const cx = parseInt(m[2], 10);
                    const cy = parseInt(m[3], 10);
                    if (mapNamesMatch(mapId, mapName) && Math.abs(cx - mx) <= tol && Math.abs(cy - my) <= tol) {
                        const stepRef = sec.段 === "branch"
                            ? { 段: "branch", 分支: sec.分支, 步骤: i + 1 }
                            : { 段: "common", 步骤: i + 1 };
                        matches.push({ stepRef, section: sec, stepIndex: i + 1 });
                    }
                }
            });
        });
        if (matches.length === 1) return { stepRef: matches[0].stepRef, matches };
        return { stepRef: null, matches };
    }

    function renderEntitySummaryHtml(cat, item, opts) {
        if (!item) return "";
        let rows = "";
        if (cat === "人类武器") {
            rows += sumRow("价格", getPrice(item), "price");
            rows += sumRow("攻击", item.攻击);
            rows += sumRow("范围", item.范围);
            rows += sumRow("属性", item.属性);
        } else if (cat === "人类防具") {
            rows += sumRow("价格", getPrice(item), "price");
            rows += sumRow("防御", item.防御 ?? item.守备);
            rows += sumRow("部位", item.部位);
        } else if (cat === "人类道具" || cat === "战车道具") {
            rows += sumRow("价格", getPrice(item), "price");
            rows += sumRow("效果", item.效果);
        } else if (cat === "战车装备") {
            rows += sumRow("价格", getPrice(item), "price");
            rows += sumRow("分类", item.分类 || item.部位);
            // stats 全量渲染（主炮攻击力/弹仓、C装置命中/回避、引擎载重等各部位不同）
            const stats = item.stats || {};
            ["攻击力", "弹仓", "命中", "回避", "载重", "守备力", "重量"].forEach(k => {
                if (stats[k] == null) return;
                const pair = fmtStatPair(stats[k]);
                if (pair) rows += sumRow(k, pair);
            });
        } else if (cat === "特殊炮弹") {
            rows += sumRow("价格", getPrice(item), "price");
            rows += sumRow("效果", item.効果 || item.效果);
        } else if (cat === "赏金首") {
            rows += sumRow("等级", item.等级);
            rows += sumRow("HP", item.HP);
            rows += sumRow("赏金", item.赏金 ?? item.金额, "money");
            rows += sumRow("经验", item.经验);
            rows += sumRow("弱点", item.弱点属性);
            rows += sumRow("出没", item.出没地点);
            rows += sumRow("掉落", dropsText(item));
        } else if (cat === "怪物数据") {
            rows += sumRow("等级", item.等级);
            rows += sumRow("HP", item.HP);
            rows += sumRow("攻击", item.攻击);
            rows += sumRow("防御", item.防御);
            rows += sumRow("经验", item.经验);
            rows += sumRow("金钱", item.金钱, "money");
            rows += sumRow("弱点", item.弱点属性);
            rows += sumRow("掉落", dropsText(item));
        } else if (cat === "冒险指南") {
            const stepRef = opts && opts.stepRef;
            if (item.名称) rows += sumRow("任务名称", item.名称);
            if (stepRef) {
                const stepLabel = formatGuideStepLabel(item, stepRef);
                if (stepLabel) rows += sumRow("当前步骤", stepLabel);
                const preview = getGuideStepText(item, stepRef);
                if (preview) rows += sumRow("本步摘要", preview);
            } else {
                const overview = formatGuideOverview(item);
                if (overview) rows += sumRow("步骤", overview);
            }
            rows += sumRow("类型", item.类型);
            rows += sumRow("触发地点", item.触发地点);
            rows += sumRow("触发条件", item.触发条件);
            rows += sumRow("奖励", item.奖励);
        } else {
            rows += sumRow("价格", getPrice(item), "price");
        }
        return `<div class="item-sum"><div class="item-sum-cat">${escHtml(cat)}</div>${rows}</div>`;
    }

    function renderItemSummaryHtml(cat, item) {
        return renderEntitySummaryHtml(cat, item);
    }

    function renderCurrencySummaryHtml(marker) {
        const amt = marker.金额 ?? marker.金币 ?? marker.备注;
        let rows = sumRow("拾取金额", amt, "money");
        if (!rows && marker.名称) rows = sumRow("标注", marker.名称);
        if (!rows) return `<div class="item-sum-unlinked">未填写拾取金额</div>`;
        return `<div class="item-sum"><div class="item-sum-cat">货币拾取</div>${rows}</div>`;
    }

    function markerEntityLink(marker) {
        const explicit = parseLink(marker && marker.关联物品);
        if (explicit) return explicit;
        const type = marker && marker.类型;
        const name = String(marker && marker.名称 || "").trim();
        if (!name) return null;
        if (type === "赏金首") return { 分类: "赏金首", 名称: name };
        if (type === "怪物") return { 分类: "怪物数据", 名称: name };
        if (type === "事件") return { 分类: "冒险指南", 名称: name };
        return null;
    }

    function collectLinkedMarkers(points, kind) {
        const types = entityMarkerTypes();
        const out = [];
        Object.keys(points || {}).forEach(mapId => {
            const arr = points[mapId];
            if (!Array.isArray(arr)) return;
            arr.forEach(marker => {
                if (!marker || !types.has(marker.类型)) return;
                const link = markerEntityLink(marker);
                if (!link) return;
                out.push({ mapId, marker, kind: kind || "preset", link });
            });
        });
        return out;
    }

    async function ensureItemMarkerIndex(force) {
        if (!force && _markerIndex) return _markerIndex;
        if (!force && _markerIndexPromise) return _markerIndexPromise;
        _markerIndexPromise = (async () => {
            const MB = window.MapBridge;
            const empty = { byKey: Object.create(null) };
            if (!MB) {
                _markerIndex = empty;
                return _markerIndex;
            }
            const [points, userData] = await Promise.all([
                MB.fetchPresetPoints(!!force),
                MB.fetchUserMapData(!!force)
            ]);
            if (typeof MB.fetchMaps === "function") await MB.fetchMaps(!!force);
            const byKey = Object.create(null);
            const add = (entry) => {
                const k = linkKey(entry.link.分类, entry.link.名称);
                if (!byKey[k]) byKey[k] = [];
                byKey[k].push(entry);
            };
            collectLinkedMarkers(points, "preset").forEach(add);
            collectLinkedMarkers(userData && userData.marks, "user").forEach(add);
            _markerIndex = { byKey };
            return _markerIndex;
        })().catch(err => {
            _markerIndexPromise = null;
            console.warn("地图点位索引失败", err);
            _markerIndex = { byKey: Object.create(null) };
            return _markerIndex;
        });
        return _markerIndexPromise;
    }

    function renderItemMapMarkersHtml(cat, name) {
        if (!_markerIndex) return "";
        const list = _markerIndex.byKey[linkKey(cat, name)] || [];
        if (!list.length) return "";
        const MB = window.MapBridge;
        return list.map(e => {
            const mapName = MB && typeof MB.getMapDisplayName === "function"
                ? MB.getMapDisplayName(e.mapId)
                : e.mapId;
            const mk = e.marker || {};
            const kindLabel = e.kind === "user" ? "我的标记" : "预设";
            let label = mapName + " (" + (mk.x ?? "?") + ", " + (mk.y ?? "?") + ") · " + kindLabel;
            if (cat === "冒险指南" && mk.关联步骤 && _catalog && _catalog.byCat["冒险指南"]) {
                const guideItem = _catalog.byCat["冒险指南"][name];
                if (guideItem) {
                    const stepLbl = formatGuideStepLabel(guideItem, mk.关联步骤);
                    if (stepLbl) label += " · " + stepLbl;
                }
            }
            const markerName = mk.名称 || name;
            const click = MB
                ? `MapBridge.jumpToMarker('${escAttr(e.mapId)}','${escAttr(markerName)}','${escAttr(e.kind)}')`
                : "";
            const cls = e.kind === "user" ? " drop-item map-loc-tag map-loc-tag--night" : " drop-item map-loc-tag";
            return `<span class="${cls.trim()}" title="${escHtml(label)}" onclick="${click}">${escHtml(label)}</span>`;
        }).join("");
    }

    function jumpToItemInDatabase(cat, name) {
        if (!name) return;
        // 嵌入主站 BS 面板时：通知父页面关闭面板并直接定位，不整页跳转
        if (window.parent && window.parent !== window) {
            try {
                window.parent.postMessage({ type: "mm-bs-close", jump: String(name), cat: String(cat || "") }, "*");
                return;
            } catch (e) { /* 嵌入不可用时回退为普通跳转 */ }
        }
        const p = new URLSearchParams();
        p.set("jump", name);
        if (cat) p.set("cat", cat);
        location.href = "index.html?" + p.toString();
    }

    function invalidateMarkerIndex() {
        _markerIndex = null;
        _markerIndexPromise = null;
    }

    function invalidateCatalog() {
        _catalog = null;
        _catalogPromise = null;
        _shopIndex = null;
        invalidateMarkerIndex();
    }

    window.ItemBridge = {
        ITEM_CATEGORIES,
        ENTITY_CATEGORIES,
        MARKER_TYPE_CATEGORIES,
        LINKED_MARKER_TYPES,
        CURRENCY_MARKER_TYPE,
        SHOP_MARKER_TYPES,
        SHOP_TYPE_CATEGORIES,
        isShopMarkerType,
        shopCategoriesForMarkerType,
        shopNamesForMarker,
        getShopInventory,
        resolveShopInventory,
        ensureShopInventory,
        isItemMarkerType,
        isEntityMarkerType,
        isCurrencyMarkerType,
        categoriesForMarkerType,
        defaultCategoryForMarkerType,
        parseLink,
        loadItemCatalog,
        getCatalog,
        listItems,
        itemLabel,
        resolveLinkedItem,
        resolveMarkerEntity,
        suggestItemByName,
        suggestEntityByName,
        getPrice,
        fmtPrice,
        renderItemSummaryHtml,
        renderEntitySummaryHtml,
        parseGuide,
        parseGuideStep,
        buildGuideStepSections,
        encodeStepRef,
        decodeStepRef,
        normalizeStepRef,
        formatGuideStepLabel,
        formatGuideOverview,
        stripStepMarkup,
        getGuideStepText,
        suggestGuideStepByCoords,
        renderCurrencySummaryHtml,
        ensureItemMarkerIndex,
        renderItemMapMarkersHtml,
        jumpToItemInDatabase,
        invalidateMarkerIndex,
        invalidateCatalog
    };
    window.jumpToItemInDatabase = jumpToItemInDatabase;
})();
