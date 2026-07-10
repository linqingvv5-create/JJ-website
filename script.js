(function () {
  const storageKey = "linqing-minimal-trade-board-state-v3";
  const exportedAppName = "linqing-minimal-trade-board";
  const PLAN_STATUS = {
    PENDING: "未触发",
    WAITING: "已触发待执行",
    DONE: "已执行",
    PAUSED: "暂停",
    CANCELLED: "取消"
  };
  const PLAN_TYPE = {
    BUY: "买入",
    T_BUY: "T买回",
    SELL: "卖出",
    T_SELL: "T卖出",
    WATCH: "观察"
  };
  const planTypeOptions = [
    PLAN_TYPE.BUY,
    PLAN_TYPE.T_BUY,
    PLAN_TYPE.SELL,
    PLAN_TYPE.T_SELL,
    PLAN_TYPE.WATCH
  ];
  const statusOptions = Object.values(PLAN_STATUS);
  const activePlanStatuses = new Set([PLAN_STATUS.PENDING, PLAN_STATUS.WAITING]);
  const buyTypes = new Set([PLAN_TYPE.BUY, PLAN_TYPE.T_BUY]);
  const sellTypes = new Set([PLAN_TYPE.SELL, PLAN_TYPE.T_SELL]);
  const FAMILY_BYD_HOLDING_ID = "family-002594";
  const FAMILY_BYD_LEGACY_PLAN_ID = "family-byd-plan-1";
  const syncClientKey = "linqing-minimal-trade-board-client-id";
  const tradeViewModeKey = "linqing-minimal-trade-board-view-mode";
  const syncApiStateUrl = "/api/state";
  const syncApiActionUrl = "/api/actions";
  const syncPollIntervalMs = 5000;
  const appData = window.APP_DATA || {};
  const defaultState = normalizeState(appData);

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
  let selectedMode = "detail";
  let detailAutoSaveTimerId = 0;
  let detailSaveStatusText = "";
  let tradeViewPreference = loadTradeViewPreference();
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
        toggleTradeViewMode();
      });
    }

    backButton.addEventListener("click", () => {
      clearDetailAutoSaveTimer();
      detailSaveStatusText = "";
      selectedHoldingId = null;
      selectedMode = "detail";
      renderApp();
    });

    resetButton.addEventListener("click", async () => {
      const confirmed = window.confirm("确认重置为当前修正后的初始数据吗？你在网页里的修改会被覆盖。");
      if (!confirmed) {
        return;
      }

      state = clone(defaultState);
      selectedHoldingId = null;
      selectedMode = "detail";
      saveState();
      renderApp();
      await syncFullState({
        successMessage: "已同步重置后的数据",
        skipRender: true
      });
    });

    exportButton.addEventListener("click", () => {
      exportState();
    });

    importButton.addEventListener("click", () => {
      importFile.click();
    });

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
      selectedMode = button.dataset.openMode || "detail";
      renderApp();
    });

    accountList.addEventListener("change", (event) => {
      const bankCashInput = event.target.closest("[data-home-bank-cash]");
      if (bankCashInput) {
        state.bankCash = parseNullableNumber(bankCashInput.value);
        saveState();
        renderHomeView();
        void syncAction({
          type: "updateBankCash",
          bankCash: state.bankCash
        }, {
          successMessage: "已同步银行资金",
          skipRender: true
        });
        return;
      }

      const cashInput = event.target.closest("[data-home-cash]");
      if (cashInput) {
        const account = getAccountById(cashInput.dataset.homeCash);
        if (!account) {
          return;
        }

        account.availableCash = parseNullableNumber(cashInput.value);
        saveState();
        renderHomeView();
        void syncAction({
          type: "updateAccountCash",
          accountId: account.id,
          availableCash: account.availableCash
        }, {
          successMessage: "已同步可用资金",
          skipRender: true
        });
        return;
      }

      const input = event.target.closest("[data-home-price]");
      if (!input) {
        return;
      }

      const holding = getHoldingById(input.dataset.homePrice);
      if (!holding) {
        return;
      }

      holding.currentPrice = parseNullableNumber(input.value);
      clearHoldingDerivedValues(holding);
      saveState();
      renderApp();
      void syncAction({
        type: "updateHoldingPrice",
        holdingId: holding.id,
        currentPrice: holding.currentPrice
      }, {
        successMessage: "已同步最新价格",
        skipRender: true
      });
    });

    detailContent.addEventListener("submit", (event) => {
      const form = event.target.closest("#detail-form");
      if (!form) {
        return;
      }

      event.preventDefault();
      saveDetailForm(form, {
        saveMessage: "已保存"
      });
    });

    detailContent.addEventListener("click", (event) => {
      const addPlanButton = event.target.closest("[data-add-plan]");
      if (addPlanButton) {
        addPlanForHolding(addPlanButton.dataset.addPlan);
        return;
      }
    });

    detailContent.addEventListener("input", handleDetailDraftUpdate);
    detailContent.addEventListener("change", handleDetailDraftUpdate);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        void refreshRemoteState({
          allowMissing: true,
          silent: true
        });
      }
    });

    window.addEventListener("resize", () => {
      if (tradeViewPreference === "auto") {
        renderApp();
      }
    });
  }

  function loadState() {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return clone(defaultState);
      }

      const parsed = JSON.parse(raw);
      const importedState = normalizeState(parsed && parsed.state ? parsed.state : parsed);
      return applyStateMigrations(mergeState(defaultState, importedState));
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

  function loadTradeViewPreference() {
    try {
      const raw = String(window.localStorage.getItem(tradeViewModeKey) || "auto").trim();
      return raw === "mobile" || raw === "desktop" ? raw : "auto";
    } catch (error) {
      return "auto";
    }
  }

  function saveTradeViewPreference() {
    try {
      window.localStorage.setItem(tradeViewModeKey, tradeViewPreference);
    } catch (error) {
    }
  }

  function getTradeViewMode() {
    if (tradeViewPreference === "mobile" || tradeViewPreference === "desktop") {
      return tradeViewPreference;
    }

    return window.matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop";
  }

  function toggleTradeViewMode() {
    tradeViewPreference = getTradeViewMode() === "mobile" ? "desktop" : "mobile";
    saveTradeViewPreference();
    renderApp();
  }

  function updateViewToggleButton() {
    if (!viewToggleButton) {
      return;
    }

    const mode = getTradeViewMode();
    viewToggleButton.textContent = mode === "mobile" ? "标准版" : "手机版";
    viewToggleButton.classList.toggle("is-active", mode === "mobile");
    viewToggleButton.title = tradeViewPreference === "auto"
      ? "当前会按屏幕宽度自动切换，你也可以手动锁定成另一种视图。"
      : "已手动切换视图，再点一次可切换到另一种版面。";
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
        setSyncStatus("local", "当前是本地模式，打开 server.py 后可多设备同步");
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
        setSyncStatus("online", "共享服务已连接，等待第一次同步");
        await syncFullState({
          successMessage: "已建立共享数据",
          skipRender: true
        });
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
          setSyncStatus("local", "当前是本地模式，打开 server.py 后可多设备同步");
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
    state = applyStateMigrations(mergeState(defaultState, remoteState));
    saveState();

    if (!nextOptions.skipRender && !isEditingDetailForm()) {
      renderApp();
      return;
    }

    renderSyncStatus();
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
      const form = detailContent.querySelector("#detail-form");
      if (!form) {
        return;
      }

      saveDetailForm(form, {
        saveMessage: "已自动保存"
      });
    }, 180);
  }

  function renderApp() {
    renderHeader();
    renderHomeView();
    renderDetailView();
    renderSyncStatus();
    updateViewToggleButton();
  }

  function renderHeader() {
    const holding = selectedHoldingId ? getHoldingById(selectedHoldingId) : null;

    pageTitle.textContent = "林青交易看板";

    if (!holding) {
      pageSubtitle.textContent = "网页里的修改会自动保存到本地浏览器，刷新后仍会保留。";
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

  function renderHoldingRow(holding) {
    const metrics = computeHoldingMetrics(holding);
    const planSummary = computePlanSummary(holding.id);
    const actionClass = planSummary.hasNextPlan ? "action-tag" : "action-tag action-tag-muted";

    return `
      <tr class="holding-row">
        <td class="stock-cell">
          <strong>${escapeHtml(holding.name)}</strong>
          <span class="stock-code">${escapeHtml(holding.code)}</span>
        </td>
        <td>${escapeHtml(formatShares(holding.shares))}</td>
        <td>${escapeHtml(displayPriceOrPending(holding.cost, "待填", 3))}</td>
        <td>
          <input
            class="table-price-input"
            type="number"
            step="0.001"
            inputmode="decimal"
            data-home-price="${escapeAttribute(holding.id)}"
            value="${escapeAttribute(formatInputNumber(holding.currentPrice, 3))}"
            placeholder="待填"
          >
        </td>
        <td>${escapeHtml(metrics.marketValueText)}</td>
        <td class="${getProfitClass(metrics.floatingPnl)}">${escapeHtml(metrics.floatingPnlText)}</td>
        <td class="status-cell" title="${escapeAttribute(holding.status || "待补充")}">${escapeHtml(holding.status || "待补充")}</td>
        <td>${escapeHtml(planSummary.nextTriggerText)}</td>
        <td title="${escapeAttribute(planSummary.nextActionText)}">
          <span class="${actionClass}">${escapeHtml(planSummary.nextActionText)}</span>
        </td>
        <td>${escapeHtml(String(planSummary.unexecutedCount))}</td>
        <td>
          <div class="row-actions">
            <button class="row-button" type="button" data-open-holding="${escapeAttribute(holding.id)}" data-open-mode="detail">详情</button>
            <button class="row-button row-button-accent" type="button" data-open-holding="${escapeAttribute(holding.id)}" data-open-mode="edit">编辑</button>
          </div>
        </td>
      </tr>
    `;
  }

  function renderEmptyHoldingRow() {
    return `
      <tr class="empty-row">
        <td colspan="11">当前账户暂无持仓。</td>
      </tr>
    `;
  }

  function renderPlanRow(plan) {
    return `
      <tr
        class="plan-row"
        data-plan-id="${escapeAttribute(plan.id)}"
        data-plan-label="${escapeAttribute(plan.label || plan.id)}"
      >
        <td>${escapeHtml(plan.label || plan.id)}</td>
        <td>
          <select class="cell-select" data-field="type">
            ${renderPlanTypeOptions(plan.type)}
          </select>
        </td>
        <td>
          <input
            class="cell-input cell-input-short"
            type="number"
            step="0.001"
            min="0"
            data-field="triggerPrice"
            value="${escapeAttribute(formatInputNumber(plan.triggerPrice, 3))}"
            placeholder="待填"
          >
        </td>
        <td>
          <input
            class="cell-input cell-input-short"
            type="number"
            step="100"
            min="0"
            data-field="shares"
            value="${escapeAttribute(formatInputNumber(plan.shares, 0))}"
            placeholder="待填"
          >
        </td>
        <td data-plan-amount>${escapeHtml(getPlanAmountText(plan))}</td>
        <td>
          <select class="cell-select" data-field="status">
            ${renderStatusOptions(plan.status)}
          </select>
        </td>
        <td>
          <input
            class="cell-input cell-input-note"
            type="text"
            data-field="note"
            value="${escapeAttribute(plan.note || "")}"
            placeholder="备注"
          >
        </td>
      </tr>
    `;
  }

  function renderNoPlans() {
    return `
      <tr class="empty-row">
        <td colspan="7">当前没有买卖计划，点上方“新增一行计划”即可开始编辑。</td>
      </tr>
    `;
  }

  function saveDetailForm(form, options) {
    clearDetailAutoSaveTimer();
    const result = buildDetailDraft(form);
    if (!result) {
      return;
    }

    replaceHolding(result.holding);
    replacePlans(result.holding.id, result.plans);
    saveState();
    syncDetailFormAfterSave(form, result.holding);
    updateDraftSummary(form);
    updateDetailPlanSummary(result.holding.id);
    renderHeader();
    renderHomeView();
    setDetailSaveStatus((options && options.saveMessage) || "已保存");

    result.notices.forEach((notice) => {
      window.alert(notice);
    });
  }

  function buildDetailDraft(form) {
    const holdingId = form.dataset.holdingId;
    const currentHolding = getHoldingById(holdingId);

    if (!currentHolding) {
      return null;
    }

    const currentPlans = getPlansForHolding(holdingId);
    const currentPlanMap = new Map(currentPlans.map((plan) => [plan.id, plan]));
    const notices = [];
    const nextHolding = normalizeHolding({
      ...currentHolding,
      shares: parseNonNegativeInteger(form.elements.namedItem("holdingShares").value),
      cost: parseNullableNumber(form.elements.namedItem("holdingCost").value),
      currentPrice: parseNullableNumber(form.elements.namedItem("holdingCurrentPrice").value),
      reflectionNote: normalizeNoteText(form.elements.namedItem("holdingReflection").value),
      marketValueOverride: null,
      floatingPnlOverride: null
    });

    const nextPlans = Array.from(form.querySelectorAll(".plan-row")).map((row) => {
      const oldPlan = currentPlanMap.get(row.dataset.planId);
      return normalizePlan({
        ...(oldPlan || {}),
        id: row.dataset.planId,
        label: row.dataset.planLabel || row.dataset.planId,
        holdingId,
        type: row.querySelector('[data-field="type"]').value,
        triggerPrice: parseNullableNumber(row.querySelector('[data-field="triggerPrice"]').value),
        shares: parseNullableInteger(row.querySelector('[data-field="shares"]').value),
        status: row.querySelector('[data-field="status"]').value,
        note: String(row.querySelector('[data-field="note"]').value || "").trim()
      });
    });

    let adjustedShares = nextHolding.shares;

    nextPlans.forEach((draftPlan) => {
      const oldPlan = currentPlanMap.get(draftPlan.id);
      if (oldPlan && oldPlan.applied && oldPlan.status === PLAN_STATUS.DONE && draftPlan.status !== PLAN_STATUS.DONE) {
        notices.push("该计划已经影响过持仓，如需撤销请手动修改当前持仓。");
      }

      if (draftPlan.status !== PLAN_STATUS.DONE || draftPlan.applied) {
        return;
      }

      const executionDelta = getExecutionDelta(draftPlan);
      if (executionDelta === 0) {
        return;
      }

      adjustedShares += executionDelta;
      draftPlan.applied = true;
    });

    nextHolding.shares = clampShares(adjustedShares);

    return {
      holding: nextHolding,
      plans: nextPlans,
      notices
    };
  }

  function handleDetailDraftUpdate(event) {
    const form = event.target.closest("#detail-form");
    if (!form) {
      return;
    }

    updateDraftSummary(form);
    if (event.type === "change") {
      saveDetailForm(form, {
        saveMessage: "已自动保存"
      });
      return;
    }

    scheduleDetailAutoSave();
  }

  function updateDraftSummary(form) {
    const shares = parseNonNegativeInteger(form.elements.namedItem("holdingShares").value);
    const cost = parseNullableNumber(form.elements.namedItem("holdingCost").value);
    const currentPrice = parseNullableNumber(form.elements.namedItem("holdingCurrentPrice").value);
    const liveMarketValue = detailContent.querySelector("[data-live-market-value]");
    const liveFloatingPnl = detailContent.querySelector("[data-live-floating-pnl]");

    if (liveMarketValue) {
      liveMarketValue.textContent = formatHoldingMarketValue(shares, currentPrice);
    }

    if (liveFloatingPnl) {
      const pnlNumber = getComputedFloatingPnl(shares, cost, currentPrice);
      liveFloatingPnl.textContent = formatHoldingFloatingPnl(shares, cost, currentPrice);
      liveFloatingPnl.className = getProfitClass(pnlNumber);
    }

    detailContent.querySelectorAll(".plan-row").forEach((row) => {
      const triggerPrice = parseNullableNumber(row.querySelector('[data-field="triggerPrice"]').value);
      const sharesValue = parseNullableInteger(row.querySelector('[data-field="shares"]').value);
      const amount = row.querySelector("[data-plan-amount]");

      if (amount) {
        amount.textContent = getPlanAmountText({
          triggerPrice,
          shares: sharesValue
        });
      }
    });
  }

  function syncDetailFormAfterSave(form, holding) {
    const holdingSharesInput = form.elements.namedItem("holdingShares");
    if (
      holdingSharesInput &&
      parseNonNegativeInteger(holdingSharesInput.value) !== holding.shares
    ) {
      holdingSharesInput.value = formatInputNumber(holding.shares, 0);
    }
  }

  function updateDetailPlanSummary(holdingId) {
    const planSummary = computePlanSummary(holdingId);
    const liveNextStatus = detailContent.querySelector("[data-live-next-status]");
    const liveNextAction = detailContent.querySelector("[data-live-next-action]");

    if (liveNextStatus) {
      liveNextStatus.textContent = planSummary.nextPlanStatus || "";
      liveNextStatus.className = `status-chip ${getStatusClass(planSummary.nextPlanStatus)}${planSummary.nextPlanStatus ? "" : " hidden"}`;
    }

    if (liveNextAction) {
      liveNextAction.textContent = planSummary.nextActionText;
      liveNextAction.className = planSummary.hasNextPlan ? "action-tag" : "action-tag action-tag-muted";
    }
  }

  function setDetailSaveStatus(message) {
    detailSaveStatusText = message || "";
    const saveStatus = detailContent.querySelector("[data-save-status]");
    if (!saveStatus) {
      return;
    }

    saveStatus.textContent = detailSaveStatusText;
    saveStatus.className = `save-status${detailSaveStatusText ? " is-visible" : ""}`;
  }

  function addPlanForHolding(holdingId) {
    const holding = getHoldingById(holdingId);
    if (!holding) {
      return;
    }

    const newPlan = createEmptyPlan(holdingId);
    state.plans.push(newPlan);
    saveState();
    detailSaveStatusText = "已自动保存";
    renderApp();
  }

  function createEmptyPlan(holdingId) {
    const existingPlans = getPlansForHolding(holdingId);
    const nextNumber = existingPlans.reduce((maxNumber, plan) => {
      const match = String(plan.label || "").match(/(\d+)$/);
      if (!match) {
        return maxNumber;
      }

      return Math.max(maxNumber, Number(match[1]));
    }, 0) + 1;

    return normalizePlan({
      id: `${holdingId}-plan-${Date.now()}`,
      label: `计划${nextNumber}`,
      holdingId,
      type: PLAN_TYPE.WATCH,
      triggerPrice: null,
      shares: null,
      status: PLAN_STATUS.PENDING,
      note: "",
      applied: false
    });
  }

  function replaceHolding(nextHolding) {
    state.holdings = state.holdings.map((holding) => {
      return holding.id === nextHolding.id ? nextHolding : holding;
    });
  }

  function replacePlans(holdingId, nextPlans) {
    state.plans = state.plans.filter((plan) => plan.holdingId !== holdingId).concat(nextPlans);
  }

  async function importState(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const importedState = normalizeState(parsed && parsed.state ? parsed.state : parsed);
      const confirmed = window.confirm("确认用导入的 JSON 覆盖当前网页里的数据吗？");

      if (!confirmed) {
        return;
      }

      state = applyStateMigrations(mergeState(defaultState, importedState));
      selectedHoldingId = null;
      selectedMode = "detail";
      saveState();
      renderApp();
    } catch (error) {
      window.alert("导入失败，请确认这是有效的 JSON 文件。");
    }
  }

  function exportState() {
    const payload = {
      app: exportedAppName,
      exportedAt: formatDateTime(new Date()),
      state: clone(state)
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

  function computeAccountSummary(accountId) {
    const account = getAccountById(accountId);
    const holdings = getHoldingsByAccount(accountId);
    const marketValues = buildSummaryNumbers(holdings, (holding) => getHoldingMarketValueNumber(holding));
    const costs = buildSummaryNumbers(holdings, (holding) => getHoldingCostValueNumber(holding));
    const floatingPnls = buildSummaryNumbers(holdings, (holding) => getHoldingFloatingPnl(holding));
    const availableCash = buildSingleNumberSummary(getAccountAvailableCashNumber(account));
    const todayNeedActionShares = getPlansByAccount(accountId)
      .filter((plan) => plan.status === PLAN_STATUS.WAITING)
      .reduce((sum, plan) => {
        return sum + (Number.isFinite(plan.shares) ? Number(plan.shares) : 0);
      }, 0);
    const uniqueRisks = [];

    holdings.forEach((holding) => {
      if (holding.risk && !uniqueRisks.includes(holding.risk)) {
        uniqueRisks.push(holding.risk);
      }
    });

    return {
      totalAssetText: formatCombinedCurrency([marketValues, availableCash], "待填可用资金/现价"),
      marketValueText: formatPartialCurrency(marketValues, "待填现价"),
      availableCashText: formatPartialCurrency(availableCash, "待填可用资金"),
      costText: formatPartialCurrency(costs, "待填成本"),
      floatingPnlText: formatPartialProfit(floatingPnls, "待填成本/现价"),
      floatingPnlNumber: floatingPnls.empty ? null : floatingPnls.sum,
      todayNeedActionText: todayNeedActionShares > 0 ? formatShares(todayNeedActionShares) : "0",
      riskText: uniqueRisks.length ? uniqueRisks.join("；") : "暂无额外风险提醒"
    };
  }

  function computeHomeSummary() {
    const marketValues = buildSummaryNumbers(state.holdings, (holding) => getHoldingMarketValueNumber(holding));
    const availableCash = buildSummaryNumbers(state.accounts, (account) => getAccountAvailableCashNumber(account));
    const bankCash = buildSingleNumberSummary(getBankCashNumber());

    return {
      totalAssetText: formatCombinedCurrency([marketValues, availableCash, bankCash], "待填银行资金/可用资金/现价"),
      marketValueText: formatPartialCurrency(marketValues, "待填现价"),
      availableCashText: formatPartialCurrency(availableCash, "待填可用资金"),
      bankCashText: formatPartialCurrency(bankCash, "待填银行资金")
    };
  }

  function computeHoldingMetrics(holding) {
    const marketValueNumber = getHoldingMarketValueNumber(holding);
    const floatingPnl = getHoldingFloatingPnl(holding);

    return {
      marketValueNumber,
      marketValueText: marketValueNumber === null ? "待填" : formatCurrency(marketValueNumber),
      floatingPnl,
      floatingPnlText: floatingPnl === null ? formatHoldingFloatingPnl(holding.shares, holding.cost, holding.currentPrice) : formatProfit(floatingPnl)
    };
  }

  function computePlanSummary(holdingId) {
    const plans = getPlansForHolding(holdingId);
    const nextPlan = getNextPlan(plans);

    return {
      hasNextPlan: Boolean(nextPlan),
      nextPlanStatus: nextPlan ? nextPlan.status : "",
      nextTriggerText: nextPlan ? getPlanTriggerText(nextPlan) : "暂无",
      nextActionText: nextPlan ? getNextActionText(nextPlan) : "暂无操作",
      executedCount: plans.filter((plan) => plan.status === PLAN_STATUS.DONE).length,
      unexecutedCount: plans.filter((plan) => plan.status !== PLAN_STATUS.DONE).length
    };
  }

  function getNextPlan(plans) {
    return plans.find((plan) => activePlanStatuses.has(plan.status)) || null;
  }

  function getNextActionText(plan) {
    if (!plan) {
      return "暂无操作";
    }

    if (plan.type === PLAN_TYPE.WATCH) {
      return plan.note || "等待复核";
    }

    const parts = [];

    if (Number.isFinite(plan.triggerPrice)) {
      parts.push(formatPrice(plan.triggerPrice, 2));
    }

    if (plan.type) {
      parts.push(plan.type);
    }

    if (Number.isFinite(plan.shares)) {
      parts.push(formatShares(plan.shares));
    }

    if (!parts.length && plan.note) {
      parts.push(plan.note);
    }

    return parts.join(" ") || "暂无操作";
  }

  function getPlanTriggerText(plan) {
    if (plan.type === PLAN_TYPE.WATCH) {
      return Number.isFinite(plan.triggerPrice) ? "待确认" : "暂无";
    }

    return Number.isFinite(plan.triggerPrice) ? formatPrice(plan.triggerPrice, 2) : "待填";
  }

  function getPlanAmountText(plan) {
    if (!Number.isFinite(plan.triggerPrice) || !Number.isFinite(plan.shares)) {
      return "待填";
    }

    return formatCurrency(plan.triggerPrice * plan.shares);
  }

  function getPlansByAccount(accountId) {
    const holdingIds = new Set(getHoldingsByAccount(accountId).map((holding) => holding.id));
    return state.plans.filter((plan) => holdingIds.has(plan.holdingId));
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

  function getHoldingMarketValueNumber(holding) {
    if (Number.isFinite(holding.marketValueOverride)) {
      return Number(holding.marketValueOverride);
    }

    if (!Number.isFinite(holding.shares) || !Number.isFinite(holding.currentPrice)) {
      return null;
    }

    return holding.shares * holding.currentPrice;
  }

  function getHoldingCostValueNumber(holding) {
    if (!Number.isFinite(holding.shares) || !Number.isFinite(holding.cost)) {
      return null;
    }

    return holding.shares * holding.cost;
  }

  function getHoldingFloatingPnl(holding) {
    if (Number.isFinite(holding.floatingPnlOverride)) {
      return Number(holding.floatingPnlOverride);
    }

    return getComputedFloatingPnl(holding.shares, holding.cost, holding.currentPrice);
  }

  function getComputedFloatingPnl(shares, cost, currentPrice) {
    if (!Number.isFinite(shares) || !Number.isFinite(cost) || !Number.isFinite(currentPrice)) {
      return null;
    }

    return shares * currentPrice - shares * cost;
  }

  function formatHoldingMarketValue(shares, currentPrice) {
    if (!Number.isFinite(shares) || !Number.isFinite(currentPrice)) {
      return "待填";
    }

    return formatCurrency(shares * currentPrice);
  }

  function formatHoldingFloatingPnl(shares, cost, currentPrice) {
    if (!Number.isFinite(currentPrice)) {
      return "待填现价";
    }

    if (!Number.isFinite(cost)) {
      return "待填成本";
    }

    return formatProfit(shares * currentPrice - shares * cost);
  }

  function clearHoldingDerivedValues(holding) {
    holding.marketValueOverride = null;
    holding.floatingPnlOverride = null;
  }

  function getAccountAvailableCashNumber(account) {
    if (!account || !Number.isFinite(account.availableCash)) {
      return null;
    }

    return Number(account.availableCash);
  }

  function getBankCashNumber() {
    if (!Number.isFinite(state.bankCash)) {
      return null;
    }

    return Number(state.bankCash);
  }

  function buildSummaryNumbers(holdings, getter) {
    let sum = 0;
    let known = 0;

    holdings.forEach((holding) => {
      const value = getter(holding);
      if (Number.isFinite(value)) {
        sum += Number(value);
        known += 1;
      }
    });

    return {
      sum,
      known,
      total: holdings.length,
      complete: holdings.length > 0 && known === holdings.length,
      empty: known === 0
    };
  }

  function buildSingleNumberSummary(value) {
    if (!Number.isFinite(value)) {
      return {
        sum: 0,
        known: 0,
        total: 1,
        complete: false,
        empty: true
      };
    }

    return {
      sum: Number(value),
      known: 1,
      total: 1,
      complete: true,
      empty: false
    };
  }

  function formatPartialCurrency(summary, emptyText) {
    if (summary.empty) {
      return emptyText;
    }

    return summary.complete ? formatCurrency(summary.sum) : `${formatCurrency(summary.sum)}（部分）`;
  }

  function formatCombinedCurrency(summaries, emptyText) {
    const summaryList = Array.isArray(summaries) ? summaries.filter(Boolean) : [];
    const nonEmptySummaries = summaryList.filter((summary) => !summary.empty);

    if (!nonEmptySummaries.length) {
      return emptyText;
    }

    const sum = nonEmptySummaries.reduce((total, summary) => total + Number(summary.sum || 0), 0);
    const complete = summaryList.length > 0 && summaryList.every((summary) => summary.complete);

    return complete ? formatCurrency(sum) : `${formatCurrency(sum)}（部分）`;
  }

  function formatPartialProfit(summary, emptyText) {
    if (summary.empty) {
      return emptyText;
    }

    return summary.complete ? formatProfit(summary.sum) : `${formatProfit(summary.sum)}（部分）`;
  }

  function getExecutionDelta(plan) {
    if (!Number.isFinite(plan.shares)) {
      return 0;
    }

    if (buyTypes.has(plan.type)) {
      return Number(plan.shares);
    }

    if (sellTypes.has(plan.type)) {
      return Number(plan.shares) * -1;
    }

    return 0;
  }

  function clampShares(value) {
    return Math.max(0, Math.round(Number(value || 0)));
  }

  function renderStatusOptions(currentStatus) {
    return statusOptions
      .map((status) => {
        const selected = status === currentStatus ? " selected" : "";
        return `<option value="${escapeAttribute(status)}"${selected}>${escapeHtml(status)}</option>`;
      })
      .join("");
  }

  function renderPlanTypeOptions(currentType) {
    return planTypeOptions
      .map((type) => {
        const selected = type === currentType ? " selected" : "";
        return `<option value="${escapeAttribute(type)}"${selected}>${escapeHtml(type)}</option>`;
      })
      .join("");
  }

  function getStatusClass(status) {
    if (status === PLAN_STATUS.WAITING) {
      return "status-waiting";
    }

    if (status === PLAN_STATUS.DONE) {
      return "status-done";
    }

    if (status === PLAN_STATUS.PAUSED) {
      return "status-paused";
    }

    if (status === PLAN_STATUS.CANCELLED) {
      return "status-cancelled";
    }

    return "status-untriggered";
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

  function normalizeState(source) {
    const raw = source && typeof source === "object" ? source : {};

    return {
      bankCash: parseNullableNumber(raw.bankCash),
      accounts: normalizeAccounts(raw.accounts),
      holdings: normalizeHoldings(raw.holdings),
      plans: normalizePlans(raw.plans)
    };
  }

  function mergeState(baseState, overrideState) {
    return {
      bankCash: overrideState.bankCash === null ? baseState.bankCash : overrideState.bankCash,
      accounts: mergeArrayById(baseState.accounts, overrideState.accounts, mergeAccount),
      holdings: mergeArrayById(baseState.holdings, overrideState.holdings, mergeHolding),
      plans: mergeArrayById(baseState.plans, overrideState.plans, mergePlan)
    };
  }

  function applyStateMigrations(currentState) {
    const nextState = clone(currentState);
    nextState.plans = migrateFamilyBydPlans(nextState.plans);
    return nextState;
  }

  function migrateFamilyBydPlans(plans) {
    const currentPlans = Array.isArray(plans) ? plans : [];
    const familyBydPlans = currentPlans.filter((plan) => plan.holdingId === FAMILY_BYD_HOLDING_ID);

    if (!shouldReplaceLegacyFamilyBydPlans(familyBydPlans)) {
      return currentPlans;
    }

    const defaultFamilyBydPlans = defaultState.plans
      .filter((plan) => plan.holdingId === FAMILY_BYD_HOLDING_ID)
      .map((plan) => clone(plan));

    return currentPlans
      .filter((plan) => plan.holdingId !== FAMILY_BYD_HOLDING_ID)
      .concat(defaultFamilyBydPlans);
  }

  function shouldReplaceLegacyFamilyBydPlans(familyBydPlans) {
    if (!familyBydPlans.length) {
      return true;
    }

    if (familyBydPlans.length !== 1) {
      return false;
    }

    const legacyPlan = familyBydPlans[0];
    return legacyPlan.id === FAMILY_BYD_LEGACY_PLAN_ID
      && legacyPlan.type === PLAN_TYPE.WATCH
      && !Number.isFinite(legacyPlan.triggerPrice)
      && !Number.isFinite(legacyPlan.shares)
      && String(legacyPlan.note || "").includes("等待后续策略确认");
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
    if (!baseAccount) {
      return normalizeAccount(overrideAccount);
    }

    return normalizeAccount({
      id: baseAccount.id,
      label: baseAccount.label,
      name: baseAccount.name,
      availableCash: overrideAccount ? overrideAccount.availableCash : baseAccount.availableCash
    });
  }

  function mergeHolding(baseHolding, overrideHolding) {
    if (!baseHolding) {
      return normalizeHolding(overrideHolding);
    }

    return normalizeHolding({
      id: baseHolding.id,
      accountId: baseHolding.accountId,
      name: baseHolding.name,
      code: baseHolding.code,
      shares: overrideHolding ? overrideHolding.shares : baseHolding.shares,
      cost: overrideHolding ? overrideHolding.cost : baseHolding.cost,
      currentPrice: overrideHolding ? overrideHolding.currentPrice : baseHolding.currentPrice,
      status: baseHolding.status,
      risk: baseHolding.risk,
      extraNote: baseHolding.extraNote,
      reflectionNote: overrideHolding ? overrideHolding.reflectionNote : baseHolding.reflectionNote,
      marketValueOverride: overrideHolding ? overrideHolding.marketValueOverride : baseHolding.marketValueOverride,
      floatingPnlOverride: overrideHolding ? overrideHolding.floatingPnlOverride : baseHolding.floatingPnlOverride
    });
  }

  function mergePlan(basePlan, overridePlan) {
    if (!basePlan) {
      return normalizePlan(overridePlan);
    }

    return normalizePlan({
      id: basePlan.id,
      label: basePlan.label,
      holdingId: basePlan.holdingId,
      type: overridePlan ? overridePlan.type : basePlan.type,
      triggerPrice: overridePlan ? overridePlan.triggerPrice : basePlan.triggerPrice,
      shares: overridePlan ? overridePlan.shares : basePlan.shares,
      status: overridePlan ? overridePlan.status : basePlan.status,
      note: overridePlan ? overridePlan.note : basePlan.note,
      applied: overridePlan ? overridePlan.applied : basePlan.applied
    });
  }

  function normalizeAccounts(source) {
    const list = Array.isArray(source) ? source : [];
    return list.map(normalizeAccount);
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
    return list.map(normalizeHolding);
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

  function normalizePlans(source) {
    const list = Array.isArray(source) ? source : [];
    return list.map(normalizePlan);
  }

  function normalizePlan(source) {
    const rawStatus = String((source && source.status) || PLAN_STATUS.PENDING).trim();
    const normalizedStatus = rawStatus === "已取消" ? PLAN_STATUS.CANCELLED : rawStatus;
    const appliedFallback = normalizedStatus === PLAN_STATUS.DONE;
    const applied = parseBoolean(source && source.applied, appliedFallback);
    const rawType = String((source && source.type) || PLAN_TYPE.WATCH).trim();
    const type = planTypeOptions.includes(rawType) ? rawType : PLAN_TYPE.WATCH;

    return {
      id: String((source && source.id) || "").trim(),
      label: String((source && source.label) || "").trim(),
      holdingId: String((source && source.holdingId) || "").trim(),
      type,
      triggerPrice: parseNullableNumber(source && source.triggerPrice),
      shares: parseNullableInteger(source && source.shares),
      status: statusOptions.includes(normalizedStatus) ? normalizedStatus : PLAN_STATUS.PENDING,
      note: String((source && source.note) || "").trim(),
      applied
    };
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

  function parseNonNegativeInteger(value) {
    const parsed = parseNullableInteger(value);
    return parsed === null ? 0 : Math.max(0, parsed);
  }

  function parseNumberOrZero(value) {
    const parsed = parseNullableNumber(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatCurrency(value) {
    return `¥${Number(value || 0).toLocaleString("zh-CN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    })}`;
  }

  function formatProfit(value) {
    const number = Number(value || 0);
    const sign = number > 0 ? "+" : "";
    return `${sign}${formatCurrency(number)}`;
  }

  function formatPrice(value, digits) {
    return Number(value || 0).toFixed(Number.isFinite(digits) ? digits : 2);
  }

  function formatShares(value) {
    return `${Number(value || 0).toLocaleString("zh-CN")}股`;
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

  function renderHomeView() {
    const homeSummary = computeHomeSummary();
    const isMobileView = getTradeViewMode() === "mobile";

    accountList.innerHTML = `
      <section class="overview-section">
        <div class="overview-bar">
          <span class="section-kicker">首页总览</span>

          <div class="overview-metric">
            <span class="field-label">总资产</span>
            <strong>${escapeHtml(homeSummary.totalAssetText)}</strong>
          </div>

          <div class="overview-metric">
            <span class="field-label">总市值</span>
            <strong>${escapeHtml(homeSummary.marketValueText)}</strong>
          </div>

          <div class="overview-metric">
            <span class="field-label">总可用资金</span>
            <strong>${escapeHtml(homeSummary.availableCashText)}</strong>
          </div>

          <label class="overview-inline-field">
            <span class="field-label">银行资金</span>
            <input
              class="overview-inline-input"
              type="number"
              step="0.01"
              inputmode="decimal"
              data-home-bank-cash
              value="${escapeAttribute(formatInputNumber(state.bankCash, 2))}"
              placeholder="待填"
            >
          </label>
        </div>
      </section>
      ${state.accounts.map((account) => {
        const holdings = getHoldingsByAccount(account.id);
        const summary = computeAccountSummary(account.id);
        return isMobileView
          ? renderMobileAccountSection(account, holdings, summary)
          : renderDesktopAccountSection(account, holdings, summary);
      }).join("")}
    `;
  }

  function renderDesktopAccountSection(account, holdings, summary) {
    return `
      <section class="account-section">
        <div class="account-header">
          <div class="account-title-row">
            <span class="account-label">${escapeHtml(account.label)}</span>
            <h2 class="account-title">${escapeHtml(account.name)}</h2>
          </div>

          <div class="account-summary-line">
            <span>总资产<strong>${escapeHtml(summary.totalAssetText)}</strong></span>
            <span>总市值<strong>${escapeHtml(summary.marketValueText)}</strong></span>
            <label class="summary-inline-field">
              <span>可用资金</span>
              <input
                class="summary-inline-input"
                type="number"
                step="0.01"
                inputmode="decimal"
                data-home-cash="${escapeAttribute(account.id)}"
                value="${escapeAttribute(formatInputNumber(account.availableCash, 2))}"
                placeholder="待填"
              >
            </label>
            <span>总成本<strong>${escapeHtml(summary.costText)}</strong></span>
            <span>浮盈亏<strong class="${getProfitClass(summary.floatingPnlNumber)}">${escapeHtml(summary.floatingPnlText)}</strong></span>
            <span>今日操作 <strong>${escapeHtml(summary.todayNeedActionText)}</strong></span>
          </div>
        </div>

        <div class="table-scroll">
          <table class="holding-table">
            <thead>
              <tr>
                <th>股票名称 + 代码</th>
                <th>当前持仓</th>
                <th>成本价</th>
                <th>当前价</th>
                <th>当前市值</th>
                <th>浮盈亏</th>
                <th>当前状态</th>
                <th>下一触发价</th>
                <th>下一步动作</th>
                <th>未执行计划数量</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${holdings.length ? holdings.map((holding) => renderHoldingRow(holding)).join("") : renderEmptyHoldingRow()}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderMobileAccountSection(account, holdings, summary) {
    return `
      <section class="account-section">
        <div class="account-header">
          <div class="account-title-row">
            <span class="account-label">${escapeHtml(account.label)}</span>
            <h2 class="account-title">${escapeHtml(account.name)}</h2>
          </div>

          <div class="mobile-account-summary">
            <div class="mobile-account-metric">
              <span class="field-label">总资产</span>
              <strong>${escapeHtml(summary.totalAssetText)}</strong>
            </div>
            <div class="mobile-account-metric">
              <span class="field-label">总市值</span>
              <strong>${escapeHtml(summary.marketValueText)}</strong>
            </div>
            <label class="mobile-account-metric mobile-cash-field">
              <span class="field-label">可用资金</span>
              <input
                class="mobile-metric-input"
                type="number"
                step="0.01"
                inputmode="decimal"
                data-home-cash="${escapeAttribute(account.id)}"
                value="${escapeAttribute(formatInputNumber(account.availableCash, 2))}"
                placeholder="待填"
              >
            </label>
          </div>
        </div>

        <div class="mobile-holding-list">
          ${holdings.length ? holdings.map((holding) => renderHoldingMobileCard(holding)).join("") : `<div class="mobile-empty-card">当前账户暂无持仓。</div>`}
        </div>
      </section>
    `;
  }

  function renderHoldingMobileCard(holding) {
    const metrics = computeHoldingMetrics(holding);
    const planSummary = computePlanSummary(holding.id);
    const actionClass = planSummary.hasNextPlan ? "action-tag" : "action-tag action-tag-muted";

    return `
      <article class="holding-mobile-card">
        <div class="holding-mobile-head">
          <div class="holding-mobile-main">
            <strong>${escapeHtml(holding.name)}</strong>
            <span class="stock-code">${escapeHtml(holding.code)}</span>
          </div>
          <span class="status-chip ${getStatusClass(planSummary.nextPlanStatus)}${planSummary.nextPlanStatus ? "" : " hidden"}">${escapeHtml(planSummary.nextPlanStatus || "")}</span>
        </div>

        <div class="mobile-holding-grid">
          <div class="mobile-metric-block">
            <span class="field-label">持仓</span>
            <strong>${escapeHtml(formatShares(holding.shares))}</strong>
          </div>
          <div class="mobile-metric-block">
            <span class="field-label">成本价</span>
            <strong>${escapeHtml(displayPriceOrPending(holding.cost, "待填", 3))}</strong>
          </div>
          <label class="mobile-metric-block">
            <span class="field-label">当前价</span>
            <input
              class="mobile-metric-input"
              type="number"
              step="0.001"
              inputmode="decimal"
              data-home-price="${escapeAttribute(holding.id)}"
              value="${escapeAttribute(formatInputNumber(holding.currentPrice, 3))}"
              placeholder="待填"
            >
          </label>
          <div class="mobile-metric-block">
            <span class="field-label">当前市值</span>
            <strong>${escapeHtml(metrics.marketValueText)}</strong>
          </div>
          <div class="mobile-metric-block">
            <span class="field-label">浮盈亏</span>
            <strong class="${getProfitClass(metrics.floatingPnl)}">${escapeHtml(metrics.floatingPnlText)}</strong>
          </div>
          <div class="mobile-metric-block">
            <span class="field-label">当前状态</span>
            <span>${escapeHtml(holding.status || "待补充")}</span>
          </div>
          <div class="mobile-metric-block full-width">
            <span class="field-label">下一步动作</span>
            <span class="${actionClass}">${escapeHtml(planSummary.nextActionText)}</span>
          </div>
        </div>

        <div class="mobile-card-actions">
          <button class="row-button" type="button" data-open-holding="${escapeAttribute(holding.id)}" data-open-mode="detail">详情</button>
          <button class="row-button row-button-accent" type="button" data-open-holding="${escapeAttribute(holding.id)}" data-open-mode="edit">编辑</button>
        </div>
      </article>
    `;
  }

  function renderPlanEditorSection(holding, plans, isMobileView) {
    return `
      <section class="plan-section">
        <div class="section-head">
          <h3 class="section-title">买卖计划</h3>
          <p class="section-note">所有输入都会自动保存。手机版会改成上下排布，不需要左右滑。</p>
          <button class="secondary-button" type="button" data-add-plan="${escapeAttribute(holding.id)}">新增一行计划</button>
        </div>

        ${isMobileView ? `
          <div class="mobile-plan-list">
            ${plans.length ? plans.map((plan) => renderPlanMobileCard(plan)).join("") : renderNoPlansMobile()}
          </div>
        ` : `
          <div class="table-scroll">
            <table class="plan-table">
              <thead>
                <tr>
                  <th>计划ID</th>
                  <th>类型</th>
                  <th>触发价</th>
                  <th>股数</th>
                  <th>金额</th>
                  <th>状态</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                ${plans.length ? plans.map((plan) => renderPlanRow(plan)).join("") : renderNoPlans()}
              </tbody>
            </table>
          </div>
        `}
      </section>
    `;
  }

  function renderPlanMobileCard(plan) {
    return `
      <div
        class="plan-mobile-card plan-row"
        data-plan-id="${escapeAttribute(plan.id)}"
        data-plan-label="${escapeAttribute(plan.label || plan.id)}"
      >
        <div class="plan-mobile-head">
          <strong>${escapeHtml(plan.label || plan.id)}</strong>
          <span class="status-chip ${getStatusClass(plan.status)}">${escapeHtml(plan.status)}</span>
        </div>

        <div class="mobile-plan-grid">
          <label class="detail-field">
            <span class="field-label">类型</span>
            <select class="cell-select" data-field="type">
              ${renderPlanTypeOptions(plan.type)}
            </select>
          </label>

          <label class="detail-field">
            <span class="field-label">触发价</span>
            <input
              class="cell-input cell-input-short"
              type="number"
              step="0.001"
              min="0"
              data-field="triggerPrice"
              value="${escapeAttribute(formatInputNumber(plan.triggerPrice, 3))}"
              placeholder="待填"
            >
          </label>

          <label class="detail-field">
            <span class="field-label">股数</span>
            <input
              class="cell-input cell-input-short"
              type="number"
              step="100"
              min="0"
              data-field="shares"
              value="${escapeAttribute(formatInputNumber(plan.shares, 0))}"
              placeholder="待填"
            >
          </label>

          <div class="detail-stat">
            <span class="field-label">金额</span>
            <strong data-plan-amount>${escapeHtml(getPlanAmountText(plan))}</strong>
          </div>

          <label class="detail-field">
            <span class="field-label">状态</span>
            <select class="cell-select" data-field="status">
              ${renderStatusOptions(plan.status)}
            </select>
          </label>

          <label class="detail-field">
            <span class="field-label">备注</span>
            <input
              class="cell-input cell-input-note"
              type="text"
              data-field="note"
              value="${escapeAttribute(plan.note || "")}"
              placeholder="备注"
            >
          </label>
        </div>
      </div>
    `;
  }

  function renderNoPlansMobile() {
    return `<div class="mobile-empty-card">当前没有买卖计划，点上方按钮就能新增。</div>`;
  }

  function renderDetailView() {
    const holding = selectedHoldingId ? getHoldingById(selectedHoldingId) : null;
    if (!holding) {
      detailContent.innerHTML = "";
      return;
    }

    const isMobileView = getTradeViewMode() === "mobile";
    const metrics = computeHoldingMetrics(holding);
    const planSummary = computePlanSummary(holding.id);
    const plans = getPlansForHolding(holding.id);

    detailContent.innerHTML = `
      <form id="detail-form" data-holding-id="${escapeAttribute(holding.id)}">
        <section class="detail-panel">
          <div class="detail-topline">
            <div class="detail-title-block">
              <p class="section-kicker">股票详情</p>
              <h2 class="detail-title">${escapeHtml(holding.name)} ${escapeHtml(holding.code)}</h2>
            </div>
            <div class="detail-side-panel">
              <div class="detail-side-head">
                <span class="field-label">心得 / 感悟</span>
                <span
                  class="status-chip ${getStatusClass(planSummary.nextPlanStatus)}${planSummary.nextPlanStatus ? "" : " hidden"}"
                  data-live-next-status
                >${escapeHtml(planSummary.nextPlanStatus || "")}</span>
              </div>

              <textarea
                class="detail-reflection-textarea"
                name="holdingReflection"
                rows="6"
                placeholder="写下你的判断、原因、提醒点。"
              >${escapeHtml(holding.reflectionNote || "")}</textarea>
            </div>
          </div>

          <div class="detail-summary-grid">
            <label class="detail-field">
              <span class="field-label">当前持仓</span>
              <input type="number" step="100" min="0" name="holdingShares" value="${escapeAttribute(formatInputNumber(holding.shares, 0))}">
            </label>

            <label class="detail-field">
              <span class="field-label">成本价</span>
              <input type="number" step="0.001" min="0" name="holdingCost" value="${escapeAttribute(formatInputNumber(holding.cost, 3))}" placeholder="待填">
            </label>

            <label class="detail-field">
              <span class="field-label">当前价</span>
              <input type="number" step="0.001" min="0" name="holdingCurrentPrice" value="${escapeAttribute(formatInputNumber(holding.currentPrice, 3))}" placeholder="待填">
            </label>

            <div class="detail-stat">
              <span class="field-label">当前市值</span>
              <strong data-live-market-value>${escapeHtml(metrics.marketValueText)}</strong>
            </div>

            <div class="detail-stat">
              <span class="field-label">浮盈亏</span>
              <strong class="${getProfitClass(metrics.floatingPnl)}" data-live-floating-pnl>${escapeHtml(metrics.floatingPnlText)}</strong>
            </div>

            <div class="detail-stat">
              <span class="field-label">下一步动作</span>
              <span class="${planSummary.hasNextPlan ? "action-tag" : "action-tag action-tag-muted"}" data-live-next-action>${escapeHtml(planSummary.nextActionText)}</span>
            </div>
          </div>

          ${holding.extraNote ? `<p class="detail-note">备注：${escapeHtml(holding.extraNote)}</p>` : ""}

          <div class="detail-actions">
            <button class="primary-button" type="submit">保存修改</button>
            <span class="save-status${detailSaveStatusText ? " is-visible" : ""}" data-save-status>${escapeHtml(detailSaveStatusText)}</span>
          </div>
        </section>

        ${renderPlanEditorSection(holding, plans, isMobileView)}
      </form>
    `;

    if (selectedMode === "edit") {
      const input = detailContent.querySelector('input[name="holdingCurrentPrice"]') || detailContent.querySelector('input[name="holdingShares"]');
      if (input) {
        window.requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      }
    }
  }

  function renderHeader() {
    const holding = selectedHoldingId ? getHoldingById(selectedHoldingId) : null;

    pageTitle.textContent = "林青交易看板";

    if (!holding) {
      pageSubtitle.textContent = "网页改动会先保存在本机；连上共享服务后，手机和电脑会同步同一份数据。";
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

  function saveDetailForm(form, options) {
    clearDetailAutoSaveTimer();
    const result = buildDetailDraft(form);
    if (!result) {
      return;
    }

    replaceHolding(result.holding);
    replacePlans(result.holding.id, result.plans);
    saveState();
    syncDetailFormAfterSave(form, result.holding);
    updateDraftSummary(form);
    updateDetailPlanSummary(result.holding.id);
    renderHeader();
    renderHomeView();
    setDetailSaveStatus((options && options.saveMessage) || "已保存");
    void syncAction({
      type: "upsertHoldingBundle",
      holding: clone(result.holding),
      plans: clone(result.plans)
    }, {
      successMessage: "已同步当前股票详情",
      skipRender: true
    });

    result.notices.forEach((notice) => {
      window.alert(notice);
    });
  }

  function addPlanForHolding(holdingId) {
    const holding = getHoldingById(holdingId);
    if (!holding) {
      return;
    }

    const newPlan = createEmptyPlan(holdingId);
    state.plans.push(newPlan);
    saveState();
    detailSaveStatusText = "已自动保存";
    renderApp();
    void syncAction({
      type: "addPlan",
      holdingId,
      plan: clone(newPlan)
    }, {
      successMessage: "已同步新增计划",
      skipRender: true
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

      state = applyStateMigrations(mergeState(defaultState, importedState));
      selectedHoldingId = null;
      selectedMode = "detail";
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
          setSyncStatus("online", "共享服务已连接，正在推送你这台设备已有的数据");
          await syncFullState({
            successMessage: "已建立共享数据",
            skipRender: true
          });
        } else {
          setSyncStatus("online", "共享服务已连接，但云端还是空的；请先从原设备打开一次或导入 JSON");
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
})();
