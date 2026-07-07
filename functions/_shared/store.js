const APP_NAME = "linqing-minimal-trade-board";
const MODULE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function nowText() {
  const current = new Date();
  const pad = (value) => String(value).padStart(2, "0");

  return [
    current.getFullYear(),
    pad(current.getMonth() + 1),
    pad(current.getDate()),
  ].join("-") + ` ${pad(current.getHours())}:${pad(current.getMinutes())}:${pad(current.getSeconds())}`;
}

function defaultStore() {
  return {
    app: APP_NAME,
    revision: 0,
    savedAt: null,
    state: null,
    modules: {},
  };
}

function defaultModuleStore() {
  return {
    revision: 0,
    savedAt: null,
    state: {},
  };
}

function sanitizeModuleStore(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const parsedRevision = Number(data.revision);
  const revision = Number.isFinite(parsedRevision) ? Math.max(0, Math.trunc(parsedRevision)) : 0;
  const savedAt = data.savedAt ? String(data.savedAt) : null;
  const state = data.state && typeof data.state === "object" && !Array.isArray(data.state) ? data.state : {};

  return {
    revision,
    savedAt,
    state,
  };
}

function sanitizeModules(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const modules = {};
  for (const [rawModuleId, rawModule] of Object.entries(raw)) {
    const moduleId = String(rawModuleId || "").trim();
    if (MODULE_ID_PATTERN.test(moduleId)) {
      modules[moduleId] = sanitizeModuleStore(rawModule);
    }
  }

  return modules;
}

function sanitizeStore(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const parsedRevision = Number(data.revision);
  const revision = Number.isFinite(parsedRevision) ? Math.max(0, Math.trunc(parsedRevision)) : 0;
  const savedAt = data.savedAt ? String(data.savedAt) : null;
  const state = data.state && typeof data.state === "object" && !Array.isArray(data.state) ? data.state : null;

  return {
    app: String(data.app || APP_NAME),
    revision,
    savedAt,
    state,
    modules: sanitizeModules(data.modules),
  };
}

function baseState() {
  return {
    bankCash: null,
    accounts: [],
    holdings: [],
    plans: [],
  };
}

function ensureState(store, fallbackState = null) {
  if (store.state && typeof store.state === "object" && !Array.isArray(store.state)) {
    return store.state;
  }

  if (fallbackState && typeof fallbackState === "object" && !Array.isArray(fallbackState)) {
    store.state = fallbackState;
    return store.state;
  }

  store.state = baseState();
  return store.state;
}

function upsertItem(items, nextItem) {
  const nextId = String(nextItem?.id || "").trim();
  const index = items.findIndex((item) => String(item?.id || "").trim() === nextId);

  if (index >= 0) {
    items[index] = nextItem;
    return;
  }

  items.push(nextItem);
}

function findItem(items, itemId) {
  const targetId = String(itemId || "").trim();
  return items.find((item) => String(item?.id || "").trim() === targetId) || null;
}

function applyAction(store, envelope) {
  const action = envelope?.action;
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new Error("Missing action payload.");
  }

  const actionType = String(action.type || "").trim();
  const fallbackState = envelope?.fallbackState;

  if (actionType === "replaceState") {
    const nextState = action.state;
    if (!nextState || typeof nextState !== "object" || Array.isArray(nextState)) {
      throw new Error("replaceState requires a state object.");
    }

    store.state = nextState;
  } else {
    const state = ensureState(store, fallbackState);

    if (actionType === "updateBankCash") {
      state.bankCash = action.bankCash;
    } else if (actionType === "updateAccountCash") {
      const accountId = String(action.accountId || "").trim();
      const account = findItem(state.accounts || (state.accounts = []), accountId);
      if (!account) {
        throw new Error(`Unknown account id: ${accountId}`);
      }

      account.availableCash = action.availableCash;
    } else if (actionType === "updateHoldingPrice") {
      const holdingId = String(action.holdingId || "").trim();
      const holding = findItem(state.holdings || (state.holdings = []), holdingId);
      if (!holding) {
        throw new Error(`Unknown holding id: ${holdingId}`);
      }

      holding.currentPrice = action.currentPrice;
      holding.marketValueOverride = null;
      holding.floatingPnlOverride = null;
    } else if (actionType === "upsertHoldingBundle") {
      const holding = action.holding;
      const plans = action.plans;
      if (!holding || typeof holding !== "object" || Array.isArray(holding)) {
        throw new Error("upsertHoldingBundle requires a holding object.");
      }
      if (!Array.isArray(plans)) {
        throw new Error("upsertHoldingBundle requires a plans array.");
      }

      const holdingId = String(holding.id || "").trim();
      if (!holdingId) {
        throw new Error("Holding id is required.");
      }

      upsertItem(state.holdings || (state.holdings = []), holding);
      state.plans = (state.plans || []).filter((plan) => String(plan?.holdingId || "").trim() !== holdingId).concat(plans);
    } else if (actionType === "addPlan") {
      const plan = action.plan;
      if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
        throw new Error("addPlan requires a plan object.");
      }

      const planId = String(plan.id || "").trim();
      const plans = state.plans || (state.plans = []);
      state.plans = plans.filter((currentPlan) => String(currentPlan?.id || "").trim() !== planId);
      state.plans.push(plan);
    } else {
      throw new Error(`Unsupported action type: ${actionType}`);
    }
  }

  store.app = APP_NAME;
  store.revision = Number(store.revision || 0) + 1;
  store.savedAt = nowText();
  return sanitizeStore(store);
}

function parseMainDocument(row) {
  if (!row) {
    return defaultStore();
  }

  return sanitizeStore({
    app: APP_NAME,
    revision: row.revision,
    savedAt: row.saved_at,
    state: row.body,
  });
}

function buildMainDocument(store) {
  const nextStore = sanitizeStore(store);
  return {
    id: "board-state",
    revision: nextStore.revision,
    saved_at: nextStore.savedAt,
    body: nextStore.state || baseState(),
  };
}

function requireValidModuleId(rawModuleId) {
  const moduleId = String(rawModuleId || "").trim();
  if (!MODULE_ID_PATTERN.test(moduleId)) {
    throw new Error("Invalid module id.");
  }

  return moduleId;
}

function moduleDocumentId(moduleId) {
  return `module:${moduleId}`;
}

function parseModuleDocument(row) {
  if (!row) {
    return defaultModuleStore();
  }

  return sanitizeModuleStore({
    revision: row.revision,
    savedAt: row.saved_at,
    state: row.body,
  });
}

function buildModuleDocument(moduleId, moduleStore) {
  const nextModuleStore = sanitizeModuleStore(moduleStore);
  return {
    id: moduleDocumentId(moduleId),
    revision: nextModuleStore.revision,
    saved_at: nextModuleStore.savedAt,
    body: nextModuleStore.state,
  };
}

function moduleResponsePayload(moduleId, rawModule) {
  const moduleStore = sanitizeModuleStore(rawModule);
  return {
    moduleId,
    revision: moduleStore.revision,
    savedAt: moduleStore.savedAt,
    state: moduleStore.state,
  };
}

export {
  APP_NAME,
  applyAction,
  baseState,
  buildMainDocument,
  buildModuleDocument,
  defaultModuleStore,
  defaultStore,
  ensureState,
  moduleDocumentId,
  moduleResponsePayload,
  nowText,
  parseMainDocument,
  parseModuleDocument,
  requireValidModuleId,
  sanitizeModuleStore,
  sanitizeStore,
};
