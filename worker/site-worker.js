const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS shared_state (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  saved_at TEXT,
  body TEXT NOT NULL
)`;

const FINANCE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS finance_members (id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL, is_current_user INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, body TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS finance_accounts (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, owner_member_id TEXT, current_balance_cents INTEGER NOT NULL DEFAULT 0, include_in_family_assets INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, body TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS finance_accounts_owner_idx ON finance_accounts(owner_member_id)`,
  `CREATE TABLE IF NOT EXISTS finance_categories (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, direction TEXT NOT NULL, parent_id TEXT, body TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS finance_categories_parent_idx ON finance_categories(parent_id)`,
  `CREATE TABLE IF NOT EXISTS finance_transactions (id TEXT PRIMARY KEY NOT NULL, occurred_at TEXT NOT NULL, type TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), category_id TEXT, from_account_id TEXT, to_account_id TEXT, bookkeeper_member_id TEXT, payer_member_id TEXT, ownership TEXT NOT NULL, include_in_family_stats INTEGER NOT NULL DEFAULT 1, goal_id TEXT, body TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS finance_transactions_date_idx ON finance_transactions(occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS finance_transactions_accounts_idx ON finance_transactions(from_account_id, to_account_id)`,
  `CREATE INDEX IF NOT EXISTS finance_transactions_goal_idx ON finance_transactions(goal_id)`,
  `CREATE TABLE IF NOT EXISTS finance_goals (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, target_amount_cents INTEGER NOT NULL DEFAULT 0, allocated_amount_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS finance_goal_entries (id TEXT PRIMARY KEY NOT NULL, goal_id TEXT NOT NULL, type TEXT NOT NULL, amount_cents INTEGER NOT NULL, occurred_at TEXT NOT NULL, body TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS finance_goal_entries_goal_idx ON finance_goal_entries(goal_id, occurred_at DESC)`,
  `CREATE TABLE IF NOT EXISTS finance_asset_snapshots (id TEXT PRIMARY KEY NOT NULL, snapshot_date TEXT NOT NULL, scope TEXT NOT NULL, scope_id TEXT, net_asset_cents INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS finance_asset_snapshots_date_idx ON finance_asset_snapshots(snapshot_date DESC)`,
  `CREATE TABLE IF NOT EXISTS finance_meta (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`
];

const ALLOWED_ORIGINS = new Set([
  "https://linqingvv5-create.github.io",
  "https://linqing-trading-dashboard.linqingvv5.chatgpt.site"
]);

function apiHeaders(request) {
  const origin = request.headers.get("origin");
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "vary": "Origin"
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
    headers["access-control-allow-headers"] = "Content-Type";
  }
  return headers;
}

function json(data, status = 200, request) {
  return new Response(JSON.stringify(data), { status, headers: apiHeaders(request) });
}

async function ensureSchema(db) {
  await db.prepare(SCHEMA_SQL).run();
}

async function ensureFinanceSchema(db) {
  await db.batch(FINANCE_SCHEMA.map((statement) => db.prepare(statement)));
}

async function readState(db) {
  await ensureSchema(db);
  const row = await db.prepare("SELECT revision, saved_at, body FROM shared_state WHERE id = ?1").bind("board-state").first();
  if (!row) return { revision: 0, savedAt: null, state: null };
  let state = null;
  try { state = JSON.parse(String(row.body || "null")); } catch (_) { state = null; }
  return { revision: Number(row.revision) || 0, savedAt: row.saved_at || null, state };
}

async function writeState(request, db) {
  const payload = await request.json();
  if (!payload || !payload.state || typeof payload.state !== "object" || Array.isArray(payload.state)) {
    return json({ error: "state must be an object" }, 400, request);
  }
  await ensureSchema(db);
  const previous = await db.prepare("SELECT revision FROM shared_state WHERE id = ?1").bind("board-state").first();
  const revision = (Number(previous?.revision) || 0) + 1;
  const savedAt = new Date().toISOString();
  await db.prepare(`INSERT INTO shared_state (id, revision, saved_at, body)
    VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, saved_at = excluded.saved_at, body = excluded.body`)
    .bind("board-state", revision, savedAt, JSON.stringify(payload.state)).run();
  return json({ revision, savedAt, state: payload.state }, 200, request);
}

function parseBodies(result) {
  return (result?.results || []).map((row) => {
    try { return JSON.parse(String(row.body || "{}")); } catch (_) { return {}; }
  });
}

async function readFinanceState(db) {
  await ensureFinanceSchema(db);
  const [members, accounts, categories, transactions, goals, goalEntries, snapshots, updated] = await db.batch([
    db.prepare("SELECT body FROM finance_members ORDER BY is_current_user DESC, display_name"),
    db.prepare("SELECT body FROM finance_accounts ORDER BY name"),
    db.prepare("SELECT body FROM finance_categories ORDER BY direction, name"),
    db.prepare("SELECT body FROM finance_transactions ORDER BY occurred_at DESC"),
    db.prepare("SELECT body FROM finance_goals ORDER BY kind, name"),
    db.prepare("SELECT body FROM finance_goal_entries ORDER BY occurred_at DESC"),
    db.prepare("SELECT body FROM finance_asset_snapshots ORDER BY snapshot_date DESC"),
    db.prepare("SELECT value FROM finance_meta WHERE id = 'updated-at'")
  ]);
  return { state: { version: 1, updatedAt: updated?.results?.[0]?.value || null, members: parseBodies(members), accounts: parseBodies(accounts), categories: parseBodies(categories), transactions: parseBodies(transactions), goals: parseBodies(goals), goalEntries: parseBodies(goalEntries), assetSnapshots: parseBodies(snapshots) } };
}

function requireArray(state, key) {
  if (!Array.isArray(state[key])) throw new Error(`${key} must be an array`);
  return state[key];
}

