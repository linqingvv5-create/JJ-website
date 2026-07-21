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
    accounts: [{ id: "self", name: "梦想号", availableCash: 100000 }],
    holdings: [{ id: "h1", accountId: "self", shares: 100, cost: 10, currentPrice: 12 }]
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
const family = api.getState().accounts.find((item) => item.id === "account-family");
const member = api.getState().members.find((item) => item.isCurrentUser);
const month = new Date().toISOString().slice(0, 7);

api.applyTransaction({
  id: "expense-1", occurredAt: new Date().toISOString(), type: "EXPENSE", amountCents: 3500,
  categoryId: "expense-food", fromAccountId: bank.id, toAccountId: "", bookkeeperMemberId: member.id,
  payerMemberId: member.id, ownership: "FAMILY", ownerMemberId: "", isShared: true,
  includeInFamilyStats: true, goalId: "", merchant: "", note: "家庭午餐", splitAllocations: []
});
assert.equal(bank.currentBalanceCents, state.accounts.find((item) => item.id === "account-bank").openingBalanceCents - 3500);
assert.equal(api.monthlySummary(month).expense, 3500);

const houseGoal = api.getState().goals.find((item) => item.id === "goal-house-duck");
api.applyTransaction({
  id: "transfer-1", occurredAt: new Date().toISOString(), type: "TRANSFER", amountCents: 100000,
  categoryId: "", fromAccountId: bank.id, toAccountId: family.id, bookkeeperMemberId: member.id,
  payerMemberId: member.id, ownership: "FAMILY", ownerMemberId: "", isShared: true,
  includeInFamilyStats: false, goalId: houseGoal.id, merchant: "", note: "买房鸭月度投入", splitAllocations: []
});
assert.equal(family.currentBalanceCents, 100000);
assert.equal(houseGoal.allocatedAmountCents, 100000);
assert.equal(api.monthlySummary(month).expense, 3500, "goal transfer must not become expense");
assert.equal(api.monthlySummary(month).income, 0, "goal transfer must not become income");

const investments = api.investmentSummaries();
assert.equal(investments.length, 1);
assert.equal(investments[0].totalAssetCents, 10120000);
assert.equal(api.getState().transactions.length, 2, "investment refresh must not create ledger rows");
const smallGoose = api.effectiveGoals(investments).find((item) => item.id === "goal-small-goose");
assert.equal(smallGoose.currentAmountCents, investments[0].totalAssetCents);

api.refreshDerivedState();
assert.equal(api.getState().assetSnapshots.length, 1);
assert.equal(api.getState().investmentSummaries.length, 1);
console.log("finance system domain tests passed");
