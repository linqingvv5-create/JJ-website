const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS shared_state (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  saved_at TEXT,
  body TEXT NOT NULL
)`;

const FINANCE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS finance_member_locks (member_id TEXT PRIMARY KEY NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS finance_members (id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL, is_current_user INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, body TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS finance_accounts (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, owner_member_id TEXT, current_balance_cents INTEGER NOT NULL DEFAULT 0, include_in_family_assets INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, body TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS finance_accounts_owner_idx ON finance_accounts(owner_member_id)`,
  `CREATE TABLE IF NOT EXISTS finance_categories (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, direction TEXT NOT NULL, parent_id TEXT, body TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS finance_categories_parent_idx ON finance_categories(parent_id)`,
  `CREATE TABLE IF NOT EXISTS finance_transactions (id TEXT PRIMARY KEY NOT NULL, occurred_at TEXT NOT NULL, type TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), category_id TEXT, from_account_id TEXT, to_account_id TEXT, bookkeeper_member_id TEXT, payer_member_id TEXT, ownership TEXT NOT NULL, include_in_family_stats INTEGER NOT NULL DEFAULT 1, goal_id TEXT, body TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS finance_transactions_date_idx ON finance_transactions(occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS finance_transactions_accounts_idx ON finance_transactions(from_account_id, to_account_id)`,
  `CREATE INDEX IF NOT EXISTS finance_transactions_goal_idx ON finance_transactions(goal_id)`,
  `CREATE TABLE IF NOT EXISTS finance_dream_animals (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, owner_member_id TEXT, body TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS finance_goals (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, target_amount_cents INTEGER NOT NULL DEFAULT 0, allocated_amount_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS finance_goal_entries (id TEXT PRIMARY KEY NOT NULL, goal_id TEXT NOT NULL, type TEXT NOT NULL, amount_cents INTEGER NOT NULL, occurred_at TEXT NOT NULL, body TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS finance_goal_entries_goal_idx ON finance_goal_entries(goal_id, occurred_at DESC)`,
  `CREATE TABLE IF NOT EXISTS finance_asset_snapshots (id TEXT PRIMARY KEY NOT NULL, snapshot_date TEXT NOT NULL, scope TEXT NOT NULL, scope_id TEXT, net_asset_cents INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS finance_asset_snapshots_date_idx ON finance_asset_snapshots(snapshot_date DESC)`,
  `CREATE TABLE IF NOT EXISTS finance_investment_summaries (id TEXT PRIMARY KEY NOT NULL, investment_account_id TEXT NOT NULL, name TEXT NOT NULL, total_asset_cents INTEGER NOT NULL DEFAULT 0, profit_loss_cents INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, body TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS finance_meta (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS finance_extensions (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL)`
];

const ALLOWED_ORIGINS = new Set([
  "https://linqingvv5-create.github.io",
  "https://linqing-trading-dashboard.linqingvv5.chatgpt.site"
]);

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

const CANONICAL_FINANCE_LABELS = {
  members: {
    "member-me": { displayName: "白白", role: "本人" }
  },
  accounts: {
    "account-bank": "银行卡", "account-wechat": "微信", "account-alipay": "支付宝",
    "account-cash": "现金", "account-family": "家庭公共账户", "account-credit": "信用卡"
  },
  categories: {
    "income-salary": "工资", "income-bonus": "奖金", "income-parents": "父母给予", "income-windfall": "意外之财",
    "income-book": "写书收入", "income-up": "UP主收入", "income-dividend": "投资分红", "income-interest": "利息",
    "income-refund": "退款", "income-other": "其他收入", "expense-required": "生活必须支出", "expense-food": "餐饮",
    "expense-home": "居住", "expense-utilities": "水电燃气", "expense-phone": "通讯", "expense-commute": "通勤",
    "expense-medical": "医疗", "expense-insurance": "基础保险", "expense-daily": "日用品", "expense-pet": "宠物基础支出",
    "expense-optional": "生活非必须支出", "expense-dining": "外食", "expense-fun": "娱乐", "expense-clothes": "服装",
    "expense-skincare": "护肤", "expense-makeup": "化妆", "expense-digital": "数码", "expense-hobby": "兴趣",
    "expense-social": "社交", "expense-travel": "旅行", "expense-shopping": "非必要购物", "expense-dream": "梦想计划支出",
    "expense-invest": "投资相关费用", "expense-other": "其他支出"
  },
  animals: { "animal-big-goose": "大鹅", "animal-small-goose": "小鹅", "animal-house-duck": "买房鸭", "animal-travel-chicken": "旅游鸡" },
  goals: { "goal-big-goose": "大鹅", "goal-small-goose": "小鹅", "goal-house-duck": "买房鸭", "goal-travel-chicken": "旅游鸡" },
  investments: { "investment-self": "个人基金", "investment-family": "私募基金" }
};
const REMOVED_MEMBER_IDS = new Set(["member-partner"]);

