/**
 * 桌面端 SYNC：手动检查云端版本，有更新时询问后再下载。
 */
(function () {
    const IS_TAURI = typeof window.__TAURI__ !== "undefined" && !!window.__TAURI__.core;
    if (!IS_TAURI) return;

    const PANEL_Z = 100000;
    const AUTO_CLOSE_MS = 5000;

    let panelEl = null;
    let checking = false;
    let downloading = false;
    let autoCloseTimer = null;

    function formatVer(v) {
        if (!v) return "—";
        return String(v).replace(/\./g, "/");
    }

    function cancelAutoClose() {
        if (autoCloseTimer) {
            clearTimeout(autoCloseTimer);
            autoCloseTimer = null;
        }
    }

    function hidePanel() {
        cancelAutoClose();
        if (panelEl) panelEl.style.display = "none";
    }

    function scheduleAutoClose(ms) {
        cancelAutoClose();
        autoCloseTimer = setTimeout(hidePanel, ms == null ? AUTO_CLOSE_MS : ms);
    }

    function showPanel() {
        ensurePanel();
        panelEl.style.display = "block";
        document.body.appendChild(panelEl);
    }

    function ensurePanel() {
        if (panelEl) return panelEl;
        panelEl = document.createElement("div");
        panelEl.id = "data-sync-panel";
        panelEl.style.cssText =
            "display:none;position:fixed;right:16px;bottom:16px;z-index:" + PANEL_Z + ";" +
            "min-width:280px;max-width:360px;padding:12px 14px;" +
            "background:rgba(2,6,2,0.96);border:1px solid #2a7a45;color:#9fdfaf;" +
            "font-size:12px;letter-spacing:1px;box-shadow:0 0 24px rgba(0,0,0,0.45);";
        panelEl.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
            '<span style="color:#50ff7d;">DATA SYNC</span>' +
            '<button type="button" id="data-sync-close" style="background:none;border:none;color:#9fdfaf;cursor:pointer;font-size:14px;padding:0 4px;">✕</button>' +
            "</div>" +
            '<div id="data-sync-msg">就绪</div>' +
            '<div id="data-sync-progress-wrap" style="margin-top:8px;display:none;">' +
            '<div style="height:6px;background:#0a1a0f;border:1px solid #2a7a45;">' +
            '<div id="data-sync-bar" style="height:100%;width:0;background:#50ff7d;transition:width .15s;"></div></div>' +
            '<div id="data-sync-detail" style="margin-top:4px;font-size:10px;opacity:.75;"></div></div>';
        document.body.appendChild(panelEl);
        panelEl.querySelector("#data-sync-close").onclick = (e) => {
            e.stopPropagation();
            hidePanel();
        };
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

    function askConfirm(message, onOk) {
        if (typeof window.mmConfirm === "function") {
            window.mmConfirm(message, onOk);
            return;
        }
        if (confirm(message.replace(/<br>/g, "\n"))) onOk();
    }

    async function downloadUpdate(mode) {
        downloading = true;
        cancelAutoClose();
        hidePanel();
        setMsg(mode === "full" ? "正在全量更新…" : "正在下载更新…");
        setProgress(0, "");
        try {
            const run = window.mmRunDataSync;
            const result = run
                ? await run(mode)
                : await window.__TAURI__.core.invoke("sync_data_now_cmd", { fullAlign: mode === "full" });
            showPanel();
            if (result && result.skipped) {
                setMsg(result.message || "远程更新未启用");
                scheduleAutoClose();
                return;
            }
            if (result && result.upToDate) {
                setMsg(`当前数据已为最新\n版本: ${formatVer(result.version)}`);
                setProgress(100, "");
                scheduleAutoClose();
            } else {
                const extra = result && result.message ? `\n${result.message}` : "";
                setMsg(`更新完成: ${(result && result.downloaded) || 0} 个文件${extra}`);
                setProgress(100, result && result.version ? formatVer(result.version) : "");
                scheduleAutoClose();
                if (result && result.reloadSuggested) {
                    cancelAutoClose();
                    setTimeout(() => location.reload(), 800);
                }
            }
            if (window.mmRefreshTitlebarVersion) window.mmRefreshTitlebarVersion();
        } catch (e) {
            setMsg("更新失败: " + (e && e.message ? e.message : String(e)));
            scheduleAutoClose();
        } finally {
            downloading = false;
        }
    }

    async function checkAndPrompt() {
        if (checking) return;
        checking = true;
        cancelAutoClose();
        showPanel();
        setMsg("正在检查云端版本…");
        setProgress(0, "");
        try {
            const check = await window.__TAURI__.core.invoke("check_data_update_cmd");
            if (!check.enabled) {
                setMsg(check.message || "远程数据未启用");
                scheduleAutoClose();
                return;
            }
            const local = formatVer(check.localVersion) || "无";
            const remote = formatVer(check.remoteVersion);
            if (!check.hasUpdate) {
                setMsg(`当前数据已为最新\n版本: ${local}`);
                setProgress(100, "");
                if (window.mmRefreshTitlebarVersion) window.mmRefreshTitlebarVersion();
                scheduleAutoClose();
                return;
            }
            setMsg(`发现新版本: ${local} → ${remote}`);
            hidePanel();
            const msg = `检测到数据版本 ${local} → ${remote}\n请选择更新方式：`;
            if (typeof window.mmPick === "function") {
                window.mmPick(msg, [
                    { label: "增量更新", value: "increment" },
                    { label: "全量更新", value: "full" },
                    { label: "取消", value: null },
                ], mode => {
                    if (!mode) return;
                    if (mode !== "full") { downloadUpdate(mode); return; }
                    // 全量更新有删除行为，二次确认
                    const warn = "全量更新将把本地缓存对齐到远程状态：\n" +
                        "远程已下线的文件会从本地缓存中删除。\n" +
                        "你的标注与配图（用户数据）不受影响。\n\n确定继续吗？";
                    if (typeof window.mmConfirm === "function") {
                        window.mmConfirm(warn, () => downloadUpdate("full"));
                    } else if (confirm(warn)) {
                        downloadUpdate("full");
                    }
                });
            } else {
                askConfirm(msg, () => downloadUpdate("increment"));
            }
        } catch (e) {
            setMsg("检查失败: " + (e && e.message ? e.message : String(e)));
            scheduleAutoClose();
        } finally {
            checking = false;
        }
    }

    window.mmCheckDataUpdate = checkAndPrompt;

    function addTriggerButton() {
        const bar = document.querySelector(".status-bridge .status-text");
        if (!bar || document.getElementById("data-sync-trigger")) return;
        const span = document.createElement("span");
        span.id = "data-sync-trigger";
        span.textContent = "SYNC";
        span.style.cssText = "cursor:pointer;margin-left:8px;color:#50ff7d;";
        span.title = "检查数据更新";
        span.onclick = () => checkAndPrompt();
        bar.appendChild(span);
    }

    window.addEventListener("DOMContentLoaded", () => {
        addTriggerButton();
        window.__TAURI__.event
            .listen("data-sync-progress", (ev) => {
                const p = ev.payload || {};
                if (!panelEl || panelEl.style.display === "none") return;
                cancelAutoClose();
                setProgress(p.percent || 0, p.detail || p.phase || "");
                if (p.message) setMsg(p.message);
                if (p.phase === "done" && !downloading) scheduleAutoClose();
            })
            .catch(() => {});
    });
})();
