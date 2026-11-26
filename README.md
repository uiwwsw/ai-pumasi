<div align="center">

<img src="https://raw.githubusercontent.com/uiwwsw/pumasi-agent/main/build/icon.svg" alt="Pumasi Agent" width="96" height="96">

<h1>Pumasi Agent</h1>

<p><b>Free AI models, working as a team.</b><br>A lead model splits the job, free models do the work, and when you need more hands, other users lend theirs.</p>

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

<img src="docs/images/scorecard.en.svg" alt="Same exams: Nemotron 3.5 Super (free) 30/30, 28/30, 23/25 vs ChatGPT free 23/30, 24/30, 13.4/25">

<img src="https://raw.githubusercontent.com/uiwwsw/pumasi-agent/main/docs/images/workspace.en.png" alt="Pumasi Agent workspace">


## Why it's different

**Split the work, not the bill.** Team mode turns one request into up to six tasks. A lead model plans them and signs off; free models do the tasks and merge the result. The lead can be free too, or a paid model such as Claude Opus, in which case it spends its expensive tokens on planning and approval only.

**Borrow hands, not keys.** With Pumasi, your team can hand tasks to other users. Their app takes one task, runs it on a free key they chose to lend, and sends back the result. The task and the result are sealed between the two devices: the relay only moves ciphertext, and the helper's screen shows a token count and nothing else. No one's key ever leaves their machine. Helping earns points; posting spends them.

**Free models that hold their own.** Nemotron 3.5 Super, a free model you can run here, took three program-graded exams and scored 30/30, 28/30 and 23/25. ChatGPT's free tier scored 23, 24 and 13.4. Questions, answers and graders are in [bench/](bench/README.md).

**Free tiers run out. The app keeps going.** Add free keys from NVIDIA, OpenRouter, Groq or Google. The Auto (free) model starts with the best-scoring model you can reach and moves to the next only when one hits its limit or stalls.

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
- Bundle vote (asking several models the same question) is experimental. It spends several times the tokens and has not scored higher than Nemotron Super alone, so it is off by default and not what the scorecard shows.

## Roadmap

Built and shipped one at a time, in this order.

1. **A team that runs itself.** Each free model drafts a plan, they vote on the plans without seeing who wrote them, and the winner leads: it splits the work, the others do it, and they vote on whether the result is done. No human-picked lead, no paid model needed. The goal is smarter and leaner: it ships only if it beats Nemotron Super alone and today's team mode on large, multi-part tasks while using the same or fewer tokens.
2. **Pumasi, next steps.** Help automatically while the app is idle, report and block bad results, then open sign-up.
3. **Rethink bundle vote.** Keep it only if the self-running team needs it; otherwise remove it.
4. **Streaming answers.**
5. **File attachments.**

## Install

| Platform | Installer |
| --- | --- |
| macOS · Apple Silicon | [DMG](https://github.com/uiwwsw/pumasi-agent/releases/download/v0.1.10/Pumasi-Agent-0.1.10-mac-arm64.dmg) |
| macOS · Intel | [DMG](https://github.com/uiwwsw/pumasi-agent/releases/download/v0.1.10/Pumasi-Agent-0.1.10-mac-x64.dmg) |
| Windows · x64 | [EXE](https://github.com/uiwwsw/pumasi-agent/releases/download/v0.1.10/Pumasi-Agent-0.1.10-windows-x64.exe) |

The Windows installer is not signed with a developer certificate, so SmartScreen may warn. Setting up keys, team mode, Pumasi, data handling and running from source: see the [guide](docs/guide.en.md).

## License

[MIT](LICENSE). The SUITE font has a [separate license](public/fonts/LICENSE). Libraries used and projects referenced are listed in [components](docs/components.md) (Korean).
