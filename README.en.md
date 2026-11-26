<div align="center">

<img src="https://raw.githubusercontent.com/uiwwsw/pumasi-agent/main/build/icon.svg" alt="Pumasi Agent" width="96" height="96">

<h1>Pumasi Agent · 품앗이 에이전트</h1>

<p>A desktop app that asks several free AI models the same question and picks the answer by vote</p>

<p>
<a href="https://github.com/uiwwsw/pumasi-agent/releases"><img alt="release" src="https://img.shields.io/github/v/release/uiwwsw/pumasi-agent?include_prereleases&style=flat-square&label=release"></a>
<a href="https://github.com/uiwwsw/pumasi-agent/actions/workflows/check.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/uiwwsw/pumasi-agent/check.yml?branch=main&style=flat-square&label=CI"></a>
<img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-607b64?style=flat-square">
<img alt="Electron" src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white">
<img alt="providers" src="https://img.shields.io/badge/providers-OpenAI%20%7C%20Anthropic%20%7C%20Gemini%20%7C%20Ollama-555?style=flat-square">
<img alt="status" src="https://img.shields.io/badge/status-developer%20preview-orange?style=flat-square">
<a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/uiwwsw/pumasi-agent?style=flat-square"></a>
</p>

<p><a href="https://pumasi-agent.vercel.app/">Web demo</a> · <a href="#install">Download</a> · <a href="docs/guide.en.md">Guide</a> · <a href="docs/components.md">Components</a> · <a href="bench/README.md">Measurements</a> · <a href="CHANGELOG.md">Changelog</a> · <a href="README.md">한국어</a></p>

</div>

<img src="docs/images/scorecard.en.svg" alt="Same exams: Pumasi Agent free bundle 29/30, 28/30, 23.4/25 vs ChatGPT free 23/30, 24/30, 13.4/25">

<img src="https://raw.githubusercontent.com/uiwwsw/pumasi-agent/main/docs/images/workspace.en.png" alt="Pumasi Agent workspace">


## What it does

- **Pumasi:** press Help and your app becomes one worker on someone else's team, doing one task with the free keys you chose to lend and passing back only the result. Turn on "Hand tasks to Pumasi" in team mode and other people's apps do your tasks. Tasks and results are encrypted and not visible on the server or on the helper's screen. For now, joining needs an invite code. [Design](docs/pumasi-network.md) (Korean)
- **Bundle vote:** two to five free models answer the same question, and a vote weighted by each model's measured skill picks the answer. When the remaining models can no longer change the result, it settles right away.
- **Team mode:** a lead model (for example Claude Opus) splits the work into one to six tasks and only approves. Free models do the tasks and the merge.
- **Auto (free) model:** add free keys from NVIDIA, OpenRouter, Groq or Google and it uses the best-scoring free model available, skipping rate-limited providers.
- **Retry on failure:** empty, cut-off or timed-out answers go to the same model once more, then to another model.
- **Token preview:** estimated tokens and budget share before a run, actual usage after.
- **Key management:** API keys added in Settings are encrypted with the OS keychain and never shown again.
- OpenAI, Anthropic, Gemini, Ollama and OpenAI-compatible servers
- Group, archive and trash conversations; on-device saving (off by default)
- English and Korean interface, signed and notarized macOS and Windows installers, automatic updates

It does not edit files or run terminal commands; it answers text questions. Methods and raw data for the scorecard are in [Measurements](bench/README.md).

## Install

| Platform | Installer |
| --- | --- |
| macOS · Apple Silicon | [DMG](https://github.com/uiwwsw/pumasi-agent/releases/download/v0.1.10/Pumasi-Agent-0.1.10-mac-arm64.dmg) |
| macOS · Intel | [DMG](https://github.com/uiwwsw/pumasi-agent/releases/download/v0.1.10/Pumasi-Agent-0.1.10-mac-x64.dmg) |
| Windows · x64 | [EXE](https://github.com/uiwwsw/pumasi-agent/releases/download/v0.1.10/Pumasi-Agent-0.1.10-windows-x64.exe) |

The Windows installer is not signed with a developer certificate, so SmartScreen may warn. Keys, team mode, data handling and running from source are covered in the [guide](docs/guide.en.md).

## License

[MIT](LICENSE). The SUITE font has a [separate license](public/fonts/LICENSE). Libraries used and projects referenced are listed in [components](docs/components.md) (Korean).
