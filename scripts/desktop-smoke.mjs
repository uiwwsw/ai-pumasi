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
  await expect(
    page.getByRole("heading", { name: "무엇을 도와드릴까요?" }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/aurora-desktop.png" });
  // No keys: status says so, and sending explains where to add one. The draft stays.
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
  await send("키 없이 보내기");
  await expect(page.getByRole("alert")).toContainText("API 키");
  await expect(editor).toHaveValue("키 없이 보내기");
  await expect(page.locator(".message")).toHaveCount(0);
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
    ipcMain.removeHandler("aurora:ai-request");
    ipcMain.handle("aurora:ai-request", async (event, p) => {
      globalThis.auroraTestCalls.push(p);
      // Stream part of the answer first, the way the real handler does.
      event.sender.send("aurora:ai-delta", "모의 스트리밍 일부");
      await new Promise((r) => setTimeout(r, 1500));
      return {
        model: p.model,
        text: "모의 API 답변",
        inputTokens: 34,
        outputTokens: 45,
        incomplete: false,
      };
    });
  });
  await page.reload();
  // Enter sends right away: no confirmation dialog, no model to pick.
  await editor.fill("요약해 줘");
  await editor.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The answer shows while it streams, before the call finishes.
  await expect(page.locator(".message.assistant")).toContainText("모의 스트리밍 일부");
  await page.screenshot({ path: "artifacts/aurora-streaming.png" });
  await expect(page.getByLabel("대화 내용")).toContainText("모의 API 답변");
  await expect(page.locator(".message.assistant")).toContainText("자동");
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
  expect(calls.map((c) => [c.action, c.model, c.maxOutputTokens])).toEqual([
    ["execute", "auto-free", 4096],
    ["execute", "gpt-6.1-sol", 4096],
  ]);
  // A failed call keeps the draft, shows the error and does not retry.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("aurora:ai-request");
    ipcMain.handle("aurora:ai-request", (_event, p) => {
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
    ipcMain.removeHandler("aurora:ai-request");
    ipcMain.handle("aurora:ai-request", (_event, p) => ({
      model: p.model,
      text: "모의 API 답변",
      inputTokens: 1,
      outputTokens: 1,
      incomplete: false,
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
  await page.getByRole("button", { name: "대화 검색", exact: true }).click();
  await page.getByLabel("대화 검색어").fill("첫 번째");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "레거시 첫 번째 코드 작업" })
    .click();
  await expect(page.getByLabel("대화 내용")).toContainText("레거시 첫 번째 코드 작업");
  await page.screenshot({ path: "artifacts/aurora-legacy.png" });
  await settings();
  await page.getByLabel("대화 관리 모드").selectOption("auto");
  await page.getByLabel("화면 테마").selectOption("dark");
  await close();
  await expect(page.locator(".message")).toHaveCount(4);
  await page.screenshot({ path: "artifacts/aurora-dark.png" });
  // Saved conversations survive a reload.
  await page.reload();
  await expect(page.locator(".message")).toHaveCount(4);
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
          "missing-key-message",
          "enter-sends-without-dialog",
          "answer-streams",
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
  console.log(
    "Desktop checks passed: send without a dialog, Auto by default, real usage only, errors keep the draft, legacy sessions, storage and layout.",
  );
} finally {
  await app?.close();
  console.log(`QA profile retained: ${profile}`);
}
