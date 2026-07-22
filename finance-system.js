(function () {
  "use strict";

  const CACHE_KEY = "linqing-finance-system-cache-v1";
  const NAV_PREFERENCE_KEY = "linqing-finance-navigation-v1";
  const API_ORIGIN = "https://linqing-finance-api.linqingvv5.workers.dev";
  const API_URL = `${API_ORIGIN}/api/finance/state`;
  const INVESTMENT_STORAGE_KEY = "linqing-trade-board-excel-v1";
  const VIEW_TITLES = {
    overview: ["资金总览", "家庭资金、日常账户、目标与投资资产"],
    ledger: ["家庭账本", "个人与家庭收支明细"],
    accounts: ["账户", "银行卡、微信、支付宝、现金和信用卡"],
    members: ["家庭成员", "家庭成员、个人账户与共享账目"],
    dreams: ["鹅鸭鸡", "长期积累、中期目标和短期愿望"],
    investments: ["投资账户", "只读取账户资产摘要，不混入家庭账单"],
    reports: ["报表", "月报、年报和资产趋势"],
    mine: ["我的", "当前成员与常用个人入口"]
  };
  const FUND_TABS = [["overview", "总览"], ["ledger", "账本"], ["accounts", "账户"], ["members", "家庭成员"]];
  const INVESTMENT_TABS = [["accounts", "账户总览"], ["holdings", "持仓管理"], ["plans", "交易计划"]];

  const CATEGORY_SEEDS = [
    ["income-salary", "工资", "INCOME", null], ["income-bonus", "奖金", "INCOME", null],
    ["income-parents", "父母给予", "INCOME", null], ["income-windfall", "意外之财", "INCOME", null],
    ["income-book", "写书收入", "INCOME", null], ["income-up", "UP主收入", "INCOME", null],
    ["income-dividend", "投资分红", "INCOME", null], ["income-interest", "利息", "INCOME", null],
    ["income-refund", "退款", "INCOME", null], ["income-other", "其他收入", "INCOME", null],
    ["expense-required", "生活必须支出", "EXPENSE", null], ["expense-food", "餐饮", "EXPENSE", "expense-required"],
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
    view: document.getElementById("finance-system-view"),
    moduleTabs: document.getElementById("finance-module-tabs"),
    quickAdd: document.getElementById("finance-quick-add")
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
  let syncText = "正在读取云端保存…";
  let saveTimer = 0;
  let toastTimer = 0;
  let navPreference = loadNavPreference();
  let sharedRevision = 0;
  let personalRevision = 0;
  let cloudBusy = false;
  let realtimeChannel = null;

  if (location.protocol === "file:" || !window.FinanceAuth) {
    bindEvents();
    navigateRoute(parseRoute());
    void loadRemoteState();
  } else {
    void initializeAuthenticatedFinance();
  }

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
      dreamAnimals: [
        animalSeed("animal-big-goose", "GOOSE", "大鹅", "大鹅"),
        animalSeed("animal-small-goose", "GOOSE", "小鹅", "小鹅"),
        animalSeed("animal-house-duck", "DUCK", "买房鸭", "买房鸭"),
        animalSeed("animal-travel-chicken", "CHICKEN", "旅游鸡", "旅游鸡")
      ],
      goals: [
        goalSeed("goal-big-goose", "animal-big-goose", "GOOSE", "大鹅", 1000000000, 0, "长期养老投资，不动本金和收益", "ACTIVE", false, ["account-family"]),
        goalSeed("goal-small-goose", "animal-small-goose", "GOOSE", "小鹅", 100000000, 0, "关联现有波段投资账户", "ACTIVE", true, []),
        goalSeed("goal-house-duck", "animal-house-duck", "DUCK", "买房鸭", 200000000, 0, "中长期买房资金", "ACTIVE", false, ["account-family"]),
        goalSeed("goal-travel-chicken", "animal-travel-chicken", "CHICKEN", "旅游鸡", 3000000, 0, "短期旅行计划", "SAVING", false, ["account-family"])
      ],
      goalEntries: [],
      assetSnapshots: [],
      investmentSummaries: [],
      memberAssetSummaries: [],
      memberMonthlySummaries: []
    };
  }

  function accountSeed(id, name, type, ownerMemberId, balanceCents, includeInFamilyAssets) {
    return { id, name, type, ownerMemberId, openingBalanceCents: balanceCents, currentBalanceCents: balanceCents, includeInFamilyAssets, isShared: type === "FAMILY_SHARED", isArchived: false, updatedAt: new Date().toISOString() };
  }

  function animalSeed(id, kind, name, visualVariant) {
    return { id, kind, name, ownerMemberId: "member-me", visualVariant, sortOrder: 0, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }

  function goalSeed(id, animalId, kind, name, targetAmountCents, allocatedAmountCents, note, status, linkedInvestment, linkedAccountIds) {
    return { id, animalId, kind, name, targetAmountCents, allocatedAmountCents, spentAmountCents: 0, principalCents: allocatedAmountCents, earningsCents: 0, status, note, targetDate: "", linkedAccountIds: linkedAccountIds || [], linkedInvestmentAccountIds: linkedInvestment ? ["*"] : [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }

  function bindEvents() {
    document.querySelectorAll("[data-finance-view]").forEach((button) => {
      button.addEventListener("click", () => openFinanceView(button.dataset.financeView));
    });
    document.querySelectorAll("[data-quick-target]").forEach((button) => {
      button.addEventListener("click", () => leaveFinanceMode(button.dataset.quickTarget));
    });
    document.querySelectorAll("[data-primary-section]").forEach((button) => {
      button.addEventListener("click", () => openPrimarySection(button.dataset.primarySection));
    });
    els.moduleTabs?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-module-tab]");
      if (!button) return;
      const [section, tab] = button.dataset.moduleTab.split(":");
      if (section === "funds") openFinanceView(tab);
      else openInvestmentTab(tab);
    });
    els.quickAdd?.addEventListener("click", openTransactionModal);
    els.content.addEventListener("click", handleContentClick);
    els.content.addEventListener("input", handleContentInput);
    els.content.addEventListener("change", handleContentChange);
    els.content.addEventListener("focusout", handleContentFocusOut);
    window.addEventListener("hashchange", () => {
      navigateRoute(parseRoute());
    });
  }

  function openPrimarySection(section) {
    if (section === "funds") openFinanceView(navPreference.funds || "overview");
    else if (section === "investment") openInvestmentTab(navPreference.investment || "accounts");
    else if (section === "dreams") openFinanceView("dreams");
    else if (section === "reports") openFinanceView("reports");
    else openFinanceView("mine");
  }

  function navigateRoute(route, updateHash = true) {
    if (route.section === "investment" && route.subtab !== "accounts") openInvestmentTab(route.subtab, updateHash);
    else openFinanceView(route.view, updateHash);
  }

  function openFinanceView(view, updateHash = true) {
    currentView = VIEW_TITLES[view] ? view : "overview";
    const route = routeForView(currentView);
    if (route.section === "funds") rememberSubtab("funds", route.subtab);
    if (route.section === "investment") rememberSubtab("investment", route.subtab);
    document.body.classList.add("finance-mode");
    els.view.classList.add("is-active");
    const [title, subtitle] = VIEW_TITLES[currentView];
    els.pageTitle.textContent = title;
    els.pageSubtitle.textContent = subtitle;
    setActiveNav(route.section);
    updateModuleTabs(route.section, route.subtab);
    if (els.quickAdd) els.quickAdd.hidden = route.section !== "funds";
    if (updateHash) history.replaceState(null, "", route.path);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openInvestmentTab(tab, updateHash = true) {
    const subtab = ["accounts", "holdings", "plans"].includes(tab) ? tab : "accounts";
    rememberSubtab("investment", subtab);
    if (subtab === "accounts") { openFinanceView("investments", updateHash); return; }
    document.body.classList.remove("finance-mode");
    els.view.classList.remove("is-active");
    setActiveNav("investment");
    updateModuleTabs("investment", subtab);
    if (els.quickAdd) els.quickAdd.hidden = true;
    if (updateHash) history.replaceState(null, "", `#/investment/${subtab}`);
    document.querySelector(`.finance-legacy-nav-bridge [data-quick-target="${subtab}"]`)?.click();
  }

  function leaveFinanceMode(target) {
    document.body.classList.remove("finance-mode");
    els.view.classList.remove("is-active");
    if (["holdings", "plans"].includes(target)) {
      rememberSubtab("investment", target);
      setActiveNav("investment");
      updateModuleTabs("investment", target);
      if (els.quickAdd) els.quickAdd.hidden = true;
      history.replaceState(null, "", `#/investment/${target}`);
    }
  }

  function setActiveNav(section) {
    document.querySelectorAll(".finance-main-nav button").forEach((button) => {
      button.classList.toggle("is-finance-active", button.dataset.primarySection === section);
    });
  }

  function updateModuleTabs(section, subtab) {
    if (!els.moduleTabs) return;
    const tabs = section === "funds" ? FUND_TABS : section === "investment" ? INVESTMENT_TABS : [];
    els.moduleTabs.hidden = !tabs.length;
    els.moduleTabs.innerHTML = tabs.map(([key, label]) => `<button type="button" class="${key === subtab ? "is-active" : ""}" data-module-tab="${section}:${key}">${escapeHtml(label)}</button>`).join("");
  }

  function render() {
    if (currentView === "ledger") renderLedger();
    else if (currentView === "accounts") renderAccounts();
    else if (currentView === "members") renderMembers();
    else if (currentView === "dreams") renderDreams();
    else if (currentView === "investments") renderInvestments();
    else if (currentView === "reports") renderReports();
    else if (currentView === "mine") renderMine();
    else renderOverview();
  }

  function renderOverview() {
    const monthly = monthlySummary(ledgerMonth);
    const investments = investmentSummaries();
    const assets = familyAssetTotals(investments);
    const investmentAssets = assets.investmentAssets;
    const recent = filteredTransactions().slice(0, 5);
    const goals = effectiveGoals(investments).slice(0, 3);
    els.content.innerHTML = `
      <div class="finance-page">
        ${pageHead("资金总览", "日常资金与投资资产分开记录、统一查看", `<button class="finance-primary" data-add-transaction>＋ 快速记账</button>`)}
        <section class="finance-summary-grid">
          ${summaryCard("家庭净资产", money(assets.netAssets), "")}
          ${summaryCard("本月收入", money(monthly.income), "finance-income")}
          ${summaryCard("本月支出", money(monthly.expense), "finance-expense")}
          ${summaryCard("本月结余", signedMoney(monthly.income - monthly.expense), monthly.income - monthly.expense >= 0 ? "finance-income" : "finance-expense")}
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
          ${scopeChip("me", "我的账本")}${state.members.filter((item) => !item.isCurrentUser && item.isActive).map((item) => scopeChip(`member:${item.id}`, `${item.displayName}账本`)).join("")}${scopeChip("family", "家庭账本")}
          <input type="month" data-ledger-month value="${escapeAttribute(ledgerMonth)}">
          <select data-ledger-type><option value="ALL">全部类型</option>${optionList([["INCOME","收入"],["EXPENSE","支出"],["TRANSFER","转账"],["REFUND","退款"],["REIMBURSEMENT","报销"],["BALANCE_ADJUSTMENT","余额调整"]], ledgerType)}</select>
          <input type="search" data-ledger-search value="${escapeAttribute(ledgerSearch)}" placeholder="搜索分类、账户、商家或备注">
        </div>
        <div class="finance-table-wrap">
          <table class="finance-table">
            <thead><tr><th><button data-ledger-sort="occurredAt">日期时间 ${sortMark("occurredAt")}</button></th><th><button data-ledger-sort="amountCents">金额 ${sortMark("amountCents")}</button></th><th><button data-ledger-sort="type">类型 ${sortMark("type")}</button></th><th>一级分类</th><th>二级分类</th><th>支出账户</th><th>收入账户</th><th>记账人</th><th>实际付款人</th><th>个人或家庭</th><th>是否共享</th><th>鹅鸭鸡目标</th><th>商家</th><th>备注</th></tr></thead>
            <tbody>${rows.map(transactionTableRow).join("")}</tbody>
          </table>
          ${rows.length ? "" : empty("当前筛选条件下没有账目。")}
        </div>
        <div class="finance-mobile-ledger">${rows.length ? rows.map(transactionCard).join("") : empty("当前筛选条件下没有账目。")}</div>
      </div>`;
  }

  function renderAccounts() {
    const month = monthlyAccountFlows(ledgerMonth);
    els.content.innerHTML = `
      <div class="finance-page">
        ${pageHead("账户", "信用卡消费算支出，还款只算账户转账", `<button class="finance-secondary" data-add-member>＋ 家庭成员</button><button class="finance-secondary" data-add-category>＋ 自定义分类</button><button class="finance-primary" data-add-account>＋ 添加账户</button>`)}
        <section class="finance-panel" style="margin:0 16px 18px">
          <div class="finance-panel-head"><strong>日常账户</strong><span>${state.accounts.filter((item) => !item.isArchived).length} 个</span></div>
          <div class="finance-account-list">${state.accounts.filter((item) => !item.isArchived).map((account) => accountRow(account, month[account.id], true)).join("")}</div>
        </section>
      </div>`;
  }

  function renderMembers() {
    els.content.innerHTML = `
      <div class="finance-page">
        ${pageHead("家庭成员", "成员身份、个人账户和共享账目", `<button class="finance-primary" data-add-member>＋ 家庭成员</button>`)}
        <section class="finance-panel" style="margin:0 16px 18px">
          <div class="finance-panel-head"><strong>家庭成员</strong><span>${state.members.filter((item) => item.isActive).length} 人</span></div>
          <div class="finance-account-list">${memberRows()}</div>
        </section>
      </div>`;
  }

  function renderMine() {
    const me = state.members.find((item) => item.isCurrentUser) || state.members[0];
    const personalAccounts = state.accounts.filter((account) => account.ownerMemberId === me?.id && !account.isArchived);
    const personalTransactions = state.transactions.filter((item) => item.ownerMemberId === me?.id || item.payerMemberId === me?.id || item.bookkeeperMemberId === me?.id);
    els.content.innerHTML = `
      <div class="finance-page">
        ${pageHead("我的", "当前成员与常用个人入口")}
        <section class="finance-panel finance-profile-card">
          <div class="finance-profile-avatar">${escapeHtml((me?.displayName || "我").slice(0, 1))}</div>
          <div><span>${escapeHtml(me?.role || "家庭成员")}</span><h2>${escapeHtml(me?.displayName || "我")}</h2><p>${personalAccounts.length} 个账户 · ${personalTransactions.length} 条相关账目</p></div>
        </section>
        <section class="finance-panel finance-mine-links">
          <button type="button" data-open-view="ledger"><span>我的账本</span><b>查看个人与家庭明细 ›</b></button>
          <button type="button" data-open-view="accounts"><span>我的账户</span><b>余额与本月资金流 ›</b></button>
          <button type="button" data-open-view="members"><span>家庭成员</span><b>成员与共享账目 ›</b></button>
          ${window.FinanceAuth?.activeMemberId ? `<button type="button" data-change-member-password><span>修改个人密码</span><b>仅用于我的个人页 ›</b></button><button type="button" data-leave-member><span>退出个人页</span><b>返回家庭共享区域 ›</b></button>` : ""}
          ${window.FinanceAuth?.household ? `<button type="button" data-cloud-sign-out><span>退出整个系统</span><b>重新输入总密码 ›</b></button>` : ""}
        </section>
      </div>`;
  }

  function memberRows() {
    return state.members.filter((item) => item.isActive).map((member) => `<div class="finance-account-row"><div><span>${escapeHtml(member.role)}</span><strong>${escapeHtml(member.displayName)}${member.isCurrentUser ? " · 当前个人页" : ""}</strong></div><div><span>个人区域</span><strong>独立密码保护</strong></div><div><button type="button" class="finance-secondary" data-member-portal="${escapeAttribute(member.id)}">${member.isCurrentUser ? "已进入" : "进入个人页"}</button></div></div>`).join("");
  }

  function renderDreams() {
    const investments = investmentSummaries();
    const goals = effectiveGoals(investments);
    els.content.innerHTML = `
      <div class="finance-page">
        ${pageHead("鹅鸭鸡", "鹅：长期财富与投资；鸭：中长期目标；鸡：短期愿望和计划", `<button class="finance-primary" data-add-goal>＋ 新建目标</button>`)}
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
          ${summaryCard("当前盈亏", signedMoney(totals.pnl), totals.pnl >= 0 ? "finance-stock-up" : "finance-stock-down")}${summaryCard("可用资金", money(totals.cash), "")}
        </section>
        <section class="finance-panel" style="margin:14px 16px 18px">
          <div class="finance-panel-head"><strong>账户资产摘要</strong><span>${rows.length} 个投资账户</span></div>
          <div class="finance-investment-list">${rows.map(investmentRow).join("")}</div>
        </section>
      </div>`;
  }

  function renderReports() {
    const months = lastMonths(12).map((month) => ({ month, ...monthlySummary(month) }));
    const current = monthlySummary(ledgerMonth);
    const max = Math.max(1, ...months.flatMap((item) => [item.income, item.expense]));
    const required = categoryExpense(current.transactions, "expense-required");
    const optional = categoryExpense(current.transactions, "expense-optional");
    els.content.innerHTML = `
      <div class="finance-page">
        ${pageHead("报表", "月报、年度趋势和家庭资产摘要", `<input type="month" class="finance-secondary" data-report-month value="${escapeAttribute(ledgerMonth)}">`)}
        <section class="finance-summary-grid">
          ${summaryCard("本月收入", money(current.income), "finance-income")}${summaryCard("本月支出", money(current.expense), "finance-expense")}
          ${summaryCard("必须支出", money(required), "")}${summaryCard("非必须支出", money(optional), "")}
        </section>
        <div class="finance-section-grid">
          <section class="finance-panel">
            <div class="finance-panel-head"><strong>年度趋势</strong><span>近十二个月收入 / 支出</span></div>
            <div class="finance-report-bars">${months.map((item) => reportBars(item, max)).join("")}</div>
          </section>
          <section class="finance-panel">
            <div class="finance-panel-head"><strong>成员支出</strong><span>${escapeHtml(ledgerMonth)}</span></div>
            <div class="finance-account-list">${state.members.map((member) => memberExpenseRow(member, current.transactions)).join("")}</div>
          </section>
          <section class="finance-panel">
            <div class="finance-panel-head"><strong>资产报表</strong><span>日常账户 + 投资摘要</span></div>
            <div class="finance-account-list">${state.assetSnapshots.slice(0, 6).map((item) => `<div class="finance-account-row"><div><span>${escapeHtml(item.snapshotDate)}</span><strong>家庭净资产</strong></div><div><span>资产</span><strong>${money(item.assetCents)}</strong></div><div><span>负债</span><strong>${money(item.liabilityCents)}</strong></div><div><span>净资产</span><strong>${money(item.netAssetCents)}</strong></div></div>`).join("") || empty("保存一笔账后生成资产快照。")}</div>
          </section>
        </div>
      </div>`;
  }

  function handleContentClick(event) {
    const open = event.target.closest("[data-open-view]");
    if (open) { openFinanceView(open.dataset.openView); return; }
    if (event.target.closest("[data-add-transaction]")) { openTransactionModal(); return; }
    if (event.target.closest("[data-add-member]")) { openMemberModal(); return; }
    const memberPortal = event.target.closest("[data-member-portal]");
    if (memberPortal) { void openMemberPortal(memberPortal.dataset.memberPortal); return; }
    if (event.target.closest("[data-change-member-password]")) { void openMemberPortal(window.FinanceAuth?.activeMemberId, true); return; }
    if (event.target.closest("[data-leave-member]")) { void leaveMemberPortal(); return; }
    if (event.target.closest("[data-add-account]")) { openAccountModal(); return; }
    if (event.target.closest("[data-add-category]")) { openCategoryModal(); return; }
    const editAccount = event.target.closest("[data-edit-account]");
    if (editAccount) { openAccountModal(editAccount.dataset.editAccount); return; }
    const adjustAccount = event.target.closest("[data-adjust-account]");
    if (adjustAccount) { openBalanceAdjustmentModal(adjustAccount.dataset.adjustAccount); return; }
    if (event.target.closest("[data-add-goal]")) { openGoalModal(); return; }
    const editGoal = event.target.closest("[data-edit-goal]");
    if (editGoal) { openGoalModal(editGoal.dataset.editGoal); return; }
    const goalHistory = event.target.closest("[data-goal-history]");
    if (goalHistory) { openGoalHistory(goalHistory.dataset.goalHistory); return; }
    const allocate = event.target.closest("[data-allocate-goal]");
    if (allocate) {
      const goal = goalById(allocate.dataset.allocateGoal);
      if (!goal?.linkedAccountIds?.length) { window.alert("请先编辑目标并关联至少一个真实账户。"); return; }
      openTransactionModal({ type: "TRANSFER", goalId: goal.id, toAccountId: goal.linkedAccountIds[0] });
      return;
    }
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
    if (event.target.closest("[data-cloud-sign-out]")) { void window.FinanceAuth?.signOut(); return; }
    if (event.target.closest("[data-refresh-investment]")) { refreshDerivedState(); queueSave(); renderInvestments(); showToast("投资账户摘要已刷新"); }
  }

  function handleContentInput(event) {
    if (event.target.matches("[data-ledger-search]")) {
      ledgerSearch = event.target.value;
      const needle = ledgerSearch.trim().toLowerCase();
      els.content.querySelectorAll(".finance-table tbody tr").forEach((row) => { row.hidden = Boolean(needle) && !row.textContent.toLowerCase().includes(needle); });
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

  async function openMemberPortal(memberId, changing = false) {
    const member = state.members.find((item) => item.id === memberId);
    if (!member || !window.FinanceAuth?.memberLockStatus) return;
    let configured = changing;
    try {
      const status = await window.FinanceAuth.memberLockStatus();
      configured = status.configuredMemberIds?.includes(memberId) || changing;
    } catch (_) {
      showToast("暂时无法连接个人密码服务");
      return;
    }
    const title = changing ? `修改${member.displayName}的个人密码` : configured ? `进入${member.displayName}的个人页` : `设置${member.displayName}的个人密码`;
    const fields = changing
      ? `<label class="is-wide"><span>当前个人密码</span><input name="currentPassword" type="password" autocomplete="current-password" required autofocus></label><label class="is-wide"><span>新个人密码</span><input name="newPassword" type="password" minlength="4" autocomplete="new-password" required></label><label class="is-wide"><span>再次输入新密码</span><input name="confirmPassword" type="password" minlength="4" autocomplete="new-password" required></label>`
      : configured
        ? `<label class="is-wide"><span>个人密码</span><input name="password" type="password" autocomplete="current-password" required autofocus></label>`
        : `<p class="is-wide auth-message">这是首次进入，请由本人设置至少 4 位的独立密码。</p><label class="is-wide"><span>设置个人密码</span><input name="newPassword" type="password" minlength="4" autocomplete="new-password" required autofocus></label><label class="is-wide"><span>再次输入密码</span><input name="confirmPassword" type="password" minlength="4" autocomplete="new-password" required></label>`;
    const modal = createModal(title, `<form class="finance-form">${fields}<p class="is-wide auth-message" data-member-message></p><div class="finance-form-actions"><button type="button" class="finance-secondary" data-close-finance-modal>取消</button><button class="finance-primary" type="submit">${changing ? "保存新密码" : "进入个人页"}</button></div></form>`);
    modal.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      const message = form.querySelector("[data-member-message]");
      const button = form.querySelector("button[type=submit]");
      const newPassword = String(values.get("newPassword") || "");
      if ((changing || !configured) && newPassword !== String(values.get("confirmPassword") || "")) {
        message.textContent = "两次输入的密码不一致。"; message.classList.add("is-error"); return;
      }
      button.disabled = true; message.textContent = "正在验证…"; message.classList.remove("is-error");
      const result = changing || !configured
        ? await window.FinanceAuth.setMemberPassword(memberId, newPassword, String(values.get("currentPassword") || ""))
        : await window.FinanceAuth.unlockMember(memberId, String(values.get("password") || ""));
      button.disabled = false;
      if (!result.ok) {
        message.textContent = result.status === 401 ? "个人密码不正确。" : (result.error || "暂时无法进入，请稍后重试。");
        message.classList.add("is-error"); return;
      }
      closeModal(modal);
      await loadRemoteState();
      activateMember(memberId);
      localStorage.setItem(cacheKey(), JSON.stringify(state));
      openFinanceView("mine");
      showToast(changing ? "个人密码已更新" : "已进入个人页");
    });
  }

  async function leaveMemberPortal() {
    window.FinanceAuth?.leaveMember?.();
    await loadRemoteState();
    state.members.forEach((item) => { item.isCurrentUser = false; });
    localStorage.setItem(cacheKey(), JSON.stringify(state));
    openFinanceView("members");
    showToast("已退出个人页");
  }

  function activateMember(memberId) {
    state.members.forEach((item) => { item.isCurrentUser = Boolean(memberId && item.id === memberId); });
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
    if (type === "TRANSFER" && (!fromAccountId || !toAccountId)) throw new Error("转账必须同时选择转出账户和转入账户。");
    if (type === "TRANSFER" && fromAccountId === toAccountId) throw new Error("转出和转入账户不能相同。");
    const goal = goalById(goalId);
    if (type === "TRANSFER" && goal && !goal.linkedAccountIds?.includes(toAccountId)) throw new Error("转入账户必须是该鹅鸭鸡目标已关联的真实账户。");
    if (type === "EXPENSE" && goal && !goal.linkedAccountIds?.includes(fromAccountId)) throw new Error("目标支出必须使用该目标已关联的真实账户。");
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
    if (["INCOME", "REFUND", "REIMBURSEMENT", "TRANSFER"].includes(transaction.type) && to) to.currentBalanceCents += transaction.amountCents;
    if (transaction.type === "BALANCE_ADJUSTMENT") {
      const target = to || from;
      if (target) target.currentBalanceCents += Number.isFinite(Number(transaction.adjustmentDeltaCents)) ? Number(transaction.adjustmentDeltaCents) : transaction.amountCents;
    }
    if (from) from.updatedAt = new Date().toISOString();
    if (to) to.updatedAt = new Date().toISOString();
    const goal = goalById(transaction.goalId);
    if (goal) {
      if (transaction.type === "TRANSFER") {
        goal.allocatedAmountCents += transaction.amountCents;
        goal.principalCents += transaction.amountCents;
        addGoalEntry(goal.id, "ALLOCATION", transaction.amountCents, transaction.id);
        if (goal.kind === "CHICKEN" && goal.allocatedAmountCents >= goal.targetAmountCents && goal.status === "SAVING") goal.status = "GROWN";
      } else if (transaction.type === "EXPENSE") {
        goal.spentAmountCents += transaction.amountCents;
        goal.allocatedAmountCents = Math.max(0, goal.allocatedAmountCents - transaction.amountCents);
        addGoalEntry(goal.id, "SPEND", -transaction.amountCents, transaction.id);
        if (goal.kind === "CHICKEN" && !["COMPLETED", "CLOSED"].includes(goal.status)) goal.status = "USED";
      }
      goal.updatedAt = new Date().toISOString();
    }
    state.transactions.unshift(transaction);
    state.updatedAt = new Date().toISOString();
  }

  function addGoalEntry(goalId, type, amountCents, transactionId) {
    state.goalEntries.unshift({ id: uid("goal-entry"), goalId, type, amountCents, transactionId, occurredAt: new Date().toISOString() });
  }

  function openAccountModal(accountId) {
    const existing = accountById(accountId);
    const modal = createModal(existing ? "编辑账户" : "添加账户", `<form class="finance-form">
      <label class="is-wide"><span>账户名称</span><input name="name" value="${escapeAttribute(existing?.name || "")}" required placeholder="例如：招商银行工资卡"></label>
      <label><span>账户类型</span><select name="type">${optionList([["BANK","银行卡"],["WECHAT","微信"],["ALIPAY","支付宝"],["CASH","现金"],["CREDIT_CARD","信用卡"],["FAMILY_SHARED","家庭公共账户"],["FUND","基金账户"],["SECURITIES","证券账户"],["OTHER","其他账户"]], existing?.type || "BANK")}</select></label>
      <label><span>所属成员</span><select name="ownerMemberId">${memberOptions(existing?.ownerMemberId)}</select></label>
      ${existing ? "" : `<label><span>初始余额（元）</span><input name="balance" type="number" step="0.01" value="0" required></label>`}
      <label><span>是否共享</span><select name="isShared"><option value="true" ${existing?.isShared ? "selected" : ""}>家庭共享</option><option value="false" ${existing && !existing.isShared ? "selected" : ""}>个人私有</option></select></label>
      <label><span>计入家庭总资产</span><select name="include"><option value="true" ${existing?.includeInFamilyAssets !== false ? "selected" : ""}>计入</option><option value="false" ${existing?.includeInFamilyAssets === false ? "selected" : ""}>不计入</option></select></label>
      ${existing ? `<label><span>状态</span><select name="isArchived"><option value="false">正常使用</option><option value="true" ${existing.isArchived ? "selected" : ""}>停用归档</option></select></label>` : ""}
      <div class="finance-form-actions"><button type="button" class="finance-secondary" data-close-finance-modal>取消</button><button class="finance-primary" type="submit">保存账户</button></div>
    </form>`);
    modal.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      if (existing) {
        existing.name = String(values.get("name")).trim(); existing.type = String(values.get("type")); existing.ownerMemberId = String(values.get("ownerMemberId"));
        existing.isShared = String(values.get("isShared")) === "true"; existing.includeInFamilyAssets = String(values.get("include")) === "true"; existing.isArchived = String(values.get("isArchived")) === "true"; existing.updatedAt = new Date().toISOString();
      } else {
        const balance = Math.round(Number(values.get("balance")) * 100);
        const account = accountSeed(uid("account"), String(values.get("name")).trim(), String(values.get("type")), String(values.get("ownerMemberId")), Number.isFinite(balance) ? balance : 0, String(values.get("include")) === "true");
        account.isShared = String(values.get("isShared")) === "true"; state.accounts.push(account);
      }
      closeModal(modal); saveNow(); render(); showToast(existing ? "账户已更新" : "账户已添加");
    });
  }

  function openBalanceAdjustmentModal(accountId) {
    const account = accountById(accountId); if (!account) return;
    const modal = createModal("调整账户余额", `<form class="finance-form">
      <div class="is-wide"><span>当前余额</span><strong style="display:block;font-size:24px;margin-top:6px">${money(account.currentBalanceCents)}</strong></div>
      <label class="is-wide"><span>调整后的实际余额（元）</span><input class="finance-amount-input" name="newBalance" type="number" step="0.01" value="${(account.currentBalanceCents / 100).toFixed(2)}" required></label>
      <label class="is-wide"><span>调整原因</span><input name="note" required placeholder="例如：对账修正"></label>
      <div class="finance-form-actions"><button type="button" class="finance-secondary" data-close-finance-modal>取消</button><button class="finance-primary" type="submit">保存调整</button></div>
    </form>`);
    modal.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault(); const values = new FormData(event.currentTarget); const next = Math.round(Number(values.get("newBalance")) * 100); const delta = next - account.currentBalanceCents;
      if (!Number.isFinite(next) || delta === 0) { closeModal(modal); return; }
      const member = state.members.find((item) => item.isCurrentUser) || state.members[0];
      applyTransaction({ id: uid("adjustment"), occurredAt: new Date().toISOString(), type: "BALANCE_ADJUSTMENT", amountCents: Math.abs(delta), adjustmentDeltaCents: delta, categoryId: "", fromAccountId: delta < 0 ? account.id : "", toAccountId: delta > 0 ? account.id : "", bookkeeperMemberId: member?.id || "", payerMemberId: member?.id || "", ownership: "PERSONAL", ownerMemberId: account.ownerMemberId, isShared: account.isShared, includeInFamilyStats: false, goalId: "", merchant: "", note: String(values.get("note") || ""), splitAllocations: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      closeModal(modal); saveNow(); renderAccounts(); showToast("余额调整已单独记录，不计收入或支出");
    });
  }

  function openCategoryModal() {
    const modal = createModal("自定义分类", `<form class="finance-form">
      <label><span>收支方向</span><select name="direction"><option value="EXPENSE">支出</option><option value="INCOME">收入</option></select></label>
      <label><span>一级分类（可选）</span><select name="parentId"><option value="">作为一级分类</option>${state.categories.filter((item) => !item.parentId).map((item) => `<option value="${escapeAttribute(item.id)}" data-direction="${item.direction}">${escapeHtml(item.name)}</option>`).join("")}</select></label>
      <label class="is-wide"><span>分类名称</span><input name="name" required placeholder="输入自定义分类"></label>
      <div class="finance-form-actions"><button type="button" class="finance-secondary" data-close-finance-modal>取消</button><button class="finance-primary" type="submit">保存分类</button></div>
    </form>`);
    modal.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault(); const values = new FormData(event.currentTarget); const parent = categoryById(String(values.get("parentId") || "")); const direction = parent?.direction || String(values.get("direction"));
      state.categories.push({ id: uid("category"), name: String(values.get("name")).trim(), direction, parentId: parent?.id || null, scope: "CUSTOM", ownerMemberId: "", sortOrder: state.categories.length + 1, isActive: true });
      closeModal(modal); saveNow(); renderAccounts(); showToast("自定义分类已添加");
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

  function openGoalModal(goalId) {
    const existing = goalById(goalId);
    const modal = createModal(existing ? "编辑鹅鸭鸡目标" : "新建鹅鸭鸡目标", `<form class="finance-form">
      <label class="is-wide"><span>目标名称</span><input name="name" value="${escapeAttribute(existing?.name || "")}" required placeholder="例如：装修鸭"></label>
      <label><span>类型</span><select name="kind">${optionList([["GOOSE","鹅 · 长期财富与投资"],["DUCK","鸭 · 中长期目标"],["CHICKEN","鸡 · 短期愿望和计划"]], existing?.kind || "DUCK")}</select></label>
      <label><span>目标金额（元）</span><input name="target" type="number" min="1" step="0.01" value="${existing ? (existing.targetAmountCents / 100).toFixed(2) : ""}" required></label>
      <label><span>预计完成日期</span><input name="targetDate" type="date" value="${escapeAttribute(existing?.targetDate || "")}"></label>
      <label><span>状态</span><select name="status">${optionList([["ACTIVE","进行中"],["SAVING","存钱中"],["GROWN","已长成"],["USED","已使用"],["COMPLETED","已完成"],["CLOSED","已关闭"]], existing?.status || "ACTIVE")}</select></label>
      <fieldset class="finance-account-links is-wide"><legend>关联真实账户（可多选）</legend>${state.accounts.filter((item) => !item.isArchived && item.type !== "CREDIT_CARD").map((account) => `<label><input type="checkbox" name="linkedAccountIds" value="${escapeAttribute(account.id)}" ${existing?.linkedAccountIds?.includes(account.id) ? "checked" : ""}> ${escapeHtml(account.name)}</label>`).join("")}</fieldset>
      <label class="is-wide"><span>投资摘要联动</span><select name="linkedInvestment"><option value="false">不关联投资账户</option><option value="true" ${existing?.linkedInvestmentAccountIds?.length ? "selected" : ""}>关联现有投资账户摘要</option></select></label>
      <label class="is-wide"><span>说明</span><input name="note" value="${escapeAttribute(existing?.note || "")}" placeholder="目标用途或计划"></label>
      <div class="finance-form-actions"><button type="button" class="finance-secondary" data-close-finance-modal>取消</button><button class="finance-primary" type="submit">保存目标</button></div>
    </form>`);
    modal.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const kind = String(values.get("kind"));
      const linkedAccountIds = values.getAll("linkedAccountIds").map(String);
      if (existing) {
        existing.name = String(values.get("name")).trim(); existing.kind = kind; existing.targetAmountCents = Math.round(Number(values.get("target")) * 100); existing.targetDate = String(values.get("targetDate") || ""); existing.status = String(values.get("status")); existing.linkedAccountIds = linkedAccountIds; existing.linkedInvestmentAccountIds = String(values.get("linkedInvestment")) === "true" ? ["*"] : []; existing.note = String(values.get("note") || ""); existing.updatedAt = new Date().toISOString();
        const animal = state.dreamAnimals.find((item) => item.id === existing.animalId); if (animal) { animal.name = existing.name; animal.kind = kind; animal.updatedAt = new Date().toISOString(); }
      } else {
        const animalId = uid("animal"); const name = String(values.get("name")).trim(); state.dreamAnimals.push(animalSeed(animalId, kind, name, name));
        state.goals.push(goalSeed(uid("goal"), animalId, kind, name, Math.round(Number(values.get("target")) * 100), 0, String(values.get("note") || ""), String(values.get("status")), String(values.get("linkedInvestment")) === "true", linkedAccountIds));
        state.goals[state.goals.length - 1].targetDate = String(values.get("targetDate") || "");
      }
      closeModal(modal); saveNow(); renderDreams(); showToast(existing ? "目标已更新" : "目标已创建");
    });
  }

  function openGoalHistory(goalId) {
    const goal = goalById(goalId); if (!goal) return;
    const entries = state.goalEntries.filter((item) => item.goalId === goalId).sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
    createModal(`${goal.name} · 资金变化历史`, entries.length ? `<div class="finance-history-list">${entries.map((item) => `<div><span>${escapeHtml(formatDateTime(item.occurredAt))} · ${item.type === "SPEND" ? "目标支出" : "转入目标"}</span><strong class="${item.amountCents >= 0 ? "finance-transfer" : "finance-expense"}">${signedMoney(item.amountCents)}</strong><small>${escapeHtml(state.transactions.find((transaction) => transaction.id === item.transactionId)?.note || "--")}</small></div>`).join("")}</div>` : empty("还没有目标资金变化。"));
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

  function accountRow(account, flow, manageable) {
    const owner = memberName(account.ownerMemberId);
    const currentFlow = flow || { incoming: 0, outgoing: 0 };
    return `<div class="finance-account-row">
      <div class="finance-account-name"><span class="finance-account-type">${escapeHtml(accountIcon(account.type))}</span><div><span>${escapeHtml(accountTypeName(account.type))}</span><strong>${escapeHtml(account.name)}</strong></div></div>
      <div><span>当前余额</span><strong>${money(account.currentBalanceCents)}</strong></div>
      <div><span>本月流入 / 流出</span><strong>${money(currentFlow.incoming)} / ${money(currentFlow.outgoing)}</strong></div>
      <div><span>${account.includeInFamilyAssets ? "计入家庭资产" : "不计家庭资产"} · ${escapeHtml(owner)}</span><strong>${shortDate(account.updatedAt)} ${manageable ? `<button class="finance-row-action" data-edit-account="${escapeAttribute(account.id)}">编辑</button><button class="finance-row-action" data-adjust-account="${escapeAttribute(account.id)}">调余额</button>` : ""}</strong></div>
    </div>`;
  }

  function accountSummaryRow(name, type, balance, count) {
    return `<div class="finance-account-row"><div class="finance-account-name"><span class="finance-account-type">投</span><div><span>${escapeHtml(type)}</span><strong>${escapeHtml(name)}</strong></div></div><div><span>当前资产</span><strong>${money(balance)}</strong></div><div><span>账户数</span><strong>${count}</strong></div><div><span>统计口径</span><strong>只读摘要</strong></div></div>`;
  }

  function transactionRow(item) {
    const account = item.type === "EXPENSE" ? accountName(item.fromAccountId) : accountName(item.toAccountId || item.fromAccountId);
    return `<div class="finance-account-row"><div><span>${shortDate(item.occurredAt)} · ${escapeHtml(typeName(item.type))}</span><strong>${escapeHtml(categoryName(item.categoryId) || item.note || "未分类")}</strong></div><div><span>${escapeHtml(account)}</span><strong class="${transactionColorClass(item.type)}">${transactionMoney(item)}</strong></div><div><span>归属</span><strong>${item.ownership === "FAMILY" ? "家庭" : memberName(item.ownerMemberId)}</strong></div><div><span>备注</span><strong>${escapeHtml(item.note || "--")}</strong></div></div>`;
  }

  function compactGoalRow(goal) {
    return `<div class="finance-account-row"><div><span>${animalName(goal.kind)}</span><strong>${escapeHtml(goal.name)}</strong></div><div><span>当前 / 目标</span><strong>${money(goal.currentAmountCents)} / ${money(goal.targetAmountCents)}</strong></div><div><span>完成比例</span><strong>${formatProgress(goal)}</strong></div><div><span>状态</span><strong>${escapeHtml(goalStatusName(effectiveGoalStatus(goal)))}</strong></div></div>`;
  }

  function goalCard(goal) {
    const ratio = progress(goal);
    const emoji = goal.kind === "GOOSE" ? "🪿" : goal.kind === "DUCK" ? "🦆" : "🐔";
    const size = 25 + Math.min(18, ratio / 5);
    const remaining = Math.max(0, goal.targetAmountCents - goal.currentAmountCents);
    const monthAdded = sum(state.goalEntries.filter((item) => item.goalId === goal.id && item.type === "ALLOCATION" && monthKey(item.occurredAt) === ledgerMonth).map((item) => item.amountCents));
    const linkedNames = goal.linkedInvestmentAccountIds?.length ? "投资账户摘要" : (goal.linkedAccountIds || []).map(accountName).join("、") || "未关联";
    return `<article class="finance-goal-card">
      <div class="finance-goal-top"><div class="finance-animal"><div class="finance-animal-figure" style="--animal-size:${size}px">${emoji}</div><div><h3>${escapeHtml(goal.name)}</h3><p>${escapeHtml(goal.note || animalName(goal.kind))}</p></div></div><div class="finance-goal-value"><strong>${money(goal.currentAmountCents)}</strong><span>目标 ${money(goal.targetAmountCents)}</span></div></div>
      <div class="finance-progress"><i style="width:${Math.min(100, ratio)}%"></i></div>
      <div class="finance-goal-meta"><div><span>完成比例</span><strong>${formatProgress(goal)}</strong></div><div><span>累计本金</span><strong>${money(goal.principalCents)}</strong></div><div><span>累计收益</span><strong class="${goal.earningsCents >= 0 ? "finance-stock-up" : "finance-stock-down"}">${signedMoney(goal.earningsCents)}</strong></div><div><span>本月新增</span><strong>${money(monthAdded)}</strong></div><div><span>已支出</span><strong>${money(goal.spentAmountCents)}</strong></div><div><span>剩余目标</span><strong>${money(remaining)}</strong></div><div><span>预计完成</span><strong>${escapeHtml(goal.targetDate || "未设置")}</strong></div><div><span>关联账户</span><strong>${escapeHtml(linkedNames)}</strong></div><div><span>状态</span><strong>${escapeHtml(goalStatusName(effectiveGoalStatus(goal)))}</strong></div></div>
      <div class="finance-inline-actions"><button class="finance-primary" data-allocate-goal="${escapeAttribute(goal.id)}">转入目标</button>${goal.kind === "CHICKEN" ? `<button class="finance-secondary" data-spend-goal="${escapeAttribute(goal.id)}">目标支出</button>` : ""}<button class="finance-secondary" data-goal-history="${escapeAttribute(goal.id)}">历史</button><button class="finance-secondary" data-edit-goal="${escapeAttribute(goal.id)}">编辑</button></div>
    </article>`;
  }

  function investmentRow(item) {
    return `<div class="finance-investment-row"><div><span>证券账户</span><strong>${escapeHtml(item.name)}</strong></div><div><span>总资产（含可用资金）</span><strong>${money(item.totalAssetCents)}</strong></div><div><span>推算本金 / 投资盈亏</span><strong>${money(item.principalCents)} / <b class="${item.profitLossCents >= 0 ? "finance-stock-up" : "finance-stock-down"}">${signedMoney(item.profitLossCents)}</b></strong></div><div><span>账户内可用资金 · 更新时间</span><strong>${money(item.availableCashCents)} · ${shortDate(item.updatedAt)}</strong></div></div>`;
  }

  function transactionTableRow(item) {
    const category = categoryById(item.categoryId);
    const parent = category?.parentId ? categoryById(category.parentId) : category;
    const sub = category?.parentId ? category : null;
    return `<tr data-transaction-id="${escapeAttribute(item.id)}"><td>${escapeHtml(formatDateTime(item.occurredAt))}</td><td class="${transactionColorClass(item.type)}"><strong>${transactionMoney(item)}</strong></td><td>${escapeHtml(typeName(item.type))}</td><td>${escapeHtml(parent?.name || "--")}</td><td>${escapeHtml(sub?.name || "--")}</td><td>${escapeHtml(accountName(item.fromAccountId))}</td><td>${escapeHtml(accountName(item.toAccountId))}</td><td>${escapeHtml(memberName(item.bookkeeperMemberId))}</td><td>${escapeHtml(memberName(item.payerMemberId))}</td><td>${item.ownership === "FAMILY" ? "家庭" : "个人"}</td><td>${item.isShared ? "共享" : "私密"}</td><td>${escapeHtml(goalById(item.goalId)?.name || "--")}</td><td>${escapeHtml(item.merchant || "--")}</td><td contenteditable="true" data-edit-note="${escapeAttribute(item.id)}">${escapeHtml(item.note || "")}</td></tr>`;
  }

  function transactionCard(item) {
    const category = categoryById(item.categoryId);
    const parent = category?.parentId ? categoryById(category.parentId) : category;
    const sub = category?.parentId ? category : null;
    return `<article class="finance-ledger-card" data-transaction-id="${escapeAttribute(item.id)}">
      <div class="finance-ledger-card-head"><div><span>${escapeHtml(formatDateTime(item.occurredAt))}</span><strong>${escapeHtml(typeName(item.type))}</strong></div><b class="${transactionColorClass(item.type)}">${transactionMoney(item)}</b></div>
      <dl><div><dt>分类</dt><dd>${escapeHtml([parent?.name, sub?.name].filter(Boolean).join(" / ") || "--")}</dd></div><div><dt>资金流</dt><dd>${escapeHtml(accountName(item.fromAccountId))} → ${escapeHtml(accountName(item.toAccountId))}</dd></div><div><dt>记账 / 付款</dt><dd>${escapeHtml(memberName(item.bookkeeperMemberId))} / ${escapeHtml(memberName(item.payerMemberId))}</dd></div><div><dt>归属 / 共享</dt><dd>${item.ownership === "FAMILY" ? "家庭" : "个人"} / ${item.isShared ? "共享" : "私密"}</dd></div><div><dt>目标 / 商家</dt><dd>${escapeHtml(goalById(item.goalId)?.name || "--")} / ${escapeHtml(item.merchant || "--")}</dd></div><div><dt>备注</dt><dd>${escapeHtml(item.note || "--")}</dd></div></dl>
    </article>`;
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
    const selectedMember = ledgerScope.startsWith("member:") ? ledgerScope.slice(7) : "";
    const needle = ledgerSearch.trim().toLowerCase();
    return [...state.transactions].filter((item) => monthKey(item.occurredAt) === ledgerMonth)
      .filter((item) => ledgerType === "ALL" || item.type === ledgerType)
      .filter((item) => ledgerScope === "family" ? (item.ownership === "FAMILY" || item.includeInFamilyStats) && (item.isShared || item.ownerMemberId === me || item.payerMemberId === me || item.bookkeeperMemberId === me) : ledgerScope === "me" ? item.ownerMemberId === me || item.payerMemberId === me || item.bookkeeperMemberId === me : item.isShared && (item.ownerMemberId === selectedMember || item.payerMemberId === selectedMember || item.bookkeeperMemberId === selectedMember))
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
    const me = state.members.find((item) => item.isCurrentUser)?.id;
    const privateOthers = (state.memberMonthlySummaries || []).filter((item) => item.month === month && item.memberId !== me);
    return {
      transactions,
      income: sum(included.filter((item) => ["INCOME", "REFUND", "REIMBURSEMENT"].includes(item.type)).map((item) => item.amountCents)) + sum(privateOthers.map((item) => item.incomeCents)),
      expense: sum(included.filter((item) => item.type === "EXPENSE").map((item) => item.amountCents)) + sum(privateOthers.map((item) => item.expenseCents))
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
      const totalAssetCents = marketValueCents + availableCashCents;
      return { id: `investment-${account.id}`, investmentAccountId: String(account.id), name: String(account.name || "投资账户"), totalAssetCents, marketValueCents, availableCashCents, profitLossCents, principalCents: Math.max(0, totalAssetCents - profitLossCents), updatedAt: new Date().toISOString() };
    });
  }

  function familyAssetTotals(investments = investmentSummaries()) {
    const me = state.members.find((item) => item.isCurrentUser)?.id;
    const otherPrivate = (state.memberAssetSummaries || []).filter((item) => item.memberId !== me);
    const dailyAssets = sum(state.accounts.filter((item) => item.includeInFamilyAssets && !item.isArchived && item.type !== "CREDIT_CARD" && item.type !== "SECURITIES" && !item.externalInvestmentAccountId).map((item) => item.currentBalanceCents)) + sum(otherPrivate.map((item) => item.assetCents));
    const liabilities = Math.abs(sum(state.accounts.filter((item) => !item.isArchived && item.type === "CREDIT_CARD" && item.currentBalanceCents < 0).map((item) => item.currentBalanceCents))) + sum(otherPrivate.map((item) => item.liabilityCents));
    const investmentAssets = sum(investments.map((item) => item.totalAssetCents));
    return { dailyAssets, liabilities, investmentAssets, totalAssets: dailyAssets + investmentAssets, netAssets: dailyAssets + investmentAssets - liabilities };
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
    refreshDerivedState();
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(cacheKey(), JSON.stringify(state));
    syncText = "正在保存…";
    void pushRemoteState();
  }

  function refreshDerivedState() {
    state.investmentSummaries = investmentSummaries();
    const assets = familyAssetTotals(state.investmentSummaries);
    const today = new Date().toISOString().slice(0, 10);
    const snapshot = { id: `family-${today}`, snapshotDate: today, scope: "FAMILY", scopeId: "family", assetCents: assets.totalAssets, liabilityCents: assets.liabilities, netAssetCents: assets.netAssets, principalCents: sum(state.investmentSummaries.map((item) => item.principalCents)), profitLossCents: sum(state.investmentSummaries.map((item) => item.profitLossCents)), source: "ACCOUNT_AND_INVESTMENT_SUMMARY", createdAt: new Date().toISOString() };
    const index = state.assetSnapshots.findIndex((item) => item.id === snapshot.id);
    if (index >= 0) state.assetSnapshots[index] = snapshot; else state.assetSnapshots.unshift(snapshot);
  }

  async function initializeAuthenticatedFinance() {
    await window.FinanceAuth.ready;
    state = loadCache() || defaultState();
    adoptAuthenticatedMembers();
    bindEvents();
    navigateRoute(parseRoute());
    await loadRemoteState();
    subscribeRealtime();
  }

  async function loadRemoteState(fromRealtime = false) {
    if (location.protocol === "file:") { syncText = "已保存在此设备 · 本地预览"; return; }
    if (window.FinanceAuth?.client && window.FinanceAuth.household) {
      if (cloudBusy) return;
      cloudBusy = true;
      try {
        const client = window.FinanceAuth.client;
        const householdId = window.FinanceAuth.household.id;
        const [sharedResult, personalResult] = await Promise.all([
          client.from("household_finance_state").select("revision,body,updated_at").eq("household_id", householdId).maybeSingle(),
          client.from("personal_finance_state").select("revision,body,updated_at").eq("household_id", householdId).eq("user_id", window.FinanceAuth.user.id).maybeSingle()
        ]);
        if (sharedResult.error) throw sharedResult.error;
        if (personalResult.error) throw personalResult.error;
        sharedRevision = Number(sharedResult.data?.revision || 0);
        personalRevision = Number(personalResult.data?.revision || 0);
        if (sharedResult.data?.body && hasFinanceData(sharedResult.data.body)) {
          state = mergeCloudState(sharedResult.data.body, personalResult.data?.body || privateStateBody(state));
          adoptAuthenticatedMembers();
          syncText = fromRealtime ? "已收到家庭成员的更新" : "已从家庭云端读取";
          localStorage.setItem(cacheKey(), JSON.stringify(state));
        } else {
          adoptAuthenticatedMembers();
          await pushRemoteState();
        }
      } catch (_) {
        syncText = "已保存在此设备 · 云端读取失败";
      } finally {
        cloudBusy = false;
      }
      if (document.body.classList.contains("finance-mode")) render();
      return;
    }
    try {
      const response = await fetch(API_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.state && Array.isArray(payload.state.accounts)) {
        if (window.FinanceAuth?.activeMemberId && payload.activeMemberId !== window.FinanceAuth.activeMemberId) window.FinanceAuth.leaveMember();
        state = normalizeState(payload.state);
        activateMember(payload.activeMemberId || null);
      }
      else await pushRemoteState();
      localStorage.setItem(cacheKey(), JSON.stringify(state));
      syncText = "已从云端读取保存数据";
      if (document.body.classList.contains("finance-mode")) render();
    } catch (_) {
      syncText = "已保存在此设备 · 云端暂不可用";
      if (document.body.classList.contains("finance-mode")) render();
    }
  }

  async function pushRemoteState() {
    if (location.protocol === "file:") { syncText = "已保存在此设备 · 本地预览"; return; }
    refreshDerivedState();
    if (window.FinanceAuth?.client && window.FinanceAuth.household) {
      const client = window.FinanceAuth.client;
      const householdId = window.FinanceAuth.household.id;
      const bodies = splitCloudState();
      cloudBusy = true;
      try {
        const sharedResult = await client.rpc("save_household_finance_state", { target_household_id: householdId, expected_revision: sharedRevision, next_body: bodies.shared });
        if (sharedResult.error) throw sharedResult.error;
        sharedRevision = Number((Array.isArray(sharedResult.data) ? sharedResult.data[0] : sharedResult.data)?.revision || sharedRevision + 1);
        const personalResult = await client.rpc("save_personal_finance_state", { target_household_id: householdId, expected_revision: personalRevision, next_body: bodies.personal });
        if (personalResult.error) throw personalResult.error;
        personalRevision = Number((Array.isArray(personalResult.data) ? personalResult.data[0] : personalResult.data)?.revision || personalRevision + 1);
        syncText = "已保存到家庭云端";
      } catch (error) {
        if (/revision conflict/i.test(error.message || "")) {
          syncText = "检测到他人更新，正在重新读取…";
          cloudBusy = false;
          await loadRemoteState(true);
          toast("另一台设备刚刚保存了数据，请确认后重试本次修改。");
        } else syncText = "已保存在此设备 · 云端保存失败";
      } finally { cloudBusy = false; }
      if (document.body.classList.contains("finance-mode")) render();
      return;
    }
    try {
      const response = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      syncText = "已保存到云端共享账本";
    } catch (_) { syncText = "已保存在此设备 · 云端保存失败"; }
    if (document.body.classList.contains("finance-mode")) render();
  }

  function cacheKey() {
    const auth = window.FinanceAuth;
    return auth?.activeMemberId ? `${CACHE_KEY}:member-v2:${auth.activeMemberId}` : `${CACHE_KEY}:shared-v2`;
  }

  function loadCache() {
    try { const value = JSON.parse(localStorage.getItem(cacheKey()) || "null"); return value ? normalizeState(value) : null; } catch (_) { return null; }
  }

  function normalizeState(raw) {
    const fallback = defaultState();
    const dreamAnimals = Array.isArray(raw.dreamAnimals) && raw.dreamAnimals.length ? raw.dreamAnimals : fallback.dreamAnimals;
    const goals = (Array.isArray(raw.goals) && raw.goals.length ? raw.goals : fallback.goals).map((goal, index) => ({ ...goal, animalId: goal.animalId || dreamAnimals.find((animal) => animal.name === goal.name && animal.kind === goal.kind)?.id || dreamAnimals[index]?.id || "" }));
    return {
      version: 1,
      updatedAt: String(raw.updatedAt || new Date().toISOString()),
      members: Array.isArray(raw.members) && raw.members.length ? raw.members : fallback.members,
      categories: (Array.isArray(raw.categories) && raw.categories.length ? raw.categories : fallback.categories).map((category) => category.id === "expense-food" ? { ...category, name: "餐饮" } : category),
      accounts: Array.isArray(raw.accounts) ? raw.accounts : fallback.accounts,
      transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
      dreamAnimals,
      goals,
      goalEntries: Array.isArray(raw.goalEntries) ? raw.goalEntries : [],
      assetSnapshots: Array.isArray(raw.assetSnapshots) ? raw.assetSnapshots : [],
      investmentSummaries: Array.isArray(raw.investmentSummaries) ? raw.investmentSummaries : [],
      memberAssetSummaries: Array.isArray(raw.memberAssetSummaries) ? raw.memberAssetSummaries : [],
      memberMonthlySummaries: Array.isArray(raw.memberMonthlySummaries) ? raw.memberMonthlySummaries : []
    };
  }

  function adoptAuthenticatedMembers() {
    const auth = window.FinanceAuth;
    if (!auth?.user) return;
    const oldCurrent = state.members.find((item) => item.isCurrentUser)?.id || "member-me";
    const newCurrent = auth.user.id;
    if (oldCurrent !== newCurrent) {
      state.accounts.forEach((item) => { if (item.ownerMemberId === oldCurrent) item.ownerMemberId = newCurrent; });
      state.transactions.forEach((item) => {
        ["ownerMemberId", "payerMemberId", "bookkeeperMemberId"].forEach((key) => { if (item[key] === oldCurrent) item[key] = newCurrent; });
      });
      state.dreamAnimals.forEach((item) => { if (item.ownerMemberId === oldCurrent) item.ownerMemberId = newCurrent; });
    }
    const roles = { owner: "家庭创建者", admin: "家庭管理员", member: "家庭成员" };
    state.members = (auth.members?.length ? auth.members : [auth.member]).map((item) => ({ id: item.id, displayName: item.displayName || "家庭成员", role: roles[item.role] || "家庭成员", isCurrentUser: item.id === newCurrent, isActive: true }));
  }

  function privateStateBody(source = state) {
    return {
      version: 1,
      updatedAt: source.updatedAt,
      accounts: source.accounts.filter((item) => !item.isShared),
      transactions: source.transactions.filter((item) => !item.isShared)
    };
  }

  function splitCloudState() {
    const personal = privateStateBody(state);
    const currentId = state.members.find((item) => item.isCurrentUser)?.id;
    const privateAccounts = personal.accounts.filter((item) => item.ownerMemberId === currentId && !item.isArchived);
    const privateSummary = {
      memberId: currentId,
      assetCents: sum(privateAccounts.filter((item) => item.includeInFamilyAssets && item.type !== "CREDIT_CARD" && item.type !== "SECURITIES" && !item.externalInvestmentAccountId).map((item) => item.currentBalanceCents)),
      liabilityCents: Math.abs(sum(privateAccounts.filter((item) => item.type === "CREDIT_CARD" && item.currentBalanceCents < 0).map((item) => item.currentBalanceCents))),
      updatedAt: new Date().toISOString()
    };
    const memberAssetSummaries = [...(state.memberAssetSummaries || []).filter((item) => item.memberId !== currentId), privateSummary];
    const privateMonths = [...new Set(personal.transactions.filter((item) => item.includeInFamilyStats).map((item) => monthKey(item.occurredAt)))];
    const currentMonthly = privateMonths.map((month) => {
      const rows = personal.transactions.filter((item) => item.includeInFamilyStats && monthKey(item.occurredAt) === month);
      return { memberId: currentId, month, incomeCents: sum(rows.filter((item) => ["INCOME", "REFUND", "REIMBURSEMENT"].includes(item.type)).map((item) => item.amountCents)), expenseCents: sum(rows.filter((item) => item.type === "EXPENSE").map((item) => item.amountCents)), updatedAt: new Date().toISOString() };
    });
    const memberMonthlySummaries = [...(state.memberMonthlySummaries || []).filter((item) => item.memberId !== currentId), ...currentMonthly];
    const shared = {
      ...state,
      accounts: state.accounts.filter((item) => item.isShared),
      transactions: state.transactions.filter((item) => item.isShared),
      memberAssetSummaries,
      memberMonthlySummaries
    };
    return { shared, personal };
  }

  function mergeCloudState(sharedBody, personalBody) {
    const shared = normalizeState(sharedBody);
    const personalAccounts = Array.isArray(personalBody?.accounts) ? personalBody.accounts : [];
    const personalTransactions = Array.isArray(personalBody?.transactions) ? personalBody.transactions : [];
    return normalizeState({ ...shared, accounts: [...shared.accounts, ...personalAccounts], transactions: [...shared.transactions, ...personalTransactions] });
  }

  function subscribeRealtime() {
    const auth = window.FinanceAuth;
    if (!auth?.client || realtimeChannel) return;
    let timer = 0;
    const reload = () => { clearTimeout(timer); timer = window.setTimeout(() => { if (!cloudBusy) void loadRemoteState(true); }, 450); };
    realtimeChannel = auth.client.channel(`finance-${auth.household.id}-${auth.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "household_finance_state", filter: `household_id=eq.${auth.household.id}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "personal_finance_state", filter: `user_id=eq.${auth.user.id}` }, reload)
      .subscribe();
  }

  function hasFinanceData(value) { return value && Array.isArray(value.accounts) && value.accounts.length > 0 && Array.isArray(value.transactions); }

  function exportCsv() {
    const headers = ["日期时间","金额","类型","一级分类","二级分类","支出账户","收入账户","记账人","实际付款人","个人或家庭","是否共享","鹅鸭鸡目标","商家","备注"];
    const rows = filteredTransactions().map((item) => {
      const category = categoryById(item.categoryId); const parent = category?.parentId ? categoryById(category.parentId) : category;
      return [formatDateTime(item.occurredAt), (item.amountCents / 100).toFixed(2), typeName(item.type), parent?.name || "", category?.parentId ? category.name : "", accountName(item.fromAccountId), accountName(item.toAccountId), memberName(item.bookkeeperMemberId), memberName(item.payerMemberId), item.ownership === "FAMILY" ? "家庭" : "个人", item.isShared ? "是" : "否", goalById(item.goalId)?.name || "", item.merchant || "", item.note || ""];
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
        const transaction = { id: uid("import"), occurredAt: new Date(data["日期时间"] || Date.now()).toISOString(), type, amountCents, categoryId: category?.id || "", fromAccountId: from?.id || "", toAccountId: to?.id || "", bookkeeperMemberId: bookkeeper?.id || "", payerMemberId: payer?.id || "", ownership: data["个人或家庭"] === "个人" ? "PERSONAL" : "FAMILY", ownerMemberId: data["个人或家庭"] === "个人" ? payer?.id || "" : "", isShared: data["是否共享"] !== "否", includeInFamilyStats: !["TRANSFER", "BALANCE_ADJUSTMENT"].includes(type), goalId: goal?.id || "", merchant: data["商家"] || "", note: data["备注"] || "", splitAllocations: [], importBatchId: file.name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (type === "EXPENSE" && !transaction.fromAccountId) throw new Error("missing account");
        if (["INCOME","REFUND","REIMBURSEMENT","BALANCE_ADJUSTMENT"].includes(type) && !transaction.toAccountId) throw new Error("missing account");
        if (type === "TRANSFER" && (!transaction.fromAccountId || !transaction.toAccountId || transaction.fromAccountId === transaction.toAccountId)) throw new Error("missing transfer side");
        if (type === "TRANSFER" && goal && !goal.linkedAccountIds?.includes(transaction.toAccountId)) throw new Error("unlinked goal account");
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

  function parseRoute(hash = location.hash) {
    const path = String(hash || "").replace(/^#\/?/, "").replace(/^\//, "");
    const [section, subtab] = path.split("/");
    if (section === "funds") {
      const tab = FUND_TABS.some(([key]) => key === subtab) ? subtab : navPreference.funds || "overview";
      return { section: "funds", subtab: tab, view: tab, path: `#/funds/${tab}` };
    }
    if (section === "investment") {
      const tab = INVESTMENT_TABS.some(([key]) => key === subtab) ? subtab : navPreference.investment || "accounts";
      return { section: "investment", subtab: tab, view: tab === "accounts" ? "investments" : "", path: `#/investment/${tab}` };
    }
    if (["dreams", "reports", "mine"].includes(section)) return { section, subtab: "", view: section, path: `#/${section}` };
    const legacy = { overview: ["funds", "overview"], ledger: ["funds", "ledger"], accounts: ["funds", "accounts"], members: ["funds", "members"], investments: ["investment", "accounts"], holdings: ["investment", "holdings"], plans: ["investment", "plans"] }[section];
    if (legacy) return legacy[0] === "funds" ? { section: "funds", subtab: legacy[1], view: legacy[1], path: `#/funds/${legacy[1]}` } : { section: "investment", subtab: legacy[1], view: legacy[1] === "accounts" ? "investments" : "", path: `#/investment/${legacy[1]}` };
    const tab = navPreference.funds || "overview";
    return { section: "funds", subtab: tab, view: tab, path: `#/funds/${tab}` };
  }

  function routeForView(view) {
    if (FUND_TABS.some(([key]) => key === view)) return { section: "funds", subtab: view, view, path: `#/funds/${view}` };
    if (view === "investments") return { section: "investment", subtab: "accounts", view, path: "#/investment/accounts" };
    return { section: view, subtab: "", view, path: `#/${view}` };
  }

  function loadNavPreference() {
    try {
      const value = JSON.parse(localStorage.getItem(NAV_PREFERENCE_KEY) || "null");
      return { funds: FUND_TABS.some(([key]) => key === value?.funds) ? value.funds : "overview", investment: INVESTMENT_TABS.some(([key]) => key === value?.investment) ? value.investment : "accounts" };
    } catch (_) { return { funds: "overview", investment: "accounts" }; }
  }

  function rememberSubtab(section, tab) {
    if (!navPreference || navPreference[section] === tab) return;
    navPreference = { ...navPreference, [section]: tab };
    localStorage.setItem(NAV_PREFERENCE_KEY, JSON.stringify(navPreference));
  }
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
  function formatProgress(goal) { const ratio = progress(goal); return `${(goal.currentAmountCents >= goal.targetAmountCents ? 100 : Math.min(99.99, Math.max(0, ratio))).toFixed(2)}%`; }
  function effectiveGoalStatus(goal) { return goal.currentAmountCents < goal.targetAmountCents && ["GROWN", "COMPLETED"].includes(goal.status) ? (goal.kind === "CHICKEN" ? "SAVING" : "ACTIVE") : goal.status; }
  function transactionColorClass(type) { return type === "EXPENSE" ? "finance-expense" : ["INCOME", "REFUND", "REIMBURSEMENT"].includes(type) ? "finance-income" : type === "TRANSFER" ? "finance-transfer" : "finance-adjustment"; }
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
  function animalName(kind) { return ({ GOOSE: "鹅 · 长期财富与投资", DUCK: "鸭 · 中长期目标", CHICKEN: "鸡 · 短期愿望和计划" })[kind] || "资金目标"; }
  function goalStatusName(status) { return ({ ACTIVE: "进行中", SAVING: "存钱中", GROWN: "已长成", USED: "已使用", COMPLETED: "已完成", CLOSED: "已关闭" })[status] || status; }
  function accountTypeName(type) { return ({ BANK: "银行卡", WECHAT: "微信", ALIPAY: "支付宝", CASH: "现金", CREDIT_CARD: "信用卡", FAMILY_SHARED: "家庭公共账户", FUND: "基金账户", SECURITIES: "证券账户", OTHER: "其他账户" })[type] || "账户"; }
  function accountIcon(type) { return ({ BANK: "卡", WECHAT: "微", ALIPAY: "支", CASH: "现", CREDIT_CARD: "信", FAMILY_SHARED: "家", FUND: "基", SECURITIES: "证", OTHER: "账" })[type] || "账"; }

  if (window.__FINANCE_TEST_MODE__) {
    window.__FINANCE_TEST_API__ = {
      defaultState,
      setState(nextState) { state = normalizeState(nextState); },
      getState() { return state; },
      applyTransaction,
      monthlySummary,
      investmentSummaries,
      effectiveGoals,
      refreshDerivedState,
      familyAssetTotals,
      formatProgress,
      effectiveGoalStatus,
      parseRoute,
      routeForView
    };
  }
})();
