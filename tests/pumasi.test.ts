import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { createRelay } from "../relay/server.mjs";
const require = createRequire(import.meta.url);
const pumasi = require("../electron/pumasi.cjs");
const team = require("../electron/team.cjs");

const fakeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => b.toString().slice(4),
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pumasi-test-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Built from parts so the repo secret scanner does not flag this fake value.
const FAKE_KEY = ["nvapi", "fake", "donated", "value", "1234"].join("-");

async function startRelay(invites = ["hello"]) {
  const dir = tmp();
  const relay = createRelay({ file: path.join(dir, "relay.db"), invites, grant: 1000 });
  const server = http.createServer(relay.handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  return { relay, url, dir, close: () => new Promise((r) => server.close(r)) };
}

function device(url: string) {
  const dir = tmp();
  const identity = pumasi.loadIdentity(path.join(dir, "id.json"), fakeStorage);
  const settings = pumasi.createSettings(path.join(dir, "pumasi.json"));
  settings.update({ server: url });
  return { dir, identity, settings, api: pumasi.createClient({ server: url, identity }) };
}

test("sealed text opens only with the right key and label", () => {
  const keys = pumasi.boxKeys();
  const other = pumasi.boxKeys();
  const sealed = pumasi.seal("비밀 작업", keys.publicRaw, "slot|task");
  assert.equal(pumasi.open(sealed, keys, "slot|task"), "비밀 작업");
  assert.throws(() => pumasi.open(sealed, keys, "slot|result"));
  assert.throws(() => pumasi.open(sealed, other, "slot|task"));
  assert.ok(!JSON.stringify(sealed).includes("비밀"));
});

test("device identity is stored encrypted and reloads to the same id", () => {
  const dir = tmp();
  const file = path.join(dir, "id.json");
  const a = pumasi.loadIdentity(file, fakeStorage);
  const b = pumasi.loadIdentity(file, fakeStorage);
  assert.equal(a.id, b.id);
  assert.ok(!fs.readFileSync(file, "utf8").includes("PRIVATE"));
  assert.throws(() => pumasi.loadIdentity(path.join(dir, "x.json"), { ...fakeStorage, isEncryptionAvailable: () => false }));
});

test("posting refuses emails, phone numbers and key-shaped text", () => {
  assert.notEqual(pumasi.privateReason("메일은 kim@example.com 으로"), "");
  assert.notEqual(pumasi.privateReason("연락처 010-1234-5678"), "");
  assert.notEqual(pumasi.privateReason(`key ${FAKE_KEY}`), "");
  assert.equal(pumasi.privateReason("1부터 100까지 더하면?"), "");
});

test("only donated free-host keys are lent, never paid keys", () => {
  const env = { NVIDIA_API_KEY: "a".repeat(20), GROQ_API_KEY: "b".repeat(20), OPENAI_API_KEY: "c".repeat(20) };
  assert.deepEqual(pumasi.donatedEnv(env, { nvidia: true }), { NVIDIA_API_KEY: "a".repeat(20) });
  assert.deepEqual(pumasi.donatedEnv(env, {}), {});
});

test("relay rejects unsigned, forged and replayed requests", async () => {
  const r = await startRelay();
  try {
    const plain = await fetch(`${r.url}/v1/me`);
    assert.equal(plain.status, 401);
    const a = device(r.url);
    await a.api("POST", "/v1/join", { invite: "hello" });
    // Same headers twice: the second is a replay.
    const ts = String(Date.now());
    const digest = crypto.createHash("sha256").update("").digest("hex");
    const sig = crypto.sign(null, Buffer.from(`GET\n/v1/me\n${ts}\n${digest}`), a.identity.privateKey).toString("base64url");
    const headers = { "x-pumasi-id": a.identity.id, "x-pumasi-ts": ts, "x-pumasi-sig": sig };
    assert.equal((await fetch(`${r.url}/v1/me`, { headers })).status, 200);
    assert.equal((await fetch(`${r.url}/v1/me`, { headers })).status, 401);
    // Someone else's id with my signature.
    const b = device(r.url);
    const forged = { ...headers, "x-pumasi-id": b.identity.id, "x-pumasi-ts": String(Date.now()) };
    assert.equal((await fetch(`${r.url}/v1/me`, { headers: forged })).status, 401);
    await assert.rejects(b.api("POST", "/v1/join", { invite: "wrong" }), /초대 코드/);
  } finally {
    await r.close();
  }
});

test("a helper's app does one task with its own key; the relay never sees the text", async () => {
  const r = await startRelay();
  try {
    const poster = device(r.url);
    const helper = device(r.url);
    await poster.api("POST", "/v1/join", { invite: "hello" });
    await helper.api("POST", "/v1/join", { invite: "hello" });
    helper.settings.update({ donate: { nvidia: true } });
    const env = { NVIDIA_API_KEY: FAKE_KEY, OPENAI_API_KEY: "paid-key-should-not-be-used" };
    const calls: any[] = [];
    const request = async (p: any, o: any) => {
      calls.push({ p, env: o.env });
      return { text: `답: ${p.text.length}자 작업 완료 ${FAKE_KEY}`, inputTokens: 30, outputTokens: 70 };
    };
    const progress: any[] = [];
    const helping = (async () => {
      for (let i = 0; i < 40; i++) {
        const { slots } = await helper.api("GET", "/v1/open");
        if (slots.length) return pumasi.help(slots[0].slotId, { api: helper.api, env, settings: helper.settings, request, sleep, onProgress: (e: any) => progress.push(e) });
        await sleep(50);
      }
      throw new Error("no slot appeared");
    })();
    const results = await pumasi.runRemote(["아주 비밀스러운 작업 내용"], { api: poster.api, copies: 1, sleep: (ms: number) => sleep(Math.min(ms, 50)) });
    await helping;
    const text = results.get(0)[0];
    assert.match(text, /작업 완료/);
    assert.ok(!text.includes(FAKE_KEY), "helper key is masked in the result");
    // The helper's model got the task, with only the donated key.
    assert.equal(calls[0].p.text, "아주 비밀스러운 작업 내용");
    assert.deepEqual(Object.keys(calls[0].env), ["NVIDIA_API_KEY"]);
    // The helper's window only hears states and token counts.
    assert.ok(progress.every((e) => !("text" in e)));
    assert.ok(!JSON.stringify(progress).includes("비밀"));
    // Points moved from poster to helper.
    assert.equal((await helper.api("GET", "/v1/me")).credits, 1100);
    assert.equal((await poster.api("GET", "/v1/me")).credits, 900);
    assert.equal(helper.settings.get().usedToday, 100);
    // Nothing readable on the relay, and the job is gone.
    const dump = fs.readFileSync(path.join(r.dir, "relay.db")).toString("utf8") + (fs.existsSync(path.join(r.dir, "relay.db-wal")) ? fs.readFileSync(path.join(r.dir, "relay.db-wal")).toString("utf8") : "");
    assert.ok(!dump.includes("비밀스러운"));
    assert.ok(!dump.includes("작업 완료"));
    assert.equal(r.relay.db.prepare("SELECT COUNT(*) AS n FROM slots").get().n, 0);
  } finally {
    await r.close();
  }
});

test("a helper cannot take its own task, two at once, or a second copy of one task", async () => {
  const r = await startRelay();
  try {
    const poster = device(r.url);
    const helper = device(r.url);
    await poster.api("POST", "/v1/join", { invite: "hello" });
    await helper.api("POST", "/v1/join", { invite: "hello" });
    const keys = pumasi.boxKeys();
    const job = await poster.api("POST", "/v1/jobs", { copies: 2, tasks: [10, 20], jobKey: keys.publicRaw });
    assert.equal((await poster.api("GET", "/v1/open")).slots.length, 0);
    await assert.rejects(poster.api("POST", `/v1/slots/${job.slots[0].slotId}/claim`, { helperKey: keys.publicRaw }));
    await helper.api("POST", `/v1/slots/${job.slots[0].slotId}/claim`, { helperKey: keys.publicRaw });
    await assert.rejects(helper.api("POST", `/v1/slots/${job.slots[2].slotId}/claim`, { helperKey: keys.publicRaw }), /하나씩/);
    await helper.api("POST", `/v1/slots/${job.slots[0].slotId}/release`);
    // Giving up frees the helper; finishing task 0 means its other copy is not offered again.
    await helper.api("POST", `/v1/slots/${job.slots[0].slotId}/claim`, { helperKey: keys.publicRaw });
    const sealed = pumasi.seal("x", keys.publicRaw, "l");
    await poster.api("POST", `/v1/slots/${job.slots[0].slotId}/task`, { sealed });
    await helper.api("POST", `/v1/slots/${job.slots[0].slotId}/result`, { sealed, tokens: 5 });
    const open = (await helper.api("GET", "/v1/open")).slots.map((s: any) => s.slotId);
    assert.ok(!open.includes(job.slots[1].slotId));
    // The helper cannot read the poster's job or results.
    await assert.rejects(helper.api("GET", `/v1/jobs/${job.jobId}`));
    await assert.rejects(helper.api("GET", `/v1/slots/${job.slots[0].slotId}/result`));
  } finally {
    await r.close();
  }
});

test("team mode takes helper results first and asks its own worker only for unanswered tasks", async () => {
  const asked: string[] = [];
  const fetchImpl = async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    const text = JSON.stringify(body);
    let reply = "ok";
    if (text.includes("plan") || /작업 분할|tasks/.test(body.instructions ?? body.system ?? "")) reply = "";
    asked.push(text);
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  };
  const calls: any[] = [];
  const fakeProviders = require("../electron/providers.cjs");
  const original = fakeProviders.request;
  fakeProviders.request = async (p: any) => {
    calls.push(p);
    if (p.action === "plan")
      return { text: JSON.stringify({ goal: "g", tasks: [{ id: "a", title: "A", instructions: "첫 작업을 하세요" }, { id: "b", title: "B", instructions: "둘째 작업을 하세요" }] }), inputTokens: 1, outputTokens: 1 };
    if (p.action === "review") return { text: JSON.stringify({ approved: true }), inputTokens: 1, outputTokens: 1 };
    return { text: `로컬 결과 ${p.action} 충분히 긴 답입니다`, inputTokens: 1, outputTokens: 1 };
  };
  try {
    const result = await team.orchestrate(
      { lead: "claude-opus", worker: "gemini-flash", text: "요청", context: [] },
      {
        env: {},
        fetchImpl,
        sleep: async () => {},
        remote: async (prompts: string[]) => new Map([[0, ["돕는 사람 결과"]], [1, []]]),
      },
    );
    const works = calls.filter((c) => c.action === "work");
    assert.equal(works.length, 1, "only the unanswered task ran locally");
    assert.equal(works[0].text, "둘째 작업을 하세요");
    assert.equal(result.pumasiTasks, 1);
    const merge = calls.find((c) => c.action === "merge");
    assert.match(merge.text, /돕는 사람 결과/);
    assert.ok(result.text);
  } finally {
    fakeProviders.request = original;
  }
});

test("slots of a poster whose app stopped checking in are hidden, then dropped", async () => {
  let clock = 1_000_000;
  const relay = createRelay({ invites: ["hi"], now: () => clock });
  const server = http.createServer(relay.handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const mk = () => {
      const d = device(url);
      return { ...d, api: pumasi.createClient({ server: url, identity: d.identity, now: () => clock }) };
    };
    const poster = mk();
    const helper = mk();
    await poster.api("POST", "/v1/join", { invite: "hi" });
    await helper.api("POST", "/v1/join", { invite: "hi" });
    await poster.api("POST", "/v1/jobs", { copies: 1, tasks: [5], jobKey: pumasi.boxKeys().publicRaw });
    assert.equal((await helper.api("GET", "/v1/open")).slots.length, 1);
    clock += 31_000;
    assert.equal((await helper.api("GET", "/v1/open")).slots.length, 0);
    clock += 100_000;
    await helper.api("GET", "/v1/me");
    assert.equal(relay.db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n, 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
