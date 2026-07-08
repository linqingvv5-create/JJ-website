(function () {
  const STORAGE_KEY = "jj_life_hub_state_v1";
  const LAST_PAGE_KEY = "jj_app_last_page_v1";
  const MODULE_KEYS = ["growth", "hobby", "money", "creator", "work"];
  const MODULE_CONFIG = {
    growth: {
      icon: "🌱",
      title: "成长",
      subtitle: "读书·技能·复盘",
      notePlaceholder: "随手记读书笔记、要学的技能、最近卡住的地方、想做的复盘题目。",
      focusPlaceholder: "这两天最想推进什么？",
      stepPlaceholder: "下一步只写一个最小动作",
      taskPlaceholder: "加一条成长待办，比如：整理 3 条读书摘录",
      tips: "先不用想完整系统，先把灵感和下一步存起来。"
    },
    hobby: {
      icon: "🎨",
      title: "兴趣",
      subtitle: "手工·收藏·探索",
      notePlaceholder: "记录灵感、材料清单、想做的东西、想买的器材、想去看的展。",
      focusPlaceholder: "最近最想玩的兴趣方向",
      stepPlaceholder: "下一步要买什么、做什么、试什么",
      taskPlaceholder: "加一条兴趣待办，比如：查 2 个材料链接",
      tips: "兴趣模块适合先堆想法，等你哪天想展开，我们再细化。"
    },
    money: {
      icon: "💰",
      title: "赚钱项目",
      subtitle: "量化·副业·投资",
      notePlaceholder: "这里写项目想法、收入目标、投资观察、想验证的新方向。",
      focusPlaceholder: "当前最优先想推进的赚钱方向",
      stepPlaceholder: "今天/明天能做的一步",
      taskPlaceholder: "加一条赚钱待办，比如：整理一个副业方案",
      tips: "交易看板继续管具体持仓，这里更适合放项目想法和副业推进。"
    },
    creator: {
      icon: "📸",
      title: "博主",
      subtitle: "小红书·内容·涨粉",
      notePlaceholder: "记选题、封面灵感、脚本碎片、最近的数据观察和内容方向。",
      focusPlaceholder: "最近最想发的内容主题",
      stepPlaceholder: "下一步：写提纲、拍素材还是发一条",
      taskPlaceholder: "加一条内容待办，比如：列 5 个标题",
      tips: "先把内容灵感全接住，后面我们再做内容日历和数据面板。"
    },
    work: {
      icon: "💼",
      title: "工作",
      subtitle: "任务·日程·效率",
      notePlaceholder: "记录今天要做的事、卡点、沟通提醒、临时灵感和流程优化。",
      focusPlaceholder: "当前工作主线",
      stepPlaceholder: "下一步先推进哪个动作",
      taskPlaceholder: "加一条工作待办，比如：回一封关键邮件",
      tips: "工作模块先做轻量待办，后面可以再接日程和流程模板。"
    }
  };
  const MODULE_PAGE_IDS = {
    growth: "pageGrowth",
    hobby: "pageHobby",
    money: "pageMoney",
    creator: "pageCreator",
    work: "pageWork"
  };
  const MODULE_SELECTORS = {
    growth: ".mod-card[onclick=\"navTo('growth')\"]",
    hobby: ".mod-card[onclick=\"navTo('hobby')\"]",
    money: ".mod-card[onclick=\"navTo('money')\"]",
    creator: ".mod-card[onclick=\"navTo('creator')\"]",
    work: ".mod-card[onclick=\"navTo('work')\"]"
  };

  const syncState = {
    mode: "checking",
    savedAt: "",
  };

  const originalRenderHome = typeof window.renderHome === "function" ? window.renderHome : null;

  function injectStyles() {
    if (document.getElementById("lifeHubStyles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "lifeHubStyles";
    style.textContent = `
      body {
        padding-top: env(safe-area-inset-top);
        padding-bottom: calc(84px + env(safe-area-inset-bottom));
        overscroll-behavior-y: contain;
      }

      .home-header {
        padding-top: calc(28px + env(safe-area-inset-top));
      }

      .wake-btn {
        margin-bottom: 14px;
      }

      .home-quickbar {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        padding: 0 16px 12px;
      }

      .quick-action-card,
      .home-focus-card,
      .life-module-panel,
      .life-module-hero,
      .life-task-item {
        border: 1px solid var(--bd);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18);
      }

      .quick-action-card {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-height: 92px;
        padding: 14px;
        border-radius: 18px;
        background: linear-gradient(135deg, rgba(24,24,36,0.98), rgba(17,17,26,0.98));
        color: var(--txt);
        text-decoration: none;
        text-align: left;
      }

      .quick-action-card strong {
        font-size: 16px;
      }

      .quick-action-card span {
        font-size: 12px;
        color: var(--mt);
      }

      .quick-action-card.accent {
        background: linear-gradient(135deg, rgba(24,48,86,0.98), rgba(16,27,47,0.98));
        border-color: rgba(92, 201, 232, 0.32);
      }

      .home-focus-card {
        margin: 0 16px 14px;
        padding: 16px;
        border-radius: 18px;
        background: linear-gradient(135deg, rgba(24,24,36,0.98), rgba(14,14,22,0.98));
      }

      .home-focus-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
      }

      .home-focus-kicker {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ac2);
      }

      .home-focus-sync {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 5px 10px;
        border-radius: 999px;
        background: rgba(92, 201, 232, 0.14);
        color: var(--ac2);
        font-size: 11px;
        font-weight: 700;
      }

      .home-focus-sync[data-sync-mode="online"] {
        background: rgba(62, 207, 142, 0.14);
        color: var(--done);
      }

      .home-focus-sync[data-sync-mode="offline"] {
        background: rgba(245, 166, 35, 0.14);
        color: var(--warn);
      }

      .home-focus-list {
        display: grid;
        gap: 10px;
      }

      .home-focus-row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 10px;
        padding: 12px 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.03);
      }

      .home-focus-row strong {
        font-size: 14px;
      }

      .home-focus-row p {
        margin: 2px 0 0;
        font-size: 12px;
        color: var(--mt);
      }

      .home-focus-empty {
        padding: 12px 0 2px;
        font-size: 13px;
        line-height: 1.6;
        color: var(--mt);
      }

      .home-focus-count {
        min-width: 56px;
        padding: 6px 8px;
        border-radius: 999px;
        background: rgba(232, 116, 92, 0.14);
        color: var(--accent);
        font-size: 11px;
        font-weight: 700;
        text-align: center;
      }

      .module-card-snapshot {
        display: grid;
        gap: 6px;
        margin-top: 14px;
      }

      .module-card-badge {
        display: inline-flex;
        width: fit-content;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.12);
        font-size: 11px;
        font-weight: 700;
      }

      .module-card-preview {
        font-size: 12px;
        line-height: 1.45;
        opacity: 0.82;
      }

      .life-module-shell {
        padding-bottom: 10px;
      }

      .life-module-shell .back-btn {
        padding-top: calc(12px + env(safe-area-inset-top));
      }

      .life-module-hero {
        padding: 20px 18px;
        border-radius: 22px;
        background: linear-gradient(145deg, rgba(25,25,39,0.98), rgba(13,13,20,0.98));
        margin-bottom: 14px;
      }

      .life-module-hero h1 {
        text-align: left;
        padding: 0;
        margin-bottom: 8px;
      }

      .life-module-hero p {
        color: var(--mt);
        line-height: 1.6;
      }

      .life-module-hero-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 10px;
      }

      .life-module-kicker {
        font-size: 12px;
        letter-spacing: 0.08em;
        color: var(--ac3);
        text-transform: uppercase;
      }

      .life-module-sync {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 28px;
        padding: 5px 10px;
        border-radius: 999px;
        background: rgba(92, 201, 232, 0.14);
        color: var(--ac2);
        font-size: 11px;
        font-weight: 700;
      }

      .life-module-sync[data-sync-mode="online"] {
        background: rgba(62, 207, 142, 0.14);
        color: var(--done);
      }

      .life-module-sync[data-sync-mode="offline"] {
        background: rgba(245, 166, 35, 0.14);
        color: var(--warn);
      }

      .life-module-grid {
        display: grid;
        gap: 12px;
      }

      .life-module-two-col {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .life-module-panel {
        padding: 16px;
        border-radius: 18px;
        background: linear-gradient(145deg, rgba(24,24,36,0.98), rgba(14,14,22,0.98));
      }

      .life-module-panel h2 {
        margin: 0;
        font-size: 16px;
      }

      .life-module-panel-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
      }

      .life-module-panel-head span,
      .life-module-help,
      .life-module-updated {
        font-size: 12px;
        color: var(--mt);
      }

      .life-module-input,
      .life-module-textarea,
      .life-module-task-input {
        width: 100%;
        border: 1px solid var(--bd);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        color: var(--txt);
      }

      .life-module-input,
      .life-module-task-input {
        min-height: 48px;
        padding: 12px 14px;
      }

      .life-module-textarea {
        min-height: 136px;
        padding: 14px;
        resize: vertical;
      }

      .life-module-task-creator {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        margin-bottom: 12px;
      }

      .life-module-task-button,
      .life-module-primary-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 46px;
        padding: 0 16px;
        border-radius: 14px;
        border: none;
        background: linear-gradient(135deg, #f0b050, #e8745c);
        color: #fff;
        font-size: 14px;
        font-weight: 700;
        text-decoration: none;
      }

      .life-module-primary-link.money-link {
        background: linear-gradient(135deg, #2563eb, #0f766e);
      }

      .life-module-task-list {
        display: grid;
        gap: 10px;
      }

      .life-task-item {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 10px;
        align-items: center;
        padding: 12px 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.03);
      }

      .life-task-item.is-done {
        opacity: 0.68;
      }

      .life-task-toggle {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2px solid var(--bd);
        background: transparent;
        color: #fff;
        font-size: 11px;
      }

      .life-task-item.is-done .life-task-toggle {
        border-color: var(--done);
        background: var(--done);
      }

      .life-task-text {
        font-size: 14px;
        line-height: 1.45;
      }

      .life-task-item.is-done .life-task-text {
        text-decoration: line-through;
        color: var(--mt);
      }

      .life-task-delete {
        min-width: 34px;
        min-height: 34px;
        border-radius: 10px;
        border: 1px solid var(--bd);
        background: rgba(255, 255, 255, 0.04);
        color: var(--mt);
      }

      .life-module-empty {
        padding: 14px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.03);
        color: var(--mt);
        font-size: 13px;
        line-height: 1.6;
      }

      @media (max-width: 760px) {
        .grid {
          grid-template-columns: 1fr;
        }

        .home-quickbar,
        .life-module-two-col {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function createEmptyModuleState() {
    return {
      focus: "",
      nextStep: "",
      notes: "",
      tasks: [],
      updatedAt: ""
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizeTask(task) {
    const data = task && typeof task === "object" ? task : {};
    return {
      id: String(data.id || "").trim() || `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      text: String(data.text || "").trim(),
      done: Boolean(data.done)
    };
  }

  function normalizeModuleState(rawModuleState) {
    const state = rawModuleState && typeof rawModuleState === "object" ? rawModuleState : {};
    return {
      focus: String(state.focus || ""),
      nextStep: String(state.nextStep || ""),
      notes: String(state.notes || ""),
      tasks: Array.isArray(state.tasks) ? state.tasks.map(normalizeTask).filter((task) => task.text) : [],
      updatedAt: String(state.updatedAt || "")
    };
  }

  function normalizeHubState(rawState) {
    const state = rawState && typeof rawState === "object" ? rawState : {};
    const nextState = {};
    for (const moduleKey of MODULE_KEYS) {
      nextState[moduleKey] = normalizeModuleState(state[moduleKey]);
    }
    return nextState;
  }

  function loadHubState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return normalizeHubState(raw ? JSON.parse(raw) : null);
    } catch (error) {
      return normalizeHubState(null);
    }
  }

  function saveHubState(nextState) {
    const normalized = normalizeHubState(nextState);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function getModuleState(moduleKey) {
    return loadHubState()[moduleKey] || createEmptyModuleState();
  }

  function updateVisibleModuleMeta(moduleKey) {
    const visibleModule = getVisibleModuleKey();
    if (visibleModule !== moduleKey) {
      return;
    }

    const state = getModuleState(moduleKey);
    const updatedNode = document.querySelector(`#${MODULE_PAGE_IDS[moduleKey]} .life-module-updated`);
    if (updatedNode) {
      updatedNode.textContent = formatModuleUpdatedAt(state.updatedAt);
    }
  }

  function updateModuleState(moduleKey, updater, options) {
    const nextOptions = options || {};
    const hubState = loadHubState();
    const currentState = clone(hubState[moduleKey] || createEmptyModuleState());
    const nextModuleState = normalizeModuleState(updater(currentState) || currentState);
    nextModuleState.updatedAt = new Date().toISOString();
    hubState[moduleKey] = nextModuleState;
    saveHubState(hubState);
    refreshShell(moduleKey, nextOptions);
    return nextModuleState;
  }

  function formatModuleUpdatedAt(value) {
    if (!value) {
      return "还没开始写，随时可以先记一条。";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "内容已保存";
    }

    const dateText = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    return `最近更新 ${dateText}`;
  }

  function countPendingTasks(moduleState) {
    return (moduleState.tasks || []).filter((task) => !task.done).length;
  }

  function getModulePreview(moduleState) {
    return moduleState.focus || moduleState.nextStep || moduleState.notes.split("\n").find(Boolean) || "还没有内容，先记一个下一步。";
  }

  function getLastVisitedPage() {
    try {
      return window.localStorage.getItem(LAST_PAGE_KEY) || "";
    } catch (error) {
      return "";
    }
  }

  function setLastVisitedPage(page) {
    try {
      window.localStorage.setItem(LAST_PAGE_KEY, page);
    } catch (error) {
      return;
    }
  }

  function setHashForPage(page) {
    const nextUrl = page && page !== "home" ? `#${page}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }

  function renderModulePage(moduleKey) {
    const host = document.getElementById(MODULE_PAGE_IDS[moduleKey]);
    const config = MODULE_CONFIG[moduleKey];
    if (!host || !config) {
      return;
    }

    const moduleState = getModuleState(moduleKey);
    const pendingCount = countPendingTasks(moduleState);
    const syncLabel = getSyncLabel();

    host.innerHTML = `
      <div class="life-module-shell">
        <button class="back-btn" onclick="navTo('home')">← 首页</button>
        <div class="page">
          <section class="life-module-hero">
            <div class="life-module-hero-top">
              <span class="life-module-kicker">Module Workspace</span>
              <span class="life-module-sync" data-lifehub-sync-status data-sync-mode="${escapeHtml(syncLabel.mode)}">${escapeHtml(syncLabel.text)}</span>
            </div>
            <h1>${config.icon} ${config.title}</h1>
            <p>${config.subtitle}</p>
            <p class="life-module-updated">${escapeHtml(formatModuleUpdatedAt(moduleState.updatedAt))}</p>
          </section>

          ${moduleKey === "money" ? `
            <section class="life-module-panel" style="margin-bottom:12px;">
              <div class="life-module-panel-head">
                <h2>交易看板</h2>
                <span>手机上也能直接打开</span>
              </div>
              <p class="life-module-help" style="margin-bottom:12px;">具体持仓、计划和账户继续放在交易看板，这里用来记赚钱方向和副业推进。</p>
              <a class="life-module-primary-link money-link" href="finance.html">打开交易看板</a>
            </section>
          ` : ""}

          <div class="life-module-grid">
            <div class="life-module-two-col">
              <section class="life-module-panel">
                <div class="life-module-panel-head">
                  <h2>当前主线</h2>
                  <span>打开就先看这里</span>
                </div>
                <input
                  class="life-module-input"
                  type="text"
                  data-lifehub-module="${moduleKey}"
                  data-lifehub-field="focus"
                  value="${escapeHtml(moduleState.focus)}"
                  placeholder="${escapeHtml(config.focusPlaceholder)}"
                >
              </section>

              <section class="life-module-panel">
                <div class="life-module-panel-head">
                  <h2>下一步动作</h2>
                  <span>尽量写小一点</span>
                </div>
                <input
                  class="life-module-input"
                  type="text"
                  data-lifehub-module="${moduleKey}"
                  data-lifehub-field="nextStep"
                  value="${escapeHtml(moduleState.nextStep)}"
                  placeholder="${escapeHtml(config.stepPlaceholder)}"
                >
              </section>
            </div>

            <section class="life-module-panel">
              <div class="life-module-panel-head">
                <h2>灵感和想法</h2>
                <span>自动云同步</span>
              </div>
              <textarea
                class="life-module-textarea"
                data-lifehub-module="${moduleKey}"
                data-lifehub-field="notes"
                placeholder="${escapeHtml(config.notePlaceholder)}"
              >${escapeHtml(moduleState.notes)}</textarea>
              <p class="life-module-help" style="margin-top:10px;">${config.tips}</p>
            </section>

            <section class="life-module-panel">
              <div class="life-module-panel-head">
                <h2>随手待办</h2>
                <span>${pendingCount ? `${pendingCount} 项未完成` : "空着也没关系"}</span>
              </div>
              <div class="life-module-task-creator">
                <input
                  class="life-module-task-input"
                  type="text"
                  data-lifehub-new-task="${moduleKey}"
                  placeholder="${escapeHtml(config.taskPlaceholder)}"
                >
                <button class="life-module-task-button" type="button" data-lifehub-add-task="${moduleKey}">添加</button>
              </div>
              <div class="life-module-task-list">
                ${renderTaskList(moduleKey, moduleState.tasks)}
              </div>
            </section>
          </div>
        </div>
      </div>
    `;
  }

  function renderTaskList(moduleKey, tasks) {
    if (!tasks.length) {
      return `<div class="life-module-empty">这里先空着也没问题。你有想法时，随手丢一条进来，手机和电脑会一起同步。</div>`;
    }

    return tasks.map((task) => `
      <div class="life-task-item${task.done ? " is-done" : ""}">
        <button class="life-task-toggle" type="button" data-lifehub-toggle-task="${moduleKey}" data-task-id="${escapeHtml(task.id)}">${task.done ? "✓" : ""}</button>
        <div class="life-task-text">${escapeHtml(task.text)}</div>
        <button class="life-task-delete" type="button" data-lifehub-delete-task="${moduleKey}" data-task-id="${escapeHtml(task.id)}">✕</button>
      </div>
    `).join("");
  }

  function ensureHomeExtensionNodes() {
    const wakeButton = document.getElementById("wakeBtn");
    const grid = document.querySelector(".grid");
    if (!wakeButton || !grid) {
      return {};
    }

    let quickBar = document.getElementById("homeQuickBar");
    if (!quickBar) {
      quickBar = document.createElement("div");
      quickBar.id = "homeQuickBar";
      quickBar.className = "home-quickbar";
      grid.parentNode.insertBefore(quickBar, grid);
    }

    let focusCard = document.getElementById("homeFocusCard");
    if (!focusCard) {
      focusCard = document.createElement("div");
      focusCard.id = "homeFocusCard";
      focusCard.className = "home-focus-card";
      grid.parentNode.insertBefore(focusCard, grid);
    }

    return { quickBar, focusCard };
  }

  function renderHomeQuickBar(target) {
    const lastPage = getLastVisitedPage();
    const lastConfig = MODULE_CONFIG[lastPage];
    const lastModuleState = lastConfig ? getModuleState(lastPage) : null;
    const lastLabel = lastConfig ? `${lastConfig.icon} ${lastConfig.title}` : "💪 健身";
    const lastHint = lastConfig
      ? (lastModuleState.nextStep || lastModuleState.focus || `${countPendingTasks(lastModuleState)} 项待办`)
      : "回到最近打开的模块";

    target.innerHTML = `
      <button class="quick-action-card" type="button" data-lifehub-open-last>
        <strong>继续上次</strong>
        <div>${escapeHtml(lastLabel)}</div>
        <span>${escapeHtml(lastHint)}</span>
      </button>
      <a class="quick-action-card accent" href="finance.html">
        <strong>打开交易看板</strong>
        <div>资金、持仓、计划</div>
        <span>理财数据继续在独立看板维护</span>
      </a>
    `;
  }

  function getSyncLabel() {
    if (syncState.mode === "online") {
      return {
        mode: "online",
        text: syncState.savedAt ? `云同步已连上 · ${syncState.savedAt.slice(11, 16)}` : "云同步已连接"
      };
    }

    if (syncState.mode === "offline") {
      return {
        mode: "offline",
        text: "离线中，先保存在本机"
      };
    }

    if (syncState.mode === "syncing") {
      return {
        mode: "syncing",
        text: "正在同步..."
      };
    }

    return {
      mode: "checking",
      text: "自动保存已开启"
    };
  }

  function buildFocusRows() {
    return MODULE_KEYS
      .map((moduleKey) => {
        const config = MODULE_CONFIG[moduleKey];
        const moduleState = getModuleState(moduleKey);
        const preview = moduleState.focus || moduleState.nextStep || moduleState.notes.split("\n").find(Boolean) || "";
        const pendingCount = countPendingTasks(moduleState);
        return {
          moduleKey,
          icon: config.icon,
          title: config.title,
          preview,
          pendingCount
        };
      })
      .filter((item) => item.preview || item.pendingCount)
      .sort((left, right) => right.pendingCount - left.pendingCount || left.title.localeCompare(right.title));
  }

  function renderHomeFocusCard(target) {
    const rows = buildFocusRows().slice(0, 4);
    const syncLabel = getSyncLabel();

    target.innerHTML = `
      <div class="home-focus-head">
        <div>
          <div class="home-focus-kicker">Today Board</div>
          <strong>今天先推进这些</strong>
        </div>
        <span class="home-focus-sync" data-lifehub-sync-status data-sync-mode="${escapeHtml(syncLabel.mode)}">${escapeHtml(syncLabel.text)}</span>
      </div>
      <div class="home-focus-list">
        ${rows.length ? rows.map((row) => `
          <button class="home-focus-row" type="button" data-lifehub-open-module="${row.moduleKey}">
            <div style="font-size:24px;">${row.icon}</div>
            <div style="text-align:left;">
              <strong>${row.title}</strong>
              <p>${escapeHtml(row.preview || "先写一句当前主线")}</p>
            </div>
            <div class="home-focus-count">${row.pendingCount ? `${row.pendingCount} 待办` : "已开工"}</div>
          </button>
        `).join("") : `
          <div class="home-focus-empty">
            这 5 个模块已经接上云同步了。<br>
            你现在随便点一个模块，先写一句“当前主线”或“下一步动作”，这里就会自动汇总。
          </div>
        `}
      </div>
    `;
  }

  function renderModuleCardSnapshots() {
    for (const moduleKey of MODULE_KEYS) {
      const card = document.querySelector(MODULE_SELECTORS[moduleKey]);
      if (!card) {
        continue;
      }

      let snapshot = card.querySelector(".module-card-snapshot");
      if (!snapshot) {
        snapshot = document.createElement("div");
        snapshot.className = "module-card-snapshot";
        card.appendChild(snapshot);
      }

      const moduleState = getModuleState(moduleKey);
      const pendingCount = countPendingTasks(moduleState);
      const preview = getModulePreview(moduleState);

      snapshot.innerHTML = `
        <span class="module-card-badge">${pendingCount ? `${pendingCount} 项待办` : "云同步已开"}</span>
        <div class="module-card-preview">${escapeHtml(preview)}</div>
      `;
    }
  }

  function renderHomeEnhancements() {
    const { quickBar, focusCard } = ensureHomeExtensionNodes();
    if (!quickBar || !focusCard) {
      return;
    }

    renderHomeQuickBar(quickBar);
    renderHomeFocusCard(focusCard);
    renderModuleCardSnapshots();
    updateSyncBadges();
  }

  function updateSyncBadges() {
    const syncLabel = getSyncLabel();
    document.querySelectorAll("[data-lifehub-sync-status]").forEach((node) => {
      node.textContent = syncLabel.text;
      node.dataset.syncMode = syncLabel.mode;
    });
  }

  function showPage(page) {
    ["tmpRecords", "tmpSettings"].forEach((id) => {
      const node = document.getElementById(id);
      if (node) {
        node.remove();
      }
    });

    document.querySelectorAll('[id^="page"]').forEach((node) => {
      node.classList.add("hide");
    });

    const target = document.getElementById(`page${page.charAt(0).toUpperCase()}${page.slice(1)}`);
    if (target) {
      target.classList.remove("hide");
    }

    document.querySelectorAll("#bottomNav button").forEach((button) => {
      button.classList.toggle("active", button.dataset.page === page || (page === "home" && button.dataset.page === "home"));
    });

    if (page === "home" && originalRenderHome) {
      originalRenderHome();
      renderHomeEnhancements();
      return;
    }

    if (page === "fitness" && typeof window.renderFitness === "function") {
      window.renderFitness();
      return;
    }

    if (page === "circumference" && typeof window.renderCircumference === "function") {
      window.renderCircumference();
      return;
    }

    if (page === "photos" && typeof window.renderPhotoGallery === "function") {
      window.renderPhotoGallery();
      return;
    }

    if (MODULE_KEYS.includes(page)) {
      renderModulePage(page);
    }
  }

  function refreshShell(moduleKey, options) {
    const nextOptions = options || {};
    const visibleModule = getVisibleModuleKey();
    if (moduleKey && visibleModule === moduleKey && nextOptions.rerenderCurrentModule !== false) {
      renderModulePage(moduleKey);
    } else if (moduleKey) {
      updateVisibleModuleMeta(moduleKey);
    }

    if (isHomeVisible()) {
      renderHomeEnhancements();
    } else {
      renderModuleCardSnapshots();
      updateSyncBadges();
    }
  }

  function getVisibleModuleKey() {
    return MODULE_KEYS.find((moduleKey) => {
      const node = document.getElementById(MODULE_PAGE_IDS[moduleKey]);
      return node && !node.classList.contains("hide");
    }) || "";
  }

  function isHomeVisible() {
    const pageHome = document.getElementById("pageHome");
    return Boolean(pageHome && !pageHome.classList.contains("hide"));
  }

  function openLastPage() {
    const lastPage = getLastVisitedPage();
    const nextPage = lastPage || "fitness";
    window.navTo(nextPage);
  }

  function addTask(moduleKey) {
    const input = document.querySelector(`[data-lifehub-new-task="${moduleKey}"]`);
    if (!input) {
      return;
    }

    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }

    updateModuleState(moduleKey, (moduleState) => {
      moduleState.tasks.unshift({
        id: `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        text,
        done: false
      });
      return moduleState;
    });
  }

  function handleInput(event) {
    const field = event.target.closest("[data-lifehub-field]");
    if (!field) {
      return;
    }

    const moduleKey = field.dataset.lifehubModule;
    const property = field.dataset.lifehubField;
    if (!MODULE_KEYS.includes(moduleKey) || !property) {
      return;
    }

    updateModuleState(moduleKey, (moduleState) => {
      moduleState[property] = field.value;
      return moduleState;
    }, {
      rerenderCurrentModule: false
    });
  }

  function handleClick(event) {
    const openLastButton = event.target.closest("[data-lifehub-open-last]");
    if (openLastButton) {
      openLastPage();
      return;
    }

    const openModuleButton = event.target.closest("[data-lifehub-open-module]");
    if (openModuleButton) {
      window.navTo(openModuleButton.dataset.lifehubOpenModule);
      return;
    }

    const addTaskButton = event.target.closest("[data-lifehub-add-task]");
    if (addTaskButton) {
      addTask(addTaskButton.dataset.lifehubAddTask);
      return;
    }

    const toggleTaskButton = event.target.closest("[data-lifehub-toggle-task]");
    if (toggleTaskButton) {
      const moduleKey = toggleTaskButton.dataset.lifehubToggleTask;
      const taskId = toggleTaskButton.dataset.taskId;
      updateModuleState(moduleKey, (moduleState) => {
        moduleState.tasks = moduleState.tasks.map((task) => {
          if (task.id !== taskId) {
            return task;
          }
          return {
            ...task,
            done: !task.done
          };
        });
        return moduleState;
      });
      return;
    }

    const deleteTaskButton = event.target.closest("[data-lifehub-delete-task]");
    if (deleteTaskButton) {
      const moduleKey = deleteTaskButton.dataset.lifehubDeleteTask;
      const taskId = deleteTaskButton.dataset.taskId;
      updateModuleState(moduleKey, (moduleState) => {
        moduleState.tasks = moduleState.tasks.filter((task) => task.id !== taskId);
        return moduleState;
      });
    }
  }

  function handleKeydown(event) {
    const input = event.target.closest("[data-lifehub-new-task]");
    if (!input || event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    addTask(input.dataset.lifehubNewTask);
  }

  function handleStorage(event) {
    if (event.key !== STORAGE_KEY) {
      return;
    }

    const visibleModule = getVisibleModuleKey();
    if (visibleModule) {
      renderModulePage(visibleModule);
    }
    renderHomeEnhancements();
  }

  function handleSyncStatus(event) {
    const detail = event.detail || {};
    syncState.mode = String(detail.mode || "checking");
    syncState.savedAt = String(detail.savedAt || "");
    updateSyncBadges();
    if (isHomeVisible()) {
      renderHomeEnhancements();
    }
  }

  function handleRemoteStateUpdate() {
    const visibleModule = getVisibleModuleKey();
    if (visibleModule) {
      renderModulePage(visibleModule);
    }
    renderHomeEnhancements();
  }

  function installNavigation() {
    window.navTo = function (page) {
      const nextPage = String(page || "home");
      if (nextPage !== "home") {
        setLastVisitedPage(nextPage);
      }
      setHashForPage(nextPage);
      showPage(nextPage);
    };
  }

  function openInitialPage() {
    const hashPage = String(window.location.hash || "").replace(/^#/, "");
    const allowedPages = new Set(["home", "fitness", "circumference", "photos", ...MODULE_KEYS]);
    if (hashPage && allowedPages.has(hashPage)) {
      showPage(hashPage);
      return;
    }

    renderHomeEnhancements();
  }

  function bootstrap() {
    injectStyles();
    saveHubState(loadHubState());

    for (const moduleKey of MODULE_KEYS) {
      renderModulePage(moduleKey);
    }

    installNavigation();
    document.addEventListener("input", handleInput);
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeydown);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("life-hub-sync-status", handleSyncStatus);
    window.addEventListener("life-hub-state-updated", handleRemoteStateUpdate);
    openInitialPage();
  }

  bootstrap();
})();
