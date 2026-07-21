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
assert.equal(api.getState().categories.find((item) => item.id === "expense-food").name, "餐饮");

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

// 场景 C：投资总资产从 999,789.95 调整为 980,000 元。
assert.equal(initialInvestments.length, 1);
assert.equal(initialInvestments[0].totalAssetCents, 99978995);
const initialSmallGoose = api.effectiveGoals(initialInvestments).find((item) => item.id === "goal-small-goose");
assert.equal(api.formatProgress(initialSmallGoose), "99.98%", "C: 未达目标不能提前显示 100%");
assert.equal(api.effectiveGoalStatus(initialSmallGoose), "ACTIVE", "C: 未达目标仍为进行中");
const beforeInvestmentNet = api.familyAssetTotals(initialInvestments).netAssets;
const transactionCount = api.getState().transactions.length;
context.APP_DATA.accounts[0].availableCash = 980000;
const adjustedInvestments = api.investmentSummaries();
const adjustedSmallGoose = api.effectiveGoals(adjustedInvestments).find((item) => item.id === "goal-small-goose");
assert.equal(adjustedInvestments[0].totalAssetCents, 98000000, "C: 投资总资产变为 980,000 元");
assert.equal(adjustedSmallGoose.currentAmountCents, 98000000, "C: 小鹅金额联动");
assert.equal(api.formatProgress(adjustedSmallGoose), "98.00%", "C: 小鹅进度联动");
assert.equal(api.familyAssetTotals(adjustedInvestments).netAssets, beforeInvestmentNet - 1978995, "C: 家庭净资产减少 19,789.95 元");
assert.equal(api.getState().transactions.length, transactionCount, "C: 投资更新不生成家庭账目");
assert.equal(api.monthlySummary(month).income, 0, "C: 投资更新不产生收入");
assert.equal(api.monthlySummary(month).expense, 3500, "C: 投资更新不产生支出");

api.refreshDerivedState();
assert.equal(api.getState().assetSnapshots.length, 1);
assert.equal(api.getState().investmentSummaries.length, 1);
assert.equal(api.getState().investmentSummaries[0].totalAssetCents, 98000000);
console.log("finance system scenarios A/B/C passed");
