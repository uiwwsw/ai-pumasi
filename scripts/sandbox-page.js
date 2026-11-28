// Runs one model-written program and reports what it printed. This page is loaded in an iframe
// with sandbox="allow-scripts" (its own origin: no storage, no access to the app) under a policy
// that allows no network at all. The program runs in a worker made from text, which inherits that
// policy, so a loop cannot freeze the app and nothing it does can leave this frame.
(() => {
  const WRAP = (code) => `
const __out = [];
let __size = 0;
const __show = (v) => {
  if (typeof v === "string") return v;
  if (typeof v === "bigint") return v.toString();
  try { return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)); } catch { return String(v); }
};
const __log = (...a) => {
  if (__size > 8000) return;
  const line = a.map(__show).join(" ");
  __size += line.length + 1;
  __out.push(line);
};
const console = { log: __log, info: __log, warn: __log, error: __log, debug: __log };
(async () => {
  try {
    await (async () => {
${code}
    })();
    postMessage({ ok: true, out: __out.join("\\n").slice(0, 8000) });
  } catch (e) {
    postMessage({ ok: false, out: __out.join("\\n").slice(0, 8000), error: String(e && e.message ? e.message : e).slice(0, 500) });
  }
})();
`;
  let busy = false;
  addEventListener("message", (event) => {
    const d = event.data;
    // Only the page that embeds this frame may ask, one program at a time.
    if (event.source !== parent || !d || d.type !== "run" || typeof d.code !== "string" || busy) return;
    busy = true;
    const reply = (result) => {
      busy = false;
      parent.postMessage({ type: "ran", id: d.id, ...result }, "*");
    };
    let worker;
    const url = URL.createObjectURL(new Blob([WRAP(d.code)], { type: "text/javascript" }));
    const done = (result) => {
      clearTimeout(timer);
      worker?.terminate();
      URL.revokeObjectURL(url);
      reply(result);
    };
    const timer = setTimeout(
      () => done({ ok: false, out: "", error: "timeout" }),
      Math.min(60000, Math.max(1000, Number(d.timeoutMs) || 15000)),
    );
    try {
      worker = new Worker(url);
      worker.onmessage = (m) =>
        done({ ok: m.data?.ok === true, out: String(m.data?.out ?? ""), error: m.data?.error });
      worker.onerror = (e) => {
        e.preventDefault?.();
        done({ ok: false, out: "", error: String(e.message || "program error").slice(0, 500) });
      };
    } catch (e) {
      done({ ok: false, out: "", error: String(e?.message ?? e).slice(0, 500) });
    }
  });
  parent.postMessage({ type: "sandbox-ready" }, "*");
})();
