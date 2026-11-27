// Code mode agent: the model works in the folder the user opened, one step at a time.
// Reading, listing and searching run on their own. Saving a file or running a command waits for
// the user's approval in the window, every time.
const { tr } = require("./i18n.cjs");

const MAX_STEPS = 20;
const RESULT_CHARS = 18000; // what one step's results may add to the next request
const OLD_RESULT_CHARS = 3000; // earlier steps are cut to this once they are history

/**
 * Actions in a model reply, in order. One per line:
 *   <<<LIST path>>>   <<<READ path>>>   <<<SEARCH text>>>   <<<RUN command>>>
 * and file writes:
 *   <<<FILE path
 *   full content
 *   >>>FILE
 * Returns {actions, prose}: prose is the reply without the action lines.
 */
function parseActions(reply) {
  const text = String(reply ?? "");
  const actions = [];
  const keep = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const one = /^\s*<<<(LIST|READ|SEARCH|RUN)\s+(.*?)>>>\s*$/.exec(line);
    if (one) {
      actions.push({ kind: one[1].toLowerCase(), arg: one[2].trim() });
      continue;
    }
    const file = /^\s*<<<FILE\s+(.+?)\s*$/.exec(line);
    if (file) {
      const end = lines.findIndex((l, j) => j > i && /^\s*>>>FILE\s*$/.test(l));
      const reopen = lines.findIndex((l, j) => j > i && /^\s*<<<FILE\s/.test(l));
      if (end !== -1 && (reopen === -1 || reopen > end)) {
        const body = lines.slice(i + 1, end);
        actions.push({
          kind: "write",
          arg: file[1].trim(),
          text: body.length ? body.join("\n") + "\n" : "",
        });
        i = end;
        continue;
      }
    }
    keep.push(line);
  }
  return {
    actions,
    prose: keep.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

const numbered = (text) =>
  text
    .split("\n")
    .map((l, i) => `${String(i + 1).padStart(4)}  ${l}`)
    .join("\n");

/**
 * What to show while a reply streams: the prose so far, without action lines, finished file
 * blocks, or a file block that is still being written.
 */
function draftProse(text) {
  const s = String(text ?? "");
  const open = s.lastIndexOf("<<<FILE");
  const closed = s.lastIndexOf(">>>FILE");
  const visible = open > closed ? s.slice(0, open) : s;
  return parseActions(visible.replace(/<<<[A-Z]*[^\n>]*$/, "")).prose;
}

const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…(${s.length - n} chars cut)` : s);

/**
 * @param {{text:string, history:{role:"user"|"assistant", text:string}[], model:string, autoOrder?:string[]}} p
 * @param {{request:Function, workspace:object, exec:(cmd:string)=>Promise<{code:number|null, output:string}>,
 *   ask:(e:object)=>Promise<boolean>, emit:(e:object)=>void, stopped?:()=>boolean, maxSteps?:number}} io
 */
async function runAgent(p, io) {
  const { request, workspace, exec, ask, emit } = io;
  const stopped = io.stopped ?? (() => false);
  const maxSteps = io.maxSteps ?? MAX_STEPS;
  const folder = workspace.current();
  if (!folder) throw new Error(tr("먼저 폴더를 열어 주세요."));
  const top = workspace
    .list("")
    .map((e) => (e.dir ? `${e.path}/` : e.path))
    .join("\n");
  const context = [
    {
      role: "user",
      text: `Project folder: ${folder.name}\nTop level:\n${cut(top, 4000)}`,
    },
    { role: "assistant", text: "OK" },
    ...p.history.slice(-8),
  ];
  const usage = { in: 0, out: 0 };
  let ask_text = p.text;
  let steps = 0;
  let id = 0;
  for (;;) {
    if (stopped()) {
      emit({ type: "stopped" });
      break;
    }
    if (steps >= maxSteps) {
      emit({ type: "limit", steps });
      break;
    }
    steps++;
    emit({ type: "thinking", step: steps });
    // Show the reply as it is written, at most ~12 times a second.
    let shown = "";
    let lastDraft = 0;
    const onDelta = (sofar) => {
      const now = Date.now();
      if (now - lastDraft < 80) return;
      const prose = draftProse(sofar);
      if (prose === shown) return;
      lastDraft = now;
      shown = prose;
      emit({ type: "draft", text: prose });
    };
    const r = await request(
      {
        action: "agent",
        model: p.model,
        text: ask_text,
        context,
        maxOutputTokens: 16000,
        autoOrder: p.autoOrder,
      },
      { onDelta },
    );
    usage.in += r.inputTokens ?? 0;
    usage.out += r.outputTokens ?? 0;
    const { actions, prose } = parseActions(r.text);
    if (prose) emit({ type: "say", text: prose, model: r.modelId ?? p.model });
    if (!actions.length) break;
    const results = [];
    for (const a of actions) {
      if (stopped()) break;
      const n = ++id;
      try {
        if (a.kind === "list") {
          const rel = a.arg === "." ? "" : a.arg;
          const entries = workspace.list(rel);
          emit({ type: "tool", id: n, kind: "list", path: rel || ".", count: entries.length });
          results.push(
            `LIST ${a.arg}\n${entries.map((e) => (e.dir ? `${e.path}/` : e.path)).join("\n") || "(empty)"}`,
          );
        } else if (a.kind === "read") {
          const f = workspace.read(a.arg);
          emit({ type: "tool", id: n, kind: "read", path: a.arg, lines: f.text.split("\n").length });
          results.push(`READ ${a.arg}\n${cut(numbered(f.text), 12000)}`);
        } else if (a.kind === "search") {
          const hits = workspace.search(a.arg);
          emit({ type: "tool", id: n, kind: "search", query: a.arg, count: hits.length });
          results.push(
            `SEARCH ${a.arg}\n${hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n") || "(no matches)"}`,
          );
        } else if (a.kind === "write") {
          let before = "";
          let existed = false;
          try {
            before = workspace.read(a.arg).text;
            existed = true;
          } catch {}
          emit({ type: "edit", id: n, path: a.arg, before, after: a.text, existed });
          if (await ask({ id: n, kind: "edit" })) {
            workspace.write(a.arg, a.text);
            // Remember what was there so the user can undo this one change later.
            io.saved?.({ id: n, path: a.arg, before, after: a.text, existed });
            emit({ type: "edit-done", id: n, saved: true });
            results.push(`FILE ${a.arg}: saved`);
          } else {
            emit({ type: "edit-done", id: n, saved: false });
            results.push(`FILE ${a.arg}: the user declined this change`);
          }
        } else if (a.kind === "run") {
          emit({ type: "run", id: n, command: a.arg });
          if (await ask({ id: n, kind: "run" })) {
            const out = await exec(a.arg);
            emit({ type: "run-done", id: n, code: out.code, output: cut(out.output, 20000) });
            results.push(`RUN ${a.arg}\nexit code ${out.code}\n${cut(out.output, 8000)}`);
          } else {
            emit({ type: "run-done", id: n, declined: true });
            results.push(`RUN ${a.arg}: the user declined to run this`);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: "tool-error", id: n, kind: a.kind, arg: a.arg, error: message });
        results.push(`${a.kind.toUpperCase()} ${a.arg}: error: ${message}`);
      }
    }
    // Older results only need to remind the model what happened; the newest ones go in full.
    for (const m of context)
      if (m.role === "user" && m.text.startsWith("Results:\n"))
        m.text = cut(m.text, OLD_RESULT_CHARS);
    context.push({ role: "user", text: ask_text.startsWith("Results:\n") ? cut(ask_text, OLD_RESULT_CHARS) : ask_text });
    context.push({ role: "assistant", text: cut(r.text, 6000) });
    ask_text = cut(`Results:\n${results.join("\n\n")}`, RESULT_CHARS);
  }
  emit({ type: "done", usage, steps });
  return { usage, steps };
}

module.exports = { runAgent, parseActions, draftProse };
