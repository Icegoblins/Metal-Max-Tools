/**
 * MM2R 战车装备通用渲染器 - 2024 独立对象版
 * 适配数据格式：每个星级为独立条目，stats 为 [min, max]
 */

const vehicleRenderer = {
    skin: "skin-tank-tech",

    // 属性图标映射
    attrMap: {
        "通常": "img/icons/phys.png", "物理": "img/icons/phys.png",
        "火焰": "img/icons/fire.png", "火": "img/icons/fire.png",
        "寒冰": "img/icons/cold.png", "冰": "img/icons/cold.png", "冷": "img/icons/cold.png",
        "电磁": "img/icons/elec.png", "电": "img/icons/elec.png",
        "音波": "img/icons/sonic.png", "音": "img/icons/sonic.png",
        "毒气": "img/icons/poison.png", "气": "img/icons/poison.png",
        "激光": "img/icons/beam.png",  "光": "img/icons/beam.png"
    },

    logHeaders: {
        "主炮": "MAIN CANNON DATA LOG",
        "副炮": "SUB CANNON DATA LOG",
        "S-E": "S-E UNIT DATA LOG",
        "C装置": "C-UNIT DATA LOG",
        "引擎": "ENGINE DATA LOG"
    },

    fmtStatPair: function(pair, unit) {
        unit = unit || "";
        if (!Array.isArray(pair) || pair.length === 0) return "-";
        const min = pair[0];
        const max = pair.length > 1 ? pair[1] : pair[0];
        if (min === max || max === undefined || max === null) return `${min}${unit}`;
        return `${min}${unit} ▶ ${max}${unit}`;
    },

    fmtStar: function(n) {
        const star = Number(n) || 0;
        return star > 0 ? "★".repeat(star) : "通常";
    },

    hasLogVal: function(v) {
        return v != null && String(v).trim() !== "" && v !== "-" && v !== "—";
    },

    pickDesc: function(item, fallback) {
        const keys = ["描述", "说明", "备注"];
        for (let i = 0; i < keys.length; i++) {
            const v = item[keys[i]];
            if (this.hasLogVal(v)) return v;
        }
        return fallback;
    },

    engineUpgradeLabel: function(item) {
        const val = item.改造分支;
        if (val === "1" || val === "—" || val === "-" || !val || val === "0") return "初期型";
        const num = parseInt(val, 10);
        if (!isNaN(num)) return (num - 1) + "阶改造";
        return val;
    },

    buildVehicleLog: function(item) {
        const cat = item.分类 || "装备";
        const s = item.stats || {};
        const header = this.logHeaders[cat] || "DATA LOG";
        const lines = [
            `>> ${header} [admin]:`,
            `>> [ID: ${item.名称}]`,
            `>> 星级：${this.fmtStar(item.星级)}`
        ];

        if (cat === "引擎") {
            lines.push(`>> 核心参数：最大载重 ${this.fmtStatPair(s["载重"], "t")} | 自重 ${this.fmtStatPair(s["重量"], "t")}`);
            lines.push(`>> 守备力：${this.fmtStatPair(s["守备力"], "")} | 类型：${item.类型 || "-"} | 改造：${this.engineUpgradeLabel(item)}`);
            if (this.hasLogVal(item.改造支系)) {
                lines.push(`>> 改造支系：${item.改造支系}`);
            }
            lines.push(`>> 备注说明：${this.pickDesc(item, "该型号暂无额外技术说明")}`);
        } else if (cat === "C装置") {
            lines.push(`>> 命中：${this.fmtStatPair(s["命中"], "%")} | 回避：${this.fmtStatPair(s["回避"], "%")}`);
            lines.push(`>> 守备力：${this.fmtStatPair(s["守备力"], "")} | 重量：${this.fmtStatPair(s["重量"], "t")}`);
            const trait = this.hasLogVal(item.特性) ? item.特性 : "无特殊属性";
            lines.push(`>> 特性匹配：${trait}`);
            lines.push(`>> 详细描述：${this.pickDesc(item, "数据库暂无补充")}`);
        } else {
            lines.push(`>> 攻击力：${this.fmtStatPair(s["攻击力"], "")} | 守备力：${this.fmtStatPair(s["守备力"], "")}`);
            lines.push(`>> 重量：${this.fmtStatPair(s["重量"], "t")} | 弹仓：${this.fmtStatPair(s["弹仓"], "")}`);
            lines.push(`>> 范围：${item.范围 || "-"} | 属性：${item.属性 || "-"}`);
            if (cat === "主炮" && this.hasLogVal(item.特殊炮弹)) {
                lines.push(`>> 特殊炮弹：${item.特殊炮弹}`);
            }
            if (cat === "副炮" && this.hasLogVal(item.可否迎击)) {
                lines.push(`>> 可否迎击：${item.可否迎击}`);
            }
            lines.push(`>> 技术说明：${this.pickDesc(item, "该型号暂无额外技术说明")}`);
        }

        return lines.join("\n");
    },

    // 核心渲染逻辑
    renderStats: function(item) {
        const s = item.stats || {};
        const cat = item.分类 || "装备";

        // 1. 获取该装备的所有星级版本（用于星级切换）
        const allStarVersions = (window.allData || []).filter(it => it.名称 === item.名称);
        const displayVersions = allStarVersions.length > 0 ? allStarVersions : [item];
        displayVersions.sort((a, b) => (a.星级 || 0) - (b.星级 || 0));

        let html = '';

        // --- 第一行：星级选择器 ---
        html += this.renderStarSelector(displayVersions, item);

        // --- 第二行：性能区 ---
        html += `<div class="group-title">【${cat} 基础性能】</div>`;
        html += '<div class="stats-grid detail-field-grid">';

        let config = [];
        if (cat === "引擎") {
            config = [
                { k: "最大载重", v: s["载重"], u: " t" },
                { k: "引擎自重", v: s["重量"], u: " t" },
                { k: "守备力", v: s["守备力"], u: "" },
                { k: "改造阶数", v: (function() {const val = item.改造分支;if (val === "1" || val === "—" || val === "-" || !val || val === "0") {return "初期型";}const num = parseInt(val);if (!isNaN(num)) {return (num - 1) + "阶改造";}return val;})(), u: ""},
                { k: "类型", v: item.类型, u: "" }
            ];
        } else if (cat === "C装置") {
            config = [
                { k: "命中", v: s["命中"], u: "%" },
                { k: "回避", v: s["回避"], u: "%" },
                { k: "守备", v: s["守备力"], u: "" },
                { k: "重量", v: s["重量"], u: " t" }
            ];
        } else {
            config = [
                { k: "攻击力", v: s["攻击力"], u: "" },
                { k: "守备力", v: s["守备力"], u: "" },
                { k: "重量", v: s["重量"], u: " t" },
                { k: "弹仓", v: s["弹仓"], u: "" },
                { k: "范围", v: item.范围, u: "" },
                { k: "属性", v: item.属性, u: "" }
            ];
        }

        config.forEach(stat => {
            let displayVal = "-";
            let isRange = false;

            // 增加对“改造阶数”的特殊处理逻辑
            if (stat.k === "改造阶数") {
                if (stat.v && stat.v !== "0" && stat.v !== "-") {
                    displayVal = `${stat.v}`;
                } else {
                    displayVal = "初期型";
                }
            }

            if (stat.k === "属性" || stat.k === "类型" || stat.k === "范围") {
                displayVal = stat.v || "-";
            } else if (Array.isArray(stat.v)) {
                const min = stat.v[0];
                const max = stat.v[1];
                if (min === max) {
                    displayVal = `${min}`;
                } else {
                    isRange = true;
                    displayVal = `<span class="stat-range"><span class="stat-range-base">${min}<span class="stat-range-arrow">▶</span></span><span class="stat-range-max">${max}${stat.u}</span></span>`;
                }
            }

            // 图标渲染逻辑
            let displayContent = isRange ? displayVal : `${displayVal}${stat.u}`;
            if (stat.k === "属性" && displayVal !== "-" && displayVal !== "无") {
                for (let key in this.attrMap) {
                    if (displayVal.includes(key)) {
                        displayContent = `<div style="display:flex; align-items:center;"><img src="${this.attrMap[key]}" style="height:16px; margin-right:4px;">${displayVal}</div>`;
                        break;
                    }
                }
            }

            html += `<div class="stat-card"><span class="stat-label">${stat.k}</span><span class="stat-value">${displayContent}</span></div>`;
        });
        html += '</div>';

        // --- 第三行：改造分支路线 (进化轴) ---
        html += this.renderEvolutionLine(item);

        // --- 第四行：载重分析 (仅引擎) ---
        if (cat === "引擎" && s["载重"]) {
            const maxLoad = parseFloat(s["载重"][1]);  // 引擎最大载重
            const baseWeight = parseFloat(s["重量"][0]); // 初期自重
            const upgradeWeight = parseFloat(s["重量"][1]); // 强化后自重

            // --- 定义差值：强化增加的重量 ---
            const weightDiff = parseFloat((upgradeWeight - baseWeight).toFixed(2));
            const actualDiff = Math.max(0, weightDiff);         // 确保差值不为负数（防止数据录入错误）

            // 计算净载重区间：初期载重(max - base) ~ 强化后载重(max - up)
            const netBase = (maxLoad - baseWeight).toFixed(2);// 初期载重(max - base)
            const netFinal = (maxLoad - upgradeWeight).toFixed(2);// 强化后载重(max - up)

            const baseRate = ((baseWeight / maxLoad) * 100).toFixed(2); // 基础自重占比
            const baseupRate = ((upgradeWeight / maxLoad) * 100).toFixed(2); // 强化自重占比
            const upgradeRate = (((upgradeWeight - baseWeight) / maxLoad) * 100).toFixed(2); // 增量自重占比

            const effectiveRate = (100 - (upgradeWeight / maxLoad) * 100).toFixed(1); // 最终可用率
            const BaseEffective = (((maxLoad - baseWeight)/ maxLoad) * 100).toFixed(2); // 初期可用率
            const finalEffective = (((maxLoad - upgradeWeight)/ maxLoad) * 100).toFixed(2); // 强化后可用率

            html += `
                <div class="group-title">【载重性能分析】</div>
                <div class="load-analysis-container" style="background: rgba(0,0,0,0.3);margin-top: 15px; padding: 15px; border: 1px solid #333; border-radius: 4px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                        <div style="display: flex; gap: 10px; font-size: 11px;">
                            <span style="color:#ff4444;">■ 引擎自重 ${baseWeight}t</span>
                            <span style="color:#ff69b4;">■ 强化增量 (+${actualDiff}t)</span>
                            <span style="color:#50ff7d;">■ 净载重 ${netBase}t ~ ${netFinal}t</span>
                            <span style="color:#ff4444; border-left: 2px solid #ff4444"></span> <span style="color:#ff4444;">自重占比: ${baseRate}% ~ ${baseupRate}%</span>
                            <span style="color:#50ff7d; border-left: 2px solid #ff4444"></span> <span style="color:#50ff7d;">实际可用率: ${BaseEffective}% ~ ${finalEffective}%</span>
                        </div>
                        <div style="font-size: 12px; color: #888;">
                            <span>总载重 <b style="color:#50ff7d; font-size: 20px;">${maxLoad}t</b></span>
                        </div>
                    </div>
                    
                    <div style="height: 14px; background: #111; border-radius: 7px; overflow: hidden; display: flex; border: 1px solid #444; box-shadow: inset 0 0 5px #000;">
                        <div style="width: ${baseRate}%; background: #ff4444; transition: width 0.3s;"></div>
                        <div style="width: ${upgradeRate}%; background: #ff69b4; transition: width 0.3s; opacity: 0.8;"></div>
                        <div style="flex: 1; background: linear-gradient(90deg, #2e7d32, #50ff7d); transition: width 0.3s;"></div>
                    </div>
                        
                        <div style="margin-top: 6px; font-size: 11px; color: #888; display: flex; justify-content: space-between;">
                            <span>0%</span>
                            <span>100%</span>
                        </div>
                    
                    
                </div>`;
        }

        // --- 第五行：流通与获取 ---
        // --- 处理获取方式标签化 ---
        let acquisitionHtml = "";
        const isFixed = item.部位 && item.部位.includes("固定");

        const price = item.价格 > 0 ? item.价格.toLocaleString() + " G" : "非卖品";
        const upgradeCost = (item.改造费 && item.改造费 > 0) ? item.改造费.toLocaleString() + " G" : "无法改造";

        html += '<div class="group-title">【流通与获取】</div>';
        html += '<div class="stats-grid trade-info-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">';

        if (isFixed) {
            // ==========================================
            // 逻辑 A：固定装备专用逻辑 (隐藏价格/改造费)
            // ==========================================
            // 先摘出 [[地图引用]]，避免其中的 "/" 被商店名切分误拆
            const mapRefs = [];
            const strippedSource = String(item.获取方式 || "未知").replace(/\[\[([^\[\]]+?)\]\]/g, (m0, inner) => {
                const t = inner.trim();
                if (t) mapRefs.push(t);
                return " ";
            });
            const sources = strippedSource.split(/[/、]/).map(s => s.trim()).filter(s => s !== "");
            if (sources.length === 0 && mapRefs.length === 0) sources.push("未知");

            html += `
                <div class="stat-card" style="grid-column: span 3; border: 1px dashed #50ff7d; background: rgba(80,255,125,0.05); padding: 10px;">
                    <span class="stat-label" style="color: #50ff7d; margin-bottom: 8px;">[ 固定部位装备 - 关联底盘 ]</span>
                    <div style="display:flex; flex-wrap:; gap:1px; align-items:center;">
                        ${sources.map(src => {
                            const s = String(src).trim();
                            const attr = s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
                            const text = s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
                            return `
                            <div class="drop-item-link" onclick="window.globalSearchAndJump('${attr}')">
                                <span class="drop-tag"></span>
                                <div class="drop-name-wrapper">
                                    <span class="drop-name">${text}</span>
                                </div>
                            </div>
                        `;}).join('')}
                        ${mapRefs.map(inner => {
                            const sep = inner.indexOf("/");
                            const refMapId = sep > 0 ? inner.slice(0, sep).trim() : "";
                            const refName = (sep > 0 ? inner.slice(sep + 1) : inner).trim();
                            const attr = refName.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
                            const click = refMapId
                                ? `MapBridge.jumpToMarker('${refMapId.replace(/'/g, "\\'")}','${attr}','preset')`
                                : `globalMapJump('${attr}')`;
                            const text = refName.replace(/&/g, "&amp;").replace(/</g, "&lt;");
                            return `
                            <div class="drop-item-link" onclick="${click}">
                                <span class="drop-tag"></span>
                                <div class="drop-name-wrapper">
                                    <span class="drop-name">📍${text}</span>
                                </div>
                            </div>
                        `;}).join('')}
                    </div>
                    <div style="margin-top: 8px; font-size: 12px; color: #888;">
                        * 此装备为特定底盘固有武器，无法通过商店购买或单独改造。
                    </div>
                </div>`;

        } else {
            // ==========================================
            // 逻辑 B：非固定装备逻辑 (正常显示价格/获取方式)
            // ==========================================
            const price = item.价格 > 0 ? item.价格.toLocaleString() + " G" : "非卖品";
            const upgradeCost = (item.改造费 && item.改造费 > 0) ? item.改造费.toLocaleString() + " G" : "无法改造";

            html += `<div class="stat-card"><span class="stat-label">价格</span><span class="stat-value" style="white-space: nowrap;">${price}</span></div>`;
            html += `<div class="stat-card"><span class="stat-label">改造费用</span><span class="stat-value" style="white-space: nowrap; color:#50ff7d;">${upgradeCost}</span></div>`;

            // 获取途径独占下一行
            html += `
                <div class="stat-card" style="grid-column: 1 / -1;">
                    <span class="stat-label">获取途径</span>
                    <div class="stat-value" style="white-space: normal; line-height:1.4;">${renderSourceRichText(item.获取方式 || "")}</div>
                </div>`;
        }

        // 特有字段展示
        html += '<div class="group-title">【其他】</div>';
        html += '<div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px;">';
        if (item.特性) html += `<div class="stat-card" style="grid-column: span 2;"><span class="stat-label">特性</span><span class="stat-value" style="color:#50ff7d;">${renderSourceRichText(item.特性)}</span></div>`;
        if (item.特殊炮弹) html += `<div class="stat-card"><span class="stat-label">特殊炮弹</span><span class="stat-value">${item.特殊炮弹}</span></div>`;
        if (item.可否迎击) html += `<div class="stat-card"><span class="stat-label">可否迎击</span><span class="stat-value">${item.可否迎击}</span></div>`;

        html += '</div>'; // 闭合 stats-grid
        html += renderItemMapLocationsSection("战车装备", item.名称);

        const customLog = this.buildVehicleLog(item);
        setTimeout(() => {
            if (window.triggerGlobalTypewriter) {
                window.triggerGlobalTypewriter(customLog);
            }
        }, 50);

        return `<div class="tank-render-wrapper" style="grid-column: 1 / -1; padding: 10px;">${html}</div>`;},

    // 渲染星级按钮
    renderStarSelector: function(allVersions, currentItem) {

        // 隐藏没有星级的物品
        `if (allVersions.length <= 1) return '';`

        const labels = ["通常", "★", "★★", "★★★", "★★★★"];

        return `
            <div class="star-selector" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(10, 1fr); gap: 10px; margin-bottom:15px; overflow-x:auto;">
                ${allVersions.map(v => {
                    const isActive = v.星级 === currentItem.星级;
                    return `
                        <button class="star-btn ${isActive ? 'active' : ''}" 
                                onclick="window.switchVehicleObj('${v.名称}', ${v.星级})" 
                                style="flex:1; min-width:60px; padding:10px; background:${isActive ? 'rgba(80, 255, 125, 0.2)' : '#000'}; 
                                       border:1px solid; ${isActive ? '#50ff7d' : '#333'}; 
                                       color:${isActive ? '#50ff7d' : '#666'}; cursor:pointer; font-weight:bold; border-radius:4px;">
                            ${labels[v.星级] || v.星级 + '星'}
                        </button>`;
                }).join('')}
            </div>`;
    },

    // 渲染改造分支 (基于“改造支系”字段)
    renderEvolutionLine: function(item) {
        if (!item.改造分支 || item.改造分支 === "-") return '';

        // 获取同一支系、且星级相同的进化节点
        const sameSeriesNodes = (window.allData || []).filter(it =>
            it.改造支系 === item.改造支系 && it.星级 === (item.星级 || 0)
    );

        // 按改造分支排序 (1阶, 2阶...)
        sameSeriesNodes.sort((a, b) => (parseInt(a.改造分支) || 0) - (parseInt(b.改造分支) || 0));

        if (sameSeriesNodes.length <= 1) return '';

        let html = '<div class="group-title">【改造分支路线】</div>';
        html += '<div class="evolution-track" style="">';

        sameSeriesNodes.forEach((node, i) => {
        const isCurrent = node.名称 === item.名称;
        // --- 关键修改：动态添加 active 类名 ---
        const activeClass = isCurrent ? 'active' : '';
        // --- 核心修复：定义 s 变量，防止报错 ---
        const s = node.stats || {};

        // --- 调取悬浮窗显示的数据 ---
        let perfInfo = "";
        const cat = node.分类 || "";
        if (cat === "引擎") {
            perfInfo = `载重: ${s["载重"]?.[1] || '-'} t`;
        } else if (cat === "C装置") {
            perfInfo = `命中: ${s["命中"]?.[1] || '-'}%`;
        } else {
            perfInfo = `攻击: ${s["攻击力"]?.[1] || '-'}`;
        }

        const stageText = (function() {
            const val = node.改造分支;
            if (val === "1" || !val || val === "0") return "初期型";
            return (parseInt(val) - 1) + "阶改造";
        })();
        const costText = node.改造费 > 0 ? `${node.改造费.toLocaleString()} G` : "无法改造";

        // 修改点击事件 onclick="window.globalSearchAndJump('${node.名称}')" 全局搜索跳转
        html += `
        <div class="evo-node ${activeClass}" onclick="window.switchVehicleObj('${node.名称}', ${node.星级 || 0})" 
             style="display:flex; flex-direction:column; align-items:center; min-width:120px; cursor:pointer; position:relative; z-index:2;">
            
            <div class="evo-popover">
                <div style="color:#50ff7d; font-weight:bold; border-bottom:1px solid #333; margin-bottom:5px; padding-bottom:3px; font-size:12px;">${node.名称}</div>
                <div class="pop-row" style="display:flex; justify-content:space-between; width:100%; font-size:11px;">
                    <span style="color:#888;">性能:</span><b style="color:#fff;">${perfInfo}</b>
                </div>
                <div class="pop-row" style="display:flex; justify-content:space-between; width:100%; font-size:11px;">
                    <span style="color:#888;">阶级:</span><b style="color:#ffae00;">${stageText}</b>
                </div>
                <div class="pop-row" style="display:flex; justify-content:space-between; width:100%; font-size:11px;">
                    <span style="color:#888;">费用:</span><b style="color:#50ff7d;">${costText}</b>
                </div>
            </div>

            <div class="node-dot ${isCurrent ? 'node-active' : ''}" 
                 style="width:14px; height:14px; border-radius:50%; border: 2px solid ${isCurrent ? '#fff' : '#333'};
                        background: ${isCurrent ? '#50ff7d' : '#111'};
                        box-shadow: ${isCurrent ? '0 0 15px #50ff7d, 0 0 30px #50ff7d, inset 0 0 10px #fff' : '0 0 5px rgba(80,255,125,0.2)'};
                        position: relative; transition: all 0.3s;">
            </div>
            
            <div class="node-name-text" style="font-size:12px; margin-top:10px; white-space:nowrap;
                        font-weight: ${isCurrent ? 'bold' : 'normal'};
                        color: ${isCurrent ? '#fff' : '#888'};
                        text-shadow: ${isCurrent ? '0 0 8px #50ff7d' : 'none'};
                        transition: all 0.3s;">
                ${node.名称}
            </div>
            
            ${i < sameSeriesNodes.length - 1 ? `
                <div style="position:absolute; width:100%; height:2px; 
                            background: ${isCurrent ? 'linear-gradient(90deg, #50ff7d, #333)' : '#333'}; 
                            left:50%; top:8px; z-index:-1; opacity: 0.4;">
                </div>` : ''}
        </div>`;
    });

    html += '</div>';
    return `<div class="tank-render-wrapper" style="grid-column: 1 / -1; padding: 10px;">${html}</div>`;
}
};

/**
 * 全局辅助函数：根据名称和星级精准定位对象并刷新详情
 */
window.switchVehicleObj = (name, star) => {
    // 1. 在全库数据中找到目标对象
    const target = (window.allData || []).find(it => it.名称 === name && it.星级 === star);

    if (target && window.showDetail) {
        // 2. 更新详情面板
        window.showDetail(target);

        // --- 新增代码：动态更新大标题星级 ---
        const titleEl = document.querySelector('.item-name'); // 对应 test.html 中的标题类名
        if (titleEl) {
            const starStr = star > 0 ? " " + "★".repeat(star) : "";
            titleEl.innerHTML = `${name}<span style="font-size: 32px; color: #fff; text-shadow: 0 0 12px var(--mm-green); margin: 0;">${starStr}</span>`;
        }
        // -----------------------------------

        // 3. 【关键修复】同步更新左侧列表状态
        // 使用 setTimeout 确保在 DOM 更新后执行滚动和高亮
        setTimeout(() => {
            if (typeof highlightAndScrollTo === "function") {
                highlightAndScrollTo(name);
            }
        }, 100);
    }
};

// --- 注册渲染器 ---

// 1. 定义所有可能出现在 config.json 中的标签页名称
// 只要标签页叫这些名字，都会调用这个渲染器
const tankTabNames = ["战车装备", "战车武器", "战车引擎", "固定装备"];

// 2. 同时定义你数据 JSON 中 item.分类 字段可能的值
const subCategories = ["主炮", "副炮", "S-E", "C装置", "引擎"];

// 统一注册
[...tankTabNames, ...subCategories].forEach(name => {
    if (typeof registerPageRenderer === "function") {
        registerPageRenderer(name, vehicleRenderer);
    }
});