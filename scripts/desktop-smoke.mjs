import assert from "node:assert/strict";
import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
const profile = await mkdtemp(path.join(tmpdir(), "aurora-qa-"));
await mkdir("artifacts", { recursive: true });
const errors = [];
let app;
try {
  app = await electron.launch({
    // The checks below look for Korean labels; pin the UI language.
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
      NVIDIA_API_KEY: "",
      GROQ_API_KEY: "",
      OPENROUTER_API_KEY: "",
    },
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  const editor = page.getByRole("textbox", { name: "메시지", exact: true });
  const send = async (text) => {
    await editor.fill(text);
    await page.getByRole("button", { name: "보내기", exact: true }).click();
  };
  const settings = async () => {
    // The usage panel starts closed after each load.
    if (!(await page.getByLabel("사용량", { exact: true }).isVisible()))
      await page.getByRole("button", { name: "사용량 패널 전환", exact: true }).click();
    await page.getByRole("button", { name: "모드 설정", exact: true }).click();
  };
  const close = () =>
    page.getByRole("button", { name: "닫기", exact: true }).click();
  // No keys: the app asks for one instead of offering a message box that cannot answer.
  await expect(page.getByRole("heading", { name: "API 키를 등록해 주세요" })).toBeVisible();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("button", { name: "OpenRouter로 시작하기" })).toBeVisible();
  const status = await page.evaluate(() => window.auroraAI.status());
  expect(status).toMatchObject({
    openai: false,
    anthropic: false,
    gemini: false,
    ollama: false,
    compat: false,
    auto: false,
  });
  expect(Object.values(status.models).every((v) => v === false)).toBe(true);
  expect(Object.values(status.hosts).every((v) => v === false)).toBe(true);
  // A pasted value that is no provider's key shape is refused before anything is saved or sent.
  const keyBox = page.getByLabel("API 키", { exact: true });
  await keyBox.fill("not-a-key");
  await page.getByRole("button", { name: "등록", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("어느 회사 키인지");
  await page.screenshot({ path: "artifacts/aurora-key-setup.png" });
  // Settings: keys first, models folded under Advanced with Auto as the default.
  await settings();
  await page.getByText("고급: 모델과 팀").click();
  await expect(page.getByLabel("답할 모델", { exact: true })).toHaveValue("auto-free");
  await expect(page.getByText("실제 API 사용", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "artifacts/aurora-model-settings.png" });
  await close();
  // Mock only the IPC provider boundary. No real credentials or provider calls in QA.
  await app.evaluate(({ ipcMain }) => {
    globalThis.auroraTestCalls = [];
    ipcMain.removeHandler("aurora:ai-status");
    ipcMain.handle("aurora:ai-status", () => ({
      openai: true,
      anthropic: true,
      auto: true,
    }));
    ipcMain.removeHandler("aurora:ask");
    ipcMain.handle("aurora:ask", async (event, p) => {
      globalThis.auroraTestCalls.push(p);
      // Stream part of the answer first, the way the real handler does.
      const progress = (e) => event.sender.send("aurora:ask-progress", e);
      progress({ stage: "plan", mode: "direct", effort: "mid" });
      progress({ stage: "part", id: "answer", title: "", state: "running", model: "gpt-6.1-sol" });
      progress({ stage: "think", id: "answer", text: "모의 생각: 먼저 조건을 정리한다" });
      await new Promise((r) => setTimeout(r, 1200));
      event.sender.send("aurora:ai-delta", "모의 스트리밍 일부");
      await new Promise((r) => setTimeout(r, 1500));
      return {
        text: "모의 API 답변\n\n**굵은 글씨** 첫 줄<br>둘째 줄\n\n| 항목 | 값 |\n| --- | --- |\n| 가 | 1<br>2 |",
        mode: "direct",
        effort: "mid",
        model: p.model,
        usage: { route: { in: 0, out: 0 }, work: { in: 34, out: 45 }, check: { in: 0, out: 0 } },
      };
    });
  });
  await page.reload();
  // With a key that can answer, the chat is there.
  await expect(page.getByRole("heading", { name: "무엇을 도와드릴까요?" })).toBeVisible();
  await page.screenshot({ path: "artifacts/aurora-desktop.png" });
  // Enter sends right away: no confirmation dialog, no model to pick.
  await editor.fill("요약해 줘");
  await editor.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // While waiting: which model is thinking, for how long, and about what.
  await expect(page.locator(".ask-progress")).toContainText("생각하는 중");
  await expect(page.locator(".ask-thought")).toContainText("모의 생각");
  await page.screenshot({ path: "artifacts/aurora-thinking.png" });
  // The answer shows while it streams, before the call finishes.
  await expect(page.locator(".message.assistant")).toContainText("모의 스트리밍 일부");
  await page.screenshot({ path: "artifacts/aurora-streaming.png" });
  await expect(page.getByLabel("대화 내용")).toContainText("모의 API 답변");
  await expect(page.locator(".message.assistant")).toContainText("자동");
  // Markdown is drawn, and <br> is a line break instead of text.
  await expect(page.locator(".message.assistant strong")).toHaveText("굵은 글씨");
  await expect(page.locator(".message.assistant td br")).toHaveCount(1);
  await expect(page.locator(".message.assistant").first()).not.toContainText("<br>");
  await expect(page.getByRole("button", { name: "답 복사", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "대화 공유", exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/aurora-markdown.png" });
  await expect(editor).toHaveValue("");
  // Only reported numbers: nothing estimated before sending, real usage after.
  await expect(page.locator(".draft-estimate")).toHaveCount(0);
  await page.getByRole("button", { name: "사용량 패널 전환", exact: true }).click();
  await expect(page.getByLabel("사용량", { exact: true })).toContainText("79");
  await page.screenshot({ path: "artifacts/aurora-answer.png" });
  // A model chosen in Advanced is used for the next question.
  await settings();
  await page.getByText("고급: 모델과 팀").click();
  await page.getByLabel("답할 모델", { exact: true }).selectOption("gpt-6.1-sol");
  await close();
  // A text file rides along with the question: the model gets its content, the chat shows its name.
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("첨부 내용 한 줄"),
  });
  await expect(page.locator(".composer .attach-chip")).toContainText("notes.txt");
  await send("이어서 설명해 줘");
  // Wait for the streamed answer to be replaced by the finished one.
  await expect(page.locator(".message.assistant").nth(1)).toContainText("모의 API 답변");
  await expect(page.locator(".message")).toHaveCount(4);
  await expect(page.locator(".message.user .attach-chip")).toContainText("notes.txt");
  await expect(page.locator(".composer .attach-chip")).toHaveCount(0);
  let calls = await app.evaluate(() => globalThis.auroraTestCalls);
  expect(calls[1].text).toContain('<file name="notes.txt">\n첨부 내용 한 줄\n</file>');
  expect(calls.map((c) => c.model)).toEqual(["auto-free", "gpt-6.1-sol"]);
  // A failed call keeps the draft, shows the error and does not retry.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("aurora:ask");
    ipcMain.handle("aurora:ask", (_event, p) => {
      globalThis.auroraTestCalls.push(p);
      throw new Error("모의 API 오류");
    });
  });
  await send("추가 설명");
  await expect(page.getByRole("alert")).toContainText("모의 API 오류");
  await expect(editor).toHaveValue("추가 설명");
  await expect(page.locator(".message")).toHaveCount(4);
  expect(await app.evaluate(() => globalThis.auroraTestCalls.length)).toBe(3);
  await app.evaluate(({ ipcMain }) => {
    // A request the app splits in two: the first part finishes, the second keeps running until the
    // user finishes with what is done.
    let finish;
    ipcMain.removeHandler("aurora:ask-control");
    ipcMain.handle("aurora:ask-control", (_event, action) => {
      globalThis.auroraControls = [...(globalThis.auroraControls ?? []), action];
      finish?.(action);
    });
    ipcMain.removeHandler("aurora:ask");
    ipcMain.handle("aurora:ask", async (event, p) => {
      const send = (e) => event.sender.send("aurora:ask-progress", e);
      send({ stage: "plan", mode: "split", effort: "high", parts: ["문제 1", "문제 2"] });
      send({ stage: "part", id: "p1", title: "문제 1", state: "running", model: "gpt-6.1-sol", startedAt: Date.now() });
      send({ stage: "part", id: "p2", title: "문제 2", state: "running", model: "gpt-6.1-sol", startedAt: Date.now() });
      send({ stage: "part", id: "p1", title: "문제 1", state: "done", model: "gpt-6.1-sol", text: "첫 문제의 답" });
      const action = await new Promise((r) => (finish = r));
      if (action === "stop") throw new Error("stopped");
      return {
        text: "### 문제 1\n\n첫 문제의 답\n\n### 문제 2\n\n(건너뜀)",
        mode: "split",
        effort: "high",
        parts: [
          { title: "문제 1", model: "gpt-6.1-sol", failed: false, skipped: false, incomplete: false },
          { title: "문제 2", model: null, failed: false, skipped: true, incomplete: false },
        ],
        usage: { route: { in: 0, out: 0 }, work: { in: 1, out: 1 }, check: { in: 0, out: 0 } },
      };
    });
  });
  // The board says what is happening, shows the finished part at once, and can finish early.
  await send("두 문제를 풀어 줘");
  await expect(page.locator(".ask-progress")).toContainText("2개로 나눠 푸는 중 · 1개 끝남");
  await expect(page.locator(".ask-progress .mode-chip")).toHaveText("Pumasi mode");
  await expect(page.locator(".message.assistant").last()).toContainText("첫 문제의 답");
  await page.screenshot({ path: "artifacts/aurora-split.png" });
  await page.getByRole("button", { name: "지금까지로 마무리", exact: true }).click();
  await expect(page.locator(".message-meta").last()).toContainText("2개로 나눠 풂 · 1개 건너뜀");
  await expect(page.locator(".message")).toHaveCount(6);
  // Stop ends the run, says so, and puts the question back.
  await send("멈출 질문");
  await page.getByRole("button", { name: "중지", exact: true }).click();
  await expect(editor).toHaveValue("멈출 질문");
  await expect(page.locator(".message")).toHaveCount(6);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("aurora:ask");
    ipcMain.handle("aurora:ask", (_event, p) => ({
      text: "모의 API 답변",
      mode: "direct",
      effort: "mid",
      model: p.model,
      usage: { route: { in: 0, out: 0 }, work: { in: 1, out: 1 }, check: { in: 0, out: 0 } },
    }));
  });
  // Saving, legacy sessions and search.
  await settings();
  await page.getByText("이 기기에 대화 저장", { exact: true }).click();
  await page.getByLabel("대화 관리 모드").selectOption("legacy");
  await close();
  await expect(page.getByRole("button", { name: "새 세션", exact: true })).toBeVisible();
  await send("레거시 첫 번째 코드 작업");
  await expect(page.locator(".message")).toHaveCount(2);
  await page.getByRole("button", { name: "새 세션", exact: true }).click();
  await send("여행 요약 레거시 두 번째");
  await expect(page.locator(".message")).toHaveCount(2);
  await expect(page.locator(".chat-item")).toHaveCount(2);
  // The search box sits above the list and filters it as you type; ⌘K jumps to it.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByLabel("대화 검색", { exact: true })).toBeFocused();
  await page.keyboard.type("첫 번째");
  await expect(page.locator(".chat-item")).toHaveCount(1);
  await page.locator(".chat-item").first().click();
  await expect(page.getByLabel("대화 내용")).toContainText("레거시 첫 번째 코드 작업");
  await page.getByLabel("대화 검색", { exact: true }).fill("");
  await expect(page.locator(".chat-item")).toHaveCount(2);
  await page.screenshot({ path: "artifacts/aurora-legacy.png" });
  await settings();
  await page.getByLabel("대화 관리 모드").selectOption("auto");
  await page.getByLabel("화면 테마").selectOption("dark");
  await close();
  await expect(page.locator(".message")).toHaveCount(6);
  await page.screenshot({ path: "artifacts/aurora-dark.png" });
  // Saved conversations survive a reload.
  await page.reload();
  await expect(page.locator(".message")).toHaveCount(6);
  await settings();
  await page.getByLabel("대화 관리 모드").selectOption("legacy");
  await close();
  await expect(page.locator(".chat-item")).toHaveCount(2);
  await settings();
  await page.getByLabel("대화 관리 모드").selectOption("auto");
  await close();
  await page.setViewportSize({ width: 900, height: 700 });
  await page.screenshot({ path: "artifacts/aurora-compact.png" });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  ).toBe(false);
  // Turning saving off clears the stored copy.
  await settings();
  await page.getByText("이 기기에 대화 저장", { exact: true }).click();
  await close();
  await page.reload();
  await expect(page.locator(".message")).toHaveCount(0);
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const p =
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      sandbox: p.sandbox,
      nodeIntegration: p.nodeIntegration,
      contextIsolation: p.contextIsolation,
    };
  });
  expect(prefs).toEqual({
    sandbox: true,
    nodeIntegration: false,
    contextIsolation: true,
  });
  expect(errors).toEqual([]);
  await writeFile(
    "artifacts/smoke-result.json",
    JSON.stringify(
      {
        passed: true,
        errors,
        prefs,
        checks: [
          "key-setup-before-chat",
          "enter-sends-without-dialog",
          "answer-streams",
          "split-progress-finish-and-stop",
          "text-attachment",
          "auto-default-and-advanced-model",
          "real-usage-only",
          "API-error-retains-draft-no-retry",
          "legacy-session-search",
          "persistence/reload",
          "dark/compact",
          "sandbox",
        ],
      },
      null,
      2,
    ),
  );
  // With the sidebar closed on macOS, the top bar starts to the right of the window buttons.
  if (process.platform === "darwin") {
    await page.getByRole("button", { name: "사이드바 접기", exact: true }).click();
    const box = await page.getByRole("button", { name: "사이드바 열기", exact: true }).boundingBox();
    assert.ok(box && box.x >= 88, `sidebar button under the window buttons: x=${box?.x}`);
    await page.screenshot({ path: "artifacts/aurora-sidebar-closed.png" });
    await page.getByRole("button", { name: "사이드바 열기", exact: true }).click();
  }
  console.log(
    "Desktop checks passed: send without a dialog, Auto by default, real usage only, errors keep the draft, legacy sessions, storage and layout.",
  );
} finally {
  await app?.close();
  console.log(`QA profile retained: ${profile}`);
}
