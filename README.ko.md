<div align="center">

<img src="https://raw.githubusercontent.com/uiwwsw/pumasi-agent/main/build/icon.svg" alt="Pumasi Agent" width="96" height="96">

<h1>품앗이 에이전트 · Pumasi Agent</h1>

<p>무료 AI 여러 개에 같은 질문을 풀게 하고, 투표로 답을 고르는 데스크톱 앱</p>

<p>
<a href="https://github.com/uiwwsw/pumasi-agent/releases"><img alt="release" src="https://img.shields.io/github/v/release/uiwwsw/pumasi-agent?include_prereleases&style=flat-square&label=release"></a>
<a href="https://github.com/uiwwsw/pumasi-agent/actions/workflows/check.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/uiwwsw/pumasi-agent/check.yml?branch=main&style=flat-square&label=CI"></a>
<img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-607b64?style=flat-square">
<img alt="Electron" src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white">
<img alt="providers" src="https://img.shields.io/badge/providers-OpenAI%20%7C%20Anthropic%20%7C%20Gemini%20%7C%20Ollama-555?style=flat-square">
<img alt="status" src="https://img.shields.io/badge/status-developer%20preview-orange?style=flat-square">
<a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/uiwwsw/pumasi-agent?style=flat-square"></a>
</p>

<p><a href="https://pumasi-agent.vercel.app/">웹 데모</a> · <a href="#설치">다운로드</a> · <a href="docs/guide.md">사용 안내</a> · <a href="docs/components.md">구성 요소</a> · <a href="bench/README.md">측정 기록</a> · <a href="CHANGELOG.md">변경 기록</a> · <a href="README.md">English</a></p>

</div>

<img src="docs/images/scorecard.svg" alt="같은 시험 성적: 품앗이 에이전트 무료 묶음 29/30, 28/30, 23.4/25 대 ChatGPT 무료 23/30, 24/30, 13.4/25">

<img src="https://raw.githubusercontent.com/uiwwsw/pumasi-agent/main/docs/images/workspace.png" alt="Pumasi Agent 작업 공간">


## 하는 일

- **품앗이:** 돕기를 누르면 내 앱이 다른 사람 팀의 작업 모델 한 명이 되어, 내가 빌려주기로 한 무료 키로 작업 하나를 처리하고 결과만 넘깁니다. 팀 모드에서 "품앗이에 맡기기"를 켜면 반대로 내 작업을 다른 사람들이 처리합니다. 작업 글과 결과는 암호화되어 서버와 돕는 사람의 화면에는 보이지 않습니다. 지금은 초대 코드를 받은 사람만 가입할 수 있습니다. [설계](docs/pumasi-network.md)
- **묶음 투표 (성적표의 방식):** 유료 모델은 하나도 쓰지 않습니다. 성적표의 묶음은 무료 API로 부른 무료 모델 4개(Nemotron 3.5 Super·Ultra·Lightning, Gemini 3.1 Flash-Lite)이고, 이끄는 모델이나 채점하는 모델 없이 각자 풀고 투표합니다.
- **투표 방식:** 무료 모델 2~5개가 같은 질문을 풀고, 모델마다 측정한 실력만큼 무게를 준 투표로 답을 고릅니다. 남은 모델이 모두 반대해도 결과가 바뀌지 않으면 그 자리에서 확정합니다.
- **팀 모드 (선택):** 성적표의 묶음 투표와는 다른 기능입니다. 고른 총괄 모델(Claude Opus·GPT·무료 모델 중 아무거나)이 일을 작업 1~6개로 나누고 승인만 하며, 작업과 합치기는 무료 모델이 합니다.
- **자동 (무료) 모델:** NVIDIA·OpenRouter·Groq·Google 무료 키를 넣으면, 쓸 수 있는 무료 모델 중 성적이 높은 것부터 씁니다. 한도에 걸린 곳은 건너뜁니다.
- **실패하면 다시 맡기기:** 빈 답, 잘린 답, 시간 초과는 같은 모델에 한 번 더, 그다음 다른 모델에 넘깁니다.
- **토큰 미리 보기:** 실행 전에 예상 토큰과 예산 대비 비율을, 끝나면 실제 사용량을 보여 줍니다.
- **키 관리:** 설정에서 넣은 API 키는 OS 키체인으로 암호화해 저장하고, 다시 화면에 보여 주지 않습니다.
- OpenAI, Anthropic, Gemini, Ollama, OpenAI 호환 서버 연결
- 대화 묶기·보관·휴지통, 기기 내 저장(기본 꺼짐)
- 한국어·영어 화면, macOS(서명·공증)·Windows 설치 파일, 자동 업데이트

파일 수정이나 터미널 실행은 하지 않습니다. 텍스트 질문과 답만 합니다. 성적표의 측정 방법과 원자료는 [측정 기록](bench/README.md)에 있습니다.

## 설치

| 운영체제 | 설치 파일 |
| --- | --- |
| macOS · Apple Silicon | [DMG](https://github.com/uiwwsw/pumasi-agent/releases/download/v0.1.10/Pumasi-Agent-0.1.10-mac-arm64.dmg) |
| macOS · Intel | [DMG](https://github.com/uiwwsw/pumasi-agent/releases/download/v0.1.10/Pumasi-Agent-0.1.10-mac-x64.dmg) |
| Windows · x64 | [EXE](https://github.com/uiwwsw/pumasi-agent/releases/download/v0.1.10/Pumasi-Agent-0.1.10-windows-x64.exe) |

Windows 설치 파일은 개발자 인증서로 서명하지 않아 SmartScreen 경고가 나올 수 있습니다. 키 설정, 팀 모드 사용법, 데이터 처리, 소스에서 실행하는 방법은 [사용 안내](docs/guide.md)에 있습니다.

## 라이선스

[MIT](LICENSE). SUITE 글꼴은 [별도 라이선스](public/fonts/LICENSE)를 따릅니다. 쓴 라이브러리와 참고한 프로젝트는 [구성 요소](docs/components.md)에 있습니다.
