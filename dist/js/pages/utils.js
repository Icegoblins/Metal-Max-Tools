/**
 * 渲染人类装备的职业适配矩阵
 * @param {Object} item - 包含“职业_XXX”键值对的装备数据对象
 * @returns {string} - 生成的 HTML 字符串
 */
function renderCommonJobMatrix(item) {
    // 1. 筛选出所有职业相关的字段 (例如：职业_猎人, 职业_犬)
    const jobKeys = Object.keys(item).filter(key => key.startsWith("职业_"));

    // 如果没有职业数据，则不渲染此模块
    if (jobKeys.length === 0) return "";

    // 2. 特殊职业颜色映射表 (配置化管理)
    // 只要职业名或内容包含键名(Key)，就会应用对应的 CSS 类名
    const specialJobMap = {
        "犬": "dog-limit",       // 金棕色
        "食金虫": "insect-limit", // 青绿色
        "机器人": "special-limit" // 预留紫色
    };

    let html = '<div class="group-title">【职业适配】</div>';
    html += '<div class="stats-grid" style="grid-column: 1 / -1;display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px;">';
    // 容器使用 job-grid 类，配合 CSS 的 display: grid 形成矩阵
    html += '<div class="job-grid">';


    jobKeys.forEach(key => {
        // 提取基础职业名，例如 "职业_机械师" -> "机械师"
        const jobBaseName = key.replace("职业_", "");
        const val = item[key]; // 获取单元格内容，如 "○", "-", "男机械师"

        // 判断该装备是否对该职业可用 (排除 "-" 和空值)
        const isActive = (val !== "-" && val !== "");

        let displayContent = jobBaseName; // 默认显示职业名
        let colorClass = "";              // 存储对应的颜色类名

        if (isActive) {
            // 优先逻辑 A: 检测单元格内容是否包含特定的限定文字
            if (val.includes("男")) {
                colorClass = "male-limit";
                displayContent = val;
            } else if (val.includes("女")) {
                colorClass = "female-limit";
                displayContent = val;
            } else {
                // 优先逻辑 B: 匹配特殊职业配置表 (犬、食金虫等)
                // 同时检查职业底名 (jobBaseName) 和 单元格内容 (val)
                for (let keyword in specialJobMap) {
                    if (jobBaseName.includes(keyword) || val.includes(keyword)) {
                        colorClass = specialJobMap[keyword];
                        break;
                    }
                }

                // 如果是通用标记 "○"，显示职业底名；否则显示具体描述
                displayContent = (val === "○") ? jobBaseName : val;
            }
        }

        // 生成单个职业格子的 HTML
        // active/disabled 控制亮起或灰掉，colorClass 控制具体颜色
        html += `
            <div class="job-tag ${isActive ? 'active' : 'disabled'} ${colorClass}">
                ${displayContent}
            </div>`;
    });

    html += '</div>';
    return html;
}

function formatPrice(value) {
    if (!value || value === "-" || value === "暂无") {
        return "非卖品";
    }

    const num = parseFloat(value);
    if (isNaN(num)) {
        return value + " G"; // 非数字，直接添加单位
    }

    // 格式化数字并添加单位
    return num.toLocaleString('zh-CN') + " G";
}

/**
 * 渲染战车星级切换模块
 * @param {Array} starsData - 该装备的星级属性数组
 * @param {number} currentIdx - 当前选中的星级索引 (0-3)
 * @param {Function} onSwitch - 点击切换时的回调
 */
function renderStarSelector(starsData, currentIdx, onSwitch) {
    if (!starsData || starsData.length <= 1) return "";

    let html = '<div class="star-selector-container">';
    const starLabels = ["通常", "★", "★★", "★★★"];

    starLabels.forEach((label, idx) => {
        const isActive = idx === currentIdx ? "active" : "";
        const exists = starsData[idx] ? "" : "disabled";
        // 绑定一个全局临时函数来处理点击，或者在渲染后通过 JS 绑定
        html += `<div class="star-btn ${isActive} ${exists}" onclick="window.switchVehicleStar(${idx})">${label}</div>`;
    });

    html += '</div>';
    return html;
}

/**
 * 计算差值并格式化 HTML
 * @param {number} current - 当前值
 * @param {number} base - 0星基准值
 * @param {boolean} isWeight - 是否是重量（重量降低是绿色，升高是红色）
 */
function formatStatDiff(current, base, isWeight = false) {
    if (current === base) return "";
    const diff = (current - base).toFixed(2);
    const numDiff = parseFloat(diff);

    let color = numDiff > 0 ? "#00ff00" : "#ff3333";
    let sign = numDiff > 0 ? "↑" : "↓";

    // 重量逻辑反转：重量轻了（负数）显示绿色
    if (isWeight) {
        color = numDiff < 0 ? "#00ff00" : "#ff3333";
    }

    return `<span class="stat-diff" style="color:${color};">[${sign}${Math.abs(numDiff)}]</span>`;
}

window.searchAndJump = function(targetName) {
    // 1. 切换到“战车底盘”分类
    const navButtons = document.querySelectorAll('.nav-btn');
    const tankNav = Array.from(navButtons).find(btn => btn.innerText.includes("战车"));

    if (tankNav) {
        tankNav.click(); // 触发分类切换

        // 2. 延迟执行搜索，等待列表渲染
        setTimeout(() => {
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.value = targetName;
                searchInput.dispatchEvent(new Event('input')); // 触发列表过滤

                // 3. 自动点击搜索结果中的第一项
                const firstResult = document.querySelector('.list-item');
                if (firstResult) firstResult.click();
            }
        }, 100);
    }
};

/** 阻止浏览器「保存的信息」候选框（Chrome/Edge 常忽略 autocomplete=off） */
window.mmDisableInputAutofill = function (el) {
    if (!el) return;
    el.setAttribute("autocomplete", "off");
    el.setAttribute("autocorrect", "off");
    el.setAttribute("autocapitalize", "off");
    el.setAttribute("spellcheck", "false");
    el.setAttribute("data-lpignore", "true");
    el.setAttribute("data-form-type", "other");
    if (el.type === "text") {
        try { el.type = "search"; } catch (_) { /* ignore */ }
    }
    el.readOnly = true;
    el.addEventListener("focus", function () {
        el.readOnly = false;
    });
};