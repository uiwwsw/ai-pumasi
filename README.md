<div align="center">

<img src="https://raw.githubusercontent.com/uiwwsw/aurora/main/build/icon.svg" alt="Aurora" width="96" height="96">

<h1>Aurora · 오로라</h1>

<p>OpenAI·Anthropic·Gemini·Ollama 모델을 한 창에서 쓰는 데스크톱 앱</p>

<p>
<a href="https://github.com/uiwwsw/aurora/releases"><img alt="release" src="https://img.shields.io/github/v/release/uiwwsw/aurora?include_prereleases&style=flat-square&label=release"></a>
<a href="https://github.com/uiwwsw/aurora/actions/workflows/check.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/uiwwsw/aurora/check.yml?branch=main&style=flat-square&label=CI"></a>
<img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-607b64?style=flat-square">
<img alt="Electron" src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white">
<img alt="providers" src="https://img.shields.io/badge/providers-OpenAI%20%7C%20Anthropic%20%7C%20Gemini%20%7C%20Ollama-555?style=flat-square">
<img alt="status" src="https://img.shields.io/badge/status-developer%20preview-orange?style=flat-square">
<a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/uiwwsw/aurora?style=flat-square"></a>
</p>

<p><a href="https://aurora-two-virid.vercel.app/">웹 데모</a> · <a href="#설치">다운로드</a> · <a href="docs/components.md">구성 요소</a> · <a href="bench/README.md">측정 기록</a> · <a href="CHANGELOG.md">변경 기록</a> · <a href="README.en.md">English</a></p>

</div>

<img src="https://raw.githubusercontent.com/uiwwsw/aurora/main/docs/images/aurora-v0.1.png" alt="Aurora 작업 공간">

## 제공하는 것

- OpenAI, Anthropic, Google Gemini, 로컬 Ollama 모델에 텍스트 요청
- 요청 전 예상 입력·출력 토큰 범위 (문자 수와 모델 등급 기준)
- 응답 후 제공자가 보고한 실제 토큰 사용량
- 분석 모델에게 맞는 모델 추천 받기 (실행 모델은 직접 선택)
- 팀 모드: 선임 모델이 작업 1~6개로 나누고, 주니어 모델이 하나씩 처리하고, 선임이 판정
- 팀 모드 주니어 실패 시 1회 재시도, 다른 무료 모델로 넘김
- 대화를 작업 단위로 묶기, 보관·휴지통·복원
- 대화 저장 켜기·끄기 (기본 꺼짐, 기기 내 저장)
- macOS(서명·공증) DMG, Windows x64 설치 파일
- Windows 자동 업데이트 (시작 시와 6시간마다 확인)
- 설치 없이 보는 웹 데모 (AI 호출 없음)

## 제공하지 않는 것

- 질문을 보고 모델을 골라 실행하는 자동 라우터 (앱 안의 등급 추천은 키워드·글자 수 규칙, `src/domain.ts`)
- 무료 모델만으로 도는 기본 팀 모드 (선임 기본값 Claude Opus 5.5, 유료 API 키 필요)
- 파일 수정, 셸 실행, 웹 검색 같은 도구
- 실제 토크나이저 기반 토큰 계산, 전체 작업 비용 제한
- 실제 제공자로 검증한 팀 모드 (모의 응답으로만 테스트)

## 설치

