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

**Two modes: Chat and Code.** Chat is for questions. Code works the way Claude Code or Codex does: open a project folder and describe the task. The agent looks around, reads and searches files on its own, then proposes changes as diffs and asks before it runs a command. Nothing is saved or run until you approve it. Code mode is in beta.

**Split the work, not the bill.** Team mode turns one request into up to six tasks. A lead model plans them and signs off; free models do the tasks and merge the result. By default the lead is the free model with the best measured score. If it hits its limit, the next one in the ranking takes over, and you can reorder the ranking in settings. When the lead isn't sure a result is right, the runner-up checks it once; otherwise there is no extra call. You can also pick a paid lead such as Claude Opus, which then spends its tokens on planning and approval only.

**Share the problem.** Turn on Pitch in and your team hands tasks to other users. Their app takes one task, runs it on their own free key, and sends back the result. The task and the result are sealed between the two devices: the relay only moves ciphertext, and the helper's screen shows a token count and nothing else. No one's key ever leaves their machine. Helping earns points; posting spends them.

**Free models that hold their own.** Nemotron 3.5 Super, a free model you can run here, took three program-graded exams and scored 30/30, 28/30 and 23/25. ChatGPT's free tier scored 23, 24 and 13.4. Questions, answers and graders are in [bench/](bench/README.md).

**Add your keys, then just ask.** Put keys for NVIDIA, OpenRouter, Groq or Google (free) and OpenAI or Anthropic (paid) in Settings once. Press Enter and Auto answers: it starts with the best-scoring free model you can reach, moves to the next when one hits its limit or stalls, and uses a paid key only after every free one is out. There is no model to pick and no confirmation step; you can still choose a model under Settings → Advanced.

**Your keys stay yours.** API keys are encrypted with the OS keychain, never shown again, and masked out of model answers and error messages.

## The idea behind Pitch in

Most token-sharing projects collect keys or credits in one place and hand them out. Whoever runs that pool sits in the middle of every request, and a shared key is easy to abuse.

Pitch in works the other way round. You share the problem. Someone who wants to help picks it up, solves it with their own tools, and sends back the result. Keys and credits stay with the people who own them, and nothing sits in the middle that could be abused.

Today's app has the first piece: another user's app runs one of your team's tasks on their own free key, sealed between the two devices. The full version, where a person takes a role the lead hands out and works on it until the answer is right, is still an idea. It isn't built yet, and we're looking for contributors to build it. [docs/pitch-in.md](docs/pitch-in.md) lists what's built and the open problems; pick one and open an issue.

## Also in the box

- OpenAI, Anthropic, Gemini, Ollama and any OpenAI-compatible server
- Token usage after each answer, as the provider reports it. Nothing is guessed before sending.
- Failed, empty or cut-off answers are retried, then passed to another model
- Conversations you can group, archive and restore; saving stays on your device and is off by default
- English and Korean interface; signed and notarized for macOS, installer for Windows, automatic updates
- Update channels: Stable, Beta and Alpha (Help → Update channel)

## Limits, honestly

- Code mode is a beta: one folder at a time, each command limited to two minutes, and Pitch in doesn't work there yet.
- The lead ranking comes from one measurement today, the reasoning exam. Separate rankings for code and writing will come once those are measured.
- Pitch in is invite-only while in preview.
- Bundle vote (asking several models the same question) is experimental. It spends several times the tokens and has not scored higher than Nemotron Super alone, so it is off by default and not what the scorecard shows.

## Roadmap

Built and shipped one at a time, in this order.

1. **A team that doesn't waste tokens.** On six hard problems the team now gets 3 right where Nemotron Super alone gets 0, but it uses about 50 times the tokens. Next: answer directly when splitting won't help, cut review rounds that change nothing, and cap how long workers think. It goes to the stable channel only if it beats Super alone with the same or fewer tokens.
2. **Streaming answers.** Done for chat and code mode.
3. **Code mode, closer to Claude Code and Codex.** Undo for saved changes, a git changes view and "save all" for one request are in. Next: native tool calls, kept only if they beat today's text protocol on the free models.
4. **Pitch in with people.** A person takes a role the lead hands out and works on it until the answer is right. Also: report and block bad results, and open sign-up.
5. **Pitch in for code mode, file attachments, and a decision on bundle vote.**

## Install

| Platform | Installer |
| --- | --- |
| macOS · Apple Silicon | [DMG](https://github.com/uiwwsw/pumasi-agent/releases/download/v0.1.10/Pumasi-Agent-0.1.10-mac-arm64.dmg) |
| macOS · Intel | [DMG](https://github.com/uiwwsw/pumasi-agent/releases/download/v0.1.10/Pumasi-Agent-0.1.10-mac-x64.dmg) |
| Windows · x64 | [EXE](https://github.com/uiwwsw/pumasi-agent/releases/download/v0.1.10/Pumasi-Agent-0.1.10-windows-x64.exe) |

Beta builds, with new features first, are on the [releases page](https://github.com/uiwwsw/pumasi-agent/releases). An installed app can switch under Help → Update channel.

The Windows installer is not signed with a developer certificate, so SmartScreen may warn. Setting up keys, team mode, Pumasi, data handling and running from source: see the [guide](docs/guide.en.md).

## License

[MIT](LICENSE). The SUITE font has a [separate license](public/fonts/LICENSE). Libraries used and projects referenced are listed in [components](docs/components.md) (Korean).
