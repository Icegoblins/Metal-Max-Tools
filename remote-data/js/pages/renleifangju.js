registerPageRenderer("人类防具", {
    skin: "skin-人类防具",

    renderStats: function(item) {
        let html = '';

        const iconMap = {
            "物理": "img/icons/phys.png", "火焰": "img/icons/fire.png",
            "寒冰": "img/icons/cold.png", "电磁": "img/icons/elec.png",
            "音波": "img/icons/sonic.png", "毒气": "img/icons/poison.png",
            "激光": "img/icons/beam.png"
        };

        html += '<div class="group-title">【防具性能】</div>';
        html += '<div class="stats-grid detail-field-grid">';
        const defense = item.防御 ?? item.守备;
        const stats = [
            { k: "价格", v: getItemPrice(item), isPrice: true },
            { k: "防御", v: defense },
            { k: "攻击", v: item.攻击 },
            { k: "速度", v: item.速度 },
            { k: "男子气概", v: item.男子气概 },
            { k: "部位", v: item.部位 }
        ];

        stats.forEach(s => {
            if (s.isPrice || ["防御", "攻击", "速度"].includes(s.k) || (s.v !== undefined && s.v !== null && s.v !== "" && s.v !== "-")) {
                let finalValue = s.v;
                if (s.isPrice) {
                    finalValue = formatPrice(s.v);
                } else if (s.k === "防御" || s.k === "攻击" || s.k === "速度") {
                    const num = parseFloat(s.v);
                    if (!isNaN(num)) finalValue = num;
                }

                html += `<div class="stat-card">
                            <span class="stat-label">${s.k}</span>
                            <span class="stat-value" style="color:#00ff66;">${finalValue}</span>
                         </div>`;
            }
        });

        html += '<div class="group-title">【抗性】</div>';
        html += '<div class="stats-grid detail-field-grid">';

        const resists = ["物理", "火焰", "寒冰", "电磁", "音波", "毒气", "激光"];
        resists.forEach(r => {
            const val = (item[r] && item[r] !== "-") ? item[r] : "0";
            const style = val === "0" ? "style='opacity: 0.35;'" : "";

            html += `
                <div class="stat-card" ${style}>
                    <span class="stat-label">
                        <img src="${iconMap[r]}" class="prop-icon" style="width:16px; margin-right:4px;">${r}
                    </span>
                    <span class="stat-value">${val}</span>
                </div>`;
        });

        html += renderCommonJobMatrix(item);

        const sourceInfo = item.获得方法 || item.获取途径 || item.获得途径 || item.出处;
        if (sourceInfo && sourceInfo !== "-") {
            html += renderSourceSection(sourceInfo);
        }
        html += renderItemMapLocationsSection("人类防具", item.名称);
        return html;
    },

    onUpdateVisual: function(item) {
        const imgEl = document.getElementById('detail-img');
        const partDir = item.部位 || "其他";
        if (imgEl) {
            imgEl.src = `img/armor/${partDir}/${item.名称}.png`;
            imgEl.onerror = () => { imgEl.src = 'img/icons/empty_armor.png'; };
        }

        let log = `>> 防具档案：${item.名称}`;
        const desc = item.描述 || item.特性 || item.说明;
        if (desc && desc !== "-") log += `\n>> ${desc}`;
        setTimeout(() => {
            if (window.triggerGlobalTypewriter) window.triggerGlobalTypewriter(log);
        }, 50);
    }
});
