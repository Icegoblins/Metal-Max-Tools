registerPageRenderer("人类道具", {
    skin: "skin-人类道具",

    renderStats: function(item) {
        let html = '';

        html += '<div class="group-title">【道具信息】</div>';
        html += '<div class="stats-grid detail-field-grid">';
        const stats = [
            { k: "价格", v: getItemPrice(item), isPrice: true },
            { k: "使用次数", v: item.使用次数 ?? item.消耗 },
            { k: "部位", v: item.部位 }
        ];

        stats.forEach(s => {
            if (s.isPrice || s.k === "使用次数" || (s.v && s.v !== "-")) {
                let finalValue = s.isPrice ? formatPrice(s.v) : s.v;

                html += `<div class="stat-card">
                            <span class="stat-label">${s.k}</span>
                            <span class="stat-value" style="color:#00ff66;">${finalValue}</span>
                         </div>`;
            }
        });

        html += '<div class="group-title">【使用效果】</div>';
        html += '<div class="stats-grid detail-field-grid">';
        html += `<div class="effect-box" style="grid-column: 1 / -1; padding:15px; background:rgba(80,255,125,0.05); border:1px solid #333; color:var(--mm-green); font-size:18px; line-height:1.6;">
                    ${renderSourceRichText(item.效果 || item.说明 || "") || "暂无效果描述"}
                 </div>`;
        html += '</div>';

        const sourceInfo = item.获得方法 || item.出处;
        if (sourceInfo && sourceInfo !== "-") {
            html += renderSourceSection(sourceInfo);
        }
        html += renderItemMapLocationsSection("人类道具", item.名称);
        return html;
    },

    onUpdateVisual: function(item) {
        const imgEl = document.getElementById('detail-img');
        if (imgEl) {
            imgEl.src = `img/items/${item.名称}.png`;
            imgEl.onerror = () => { imgEl.src = 'img/icons/empty_item.png'; };
        }

        const log = `>> 道具档案：${item.名称}\n>> 效果：${item.效果 || "???"}\n>> ${item.描述 && item.描述 !== "-" ? item.描述 : ""}`;
        setTimeout(() => {
            if (window.triggerGlobalTypewriter) window.triggerGlobalTypewriter(log);
        }, 50);
    }
});
