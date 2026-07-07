import { APP_NAME } from "../_shared/store.js";
import { errorResponse, jsonResponse } from "../_shared/supabase.js";

export async function onRequest(context) {
  try {
    const { env } = context;
    return jsonResponse({
      ok: true,
      app: APP_NAME,
      supabaseConfigured: Boolean((env.SUPABASE_URL || "").trim() && ((env.SUPABASE_SECRET_KEY || "").trim() || (env.SUPABASE_SERVICE_ROLE_KEY || "").trim())),
      tokenProtected: Boolean((env.APP_SYNC_TOKEN || "").trim()),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
