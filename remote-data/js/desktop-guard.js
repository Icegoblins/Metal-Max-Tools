// 桌面壳（Tauri）内禁用 WebView 默认右键菜单（刷新 / 检查 / 另存为等）
(function () {
    const isTauri = typeof window.__TAURI__ !== "undefined" && window.__TAURI__.core;
    if (!isTauri) return;
    document.addEventListener("contextmenu", (e) => e.preventDefault(), { capture: true });
})();
