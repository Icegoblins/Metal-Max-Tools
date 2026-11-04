/**
 * 特技页面渲染器
 *
 * 数据契约（mm2r_database.xlsx → dist/data/特技.json）：
 *   类型 | 族 | 名称 | 等级 | 效果 | 使用次数 | 获得方法 | 描述
 *   同「族」= 同一技能的普通版与「真・」进阶版，各 5 个等级（Lv.1~5）。
 *
 * 交互：
 *   1. 名称旁「普通 / 进阶」开关：照抄怪物数据的 .shiny-terminal-switch，
 *      按 (族, 等级, 形态) 查表切换，保持当前等级。
 *      例：电光石火SS → 真・电光石火SS。
 *   2. 等级切换：照抄星级控件的 .star-btn，按 (族, 形态, 等级) 查表切换。
 *
 * 注意：不能靠「名称加前缀」拼进阶名。「狙击」族普通侧是
 * 生疏/常规/熟练/极限/爆头狙击，进阶侧却是 真・狙击A/S/SS/EX，
 * 所以一律按 (族, 等级, 形态) 回表取目标行。
 */
(function () {
    "use strict";

    // 数据里的进阶前缀是「真・」(U+30FB)，只判首字即可，避免中点字符差异
    var ADV_HEAD = "真";
    var LV_LABELS = { 1: "Lv.1", 2: "Lv.2", 3: "Lv.3", 4: "Lv.4", 5: "Lv.5" };

    function lvNum(v) {
        var n = Number(v);
        return isFinite(n) ? n : 0;
    }

    function isAdv(item) {
        return String((item && item.名称) || "").charAt(0) === ADV_HEAD;
    }

    // 当前分类的完整数据（列表点击时 window.allData 也会被赋值，这里优先用 currentRawData）
    function pool() {
        return window.currentRawData || window.allData || [];
    }

    function findVariant(family, level, wantAdv) {
        var lv = lvNum(level);
        return pool().find(function (it) {
            return it.族 === family && lvNum(it.等级) === lv && isAdv(it) === wantAdv;
        });
    }

    function hasAdvVariant(family) {
        return pool().some(function (it) { return it.族 === family && isAdv(it); });
    }

    function levelsOf(family, adv) {
        return pool()
            .filter(function (it) { return it.族 === family && isAdv(it) === adv; })
            .map(function (it) { return lvNum(it.等级); })
            .filter(function (n) { return n > 0; })
            .sort(function (a, b) { return a - b; });
    }

    function clean(v) {
        var s = String(v == null ? "" : v).trim();
        return (!s || s === "-") ? "" : s;
    }

    function esc(s) {
        return window.escHtml ? window.escHtml(s) : String(s == null ? "" : s);
    }

    function statCard(label, value, color) {
        return '<div class="stat-card"><span class="stat-label">' + esc(label) +
            '</span><span class="stat-value" style="color:' + (color || "#50ff7d") + ';">' +
            esc(value) + '</span></div>';
    }

    // --- 名称旁开关：普通 / 进阶 -------------------------------------------
    window.syncTejiUi = function (item, activeTab) {
        var btn = document.getElementById("teji-toggle");
        if (!btn) return;
        var isTeji = activeTab === "特技" && !!(item && item.族);
        var canToggle = isTeji && hasAdvVariant(item.族);
        var adv = isTeji && isAdv(item);
        btn.style.display = canToggle ? "" : "none";
        btn.classList.toggle("is-shiny-on", adv);
        var label = btn.querySelector(".sts-label");
        if (label) label.textContent = adv ? "进阶" : "普通";
    };

    window.toggleTejiAdvance = function () {
        var item = window.lastSelectedItem;
        if (!item || !item.族) return;
        var target = findVariant(item.族, item.等级, !isAdv(item));
        if (target && window.showDetail) window.showDetail(target);
    };

    // --- 等级切换：照抄星级控件 -------------------------------------------
    window.switchTejiLevel = function (lv) {
        var item = window.lastSelectedItem;
        if (!item || !item.族) return;
        var target = findVariant(item.族, lv, isAdv(item));
        if (target && window.showDetail) window.showDetail(target);
    };

    registerPageRenderer("特技", {
        skin: "skin-特技",

        renderStats: function (item) {
            var family = item.族 || "";
            var adv = isAdv(item);
            var curLv = lvNum(item.等级);
            var levels = levelsOf(family, adv);
            var effect = clean(item.效果);
            var uses = clean(item.使用次数) || "—";
            var html = "";

            // A. 等级选择器（.star-btn 与星级控件同款）
            if (levels.length > 1) {
                // 与战车装备的星级选择器一致：直接一排按钮，不额外占一行标题
                html += '<div class="star-selector" style="grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:10px;margin:0 0 6px 0;">';
                levels.forEach(function (lv) {
                    var active = lv === curLv;
                    html += '<button class="star-btn ' + (active ? "active" : "") + '"' +
                        ' onclick="window.switchTejiLevel(' + lv + ')"' +
                        ' style="flex:0 1 auto;min-width:72px;padding:10px 14px;white-space:nowrap;' +
                        ' background:' + (active ? "rgba(80,255,125,0.2)" : "#000") + ';' +
                        ' border:1px solid ' + (active ? "#50ff7d" : "#333") + ';' +
                        ' color:' + (active ? "#50ff7d" : "#666") + ';' +
                        ' cursor:pointer;font-weight:bold;border-radius:4px;">' +
                        (LV_LABELS[lv] || ("Lv." + lv)) + '</button>';
                });
                html += '</div>';
            }

            // B. 基础信息
            html += '<div class="group-title">【技能信息】</div>';
            html += '<div class="stats-grid detail-field-grid">';
            html += statCard("分类", item.类型 || "—");
            html += statCard("技能族", family || "—");
            html += statCard("形态", adv ? "进阶" : "普通", adv ? "#ffd700" : "#50ff7d");
            html += statCard("等级", LV_LABELS[curLv] || ("Lv." + curLv));
            html += statCard("使用次数", uses);
            html += '</div>';

            // C. 效果
            if (effect) {
                html += '<div class="group-title">【效果】</div>';
                html += '<div class="stats-grid detail-field-grid">' +
                    '<div class="stat-card" style="grid-column:span 5;">' +
                    '<span class="stat-value" style="color:#50ff7d;text-align:left;white-space:normal;line-height:1.7;">' +
                    esc(effect) + '</span></div></div>';
            }

            // D. 同族另一形态、同等级对照（方便对比普通 / 进阶差异）
            var other = findVariant(family, curLv, !adv);
            if (other) {
                html += '<div class="group-title">【' + (adv ? "普通" : "进阶") + '版 · 同等级对照】</div>';
                // 单行小字：名称 / 次数 / 效果并排，避免 20px 大字再占一行把首屏撑出滚动
                html += '<div class="stats-grid detail-field-grid">' +
                    '<div class="stat-card" style="grid-column:span 5;">' +
                    '<span class="stat-value" style="color:#9aa89a;text-align:left;white-space:normal;' +
                    'word-break:break-word;line-height:1.5;font-size:14px;">' +
                    esc(other.名称) + '　使用次数 ' + esc(clean(other.使用次数) || "—") +
                    '　｜　' + esc(clean(other.效果)) +
                    '</span></div></div>';
            }
            return html;
        },

        onUpdateVisual: function (item) {
            var log = ">> 特技档案：" + item.名称 +
                "\n>> 形态：" + (isAdv(item) ? "进阶" : "普通") + " / 等级 " + (LV_LABELS[lvNum(item.等级)] || item.等级) +
                "\n>> " + (clean(item.效果) || "（无效果文本）");
            setTimeout(function () {
                if (window.triggerGlobalTypewriter) window.triggerGlobalTypewriter(log);
            }, 50);
        }
    });
})();
