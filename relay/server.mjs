// Pumasi relay: passes sealed tasks and results between apps and keeps the points ledger.
// It never sees keys, prompts or answers: every task and result arrives encrypted for one device.
import http from "node:http";
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");
const CLOCK_SKEW_MS = 120_000;
const CLAIM_TTL_MS = 120_000; // claimed but the poster never sent the task
const WORK_TTL_MS = 600_000; // task sent but no result
const JOB_TTL_MS = 3_600_000;
const POSTER_GONE_MS = 30_000; // the poster's app stopped checking in: hide its slots
const POSTER_DEAD_MS = 120_000; // and then drop the job
const MAX_BODY = 512 * 1024;
const MAX_SEALED = 400_000;
const MAX_TOKENS = 32_000;
const RATE_PER_MIN = 240;

const b64 = /^[A-Za-z0-9_-]+$/;
const fail = (status, message) => Object.assign(new Error(message), { status });

/** A 32-byte public key sent as base64url, or an error. */
function rawKey(value, prefix, what) {
  if (typeof value !== "string" || !b64.test(value)) throw fail(400, `bad ${what}`);
  const raw = Buffer.from(value, "base64url");
  if (raw.length !== 32) throw fail(400, `bad ${what}`);
  createPublicKey({ key: Buffer.concat([prefix, raw]), format: "der", type: "spki" });
  return value;
}

function sealedOk(s) {
  if (!s || typeof s !== "object") return false;
  return ["epk", "iv", "ct", "tag"].every(
    (k) => typeof s[k] === "string" && b64.test(s[k]) && s[k].length <= MAX_SEALED,
  );
}

