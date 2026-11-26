import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const executablePath = process.argv[2];
if (!executablePath)
  throw new Error(
    "Usage: node scripts/package-smoke.mjs <installed-executable>",
  );
await access(executablePath);
const profile = await mkdtemp(path.join(tmpdir(), "aurora-installed-qa-"));
await mkdir("artifacts", { recursive: true });
let app;
try {
  app = await electron.launch({
    executablePath: path.resolve(executablePath),
    env: {
      ...process.env,
      AURORA_QA_DATA: profile,
      AURORA_DISABLE_ENV_FILE: "1",
      AURORA_OLLAMA: "0",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      GEMINI_API_KEY: "",
      NVIDIA_API_KEY: "",
      GROQ_API_KEY: "",
      OPENROUTER_API_KEY: "",
      AURORA_OPENAI_COMPAT_URL: "",
      AURORA_OPENAI_COMPAT_KEY: "",
    },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await expect(
    page.getByRole("heading", { name: "대화는 하나로, 생각은 자유롭게." }),
  ).toBeVisible();
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
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
  await page
    .getByRole("button", { name: "모드 및 예산 설정", exact: true })
    .click();
  await expect(page.getByLabel("내부 분석 모델", { exact: true })).toHaveValue(
    "gpt-6-luna",
  );
  await expect(page.getByLabel("기본 실행 모델", { exact: true })).toHaveValue(
    "gpt-6.1-sol",
  );
  await page.screenshot({
    path: `artifacts/installed-${process.platform}-${process.arch}.png`,
  });
  console.log(
    "Installed app booted, packaged resources and preload bridge verified.",
  );
} finally {
  await app?.close();
  console.log(`Installed-app QA profile retained: ${profile}`);
}
