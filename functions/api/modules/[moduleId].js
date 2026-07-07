import {
  buildModuleDocument,
  defaultModuleStore,
  moduleDocumentId,
  moduleResponsePayload,
  nowText,
  parseModuleDocument,
  requireValidModuleId,
  sanitizeModuleStore,
} from "../../_shared/store.js";
import {
  assertSyncToken,
  errorResponse,
  getDocument,
  jsonResponse,
  readJsonBody,
  upsertDocument,
} from "../../_shared/supabase.js";

export async function onRequest(context) {
  try {
    const { request, env, params } = context;
    const method = request.method.toUpperCase();
    const moduleId = requireValidModuleId(params.moduleId);

    if (method === "GET") {
      assertSyncToken(request, env);
      const row = await getDocument(env, moduleDocumentId(moduleId));
      return jsonResponse(moduleResponsePayload(moduleId, row ? parseModuleDocument(row) : defaultModuleStore()));
    }

    if (method === "POST") {
      assertSyncToken(request, env);
      const payload = await readJsonBody(request);
      const nextState = payload.state;
      if (!nextState || typeof nextState !== "object" || Array.isArray(nextState)) {
        throw new Error("state must be a JSON object.");
      }

      const currentRow = await getDocument(env, moduleDocumentId(moduleId));
      const currentStore = currentRow ? parseModuleDocument(currentRow) : defaultModuleStore();
      const nextStore = sanitizeModuleStore({
        revision: Number(currentStore.revision || 0) + 1,
        savedAt: nowText(),
        state: nextState,
      });

      await upsertDocument(env, buildModuleDocument(moduleId, nextStore));
      return jsonResponse(moduleResponsePayload(moduleId, nextStore));
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
