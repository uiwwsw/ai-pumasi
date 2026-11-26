<div align="center">

<img src="https://raw.githubusercontent.com/uiwwsw/aurora/main/build/icon.svg" alt="Aurora" width="96" height="96">

<h1>Aurora · 오로라</h1>

<p>여러 AI 모델을 선임·주니어 팀으로 묶어 돌리는 데스크톱 앱</p>

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


## 다른 도구와 다른 점

여러 모델을 팀으로 묶는 것 자체는 흔합니다. [OpenCode](https://opencode.ai/docs/agents/)는 에이전트마다 다른 모델(무료 모델 포함)을 지정하는 데스크톱 앱이 있고, [Roo Code](https://docs.roocode.com/features/boomerang-tasks)의 오케스트레이터 모드도 모드별로 모델을 나눕니다. [Orkas](https://github.com/Orkas-AI/Orkas) 같은 리드·하위 에이전트 데스크톱 앱도 여럿 있습니다. Aurora에서 코드로 확인되는 차이는 아래뿐입니다.

- **선임 출력 제한:** 선임 모델은 작업 목록과 승인·재작업 판정만 JSON으로 냅니다. 답을 다시 쓰지 않고, 결과 합치기도 주니어가 합니다. 비싼 모델의 출력 토큰이 구조적으로 작습니다 (`electron/team.cjs`).
- **무료 한도 대비:** 주니어 호출이 429·5xx로 실패하면 한 번 다시 시도하고, 키가 있는 다른 무료 모델로 넘깁니다.
- **비용이 보이는 실행:** 실행 전 예상 토큰 범위를 보여 주고, 응답 뒤에는 선임·주니어 사용량을 따로 표시합니다.
- **코딩 도구가 아님:** 파일·셸 권한 없이 일반 질문과 문서 작업에 답하는 데스크톱 앱입니다. 화면은 한국어입니다.
- **공개 측정:** 무료 모델 묶음과 ChatGPT 무료를 같은 한국어 문항으로 비교한 방법과 원자료를 공개했습니다 ([측정 기록](bench/README.md)).

이 차이들은 작고 다른 도구가 쉽게 따라 할 수 있습니다. "무료 모델 묶음이 단일 모델보다 낫다"를 앱 안에서 보여 주기 전까지는 뚜렷한 차별점이 없습니다.

## 지금 되는 것

- OpenAI, Anthropic, Gemini, Ollama 모델에 텍스트 요청
- 팀 모드: 선임이 작업 1~6개로 나누고, 주니어가 처리하고, 선임이 판정 (최대 2회차)
- 요청 전 예상 토큰 범위, 응답 후 실제 사용량 표시
- 대화를 작업 단위로 묶기, 보관·휴지통·복원, 기기 내 저장(기본 꺼짐)
- macOS(서명·공증)·Windows x64 설치 파일, Windows 자동 업데이트

## 진행 예정

- 질문을 보고 모델과 팀 구성을 알아서 고르는 자동 라우터 (지금은 키워드·글자 수 규칙으로 등급만 추천)
- 무료 모델끼리 묶어 답을 합치는 구성의 앱 반영 (지금은 `bench/` 측정 스크립트에만 있음)
- 무료 모델만으로 짠 팀의 품질 측정
- 스트리밍 응답, 파일 첨부, 영어 화면
- OpenRouter·Groq 같은 OpenAI 호환 주소 직접 추가
- 실제 제공자 키로 팀 모드 검증 (지금은 모의 응답 테스트만)

## 현재 위치

개인이 만든 개발 프리뷰입니다. 알려진 사용자와 실사용 사례가 없습니다.

| 비교 대상 | 그쪽이 앞서는 점 |
| --- | --- |
| [OpenCode](https://opencode.ai), [Roo Code](https://roocode.com) (코딩 에이전트) | 에이전트별 모델 지정, 무료 모델, 파일·터미널 작업, 큰 사용자층 |
| [Orkas](https://github.com/Orkas-AI/Orkas), [Agent Teams AI](https://github.com/777genius/agent-teams-ai) (팀 데스크톱 앱) | 병렬 하위 에이전트, 로컬 모델, 도구 실행 |
| [Cherry Studio](https://github.com/CherryHQ/cherry-studio), [Msty](https://msty.ai), [Jan](https://jan.ai) (채팅 앱) | 수십 개 제공자, 지식 베이스, MCP, 스트리밍, 여러 답 나란히 비교 |
| [Open WebUI](https://github.com/open-webui/open-webui), [LibreChat](https://github.com/danny-avila/librechat) (자체 호스팅) | 에이전트, RAG, 다중 사용자 |

앱 밖 측정에서 무료 모델 다수결 묶음은 추론 시험 30문항에서 29점(ChatGPT 무료 23점)이었지만, 무료 모델 하나가 혼자 30점을 받았습니다. 묶어서 더 나아졌다는 근거는 아직 없습니다.

## 설치

| 운영체제 | 설치 파일 |
| --- | --- |
| macOS · Apple Silicon | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-mac-arm64.dmg) |
| macOS · Intel | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-mac-x64.dmg) |
| Windows · x64 | [EXE](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-windows-x64.exe) |

Windows 설치 파일은 개발자 인증서로 서명하지 않아 SmartScreen 경고가 나올 수 있습니다. 키 설정, 팀 모드 사용법, 데이터 처리, 소스에서 실행하는 방법은 [사용 안내](docs/guide.md)에 있습니다.

## 라이선스

[MIT](LICENSE). SUITE 글꼴은 [별도 라이선스](public/fonts/LICENSE)를 따릅니다. 쓴 라이브러리와 참고한 프로젝트는 [구성 요소](docs/components.md)에 있습니다.
