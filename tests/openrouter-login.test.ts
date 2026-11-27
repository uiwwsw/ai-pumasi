import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { startLogin } = require("../electron/openrouter-login.cjs");

const exchange = (seen: any[]) => async (url: string, init: any) => {
  seen.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ key: "sk-or-v1-from-login" }) };
};

test("sign-in: the browser comes back with the code and the app keeps the key", async () => {
  const seen: any[] = [];
  let auth = "";
  let login: any;
  login = startLogin({
    fetchImpl: exchange(seen),
    open: async (url: string) => {
      auth = url;
      const u = new URL(url);
      // The approval screen names the app after this address, so it is our site, not localhost.
      assert.equal(u.searchParams.get("callback_url"), "https://pumasi-agent.vercel.app/desktop-login/");
      const state = u.searchParams.get("state")!;
      // No port rides in state any more: the return page opens the app's own link.
      assert.match(state, /^[\w-]+$/);
      // Links that are not ours, or carry another state, are ignored and do not end the sign-in.
      assert.equal(login.receive("https://evil.example/openrouter?code=c&state=" + state), false);
      assert.equal(login.receive("pumasi-agent://other?code=c&state=" + state), false);
      assert.equal(login.receive("pumasi-agent://openrouter?code=c&state=nope"), false);
      assert.equal(login.receive("not a url"), false);
      queueMicrotask(() => {
        assert.equal(login.receive(`pumasi-agent://openrouter?code=one-time&state=${state}`), true);
        // The same link arriving twice is not exchanged twice.
        assert.equal(login.receive(`pumasi-agent://openrouter?code=one-time&state=${state}`), false);
      });
    },
  });
  assert.equal(await login.promise, "sk-or-v1-from-login");
  const u = new URL(auth);
  assert.equal(u.origin + u.pathname, "https://openrouter.ai/auth");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://openrouter.ai/api/v1/auth/keys");
  assert.equal(seen[0].body.code, "one-time");
  assert.equal(seen[0].body.code_challenge_method, "S256");
  // The verifier sent with the code is the one behind the challenge in the sign-in link.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seen[0].body.code_verifier));
  const challenge = Buffer.from(digest).toString("base64url");
  assert.equal(u.searchParams.get("code_challenge"), challenge);
});

test("sign-in can be cancelled and times out", async () => {
  const a = startLogin({ open: async () => {} });
  a.cancel();
  await assert.rejects(a.promise, /취소/);
  const b = startLogin({ open: async () => {}, waitMs: 30 });
  await assert.rejects(b.promise, /시간이 지났습니다/);
});

test("a link without a code ends the sign-in as cancelled", async () => {
  let login: any;
  login = startLogin({
    open: async (url: string) => {
      const state = new URL(url).searchParams.get("state");
      queueMicrotask(() => login.receive(`pumasi-agent://openrouter?state=${state}`));
    },
  });
  await assert.rejects(login.promise, /취소/);
});
