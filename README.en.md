<div align="center">

<img src="https://raw.githubusercontent.com/uiwwsw/aurora/main/build/icon.svg" alt="Aurora" width="96" height="96">

<h1>Aurora</h1>

<p>A desktop app where the expensive AI only plans and checks, and free AI does the work</p>

<p>
<a href="https://github.com/uiwwsw/aurora/releases"><img alt="release" src="https://img.shields.io/github/v/release/uiwwsw/aurora?include_prereleases&style=flat-square&label=release"></a>
<a href="https://github.com/uiwwsw/aurora/actions/workflows/check.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/uiwwsw/aurora/check.yml?branch=main&style=flat-square&label=CI"></a>
<img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-607b64?style=flat-square">
<img alt="Electron" src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white">
<img alt="providers" src="https://img.shields.io/badge/providers-OpenAI%20%7C%20Anthropic%20%7C%20Gemini%20%7C%20Ollama-555?style=flat-square">
<img alt="status" src="https://img.shields.io/badge/status-developer%20preview-orange?style=flat-square">
<a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/uiwwsw/aurora?style=flat-square"></a>
</p>

<p><a href="https://aurora-two-virid.vercel.app/">Web demo</a> · <a href="#install">Download</a> · <a href="docs/guide.en.md">Guide</a> · <a href="docs/components.md">Components</a> · <a href="bench/README.md">Measurements</a> · <a href="CHANGELOG.md">Changelog</a> · <a href="README.md">한국어</a></p>

</div>

<img src="https://raw.githubusercontent.com/uiwwsw/aurora/main/docs/images/aurora-v0.1.png" alt="Aurora workspace">


## What Aurora does well

**Free models, bundled, beat ChatGPT's free tier.** On a freshly generated 30-question reasoning exam that is not on the internet, a bundle of four free models scored 29 and ChatGPT free scored 23. Answers are computed by a program and graded automatically. ChatGPT free answered "no solution" to logic puzzles that have one and missed 7 questions. Method and raw data are in the [measurement notes](bench/README.md). The bundle is being brought into the app now.

**The expensive model only gets the expensive work.** In team mode the lead model (for example Claude Opus) splits the request into 1–6 tasks and decides whether to approve the results. It never rewrites the answer; a free worker model merges the results. The priciest output tokens stay small by design.

**When a free model stalls or cuts corners, Aurora hands the task out again.** Empty, too-short or cut-off replies and timeouts count as failures: the same model gets one more try, then another free model takes over. Models that fail often or run slow are recorded and moved down the list. The run screen shows which task has been running for how many seconds.

**You see the cost before you spend it.** An estimated token range and its share of your budget before a run; lead and worker usage shown separately after it.

**A question app for anyone, not a coding tool.** It answers general questions and document tasks without file or terminal access. The interface is in Korean.

## What works now

- Text requests to OpenAI, Anthropic, Gemini and Ollama models
- Team mode: the lead splits the work, workers do it, the lead judges (up to two rounds)
- Stalled-task recovery: retries for empty or cut-off replies and timeouts, model order from each model's track record, per-task progress
- Estimated token range before a request, provider-reported usage after it
- Conversations grouped into work items; archive, trash, restore; on-device saving (off by default)
- macOS (signed and notarized) and Windows x64 installers; automatic updates

## Coming next

- **The free-model bundle inside the app:** several free models answer the same question and a vote weighted by each model's measured skill picks the answer. In our measurements this got right the question a plain majority vote missed.
- **Token estimates learned from your own usage:** Aurora records the tokens you actually used, on your device, and tells you what share of your budget the next request will take. You can switch it off.
- An automatic router that picks the model and team for each question
- Streaming responses, file attachments, an English interface, OpenAI-compatible endpoints such as OpenRouter or Groq

## Who it is for

If you need an agent that edits code and runs a terminal, [OpenCode](https://opencode.ai) or [Roo Code](https://roocode.com) fit better; if you need dozens of providers and a knowledge base, try [Cherry Studio](https://github.com/CherryHQ/cherry-studio) or [Open WebUI](https://github.com/open-webui/open-webui). Aurora is for people who find one paid AI too expensive for everything and one free AI not quite enough, and who want to see what each request costs. It is a developer preview built by one person.

## Install

| Platform | Installer |
| --- | --- |
| macOS · Apple Silicon | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.5/Aurora-0.1.5-mac-arm64.dmg) |
| macOS · Intel | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.5/Aurora-0.1.5-mac-x64.dmg) |
| Windows · x64 | [EXE](https://github.com/uiwwsw/aurora/releases/download/v0.1.5/Aurora-0.1.5-windows-x64.exe) |

The Windows installer is not signed with a developer certificate, so SmartScreen may warn. Keys, team mode, data handling and running from source are covered in the [guide](docs/guide.en.md).

## License

[MIT](LICENSE). The SUITE font has a [separate license](public/fonts/LICENSE). Libraries used and projects referenced are listed in [components](docs/components.md) (Korean).
