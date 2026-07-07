import {
  applyAction,
  buildMainDocument,
  defaultStore,
  parseMainDocument,
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
    if (request.method.toUpperCase() !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          Allow: "POST",
        },
      });
    }

    assertSyncToken(request, env);
    const payload = await readJsonBody(request);
    const currentRow = await getDocument(env, "board-state");
    const currentStore = currentRow ? parseMainDocument(currentRow) : defaultStore();
    const nextStore = applyAction(currentStore, payload);

    await upsertDocument(env, buildMainDocument(nextStore));
    return jsonResponse(nextStore);
  } catch (error) {
    return errorResponse(error);
  }
}
