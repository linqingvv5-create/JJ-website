(function () {
  const storageKey = "linqing-minimal-trade-board-state-v3";
  const exportedAppName = "linqing-minimal-trade-board";
  const syncClientKey = "linqing-minimal-trade-board-client-id";
  const viewModeKey = "linqing-minimal-trade-board-view-mode";
  const syncApiStateUrl = "/api/state";
  const syncApiActionUrl = "/api/actions";
  const syncPollIntervalMs = 5000;

  const PLAN_STATUS = {
    PENDING: "未触发",
    WAITING: "已触发待执行",
    DONE: "已执行",
    PAUSED: "暂停",
    CANCELLED: "取消"
  };

  const PLAN_KIND = {
    SELL: "sell",
    TRADE: "trade",
    ADD: "add",
    WATCH: "watch"
  };

  const POSITION_SIDE = {
    BUY: "buy",
    SELL: "sell"
  };

  const DETAIL_TAB = {
    POSITION: "position",
    PLANS: "plans",
    STRATEGY: "strategy"
  };

  const planStatusOptions = Object.values(PLAN_STATUS);
  const activePlanStatuses = new Set([PLAN_STATUS.PENDING, PLAN_STATUS.WAITING]);
  const planKindLabels = {
    [PLAN_KIND.SELL]: "计划卖出",
    [PLAN_KIND.TRADE]: "计划做T",
    [PLAN_KIND.ADD]: "计划补仓",
    [PLAN_KIND.WATCH]: "观察提醒"
  };
  const positionLabelOptions = [
    "初始持仓",
    "已买入",
    "补仓买入",
    "T买回执行",
    "计划卖出执行",
    "T卖出执行",
    "手动调整"
  ];
  const addUseOptions = ["加入做T仓", "等目标价卖出", "长期持有", "待定"];

  const appData = window.APP_DATA || {};
  const defaultState = finalizeState(normalizeState(appData));

  const pageTitle = document.getElementById("page-title");
  const pageSubtitle = document.getElementById("page-subtitle");
  const backButton = document.getElementById("back-button");
  const resetButton = document.getElementById("reset-data-btn");
  const exportButton = document.getElementById("export-data-btn");
  const importButton = document.getElementById("import-data-btn");
  const viewToggleButton = document.getElementById("view-toggle-btn");
  const importFile = document.getElementById("import-file");
  const homeView = document.getElementById("home-view");
  const detailView = document.getElementById("detail-view");
  const accountList = document.getElementById("account-list");
  const detailContent = document.getElementById("detail-content");
  const syncStatus = document.getElementById("sync-status");

  const hasLocalStateCache = hasStoredLocalState();
  let state = loadState();
  let selectedHoldingId = null;
  let selectedDetailTab = DETAIL_TAB.POSITION;
  let detailAutoSaveTimerId = 0;
  let detailSaveStatusText = "";
  let viewPreference = loadViewPreference();
  let syncQueue = Promise.resolve();
  const syncState = {
    clientId: getOrCreateClientId(),
    connected: false,
    currentRevision: 0,
    lastSavedAt: "",
    mode: "checking",
    message: "同步状态检查中...",
    pollTimerId: 0
  };

  bindEvents();
  renderApp();
  void initializeSync();

  function bindEvents() {
    if (viewToggleButton) {
      viewToggleButton.addEventListener("click", () => {
        toggleViewMode();
      });
    }

    backButton.addEventListener("click", () => {
      clearDetailAutoSaveTimer();
      detailSaveStatusText = "";
      selectedHoldingId = null;
      selectedDetailTab = DETAIL_TAB.POSITION;
      renderApp();
    });

    resetButton.addEventListener("click", async () => {
      const confirmed = window.confirm("确认重置为当前初始数据吗？你在网页里的修改会被覆盖。");
      if (!confirmed) {
        return;
      }

      state = clone(defaultState);
      selectedHoldingId = null;
      selectedDetailTab = DETAIL_TAB.POSITION;
      saveState();
      renderApp();
      await syncFullState({
        successMessage: "已同步重置后的数据",
        skipRender: true
      });
    });

    exportButton.addEventListener("click", exportState);
    importButton.addEventListener("click", () => importFile.click());

    importFile.addEventListener("change", async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) {
        return;
      }

      await importState(file);
      importFile.value = "";
    });

    accountList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-open-holding]");
      if (!button) {
        return;
      }

      clearDetailAutoSaveTimer();
      detailSaveStatusText = "";
      selectedHoldingId = button.dataset.openHolding;
      selectedDetailTab = DETAIL_TAB.POSITION;
      renderApp();
    });

    accountList.addEventListener("input", handleHomeInput);
    accountList.addEventListener("change", handleHomeInput);

    detailContent.addEventListener("click", handleDetailClick);
    detailContent.addEventListener("input", handleDetailInput);
    detailContent.addEventListener("change", handleDetailInput);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        void refreshRemoteState({
          allowMissing: true,
          silent: true
        });
      }
    });

    window.addEventListener("resize", () => {
      if (viewPreference === "auto") {
        renderApp();
      }
    });
  }

  function handleHomeInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const bankCashInput = target.closest("[data-home-bank-cash]");
    if (bankCashInput) {
      state.bankCash = parseNullableNumber(bankCashInput.value);
      saveState();
      renderHomeView();
      void syncFullState({
        successMessage: "已同步首页总览",
        skipRender: true
      });
      return;
    }

    const cashInput = target.closest("[data-home-cash]");
    if (cashInput) {
      const account = getAccountById(cashInput.dataset.homeCash);
      if (!account) {
        return;
      }

      account.availableCash = parseNullableNumber(cashInput.value);
      saveState();
      renderHomeView();
      void syncFullState({
        successMessage: "已同步账户概况",
        skipRender: true
      });
      return;
    }

    const priceInput = target.closest("[data-home-price]");
    if (priceInput) {
      const holding = getHoldingById(priceInput.dataset.homePrice);
      if (!holding) {
        return;
      }

      holding.currentPrice = parseNullableNumber(priceInput.value);
      saveState();
      renderHomeView();
      if (selectedHoldingId === holding.id) {
        updateDetailStaticSummary();
      }
      void syncFullState({
        successMessage: "已同步最新价格",
        skipRender: true
      });
    }
  }

  function handleDetailClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const tabButton = target.closest("[data-detail-tab]");
    if (tabButton) {
      selectedDetailTab = tabButton.dataset.detailTab || DETAIL_TAB.POSITION;
      renderDetailView();
      return;
    }

    const addPositionButton = target.closest("[data-add-position]");
    if (addPositionButton) {
      const holdingId = addPositionButton.dataset.addPosition;
      state.positionLots.push(createEmptyPositionLot(holdingId));
      saveState();
      renderDetailView();
      renderHomeView();
      setDetailSaveStatus("已自动保存");
      void syncFullState({
        successMessage: "已同步持仓记录",
        skipRender: true
      });
      return;
    }

    const deletePositionButton = target.closest("[data-delete-position]");
    if (deletePositionButton) {
      const lotId = deletePositionButton.dataset.deletePosition;
      state.positionLots = state.positionLots.filter((lot) => lot.id !== lotId);
      state = finalizeState(state);
      saveState();
      renderApp();
      setDetailSaveStatus("已自动保存");
      void syncFullState({
        successMessage: "已同步持仓记录",
        skipRender: true
      });
      return;
    }

    const addPlanButton = target.closest("[data-add-plan-kind]");
    if (addPlanButton) {
      const holdingId = addPlanButton.dataset.holdingId;
      const kind = addPlanButton.dataset.addPlanKind;
      state.plans.push(createEmptyPlan(holdingId, kind));
      saveState();
      renderDetailView();
      setDetailSaveStatus("已自动保存");
      void syncFullState({
        successMessage: "已同步计划",
        skipRender: true
      });
      return;
    }

    const deletePlanButton = target.closest("[data-delete-plan]");
    if (deletePlanButton) {
      const planId = deletePlanButton.dataset.deletePlan;
      state.plans = state.plans.filter((plan) => plan.id !== planId);
      state = finalizeState(state);
      saveState();
      renderApp();
      setDetailSaveStatus("已自动保存");
      void syncFullState({
        successMessage: "已同步计划",
        skipRender: true
      });
      return;
    }
  }

  function handleDetailInput(event) {
    const container = detailContent.querySelector("[data-holding-editor]");
    if (!container) {
      return;
    }

    updateDetailDraftSummary(container);
    if (event.type === "change") {
      saveDetailEditor(container, {
        saveMessage: "已自动保存"
      });
      return;
    }

    scheduleDetailAutoSave();
  }

  function loadState() {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return clone(defaultState);
      }

      const parsed = JSON.parse(raw);
      const importedState = normalizeState(parsed && parsed.state ? parsed.state : parsed);
      return finalizeState(mergeState(defaultState, importedState));
    } catch (error) {
      return clone(defaultState);
    }
  }

  function saveState() {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        app: exportedAppName,
        savedAt: formatDateTime(new Date()),
        state
      })
    );
  }

  function hasStoredLocalState() {
    try {
      return Boolean(window.localStorage.getItem(storageKey));
    } catch (error) {
      return false;
    }
  }

  function loadViewPreference() {
    try {
      const raw = String(window.localStorage.getItem(viewModeKey) || "auto").trim();
      return raw === "compact" || raw === "standard" ? raw : "auto";
    } catch (error) {
      return "auto";
    }
  }

  function saveViewPreference() {
    try {
      window.localStorage.setItem(viewModeKey, viewPreference);
    } catch (error) {
    }
  }

  function getViewMode() {
    if (viewPreference === "compact" || viewPreference === "standard") {
      return viewPreference;
    }

    return window.matchMedia("(max-width: 760px)").matches ? "compact" : "standard";
  }

  function toggleViewMode() {
    viewPreference = getViewMode() === "compact" ? "standard" : "compact";
    saveViewPreference();
    renderApp();
  }

  function updateViewToggleButton() {
    if (!viewToggleButton) {
      return;
    }

    const mode = getViewMode();
    viewToggleButton.textContent = mode === "compact" ? "标准版" : "紧凑版";
    viewToggleButton.classList.toggle("is-active", mode === "compact");
    viewToggleButton.title = mode === "compact" ? "当前是紧凑驾驶舱" : "当前是标准版";
  }

  async function initializeSync() {
    renderSyncStatus();
    await refreshRemoteState({
      allowMissing: true
    });
    startSyncPolling();
  }

  function startSyncPolling() {
    if (syncState.pollTimerId) {
      return;
    }

    syncState.pollTimerId = window.setInterval(() => {
      void refreshRemoteState({
        allowMissing: true,
        silent: true
      });
    }, syncPollIntervalMs);
  }

  function getOrCreateClientId() {
    try {
      const existing = window.localStorage.getItem(syncClientKey);
      if (existing) {
        return existing;
      }

      const nextValue = `client-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
      window.localStorage.setItem(syncClientKey, nextValue);
      return nextValue;
    } catch (error) {
      return `client-${Date.now()}`;
    }
  }

  function queueSyncTask(task) {
    syncQueue = syncQueue.catch(() => null).then(task);
    return syncQueue;
  }

  async function refreshRemoteState(options) {
    const nextOptions = options || {};
    if (detailAutoSaveTimerId || isEditingDetailForm()) {
      return null;
    }

    try {
      const response = await fetch(syncApiStateUrl, {
        cache: "no-store"
      });

      if (response.status === 404) {
        syncState.connected = false;
        setSyncStatus("local", "当前是本地模式，打开共享服务后可多设备同步");
        return null;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const remoteRevision = parseRevision(payload.revision);
      syncState.connected = true;

      if (!payload.state) {
        syncState.currentRevision = remoteRevision;
        if (hasLocalStateCache) {
          setSyncStatus("online", "共享服务已连接，正在推送当前设备数据");
          await syncFullState({
            successMessage: "已建立共享数据",
            skipRender: true
          });
        } else {
          setSyncStatus("online", "共享服务已连接，但云端还是空的");
        }
        return payload;
      }

      const shouldApplyState = remoteRevision > syncState.currentRevision || !syncState.lastSavedAt;
      syncState.currentRevision = remoteRevision;
      syncState.lastSavedAt = String(payload.savedAt || "");

      if (shouldApplyState) {
        applyRemoteState(payload, {
          skipRender: Boolean(nextOptions.skipRender)
        });
      }

      setSyncStatus("online", getSyncedStatusMessage());
      return payload;
    } catch (error) {
      syncState.connected = false;
      if (!nextOptions.silent) {
        setSyncStatus("offline", "共享服务暂时不可用，当前改动会先保存在本机");
      }
      return null;
    }
  }

  function syncFullState(options) {
    return syncAction({
      type: "replaceState",
      state: clone(state)
    }, options);
  }

  function syncAction(action, options) {
    const nextOptions = options || {};

    return queueSyncTask(async () => {
      setSyncStatus("syncing", nextOptions.pendingMessage || "正在同步...");

      try {
        const response = await fetch(syncApiActionUrl, {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            clientId: syncState.clientId,
            fallbackState: clone(state),
            action
          })
        });

        if (response.status === 404) {
          syncState.connected = false;
          setSyncStatus("local", "当前是本地模式，打开共享服务后可多设备同步");
          return null;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        syncState.connected = true;
        syncState.currentRevision = parseRevision(payload.revision);
        syncState.lastSavedAt = String(payload.savedAt || "");
        applyRemoteState(payload, {
          skipRender: nextOptions.skipRender
        });
        setSyncStatus("online", nextOptions.successMessage || getSyncedStatusMessage());
        return payload;
      } catch (error) {
        syncState.connected = false;
        setSyncStatus("offline", "同步失败，改动已经保存在当前设备");
        return null;
      }
    });
  }

  function applyRemoteState(payload, options) {
    if (!payload || !payload.state) {
      return;
    }

    const nextOptions = options || {};
    const remoteState = normalizeState(payload.state);
    state = finalizeState(mergeState(defaultState, remoteState));
    saveState();

    if (!nextOptions.skipRender && !isEditingDetailForm()) {
      renderApp();
    }
  }

  function parseRevision(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isEditingDetailForm() {
    const activeElement = document.activeElement;
    return Boolean(activeElement && detailContent.contains(activeElement));
  }

  function getSyncedStatusMessage() {
    return syncState.lastSavedAt
      ? `已连接共享数据，最新同步 ${syncState.lastSavedAt}`
      : "已连接共享数据";
  }

  function setSyncStatus(mode, message) {
    syncState.mode = mode;
    syncState.message = message;
    renderSyncStatus();
  }

  function renderSyncStatus() {
    if (!syncStatus) {
      return;
    }

    syncStatus.textContent = syncState.message;
    syncStatus.className = `sync-status sync-status-${syncState.mode}`;
  }

  function clearDetailAutoSaveTimer() {
    if (!detailAutoSaveTimerId) {
      return;
    }

    window.clearTimeout(detailAutoSaveTimerId);
    detailAutoSaveTimerId = 0;
  }

  function scheduleDetailAutoSave() {
    clearDetailAutoSaveTimer();
    detailAutoSaveTimerId = window.setTimeout(() => {
      detailAutoSaveTimerId = 0;
      const container = detailContent.querySelector("[data-holding-editor]");
      if (!container) {
        return;
      }

      saveDetailEditor(container, {
        saveMessage: "已自动保存"
      });
    }, 240);
  }

  function renderApp() {
    document.body.dataset.viewMode = getViewMode();
    renderHeader();
    renderHomeView();
    renderDetailView();
    renderSyncStatus();
    updateViewToggleButton();
  }

  function renderHeader() {
    const holding = selectedHoldingId ? getHoldingById(selectedHoldingId) : null;
    pageTitle.textContent = "林青交易驾驶舱";

    if (!holding) {
      pageSubtitle.textContent = "一屏看清账户、持仓和下一步计划。";
      backButton.classList.add("hidden");
      homeView.classList.add("is-active");
      detailView.classList.remove("is-active");
      return;
    }

    pageSubtitle.textContent = `当前查看：${holding.name} ${holding.code}`;
    backButton.classList.remove("hidden");
    homeView.classList.remove("is-active");
    detailView.classList.add("is-active");
  }

  function renderHomeView() {
    const homeSummary = computeHomeSummary();
    accountList.innerHTML = `
      <section class="dashboard-summary">
        <div class="summary-grid">
          ${renderSummaryCell("总资产", homeSummary.totalAssetText, "")}
          ${renderSummaryCell("股票市值", homeSummary.marketValueText, "")}
          ${renderSummaryCell("可用现金", homeSummary.availableCashText, "")}
          ${renderSummaryCell("其他资金", homeSummary.otherFundsText, "")}
          ${renderSummaryCell("总浮盈亏", homeSummary.floatingPnlText, getProfitClass(homeSummary.floatingPnlNumber))}
        </div>
        <label class="summary-edit-cell">
          <span class="summary-label">修改其他资金</span>
          <input
            type="number"
            step="0.01"
            inputmode="decimal"
            data-home-bank-cash
            value="${escapeAttribute(formatInputNumber(state.bankCash, 2))}"
            placeholder="待填"
          >
        </label>
      </section>
      <div class="account-groups">
        ${state.accounts.map((account) => renderAccountSection(account)).join("")}
      </div>
    `;
  }

  function renderAccountSection(account) {
    const summary = computeAccountSummary(account.id);
    const holdings = getHoldingsByAccount(account.id);

    return `
      <section class="account-group">
        <div class="account-group-head">
          <div>
            <div class="account-group-title">${escapeHtml(account.name)}</div>
            <div class="account-group-subtitle">${escapeHtml(account.label)}</div>
          </div>
          <label class="account-cash-inline">
            <span>可用现金</span>
            <input
              type="number"
              step="0.01"
              inputmode="decimal"
              data-home-cash="${escapeAttribute(account.id)}"
              value="${escapeAttribute(formatInputNumber(account.availableCash, 2))}"
              placeholder="待填"
            >
          </label>
        </div>

        <div class="account-mini-grid">
          ${renderSummaryCell("总资产", summary.totalAssetText, "")}
          ${renderSummaryCell("股票市值", summary.marketValueText, "")}
          ${renderSummaryCell("可用现金", summary.availableCashText, "")}
          ${renderSummaryCell("浮盈亏", summary.floatingPnlText, getProfitClass(summary.floatingPnlNumber))}
        </div>

        <div class="stock-list">
          ${holdings.length ? holdings.map((holding) => renderHoldingItem(holding)).join("") : `<div class="empty-note">当前账户暂无持仓。</div>`}
        </div>
      </section>
    `;
  }

  function renderHoldingItem(holding) {
    const metrics = computeHoldingMetrics(holding);
    const nextStep = computePlanSummary(holding.id);

    return `
      <article class="stock-row">
        <div class="stock-row-top">
          <div class="stock-identity">
            <strong>${escapeHtml(holding.name)}</strong>
            <span>${escapeHtml(holding.code)} · ${escapeHtml(formatShares(holding.shares))}</span>
          </div>
          <button class="detail-link-button" type="button" data-open-holding="${escapeAttribute(holding.id)}">详情/编辑</button>
        </div>

        <div class="stock-row-grid">
          <div class="stock-metric">
            <span>成本</span>
            <strong>${escapeHtml(displayPriceOrPending(holding.cost, "待填", 3))}</strong>
          </div>
          <label class="stock-metric stock-metric-edit">
            <span>现价</span>
            <input
              type="number"
              step="0.001"
              inputmode="decimal"
              data-home-price="${escapeAttribute(holding.id)}"
              value="${escapeAttribute(formatInputNumber(holding.currentPrice, 3))}"
              placeholder="待填"
            >
          </label>
          <div class="stock-metric">
            <span>市值</span>
            <strong>${escapeHtml(metrics.marketValueText)}</strong>
          </div>
          <div class="stock-metric">
            <span>浮盈亏</span>
            <strong class="${getProfitClass(metrics.floatingPnl)}">${escapeHtml(metrics.floatingPnlText)}</strong>
          </div>
        </div>

        <div class="stock-row-bottom">
          <div class="stock-state-inline">
            <span class="row-label">状态</span>
            <span class="state-pill">${escapeHtml(holding.status || "待补充")}</span>
          </div>
          <div class="stock-next-inline">
            <span class="row-label">下一步</span>
            <strong class="next-action-text">${escapeHtml(nextStep.nextActionText)}</strong>
          </div>
        </div>
      </article>
    `;
  }

  function renderSummaryCell(label, value, valueClass) {
    return `
      <div class="summary-cell">
        <span class="summary-label">${escapeHtml(label)}</span>
        <strong class="${escapeAttribute(valueClass || "")}">${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function renderDetailView() {
    const holding = selectedHoldingId ? getHoldingById(selectedHoldingId) : null;
    if (!holding) {
      detailContent.innerHTML = "";
      return;
    }

    const summary = computeHoldingMetrics(holding);
    const planSummary = computePlanSummary(holding.id);
    const positionSummary = computePositionSummary(getPositionLotsForHolding(holding.id), holding.currentPrice);

    detailContent.innerHTML = `
      <section class="detail-shell" data-holding-editor data-holding-id="${escapeAttribute(holding.id)}">
        <div class="detail-overview">
          <div class="detail-overview-head">
            <div>
              <div class="detail-name">${escapeHtml(holding.name)}</div>
              <div class="detail-code">${escapeHtml(holding.code)} · ${escapeHtml(getAccountById(holding.accountId)?.name || "")}</div>
            </div>
            <div class="detail-save">${escapeHtml(detailSaveStatusText || "自动保存已开启")}</div>
          </div>

          <div class="detail-hero-grid">
            <label class="detail-hero-card">
              <span>当前价</span>
              <input type="number" step="0.001" inputmode="decimal" data-holding-field="currentPrice" value="${escapeAttribute(formatInputNumber(holding.currentPrice, 3))}" placeholder="待填">
            </label>
            <label class="detail-hero-card">
              <span>当前状态</span>
              <input type="text" data-holding-field="status" value="${escapeAttribute(holding.status || "")}" placeholder="例如：波段持仓 / 观察仓">
            </label>
            <div class="detail-hero-card">
              <span>当前持仓</span>
              <strong data-live-shares>${escapeHtml(formatShares(positionSummary.totalShares))}</strong>
            </div>
            <div class="detail-hero-card">
              <span>平均成本</span>
              <strong data-live-cost>${escapeHtml(displayPriceOrPending(positionSummary.averageCost, "待填", 3))}</strong>
            </div>
            <div class="detail-hero-card">
              <span>当前市值</span>
              <strong data-live-market-value>${escapeHtml(summary.marketValueText)}</strong>
            </div>
            <div class="detail-hero-card">
              <span>当前浮盈亏</span>
              <strong class="${getProfitClass(summary.floatingPnl)}" data-live-floating-pnl>${escapeHtml(summary.floatingPnlText)}</strong>
            </div>
          </div>

          <div class="detail-next-bar">
            <span class="row-label">下一步计划</span>
            <strong data-live-next-action>${escapeHtml(planSummary.nextActionText)}</strong>
          </div>
        </div>

        <div class="detail-tab-bar">
          ${renderTabButton(DETAIL_TAB.POSITION, "持仓")}
          ${renderTabButton(DETAIL_TAB.PLANS, "交易计划")}
          ${renderTabButton(DETAIL_TAB.STRATEGY, "策略")}
        </div>

        <div class="detail-tab-content">
          ${selectedDetailTab === DETAIL_TAB.POSITION ? renderPositionTab(holding, positionSummary) : ""}
          ${selectedDetailTab === DETAIL_TAB.PLANS ? renderPlansTab(holding) : ""}
          ${selectedDetailTab === DETAIL_TAB.STRATEGY ? renderStrategyTab(holding) : ""}
        </div>
      </section>
    `;
  }

  function renderTabButton(tabKey, label) {
    return `
      <button
        class="tab-switch${selectedDetailTab === tabKey ? " is-active" : ""}"
        type="button"
        data-detail-tab="${escapeAttribute(tabKey)}"
      >${escapeHtml(label)}</button>
    `;
  }

  function renderPositionTab(holding, summary) {
    const lots = getPositionLotsForHolding(holding.id);

    return `
      <section class="detail-panel-block">
        <div class="section-head compact">
          <div>
            <h3>持仓记录</h3>
            <p>这里记录你的持仓来源和系统自动追加的执行记录。</p>
          </div>
          <button class="inline-add-button" type="button" data-add-position="${escapeAttribute(holding.id)}">新增记录</button>
        </div>

        <div class="detail-mini-summary">
          ${renderSummaryCell("总持仓股数", formatShares(summary.totalShares), "")}
          ${renderSummaryCell("总成本金额", summary.costAmountText, "")}
          ${renderSummaryCell("平均成本价", summary.averageCostText, "")}
          ${renderSummaryCell("当前市值", summary.marketValueText, "")}
          ${renderSummaryCell("当前浮盈亏", summary.floatingPnlText, getProfitClass(summary.floatingPnl))}
        </div>

        <div class="record-list">
          ${lots.length ? lots.map((lot) => renderPositionRow(lot)).join("") : `<div class="empty-note">还没有持仓来源记录。</div>`}
        </div>
      </section>
    `;
  }

  function renderPositionRow(lot) {
    return `
      <div class="editor-card position-row" data-position-id="${escapeAttribute(lot.id)}">
        <div class="editor-card-head">
          <strong>${escapeHtml(lot.label || "持仓记录")}</strong>
          <button class="ghost-delete" type="button" data-delete-position="${escapeAttribute(lot.id)}">删除</button>
        </div>

        <div class="editor-grid two">
          <label class="editor-field">
            <span>方向</span>
            <select data-field="side">
              ${renderOptionList([
                { value: POSITION_SIDE.BUY, label: "买入" },
                { value: POSITION_SIDE.SELL, label: "卖出" }
              ], lot.side)}
            </select>
          </label>

          <label class="editor-field">
            <span>状态</span>
            <input type="text" data-field="label" list="position-labels" value="${escapeAttribute(lot.label || "")}" placeholder="例如：已买入 / 补仓买入">
          </label>

          <label class="editor-field">
            <span>成交价格</span>
            <input type="number" step="0.001" inputmode="decimal" data-field="price" value="${escapeAttribute(formatInputNumber(lot.price, 3))}" placeholder="待填">
          </label>

          <label class="editor-field">
            <span>股数</span>
            <input type="number" step="100" inputmode="numeric" data-field="shares" value="${escapeAttribute(formatInputNumber(lot.shares, 0))}" placeholder="待填">
          </label>

          <div class="editor-stat">
            <span>金额</span>
            <strong data-live-amount>${escapeHtml(formatCurrencyOrPending(getEntryAmount(lot)))}</strong>
          </div>

          <label class="editor-field full">
            <span>备注</span>
            <input type="text" data-field="note" value="${escapeAttribute(lot.note || "")}" placeholder="可写来源、用途、说明">
          </label>
        </div>
      </div>
    `;
  }

  function renderPlansTab(holding) {
    const grouped = groupPlansByKind(holding.id);
    return `
      <section class="detail-panel-block">
        ${renderPlanGroup(holding.id, PLAN_KIND.SELL, grouped[PLAN_KIND.SELL], "计划卖出", "最终退出、减仓或达到目标价卖出")}
        ${renderPlanGroup(holding.id, PLAN_KIND.TRADE, grouped[PLAN_KIND.TRADE], "计划做T", "记录同一波段可重复执行的高卖低买")}
        ${renderPlanGroup(holding.id, PLAN_KIND.ADD, grouped[PLAN_KIND.ADD], "计划补仓", "未来低位买入计划，必须写清补仓后用途")}
        ${grouped[PLAN_KIND.WATCH].length ? renderWatchGroup(grouped[PLAN_KIND.WATCH]) : ""}
      </section>
    `;
  }

  function renderPlanGroup(holdingId, kind, plans, title, note) {
    return `
      <div class="plan-group">
        <div class="section-head compact">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(note)}</p>
          </div>
          <button class="inline-add-button" type="button" data-holding-id="${escapeAttribute(holdingId)}" data-add-plan-kind="${escapeAttribute(kind)}">新增</button>
        </div>
        <div class="record-list">
          ${plans.length ? plans.map((plan) => renderPlanCard(plan)).join("") : `<div class="empty-note">暂时没有这一类计划。</div>`}
        </div>
      </div>
    `;
  }

  function renderWatchGroup(plans) {
    return `
      <div class="plan-group">
        <div class="section-head compact">
          <div>
            <h3>观察提醒</h3>
            <p>这些规则不会直接增减持仓，但会影响你下一步判断。</p>
          </div>
        </div>
        <div class="record-list">
          ${plans.map((plan) => renderPlanCard(plan)).join("")}
        </div>
      </div>
    `;
  }

  function renderPlanCard(plan) {
    if (plan.kind === PLAN_KIND.SELL) {
      return renderSellPlanCard(plan);
    }
    if (plan.kind === PLAN_KIND.TRADE) {
      return renderTradePlanCard(plan);
    }
    if (plan.kind === PLAN_KIND.ADD) {
      return renderAddPlanCard(plan);
    }
    return renderWatchPlanCard(plan);
  }

  function renderCommonPlanHead(plan) {
    return `
      <div class="editor-card-head">
        <div class="plan-title-block">
          <strong>${escapeHtml(plan.label || planKindLabels[plan.kind])}</strong>
          <span class="type-pill">${escapeHtml(planKindLabels[plan.kind] || "计划")}</span>
        </div>
        <button class="ghost-delete" type="button" data-delete-plan="${escapeAttribute(plan.id)}">删除</button>
      </div>
    `;
  }

  function renderSellPlanCard(plan) {
    return `
      <div class="editor-card plan-row" data-plan-id="${escapeAttribute(plan.id)}" data-plan-kind="${escapeAttribute(plan.kind)}">
        ${renderCommonPlanHead(plan)}
        <div class="editor-grid two">
          <label class="editor-field">
            <span>卖出价格</span>
            <input type="number" step="0.001" inputmode="decimal" data-field="sellPrice" value="${escapeAttribute(formatInputNumber(plan.sellPrice, 3))}" placeholder="待填">
          </label>
          <label class="editor-field">
            <span>股数</span>
            <input type="number" step="100" inputmode="numeric" data-field="sellShares" value="${escapeAttribute(formatInputNumber(plan.sellShares, 0))}" placeholder="待填">
          </label>
          <div class="editor-stat">
            <span>预计卖出金额</span>
            <strong data-live-sell-amount>${escapeHtml(formatCurrencyOrPending(computeSellAmount(plan)))}</strong>
          </div>
          <label class="editor-field">
            <span>状态</span>
            <select data-field="status">${renderPlanStatusOptions(plan.status)}</select>
          </label>
          <label class="editor-field full">
            <span>计划目的</span>
            <input type="text" data-field="purpose" value="${escapeAttribute(plan.purpose || "")}" placeholder="例如：梦想卖出 / 反弹减仓第一档">
          </label>
          <label class="editor-field full">
            <span>备注</span>
            <input type="text" data-field="note" value="${escapeAttribute(plan.note || "")}" placeholder="补充条件或原因">
          </label>
        </div>
      </div>
    `;
  }

  function renderTradePlanCard(plan) {
    return `
      <div class="editor-card plan-row" data-plan-id="${escapeAttribute(plan.id)}" data-plan-kind="${escapeAttribute(plan.kind)}">
        ${renderCommonPlanHead(plan)}
        <div class="editor-grid two">
          <label class="editor-field">
            <span>T卖出价</span>
            <input type="number" step="0.001" inputmode="decimal" data-field="sellPrice" value="${escapeAttribute(formatInputNumber(plan.sellPrice, 3))}" placeholder="待填">
          </label>
          <label class="editor-field">
            <span>卖出股数</span>
            <input type="number" step="100" inputmode="numeric" data-field="sellShares" value="${escapeAttribute(formatInputNumber(plan.sellShares, 0))}" placeholder="待填">
          </label>
          <div class="editor-stat">
            <span>预计卖出金额</span>
            <strong data-live-sell-amount>${escapeHtml(formatCurrencyOrPending(computeSellAmount(plan)))}</strong>
          </div>
          <label class="editor-field">
            <span>T买回价</span>
            <input type="number" step="0.001" inputmode="decimal" data-field="buyPrice" value="${escapeAttribute(formatInputNumber(plan.buyPrice, 3))}" placeholder="待填">
          </label>
          <label class="editor-field">
            <span>买回股数</span>
            <input type="number" step="100" inputmode="numeric" data-field="buyShares" value="${escapeAttribute(formatInputNumber(plan.buyShares, 0))}" placeholder="待填">
          </label>
          <div class="editor-stat">
            <span>预计买回金额</span>
            <strong data-live-buy-amount>${escapeHtml(formatCurrencyOrPending(computeBuyAmount(plan)))}</strong>
          </div>
          <div class="editor-stat">
            <span>单次预计盈利</span>
            <strong data-live-trade-profit class="${getProfitClass(computeTradeExpectedProfit(plan))}">${escapeHtml(formatProfitOrPending(computeTradeExpectedProfit(plan)))}</strong>
          </div>
          <label class="editor-field">
            <span>状态</span>
            <select data-field="status">${renderPlanStatusOptions(plan.status)}</select>
          </label>
          <label class="editor-field">
            <span>实际卖出价</span>
            <input type="number" step="0.001" inputmode="decimal" data-field="actualSellPrice" value="${escapeAttribute(formatInputNumber(plan.actualSellPrice, 3))}" placeholder="可空">
          </label>
          <label class="editor-field">
            <span>实际买回价</span>
            <input type="number" step="0.001" inputmode="decimal" data-field="actualBuyPrice" value="${escapeAttribute(formatInputNumber(plan.actualBuyPrice, 3))}" placeholder="可空">
          </label>
          <label class="editor-field">
            <span>实际盈利</span>
            <input type="number" step="0.01" inputmode="decimal" data-field="actualProfit" value="${escapeAttribute(formatInputNumber(plan.actualProfit, 2))}" placeholder="可空">
          </label>
          <div class="editor-stat">
            <span>执行次数</span>
            <strong>${escapeHtml(String(plan.executionCount || 0))}</strong>
          </div>
          <div class="editor-stat">
            <span>累计T盈利</span>
            <strong class="${getProfitClass(plan.totalTProfit)}">${escapeHtml(formatProfitOrPending(plan.totalTProfit, "¥0"))}</strong>
          </div>
          <label class="editor-field full">
            <span>备注</span>
            <input type="text" data-field="note" value="${escapeAttribute(plan.note || "")}" placeholder="补充波段逻辑、执行提醒">
          </label>
        </div>
      </div>
    `;
  }

  function renderAddPlanCard(plan) {
    return `
      <div class="editor-card plan-row" data-plan-id="${escapeAttribute(plan.id)}" data-plan-kind="${escapeAttribute(plan.kind)}">
        ${renderCommonPlanHead(plan)}
        <div class="editor-grid two">
          <label class="editor-field">
            <span>补仓价格</span>
            <input type="number" step="0.001" inputmode="decimal" data-field="buyPrice" value="${escapeAttribute(formatInputNumber(plan.buyPrice, 3))}" placeholder="待填">
          </label>
          <label class="editor-field">
            <span>股数</span>
            <input type="number" step="100" inputmode="numeric" data-field="buyShares" value="${escapeAttribute(formatInputNumber(plan.buyShares, 0))}" placeholder="待填">
          </label>
          <div class="editor-stat">
            <span>预计买入金额</span>
            <strong data-live-buy-amount>${escapeHtml(formatCurrencyOrPending(computeBuyAmount(plan)))}</strong>
          </div>
          <label class="editor-field">
            <span>状态</span>
            <select data-field="status">${renderPlanStatusOptions(plan.status)}</select>
          </label>
          <label class="editor-field full">
            <span>补仓后用途</span>
            <select data-field="useAfterBuy">${renderOptionList(addUseOptions.map((item) => ({ value: item, label: item })), plan.useAfterBuy || "待定")}</select>
          </label>
          <label class="editor-field full">
            <span>备注</span>
            <input type="text" data-field="note" value="${escapeAttribute(plan.note || "")}" placeholder="例如：反弹到 36.74 卖出">
          </label>
        </div>
      </div>
    `;
  }

  function renderWatchPlanCard(plan) {
    return `
      <div class="editor-card plan-row" data-plan-id="${escapeAttribute(plan.id)}" data-plan-kind="${escapeAttribute(plan.kind)}">
        ${renderCommonPlanHead(plan)}
        <div class="editor-grid two">
          <label class="editor-field">
            <span>提醒价</span>
            <input type="number" step="0.001" inputmode="decimal" data-field="triggerPrice" value="${escapeAttribute(formatInputNumber(plan.triggerPrice, 3))}" placeholder="可空">
          </label>
          <label class="editor-field">
            <span>状态</span>
            <select data-field="status">${renderPlanStatusOptions(plan.status)}</select>
          </label>
          <label class="editor-field full">
            <span>提醒内容</span>
            <input type="text" data-field="note" value="${escapeAttribute(plan.note || "")}" placeholder="例如：跌破 7.00 重新看主营和财报">
          </label>
        </div>
      </div>
    `;
  }

  function renderStrategyTab(holding) {
    const watchPlans = groupPlansByKind(holding.id)[PLAN_KIND.WATCH];
    return `
      <section class="detail-panel-block">
        <div class="section-head compact">
          <div>
            <h3>策略总纲</h3>
            <p>适合写投资逻辑、风险规则、卖出原则、暂停条件。</p>
          </div>
        </div>

        <label class="strategy-field">
          <span>策略文本</span>
          <textarea rows="12" data-holding-field="strategyText" placeholder="写这只股票的总体策略、风险边界和执行原则">${escapeHtml(holding.reflectionNote || "")}</textarea>
        </label>

        ${holding.risk ? `<div class="strategy-note"><span>当前风险规则</span><p>${escapeHtml(holding.risk)}</p></div>` : ""}
        ${holding.extraNote ? `<div class="strategy-note"><span>补充说明</span><p>${escapeHtml(holding.extraNote)}</p></div>` : ""}
        ${watchPlans.length ? `<div class="strategy-note"><span>观察提醒</span><p>${escapeHtml(watchPlans.map((plan) => plan.note || getWatchPlanLabel(plan)).join("；"))}</p></div>` : ""}
      </section>
    `;
  }

  function updateDetailDraftSummary(container) {
    const draft = buildEditorDraft(container, {
      previewOnly: true
    });
    if (!draft) {
      return;
    }

    const currentPriceInput = container.querySelector('[data-holding-field="currentPrice"]');
    const currentPrice = currentPriceInput ? parseNullableNumber(currentPriceInput.value) : null;
    const summary = computePositionSummary(draft.positionLots, currentPrice);
    const nextActionText = computePlanSummaryFromPlans(draft.plans, currentPrice).nextActionText;

    const liveShares = container.querySelector("[data-live-shares]");
    const liveCost = container.querySelector("[data-live-cost]");
    const liveMarketValue = container.querySelector("[data-live-market-value]");
    const liveFloatingPnl = container.querySelector("[data-live-floating-pnl]");
    const liveNextAction = container.querySelector("[data-live-next-action]");

    if (liveShares) {
      liveShares.textContent = formatShares(summary.totalShares);
    }
    if (liveCost) {
      liveCost.textContent = displayPriceOrPending(summary.averageCost, "待填", 3);
    }
    if (liveMarketValue) {
      liveMarketValue.textContent = summary.marketValueText;
    }
    if (liveFloatingPnl) {
      liveFloatingPnl.textContent = summary.floatingPnlText;
      liveFloatingPnl.className = getProfitClass(summary.floatingPnl);
    }
    if (liveNextAction) {
      liveNextAction.textContent = nextActionText;
    }

    container.querySelectorAll(".position-row").forEach((row) => {
      const amountNode = row.querySelector("[data-live-amount]");
      if (!amountNode) {
        return;
      }

      const price = parseNullableNumber(row.querySelector('[data-field="price"]').value);
      const shares = parseNullableInteger(row.querySelector('[data-field="shares"]').value);
      amountNode.textContent = formatCurrencyOrPending(computeAmount(price, shares));
    });

    container.querySelectorAll(".plan-row").forEach((row) => {
      const kind = row.dataset.planKind;
      const draftPlan = buildPlanFromRow(row, kind, null, container.dataset.holdingId);
      const sellAmount = row.querySelector("[data-live-sell-amount]");
      const buyAmount = row.querySelector("[data-live-buy-amount]");
      const tradeProfit = row.querySelector("[data-live-trade-profit]");

      if (sellAmount) {
        sellAmount.textContent = formatCurrencyOrPending(computeSellAmount(draftPlan));
      }
      if (buyAmount) {
        buyAmount.textContent = formatCurrencyOrPending(computeBuyAmount(draftPlan));
      }
      if (tradeProfit) {
        const profit = computeTradeExpectedProfit(draftPlan);
        tradeProfit.textContent = formatProfitOrPending(profit);
        tradeProfit.className = getProfitClass(profit);
      }
    });
  }

  function saveDetailEditor(container, options) {
    clearDetailAutoSaveTimer();
    const result = buildEditorDraft(container, {
      previewOnly: false
    });
    if (!result) {
      return;
    }

    state.holdings = state.holdings.map((holding) => holding.id === result.holding.id ? result.holding : holding);
    state.positionLots = state.positionLots
      .filter((lot) => lot.holdingId !== result.holding.id)
      .concat(result.positionLots);
    state.plans = state.plans
      .filter((plan) => plan.holdingId !== result.holding.id)
      .concat(result.plans);
    state = finalizeState(state);
    saveState();
    renderHomeView();
    updateDetailStaticSummary();
    setDetailSaveStatus((options && options.saveMessage) || "已自动保存");
    void syncFullState({
      successMessage: "已同步当前股票详情",
      skipRender: true
    });

    result.notices.forEach((notice) => {
      window.alert(notice);
    });
  }

  function updateDetailStaticSummary() {
    const holding = selectedHoldingId ? getHoldingById(selectedHoldingId) : null;
    if (!holding) {
      return;
    }

    const summary = computeHoldingMetrics(holding);
    const nextAction = computePlanSummary(holding.id);
    const positionSummary = computePositionSummary(getPositionLotsForHolding(holding.id), holding.currentPrice);
    const container = detailContent.querySelector("[data-holding-editor]");
    if (!container) {
      return;
    }

    const liveShares = container.querySelector("[data-live-shares]");
    const liveCost = container.querySelector("[data-live-cost]");
    const liveMarketValue = container.querySelector("[data-live-market-value]");
    const liveFloatingPnl = container.querySelector("[data-live-floating-pnl]");
    const liveNextAction = container.querySelector("[data-live-next-action]");

    if (liveShares) {
      liveShares.textContent = formatShares(positionSummary.totalShares);
    }
    if (liveCost) {
      liveCost.textContent = displayPriceOrPending(positionSummary.averageCost, "待填", 3);
    }
    if (liveMarketValue) {
      liveMarketValue.textContent = summary.marketValueText;
    }
    if (liveFloatingPnl) {
      liveFloatingPnl.textContent = summary.floatingPnlText;
      liveFloatingPnl.className = getProfitClass(summary.floatingPnl);
    }
    if (liveNextAction) {
      liveNextAction.textContent = nextAction.nextActionText;
    }
  }

  function setDetailSaveStatus(message) {
    detailSaveStatusText = message || "";
    const saveNode = detailContent.querySelector(".detail-save");
    if (saveNode) {
      saveNode.textContent = detailSaveStatusText || "自动保存已开启";
    }
  }

  function buildEditorDraft(container, options) {
    const holdingId = container.dataset.holdingId;
    const currentHolding = getHoldingById(holdingId);
    if (!currentHolding) {
      return null;
    }

    const previewOnly = Boolean(options && options.previewOnly);
    const currentPlans = getPlansForHolding(holdingId);
    const currentPlanMap = new Map(currentPlans.map((plan) => [plan.id, plan]));
    const notices = [];

    const nextHolding = normalizeHolding({
      ...currentHolding,
      currentPrice: parseNullableNumber(container.querySelector('[data-holding-field="currentPrice"]')?.value),
      status: String(container.querySelector('[data-holding-field="status"]')?.value || "").trim(),
      reflectionNote: normalizeNoteText(container.querySelector('[data-holding-field="strategyText"]')?.value || currentHolding.reflectionNote)
    });

    const nextPositionLots = Array.from(container.querySelectorAll(".position-row")).map((row) => {
      return normalizePositionLot({
        id: row.dataset.positionId,
        holdingId,
        side: row.querySelector('[data-field="side"]').value,
        label: String(row.querySelector('[data-field="label"]').value || "").trim(),
        price: parseNullableNumber(row.querySelector('[data-field="price"]').value),
        shares: parseNullableInteger(row.querySelector('[data-field="shares"]').value),
        note: String(row.querySelector('[data-field="note"]').value || "").trim(),
        createdAt: row.dataset.createdAt || ""
      });
    });

    const nextPlans = Array.from(container.querySelectorAll(".plan-row")).map((row) => {
      const oldPlan = currentPlanMap.get(row.dataset.planId);
      return buildPlanFromRow(row, row.dataset.planKind, oldPlan, holdingId);
    });

    if (!previewOnly) {
      applyPlanExecutions(nextPlans, currentPlanMap, nextPositionLots, notices);
    }

    const computedHolding = syncHoldingFromPositionLots(nextHolding, nextPositionLots);

    return {
      holding: computedHolding,
      positionLots: nextPositionLots,
      plans: nextPlans,
      notices
    };
  }

  function buildPlanFromRow(row, kind, oldPlan, holdingId) {
    const base = oldPlan || {};
    return normalizePlan({
      ...base,
      id: row.dataset.planId,
      holdingId,
      kind,
      label: base.label || row.dataset.planId,
      status: row.querySelector('[data-field="status"]')?.value || base.status,
      note: String(row.querySelector('[data-field="note"]')?.value || "").trim(),
      purpose: String(row.querySelector('[data-field="purpose"]')?.value || "").trim(),
      useAfterBuy: String(row.querySelector('[data-field="useAfterBuy"]')?.value || "").trim(),
      triggerPrice: parseNullableNumber(row.querySelector('[data-field="triggerPrice"]')?.value),
      sellPrice: parseNullableNumber(row.querySelector('[data-field="sellPrice"]')?.value),
      sellShares: parseNullableInteger(row.querySelector('[data-field="sellShares"]')?.value),
      buyPrice: parseNullableNumber(row.querySelector('[data-field="buyPrice"]')?.value),
      buyShares: parseNullableInteger(row.querySelector('[data-field="buyShares"]')?.value),
      actualSellPrice: parseNullableNumber(row.querySelector('[data-field="actualSellPrice"]')?.value),
      actualBuyPrice: parseNullableNumber(row.querySelector('[data-field="actualBuyPrice"]')?.value),
      actualProfit: parseNullableNumber(row.querySelector('[data-field="actualProfit"]')?.value)
    });
  }

  function applyPlanExecutions(nextPlans, currentPlanMap, nextPositionLots, notices) {
    nextPlans.forEach((plan) => {
      const oldPlan = currentPlanMap.get(plan.id);

      if (oldPlan && oldPlan.applied && oldPlan.status === PLAN_STATUS.DONE && plan.status !== PLAN_STATUS.DONE) {
        plan.applied = true;
        notices.push("已执行计划不会自动回滚持仓。如需撤销，请手动调整持仓记录。");
        return;
      }

      if (plan.status !== PLAN_STATUS.DONE || plan.applied) {
        return;
      }

      const nextEntries = createPositionEntriesFromPlan(plan);
      nextEntries.forEach((entry) => {
        nextPositionLots.push(entry);
      });

      if (plan.kind === PLAN_KIND.TRADE) {
        const realizedProfit = Number.isFinite(plan.actualProfit) ? plan.actualProfit : computeTradeExpectedProfit(plan);
        plan.executionCount = Math.max(0, Number(oldPlan && oldPlan.executionCount || 0)) + 1;
        plan.totalTProfit = Number(oldPlan && oldPlan.totalTProfit || 0) + (Number.isFinite(realizedProfit) ? realizedProfit : 0);
        if (!Number.isFinite(plan.actualProfit) && Number.isFinite(realizedProfit)) {
          plan.actualProfit = realizedProfit;
        }
      }

      plan.applied = true;
    });
  }

  function createPositionEntriesFromPlan(plan) {
    const createdAt = formatDateTime(new Date());
    const entries = [];

    if (plan.kind === PLAN_KIND.SELL && Number.isFinite(plan.sellShares)) {
      entries.push(normalizePositionLot({
        id: `${plan.id}-sell-${Date.now()}`,
        holdingId: plan.holdingId,
        side: POSITION_SIDE.SELL,
        label: plan.purpose || "计划卖出执行",
        price: coalesceNumber(plan.actualSellPrice, plan.sellPrice),
        shares: plan.sellShares,
        note: plan.note,
        createdAt,
        source: "plan"
      }));
    }

    if (plan.kind === PLAN_KIND.ADD && Number.isFinite(plan.buyShares)) {
      entries.push(normalizePositionLot({
        id: `${plan.id}-buy-${Date.now()}`,
        holdingId: plan.holdingId,
        side: POSITION_SIDE.BUY,
        label: plan.useAfterBuy || "补仓买入",
        price: plan.buyPrice,
        shares: plan.buyShares,
        note: plan.note,
        createdAt,
        source: "plan"
      }));
    }

    if (plan.kind === PLAN_KIND.TRADE) {
      if (Number.isFinite(plan.sellShares)) {
        entries.push(normalizePositionLot({
          id: `${plan.id}-trade-sell-${Date.now()}`,
          holdingId: plan.holdingId,
          side: POSITION_SIDE.SELL,
          label: "T卖出执行",
          price: coalesceNumber(plan.actualSellPrice, plan.sellPrice),
          shares: plan.sellShares,
          note: plan.note,
          createdAt,
          source: "plan"
        }));
      }
      if (Number.isFinite(plan.buyShares)) {
        entries.push(normalizePositionLot({
          id: `${plan.id}-trade-buy-${Date.now()}-2`,
          holdingId: plan.holdingId,
          side: POSITION_SIDE.BUY,
          label: "T买回执行",
          price: coalesceNumber(plan.actualBuyPrice, plan.buyPrice),
          shares: plan.buyShares,
          note: plan.note,
          createdAt,
          source: "plan"
        }));
      }
    }

    return entries;
  }

  function computeAccountSummary(accountId) {
    const account = getAccountById(accountId);
    const holdings = getHoldingsByAccount(accountId);
    const marketValue = sumKnown(holdings.map((holding) => getHoldingMarketValueNumber(holding)));
    const availableCash = getAccountAvailableCashNumber(account);
    const floatingPnl = sumKnown(holdings.map((holding) => getHoldingFloatingPnl(holding)));

    return {
      totalAssetText: formatCurrency(marketValue + (availableCash || 0)),
      marketValueText: formatCurrency(marketValue),
      availableCashText: formatCurrencyOrPending(availableCash),
      floatingPnlText: formatProfitOrPending(floatingPnl, "¥0"),
      floatingPnlNumber: floatingPnl
    };
  }

  function computeHomeSummary() {
    const marketValue = sumKnown(state.holdings.map((holding) => getHoldingMarketValueNumber(holding)));
    const availableCash = sumKnown(state.accounts.map((account) => getAccountAvailableCashNumber(account)));
    const otherFunds = getBankCashNumber();
    const floatingPnl = sumKnown(state.holdings.map((holding) => getHoldingFloatingPnl(holding)));

    return {
      totalAssetText: formatCurrency(marketValue + availableCash + (otherFunds || 0)),
      marketValueText: formatCurrency(marketValue),
      availableCashText: formatCurrencyOrPending(availableCash),
      otherFundsText: formatCurrencyOrPending(otherFunds),
      floatingPnlText: formatProfitOrPending(floatingPnl, "¥0"),
      floatingPnlNumber: floatingPnl
    };
  }

  function computeHoldingMetrics(holding) {
    const marketValueNumber = getHoldingMarketValueNumber(holding);
    const floatingPnl = getHoldingFloatingPnl(holding);
    return {
      marketValueNumber,
      marketValueText: formatCurrencyOrPending(marketValueNumber),
      floatingPnl,
      floatingPnlText: formatProfitOrPending(floatingPnl)
    };
  }

  function computePlanSummary(holdingId) {
    const holding = getHoldingById(holdingId);
    return computePlanSummaryFromPlans(getPlansForHolding(holdingId), holding ? holding.currentPrice : null);
  }

  function computePlanSummaryFromPlans(plans, currentPrice) {
    const candidates = plans.flatMap((plan) => getPlanCandidates(plan, currentPrice));
    const nextCandidate = pickBestCandidate(candidates);
    return {
      hasNextPlan: Boolean(nextCandidate),
      nextActionText: nextCandidate ? nextCandidate.text : "暂无计划",
      nextPlanStatus: nextCandidate ? nextCandidate.status : "",
      candidatePrice: nextCandidate ? nextCandidate.price : null
    };
  }

  function getPlanCandidates(plan, currentPrice) {
    if (!activePlanStatuses.has(plan.status)) {
      return [];
    }

    if (plan.kind === PLAN_KIND.SELL) {
      return [{
        id: `${plan.id}-sell`,
        planId: plan.id,
        status: plan.status,
        price: plan.sellPrice,
        distance: computePriceDistance(currentPrice, plan.sellPrice),
        text: buildSellPlanLabel(plan)
      }];
    }

    if (plan.kind === PLAN_KIND.ADD) {
      return [{
        id: `${plan.id}-add`,
        planId: plan.id,
        status: plan.status,
        price: plan.buyPrice,
        distance: computePriceDistance(currentPrice, plan.buyPrice),
        text: buildAddPlanLabel(plan)
      }];
    }

    if (plan.kind === PLAN_KIND.TRADE) {
      const list = [];
      if (Number.isFinite(plan.sellPrice) || Number.isFinite(plan.sellShares)) {
        list.push({
          id: `${plan.id}-t-sell`,
          planId: plan.id,
          status: plan.status,
          price: plan.sellPrice,
          distance: computePriceDistance(currentPrice, plan.sellPrice),
          text: buildTradeLegLabel("T卖出", plan.sellPrice, plan.sellShares)
        });
      }
      if (Number.isFinite(plan.buyPrice) || Number.isFinite(plan.buyShares)) {
        list.push({
          id: `${plan.id}-t-buy`,
          planId: plan.id,
          status: plan.status,
          price: plan.buyPrice,
          distance: computePriceDistance(currentPrice, plan.buyPrice),
          text: buildTradeLegLabel("T买回", plan.buyPrice, plan.buyShares)
        });
      }
      return list;
    }

    return [{
      id: `${plan.id}-watch`,
      planId: plan.id,
      status: plan.status,
      price: plan.triggerPrice,
      distance: computePriceDistance(currentPrice, plan.triggerPrice),
      text: getWatchPlanLabel(plan)
    }];
  }

  function pickBestCandidate(candidates) {
    if (!candidates.length) {
      return null;
    }

    return [...candidates].sort((left, right) => {
      const waitingDiff = Number(right.status === PLAN_STATUS.WAITING) - Number(left.status === PLAN_STATUS.WAITING);
      if (waitingDiff !== 0) {
        return waitingDiff;
      }

      const leftPriced = Number.isFinite(left.price);
      const rightPriced = Number.isFinite(right.price);
      if (leftPriced !== rightPriced) {
        return Number(rightPriced) - Number(leftPriced);
      }

      if (leftPriced && rightPriced && left.distance !== right.distance) {
        return left.distance - right.distance;
      }

      return String(left.text).localeCompare(String(right.text), "zh-CN");
    })[0];
  }

  function computePriceDistance(currentPrice, targetPrice) {
    if (!Number.isFinite(currentPrice) || !Number.isFinite(targetPrice)) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.abs(Number(currentPrice) - Number(targetPrice));
  }

  function buildSellPlanLabel(plan) {
    const purpose = plan.purpose || "卖出";
    return `${formatPriceOrPending(plan.sellPrice)} ${purpose} ${formatSharesOrPending(plan.sellShares)}`;
  }

  function buildAddPlanLabel(plan) {
    return `${formatPriceOrPending(plan.buyPrice)} 补仓 ${formatSharesOrPending(plan.buyShares)}`;
  }

  function buildTradeLegLabel(label, price, shares) {
    return `${formatPriceOrPending(price)} ${label} ${formatSharesOrPending(shares)}`;
  }

  function getWatchPlanLabel(plan) {
    if (plan.note) {
      return plan.note;
    }
    if (Number.isFinite(plan.triggerPrice)) {
      return `${formatPrice(plan.triggerPrice, 2)} 提醒`;
    }
    return "观察规则";
  }

  function computePositionSummary(positionLots, currentPrice) {
    const ledger = buildPositionLedger(positionLots);
    const marketValue = Number.isFinite(currentPrice) ? ledger.totalShares * currentPrice : null;
    const floatingPnl = Number.isFinite(currentPrice) && Number.isFinite(ledger.costAmount)
      ? marketValue - ledger.costAmount
      : null;

    return {
      totalShares: ledger.totalShares,
      costAmount: ledger.costAmount,
      averageCost: ledger.averageCost,
      marketValue,
      floatingPnl,
      costAmountText: formatCurrencyOrPending(ledger.costAmount),
      averageCostText: displayPriceOrPending(ledger.averageCost, "待填", 3),
      marketValueText: formatCurrencyOrPending(marketValue),
      floatingPnlText: formatProfitOrPending(floatingPnl)
    };
  }

  function buildPositionLedger(positionLots) {
    const lots = Array.isArray(positionLots) ? positionLots : [];
    let totalShares = 0;
    let costAmount = 0;
    let missingCost = false;

    lots.forEach((lot) => {
      const shares = Number.isFinite(lot.shares) ? Number(lot.shares) : 0;
      if (!shares) {
        return;
      }

      if (lot.side === POSITION_SIDE.BUY) {
        totalShares += shares;
        if (Number.isFinite(lot.price)) {
          costAmount += lot.price * shares;
        } else {
          missingCost = true;
        }
        return;
      }

      const sharesToSell = Math.min(shares, totalShares);
      const averageCost = totalShares > 0 ? costAmount / totalShares : 0;
      totalShares -= sharesToSell;
      costAmount -= averageCost * sharesToSell;
    });

    costAmount = totalShares > 0 ? Math.max(0, costAmount) : 0;
    const averageCost = totalShares > 0 && !missingCost ? costAmount / totalShares : (totalShares > 0 ? costAmount / totalShares : null);

    return {
      totalShares: clampShares(totalShares),
      costAmount: totalShares > 0 ? costAmount : 0,
      averageCost: totalShares > 0 ? averageCost : null
    };
  }

  function groupPlansByKind(holdingId) {
    const grouped = {
      [PLAN_KIND.SELL]: [],
      [PLAN_KIND.TRADE]: [],
      [PLAN_KIND.ADD]: [],
      [PLAN_KIND.WATCH]: []
    };

    getPlansForHolding(holdingId).forEach((plan) => {
      grouped[plan.kind] = grouped[plan.kind] || [];
      grouped[plan.kind].push(plan);
    });

    return grouped;
  }

  function getAccountById(accountId) {
    return state.accounts.find((account) => account.id === accountId) || null;
  }

  function getHoldingsByAccount(accountId) {
    return state.holdings.filter((holding) => holding.accountId === accountId);
  }

  function getHoldingById(holdingId) {
    return state.holdings.find((holding) => holding.id === holdingId) || null;
  }

  function getPlansForHolding(holdingId) {
    return state.plans.filter((plan) => plan.holdingId === holdingId);
  }

  function getPositionLotsForHolding(holdingId) {
    return state.positionLots.filter((lot) => lot.holdingId === holdingId);
  }

  function getHoldingMarketValueNumber(holding) {
    if (Number.isFinite(holding.currentPrice) && Number.isFinite(holding.shares)) {
      return holding.shares * holding.currentPrice;
    }
    if (Number.isFinite(holding.marketValueOverride)) {
      return holding.marketValueOverride;
    }
    return null;
  }

  function getHoldingFloatingPnl(holding) {
    if (Number.isFinite(holding.currentPrice) && Number.isFinite(holding.cost) && Number.isFinite(holding.shares)) {
      return holding.shares * holding.currentPrice - holding.shares * holding.cost;
    }
    if (Number.isFinite(holding.floatingPnlOverride)) {
      return holding.floatingPnlOverride;
    }
    return null;
  }

  function getAccountAvailableCashNumber(account) {
    return account && Number.isFinite(account.availableCash) ? Number(account.availableCash) : null;
  }

  function getBankCashNumber() {
    return Number.isFinite(state.bankCash) ? Number(state.bankCash) : null;
  }

  function normalizeState(source) {
    const raw = source && typeof source === "object" ? source : {};
    const holdings = normalizeHoldings(raw.holdings);
    return finalizeState({
      bankCash: parseNullableNumber(raw.bankCash),
      accounts: normalizeAccounts(raw.accounts),
      holdings,
      positionLots: normalizePositionLots(raw.positionLots, holdings),
      plans: normalizePlans(raw.plans)
    });
  }

  function finalizeState(inputState) {
    const nextState = {
      bankCash: parseNullableNumber(inputState.bankCash),
      accounts: normalizeAccounts(inputState.accounts),
      holdings: normalizeHoldings(inputState.holdings),
      positionLots: normalizePositionLots(inputState.positionLots, normalizeHoldings(inputState.holdings)),
      plans: normalizePlans(inputState.plans)
    };

    nextState.holdings = nextState.holdings.map((holding) => {
      return syncHoldingFromPositionLots(holding, nextState.positionLots.filter((lot) => lot.holdingId === holding.id));
    });

    return nextState;
  }

  function mergeState(baseState, overrideState) {
    return finalizeState({
      bankCash: overrideState.bankCash === null ? baseState.bankCash : overrideState.bankCash,
      accounts: mergeArrayById(baseState.accounts, overrideState.accounts, mergeAccount),
      holdings: mergeArrayById(baseState.holdings, overrideState.holdings, mergeHolding),
      positionLots: mergeArrayById(baseState.positionLots || [], overrideState.positionLots || [], mergePositionLot),
      plans: mergeArrayById(baseState.plans, overrideState.plans, mergePlan)
    });
  }

  function mergeArrayById(baseList, overrideList, merger) {
    const base = Array.isArray(baseList) ? baseList : [];
    const overrides = Array.isArray(overrideList) ? overrideList : [];
    const overrideMap = new Map(overrides.map((item) => [item.id, item]));
    const merged = base.map((item) => merger(item, overrideMap.get(item.id) || null));

    overrides.forEach((item) => {
      if (!base.some((entry) => entry.id === item.id)) {
        merged.push(merger(null, item));
      }
    });

    return merged;
  }

  function mergeAccount(baseAccount, overrideAccount) {
    return normalizeAccount({
      ...(baseAccount || {}),
      ...(overrideAccount || {})
    });
  }

  function mergeHolding(baseHolding, overrideHolding) {
    return normalizeHolding({
      ...(baseHolding || {}),
      ...(overrideHolding || {}),
      extraNote: overrideHolding && overrideHolding.extraNote !== undefined ? overrideHolding.extraNote : baseHolding && baseHolding.extraNote,
      risk: overrideHolding && overrideHolding.risk !== undefined ? overrideHolding.risk : baseHolding && baseHolding.risk
    });
  }

  function mergePositionLot(baseLot, overrideLot) {
    return normalizePositionLot({
      ...(baseLot || {}),
      ...(overrideLot || {})
    });
  }

  function mergePlan(basePlan, overridePlan) {
    return normalizePlan({
      ...(basePlan || {}),
      ...(overridePlan || {})
    });
  }

  function normalizeAccounts(source) {
    const list = Array.isArray(source) ? source : [];
    return list.map(normalizeAccount).filter((account) => account.id);
  }

  function normalizeAccount(source) {
    return {
      id: String((source && source.id) || "").trim(),
      label: String((source && source.label) || "").trim(),
      name: String((source && source.name) || "").trim(),
      availableCash: parseNullableNumber(source && source.availableCash)
    };
  }

  function normalizeHoldings(source) {
    const list = Array.isArray(source) ? source : [];
    return list.map(normalizeHolding).filter((holding) => holding.id);
  }

  function normalizeHolding(source) {
    return {
      id: String((source && source.id) || "").trim(),
      accountId: String((source && source.accountId) || "").trim(),
      name: String((source && source.name) || "").trim(),
      code: String((source && source.code) || "").trim(),
      shares: clampShares(source && source.shares),
      cost: parseNullableNumber(source && source.cost),
      currentPrice: parseNullableNumber(source && source.currentPrice),
      status: String((source && source.status) || "").trim(),
      risk: String((source && source.risk) || "").trim(),
      extraNote: String((source && source.extraNote) || "").trim(),
      reflectionNote: normalizeNoteText(source && source.reflectionNote),
      marketValueOverride: parseNullableNumber(source && source.marketValueOverride),
      floatingPnlOverride: parseNullableNumber(source && source.floatingPnlOverride)
    };
  }

  function normalizePositionLots(source, holdings) {
    const list = Array.isArray(source) ? source : [];
    if (list.length) {
      return list.map(normalizePositionLot).filter((lot) => lot.id && lot.holdingId);
    }

    const holdingList = Array.isArray(holdings) ? holdings : [];
    return holdingList
      .filter((holding) => Number(holding.shares || 0) > 0)
      .map((holding) => {
        return normalizePositionLot({
          id: `${holding.id}-initial`,
          holdingId: holding.id,
          side: POSITION_SIDE.BUY,
          label: "初始持仓",
          price: holding.cost,
          shares: holding.shares,
          note: "",
          createdAt: "",
          source: "legacy"
        });
      });
  }

  function normalizePositionLot(source) {
    return {
      id: String((source && source.id) || "").trim(),
      holdingId: String((source && source.holdingId) || "").trim(),
      side: String((source && source.side) || POSITION_SIDE.BUY).trim() === POSITION_SIDE.SELL ? POSITION_SIDE.SELL : POSITION_SIDE.BUY,
      label: String((source && (source.label || source.status)) || "已买入").trim(),
      price: parseNullableNumber(source && (source.price !== undefined ? source.price : source.buyPrice)),
      shares: clampShares(source && source.shares),
      note: String((source && source.note) || "").trim(),
      createdAt: String((source && source.createdAt) || "").trim(),
      source: String((source && source.source) || "manual").trim()
    };
  }

  function normalizePlans(source) {
    const list = Array.isArray(source) ? source : [];
    return list.map(normalizePlan).filter((plan) => plan.id && plan.holdingId);
  }

  function normalizePlan(source) {
    const raw = source && typeof source === "object" ? source : {};
    const legacyType = String(raw.type || "").trim();
    const detectedKind = normalizePlanKind(raw.kind || inferPlanKindFromLegacyType(legacyType));
    const normalizedStatus = normalizePlanStatus(raw.status);

    return {
      id: String(raw.id || "").trim(),
      holdingId: String(raw.holdingId || "").trim(),
      label: String(raw.label || "").trim(),
      kind: detectedKind,
      status: normalizedStatus,
      note: String(raw.note || "").trim(),
      purpose: String(raw.purpose || (detectedKind === PLAN_KIND.SELL ? raw.note || "" : "")).trim(),
      useAfterBuy: String(raw.useAfterBuy || "待定").trim(),
      triggerPrice: parseNullableNumber(raw.triggerPrice),
      sellPrice: parseNullableNumber(raw.sellPrice !== undefined ? raw.sellPrice : (legacyType === "卖出" || legacyType === "T卖出" ? raw.triggerPrice : null)),
      sellShares: parseNullableInteger(raw.sellShares !== undefined ? raw.sellShares : (legacyType === "卖出" || legacyType === "T卖出" ? raw.shares : null)),
      buyPrice: parseNullableNumber(raw.buyPrice !== undefined ? raw.buyPrice : (legacyType === "买入" || legacyType === "T买回" ? raw.triggerPrice : null)),
      buyShares: parseNullableInteger(raw.buyShares !== undefined ? raw.buyShares : (legacyType === "买入" || legacyType === "T买回" ? raw.shares : null)),
      actualSellPrice: parseNullableNumber(raw.actualSellPrice),
      actualBuyPrice: parseNullableNumber(raw.actualBuyPrice),
      actualProfit: parseNullableNumber(raw.actualProfit),
      executionCount: Math.max(0, parseNullableInteger(raw.executionCount) || 0),
      totalTProfit: parseNullableNumber(raw.totalTProfit) || 0,
      applied: parseBoolean(raw.applied, normalizedStatus === PLAN_STATUS.DONE)
    };
  }

  function inferPlanKindFromLegacyType(type) {
    if (type === "卖出") {
      return PLAN_KIND.SELL;
    }
    if (type === "T卖出" || type === "T买回") {
      return PLAN_KIND.TRADE;
    }
    if (type === "买入") {
      return PLAN_KIND.ADD;
    }
    return PLAN_KIND.WATCH;
  }

  function normalizePlanKind(value) {
    const raw = String(value || "").trim();
    if (raw === PLAN_KIND.SELL || raw === PLAN_KIND.TRADE || raw === PLAN_KIND.ADD || raw === PLAN_KIND.WATCH) {
      return raw;
    }
    return PLAN_KIND.WATCH;
  }

  function normalizePlanStatus(value) {
    const raw = String(value || PLAN_STATUS.PENDING).trim();
    if (raw === "已取消") {
      return PLAN_STATUS.CANCELLED;
    }
    return planStatusOptions.includes(raw) ? raw : PLAN_STATUS.PENDING;
  }

  function syncHoldingFromPositionLots(holding, allLots) {
    const lots = Array.isArray(allLots) ? allLots.filter((lot) => lot.holdingId === holding.id) : [];
    if (!lots.length) {
      return normalizeHolding(holding);
    }

    const ledger = buildPositionLedger(lots);
    return normalizeHolding({
      ...holding,
      shares: ledger.totalShares,
      cost: ledger.averageCost,
      marketValueOverride: null,
      floatingPnlOverride: null
    });
  }

  function createEmptyPositionLot(holdingId) {
    return normalizePositionLot({
      id: `${holdingId}-position-${Date.now()}`,
      holdingId,
      side: POSITION_SIDE.BUY,
      label: "已买入",
      price: null,
      shares: null,
      note: "",
      createdAt: formatDateTime(new Date()),
      source: "manual"
    });
  }

  function createEmptyPlan(holdingId, kind) {
    const nextNumber = getPlansForHolding(holdingId)
      .filter((plan) => plan.kind === kind)
      .length + 1;

    return normalizePlan({
      id: `${holdingId}-${kind}-${Date.now()}`,
      holdingId,
      kind,
      label: `${planKindLabels[kind] || "计划"}${nextNumber}`,
      status: PLAN_STATUS.PENDING,
      note: "",
      useAfterBuy: "待定",
      executionCount: 0,
      totalTProfit: 0,
      applied: false
    });
  }

  async function importState(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const importedState = normalizeState(parsed && parsed.state ? parsed.state : parsed);
      const confirmed = window.confirm("确认用导入的 JSON 覆盖当前数据吗？");
      if (!confirmed) {
        return;
      }

      state = finalizeState(mergeState(defaultState, importedState));
      selectedHoldingId = null;
      selectedDetailTab = DETAIL_TAB.POSITION;
      saveState();
      renderApp();
      await syncFullState({
        successMessage: "已同步导入的数据",
        skipRender: true
      });
    } catch (error) {
      window.alert("导入失败，请确认这是有效的 JSON 文件。");
    }
  }

  function exportState() {
    const payload = {
      app: exportedAppName,
      exportedAt: formatDateTime(new Date()),
      state
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `linqing-trade-board-${formatDateForFile(new Date())}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function renderOptionList(options, currentValue) {
    return options.map((option) => {
      const selected = option.value === currentValue ? " selected" : "";
      return `<option value="${escapeAttribute(option.value)}"${selected}>${escapeHtml(option.label)}</option>`;
    }).join("");
  }

  function renderPlanStatusOptions(currentValue) {
    return renderOptionList(planStatusOptions.map((status) => ({ value: status, label: status })), currentValue);
  }

  function computeAmount(price, shares) {
    if (!Number.isFinite(price) || !Number.isFinite(shares)) {
      return null;
    }
    return price * shares;
  }

  function computeSellAmount(plan) {
    return computeAmount(plan.sellPrice, plan.sellShares);
  }

  function computeBuyAmount(plan) {
    return computeAmount(plan.buyPrice, plan.buyShares);
  }

  function computeTradeExpectedProfit(plan) {
    if (!Number.isFinite(plan.sellPrice) || !Number.isFinite(plan.buyPrice)) {
      return null;
    }
    const shares = Number.isFinite(plan.sellShares) ? plan.sellShares : plan.buyShares;
    if (!Number.isFinite(shares)) {
      return null;
    }
    return (plan.sellPrice - plan.buyPrice) * shares;
  }

  function getEntryAmount(lot) {
    return computeAmount(lot.price, lot.shares);
  }

  function sumKnown(values) {
    return (Array.isArray(values) ? values : []).reduce((sum, value) => {
      return sum + (Number.isFinite(value) ? Number(value) : 0);
    }, 0);
  }

  function clampShares(value) {
    return Math.max(0, Math.round(Number(value || 0)));
  }

  function parseNullableNumber(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    const cleaned = String(value).replace(/[^\d.-]/g, "");
    if (!cleaned) {
      return null;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseNullableInteger(value) {
    const parsed = parseNullableNumber(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }

  function parseBoolean(value, fallback) {
    if (typeof value === "boolean") {
      return value;
    }
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return Boolean(fallback);
  }

  function normalizeNoteText(value) {
    return String(value || "").replace(/\r\n/g, "\n").trim();
  }

  function formatCurrency(value) {
    return `¥${Number(value || 0).toLocaleString("zh-CN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    })}`;
  }

  function formatCurrencyOrPending(value, fallback) {
    if (!Number.isFinite(value)) {
      return fallback || "待填";
    }
    return formatCurrency(value);
  }

  function formatProfit(value) {
    const number = Number(value || 0);
    const sign = number > 0 ? "+" : "";
    return `${sign}${formatCurrency(number)}`;
  }

  function formatProfitOrPending(value, fallback) {
    if (!Number.isFinite(value)) {
      return fallback || "待填";
    }
    return formatProfit(value);
  }

  function formatPrice(value, digits) {
    return Number(value || 0).toFixed(Number.isFinite(digits) ? digits : 2);
  }

  function formatPriceOrPending(value) {
    return Number.isFinite(value) ? formatPrice(value, 2) : "待定";
  }

  function formatShares(value) {
    return `${Number(value || 0).toLocaleString("zh-CN")}股`;
  }

  function formatSharesOrPending(value) {
    return Number.isFinite(value) ? formatShares(value) : "待定股数";
  }

  function formatInputNumber(value, digits) {
    if (!Number.isFinite(value)) {
      return "";
    }
    return Number(value).toFixed(Number.isFinite(digits) ? digits : 2);
  }

  function displayPriceOrPending(value, fallback, digits) {
    return Number.isFinite(value) ? formatPrice(value, Number.isFinite(digits) ? digits : 2) : fallback;
  }

  function formatDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }

  function formatDateForFile(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${year}${month}${day}-${hour}${minute}`;
  }

  function coalesceNumber(...values) {
    for (const value of values) {
      if (Number.isFinite(value)) {
        return Number(value);
      }
    }
    return null;
  }

  function getProfitClass(value) {
    if (!Number.isFinite(value)) {
      return "profit-neutral";
    }
    if (value > 0) {
      return "profit-positive";
    }
    if (value < 0) {
      return "profit-negative";
    }
    return "profit-neutral";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  const labelList = document.createElement("datalist");
  labelList.id = "position-labels";
  labelList.innerHTML = positionLabelOptions.map((item) => `<option value="${escapeAttribute(item)}"></option>`).join("");
  document.body.appendChild(labelList);
})();
