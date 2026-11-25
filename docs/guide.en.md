# Aurora guide

[Back to README](../README.en.md)

## Quick start

1. Put the keys for the providers you use in a `.env` file. The installed app reads `~/Library/Application Support/Aurora/.env` on macOS and `%APPDATA%/Aurora/.env` on Windows, and also accepts environment variables.

   ```bash
   OPENAI_API_KEY=...        # OpenAI models
   ANTHROPIC_API_KEY=...     # Claude models, default team-mode lead
   GEMINI_API_KEY=...        # Gemini Flash (has a free tier)
   OLLAMA_MODEL=qwen3        # model name in your local Ollama (default qwen3)
   ```

   Ollama needs no key; it connects when it is running at `http://127.0.0.1:11434`.

2. Restart the app and turn on **실제 API 사용** (real API use) in Settings. The switch alone sends nothing.
3. Write a request. Optionally use **내부 모델로 분석** (analyze) for a suggestion, then pick a model and use **선택한 모델로 API 실행** (run).
4. For team mode, turn it on in Settings and choose the lead and worker models.

Failed requests are not retried or sent to another model. Usage may already have been billed when a request times out or returns a malformed response. See the [configuration guide](configuration.md).

## How team mode works

It follows the orchestrator-workers pattern Anthropic describes in [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents). The code is one file, `electron/team.cjs`.

1. **Plan:** the lead splits the request into 1–6 tasks a junior could finish alone and returns them as JSON.
2. **Work:** a worker receives one task instruction, never the whole conversation. On a 429 or server error it retries once, then falls through to another free model that has a key (Gemini, or Ollama if running).
3. **Review:** the lead approves or returns the tasks to fix with feedback. It does not rewrite the answer.
4. **Redo:** only the flagged tasks run again, for at most two rounds.
5. **Merge:** with several tasks a worker merges the results. If the merge would be cut off, the results are shown joined as they are.

The lead is called once to plan and once per review round, billed to the lead provider's account. Lead and worker token usage is shown separately under the answer.

## Measurements outside the app

`bench/` holds measurement scripts that are separate from the app. They call free models through a local [a local gateway](https://github.com/diegosouzapw/a local gateway) (an open-source gateway that puts many free providers behind one address). The setups below are **not in the app**.

| Measurement | Free-model bundle | ChatGPT free | Note |
| --- | --- | --- | --- |
| Hard reasoning exam, 30 items (auto-graded) | 29 (majority vote of 4 models) | 23 | Nemotron 3.5 Super alone scored **30** |
| 31 everyday questions (out of 10) | 8.23 (3 answer, 1 merges, with search and number check) | 8.19 | within error |
| 6 code and 3 document tasks | tied | tied | |
| Response time | median about 38 s for everyday questions, about 10 min per reasoning item | about 10 s | |

What these results support is that the free bundle did no worse than ChatGPT's free tier on these items. On the reasoning exam the strongest single free model beat the bundle, so there is no evidence yet that bundling itself made the answers better. The item counts are small, everyday answers were graded by one grader (Claude) blind to the source, and ChatGPT's answers were collected once on one day. Methods and raw data are in the [measurement notes](../bench/README.md) (Korean).

Several models answering and one merging, or a majority vote, is the approach used by [Mixture-of-Agents](https://github.com/togethercomputer/MoA) and self-consistency voting.

## Layout

```
electron/   main process: window, IPC, provider adapter (providers.cjs), team mode (team.cjs), updates
src/        React UI (main.tsx), token estimates and rules (domain.ts), model roles (routing.ts), model list (catalog.json)
scripts/    web demo build, packaging, signing checks, release publishing, Playwright checks
tests/      node:test unit tests (provider calls are mocked)
bench/      measurement scripts and results, separate from the app (needs a local gateway)
docs/       configuration, release and design notes
```

API keys stay in Electron's main process and are never passed to the renderer. All four providers are called with plain `fetch`; no provider SDK is used. File-by-file notes and the dependency list are in [Components and borrowed ideas](components.md) (Korean).

## Data

- The web demo sends conversations nowhere.
- In the desktop app, a run sends the request and the selected context to the chosen provider. Team-mode workers receive only their task instruction.
- Saving conversations is off by default. When on, data is stored unencrypted on the current device. Turning it off deletes the stored copy.
- Per-call output caps are 2,048 tokens for analysis and 4,096 for execution and team tasks. Answers can be cut off at the cap.

## Updates

Windows checks at startup and every six hours, downloads in the background and offers a restart. **Help → 업데이트 확인…** (Check for updates) checks manually. macOS automatic updates are enabled only in Developer ID signed builds. Version 0.1.1 and earlier, and older ad-hoc signed builds, must be replaced once with a new installer. A real update from one version to the next has not been verified yet.

## Run from source

Requires Node.js 24 or newer.

```bash
git clone https://github.com/uiwwsw/aurora.git
cd aurora
npm ci
cp .env.example .env   # add keys (optional)
npm start
```

| Command | What it does |
| --- | --- |
| `npm run build` | Type-check and build the UI |
| `npm test` | Domain, provider adapter, team mode, updater and web build tests |
| `npm run test:desktop` | Check the Electron UI with Playwright |
| `npm run build:web` | Build the web demo and Korean/English overview pages |
| `npm run package:mac` / `package:win` | Build installers |

Release and signing steps are in the [release notes](releases.md) (Korean); contribution steps are in [CONTRIBUTING.md](../CONTRIBUTING.md).
