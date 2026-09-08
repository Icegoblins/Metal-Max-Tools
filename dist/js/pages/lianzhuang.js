// 链装系统渲染器
// 数据结构：
// - 链装.json：一行一个星级版本（星级 "-"=通常/1/2/3/4），只有一条"主属性"；
//   词缀按分类整池并入（嵌能=人类 / 相阵=战车），最小值=基础值，最大值=强化满级值
// - 链装套装.json：分类（嵌能/相阵）各自的套装库，详情页按分类浏览切换
// - 链装强化.json：按名称并入每条记录的 强化数据（强化等级 → 词条1~3）

registerPageRenderer("链装", {
    skin: "skin-链装",

    renderStats: function(item) {
        const starNumOf = (v) => {
            const s = String(v ?? "-");
            if (["-", "0", "通常", ""].includes(s)) return 0;
            const n = parseInt(s);
            return isNaN(n) ? 0 : n;
        };
        // 切换物品时重置选择状态；星级/强化/套装局部刷新时保留
        if (window.__chainLastItem !== item) {
            window.__chainLastItem = item;
            window.currentChainForceIdx = 0;
            window.currentChainSetIdx = 0;
        }

        // 套装库懒加载：加载完成后局部刷新当前详情
        if (window.chainSetData === undefined) {
            window.chainSetData = null;
            fetch('data/链装套装.json?t=' + Date.now())
                .then(r => r.json())
                .then(j => {
                    window.chainSetData = Array.isArray(j) ? j : (j.data || []);
                    this.refreshIfActive();
                })
                .catch(() => { window.chainSetData = []; });
        }

        // 掉落反查：怪物/赏金首掉落写的是部位名（如「头部链装备」），按部位挂到每件链装
        if (window.chainDropIndex === undefined) {
            window.chainDropIndex = null;
            this.loadDropIndex().then(() => this.refreshIfActive());
        }

        const starNum = (v) => {
            const s = String(v ?? "-");
            if (["-", "0", "通常", ""].includes(s)) return 0;
            const n = parseInt(s);
            return isNaN(n) ? 0 : n;
        };

        let html = '';

        // --- A. 星级选择器（同名称所有星级版本，复用战车装备的 switchVehicleObj） ---
        const versions = (window.allData || window.currentRawData || [])
            .filter(it => it.名称 === item.名称 && it.部位 === item.部位);
        versions.sort((a, b) => starNum(a.星级) - starNum(b.星级));
        if (versions.length > 1) {
            const labels = ["通常", "★", "★★", "★★★", "★★★★"];
            html += '<div class="star-selector" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(10, 1fr); gap: 10px; margin-bottom:15px;">';
            versions.forEach(v => {
                const active = String(v.星级) === String(item.星级);
                // 星等用数字传参：通常行的星级是字符串"-"，直接传会截断 onclick 属性
                html += `<button class="star-btn ${active ? 'active' : ''}"
                            onclick="window.switchChainObj('${String(item.名称).replace(/'/g, "\\'")}', '${String(item.部位).replace(/'/g, "\\'")}', ${starNumOf(v.星级)})"
                            style="flex:1; min-width:60px; padding:10px; background:${active ? 'rgba(80,255,125,0.2)' : '#000'};
                                   border:1px solid ${active ? '#50ff7d' : '#333'};
                                   color:${active ? '#50ff7d' : '#666'}; cursor:pointer; font-weight:bold; border-radius:4px;">
                            ${labels[starNum(v.星级)] || v.星级 + '星'}
                         </button>`;
            });
            html += '</div>';
        }

        // --- B. 链装信息与主属性（链装只有这一条自身属性） ---
        html += '<div class="group-title">【链装信息】</div>';
        html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">';
        const sNum = starNum(item.星级);
        const infoCards = [
            { k: "部位", v: item.部位 },
            { k: "分类", v: item.分类 },
            { k: "星级", v: sNum > 0 ? `<span style="color:#ffd700; letter-spacing:2px;">${"★".repeat(sNum)}</span>` : "通常" },
            { k: "价格", v: (item.价格 && parseFloat(item.价格)) ? parseFloat(item.价格).toLocaleString() + " G" : "非卖品" },
        ];
        infoCards.forEach(c => {
            if (c.v === undefined || c.v === "-") return;
            html += `<div class="stat-card"><span class="stat-label">${c.k}</span><span class="stat-value" style="color:#00ff66;">${c.v}</span></div>`;
        });
        html += `<div style="grid-column: 1 / -1; display: flex;">
                    <div class="stat-card" style="border:1px dashed #50ff7d; background: rgba(80,255,125,0.05); width: fit-content; min-width: 220px;">
                        <span class="stat-label">主属性</span>
                        <span class="stat-value" style="color:#50ff7d;">${item.主属性 || "-"}</span>
                    </div>
                 </div>`;
        html += '</div>';

        // --- C. 词缀池（按分类整池：嵌能=人类 / 相阵=战车，词缀为随机获取） ---
        const affixes = item.词缀列表 || [];
        if (affixes.length > 0) {
            const fmtVal = (v) => {
                const s = String(v ?? "").trim();
                if (!s || s === "-") return "";
                if (!/^-?\d+(\.\d+)?$/.test(s)) return s;   // "1.0t" 等带单位值原样保留
                const n = parseFloat(s);
                if (Number.isInteger(n)) return (n > 0 ? "+" : "") + n;
                return (n > 0 ? "+" : "") + Math.round(n * 100) + "%"; // 比率按百分比
            };
            const rangeText = (a) => {
                const lo = fmtVal(a.最小值), hiRaw = fmtVal(a.最大值);
                // 显示为 "+5%~15%"：起点带符号，满级值不带
                const hi = hiRaw ? hiRaw.replace(/^\+/, "") : "";
                if (lo && hi && lo !== hi) return `${lo}~${hi}`;
                return lo || hi;
            };
            // 自动归类：让 30+ 条词缀有层次可扫读
            const GROUPS = [
                { name: "会心 / 连射 / 命中", test: n => /会心|连射|命中/.test(n) },
                { name: "伤害类",            test: n => n.includes("伤害") },
                { name: "抗性 / 耐性",       test: n => /抗性|耐性/.test(n) },
                { name: "功能类",            test: () => true }
            ];
            const chip = (a) => {
                const v = rangeText(a);
                return `<div style="display:flex; align-items:baseline; gap:7px; padding:4px 10px; background:rgba(80,255,125,0.04); border:1px solid #1e2a1e; border-radius:3px;">
                            <span style="color:#b8d8bc; font-size:12.5px;">${a.名称}</span>
                            ${v ? `<span style="color:#50ff7d; font-size:12.5px;">${v}</span>` : ""}
                        </div>`;
            };
            html += `<div class="group-title">【词缀池 · ${item.分类}】<span style="font-size:12px; color:#888;">随机获取，下列为该类链装可出现的全部词缀</span></div>`;
            html += '<div style="grid-column: 1 / -1;">';
            let rest = affixes.slice();
            GROUPS.map(g => {
                const items = rest.filter(a => g.test(String(a.名称)));
                rest = rest.filter(a => !g.test(String(a.名称))); // 已归类的不再进后面的组
                return { ...g, items };
            })
                .filter(g => g.items.length > 0)
                .forEach(g => {
                    html += `<div style="font-size:12px; color:#5a8a5f; letter-spacing:2px; margin:10px 0 6px;">▸ ${g.name} <span style="color:#3a5a3e;">(${g.items.length})</span></div>`;
                    html += '<div style="display:flex; flex-wrap:wrap; gap:6px;">';
                    g.items.forEach(a => { html += chip(a); });
                    html += '</div>';
                });
            html += '</div>';
        }

        // --- C2. 链装强化（按名称取自「链装强化」表：强化等级 → 词条1~3） ---
        const enhData = (item.强化数据 || []).slice()
            .sort((a, b) => parseInt(String(a.等级).replace('+', '')) - parseInt(String(b.等级).replace('+', '')));
        if (enhData.length > 0) {
            window.currentChainForceIdx = Math.min(window.currentChainForceIdx || 0, enhData.length - 1);
            const cur = enhData[window.currentChainForceIdx];
            const prev = window.currentChainForceIdx > 0 ? enhData[window.currentChainForceIdx - 1] : null;

            html += '<div class="group-title">【链装强化】</div>';
            html += '<div class="star-selector-container" style="grid-column: 1 / -1; display:grid; grid-template-columns: repeat(10, 1fr); gap:10px; margin-bottom:12px;">';
            enhData.forEach((e, idx) => {
                const active = idx === window.currentChainForceIdx ? "active" : "";
                html += `<div class="star-btn ${active}" style="padding:10px; font-size:13px;" onclick="window.switchChainForce(${idx})">强化 ${e.等级}</div>`;
            });
            html += '</div>';

            html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">';
            ["词条1", "词条2", "词条3"].forEach(k => {
                if (cur[k] === undefined || cur[k] === "-" || cur[k] === "") return;
                let diff = "";
                if (prev && !isNaN(parseFloat(cur[k])) && !isNaN(parseFloat(prev[k]))) {
                    diff = formatStatDiff(parseFloat(cur[k]), parseFloat(prev[k]));
                }
                html += `<div class="stat-card">
                            <span class="stat-label">${k}（强化 ${cur.等级}）</span>
                            <span class="stat-value" style="color:#7cfc00;">${cur[k]} ${diff}</span>
                         </div>`;
            });
            html += '</div>';
        }

        // --- E. 套装效果（按分类浏览：嵌能/相阵各自的套装库） ---
        html += this.renderSetSection(item);

        // --- F. 获得途径 ---
        const sourceInfo = item.获得方法 || item.获取途径 || item.出处;
        if (sourceInfo && sourceInfo !== "-") {
            html += '<div class="group-title">【获得途径】</div>';
            html += `<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">${sourceInfo}</div>`;
        }

        html += this.renderDropSection(item);
        return html;
    },

    refreshIfActive: function() {
        const activeTab = document.querySelector('.tab-btn.active')?.innerText;
        if (window.PageRenderers[activeTab] === this && window.lastSelectedItem) {
            document.getElementById('stats-grid').innerHTML =
                this.renderStats(window.lastSelectedItem);
        }
    },

    loadDropIndex: async function() {
        const dropKeys = ["掉落物1", "掉落物2", "掉落物3", "掉落物4", "掉落物5"];
        const index = Object.create(null);
        const push = (key, rec) => {
            if (!key || key === "-") return;
            if (!index[key]) index[key] = [];
            if (index[key].some(x => x.cat === rec.cat && x.name === rec.name)) return;
            index[key].push(rec);
        };
        const ingest = (list, cat, kind) => {
            (list || []).forEach(m => {
                const rec = {
                    name: m.名称,
                    cat,
                    kind,
                    loc: m.出没地点,
                    lv: m.等级
                };
                dropKeys.forEach(k => push(m[k], rec));
            });
        };
        const load = async (cat) => {
            try {
                const r = await fetch(`data/${encodeURIComponent(cat)}.json?t=` + Date.now());
                if (!r.ok) return [];
                const j = await r.json();
                return Array.isArray(j) ? j : (j.data || []);
            } catch (e) { return []; }
        };
        ingest(await load("怪物数据"), "怪物数据", "怪物");
        ingest(await load("赏金首"), "赏金首", "赏金首");
        Object.keys(index).forEach(k => {
            index[k].sort((a, b) => {
                if (a.kind !== b.kind) return a.kind === "赏金首" ? -1 : 1;
                const la = parseFloat(a.lv), lb = parseFloat(b.lv);
                if (!isNaN(la) && !isNaN(lb) && la !== lb) return la - lb;
                return String(a.name).localeCompare(String(b.name), "zh");
            });
        });
        window.chainDropIndex = index;
    },

    renderDropSection: function(item) {
        const index = window.chainDropIndex;
        if (!index) return '';

        const keys = [];
        if (item.部位) keys.push(item.部位);
        if (item.名称 && item.名称 !== item.部位) keys.push(item.名称);

        const seen = new Set();
        const sources = [];
        keys.forEach(k => {
            (index[k] || []).forEach(rec => {
                const id = rec.cat + "\0" + rec.name;
                if (seen.has(id)) return;
                seen.add(id);
                sources.push(rec);
            });
        });

        const part = item.部位 || "该部位";
        let html = `<div class="group-title">【掉落来源】<span style="font-size:12px; color:#888;"> 怪物掉落为部位池，下列会掉「${part}」</span></div>`;
        html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid;min-width: 100px; grid-template-columns: repeat(7, 1fr); gap: 10px;">';

        if (sources.length === 0) {
            html += `<div class="stat-card" style="grid-column: 1/-1; flex-direction: row; border: none;">
                        <span style="color:#666;">暂无怪物掉落记录</span>
                     </div></div>`;
            return html;
        }

        const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const chip = (rec) => {
            const loc = (rec.loc && rec.loc !== "-") ? rec.loc : "";
            const title = loc ? `${rec.kind} · ${rec.name}　出没：${loc}` : `${rec.kind} · ${rec.name}`;
            const tag = rec.kind === "赏金首"
                ? `<span style="color:#ffd700; font-size:11px; margin-right:4px;">赏金</span>`
                : "";
            return `<span class="drop-item" title="${title.replace(/"/g, "&quot;")}"
                          onclick="globalSearchAndJump('${esc(rec.name)}')">${tag}${rec.name}</span>`;
        };

        const bosses = sources.filter(s => s.kind === "赏金首");
        const mobs = sources.filter(s => s.kind !== "赏金首");
        html += `<div class="stat-card" style="grid-column: 1/-1; flex-direction: column; align-items:flex-start; border: none; gap:8px;">`;
        if (bosses.length) {
            html += `<div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                        <span style="color:#5a8a5f; font-size:12px; letter-spacing:1px;">赏金首 (${bosses.length})</span>
                        ${bosses.map(chip).join("")}
                     </div>`;
        }
        if (mobs.length) {
            html += `<div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                        <span style="color:#5a8a5f; font-size:12px; letter-spacing:1px;">怪物 (${mobs.length})</span>
                        ${mobs.map(chip).join("")}
                     </div>`;
        }
        html += `</div></div>`;
        return html;
    },

    // 套装浏览区：按钮列出本分类（嵌能/相阵）所有套装，点击下方切换 2/4 件套奖励
    renderSetSection: function(item) {
        const sets = (window.chainSetData || []).filter(s => s.分类 === item.分类);
        if (sets.length === 0) return '';
        window.currentChainSetIdx = Math.min(window.currentChainSetIdx || 0, sets.length - 1);
        const cur = sets[window.currentChainSetIdx];

        let html = '<div class="group-title">【套装效果】</div>';
        html += '<div class="star-selector-container" style="grid-column: 1 / -1; display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px;">';
        sets.forEach((s, idx) => {
            const active = idx === window.currentChainSetIdx ? "active" : "";
            // 该件装备名称带此前缀（如 泰坦速能核芯 × 泰坦）时金色标记
            const owned = String(item.名称).startsWith(String(s.套装名));
            html += `<div class="star-btn ${active}" style="flex:0 1 auto; white-space:nowrap; padding:10px; font-size:13px; ${owned ? 'border-color:#ffd700; color:#ffd700;' : ''}"
                        onclick="window.switchChainSet(${idx})">${s.套装名}</div>`;
        });
        html += '</div>';

        const effRow = (label, text) => {
            if (!text || text === "-") return "";
            return `<div class="stat-card" style="grid-column: 1/-1; flex-direction: row; align-items: baseline; border:none;">
                        <span class="stat-label" style="color:#ffd700; white-space:nowrap; margin-right:10px; font-size:16px;">${label}</span>
                        <span class="stat-value" style="color:#ffd700; text-align:left; font-size:16px;">${text}</span>
                    </div>`;
        };
        html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">';
        html += effRow("2件套：", cur["2件套效果"]);
        html += effRow("4件套：", cur["4件套效果"]);
        html += '</div>';
        return html;
    },

    onUpdateVisual: function(item) {
        let log = `>> 主属性：${item.主属性 || "???"}\n`;
        if (item.描述 && item.描述 !== "-") log += `>> ${item.描述}`;
        if (typeof startTypewriter === "function") startTypewriter(log);
    }
});

