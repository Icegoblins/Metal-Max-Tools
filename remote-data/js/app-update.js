/**
 * 应用层更新（L1）：启动时静默体检，发现新版提示安装。
 * 与 data-sync.js 的 L2/L3（界面 / 数据在缓存目录热更）相互独立：
 *   那一层走 Pages manifest，改 UI 不用重装；
 *   这一层只处理无法热替换的 exe 本体，必须由安装包完成。
 */
(function () {
    const IS_TAURI = typeof window.__TAURI__ !== "undefined" && !!window.__TAURI__.core;
    if (!IS_TAURI) return;

    const PANEL_Z = 100001;

    let panelEl = null;
    let checking = false;
    let installing = false;
    let closeTimer = null;

    function invoke(cmd, args) {
        return window.__TAURI__.core.invoke(cmd, args || {});
    }

    function errorText(e) {
        if (!e) return "未知错误";
        if (typeof e === "string") return e;
        return e.message || String(e);
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
        }[c]));
    }

    function cancelClose() {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    }

    function hidePanel() {
        cancelClose();
        if (panelEl) panelEl.style.display = "none";
    }

    function show(options) {
        ensurePanel();
        panelEl.querySelector("#app-update-body").innerHTML = options.body;
        const bar = panelEl.querySelector("#app-update-bar-wrap");
        bar.style.display = options.progress ? "block" : "none";
        panelEl.style.display = "block";
        cancelClose();
        if (options.autoCloseMs) closeTimer = setTimeout(hidePanel, options.autoCloseMs);
    }

    function ensurePanel() {
        if (panelEl) return panelEl;
        panelEl = document.createElement("div");
        panelEl.id = "app-update-panel";
        panelEl.style.cssText =
            "display:none;position:fixed;right:16px;bottom:16px;z-index:" + PANEL_Z + ";" +
            "min-width:300px;max-width:380px;padding:12px 14px;" +
            "background:rgba(2,6,14,0.96);border:1px solid #2a6a8a;color:#9fd6ef;" +
            "font-size:12px;letter-spacing:1px;line-height:1.7;" +
            "box-shadow:0 0 24px rgba(0,0,0,0.45);";
        panelEl.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
            '<span style="color:#7ad4ff;">APP UPDATE</span>' +
            '<button type="button" id="app-update-close" style="background:none;border:none;color:#9fd6ef;' +
            'cursor:pointer;font-size:14px;padding:0 4px;">✕</button></div>' +
            '<div id="app-update-body"></div>' +
            '<div id="app-update-bar-wrap" style="margin-top:8px;display:none;">' +
            '<div style="height:6px;background:#0a1420;border:1px solid #2a6a8a;">' +
            '<div id="app-update-bar" style="height:100%;width:0;background:#7ad4ff;transition:width .15s;"></div></div>' +
            '<div id="app-update-detail" style="margin-top:4px;font-size:10px;opacity:.8;"></div></div>';
        document.body.appendChild(panelEl);
        panelEl.querySelector("#app-update-close").onclick = (e) => { e.stopPropagation(); hidePanel(); };
        return panelEl;
    }

    function setProgress(pct, detail) {
        ensurePanel();
        const bar = document.getElementById("app-update-bar");
        const det = document.getElementById("app-update-detail");
        document.getElementById("app-update-bar-wrap").style.display = "block";
        if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + "%";
        if (det) det.textContent = detail || "";
    }

    function buttonHtml(id, label) {
        return '<button type="button" id="' + id + '" style="margin-top:10px;margin-right:8px;' +
            "padding:6px 16px;background:#0a1420;border:1px solid #7ad4ff;color:#7ad4ff;" +
            'cursor:pointer;font-family:inherit;letter-spacing:1px;">' + label + "</button>";
    }

    function offerUpdate(info) {
        const notes = (info.notes || "").trim();
        let body =
            "<div>新版本 v" + escapeHtml(info.latestVersion) + " 可用</div>" +
            '<div style="opacity:.7;">当前版本 v' + escapeHtml(info.currentVersion) + "</div>";
        if (notes) {
            body += '<div style="margin-top:8px;padding:8px;background:rgba(122,212,255,0.08);' +
                'white-space:pre-wrap;word-break:break-all;">' + escapeHtml(notes) + "</div>";
        }
        if (info.canInstall) {
            body += buttonHtml("app-update-go", "立即更新") +
                '<span style="opacity:.6;">更新时会重启应用</span>';
        } else {
            body += '<div style="margin-top:8px;opacity:.8;">当前为绿色便携版，无法自动替换自身。' +
                "下载新版解压覆盖即可（标注与配图在「用户数据」目录，不受影响）。</div>" +
                buttonHtml("app-update-go", "前往下载") +
                '<span style="opacity:.6;">如需自动更新，请改用 setup 安装包版本</span>';
        }
        show({ body: body, progress: false });
        const btn = document.getElementById("app-update-go");
        if (btn) {
            btn.onclick = () => {
                if (info.canInstall) startInstall();
                else invoke("open_releases_page").catch(() => {});
            };
        }
    }

    async function startInstall() {
        if (installing) return;
        installing = true;
        cancelClose();
        const cur = panelEl.querySelector("#app-update-body");
        if (cur) cur.innerHTML = "<div>正在下载并安装更新…</div>";
        setProgress(0, "准备中…");
        try {
            await invoke("install_app_update_cmd");
            setProgress(100, "安装完成，正在重启…");
        } catch (e) {
            installing = false;
            const body = document.getElementById("app-update-body");
            if (body) body.innerHTML = '<div style="color:#ff9d9d;">更新失败: ' + escapeHtml(errorText(e)) + "</div>";
            const det = document.getElementById("app-update-detail");
            if (det) det.textContent = "可稍后重试，或前往 Release 手动下载";
        }
    }

    async function checkAppUpdate(silent) {
        if (checking || installing) return;
        checking = true;
        try {
            const info = await invoke("check_app_update_cmd");
            if (info && info.available) {
                offerUpdate(info);
                return;
            }
            if (!silent) {
                show({
                    body: "<div>" + escapeHtml((info && info.message) || "已是最新版本") + "</div>",
                    progress: false,
                    autoCloseMs: 5000,
                });
            }
        } catch (e) {
            if (!silent) {
                show({
                    body: '<div style="color:#ff9d9d;">检查失败: ' + escapeHtml(errorText(e)) + "</div>",
                    progress: false,
                    autoCloseMs: 6000,
                });
            }
        } finally {
            checking = false;
        }
    }

    async function addVersionBadge() {
        const bar = document.querySelector(".status-bridge .status-text");
        if (!bar || document.getElementById("app-version-badge")) return;
        let version;
        try {
            version = await invoke("get_app_version");
        } catch (e) {
            return;
        }
        const span = document.createElement("span");
        span.id = "app-version-badge";
        span.textContent = "v" + version;
        span.title = "程序版本 v" + version + " — 点击检查程序更新";
        span.style.cssText = "cursor:pointer;margin-left:8px;color:#7ad4ff;";
        span.onclick = () => window.mmCheckAppUpdate();
        bar.appendChild(span);
    }

    window.mmCheckAppUpdate = () => checkAppUpdate(false);

    window.addEventListener("DOMContentLoaded", () => {
        setTimeout(() => {
            addVersionBadge();
            // 静默体检：仅在确有新版时打扰用户
            if (!sessionStorage.getItem("mm-app-update-checked")) {
                sessionStorage.setItem("mm-app-update-checked", "1");
                setTimeout(() => checkAppUpdate(true), 3000);
            }
        }, 400);

        window.__TAURI__.event
            .listen("app-update-progress", (ev) => {
                const p = ev.payload || {};
                if (!installing) return;
                const downloaded = p.downloaded || 0;
                const total = p.total || 0;
                const mb = (n) => (n / 1024 / 1024).toFixed(1) + " MB";
                let detail = p.message || "";
                if (total > 0) detail += "  " + mb(downloaded) + " / " + mb(total);
                setProgress(p.percent || 0, detail);
            })
            .catch(() => {});
    });
})();
