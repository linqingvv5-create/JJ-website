(function () {
  "use strict";

  const config = window.LINQING_SUPABASE_CONFIG;
  const factory = window.supabase?.createClient;
  const gate = document.getElementById("auth-gate");
  const card = document.getElementById("auth-card");
  const selectedKey = "linqing-selected-household-v1";
  let resolveReady;
  let settled = false;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const api = window.FinanceAuth = { ready, client: null, session: null, user: null, household: null, member: null, households: [] };

  if (!config || !factory || !gate || !card) {
    card.innerHTML = '<div class="auth-brand"><strong>暂时无法连接</strong><span>登录组件加载失败，请刷新页面。</span></div>';
    return;
  }

  const client = factory(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 5 } }
  });
  api.client = client;
  api.signOut = async () => { await client.auth.signOut(); localStorage.removeItem(selectedKey); location.reload(); };
  api.refreshHouseholds = loadHouseholds;
  installLegacyInvestmentAdapter();

  renderLogin("login");
  void initialize();

  async function initialize() {
    const { data, error } = await client.auth.getSession();
    if (error) return showFatal(error.message);
    if (data.session) await useSession(data.session);
    client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") { api.session = null; api.user = null; api.household = null; renderLogin("login"); }
      else if (session && session.user.id !== api.user?.id) window.setTimeout(() => useSession(session), 0);
    });
  }

  async function useSession(session) {
    api.session = session;
    api.user = session.user;
    await loadHouseholds();
  }

  async function loadHouseholds() {
    const { data, error } = await client.from("household_members")
      .select("household_id,role,display_name,households(id,name,invite_code)")
      .eq("user_id", api.user.id);
    if (error) return renderSetupError(error);
    api.households = (data || []).map((row) => ({
      id: row.household_id,
      name: row.households?.name || "我的家庭",
      inviteCode: row.households?.invite_code || "",
      role: row.role,
      displayName: row.display_name || api.user.user_metadata?.display_name || api.user.email?.split("@")[0] || "我"
    }));
    const preferred = localStorage.getItem(selectedKey);
    const chosen = api.households.find((item) => item.id === preferred) || (api.households.length === 1 ? api.households[0] : null);
    if (chosen) return enterHousehold(chosen);
    renderHouseholdSetup();
  }

  async function enterHousehold(household) {
    api.household = household;
    api.member = { id: api.user.id, displayName: household.displayName, role: household.role };
    const { data: memberRows } = await client.from("household_members").select("user_id,role,display_name,joined_at").eq("household_id", household.id);
    api.members = (memberRows || []).map((row) => ({ id: row.user_id, displayName: row.display_name || "家庭成员", role: row.role, joinedAt: row.joined_at }));
    localStorage.setItem(selectedKey, household.id);
    gate.hidden = true;
    document.body.classList.remove("auth-pending");
    if (!settled) { settled = true; resolveReady(api); }
    window.dispatchEvent(new CustomEvent("finance-auth-ready", { detail: api }));
  }

  function renderLogin(mode) {
    gate.hidden = false;
    document.body.classList.add("auth-pending");
    const register = mode === "register";
    card.innerHTML = `
      <div class="auth-brand"><strong>林青资金与投资</strong><span>家庭账本 · 目标规划 · 投资汇总</span></div>
      <div class="auth-tabs"><button type="button" data-auth-mode="login" class="${register ? "" : "is-active"}">登录</button><button type="button" data-auth-mode="register" class="${register ? "is-active" : ""}">注册</button></div>
      <form class="auth-form" data-auth-form>
        ${register ? '<label>你的称呼<input name="displayName" autocomplete="name" maxlength="30" required placeholder="例如：林青"></label>' : ""}
        <label>邮箱<input name="email" type="email" autocomplete="email" required placeholder="name@example.com"></label>
        <label>密码<input name="password" type="password" autocomplete="${register ? "new-password" : "current-password"}" minlength="8" required placeholder="至少 8 位"></label>
        <button class="auth-primary" type="submit">${register ? "创建账号" : "登录"}</button>
      </form>
      <p class="auth-message" data-auth-message>${register ? "注册后可能需要到邮箱确认一次；以后使用密码登录，不需要每次验证码。" : "登录状态会保存在这台设备上。"}</p>`;
    card.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => renderLogin(button.dataset.authMode)));
    card.querySelector("[data-auth-form]").addEventListener("submit", (event) => submitAuth(event, register));
  }

  async function submitAuth(event, register) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = card.querySelector("[data-auth-message]");
    const button = form.querySelector("button[type=submit]");
    const values = new FormData(form);
    button.disabled = true;
    message.classList.remove("is-error");
    message.textContent = register ? "正在创建账号…" : "正在登录…";
    const credentials = { email: String(values.get("email") || "").trim(), password: String(values.get("password") || "") };
    const result = register
      ? await client.auth.signUp({ ...credentials, options: { data: { display_name: String(values.get("displayName") || "").trim() }, emailRedirectTo: productionUrl() } })
      : await client.auth.signInWithPassword(credentials);
    button.disabled = false;
    if (result.error) { message.classList.add("is-error"); message.textContent = friendlyError(result.error.message); return; }
    if (result.data.session) return useSession(result.data.session);
    message.textContent = "账号已创建。请打开验证邮件确认后，再回到这里用密码登录。";
  }

  function renderHouseholdSetup() {
    gate.hidden = false;
    document.body.classList.add("auth-pending");
    card.innerHTML = `
      <div class="auth-brand"><strong>选择你的家庭</strong><span>已登录：${escapeHtml(api.user.email || "")}</span></div>
      ${api.households.length ? `<div class="auth-households">${api.households.map((item) => `<button class="auth-household" type="button" data-household-id="${item.id}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.displayName)} · ${roleName(item.role)}</span></button>`).join("")}</div>` : '<p class="auth-user-line">第一次使用，请创建家庭；家人可用邀请码加入。</p>'}
      <form class="auth-form" data-create-household><label>家庭名称<input name="name" maxlength="60" required placeholder="例如：我们的家"></label><label>你的称呼<input name="displayName" maxlength="30" required placeholder="例如：林青"></label><button class="auth-primary">创建家庭</button></form>
      <div class="auth-divider">或使用邀请码加入</div>
      <form class="auth-form" data-join-household><label>家庭邀请码<input name="code" maxlength="10" required autocapitalize="characters" placeholder="10 位邀请码"></label><label>你的称呼<input name="displayName" maxlength="30" required></label><button class="auth-secondary">加入家庭</button></form>
      <p class="auth-message" data-auth-message></p>
      <button class="auth-secondary" style="width:100%;margin-top:8px" type="button" data-sign-out>退出账号</button>`;
    card.querySelectorAll("[data-household-id]").forEach((button) => button.addEventListener("click", () => enterHousehold(api.households.find((item) => item.id === button.dataset.householdId))));
    card.querySelector("[data-create-household]").addEventListener("submit", (event) => submitHousehold(event, "create_household"));
    card.querySelector("[data-join-household]").addEventListener("submit", (event) => submitHousehold(event, "join_household"));
    card.querySelector("[data-sign-out]").addEventListener("click", api.signOut);
  }

  async function submitHousehold(event, rpc) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const params = rpc === "create_household"
      ? { household_name: String(values.get("name") || "").trim(), member_display_name: String(values.get("displayName") || "").trim() }
      : { join_code: String(values.get("code") || "").trim(), member_display_name: String(values.get("displayName") || "").trim() };
    const message = card.querySelector("[data-auth-message]");
    message.textContent = "正在保存…";
    const { error } = await client.rpc(rpc, params);
    if (error) { message.classList.add("is-error"); message.textContent = friendlyError(error.message); return; }
    await loadHouseholds();
  }

  function renderSetupError(error) {
    gate.hidden = false;
    document.body.classList.add("auth-pending");
    card.innerHTML = `<div class="auth-brand"><strong>数据库尚未初始化</strong><span>登录已连接，但家庭数据表还不能使用。</span></div><p class="auth-message is-error">${escapeHtml(error.message)}</p><button class="auth-secondary" style="width:100%" type="button" data-retry>重试</button>`;
    card.querySelector("[data-retry]").addEventListener("click", loadHouseholds);
  }

  function showFatal(message) { card.innerHTML = `<div class="auth-brand"><strong>连接失败</strong><span>${escapeHtml(message)}</span></div>`; }
  function productionUrl() { return location.protocol === "file:" ? "https://linqingvv5-create.github.io/JJ-website/finance.html" : `${location.origin}${location.pathname}`; }
  function roleName(role) { return role === "owner" ? "创建者" : role === "admin" ? "管理员" : "家庭成员"; }
  function friendlyError(message) {
    if (/invalid login credentials/i.test(message)) return "邮箱或密码不正确。";
    if (/email not confirmed/i.test(message)) return "请先打开注册确认邮件。";
    if (/already registered/i.test(message)) return "这个邮箱已经注册，请直接登录。";
    if (/invalid household invite code/i.test(message)) return "家庭邀请码不正确。";
    return message;
  }
  function escapeHtml(value) { const node = document.createElement("div"); node.textContent = String(value ?? ""); return node.innerHTML; }

  function installLegacyInvestmentAdapter() {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async function authenticatedFetch(input, init) {
      const url = typeof input === "string" ? input : input?.url || "";
      const requestUrl = new URL(url, location.href);
      if (!["/api/state", "/api/finance/state"].includes(requestUrl.pathname)) return nativeFetch(input, init);
      const auth = await ready;
      if (requestUrl.pathname === "/api/finance/state") return new Response(JSON.stringify({ error: "Legacy finance storage disabled" }), { status: 410, headers: { "Content-Type": "application/json" } });
      try {
        if (String(init?.method || "GET").toUpperCase() === "GET") {
          const { data, error } = await auth.client.from("household_investment_state").select("revision,body,updated_at").eq("household_id", auth.household.id).maybeSingle();
          if (error) throw error;
          return jsonResponse({ state: data?.body || null, revision: Number(data?.revision || 0), savedAt: data?.updated_at || null });
        }
        const payload = JSON.parse(String(init?.body || "{}"));
        const current = await auth.client.from("household_investment_state").select("revision").eq("household_id", auth.household.id).maybeSingle();
        if (current.error) throw current.error;
        const { data, error } = await auth.client.rpc("save_household_investment_state", { target_household_id: auth.household.id, expected_revision: Number(current.data?.revision || 0), next_body: payload.state || {} });
        if (error) throw error;
        const saved = Array.isArray(data) ? data[0] : data;
        return jsonResponse({ ok: true, revision: Number(saved?.revision || 0), savedAt: saved?.updated_at || new Date().toISOString() });
      } catch (error) {
        const conflict = /revision conflict/i.test(error.message || "");
        return jsonResponse({ error: error.message || "Cloud save failed" }, conflict ? 409 : 500);
      }
    };
  }
  function jsonResponse(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
})();