function corruptedLabel(value) {
  return !String(value || "").trim() || String(value).includes("?");
}

function canonicalizeFinanceState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return state;
  const repairName = (items, labels) => (Array.isArray(items) ? items : []).map((item) => {
    const label = labels[item?.id];
    return label && corruptedLabel(item?.name) ? { ...item, name: label } : item;
  });
  return {
    ...state,
    members: (Array.isArray(state.members) ? state.members : []).filter((item) => !REMOVED_MEMBER_IDS.has(item?.id)).map((item) => {
      const label = CANONICAL_FINANCE_LABELS.members[item?.id];
      if (!label) return item;
      return {
        ...item,
        displayName: corruptedLabel(item.displayName) ? label.displayName : item.displayName,
        role: corruptedLabel(item.role) ? label.role : item.role
      };
    }),
    accounts: repairName(state.accounts, CANONICAL_FINANCE_LABELS.accounts),
    categories: repairName(state.categories, CANONICAL_FINANCE_LABELS.categories),
    dreamAnimals: repairName(state.dreamAnimals, CANONICAL_FINANCE_LABELS.animals),
    goals: repairName(state.goals, CANONICAL_FINANCE_LABELS.goals),
    investmentSummaries: repairName(state.investmentSummaries, CANONICAL_FINANCE_LABELS.investments)
  };
}

function bytesEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function passwordMatches(actual, expected) {
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);
  return bytesEqual(new Uint8Array(actualHash), new Uint8Array(expectedHash));
}

async function createSessionToken(secret, claims = {}) {
  const payload = base64Url(encoder.encode(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })));
  return `${payload}.${base64Url(await hmac(secret, payload))}`;
}

async function sessionClaims(token, secret) {
  try {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return null;
    const expected = await hmac(secret, payload);
    if (!bytesEqual(decodeBase64Url(signature), expected)) return null;
    const body = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    return Number(body.exp) > Math.floor(Date.now() / 1000) ? body : null;
  } catch (_) {
    return null;
  }
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

async function siteSession(request, env) {
  const password = String(env.APP_PASSWORD || "");
  const claims = password ? await sessionClaims(bearerToken(request), password) : null;
  return claims?.type === "site" ? claims : null;
}

async function requireSession(request, env) {
  return Boolean(await siteSession(request, env));
}

async function memberSession(request, env) {
  const password = String(env.APP_PASSWORD || "");
  const token = request.headers.get("x-member-authorization") || "";
  const claims = password ? await sessionClaims(token.startsWith("Bearer ") ? token.slice(7).trim() : "", password) : null;
  if (claims?.type === "member" && claims.memberId) return String(claims.memberId);
  const site = await siteSession(request, env);
  return site?.memberId ? String(site.memberId) : null;
}

async function sessionResponse(request, env) {
  const secret = String(env.APP_PASSWORD || "");
  if (!secret) return json({ error: "网站密码尚未设置" }, 503, request);
  if (request.method === "GET") {
    const claims = await siteSession(request, env);
    return claims?.memberId ? json({ ok: true, memberId: String(claims.memberId) }, 200, request) : json({ error: "Unauthorized" }, 401, request);
  }
  if (request.method === "POST") {
    const payload = await request.json().catch(() => ({}));
    const loginPassword = String(payload.password || "");
    await ensureFinanceSchema(env.DB);
    const locks = await env.DB.prepare("SELECT member_id, password_hash, salt FROM finance_member_locks ORDER BY member_id").all();
    for (const row of locks?.results || []) {
      if (await memberPasswordMatches(loginPassword, row)) return memberLoginResponse(request, secret, String(row.member_id));
    }
    const members = await env.DB.prepare("SELECT id FROM finance_members ORDER BY is_current_user DESC, rowid ASC").all();
    const primaryMemberId = (members?.results || []).map((row) => String(row.id)).find((id) => id === "member-me") || String(members?.results?.[0]?.id || "");
    const primaryHasPassword = (locks?.results || []).some((row) => String(row.member_id) === primaryMemberId);
    if (primaryMemberId && !primaryHasPassword && await passwordMatches(loginPassword, secret)) {
      await saveMemberPassword(env.DB, primaryMemberId, loginPassword);
      return memberLoginResponse(request, secret, primaryMemberId);
    }
    return json({ error: "Unauthorized" }, 401, request);
  }
  return new Response("Method Not Allowed", { status: 405, headers: { ...apiHeaders(request), allow: "GET, POST, OPTIONS" } });
}

async function memberLoginResponse(request, secret, memberId) {
  return json({
    ok: true,
    memberId,
    token: await createSessionToken(secret, { type: "site", memberId }),
    memberToken: await createSessionToken(secret, { type: "member", memberId })
  }, 200, request);
}

async function deriveMemberPassword(password, salt) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, material, 256);
  return new Uint8Array(bits);
}

