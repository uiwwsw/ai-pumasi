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
  const login = startLogin({
    fetchImpl: exchange(seen),
    open: async (url: string) => {
      auth = url;
      const u = new URL(url);
      // The approval screen names the app after this address, so it is our site, not localhost.
      assert.equal(u.searchParams.get("callback_url"), "https://pumasi-agent.vercel.app/desktop-login/");
      // The return page sends the browser on to the port carried at the end of state.
      const state = u.searchParams.get("state")!;
      const back = { port: state.slice(state.lastIndexOf(".") + 1) };
      assert.match(back.port, /^\d+$/);
      // A callback that does not carry our state is refused and does not end the sign-in.
      const wrong = await fetch(`http://127.0.0.1:${back.port}/callback?code=c&state=nope`);
      assert.equal(wrong.status, 400);
      const ok = await fetch(
        `http://127.0.0.1:${back.port}/callback?code=one-time&state=${state}`,
      );
      assert.match(await ok.text(), /Pumasi Agent/);
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
