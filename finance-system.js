(function () {
  "use strict";

  const CACHE_KEY = "linqing-finance-system-cache-v1";
  const API_ORIGIN = window.location.hostname.endsWith("github.io")
    ? "https://linqing-trading-dashboard.linqingvv5.chatgpt.site"
    : "";
  const API_URL = `${API_ORIGIN}/api/finance/state`;
  const INVESTMENT_STORAGE_KEY = "linqing-trade-board-excel-v1";
  const VIEW_TITLES = {
    overview: ["资金总览", "家庭资金、日常账户、目标与投资资产"],
    ledger: ["家庭账本", "个人与家庭收支明细"],
    accounts: ["账户", "银行卡、微信、支付宝、现金和信用卡"],
    dreams: ["鹅鸭鸡", "长期积累、中期目标和短期愿望"],
    investments: ["投资账户", "只读取账户资产摘要，不混入家庭账单"],
    reports: ["报表", "月报、年报和资产趋势"]
  };

  const CATEGORY_SEEDS = [
    ["income-salary", "工资", "INCOME", null], ["income-bonus", "奖金", "INCOME", null],
    ["income-parents", "父母给予", "INCOME", null], ["income-windfall", "意外之财", "INCOME", null],
    ["income-book", "写书收入", "INCOME", null], ["income-up", "UP主收入", "INCOME", null],
    ["income-dividend", "投资分红", "INCOME", null], ["income-interest", "利息", "INCOME", null],
    ["income-refund", "退款", "INCOME", null], ["income-other", "其他收入", "INCOME", null],
    ["expense-required", "生活必须支出", "EXPENSE", null], ["expense-food", "饮食", "EXPENSE", "expense-required"],
    ["expense-home", "居住", "EXPENSE", "expense-required"], ["expense-utilities", "水电燃气", "EXPENSE", "expense-required"],
    ["expense-phone", "通讯", "EXPENSE", "expense-required"], ["expense-commute", "通勤", "EXPENSE", "expense-required"],
    ["expense-medical", "医疗", "EXPENSE", "expense-required"], ["expense-insurance", "基础保险", "EXPENSE", "expense-required"],
    ["expense-daily", "日用品", "EXPENSE", "expense-required"], ["expense-pet", "宠物基础支出", "EXPENSE", "expense-required"],
    ["expense-optional", "生活非必须支出", "EXPENSE", null], ["expense-dining", "外食", "EXPENSE", "expense-optional"],
    ["expense-fun", "娱乐", "EXPENSE", "expense-optional"], ["expense-clothes", "服装", "EXPENSE", "expense-optional"],
    ["expense-skincare", "护肤", "EXPENSE", "expense-optional"], ["expense-makeup", "化妆", "EXPENSE", "expense-optional"],
    ["expense-digital", "数码", "EXPENSE", "expense-optional"], ["expense-hobby", "兴趣", "EXPENSE", "expense-optional"],
    ["expense-social", "社交", "EXPENSE", "expense-optional"], ["expense-travel", "旅行", "EXPENSE", "expense-optional"],
    ["expense-shopping", "非必要购物", "EXPENSE", "expense-optional"],
    ["expense-dream", "梦想计划支出", "EXPENSE", null], ["expense-invest", "投资相关费用", "EXPENSE", null],
    ["expense-other", "其他支出", "EXPENSE", null]
  ];

  const els = {
    pageTitle: document.getElementById("page-title"),
    pageSubtitle: document.getElementById("page-subtitle"),
    content: document.getElementById("finance-system-content"),
    view: document.getElementById("finance-system-view")
  };

  if (!els.content || !els.view) return;

  let state = loadCache() || defaultState();
  let currentView = "overview";
  let ledgerScope = "family";
  let ledgerSearch = "";
  let ledgerMonth = monthKey(new Date());
  let ledgerType = "ALL";
  let ledgerSortKey = "occurredAt";
  let ledgerSortDirection = "desc";
  let syncText = "正在连接共享数据…";
  let saveTimer = 0;
  let toastTimer = 0;

  bindEvents();
  const initialView = hashView();
  if (VIEW_TITLES[initialView]) openFinanceView(initialView, false);
  void loadRemoteState();

  function defaultState() {
    const now = new Date().toISOString();
    const investment = readInvestmentState();
    const bankBalance = Math.round((Number(investment.bankCash) || 0) * 100);
    return {
      version: 1,
      updatedAt: now,
      members: [
        { id: "member-me", displayName: "我", role: "本人", isCurrentUser: true, isActive: true },
        { id: "member-partner", displayName: "家人", role: "家庭成员", isCurrentUser: false, isActive: true }
      ],
      categories: CATEGORY_SEEDS.map(([id, name, direction, parentId], index) => ({ id, name, direction, parentId, sortOrder: index + 1, isActive: true })),
      accounts: [
        accountSeed("account-bank", "银行卡", "BANK", "member-me", bankBalance, true),
        accountSeed("account-wechat", "微信", "WECHAT", "member-me", 0, true),
        accountSeed("account-alipay", "支付宝", "ALIPAY", "member-me", 0, true),
        accountSeed("account-cash", "现金", "CASH", "member-me", 0, true),
        accountSeed("account-family", "家庭公共账户", "FAMILY_SHARED", "member-me", 0, true),
        accountSeed("account-credit", "信用卡", "CREDIT_CARD", "member-me", 0, true)
      ],
      transactions: [],
      goals: [
        goalSeed("goal-big-goose", "GOOSE", "大鹅", 1000000000, 0, "长期养老投资，不动本金和收益", "ACTIVE"),
        goalSeed("goal-small-goose", "GOOSE", "小鹅", 100000000, 0, "关联现有波段投资账户", "ACTIVE", true),
        goalSeed("goal-house-duck", "DUCK", "买房鸭", 200000000, 0, "中长期买房资金", "ACTIVE"),
        goalSeed("goal-travel-chicken", "CHICKEN", "旅游鸡", 3000000, 0, "短期旅行计划", "SAVING")
      ],
      goalEntries: [],
      assetSnapshots: []
    };
  }

  function accountSeed(id, name, type, ownerMemberId, balanceCents, includeInFamilyAssets) {
    return { id, name, type, ownerMemberId, openingBalanceCents: balanceCents, currentBalanceCents: balanceCents, includeInFamilyAssets, isShared: type === "FAMILY_SHARED", isArchived: false, updatedAt: new Date().toISOString() };
  }

  function goalSeed(id, kind, name, targetAmountCents, allocatedAmountCents, note, status, linkedInvestment) {
    return { id, kind, name, targetAmountCents, allocatedAmountCents, spentAmountCents: 0, principalCents: allocatedAmountCents, earningsCents: 0, status, note, linkedAccountIds: [], linkedInvestmentAccountIds: linkedInvestment ? ["*"] : [], updatedAt: new Date().toISOString() };
  }

  function bindEvents() {
    document.querySelectorAll("[data-finance-view]").forEach((button) => {
      button.addEventListener("click", () => openFinanceView(button.dataset.financeView));
    });
    document.querySelectorAll("[data-quick-target]").forEach((button) => {
      button.addEventListener("click", () => leaveFinanceMode(button.dataset.quickTarget));
    });
    els.content.addEventListener("click", handleContentClick);
    els.content.addEventListener("input", handleContentInput);
    els.content.addEventListener("change", handleContentChange);
    els.content.addEventListener("focusout", handleContentFocusOut);
    window.addEventListener("hashchange", () => {
      const view = hashView();
      if (VIEW_TITLES[view]) openFinanceView(view, false);
    });
  }

  function openFinanceView(view, updateHash = true) {
    currentView = VIEW_TITLES[view] ? view : "overview";
    document.body.classList.add("finance-mode");
    els.view.classList.add("is-active");
    const [title, subtitle] = VIEW_TITLES[currentView];
    els.pageTitle.textContent = title;
    els.pageSubtitle.textContent = subtitle;
    setActiveNav(currentView);
    if (updateHash) history.replaceState(null, "", `#/` + currentView);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function leaveFinanceMode(target) {
    document.body.classList.remove("finance-mode");
    els.view.classList.remove("is-active");
    setActiveNav(target === "holdings" ? "holdings" : target === "plans" ? "plans" : "");
    if (location.hash.startsWith("#/")) history.replaceState(null, "", location.pathname + location.search);
  }

  function setActiveNav(view) {
    document.querySelectorAll(".finance-main-nav button").forEach((button) => {
      const key = button.dataset.financeView || button.dataset.quickTarget;
      button.classList.toggle("is-finance-active", key === view);
    });
  }

  function render() {
    if (currentView === "ledger") renderLedger();
    else if (currentView === "accounts") renderAccounts();
    else if (currentView === "dreams") renderDreams();
    else if (currentView === "investments") renderInvestments();
    else if (currentView === "reports") renderReports();
    else renderOverview();
  }

  function renderOverview() {
    const monthly = monthlySummary(ledgerMonth);
    const investments = investmentSummaries();
    const dailyAssets = sum(state.accounts.filter((item) => item.includeInFamilyAssets && item.type !== "CREDIT_CARD" && item.type !== "SECURITIES").map((item) => item.currentBalanceCents));
    const liabilities = Math.abs(sum(state.accounts.filter((item) => item.type === "CREDIT_CARD" && item.currentBalanceCents < 0).map((item) => item.currentBalanceCents)));
    const investmentAssets = sum(investments.map((item) => item.totalAssetCents));
    const netAssets = dailyAssets + investmentAssets - liabilities;
    const recent = filteredTransactions().slice(0, 5);
    const goals = effectiveGoals(investments).slice(0, 3);
    els.content.innerHTML = `
      <div class="finance-page">
        ${pageHead("资金总览", "日常资金与投资资产分开记录、统一查看", `<button class="finance-primary" data-add-transaction>＋ 快速记账</button>`)}
        <section class="finance-summary-grid">
          ${summaryCard("家庭净资产", money(netAssets), "")}
          ${summaryCard("本月收入", money(monthly.income), "finance-positive")}
          ${summaryCard("本月支出", money(monthly.expense), "finance-negative")}
          ${summaryCard("本月结余", signedMoney(monthly.income - monthly.expense), monthly.income - monthly.expense >= 0 ? "finance-positive" : "finance-negative")}
        </section>
        <div class="finance-section-grid">
          <section class="finance-panel">
            <div class="finance-panel-head"><div><strong>账户资产</strong><br><span>投资资产只显示摘要</span></div><button class="finance-secondary" data-open-view="accounts">查看账户</button></div>
            <div class="finance-account-list">
              ${state.accounts.filter((item) => !item.isArchived).slice(0, 5).map(accountRow).join("")}
              ${accountSummaryRow("投资账户合计", "投资摘要", investmentAssets, investments.length)}
            </div>
          </section>
          <section class="finance-panel finance-quick-card">
            <h3>记一笔</h3><p>收入、支出和账户转账各自保存。银行卡转证券账户不会算消费，股票买卖也不会进入这里。</p>
            <button class="finance-primary" data-add-transaction>输入金额开始记账</button>
          </section>
          <section class="finance-panel">
            <div class="finance-panel-head"><div><strong>最近账目</strong><br><span>${escapeHtml(ledgerMonth)} · ${recent.length} 条</span></div><button class="finance-secondary" data-open-view="ledger">全部明细</button></div>
            ${recent.length ? `<div class="finance-account-list">${recent.map(transactionRow).join("")}</div>` : empty("还没有账目，先记一笔家庭支出吧。")}
          </section>
          <section class="finance-panel">
            <div class="finance-panel-head"><div><strong>鹅鸭鸡进度</strong><br><span>目标用途不等于真实银行卡</span></div><button class="finance-secondary" data-open-view="dreams">全部目标</button></div>
            <div class="finance-goal-list">${goals.map(compactGoalRow).join("")}</div>
          </section>
        </div>
      </div>`;
  }

  function renderLedger() {
    const rows = filteredTransactions();
    els.content.innerHTML = `
      <div class="finance-page">
        ${pageHead("家庭账本", "表格可搜索、筛选、按月查看，备注可直接编辑", `<button class="finance-secondary" data-export-csv>导出 CSV</button><button class="finance-secondary" data-import-csv>导入 CSV</button><input type="file" accept=".csv,text/csv" data-csv-file hidden><button class="finance-primary" data-add-transaction>＋ 记一笔</button>`)}
        <div class="finance-filters">
          ${scopeChip("me", "我的账本")}${scopeChip("partner", "对方账本")}${scopeChip("family", "家庭账本")}
          <input type="month" data-ledger-month value="${escapeAttribute(ledgerMonth)}">
          <select data-ledger-type><option value="ALL">全部类型</option>${optionList([["INCOME","收入"],["EXPENSE","支出"],["TRANSFER","转账"],["REFUND","退款"],["REIMBURSEMENT","报销"],["BALANCE_ADJUSTMENT","余额调整"]], ledgerType)}</select>
          <input type="search" data-ledger-search value="${escapeAttribute(ledgerSearch)}" placeholder="搜索分类、账户、商家或备注">
        </div>
        <div class="finance-table-wrap">
          <table class="finance-table">
            <thead><tr><th><button data-ledger-sort="occurredAt">日期时间 ${sortMark("occurredAt")}</button></th><th><button data-ledger-sort="amountCents">金额 ${sortMark("amountCents")}</button></th><th><button data-ledger-sort="type">类型 ${sortMark("type")}</button></th><th>一级分类</th><th>二级分类</th><th>支出账户</th><th>收入账户</th><th>记账人</th><th>实际付款人</th><th>个人或家庭</th><th>鹅鸭鸡目标</th><th>商家</th><th>备注</th></tr></thead>
            <tbody>${rows.map(transactionTableRow).join("")}</tbody>
          </table>
          ${rows.length ? "" : empty("当前筛选条件下没有账目。")}
        </div>
      </div>`;
  }

  function renderAccounts() {
    const month = monthlyAccountFlows(ledgerMonth);
    els.content.innerHTML = `
      <div class="finance-page">
        ${pageHead("账户", "信用卡消费算支出，还款只算账户转账", `<button class="finance-secondary" data-add-member>＋ 家庭成员</button><button class="finance-primary" data-add-account>＋ 添加账户</button>`)}
        <section class="finance-panel" style="margin:0 16px 18px">
          <div class="finance-panel-head"><strong>日常账户</strong><span>${state.accounts.filter((item) => !item.isArchived).length} 个</span></div>
          <div class="finance-account-list">${state.accounts.filter((item) => !item.isArchived).map((account) => accountRow(account, month[account.id])).join("")}</div>
        </section>
      </div>`;
  }

  function renderDreams() {
    const investments = investmentSummaries();
    const goals = effectiveGoals(investments);
    els.content.innerHTML = `
      <div class="finance-page">
        ${pageHead("鹅鸭鸡", "鹅管长期积累，鸭管中期目标，鸡管短期愿望", `<button class="finance-primary" data-add-goal>＋ 新建目标</button>`)}
        <div class="finance-goal-grid">${goals.map(goalCard).join("")}</div>
      </div>`;
  }

  function renderInvestments() {
    const rows = investmentSummaries();
    const totals = {
      asset: sum(rows.map((item) => item.totalAssetCents)),
      principal: sum(rows.map((item) => item.principalCents)),
      pnl: sum(rows.map((item) => item.profitLossCents)),
      cash: sum(rows.map((item) => item.availableCashCents))
    };
    els.content.innerHTML = `
      <div class="finance-page">
        ${pageHead("投资账户", "从原投资系统实时汇总，不生成家庭收入或支出", `<button class="finance-secondary" data-refresh-investment>刷新摘要</button>`)}
        <section class="finance-summary-grid">
          ${summaryCard("投资总资产", money(totals.asset), "")}${summaryCard("累计投入本金", money(totals.principal), "")}
          ${summaryCard("当前盈亏", signedMoney(totals.pnl), totals.pnl >= 0 ? "finance-positive" : "finance-negative")}${summaryCard("可用资金", money(totals.cash), "")}
        </section>
        <section class="finance-panel" style="margin:14px 16px 18px">
          <div class="finance-panel-head"><strong>账户资产摘要</strong><span>${rows.length} 个投资账户</span></div>
          <div class="finance-investment-list">${rows.map(investmentRow).join("")}</div>
        </section>
      </div>`;
  }

  function renderReports() {
    const months = lastMonths(6).map((month) => ({ month, ...monthlySummary(month) }));
    const current = monthlySummary(ledgerMonth);
    const max = Math.max(1, ...months.flatMap((item) => [item.income, item.expense]));
    const required = categoryExpense(current.transactions, "expense-required");
    const optional = categoryExpense(current.transactions, "expense-optional");
    els.content.innerHTML = `
      <div class="finance-page">
        ${pageHead("报表", "月报、年度趋势和家庭资产摘要", `<input type="month" class="finance-secondary" data-report-month value="${escapeAttribute(ledgerMonth)}">`)}
        <section class="finance-summary-grid">
          ${summaryCard("本月收入", money(current.income), "finance-positive")}${summaryCard("本月支出", money(current.expense), "finance-negative")}
          ${summaryCard("必须支出", money(required), "")}${summaryCard("非必须支出", money(optional), "")}
        </section>
        <div class="finance-section-grid">
          <section class="finance-panel">
            <div class="finance-panel-head"><strong>近六个月趋势</strong><span>收入 / 支出</span></div>
            <div class="finance-report-bars">${months.map((item) => reportBars(item, max)).join("")}</div>
          </section>
          <section class="finance-panel">
            <div class="finance-panel-head"><strong>成员支出</strong><span>${escapeHtml(ledgerMonth)}</span></div>
            <div class="finance-account-list">${state.members.map((member) => memberExpenseRow(member, current.transactions)).join("")}</div>
          </section>
        </div>
      </div>`;
  }

  function handleContentClick(event) {
    const open = event.target.closest("[data-open-view]");
    if (open) { openFinanceView(open.dataset.openView); return; }
    if (event.target.closest("[data-add-transaction]")) { openTransactionModal(); return; }
    if (event.target.closest("[data-add-member]")) { openMemberModal(); return; }
    if (event.target.closest("[data-add-account]")) { openAccountModal(); return; }
    if (event.target.closest("[data-add-goal]")) { openGoalModal(); return; }
    const allocate = event.target.closest("[data-allocate-goal]");
    if (allocate) { openTransactionModal({ type: "TRANSFER", goalId: allocate.dataset.allocateGoal }); return; }
    const spend = event.target.closest("[data-spend-goal]");
    if (spend) { openTransactionModal({ type: "EXPENSE", goalId: spend.dataset.spendGoal, categoryId: "expense-dream" }); return; }
    const scope = event.target.closest("[data-ledger-scope]");
    if (scope) { ledgerScope = scope.dataset.ledgerScope; renderLedger(); return; }
    const sort = event.target.closest("[data-ledger-sort]");
    if (sort) {
      const key = sort.dataset.ledgerSort;
      ledgerSortDirection = ledgerSortKey === key && ledgerSortDirection === "desc" ? "asc" : "desc";
      ledgerSortKey = key;
      renderLedger();
      return;
    }
    if (event.target.closest("[data-export-csv]")) { exportCsv(); return; }
    if (event.target.closest("[data-import-csv]")) { els.content.querySelector("[data-csv-file]")?.click(); return; }
    if (event.target.closest("[data-refresh-investment]")) { renderInvestments(); showToast("投资账户摘要已刷新"); }
  }

  function handleContentInput(event) {
    if (event.target.matches("[data-ledger-search]")) {
      ledgerSearch = event.target.value;
      renderLedger();
    }
  }

  function handleContentChange(event) {
    if (event.target.matches("[data-ledger-month]")) { ledgerMonth = event.target.value || monthKey(new Date()); renderLedger(); }
    if (event.target.matches("[data-ledger-type]")) { ledgerType = event.target.value; renderLedger(); }
    if (event.target.matches("[data-report-month]")) { ledgerMonth = event.target.value || monthKey(new Date()); renderReports(); }
    if (event.target.matches("[data-csv-file]")) void importCsv(event.target.files?.[0]);
  }

  function handleContentFocusOut(event) {
    const cell = event.target.closest("[data-edit-note]");
    if (!cell) return;
    const transaction = state.transactions.find((item) => item.id === cell.dataset.editNote);
    if (!transaction) return;
    transaction.note = cell.textContent.trim();
    transaction.updatedAt = new Date().toISOString();
    queueSave();
  }

  function openTransactionModal(prefill = {}) {
    const type = prefill.type || "EXPENSE";
    const modal = createModal("记一笔", transactionForm(type, prefill));
    const form = modal.querySelector("form");
    const typeSelect = form.elements.type;
    const updateFields = () => updateTransactionForm(form);
    typeSelect.addEventListener("change", updateFields);
    updateFields();
    if (prefill.categoryId) form.elements.categoryId.value = prefill.categoryId;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const values = new FormData(form);
        const transaction = buildTransaction(values);
        applyTransaction(transaction);
        closeModal(modal);
        saveNow();
        render();
        showToast(transaction.type === "TRANSFER" ? "转账已保存，不计入收支" : "账目已保存，余额与统计已更新");
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "保存失败");
      }
    });
  }

  function transactionForm(type, prefill) {
    const currentMember = state.members.find((item) => item.isCurrentUser) || state.members[0];
    return `<form class="finance-form">
      <label class="is-wide"><span>金额（元）</span><input class="finance-amount-input" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" required autofocus></label>
      <label><span>类型</span><select name="type">${optionList([["EXPENSE","支出"],["INCOME","收入"],["TRANSFER","转账"],["REFUND","退款"],["REIMBURSEMENT","报销"],["BALANCE_ADJUSTMENT","账户余额调整"]], type)}</select></label>
      <label><span>日期</span><input name="occurredAt" type="datetime-local" value="${localDateTimeValue(new Date())}" required></label>
      <label data-category-field><span>分类</span><select name="categoryId"></select></label>
      <label data-from-field><span>支出 / 转出账户</span><select name="fromAccountId"><option value="">请选择</option>${accountOptions(prefill.fromAccountId)}</select></label>
      <label data-to-field><span>收入 / 转入账户</span><select name="toAccountId"><option value="">请选择</option>${accountOptions(prefill.toAccountId)}</select></label>
      <label><span>归属</span><select name="ownership"><option value="FAMILY">家庭</option><option value="PERSONAL">个人</option></select></label>
      <label><span>实际付款人</span><select name="payerMemberId">${memberOptions(currentMember?.id)}</select></label>
      <label><span>记账人</span><select name="bookkeeperMemberId">${memberOptions(currentMember?.id)}</select></label>
      <label><span>鹅鸭鸡目标（可选）</span><select name="goalId"><option value="">不关联</option>${goalOptions(prefill.goalId)}</select></label>
      <label><span>商家（可选）</span><input name="merchant" type="text" placeholder="例如：超市"></label>
      <label class="is-wide"><span>备注（可选）</span><input name="note" type="text" placeholder="用途或说明"></label>
      <label><span>是否共享</span><select name="isShared"><option value="true">共享</option><option value="false">私密</option></select></label>
      <label><span>家庭统计</span><select name="includeInFamilyStats"><option value="true">计入</option><option value="false">不计入</option></select></label>
      <div class="finance-form-actions"><button type="button" class="finance-secondary" data-close-finance-modal>取消</button><button type="submit" class="finance-primary">保存</button></div>
    </form>`;
  }

  function updateTransactionForm(form) {
    const type = form.elements.type.value;
    const expenseLike = ["EXPENSE"].includes(type);
    const incomeLike = ["INCOME", "REFUND", "REIMBURSEMENT", "BALANCE_ADJUSTMENT"].includes(type);
    const transfer = type === "TRANSFER";
    form.querySelector("[data-from-field]").hidden = incomeLike;
    form.querySelector("[data-to-field]").hidden = expenseLike;
    form.querySelector("[data-category-field]").hidden = transfer || type === "BALANCE_ADJUSTMENT";
    const direction = expenseLike ? "EXPENSE" : "INCOME";
    const selectedCategory = form.elements.categoryId.value;
    form.elements.categoryId.innerHTML = categoryOptions(direction, selectedCategory);
  }

  function buildTransaction(values) {
    const type = String(values.get("type"));
    const amountCents = Math.round(Number(values.get("amount")) * 100);
    const fromAccountId = String(values.get("fromAccountId") || "");
    const toAccountId = String(values.get("toAccountId") || "");
    const goalId = String(values.get("goalId") || "");
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error("请输入正确金额。");
    if (type === "EXPENSE" && !fromAccountId) throw new Error("支出必须选择支付账户。");
    if (["INCOME", "REFUND", "REIMBURSEMENT", "BALANCE_ADJUSTMENT"].includes(type) && !toAccountId) throw new Error("请选择资金进入的账户。");
    if (type === "TRANSFER" && (!fromAccountId || (!toAccountId && !goalId))) throw new Error("转账必须选择转出账户，以及转入账户或鹅鸭鸡目标。");
    if (type === "TRANSFER" && fromAccountId === toAccountId) throw new Error("转出和转入账户不能相同。");
    return {
      id: uid("transaction"),
      occurredAt: new Date(String(values.get("occurredAt"))).toISOString(),
      type,
      amountCents,
      categoryId: String(values.get("categoryId") || ""),
      fromAccountId,
      toAccountId,
      bookkeeperMemberId: String(values.get("bookkeeperMemberId") || ""),
      payerMemberId: String(values.get("payerMemberId") || ""),
      ownership: String(values.get("ownership") || "FAMILY"),
      ownerMemberId: String(values.get("ownership")) === "PERSONAL" ? String(values.get("payerMemberId") || "") : "",
      isShared: String(values.get("isShared")) === "true",
      includeInFamilyStats: type === "TRANSFER" || type === "BALANCE_ADJUSTMENT" ? false : String(values.get("includeInFamilyStats")) === "true",
      goalId,
      merchant: String(values.get("merchant") || "").trim(),
      note: String(values.get("note") || "").trim(),
      splitAllocations: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function applyTransaction(transaction) {
    const from = accountById(transaction.fromAccountId);
    const to = accountById(transaction.toAccountId);
    if (["EXPENSE", "TRANSFER"].includes(transaction.type) && from) from.currentBalanceCents -= transaction.amountCents;
    if (["INCOME", "REFUND", "REIMBURSEMENT", "BALANCE_ADJUSTMENT", "TRANSFER"].includes(transaction.type) && to) to.currentBalanceCents += transaction.amountCents;
    if (from) from.updatedAt = new Date().toISOString();
    if (to) to.updatedAt = new Date().toISOString();
    const goal = goalById(transaction.goalId);
    if (goal) {
      if (transaction.type === "TRANSFER") {
        goal.allocatedAmountCents += transaction.amountCents;
        goal.principalCents += transaction.amountCents;
        addGoalEntry(goal.id, "ALLOCATION", transaction.amountCents, transaction.id);
      } else if (transaction.type === "EXPENSE") {
        goal.spentAmountCents += transaction.amountCents;
        goal.allocatedAmountCents = Math.max(0, goal.allocatedAmountCents - transaction.amountCents);
        addGoalEntry(goal.id, "SPEND", -transaction.amountCents, transaction.id);
      }
      goal.updatedAt = new Date().toISOString();
    }
    state.transactions.unshift(transaction);
    state.updatedAt = new Date().toISOString();
  }

  function addGoalEntry(goalId, type, amountCents, transactionId) {
    state.goalEntries.unshift({ id: uid("goal-entry"), goalId, type, amountCents, transactionId, occurredAt: new Date().toISOString() });
  }

  function openAccountModal() {
    const modal = createModal("添加账户", `<form class="finance-form">
      <label class="is-wide"><span>账户名称</span><input name="name" required placeholder="例如：招商银行工资卡"></label>
      <label><span>账户类型</span><select name="type">${optionList([["BANK","银行卡"],["WECHAT","微信"],["ALIPAY","支付宝"],["CASH","现金"],["CREDIT_CARD","信用卡"],["FAMILY_SHARED","家庭公共账户"],["FUND","基金账户"],["SECURITIES","证券账户"],["OTHER","其他账户"]], "BANK")}</select></label>
      <label><span>所属成员</span><select name="ownerMemberId">${memberOptions()}</select></label>
      <label><span>当前余额（元）</span><input name="balance" type="number" step="0.01" value="0" required></label>
      <label><span>计入家庭总资产</span><select name="include"><option value="true">计入</option><option value="false">不计入</option></select></label>
      <div class="finance-form-actions"><button type="button" class="finance-secondary" data-close-finance-modal>取消</button><button class="finance-primary" type="submit">保存账户</button></div>
    </form>`);
    modal.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const balance = Math.round(Number(values.get("balance")) * 100);
      state.accounts.push(accountSeed(uid("account"), String(values.get("name")).trim(), String(values.get("type")), String(values.get("ownerMemberId")), Number.isFinite(balance) ? balance : 0, String(values.get("include")) === "true"));
      closeModal(modal); saveNow(); render(); showToast("账户已添加");
    });
  }

  function openMemberModal() {
    const modal = createModal("添加家庭成员", `<form class="finance-form">
      <label class="is-wide"><span>成员名称</span><input name="displayName" required placeholder="例如：青先生"></label>
      <label class="is-wide"><span>家庭角色</span><input name="role" required placeholder="例如：伴侣"></label>
      <div class="finance-form-actions"><button type="button" class="finance-secondary" data-close-finance-modal>取消</button><button class="finance-primary" type="submit">添加成员</button></div>
    </form>`);
    modal.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      state.members.push({ id: uid("member"), displayName: String(values.get("displayName")).trim(), role: String(values.get("role")).trim(), isCurrentUser: false, isActive: true });
      closeModal(modal); saveNow(); renderAccounts(); showToast("家庭成员已添加");
    });
  }

  function openGoalModal() {
    const modal = createModal("新建鹅鸭鸡目标", `<form class="finance-form">
      <label class="is-wide"><span>目标名称</span><input name="name" required placeholder="例如：装修鸭"></label>
      <label><span>类型</span><select name="kind"><option value="GOOSE">鹅 · 长期积累</option><option value="DUCK">鸭 · 中期目标</option><option value="CHICKEN">鸡 · 短期愿望</option></select></label>
      <label><span>目标金额（元）</span><input name="target" type="number" min="1" step="0.01" required></label>
      <label class="is-wide"><span>说明</span><input name="note" placeholder="目标用途或计划"></label>
      <div class="finance-form-actions"><button type="button" class="finance-secondary" data-close-finance-modal>取消</button><button class="finance-primary" type="submit">创建目标</button></div>
    </form>`);
    modal.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const kind = String(values.get("kind"));
      const status = kind === "CHICKEN" ? "SAVING" : "ACTIVE";
      state.goals.push(goalSeed(uid("goal"), kind, String(values.get("name")).trim(), Math.round(Number(values.get("target")) * 100), 0, String(values.get("note") || ""), status));
      closeModal(modal); saveNow(); renderDreams(); showToast("目标已创建");
    });
  }

  function createModal(title, body) {
    document.querySelector(".finance-modal-backdrop")?.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "finance-modal-backdrop";
    backdrop.innerHTML = `<section class="finance-modal" role="dialog" aria-modal="true" aria-label="${escapeAttribute(title)}"><div class="finance-modal-head"><h3>${escapeHtml(title)}</h3><button type="button" class="finance-icon-button" data-close-finance-modal aria-label="关闭">×</button></div>${body}</section>`;
    document.body.appendChild(backdrop);
    document.body.classList.add("modal-open");
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop || event.target.closest("[data-close-finance-modal]")) closeModal(backdrop); });
    return backdrop;
  }

  function closeModal(modal) { modal.remove(); document.body.classList.remove("modal-open"); }

  function pageHead(title, subtitle, actions) {
    return `<header class="finance-page-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><div class="finance-head-actions"><span class="finance-sync-note">${escapeHtml(syncText)}</span>${actions || ""}</div></header>`;
  }

  function summaryCard(label, value, className) { return `<div class="finance-summary-card"><span>${escapeHtml(label)}</span><strong class="${className || ""}">${escapeHtml(value)}</strong></div>`; }
  function empty(text) { return `<div class="finance-empty">${escapeHtml(text)}</div>`; }

  function accountRow(account, flow) {
    const owner = memberName(account.ownerMemberId);
    const currentFlow = flow || { incoming: 0, outgoing: 0 };
    return `<div class="finance-account-row">
      <div class="finance-account-name"><span class="finance-account-type">${escapeHtml(accountIcon(account.type))}</span><div><span>${escapeHtml(accountTypeName(account.type))}</span><strong>${escapeHtml(account.name)}</strong></div></div>
      <div><span>当前余额</span><strong>${money(account.currentBalanceCents)}</strong></div>
      <div><span>本月流入 / 流出</span><strong>${money(currentFlow.incoming)} / ${money(currentFlow.outgoing)}</strong></div>
      <div><span>所属成员 · 更新</span><strong>${escapeHtml(owner)} · ${shortDate(account.updatedAt)}</strong></div>
    </div>`;
  }

  function accountSummaryRow(name, type, balance, count) {
    return `<div class="finance-account-row"><div class="finance-account-name"><span class="finance-account-type">投</span><div><span>${escapeHtml(type)}</span><strong>${escapeHtml(name)}</strong></div></div><div><span>当前资产</span><strong>${money(balance)}</strong></div><div><span>账户数</span><strong>${count}</strong></div><div><span>统计口径</span><strong>只读摘要</strong></div></div>`;
  }

  function transactionRow(item) {
    const account = item.type === "EXPENSE" ? accountName(item.fromAccountId) : accountName(item.toAccountId || item.fromAccountId);
    return `<div class="finance-account-row"><div><span>${shortDate(item.occurredAt)} · ${escapeHtml(typeName(item.type))}</span><strong>${escapeHtml(categoryName(item.categoryId) || item.note || "未分类")}</strong></div><div><span>${escapeHtml(account)}</span><strong class="${item.type === "EXPENSE" ? "finance-negative" : item.type === "TRANSFER" ? "" : "finance-positive"}">${transactionMoney(item)}</strong></div><div><span>归属</span><strong>${item.ownership === "FAMILY" ? "家庭" : memberName(item.ownerMemberId)}</strong></div><div><span>备注</span><strong>${escapeHtml(item.note || "--")}</strong></div></div>`;
  }

  function compactGoalRow(goal) {
    const ratio = progress(goal);
    return `<div class="finance-account-row"><div><span>${animalName(goal.kind)}</span><strong>${escapeHtml(goal.name)}</strong></div><div><span>当前 / 目标</span><strong>${money(goal.currentAmountCents)} / ${money(goal.targetAmountCents)}</strong></div><div><span>完成比例</span><strong>${ratio.toFixed(1)}%</strong></div><div><span>状态</span><strong>${escapeHtml(goalStatusName(goal.status))}</strong></div></div>`;
  }

  function goalCard(goal) {
    const ratio = progress(goal);
    const emoji = goal.kind === "GOOSE" ? "🪿" : goal.kind === "DUCK" ? "🦆" : "🐔";
    const size = 25 + Math.min(18, ratio / 5);
    const remaining = Math.max(0, goal.targetAmountCents - goal.currentAmountCents);
    return `<article class="finance-goal-card">
      <div class="finance-goal-top"><div class="finance-animal"><div class="finance-animal-figure" style="--animal-size:${size}px">${emoji}</div><div><h3>${escapeHtml(goal.name)}</h3><p>${escapeHtml(goal.note || animalName(goal.kind))}</p></div></div><div class="finance-goal-value"><strong>${money(goal.currentAmountCents)}</strong><span>目标 ${money(goal.targetAmountCents)}</span></div></div>
      <div class="finance-progress"><i style="width:${Math.min(100, ratio)}%"></i></div>
      <div class="finance-goal-meta"><div><span>完成比例</span><strong>${ratio.toFixed(1)}%</strong></div><div><span>累计本金</span><strong>${money(goal.principalCents)}</strong></div><div><span>累计收益</span><strong>${signedMoney(goal.earningsCents)}</strong></div><div><span>已支出</span><strong>${money(goal.spentAmountCents)}</strong></div><div><span>剩余目标</span><strong>${money(remaining)}</strong></div><div><span>状态</span><strong>${escapeHtml(goalStatusName(goal.status))}</strong></div></div>
      <div class="finance-inline-actions"><button class="finance-primary" data-allocate-goal="${escapeAttribute(goal.id)}">转入目标</button>${goal.kind === "CHICKEN" ? `<button class="finance-secondary" data-spend-goal="${escapeAttribute(goal.id)}">目标支出</button>` : ""}</div>
    </article>`;
  }

  function investmentRow(item) {
    return `<div class="finance-investment-row"><div><span>证券账户</span><strong>${escapeHtml(item.name)}</strong></div><div><span>当前总资产</span><strong>${money(item.totalAssetCents)}</strong></div><div><span>累计本金 / 盈亏</span><strong>${money(item.principalCents)} / <b class="${item.profitLossCents >= 0 ? "finance-positive" : "finance-negative"}">${signedMoney(item.profitLossCents)}</b></strong></div><div><span>可用资金 · 更新时间</span><strong>${money(item.availableCashCents)} · ${shortDate(item.updatedAt)}</strong></div></div>`;
  }

  function transactionTableRow(item) {
    const category = categoryById(item.categoryId);
    const parent = category?.parentId ? categoryById(category.parentId) : category;
    const sub = category?.parentId ? category : null;
    return `<tr data-transaction-id="${escapeAttribute(item.id)}"><td>${escapeHtml(formatDateTime(item.occurredAt))}</td><td class="${item.type === "EXPENSE" ? "finance-negative" : item.type === "TRANSFER" ? "" : "finance-positive"}"><strong>${transactionMoney(item)}</strong></td><td>${escapeHtml(typeName(item.type))}</td><td>${escapeHtml(parent?.name || "--")}</td><td>${escapeHtml(sub?.name || "--")}</td><td>${escapeHtml(accountName(item.fromAccountId))}</td><td>${escapeHtml(accountName(item.toAccountId))}</td><td>${escapeHtml(memberName(item.bookkeeperMemberId))}</td><td>${escapeHtml(memberName(item.payerMemberId))}</td><td>${item.ownership === "FAMILY" ? "家庭" : "个人"}</td><td>${escapeHtml(goalById(item.goalId)?.name || "--")}</td><td>${escapeHtml(item.merchant || "--")}</td><td contenteditable="true" data-edit-note="${escapeAttribute(item.id)}">${escapeHtml(item.note || "")}</td></tr>`;
  }

  function reportBars(item, max) {
    return `<div><div class="finance-report-row is-income"><span>${escapeHtml(item.month)}</span><div class="finance-report-track"><i style="width:${item.income / max * 100}%"></i></div><strong>收 ${money(item.income)}</strong></div><div class="finance-report-row"><span></span><div class="finance-report-track"><i style="width:${item.expense / max * 100}%"></i></div><strong>支 ${money(item.expense)}</strong></div></div>`;
  }

  function memberExpenseRow(member, transactions) {
    const expense = sum(transactions.filter((item) => item.type === "EXPENSE" && item.payerMemberId === member.id && item.includeInFamilyStats).map((item) => item.amountCents));
    return `<div class="finance-account-row"><div><span>${escapeHtml(member.role)}</span><strong>${escapeHtml(member.displayName)}</strong></div><div><span>本月支出</span><strong>${money(expense)}</strong></div><div><span>家庭占比</span><strong>${percentage(expense, sum(transactions.filter((item) => item.type === "EXPENSE" && item.includeInFamilyStats).map((item) => item.amountCents)))}</strong></div><div><span>账目数</span><strong>${transactions.filter((item) => item.payerMemberId === member.id && item.type === "EXPENSE").length}</strong></div></div>`;
  }

  function filteredTransactions() {
    const me = state.members.find((item) => item.isCurrentUser)?.id;
    const partner = state.members.find((item) => !item.isCurrentUser)?.id;
    const needle = ledgerSearch.trim().toLowerCase();
    return [...state.transactions].filter((item) => monthKey(item.occurredAt) === ledgerMonth)
      .filter((item) => ledgerType === "ALL" || item.type === ledgerType)
      .filter((item) => ledgerScope === "family" ? item.ownership === "FAMILY" || item.includeInFamilyStats : ledgerScope === "me" ? item.ownerMemberId === me || item.payerMemberId === me : item.ownerMemberId === partner || item.payerMemberId === partner)
      .filter((item) => !needle || [categoryName(item.categoryId), accountName(item.fromAccountId), accountName(item.toAccountId), item.merchant, item.note, goalById(item.goalId)?.name].some((value) => String(value || "").toLowerCase().includes(needle)))
      .sort((a, b) => {
        const left = a[ledgerSortKey]; const right = b[ledgerSortKey];
        const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left || "").localeCompare(String(right || ""));
        return ledgerSortDirection === "asc" ? comparison : -comparison;
      });
  }

  function monthlySummary(month) {
    const transactions = state.transactions.filter((item) => monthKey(item.occurredAt) === month);
    const included = transactions.filter((item) => item.includeInFamilyStats);
    return {
      transactions,
      income: sum(included.filter((item) => ["INCOME", "REFUND", "REIMBURSEMENT"].includes(item.type)).map((item) => item.amountCents)),
      expense: sum(included.filter((item) => item.type === "EXPENSE").map((item) => item.amountCents))
    };
  }

  function monthlyAccountFlows(month) {
    const result = {};
    state.accounts.forEach((account) => { result[account.id] = { incoming: 0, outgoing: 0 }; });
    state.transactions.filter((item) => monthKey(item.occurredAt) === month).forEach((item) => {
      if (item.fromAccountId && result[item.fromAccountId]) result[item.fromAccountId].outgoing += item.amountCents;
      if (item.toAccountId && result[item.toAccountId]) result[item.toAccountId].incoming += item.amountCents;
    });
    return result;
  }

  function categoryExpense(transactions, parentId) {
    return sum(transactions.filter((item) => item.type === "EXPENSE" && item.includeInFamilyStats && (item.categoryId === parentId || categoryById(item.categoryId)?.parentId === parentId)).map((item) => item.amountCents));
  }

  function investmentSummaries() {
    const source = readInvestmentState();
    const holdings = Array.isArray(source.holdings) ? source.holdings : [];
    return (source.accounts || []).map((account) => {
      const rows = holdings.filter((holding) => String(holding.accountId) === String(account.id));
      const marketValueCents = Math.round(sum(rows.map((holding) => Number.isFinite(Number(holding.marketValueOverride)) ? Number(holding.marketValueOverride) : (Number(holding.currentPrice) || 0) * (Number(holding.shares) || 0))) * 100);
      const profitLossCents = Math.round(sum(rows.map((holding) => Number.isFinite(Number(holding.floatingPnlOverride)) ? Number(holding.floatingPnlOverride) : ((Number(holding.currentPrice) || 0) - (Number(holding.cost) || 0)) * (Number(holding.shares) || 0) + (Number(holding.floatingPnlAdjustment) || 0))) * 100);
      const availableCashCents = Math.round((Number(account.availableCash) || 0) * 100);
      return { id: `investment-${account.id}`, investmentAccountId: String(account.id), name: String(account.name || "投资账户"), totalAssetCents: marketValueCents + availableCashCents, marketValueCents, availableCashCents, profitLossCents, principalCents: Math.max(0, marketValueCents - profitLossCents), updatedAt: new Date().toISOString() };
    });
  }

  function effectiveGoals(investments) {
    const investmentAsset = sum(investments.map((item) => item.totalAssetCents));
    const investmentPnl = sum(investments.map((item) => item.profitLossCents));
    return state.goals.map((goal) => {
      if (!goal.linkedInvestmentAccountIds?.length) return { ...goal, currentAmountCents: goal.allocatedAmountCents };
      return { ...goal, currentAmountCents: investmentAsset, principalCents: Math.max(0, investmentAsset - investmentPnl), earningsCents: investmentPnl };
    });
  }

  function readInvestmentState() {
    try {
      const local = JSON.parse(localStorage.getItem(INVESTMENT_STORAGE_KEY) || "null");
      if (local && typeof local === "object") return local;
    } catch (_) { /* use defaults */ }
    return window.APP_DATA || { bankCash: 0, accounts: [], holdings: [] };
  }

  function queueSave() { clearTimeout(saveTimer); saveTimer = window.setTimeout(saveNow, 350); }

  function saveNow() {
    clearTimeout(saveTimer);
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    syncText = "正在保存…";
    void pushRemoteState();
  }

  async function loadRemoteState() {
    if (location.protocol === "file:") { syncText = "本地预览 · 等待云端发布"; return; }
    try {
      const response = await fetch(API_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.state && hasFinanceData(payload.state)) state = normalizeState(payload.state);
      else await pushRemoteState();
      localStorage.setItem(CACHE_KEY, JSON.stringify(state));
      syncText = "共享数据已同步";
      if (document.body.classList.contains("finance-mode")) render();
    } catch (_) {
      syncText = "离线缓存 · 恢复连接后同步";
      if (document.body.classList.contains("finance-mode")) render();
    }
  }

  async function pushRemoteState() {
    if (location.protocol === "file:") { syncText = "本地预览 · 尚未上传"; return; }
    try {
      const response = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      syncText = "共享数据已保存";
    } catch (_) { syncText = "已保存在设备，等待云端同步"; }
    if (document.body.classList.contains("finance-mode")) render();
  }

  function loadCache() {
    try { const value = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); return value ? normalizeState(value) : null; } catch (_) { return null; }
  }

  function normalizeState(raw) {
    const fallback = defaultState();
    return {
      version: 1,
      updatedAt: String(raw.updatedAt || new Date().toISOString()),
      members: Array.isArray(raw.members) && raw.members.length ? raw.members : fallback.members,
      categories: Array.isArray(raw.categories) && raw.categories.length ? raw.categories : fallback.categories,
      accounts: Array.isArray(raw.accounts) && raw.accounts.length ? raw.accounts : fallback.accounts,
      transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
      goals: Array.isArray(raw.goals) && raw.goals.length ? raw.goals : fallback.goals,
      goalEntries: Array.isArray(raw.goalEntries) ? raw.goalEntries : [],
      assetSnapshots: Array.isArray(raw.assetSnapshots) ? raw.assetSnapshots : []
    };
  }

  function hasFinanceData(value) { return value && Array.isArray(value.accounts) && value.accounts.length > 0 && Array.isArray(value.transactions); }

  function exportCsv() {
    const headers = ["日期时间","金额","类型","一级分类","二级分类","支出账户","收入账户","记账人","实际付款人","个人或家庭","鹅鸭鸡目标","商家","备注"];
    const rows = filteredTransactions().map((item) => {
      const category = categoryById(item.categoryId); const parent = category?.parentId ? categoryById(category.parentId) : category;
      return [formatDateTime(item.occurredAt), (item.amountCents / 100).toFixed(2), typeName(item.type), parent?.name || "", category?.parentId ? category.name : "", accountName(item.fromAccountId), accountName(item.toAccountId), memberName(item.bookkeeperMemberId), memberName(item.payerMemberId), item.ownership === "FAMILY" ? "家庭" : "个人", goalById(item.goalId)?.name || "", item.merchant || "", item.note || ""];
    });
    const csv = "\ufeff" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadBlob(csv, `家庭账本-${ledgerMonth}.csv`, "text/csv;charset=utf-8");
  }

  async function importCsv(file) {
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text.replace(/^\ufeff/, ""));
    if (rows.length < 2) { window.alert("CSV 中没有可导入的明细。"); return; }
    const headers = rows[0];
    let imported = 0; let skipped = 0;
    rows.slice(1).forEach((row) => {
      const data = Object.fromEntries(headers.map((header, index) => [header.trim(), row[index] || ""]));
      try {
        const type = enumType(data["类型"]); const amountCents = Math.round(Number(data["金额"]) * 100);
        const from = state.accounts.find((item) => item.name === data["支出账户"]); const to = state.accounts.find((item) => item.name === data["收入账户"]);
        const category = state.categories.find((item) => item.name === (data["二级分类"] || data["一级分类"]));
        const payer = state.members.find((item) => item.displayName === data["实际付款人"]) || state.members[0];
        const bookkeeper = state.members.find((item) => item.displayName === data["记账人"]) || state.members[0];
        const goal = state.goals.find((item) => item.name === data["鹅鸭鸡目标"]);
        if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error("bad amount");
        const transaction = { id: uid("import"), occurredAt: new Date(data["日期时间"] || Date.now()).toISOString(), type, amountCents, categoryId: category?.id || "", fromAccountId: from?.id || "", toAccountId: to?.id || "", bookkeeperMemberId: bookkeeper?.id || "", payerMemberId: payer?.id || "", ownership: data["个人或家庭"] === "个人" ? "PERSONAL" : "FAMILY", ownerMemberId: data["个人或家庭"] === "个人" ? payer?.id || "" : "", isShared: true, includeInFamilyStats: !["TRANSFER", "BALANCE_ADJUSTMENT"].includes(type), goalId: goal?.id || "", merchant: data["商家"] || "", note: data["备注"] || "", splitAllocations: [], importBatchId: file.name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (type === "EXPENSE" && !transaction.fromAccountId) throw new Error("missing account");
        if (["INCOME","REFUND","REIMBURSEMENT","BALANCE_ADJUSTMENT"].includes(type) && !transaction.toAccountId) throw new Error("missing account");
        if (type === "TRANSFER" && (!transaction.fromAccountId || (!transaction.toAccountId && !transaction.goalId))) throw new Error("missing transfer side");
        applyTransaction(transaction); imported += 1;
      } catch (_) { skipped += 1; }
    });
    saveNow(); renderLedger(); showToast(`已导入 ${imported} 条，跳过 ${skipped} 条`);
  }

  function parseCsv(text) {
    const rows = []; let row = []; let cell = ""; let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index]; const next = text[index + 1];
      if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { row.push(cell); cell = ""; }
      else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && next === "\n") index += 1; row.push(cell); if (row.some((value) => value !== "")) rows.push(row); row = []; cell = ""; }
      else cell += char;
    }
    row.push(cell); if (row.some((value) => value !== "")) rows.push(row); return rows;
  }

  function downloadBlob(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
  }

  function showToast(text) {
    document.querySelector(".finance-toast")?.remove(); clearTimeout(toastTimer);
    const toast = document.createElement("div"); toast.className = "finance-toast"; toast.textContent = text; document.body.appendChild(toast);
    toastTimer = window.setTimeout(() => toast.remove(), 2600);
  }

  function hashView() { return location.hash.replace(/^#\//, ""); }
  function accountById(id) { return state.accounts.find((item) => item.id === id); }
  function goalById(id) { return state.goals.find((item) => item.id === id); }
  function categoryById(id) { return state.categories.find((item) => item.id === id); }
  function accountName(id) { return accountById(id)?.name || (id ? "未知账户" : "--"); }
  function memberName(id) { return state.members.find((item) => item.id === id)?.displayName || "--"; }
  function categoryName(id) { return categoryById(id)?.name || ""; }
  function sum(values) { return values.reduce((total, value) => total + (Number(value) || 0), 0); }
  function money(cents) { return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format((Number(cents) || 0) / 100); }
  function signedMoney(cents) { const value = Number(cents) || 0; return `${value > 0 ? "+" : value < 0 ? "-" : ""}${money(Math.abs(value))}`; }
  function transactionMoney(item) { return `${item.type === "EXPENSE" ? "-" : ["INCOME","REFUND","REIMBURSEMENT"].includes(item.type) ? "+" : ""}${money(item.amountCents)}`; }
  function percentage(value, total) { return total ? `${(value / total * 100).toFixed(1)}%` : "0.0%"; }
  function progress(goal) { return goal.targetAmountCents > 0 ? goal.currentAmountCents / goal.targetAmountCents * 100 : 0; }
  function monthKey(value) { const date = value instanceof Date ? value : new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
  function shortDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "--" : `${date.getMonth() + 1}/${date.getDate()}`; }
  function formatDateTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")} ${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`; }
  function localDateTimeValue(date) { const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
  function uid(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`; }
  function lastMonths(count) { const result = []; const date = new Date(); for (let i = count - 1; i >= 0; i -= 1) { const item = new Date(date.getFullYear(), date.getMonth() - i, 1); result.push(monthKey(item)); } return result; }
  function scopeChip(value, label) { return `<button class="finance-chip ${ledgerScope === value ? "is-active" : ""}" data-ledger-scope="${value}">${label}</button>`; }
  function sortMark(key) { return ledgerSortKey === key ? (ledgerSortDirection === "asc" ? "↑" : "↓") : ""; }
  function csvCell(value) { const text = String(value ?? ""); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
  function escapeAttribute(value) { return escapeHtml(value).replace(/`/g, "&#096;"); }

  function optionList(options, selected) { return options.map(([value, label]) => `<option value="${escapeAttribute(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`).join(""); }
  function accountOptions(selected) { return state.accounts.filter((item) => !item.isArchived).map((item) => `<option value="${escapeAttribute(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name)} · ${money(item.currentBalanceCents)}</option>`).join(""); }
  function memberOptions(selected) { return state.members.filter((item) => item.isActive).map((item) => `<option value="${escapeAttribute(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.displayName)}</option>`).join(""); }
  function goalOptions(selected) { return state.goals.map((item) => `<option value="${escapeAttribute(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join(""); }
  function categoryOptions(direction, selected) { return state.categories.filter((item) => item.direction === direction && item.isActive).map((item) => `<option value="${escapeAttribute(item.id)}" ${item.id === selected ? "selected" : ""}>${item.parentId ? "　" : ""}${escapeHtml(item.name)}</option>`).join(""); }

  function typeName(type) { return ({ INCOME: "收入", EXPENSE: "支出", TRANSFER: "转账", REFUND: "退款", REIMBURSEMENT: "报销", BALANCE_ADJUSTMENT: "余额调整" })[type] || type; }
  function enumType(name) { return ({ 收入: "INCOME", 支出: "EXPENSE", 转账: "TRANSFER", 退款: "REFUND", 报销: "REIMBURSEMENT", 余额调整: "BALANCE_ADJUSTMENT", 账户余额调整: "BALANCE_ADJUSTMENT" })[name] || "EXPENSE"; }
  function animalName(kind) { return ({ GOOSE: "鹅 · 长期积累", DUCK: "鸭 · 中期目标", CHICKEN: "鸡 · 短期愿望" })[kind] || "资金目标"; }
  function goalStatusName(status) { return ({ ACTIVE: "进行中", SAVING: "存钱中", GROWN: "已长成", USED: "已使用", COMPLETED: "已完成", CLOSED: "已关闭" })[status] || status; }
  function accountTypeName(type) { return ({ BANK: "银行卡", WECHAT: "微信", ALIPAY: "支付宝", CASH: "现金", CREDIT_CARD: "信用卡", FAMILY_SHARED: "家庭公共账户", FUND: "基金账户", SECURITIES: "证券账户", OTHER: "其他账户" })[type] || "账户"; }
  function accountIcon(type) { return ({ BANK: "卡", WECHAT: "微", ALIPAY: "支", CASH: "现", CREDIT_CARD: "信", FAMILY_SHARED: "家", FUND: "基", SECURITIES: "证", OTHER: "账" })[type] || "账"; }
})();
