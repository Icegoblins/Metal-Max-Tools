/**
 * BS 地图 ↔ 主站互通：预设点位/区域检索与跳转 URL 构建
 */
(function () {
    "use strict";

    let _pointsCache = null;
    let _regionsCache = null;
    let _pointsTs = 0;
    let _regionsTs = 0;
    const CACHE_MS = 15000;

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

    async function fetchPresetPoints(force) {
        const now = Date.now();
        if (!force && _pointsCache && now - _pointsTs < CACHE_MS) return _pointsCache;
        try {
            const r = await fetch("data/地图点位.json?t=" + now);
            if (!r.ok) { _pointsCache = {}; _pointsTs = now; return _pointsCache; }
            _pointsCache = unwrapPoints(await r.json());
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
        try {
            const r = await fetch("data/地图区域.json?t=" + now);
            if (!r.ok) { _regionsCache = {}; _regionsTs = now; return _regionsCache; }
            _regionsCache = unwrapRegions(await r.json());
            _regionsTs = now;
            return _regionsCache;
        } catch (e) {
            console.warn("地图区域读取失败", e);
            _regionsCache = {};
            _regionsTs = now;
            return _regionsCache;
        }
    }

    function norm(s) {
        return String(s || "").trim().toLowerCase();
    }

    function findMarkerInPoints(points, name, fuzzy) {
        const q = norm(name);
        if (!q) return null;
        let fuzzyHit = null;
        for (const mapId of Object.keys(points || {})) {
            const arr = points[mapId];
            if (!Array.isArray(arr)) continue;
            for (const item of arr) {
                if (!item || !item.名称) continue;
                const n = norm(item.名称);
                if (n === q) return { mapId, item, kind: "preset" };
                if (fuzzy && !fuzzyHit && n.includes(q)) fuzzyHit = { mapId, item, kind: "preset" };
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
        const qs = p.toString();
        return "map.html" + (qs ? "?" + qs : "");
    }

    function jumpToMarker(mapId, markerName, kind) {
        location.href = buildMapUrl({ map: mapId, marker: markerName, kind: kind || "preset" });
    }

    function jumpToRegion(mapId, regionName) {
        location.href = buildMapUrl({ map: mapId, region: regionName });
    }

    window.MapBridge = {
        fetchPresetPoints,
        fetchPresetRegions,
        findMarkerInPoints,
        findRegionInData,
        buildMapUrl,
        jumpToMarker,
        jumpToRegion,
        invalidateCache() { _pointsCache = null; _regionsCache = null; }
    };

    window.globalMapJump = async function (placeName) {
        if (!placeName || placeName === "-") return;
        const name = String(placeName).trim();
        const regions = await fetchPresetRegions(false);
        const points = await fetchPresetPoints(false);
        const reg = findRegionInData(regions, name, false)
            || findRegionInData(regions, name, true);
        if (reg) {
            MapBridge.jumpToRegion(reg.mapId, reg.region.名称);
            return;
        }
        const mk = findMarkerInPoints(points, name, false)
            || findMarkerInPoints(points, name, true);
        if (mk) {
            MapBridge.jumpToMarker(mk.mapId, mk.item.名称, mk.kind);
            return;
        }
        if (typeof mmAlert === "function") {
            mmAlert("地图尚未登记地点「" + name + "」", "warning");
        } else {
            alert("地图尚未登记地点「" + name + "」");
        }
    };

    window.searchMapPresetMarker = async function (targetName) {
        const points = await fetchPresetPoints(false);
        return findMarkerInPoints(points, targetName, false)
            || findMarkerInPoints(points, targetName, true);
    };
})();
