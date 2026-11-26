// Pumasi: your app works as one worker on someone else's team, with your own keys, and hands back
// only the result. Tasks and results are sealed for one device: the relay cannot read them, and on
// the helper's machine they stay in the main process (never sent to the window).
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { tr } = require("./i18n.cjs");
const { redact } = require("./secrets.cjs");

const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");
const DONATABLE = {
  nvidia: "NVIDIA_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  google: "GEMINI_API_KEY",
};
const DEFAULT_SERVER = "https://pumasi-agent.duckdns.org";
const HELP_MAX_OUTPUT = 4096;

// ---------- sealing ----------

const rawPublic = (keyObject) =>
  keyObject.export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
const publicFromRaw = (raw) =>
  crypto.createPublicKey({
    key: Buffer.concat([SPKI_X25519, Buffer.from(raw, "base64url")]),
    format: "der",
    type: "spki",
  });

/** A one-time X25519 key pair: {privateKey, publicRaw}. Lives in memory only. */
function boxKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("x25519");
  return { privateKey, publicRaw: rawPublic(publicKey) };
}

function derive(shared, epkRaw, recipientRaw, label) {
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      shared,
      Buffer.concat([Buffer.from(epkRaw, "base64url"), Buffer.from(recipientRaw, "base64url")]),
      `pumasi-v1|${label}`,
      32,
    ),
  );
}

/** Encrypt text so only the holder of recipientRaw's private key can read it. label binds it to one slot and direction. */
function seal(text, recipientRaw, label) {
  const eph = crypto.generateKeyPairSync("x25519");
  const epk = rawPublic(eph.publicKey);
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: publicFromRaw(recipientRaw) });
  const key = derive(shared, epk, recipientRaw, label);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(label));
  const ct = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return {
    epk,
    iv: iv.toString("base64url"),
    ct: ct.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

function open(sealed, keys, label) {
  const shared = crypto.diffieHellman({ privateKey: keys.privateKey, publicKey: publicFromRaw(sealed.epk) });
  const key = derive(shared, sealed.epk, keys.publicRaw, label);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64url"));
  decipher.setAAD(Buffer.from(label));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ct, "base64url")), decipher.final()]).toString("utf8");
}

// ---------- device identity and settings ----------

/**
 * The device's signing key (Ed25519), encrypted with the OS keychain. Its public half is the
 * anonymous id the relay knows. Refuses to store it in plain text.
 */
function loadIdentity(file, safeStorage) {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error(tr("이 기기에서는 운영체제 암호화를 쓸 수 없어 품앗이를 켤 수 없습니다."));
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    const der = Buffer.from(safeStorage.decryptString(Buffer.from(saved.key, "base64")), "base64");
    const privateKey = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    return { privateKey, id: saved.id };
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const id = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
  const der = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ id, key: safeStorage.encryptString(der).toString("base64") }), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return { privateKey, id };
}

const DEFAULTS = { server: DEFAULT_SERVER, joined: false, donate: {}, dailyCap: 50000, day: "", usedToday: 0 };

function createSettings(file, now = () => Date.now()) {
  const read = () => {
    try {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, "utf8")) };
    } catch {
      return { ...DEFAULTS };
    }
  };
  const write = (s) => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return s;
  };
  const today = () => new Date(now()).toISOString().slice(0, 10);
  return {
    get() {
      const s = read();
      if (s.day !== today()) Object.assign(s, { day: today(), usedToday: 0 });
      return s;
    },
    update(patch) {
      const s = this.get();
      if ("server" in patch) {
        const url = new URL(String(patch.server));
        const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
        if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
          throw new Error(tr("품앗이 서버 주소는 https여야 합니다."));
        if (url.origin !== new URL(s.server).origin) s.joined = false;
        s.server = url.origin;
      }
      if ("donate" in patch)
        s.donate = Object.fromEntries(Object.keys(DONATABLE).map((h) => [h, patch.donate?.[h] === true]));
      if ("dailyCap" in patch) {
        const cap = Math.floor(Number(patch.dailyCap));
        if (!Number.isFinite(cap) || cap < 0 || cap > 10_000_000) throw new Error(tr("하루 한도가 올바르지 않습니다."));
        s.dailyCap = cap;
      }
      if ("joined" in patch) s.joined = patch.joined === true;
      return write(s);
    },
    addUsed(tokens) {
      const s = this.get();
      s.usedToday += tokens;
      return write(s);
    },
  };
}

