// 冒险指南渲染器：步骤式攻略（图标 + 文字 + 可跳转地点标签 + 步骤配图）
// 步骤语法（Excel「攻略步骤」列，Alt+Enter 换行，一行一步）：
//   [战斗]/[对话]/[收集]/[BOSS]/[交付]  行首图标标签（可省略，省略时显示序号）
//   [[地名]]                            渲染为可点击标签，跳 BS控制器地图定位
//   |图片文件名.png                      行尾步骤配图（图片放 img/冒险指南/ 下）
registerPageRenderer("冒险指南", {
    skin: "skin-冒险指南",

    STEP_ICONS: {
        "战斗": "⚔",
        "对话": "💬",
        "收集": "📦",
        "BOSS": "☠",
        "交付": "🎁",
        "调查": "🔍",
        "移动": "🚙"
    },

    escHtml: function (s) {
        return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    },
    escAttr: function (s) {
        return String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
    },
    escapeRegExp: function (s) {
        return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    },

    /** 前置任务跳转标签（金色，区别于绿色的地图地点标签） */
    taskJumpTag: function (name) {
        return `<span class="drop-item map-loc-tag map-loc-tag--task" title="跳转到该冒险指南条目" onclick="globalSearchAndJump('${this.escAttr(name)}','冒险指南')">${this.escHtml(name)}</span>`;
    },

    // --- 数据库条目链接（青色）：奖励/步骤里提到的道具、武器、赏金首等 ---
    DB_LINK_CATS: ["人类武器", "人类防具", "人类道具", "战车装备", "战车道具", "特殊炮弹", "赏金首", "怪物数据", "称号"],
    _dbNameMap: null,
    _dbMapPromise: null,

    dbJumpTag: function (name, cat) {
        return `<span class="drop-item map-loc-tag map-loc-tag--db" title="数据库：${this.escAttr(cat)}" onclick="globalSearchAndJump('${this.escAttr(name)}','${this.escAttr(cat)}')">${this.escHtml(name)}</span>`;
    },

    /** 数据库目录懒加载；加载完成后重绘当前详情让物品链接生效 */
    ensureDbCatalog: function () {
        const IB = window.ItemBridge;
        if (!IB || !IB.loadItemCatalog) return;
        if (!this._dbMapPromise) {
            this._dbMapPromise = IB.loadItemCatalog().then(() => {
                this._dbNameMap = null;
                const active = document.querySelector(".tab-btn.active");
                if (active && active.innerText === "冒险指南" && window.lastSelectedItem) {
                    const grid = document.getElementById("stats-grid");
                    if (grid) grid.innerHTML = window.PageRenderers["冒险指南"].renderStats(window.lastSelectedItem);
                }
            }).catch(() => { });
        }
    },

    /** 名称 → 分类 的数据库条目索引（目录未加载完成时返回 null） */
    dbLinkIndex: function () {
        if (this._dbNameMap) return this._dbNameMap;
        const cat = window.ItemBridge && ItemBridge.getCatalog && ItemBridge.getCatalog();
        if (!cat) return null;
        const map = Object.create(null);
        this.DB_LINK_CATS.forEach(c => {
            Object.keys(cat.byCat[c] || {}).forEach(n => {
                if (!map[n]) map[n] = c;
            });
        });
        this._dbNameMap = map;
        return map;
    },

    /** 当前分类所有条目名（用于「名称」自动识别前置任务） */
    guideEntryNames: function () {
        return (window.currentRawData || [])
            .map(it => it && it.名称)
            .filter(n => n && String(n).trim() && String(n).trim() !== "-")
            .sort((a, b) => String(b).length - String(a).length);
    },

    /**
     * 在已转义的文本上渲染跳转标签：
     * [[地名]] / [[地名|文案]] → 地图跳转（绿），
     * [[地图名@x,y]] / [[地图名@x,y|文案]] → 地图精确坐标跳转（绿），
     * {{任务名}} → 指南跳转（金），
     * 「名称」自动识别（指南条目→金，数据库条目→青）
     */
    decorateJumpTags: function (html) {
        html = html.replace(/\[\[([^\[\]]+)\]\]/g, (m, raw) => {
            const body = String(raw).trim();
            let target = body, label = "";
            const pipe = body.indexOf("|");
            if (pipe >= 0) {
                target = body.slice(0, pipe).trim();
                label = body.slice(pipe + 1).trim();
            }
            const at = target.lastIndexOf("@");
            if (at > 0) {
                const place = target.slice(0, at).trim();
                const mm = target.slice(at + 1).trim().match(/^(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)$/);
                if (mm && place) {
                    const txt = label || (place + " (" + Number(mm[1]) + ", " + Number(mm[2]) + ")");
                    return `<span class="drop-item map-loc-tag" title="在BS控制器地图中定位到坐标" onclick="MapBridge.jumpToPoint('${this.escAttr(place)}', ${Number(mm[1])}, ${Number(mm[2])})">${this.escHtml(txt)}</span>`;
                }
            }
            if (!target) return m;
            const txt = label || target;
            return `<span class="drop-item map-loc-tag" title="在BS控制器地图中定位" onclick="globalMapJump('${this.escAttr(target)}')">${this.escHtml(txt)}</span>`;
        });
        html = html.replace(/\{\{([^{}]+)\}\}/g, (m, n) => this.taskJumpTag(n.trim()));
        this.guideEntryNames().forEach(n => {
            const re = new RegExp("「" + this.escapeRegExp(this.escHtml(String(n))) + "」", "g");
            html = html.replace(re, "「" + this.taskJumpTag(String(n)) + "」");
        });
        const db = this.dbLinkIndex();
        if (db) {
            Object.keys(db).sort((a, b) => b.length - a.length).forEach(n => {
                const re = new RegExp("「" + this.escapeRegExp(this.escHtml(String(n))) + "」", "g");
                html = html.replace(re, "「" + this.dbJumpTag(String(n), db[n]) + "」");
            });
        }
        return html;
    },

    /** 步骤/正文渲染入口 */
    renderInlineJumpTags: function (text) {
        return this.decorateJumpTags(this.escHtml(text));
    },

    /** 奖励列渲染：在通用语法之上追加裸物品名匹配（不带引号也能链接） */
    renderReward: function (text) {
        let html = this.escHtml(text);
        const db = this.dbLinkIndex();
        if (db) {
            // 长名优先；已生成的链接先存入 stash 换成占位符，防止短物品名（如"霰弹枪"）命中链接内部文本/属性
            const stash = [];
            const stashHtml = s => "\u0000" + (stash.push(s) - 1) + "\u0000";
            Object.keys(db).sort((a, b) => b.length - a.length).forEach(n => {
                if (String(n).length < 2) return;
                const re = new RegExp(this.escapeRegExp(this.escHtml(String(n))), "g");
                html = html.replace(re, m => stashHtml(this.dbJumpTag(n, db[n])));
            });
            // 货币/声望/经验等通用奖励渲染为芯片（样式化、无跳转）；长词（经验值/声望值）优先匹配避免残留尾字
            [/\d[\d,，]*G/g, /\d+\s*(?:经验值|声望值|经验|声望)|(?:经验值|声望值|经验|声望)\s*[+-]?\d+/g].forEach(re => {
                html = html.replace(re, m => stashHtml('<span class="reward-chip">' + m + "</span>"));
            });
            // 相邻标签之间的纯分隔符（、，,等）不再显示
            html = html.replace(/(\u0000\d+\u0000)[\s、,，;；/]+(?=\u0000\d+\u0000)/g, "$1");
            html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]);
        }
        return this.decorateJumpTags(html);
    },

    /** 任务级地点列表（、分隔）→ 可点击跳转标签 */
    renderPlaceTags: function (raw) {
        const places = String(raw || "").split(/[、,，;；/]/).map(s => s.trim()).filter(s => s && s !== "-");
        if (!places.length) return "";
        return places.map(p =>
            `<span class="drop-item map-loc-tag" title="在BS控制器地图中定位" onclick="globalMapJump('${this.escAttr(p)}')">${this.escHtml(p)}</span>`
        ).join(" ");
    },

    /** 解析一行步骤 → { icon, text, img } */
    parseStep: function (line) {
        let s = line.trim();
        let icon = null;
        const iconMatch = s.match(/^\[(战斗|对话|收集|BOSS|交付|调查|移动)\]\s*/);
        if (iconMatch) {
            icon = iconMatch[1];
            s = s.slice(iconMatch[0].length);
        }
        let img = null;
        const pipeIdx = s.lastIndexOf("|");
        if (pipeIdx >= 0) {
            const tail = s.slice(pipeIdx + 1).trim();
            // 仅当竖线后是图片扩展名时才视为步骤配图，避免吞掉 [[地名@x,y|文案]] 里的竖线
            if (tail && !tail.includes(" ") && /\.(png|jpe?g|webp|gif|bmp)$/i.test(tail)) {
                img = tail;
                s = s.slice(0, pipeIdx);
            }
        }
        return { icon, text: s.trim(), img };
    },

    /** 解析攻略步骤：一行一步；# 开头为结局分支头（#结局A：标题｜奖励：xxx） */
    parseGuide: function (raw) {
        const lines = String(raw || "").split(/\r?\n/).map(s => s.trim()).filter(s => s && s !== "-");
        const common = [];
        const branches = [];
        let cur = null;
        lines.forEach(line => {
            if (line.startsWith("#")) {
                let head = line.slice(1).trim();
                let reward = "";
                const pipeIdx = head.lastIndexOf("|");
                if (pipeIdx >= 0) {
                    const tail = head.slice(pipeIdx + 1).trim();
                    if (/^奖励[:：]/.test(tail)) {
                        reward = tail.replace(/^奖励[:：]/, "").trim();
                        head = head.slice(0, pipeIdx).trim();
                    }
                }
                cur = { title: head, reward, steps: [] };
                branches.push(cur);
                return;
            }
            const step = this.parseStep(line);
            if (step.text || step.img) {
                if (cur) cur.steps.push(step);
                else common.push(step);
            }
        });
        return { common, branches };
    },

    /** 渲染一段步骤时间轴（通用步骤 / 各结局分支共用） */
    renderStepList: function (steps) {
        let html = "";
        steps.forEach((step, i) => {
            const last = i === steps.length - 1;
            const badge = step.icon
                ? `<span title="${this.escAttr(step.icon)}" style="background:rgba(80,255,125,0.12);">${this.escHtml(this.STEP_ICONS[step.icon] || "▶")}</span>`
                : `<span>${String(i + 1).padStart(2, '0')}</span>`;

            let imgHtml = "";
            if (step.img) {
                const src = "img/冒险指南/" + encodeURI(step.img);
                imgHtml = `<img src="${this.escAttr(src)}" alt="步骤配图" loading="lazy"
                                style="max-width:150px; max-height:96px; border:1px solid #2a7a45; cursor:zoom-in; flex-shrink:0; object-fit:cover;"
                                onerror="this.style.display='none'"
                                onclick="window.mmTaskLightbox && window.mmTaskLightbox('${this.escAttr(src)}')">`;
            }

            html += `<div style="display:flex; align-items:flex-start; gap:10px; margin-left:14px; ${last ? "" : "padding-bottom:12px; border-left:2px solid #1a3d1a;"}">
                        <span style="color:#50ff7d; border:1px solid #50ff7d; min-width:28px; text-align:center; padding:2px 0; font-size:12px; flex-shrink:0;">${badge}</span>
                        <span style="color:#50ff7d; line-height:1.7; flex:1;">${this.renderInlineJumpTags(step.text)}</span>
                        ${imgHtml}
                     </div>`;
        });
        return html;
    },

    renderStepTimeline: function (raw) {
        const guide = this.parseGuide(raw);
        if (!guide.common.length && !guide.branches.length) return "";

        let html = '<div class="group-title">【攻略步骤】</div>';
        html += '<div class="stats-grid detail-field-grid">';
        html += '<div style="grid-column: span 5; border:1px dashed #50ff7d; background: rgba(80,255,125,0.05); padding: 14px 12px;">';

        if (guide.branches.length) {
            if (guide.common.length) html += this.renderStepList(guide.common);
            guide.branches.forEach(b => {
                html += `<div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin:16px 0 10px 14px;">
                            <span style="color:#ffd700; border:1px solid #ffd700; padding:2px 8px; font-size:12px; flex-shrink:0;">⚑ ${this.renderInlineJumpTags(b.title)}</span>
                            ${b.reward ? `<span class="branch-reward" style="color:#ffd700; font-size:12px; opacity:0.9;">奖励：${this.renderReward(b.reward)}</span>` : ""}
                         </div>`;
                html += this.renderStepList(b.steps);
            });
        } else {
            html += this.renderStepList(guide.common);
        }

        html += '</div></div>';
        return html;
    },

    renderSimpleCard: function (title, value, color) {
        if (value === undefined || value === null || String(value).trim() === "" || String(value) === "-") return "";
        return `<div class="group-title">【${title}】</div>
                <div class="stats-grid detail-field-grid">
                    <div class="stat-card" style="grid-column: span 5;">
                        <span class="stat-value" style="color:${color || "#00ff66"}; text-align:left; white-space: normal; line-height:1.6;">${this.renderInlineJumpTags(value)}</span>
                    </div>
                </div>`;
    },

    renderStats: function (item) {
        this.ensureDbCatalog();
        let html = "";

        // --- A. 触发地点（可点击跳转地图） ---
        const placeTags = this.renderPlaceTags(item.触发地点);
        if (placeTags) {
            html += '<div class="group-title">【触发地点】</div>';
            html += '<div class="stats-grid detail-field-grid">';
            html += `<div class="stat-card" style="grid-column: 1 / -1;">
                        <span class="stat-label">点击定位</span>
                        <span class="stat-value loc-tags">${placeTags}</span>
                     </div>`;
            html += '</div>';
        }

        // --- B. 触发条件 ---
        html += this.renderSimpleCard("触发条件", item.触发条件, "#9fdfaf");

        // --- C. 攻略步骤（步骤式时间轴） ---
        html += this.renderStepTimeline(item.攻略步骤);

        // --- D. 奖励（支持裸物品名自动链接数据库条目） ---
        if (item.奖励 && item.奖励 !== "-") {
            html += '<div class="group-title">【任务奖励】</div>';
            html += '<div class="stats-grid detail-field-grid">';
            html += `<div class="stat-card" style="grid-column: span 5;">
                        <span class="stat-value" style="color:#ffd700; text-align:left; white-space: normal; line-height:1.6;">${this.renderReward(item.奖励)}</span>
                     </div>`;
            html += '</div>';
        }

        // --- E. 地图点位（地图上关联本指南的标记，可反向跳转定位） ---
        if (window.ItemBridge && typeof ItemBridge.renderItemMapMarkersHtml === "function") {
            const tags = ItemBridge.renderItemMapMarkersHtml("冒险指南", item.名称);
            if (tags) {
                html += '<div class="group-title">【地图点位】</div>';
                html += '<div class="stats-grid detail-field-grid">';
                html += `<div class="stat-card" style="grid-column: 1 / -1;">
                            <span class="stat-value loc-tags">${tags}</span>
                         </div>`;
                html += '</div>';
            }
        }

        // --- F. 任务简述（兼容旧"备注"列名）：小字号、自然换行（不用 keep-all 的标点断行） ---
        const brief = item.任务简述 || item.备注;
        if (brief && String(brief).trim() !== "" && String(brief).trim() !== "-") {
            html += '<div class="group-title">【任务简述】</div>';
            html += '<div class="stats-grid detail-field-grid">';
            html += `<div class="stat-card" style="grid-column: 1 / -1;">
                        <span class="stat-value stat-value-wrap" style="color:#888; text-align:left; white-space: normal; font-size:13px; line-height:1.8;">${this.renderInlineJumpTags(brief)}</span>
                     </div>`;
            html += '</div>';
        }

        return html;
    },

    onUpdateVisual: function (item) {
        const guide = this.parseGuide(item.攻略步骤);
        const maxBranch = guide.branches.reduce((n, b) => Math.max(n, b.steps.length), 0);
        const totalSteps = guide.common.length + maxBranch;
        const branchTxt = guide.branches.length
            ? `${guide.branches.length} 种结局 · 共 ${totalSteps} 步`
            : `共 ${totalSteps} 步`;
        const loc = (item.触发地点 && item.触发地点 !== "-") ? item.触发地点 : "???";
        const reward = (item.奖励 && item.奖励 !== "-") ? `\n>> 奖励：${item.奖励}` : "";
        const brief = (item.任务简述 || item.备注 || "").trim();
        const briefTxt = (brief && brief !== "-") ? `\n>> 简述：${brief}` : "";
        const log = `>> 冒险指南档案：${item.名称}\n>> 类型：${item.类型 || "???"} · 地点：${loc} · ${branchTxt}${reward}${briefTxt}`;
        setTimeout(() => {
            if (window.triggerGlobalTypewriter) window.triggerGlobalTypewriter(log);
        }, 50);
    }
});

// --- 步骤配图 lightbox（全屏遮罩，点击关闭） ---
(function () {
    "use strict";
    let overlay = null;
    window.mmTaskLightbox = function (src) {
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.style.cssText = "position:fixed; inset:0; z-index:9999; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; cursor:zoom-out;";
            overlay.addEventListener("click", function () { overlay.style.display = "none"; });
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = `<img src="${src}" alt="" style="max-width:92vw; max-height:92vh; border:1px solid #50ff7d; box-shadow:0 0 40px rgba(80,255,125,0.3);">`;
        overlay.style.display = "flex";
    };
})();
