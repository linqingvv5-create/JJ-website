const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS shared_state (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  saved_at TEXT,
  body TEXT NOT NULL
)`;

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
  return new Response(JSON.stringify(data), {
    status,
    headers: apiHeaders(request)
  });
}

async function ensureSchema(db) {
  await db.prepare(SCHEMA_SQL).run();
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
