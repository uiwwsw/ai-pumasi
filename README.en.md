<div align="center">

<img src="https://raw.githubusercontent.com/uiwwsw/aurora/main/build/icon.svg" alt="Aurora" width="96" height="96">

<h1>Aurora</h1>

<p>A desktop app that runs several AI models as a lead-and-worker team</p>

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


## How it differs

Running several models as a team is common. [OpenCode](https://opencode.ai/docs/agents/) has a desktop app where each agent can use its own model, free models included, and [Roo Code](https://docs.roocode.com/features/boomerang-tasks)'s orchestrator mode assigns models per mode. Lead-and-sub-agent desktop apps such as [Orkas](https://github.com/Orkas-AI/Orkas) also exist. The differences you can verify in Aurora's code are these:

- **Capped lead output:** the lead model only returns a task list and an approve/redo verdict as JSON. It never rewrites the answer, and a worker merges the results. Output tokens from the expensive model stay small by design (`electron/team.cjs`).
- **Free-tier fallbacks:** a worker call that fails with 429 or 5xx is retried once and then sent to another free model that has a key.
- **Visible cost:** an estimated token range before a run, and lead and worker usage shown separately after it.
- **Not a coding tool:** a desktop app that answers general questions and document tasks without file or shell access. The interface is in Korean.
- **Published measurement:** the method and raw data comparing a free-model bundle with ChatGPT's free tier on the same Korean questions are public ([measurement notes](bench/README.md)).

These differences are small and easy for other tools to copy. Until the app itself shows a free-model bundle beating a single model, Aurora has no clear differentiator.

## What works now

- Text requests to OpenAI, Anthropic, Gemini and Ollama models
- Team mode: the lead splits the work into 1–6 tasks, the worker does them, the lead judges (up to two rounds)
- Estimated token range before a request, provider-reported usage after it
- Conversations grouped into work items; archive, trash, restore; on-device saving (off by default)
- macOS (signed and notarized) and Windows x64 installers; Windows automatic updates

## Planned

- An automatic router that picks the model and team for a question (today only a keyword and length rule suggests a tier)
- Bringing the free-model answer bundle into the app (today it exists only in the `bench/` measurement scripts)
- Measuring the quality of a team made only of free models
- Streaming responses, file attachments, an English interface
- Adding OpenAI-compatible endpoints such as OpenRouter or Groq directly
- Verifying team mode with real provider keys (today it is tested with mocked responses only)

## Where it stands

A developer preview built by one person. There are no known users or production deployments.

| Compared with | Where they are ahead |
| --- | --- |
| [OpenCode](https://opencode.ai), [Roo Code](https://roocode.com) (coding agents) | per-agent models, free models, file and terminal work, large user base |
| [Orkas](https://github.com/Orkas-AI/Orkas), [Agent Teams AI](https://github.com/777genius/agent-teams-ai) (team desktop apps) | parallel sub-agents, local models, tool execution |
| [Cherry Studio](https://github.com/CherryHQ/cherry-studio), [Msty](https://msty.ai), [Jan](https://jan.ai) (chat apps) | dozens of providers, knowledge bases, MCP, streaming, side-by-side answers |
| [Open WebUI](https://github.com/open-webui/open-webui), [LibreChat](https://github.com/danny-avila/librechat) (self-hosted) | agents, RAG, multiple users |

In measurements outside the app, a majority vote of free models scored 29 of 30 on a reasoning exam (ChatGPT free: 23), but one free model alone scored 30. There is no evidence yet that bundling improved the answers.

## Install

| Platform | Installer |
| --- | --- |
| macOS · Apple Silicon | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-mac-arm64.dmg) |
| macOS · Intel | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-mac-x64.dmg) |
| Windows · x64 | [EXE](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-windows-x64.exe) |

The Windows installer is not signed with a developer certificate, so SmartScreen may warn. Keys, team mode, data handling and running from source are covered in the [guide](docs/guide.en.md).

## License

[MIT](LICENSE). The SUITE font has a [separate license](public/fonts/LICENSE). Libraries used and projects referenced are listed in [components](docs/components.md) (Korean).