async function memberPasswordMatches(password, row) {
  if (!row) return false;
  return bytesEqual(await deriveMemberPassword(password, decodeBase64Url(String(row.salt))), decodeBase64Url(String(row.password_hash)));
}

async function saveMemberPassword(db, memberId, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveMemberPassword(password, salt);
  await db.prepare(`INSERT INTO finance_member_locks (member_id, password_hash, salt, updated_at)
    VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(member_id) DO UPDATE SET password_hash = excluded.password_hash, salt = excluded.salt, updated_at = excluded.updated_at`)
    .bind(memberId, base64Url(hash), base64Url(salt), new Date().toISOString()).run();
}

async function memberLocksResponse(request, env, url) {
  if (!await requireSession(request, env)) return json({ error: "Unauthorized" }, 401, request);
  await ensureFinanceSchema(env.DB);
  if (url.pathname === "/api/member-locks" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT member_id FROM finance_member_locks ORDER BY member_id").all();
    return json({ configuredMemberIds: (result?.results || []).map((row) => String(row.member_id)) }, 200, request);
  }

  const match = url.pathname.match(/^\/api\/member-locks\/([^/]+)\/(unlock|password)$/);
  if (!match) return json({ error: "Not Found" }, 404, request);
  const memberId = decodeURIComponent(match[1]);
  const action = match[2];
  const row = await env.DB.prepare("SELECT password_hash, salt FROM finance_member_locks WHERE member_id = ?1").bind(memberId).first();
  const payload = await request.json().catch(() => ({}));

  if (action === "unlock" && request.method === "POST") {
    if (!row) return json({ error: "Password not configured", needsSetup: true }, 409, request);
    if (!await memberPasswordMatches(String(payload.password || ""), row)) return json({ error: "Unauthorized" }, 401, request);
    const secret = String(env.APP_PASSWORD || "");
    return json({ ok: true, token: await createSessionToken(secret, { type: "member", memberId }) }, 200, request);
  }

  if (action === "password" && request.method === "PUT") {
    const nextPassword = String(payload.newPassword || "");
    if (nextPassword.length < 4 || nextPassword.length > 128) return json({ error: "个人密码至少需要 4 位" }, 400, request);
    if (row && !await memberPasswordMatches(String(payload.currentPassword || ""), row)) return json({ error: "Current password is incorrect" }, 401, request);
    const otherLocks = await env.DB.prepare("SELECT member_id, password_hash, salt FROM finance_member_locks WHERE member_id <> ?1").bind(memberId).all();
    for (const other of otherLocks?.results || []) {
      if (await memberPasswordMatches(nextPassword, other)) return json({ error: "这个密码已被其他家庭成员使用，请换一个密码" }, 409, request);
    }
    await saveMemberPassword(env.DB, memberId, nextPassword);
    const secret = String(env.APP_PASSWORD || "");
    return json({ ok: true, token: await createSessionToken(secret, { type: "member", memberId }) }, 200, request);
  }

  if (action === "password" && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM finance_member_locks WHERE member_id = ?1").bind(memberId).run();
    return json({ ok: true }, 200, request);
  }

  return new Response("Method Not Allowed", { status: 405, headers: { ...apiHeaders(request), allow: action === "unlock" ? "POST, OPTIONS" : "PUT, DELETE, OPTIONS" } });
}

