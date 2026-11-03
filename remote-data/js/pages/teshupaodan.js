// 特殊炮弹渲染器：效果 + 制作材料 + 备注
registerPageRenderer("特殊炮弹", {
    skin: "skin-特殊炮弹",

    renderStats: function(item) {
        let html = '';

        html += '<div class="group-title">【炮弹信息】</div>';
        html += '<div class="stats-grid detail-field-grid">';
        html += `<div class="stat-card">
                    <span class="stat-label">价格</span>
                    <span class="stat-value" style="color:#00ff66;">${formatPrice(getItemPrice(item))}</span>
                 </div>`;
        ["材料1", "材料2", "材料3"].forEach(k => {
            const v = item[k];
            if (v === undefined || v === "-") return;
            html += `<div class="stat-card">
                        <span class="stat-label">${k}</span>
                        <span class="stat-value" style="color:#00ff66;">${v}</span>
                     </div>`;
        });
        html += '</div>';

        html += '<div class="group-title">【炮弹效果】</div>';
        html += '<div class="stats-grid detail-field-grid">';
        html += `<div class="effect-box" style="grid-column: 1 / -1; padding:15px; background:rgba(80,255,125,0.05); border:1px solid #333; color:var(--mm-green); font-size:18px; line-height:1.6;">
                    ${renderSourceRichText(item.効果 || item.效果 || "") || "暂无效果描述"}
                 </div>`;
        html += '</div>';

        const remark = item.備考 || item.备考;
        if (remark && remark !== "-") {
            html += '<div class="group-title">【备注】</div>';
            html += `<div class="stats-grid detail-field-grid">
                        <div class="stat-card" style="grid-column: span 5;">
                            <span class="stat-value" style="color:#888; text-align:left; white-space: normal; line-height:1.5;">${remark}</span>
                        </div>
                     </div>`;
        }
        html += renderItemMapLocationsSection("特殊炮弹", item.名称);
        return html;
    },

    onUpdateVisual: function(item) {
        const log = `>> 炮弹档案：${item.名称}\n>> 效果：${item.効果 || item.效果 || "???"}\n>> ${item.描述 && item.描述 !== "-" ? item.描述 : (item.備考 && item.備考 !== "-" ? item.備考 : "")}`;
        setTimeout(() => {
            if (window.triggerGlobalTypewriter) window.triggerGlobalTypewriter(log);
        }, 50);
    }
});