function safeText(value, fallback = "") {
  return String(value == null ? fallback : value);
}

async function writeFinanceState(request, db) {
  const payload = await request.json();
  const state = payload?.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return json({ error: "state must be an object" }, 400, request);
  const members = requireArray(state, "members");
  const accounts = requireArray(state, "accounts");
  const categories = requireArray(state, "categories");
  const transactions = requireArray(state, "transactions");
  const goals = requireArray(state, "goals");
  const goalEntries = Array.isArray(state.goalEntries) ? state.goalEntries : [];
  const snapshots = Array.isArray(state.assetSnapshots) ? state.assetSnapshots : [];
  await ensureFinanceSchema(db);
  const statements = [
    db.prepare("DELETE FROM finance_members"), db.prepare("DELETE FROM finance_accounts"),
    db.prepare("DELETE FROM finance_categories"), db.prepare("DELETE FROM finance_transactions"),
    db.prepare("DELETE FROM finance_goals"), db.prepare("DELETE FROM finance_goal_entries"),
    db.prepare("DELETE FROM finance_asset_snapshots")
  ];
  members.forEach((item) => statements.push(db.prepare("INSERT INTO finance_members (id, display_name, role, is_current_user, is_active, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(safeText(item.id), safeText(item.displayName), safeText(item.role), item.isCurrentUser ? 1 : 0, item.isActive === false ? 0 : 1, JSON.stringify(item))));
  accounts.forEach((item) => statements.push(db.prepare("INSERT INTO finance_accounts (id, name, type, owner_member_id, current_balance_cents, include_in_family_assets, updated_at, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)").bind(safeText(item.id), safeText(item.name), safeText(item.type), safeText(item.ownerMemberId), Math.trunc(Number(item.currentBalanceCents) || 0), item.includeInFamilyAssets ? 1 : 0, safeText(item.updatedAt, new Date().toISOString()), JSON.stringify(item))));
  categories.forEach((item) => statements.push(db.prepare("INSERT INTO finance_categories (id, name, direction, parent_id, body) VALUES (?1, ?2, ?3, ?4, ?5)").bind(safeText(item.id), safeText(item.name), safeText(item.direction), safeText(item.parentId), JSON.stringify(item))));
  transactions.forEach((item) => {
    const amount = Math.trunc(Number(item.amountCents) || 0);
    if (amount <= 0) throw new Error(`Invalid transaction amount: ${safeText(item.id)}`);
    statements.push(db.prepare("INSERT INTO finance_transactions (id, occurred_at, type, amount_cents, category_id, from_account_id, to_account_id, bookkeeper_member_id, payer_member_id, ownership, include_in_family_stats, goal_id, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)").bind(safeText(item.id), safeText(item.occurredAt), safeText(item.type), amount, safeText(item.categoryId), safeText(item.fromAccountId), safeText(item.toAccountId), safeText(item.bookkeeperMemberId), safeText(item.payerMemberId), safeText(item.ownership, "FAMILY"), item.includeInFamilyStats ? 1 : 0, safeText(item.goalId), JSON.stringify(item)));
  });
  goals.forEach((item) => statements.push(db.prepare("INSERT INTO finance_goals (id, kind, name, target_amount_cents, allocated_amount_cents, status, updated_at, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)").bind(safeText(item.id), safeText(item.kind), safeText(item.name), Math.trunc(Number(item.targetAmountCents) || 0), Math.trunc(Number(item.allocatedAmountCents) || 0), safeText(item.status), safeText(item.updatedAt, new Date().toISOString()), JSON.stringify(item))));
  goalEntries.forEach((item) => statements.push(db.prepare("INSERT INTO finance_goal_entries (id, goal_id, type, amount_cents, occurred_at, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(safeText(item.id), safeText(item.goalId), safeText(item.type), Math.trunc(Number(item.amountCents) || 0), safeText(item.occurredAt), JSON.stringify(item))));
  snapshots.forEach((item) => statements.push(db.prepare("INSERT INTO finance_asset_snapshots (id, snapshot_date, scope, scope_id, net_asset_cents, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(safeText(item.id), safeText(item.snapshotDate), safeText(item.scope), safeText(item.scopeId), Math.trunc(Number(item.netAssetCents) || 0), JSON.stringify(item))));
  const updatedAt = new Date().toISOString();
  statements.push(db.prepare("INSERT INTO finance_meta (id, value) VALUES ('updated-at', ?1) ON CONFLICT(id) DO UPDATE SET value = excluded.value").bind(updatedAt));
  await db.batch(statements);
  return json({ state: { ...state, updatedAt } }, 200, request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/finance/state") {
      try {
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: apiHeaders(request) });
        if (request.method === "GET") return json(await readFinanceState(env.DB), 200, request);
        if (request.method === "POST") return await writeFinanceState(request, env.DB);
        return new Response("Method Not Allowed", { status: 405, headers: { ...apiHeaders(request), allow: "GET, POST, OPTIONS" } });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "资金数据服务异常" }, 500, request);
      }
    }
    if (url.pathname === "/api/state") {
      try {
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: apiHeaders(request) });
        if (request.method === "GET") return json(await readState(env.DB), 200, request);
        if (request.method === "POST") return await writeState(request, env.DB);
        return new Response("Method Not Allowed", { status: 405, headers: { ...apiHeaders(request), allow: "GET, POST, OPTIONS" } });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "同步服务异常" }, 500, request);
      }
    }
    if (url.pathname === "/api/health") return json({ ok: true }, 200, request);
    const assetUrl = new URL(request.url);
    if (assetUrl.pathname === "/") assetUrl.pathname = "/finance.html";
    return env.ASSETS.fetch(new Request(assetUrl, request));
  }
};
