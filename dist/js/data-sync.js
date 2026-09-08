/**
 * 桌面端远程数据同步 UI（依赖 Tauri invoke: sync_data_now / get_sync_status）
 */
(function () {
    const IS_TAURI = typeof window.__TAURI__ !== "undefined" && !!window.__TAURI__.core;
    if (!IS_TAURI) return;

    let panelEl = null;
    let statusTimer = null;

    function ensurePanel() {
        if (panelEl) return panelEl;
        panelEl = document.createElement("div");
        panelEl.id = "data-sync-panel";
        panelEl.style.cssText =
            "display:none;position:fixed;right:16px;bottom:16px;z-index:500;" +
            "min-width:280px;max-width:360px;padding:12px 14px;" +
            "background:rgba(2,6,2,0.96);border:1px solid #2a7a45;color:#9fdfaf;" +
            "font-size:12px;letter-spacing:1px;box-shadow:0 0 24px rgba(0,0,0,0.45);";
        panelEl.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
            '<span style="color:#50ff7d;">DATA SYNC</span>' +
            '<button type="button" id="data-sync-close" style="background:none;border:none;color:#9fdfaf;cursor:pointer;">✕</button>' +
            "</div>" +
            '<div id="data-sync-msg">就绪</div>' +
            '<div id="data-sync-progress-wrap" style="margin-top:8px;display:none;">' +
            '<div style="height:6px;background:#0a1a0f;border:1px solid #2a7a45;">' +
            '<div id="data-sync-bar" style="height:100%;width:0;background:#50ff7d;transition:width .15s;"></div></div>' +
            '<div id="data-sync-detail" style="margin-top:4px;font-size:10px;opacity:.75;"></div></div>' +
            '<div style="margin-top:10px;display:flex;gap:8px;">' +
            '<button type="button" id="data-sync-btn" class="mm-btn" style="flex:1;padding:6px 8px;">检查更新</button>' +
            "</div>";
        document.body.appendChild(panelEl);
        panelEl.querySelector("#data-sync-close").onclick = () => {
            panelEl.style.display = "none";
        };
        panelEl.querySelector("#data-sync-btn").onclick = () => runSync(false);
        return panelEl;
    }

    function setProgress(pct, detail) {
        const wrap = document.getElementById("data-sync-progress-wrap");
        const bar = document.getElementById("data-sync-bar");
        const det = document.getElementById("data-sync-detail");
        if (!wrap || !bar) return;
        wrap.style.display = "block";
        bar.style.width = Math.max(0, Math.min(100, pct)) + "%";
        if (det) det.textContent = detail || "";
    }

    function setMsg(text) {
        const el = document.getElementById("data-sync-msg");
        if (el) el.textContent = text;
    }

    async function refreshStatus() {
        try {
            const st = await window.__TAURI__.core.invoke("get_sync_status");
            if (!st || !st.enabled) return;
            const ver = st.remoteVersion || st.localVersion || "—";
            const last = st.lastSyncAt ? new Date(st.lastSyncAt).toLocaleString() : "从未";
            if (st.phase === "idle" && panelEl && panelEl.style.display !== "none") {
                setMsg(`数据版本: ${ver}\n上次同步: ${last}`);
            }
        } catch (_) { /* ignore */ }
    }

    async function runSync(silent) {
        ensurePanel();
        if (!silent) panelEl.style.display = "block";
        setMsg("正在检查更新…");
        setProgress(0, "");
        try {
            const result = await window.__TAURI__.core.invoke("sync_data_now");
            if (result.skipped) {
                setMsg(result.message || "远程更新未启用");
                return;
            }
            if (result.upToDate) {
                setMsg(`已是最新 (${result.version || ""})`);
                setProgress(100, "");
                return;
            }
            setMsg(`同步完成: ${result.downloaded || 0} 个文件`);
            setProgress(100, result.version ? `version ${result.version}` : "");
            if (result.reloadSuggested) {
                setTimeout(() => location.reload(), 800);
            }
        } catch (e) {
            setMsg("同步失败: " + (e && e.message ? e.message : String(e)));
        }
    }

    function addTriggerButton() {
        const bar = document.querySelector(".status-bridge .status-text");
        if (!bar || document.getElementById("data-sync-trigger")) return;
        const span = document.createElement("span");
        span.id = "data-sync-trigger";
        span.textContent = "SYNC";
        span.style.cssText = "cursor:pointer;margin-left:8px;color:#50ff7d;";
        span.title = "检查数据更新";
        span.onclick = () => {
            ensurePanel();
            panelEl.style.display = "block";
            refreshStatus();
        };
        bar.appendChild(span);
    }

    window.addEventListener("DOMContentLoaded", () => {
        addTriggerButton();
        window.__TAURI__.event.listen("data-sync-progress", (ev) => {
            const p = ev.payload || {};
            ensurePanel();
            if (!silentProgress()) panelEl.style.display = "block";
            setProgress(p.percent || 0, p.detail || p.phase || "");
            if (p.message) setMsg(p.message);
        }).catch(() => {});

        runSync(true);
        statusTimer = setInterval(refreshStatus, 15000);
    });

    function silentProgress() {
        return panelEl && panelEl.style.display === "none";
    }
})();