export function createRelay({ file = ":memory:", invites = [], grant = 20_000, now = Date.now } = {}) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, credits INTEGER NOT NULL, helped INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, job_key TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS slots (id TEXT PRIMARY KEY, job TEXT NOT NULL, task INTEGER NOT NULL, copy INTEGER NOT NULL, size INTEGER NOT NULL,
      state TEXT NOT NULL, helper TEXT, helper_key TEXT, sealed_task TEXT, sealed_result TEXT, tokens INTEGER, updated INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS slots_state ON slots(state);
    CREATE INDEX IF NOT EXISTS slots_job ON slots(job);
  `);
  const q = (sql) => db.prepare(sql);
  const seen = new Map(); // recent signatures, to refuse replays inside the clock window
  const hits = new Map(); // requests per id per minute

  function sweep() {
    const t = now();
    q(`UPDATE slots SET state='open', helper=NULL, helper_key=NULL, updated=? WHERE state='claimed' AND updated<?`).run(t, t - CLAIM_TTL_MS);
    q(`UPDATE slots SET state='open', helper=NULL, helper_key=NULL, sealed_task=NULL, updated=? WHERE state='sent' AND updated<?`).run(t, t - WORK_TTL_MS);
    for (const { id } of q(`SELECT id FROM jobs WHERE created<? OR seen<?`).all(t - JOB_TTL_MS, t - POSTER_DEAD_MS)) dropJob(id);
    for (const [sig, at] of seen) if (at < t - CLOCK_SKEW_MS * 2) seen.delete(sig);
    for (const [id, h] of hits) if (h.minute !== Math.floor(t / 60000)) hits.delete(id);
  }
  function dropJob(id) {
    q(`DELETE FROM slots WHERE job=?`).run(id);
    q(`DELETE FROM jobs WHERE id=?`).run(id);
  }

  /** Who signed this request. Throws on a bad, stale or replayed signature. */
  function authenticate(req, body) {
    const id = req.headers["x-pumasi-id"];
    const ts = Number(req.headers["x-pumasi-ts"]);
    const sig = req.headers["x-pumasi-sig"];
    if (typeof id !== "string" || typeof sig !== "string" || !b64.test(sig)) throw fail(401, "unsigned");
    rawKey(id, SPKI_ED25519, "id");
    if (!Number.isFinite(ts) || Math.abs(now() - ts) > CLOCK_SKEW_MS) throw fail(401, "clock");
    const digest = createHash("sha256").update(body).digest("hex");
    const message = Buffer.from(`${req.method}\n${req.url}\n${ts}\n${digest}`);
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(id, "base64url")]), format: "der", type: "spki" });
    if (!verify(null, message, key, Buffer.from(sig, "base64url"))) throw fail(401, "signature");
    if (seen.has(sig)) throw fail(401, "replay");
    seen.set(sig, now());
    const minute = Math.floor(now() / 60000);
    const h = hits.get(id) ?? { minute, n: 0 };
    if (h.minute !== minute) Object.assign(h, { minute, n: 0 });
    if (++h.n > RATE_PER_MIN) throw fail(429, "slow down");
    hits.set(id, h);
    return id;
  }

  const user = (id) => q(`SELECT * FROM users WHERE id=?`).get(id);
  const member = (id) => user(id) ?? (() => { throw fail(403, "join first"); })();
  const slotOf = (id) => {
    if (typeof id !== "string" || !b64.test(id)) throw fail(404, "no slot");
    return q(`SELECT slots.*, jobs.owner, jobs.job_key FROM slots JOIN jobs ON jobs.id=slots.job WHERE slots.id=?`).get(id) ?? (() => { throw fail(404, "no slot"); })();
  };
  const jobOf = (id, owner) => {
    const job = typeof id === "string" && q(`SELECT * FROM jobs WHERE id=?`).get(id);
    if (!job || job.owner !== owner) throw fail(404, "no job");
    return job;
  };
  const me = (u) => ({ credits: u.credits, helped: u.helped, used: u.used });

  const routes = [
    ["POST", /^\/v1\/join$/, (id, body) => {
      const existing = user(id);
      if (existing) return me(existing);
      if (!invites.includes(body.invite)) throw fail(403, "invite");
      q(`INSERT INTO users (id, credits, created) VALUES (?, ?, ?)`).run(id, grant, now());
      return me(user(id));
    }],
    ["GET", /^\/v1\/me$/, (id) => me(member(id))],
    ["POST", /^\/v1\/jobs$/, (id, body) => {
      const u = member(id);
      if (u.credits <= 0) throw fail(402, "no points");
      const copies = body.copies;
      const tasks = body.tasks;
      if (!Number.isInteger(copies) || copies < 1 || copies > 3) throw fail(400, "copies");
      if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 6 || tasks.some((s) => !Number.isInteger(s) || s < 1 || s > 200_000)) throw fail(400, "tasks");
      const jobKey = rawKey(body.jobKey, SPKI_X25519, "jobKey");
      if (q(`SELECT COUNT(*) AS n FROM jobs WHERE owner=?`).get(id).n >= 3) throw fail(429, "too many jobs");
      const job = randomUUID();
      q(`INSERT INTO jobs (id, owner, job_key, created, seen) VALUES (?, ?, ?, ?, ?)`).run(job, id, jobKey, now(), now());
      const slots = [];
      tasks.forEach((size, task) => {
        for (let copy = 0; copy < copies; copy++) {
          const slot = randomUUID();
          q(`INSERT INTO slots (id, job, task, copy, size, state, updated) VALUES (?, ?, ?, ?, ?, 'open', ?)`).run(slot, job, task, copy, size, now());
          slots.push({ slotId: slot, task, copy });
        }
      });
      return { jobId: job, slots };
    }],
    ["GET", /^\/v1\/jobs\/([\w-]+)$/, (id, _b, [job]) => {
      jobOf(job, id);
      q(`UPDATE jobs SET seen=? WHERE id=?`).run(now(), job);
      return {
        slots: q(`SELECT id, task, copy, state, helper_key, tokens FROM slots WHERE job=? ORDER BY task, copy`).all(job).map((s) => ({
          slotId: s.id, task: s.task, copy: s.copy, state: s.state, helperKey: s.state === "claimed" ? s.helper_key : undefined, tokens: s.tokens ?? undefined,
        })),
      };
    }],
    ["DELETE", /^\/v1\/jobs\/([\w-]+)$/, (id, _b, [job]) => {
      jobOf(job, id);
      dropJob(job);
      return { ok: true };
    }],
    ["POST", /^\/v1\/slots\/([\w-]+)\/task$/, (id, body, [slot]) => {
      const s = slotOf(slot);
      if (s.owner !== id) throw fail(404, "no slot");
      if (s.state !== "claimed") throw fail(409, "not claimed");
      if (!sealedOk(body.sealed)) throw fail(400, "sealed");
      q(`UPDATE slots SET state='sent', sealed_task=?, updated=? WHERE id=?`).run(JSON.stringify(body.sealed), now(), slot);
      return { ok: true };
    }],
    ["GET", /^\/v1\/slots\/([\w-]+)\/result$/, (id, _b, [slot]) => {
      const s = slotOf(slot);
      if (s.owner !== id) throw fail(404, "no slot");
      if (s.state !== "done") return { state: s.state };
      return { state: "done", sealed: JSON.parse(s.sealed_result), tokens: s.tokens };
    }],
    ["GET", /^\/v1\/open$/, (id) => {
      member(id);
      // Never offer your own work, or a second copy of a task you already took.
      return {
        slots: q(`SELECT slots.id, slots.size, slots.updated FROM slots JOIN jobs ON jobs.id=slots.job
          WHERE slots.state='open' AND jobs.owner<>? AND jobs.seen>=?
          AND NOT EXISTS (SELECT 1 FROM slots o WHERE o.job=slots.job AND o.task=slots.task AND o.helper=?)
          ORDER BY slots.updated LIMIT 50`).all(id, now() - POSTER_GONE_MS, id).map((s) => ({ slotId: s.id, size: s.size, postedAt: s.updated })),
      };
    }],
    ["POST", /^\/v1\/slots\/([\w-]+)\/claim$/, (id, body, [slot]) => {
      member(id);
      const helperKey = rawKey(body.helperKey, SPKI_X25519, "helperKey");
      const s = slotOf(slot);
      if (s.owner === id) throw fail(409, "own job");
      if (s.state !== "open") throw fail(409, "taken");
      if (q(`SELECT COUNT(*) AS n FROM slots WHERE helper=? AND state IN ('claimed','sent')`).get(id).n) throw fail(409, "one at a time");
      if (q(`SELECT 1 FROM slots WHERE job=? AND task=? AND helper=?`).get(s.job, s.task, id)) throw fail(409, "taken");
      const r = q(`UPDATE slots SET state='claimed', helper=?, helper_key=?, updated=? WHERE id=? AND state='open'`).run(id, helperKey, now(), slot);
      if (!r.changes) throw fail(409, "taken");
      return { ok: true };
    }],
    ["GET", /^\/v1\/slots\/([\w-]+)\/task$/, (id, _b, [slot]) => {
      const s = slotOf(slot);
      if (s.helper !== id) throw fail(404, "no slot");
      if (s.state !== "sent") return { state: s.state };
      return { state: "sent", sealed: JSON.parse(s.sealed_task), jobKey: s.job_key };
    }],
    ["POST", /^\/v1\/slots\/([\w-]+)\/result$/, (id, body, [slot]) => {
      const s = slotOf(slot);
      if (s.helper !== id || s.state !== "sent") throw fail(409, "not yours");
      if (!sealedOk(body.sealed)) throw fail(400, "sealed");
      const tokens = Math.max(0, Math.min(MAX_TOKENS, Math.floor(Number(body.tokens) || 0)));
      db.exec("BEGIN");
      try {
        q(`UPDATE slots SET state='done', sealed_result=?, sealed_task=NULL, tokens=?, updated=? WHERE id=?`).run(JSON.stringify(body.sealed), tokens, now(), slot);
        q(`UPDATE users SET credits=credits+?, helped=helped+1 WHERE id=?`).run(tokens, id);
        q(`UPDATE users SET credits=credits-?, used=used+? WHERE id=?`).run(tokens, tokens, s.owner);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return { ok: true, tokens };
    }],
    ["POST", /^\/v1\/slots\/([\w-]+)\/release$/, (id, _b, [slot]) => {
      const s = slotOf(slot);
      if (s.helper !== id || !["claimed", "sent"].includes(s.state)) throw fail(409, "not yours");
      q(`UPDATE slots SET state='open', helper=NULL, helper_key=NULL, sealed_task=NULL, updated=? WHERE id=?`).run(now(), slot);
      return { ok: true };
    }],
  ];

  async function handle(req, res) {
    const send = (status, value) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > MAX_BODY) throw fail(413, "too large");
        chunks.push(c);
      }
      const raw = Buffer.concat(chunks);
      sweep();
      const id = authenticate(req, raw);
      let body = {};
      if (raw.length) {
        try { body = JSON.parse(raw.toString("utf8")); } catch { throw fail(400, "json"); }
        if (!body || typeof body !== "object" || Array.isArray(body)) throw fail(400, "json");
      }
      for (const [method, pattern, fn] of routes) {
        const m = req.method === method && req.url.match(pattern);
        if (m) return send(200, fn(id, body, m.slice(1)));
      }
      throw fail(404, "not found");
    } catch (error) {
      send(error.status ?? 500, { error: error.status ? error.message : "server" });
    }
  }
  return { handle, db, sweep };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const invites = (process.env.PUMASI_INVITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const relay = createRelay({ file: process.env.PUMASI_DB ?? "pumasi.db", invites, grant: Number(process.env.PUMASI_GRANT ?? 20000) });
  http.createServer(relay.handle).listen(Number(process.env.PORT ?? 8787), () => console.log("pumasi relay ready"));
}