function apiHeaders(request) {
  const origin = request.headers.get("origin");
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "vary": "Origin"
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    headers["access-control-allow-headers"] = "Content-Type, Authorization, X-Member-Authorization";
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

function privateOwner(item) {
  return safeText(item.ownerMemberId || item.payerMemberId || item.bookkeeperMemberId);
}

function visibleToMember(item, memberId) {
  return item.isShared === true || (memberId && privateOwner(item) === memberId);
}

async function readFinanceState(db, memberId = null, includeAll = false) {
  await ensureFinanceSchema(db);
  const [members, accounts, categories, transactions, animals, goals, goalEntries, snapshots, investments, updated, extensions] = await db.batch([
    db.prepare("SELECT body FROM finance_members ORDER BY is_current_user DESC, display_name"),
    db.prepare("SELECT body FROM finance_accounts ORDER BY name"),
    db.prepare("SELECT body FROM finance_categories ORDER BY direction, name"),
    db.prepare("SELECT body FROM finance_transactions ORDER BY occurred_at DESC"),
    db.prepare("SELECT body FROM finance_dream_animals ORDER BY kind, name"),
    db.prepare("SELECT body FROM finance_goals ORDER BY kind, name"),
    db.prepare("SELECT body FROM finance_goal_entries ORDER BY occurred_at DESC"),
    db.prepare("SELECT body FROM finance_asset_snapshots ORDER BY snapshot_date DESC"),
    db.prepare("SELECT body FROM finance_investment_summaries ORDER BY name"),
    db.prepare("SELECT value FROM finance_meta WHERE id = 'updated-at'"),
    db.prepare("SELECT body FROM finance_extensions WHERE id = 'funds-v2'")
  ]);
  const accountBodies = parseBodies(accounts);
  const transactionBodies = parseBodies(transactions);
  const extension = parseBodies(extensions)[0] || {};
  return { activeMemberId: includeAll ? null : memberId, state: canonicalizeFinanceState({ version: 2, updatedAt: updated?.results?.[0]?.value || null, members: parseBodies(members), accounts: includeAll ? accountBodies : accountBodies.filter((item) => visibleToMember(item, memberId)), categories: parseBodies(categories), transactions: includeAll ? transactionBodies : transactionBodies.filter((item) => visibleToMember(item, memberId)), dreamAnimals: parseBodies(animals), goals: parseBodies(goals), goalEntries: parseBodies(goalEntries), assetSnapshots: parseBodies(snapshots), investmentSummaries: parseBodies(investments), dreamFunds: Array.isArray(extension.dreamFunds) ? extension.dreamFunds : [], tags: Array.isArray(extension.tags) ? extension.tags : [], allocationRules: Array.isArray(extension.allocationRules) ? extension.allocationRules : [], incomeAllocationRules: Array.isArray(extension.incomeAllocationRules) ? extension.incomeAllocationRules : [] }) };
}

function requireArray(state, key) {
  if (!Array.isArray(state[key])) throw new Error(`${key} must be an array`);
  return state[key];
}

function safeText(value, fallback = "") {
  return String(value == null ? fallback : value);
}

async function writeFinanceState(request, db, memberId = null) {
  const payload = await request.json();
  const state = canonicalizeFinanceState(payload?.state);
  if (!state || typeof state !== "object" || Array.isArray(state)) return json({ error: "state must be an object" }, 400, request);
  const members = requireArray(state, "members");
  let accounts = requireArray(state, "accounts");
  const categories = requireArray(state, "categories");
  let transactions = requireArray(state, "transactions");
  const animals = requireArray(state, "dreamAnimals");
  const goals = requireArray(state, "goals");
  const goalEntries = Array.isArray(state.goalEntries) ? state.goalEntries : [];
  const snapshots = Array.isArray(state.assetSnapshots) ? state.assetSnapshots : [];
  const investments = Array.isArray(state.investmentSummaries) ? state.investmentSummaries : [];
  const extensions = { dreamFunds: Array.isArray(state.dreamFunds) ? state.dreamFunds : [], tags: Array.isArray(state.tags) ? state.tags : [], allocationRules: Array.isArray(state.allocationRules) ? state.allocationRules : [], incomeAllocationRules: Array.isArray(state.incomeAllocationRules) ? state.incomeAllocationRules : [] };
  await ensureFinanceSchema(db);
  const existing = (await readFinanceState(db, null, true)).state;
  const keepPrivateAccount = (item) => item.isShared !== true && (!memberId || privateOwner(item) !== memberId);
  const keepPrivateTransaction = (item) => item.isShared !== true && (!memberId || privateOwner(item) !== memberId);
  const allowedIncoming = (item) => item.isShared === true || Boolean(memberId && privateOwner(item) === memberId);
  accounts = [...existing.accounts.filter(keepPrivateAccount), ...accounts.filter(allowedIncoming)];
  transactions = [...existing.transactions.filter(keepPrivateTransaction), ...transactions.filter(allowedIncoming)];
  const statements = [
    db.prepare("DELETE FROM finance_members"), db.prepare("DELETE FROM finance_accounts"),
    db.prepare("DELETE FROM finance_categories"), db.prepare("DELETE FROM finance_transactions"),
    db.prepare("DELETE FROM finance_dream_animals"), db.prepare("DELETE FROM finance_goals"), db.prepare("DELETE FROM finance_goal_entries"),
    db.prepare("DELETE FROM finance_asset_snapshots"), db.prepare("DELETE FROM finance_investment_summaries")
  ];
  members.forEach((item) => statements.push(db.prepare("INSERT INTO finance_members (id, display_name, role, is_current_user, is_active, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(safeText(item.id), safeText(item.displayName), safeText(item.role), item.isCurrentUser ? 1 : 0, item.isActive === false ? 0 : 1, JSON.stringify(item))));
  accounts.forEach((item) => statements.push(db.prepare("INSERT INTO finance_accounts (id, name, type, owner_member_id, current_balance_cents, include_in_family_assets, updated_at, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)").bind(safeText(item.id), safeText(item.name), safeText(item.type), safeText(item.ownerMemberId), Math.trunc(Number(item.currentBalanceCents) || 0), item.includeInFamilyAssets ? 1 : 0, safeText(item.updatedAt, new Date().toISOString()), JSON.stringify(item))));
  categories.forEach((item) => statements.push(db.prepare("INSERT INTO finance_categories (id, name, direction, parent_id, body) VALUES (?1, ?2, ?3, ?4, ?5)").bind(safeText(item.id), safeText(item.name), safeText(item.direction), safeText(item.parentId), JSON.stringify(item))));
  transactions.forEach((item) => {
    const amount = Math.trunc(Number(item.amountCents) || 0);
    if (amount <= 0) throw new Error(`Invalid transaction amount: ${safeText(item.id)}`);
    const type = safeText(item.type);
    if (!["INCOME", "EXPENSE", "TRANSFER", "REFUND", "REIMBURSEMENT", "BALANCE_ADJUSTMENT"].includes(type)) throw new Error(`Invalid finance transaction type: ${type}`);
    if (type === "TRANSFER" && (!safeText(item.fromAccountId) || !safeText(item.toAccountId) || safeText(item.fromAccountId) === safeText(item.toAccountId))) throw new Error("Transfers require two different accounts");
    if (type === "TRANSFER" && item.includeInFamilyStats) throw new Error("Transfers cannot be included in income or expense statistics");
    if (type === "EXPENSE" && !safeText(item.fromAccountId)) throw new Error("Expenses require a payment account");
    if (["INCOME", "REFUND", "REIMBURSEMENT"].includes(type) && !safeText(item.toAccountId)) throw new Error(`${type} requires a receiving account`);
    if (type === "BALANCE_ADJUSTMENT" && item.includeInFamilyStats) throw new Error("Balance adjustments cannot be included in income or expense statistics");
    statements.push(db.prepare("INSERT INTO finance_transactions (id, occurred_at, type, amount_cents, category_id, from_account_id, to_account_id, bookkeeper_member_id, payer_member_id, ownership, include_in_family_stats, goal_id, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)").bind(safeText(item.id), safeText(item.occurredAt), safeText(item.type), amount, safeText(item.categoryId), safeText(item.fromAccountId), safeText(item.toAccountId), safeText(item.bookkeeperMemberId), safeText(item.payerMemberId), safeText(item.ownership, "FAMILY"), item.includeInFamilyStats ? 1 : 0, safeText(item.goalId), JSON.stringify(item)));
  });
  animals.forEach((item) => statements.push(db.prepare("INSERT INTO finance_dream_animals (id, kind, name, owner_member_id, body) VALUES (?1, ?2, ?3, ?4, ?5)").bind(safeText(item.id), safeText(item.kind), safeText(item.name), safeText(item.ownerMemberId), JSON.stringify(item))));
  goals.forEach((item) => statements.push(db.prepare("INSERT INTO finance_goals (id, kind, name, target_amount_cents, allocated_amount_cents, status, updated_at, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)").bind(safeText(item.id), safeText(item.kind), safeText(item.name), Math.trunc(Number(item.targetAmountCents) || 0), Math.trunc(Number(item.allocatedAmountCents) || 0), safeText(item.status), safeText(item.updatedAt, new Date().toISOString()), JSON.stringify(item))));
  goalEntries.forEach((item) => statements.push(db.prepare("INSERT INTO finance_goal_entries (id, goal_id, type, amount_cents, occurred_at, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(safeText(item.id), safeText(item.goalId), safeText(item.type), Math.trunc(Number(item.amountCents) || 0), safeText(item.occurredAt), JSON.stringify(item))));
  snapshots.forEach((item) => statements.push(db.prepare("INSERT INTO finance_asset_snapshots (id, snapshot_date, scope, scope_id, net_asset_cents, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(safeText(item.id), safeText(item.snapshotDate), safeText(item.scope), safeText(item.scopeId), Math.trunc(Number(item.netAssetCents) || 0), JSON.stringify(item))));
  investments.forEach((item) => statements.push(db.prepare("INSERT INTO finance_investment_summaries (id, investment_account_id, name, total_asset_cents, profit_loss_cents, updated_at, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(safeText(item.id), safeText(item.investmentAccountId), safeText(item.name), Math.trunc(Number(item.totalAssetCents) || 0), Math.trunc(Number(item.profitLossCents) || 0), safeText(item.updatedAt, new Date().toISOString()), JSON.stringify(item))));
  const updatedAt = new Date().toISOString();
  statements.push(db.prepare("INSERT INTO finance_meta (id, value) VALUES ('updated-at', ?1) ON CONFLICT(id) DO UPDATE SET value = excluded.value").bind(updatedAt));
  statements.push(db.prepare("INSERT INTO finance_extensions (id, body, updated_at) VALUES ('funds-v2', ?1, ?2) ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at").bind(JSON.stringify(extensions), updatedAt));
  await db.batch(statements);
  return json(await readFinanceState(db, memberId), 200, request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/session") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: apiHeaders(request) });
      return sessionResponse(request, env);
    }
    if (url.pathname === "/api/member-locks" || url.pathname.startsWith("/api/member-locks/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: apiHeaders(request) });
      try { return await memberLocksResponse(request, env, url); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "个人密码服务异常" }, 500, request); }
    }
    if (url.pathname === "/api/finance/state") {
      try {
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: apiHeaders(request) });
        if (!await requireSession(request, env)) return json({ error: "Unauthorized" }, 401, request);
        const memberId = await memberSession(request, env);
        if (request.method === "GET") return json(await readFinanceState(env.DB, memberId), 200, request);
        if (request.method === "POST") return await writeFinanceState(request, env.DB, memberId);
        return new Response("Method Not Allowed", { status: 405, headers: { ...apiHeaders(request), allow: "GET, POST, OPTIONS" } });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "资金数据服务异常" }, 500, request);
      }
    }
    if (url.pathname === "/api/state") {
      try {
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: apiHeaders(request) });
        if (!await requireSession(request, env)) return json({ error: "Unauthorized" }, 401, request);
        if (request.method === "GET") return json(await readState(env.DB), 200, request);
        if (request.method === "POST") return await writeState(request, env.DB);
        return new Response("Method Not Allowed", { status: 405, headers: { ...apiHeaders(request), allow: "GET, POST, OPTIONS" } });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "同步服务异常" }, 500, request);
      }
    }
    if (url.pathname === "/api/health") return json({ ok: true }, 200, request);
    if (!env.ASSETS) return json({ error: "Not Found" }, 404, request);
    const assetUrl = new URL(request.url);
    if (assetUrl.pathname === "/") assetUrl.pathname = "/finance.html";
    return env.ASSETS.fetch(new Request(assetUrl, request));
  }
};
