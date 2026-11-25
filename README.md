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


## 장점

- 한 모델(예: Claude)에 묶이지 않고, 선임과 주니어를 각각 다른 제공자의 모델로 지정할 수 있습니다.
- 선임·주니어 모두 Gemini Flash 무료 한도나 내 컴퓨터의 Ollama로 지정하면 유료 키 없이 팀을 구성할 수 있습니다. 이 조합의 답 품질은 아직 측정하지 않았습니다.
- 주니어에게는 작업 지시만 보내고 대화 전체를 보내지 않습니다. 실패하면 다른 무료 모델로 넘깁니다.

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

개인이 만든 개발 프리뷰입니다. 사용자 수와 실사용 사례는 아직 없습니다.

| 비교 대상 | 그쪽이 앞서는 점 | Aurora가 다른 점 |
| --- | --- | --- |
| [Cherry Studio](https://github.com/CherryHQ/cherry-studio), [Msty](https://msty.ai), [Jan](https://jan.ai) (데스크톱 앱) | 수십 개 제공자, 지식 베이스, MCP, 여러 모델 답 나란히 비교, 스트리밍 | 선임이 나누고 주니어가 처리하는 팀 모드가 기본 기능 |
| [Open WebUI](https://github.com/open-webui/open-webui), [LibreChat](https://github.com/danny-avila/librechat), [LobeHub](https://github.com/lobehub/lobe-chat) (자체 호스팅 웹) | 에이전트, MCP, RAG, 다중 사용자, 큰 사용자층 | 서버 없이 설치형 앱 하나 |
| [CrewAI](https://github.com/crewAIInc/crewAI), [AutoGen](https://github.com/microsoft/autogen), [LangGraph](https://github.com/langchain-ai/langgraph) (프레임워크) | 역할·도구·흐름을 코드로 자유롭게 설계 | 코드 없이 설정 화면에서 팀 구성 |

팀 모드 자체는 Anthropic이 정리한 [orchestrator-workers](https://www.anthropic.com/engineering/building-effective-agents) 방식이고 새 기법이 아닙니다. 앱 밖 측정에서는 무료 모델 다수결 묶음이 추론 시험 30문항에서 29점(ChatGPT 무료 23점)이었지만, 무료 모델 하나가 혼자 30점을 받았습니다. 묶어서 더 나아졌다는 근거는 아직 없습니다. 자세한 내용은 [측정 기록](bench/README.md)에 있습니다.

## 설치

| 운영체제 | 설치 파일 |
| --- | --- |
| macOS · Apple Silicon | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-mac-arm64.dmg) |
| macOS · Intel | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-mac-x64.dmg) |
| Windows · x64 | [EXE](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-windows-x64.exe) |

Windows 설치 파일은 개발자 인증서로 서명하지 않아 SmartScreen 경고가 나올 수 있습니다. 키 설정, 팀 모드 사용법, 데이터 처리, 소스에서 실행하는 방법은 [사용 안내](docs/guide.md)에 있습니다.

## 라이선스

[MIT](LICENSE). SUITE 글꼴은 [별도 라이선스](public/fonts/LICENSE)를 따릅니다. 쓴 라이브러리와 참고한 프로젝트는 [구성 요소](docs/components.md)에 있습니다.
