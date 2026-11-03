registerPageRenderer("人类武器", {
    skin: "skin-人类武器",

    renderStats: function(item) {
        let html = '';

        const attrMap = {
            "通常": "img/icons/phys.png", "物理": "img/icons/phys.png",
            "火焰": "img/icons/fire.png", "火": "img/icons/fire.png",
            "寒冰": "img/icons/cold.png", "冰": "img/icons/cold.png", "冷": "img/icons/cold.png",
            "电磁": "img/icons/elec.png", "电": "img/icons/elec.png",
            "音波": "img/icons/sonic.png", "音": "img/icons/sonic.png",
            "毒气": "img/icons/poison.png", "气": "img/icons/poison.png",
            "激光": "img/icons/beam.png",  "光": "img/icons/beam.png"
        };

        html += '<div class="group-title">【武器性能】</div>';
        html += '<div class="stats-grid detail-field-grid">';
        const stats = [
            { k: "价格", v: getItemPrice(item), isPrice: true },
            { k: "攻击", v: item.攻击 },
            { k: "范围", v: item.范围 }
        ];

        stats.forEach(s => {
            if (s.isPrice || (s.v && s.v !== "-")) {
                const finalValue = s.isPrice ? formatPrice(s.v) : s.v;
                html += `<div class="stat-card">
                            <span class="stat-label">${s.k}</span>
                            <span class="stat-value" style="color:#00ff66;">${finalValue}</span>
                         </div>`;
            }
        });

        if (item.属性 && item.属性 !== "-") {
            let attrIcon = '';
            for (let key in attrMap) {
                if (item.属性.includes(key)) {
                    attrIcon = `<img src="${attrMap[key]}" class="prop-icon">`;
                    break;
                }
            }
            html += `<div class="stat-card">
                        <span class="stat-label">属性</span>
                        <span class="stat-value">${attrIcon} ${item.属性}</span>
                     </div>`;
        }
        html += '</div>';

        html += renderCommonJobMatrix(item);

        const sourceInfo = item.获得方式 || item.获取途径 || item.获得途径 || item.出处;
        if (sourceInfo && sourceInfo !== "-") {
            html += renderSourceSection(sourceInfo);
        }
        html += renderItemMapLocationsSection("人类武器", item.名称);

        const log = `>> INFANTRY WEAPON LOG:\n` +
                    `>> 名称：${item.名称}\n` +
                    `>> 效果：${item.特性 || "无特殊效果"}\n` +
                    `>> 描述：${item.描述 || "暂无情报。"}`;

        setTimeout(() => {
            if (window.triggerGlobalTypewriter) {
                window.triggerGlobalTypewriter(log);
            }
        }, 50);

        return html;
    },

});