// 链装星级切换：按名称+部位+星等匹配（通常="-"、1~4 为数字星等）
window.switchChainObj = (name, part, star) => {
    const num = (v) => {
        const s = String(v ?? "-");
        if (["-", "0", "通常", ""].includes(s)) return 0;
        const n = parseInt(s);
        return isNaN(n) ? 0 : n;
    };
    const target = (window.allData || []).find(it =>
        it.名称 === name && (it.部位 || "") === (part || "") && num(it.星级) === star);
    if (target && window.showDetail) {
        window.showDetail(target);
        const titleEl = document.querySelector('.item-name');
        if (titleEl) {
            const starStr = star > 0 ? " " + "★".repeat(star) : "";
            titleEl.innerHTML = `${name}<span style="font-size: 32px; color: #fff; text-shadow: 0 0 12px var(--mm-green); margin: 0;">${starStr}</span>`;
        }
        setTimeout(() => {
            if (typeof highlightAndScrollTo === "function") highlightAndScrollTo(name);
        }, 100);
    }
};

// 链装强化等级切换：局部刷新属性网格
window.switchChainForce = function(idx) {
    window.currentChainForceIdx = idx;
    const activeTab = document.querySelector('.tab-btn.active').innerText;
    const renderer = window.PageRenderers[activeTab];
    if (window.lastSelectedItem && renderer) {
        document.getElementById('stats-grid').innerHTML = renderer.renderStats(window.lastSelectedItem);
    }
};

// 套装浏览切换：局部刷新属性网格
window.switchChainSet = function(idx) {
    window.currentChainSetIdx = idx;
    const activeTab = document.querySelector('.tab-btn.active').innerText;
    const renderer = window.PageRenderers[activeTab];
    if (window.lastSelectedItem && renderer) {
        document.getElementById('stats-grid').innerHTML = renderer.renderStats(window.lastSelectedItem);
    }
};
