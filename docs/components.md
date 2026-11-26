# 구성 요소와 빌려 쓴 것들

Aurora 저장소에 들어 있는 파일, 의존하는 라이브러리와 외부 서비스, 그리고 아이디어를 빌려 온 기존 프로젝트를 정리했다. 기준은 0.1.4 공개 버전과 main 브랜치다.

먼저 범위를 분명히 해 둔다.

- Aurora는 새로운 라우팅 알고리즘을 만들지 않았다. 앱 안의 "추천"은 분석용 모델에게 어떤 모델이 좋을지 물어보는 프롬프트 한 번이고, 실행 모델은 사람이 고른다.
- 팀 모드의 총괄 모델 기본값은 Claude Opus 5.5(OpenAI 프리셋에서는 GPT-6 Astra)로, 유료 API 키가 필요하다. 무료로 돌아가는 쪽은 작업 모델(Gemini Flash 무료 한도, Ollama 로컬)뿐이다. 총괄 모델에 무료 모델을 고를 수는 있지만 그 조합은 측정하지 않았다.
- `bench/`의 "무료 모델 묶음"은 앱 기능이 아니다. 별도 스크립트가 로컬 [a local gateway](https://github.com/diegosouzapw/a local gateway)를 거쳐 무료 제공자들을 부른 실험이고, 여러 무료 제공자를 하나의 주소로 모아 주는 일은 a local gateway가 한다.

## 파일 구조

```
aurora/
├── electron/                  # 데스크톱 앱의 메인 프로세스 (Node.js 쪽)
│   ├── main.cjs               # 창 생성, aurora:// 프로토콜, IPC 처리, 메뉴
│   ├── preload.cjs            # 화면(renderer)에 window.auroraAI만 노출하는 다리
│   ├── providers.cjs          # 제공자 4곳(OpenAI·Anthropic·Gemini·Ollama) 호출 어댑터
│   ├── team.cjs               # 팀 모드: 총괄 모델이 나누고 작업 모델이 처리, 총괄 모델이 판정
│   └── updates.cjs            # electron-updater 연결, 업데이트 확인·재시작 안내
├── src/                       # 화면 (React)
│   ├── main.tsx               # 대화·작업 정리·설정 화면 전체 (약 1,450줄 단일 파일)
│   ├── domain.ts              # 토큰 범위 추정, 작업 묶기 규칙, 예산 비율 계산
│   ├── routing.ts             # 모델 역할 설정(분석·실행·총괄·작업 모델)과 타입 정의
│   ├── catalog.json           # 앱이 아는 모델 8개 목록과 등급(경량·표준·고급)
│   └── style.css
├── scripts/                   # 빌드·배포 도구
│   ├── build-web.mjs          # 웹 데모와 한/영 소개 페이지, sitemap 생성
│   ├── package.mjs            # electron-builder로 DMG·ZIP·EXE 생성
│   ├── package-store.mjs      # Microsoft Store용 패키지
│   ├── mac-signing.mjs        # Developer ID 서명 설정 확인
│   ├── prepare-release.mjs    # 버전·태그 점검
│   ├── publish-release.mjs    # 체크섬 계산과 GitHub Release 게시
│   ├── desktop-smoke.mjs      # Playwright로 Electron 화면 점검
│   ├── package-smoke.mjs      # 설치 파일을 풀어 실행 점검
│   ├── check-packaged-notice.mjs  # 패키지 안 고지 파일 확인
│   └── icons.mjs              # SVG 아이콘을 PNG로 변환
├── tests/                     # node:test 단위 테스트 (모델 API는 모의 응답)
├── bench/                     # 앱과 별개인 측정 스크립트 (a local gateway 필요)
│   ├── run_models.mjs         # 무료 모델별로 같은 문항을 돌려 답 수집
│   ├── run_aurora.mjs         # 무료 모델 3개가 답하고 1개가 합치는 구성
│   ├── run_aurora_search.mjs  # 위키백과 검색 결과를 붙이고 쉬운 질문은 1개만
│   ├── run_verify.mjs         # 다른 무료 모델이 숫자·시간·전화번호만 대조
│   ├── grade.mjs              # 코드·문서 자동 채점, 블라인드 채점 묶음 생성
│   ├── judge_auto.mjs, duel.mjs  # a local gateway 자동 라우터로 채점 시도 (결론에 쓰지 않음)
│   └── items/, results/, checks/ # 문항, 원자료, 코드 채점 샌드박스
├── docs/                      # 설정·릴리스·설계 문서
└── .workspace/                # 개인 작업 공간 도구용 메타데이터 (showcase.json 등)
```

## 앱 안에서 요청이 지나가는 길

1. 화면(`src/main.tsx`)이 `window.auroraAI.request()`를 부른다. 이 함수는 `preload.cjs`가 만든 것이고, 화면은 API 키를 보지 못한다.
2. 메인 프로세스(`main.cjs`)가 IPC로 받아 `providers.cjs`의 `request()`로 넘긴다.
3. `providers.cjs`는 모델 목록(`catalog.json`)에서 제공자를 찾아 환경 변수의 키(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`)를 붙여 한 번 호출한다. 오류가 나도 자동으로 다시 보내지 않고, 제공자의 오류 본문은 화면에 넘기지 않는다.
4. 팀 모드이면 `team.cjs`의 `orchestrate()`가 같은 `request()`를 여러 번 부른다: 총괄 모델 계획 1번 → 작업 1~6번 → 총괄 모델 판정 → 필요한 작업만 재시도(최대 2회차) → 작업 모델이 결과 합치기.

토큰 "예상"은 `domain.ts`에서 문자 수와 모델 등급만으로 계산한다. 실제 토크나이저를 쓰지 않으므로 같은 등급의 모델은 같은 범위가 나온다.

## 의존하는 라이브러리

실행에 들어가는 것:

| 패키지 | 하는 일 |
| --- | --- |
| [react](https://react.dev), react-dom | 화면 전체 |
| [lucide-react](https://lucide.dev) | 아이콘 |
| [electron-updater](https://www.electron.build/auto-update) | 설치 앱의 업데이트 확인·다운로드 (GitHub Release 피드) |

개발과 빌드에만 쓰는 것:

| 패키지 | 하는 일 |
| --- | --- |
| [electron](https://www.electronjs.org) | 데스크톱 앱 런타임 |
| [electron-builder](https://www.electron.build) | DMG·ZIP·EXE·Store 패키지 생성, 서명·공증 연결 |
| [vite](https://vite.dev), @vitejs/plugin-react | 화면 번들링 |
| [typescript](https://www.typescriptlang.org), [tsx](https://tsx.is) | 타입 검사, `.ts` 테스트 바로 실행 |
| [@playwright/test](https://playwright.dev) | Electron 화면·설치 파일 점검 |
| [@resvg/resvg-js](https://github.com/thx/resvg-js) | 아이콘 SVG를 PNG로 변환 |
| js-yaml | 업데이트 피드(`latest-mac.yml` 등) 읽기·병합 |
| prettier | 코드 정리 |

모델 제공자용 SDK는 쓰지 않는다. 네 제공자 모두 `fetch`로 직접 부른다.

## 외부 서비스

| 서비스 | 쓰는 곳 | 비용 |
| --- | --- | --- |
| OpenAI Responses API | 분석·실행·총괄 모델 | 유료 API 키 |
| Anthropic Messages API | 분석·실행·총괄 모델 (팀 모드 총괄 모델 기본값) | 유료 API 키 |
| Google Gemini (OpenAI 호환 주소) | 작업 모델 기본값 | 무료 한도 안에서 무료 |
| [Ollama](https://ollama.com) | 작업 모델 (내 컴퓨터에서 실행, 기본 `qwen3`) | 무료, 대신 내 컴퓨터 자원 사용 |
| [a local gateway](https://github.com/diegosouzapw/a local gateway) | `bench/` 스크립트만 | 무료 제공자 묶음. 앱은 쓰지 않음 |
| 위키백과 API | `bench/run_aurora_search.mjs`만 | 무료 |
| GitHub Releases, Vercel | 설치 파일 배포, 웹 데모 | — |

## 빌려 온 아이디어

Aurora의 구조는 이미 알려진 방식들을 가져와 작게 붙인 것이다.

- **팀 모드 (총괄 모델이 나누고 작업 모델이 처리, 총괄 모델이 판정):** Anthropic의 [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)에 정리된 orchestrator-workers와 evaluator-optimizer 패턴 그대로다.
- **`bench/`의 "여러 모델이 답하고 하나가 합치기":** Together AI의 [Mixture-of-Agents](https://github.com/togethercomputer/MoA)(2024)와 같은 구조다. 여러 답을 모아 합치는 연구로는 [LLM-Blender](https://github.com/yuchenlin/LLM-Blender)(2023)도 있다.
- **질문마다 모델 고르기:** 학습된 라우터는 LMSYS의 [RouteLLM](https://github.com/lm-sys/RouteLLM), 서비스로는 [OpenRouter](https://openrouter.ai)의 `openrouter/auto`가 있다. Aurora는 라우터를 학습하지 않았고, 분석 모델에게 묻는 방식이라 이것들보다 단순하다.
- **여러 제공자를 하나의 주소로:** [LiteLLM](https://github.com/BerriAI/litellm)과 a local gateway가 하는 일이다. Aurora의 `providers.cjs`는 네 제공자만 직접 연결한 작은 어댑터다.
- **검색 결과를 붙여 답하기, 다른 모델로 사실 대조:** 일반적인 RAG와 자기 검증(self-verification) 방식이다.

문서 구성은 [nanochat](https://github.com/karpathy/nanochat) README의 파일 구조 설명과 감사의 말 형식을 참고했다.
