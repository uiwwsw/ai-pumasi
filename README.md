<div align="center">

<img src="https://raw.githubusercontent.com/uiwwsw/pumasi-agent/main/build/icon.svg" alt="Pumasi Agent" width="96" height="96">

<h1>Pumasi Agent</h1>

<p><b>Free AI models, working as a team.</b><br>Several free models take the same question and vote on the answer. When you need more hands, other users lend theirs.</p>

<p>
<a href="https://github.com/uiwwsw/pumasi-agent/releases"><img alt="release" src="https://img.shields.io/github/v/release/uiwwsw/pumasi-agent?include_prereleases&style=flat-square&label=release"></a>
<a href="https://github.com/uiwwsw/pumasi-agent/actions/workflows/check.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/uiwwsw/pumasi-agent/check.yml?branch=main&style=flat-square&label=CI"></a>
<img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-607b64?style=flat-square">
<img alt="Electron" src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white">
<img alt="providers" src="https://img.shields.io/badge/providers-OpenAI%20%7C%20Anthropic%20%7C%20Gemini%20%7C%20Ollama-555?style=flat-square">
<img alt="status" src="https://img.shields.io/badge/status-developer%20preview-orange?style=flat-square">
<a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/uiwwsw/pumasi-agent?style=flat-square"></a>
</p>

<p><a href="https://pumasi-agent.vercel.app/">Web demo</a> · <a href="#install">Download</a> · <a href="docs/guide.en.md">Guide</a> · <a href="docs/components.md">Components</a> · <a href="bench/README.md">Measurements</a> · <a href="CHANGELOG.md">Changelog</a> · <a href="README.ko.md">한국어</a></p>

</div>

<img src="docs/images/scorecard.en.svg" alt="Same exams: Pumasi Agent free bundle 29/30, 28/30, 23.4/25 vs ChatGPT free 23/30, 24/30, 13.4/25">

<img src="https://raw.githubusercontent.com/uiwwsw/pumasi-agent/main/docs/images/workspace.en.png" alt="Pumasi Agent workspace">


## Why it's different

**Free models that outscore ChatGPT's free tier.** We gave the free bundle and ChatGPT free the same three exams, all graded by a program. The bundle scored 29/30, 28/30 and 23.4/25. ChatGPT free scored 23, 24 and 13.4. The questions, answers and graders are in [bench/](bench/README.md), so you can rerun them.

**Borrow hands, not keys.** With Pumasi, your team mode can hand tasks to other users. Their app takes one task, runs it on a free key they chose to lend, and sends back the result. The task and the result are sealed between the two devices: the relay only moves ciphertext, and the helper's screen shows a token count and nothing else. No one's key ever leaves their machine. Helping earns points; posting spends them.

**Premium models only where judgment matters.** In team mode a lead model such as Claude Opus splits the work into up to six tasks and signs off. Free models write the answers and merge them, so the expensive output tokens stay few.

**Done as soon as the vote is decided.** If the models still running can no longer change the outcome, the vote closes and the stragglers are cancelled.

**Free tiers run out. The app keeps going.** Add free keys from NVIDIA, OpenRouter, Groq or Google. When one provider hits its rate limit, the request moves to the next, and the Auto (free) model always starts with the best-scoring model you can reach.

**Your keys stay yours.** API keys are encrypted with the OS keychain, never shown again, and masked out of model answers and error messages.

## Also in the box

- OpenAI, Anthropic, Gemini, Ollama and any OpenAI-compatible server
- Token estimate and budget share before a run, real usage after
- Failed, empty or cut-off answers are retried, then passed to another model
- Conversations you can group, archive and restore; saving stays on your device and is off by default
- English and Korean interface; signed and notarized for macOS, installer for Windows, automatic updates

## Limits, honestly

- Text in, text out. It does not edit files or run commands.
- Pumasi is invite-only while in preview.
- The bundle matches the best single free model; beating it by a wide margin is not proven yet. The measurement notes say exactly where it wins and where it doesn't.

## Install

| Platform | Installer |
| --- | --- |
| macOS · Apple Silicon | [DMG](https://github.com/uiwwsw/pumasi-agent/releases/download/v0.1.10/Pumasi-Agent-0.1.10-mac-arm64.dmg) |
| macOS · Intel | [DMG](https://github.com/uiwwsw/pumasi-agent/releases/download/v0.1.10/Pumasi-Agent-0.1.10-mac-x64.dmg) |
| Windows · x64 | [EXE](https://github.com/uiwwsw/pumasi-agent/releases/download/v0.1.10/Pumasi-Agent-0.1.10-windows-x64.exe) |

The Windows installer is not signed with a developer certificate, so SmartScreen may warn. Setting up keys, team mode, Pumasi, data handling and running from source: see the [guide](docs/guide.en.md).

## License

[MIT](LICENSE). The SUITE font has a [separate license](public/fonts/LICENSE). Libraries used and projects referenced are listed in [components](docs/components.md) (Korean).
