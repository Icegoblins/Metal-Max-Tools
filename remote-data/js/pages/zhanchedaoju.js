// 战车道具渲染器：效果 + 对象/使用次数/重量 等基础信息
registerPageRenderer("战车道具", {
    skin: "skin-战车道具",

    renderStats: function(item) {
        let html = '';

        html += '<div class="group-title">【道具信息】</div>';
        html += '<div class="stats-grid detail-field-grid">';
        html += `<div class="stat-card">
                    <span class="stat-label">价格</span>
                    <span class="stat-value" style="color:#00ff66;">${formatPrice(getItemPrice(item))}</span>
                 </div>`;

        const usage = item.使用次数 ?? item.消费;
        if (usage !== undefined && usage !== "-" && usage !== "") {
            html += `<div class="stat-card">
                        <span class="stat-label">使用次数</span>
                        <span class="stat-value" style="color:#00ff66;">${usage}</span>
                     </div>`;
        }

        ["对象", "重量(t)", "星数", "类型"].forEach(k => {
            const v = item[k];
            if (v === undefined || v === "-" || v === "") return;
            html += `<div class="stat-card">
                        <span class="stat-label">${k}</span>
                        <span class="stat-value" style="color:#00ff66;">${v}</span>
                     </div>`;
        });
        html += '</div>';

        html += '<div class="group-title">【使用效果】</div>';
        html += '<div class="stats-grid detail-field-grid">';
        html += `<div class="effect-box" style="grid-column: 1 / -1; padding:15px; background:rgba(80,255,125,0.05); border:1px solid #333; color:var(--mm-green); font-size:18px; line-height:1.6;">
                    ${renderSourceRichText(item.效果 || "") || "暂无效果描述"}
                 </div>`;
        html += '</div>';
        html += renderItemMapLocationsSection("战车道具", item.名称);
        return html;
    },

    onUpdateVisual: function(item) {
        const log = `>> 道具档案：${item.名称}\n>> 效果：${item.效果 || "???"}\n>> ${item.描述 && item.描述 !== "-" ? item.描述 : ""}`;
        setTimeout(() => {
            if (window.triggerGlobalTypewriter) window.triggerGlobalTypewriter(log);
        }, 50);
    }
});
