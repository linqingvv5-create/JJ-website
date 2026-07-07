import {
  buildMainDocument,
  defaultStore,
  nowText,
  parseMainDocument,
  sanitizeStore,
} from "../_shared/store.js";
import {
  assertSyncToken,
  errorResponse,
  getDocument,
  jsonResponse,
  readJsonBody,
  upsertDocument,
} from "../_shared/supabase.js";

export async function onRequest(context) {
  try {
    const { request, env } = context;
    const method = request.method.toUpperCase();

    if (method === "GET") {
      assertSyncToken(request, env);
      const row = await getDocument(env, "board-state");
      return jsonResponse(row ? parseMainDocument(row) : defaultStore());
    }

    if (method === "POST") {
      assertSyncToken(request, env);
      const payload = await readJsonBody(request);
      const nextState = payload.state;
      if (!nextState || typeof nextState !== "object" || Array.isArray(nextState)) {
        throw new Error("state must be a JSON object.");
      }

      const currentRow = await getDocument(env, "board-state");
      const currentStore = currentRow ? parseMainDocument(currentRow) : defaultStore();
      const nextStore = sanitizeStore({
        app: currentStore.app,
        revision: Number(currentStore.revision || 0) + 1,
        savedAt: nowText(),
        state: nextState,
      });

      await upsertDocument(env, buildMainDocument(nextStore));
      return jsonResponse(nextStore);
    }

    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        Allow: "GET, POST",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
