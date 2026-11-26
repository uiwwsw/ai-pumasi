# AI Pumasi 사용 안내

[README로 돌아가기](../README.md)

## 빠른 시작

1. 쓸 제공자의 키를 설정 → API 키에서 넣습니다. 키는 OS 키체인으로 암호화해 저장하고 화면에 다시 보여 주지 않습니다. `.env` 파일도 계속 읽습니다(설정에 저장한 키가 우선). 설치 앱은 macOS `~/Library/Application Support/AI Pumasi/.env`, Windows `%APPDATA%/AI Pumasi/.env`를 읽고, 환경 변수도 받습니다.

   ```bash
   OPENAI_API_KEY=...        # OpenAI 모델
   ANTHROPIC_API_KEY=...     # Claude 모델, 팀 모드 총괄 모델 기본값
   GEMINI_API_KEY=...        # Gemini Flash·Flash Lite (무료 한도 있음)
   NVIDIA_API_KEY=...        # Nemotron Super·Ultra·Lightning (무료)
   OPENROUTER_API_KEY=...    # Nemotron 무료 예비 경로
   GROQ_API_KEY=...          # GPT-OSS 120B (무료)
   OLLAMA_MODEL=qwen3        # 내 컴퓨터의 Ollama 모델 이름 (기본 qwen3)
   ```

   Ollama는 키 없이 `http://127.0.0.1:11434`에 켜져 있으면 연결됩니다.

2. 앱을 다시 시작하고 설정에서 **실제 API 사용**을 켭니다. 이 스위치만으로는 요청이 나가지 않습니다.
3. 요청을 쓰고 **내부 모델로 분석**(선택)으로 추천을 받거나, 실행 모델을 골라 **선택한 모델로 API 실행**을 누릅니다.
4. 팀 모드는 설정 → 팀 모드에서 켜고 총괄·작업 모델을 고릅니다.

오류가 나면 자동으로 다시 보내거나 다른 모델로 바꾸지 않습니다. 시간 초과나 잘못된 응답이어도 사용량은 이미 생겼을 수 있습니다. 자세한 내용은 [구성 가이드](configuration.md)에 있습니다.

## 팀 모드는 이렇게 돕니다

Anthropic이 [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)에서 정리한 orchestrator-workers 방식을 그대로 옮겼습니다. 코드는 `electron/team.cjs` 한 파일입니다.

1. **계획:** 총괄 모델이 요청을 작업 모델이 혼자 끝낼 수 있는 작업 1~6개로 나눠 JSON으로 돌려줍니다.
2. **작업:** 작업 모델이 작업 지시 하나만 받아 처리합니다. 대화 전체는 보내지 않습니다. 429나 서버 오류가 나면 한 번 다시 시도하고, 키가 있는 다른 무료 모델(Gemini, 켜져 있는 Ollama)로 넘깁니다.
3. **판정:** 총괄 모델이 결과를 보고 승인하거나 고칠 작업과 피드백만 돌려줍니다. 총괄 모델은 답을 다시 쓰지 않습니다.
4. **재작업:** 지적된 작업만 다시 시킵니다. 최대 2회차입니다.
5. **합치기:** 작업이 여럿이면 작업 모델이 하나로 합칩니다. 합치다 잘릴 만큼 길면 결과를 그대로 이어 붙여 보여 줍니다.

총괄 모델 호출은 계획 1번과 회차마다 판정 1번이고, 그 비용은 총괄 모델 제공자 계정에 청구됩니다. 응답 아래에 총괄·작업 모델 토큰을 따로 표시합니다.

## 앱 밖에서 한 측정

`bench/`에는 측정 기록이 있습니다. 무료 모델은 각 제공자의 무료 API로 불렀고, 묶음 투표는 0.1.6부터 앱에 들어 있습니다.

| 측정 | 무료 모델 묶음 | ChatGPT 무료 | 참고 |
| --- | --- | --- | --- |
| 어려운 추론 시험 30문항 (자동 채점) | 29 (4개 모델 다수결) | 23 | 무료 모델 Nemotron 3.5 Super **단독 30점** |
| 일반 질문 31개 (10점 만점) | 8.23 (3개가 답하고 1개가 합침, 검색·숫자 대조 포함) | 8.19 | 차이는 오차 범위 |
| 코드 6개·문서 3개 | 동점 | 동점 | |
| 응답 시간 | 일반 질문 중간값 약 38초, 추론 문항 약 10분 | 약 10초 | |

이 결과로 말할 수 있는 것은 "무료 모델 묶음이 이 문항들에서 ChatGPT 무료보다 못하지 않았다"는 정도입니다. 추론 시험에서는 가장 강한 무료 모델 하나가 묶음보다 높았으므로, 묶었기 때문에 더 나아졌다고 볼 근거는 아직 없습니다. 문항이 적고, 일반 질문은 Claude 한 명이 출처를 가리고 채점했고, ChatGPT 답은 하루 한 번 받은 것입니다. 방법과 원자료는 [측정 기록](../bench/README.md)에 있습니다.

여러 모델이 답하고 하나가 합치거나 다수결로 고르는 방식은 [Mixture-of-Agents](https://github.com/togethercomputer/MoA)와 self-consistency 투표에서 이미 쓰는 방식입니다.

## 구조

```
electron/   메인 프로세스: 창, IPC, 제공자 어댑터(providers.cjs), 팀 모드(team.cjs), 업데이트
src/        React 화면(main.tsx), 토큰 추정과 규칙(domain.ts), 모델 역할(routing.ts), 모델 목록(catalog.json)
scripts/    웹 데모 생성, 패키징, 서명 확인, 릴리스 게시, Playwright 점검
tests/      node:test 단위 테스트 (제공자 호출은 모의 응답)
bench/      측정 기록: 문항, 시험 생성기, 채점기, 원자료
docs/       구성·릴리스·설계 문서
```

API 키는 Electron 메인 프로세스에서만 다루고 화면(renderer)에는 넘기지 않습니다. 제공자 SDK 없이 네 제공자 모두 `fetch`로 직접 부릅니다. 파일별 설명과 의존성 목록은 [구성 요소와 빌려 쓴 것들](components.md)에 있습니다.

## 데이터

- 웹 데모는 대화를 어디에도 보내지 않습니다.
- 설치 앱에서 실행하면 요청과 선택한 문맥이 고른 제공자에게 전송됩니다. 팀 모드 작업 모델에게는 작업 지시만 갑니다.
- 대화 저장은 기본 꺼짐이고, 켜면 현재 기기에 암호화 없이 저장합니다. 끄면 저장 사본을 지웁니다.
- 호출별 출력 상한은 분석 2,048토큰, 실행·팀 작업 4,096토큰입니다. 상한에 닿으면 답이 잘릴 수 있습니다.

## 업데이트

Windows는 시작할 때와 6시간마다 새 버전을 확인하고 백그라운드로 내려받은 뒤 재시작을 안내합니다. 도움말 → **업데이트 확인…**으로 직접 확인할 수도 있습니다. macOS 자동 업데이트는 Developer ID로 서명된 빌드에서만 켜집니다. 0.1.1 이하와 이전 ad-hoc 서명 빌드는 새 설치 파일로 한 번 바꿔야 합니다. 버전 간 실제 자동 설치는 아직 따로 검증하지 않았습니다.

## 소스에서 실행

Node.js 24 이상이 필요합니다.

```bash
git clone https://github.com/uiwwsw/ai-pumasi.git
cd ai-pumasi
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

릴리스와 서명 절차는 [릴리스 문서](releases.md), 기여 방법은 [CONTRIBUTING.md](../CONTRIBUTING.md)에 있습니다.
