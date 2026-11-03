/**
 * 地图点位 SVG 图标：统一资源目录 img/地图/markers/，无资源时用内置矢量兜底
 */
(function () {
    "use strict";

    const MARKER_SVG_BASE = "img/地图/markers/";
    const _probeCache = Object.create(null);
    const _imgCache = new Map();
    const _tintCache = new Map();

    /** 内置居中矢量（viewBox 24×24，供 mask 着色） */
    const BUILTIN_MARKER_SVGS = {
        "城镇": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M12 3 5 10v11h5v-6h4v6h5V10l-7-7z"/></svg>',
        "营地": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M4 20h16v-2H4v2zm8-16 8 8h-3v8h-2v-8H8l4-8z"/></svg>',
        "设施": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5zm7.43-2.3 1.62-1.12-1.4-2.42-1.73 1a7.96 7.96 0 0 0 0-3.36l1.73-1-1.4-2.42-1.62 1.12a8.05 8.05 0 0 0-2.9-1.68L14.5 2h-5l-.35 2.04a8.05 8.05 0 0 0-2.9 1.68L4.63 4.6 3.23 7.02l1.73 1a7.96 7.96 0 0 0 0 3.36l-1.73 1 1.4 2.42 1.62-1.12c.82.74 1.82 1.3 2.9 1.68L9.5 22h5l.35-2.04a8.05 8.05 0 0 0 2.9-1.68z"/></svg>',
        "道具": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M4 8h16v12H4V8zm2 2v8h12v-8H6zm5-8 5 4H6l5-4z"/></svg>',
        "隐藏道具": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.8 7.2 17l.9-5.4L4.2 7.7l5.4-.8L12 2z"/></svg>',
        "赏金首": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M12 2C9.8 2 8 3.8 8 6v1H6v2h2v1.5c-2.2.9-4 3-4 5.5V20h16v-4c0-2.5-1.8-4.6-4-5.5V9h2V7h-2V6c0-2.2-1.8-4-4-4zm-2 4c0-1.1.9-2 2-2s2 .9 2 2v1h-4V6zm-1 7h2v3h-2v-3zm4 0h2v3h-2v-3z"/></svg>',
        "怪物": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M12 3c-2 0-3.5 1.2-4 3-.6-.3-1.3-.5-2-.5C3.5 5.5 2 7.5 2 10c0 2.2 1.2 4 3 4.8L4 20h3l1-3h8l1 3h3l-1-5.2c1.8-.8 3-2.6 3-4.8 0-2.5-1.5-4.5-4-4.5-.7 0-1.4.2-2 .5-.5-1.8-2-3-4-3zm-4 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm8 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>',
        "货币": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 2c1.5 0 2.8.5 3.8 1.4-.6.2-1.2.4-1.8.6C13 5.2 12.5 5 12 5c-2.2 0-4 1.8-4 4h2c0-1.1.9-2 2-2 .4 0 .8.1 1.1.3-.8.3-1.6.7-2.3 1.2C8.1 10.5 7 12.1 7 14h2c0-1.3 1-2.4 2.3-2.8.8-.3 1.6-.4 2.4-.3.5.1 1 .3 1.4.5.2.1.4.3.6.5H11v2h4.5c-.3 2.5-2.4 4.5-5 4.5-2.8 0-5-2.2-5-5h-2c0 3.9 3.1 7 7 7s7-3.1 7-7c0-.9-.2-1.7-.5-2.5.7-.5 1.3-1.1 1.8-1.8C17.5 17 15 19 12 19c-2.5 0-4.6-1.6-5.4-3.8 1.2-.8 2.6-1.2 4.1-1.2h2v-2h-1.5c.5-.4 1.1-.7 1.7-1C14.4 9.6 15.8 9 17.3 9H19V7h-1.2c.3-.5.5-1 .6-1.6C19.2 6.2 20.5 7 22 8.2 20.5 4.5 16.6 2 12 2z"/></svg>',
        "特殊": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M12 2l2.6 5.3L20 8.5l-4 3.9.9 5.6L12 15.5 7.1 18l.9-5.6-4-3.9 5.4-1.2L12 2z"/></svg>',
        "事件": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M12 2 2 22h20L12 2zm0 5.5L18.5 20h-13L12 7.5zM11 11v4h2v-4h-2zm0 6v2h2v-2h-2z"/></svg>',
        "入口": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M4 4h10v16H4V4zm12 0h4v16h-4V4zM9 12l4-3v6l-4-3z"/></svg>',
        "出口": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M10 4h10v16H10V4zM2 4h4v16H2V4zm11 8 4 3v-6l-4 3z"/></svg>',
        "人类商店": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" fill-rule="evenodd" d="M8 7V6a4 4 0 1 1 8 0v1h4l-1 12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 7h4zm2 0h4V6a2 2 0 1 0-4 0v1zm-1 4h2v6h-2v-6zm6 0h2v6h-2v-6z"/></svg>',
        "战车商店": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" fill-rule="evenodd" d="M9 7h4v1h6v2h-6v1H9V7zM6 12h11a4 4 0 0 1 4 4v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2a4 4 0 0 1 4-4zm2 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>',
        "酒馆": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" fill-rule="evenodd" d="M4 6h12v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zm3 3v2h6V9H7zm0 4v2h6v-2H7zm9-4h2a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-2v-2h2a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-2V9zM6 3h8v2H6V3z"/></svg>',
        "酒吧": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" fill-rule="evenodd" d="M4 6h12v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zm3 3v2h6V9H7zm0 4v2h6v-2H7zm9-4h2a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-2v-2h2a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-2V9zM6 3h8v2H6V3z"/></svg>',
        "自动贩卖机": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" fill-rule="evenodd" d="M5 2h14a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1h-3v-2h2v-6H6v6h2v2H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm2 3v6h10V5H7zm2 1.5h6V7H9V6.5zM9 9h6v1.5H9V9zm-1 10h3v3H8v-3z"/></svg>',
        "人物": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M12 3.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4.5 20.5a7.5 7.5 0 0 1 15 0v.5h-15v-.5z"/></svg>',
        "贴图": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M4 4h16v16H4V4zm2 2v12h12V6H6zm2 8 2.5-3 1.5 2 2-2.5L16 16H8l2-6z"/></svg>',
        "其他": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle fill="#000" cx="12" cy="12" r="5"/></svg>'
    };

    function encSeg(s) {
        return encodeURIComponent(String(s || "").trim()).replace(/%2F/g, "/");
    }

    function svgDataUrl(svg) {
        return "data:image/svg+xml," + encodeURIComponent(svg);
    }

    function getBuiltinSvgUrl(type) {
        const svg = BUILTIN_MARKER_SVGS[type] || BUILTIN_MARKER_SVGS["其他"];
        return svg ? svgDataUrl(svg) : null;
    }

    /** 按优先级返回候选 SVG 路径（先具体名称，再类型默认） */
    function getMarkerSvgCandidates(type, name) {
        const t = String(type || "").trim();
        const n = String(name || "").trim();
        const out = [];
        const seen = new Set();
        const add = p => {
            if (!p || seen.has(p)) return;
            seen.add(p);
            out.push(p);
        };
        if (t && n) {
            add(MARKER_SVG_BASE + t + "/" + n + ".svg");
            add(MARKER_SVG_BASE + t + "/" + encSeg(n) + ".svg");
        }
        if (t) add(MARKER_SVG_BASE + t + ".svg");
        if (t) add(MARKER_SVG_BASE + "_default/" + t + ".svg");
        return out;
    }

    function probeSvgUrl(url) {
        if (!url || url.startsWith("data:")) return Promise.resolve(true);
        if (_probeCache[url] !== undefined) return Promise.resolve(_probeCache[url]);
        return fetch(url, { method: "HEAD", cache: "force-cache" })
            .then(r => {
                _probeCache[url] = !!r.ok;
                return _probeCache[url];
            })
            .catch(() => {
                _probeCache[url] = false;
                return false;
            });
    }

    async function resolveMarkerSvgUrl(type, name) {
        const list = getMarkerSvgCandidates(type, name);
        for (let i = 0; i < list.length; i++) {
            if (await probeSvgUrl(list[i])) return list[i];
        }
        return getBuiltinSvgUrl(type);
    }

    function applySvgToGlyphSlot(slot, url) {
        if (!slot || !url) return;
        slot.classList.add("has-svg");
        slot.style.setProperty("--marker-svg", `url("${url.replace(/"/g, '\\"')}")`);
        slot.textContent = "";
    }

    function restoreGlyphFallback(slot) {
        if (!slot) return;
        const type = slot.dataset.markerType || "";
        const builtin = getBuiltinSvgUrl(type);
        if (builtin) {
            applySvgToGlyphSlot(slot, builtin);
            return;
        }
        slot.classList.remove("has-svg");
        slot.style.removeProperty("--marker-svg");
        const fb = slot.dataset.fallback || "";
        if (fb) slot.textContent = fb;
    }

    /** 为容器内所有 .marker-svg-slot 异步解析并应用 SVG */
    function upgradeMarkerSvgGlyphs(root) {
        const scope = root || document;
        const slots = scope.querySelectorAll(".marker-svg-slot:not([data-svg-done])");
        slots.forEach(slot => {
            slot.dataset.svgDone = "1";
            const type = slot.dataset.markerType || "";
            const name = slot.dataset.markerName || "";
            const candidates = getMarkerSvgCandidates(type, name);
            let i = 0;
            const tryNext = () => {
                if (i >= candidates.length) {
                    restoreGlyphFallback(slot);
                    return;
                }
                const url = candidates[i++];
                probeSvgUrl(url).then(ok => {
                    if (ok) applySvgToGlyphSlot(slot, url);
                    else tryNext();
                });
            };
            tryNext();
        });
    }

    function makeGlyphSlotHtml(item, cfg) {
        const glyph = (cfg && cfg.glyph) || "◆";
        const type = String(item && item.类型 || "");
        const name = String(item && item.名称 || "");
        const escGlyph = glyph.replace(/</g, "&lt;");
        const escType = type.replace(/"/g, "&quot;");
        const escName = name.replace(/"/g, "&quot;");
        return `<span class="glyph"><span class="marker-svg-slot" data-marker-type="${escType}" data-marker-name="${escName}" data-fallback="${escGlyph}">${escGlyph}</span></span>`;
    }

    /** 图例/侧栏色块：与地图标记共用 SVG 解析链 */
    function makeLegendSwatchHtml(typeName, cfg, markerName, extraCss) {
        const glyph = (cfg && cfg.glyph) || "◆";
        const type = String(typeName || "");
        const name = String(markerName || "");
        const color = String((cfg && cfg.color) || "currentColor").replace(/"/g, "&quot;");
        const extra = String(extraCss || "").replace(/"/g, "&quot;");
        const escGlyph = glyph.replace(/</g, "&lt;").replace(/"/g, "&quot;");
        const escType = type.replace(/"/g, "&quot;");
        const escName = name.replace(/"/g, "&quot;");
        const style = extra ? `color:${color};${extra}` : `color:${color}`;
        return `<span class="swatch" style="${style}"><span class="marker-svg-slot legend-svg-slot" data-marker-type="${escType}" data-marker-name="${escName}" data-fallback="${escGlyph}">${glyph.replace(/</g, "&lt;")}</span></span>`;
    }

    function upgradeLegendSwatches(root) {
        upgradeMarkerSvgGlyphs(root || document);
    }

    function loadMarkerSvgImage(url) {
        if (!url) return Promise.resolve(null);
        if (_imgCache.has(url)) return _imgCache.get(url);
        const p = new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("svg load failed: " + url));
            img.src = url;
        }).catch(() => {
            _imgCache.delete(url);
            return null;
        });
        _imgCache.set(url, p);
        return p;
    }

    function getTintedIconCanvas(img, size, color) {
        const s = Math.max(4, Math.round(size));
        const key = (img.src || "") + "\0" + s + "\0" + color;
        if (_tintCache.has(key)) return _tintCache.get(key);
        const off = document.createElement("canvas");
        off.width = s;
        off.height = s;
        const octx = off.getContext("2d");
        octx.drawImage(img, 0, 0, s, s);
        octx.globalCompositeOperation = "source-in";
        octx.fillStyle = color;
        octx.fillRect(0, 0, s, s);
        _tintCache.set(key, off);
        return off;
    }

    /** 在 Canvas 上绘制着色 SVG 图标（导出图片用） */
    async function drawMarkerIconOnCanvas(ctx, x, y, size, color, type, name) {
        if (!ctx) return false;
        const url = await resolveMarkerSvgUrl(type, name);
        if (!url) return false;
        const img = await loadMarkerSvgImage(url);
        if (!img) return false;
        const tinted = getTintedIconCanvas(img, size, color || "#ffffff");
        const s = tinted.width;
        ctx.drawImage(tinted, x - s / 2, y - s / 2, s, s);
        return true;
    }

    window.MarkerSvg = {
        MARKER_SVG_BASE,
        BUILTIN_MARKER_SVGS,
        getMarkerSvgCandidates,
        getBuiltinSvgUrl,
        resolveMarkerSvgUrl,
        upgradeMarkerSvgGlyphs,
        upgradeLegendSwatches,
        makeGlyphSlotHtml,
        makeLegendSwatchHtml,
        loadMarkerSvgImage,
        drawMarkerIconOnCanvas,
        invalidateProbeCache() {
            Object.keys(_probeCache).forEach(k => delete _probeCache[k]);
            _imgCache.clear();
            _tintCache.clear();
        }
    };
})();
