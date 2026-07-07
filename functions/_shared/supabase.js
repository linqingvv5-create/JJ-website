const DEFAULT_TABLE = "app_documents";
const JSON_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

function getSupabaseConfig(env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const secretKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const table = String(env.SUPABASE_TABLE || DEFAULT_TABLE).trim() || DEFAULT_TABLE;

  if (!url) {
    throw new Error("Missing SUPABASE_URL binding.");
  }
  if (!secretKey) {
    throw new Error("Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY binding.");
  }

  return {
    restUrl: `${url}/rest/v1`,
    secretKey,
    table,
  };
}

async function requestSupabase(env, path, options = {}) {
  const config = getSupabaseConfig(env);
  const response = await fetch(`${config.restUrl}/${path}`, {
    method: options.method || "GET",
    headers: {
      ...JSON_HEADERS,
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = {
        message: text,
      };
    }
  }

  if (!response.ok) {
    const errorMessage = payload?.message || payload?.error || payload?.hint || `Supabase request failed with ${response.status}`;
    const error = new Error(errorMessage);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function getDocument(env, id) {
  const { table } = getSupabaseConfig(env);
  const encodedId = encodeURIComponent(id);
  const rows = await requestSupabase(env, `${table}?id=eq.${encodedId}&select=id,revision,saved_at,body`);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function upsertDocument(env, document) {
  const { table } = getSupabaseConfig(env);
  const payload = await requestSupabase(env, `${table}?on_conflict=id`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: document,
  });

  if (Array.isArray(payload)) {
    return payload[0] || null;
  }

  return payload;
}

function readSyncToken(request) {
  return String(request.headers.get("x-app-sync-token") || "").trim();
}

function assertSyncToken(request, env) {
  const expectedToken = String(env.APP_SYNC_TOKEN || "").trim();
  if (!expectedToken) {
    return;
  }

  if (readSyncToken(request) === expectedToken) {
    return;
  }

  const error = new Error("Unauthorized");
  error.status = 401;
  throw error;
}

async function readJsonBody(request) {
  const payload = await request.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Request body must be a JSON object.");
  }

  return payload;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function errorResponse(error) {
  const status = Number(error?.status) || 500;
  const message = error instanceof Error ? error.message : "Unknown error";

  return jsonResponse(
    {
      error: message,
    },
    status,
  );
}

export {
  assertSyncToken,
  errorResponse,
  getDocument,
  jsonResponse,
  readJsonBody,
  upsertDocument,
};