// ---------- relay client ----------

function createClient({ server, identity, fetchImpl = fetch, now = () => Date.now() }) {
  return async function api(method, route, body) {
    const raw = body === undefined ? "" : JSON.stringify(body);
    const ts = String(now());
    const digest = crypto.createHash("sha256").update(raw).digest("hex");
    const sig = crypto.sign(null, Buffer.from(`${method}\n${route}\n${ts}\n${digest}`), identity.privateKey).toString("base64url");
    let res;
    try {
      res = await fetchImpl(`${server}${route}`, {
        method,
        headers: {
          "content-type": "application/json",
          "x-pumasi-id": identity.id,
          "x-pumasi-ts": ts,
          "x-pumasi-sig": sig,
        },
        body: raw || undefined,
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw Object.assign(new Error(tr("품앗이 서버에 연결하지 못했습니다.")), { transient: true });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(relayMessage(data.error, res.status)), { status: res.status, code: data.error });
    return data;
  };
}

function relayMessage(code, status) {
  const known = {
    invite: tr("초대 코드가 맞지 않습니다."),
    "join first": tr("먼저 품앗이에 가입하세요."),
    "no points": tr("점수가 없습니다. 다른 사람을 도와 점수를 모으세요."),
    taken: tr("다른 사람이 먼저 맡았습니다."),
    "one at a time": tr("한 번에 하나씩만 도울 수 있습니다."),
    "too many jobs": tr("동시에 올릴 수 있는 일은 3개까지입니다."),
    clock: tr("기기 시계가 맞지 않습니다. 시간을 자동으로 맞추세요."),
  };
  return known[code] ?? tr("품앗이 서버 오류 ({status})", { status });
}

// ---------- posting: what the poster must not send ----------

const PRIVATE = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /(?<!\d)(?:\+?82[- ]?)?0?1[016789][- ]?\d{3,4}[- ]?\d{4}(?!\d)/,
  /(?<!\d)\d{6}[- ]?[1-4]\d{6}(?!\d)/,
];

/** Why this text must not leave the device, or "". */
function privateReason(text) {
  if (redact(text, {}) !== text) return tr("키처럼 보이는 문자열");
  if (PRIVATE[0].test(text)) return tr("이메일 주소");
  if (PRIVATE[1].test(text)) return tr("전화번호");
  if (PRIVATE[2].test(text)) return tr("주민등록번호");
  return "";
}

// ---------- helping ----------

/** Only the free-host keys the helper chose to donate. Paid keys are never used for others. */
function donatedEnv(env, donate) {
  const out = {};
  for (const [host, name] of Object.entries(DONATABLE)) if (donate?.[host] && env[name]) out[name] = env[name];
  return out;
}

/**
 * Take one open slot, wait for its sealed task, run it with the donated keys and send back the
 * sealed result. onProgress gets states and token counts only, never text.
 */
async function help(slotId, { api, env, settings, request, onProgress = () => {}, sleep, now = () => Date.now() }) {
  const s = settings.get();
  const donated = donatedEnv(env, s.donate);
  if (!Object.keys(donated).length) throw new Error(tr("기부할 무료 제공자 키를 먼저 켜세요."));
  if (s.usedToday >= s.dailyCap) throw new Error(tr("오늘 기부 한도를 다 썼습니다."));
  const keys = boxKeys();
  await api("POST", `/v1/slots/${slotId}/claim`, { helperKey: keys.publicRaw });
  onProgress({ slotId, state: "claimed" });
  let task;
  const until = now() + 110_000;
  while (now() < until) {
    const r = await api("GET", `/v1/slots/${slotId}/task`);
    if (r.state === "sent") {
      task = r;
      break;
    }
    if (r.state !== "claimed") throw new Error(tr("올린 사람이 작업을 거두었습니다."));
    await sleep(1500);
  }
  if (!task) {
    await api("POST", `/v1/slots/${slotId}/release`).catch(() => {});
    throw new Error(tr("올린 사람의 앱이 응답하지 않습니다."));
  }
  onProgress({ slotId, state: "working" });
  let text;
  let tokens = 0;
  try {
    const prompt = open(task.sealed, keys, `${slotId}|task`);
    const done = await request(
      { action: "work", model: "auto-free", text: prompt.slice(0, 20000), context: [], maxOutputTokens: HELP_MAX_OUTPUT },
      { env: donated, timeoutMs: 180_000 },
    );
    tokens = (done.inputTokens ?? 0) + (done.outputTokens ?? 0);
    text = redact(done.text ?? "", { ...env, ...donated });
    if (!text.trim()) throw new Error(tr("모델이 빈 답을 보냈습니다."));
  } catch (error) {
    await api("POST", `/v1/slots/${slotId}/release`).catch(() => {});
    throw new Error(redact(error?.message ?? String(error), env));
  }
  const sealed = seal(text, task.jobKey, `${slotId}|result`);
  const r = await api("POST", `/v1/slots/${slotId}/result`, { sealed, tokens });
  settings.addUsed(r.tokens);
  onProgress({ slotId, state: "done", tokens: r.tokens });
  return { tokens: r.tokens };
}

// ---------- posting: the remote worker for team mode ----------

/**
 * Post tasks, seal each one for whoever claims it, and collect the results.
 * Returns Map(taskIndex -> [text, ...]) with every result that arrived before the deadline.
 */
async function runRemote(prompts, { api, copies = 2, onProgress = () => {}, sleep, now = () => Date.now(), waitMs = 300_000, signal }) {
  for (const p of prompts) {
    const why = privateReason(p);
    if (why) throw new Error(tr("작업에 {what}이(가) 있어 품앗이에 올리지 않았습니다. 지우고 다시 하세요.", { what: why }));
  }
  const keys = boxKeys();
  const job = await api("POST", "/v1/jobs", { copies, tasks: prompts.map((p) => Math.max(1, p.length)), jobKey: keys.publicRaw });
  const results = new Map(prompts.map((_, i) => [i, []]));
  const sent = new Set();
  const got = new Set();
  const total = prompts.length * copies;
  const deadline = now() + waitMs;
  try {
    while (now() < deadline && got.size < total && !signal?.aborted) {
      const { slots } = await api("GET", `/v1/jobs/${job.jobId}`);
      for (const s of slots) {
        if (s.state === "claimed" && !sent.has(`${s.slotId}|${s.helperKey}`)) {
          await api("POST", `/v1/slots/${s.slotId}/task`, { sealed: seal(prompts[s.task], s.helperKey, `${s.slotId}|task`) });
          sent.add(`${s.slotId}|${s.helperKey}`);
        }
        if (s.state === "done" && !got.has(s.slotId)) {
          const r = await api("GET", `/v1/slots/${s.slotId}/result`);
          got.add(s.slotId);
          try {
            results.get(s.task).push(open(r.sealed, keys, `${s.slotId}|result`));
          } catch {
            // A result that does not open is dropped, like a wrong answer.
          }
        }
      }
      onProgress({
        stage: "pumasi",
        open: slots.filter((s) => s.state === "open").length,
        working: slots.filter((s) => s.state === "claimed" || s.state === "sent").length,
        done: got.size,
        total,
      });
      // Enough when every task has at least one result and nobody is still working.
      const busy = slots.some((s) => s.state === "claimed" || s.state === "sent");
      if ([...results.values()].every((r) => r.length) && !busy) break;
      await sleep(1500);
    }
  } finally {
    await api("DELETE", `/v1/jobs/${job.jobId}`).catch(() => {});
  }
  return results;
}

module.exports = {
  DONATABLE,
  DEFAULT_SERVER,
  seal,
  open,
  boxKeys,
  loadIdentity,
  createSettings,
  createClient,
  privateReason,
  donatedEnv,
  help,
  runRemote,
};
