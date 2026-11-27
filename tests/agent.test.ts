import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { runAgent, parseActions, draftProse } = require("../electron/agent.cjs");
const { createWorkspace } = require("../electron/workspace.cjs");

test("parseActions reads actions in order and keeps the rest as prose", () => {
  const { actions, prose } = parseActions(
    "먼저 봅니다.\n<<<LIST .>>>\n<<<READ src/a.js>>>\n<<<FILE src/a.js\nlet a = 2;\n>>>FILE\n<<<RUN npm test>>>\n끝.",
  );
  assert.deepEqual(
    actions.map((a: any) => [a.kind, a.arg]),
    [["list", "."], ["read", "src/a.js"], ["write", "src/a.js"], ["run", "npm test"]],
  );
  assert.equal(actions[2].text, "let a = 2;\n");
  assert.equal(prose, "먼저 봅니다.\n끝.");
});

test("an unclosed file block is not an action", () => {
  const { actions, prose } = parseActions("<<<FILE a.js\nx\n<<<FILE b.js\ny\n>>>FILE");
  assert.deepEqual(actions.map((a: any) => a.arg), ["b.js"]);
  assert.match(prose, /<<<FILE a\.js/);
});

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/a.js"), "let a = 1;\n");
  const workspace = createWorkspace();
  workspace.allow(root);
  return { root, workspace };
}

async function drive(replies: string[], answers: Record<string, boolean>) {
  const { root, workspace } = project();
  const events: any[] = [];
  const sent: any[] = [];
  const ran: string[] = [];
  let n = 0;
  const result = await runAgent(
    { text: "a를 2로", history: [], model: "auto-free" },
    {
      workspace,
      request: async (req: any) => {
        sent.push(req);
        return { text: replies[n++] ?? "끝.", inputTokens: 10, outputTokens: 3 };
      },
      exec: async (cmd: string) => {
        ran.push(cmd);
        return { code: 0, output: "ok" };
      },
      ask: async ({ id }: any) => {
        const e = events.find((x) => x.id === id && (x.type === "edit" || x.type === "run"));
        return answers[e.type] ?? false;
      },
      emit: (e: any) => events.push(e),
    },
  );
  return { root, events, sent, ran, result };
}

test("the agent reads on its own, saves only an approved change, and feeds results back", async () => {
  const { root, events, sent, ran, result } = await drive(
    [
      "<<<READ src/a.js>>>",
      "<<<FILE src/a.js\nlet a = 2;\n>>>FILE\n<<<RUN node -v>>>",
      "a를 2로 바꿨습니다.",
    ],
    { edit: true, run: false },
  );
  assert.equal(fs.readFileSync(path.join(root, "src/a.js"), "utf8"), "let a = 2;\n");
  assert.deepEqual(ran, []);
  assert.match(sent[1].text, /READ src\/a\.js\n\s+1  let a = 1;/);
  assert.match(sent[2].text, /FILE src\/a\.js: saved/);
  assert.match(sent[2].text, /declined to run/);
  assert.equal(events.find((e) => e.type === "edit").before, "let a = 1;\n");
  assert.equal(result.steps, 3);
  assert.deepEqual(result.usage, { in: 30, out: 9 });
});

test("a declined change is not written", async () => {
  const { root, sent } = await drive(["<<<FILE src/a.js\nlet a = 9;\n>>>FILE", "그만둡니다."], {});
  assert.equal(fs.readFileSync(path.join(root, "src/a.js"), "utf8"), "let a = 1;\n");
  assert.match(sent[1].text, /declined this change/);
});

test("errors come back to the model instead of ending the run", async () => {
  const { sent, events } = await drive(["<<<READ ../etc/passwd>>>", "못 엽니다."], {});
  assert.match(sent[1].text, /READ \.\.\/etc\/passwd: error/);
  assert.ok(events.some((e) => e.type === "tool-error"));
});

test("the run stops at the step limit", async () => {
  const { workspace } = project();
  const events: any[] = [];
  const r = await runAgent(
    { text: "x", history: [], model: "auto-free" },
    {
      workspace,
      maxSteps: 3,
      request: async () => ({ text: "<<<LIST .>>>" }),
      exec: async () => ({ code: 0, output: "" }),
      ask: async () => false,
      emit: (e: any) => events.push(e),
    },
  );
  assert.equal(r.steps, 3);
  assert.ok(events.some((e) => e.type === "limit"));
});

test("a streaming reply shows only its prose, never a file block being written", () => {
  assert.equal(draftProse("먼저 봅니다.\n<<<READ src/a.js>>>"), "먼저 봅니다.");
  assert.equal(draftProse("고칩니다.\n<<<FILE src/a.js\nlet a ="), "고칩니다.");
  assert.equal(draftProse("고칩니다.\n<<<FILE src/a.js\nx\n>>>FILE\n끝."), "고칩니다.\n끝.");
  // An action line cut off mid-way is hidden too.
  assert.equal(draftProse("봅니다.\n<<<REA"), "봅니다.");
});

test("drafts stream while the model writes, and each saved change is remembered for undo", async () => {
  const { workspace, root } = project();
  const events: any[] = [];
  const saved: any[] = [];
  let n = 0;
  await runAgent(
    { text: "x", history: [], model: "auto-free" },
    {
      workspace,
      request: async (_req: any, extra: any) => {
        n++;
        if (n === 1) {
          extra.onDelta("새 파일을 만듭니다.");
          return { text: "새 파일을 만듭니다.\n<<<FILE src/b.js\nb\n>>>FILE\n<<<FILE src/a.js\nlet a = 3;\n>>>FILE" };
        }
        return { text: "끝." };
      },
      exec: async () => ({ code: 0, output: "" }),
      ask: async () => true,
      emit: (e: any) => events.push(e),
      saved: (e: any) => saved.push(e),
    },
  );
  assert.equal(events.find((e) => e.type === "draft").text, "새 파일을 만듭니다.");
  assert.deepEqual(
    saved.map((e) => [e.path, e.existed, e.before]),
    [["src/b.js", false, ""], ["src/a.js", true, "let a = 1;\n"]],
  );
  assert.equal(fs.readFileSync(path.join(root, "src/b.js"), "utf8"), "b\n");
  // Undoing a created file removes it; the folder rules still apply.
  workspace.remove("src/b.js");
  assert.equal(fs.existsSync(path.join(root, "src/b.js")), false);
  assert.throws(() => workspace.remove("../outside.js"));
});
