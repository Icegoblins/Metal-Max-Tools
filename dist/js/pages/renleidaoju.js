registerPageRenderer("人类道具", {
    skin: "skin-人类道具", // 建议在 CSS 里定义一个淡蓝或淡紫色皮肤

    renderStats: function(item) {
        let html = '';

        // --- A. 防具性能区 ---
        html += '<div class="group-title">【道具信息】</div>';
        html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">';
        const stats = [
            { k: "价格", v: item.价格 },
            { k: "使用次数", v: item.消耗 },
            { k: "部位", v: item.部位 }
        ];

        stats.forEach(s => {
            if (["价格", "使用次数"].includes(s.k) || (s.v && s.v !== "-")) {
                // 核心判断：如果是价格且为空，显示非卖品
                let finalValue = s.v;
                if (s.k === "价格" && (!s.v || s.v === "-")) {
                    finalValue = "非卖品";
                }else {const num = parseFloat(s.v);if (s.k === "价格") {finalValue = num.toLocaleString() + " G";}}


                html += `<div class="stat-card">
                            <span class="stat-label">${s.k}</span>
                            <span class="stat-value" style="color:#00ff66;">${finalValue}</span>
                         </div>`;
            }
        });

        // 2. 效果大字展示
        html += '<div class="group-title">【使用效果】</div>';
        html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">';
        html += `<div class="effect-box" style="grid-column: span 5;"padding:15px; background:rgba(80,255,125,0.05); border:1px solid #333; color:var(--mm-green); font-size:18px; line-height:1.6;">
                    ${item.效果 || item.说明 || "暂无效果描述"}
                 </div>`;

        // 3. 获得途径 (重用之前的样式)
        const sourceInfo = item.获得方法 || item.出处;
        if (sourceInfo && sourceInfo !== "-") {
            html += '<div class="group-title">【获得途径】</div>';
            html += `<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">${sourceInfo}</div>`;}
        return html;
    },

    onUpdateVisual: function(item) {
        const imgEl = document.getElementById('detail-img');
        if (imgEl) {
            imgEl.src = `img/items/${item.名称}.png`;
            imgEl.onerror = () => { imgEl.src = 'img/icons/empty_item.png'; };
        }
    }
});