// 链装系统渲染器
// 数据结构：
// - 链装.json：一行一个星级版本（星级 "-"=通常/1/2/3/4/5），只有一条"主属性"；
//   词缀按「部位所属的池」整池并入（链装词缀库的 链装池 列），每条自带 档位=[{等级, 数值, 文本}]，
//   文本在数据转换期算好（含 % / t 单位），前端只按滑块档位取用，不再自行换算数值
// - 链装套装.json：分类（嵌能/相阵）各自的套装库，详情页按分类浏览切换

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
            const labels = ["通常", "★", "★★", "★★★", "★★★★", "★★★★★"];
            const starBtnMinW = [72, 48, 56, 64, 76, 100];
            html += '<div class="star-selector" style="grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 10px; margin-bottom:15px;">';
            versions.forEach(v => {
                const active = String(v.星级) === String(item.星级);
                const sn = starNum(v.星级);
                const minW = starBtnMinW[sn] || 60;
                // 星等用数字传参：通常行的星级是字符串"-"，直接传会截断 onclick 属性
                html += `<button class="star-btn ${active ? 'active' : ''}"
                            onclick="window.switchChainObj('${String(item.名称).replace(/'/g, "\\'")}', '${String(item.部位).replace(/'/g, "\\'")}', ${starNumOf(v.星级)})"
                            style="flex:0 1 auto; min-width:${minW}px; padding:10px 14px; white-space:nowrap; background:${active ? 'rgba(80,255,125,0.2)' : '#000'};
                                   border:1px solid ${active ? '#50ff7d' : '#333'};
                                   color:${active ? '#50ff7d' : '#666'}; cursor:pointer; font-weight:bold; border-radius:4px;">
                            ${labels[sn] || v.星级 + '星'}
                         </button>`;
            });
            html += '</div>';
        }

        // --- B. 链装信息与主属性（链装只有这一条自身属性） ---
        html += '<div class="group-title">【链装信息】</div>';
        html += '<div class="stats-grid detail-field-grid">';
        const sNum = starNum(item.星级);
        const infoCards = [
            { k: "部位", v: item.部位 },
            { k: "分类", v: item.分类 },
            { k: "星级", v: sNum > 0 ? `<span style="color:var(--mm-green); letter-spacing:2px;">${"★".repeat(sNum)}</span>` : "通常" },
            { k: "价格", v: formatPrice(getItemPrice(item)) },
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

        // --- C. 词缀池（按部位所属池整池挂载，档位数值随下方滑块切换） ---
        const affixes = item.词缀列表 || [];
        if (affixes.length > 0) {
            const tierCount = Math.max(...affixes.map(a => (a.档位 || []).length), 0);
            window.__chainAffixes = affixes;
            if (tierCount > 0) {
                window.currentChainForceIdx = Math.min(window.currentChainForceIdx || 0, tierCount - 1);
            }
            const cur = window.currentChainForceIdx || 0;
            const tierText = (a) => {
                const t = (a.档位 || [])[cur];
                return t ? t.文本 : "";
            };
            // 自动归类：让 30+ 条词缀有层次可扫读
            const GROUPS = [
                { name: "会心 / 连射 / 命中", test: n => /会心|连射|命中/.test(n) },
                { name: "伤害类",            test: n => n.includes("伤害") },
                { name: "抗性 / 耐性",       test: n => /抗性|耐性/.test(n) },
                { name: "功能类",            test: () => true }
            ];
            const chip = (a, i) => {
                const v = tierText(a);
                return `<div style="display:flex; align-items:baseline; gap:7px; padding:4px 10px; background:rgba(80,255,125,0.04); border:1px solid #1e2a1e; border-radius:3px;">
                            <span style="color:#b8d8bc; font-size:12.5px;">${a.名称}</span>
                            ${v ? `<span class="chain-affix-val" data-i="${i}" style="color:#50ff7d; font-size:12.5px;">${v}</span>` : ""}
                        </div>`;
            };
            html += `<div class="group-title">【词缀池 · ${item.分类}】<span style="font-size:12px; color:#888;">随机获取，下列为「${item.部位}」可出现的全部词缀（${affixes.length} 条）</span></div>`;
            html += '<div style="grid-column: 1 / -1;">';
            const tagged = affixes.map((a, i) => ({ a, i }));
            let rest = tagged.slice();
            GROUPS.map(g => {
                const hits = rest.filter(x => g.test(String(x.a.名称)));
                rest = rest.filter(x => !g.test(x.a.名称)); // 已归类的不再进后面的组
                return { ...g, hits };
            })
                .filter(g => g.hits.length > 0)
                .forEach(g => {
                    html += `<div style="font-size:12px; color:#5a8a5f; letter-spacing:2px; margin:10px 0 6px;">▸ ${g.name} <span style="color:#3a5a3e;">(${g.hits.length})</span></div>`;
                    html += '<div style="display:flex; flex-wrap:wrap; gap:6px;">';
                    g.hits.forEach(x => { html += chip(x.a, x.i); });
                    html += '</div>';
                });
            html += this.renderForceSlider(tierCount, cur);
            html += '</div>';
        }

        // --- E. 套装效果（按分类浏览：嵌能/相阵各自的套装库） ---
        html += this.renderSetSection(item);

        // --- F. 获得途径 ---
        const sourceInfo = item.获得方法 || item.获取途径 || item.出处;
        if (sourceInfo && sourceInfo !== "-") {
            html += renderSourceSection(sourceInfo);
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
        if (typeof ensureMonsterSpawnIndex === "function") {
            await ensureMonsterSpawnIndex();
        }
        const spawnIdx = typeof getMonsterSpawnIndex === "function" ? getMonsterSpawnIndex() : null;
        const ingest = (list, cat, kind) => {
            (list || []).forEach(m => {
                if (typeof isShinyRow === "function" && isShinyRow(m)) return;
                const locText = typeof formatSpawnLocationsText === "function"
                    ? formatSpawnLocationsText(m.名称, spawnIdx)
                    : (m.出没地点 || "-");
                const rec = {
                    name: m.名称,
                    cat,
                    kind,
                    loc: locText === "未知" ? "-" : locText,
                    lv: m.等级
                };
                dropKeys.forEach(k => {
                    expandDropTokens(m[k]).forEach(token => push(token, rec));
                });
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
        html += '<div class="stats-grid detail-field-grid" style="min-width: 100px;">';

        if (sources.length === 0) {
            html += `<div class="stat-card" style="grid-column: 1/-1; flex-direction: row; border: none;">
                        <span style="color:#666;">暂无怪物掉落记录</span>
                     </div></div>`;
            return html;
        }

        const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
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

    // 词缀池的强化档位滑块：一段一个圆点（基础 / +1 … +9），点或拖都切档
    renderForceSlider: function(tierCount, cur) {
        if (tierCount < 2) return '';
        const label = (i) => i === 0 ? "基础" : `+${i}`;
        const pct = cur / (tierCount - 1);
        let dots = '';
        for (let i = 0; i < tierCount; i++) {
            const on = i === cur;
            dots += `<div data-idx="${i}" style="position:relative; z-index:1; display:flex; flex-direction:column; align-items:center; gap:6px; cursor:pointer;">
                        <span class="cfs-dot" data-idx="${i}" style="width:13px; height:13px; border-radius:50%; border:1px solid #50ff7d;
                              background:${on ? '#50ff7d' : '#000'}; box-shadow:${on ? '0 0 8px rgba(80,255,125,0.7)' : 'none'};"></span>
                        <span class="cfs-lab" data-idx="${i}" style="font-size:11px; color:${on ? '#50ff7d' : '#4a5a4c'};">${label(i)}</span>
                     </div>`;
        }
        return `<div style="margin:16px 4px 2px;">
                    <div style="font-size:12px; color:#5a8a5f; letter-spacing:2px; margin-bottom:10px;">▸ 词缀强化 <span style="color:#3a5a3e;">拖动或点击圆点查看各档数值</span></div>
                    <div class="cfs-slider"
                         onpointerdown="window.chainForceDrag(event, this, true)"
                         onpointermove="window.chainForceDrag(event, this, false)"
                         onpointerup="window.chainForceDragEnd(event)"
                         style="position:relative; display:flex; justify-content:space-between; align-items:flex-start; touch-action:none; user-select:none; padding:0 6px;">
                        <div style="position:absolute; left:6px; right:6px; top:6px; height:2px; background:#1e2a1e;"></div>
                        <div class="cfs-fill" style="position:absolute; left:6px; top:6px; height:2px; background:#50ff7d; width:calc((100% - 12px) * ${pct});"></div>
                        ${dots}
                    </div>
                </div>`;
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
                        <span class="stat-value stat-value-wrap" style="color:#ffd700; text-align:left; flex:1; min-width:0; font-size:16px;">${text}</span>
                    </div>`;
        };
        html += '<div class="stats-grid detail-field-grid">';
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

// 词缀池强化档位：只改圆点和词缀数值文本，不整块重刷（重刷会销毁元素、打断拖动）
window.chainForceSetLevel = function(idx) {
    if (idx === window.currentChainForceIdx) return;
    const affixes = window.__chainAffixes || [];
    window.currentChainForceIdx = idx;
    const grid = document.getElementById('stats-grid');
    if (!grid) return;
    grid.querySelectorAll('.cfs-dot').forEach(d => {
        const on = Number(d.dataset.idx) === idx;
        d.style.background = on ? '#50ff7d' : '#000';
        d.style.boxShadow = on ? '0 0 8px rgba(80,255,125,0.7)' : 'none';
    });
    grid.querySelectorAll('.cfs-lab').forEach(l => {
        l.style.color = Number(l.dataset.idx) === idx ? '#50ff7d' : '#4a5a4c';
    });
    const tiers = affixes.reduce((m, a) => Math.max(m, (a.档位 || []).length), 0);
    const fill = grid.querySelector('.cfs-fill');
    if (fill && tiers > 1) fill.style.width = `calc((100% - 12px) * ${idx / (tiers - 1)})`;
    grid.querySelectorAll('.chain-affix-val').forEach(s => {
        const t = ((affixes[Number(s.dataset.i)] || {}).档位 || [])[idx];
        s.textContent = t ? t.文本 : "";
    });
};

window.chainForceDrag = function(ev, el, isDown) {
    if (isDown) {
        el.__dragging = true;
        try { el.setPointerCapture(ev.pointerId); } catch (e) { /* 合成事件无 pointerId */ }
    } else if (!el.__dragging) {
        return;
    }
    ev.preventDefault();
    let best = 0, bestDist = Infinity;
    el.querySelectorAll('.cfs-dot').forEach(dot => {
        const r = dot.getBoundingClientRect();
        const dist = Math.abs(ev.clientX - (r.left + r.width / 2));
        if (dist < bestDist) { bestDist = dist; best = Number(dot.dataset.idx); }
    });
    window.chainForceSetLevel(best);
};

window.chainForceDragEnd = function(ev) {
    ev.currentTarget.__dragging = false;
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