| 운영체제 | 설치 파일 |
| --- | --- |
| macOS · Apple Silicon | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-mac-arm64.dmg) |
| macOS · Intel | [DMG](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-mac-x64.dmg) |
| Windows · x64 | [EXE](https://github.com/uiwwsw/aurora/releases/download/v0.1.4/Aurora-0.1.4-windows-x64.exe) |

ZIP, 체크섬, 변경 기록은 [v0.1.4 릴리스](https://github.com/uiwwsw/aurora/releases/tag/v0.1.4)에 있습니다. macOS 파일은 Developer ID 서명과 Apple 공증을 거쳤습니다. Windows 설치 파일은 개발자 인증서로 서명하지 않아 SmartScreen 경고가 나올 수 있습니다.

설치 없이 화면만 보려면 [웹 데모](https://aurora-two-virid.vercel.app/)를 여세요. 웹 데모는 AI를 호출하지 않는 로컬 미리보기이고, 화면은 한국어입니다.

## 빠른 시작

1. 쓸 제공자의 키를 `.env` 파일에 넣습니다. 설치 앱은 macOS `~/Library/Application Support/Aurora/.env`, Windows `%APPDATA%/Aurora/.env`를 읽고, 환경 변수도 받습니다.

   ```bash
   OPENAI_API_KEY=...        # OpenAI 모델
   ANTHROPIC_API_KEY=...     # Claude 모델, 팀 모드 선임 기본값
   GEMINI_API_KEY=...        # Gemini Flash (무료 한도 있음)
   OLLAMA_MODEL=qwen3        # 내 컴퓨터의 Ollama 모델 이름 (기본 qwen3)
   ```

   Ollama는 키 없이 `http://127.0.0.1:11434`에 켜져 있으면 연결됩니다.

2. 앱을 다시 시작하고 설정에서 **실제 API 사용**을 켭니다. 이 스위치만으로는 요청이 나가지 않습니다.
3. 요청을 쓰고 **내부 모델로 분석**(선택)으로 추천을 받거나, 실행 모델을 골라 **선택한 모델로 API 실행**을 누릅니다.
4. 팀 모드는 설정 → 팀 모드에서 켜고 선임·주니어 모델을 고릅니다.

오류가 나면 자동으로 다시 보내거나 다른 모델로 바꾸지 않습니다. 시간 초과나 잘못된 응답이어도 사용량은 이미 생겼을 수 있습니다. 자세한 내용은 [구성 가이드](docs/configuration.md)에 있습니다.

## 팀 모드는 이렇게 돕니다

Anthropic이 [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)에서 정리한 orchestrator-workers 방식을 그대로 옮겼습니다. 코드는 `electron/team.cjs` 한 파일입니다.

1. **계획:** 선임이 요청을 주니어가 혼자 끝낼 수 있는 작업 1~6개로 나눠 JSON으로 돌려줍니다.
2. **작업:** 주니어가 작업 지시 하나만 받아 처리합니다. 대화 전체는 보내지 않습니다. 429나 서버 오류가 나면 한 번 다시 시도하고, 키가 있는 다른 무료 모델(Gemini, 켜져 있는 Ollama)로 넘깁니다.
3. **판정:** 선임이 결과를 보고 승인하거나 고칠 작업과 피드백만 돌려줍니다. 선임은 답을 다시 쓰지 않습니다.
4. **재작업:** 지적된 작업만 다시 시킵니다. 최대 2회차입니다.
5. **합치기:** 작업이 여럿이면 주니어가 하나로 합칩니다. 합치다 잘릴 만큼 길면 결과를 그대로 이어 붙여 보여 줍니다.

선임 호출은 계획 1번과 회차마다 판정 1번이고, 그 비용은 선임 제공자 계정에 청구됩니다. 응답 아래에 선임·주니어 토큰을 따로 표시합니다.

## 앱 밖에서 한 측정

`bench/`에는 앱과 별개인 측정 스크립트가 있습니다. 스크립트는 로컬 [OmniRoute](https://github.com/diegosouzapw/OmniRoute)(여러 무료 제공자를 한 주소로 모아 주는 오픈소스 게이트웨이)를 거쳐 무료 모델을 부릅니다. 아래 구성은 **앱에 들어 있지 않습니다.**

| 측정 | 무료 모델 묶음 | ChatGPT 무료 | 참고 |
| --- | --- | --- | --- |
| 어려운 추론 시험 30문항 (자동 채점) | 29 (4개 모델 다수결) | 23 | 무료 모델 Nemotron 3.5 Super **단독 30점** |
| 일반 질문 31개 (10점 만점) | 8.23 (3개가 답하고 1개가 합침, 검색·숫자 대조 포함) | 8.19 | 차이는 오차 범위 |
| 코드 6개·문서 3개 | 동점 | 동점 | |
| 응답 시간 | 일반 질문 중간값 약 38초, 추론 문항 약 10분 | 약 10초 | |

이 결과로 말할 수 있는 것은 "무료 모델 묶음이 이 문항들에서 ChatGPT 무료보다 못하지 않았다"는 정도입니다. 추론 시험에서는 가장 강한 무료 모델 하나가 묶음보다 높았으므로, 묶었기 때문에 더 나아졌다고 볼 근거는 아직 없습니다. 문항이 적고, 일반 질문은 Claude 한 명이 출처를 가리고 채점했고, ChatGPT 답은 하루 한 번 받은 것입니다. 방법과 원자료는 [측정 기록](bench/README.md)에 있습니다.

여러 모델이 답하고 하나가 합치거나 다수결로 고르는 방식은 [Mixture-of-Agents](https://github.com/togethercomputer/MoA)와 self-consistency 투표에서 이미 쓰는 방식입니다.

## 구조

```
electron/   메인 프로세스: 창, IPC, 제공자 어댑터(providers.cjs), 팀 모드(team.cjs), 업데이트
src/        React 화면(main.tsx), 토큰 추정과 규칙(domain.ts), 모델 역할(routing.ts), 모델 목록(catalog.json)
scripts/    웹 데모 생성, 패키징, 서명 확인, 릴리스 게시, Playwright 점검
tests/      node:test 단위 테스트 (제공자 호출은 모의 응답)
bench/      앱과 별개인 측정 스크립트와 결과 (OmniRoute 필요)
docs/       구성·릴리스·설계 문서
```

API 키는 Electron 메인 프로세스에서만 다루고 화면(renderer)에는 넘기지 않습니다. 제공자 SDK 없이 네 제공자 모두 `fetch`로 직접 부릅니다. 파일별 설명과 의존성 목록은 [구성 요소와 빌려 쓴 것들](docs/components.md)에 있습니다.

## 데이터

- 웹 데모는 대화를 어디에도 보내지 않습니다.
- 설치 앱에서 실행하면 요청과 선택한 문맥이 고른 제공자에게 전송됩니다. 팀 모드 주니어에게는 작업 지시만 갑니다.
- 대화 저장은 기본 꺼짐이고, 켜면 현재 기기에 암호화 없이 저장합니다. 끄면 저장 사본을 지웁니다.
- 호출별 출력 상한은 분석 2,048토큰, 실행·팀 작업 4,096토큰입니다. 상한에 닿으면 답이 잘릴 수 있습니다.

## 업데이트

Windows는 시작할 때와 6시간마다 새 버전을 확인하고 백그라운드로 내려받은 뒤 재시작을 안내합니다. 도움말 → **업데이트 확인…**으로 직접 확인할 수도 있습니다. macOS 자동 업데이트는 Developer ID로 서명된 빌드에서만 켜집니다. 0.1.1 이하와 이전 ad-hoc 서명 빌드는 새 설치 파일로 한 번 바꿔야 합니다. 버전 간 실제 자동 설치는 아직 따로 검증하지 않았습니다.

## 소스에서 실행

Node.js 24 이상이 필요합니다.

```bash
git clone https://github.com/uiwwsw/aurora.git
cd aurora
npm ci
cp .env.example .env   # 키 입력 (선택)
npm start
```

| 명령 | 하는 일 |
| --- | --- |
| `npm run build` | 타입 검사와 화면 빌드 |
| `npm test` | 도메인·제공자 어댑터·팀 모드·업데이트·웹 생성 테스트 |
| `npm run test:desktop` | Playwright로 Electron 화면 점검 |
| `npm run build:web` | 웹 데모와 한/영 소개 페이지 생성 |
| `npm run package:mac` / `package:win` | 설치 파일 생성 |

릴리스와 서명 절차는 [릴리스 문서](docs/releases.md), 기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)에 있습니다.

## 빌려 쓴 것

- 팀 모드 구조: Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) (orchestrator-workers, evaluator-optimizer)
- 측정용 무료 모델 게이트웨이: [OmniRoute](https://github.com/diegosouzapw/OmniRoute)
- 여러 답을 모으는 방식: [Mixture-of-Agents](https://github.com/togethercomputer/MoA), [LLM-Blender](https://github.com/yuchenlin/LLM-Blender)
- 모델 라우팅의 기존 작업: [RouteLLM](https://github.com/lm-sys/RouteLLM), [OpenRouter](https://openrouter.ai)의 `openrouter/auto`, 다중 제공자 게이트웨이 [LiteLLM](https://github.com/BerriAI/litellm)
- 앱: [Electron](https://www.electronjs.org), [electron-builder](https://www.electron.build), [React](https://react.dev), [Vite](https://vite.dev), [Lucide](https://lucide.dev) 아이콘, [SUITE](https://sun.fo/suite) 글꼴

## 라이선스

[MIT](LICENSE). SUITE 글꼴은 [별도 라이선스](public/fonts/LICENSE)를 따릅니다.
