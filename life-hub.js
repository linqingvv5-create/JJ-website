(function () {
  const STORAGE_KEY = "jj_life_hub_state_v1";
  const MODULE_KEYS = ["growth", "hobby", "money", "creator", "work"];
  const IDEA_TAGS = ["fitness", ...MODULE_KEYS];
  const MODULE_PAGE_IDS = {
    growth: "pageGrowth",
    hobby: "pageHobby",
    money: "pageMoney",
    creator: "pageCreator",
    work: "pageWork",
  };
  const MODULE_CONFIG = {
    fitness: {
      icon: "💪",
      title: "健身",
      shortTitle: "健身",
      subtitle: "训练、饮食、体态",
    },
    growth: {
      icon: "🌱",
      title: "成长",
      shortTitle: "成长",
      subtitle: "读书、技能、复盘",
      focusPlaceholder: "最近最想推进什么？",
      stepPlaceholder: "下一步先做哪一个最小动作",
      notePlaceholder: "记录读书摘录、学习卡点、技能计划、复盘想法。",
      taskPlaceholder: "加一条成长待办",
      emptyText: "先写一句主线或加一条待办，后面我们再慢慢细化。",
    },
    hobby: {
      icon: "🎨",
      title: "兴趣",
      shortTitle: "兴趣",
      subtitle: "手工、收藏、探索",
      focusPlaceholder: "最近最想玩的兴趣方向",
      stepPlaceholder: "下一步准备做什么",
      notePlaceholder: "记录灵感、材料清单、想买的器材、想去看的展。",
      taskPlaceholder: "加一条兴趣待办",
      emptyText: "这里适合先堆灵感，后面想展开的时候我们再拆细。",
    },
    money: {
      icon: "💰",
      title: "赚钱项目",
      shortTitle: "赚钱",
      subtitle: "量化、副业、投资",
      focusPlaceholder: "当前最重要的赚钱方向",
      stepPlaceholder: "今天或明天先推进哪一步",
      notePlaceholder: "记录副业想法、收入目标、项目验证、投资观察。",
      taskPlaceholder: "加一条赚钱待办",
      emptyText: "交易看板管具体持仓，这里更适合放项目想法和副业推进。",
    },
    creator: {
      icon: "📸",
      title: "博主",
      shortTitle: "博主",
      subtitle: "内容、选题、涨粉",
      focusPlaceholder: "最近最想发的内容主题",
      stepPlaceholder: "下一步是写、拍还是发",
      notePlaceholder: "记录选题、标题、脚本碎片、数据观察和内容方向。",
      taskPlaceholder: "加一条内容待办",
      emptyText: "先把内容灵感接住，后面再继续做日历和数据页。",
    },
    work: {
      icon: "💼",
      title: "工作",
      shortTitle: "工作",
      subtitle: "任务、日程、效率",
      focusPlaceholder: "今天工作的主线是什么",
      stepPlaceholder: "下一步先推进什么",
      notePlaceholder: "记录待办、沟通提醒、卡点、临时想法和流程优化。",
      taskPlaceholder: "加一条工作待办",
      emptyText: "工作页先保持轻量，保证你打开就能马上记、马上勾。",
    },
  };

  const originalRenderHome = typeof window.renderHome === "function" ? window.renderHome : null;
  const selectedIdeaTags = new Set();
  const homeDraft = {
    todayPlan: "",
    ideaText: "",
    ideaNote: "",
  };
  const ideaLibraryState = {
    sort: "pending",
    tag: "all",
  };
  const syncState = {
    mode: "checking",
    savedAt: "",
  };

  function injectStyles() {
    if (document.getElementById("lifeHubStyles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "lifeHubStyles";
    style.textContent = `
      html, body {
        overflow-x: hidden;
      }

      body {
        padding-top: env(safe-area-inset-top);
        padding-bottom: calc(28px + env(safe-area-inset-bottom));
        overscroll-behavior-y: contain;
      }

      .bottom-nav {
        display: none !important;
      }

      .home-header {
        text-align: left;
        padding: calc(22px + env(safe-area-inset-top)) 16px 6px;
      }

      .home-header .quote {
        display: none;
      }

      .wake-btn {
        display: none !important;
      }

      .home-dashboard {
        display: grid;
        gap: 12px;
        padding: 10px 16px 16px;
      }

      .home-board-card,
      .life-module-panel,
      .life-module-hero,
      .life-task-item,
      .idea-item {
        border: 1px solid var(--bd);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16);
      }

      .home-board-card,
      .life-module-panel,
      .life-module-hero {
        border-radius: 18px;
        background: linear-gradient(145deg, rgba(24, 24, 36, 0.98), rgba(14, 14, 22, 0.98));
      }

      .home-board-card {
        padding: 16px;
      }

      .home-board-head,
      .life-module-panel-head,
      .life-module-hero-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
      }

      .home-board-head h2,
      .life-module-panel h2,
      .life-module-hero h1 {
        margin: 0;
      }

      .home-board-head h2,
      .life-module-panel h2 {
        font-size: 16px;
      }

      .home-board-meta,
      .life-module-panel-head span,
      .life-module-help,
      .life-module-updated,
      .life-module-hero p,
      .today-plan-empty,
      .idea-empty,
      .home-helper {
        color: var(--mt);
        font-size: 12px;
        line-height: 1.6;
      }

      .home-sync-pill,
      .life-module-sync {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 28px;
        padding: 5px 10px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
        background: rgba(92, 201, 232, 0.14);
        color: var(--ac2);
      }

      .home-sync-pill[data-sync-mode="online"],
      .life-module-sync[data-sync-mode="online"] {
        background: rgba(62, 207, 142, 0.14);
        color: var(--done);
      }

      .home-sync-pill[data-sync-mode="offline"],
      .life-module-sync[data-sync-mode="offline"] {
        background: rgba(245, 166, 35, 0.14);
        color: var(--warn);
      }

      .today-plan-creator,
      .idea-creator {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        margin-bottom: 12px;
      }

      .today-plan-input,
      .idea-input,
      .life-module-input,
      .life-module-task-input,
      .idea-notes-input,
      .life-module-textarea {
        width: 100%;
        border: 1px solid var(--bd);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        color: var(--txt);
      }

      .today-plan-input,
      .idea-input,
      .life-module-input,
      .life-module-task-input {
        min-height: 46px;
        padding: 12px 14px;
      }

      .idea-notes-input,
      .life-module-textarea {
        min-height: 110px;
        padding: 14px;
        resize: vertical;
      }

      .today-plan-add,
      .idea-add,
      .life-module-task-button,
      .life-module-primary-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 46px;
        padding: 0 16px;
        border: none;
        border-radius: 14px;
        background: linear-gradient(135deg, #f0b050, #e8745c);
        color: #fff;
        font-size: 14px;
        font-weight: 700;
        text-decoration: none;
        white-space: nowrap;
      }

      .life-module-primary-link.money-link {
        background: linear-gradient(135deg, #2563eb, #0f766e);
      }

      .idea-composer {
        display: grid;
        gap: 10px;
        margin-bottom: 12px;
      }

      .tag-picker,
      .idea-tag-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .tag-chip {
        min-height: 34px;
        padding: 0 12px;
        border-radius: 999px;
        border: 1px solid var(--bd);
        background: rgba(255, 255, 255, 0.04);
        color: var(--mt);
        font-size: 12px;
        font-weight: 700;
      }

      .tag-chip.is-selected {
        background: rgba(92, 201, 232, 0.16);
        border-color: rgba(92, 201, 232, 0.38);
        color: var(--ac2);
      }

      .home-list,
      .life-module-task-list,
      .related-idea-list {
        display: grid;
        gap: 10px;
      }

      .life-task-item,
      .idea-item {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 10px;
        align-items: start;
        padding: 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.03);
      }

      .life-task-item.is-done,
      .idea-item.is-done {
        opacity: 0.68;
      }

      .life-task-toggle,
      .idea-toggle {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2px solid var(--bd);
        background: transparent;
        color: #fff;
        font-size: 11px;
      }

      .life-task-item.is-done .life-task-toggle,
      .idea-item.is-done .idea-toggle {
        border-color: var(--done);
        background: var(--done);
      }

      .life-task-delete,
      .idea-delete {
        min-width: 34px;
        min-height: 34px;
        border-radius: 10px;
        border: 1px solid var(--bd);
        background: rgba(255, 255, 255, 0.04);
        color: var(--mt);
      }

      .life-task-text,
      .idea-text {
        font-size: 14px;
        line-height: 1.5;
      }

      .life-task-item.is-done .life-task-text,
      .idea-item.is-done .idea-text {
        color: var(--mt);
        text-decoration: line-through;
      }

      .idea-text {
        white-space: pre-wrap;
        word-break: break-word;
      }

      .idea-meta {
        margin-top: 8px;
        display: grid;
        gap: 8px;
      }

      .idea-notes {
        font-size: 12px;
        color: var(--mt);
        white-space: pre-wrap;
        word-break: break-word;
      }

      .idea-meta-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }

      .idea-time {
        font-size: 11px;
        color: var(--mt);
      }

      .idea-tag {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 0 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: var(--txt);
        font-size: 11px;
        font-weight: 700;
      }

      .idea-archive-toolbar {
        display: grid;
        gap: 10px;
        margin-bottom: 12px;
      }

      .idea-archive-toolbar-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }

      .idea-toolbar-label {
        min-width: 64px;
        font-size: 12px;
        color: var(--mt);
        font-weight: 700;
      }

      .idea-filter-summary {
        font-size: 12px;
        color: var(--mt);
      }

      .life-module-shell {
        padding-bottom: 10px;
      }

      .life-module-shell .back-btn {
        padding-top: calc(12px + env(safe-area-inset-top));
      }

      .life-module-hero {
        padding: 18px;
        margin-bottom: 12px;
      }

      .life-module-kicker {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ac3);
      }

      .life-module-hero h1 {
        text-align: left;
        padding: 0;
        margin-bottom: 6px;
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

      .module-simple-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: stretch;
      }

      .module-simple-grid .mod-card {
        min-height: 96px;
        padding: 16px 14px;
      }

      .module-simple-grid .mod-card .icon {
        margin-bottom: 6px;
      }

      .module-simple-grid .mod-card .sub {
        margin-top: 2px;
        font-size: 11px;
      }

      @media (max-width: 760px) {
        .life-module-two-col {
          grid-template-columns: 1fr;
        }

        .idea-archive-toolbar-row {
          align-items: flex-start;
        }

        .idea-toolbar-label {
          width: 100%;
          min-width: 0;
        }

        .today-plan-creator,
        .idea-creator {
          grid-template-columns: 1fr;
        }

        .today-plan-add,
        .idea-add,
        .life-module-task-button {
          width: 100%;
        }
      }

      @media (max-width: 360px) {
        .module-simple-grid {
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
      updatedAt: "",
    };
  }

  function createDefaultState() {
    const state = {
      todayPlan: [],
      ideas: [],
    };

    for (const moduleKey of MODULE_KEYS) {
      state[moduleKey] = createEmptyModuleState();
    }

    return state;
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
    const text = String(data.text || "").trim();
    return {
      id: String(data.id || "").trim() || `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      text,
      done: Boolean(data.done),
      createdAt: String(data.createdAt || ""),
    };
  }

  function normalizeIdea(idea) {
    const data = idea && typeof idea === "object" ? idea : {};
    const tags = Array.isArray(data.tags)
      ? Array.from(new Set(data.tags.map((tag) => String(tag || "").trim()).filter((tag) => IDEA_TAGS.includes(tag))))
      : [];

    return {
      id: String(data.id || "").trim() || `idea-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      text: String(data.text || "").trim(),
      note: String(data.note || "").trim(),
      tags,
      done: Boolean(data.done),
      createdAt: String(data.createdAt || ""),
    };
  }

  function normalizeTaskList(tasks) {
    return Array.isArray(tasks) ? tasks.map(normalizeTask).filter((task) => task.text) : [];
  }

  function normalizeIdeas(ideas) {
    return Array.isArray(ideas) ? ideas.map(normalizeIdea).filter((idea) => idea.text) : [];
  }

  function normalizeModuleState(rawState) {
    const state = rawState && typeof rawState === "object" ? rawState : {};
    return {
      focus: String(state.focus || ""),
      nextStep: String(state.nextStep || ""),
      notes: String(state.notes || ""),
      tasks: normalizeTaskList(state.tasks),
      updatedAt: String(state.updatedAt || ""),
    };
  }

  function normalizeHubState(rawState) {
    const data = rawState && typeof rawState === "object" ? rawState : {};
    const state = createDefaultState();

    state.todayPlan = normalizeTaskList(data.todayPlan);
    state.ideas = normalizeIdeas(data.ideas);

    for (const moduleKey of MODULE_KEYS) {
      state[moduleKey] = normalizeModuleState(data[moduleKey]);
    }

    return state;
  }

  function loadHubState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return normalizeHubState(raw ? JSON.parse(raw) : null);
    } catch (error) {
      return createDefaultState();
    }
  }

  function saveHubState(nextState) {
    const normalized = normalizeHubState(nextState);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function updateHubState(updater, options) {
    const nextOptions = options || {};
    const currentState = loadHubState();
    const nextState = normalizeHubState(updater(clone(currentState)) || currentState);
    saveHubState(nextState);
    refreshUI(nextOptions);
    return nextState;
  }

  function getModuleState(moduleKey) {
    return loadHubState()[moduleKey] || createEmptyModuleState();
  }

  function getSyncLabel() {
    if (syncState.mode === "online") {
      return {
        mode: "online",
        text: syncState.savedAt ? `云同步 ${syncState.savedAt.slice(11, 16)}` : "云同步已连接",
      };
    }

    if (syncState.mode === "offline") {
      return {
        mode: "offline",
        text: "离线，先保存在本机",
      };
    }

    if (syncState.mode === "syncing") {
      return {
        mode: "syncing",
        text: "正在同步",
      };
    }

    return {
      mode: "checking",
      text: "自动保存中",
    };
  }

  function formatTimeLabel(value) {
    if (!value) {
      return "刚刚创建";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "刚刚创建";
    }

    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function formatModuleUpdatedAt(value) {
    if (!value) {
      return "还没开始写，先记一句当前主线就行。";
    }
    return `最近更新 ${formatTimeLabel(value)}`;
  }

  function countPending(tasks) {
    return (tasks || []).filter((task) => !task.done).length;
  }

  function getTaggedIdeas(tagKey) {
    return loadHubState().ideas.filter((idea) => idea.tags.includes(tagKey));
  }

  function getIdeaTimestamp(idea) {
    const time = new Date(idea && idea.createdAt ? idea.createdAt : "").getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function getIdeaFilterLabel(tag) {
    if (tag === "all") {
      return "全部";
    }
    return MODULE_CONFIG[tag] ? MODULE_CONFIG[tag].shortTitle : tag;
  }

  function getIdeasForLibrary(ideas) {
    const source = Array.isArray(ideas) ? ideas : [];
    const filtered = ideaLibraryState.tag === "all"
      ? [...source]
      : source.filter((idea) => idea.tags.includes(ideaLibraryState.tag));

    if (ideaLibraryState.sort === "latest") {
      return filtered.sort((left, right) => getIdeaTimestamp(right) - getIdeaTimestamp(left));
    }

    if (ideaLibraryState.sort === "oldest") {
      return filtered.sort((left, right) => getIdeaTimestamp(left) - getIdeaTimestamp(right));
    }

    return filtered.sort((left, right) => {
      const doneDiff = Number(left.done) - Number(right.done);
      if (doneDiff !== 0) {
        return doneDiff;
      }
      return getIdeaTimestamp(right) - getIdeaTimestamp(left);
    });
  }

  function getVisibleModuleKey() {
    return MODULE_KEYS.find((moduleKey) => {
      const node = document.getElementById(MODULE_PAGE_IDS[moduleKey]);
      return node && !node.classList.contains("hide");
    }) || "";
  }

  function isHomeVisible() {
    const node = document.getElementById("pageHome");
    return Boolean(node && !node.classList.contains("hide"));
  }

  function ensureHomeNodes() {
    const header = document.querySelector(".home-header");
    const grid = document.querySelector(".grid");
    if (!header || !grid) {
      return {};
    }

    grid.classList.add("module-simple-grid");

    let dashboard = document.getElementById("homeDashboard");
    if (!dashboard) {
      dashboard = document.createElement("div");
      dashboard.id = "homeDashboard";
      dashboard.className = "home-dashboard";
    }

    if (grid.nextElementSibling !== dashboard) {
      grid.insertAdjacentElement("afterend", dashboard);
    }

    return { dashboard, grid };
  }

  function renderTodayPlanSection(tasks) {
    const syncLabel = getSyncLabel();
    const sortedTasks = [...tasks].sort((left, right) => Number(left.done) - Number(right.done));

    return `
      <section class="home-board-card">
        <div class="home-board-head">
          <div>
            <h2>今日安排</h2>
            <div class="home-board-meta">${countPending(tasks) ? `${countPending(tasks)} 项待完成` : "今天想做的事先记在这里"}</div>
          </div>
          <span class="home-sync-pill" data-lifehub-sync-status data-sync-mode="${escapeHtml(syncLabel.mode)}">${escapeHtml(syncLabel.text)}</span>
        </div>
        <div class="today-plan-creator">
          <input class="today-plan-input" type="text" id="todayPlanInput" placeholder="加一条今天要做的事" value="${escapeHtml(homeDraft.todayPlan)}">
          <button class="today-plan-add" type="button" data-home-action="add-today-plan">添加</button>
        </div>
        <div class="home-list">
          ${sortedTasks.length ? sortedTasks.map((task) => `
            <div class="life-task-item${task.done ? " is-done" : ""}">
              <button class="life-task-toggle" type="button" data-home-action="toggle-today-plan" data-item-id="${escapeHtml(task.id)}">${task.done ? "✓" : ""}</button>
              <div class="life-task-text">${escapeHtml(task.text)}</div>
              <button class="life-task-delete" type="button" data-home-action="delete-today-plan" data-item-id="${escapeHtml(task.id)}">✕</button>
            </div>
          `).join("") : `
            <div class="today-plan-empty">不用复杂计划，想到什么就先写一条，完成后直接打勾。</div>
          `}
        </div>
      </section>
    `;
  }

  function renderIdeaItem(idea, contextTag) {
    const displayTags = idea.tags.map((tag) => MODULE_CONFIG[tag]).filter(Boolean);
    return `
      <div class="idea-item${idea.done ? " is-done" : ""}">
        <button class="idea-toggle" type="button" data-home-action="toggle-idea" data-item-id="${escapeHtml(idea.id)}">${idea.done ? "✓" : ""}</button>
        <div>
          <div class="idea-text">${escapeHtml(idea.text)}</div>
          <div class="idea-meta">
            ${idea.note ? `<div class="idea-notes">${escapeHtml(idea.note)}</div>` : ""}
            <div class="idea-meta-bar">
              <div class="idea-tag-list">
                ${displayTags.map((tag) => `
                  <span class="idea-tag">${tag.icon} ${tag.shortTitle}</span>
                `).join("")}
              </div>
              <div class="idea-time">${contextTag ? `归到 ${MODULE_CONFIG[contextTag].title}` : formatTimeLabel(idea.createdAt)}</div>
            </div>
          </div>
        </div>
        <button class="idea-delete" type="button" data-home-action="delete-idea" data-item-id="${escapeHtml(idea.id)}">✕</button>
      </div>
    `;
  }

  function renderIdeaComposerSection(ideas) {
    const pendingCount = countPending(ideas);
    const selectedTags = IDEA_TAGS.filter((tag) => selectedIdeaTags.has(tag));

    return `
      <section class="home-board-card">
        <div class="home-board-head">
          <div>
            <h2>灵感随记</h2>
            <div class="home-board-meta">${pendingCount ? `${pendingCount} 条还在推进` : "想到就记，保存后会进入下面的灵感库"}</div>
          </div>
        </div>

        <div class="idea-composer">
          <input class="idea-input" type="text" id="ideaTextInput" placeholder="一句话先记下来" value="${escapeHtml(homeDraft.ideaText)}">
          <textarea class="idea-notes-input" id="ideaNoteInput" placeholder="补充背景、步骤、细节都可以（可空）">${escapeHtml(homeDraft.ideaNote)}</textarea>
          <div class="tag-picker">
            ${IDEA_TAGS.map((tag) => `
              <button
                class="tag-chip${selectedIdeaTags.has(tag) ? " is-selected" : ""}"
                type="button"
                data-home-action="toggle-idea-tag"
                data-tag="${tag}"
              >${MODULE_CONFIG[tag].icon} ${MODULE_CONFIG[tag].shortTitle}</button>
            `).join("")}
          </div>
          <div class="home-helper">可以多选标签，比如同一条灵感同时归到健身和博主。</div>
          <div class="idea-creator">
            <div class="home-helper">${selectedTags.length ? `当前标签：${selectedTags.map((tag) => MODULE_CONFIG[tag].shortTitle).join("、")}` : "至少选一个标签再保存"}</div>
            <button class="idea-add" type="button" data-home-action="add-idea">保存灵感</button>
          </div>
          <div class="home-helper">保存后会进入下面的“灵感库”，你可以按标签、时间和完成状态慢慢整理。</div>
        </div>
      </section>
    `;
  }

  function renderIdeaArchiveSection(ideas) {
    const filteredIdeas = getIdeasForLibrary(ideas);
    const pendingCount = countPending(filteredIdeas);
    const currentTagLabel = getIdeaFilterLabel(ideaLibraryState.tag);
    const sortLabel = ideaLibraryState.sort === "pending"
      ? "未完成优先"
      : ideaLibraryState.sort === "latest"
        ? "最新优先"
        : "最早优先";

    return `
      <section class="home-board-card">
        <div class="home-board-head">
          <div>
            <h2>灵感库</h2>
            <div class="home-board-meta">${filteredIdeas.length ? `${filteredIdeas.length} 条，${pendingCount} 条未完成` : "这里会完整保存你写过的灵感"}</div>
          </div>
        </div>

        <div class="idea-archive-toolbar">
          <div class="idea-archive-toolbar-row">
            <span class="idea-toolbar-label">排序</span>
            <button class="tag-chip${ideaLibraryState.sort === "pending" ? " is-selected" : ""}" type="button" data-home-action="set-idea-sort" data-sort="pending">未完成优先</button>
            <button class="tag-chip${ideaLibraryState.sort === "latest" ? " is-selected" : ""}" type="button" data-home-action="set-idea-sort" data-sort="latest">最新优先</button>
            <button class="tag-chip${ideaLibraryState.sort === "oldest" ? " is-selected" : ""}" type="button" data-home-action="set-idea-sort" data-sort="oldest">最早优先</button>
          </div>
          <div class="idea-archive-toolbar-row">
            <span class="idea-toolbar-label">标签</span>
            <button class="tag-chip${ideaLibraryState.tag === "all" ? " is-selected" : ""}" type="button" data-home-action="set-idea-filter" data-tag="all">全部</button>
            ${IDEA_TAGS.map((tag) => `
              <button class="tag-chip${ideaLibraryState.tag === tag ? " is-selected" : ""}" type="button" data-home-action="set-idea-filter" data-tag="${tag}">
                ${MODULE_CONFIG[tag].icon} ${MODULE_CONFIG[tag].shortTitle}
              </button>
            `).join("")}
          </div>
          <div class="idea-filter-summary">当前查看：${currentTagLabel} · ${sortLabel}</div>
        </div>

        <div class="home-list">
          ${filteredIdeas.length ? filteredIdeas.map((idea) => renderIdeaItem(idea, "")).join("") : `
            <div class="idea-empty">这个筛选条件下还没有内容，换个标签看看，或者先保存一条新的灵感。</div>
          `}
        </div>
      </section>
    `;
  }

  function renderIdeaSection(ideas) {
    return `${renderIdeaComposerSection(ideas)}${renderIdeaArchiveSection(ideas)}`;
  }

  function renderHomeEnhancements() {
    const { dashboard } = ensureHomeNodes();
    if (!dashboard) {
      return;
    }

    const state = loadHubState();
    dashboard.innerHTML = `
      ${renderTodayPlanSection(state.todayPlan)}
      ${renderIdeaSection(state.ideas)}
    `;
  }

  function renderRelatedIdeasSection(moduleKey) {
    const ideas = getTaggedIdeas(moduleKey).sort((left, right) => Number(left.done) - Number(right.done));

    return `
      <section class="life-module-panel">
        <div class="life-module-panel-head">
          <h2>关联灵感</h2>
          <span>${ideas.length ? `${countPending(ideas)} 条还在推进` : "还没有归档到这里的灵感"}</span>
        </div>
        <div class="related-idea-list">
          ${ideas.length ? ideas.map((idea) => renderIdeaItem(idea, moduleKey)).join("") : `
            <div class="idea-empty">回首页的“灵感随记”里写下来，再勾选这个模块标签，这里就会自动出现。</div>
          `}
        </div>
      </section>
    `;
  }

  function renderModulePage(moduleKey) {
    const host = document.getElementById(MODULE_PAGE_IDS[moduleKey]);
    const config = MODULE_CONFIG[moduleKey];
    if (!host || !config) {
      return;
    }

    const moduleState = getModuleState(moduleKey);
    const syncLabel = getSyncLabel();
    const pendingCount = countPending(moduleState.tasks);

    host.innerHTML = `
      <div class="life-module-shell">
        <button class="back-btn" onclick="navTo('home')">← 首页</button>
        <div class="page">
          <section class="life-module-hero">
            <div class="life-module-hero-top">
              <span class="life-module-kicker">Simple Workspace</span>
              <span class="life-module-sync" data-lifehub-sync-status data-sync-mode="${escapeHtml(syncLabel.mode)}">${escapeHtml(syncLabel.text)}</span>
            </div>
            <h1>${config.icon} ${config.title}</h1>
            <p>${config.subtitle}</p>
            <p class="life-module-updated">${escapeHtml(formatModuleUpdatedAt(moduleState.updatedAt))}</p>
          </section>

          ${moduleKey === "money" ? `
            <section class="life-module-panel">
              <div class="life-module-panel-head">
                <h2>交易看板</h2>
                <span>账户和持仓继续在这里维护</span>
              </div>
              <a class="life-module-primary-link money-link" href="finance.html">打开交易看板</a>
            </section>
          ` : ""}

          <div class="life-module-grid">
            <div class="life-module-two-col">
              <section class="life-module-panel">
                <div class="life-module-panel-head">
                  <h2>当前主线</h2>
                  <span>打开先看这句</span>
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
                  <h2>下一步</h2>
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
                <h2>模块笔记</h2>
                <span>自动保存</span>
              </div>
              <textarea
                class="life-module-textarea"
                data-lifehub-module="${moduleKey}"
                data-lifehub-field="notes"
                placeholder="${escapeHtml(config.notePlaceholder)}"
              >${escapeHtml(moduleState.notes)}</textarea>
              <p class="life-module-help" style="margin-top:10px;">${config.emptyText}</p>
            </section>

            <section class="life-module-panel">
              <div class="life-module-panel-head">
                <h2>模块待办</h2>
                <span>${pendingCount ? `${pendingCount} 项未完成` : "空着也没关系"}</span>
              </div>
              <div class="today-plan-creator">
                <input
                  class="life-module-task-input"
                  type="text"
                  data-lifehub-new-task="${moduleKey}"
                  placeholder="${escapeHtml(config.taskPlaceholder)}"
                >
                <button class="life-module-task-button" type="button" data-lifehub-add-task="${moduleKey}">添加</button>
              </div>
              <div class="life-module-task-list">
                ${moduleState.tasks.length ? [...moduleState.tasks].sort((left, right) => Number(left.done) - Number(right.done)).map((task) => `
                  <div class="life-task-item${task.done ? " is-done" : ""}">
                    <button class="life-task-toggle" type="button" data-lifehub-toggle-task="${moduleKey}" data-item-id="${escapeHtml(task.id)}">${task.done ? "✓" : ""}</button>
                    <div class="life-task-text">${escapeHtml(task.text)}</div>
                    <button class="life-task-delete" type="button" data-lifehub-delete-task="${moduleKey}" data-item-id="${escapeHtml(task.id)}">✕</button>
                  </div>
                `).join("") : `
                  <div class="today-plan-empty">${config.emptyText}</div>
                `}
              </div>
            </section>

            ${renderRelatedIdeasSection(moduleKey)}
          </div>
        </div>
      </div>
    `;
  }

  function ensureFitnessIdeaPanel() {
    const page = document.getElementById("pageFitness");
    if (!page) {
      return null;
    }

    let panel = document.getElementById("fitnessIdeaPanel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "fitnessIdeaPanel";
      panel.className = "page";
      page.appendChild(panel);
    }

    return panel;
  }

  function renderFitnessIdeaPanel() {
    const panel = ensureFitnessIdeaPanel();
    if (!panel) {
      return;
    }

    const ideas = getTaggedIdeas("fitness").sort((left, right) => Number(left.done) - Number(right.done));
    panel.innerHTML = `
      <section class="life-module-panel" style="margin-top:12px;">
        <div class="life-module-panel-head">
          <h2>健身灵感</h2>
          <span>${ideas.length ? `${countPending(ideas)} 条还在推进` : "还没有关联到健身的灵感"}</span>
        </div>
        <div class="related-idea-list">
          ${ideas.length ? ideas.map((idea) => renderIdeaItem(idea, "fitness")).join("") : `
            <div class="idea-empty">首页“灵感随记”里勾选健身标签，这里就会自动同步出现。</div>
          `}
        </div>
      </section>
    `;
  }

  function refreshSyncBadges() {
    const syncLabel = getSyncLabel();
    document.querySelectorAll("[data-lifehub-sync-status]").forEach((node) => {
      node.textContent = syncLabel.text;
      node.dataset.syncMode = syncLabel.mode;
    });
  }

  function refreshUI(options) {
    const nextOptions = options || {};
    if (!nextOptions.skipHome && isHomeVisible()) {
      renderHomeEnhancements();
    }

    const visibleModule = getVisibleModuleKey();
    if (visibleModule && !nextOptions.skipModuleRender) {
      renderModulePage(visibleModule);
    }

    const fitnessVisible = document.getElementById("pageFitness") && !document.getElementById("pageFitness").classList.contains("hide");
    if (fitnessVisible || nextOptions.refreshFitnessPanel) {
      renderFitnessIdeaPanel();
    }

    refreshSyncBadges();
  }

  function toggleSelectedIdeaTag(tag) {
    if (selectedIdeaTags.has(tag)) {
      selectedIdeaTags.delete(tag);
    } else {
      selectedIdeaTags.add(tag);
    }

    if (isHomeVisible()) {
      renderHomeEnhancements();
    }
  }

  function addTodayPlan() {
    const input = document.getElementById("todayPlanInput");
    if (!input) {
      return;
    }

    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }

    homeDraft.todayPlan = "";
    updateHubState((state) => {
      state.todayPlan.unshift({
        id: `today-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        text,
        done: false,
        createdAt: new Date().toISOString(),
      });
      return state;
    }, {
      refreshFitnessPanel: true,
    });
    window.requestAnimationFrame(() => {
      document.getElementById("todayPlanInput")?.focus();
    });
  }

  function addIdea() {
    const textInput = document.getElementById("ideaTextInput");
    const noteInput = document.getElementById("ideaNoteInput");
    if (!textInput || !noteInput) {
      return;
    }

    const text = textInput.value.trim();
    if (!text) {
      textInput.focus();
      return;
    }

    const tags = IDEA_TAGS.filter((tag) => selectedIdeaTags.has(tag));
    if (!tags.length) {
      window.alert("至少选一个标签再保存。");
      return;
    }

    homeDraft.ideaText = "";
    homeDraft.ideaNote = "";
    selectedIdeaTags.clear();
    updateHubState((state) => {
      state.ideas.unshift({
        id: `idea-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        text,
        note: noteInput.value.trim(),
        tags,
        done: false,
        createdAt: new Date().toISOString(),
      });
      return state;
    }, {
      refreshFitnessPanel: tags.includes("fitness"),
    });
    window.requestAnimationFrame(() => {
      document.getElementById("ideaTextInput")?.focus();
    });
  }

  function addModuleTask(moduleKey) {
    const input = document.querySelector(`[data-lifehub-new-task="${moduleKey}"]`);
    if (!input) {
      return;
    }

    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }

    updateHubState((state) => {
      state[moduleKey].tasks.unshift({
        id: `module-task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        text,
        done: false,
        createdAt: new Date().toISOString(),
      });
      state[moduleKey].updatedAt = new Date().toISOString();
      return state;
    });
  }

  function handleModuleInput(event) {
    if (event.target.id === "todayPlanInput") {
      homeDraft.todayPlan = event.target.value;
      return;
    }

    if (event.target.id === "ideaTextInput") {
      homeDraft.ideaText = event.target.value;
      return;
    }

    if (event.target.id === "ideaNoteInput") {
      homeDraft.ideaNote = event.target.value;
      return;
    }

    const field = event.target.closest("[data-lifehub-field]");
    if (!field) {
      return;
    }

    const moduleKey = field.dataset.lifehubModule;
    const property = field.dataset.lifehubField;
    if (!MODULE_KEYS.includes(moduleKey) || !property) {
      return;
    }

    updateHubState((state) => {
      state[moduleKey][property] = field.value;
      state[moduleKey].updatedAt = new Date().toISOString();
      return state;
    }, {
      skipModuleRender: true,
      refreshFitnessPanel: moduleKey === "fitness",
    });
  }

  function handleHomeAction(action, itemId, tag) {
    if (action === "add-today-plan") {
      addTodayPlan();
      return;
    }

    if (action === "add-idea") {
      addIdea();
      return;
    }

    if (action === "toggle-idea-tag" && tag) {
      toggleSelectedIdeaTag(tag);
      return;
    }

    if (action === "set-idea-sort") {
      ideaLibraryState.sort = tag || itemId || "pending";
      if (isHomeVisible()) {
        renderHomeEnhancements();
      }
      return;
    }

    if (action === "set-idea-filter") {
      ideaLibraryState.tag = tag || "all";
      if (isHomeVisible()) {
        renderHomeEnhancements();
      }
      return;
    }

    if (action === "toggle-today-plan" && itemId) {
      updateHubState((state) => {
        state.todayPlan = state.todayPlan.map((task) => task.id === itemId ? { ...task, done: !task.done } : task);
        return state;
      });
      return;
    }

    if (action === "delete-today-plan" && itemId) {
      updateHubState((state) => {
        state.todayPlan = state.todayPlan.filter((task) => task.id !== itemId);
        return state;
      });
      return;
    }

    if (action === "toggle-idea" && itemId) {
      updateHubState((state) => {
        state.ideas = state.ideas.map((idea) => idea.id === itemId ? { ...idea, done: !idea.done } : idea);
        return state;
      }, {
        refreshFitnessPanel: true,
      });
      return;
    }

    if (action === "delete-idea" && itemId) {
      updateHubState((state) => {
        state.ideas = state.ideas.filter((idea) => idea.id !== itemId);
        return state;
      }, {
        refreshFitnessPanel: true,
      });
    }
  }

  function handleTaskAction(action, moduleKey, itemId) {
    if (!MODULE_KEYS.includes(moduleKey)) {
      return;
    }

    if (action === "add-task") {
      addModuleTask(moduleKey);
      return;
    }

    if (action === "toggle-task" && itemId) {
      updateHubState((state) => {
        state[moduleKey].tasks = state[moduleKey].tasks.map((task) => task.id === itemId ? { ...task, done: !task.done } : task);
        state[moduleKey].updatedAt = new Date().toISOString();
        return state;
      });
      return;
    }

    if (action === "delete-task" && itemId) {
      updateHubState((state) => {
        state[moduleKey].tasks = state[moduleKey].tasks.filter((task) => task.id !== itemId);
        state[moduleKey].updatedAt = new Date().toISOString();
        return state;
      });
    }
  }

  function handleClick(event) {
    const actionNode = event.target.closest("[data-home-action]");
    if (actionNode) {
      handleHomeAction(
        actionNode.dataset.homeAction,
        actionNode.dataset.itemId,
        actionNode.dataset.tag || actionNode.dataset.sort
      );
      return;
    }

    const openModuleNode = event.target.closest("[data-home-open-module]");
    if (openModuleNode) {
      window.navTo(openModuleNode.dataset.homeOpenModule);
      return;
    }

    const addTaskNode = event.target.closest("[data-lifehub-add-task]");
    if (addTaskNode) {
      handleTaskAction("add-task", addTaskNode.dataset.lifehubAddTask, "");
      return;
    }

    const toggleTaskNode = event.target.closest("[data-lifehub-toggle-task]");
    if (toggleTaskNode) {
      handleTaskAction("toggle-task", toggleTaskNode.dataset.lifehubToggleTask, toggleTaskNode.dataset.itemId);
      return;
    }

    const deleteTaskNode = event.target.closest("[data-lifehub-delete-task]");
    if (deleteTaskNode) {
      handleTaskAction("delete-task", deleteTaskNode.dataset.lifehubDeleteTask, deleteTaskNode.dataset.itemId);
    }
  }

  function handleKeydown(event) {
    if (event.key !== "Enter") {
      return;
    }

    const todayInput = event.target.closest("#todayPlanInput");
    if (todayInput) {
      event.preventDefault();
      addTodayPlan();
      return;
    }

    const ideaInput = event.target.closest("#ideaTextInput");
    if (ideaInput) {
      event.preventDefault();
      addIdea();
      return;
    }

    const moduleInput = event.target.closest("[data-lifehub-new-task]");
    if (moduleInput) {
      event.preventDefault();
      addModuleTask(moduleInput.dataset.lifehubNewTask);
    }
  }

  function handleStorage(event) {
    if (event.key !== STORAGE_KEY) {
      return;
    }

    refreshUI({
      refreshFitnessPanel: true,
    });
  }

  function handleSyncStatus(event) {
    const detail = event.detail || {};
    syncState.mode = String(detail.mode || "checking");
    syncState.savedAt = String(detail.savedAt || "");
    refreshSyncBadges();
  }

  function handleRemoteStateUpdate() {
    refreshUI({
      refreshFitnessPanel: true,
    });
  }

  function renderHome() {
    if (originalRenderHome) {
      originalRenderHome();
    }
    renderHomeEnhancements();
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

    if (page === "home") {
      renderHome();
      return;
    }

    if (page === "money") {
      window.location.href = "finance.html";
      return;
    }

    if (page === "fitness" && typeof window.renderFitness === "function") {
      window.renderFitness();
      renderFitnessIdeaPanel();
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

  function installNavigation() {
    window.navTo = function (page) {
      showPage(String(page || "home"));
    };
  }

  function openInitialPage() {
    const hashPage = String(window.location.hash || "").replace(/^#/, "");
    const allowedPages = new Set(["home", "fitness", "circumference", "photos", ...MODULE_KEYS]);
    if (hashPage && allowedPages.has(hashPage)) {
      showPage(hashPage);
      return;
    }

    renderHome();
  }

  function bootstrap() {
    injectStyles();
    saveHubState(loadHubState());

    for (const moduleKey of MODULE_KEYS) {
      renderModulePage(moduleKey);
    }

    installNavigation();
    document.addEventListener("input", handleModuleInput);
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeydown);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("life-hub-sync-status", handleSyncStatus);
    window.addEventListener("life-hub-state-updated", handleRemoteStateUpdate);
    openInitialPage();
    renderFitnessIdeaPanel();
  }

  bootstrap();
})();
