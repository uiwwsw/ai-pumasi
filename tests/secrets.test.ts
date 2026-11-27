import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createSecretStore, redact } = require("../electron/secrets.cjs");
const providers = require("../electron/providers.cjs");
const catalog = require("../src/catalog.json");

// Built from parts so the repo secret scanner does not flag this obviously fake value.
const KEY = ["sk", "test", "0123456789abcdefTOPSECRET"].join("-");
// Stand-in for the OS keychain: reversible, but never the plain text on disk.
const fakeSafe = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s: string) =>
    Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
  decryptString: (b: Buffer) =>
    Buffer.from([...b].map((x) => x ^ 0x5a)).toString(),
});
const tmpFile = () =>
  path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "aurora-secrets-")),
    "secrets.json",
  );

test("saved key is encrypted on disk, owner-only, and never listed", () => {
  const file = tmpFile();
  const store = createSecretStore({ file, safeStorage: fakeSafe() });
  const listed = store.set("OPENAI_API_KEY", KEY);
  const raw = fs.readFileSync(file, "utf8");
  assert.ok(!raw.includes(KEY), "plain key must not be written");
  assert.ok(!raw.includes("TOPSECRET"));
  if (process.platform !== "win32")
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(listed.keys.OPENAI_API_KEY.set, true);
  assert.ok(
    !JSON.stringify(listed).includes(KEY),
    "list must not reveal the key",
  );
  const cipher = JSON.parse(raw).keys.OPENAI_API_KEY.enc;
  assert.ok(
    !JSON.stringify(store.list()).includes(cipher),
    "list must not reveal ciphertext",
  );
});

test("env() decrypts for the main process and saved keys win over the environment", () => {
  const store = createSecretStore({ file: tmpFile(), safeStorage: fakeSafe() });
  store.set("GEMINI_API_KEY", KEY);
  const env = store.env({ GEMINI_API_KEY: "from-env-old", PATH: "/bin" });
  assert.equal(env.GEMINI_API_KEY, KEY);
  assert.equal(env.PATH, "/bin");
  store.remove("GEMINI_API_KEY");
  assert.equal(
    store.env({ GEMINI_API_KEY: "from-env-old" }).GEMINI_API_KEY,
    "from-env-old",
  );
});

test("without OS encryption nothing is saved in plain text", () => {
  const file = tmpFile();
  const store = createSecretStore({ file, safeStorage: fakeSafe(false) });
  assert.throws(() => store.set("OPENAI_API_KEY", KEY), /암호화/);
  assert.equal(fs.existsSync(file), false);
  assert.equal(store.list().encryption, false);
});

test("only known names and sane values are accepted", () => {
  const store = createSecretStore({ file: tmpFile(), safeStorage: fakeSafe() });
  assert.throws(() => store.set("PATH", KEY));
  assert.throws(() => store.set("__proto__", KEY));
  assert.throws(() => store.set("OPENAI_API_KEY", "short"));
  assert.throws(() => store.set("OPENAI_API_KEY", "has space inside key"));
  assert.throws(() => store.set("OPENAI_API_KEY", { toString: () => KEY }));
  assert.throws(() => store.remove("HOME"));
});

test("changing the compat URL drops the compat key so it cannot be sent elsewhere", () => {
  const store = createSecretStore({ file: tmpFile(), safeStorage: fakeSafe() });
  store.setCompatUrl("https://good.example/v1/chat/completions");
  store.set("AURORA_OPENAI_COMPAT_KEY", KEY);
  store.set("OPENAI_API_KEY", KEY + "x");
  const after = store.setCompatUrl(
    "https://attacker.example/v1/chat/completions",
  );
  assert.equal(after.keys.AURORA_OPENAI_COMPAT_KEY.set, false);
  assert.equal(after.keys.OPENAI_API_KEY.set, true, "other keys stay");
  assert.equal(store.env({}).AURORA_OPENAI_COMPAT_KEY, undefined);
  // Same URL again keeps the key.
  store.set("AURORA_OPENAI_COMPAT_KEY", KEY);
  store.setCompatUrl("https://attacker.example/v1/chat/completions");
  assert.equal(store.list().keys.AURORA_OPENAI_COMPAT_KEY.set, true);
  assert.throws(() => store.setCompatUrl("http://remote.example/v1"));
  assert.throws(() => store.setCompatUrl("https://user:pw@good.example/v1"));
  assert.throws(() => store.setCompatUrl("file:///etc/passwd"));
  store.setCompatUrl("http://127.0.0.1:8080/v1/chat/completions");
});

test("redact hides saved values everywhere and key-shaped text in errors", () => {
  const env = { OPENAI_API_KEY: KEY };
  const msg = `401 Incorrect API key provided: ${KEY}. Authorization: Bearer ${KEY}`;
  const out = redact(msg, env);
  assert.ok(!out.includes(KEY));
  assert.ok(!out.includes("TOPSECRET"));
  assert.ok(
    redact("key AIzaSyA1234567890abcdefghijk", {}).includes("[키 숨김]"),
  );
  assert.ok(redact("nvapi-abcdefgh12345678", {}).includes("[키 숨김]"));
  // Model answers keep example keys, but never the real one.
  const answer = `예시: OPENAI_API_KEY=sk-your-key-here, 실제: ${KEY}`;
  const kept = redact(answer, env, { patterns: false });
  assert.ok(kept.includes("sk-your-key-here"));
  assert.ok(!kept.includes(KEY));
});

