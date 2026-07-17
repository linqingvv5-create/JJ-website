(function () {
  "use strict";

  const STORAGE_KEY = "linqing-trade-board-excel-v1";
  const LEGACY_STORAGE_KEY = "linqing-minimal-trade-board-state-v4";
  const DATA_REVISION = "2026-07-17-mobile-sync-1";
  const SYNC_SERVICE_ORIGIN = window.location.hostname.endsWith("github.io")
    ? "https://linqing-trading-dashboard.linqingvv5.chatgpt.site"
    : "";
  const SYNC_API_STATE_URL = `${SYNC_SERVICE_ORIGIN}/api/state`;
  const SYNC_POLL_INTERVAL_MS = 5000;

  const KIND = { BUY: "buy", ADD: "add", SELL: "sell", TRADE: "trade", WATCH: "watch" };
  const TAB = { BUY: "buy", SELL: "sell", TRADE: "trade", STRATEGY: "strategy" };
  const SIDE = { BUY: "buy", SELL: "sell" };
  const NONE = "/";
  const SELL_TIERS = [
    { key: "5", label: "5%", rate: 5 },
    { key: "10", label: "10%", rate: 10 },
    { key: "15", label: "15%", rate: 15 },
    { key: "20", label: "20%", rate: 20 },
    { key: "dp", label: "DP", rate: null }
  ];

  const els = {
    pageTitle: document.getElementById("page-title"),
    pageSubtitle: document.getElementById("page-subtitle"),
    syncStatus: document.getElementById("sync-status"),
    back: document.getElementById("back-button"),
    reset: document.getElementById("reset-data-btn"),
    home: document.getElementById("home-view"),
    detail: document.getElementById("detail-view"),
    funds: document.getElementById("funds-view"),
    accountList: document.getElementById("account-list"),
    detailContent: document.getElementById("detail-content"),
    fundsContent: document.getElementById("funds-content")
  };

  const defaultState = normalizeState(window.APP_DATA || {});
  let state = loadState();
  let selectedHoldingId = null;
  let fundsOpen = false;
  let selectedTab = TAB.BUY;
  let saveTimer = 0;
  let cloudSaveTimer = 0;
  let cloudBusy = false;
  let cloudReady = false;
  let cloudDirty = false;
  let cloudRevision = 0;
  let cloudChangeVersion = 0;
  let applyingRemoteState = false;
  let longPressTimer = 0;
  let suppressNextHomeClick = false;

  bindEvents();
  render();
  void initializeCloudSync();

  function bindEvents() {
    els.back.addEventListener("click", closeDetail);
    els.reset.addEventListener("click", () => {
      if (!window.confirm("确认恢复最新初始数据吗？当前设备上的修改会被覆盖。")) return;
      state = clone(defaultState);
      saveState();
      closeDetail();
    });
    els.accountList.addEventListener("click", handleHomeClick);
    els.accountList.addEventListener("input", handleHomeInput);
    els.accountList.addEventListener("change", handleHomeInput);
    els.accountList.addEventListener("contextmenu", handleHoldingContextMenu);
    els.accountList.addEventListener("pointerdown", handleHoldingPointerDown);
    els.accountList.addEventListener("pointerup", clearHoldingLongPress);
    els.accountList.addEventListener("pointercancel", clearHoldingLongPress);
    els.accountList.addEventListener("pointermove", clearHoldingLongPress);
    els.detailContent.addEventListener("click", handleDetailClick);
    els.detailContent.addEventListener("input", handleDetailInput);
    els.detailContent.addEventListener("change", handleDetailInput);
    els.fundsContent.addEventListener("click", handleFundsClick);

    document.querySelectorAll("[data-quick-target]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.quickTarget;
        if (target === "funds") openFundsManagement();
        if (target === "holdings") { fundsOpen = false; selectedHoldingId = null; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
        if (target === "plans" && selectedHoldingId) openHolding(selectedHoldingId, TAB.BUY);
      });
    });
  }

  function handleHomeClick(event) {
    if (suppressNextHomeClick) {
      suppressNextHomeClick = false;
      event.preventDefault();
      return;
    }

    const bankTransfer = event.target.closest("[data-bank-transfer]");
    if (bankTransfer) {
      openBankTransfer(bankTransfer.dataset.bankTransfer);
      return;
    }

    const addHolding = event.target.closest("[data-add-holding]");
    if (addHolding) {
      openAddHolding(addHolding.dataset.addHolding);
      return;
    }

    const button = event.target.closest("[data-open-holding]");
    if (!button) return;
    openHolding(button.dataset.openHolding, button.dataset.openTab || TAB.BUY);
  }

  function handleHoldingContextMenu(event) {
    const row = event.target.closest("[data-holding-id]");
    if (!row) return;
    event.preventDefault();
    requestDeleteHolding(row.dataset.holdingId);
  }

  function handleHoldingPointerDown(event) {
    if (event.pointerType === "mouse" || event.button !== 0) return;
    const row = event.target.closest("[data-holding-id]");
    if (!row) return;
    clearHoldingLongPress();
    longPressTimer = window.setTimeout(() => {
      suppressNextHomeClick = true;
      requestDeleteHolding(row.dataset.holdingId);
    }, 650);
  }

  function clearHoldingLongPress() {
    window.clearTimeout(longPressTimer);
    longPressTimer = 0;
  }

  function handleHomeInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    if (target.matches("[data-home-bank-cash]")) {
      state.bankCash = numberOrNull(target.value);
      queueSave();
      if (event.type === "change") renderHome();
      return;
    }

    const accountId = target.dataset.homeCash;
    if (accountId) {
      const account = state.accounts.find((item) => item.id === accountId);
      if (account) account.availableCash = numberOrNull(target.value);
      queueSave();
      if (event.type === "change") renderHome();
      return;
    }

    const holdingId = target.dataset.homePrice;
    if (holdingId) {
      const holding = getHolding(holdingId);
      if (holding) holding.currentPrice = numberOrNull(target.value);
      queueSave();
      if (event.type === "change") renderHome();
    }
  }

  function handleDetailClick(event) {
    const tab = event.target.closest("[data-detail-tab]");
    if (tab) {
      selectedTab = tab.dataset.detailTab;
      renderDetail();
      return;
    }

    const add = event.target.closest("[data-add-plan]");
    if (add) {
      event.preventDefault();
      event.stopPropagation();
      state.plans.push(createPlan(selectedHoldingId, add.dataset.addPlan));
      saveState();
      renderDetail();
      return;
    }

    const removeHistory = event.target.closest("[data-delete-history]");
    if (removeHistory && window.confirm("删除这条已完成的做T记录吗？")) {
      const history = state.tradeHistory.find((item) => item.id === removeHistory.dataset.deleteHistory);
      if (history) {
        removeLot(`${history.planId}-cycle-${history.cycleNo}-sell`);
        removeLot(`${history.planId}-cycle-${history.cycleNo}-buy`);
      }
      state.tradeHistory = state.tradeHistory.filter((item) => item.id !== removeHistory.dataset.deleteHistory);
      recalculateHolding(getHolding(selectedHoldingId));
      saveState();
      renderHome();
      renderDetail();
      return;
    }

    const removeSale = event.target.closest("[data-delete-sale]");
    if (removeSale && window.confirm("删除这条已完成的卖出记录吗？")) {
      removeLot(completedSaleLotId(removeSale.dataset.deleteSale));
      state.completedSales = state.completedSales.filter((item) => item.id !== removeSale.dataset.deleteSale);
      recalculateHolding(getHolding(selectedHoldingId));
      saveState();
      renderHome();
      renderDetail();
      return;
    }

    const remove = event.target.closest("[data-delete-plan]");
    if (remove && window.confirm("删除这一行计划吗？")) {
      const plan = state.plans.find((item) => item.id === remove.dataset.deletePlan);
      if (plan?.kind === KIND.TRADE) {
        removeLot(tradeLotId(plan, "sell"));
        removeLot(tradeLotId(plan, "buy"));
      }
      if (plan?.kind === KIND.BUY) {
        removeLot(buyCycleLotId(plan));
        SELL_TIERS.forEach((tier) => removeLot(buyTierLotId(plan, tier.key)));
      }
      if (plan?.kind === KIND.ADD) removeLot(`${plan.id}-actual-buy`);
      state.plans = state.plans.filter((plan) => plan.id !== remove.dataset.deletePlan);
      recalculateHolding(getHolding(selectedHoldingId));
      saveState();
      renderHome();
      renderDetail();
    }
  }

  function handleDetailInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;

    const holdingField = target.dataset.holdingField;
    if (holdingField) {
      const holding = getHolding(selectedHoldingId);
      if (!holding) return;
      holding[holdingField] = holdingField === "currentPrice" ? numberOrNull(target.value) : target.value;
      queueSave();
      updateDetailNumbers();
      if (event.type === "change" && (holdingField === "currentPrice" || holdingField === "strategyType")) {
        saveState();
        renderDetail();
      }
      return;
    }

    const row = target.closest("[data-plan-id]");
    if (!row) return;
    const plan = state.plans.find((item) => item.id === row.dataset.planId);
    if (!plan) return;

    const field = target.dataset.field;
    if (!field) return;
    plan[field] = target.type === "checkbox" ? target.checked : target.type === "number" ? numberOrNull(target.value) : target.value;
    if (plan.kind === KIND.BUY) {
      syncPlannedTierFields(plan, field);
      syncActualTierFields(plan, field);
    }

    if (field === "operation") {
      applyOperationState(plan);
      row.classList.toggle("is-selected-operation", plan.operation !== NONE);
    }

    syncActualOperation(plan, event.type === "change");
    const buySellField = plan.kind === KIND.BUY && (field === "dreamPrice" || /^target(5|10|15|20)(Rate|Price)$/.test(field) || /^sell(5|10|15|20|dp)Shares$/.test(field) || /^actualTarget(5|10|15|20|dp)Rate$/.test(field) || /^actualSell(5|10|15|20|dp)(Price|Shares|Done)$/.test(field));
    if (buySellField) syncBuySellTargets(plan, event.type === "change");
    queueSave();
    updatePlanRow(row, plan);
    updateDetailNumbers();

    if (event.type === "change" && field === "operation") {
      if (plan.kind === KIND.TRADE && target.value === "卖出后买入") completeTradeCycle(plan);
      if (plan.kind === KIND.SELL && target.value === "已执行") completeSellPlan(plan);
      saveState();
      renderHome();
      renderDetail();
    } else if (event.type === "change" && (["buyPrice", "buyShares", "sellPrice", "sellShares", "actualSellPrice", "actualTradeShares", "actualBuyPrice", "actualBuyShares", "dreamPrice"].includes(field) || buySellField)) {
      saveState();
      renderHome();
      renderDetail();
    }
  }

  function openHolding(holdingId, tab) {
    fundsOpen = false;
    selectedHoldingId = holdingId;
    selectedTab = tab || TAB.BUY;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => {
      if (selectedTab === TAB.STRATEGY) return;
      const moduleName = [TAB.BUY, TAB.SELL].includes(selectedTab) ? "buy-sell" : selectedTab;
      document.querySelector(`[data-plan-module="${moduleName}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  function closeDetail() {
    fundsOpen = false;
    selectedHoldingId = null;
    selectedTab = TAB.BUY;
    render();
  }

  function render() {
    const holding = getHolding(selectedHoldingId);
    els.pageTitle.textContent = fundsOpen ? "资金管理" : holding ? holding.name : "林青投资系统";
    els.pageSubtitle.textContent = fundsOpen ? "资金总览、账户与账本" : holding ? `${holding.code} · 计划与执行` : "持仓、盈亏与下一步计划";
    if (!cloudReady) els.syncStatus.textContent = "连接云端…";
    els.back.classList.toggle("hidden", !holding && !fundsOpen);
    els.home.classList.toggle("is-active", !holding && !fundsOpen);
    els.detail.classList.toggle("is-active", Boolean(holding) && !fundsOpen);
    els.funds.classList.toggle("is-active", fundsOpen);
    renderHome();
    renderDetail();
    renderFundsManagement();
  }

  function openFundsManagement() {
    selectedHoldingId = null;
    fundsOpen = true;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderFundsManagement() {
    if (!fundsOpen) return;
    recalculateAllHoldings();
    const totalMarket = sum(state.holdings.map(marketValue));
    const securityCash = sum(state.accounts.map((account) => account.availableCash));
    const bankCash = Number(state.bankCash) || 0;
    const totalAssets = totalMarket + securityCash + bankCash;
    const entries = [...(state.ledgerEntries || [])].sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
    els.fundsContent.innerHTML = `
      <div class="funds-page">
        <section class="funds-summary-strip">
          <div><span>总资产</span><strong>${wholeCurrency(totalAssets)}</strong></div>
          <div><span>证券市值</span><strong>${wholeCurrency(totalMarket)}</strong></div>
          <div><span>可用资金</span><strong>${wholeCurrency(securityCash)}</strong></div>
          <div><span>银行资金</span><strong>${wholeCurrency(bankCash)}</strong></div>
        </section>
        <section class="funds-section">
          <div class="funds-section-head"><div><strong>账户</strong><span>证券账户与银行资金</span></div></div>
          <div class="fund-account-list">
            ${state.accounts.map((account) => {
              const holdings = state.holdings.filter((holding) => holding.accountId === account.id);
              const market = sum(holdings.map(marketValue));
              return `<div class="fund-account-row"><div><strong>${html(account.name)}</strong><span>市值 ${wholeCurrency(market)}</span></div><div><span>可用资金</span><strong>${wholeCurrency(account.availableCash)}</strong></div><button type="button" data-fund-transfer="${attr(account.id)}">转入/转出</button></div>`;
            }).join("")}
            <div class="fund-account-row bank-account-row"><div><strong>银行资金</strong><span>活期、大额存单等</span></div><div><span>当前合计</span><strong>${wholeCurrency(bankCash)}</strong></div><button type="button" data-edit-bank-funds>调整</button></div>
          </div>
        </section>
        <section class="funds-section ledger-section">
          <div class="funds-section-head"><div><strong>账本</strong><span>收入、支出、转入和转出记录</span></div><button type="button" data-add-ledger>＋记一笔</button></div>
          <div class="ledger-list">${entries.length ? entries.map(renderLedgerEntry).join("") : `<div class="ledger-empty">暂无记录，点击“记一笔”开始。</div>`}</div>
        </section>
      </div>`;
  }

  function renderLedgerEntry(entry) {
    const incoming = ["收入", "转入", "利息"].includes(entry.type);
    return `<div class="ledger-row"><div class="ledger-date"><strong>${html(entry.date || "")}</strong><span>${html(entry.type || "记录")}</span></div><div class="ledger-copy"><strong>${html(entry.accountName || "未分类账户")}</strong><span>${html(entry.note || "--")}</span></div><strong class="ledger-amount ${incoming ? "profit-positive" : "profit-negative"}">${incoming ? "+" : "-"}${wholeCurrency(Math.abs(Number(entry.amount) || 0))}</strong><button type="button" data-delete-ledger="${attr(entry.id)}" aria-label="删除记录">×</button></div>`;
  }

  function handleFundsClick(event) {
    const transfer = event.target.closest("[data-fund-transfer]");
    if (transfer) { openBankTransfer(transfer.dataset.fundTransfer); return; }
    if (event.target.closest("[data-edit-bank-funds]")) { openBankFundsEditor(); return; }
    if (event.target.closest("[data-add-ledger]")) { openLedgerEditor(); return; }
    const remove = event.target.closest("[data-delete-ledger]");
    if (remove && window.confirm("删除这条账本记录吗？")) {
      state.ledgerEntries = (state.ledgerEntries || []).filter((item) => item.id !== remove.dataset.deleteLedger);
      saveState();
      renderFundsManagement();
    }
  }

  function openLedgerEditor() {
    document.querySelector(".stock-modal-backdrop")?.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "stock-modal-backdrop";
    backdrop.innerHTML = `<form class="stock-modal ledger-modal"><div class="stock-modal-title"><strong>账本 · 记一笔</strong><button type="button" data-close-stock-modal>×</button></div><div class="stock-modal-grid"><label><span>日期</span><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label><label><span>类型</span><select name="type"><option>支出</option><option>收入</option><option>转入</option><option>转出</option><option>利息</option></select></label><label><span>账户</span><select name="accountId">${state.accounts.map((account) => `<option value="${attr(account.id)}">${html(account.name)}</option>`).join("")}<option value="bank">银行资金</option></select></label><label><span>金额</span><input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required></label><label class="stock-modal-wide"><span>备注</span><input name="note" type="text" placeholder="用途或说明"></label></div><div class="stock-modal-actions"><button type="button" data-close-stock-modal>取消</button><button type="submit">保存</button></div></form>`;
    document.body.appendChild(backdrop);
    document.body.classList.add("modal-open");
    const close = () => { backdrop.remove(); document.body.classList.remove("modal-open"); };
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop || event.target.closest("[data-close-stock-modal]")) close(); });
    backdrop.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const accountId = String(values.get("accountId") || "bank");
      const account = state.accounts.find((item) => item.id === accountId);
      state.ledgerEntries.unshift(normalizeLedgerEntry({ id: `ledger-${Date.now()}`, date: values.get("date"), type: values.get("type"), accountId, accountName: account?.name || "银行资金", amount: Number(values.get("amount")), note: values.get("note"), createdAt: new Date().toISOString() }));
      saveState();
      close();
      renderFundsManagement();
    });
  }

  function openBankFundsEditor() {
    const next = window.prompt("请输入银行资金合计（元）", String(Number(state.bankCash) || 0));
    if (next == null) return;
    const value = Number(next);
    if (!Number.isFinite(value) || value < 0) return;
    state.bankCash = value;
    saveState();
    renderFundsManagement();
  }

  function renderHome() {
    recalculateAllHoldings();
    const totalMarket = sum(state.holdings.map(marketValue));
    const totalCash = sum(state.accounts.map((account) => account.availableCash));
    const totalPnl = sum(state.holdings.map(floatingPnl));
    const totalAsset = totalMarket + totalCash + (state.bankCash || 0);
    const position = totalMarket + totalCash > 0 ? totalMarket / (totalMarket + totalCash) * 100 : null;

    els.accountList.innerHTML = `
      <section class="dashboard-summary">
        <div class="summary-title-row"><div><strong>人民币账户 · A股</strong><span>资产总览</span></div><span class="position-badge">仓位 ${percent(position, 1)}</span></div>
        <div class="summary-grid">
          ${summaryCell("总资产", wholeCurrency(totalAsset))}
          ${summaryCell("总市值", wholeCurrency(totalMarket))}
          ${summaryCell("总盈亏", signedWholeCurrency(totalPnl), profitClass(totalPnl))}
          ${summaryCell("可用资金", wholeCurrency(totalCash))}
          <label class="summary-cell summary-edit-cell"><span class="summary-label">银行资金（含息）</span><input type="number" step="1" inputmode="numeric" data-home-bank-cash value="${inputNumber(state.bankCash, 0)}"></label>
        </div>
      </section>
      <section class="holdings-board">
        ${state.accounts.map(renderAccount).join("")}
      </section>`;
  }

  function renderAccount(account) {
    const holdings = state.holdings.filter((holding) => holding.accountId === account.id);
    const mv = sum(holdings.map(marketValue));
    const pnl = sum(holdings.map(floatingPnl));
    const asset = mv + (account.availableCash || 0);
    const position = asset > 0 ? mv / asset * 100 : null;
    return `
      <section class="account-group">
        <div class="account-group-head">
          <div class="account-identity"><strong>${html(account.name)}</strong><span class="account-position-badge">仓位 ${percent(position, 1)}</span></div>
          <div class="account-inline-stat account-total"><span class="account-stat-label section-title">总资产</span><strong class="account-stat-value">${wholeCurrency(asset)}</strong></div>
          <div class="account-inline-stat account-market"><span class="account-stat-label section-title">市值</span><strong class="account-stat-value">${wholeCurrency(mv)}</strong></div>
          <div class="account-inline-stat account-pnl"><span class="account-stat-label section-title">总盈亏</span><strong class="account-stat-value ${profitClass(pnl)}">${signedWholeCurrency(pnl)}</strong></div>
          <div class="account-cash-inline"><span class="account-stat-label section-title">可用资金</span><div class="account-cash-value-line"><strong class="account-stat-value">${wholeNumber(account.availableCash)}</strong><button type="button" class="bank-transfer-button" data-bank-transfer="${attr(account.id)}" aria-label="银行资金转入转出" title="银行资金转入/转出">银</button></div></div>
          <button type="button" class="account-add-button" data-add-holding="${attr(account.id)}" aria-label="新增股票" title="新增股票">＋</button>
        </div>
        <div class="portfolio-table-head portfolio-grid">
          <span class="section-title">股票/市值</span><span class="section-title">盈亏/盈亏率</span><span class="section-title">持仓</span><span class="section-title">成本/现价</span><span class="section-title">下一步</span>
        </div>
        <div class="portfolio-list">${holdings.map(renderHolding).join("")}</div>
      </section>`;
  }

  function renderHolding(holding) {
    const mv = marketValue(holding);
    const pnl = floatingPnl(holding);
    const rate = costAmount(holding) ? pnl / costAmount(holding) * 100 : null;
    const next = nextAction(holding.id);
    return `
      <article class="portfolio-stock" data-holding-id="${attr(holding.id)}">
        <div class="portfolio-grid portfolio-values">
          <button class="portfolio-name" type="button" data-open-holding="${attr(holding.id)}" data-open-tab="strategy"><strong class="cell-primary">${html(holding.name)}</strong><span class="cell-secondary">${wholeNumber(mv)}</span></button>
          <div class="two-line-number portfolio-pnl ${profitClass(pnl)}"><strong class="cell-primary">${signedWholeNumber(pnl)}</strong><span class="cell-primary">${signedPercent(rate)}</span></div>
          <div class="two-line-number portfolio-shares"><strong class="cell-primary">${integer(holding.shares)}</strong></div>
          <div class="two-line-number portfolio-cost-price"><div class="portfolio-cost-stack"><strong class="cell-primary">${price(holding.cost, 3)}</strong><label><input class="cell-primary ${profitClass(priceDifference(holding))}" type="number" step="0.001" inputmode="decimal" data-home-price="${attr(holding.id)}" value="${inputNumber(holding.currentPrice, 3)}" aria-label="${attr(holding.name)}现价"></label></div></div>
          <button class="portfolio-next-cell ${homeNextClass(next)}" data-open-holding="${attr(holding.id)}" data-open-tab="${next.kind || TAB.STRATEGY}"><span>${html(homeNextLabel(next))}</span><strong>${next.price == null ? "--" : `¥${price(next.price)}`}</strong><em>${next.shares == null ? "" : `${integer(next.shares)}股`}</em></button>
        </div>
      </article>`;
  }

  function homeNextLabel(action) {
    if (action.type === "T买回") return "T买";
    if (action.type === "T卖出") return "T卖";
    if (action.type === "买入") return "买";
    if (["卖出", "最终退出"].includes(action.type)) return "卖";
    return "暂无";
  }

  function homeNextClass(action) {
    return ["T买回", "买入"].includes(action.type) ? "next-buy" : ["T卖出", "卖出", "最终退出"].includes(action.type) ? "next-sell" : "next-none";
  }

  function priceDifference(holding) {
    return Number.isFinite(holding.currentPrice) && Number.isFinite(holding.cost) ? holding.currentPrice - holding.cost : null;
  }

  function renderDetail() {
    const holding = getHolding(selectedHoldingId);
    if (!holding) { els.detailContent.innerHTML = ""; return; }
    recalculateHolding(holding);
    els.detailContent.innerHTML = `
      <section class="detail-shell">
        <div class="detail-overview">
          <div class="detail-overview-head detail-controls-only"><label class="strategy-type-select"><span>策略类型</span><select data-holding-field="strategyType">${strategyTypeOptions(holding.strategyType)}</select></label></div>
          <div class="detail-quote-grid">
            ${quote("持仓", integer(holding.shares), "", "shares")}${quote("平均成本", price(holding.cost, 3), "", "cost")}
            <label class="quote-cell"><span>当前价</span><input type="number" step="0.001" data-holding-field="currentPrice" value="${inputNumber(holding.currentPrice, 3)}"></label>
            ${quote("市值", plainMoney(marketValue(holding)), "", "market")}${quote("浮盈亏", signedPlain(floatingPnl(holding)), profitClass(floatingPnl(holding)), "pnl")}${quote("累计T盈利", signedPlain(totalTradeProfit(holding.id)), profitClass(totalTradeProfit(holding.id)), "trade-profit")}
          </div>
          ${renderNextActions(holding)}
        </div>
        <div class="detail-tab-content planbook-content">${renderBuyTab(holding)}${renderTradeTab(holding)}${renderStrategyTab(holding)}</div>
      </section>`;
  }

  function renderNextActions(holding) {
    const actions = [latestActionForKind(holding, KIND.BUY), latestActionForKind(holding, KIND.SELL), latestActionForKind(holding, KIND.TRADE)]
      .sort((a, b) => actionDistance(a) - actionDistance(b));
    return `<div class="next-actions-panel"><div class="next-actions-title">下一步操作</div>${actions.map((action) => `<div class="next-action-row"><div class="next-action-main"><em>${html(action.type)}</em><strong>${html(action.text)}</strong></div><div class="next-action-meta"><span>距离当前价 ${action.distance == null ? "--" : signedPercent(action.distance)}</span><span>来源：${html(action.source)}</span></div></div>`).join("")}</div>`;
  }

  function actionDistance(action) { return Number.isFinite(action.distance) ? Math.abs(action.distance) : Number.POSITIVE_INFINITY; }

  function latestActionForKind(holding, kind) {
    const plans = state.plans.filter((plan) => plan.holdingId === holding.id);
    if (kind === KIND.TRADE) {
      const active = plans.find((plan) => plan.kind === KIND.TRADE && plan.operation === "已卖出");
      if (active) return actionResult(holding, active, "做T", active.buyPrice, active.actualTradeShares || active.sellShares, "做T计划（已卖出）", `等待 ${price(active.buyPrice)} 买回 ${integer(active.actualTradeShares || active.sellShares)}股`, KIND.TRADE);
      const plan = nearestPlan(plans.filter((item) => item.kind === KIND.TRADE && isAvailablePlan(item)), holding.currentPrice, "sellPrice");
      return plan ? actionResult(holding, plan, "做T", plan.sellPrice, plan.sellShares, "做T计划", `${price(plan.sellPrice)} T卖出 ${integer(plan.sellShares)}股`, KIND.TRADE) : emptyKindAction("做T", "做T计划");
    }
    if (kind === KIND.BUY) {
      const plan = nearestPlan(plans.filter((item) => (item.kind === KIND.BUY || item.kind === KIND.ADD) && !item.holdingBased && isAvailablePlan(item) && !item.actualApplied), holding.currentPrice, "buyPrice");
      return plan ? actionResult(holding, plan, "买入", plan.buyPrice, plan.buyShares, plan.kind === KIND.ADD ? "补仓计划" : "买卖计划", `${price(plan.buyPrice)} 买入 ${integer(plan.buyShares)}股`, KIND.BUY) : emptyKindAction("买入", "买卖计划");
    }
    const pairedTier = nearestPendingBuySellTier(holding, plans);
    if (pairedTier) return actionResult(holding, pairedTier.plan, "卖出", pairedTier.price, pairedTier.shares, `买卖计划（${pairedTier.tier.label}）`, `${price(pairedTier.price)} 卖出 ${integer(pairedTier.shares)}股`, KIND.SELL);
    const sellPlans = plans.filter((item) => item.kind === KIND.SELL && isAvailablePlan(item));
    const plan = nearestPlan(sellPlans.filter((item) => !isFinalExitPlan(item)), holding.currentPrice, "sellPrice") || nearestPlan(sellPlans, holding.currentPrice, "sellPrice");
    return plan ? actionResult(holding, plan, "卖出", plan.sellPrice, plan.sellShares, isFinalExitPlan(plan) ? "最终退出计划" : "买卖计划", `${price(plan.sellPrice)} 卖出 ${integer(plan.sellShares)}股`, KIND.SELL) : emptyKindAction("卖出", "买卖计划");
  }

  function emptyKindAction(type, source) { return { type, text: "暂无", source, distance: null }; }

  function renderActiveTab(holding) {
    if ([TAB.BUY, TAB.SELL].includes(selectedTab)) return renderBuyTab(holding);
    if (selectedTab === TAB.TRADE) return renderTradeTab(holding);
    return renderStrategyTab(holding);
  }

  function renderBuyTab(holding) {
    const buys = plansOf(holding.id, KIND.BUY);
    const count = buys.length;
    return `
      <details class="plan-accordion" data-plan-module="buy-sell" ${count || [TAB.BUY, TAB.SELL].includes(selectedTab) ? "open" : ""}>
        <summary class="accordion-summary"><div><strong>买卖计划</strong><span>持仓或买入后按 5% / 10% / 15% / 20% / DP 分档卖出</span></div><div class="accordion-summary-actions"><b>${count}条</b><button type="button" class="sheet-add summary-add" data-add-plan="buy">＋买卖</button></div></summary>
        <div class="accordion-body">
        <div class="mobile-plan-list">${buys.length ? buys.map(renderBuyCard).join("") : emptyCard("暂无买卖计划")}</div>
        <div class="excel-table buy-sheet desktop-plan-table">
          <div class="excel-head"><span>操作计划</span><span>序号</span><span>价格</span><span>股数</span><span>计划成本</span><span>实际买入价</span><span>实际股数</span><span>实际成本</span><span></span></div>
          ${buys.length ? buys.map(renderBuyRow).join("") : emptyRow("暂无买卖计划")}
        </div>
        </div>
      </details>`;
  }

  function renderBuyRow(plan, index) {
    return `<div class="excel-row ${plan.operation === "买入" ? "is-selected-operation" : ""}" data-plan-id="${attr(plan.id)}">
      ${selectCell("操作计划", "operation", plan.operation, ["买入", NONE])}${textCell("序号", String(plan.sequence || index + 1))}
      ${numberCell("价格", "buyPrice", plan.buyPrice, "0.001")}${numberCell("股数", "buyShares", plan.buyShares, "100")}${calcCell("计划成本", money(amount(plan.buyPrice, plan.buyShares)), "plan-cost")}
      ${numberCell("实际买入价", "actualBuyPrice", plan.actualBuyPrice, "0.001")}${numberCell("实际股数", "actualBuyShares", plan.actualBuyShares, "100")}${calcCell("实际成本", money(amount(plan.actualBuyPrice, plan.actualBuyShares)), "actual-cost")}${deleteCell(plan.id)}
    </div>`;
  }

  function renderBuyCard(plan, index) {
    const showActual = plan.operation === "买入";
    const executed = Boolean(showActual && plan.actualApplied && positive(plan.actualBuyPrice) && positive(plan.actualBuyShares || plan.buyShares));
    return `<article class="mobile-plan-card compact-plan-card buy-sell-cycle-card ${executed ? "is-buy-executed" : ""}" data-plan-id="${attr(plan.id)}">
      <div class="t-plan-inline">
        <strong class="t-inline-title">买卖${padNo(plan.sequence || index + 1)}</strong>
        <div class="t-inline-buy"><span>买</span>${inlinePlanNumber("buyPrice", plan.buyPrice)}<b>×</b>${inlinePlanNumber("buyShares", plan.buyShares, 100)}<i>股</i></div>
        <strong class="t-inline-profit profit-neutral" data-calc="plan-cost">${money(amount(plan.buyPrice, plan.buyShares))}</strong>
        <span class="t-inline-cycle">第${integer(plan.cycleNo || 1)}次</span>
        ${mobileSelect("operation", plan.operation, [[NONE, "未触发"], ["买入", executed ? "已买入" : "执行买入"]])}
        ${mobileDelete(plan.id)}
      </div>
      ${renderSellTierGrid(plan)}
      ${showActual ? `<div class="actual-buy-sell-block ${executed ? "is-buy-executed" : ""}"><div class="inline-actual-row buy-actual-row"><span>实际买入</span>${inlinePlanNumber("actualBuyPrice", plan.actualBuyPrice)}<b>×</b>${inlinePlanNumber("actualBuyShares", plan.actualBuyShares || plan.buyShares, 100)}<i>股</i><strong data-calc="actual-cost">${money(amount(plan.actualBuyPrice, plan.actualBuyShares || plan.buyShares))}</strong></div>${renderActualSellTierGrid(plan, executed)}</div>` : ""}
    </article>`;
  }

  function renderSellTierGrid(plan) {
    return `<div class="sell-tier-grid">${SELL_TIERS.map((tier) => {
      const sharesField = `sell${tier.key}Shares`;
      const targetPrice = plannedTierPrice(plan, tier);
      const rateEditor = tier.key === "dp" ? `<strong>DP</strong>` : `<label class="tier-rate-editor"><input type="number" step="0.1" inputmode="decimal" data-field="target${tier.key}Rate" value="${inputNumber(plan[`target${tier.key}Rate`], 1)}"><i>%</i></label>`;
      const priceField = tier.key === "dp" ? "dreamPrice" : `target${tier.key}Price`;
      const priceDisplay = `<input type="number" step="0.001" inputmode="decimal" data-field="${priceField}" value="${inputNumber(targetPrice, 3)}" placeholder="目标价">`;
      return `<div class="sell-tier"><div class="sell-tier-top">${rateEditor}${priceDisplay}</div><div class="sell-tier-bottom"><label><input type="number" min="0" step="100" inputmode="numeric" data-field="${sharesField}" value="${inputNumber(plan[sharesField], 0)}" placeholder="0"><i>股</i></label></div></div>`;
    }).join("")}</div>`;
  }

  function renderActualSellTierGrid(plan, enabled) {
    return `<div class="sell-tier-grid actual-sell-tier-grid">${SELL_TIERS.map((tier) => {
      const rateField = `actualTarget${tier.key}Rate`;
      const priceField = `actualSell${tier.key}Price`;
      const sharesField = `actualSell${tier.key}Shares`;
      const doneField = `actualSell${tier.key}Done`;
      const actualPrice = plan[priceField];
      const calculatedRate = positive(plan.actualBuyPrice) && positive(actualPrice) ? (actualPrice / plan.actualBuyPrice - 1) * 100 : null;
      const actualRate = Number.isFinite(plan[rateField]) ? plan[rateField] : calculatedRate;
      return `<div class="sell-tier ${plan[doneField] ? "is-tier-done" : ""}"><div class="sell-tier-top"><label class="tier-rate-editor actual-rate-editor"><input type="number" step="0.1" inputmode="decimal" data-field="${rateField}" value="${inputNumber(actualRate, 1)}" placeholder="--"><i>%</i></label><input type="number" step="0.001" inputmode="decimal" data-field="${priceField}" value="${inputNumber(actualPrice, 3)}" placeholder="实际卖价"></div><div class="sell-tier-bottom"><label><input type="number" min="0" step="100" inputmode="numeric" data-field="${sharesField}" value="${inputNumber(plan[sharesField], 0)}" placeholder="0"><i>股</i></label><label class="tier-done" title="标记已卖"><input type="checkbox" aria-label="标记已卖" data-field="${doneField}" ${plan[doneField] ? "checked" : ""} ${enabled ? "" : "disabled"}></label></div></div>`;
    }).join("")}</div>`;
  }

  function renderAddRow(plan, index) {
    return `<div class="excel-row ${plan.operation === "买入" ? "is-selected-operation" : ""}" data-plan-id="${attr(plan.id)}">
      ${selectCell("操作计划", "operation", plan.operation, ["买入", NONE])}${textCell("序号", String(plan.sequence || index + 1))}${numberCell("买入价格", "buyPrice", plan.buyPrice, "0.001")}${numberCell("股数", "buyShares", plan.buyShares, "100")}${calcCell("买入金额", money(amount(plan.buyPrice, plan.buyShares)), "plan-cost")}
      ${selectCell("补仓后用途", "useAfterBuy", plan.useAfterBuy, ["加入做T仓", "等目标价卖出", "长期持有", "待定"])}${selectCell("状态", "status", plan.status, ["未触发", "已触发待执行", "已执行", "暂停", "取消"])}${inputCell("备注", "note", plan.note)}${deleteCell(plan.id)}
    </div>`;
  }

  function renderSellTab(holding) {
    const plans = plansOf(holding.id, KIND.SELL);
    const title = sellModuleName(holding);
    return `<details class="plan-accordion" data-plan-module="sell" ${shouldOpenModule(holding, KIND.SELL, plans.length) ? "open" : ""}>${accordionSummary(title, plans.length, plans.length ? "按价格接近程度执行" : "暂无计划", KIND.SELL)}
      <div class="accordion-body">
      <div class="mobile-plan-list">${plans.length ? plans.map((plan, index) => renderSellCard(plan, index, holding)).join("") : emptyCard("暂无卖出计划")}</div>
      <div class="excel-table sell-sheet desktop-plan-table"><div class="excel-head"><span>操作计划</span><span>序号</span><span>成本价</span><span>持仓股数</span><span>卖出价格</span><span>卖出股数</span><span>卖出总价</span><span>预计盈利</span><span>状态</span><span>备注</span><span></span></div>
      ${plans.length ? plans.map((plan, index) => renderSellRow(plan, index, holding)).join("") : emptyRow("暂无卖出计划")}</div></div></details>`;
  }

  function renderSellRow(plan, index, holding) {
    const expected = Number.isFinite(plan.sellPrice) && Number.isFinite(plan.sellShares) && Number.isFinite(holding.cost) ? (plan.sellPrice - holding.cost) * plan.sellShares : null;
    return `<div class="excel-row" data-plan-id="${attr(plan.id)}">
      ${selectCell("操作计划", "operation", plan.operation, ["卖出", NONE])}${textCell("序号", String(plan.sequence || index + 1))}${textCell("成本价", price(holding.cost, 3))}${textCell("持仓股数", integer(holding.shares))}${numberCell("卖出价格", "sellPrice", plan.sellPrice, "0.001")}${numberCell("卖出股数", "sellShares", plan.sellShares, "100")}${calcCell("卖出总价", money(amount(plan.sellPrice, plan.sellShares)), "sell-total")}${calcCell("预计盈利", signedMoney(expected), "expected-profit", profitClass(expected))}${selectCell("状态", "status", plan.status, ["未触发", "已触发待执行", "已执行", "暂停", "取消"])}${inputCell("备注", "note", plan.note || plan.purpose)}${deleteCell(plan.id)}
    </div>`;
  }

  function renderSellCard(plan, index, holding) {
    const expected = positive(plan.sellPrice) && positive(plan.sellShares) && positive(holding.cost) ? (plan.sellPrice - holding.cost) * plan.sellShares : null;
    const completed = plan.operation === "已执行" || plan.status === "已执行";
    return `<article class="mobile-plan-card compact-plan-card ${completed ? "is-completed-operation" : ""}" data-plan-id="${attr(plan.id)}">
      <div class="t-plan-inline">
        <strong class="t-inline-title">卖${padNo(plan.sequence || index + 1)}</strong>
        <div class="t-inline-sell"><span>卖</span>${inlinePlanNumber("sellPrice", plan.sellPrice)}<b>×</b>${inlinePlanNumber("sellShares", plan.sellShares, 100)}<i>股</i></div>
        <input class="inline-note-input" type="text" data-field="note" value="${attr(plan.note || plan.purpose)}" placeholder="备注">
        <strong class="t-inline-profit ${profitClass(expected)}" data-calc="expected-profit">${signedMoney(expected)}</strong>
        ${mobileSelect("operation", plan.operation, [[NONE, "未触发"], ["卖出", "待卖出"], ["已执行", "已完成"], ["暂停", "暂停"], ["取消", "取消"]])}
        ${mobileDelete(plan.id)}
      </div>
    </article>`;
  }

  function renderTradeTab(holding) {
    const plans = plansOf(holding.id, KIND.TRADE);
    const history = state.tradeHistory.filter((item) => item.holdingId === holding.id);
    const completedSales = state.completedSales.filter((item) => item.holdingId === holding.id);
    const completedCount = history.length + completedSales.length;
    const tradeProfit = totalTradeProfit(holding.id);
    const sellProfit = totalSellProfit(holding.id);
    const allProfit = tradeProfit + sellProfit;
    return `
      <details class="plan-accordion" data-plan-module="trade" ${shouldOpenModule(holding, KIND.TRADE, plans.length) ? "open" : ""}>${accordionSummary("做T计划", plans.length, plans.length ? "预设卖出与买回档位" : "暂无计划", KIND.TRADE)}
        <div class="accordion-body">
        <div class="mobile-plan-list">${plans.length ? plans.map(renderTradePlanCard).join("") : emptyCard("暂无做T计划")}</div>
        <div class="excel-table trade-plan-sheet desktop-plan-table"><div class="excel-head"><span>操作计划</span><span>序号</span><span>卖出价格</span><span>股数</span><span>买入价格</span><span>做T盈利</span><span></span></div>${plans.length ? plans.map(renderTradePlanRow).join("") : emptyRow("暂无做T计划")}</div>
      </div></details>
      <details class="plan-accordion" data-plan-module="trade-history" ${completedCount ? "open" : ""}>${accordionSummary("已完成", completedCount, `总收益 ${signedMoney(allProfit)}`)}
        <div class="accordion-body">
        <div class="completion-totals"><span>做T收益<strong class="${profitClass(tradeProfit)}">${signedMoney(tradeProfit)}</strong></span><span>卖出收益<strong class="${profitClass(sellProfit)}">${signedMoney(sellProfit)}</strong></span><span>总收益<strong class="${profitClass(allProfit)}">${signedMoney(allProfit)}</strong></span></div>
        <div class="mobile-plan-list">${completedCount ? `${completedSales.map(renderCompletedSaleCard).join("")}${history.map(renderHistoryCard).join("")}` : emptyCard("暂无已完成记录")}</div>
        <div class="excel-table trade-history-sheet desktop-plan-table"><div class="excel-head"><span>序号</span><span>类型/次数</span><span>卖出价格</span><span>股数</span><span>买入价格</span><span>实际盈利</span></div>${completedCount ? `${completedSales.map(renderCompletedSaleRow).join("")}${history.map(renderHistoryRow).join("")}` : emptyRow("暂无已完成记录")}</div>
      </div></details>`;
  }

  function renderTradePlanRow(plan, index) {
    const profit = Number.isFinite(plan.sellPrice) && Number.isFinite(plan.buyPrice) && Number.isFinite(plan.sellShares) ? (plan.sellPrice - plan.buyPrice) * plan.sellShares : null;
    return `<div class="excel-row ${plan.operation !== NONE ? "is-selected-operation" : ""}" data-plan-id="${attr(plan.id)}">${selectCell("操作计划", "operation", plan.operation, ["已卖出", "卖出后买入", NONE])}${textCell("序号", String(plan.sequence || index + 1))}${numberCell("卖出价格", "sellPrice", plan.sellPrice, "0.001")}${numberCell("股数", "sellShares", plan.sellShares, "100")}${numberCell("买入价格", "buyPrice", plan.buyPrice, "0.001")}${calcCell("做T盈利", signedMoney(profit), "trade-profit", profitClass(profit))}${deleteCell(plan.id)}</div>`;
  }

  function renderTradePlanCard(plan, index) {
    const profit = positive(plan.sellPrice) && positive(plan.buyPrice) && positive(plan.sellShares) ? (plan.sellPrice - plan.buyPrice) * plan.sellShares : null;
    const active = plan.operation === "已卖出";
    return `<article class="mobile-plan-card compact-plan-card ${active ? "is-selected-operation" : ""}" data-plan-id="${attr(plan.id)}">
      <div class="t-plan-inline">
        <strong class="t-inline-title">T${padNo(plan.sequence || index + 1)}</strong>
        <div class="t-inline-sell"><span>卖</span>${inlinePlanNumber("sellPrice", plan.sellPrice)}<b>×</b>${inlinePlanNumber("sellShares", plan.sellShares, 100)}<i>股</i></div>
        <span class="t-inline-divider" aria-hidden="true">｜</span>
        <div class="t-inline-buy"><span>买</span>${inlinePlanNumber("buyPrice", plan.buyPrice)}<b>×</b><i>${integer(plan.sellShares)}股</i></div>
        <strong class="t-inline-profit ${profitClass(profit)}" data-calc="trade-profit">${signedMoney(profit)}</strong>
        <span class="t-inline-cycle">第${integer(plan.cycleNo || 1)}次</span>
        ${mobileSelect("operation", plan.operation, [[NONE, "未触发"], ["已卖出", "已卖出"], ["卖出后买入", "已完成"], ["暂停", "暂停"], ["取消", "取消"]])}
        ${mobileDelete(plan.id)}
      </div>
      ${active ? renderTradeActualInline(plan) : ""}
    </article>`;
  }

  function renderTradeActualInline(plan) {
    const shares = plan.actualTradeShares || plan.sellShares;
    return `<div class="trade-actual-inline">
      <div class="trade-actual-half trade-actual-sell"><span>实际卖</span>${inlinePlanNumber("actualSellPrice", plan.actualSellPrice)}<b>×</b>${inlinePlanNumber("actualTradeShares", shares, 100)}<i>股</i></div>
      <span class="t-inline-divider" aria-hidden="true">｜</span>
      <div class="trade-actual-half trade-actual-buy"><span>实际买</span>${inlinePlanNumber("actualBuyPrice", plan.actualBuyPrice)}<b>×</b><i>${integer(shares)}股</i></div>
      <strong class="${profitClass(actualTradeProfit(plan))}" data-calc="actual-trade-profit">${signedMoney(actualTradeProfit(plan))}</strong>
    </div>`;
  }

  function renderTradeActiveCard(plan) {
    return `<article class="mobile-plan-card active-trade-card is-selected-operation" data-plan-id="${attr(plan.id)}">
      <div class="mobile-card-head"><strong>进行中 T ${padNo(plan.cycleNo || 1)}</strong>${mobileSelect("operation", plan.operation, [["已卖出", "等待买回"], ["卖出后买入", "完成闭环"], ["暂停", "暂停"], ["取消", "取消"]])}</div>
      <div class="execution-line"><span>已卖出：</span>${inlinePlanNumber("actualSellPrice", plan.actualSellPrice)}<b>×</b>${inlinePlanNumber("actualTradeShares", plan.actualTradeShares || plan.sellShares, 100)}<i>股</i></div>
      <div class="trade-buy-line"><span>等待买回：</span>${inlinePlanNumber("buyPrice", plan.buyPrice)}<span>实际买回</span>${inlinePlanNumber("actualBuyPrice", plan.actualBuyPrice)}</div>
      <div class="result-line"><span>状态：等待买回</span><strong class="${profitClass(actualTradeProfit(plan))}" data-calc="actual-trade-profit">${signedMoney(actualTradeProfit(plan))}</strong></div>
    </article>`;
  }

  function renderHistoryCard(item, index) {
    return `<article class="mobile-plan-card compact-plan-card history-inline-card is-completed-record"><div class="t-plan-inline">
      <strong class="t-inline-title">T${padNo(item.sequence || index + 1)}</strong>
      <div class="t-inline-sell"><span>卖</span><i>${price(item.sellPrice, 3)}</i><b>×</b><i>${integer(item.shares)}股</i></div>
      <span class="t-inline-divider" aria-hidden="true">｜</span>
      <div class="t-inline-buy"><span>买</span><i>${price(item.buyPrice, 3)}</i><b>×</b><i>${integer(item.shares)}股</i></div>
      <strong class="t-inline-profit ${profitClass(item.profit)}">${signedMoney(item.profit)}</strong>
      <span class="t-inline-cycle">第${integer(item.cycleNo || 1)}次</span><span class="done-label">已完成</span>${completedDelete("history", item.id)}
    </div></article>`;
  }

  function renderCompletedSaleCard(item, index) {
    const paired = item.type === "买卖计划";
    return `<article class="mobile-plan-card compact-plan-card history-inline-card completed-sale-card is-completed-record"><div class="t-plan-inline">
      <strong class="t-inline-title">${paired ? "买卖" : "卖"}${padNo(item.sequence || index + 1)}</strong>
      ${paired ? `<div class="t-inline-buy"><span>买</span><i>${price(item.buyPrice, 3)}</i><b>×</b><i>${integer(item.shares)}股</i></div><span class="t-inline-divider">｜</span>` : ""}
      <div class="t-inline-sell"><span>卖</span><i>${price(item.sellPrice, 3)}</i><b>×</b><i>${integer(item.shares)}股</i></div>
      <span class="completed-note">${html(item.note || "普通卖出")}</span>
      <strong class="t-inline-profit ${profitClass(item.profit)}">${signedMoney(item.profit)}</strong><span class="done-label">已完成</span>${completedDelete("sale", item.id)}
    </div></article>`;
  }

  function renderTradeActualRow(plan) {
    const profit = actualTradeProfit(plan);
    return `<div class="excel-row ${plan.operation !== NONE ? "is-selected-operation" : ""}" data-plan-id="${attr(plan.id)}">${textCell("计划", plan.label || "做T")}${textCell("操作次数", `第${plan.cycleNo || 1}次`)}${numberCell("实际卖出价", "actualSellPrice", plan.actualSellPrice, "0.001")}${numberCell("股数", "actualTradeShares", plan.actualTradeShares, "100")}${numberCell("实际买入价", "actualBuyPrice", plan.actualBuyPrice, "0.001")}${calcCell("实际T盈利", signedMoney(profit), "actual-trade-profit", profitClass(profit))}</div>`;
  }

  function renderHistoryRow(item, index) {
    return `<div class="excel-row is-completed-record">${textCell("序号", String(index + 1))}${textCell("操作次数", `第${item.cycleNo}次`)}${textCell("卖出价格", price(item.sellPrice, 3))}${textCell("股数", integer(item.shares))}${textCell("买入价格", price(item.buyPrice, 3))}${calcCell("做T盈利", signedMoney(item.profit), "", profitClass(item.profit))}</div>`;
  }

  function renderCompletedSaleRow(item, index) {
    return `<div class="excel-row is-completed-record">${textCell("序号", String(index + 1))}${textCell("类型", item.type || "普通卖出")}${textCell("卖出价格", price(item.sellPrice, 3))}${textCell("股数", integer(item.shares))}${textCell("买入价格", item.buyPrice == null ? "--" : price(item.buyPrice, 3))}${calcCell("卖出收益", signedMoney(item.profit), "", profitClass(item.profit))}</div>`;
  }

  function renderStrategyTab(holding) {
    const hasContent = Boolean(holding.strategyText || holding.reflectionNote || holding.risk || holding.extraNote);
    return `<details class="plan-accordion strategy-sheet" data-plan-module="strategy" ${selectedTab === TAB.STRATEGY || hasContent ? "open" : ""}>${accordionSummary("策略说明", hasContent ? 1 : 0, strategySummary(holding))}<div class="accordion-body"><textarea data-holding-field="strategyText" placeholder="在这里记录这只股票的完整策略……">${html(holding.strategyText || holding.reflectionNote || "")}</textarea>${holding.risk ? `<div class="strategy-reference"><strong>风险提醒</strong><p>${html(holding.risk)}</p></div>` : ""}${holding.extraNote ? `<div class="strategy-reference"><strong>补充说明</strong><p>${html(holding.extraNote)}</p></div>` : ""}</div></details>`;
  }

  function syncActualOperation(plan, commit) {
    if (plan.kind === KIND.BUY || plan.kind === KIND.ADD) {
      const lotId = plan.kind === KIND.BUY ? buyCycleLotId(plan) : `${plan.id}-actual-buy`;
      const actualBuyShares = plan.actualBuyShares || plan.buyShares;
      const addExecuted = plan.kind === KIND.ADD && plan.status === "已执行" && positive(plan.buyPrice) && positive(plan.buyShares);
      const buyExecuted = plan.kind === KIND.BUY && plan.operation === "买入" && positive(plan.actualBuyPrice) && positive(actualBuyShares);
      if (addExecuted || buyExecuted) {
        upsertLot({ id: lotId, holdingId: plan.holdingId, side: SIDE.BUY, label: plan.kind === KIND.ADD ? "补仓买入" : "实际买入", price: addExecuted ? plan.buyPrice : plan.actualBuyPrice, shares: addExecuted ? plan.buyShares : actualBuyShares, source: "actual" });
        plan.actualApplied = true;
      } else {
        removeLot(lotId);
        if (plan.kind === KIND.BUY) SELL_TIERS.forEach((tier) => removeLot(buyTierLotId(plan, tier.key)));
        plan.actualApplied = false;
      }
      recalculateHolding(getHolding(plan.holdingId));
      return;
    }

    if (plan.kind === KIND.TRADE && plan.operation === NONE) {
      removeLot(tradeLotId(plan, "sell"));
      plan.sellApplied = false;
      if (commit) recalculateHolding(getHolding(plan.holdingId));
      return;
    }

    if (plan.kind === KIND.TRADE && plan.operation === "已卖出") {
      const shares = plan.actualTradeShares || plan.sellShares;
      const lotId = tradeLotId(plan, "sell");
      if (positive(plan.actualSellPrice) && positive(shares)) {
        upsertLot({ id: lotId, holdingId: plan.holdingId, side: SIDE.SELL, label: `T卖出第${plan.cycleNo}次`, price: plan.actualSellPrice, shares, source: "trade" });
        plan.sellApplied = true;
      } else {
        removeLot(lotId);
        plan.sellApplied = false;
      }
      if (commit) recalculateHolding(getHolding(plan.holdingId));
    }
  }

  function plannedTierPrice(plan, tier) {
    if (tier.key === "dp") return numberOrNull(plan.dreamPrice);
    const explicit = numberOrNull(plan[`target${tier.key}Price`]);
    if (positive(explicit)) return explicit;
    const rate = numberOrNull(plan[`target${tier.key}Rate`]);
    return positive(plan.buyPrice) && Number.isFinite(rate) ? plan.buyPrice * (1 + rate / 100) : null;
  }

  function syncPlannedTierFields(plan, field) {
    if (field === "buyPrice") {
      SELL_TIERS.filter((tier) => tier.rate != null).forEach((tier) => {
        const rate = numberOrNull(plan[`target${tier.key}Rate`]);
        plan[`target${tier.key}Price`] = positive(plan.buyPrice) && Number.isFinite(rate) ? plan.buyPrice * (1 + rate / 100) : null;
      });
      return;
    }
    const rateMatch = field.match(/^target(5|10|15|20)Rate$/);
    if (rateMatch) {
      const key = rateMatch[1];
      const rate = numberOrNull(plan[field]);
      plan[`target${key}Price`] = positive(plan.buyPrice) && Number.isFinite(rate) ? plan.buyPrice * (1 + rate / 100) : null;
      return;
    }
    const priceMatch = field.match(/^target(5|10|15|20)Price$/);
    if (priceMatch) {
      const key = priceMatch[1];
      const targetPrice = numberOrNull(plan[field]);
      plan[`target${key}Rate`] = positive(plan.buyPrice) && positive(targetPrice) ? (targetPrice / plan.buyPrice - 1) * 100 : null;
    }
  }

  function syncActualTierFields(plan, field) {
    if (field === "actualBuyPrice") {
      SELL_TIERS.forEach((tier) => {
        const actualPrice = numberOrNull(plan[`actualSell${tier.key}Price`]);
        plan[`actualTarget${tier.key}Rate`] = positive(plan.actualBuyPrice) && positive(actualPrice) ? (actualPrice / plan.actualBuyPrice - 1) * 100 : null;
      });
      return;
    }
    const rateMatch = field.match(/^actualTarget(5|10|15|20|dp)Rate$/);
    if (rateMatch) {
      const key = rateMatch[1];
      const rate = numberOrNull(plan[field]);
      plan[`actualSell${key}Price`] = positive(plan.actualBuyPrice) && Number.isFinite(rate) ? plan.actualBuyPrice * (1 + rate / 100) : null;
      return;
    }
    const priceMatch = field.match(/^actualSell(5|10|15|20|dp)Price$/);
    if (priceMatch) {
      const key = priceMatch[1];
      const actualPrice = numberOrNull(plan[field]);
      plan[`actualTarget${key}Rate`] = positive(plan.actualBuyPrice) && positive(actualPrice) ? (actualPrice / plan.actualBuyPrice - 1) * 100 : null;
    }
  }

  function buyCycleLotId(plan) { return `${plan.id}-buy-cycle-${plan.cycleNo || 1}`; }
  function buyTierLotId(plan, tierKey) { return `${plan.id}-buy-cycle-${plan.cycleNo || 1}-sell-${tierKey}`; }

  function syncBuySellTargets(plan, commit) {
    if (plan.kind !== KIND.BUY) return;
    SELL_TIERS.forEach((tier) => {
      const done = Boolean(plan[`actualSell${tier.key}Done`]);
      const shares = integerValue(plan[`actualSell${tier.key}Shares`]);
      const sellPrice = numberOrNull(plan[`actualSell${tier.key}Price`]);
      const lotId = buyTierLotId(plan, tier.key);
      if (plan.actualApplied && done && positive(shares) && positive(sellPrice)) {
        upsertLot({ id: lotId, holdingId: plan.holdingId, side: SIDE.SELL, label: `买卖计划${tier.label}卖出`, price: sellPrice, shares, source: "buy-sell" });
      } else {
        removeLot(lotId);
      }
    });
    recalculateHolding(getHolding(plan.holdingId));
    if (commit) completeBuySellCycleIfReady(plan);
  }

  function completeBuySellCycleIfReady(plan) {
    if (!plan.actualApplied) return;
    const boughtShares = integerValue(plan.actualBuyShares || plan.buyShares);
    const completedTiers = SELL_TIERS.filter((tier) => plan[`actualSell${tier.key}Done`]);
    const soldShares = sum(completedTiers.map((tier) => integerValue(plan[`actualSell${tier.key}Shares`])));
    if (!positive(boughtShares) || soldShares < boughtShares) return;
    if (completedTiers.some((tier) => !positive(plan[`actualSell${tier.key}Price`]) || !positive(plan[`actualSell${tier.key}Shares`]))) {
      window.alert("请先填写所有已卖档位的实际卖出价格和股数。 ");
      return;
    }
    if (soldShares > boughtShares) {
      window.alert(`已卖股数 ${integer(soldShares)} 超过实际买入 ${integer(boughtShares)} 股，请调整后再完成。`);
      return;
    }
    const revenue = sum(completedTiers.map((tier) => numberOrNull(plan[`actualSell${tier.key}Price`]) * integerValue(plan[`actualSell${tier.key}Shares`])));
    const averageSellPrice = soldShares ? revenue / soldShares : null;
    const buyPrice = plan.actualBuyPrice || plan.buyPrice;
    const profit = revenue - buyPrice * soldShares;
    const record = normalizeCompletedSale({
      id: `${plan.id}-buy-sell-${plan.cycleNo || 1}-${Date.now()}`,
      holdingId: plan.holdingId,
      planId: plan.id,
      sequence: plan.sequence,
      type: "买卖计划",
      cycleNo: plan.cycleNo || 1,
      buyPrice,
      sellPrice: averageSellPrice,
      shares: soldShares,
      profit,
      note: `第${plan.cycleNo || 1}次买卖闭环`,
      completedAt: new Date().toISOString()
    });
    SELL_TIERS.forEach((tier) => removeLot(buyTierLotId(plan, tier.key)));
    upsertLot({ id: completedSaleLotId(record.id), holdingId: record.holdingId, side: SIDE.SELL, label: "买卖计划完成", price: averageSellPrice, shares: soldShares, source: "completed-sale" });
    state.completedSales.push(record);
    plan.cycleNo = (plan.cycleNo || 1) + 1;
    plan.operation = NONE;
    plan.status = "未触发";
    plan.actualBuyPrice = null;
    plan.actualBuyShares = null;
    plan.actualApplied = false;
    SELL_TIERS.forEach((tier) => {
      plan[`actualTarget${tier.key}Rate`] = null;
      plan[`actualSell${tier.key}Price`] = null;
      plan[`actualSell${tier.key}Shares`] = null;
      plan[`actualSell${tier.key}Done`] = false;
    });
    recalculateHolding(getHolding(plan.holdingId));
  }

  function completeTradeCycle(plan) {
    const shares = plan.actualTradeShares || plan.sellShares;
    if (!positive(plan.actualSellPrice) || !positive(plan.actualBuyPrice) || !positive(shares)) {
      plan.operation = "已卖出";
      window.alert("请先填写实际卖出价格、股数和实际买入价格，再完成本轮做T。 ");
      return;
    }

    upsertLot({ id: tradeLotId(plan, "sell"), holdingId: plan.holdingId, side: SIDE.SELL, label: `T卖出第${plan.cycleNo}次`, price: plan.actualSellPrice, shares, source: "trade" });
    upsertLot({ id: tradeLotId(plan, "buy"), holdingId: plan.holdingId, side: SIDE.BUY, label: `T买回第${plan.cycleNo}次`, price: plan.actualBuyPrice, shares, source: "trade" });
    const profit = (plan.actualSellPrice - plan.actualBuyPrice) * shares;
    state.tradeHistory.push({ id: `${plan.id}-history-${plan.cycleNo}-${Date.now()}`, holdingId: plan.holdingId, planId: plan.id, sequence: plan.sequence, cycleNo: plan.cycleNo, sellPrice: plan.actualSellPrice, shares, buyPrice: plan.actualBuyPrice, profit, completedAt: new Date().toISOString() });
    plan.cycleNo += 1;
    plan.operation = NONE;
    plan.status = "未触发";
    plan.actualSellPrice = null;
    plan.actualBuyPrice = null;
    plan.actualTradeShares = null;
    plan.sellApplied = false;
    recalculateHolding(getHolding(plan.holdingId));
  }

  function completeSellPlan(plan) {
    if (!positive(plan.sellPrice) || !positive(plan.sellShares)) {
      plan.operation = "卖出";
      plan.status = "已触发待执行";
      window.alert("请先填写卖出价格和卖出股数，再完成卖出计划。 ");
      return;
    }
    const record = saleRecordFromPlan(plan, getHolding(plan.holdingId));
    if (!state.completedSales.some((item) => item.planId === plan.id)) state.completedSales.push(record);
    upsertLot({ id: completedSaleLotId(record.id), holdingId: record.holdingId, side: SIDE.SELL, label: "普通卖出", price: record.sellPrice, shares: record.shares, source: "completed-sale" });
    state.plans = state.plans.filter((item) => item.id !== plan.id);
    recalculateHolding(getHolding(plan.holdingId));
  }

  function saleRecordFromPlan(plan, holding) {
    const profit = Number.isFinite(plan.realizedProfit) ? plan.realizedProfit : positive(holding?.cost) ? (plan.sellPrice - holding.cost) * plan.sellShares : 0;
    return normalizeCompletedSale({ id: `${plan.id}-completed-sale`, holdingId: plan.holdingId, planId: plan.id, sequence: plan.sequence, sellPrice: plan.sellPrice, shares: plan.sellShares, profit, note: plan.note || plan.purpose, completedAt: new Date().toISOString() });
  }

  function nextAction(holdingId) {
    const holding = getHolding(holdingId);
    const plans = state.plans.filter((plan) => plan.holdingId === holdingId);
    const activeTrade = plans.find((plan) => plan.kind === KIND.TRADE && plan.operation === "已卖出" && positive(plan.actualSellPrice) && !positive(plan.actualBuyPrice));
    if (activeTrade) return actionResult(holding, activeTrade, "T买回", activeTrade.buyPrice, activeTrade.actualTradeShares || activeTrade.sellShares, "做T计划（已卖出）", `等待 ${price(activeTrade.buyPrice)} 买回 ${integer(activeTrade.actualTradeShares || activeTrade.sellShares)}股`, KIND.TRADE);

    const available = plans.filter(isAvailablePlan);
    const trade = nearestPlan(available.filter((plan) => plan.kind === KIND.TRADE && plan.operation !== "已卖出"), holding?.currentPrice, "sellPrice");
    if (trade) return actionResult(holding, trade, "T卖出", trade.sellPrice, trade.sellShares, "做T计划", `${price(trade.sellPrice)} T卖出 ${integer(trade.sellShares)}股`, KIND.TRADE);

    const buy = nearestPlan(available.filter((plan) => (plan.kind === KIND.BUY || plan.kind === KIND.ADD) && !plan.holdingBased && !plan.actualApplied), holding?.currentPrice, "buyPrice");
    if (buy) return actionResult(holding, buy, "买入", buy.buyPrice, buy.buyShares, buy.kind === KIND.ADD ? "补仓计划" : "买卖计划", `${price(buy.buyPrice)} 买入 ${integer(buy.buyShares)}股`, KIND.BUY);

    const pairedTier = nearestPendingBuySellTier(holding, plans);
    if (pairedTier) return actionResult(holding, pairedTier.plan, "卖出", pairedTier.price, pairedTier.shares, `买卖计划（${pairedTier.tier.label}）`, `${price(pairedTier.price)} 卖出 ${integer(pairedTier.shares)}股`, KIND.SELL);

    const sellPlans = available.filter((plan) => plan.kind === KIND.SELL);
    const normalSell = nearestPlan(sellPlans.filter((plan) => !isFinalExitPlan(plan)), holding?.currentPrice, "sellPrice");
    if (normalSell) return actionResult(holding, normalSell, "卖出", normalSell.sellPrice, normalSell.sellShares, "买卖计划", `${price(normalSell.sellPrice)} 卖出 ${integer(normalSell.sellShares)}股`, KIND.SELL);

    const finalSell = nearestPlan(sellPlans.filter(isFinalExitPlan), holding?.currentPrice, "sellPrice");
    if (finalSell) return actionResult(holding, finalSell, "最终退出", finalSell.sellPrice, finalSell.sellShares, "最终退出计划", `${price(finalSell.sellPrice)} 卖出 ${integer(finalSell.sellShares)}股`, KIND.SELL);
    return { source: "无当前操作", type: "暂无", text: "暂无当前操作", price: null, shares: null, distance: null, kind: null, planId: null };
  }

  function actionResult(holding, plan, type, actionPrice, shares, source, text, kind) {
    const distance = positive(holding?.currentPrice) && positive(actionPrice) ? (actionPrice - holding.currentPrice) / holding.currentPrice * 100 : null;
    return { source, type, text, price: actionPrice, shares, distance, kind, planId: plan.id };
  }

  function isAvailablePlan(plan) {
    return !["已执行", "已完成", "暂停", "取消"].includes(plan.status) && !["暂停", "取消", "卖出后买入"].includes(plan.operation);
  }

  function nearestPlan(plans, currentPrice, field) {
    return plans.filter((plan) => positive(plan[field])).sort((a, b) => Math.abs(a[field] - (currentPrice || 0)) - Math.abs(b[field] - (currentPrice || 0)) || (a.sequence || 0) - (b.sequence || 0))[0] || null;
  }

  function nearestPendingBuySellTier(holding, plans) {
    const tiers = [];
    plans.filter((plan) => plan.kind === KIND.BUY && plan.actualApplied).forEach((plan) => {
      SELL_TIERS.forEach((tier) => {
        const shares = integerValue(plan[`actualSell${tier.key}Shares`]);
        const targetPrice = numberOrNull(plan[`actualSell${tier.key}Price`]);
        if (!plan[`actualSell${tier.key}Done`] && positive(shares) && positive(targetPrice)) tiers.push({ plan, tier, shares, price: targetPrice });
      });
    });
    return tiers.sort((a, b) => Math.abs(a.price - (holding?.currentPrice || 0)) - Math.abs(b.price - (holding?.currentPrice || 0)))[0] || null;
  }

  function isFinalExitPlan(plan) {
    return /最终|退出|不计划买回|大幅减仓|梦想价/.test(`${plan.note || ""} ${plan.purpose || ""}`);
  }

  function moduleHint(holding, kind) {
    const plans = state.plans.filter((plan) => plan.holdingId === holding.id && plan.kind === kind && isAvailablePlan(plan));
    if (!plans.length) return { price: null, shares: null };
    if (kind === KIND.TRADE) {
      const active = plans.find((plan) => plan.operation === "已卖出");
      if (active) return { price: active.buyPrice, shares: active.actualTradeShares || active.sellShares };
      const plan = nearestPlan(plans, holding.currentPrice, "sellPrice");
      return plan ? { price: plan.sellPrice, shares: plan.sellShares } : { price: null, shares: null };
    }
    const field = kind === KIND.SELL ? "sellPrice" : "buyPrice";
    const sharesField = kind === KIND.SELL ? "sellShares" : "buyShares";
    const plan = nearestPlan(plans, holding.currentPrice, field);
    return plan ? { price: plan[field], shares: plan[sharesField] } : { price: null, shares: null };
  }

  function homeActionButton(holdingId, tab, label, hint) {
    return `<button data-open-holding="${attr(holdingId)}" data-open-tab="${tab}"><span>${label}</span><strong>${hint.price == null ? "暂无" : `¥${price(hint.price)}`}</strong><em>${hint.shares == null ? "" : `${integer(hint.shares)}股`}</em></button>`;
  }

  function sellModuleName(holding) {
    return "买卖计划";
  }

  function shouldOpenModule(holding, kind, count) {
    const tab = kind === KIND.BUY ? TAB.BUY : kind === KIND.SELL ? TAB.SELL : TAB.TRADE;
    if (selectedTab === tab) return true;
    if (nextAction(holding.id).kind === kind) return true;
    if (kind === KIND.TRADE && ["长期持有型", "防守股息型"].includes(holding.strategyType)) return false;
    return count > 0;
  }

  function accordionSummary(title, count, subtitle, addKind) {
    const countLabel = title === "策略说明" ? (count ? "已填写" : "未填写") : `${count}条`;
    return `<summary class="accordion-summary"><div><strong>${html(title)}</strong><span>${html(subtitle)}</span></div><div class="accordion-summary-actions"><b>${countLabel}</b>${addKind ? `<button type="button" class="sheet-add summary-add" data-add-plan="${attr(addKind)}">＋新增</button>` : ""}</div></summary>`;
  }

  function strategySummary(holding) {
    if (holding.strategyType === "防守股息型") return "持仓目标、股息逻辑与风险";
    if (holding.strategyType === "长期持有型") return "长期逻辑与高估减仓纪律";
    if (holding.strategyType === "遗留退出型") return "退出路径与执行纪律";
    return "交易逻辑、风险与复盘";
  }

  function applyOperationState(plan) {
    if (plan.operation === NONE) { plan.status = "未触发"; return; }
    if (["暂停", "取消"].includes(plan.operation)) { plan.status = plan.operation; return; }
    if (plan.kind === KIND.SELL) {
      plan.status = plan.operation === "已执行" ? "已执行" : "已触发待执行";
      if (plan.operation === "已执行") {
        const holding = getHolding(plan.holdingId);
        plan.realizedProfit = positive(plan.sellPrice) && positive(plan.sellShares) && positive(holding?.cost) ? (plan.sellPrice - holding.cost) * plan.sellShares : 0;
      }
    }
    if (plan.kind === KIND.BUY) {
      initializeBuyExecution(plan);
      plan.status = "已触发待执行";
    }
    if (plan.kind === KIND.ADD) plan.status = "已触发待执行";
    if (plan.kind === KIND.TRADE && plan.operation === "已卖出") plan.status = "已卖出";
  }

  function initializeBuyExecution(plan) {
    if (!positive(plan.actualBuyPrice)) plan.actualBuyPrice = plan.buyPrice;
    if (!positive(plan.actualBuyShares)) plan.actualBuyShares = plan.buyShares;
    SELL_TIERS.forEach((tier) => {
      const rateField = `actualTarget${tier.key}Rate`;
      const priceField = `actualSell${tier.key}Price`;
      const sharesField = `actualSell${tier.key}Shares`;
      const doneField = `actualSell${tier.key}Done`;
      if (!positive(plan[priceField])) plan[priceField] = plannedTierPrice(plan, tier);
      if (!Number.isFinite(plan[rateField])) plan[rateField] = positive(plan.actualBuyPrice) && positive(plan[priceField]) ? (plan[priceField] / plan.actualBuyPrice - 1) * 100 : null;
      if (!positive(plan[sharesField])) plan[sharesField] = plan[`sell${tier.key}Shares`];
      if (plan[doneField] == null) plan[doneField] = false;
    });
  }

  function updatePlanRow(row, plan) {
    const set = (selector, value, cls) => {
      const node = row.querySelector(selector);
      if (!node) return;
      node.textContent = value;
      if (cls) {
        node.classList.remove("profit-positive", "profit-negative", "profit-neutral");
        node.classList.add(cls);
      }
    };
    set("[data-calc='plan-cost']", money(amount(plan.buyPrice, plan.buyShares)));
    set("[data-calc='actual-cost']", money(amount(plan.actualBuyPrice, plan.actualBuyShares)));
    set("[data-calc='sell-total']", money(amount(plan.sellPrice, plan.sellShares)));
    const holding = getHolding(plan.holdingId);
    const expected = holding && positive(plan.sellPrice) && positive(plan.sellShares) ? (plan.sellPrice - holding.cost) * plan.sellShares : null;
    set("[data-calc='expected-profit']", signedMoney(expected), profitClass(expected));
    const plannedT = positive(plan.sellPrice) && positive(plan.buyPrice) && positive(plan.sellShares) ? (plan.sellPrice - plan.buyPrice) * plan.sellShares : null;
    set("[data-calc='trade-profit']", signedMoney(plannedT), profitClass(plannedT));
    const actualT = actualTradeProfit(plan);
    set("[data-calc='actual-trade-profit']", signedMoney(actualT), profitClass(actualT));
  }

  function updateDetailNumbers() {
    const holding = getHolding(selectedHoldingId);
    if (!holding) return;
    recalculateHolding(holding);
    const update = (key, value, cls) => {
      const node = els.detailContent.querySelector(`[data-live="${key}"]`);
      if (!node) return;
      node.textContent = value;
      if (cls) node.className = cls;
    };
    update("shares", integer(holding.shares));
    update("cost", price(holding.cost, 3));
    update("market", plainMoney(marketValue(holding)));
    update("pnl", signedPlain(floatingPnl(holding)), profitClass(floatingPnl(holding)));
    update("trade-profit", signedPlain(totalTradeProfit(holding.id)), profitClass(totalTradeProfit(holding.id)));
  }

  function recalculateAllHoldings() { state.holdings.forEach(recalculateHolding); }
  function recalculateHolding(holding) {
    if (!holding) return;
    const lots = state.positionLots.filter((lot) => lot.holdingId === holding.id);
    if (!lots.length) return;
    let shares = 0;
    let cost = 0;
    lots.forEach((lot) => {
      const qty = Number(lot.shares) || 0;
      if (lot.side === SIDE.BUY) { shares += qty; cost += (Number(lot.price) || 0) * qty; }
      else {
        const sold = Math.min(qty, shares);
        const avg = shares > 0 ? cost / shares : 0;
        shares -= sold;
        cost -= avg * sold;
      }
    });
    holding.shares = Math.max(0, Math.round(shares));
    holding.availableShares = Math.max(0, holding.shares - (holding.unavailableShares || 0));
    holding.cost = shares > 0 ? cost / shares : null;
  }

  function normalizeState(raw) {
    const holdings = (raw.holdings || []).filter((holding) => holding.id !== "family-standard-bond").map(normalizeHolding);
    let lots = Array.isArray(raw.positionLots) && raw.positionLots.length ? raw.positionLots.filter((lot) => lot.holdingId !== "family-standard-bond").map(normalizeLot) : holdings.map((holding) => normalizeLot({ id: `${holding.id}-initial`, holdingId: holding.id, side: SIDE.BUY, label: "初始持仓", price: holding.cost, shares: holding.shares, source: "initial" }));
    const buyCounts = new Map();
    (raw.plans || []).forEach((plan) => {
      if (plan.kind === KIND.BUY) buyCounts.set(String(plan.holdingId), (buyCounts.get(String(plan.holdingId)) || 0) + 1);
    });
    const mergedPlanRows = (raw.plans || []).map((plan) => {
      if (plan.kind !== KIND.SELL || plan.operation === "已执行" || plan.status === "已执行") return plan;
      const holding = holdings.find((item) => item.id === String(plan.holdingId));
      const nextSequence = (buyCounts.get(String(plan.holdingId)) || 0) + 1;
      buyCounts.set(String(plan.holdingId), nextSequence);
      return {
        ...plan,
        kind: KIND.BUY,
        sequence: nextSequence,
        operation: NONE,
        status: "未触发",
        buyPrice: holding?.cost,
        buyShares: holding?.shares,
        dreamPrice: plan.sellPrice,
        selldpShares: plan.sellShares,
        holdingBased: true
      };
    });
    const normalizedPlans = mergedPlanRows.map(normalizePlan).filter((plan) => plan.holdingId !== "family-standard-bond");
    const completedSales = (raw.completedSales || []).map(normalizeCompletedSale);
    const plans = normalizedPlans.filter((plan) => {
      const completed = plan.kind === KIND.SELL && (plan.operation === "已执行" || plan.status === "已执行");
      if (!completed) return true;
      if (!completedSales.some((item) => item.planId === plan.id)) completedSales.push(saleRecordFromPlan(plan, holdings.find((holding) => holding.id === plan.holdingId)));
      return false;
    });
    plans.filter((plan) => plan.kind === KIND.BUY && plan.operation === NONE).forEach((plan) => {
      const currentPrefix = `${plan.id}-buy-cycle-${plan.cycleNo || 1}`;
      lots = lots.filter((lot) => lot.id !== `${plan.id}-actual-buy` && lot.id !== currentPrefix && !lot.id.startsWith(`${currentPrefix}-sell-`));
      plan.actualApplied = false;
    });
    completedSales.forEach((sale) => {
      const lotId = completedSaleLotId(sale.id);
      if (!lots.some((lot) => lot.id === lotId)) lots.push(normalizeLot({ id: lotId, holdingId: sale.holdingId, side: SIDE.SELL, label: "普通卖出", price: sale.sellPrice, shares: sale.shares, source: "completed-sale" }));
    });
    return {
      dataRevision: DATA_REVISION,
      bankCash: numberOrNull(raw.bankCash),
      accounts: (raw.accounts || []).map((item) => ({ id: String(item.id), label: String(item.label || ""), name: String(item.name || ""), availableCash: numberOrNull(item.availableCash) })),
      holdings,
      positionLots: lots,
      plans,
      tradeHistory: (raw.tradeHistory || []).map(normalizeHistory),
      completedSales,
      ledgerEntries: (raw.ledgerEntries || []).map(normalizeLedgerEntry)
    };
  }

  function normalizeLedgerEntry(raw) {
    return {
      id: String(raw.id || `ledger-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
      date: String(raw.date || new Date().toISOString().slice(0, 10)),
      type: String(raw.type || "记录"),
      accountId: String(raw.accountId || "bank"),
      accountName: String(raw.accountName || "未分类账户"),
      amount: Math.abs(Number(raw.amount) || 0),
      note: String(raw.note || ""),
      createdAt: String(raw.createdAt || new Date().toISOString())
    };
  }

  function normalizeHolding(raw) {
    const shares = integerValue(raw.shares);
    const availableShares = raw.availableShares == null ? shares : integerValue(raw.availableShares);
    return { ...raw, id: String(raw.id), accountId: String(raw.accountId), name: String(raw.name || ""), code: String(raw.code || ""), shares, availableShares, unavailableShares: raw.unavailableShares == null ? Math.max(0, shares - availableShares) : integerValue(raw.unavailableShares), cost: numberOrNull(raw.cost), currentPrice: numberOrNull(raw.currentPrice), floatingPnlAdjustment: numberOrNull(raw.floatingPnlAdjustment) || 0, strategyType: String(raw.strategyType || "长期持有型"), strategyText: String(raw.strategyText || raw.reflectionNote || "") };
  }

  function normalizeLot(raw) { return { id: String(raw.id), holdingId: String(raw.holdingId), side: raw.side === SIDE.SELL ? SIDE.SELL : SIDE.BUY, label: String(raw.label || "持仓记录"), price: numberOrNull(raw.price), shares: integerValue(raw.shares), source: String(raw.source || "manual") }; }

  function normalizePlan(raw, index) {
    const legacyType = String(raw.type || "");
    let kind = raw.kind;
    if (!Object.values(KIND).includes(kind)) {
      if (legacyType === "买入") kind = KIND.BUY;
      else if (legacyType === "卖出") kind = KIND.SELL;
      else if (legacyType === "T卖出" || legacyType === "T买回") kind = KIND.TRADE;
      else kind = KIND.WATCH;
    }
    const operation = raw.operation || (raw.status === "已触发待执行" ? (kind === KIND.SELL ? "卖出" : kind === KIND.TRADE ? "已卖出" : "买入") : NONE);
    const normalized = {
      ...raw, id: String(raw.id || `plan-${Date.now()}-${index}`), holdingId: String(raw.holdingId), kind, label: String(raw.label || "计划"), sequence: integerValue(raw.sequence) || index + 1, operation,
      status: String(raw.status || "未触发"), note: String(raw.note || ""), purpose: String(raw.purpose || ""), useAfterBuy: String(raw.useAfterBuy || "待定"),
      buyPrice: numberOrNull(raw.buyPrice ?? (legacyType === "买入" ? raw.triggerPrice : null)), buyShares: integerOrNull(raw.buyShares ?? (legacyType === "买入" ? raw.shares : null)),
      sellPrice: numberOrNull(raw.sellPrice ?? (legacyType === "卖出" || legacyType === "T卖出" ? raw.triggerPrice : null)), sellShares: integerOrNull(raw.sellShares ?? (legacyType === "卖出" || legacyType === "T卖出" ? raw.shares : null)),
      actualBuyPrice: numberOrNull(raw.actualBuyPrice), actualBuyShares: integerOrNull(raw.actualBuyShares), actualSellPrice: numberOrNull(raw.actualSellPrice), actualTradeShares: integerOrNull(raw.actualTradeShares), realizedProfit: numberOrNull(raw.realizedProfit),
      cycleNo: Math.max(1, integerValue(raw.cycleNo || raw.executionCount + 1 || 1)), actualApplied: Boolean(raw.actualApplied), sellApplied: Boolean(raw.sellApplied)
    };
    if (kind === KIND.BUY) {
      normalized.dreamPrice = numberOrNull(raw.dreamPrice);
      SELL_TIERS.forEach((tier) => {
        if (tier.rate != null) {
          normalized[`target${tier.key}Rate`] = numberOrNull(raw[`target${tier.key}Rate`]) ?? tier.rate;
          normalized[`target${tier.key}Price`] = numberOrNull(raw[`target${tier.key}Price`]) ?? (positive(normalized.buyPrice) ? normalized.buyPrice * (1 + normalized[`target${tier.key}Rate`] / 100) : null);
        }
        normalized[`sell${tier.key}Shares`] = integerOrNull(raw[`sell${tier.key}Shares`]);
        normalized[`actualSell${tier.key}Price`] = numberOrNull(raw[`actualSell${tier.key}Price`]);
        normalized[`actualTarget${tier.key}Rate`] = numberOrNull(raw[`actualTarget${tier.key}Rate`]) ?? (positive(normalized.actualBuyPrice) && positive(normalized[`actualSell${tier.key}Price`]) ? (normalized[`actualSell${tier.key}Price`] / normalized.actualBuyPrice - 1) * 100 : null);
        normalized[`actualSell${tier.key}Shares`] = integerOrNull(raw[`actualSell${tier.key}Shares`]);
        normalized[`actualSell${tier.key}Done`] = Boolean(raw[`actualSell${tier.key}Done`]);
      });
    }
    return normalized;
  }

  function normalizeHistory(raw) { return { id: String(raw.id), holdingId: String(raw.holdingId), planId: String(raw.planId || ""), sequence: integerValue(raw.sequence) || null, cycleNo: integerValue(raw.cycleNo) || 1, sellPrice: numberOrNull(raw.sellPrice), shares: integerValue(raw.shares), buyPrice: numberOrNull(raw.buyPrice), profit: numberOrNull(raw.profit) || 0, completedAt: String(raw.completedAt || "") }; }

  function normalizeCompletedSale(raw) { return { id: String(raw.id), holdingId: String(raw.holdingId), planId: String(raw.planId || ""), sequence: integerValue(raw.sequence) || null, cycleNo: integerValue(raw.cycleNo) || null, type: String(raw.type || "普通卖出"), buyPrice: numberOrNull(raw.buyPrice), sellPrice: numberOrNull(raw.sellPrice), shares: integerValue(raw.shares), profit: numberOrNull(raw.profit) || 0, note: String(raw.note || ""), completedAt: String(raw.completedAt || "") }; }

  function createPlan(holdingId, kind) {
    const count = plansOf(holdingId, kind).length + 1;
    return normalizePlan({ id: `${holdingId}-${kind}-${Date.now()}`, holdingId, kind, label: `${kindLabel(kind)}${count}`, sequence: count, operation: NONE, status: "未触发", useAfterBuy: "待定", cycleNo: 1 }, count - 1);
  }

  function openAddHolding(accountId) {
    const account = state.accounts.find((item) => item.id === accountId);
    if (!account) return;
    document.querySelector(".stock-modal-backdrop")?.remove();

    const backdrop = document.createElement("div");
    backdrop.className = "stock-modal-backdrop";
    backdrop.innerHTML = `
      <form class="stock-modal" aria-label="新增股票">
        <div class="stock-modal-title"><strong>${html(account.name)} · 新增股票</strong><button type="button" data-close-stock-modal aria-label="关闭">×</button></div>
        <div class="stock-modal-grid">
          <label><span>股票名称</span><input name="name" required autocomplete="off" placeholder="例如：比亚迪"></label>
          <label><span>股票代码</span><input name="code" inputmode="numeric" autocomplete="off" placeholder="例如：002594"></label>
          <label><span>初始持仓</span><input name="shares" type="number" min="0" step="100" inputmode="numeric" value="0"></label>
          <label><span>成本价</span><input name="cost" type="number" min="0" step="0.001" inputmode="decimal"></label>
          <label><span>当前价</span><input name="currentPrice" type="number" min="0" step="0.001" inputmode="decimal"></label>
          <label class="stock-modal-wide"><span>策略类型</span><select name="strategyType"><option>长期持有型</option><option>遗留修复型</option><option>防守股息型</option><option>波段做T型</option><option>遗留退出型</option></select></label>
        </div>
        <div class="stock-modal-actions"><button type="button" data-close-stock-modal>取消</button><button type="submit">确认新增</button></div>
      </form>`;
    document.body.appendChild(backdrop);
    document.body.classList.add("modal-open");

    const close = () => {
      backdrop.remove();
      document.body.classList.remove("modal-open");
    };
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop || event.target.closest("[data-close-stock-modal]")) close();
    });
    backdrop.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const name = String(values.get("name") || "").trim();
      if (!name) return;
      const code = String(values.get("code") || "").trim();
      const shares = Math.max(0, integerValue(values.get("shares")));
      const cost = numberOrNull(values.get("cost"));
      const currentPrice = numberOrNull(values.get("currentPrice"));
      const safeCode = code.replace(/[^a-zA-Z0-9]/g, "") || "stock";
      const holding = normalizeHolding({
        id: `${accountId}-${safeCode}-${Date.now()}`,
        accountId,
        name,
        code,
        shares,
        availableShares: shares,
        cost,
        currentPrice,
        floatingPnlAdjustment: 0,
        strategyType: String(values.get("strategyType") || "长期持有型"),
        status: "",
        risk: "",
        extraNote: "",
        strategyText: ""
      });
      state.holdings.push(holding);
      if (shares > 0) upsertLot({ id: `${holding.id}-initial`, holdingId: holding.id, side: SIDE.BUY, label: "初始持仓", price: cost ?? currentPrice ?? 0, shares, source: "initial" });
      saveState();
      close();
      renderHome();
    });
    backdrop.querySelector("input[name='name']")?.focus();
  }

  function openBankTransfer(accountId) {
    const account = state.accounts.find((item) => item.id === accountId);
    if (!account) return;
    document.querySelector(".stock-modal-backdrop")?.remove();

    const backdrop = document.createElement("div");
    backdrop.className = "stock-modal-backdrop";
    backdrop.innerHTML = `
      <form class="stock-modal bank-transfer-modal" aria-label="银行资金转入转出">
        <div class="stock-modal-title"><strong>${html(account.name)} · 银行资金</strong><button type="button" data-close-stock-modal aria-label="关闭">×</button></div>
        <div class="bank-transfer-balance"><span>当前可用资金</span><strong>${wholeCurrency(account.availableCash)}</strong></div>
        <div class="stock-modal-grid bank-transfer-grid">
          <label><span>操作</span><select name="direction"><option value="in">转入</option><option value="out">转出</option></select></label>
          <label><span>金额（元）</span><input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required autofocus placeholder="请输入金额"></label>
        </div>
        <div class="stock-modal-actions"><button type="button" data-close-stock-modal>取消</button><button type="submit">确认变更</button></div>
      </form>`;
    document.body.appendChild(backdrop);
    document.body.classList.add("modal-open");

    const close = () => {
      backdrop.remove();
      document.body.classList.remove("modal-open");
    };
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop || event.target.closest("[data-close-stock-modal]")) close();
    });
    backdrop.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const amountValue = Number(values.get("amount"));
      if (!Number.isFinite(amountValue) || amountValue <= 0) return;
      const currentCash = Number(account.availableCash) || 0;
      const isTransferOut = values.get("direction") === "out";
      if (isTransferOut && amountValue > currentCash) {
        window.alert(`可用资金不足，当前可用 ${wholeCurrency(currentCash)}。`);
        return;
      }
      account.availableCash = currentCash + (isTransferOut ? -amountValue : amountValue);
      state.ledgerEntries.unshift(normalizeLedgerEntry({ id: `ledger-transfer-${Date.now()}`, date: new Date().toISOString().slice(0, 10), type: isTransferOut ? "转出" : "转入", accountId: account.id, accountName: account.name, amount: amountValue, note: "证券账户资金变动", createdAt: new Date().toISOString() }));
      saveState();
      close();
      renderHome();
      renderFundsManagement();
    });
    backdrop.querySelector("input[name='amount']")?.focus();
  }

  function requestDeleteHolding(holdingId) {
    clearHoldingLongPress();
    const holding = getHolding(holdingId);
    if (!holding) return;
    recalculateHolding(holding);
    if ((holding.shares || 0) !== 0) {
      window.alert(`当前仍持有 ${integer(holding.shares)} 股，持仓归零后才能删除。`);
      return;
    }
    if (!window.confirm(`删除“${holding.name}”这一行吗？相关计划与记录也会一并删除。`)) return;
    state.holdings = state.holdings.filter((item) => item.id !== holdingId);
    state.positionLots = state.positionLots.filter((item) => item.holdingId !== holdingId);
    state.plans = state.plans.filter((item) => item.holdingId !== holdingId);
    state.tradeHistory = state.tradeHistory.filter((item) => item.holdingId !== holdingId);
    state.completedSales = state.completedSales.filter((item) => item.holdingId !== holdingId);
    if (selectedHoldingId === holdingId) selectedHoldingId = null;
    saveState();
    render();
  }

  function loadState() {
    try {
      const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (current && current.dataRevision === DATA_REVISION) {
        const normalized = normalizeState(current);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        return normalized;
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (error) { /* use defaults */ }
    return clone(defaultState);
  }

  function saveState() {
    clearTimeout(saveTimer);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (applyingRemoteState) return;
    cloudDirty = true;
    cloudChangeVersion += 1;
    els.syncStatus.textContent = cloudReady ? "等待云端同步…" : "已保存在本机";
    scheduleCloudSave();
  }
  function queueSave() { clearTimeout(saveTimer); els.syncStatus.textContent = "保存中…"; saveTimer = window.setTimeout(saveState, 250); }

  function scheduleCloudSave() {
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = window.setTimeout(() => void pushCloudState(), 450);
  }

  async function initializeCloudSync() {
    if (window.location.protocol === "file:") {
      els.syncStatus.textContent = "本机自动保存";
      return;
    }
    await pullCloudState(true);
    window.setInterval(() => void pullCloudState(false), SYNC_POLL_INTERVAL_MS);
  }

  async function pullCloudState(initial) {
    if (cloudBusy || (!initial && cloudDirty)) return;
    cloudBusy = true;
    if (initial) els.syncStatus.textContent = "正在连接共享数据…";
    try {
      const response = await fetch(SYNC_API_STATE_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const remoteRevision = Number(payload.revision) || 0;
      cloudReady = true;
      if (!payload.state || payload.state.dataRevision !== DATA_REVISION) {
        cloudRevision = remoteRevision;
        cloudDirty = true;
        cloudBusy = false;
        await pushCloudState();
        return;
      }
      if (remoteRevision > cloudRevision || initial) {
        applyingRemoteState = true;
        state = normalizeState(payload.state);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        applyingRemoteState = false;
        cloudRevision = remoteRevision;
        render();
      }
      els.syncStatus.textContent = payload.savedAt ? `云端已同步 ${payload.savedAt}` : "云端已连接";
    } catch (error) {
      cloudReady = false;
      els.syncStatus.textContent = "云端暂不可用，本机已保存";
    } finally {
      cloudBusy = false;
    }
  }

  async function pushCloudState() {
    if (!cloudDirty || cloudBusy || window.location.protocol === "file:") return;
    cloudBusy = true;
    const sendingVersion = cloudChangeVersion;
    const snapshot = clone(state);
    els.syncStatus.textContent = "正在同步云端…";
    try {
      const response = await fetch(SYNC_API_STATE_URL, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: snapshot })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      cloudReady = true;
      cloudRevision = Number(payload.revision) || cloudRevision;
      if (sendingVersion === cloudChangeVersion) cloudDirty = false;
      els.syncStatus.textContent = payload.savedAt ? `云端已同步 ${payload.savedAt}` : "云端已同步";
    } catch (error) {
      cloudReady = false;
      els.syncStatus.textContent = "同步失败，本机已保存";
    } finally {
      cloudBusy = false;
      if (cloudDirty) scheduleCloudSave();
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ app: "林青投资系统", exportedAt: new Date().toISOString(), state }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `林青投资系统-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
  }

  async function importJson(event) {
    const file = event.target.files?.[0]; if (!file) return;
    try { const parsed = JSON.parse(await file.text()); state = normalizeState(parsed.state || parsed); saveState(); closeDetail(); }
    catch (error) { window.alert("导入失败，请选择有效的 JSON 文件。 "); }
    event.target.value = "";
  }

  function upsertLot(lot) {
    const normalized = normalizeLot(lot);
    const index = state.positionLots.findIndex((item) => item.id === normalized.id);
    const previous = index >= 0 ? state.positionLots[index] : null;
    if (previous) adjustAccountCashForLot(previous, -lotCashEffect(previous));
    if (index >= 0) state.positionLots[index] = normalized;
    else state.positionLots.push(normalized);
    adjustAccountCashForLot(normalized, lotCashEffect(normalized));
  }
  function removeLot(id) {
    const previous = state.positionLots.find((lot) => lot.id === id);
    if (previous) adjustAccountCashForLot(previous, -lotCashEffect(previous));
    state.positionLots = state.positionLots.filter((lot) => lot.id !== id);
  }
  function lotCashEffect(lot) {
    if (!lot || lot.source === "initial") return 0;
    const value = (Number(lot.price) || 0) * (Number(lot.shares) || 0);
    return lot.side === SIDE.SELL ? value : -value;
  }
  function adjustAccountCashForLot(lot, delta) {
    if (!delta) return;
    const holding = getHolding(lot.holdingId);
    const account = holding && state.accounts.find((item) => item.id === holding.accountId);
    if (!account) return;
    account.availableCash = Math.round(((Number(account.availableCash) || 0) + delta) * 100) / 100;
  }
  function tradeLotId(plan, side) { return `${plan.id}-cycle-${plan.cycleNo}-${side}`; }
  function completedSaleLotId(saleId) { return `${saleId}-position`; }
  function plansOf(holdingId, kind) { return state.plans.filter((plan) => plan.holdingId === holdingId && plan.kind === kind); }
  function getHolding(id) { return state.holdings.find((holding) => holding.id === id) || null; }
  function accountName(id) { return state.accounts.find((account) => account.id === id)?.name || ""; }
  function marketValue(holding) { return positive(holding.currentPrice) ? holding.currentPrice * (holding.shares || 0) : 0; }
  function costAmount(holding) { return positive(holding.cost) ? holding.cost * (holding.shares || 0) : 0; }
  function floatingPnl(holding) { return marketValue(holding) - costAmount(holding) + (holding.floatingPnlAdjustment || 0); }
  function actualTradeProfit(plan) { return positive(plan.actualSellPrice) && positive(plan.actualBuyPrice) && positive(plan.actualTradeShares || plan.sellShares) ? (plan.actualSellPrice - plan.actualBuyPrice) * (plan.actualTradeShares || plan.sellShares) : null; }
  function totalTradeProfit(holdingId) { return sum(state.tradeHistory.filter((item) => !holdingId || item.holdingId === holdingId).map((item) => item.profit)); }
  function totalSellProfit(holdingId) {
    return sum(state.completedSales.filter((item) => !holdingId || item.holdingId === holdingId).map((item) => item.profit));
  }
  function amount(priceValue, shares) { return Number.isFinite(priceValue) && Number.isFinite(shares) ? priceValue * shares : null; }
  function sum(values) { return values.reduce((total, value) => total + (Number(value) || 0), 0); }
  function positive(value) { return Number.isFinite(value) && value > 0; }

  function tabButton(key, label) { return `<button type="button" class="tab-switch ${selectedTab === key ? "is-active" : ""}" data-detail-tab="${key}">${label}</button>`; }
  function summaryCell(label, value, cls = "") { return `<div class="summary-cell"><span class="summary-label">${label}</span><strong class="${cls}">${value}</strong></div>`; }
  function quote(label, value, cls = "", live = "") { return `<div class="quote-cell"><span>${label}</span><strong class="${cls}" ${live ? `data-live="${live}"` : ""}>${value}</strong></div>`; }
  function sheetTitle(title, subtitle, kind) { return `<div class="sheet-title"><div><h3>${title}</h3><p>${subtitle}</p></div><button type="button" class="sheet-add" data-add-plan="${kind}">＋新增</button></div>`; }
  function selectCell(label, field, value, options) { return `<label class="excel-cell"><span class="cell-label">${label}</span><select data-field="${field}">${options.map((option) => `<option value="${attr(option)}" ${option === value ? "selected" : ""}>${html(option)}</option>`).join("")}</select></label>`; }
  function numberCell(label, field, value, step) { return `<label class="excel-cell"><span class="cell-label">${label}</span><input type="number" step="${step}" inputmode="decimal" data-field="${field}" value="${inputNumber(value, step === "100" ? 0 : 3)}"></label>`; }
  function inputCell(label, field, value) { return `<label class="excel-cell"><span class="cell-label">${label}</span><input type="text" data-field="${field}" value="${attr(value || "")}"></label>`; }
  function textCell(label, value) { return `<div class="excel-cell excel-text"><span class="cell-label">${label}</span><strong>${html(value)}</strong></div>`; }
  function calcCell(label, value, calc, cls = "") { return `<div class="excel-cell excel-calc ${cls}" ${calc ? `data-calc="${calc}"` : ""}><span class="cell-label">${label}</span><strong>${value}</strong></div>`; }
  function deleteCell(id) { return `<div class="excel-cell delete-cell"><button type="button" data-delete-plan="${attr(id)}" aria-label="删除">×</button></div>`; }
  function emptyRow(text) { return `<div class="sheet-empty">${text}</div>`; }
  function emptyCard(text) { return `<div class="mobile-empty">${text}</div>`; }
  function padNo(value) { return String(value || 0).padStart(2, "0"); }
  function mobileSelect(field, value, options) { return `<select class="mobile-operation-select" data-field="${field}">${options.map(([optionValue, label]) => `<option value="${attr(optionValue)}" ${optionValue === value ? "selected" : ""}>${html(label)}</option>`).join("")}</select>`; }
  function mobileNumber(label, field, value, step = 0.001) { return `<label class="mobile-field"><span>${label}</span><input type="number" inputmode="decimal" step="${step}" data-field="${field}" value="${inputNumber(value, step === 100 ? 0 : 3)}"></label>`; }
  function mobileInput(label, field, value) { return `<label class="mobile-field"><span>${label}</span><input type="text" data-field="${field}" value="${attr(value || "")}"></label>`; }
  function mobileSelectField(label, field, value, options) { return `<label class="mobile-field"><span>${label}</span><select data-field="${field}">${options.map((option) => `<option value="${attr(option)}" ${option === value ? "selected" : ""}>${html(option)}</option>`).join("")}</select></label>`; }
  function mobileCalc(label, value, calc, cls = "") { return `<div class="mobile-field mobile-calc ${cls}" data-calc="${calc}"><span>${label}</span><strong>${value}</strong></div>`; }
  function mobileText(label, value) { return `<div class="mobile-field mobile-calc"><span>${label}</span><strong>${html(value)}</strong></div>`; }
  function mobileDelete(id) { return `<button class="mobile-delete" type="button" data-delete-plan="${attr(id)}" aria-label="删除计划">×</button>`; }
  function completedDelete(kind, id) { return `<button class="mobile-delete completed-delete" type="button" data-delete-${kind}="${attr(id)}" aria-label="删除已完成记录">×</button>`; }
  function mobileInlineNumber(field, value, step = 0.001) { return `<input class="inline-plan-input" type="number" inputmode="decimal" step="${step}" data-field="${field}" value="${inputNumber(value, step === 100 ? 0 : 3)}">`; }
  function inlinePlanNumber(field, value, step = 0.001) { return `<input class="execution-input" type="number" inputmode="decimal" step="${step}" data-field="${field}" value="${inputNumber(value, step === 100 ? 0 : 3)}">`; }
  function compactPlanTable(columns, cls = "") {
    return `<div class="compact-plan-table ${cls}" style="--compact-cols:${columns.length}"><div class="compact-label-row">${columns.map(([label]) => `<span>${html(label)}</span>`).join("")}</div><div class="compact-value-row">${columns.map(([, value]) => value).join("")}</div></div>`;
  }
  function compactNumber(field, value, step = 0.001) { return `<input type="number" inputmode="decimal" step="${step}" data-field="${field}" value="${inputNumber(value, step === 100 ? 0 : 3)}">`; }
  function compactCalc(value, calc, cls = "") { return `<strong class="${cls}" data-calc="${calc}">${value}</strong>`; }
  function compactText(value, cls = "") { return `<strong class="${cls}">${html(value)}</strong>`; }
  function compactSelect(field, value, options) { return `<select data-field="${field}">${options.map((option) => `<option value="${attr(option)}" ${option === value ? "selected" : ""}>${html(option)}</option>`).join("")}</select>`; }
  function strategyTypeOptions(current) { return ["遗留修复型", "长期持有型", "防守股息型", "波段做T型", "遗留退出型"].map((option) => `<option value="${option}" ${option === current ? "selected" : ""}>${option}</option>`).join(""); }
  function kindLabel(kind) { return ({ buy: "买卖计划", add: "补仓计划", sell: "买卖计划", trade: "做T计划" })[kind] || "计划"; }

  function money(value) { return Number.isFinite(value) ? `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "--"; }
  function plainMoney(value) { return Number.isFinite(value) ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--"; }
  function signedMoney(value) { return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${money(value)}` : "--"; }
  function signedPlain(value) { return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${plainMoney(value)}` : "--"; }
  function wholeNumber(value) { return Number.isFinite(value) ? Math.round(value).toLocaleString("zh-CN") : "--"; }
  function signedWholeNumber(value) { return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${wholeNumber(value)}` : "--"; }
  function wholeCurrency(value) { return Number.isFinite(value) ? `¥${wholeNumber(value)}` : "--"; }
  function signedWholeCurrency(value) { return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${wholeCurrency(value)}` : "--"; }
  function price(value, digits = 2) { return Number.isFinite(value) ? Number(value).toFixed(digits) : "--"; }
  function integer(value) { return Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString("zh-CN") : "--"; }
  function percent(value, digits = 2) { return Number.isFinite(value) ? `${Number(value).toFixed(digits)}%` : "--"; }
  function signedPercent(value) { return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "--"; }
  function profitClass(value) { return !Number.isFinite(value) || value === 0 ? "profit-neutral" : value > 0 ? "profit-positive" : "profit-negative"; }
  function inputNumber(value, digits) { return Number.isFinite(value) ? Number(value).toFixed(digits) : ""; }
  function numberOrNull(value) { if (value === "" || value == null) return null; const parsed = Number(String(value).replace(/,/g, "")); return Number.isFinite(parsed) ? parsed : null; }
  function integerValue(value) { return Math.max(0, Math.round(Number(value) || 0)); }
  function integerOrNull(value) { const parsed = numberOrNull(value); return parsed == null ? null : integerValue(parsed); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function html(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
  function attr(value) { return html(value); }
})();
