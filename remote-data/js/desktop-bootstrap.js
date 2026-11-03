/**
 * 桌面端：仅当「数据缓存/」尚无资源时，首次启动自动拉取；之后纯本地运行。
 * dev（npm run dev）：若项目 dist/ 已有 data/，直接走本地静态回退，不触发全量下载。
 */
(function () {
    const IS_TAURI = typeof window.__TAURI__ !== "undefined" && !!window.__TAURI__.core;
    if (!IS_TAURI) return;

    let readyPromise = null;

    function overlayHtml(msg, showRetry) {
        const retry = showRetry
            ? '<button type="button" id="mm-bootstrap-retry" style="margin-top:14px;padding:8px 18px;background:#0a1a0f;border:1px solid #50ff7d;color:#50ff7d;cursor:pointer;font-family:inherit;letter-spacing:1px;">重试</button>'
            : "";
        return (
            '<div style="max-width:420px;line-height:1.7;">' +
            '<div style="font-size:15px;letter-spacing:2px;color:#50ff7d;margin-bottom:8px;">DATA SYNC</div>' +
            '<div id="mm-bootstrap-msg" style="font-size:12px;color:#9fdfaf;">' + msg + "</div>" +
            '<div id="mm-bootstrap-bar-wrap" style="margin-top:12px;height:6px;background:#0a1a0f;border:1px solid #2a7a45;display:none;">' +
            '<div id="mm-bootstrap-bar" style="height:100%;width:0;background:#50ff7d;transition:width .15s;"></div></div>' +
            retry +
            "</div>"
        );
    }

    function showOverlay(msg, showRetry) {
        let el = document.getElementById("mm-bootstrap-overlay");
        if (!el) {
            el = document.createElement("div");
            el.id = "mm-bootstrap-overlay";
            el.style.cssText =
                "position:fixed;inset:0;z-index:99999;background:rgba(2,6,2,0.97);" +
                "display:flex;align-items:center;justify-content:center;padding:24px;";
            document.documentElement.appendChild(el);
        }
        el.innerHTML = overlayHtml(msg, showRetry);
        if (showRetry) {
            document.getElementById("mm-bootstrap-retry").onclick = () => {
                readyPromise = null;
                window.mmEnsureDataReady(true).catch(() => {});
            };
        }
    }

    function setOverlayMsg(msg) {
        const el = document.getElementById("mm-bootstrap-msg");
        if (el) el.innerHTML = msg;
    }

    function setOverlayProgress(pct) {
        const wrap = document.getElementById("mm-bootstrap-bar-wrap");
        const bar = document.getElementById("mm-bootstrap-bar");
        if (!wrap || !bar) return;
        wrap.style.display = "block";
        bar.style.width = Math.max(0, Math.min(100, pct)) + "%";
    }

    function hideOverlay() {
        const el = document.getElementById("mm-bootstrap-overlay");
        if (el) el.remove();
    }

    async function runSyncWithOverlay(mode) {
        showOverlay(mode === "full" ? "正在全量更新…" : "正在下载游戏数据…", true);
        const unlisten = await window.__TAURI__.event
            .listen("data-sync-progress", (ev) => {
                const p = ev.payload || {};
                if (p.message) setOverlayMsg(p.message);
                if (p.percent != null) setOverlayProgress(p.percent);
            })
            .catch(() => null);

        try {
            const result = await window.__TAURI__.core.invoke("sync_data_now_cmd", { fullAlign: mode === "full" });
            if (unlisten) unlisten();
            if (result.skipped) {
                showOverlay(
                    "远程数据未启用<br><small style='opacity:.8'>" +
                        (result.message || "") +
                        "</small>",
                    false
                );
                return result;
            }
            hideOverlay();
            if (window.mmRefreshTitlebarVersion) window.mmRefreshTitlebarVersion();
            return result;
        } catch (e) {
            if (unlisten) unlisten();
            const msg = e && e.message ? e.message : String(e);
            showOverlay("数据同步失败<br><small style='opacity:.8'>" + msg + "</small>", true);
            throw e;
        }
    }

    window.mmRunDataSync = runSyncWithOverlay;

    async function ensureDataReady(force) {
        if (readyPromise && !force) return readyPromise;

        readyPromise = (async () => {
            if (!force) {
                const hasCache = await window.__TAURI__.core.invoke("has_data_cache_cmd");
                if (hasCache) return;
            }
            await runSyncWithOverlay();
        })();

        return readyPromise;
    }

    window.mmEnsureDataReady = ensureDataReady;
})();
