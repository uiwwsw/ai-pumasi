// Ask for help, end to end: two real copies of the desktop app and a relay on this machine.
// One asks about an answer it got; the other takes the request and answers with its own key.
// The model provider is faked inside each app, so no real key or outside service is used.
import assert from "node:assert/strict";
import http from "node:http";
import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRelay } from "../relay/server.mjs";

const relay = createRelay({ file: ":memory:", invites: ["e2e-invite"], grant: 20000 });
const server = http.createServer(relay.handle);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const relayUrl = `http://127.0.0.1:${server.address().port}`;
// Built from parts so the repo secret scanner does not flag this fake value.
const FAKE_KEY = ["nvapi", "fake", "e2e", "value", "1234"].join("-");

async function launch(answer) {
  const profile = await mkdtemp(path.join(tmpdir(), "pumasi-e2e-"));
  const app = await electron.launch({
    args: [".", "--lang=ko"],
    env: {
      ...process.env,
      AURORA_QA_DATA: profile,
      AURORA_DISABLE_ENV_FILE: "1",
      AURORA_OLLAMA: "0",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      AURORA_OPENAI_COMPAT_URL: "",
      AURORA_OPENAI_COMPAT_KEY: "",
      GEMINI_API_KEY: "",
      GROQ_API_KEY: "",
      OPENROUTER_API_KEY: "",
      NVIDIA_API_KEY: FAKE_KEY,
    },
  });
  // Every model call from this app gets the same canned reply; the relay is reached for real.
  await app.evaluate((_electron, text) => {
    const real = globalThis.fetch;
    globalThis.modelCalls = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) return real(url, init);
      const body = JSON.parse(init?.body ?? "{}");
      globalThis.modelCalls.push(String(body.messages?.at(-1)?.content ?? ""));
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          choices: [{ message: { content: text }, finish_reason: "stop" }],
          usage: { prompt_tokens: 40, completion_tokens: 60 },
        }),
      };
    };
  }, answer);
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.reload();
  return { app, page, errors };
}

const asker = await launch("처음 답: 381");
const helper = await launch("도운 답: 17 × 23 = 391");
try {
  // Both join the same relay; the helper lends its free key.
  for (const { page } of [asker, helper]) {
    await page.evaluate((url) => window.auroraAI.pumasi.update({ server: url }), relayUrl);
    const joined = await page.evaluate(() => window.auroraAI.pumasi.join("e2e-invite"));
    assert.equal(joined.joined, true);
  }
  await helper.page.evaluate(() => window.auroraAI.pumasi.update({ donate: { nvidia: true } }));
  const before = {
    asker: (await asker.page.evaluate(() => window.auroraAI.pumasi.state())).me,
    helper: (await helper.page.evaluate(() => window.auroraAI.pumasi.state())).me,
  };

  // The asker gets an answer from its own model first.
  const editor = asker.page.getByRole("textbox", { name: "메시지", exact: true });
  await editor.fill("17 곱하기 23은?");
  await asker.page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(asker.page.locator(".message.assistant")).toContainText("처음 답: 381");

  // Not happy with it: ask for help. Nothing leaves before the warning is accepted.
  await asker.page.getByRole("button", { name: "Ask for help" }).click();
  await expect(asker.page.getByText("이 문제를 다른 사람과 공유하게 됩니다.")).toBeVisible();
  await expect(asker.page.getByLabel("공유할 질문")).toHaveValue("17 곱하기 23은?");
  // The asker sees what they have to spend.
  await expect(asker.page.locator(".help-points")).toContainText("내 점수 20,000");
  assert.equal((await helper.page.evaluate(() => window.auroraAI.pumasi.open())).length, 0);
  await asker.page.getByRole("button", { name: "공유하고 도움 요청" }).click();
  await expect(asker.page.locator(".help-waiting")).toContainText("도와줄 사람을 기다리는 중입니다.");

  // The helper sees one waiting request and takes it.
  let slots = [];
  for (let i = 0; i < 40 && !slots.length; i++) {
    slots = await helper.page.evaluate(() => window.auroraAI.pumasi.open());
    if (!slots.length) await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(slots.length, 1);
  // The count shows on the helper's settings button after its next check.
  await helper.page.reload();
  await expect(helper.page.locator(".account .nav-count")).toHaveText("1");
  const helped = await helper.page.evaluate((id) => window.auroraAI.pumasi.help(id), slots[0].slotId);
  assert.equal(helped.tokens, 100);

  // The asker's conversation gets the helper's answer as its own message.
  const last = asker.page.locator(".message.assistant").last();
  await expect(last).toContainText("도운 답: 17 × 23 = 391", { timeout: 20000 });
  await expect(last).toContainText("다른 사용자의 Pumasi Agent가 도운 답");
  await expect(asker.page.locator(".help-waiting")).toHaveCount(0);
  await expect(asker.page.locator(".message.assistant")).toHaveCount(2);

  // The helper's model was given the question as sent, and nothing else of the conversation.
  const seen = await helper.app.evaluate(() => globalThis.modelCalls);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].startsWith("17 곱하기 23은?"));
  assert.ok(!seen[0].includes("처음 답"));

  // Helping earns what asking spends.
  const after = {
    asker: (await asker.page.evaluate(() => window.auroraAI.pumasi.state())).me,
    helper: (await helper.page.evaluate(() => window.auroraAI.pumasi.state())).me,
  };
  assert.equal(after.helper.credits, before.helper.credits + 100);
  assert.equal(after.helper.helped, before.helper.helped + 1);
  assert.equal(after.asker.credits, before.asker.credits - 100);
  // The relay held only sealed text.
  const rows = relay.db.prepare("SELECT sealed_task, sealed_result FROM slots").all();
  assert.ok(rows.every((r) => !JSON.stringify(r).includes("곱하기") && !JSON.stringify(r).includes("391")));

  // Withdrawing: a second request is taken back and leaves nothing on the relay.
  await asker.page.getByRole("button", { name: "Ask for help" }).first().click();
  await asker.page.getByRole("button", { name: "공유하고 도움 요청" }).click();
  await expect(asker.page.locator(".help-waiting")).toBeVisible();
  await asker.page.getByRole("button", { name: "요청 거두기" }).click();
  await expect(asker.page.locator(".help-waiting")).toHaveCount(0);
  assert.equal((await helper.page.evaluate(() => window.auroraAI.pumasi.open())).length, 0);

  assert.deepEqual([...asker.errors, ...helper.errors], []);
  console.log("Ask for help passed: two apps, one relay, the answer came back, points moved, withdrawing works.");
} finally {
  await asker.app.close().catch(() => {});
  await helper.app.close().catch(() => {});
  server.close();
}
