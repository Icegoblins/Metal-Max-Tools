/**
 * BS 地图 ↔ 主站互通：预设点位/区域 + 用户标记/区域检索与跳转 URL 构建
 */
(function () {
    "use strict";

    const LS_MARKS = "mm2r_map_user_marks_v1";
    const LS_REGIONS = "mm2r_map_user_regions_v1";
    const LS_ADMIN_DRAFT = "mm2r_map_admin_draft_v1";  // map.html 编辑模式草稿（同源共享）

    let _pointsCache = null;
    let _regionsCache = null;
    let _pointsTs = 0;
    let _regionsTs = 0;
    let _userDataCache = null;
    let _userDataTs = 0;
    let _mapsCache = null;
    let _mapsTs = 0;
    const CACHE_MS = 15000;
    const ITEM_MARKER_TYPES = new Set(["道具", "隐藏道具"]);
    // 「事件」标记用于任务点位：弹窗可按名称关联 任务.json 并反向跳主站
    const ENTITY_MARKER_TYPES = new Set(["道具", "隐藏道具", "赏金首", "怪物", "事件"]);

    // 会话级数据版本：本会话内 URL 稳定以命中浏览器缓存（此前 ?t=Date.now() 每次都全量重下）
    // map.html 未定义 DATA_VER，直接读写 sessionStorage 与主站共享同一版本号
    function dataVer() {
        if (typeof window.DATA_VER === "string" && window.DATA_VER) return window.DATA_VER;
        try {
            let v = sessionStorage.getItem("MM_DATA_VER");
            if (!v) {
                v = String(Date.now());
                sessionStorage.setItem("MM_DATA_VER", v);
            }
            return v;
        } catch (e) {
            return "0";
        }
    }
    window.mmDataVer = dataVer;

    function unwrapPoints(raw) {
        if (!raw || typeof raw !== "object") return {};
        if (raw.点位 && typeof raw.点位 === "object") return raw.点位;
        return raw;
    }

    function unwrapRegions(raw) {
        if (!raw || typeof raw !== "object") return {};
        if (raw.区域 && typeof raw.区域 === "object") return raw.区域;
        return raw;
    }

    function mergeRegionDict(target, src) {
        Object.keys(src || {}).forEach(k => {
            if (!Array.isArray(src[k])) return;
            if (!target[k]) target[k] = [];
            target[k] = target[k].concat(src[k]);
        });
        return target;
    }

    function readJsonStorage(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : fallback;
        } catch (e) {
            return fallback;
        }
    }

    /** 编辑模式草稿（与 map.html 的 syncDraft 结构一致）：草稿中存在的地图条目覆盖发布数据 */
    function readAdminDraft() {
        const d = readJsonStorage(LS_ADMIN_DRAFT, null);
        if (!d || typeof d !== "object") return null;
        return {
            点位: (d.点位 && typeof d.点位 === "object") ? d.点位 : {},
            区域: (d.区域 && typeof d.区域 === "object") ? d.区域 : {}
        };
    }

    async function fetchPresetPoints(force) {
        const now = Date.now();
        if (!force && _pointsCache && now - _pointsTs < CACHE_MS) return _pointsCache;
        try {
            const r = await fetch("data/地图点位.json?v=" + dataVer());
            if (!r.ok) { _pointsCache = {}; _pointsTs = now; return _pointsCache; }
            const merged = unwrapPoints(await r.json());
            const draft = readAdminDraft();
            if (draft) {
                Object.keys(draft.点位).forEach(mapId => {
                    if (Array.isArray(draft.点位[mapId])) merged[mapId] = draft.点位[mapId];
                });
            }
            _pointsCache = merged;
            _pointsTs = now;
            return _pointsCache;
        } catch (e) {
            console.warn("地图点位读取失败", e);
            _pointsCache = {};
            _pointsTs = now;
            return _pointsCache;
        }
    }

    async function fetchPresetRegions(force) {
        const now = Date.now();
        if (!force && _regionsCache && now - _regionsTs < CACHE_MS) return _regionsCache;
        const merged = {};
        try {
            const r = await fetch("data/地图区域.json?v=" + dataVer());
            if (r.ok) mergeRegionDict(merged, unwrapRegions(await r.json()));
        } catch (e) {
            console.warn("地图区域读取失败", e);
        }
        try {
            const r2 = await fetch("data/地图点位.json?v=" + dataVer());
            if (r2.ok) {
                mergeRegionDict(merged, unwrapRegions(await r2.json()));
            }
        } catch (e) {
            console.warn("地图点位内嵌区域读取失败", e);
        }
        // 编辑模式草稿整图覆盖（与 map.html“改动整体同步进草稿”一致）
        const draft = readAdminDraft();
        if (draft) {
            Object.keys(draft.区域).forEach(mapId => {
                if (Array.isArray(draft.区域[mapId])) merged[mapId] = draft.区域[mapId];
            });
        }
        _regionsCache = merged;
        _regionsTs = now;
        return _regionsCache;
    }

    async function fetchUserMapData(force) {
        const now = Date.now();
        if (!force && _userDataCache && now - _userDataTs < CACHE_MS) return _userDataCache;

        let marks = readJsonStorage(LS_MARKS, {});
        let regions = readJsonStorage(LS_REGIONS, {});

        const IS_TAURI = typeof window.__TAURI__ !== "undefined" && !!window.__TAURI__.core;
        if (IS_TAURI) {
            try {
                const file = await window.__TAURI__.core.invoke("load_data", { name: "地图标记.json" });
                if (file && String(file).trim()) {
                    const parsed = JSON.parse(file);
                    if (parsed && typeof parsed === "object") marks = parsed;
                }
            } catch (e) { /* 用户尚未创建标记文件 */ }
            try {
                const file = await window.__TAURI__.core.invoke("load_data", { name: "地图区域.json" });
                if (file && String(file).trim()) {
                    const parsed = JSON.parse(file);
                    if (parsed && typeof parsed === "object") regions = parsed;
                }
            } catch (e) { /* 用户尚未创建区域文件 */ }
        }

        _userDataCache = { marks, regions };
        _userDataTs = now;
        return _userDataCache;
    }

    async function fetchMaps(force) {
        const now = Date.now();
        if (!force && _mapsCache && now - _mapsTs < CACHE_MS) return _mapsCache;
        try {
            const r = await fetch("data/" + encodeURIComponent("地图") + ".json?v=" + dataVer());
            if (!r.ok) {
                _mapsCache = { list: [], byId: Object.create(null) };
                _mapsTs = now;
                return _mapsCache;
            }
            const raw = await r.json();
            const list = Array.isArray(raw) ? raw : (raw.data || []);
            const byId = Object.create(null);
            list.forEach(m => {
                if (m && m.id) byId[m.id] = m;
            });
            _mapsCache = { list, byId };
            _mapsTs = now;
            return _mapsCache;
        } catch (e) {
            console.warn("地图册读取失败", e);
            _mapsCache = { list: [], byId: Object.create(null) };
            _mapsTs = now;
            return _mapsCache;
        }
    }

    function getMapDisplayName(mapId) {
        if (!mapId) return "";
        const m = _mapsCache && _mapsCache.byId && _mapsCache.byId[mapId];
        return (m && (m.名称 || m.id)) || String(mapId);
    }

    function isItemMarkerType(typeName) {
        return ITEM_MARKER_TYPES.has(typeName);
    }
    function isEntityMarkerType(typeName) {
        return ENTITY_MARKER_TYPES.has(typeName);
    }

    function norm(s) {
        return String(s || "").trim().toLowerCase();
    }

    function findMarkerInPoints(points, name, fuzzy, kind) {
        const q = norm(name);
        if (!q) return null;
        let fuzzyHit = null;
        const markerKind = kind || "preset";
        for (const mapId of Object.keys(points || {})) {
            const arr = points[mapId];
            if (!Array.isArray(arr)) continue;
            for (const item of arr) {
                if (!item || !item.名称) continue;
                const n = norm(item.名称);
                if (n === q) return { mapId, item, kind: markerKind };
                if (fuzzy && !fuzzyHit && n.includes(q)) fuzzyHit = { mapId, item, kind: markerKind };
            }
        }
        return fuzzyHit;
    }

    function findRegionInData(regions, name, fuzzy) {
        const q = norm(name);
        if (!q) return null;
        let fuzzyHit = null;
        for (const mapId of Object.keys(regions || {})) {
            const arr = regions[mapId];
            if (!Array.isArray(arr)) continue;
            for (const r of arr) {
                if (!r || !r.名称) continue;
                const n = norm(r.名称);
                if (n === q) return { mapId, region: r };
                if (fuzzy && !fuzzyHit && n.includes(q)) fuzzyHit = { mapId, region: r };
            }
        }
        return fuzzyHit;
    }

    function buildMapUrl(params) {
        const p = new URLSearchParams();
        if (params.map) p.set("map", params.map);
        if (params.marker) p.set("marker", params.marker);
        if (params.region) p.set("region", params.region);
        if (params.kind) p.set("kind", params.kind);
        if (params.x != null && params.y != null && params.x !== "" && params.y !== "") {
            p.set("x", params.x);
            p.set("y", params.y);
        }
        const qs = p.toString();
        return "map.html" + (qs ? "?" + qs : "");
    }

    // 主站 BS 面板模式（只有顶层主站定义了 openBsPane）：地图在面板内打开/定位，不整页跳转。
    // iframe 内（地图自身环境）无 openBsPane，保持原有带参自导航行为
    function openInPane(queryObj) {
        if (typeof window.openBsPane !== "function") return false;
        try {
            window.openBsPane({ mapQuery: buildMapUrl(queryObj).split("?")[1] || "" });
            return true;
        } catch (e) {
            return false;
        }
    }

    function jumpToMap(mapId) {
        if (openInPane({ map: mapId })) return;
        location.href = buildMapUrl({ map: mapId });
    }

    function jumpToMarker(mapId, markerName, kind) {
        if (openInPane({ map: mapId, marker: markerName, kind: kind || "preset" })) return;
        location.href = buildMapUrl({ map: mapId, marker: markerName, kind: kind || "preset" });
    }

    function jumpToRegion(mapId, regionName) {
        if (openInPane({ map: mapId, region: regionName })) return;
        location.href = buildMapUrl({ map: mapId, region: regionName });
    }

    async function findMapByName(name) {
        const { list } = await fetchMaps(false);
        const q = norm(name);
        if (!q) return null;
        let fuzzyHit = null;
        for (const m of list) {
            if (!m || !m.名称) continue;
            const n = norm(m.名称);
            if (n === q) return m;
            if (!fuzzyHit && n.includes(q)) fuzzyHit = m;
        }
        return fuzzyHit;
    }

    async function resolveMapPlace(name) {
        const [regions, points, userData] = await Promise.all([
            fetchPresetRegions(false),
            fetchPresetPoints(false),
            fetchUserMapData(false)
        ]);

        const reg = findRegionInData(regions, name, false)
            || findRegionInData(regions, name, true)
            || findRegionInData(userData.regions, name, false)
            || findRegionInData(userData.regions, name, true);
        if (reg) {
            return { type: "region", mapId: reg.mapId, name: reg.region.名称 };
        }

        const mk = findMarkerInPoints(points, name, false)
            || findMarkerInPoints(points, name, true)
            || findMarkerInPoints(userData.marks, name, false, "user")
            || findMarkerInPoints(userData.marks, name, true, "user");
        if (mk) {
            return { type: "marker", mapId: mk.mapId, name: mk.item.名称, kind: mk.kind };
        }

        // 兜底：地名与地图册中的地图名称一致时，直接打开该地图
        const map = await findMapByName(name);
        if (map) {
            return { type: "map", mapId: map.id, name: map.名称 };
        }
        return null;
    }

    async function jumpToPoint(mapNameOrId, x, y) {
        const name = String(mapNameOrId || "").trim();
        if (!name) return;
        const { byId } = await fetchMaps(false);
        let mapId = byId[name] ? name : null;
        if (!mapId) {
            const m = await findMapByName(name);
            if (m) mapId = m.id;
        }
        if (!mapId) {
        if (typeof mmAlert === "function") mmAlert("未找到地图「" + name + "」", "warning");
        else alert("未找到地图「" + name + "」");
        return;
    }
        if (openInPane({ map: mapId, x, y })) return;
        location.href = buildMapUrl({ map: mapId, x, y });
    }

    window.MapBridge = {
        ITEM_MARKER_TYPES,
        ENTITY_MARKER_TYPES,
        isItemMarkerType,
        isEntityMarkerType,
        fetchPresetPoints,
        fetchPresetRegions,
        fetchUserMapData,
        fetchMaps,
        getMapDisplayName,
        findMapByName,
        findMarkerInPoints,
        findRegionInData,
        buildMapUrl,
        jumpToMap,
        jumpToMarker,
        jumpToRegion,
        jumpToPoint,
        resolveMapPlace,
        invalidateCache() {
            _pointsCache = null;
            _regionsCache = null;
            _userDataCache = null;
            _mapsCache = null;
            if (window.ItemBridge && typeof ItemBridge.invalidateMarkerIndex === "function") {
                ItemBridge.invalidateMarkerIndex();
            }
        }
    };

    window.globalMapJump = async function (placeName) {
        if (!placeName || placeName === "-") return;
        const name = String(placeName).trim();
        const hit = await resolveMapPlace(name);
        if (hit) {
            if (hit.type === "region") {
                MapBridge.jumpToRegion(hit.mapId, hit.name);
            } else if (hit.type === "map") {
                jumpToMap(hit.mapId);
            } else {
                MapBridge.jumpToMarker(hit.mapId, hit.name, hit.kind);
            }
            return;
        }
        if (typeof mmAlert === "function") {
            mmAlert("地图尚未登记地点「" + name + "」", "warning");
        } else {
            alert("地图尚未登记地点「" + name + "」");
        }
    };

    window.searchMapPresetMarker = async function (targetName) {
        const hit = await resolveMapPlace(targetName);
        if (!hit) return null;
        if (hit.type === "region") {
            return { mapId: hit.mapId, item: { 名称: hit.name }, kind: "region", type: "region" };
        }
        if (hit.type === "map") {
            return { mapId: hit.mapId, item: { 名称: hit.name }, kind: "map", type: "map" };
        }
        return { mapId: hit.mapId, item: { 名称: hit.name }, kind: hit.kind, type: "marker" };
    };
})();
