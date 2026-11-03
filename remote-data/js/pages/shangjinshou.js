registerPageRenderer("赏金首", {
    skin: "skin-赏金首",

    renderStats: function(item) {
        let html = '';
        // 数据字段（远程 JSON）进 innerHTML 前统一转义
        const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

        const renderLocationTags = name => {
            if (typeof renderSpawnLocationTagsHtml === "function") {
                return renderSpawnLocationTagsHtml(name);
            }
            return "未知";
        };

        const iconMap = {
            "物理": "img/icons/phys.png", "火焰": "img/icons/fire.png",
            "寒冰": "img/icons/cold.png", "电磁": "img/icons/elec.png",
            "音波": "img/icons/sonic.png", "毒气": "img/icons/poison.png",
            "激光": "img/icons/beam.png"
        };

        // --- 1. 基础属性 (固定 4 列) ---
        html += '<div class="group-title">【基础属性】</div>';
        html += '<div class="stats-grid detail-field-grid">';
        const attrKeys = ["等级", "HP", "攻击", "防御", "速度", "经验", "金钱"];
        attrKeys.forEach(key => {
            let val = item[key] || "-";
            if (key === "经验" || key === "金钱") {
                const num = parseFloat(val);
                val = (!isNaN(num) ? num.toLocaleString() : val) + (key === "经验" ? " EXP" : " G");
            }
            html += `<div class="stat-card"><span class="stat-label">${key}</span><span class="stat-value">${esc(val)}</span></div>`;
        });
        html += '</div>';

        // --- 2. 抗性矩阵 (赏金首版：固定 7 位 + 变暗逻辑) ---
        html += '<div class="group-title">【抗性】</div>';
        html += '<div class="stats-grid detail-field-grid">';

        const resistKeys = ["物理", "火焰", "寒冰", "电磁", "音波", "毒气", "激光"];
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
                    <span class="stat-value" > ${val ? esc(val) : "0"}</span>
                </div>`;
        });

        // --- 3. 战术情报 (弱点/无效/出没地点) ---
        html += '<div class="group-title">【战术情报】</div>';
        html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid;min-width: 100px; grid-template-columns: repeat(2, 1fr); gap: 10px;">';

        // 辅助函数处理图标化显示
        const formatSpecial = (val) => {
            if(!val || val === "无") return "无";
            return val.split(/[、，,]/).map(v => {
                const name = v.trim();
                return iconMap[name] ? `<img src="${iconMap[name]}" class="prop-icon" title="${esc(name)}">` : esc(name);
            }).join(' ');
        };

        html += `<div class="stat-card"><span class="stat-label">弱点属性</span><span class="stat-value" style="white-space: nowrap;">${formatSpecial(item.弱点属性)}</span></div>`;
        html += `<div class="stat-card"><span class="stat-label">无效属性</span><span class="stat-value" style="white-space: nowrap;">${formatSpecial(item.无效属性)}</span></div>`;
        html += `<div class="stat-card" style="grid-column: 1 / -1;"><span class="stat-label">出没地点</span><span class="stat-value loc-tags">${renderLocationTags(item.名称)}</span></div>`;
        html += '</div>';

        // --- 4. 掉落物（别名展开为 L2 部位 tag） ---
        const dropTokens = collectDropTokensFromItem(item);
        if (dropTokens.length > 0) {
            html += `<div class="group-title">【掉落物】</div>
                     <div class="stats-grid detail-field-grid" style="min-width: 100px;">
                <div class="stat-card" style="grid-column: 1/-1; border: none;">
                    <span class="stat-value loc-tags">${renderDropTagsHtml(dropTokens)}</span>
                </div>`;
        }

        html += renderItemMapLocationsSection("赏金首", item.名称);
        return html;
    },

    onUpdateVisual: function(item) {
        const name = item.名称 || item.name;
        const money = item.金额 || item.赏金 || 0;
        document.getElementById('post-name').innerText = name || "";
        document.getElementById('post-money').innerText = money.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " G";

        const hasTacticAttr = (val) => val && val !== "-" && val !== "无" && val !== "无属性";
        const locText = typeof formatSpawnLocationsText === "function"
            ? formatSpawnLocationsText(item.名称, getMonsterSpawnIndex && getMonsterSpawnIndex())
            : "未知";
        let log = `>> BOUNTY TARGET LOG:\n`;
        if (typeof isShinyRow === "function" && isShinyRow(item)) log += `>> 状态：闪光\n`;
        log += `>> 代号：${item.名称}\n` +
                  `>> 危险等级：${item.等级 || "？？？"}\n` +
                  `>> 出没地点：${locText}\n` +
                  `>> 赏金：${item.赏金 || "？？？"}`;
        if (hasTacticAttr(item.弱点属性)) log += `\n>> 弱点属性：${item.弱点属性}`;
        if (hasTacticAttr(item.无效属性)) log += `\n>> 无效属性：${item.无效属性}`;
        log += `\n>> 观测记录：${item.描述 && item.描述 !== "-" ? item.描述 : "尚未观测。"}`;

        // 2. 调用主接口
        setTimeout(() => {
            if (window.triggerGlobalTypewriter) {
                window.triggerGlobalTypewriter(log);
            }
        }, 50);

        const imgContainer = document.getElementById('img-container');
    }
});