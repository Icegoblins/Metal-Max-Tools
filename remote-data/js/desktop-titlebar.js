// 无边框窗口：拖动、窗口按钮、标题栏数据版本号
(function () {
    function formatVerLabel(v) {
        if (!v) return "";
        return "------" + String(v).replace(/\./g, "/");
    }

    async function refreshTitlebarVersion() {
        const tauri = window.__TAURI__;
        if (!tauri || !tauri.core) return;
        let node = document.getElementById("tb-data-ver");
        if (!node) {
            const sub = document.querySelector(".titlebar .tb-sub");
            if (sub) {
                node = document.createElement("span");
                node.id = "tb-data-ver";
                node.className = "tb-ver";
                sub.appendChild(node);
            }
        }
        if (!node) return;
        try {
            const st = await tauri.core.invoke("get_sync_status_cmd");
            const ver = st.localVersion || st.remoteVersion;
            node.textContent = formatVerLabel(ver);
        } catch (_) {
            node.textContent = "";
        }
        // 软件版本号（SYSTEM 后、数据版本号前），取自 tauri.conf.json 的 version
        try {
            let appNode = document.getElementById("tb-app-ver");
            if (!appNode) {
                appNode = document.createElement("span");
                appNode.id = "tb-app-ver";
                appNode.className = "tb-ver";
                node.parentNode.insertBefore(appNode, node);
            }
            const appVer = await tauri.app.getVersion();
            appNode.textContent = appVer ? "V" + appVer : "";
        } catch (_) {
            /* 版本号获取失败时保持隐藏 */
        }
    }

    window.mmRefreshTitlebarVersion = refreshTitlebarVersion;

    function boot() {
        // 内嵌 iframe（如主站 BS控制器面板）里不显示：标题栏只属于顶层窗口，避免出现双标题栏
        if (window.self !== window.top) return;
        const tauri = window.__TAURI__;
        if (!tauri || !tauri.core) return;
        const tb = document.getElementById("titlebar");
        if (!tb) return;
        tb.style.display = "flex";
        tb.style.position = "relative";
        tb.style.zIndex = "10001";

        const drag = tb.querySelector(".tb-drag");
        if (drag) {
            drag.style.cursor = "default";
            drag.setAttribute("data-tauri-drag-region", "");
        }

        const invoke = (cmd) =>
            tauri.core.invoke(cmd, {}).catch((e) => console.warn("[titlebar]", cmd, e));

        const on = (id, cmd) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.style.cursor = "pointer";
            el.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                invoke(cmd);
            });
        };
        on("tb-min", "window_minimize");
        on("tb-max", "window_toggle_maximize");
        on("tb-close", "window_close");

        let syncBtn = document.getElementById("tb-sync");
        if (!syncBtn) {
            syncBtn = document.createElement("span");
            syncBtn.id = "tb-sync";
            syncBtn.className = "tb-sync";
            syncBtn.textContent = "SYNC";
            syncBtn.title = "检查数据更新";
            const drag = tb.querySelector(".tb-drag");
            if (drag) drag.appendChild(syncBtn);
        }
        syncBtn.style.cursor = "pointer";
        syncBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.mmCheckDataUpdate) window.mmCheckDataUpdate();
        };

        refreshTitlebarVersion();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
