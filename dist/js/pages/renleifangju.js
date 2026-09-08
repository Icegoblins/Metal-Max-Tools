registerPageRenderer("人类防具", {
    skin: "skin-人类防具",

    // 1. 渲染面板属性
    renderStats: function(item) {
        let html = '';

        // 统一图标路径映射
        const iconMap = {
            "物理": "img/icons/phys.png", "火炎": "img/icons/fire.png",
            "冷气": "img/icons/cold.png", "电气": "img/icons/elec.png",
            "音波": "img/icons/sonic.png", "毒气": "img/icons/poison.png",
            "光束": "img/icons/beam.png"
        };

        // --- A. 防具性能区 ---
        html += '<div class="group-title">【防具性能】</div>';
        html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">';
        const stats = [
            { k: "价格", v: item.价格 },
            { k: "守备", v: item.守备 },
            { k: "攻击", v: item.攻击 },
            { k: "速度", v: item.速度 },
            { k: "男子气概", v: item.男子气概 },
            { k: "部位", v: item.部位 }
        ];

        stats.forEach(s => {
            if (["价格", "守备", "攻击", "速度", "男子气概"].includes(s.k) || (s.v && s.v !== "-")) {
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

        // --- B. 元素抗性矩阵 (像赏金首一样排布，固定 8 个格) ---
        html += '<div class="group-title">【抗性】</div>';
        html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">';

        const resists = ["物理", "火炎", "冷气", "电气", "音波", "毒气", "光束"];
        resists.forEach(r => {
            const val = (item[r] && item[r] !== "-") ? item[r] : "0";
            // 效果：抗性为0的格子变暗，有数字的亮起
            const style = val === "0" ? "style='opacity: 0.35;'" : "";

            html += `
                <div class="stat-card" ${style}>
                    <span class="stat-label">
                        <img src="${iconMap[r]}" class="prop-icon" style="width:16px; margin-right:4px;">${r}
                    </span>
                    <span class="stat-value">${val}</span>
                </div>`;
        });





        // --- C. 职业适配 (调用 utils.js) ---
        html += renderCommonJobMatrix(item);

        // --- D. 获得途径 ---
        const sourceInfo = item.获得方法 || item.获取途径 || item.获得途径 || item.出处;
        if (sourceInfo && sourceInfo !== "-") {
            html += '<div class="group-title">【获得途径】</div>';
            html += `<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">${sourceInfo}</div>`;}
        return html;
    },

    // 2. 视觉更新
    onUpdateVisual: function(item) {
        // 图片显示逻辑：自动去对应部位的文件夹找图
        const imgEl = document.getElementById('detail-img');
        const partDir = item.部位 || "其他";
        if (imgEl) {
            // 路径示例: img/armor/头部/快乐头盔.png
            imgEl.src = `img/armor/${partDir}/${item.名称}.png`;
            imgEl.onerror = () => { imgEl.src = 'img/icons/empty_armor.png'; };
        }

        // 投递“特性”到打字机
        const log = item.特性 || item.说明 || ">> 档案读取完毕。";
        if (typeof startTypewriter === "function") startTypewriter(log);
    }
});