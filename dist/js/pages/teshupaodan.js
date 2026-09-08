// 特殊炮弹渲染器：效果 + 制作材料 + 备注
registerPageRenderer("特殊炮弹", {
    skin: "skin-特殊炮弹",

    renderStats: function(item) {
        let html = '';

        // --- A. 炮弹信息 ---
        html += '<div class="group-title">【炮弹信息】</div>';
        html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">';
        const price = parseFloat(item["价格(G)"]);
        html += `<div class="stat-card">
                    <span class="stat-label">价格</span>
                    <span class="stat-value" style="color:#00ff66;">${isNaN(price) ? "非卖品" : price.toLocaleString() + " G"}</span>
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

        // --- B. 炮弹效果 ---
        html += '<div class="group-title">【炮弹效果】</div>';
        html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">';
        html += `<div class="effect-box" style="grid-column: span 5; padding:15px; background:rgba(80,255,125,0.05); border:1px solid #333; color:var(--mm-green); font-size:18px; line-height:1.6;">
                    ${item.効果 || item.效果 || "暂无效果描述"}
                 </div>`;
        html += '</div>';

        // --- C. 备注 ---
        const remark = item.備考 || item.备考;
        if (remark && remark !== "-") {
            html += '<div class="group-title">【备注】</div>';
            html += `<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">
                        <div class="stat-card" style="grid-column: span 5;">
                            <span class="stat-value" style="color:#888; text-align:left; white-space: normal; line-height:1.5;">${remark}</span>
                        </div>
                     </div>`;
        }
        return html;
    },

    onUpdateVisual: function(item) {
        const log = `>> 炮弹档案：${item.名称}\n>> 效果：${item.効果 || item.效果 || "???"}\n>> ${item.描述 && item.描述 !== "-" ? item.描述 : (item.備考 && item.備考 !== "-" ? item.備考 : "")}`;
        setTimeout(() => {
            if (window.triggerGlobalTypewriter) window.triggerGlobalTypewriter(log);
        }, 50);
    }
});
