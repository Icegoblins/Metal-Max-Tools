// 称号渲染器：入手条件（获取攻略）+ 称号属性（Excel 里加了"效果/属性"等列会自动显示）
registerPageRenderer("称号", {
    skin: "skin-称号",

    // 候选属性列：Excel 里有哪列就显示哪列
    TITLE_ATTR_KEYS: ["效果", "属性", "加成", "称号属性", "类型"],

    renderStats: function(item) {
        let html = '';

        // --- A. 称号属性（有配置才显示） ---
        const attrs = this.TITLE_ATTR_KEYS.filter(k => item[k] && item[k] !== "-");
        if (attrs.length > 0) {
            html += '<div class="group-title">【称号属性】</div>';
            html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">';
            attrs.forEach(k => {
                html += `<div class="stat-card">
                            <span class="stat-label">${k}</span>
                            <span class="stat-value" style="color:#00ff66;">${item[k]}</span>
                         </div>`;
            });
            html += '</div>';
        }

        // --- B. 获取攻略（支持多步骤：Excel 单元格内用 Alt+Enter 换行，或 → / ；分隔步骤） ---
        const guide = item.入手条件 || item.获取方式 || item.获得方法;
        if (guide && guide !== "-") {
            const steps = String(guide).split(/\r?\n|→|⇒|；|;/)
                .map(s => s.trim().replace(/^\d+[.、．)）]\s*/, '').replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, ''))
                .filter(s => s !== "");
            html += '<div class="group-title">【获取攻略】</div>';
            html += `<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">
                        <div style="grid-column: span 5; border:1px dashed #50ff7d; background: rgba(80,255,125,0.05); padding: 12px;">`;
            if (steps.length > 1) {
                steps.forEach((s, i) => {
                    html += `<div style="display:flex; align-items:flex-start; gap:10px; ${i < steps.length - 1 ? 'padding-bottom:10px; border-left:2px solid #1a3d1a; margin-left:12px;' : ''}">
                                <span style="color:#50ff7d; border:1px solid #50ff7d; min-width:26px; text-align:center; padding:2px 0; font-size:11px; flex-shrink:0;">${String(i + 1).padStart(2, '0')}</span>
                                <span style="color:#50ff7d; line-height:1.6;">${s}</span>
                             </div>`;
                });
            } else {
                html += `<span class="stat-label">入手条件</span>
                         <span class="stat-value" style="color:#50ff7d; text-align:left; white-space: normal; line-height:1.6;">${steps[0] || guide}</span>`;
            }
            html += `</div>
                     </div>`;
        }

        // --- C. 描述/备注 ---
        if (item.描述 && item.描述 !== "-") {
            html += '<div class="group-title">【描述】</div>';
            html += `<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">
                        <div class="stat-card" style="grid-column: span 5;">
                            <span class="stat-value" style="color:#888; text-align:left; white-space: normal; line-height:1.5;">${item.描述}</span>
                        </div>
                     </div>`;
        }
        return html;
    },

    onUpdateVisual: function(item) {
        const log = `>> 称号档案：${item.名称}\n>> 入手条件：${item.入手条件 || "???"}\n>> ${item.描述 && item.描述 !== "-" ? item.描述 : ""}`;
        setTimeout(() => {
            if (window.triggerGlobalTypewriter) window.triggerGlobalTypewriter(log);
        }, 50);
    }
});
