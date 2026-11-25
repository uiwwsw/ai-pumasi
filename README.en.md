<div align="center">

<img src="https://raw.githubusercontent.com/uiwwsw/aurora/main/build/icon.svg" alt="Aurora" width="96" height="96">

<h1>Aurora</h1>

<p>A desktop app for OpenAI, Anthropic, Gemini and Ollama models in one window</p>

<p>
<a href="https://github.com/uiwwsw/aurora/releases/latest"><img alt="release" src="https://img.shields.io/github/v/release/uiwwsw/aurora?style=flat-square&label=release"></a>
<a href="https://github.com/uiwwsw/aurora/actions/workflows/check.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/uiwwsw/aurora/check.yml?branch=main&style=flat-square&label=CI"></a>
<img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-607b64?style=flat-square">
<img alt="Electron" src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white">
<img alt="providers" src="https://img.shields.io/badge/providers-OpenAI%20%7C%20Anthropic%20%7C%20Gemini%20%7C%20Ollama-555?style=flat-square">
<img alt="status" src="https://img.shields.io/badge/status-developer%20preview-orange?style=flat-square">
<a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/uiwwsw/aurora?style=flat-square"></a>
</p>

<p><a href="https://aurora-two-virid.vercel.app/">Web demo</a> · <a href="#install">Download</a> · <a href="docs/components.md">Components</a> · <a href="bench/README.md">Measurements</a> · <a href="CHANGELOG.md">Changelog</a> · <a href="README.md">한국어</a></p>

</div>

<img src="https://raw.githubusercontent.com/uiwwsw/aurora/main/docs/images/aurora-v0.1.png" alt="Aurora workspace">

## What it provides

- Text requests to OpenAI, Anthropic, Google Gemini and local Ollama models
- Estimated input and output token range before a request (from character count and model tier)
- Provider-reported token usage after the response
- Model suggestions from an analyzer model (you choose the model that runs)
- Team mode: a lead model splits the request into 1–6 tasks, a worker model does them one at a time, the lead judges
- Worker retry once on failure, then fall through to another free model
- Conversations grouped into work items; archive, trash, restore
- Optional conversation saving (off by default, stored on the device)
- macOS DMG (signed and notarized) and Windows x64 installers
- Windows automatic updates (checked at startup and every six hours)
- Web demo without installation (no AI calls)

## Not included

- An automatic router that picks and runs a model (the in-app tier suggestion is a keyword and length rule, `src/domain.ts`)
- Team mode on free models by default (the default lead is Claude Opus 5.5 and needs a paid API key)
- Tools such as file edits, shell commands or web search
- Token counts from a real tokenizer, or a budget limit for a whole task
- Team mode verified against live providers (tested with mocked responses only)

## Install

| Platform | Installer |
| --- | --- |
| macOS · Apple Silicon | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-mac-arm64.dmg) |
| macOS · Intel | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-mac-x64.dmg) |
| Windows · x64 | [EXE](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-windows-x64.exe) |

ZIP files, checksums and the changelog are on the [v0.1.4 release](https://github.com/uiwwsw/aurora/releases/tag/v0.1.4). The macOS files are Developer ID signed and notarized by Apple. The Windows installer is not signed with a developer certificate, so SmartScreen may warn.

To look at the interface without installing, open the [web demo](https://aurora-two-virid.vercel.app/). It is a local preview that calls no AI provider, and its interface is in Korean.

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

Failed requests are not retried or sent to another model. Usage may already have been billed when a request times out or returns a malformed response. See the [configuration guide](docs/configuration.md).

## How team mode works

It follows the orchestrator-workers pattern Anthropic describes in [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents). The code is one file, `electron/team.cjs`.

1. **Plan:** the lead splits the request into 1–6 tasks a junior could finish alone and returns them as JSON.
2. **Work:** a worker receives one task instruction, never the whole conversation. On a 429 or server error it retries once, then falls through to another free model that has a key (Gemini, or Ollama if running).
3. **Review:** the lead approves or returns the tasks to fix with feedback. It does not rewrite the answer.
4. **Redo:** only the flagged tasks run again, for at most two rounds.
5. **Merge:** with several tasks a worker merges the results. If the merge would be cut off, the results are shown joined as they are.

The lead is called once to plan and once per review round, billed to the lead provider's account. Lead and worker token usage is shown separately under the answer.

## Measurements outside the app

`bench/` holds measurement scripts that are separate from the app. They call free models through a local [OmniRoute](https://github.com/diegosouzapw/OmniRoute) (an open-source gateway that puts many free providers behind one address). The setups below are **not in the app**.

| Measurement | Free-model bundle | ChatGPT free | Note |
| --- | --- | --- | --- |
| Hard reasoning exam, 30 items (auto-graded) | 29 (majority vote of 4 models) | 23 | Nemotron 3.5 Super alone scored **30** |
| 31 everyday questions (out of 10) | 8.23 (3 answer, 1 merges, with search and number check) | 8.19 | within error |
| 6 code and 3 document tasks | tied | tied | |
| Response time | median about 38 s for everyday questions, about 10 min per reasoning item | about 10 s | |

What these results support is that the free bundle did no worse than ChatGPT's free tier on these items. On the reasoning exam the strongest single free model beat the bundle, so there is no evidence yet that bundling itself made the answers better. The item counts are small, everyday answers were graded by one grader (Claude) blind to the source, and ChatGPT's answers were collected once on one day. Methods and raw data are in the [measurement notes](bench/README.md) (Korean).

Several models answering and one merging, or a majority vote, is the approach used by [Mixture-of-Agents](https://github.com/togethercomputer/MoA) and self-consistency voting.

## Layout

```
electron/   main process: window, IPC, provider adapter (providers.cjs), team mode (team.cjs), updates
src/        React UI (main.tsx), token estimates and rules (domain.ts), model roles (routing.ts), model list (catalog.json)
scripts/    web demo build, packaging, signing checks, release publishing, Playwright checks
tests/      node:test unit tests (provider calls are mocked)
bench/      measurement scripts and results, separate from the app (needs OmniRoute)
docs/       configuration, release and design notes
```

API keys stay in Electron's main process and are never passed to the renderer. All four providers are called with plain `fetch`; no provider SDK is used. File-by-file notes and the dependency list are in [Components and borrowed ideas](docs/components.md) (Korean).

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

Release and signing steps are in the [release notes](docs/releases.md) (Korean); contribution steps are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

- Team mode structure: Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) (orchestrator-workers, evaluator-optimizer)
- Free-model gateway used for measurements: [OmniRoute](https://github.com/diegosouzapw/OmniRoute)
- Combining several answers: [Mixture-of-Agents](https://github.com/togethercomputer/MoA), [LLM-Blender](https://github.com/yuchenlin/LLM-Blender)
- Prior work on model routing: [RouteLLM](https://github.com/lm-sys/RouteLLM), [OpenRouter](https://openrouter.ai)'s `openrouter/auto`, and the multi-provider gateway [LiteLLM](https://github.com/BerriAI/litellm)
- App: [Electron](https://www.electronjs.org), [electron-builder](https://www.electron.build), [React](https://react.dev), [Vite](https://vite.dev), [Lucide](https://lucide.dev) icons, [SUITE](https://sun.fo/suite) font

## License

[MIT](LICENSE). The SUITE font has a [separate license](public/fonts/LICENSE).
