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


## Strengths

- Not tied to one model such as Claude: the lead and the worker can each be a model from a different provider.
- With Gemini Flash's free tier or a local Ollama model as both lead and worker, you can run a team without a paid key. Answer quality for that setup has not been measured yet.
- Workers receive only their task, never the whole conversation. A failed worker call falls through to another free model.

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

A developer preview built by one person. There are no known users or production deployments yet.

| Compared with | Where they are ahead | Where Aurora differs |
| --- | --- | --- |
| [Cherry Studio](https://github.com/CherryHQ/cherry-studio), [Msty](https://msty.ai), [Jan](https://jan.ai) (desktop apps) | dozens of providers, knowledge bases, MCP, side-by-side model answers, streaming | a lead/worker team mode is a built-in feature |
| [Open WebUI](https://github.com/open-webui/open-webui), [LibreChat](https://github.com/danny-avila/librechat), [LobeHub](https://github.com/lobehub/lobe-chat) (self-hosted web) | agents, MCP, RAG, multiple users, large user base | one installed app, no server |
| [CrewAI](https://github.com/crewAIInc/crewAI), [AutoGen](https://github.com/microsoft/autogen), [LangGraph](https://github.com/langchain-ai/langgraph) (frameworks) | roles, tools and flows designed freely in code | team set up in a settings screen without code |

Team mode is the [orchestrator-workers](https://www.anthropic.com/engineering/building-effective-agents) pattern Anthropic describes; it is not a new technique. In measurements outside the app, a majority vote of free models scored 29 of 30 on a reasoning exam (ChatGPT free: 23), but one free model alone scored 30. There is no evidence yet that bundling improved the answers. Details are in the [measurement notes](bench/README.md) (Korean).

## Install

| Platform | Installer |
| --- | --- |
| macOS · Apple Silicon | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-mac-arm64.dmg) |
| macOS · Intel | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-mac-x64.dmg) |
| Windows · x64 | [EXE](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-windows-x64.exe) |

The Windows installer is not signed with a developer certificate, so SmartScreen may warn. Keys, team mode, data handling and running from source are covered in the [guide](docs/guide.en.md).

## License

[MIT](LICENSE). The SUITE font has a [separate license](public/fonts/LICENSE). Libraries used and projects referenced are listed in [components](docs/components.md) (Korean).
