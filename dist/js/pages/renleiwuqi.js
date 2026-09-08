registerPageRenderer("人类武器", {
    skin: "skin-人类武器", // 统一使用你 HTML/CSS 中定义的皮肤名

    // 1. 渲染面板属性（随滚动条移动的部分）
    renderStats: function(item) {
        let html = '';

        // 属性图标映射（复用赏金首的图标路径）
        const attrMap = {
            "通常": "img/icons/phys.png", "物理": "img/icons/phys.png",
            "火炎": "img/icons/fire.png", "火": "img/icons/fire.png",
            "冷气": "img/icons/cold.png", "冷": "img/icons/cold.png",
            "电气": "img/icons/elec.png", "电": "img/icons/elec.png",
            "音波": "img/icons/sonic.png", "音": "img/icons/sonic.png",
            "毒气": "img/icons/poison.png", "气": "img/icons/poison.png",
            "光束": "img/icons/beam.png",  "光": "img/icons/beam.png"
        };

        // --- A. 武器性能区 ---
        html += '<div class="group-title">【武器性能】</div>';
        html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">';
        const stats = [
            { k: "价格", v: item.价格 },
            { k: "攻击", v: item.攻击 },
            { k: "范围", v: item.范围 }
        ];

        stats.forEach(s => {
            // 逻辑：
            // 如果是“价格”列，无论有没有值都显示（没有就显示非卖品）
            // 如果是其他列（攻击/范围），依然遵循“有值才显示”的逻辑
            if (s.k === "价格" || (s.v && s.v !== "-")) {

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
        // 属性图标处理
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

        // --- B. 职业适配矩阵 ---
        // 调用 utils.js 里的通用函数
        html += renderCommonJobMatrix(item);

        // --- C. 获得方式 (增加容错判断) ---
        // 重点：检查 item 里的字段名，如果不显示，请确认 Excel 里这一列的标题
        const sourceInfo = item.获得方式 || item.获取途径 || item.获得途径 || item.出处;
        if (sourceInfo && sourceInfo !== "-") {
            html += '<div class="group-title">【获得途径】</div>';
            html += `<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">${sourceInfo}</div>`;}

        // --- 统一打字机触发公式 ---
        const log = `>> INFANTRY WEAPON LOG:\n` +
                    `>> 名称：${item.名称}\n` +
                    `>> 效果：${item.攻击效果 || "无特殊效果"}\n` +
                    `>> 描述：${item.描述 || "暂无情报。"}`;

        // 2. 调用主接口
        setTimeout(() => {
            if (window.triggerGlobalTypewriter) {
                window.triggerGlobalTypewriter(log);
            }
        }, 50);

        return html;
    },

});