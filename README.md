<div align="center">

<img src="https://raw.githubusercontent.com/uiwwsw/aurora/main/build/icon.svg" alt="Aurora" width="96" height="96">

<h1>Aurora · 오로라</h1>

<p>비싼 AI는 계획과 확인만, 일은 무료 AI가 하는 데스크톱 앱</p>

<p>
<a href="https://github.com/uiwwsw/aurora/releases"><img alt="release" src="https://img.shields.io/github/v/release/uiwwsw/aurora?include_prereleases&style=flat-square&label=release"></a>
<a href="https://github.com/uiwwsw/aurora/actions/workflows/check.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/uiwwsw/aurora/check.yml?branch=main&style=flat-square&label=CI"></a>
<img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-607b64?style=flat-square">
<img alt="Electron" src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white">
<img alt="providers" src="https://img.shields.io/badge/providers-OpenAI%20%7C%20Anthropic%20%7C%20Gemini%20%7C%20Ollama-555?style=flat-square">
<img alt="status" src="https://img.shields.io/badge/status-developer%20preview-orange?style=flat-square">
<a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/uiwwsw/aurora?style=flat-square"></a>
</p>

<p><a href="https://aurora-two-virid.vercel.app/">웹 데모</a> · <a href="#설치">다운로드</a> · <a href="docs/guide.md">사용 안내</a> · <a href="docs/components.md">구성 요소</a> · <a href="bench/README.md">측정 기록</a> · <a href="CHANGELOG.md">변경 기록</a> · <a href="README.en.md">English</a></p>

</div>

<img src="https://raw.githubusercontent.com/uiwwsw/aurora/main/docs/images/aurora-v0.1.png" alt="Aurora 작업 공간">


## 오로라가 잘하는 것

**무료 AI를 모으면 ChatGPT 무료보다 잘 풉니다.** 매번 새로 만들어 인터넷에 없는 추론 시험 30문항에서 무료 모델 네 개를 묶은 구성은 29점, ChatGPT 무료는 23점을 받았습니다. 정답은 프로그램이 계산해 자동으로 채점합니다. ChatGPT 무료는 답이 있는 논리 퍼즐에 "해 없음"이라고 답하며 7문항을 놓쳤습니다. 방법과 원자료는 [측정 기록](bench/README.md)에 모두 있습니다. 이 묶음 구성은 지금 앱에 넣고 있습니다.

**비싼 모델에는 비싼 일만 맡깁니다.** 팀 모드에서 총괄 모델(예: Claude Opus)은 일을 작업 1~6개로 나누고 결과를 승인할지만 정합니다. 답을 다시 쓰지 않고, 합치는 일도 무료 작업 모델이 합니다. 그래서 가장 비싼 출력 토큰이 구조적으로 적게 나갑니다.

**무료 모델이 멈추거나 대충 답해도 알아서 다시 맡깁니다.** 빈 답, 너무 짧은 답, 중간에 잘린 답, 시간 초과는 실패로 보고 같은 모델에 한 번 더, 그래도 안 되면 다른 무료 모델에 넘깁니다. 자주 실패하거나 느린 모델은 기록해 두고 순서를 뒤로 보냅니다. 어느 작업이 몇 초째 걸리는지 실행 화면에서 바로 보입니다.

**쓰기 전에 얼마나 들지 보입니다.** 실행 전에 예상 토큰 범위와 정해 둔 예산 대비 비율을 보여 주고, 끝나면 총괄·작업 모델 사용량을 따로 표시합니다.

**코딩 도구가 아니라 누구나 쓰는 질문 앱입니다.** 파일이나 터미널 권한 없이 일반 질문과 문서 작업에 답합니다. 화면은 한국어입니다.

## 지금 되는 것

- OpenAI, Anthropic, Gemini, Ollama 모델에 텍스트 요청
- 팀 모드: 총괄 모델이 나누고, 작업 모델이 처리하고, 총괄 모델이 판정 (최대 2회차)
- 막힌 작업 다시 맡기기: 빈 답·잘린 답·시간 초과 재시도, 모델별 기록에 따른 순서 조정, 작업별 진행 표시
- 요청 전 예상 토큰 범위, 응답 후 실제 사용량 표시
- 대화를 작업 단위로 묶기, 보관·휴지통·복원, 기기 내 저장(기본 꺼짐)
- macOS(서명·공증)·Windows x64 설치 파일, 자동 업데이트

## 다음에 오는 것

- **무료 모델 묶음을 앱 안으로:** 무료 모델 여러 개가 같은 질문을 풀고, 모델별 실력에 따라 무게를 준 투표로 답을 고릅니다. 측정에서 단순 다수결이 놓친 문항을 이 방식은 맞혔습니다.
- **내 사용량으로 배우는 토큰 추정:** 실제로 쓴 토큰을 기기 안에 기록해, 다음 요청이 예산의 몇 %를 쓸지 내 사용 패턴으로 알려 줍니다. 켜고 끌 수 있습니다.
- 질문을 보고 모델과 팀 구성을 알아서 고르는 자동 라우터
- 스트리밍 응답, 파일 첨부, 영어 화면, OpenRouter·Groq 같은 OpenAI 호환 주소

## 이런 분께 맞습니다

코드를 고치고 터미널을 다루는 에이전트가 필요하면 [OpenCode](https://opencode.ai)나 [Roo Code](https://roocode.com)가 맞고, 수십 개 제공자와 지식 베이스가 필요하면 [Cherry Studio](https://github.com/CherryHQ/cherry-studio)나 [Open WebUI](https://github.com/open-webui/open-webui)가 맞습니다. 오로라는 유료 AI 하나에 모든 걸 맡기기엔 비싸고 무료 AI 하나로는 아쉬운 분, 그리고 무엇에 얼마가 드는지 보면서 쓰고 싶은 분을 위한 앱입니다. 지금은 개인이 만드는 개발 프리뷰입니다.

## 설치

| 운영체제 | 설치 파일 |
| --- | --- |
| macOS · Apple Silicon | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.5/Aurora-0.1.5-mac-arm64.dmg) |
| macOS · Intel | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.5/Aurora-0.1.5-mac-x64.dmg) |
| Windows · x64 | [EXE](https://github.com/uiwwsw/aurora/releases/download/v0.1.5/Aurora-0.1.5-windows-x64.exe) |

Windows 설치 파일은 개발자 인증서로 서명하지 않아 SmartScreen 경고가 나올 수 있습니다. 키 설정, 팀 모드 사용법, 데이터 처리, 소스에서 실행하는 방법은 [사용 안내](docs/guide.md)에 있습니다.

## 라이선스

[MIT](LICENSE). SUITE 글꼴은 [별도 라이선스](public/fonts/LICENSE)를 따릅니다. 쓴 라이브러리와 참고한 프로젝트는 [구성 요소](docs/components.md)에 있습니다.