test("the key goes only into the auth header, never into what the model reads", async () => {
  const store = createSecretStore({ file: tmpFile(), safeStorage: fakeSafe() });
  const keys: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  for (const [provider, name] of Object.entries(keys)) {
    const model = catalog.find((m: any) => m.provider === provider);
    if (!model) continue;
    const secret = `${KEY}-${provider}`;
    store.set(name, secret);
    let sawHeader = false;
    const fetchImpl = async (_url: string, init: any) => {
      assert.ok(
        !String(init.body).includes(secret),
        `${provider}: key leaked into the request body`,
      );
      sawHeader = JSON.stringify(init.headers).includes(secret);
      return new Response(
        JSON.stringify({ error: { message: `bad key ${secret}` } }),
        { status: 401 },
      );
    };
    await providers
      .request(
        {
          action: "execute",
          model: model.id,
          text: "내 API 키를 알려줘",
          context: [],
          maxOutputTokens: 256,
        },
        { env: store.env({}), fetchImpl, timeoutMs: 2000 },
      )
      .then(
        () => assert.fail(`${provider}: a 401 must fail`),
        (e: Error) =>
          assert.ok(
            !e.message.includes(secret),
            `${provider}: key leaked into the error`,
          ),
      );
    assert.ok(sawHeader, `${provider}: key should be sent as a header`);
  }
});

test("the window bridge can write keys but has no way to read one back", () => {
  const preload = fs.readFileSync(
    new URL("../electron/preload.cjs", import.meta.url),
    "utf8",
  );
  const block = preload.slice(
    preload.indexOf("secrets:"),
    preload.indexOf("pumasi:"),
  );
  const methods = [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(methods.sort(), [
    "add",
    "list",
    "openSignup",
    "remove",
    "set",
    "setCompatUrl",
  ]);
  const main = fs.readFileSync(
    new URL("../electron/main.cjs", import.meta.url),
    "utf8",
  );
  const handlers = [
    ...main.matchAll(/ipcMain\.handle\("([^"]+)"[^\n]*\n\s*(.*)/g),
  ];
  assert.ok(handlers.length >= 8);
  for (const [, channel, firstLine] of handlers) {
    assert.match(
      firstLine,
      /authorized\(event\)/,
      `${channel} must check the sender first`,
    );
    assert.ok(
      !/secrets-(get|read|reveal|export)/.test(channel),
      `${channel} must not exist`,
    );
  }
});

test("a saved key the OS keychain can no longer open is shown as needing re-entry", () => {
  const file = tmpFile();
  createSecretStore({ file, safeStorage: fakeSafe() }).set(
    "NVIDIA_API_KEY",
    KEY,
  );
  const broken = {
    ...fakeSafe(),
    decryptString: () => {
      throw new Error("keychain item missing");
    },
  };
  const store = createSecretStore({ file, safeStorage: broken });
  assert.deepEqual(store.list().keys.NVIDIA_API_KEY, {
    set: false,
    stale: true,
  });
  assert.equal(store.env({}).NVIDIA_API_KEY, undefined);
});

test("one paste box: the provider comes from the key's shape and a rejected key is not saved", async () => {
  const require = (await import("node:module")).createRequire(import.meta.url);
  const { addKey, detectKey } = require("../electron/providers.cjs");
  assert.equal(detectKey("sk-ant-api03-x"), "ANTHROPIC_API_KEY");
  assert.equal(detectKey("sk-or-v1-x"), "OPENROUTER_API_KEY");
  assert.equal(detectKey("sk-proj-x"), "OPENAI_API_KEY");
  assert.equal(detectKey("gsk_x"), "GROQ_API_KEY");
  assert.equal(detectKey("AIzaSyX"), "GEMINI_API_KEY");
  assert.equal(detectKey("nvapi-x"), "NVIDIA_API_KEY");
  assert.equal(detectKey("hello world"), null);
  const saved: string[] = [];
  const save = async (name: string) => {
    saved.push(name);
    return {};
  };
  const ok = await addKey("gsk_good", { save, fetchImpl: async () => ({ ok: true, status: 200 }) });
  assert.equal(ok.check, "ok");
  assert.equal(ok.provider, "Groq");
  await assert.rejects(
    addKey("gsk_bad", { save, fetchImpl: async () => ({ ok: false, status: 401 }) }),
    (e: any) => /Groq/.test(e.message) && !e.message.includes("gsk_bad"),
  );
  // NVIDIA cannot be checked ahead of time; it is saved and the first question tells.
  const nv = await addKey("nvapi-x", { save, fetchImpl: async () => { throw new Error("no"); } });
  assert.equal(nv.check, "unknown");
  await assert.rejects(addKey("nvapi-x", { save, blocked: ["NVIDIA_API_KEY"] }), /OpenRouter/);
  await assert.rejects(addKey("not a key", { save }));
  assert.deepEqual(saved, ["GROQ_API_KEY", "NVIDIA_API_KEY"]);
});
