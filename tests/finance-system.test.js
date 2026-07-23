const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

function element() {
  return {
    innerHTML: "",
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

const store = new Map();
const document = {
  body: element(),
  getElementById() { return element(); },
  querySelectorAll() { return []; },
  querySelector() { return null; },
  createElement() { return element(); }
};
const context = {
  console,
  document,
  localStorage: { getItem(key) { return store.get(key) || null; }, setItem(key, value) { store.set(key, value); } },
  location: { hostname: "localhost", protocol: "file:", hash: "", pathname: "/finance.html", search: "" },
  history: { replaceState() {} },
  setTimeout,
  clearTimeout,
  Intl,
  Date,
  Math,
  URL,
  Blob,
  FormData,
  APP_DATA: {
    bankCash: 245500,
    accounts: [{ id: "self", name: "梦想号", availableCash: 999789.95 }],
    holdings: []
  },
  __FINANCE_TEST_MODE__: true,
  addEventListener() {},
  scrollTo() {}
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("finance-system.js", "utf8"), context);

const api = context.__FINANCE_TEST_API__;
assert.ok(api, "test API should be available");
const state = api.defaultState();
api.setState(state);

const bank = api.getState().accounts.find((item) => item.id === "account-bank");
const wechat = api.getState().accounts.find((item) => item.id === "account-wechat");
const family = api.getState().accounts.find((item) => item.id === "account-family");
const member = api.getState().members.find((item) => item.isCurrentUser);
const month = new Date().toISOString().slice(0, 7);
const initialInvestments = api.investmentSummaries();
const initialNetAssets = api.familyAssetTotals(initialInvestments).netAssets;
assert.equal(api.getState().categories.find((item) => item.id === "expense-food").name, "吃饭");
assert.deepEqual(JSON.parse(JSON.stringify(api.getState().categories.filter((item) => !item.parentId && item.isActive).map((item) => item.name))), ["收入", "固定开支", "生活开支", "机动开支", "Dream基金", "投资转入"]);
assert.deepEqual(JSON.parse(JSON.stringify(api.getState().categories.filter((item) => item.parentId === "category-income" && item.isActive).map((item) => item.name))), ["工资", "小说", "UP主", "副业", "奖金", "利息/收益", "其他收入"]);
assert.equal(initialInvestments[0].name, "个人基金");
assert.equal(api.getState().dreamFunds.length, 4, "虚拟资金池包含短期、长期、本人投资本金和家庭公共资金");
assert.equal(api.getState().allocationRules[0].fixedBps + api.getState().allocationRules[0].livingBps + api.getState().allocationRules[0].flexBps + api.getState().allocationRules[0].dreamBps + api.getState().allocationRules[0].investmentBps, 10000, "默认收入分配比例合计为100% ");

// 场景 A：微信支付 35 元家庭餐饮支出。
api.applyTransaction({
  id: "expense-1", occurredAt: new Date().toISOString(), type: "EXPENSE", amountCents: 3500,
  categoryId: "expense-food", fromAccountId: wechat.id, toAccountId: "", bookkeeperMemberId: member.id,
  payerMemberId: member.id, ownership: "FAMILY", ownerMemberId: "", isShared: true,
  includeInFamilyStats: true, goalId: "", merchant: "餐饮商家", note: "家庭餐饮", splitAllocations: []
});
assert.equal(wechat.currentBalanceCents, -3500, "A: 微信余额减少 35 元");
assert.equal(api.monthlySummary(month).expense, 3500, "A: 月度支出增加 35 元");
assert.equal(api.monthlySummary(month).income - api.monthlySummary(month).expense, -3500, "A: 月度结余减少 35 元");
assert.equal(api.familyAssetTotals(api.investmentSummaries()).netAssets, initialNetAssets - 3500, "A: 家庭净资产减少 35 元");

// 场景 B：银行卡转入买房鸭关联账户 10,000 元。
const houseGoal = api.getState().goals.find((item) => item.id === "goal-house-duck");
const beforeTransferBank = bank.currentBalanceCents;
const beforeTransferNet = api.familyAssetTotals(api.investmentSummaries()).netAssets;
api.applyTransaction({
  id: "transfer-1", occurredAt: new Date().toISOString(), type: "TRANSFER", amountCents: 1000000,
  categoryId: "", fromAccountId: bank.id, toAccountId: family.id, bookkeeperMemberId: member.id,
  payerMemberId: member.id, ownership: "FAMILY", ownerMemberId: "", isShared: true,
  includeInFamilyStats: false, goalId: houseGoal.id, merchant: "", note: "买房鸭月度投入", splitAllocations: []
});
assert.equal(bank.currentBalanceCents, beforeTransferBank - 1000000, "B: 银行卡减少 10,000 元");
assert.equal(family.currentBalanceCents, 1000000, "B: 买房鸭关联账户增加 10,000 元");
assert.equal(houseGoal.allocatedAmountCents, 1000000, "B: 买房鸭进度增加 10,000 元");
assert.equal(api.familyAssetTotals(api.investmentSummaries()).netAssets, beforeTransferNet, "B: 家庭净资产不变");
assert.equal(api.monthlySummary(month).expense, 3500, "B: 转账不增加支出");
assert.equal(api.monthlySummary(month).income, 0, "B: 转账不增加收入");

// 场景 D：鸭和鸡可以接收入分配、利息与支出；鹅的本金不能支出。
api.applyTransaction({
  id: "interest-1", occurredAt: new Date().toISOString(), type: "INCOME", amountCents: 12000,
  categoryId: "dream-long", fromAccountId: "", toAccountId: family.id, bookkeeperMemberId: member.id,
  payerMemberId: member.id, ownership: "FAMILY", ownerMemberId: "", isShared: true,
  includeInFamilyStats: true, goalId: houseGoal.id, merchant: "", note: "买房鸭利息收益", splitAllocations: []
});
assert.equal(houseGoal.earningsCents, 12000, "D: 鸭子的利息记为蛋/收益");
assert.equal(houseGoal.allocatedAmountCents, 1012000, "D: 利息同步增加鸭子余额");
api.applyTransaction({
  id: "dream-spend-1", occurredAt: new Date().toISOString(), type: "EXPENSE", amountCents: 20000,
  categoryId: "dream-long", fromAccountId: family.id, toAccountId: "", bookkeeperMemberId: member.id,
  payerMemberId: member.id, ownership: "FAMILY", ownerMemberId: "", isShared: true,
  includeInFamilyStats: true, goalId: houseGoal.id, merchant: "", note: "买房鸭支出", splitAllocations: []
});
assert.equal(houseGoal.allocatedAmountCents, 992000, "D: 鸭子支出同步扣减余额");
const bigGoose = api.getState().goals.find((item) => item.id === "goal-big-goose");
assert.throws(() => api.applyTransaction({ type: "EXPENSE", amountCents: 100, fromAccountId: family.id, goalId: bigGoose.id }), /不能记录支出/, "D: 鹅的本金不可支出");

// 场景 C：投资总资产从 999,789.95 调整为 980,000 元。
assert.equal(initialInvestments.length, 1);
assert.equal(initialInvestments[0].totalAssetCents, 99978995);
const initialSmallGoose = api.effectiveGoals(initialInvestments).find((item) => item.id === "goal-small-goose");
const initialBigGoose = api.effectiveGoals(initialInvestments).find((item) => item.id === "goal-big-goose");
assert.equal(initialSmallGoose.currentAmountCents, 0, "C: 胖胖退休鹅不再引用白白投资账户");
assert.ok(initialBigGoose.currentAmountCents < initialNetAssets, "C: 白白退休资金会扣除生活账户和 Dream 基金");
assert.equal(api.effectiveGoalStatus(initialBigGoose), "ACTIVE", "C: 未达目标仍为进行中");
const beforeInvestmentNet = api.familyAssetTotals(initialInvestments).netAssets;
const transactionCount = api.getState().transactions.length;
context.APP_DATA.accounts[0].availableCash = 980000;
const adjustedInvestments = api.investmentSummaries();
const adjustedSmallGoose = api.effectiveGoals(adjustedInvestments).find((item) => item.id === "goal-small-goose");
const adjustedBigGoose = api.effectiveGoals(adjustedInvestments).find((item) => item.id === "goal-big-goose");
assert.equal(adjustedInvestments[0].totalAssetCents, 98000000, "C: 投资总资产变为 980,000 元");
assert.equal(adjustedSmallGoose.currentAmountCents, 0, "C: 胖胖退休鹅保持自己的资金口径");
assert.equal(adjustedBigGoose.currentAmountCents, 121546500, "C: 白白退休鹅按白白全部资产减去生活与 Dream 计算");
assert.equal(api.formatProgress(adjustedBigGoose), "12.15%", "C: 白白退休鹅进度按退休目标计算");
assert.equal(api.familyAssetTotals(adjustedInvestments).netAssets, beforeInvestmentNet - 1978995, "C: 家庭净资产减少 19,789.95 元");
assert.equal(api.getState().transactions.length, transactionCount, "C: 投资更新不生成家庭账目");
assert.equal(api.monthlySummary(month).income, 12000, "C: 投资更新不改变既有收入");
assert.equal(api.monthlySummary(month).expense, 23500, "C: 投资更新不改变既有支出");

api.refreshDerivedState();
assert.equal(api.getState().assetSnapshots.length, 1);
assert.equal(api.getState().investmentSummaries.length, 1);
assert.equal(api.getState().investmentSummaries[0].totalAssetCents, 98000000);

assert.deepEqual(
  JSON.parse(JSON.stringify(api.parseRoute("#/funds/members"))),
  { section: "funds", subtab: "settings", view: "settings", path: "#/funds/settings" },
  "旧成员页链接自动进入设置"
);
assert.deepEqual(
  JSON.parse(JSON.stringify(api.parseRoute("#/investment/holdings"))),
  { section: "investment", subtab: "holdings", view: "", path: "#/investment/holdings" },
  "投资模块使用二级路由"
);
assert.deepEqual(
  JSON.parse(JSON.stringify(api.parseRoute("#/reports"))),
  { section: "funds", subtab: "ledger", view: "ledger", path: "#/funds/ledger", ledgerPanel: "reports" },
  "旧报表链接自动进入账本报表"
);
assert.equal(api.routeForView("overview").path, "#/funds/overview");
assert.equal(api.routeForView("investments").path, "#/investment/holdings");
const customized = api.defaultState();
const customizedIncome = customized.categories.find((item) => item.id === "category-income");
customizedIncome.name = "我的收入";
const disabledSalary = customized.categories.find((item) => item.id === "income-salary");
disabledSalary.isActive = false;
api.setState(customized);
assert.equal(api.getState().categories.find((item) => item.id === "category-income").name, "我的收入", "默认分类改名后应保留");
assert.equal(api.getState().categories.find((item) => item.id === "income-salary").isActive, false, "默认分类停用后应保留");
console.log("finance system scenarios A/B/C passed");
