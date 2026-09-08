registerPageRenderer("赏金首", {
    skin: "skin-赏金首",

    renderStats: function(item) {
        let html = '';

        const escAttr = s => String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const escHtml = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const renderLocationTags = raw => {
            if (!raw || raw === "-" || raw === "未知") return "未知";
            return raw.split(/[、，,]/).map(part => {
                const n = part.trim();
                if (!n || n === "-") return "";
                return `<span class="drop-item map-loc-tag" onclick="globalMapJump('${escAttr(n)}')">${escHtml(n)}</span>`;
            }).filter(Boolean).join(" ");
        };

        const iconMap = {
            "物理": "img/icons/phys.png", "火炎": "img/icons/fire.png",
            "冷气": "img/icons/cold.png", "电气": "img/icons/elec.png",
            "音波": "img/icons/sonic.png", "毒气": "img/icons/poison.png",
            "光束": "img/icons/beam.png"
        };

        // --- 1. 基础属性 (固定 4 列) ---
        html += '<div class="group-title">【基础属性】</div>';
        html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">';
        const attrKeys = ["等级", "HP", "攻击", "防御", "速度", "经验", "金钱"];
        attrKeys.forEach(key => {
            let val = item[key] || "-";
            if (key === "经验" || key === "金钱") {
                const num = parseFloat(val);
                val = (!isNaN(num) ? num.toLocaleString() : val) + (key === "经验" ? " EXP" : " G");
            }
            html += `<div class="stat-card"><span class="stat-label">${key}</span><span class="stat-value">${val}</span></div>`;
        });
        html += '</div>';

        // --- 2. 抗性矩阵 (赏金首版：固定 7 位 + 变暗逻辑) ---
        html += '<div class="group-title">【抗性】</div>';
        html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">';

        const resistKeys = ["物理", "火炎", "冷气", "电气", "音波", "毒气", "光束"];
        resistKeys.forEach(key => {
            const val = item[key];
            // 判定逻辑：只有当数值不是“通常”、“100”或“-”时，才视为有特殊抗性，保持亮起
            const hasResist = val && val !== "通常" && val !== "100" && val !== "-" && val !== "0";
            const style = hasResist ? "" : "style='opacity: 0.35; '";

            html += `
                <div class="stat-card" ${style}>
                    <span class="stat-label">
                        <img src="${iconMap[key]}" class="prop-icon" style="width:16px; margin-right:4px;">${key}
                    </span>
                    <span class="stat-value" > ${val || "0"}</span>
                </div>`;
        });

        // --- 3. 战术情报 (弱点/无效/出没地点) ---
        html += '<div class="group-title">【战术情报】</div>';
        html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid;min-width: 100px; grid-template-columns: repeat(7, 1fr); gap: 10px;">';

        // 辅助函数处理图标化显示
        const formatSpecial = (val) => {
            if(!val || val === "无") return "无";
            return val.split(/[、，,]/).map(v => {
                const name = v.trim();
                return iconMap[name] ? `<img src="${iconMap[name]}" class="prop-icon" title="${name}">` : name;
            }).join(' ');
        };

        html += `<div class="stat-card"><span class="stat-label">弱点属性</span><span class="stat-value">${formatSpecial(item.弱点属性)}</span></div>`;
        html += `<div class="stat-card"><span class="stat-label">无效属性</span><span class="stat-value">${formatSpecial(item.无效属性)}</span></div>`;
        html += `<div class="stat-card"style="grid-column: span 2;"><span class="stat-label">出没地点</span><span class="stat-value">${renderLocationTags(item.出没地点)}</span></div>`;
        html += '</div>';

        // --- 4. 掉落物 ---
        let drops = [item["掉落物1"], item["掉落物2"], item["掉落物3"]].filter(Boolean);
        if (drops.length > 0) {
            html += `<div class="group-title">【掉落物】</div>
                     <div class="stats-grid" style="grid-column: 1 / -1;display: grid;min-width: 100px; grid-template-columns: repeat(7, 1fr); gap: 10px;">
                <div class="stat-card" style="grid-column: 1/-1; flex-direction: row; border: none;">
                    ${drops.map(d => `<span class="drop-item" onclick="globalSearchAndJump('${d}')">${d}</span>`).join('')}
                </div>`;
        }

        return html;
    },

    onUpdateVisual: function(item) {
        const name = item.名称 || item.name;
        const money = item.金额 || item.赏金 || 0;
        document.getElementById('post-name').innerText = name;
        document.getElementById('post-money').innerText = money.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " G";

        // --- 统一打字机触发公式 ---
        const log = `>> BOUNTY TARGET LOG:\n` +
                    `>> 代号：${item.名称}\n` +
                    `>> 危险等级：${item.等级 || "？？？"}\n` +
                    `>> 出没地点：${item.出没地点 || "？？？"}\n` +
                    `>> 赏金：${item.赏金 || "？？？"}\n` +
                    `>> 心得：${item.描述 || "尚未观测。"}`;

        // 2. 调用主接口
        setTimeout(() => {
            if (window.triggerGlobalTypewriter) {
                window.triggerGlobalTypewriter(log);
            }
        }, 50);

        const imgContainer = document.getElementById('img-container');
    }
});