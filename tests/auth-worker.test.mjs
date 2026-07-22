import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/site-worker.js";

class FakeDb {
  constructor() { this.locks = new Map(); this.members = [{ id: "member-me" }, { id: "member-partner" }]; }
  prepare(sql) {
    const db = this;
    return {
      sql, args: [],
      bind(...args) { this.args = args; return this; },
      async all() {
        if (sql.includes("FROM finance_member_locks")) return { results: [...db.locks.entries()].filter(([member_id]) => !sql.includes("member_id <>") || member_id !== this.args[0]).map(([member_id, lock]) => ({ member_id, ...lock })) };
        if (sql.includes("SELECT id FROM finance_members")) return { results: db.members };
        return { results: [] };
      },
      async first() {
        if (sql.includes("FROM finance_member_locks WHERE member_id")) return db.locks.get(this.args[0]) || null;
        return null;
      },
      async run() {
        if (sql.includes("INSERT INTO finance_member_locks")) db.locks.set(this.args[0], { password_hash: this.args[1], salt: this.args[2] });
        if (sql.includes("DELETE FROM finance_member_locks")) db.locks.delete(this.args[0]);
        return { success: true };
      }
    };
  }
  async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }
}

const env = { APP_PASSWORD: "test-password", DB: new FakeDb() };
const base = "https://example.test";

test("password session protects API routes", async () => {
  const rejected = await worker.fetch(new Request(`${base}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "wrong" })
  }), env);
  assert.equal(rejected.status, 401);

  const login = await worker.fetch(new Request(`${base}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: env.APP_PASSWORD })
  }), env);
  assert.equal(login.status, 200);
  const loginPayload = await login.json();
  const { token } = loginPayload;
  assert.ok(token);
  assert.equal(loginPayload.memberId, "member-me");

  const restored = await worker.fetch(new Request(`${base}/api/session`, {
    headers: { Authorization: `Bearer ${token}` }
  }), env);
  assert.equal(restored.status, 200);

  const protectedRequest = await worker.fetch(new Request(`${base}/api/state`), env);
  assert.equal(protectedRequest.status, 401);

  const setup = await worker.fetch(new Request(`${base}/api/member-locks/member-partner/password`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ newPassword: "2468" })
  }), env);
  assert.equal(setup.status, 200);

  const wrongMemberPassword = await worker.fetch(new Request(`${base}/api/member-locks/member-partner/unlock`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "0000" })
  }), env);
  assert.equal(wrongMemberPassword.status, 401);

  const memberLogin = await worker.fetch(new Request(`${base}/api/member-locks/member-partner/unlock`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "2468" })
  }), env);
  assert.equal(memberLogin.status, 200);
  assert.ok((await memberLogin.json()).token);

  const partnerHomepageLogin = await worker.fetch(new Request(`${base}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "2468" })
  }), env);
  assert.equal(partnerHomepageLogin.status, 200);
  assert.equal((await partnerHomepageLogin.json()).memberId, "member-partner");
});
