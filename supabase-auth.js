(function () {
  "use strict";

  const TOKEN_KEY = "linqing-finance-session-v1";
  const MEMBER_TOKEN_KEY = "linqing-finance-member-session-v1";
  const MEMBER_ID_KEY = "linqing-finance-member-id-v1";
  const SERVICE_ORIGIN = "https://jj-website-c5g.pages.dev";
  const gate = document.getElementById("auth-gate");
  const card = document.getElementById("auth-card");
  const nativeFetch = window.fetch.bind(window);
  let resolveReady;
  let settled = false;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const api = window.FinanceAuth = {
    ready,
    client: null,
    user: null,
    household: null,
    member: null,
    members: [],
    activeMemberId: readStored(MEMBER_ID_KEY) || null
  };

  window.fetch = authenticatedFetch;
  api.signOut = signOut;
  api.memberLockStatus = memberLockStatus;
  api.unlockMember = unlockMember;
  api.setMemberPassword = setMemberPassword;
  api.leaveMember = leaveMember;

  if (!gate || !card) return;
  renderLogin();
  void restoreSession();

  async function authenticatedFetch(input, init) {
    const rawUrl = typeof input === "string" ? input : input?.url || "";
    const url = new URL(rawUrl, location.href);
    const isApi = url.pathname.startsWith("/api/");
    if (!isApi) return nativeFetch(input, init);

    const target = `${SERVICE_ORIGIN}${url.pathname}${url.search}`;
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const token = readToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const memberToken = readStored(MEMBER_TOKEN_KEY);
    if (memberToken) headers.set("X-Member-Authorization", `Bearer ${memberToken}`);
    return nativeFetch(target, { ...(init || {}), headers });
  }

  async function memberLockStatus() {
    const response = await authenticatedFetch("/api/member-locks", { cache: "no-store" });
    if (!response.ok) throw new Error("无法读取个人密码状态");
    return response.json();
  }

  async function unlockMember(memberId, password) {
    const response = await authenticatedFetch(`/api/member-locks/${encodeURIComponent(memberId)}/unlock`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, status: response.status, ...payload };
    storeMemberSession(memberId, payload.token);
    return { ok: true };
  }

  async function setMemberPassword(memberId, newPassword, currentPassword = "") {
    const response = await authenticatedFetch(`/api/member-locks/${encodeURIComponent(memberId)}/password`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newPassword, currentPassword })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, status: response.status, ...payload };
    storeMemberSession(memberId, payload.token);
    return { ok: true };
  }

  function storeMemberSession(memberId, token) {
    localStorage.setItem(MEMBER_ID_KEY, memberId);
    if (token) localStorage.setItem(MEMBER_TOKEN_KEY, token);
    else localStorage.removeItem(MEMBER_TOKEN_KEY);
    api.activeMemberId = memberId;
  }

  function leaveMember() {
    try {
      localStorage.removeItem(MEMBER_ID_KEY);
      localStorage.removeItem(MEMBER_TOKEN_KEY);
    } catch (_) { /* ignore */ }
    api.activeMemberId = null;
  }

  async function restoreSession() {
    const token = readToken();
    if (!token) return;
    try {
      const response = await nativeFetch(`${SERVICE_ORIGIN}/api/session`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      if (response.ok) {
        const payload = await response.json();
        if (payload.memberId) storeMemberSession(payload.memberId, "");
        return unlock();
      }
    } catch (_) {
      showMessage("暂时无法连接，请检查网络后重试。", true);
      return;
    }
    clearToken();
  }

  function renderLogin() {
    gate.hidden = false;
    document.body.classList.add("auth-pending");
    card.innerHTML = `
      <div class="auth-brand"><strong>林青资金与投资</strong><span>输入你的个人密码即可进入</span></div>
      <form class="auth-form" data-auth-form>
        <label>密码<input name="password" type="password" autocomplete="current-password" required autofocus placeholder="请输入密码"></label>
        <button class="auth-primary" type="submit">进入</button>
      </form>
      <p class="auth-message" data-auth-message>登录后，这台设备会记住你的状态。</p>`;
    card.querySelector("[data-auth-form]").addEventListener("submit", submitPassword);
  }

  async function submitPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    const password = String(new FormData(form).get("password") || "");
    button.disabled = true;
    showMessage("正在进入…");
    try {
      const response = await nativeFetch(`${SERVICE_ORIGIN}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.token) {
        showMessage(response.status === 401 ? "密码不正确，请重新输入。" : (payload.error || "暂时无法登录，请稍后重试。"), true);
        return;
      }
      localStorage.setItem(TOKEN_KEY, payload.token);
      if (payload.memberId) storeMemberSession(payload.memberId, payload.memberToken || "");
      unlock();
    } catch (_) {
      showMessage("网络连接失败，请检查网络后重试。", true);
    } finally {
      button.disabled = false;
    }
  }

  function unlock() {
    api.user = null;
    api.household = { id: "family", name: "我的家庭" };
    api.member = { id: api.activeMemberId || "", displayName: "", role: "member" };
    api.members = [api.member];
    gate.hidden = true;
    document.body.classList.remove("auth-pending");
    if (!settled) {
      settled = true;
      resolveReady(api);
    }
    window.dispatchEvent(new CustomEvent("finance-auth-ready", { detail: api }));
  }

  function signOut() {
    leaveMember();
    clearToken();
    location.reload();
  }

  function readToken() {
    return readStored(TOKEN_KEY);
  }

  function readStored(key) {
    try { return String(localStorage.getItem(key) || ""); } catch (_) { return ""; }
  }

  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (_) { /* ignore */ }
  }

  function showMessage(text, isError = false) {
    const message = card.querySelector("[data-auth-message]");
    if (!message) return;
    message.textContent = text;
    message.classList.toggle("is-error", isError);
  }
})();
