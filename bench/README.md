# 무료 모델 묶음 vs ChatGPT 무료 — 측정 기록 (2026-11-25)

질문: AI를 처음 쓰는 사람에게, 무료 모델 여러 개를 묶은 오로라가 ChatGPT 무료만큼 답하는가?

## 결론

**답의 품질은 ChatGPT 무료와 같은 수준이다. 속도는 3~4배 느리다.**

| 일반 질문 31개 | 1차전 | 2차전 | 3차전 | 4차전 | ChatGPT 무료 |
|---|---|---|---|---|---|
| 구성 | 무료 3개 + 합치기 | + 위키백과 검색 | + 검색 거르기, 쉬운 질문은 1개 | + 숫자 교차 확인 | — |
| 평균 (10점 만점) | 7.26 | 7.90 | 8.00 | **8.23** | 8.19 |
| 승 / 패 / 무 | 5 / 17 / 9 | 10 / 10 / 11 | 8 / 10 / 13 | **7 / 7 / 17** | — |
| 응답 시간 (중간값) | 약 30초 | 54초 | 26.5초 | **37.8초** | 약 10초 |

코드 6개(숨은 테스트)와 문서 작업 3개(정답 대조)는 1차전부터 오로라와 ChatGPT 무료가 사실상 동점이다.

- **오로라가 강한 곳:** 계산·추론, 엑셀·글쓰기처럼 정리하는 질문.
- **오로라가 약했던 곳:** 최신 사실과 구체 숫자(노벨상, 시험 시간, 소요 시간, 전화번호). 검색과 교차 확인으로 대부분 고쳤지만 운전면허 시험 시간(50분, 실제 40분)은 끝까지 남았다.
- **남은 문제:** 속도, 그리고 무료 한도(측정 하루 만에 Groq 무료 한도를 다 썼다).

## 4차전 구성 (가장 나은 구성)

1. Gemini 3.1 Flash-Lite가 질문을 보고 검색 필요 여부와 난이도를 정한다.
2. 검색이 필요하면 위키백과 API로 찾고, 질문 단어와 맞지 않는 문서는 버린다.
3. 쉬운 질문은 NVIDIA Nemotron Ultra 하나가 답하고, 어려운 질문은 Nemotron Ultra·Gemini Flash-Lite·Nemotron Lightning 셋이 답한 뒤 Nemotron Ultra가 합친다.
4. 답에 숫자·시간·전화번호가 있으면 Gemini Flash-Lite가 대조해 틀린 부분만 고치거나 "공식 확인 필요"로 바꾼다.

모든 모델은 로컬 OmniRoute(무료 제공자 묶음)로 부른다. 구독 계정을 거치는 모델(GitHub Copilot, Augment, Codex)은 쓰지 않았다.

## 무료 모델별 측정 (40문항)

`results/model-profile.json`. 코드·문서는 자동 채점, 일반 질문은 참고용이다.

| 모델 | 코드 | 문서 | 응답 (중간값) |
|---|---|---|---|
| NVIDIA Nemotron 3 Ultra | 0.99 | 1.00 | 13초 |
| Gemini 3.1 Flash-Lite | 0.98 | 1.00 | 7초 |
| Groq gpt-oss-120b | 0.97 | 0.97 | 2초 |
| NVIDIA Nemotron 3.5 Lightning | 0.98 | 1.00 | 6.5초 |
| Kimi k2.6 / Llama 3.3 (Cloudflare) | 0.62 | 0.86~0.94 | 26초 |

약한 모델은 큰 코드 작업(계산기, CSV 해석기)에서 무너졌다. 모델별로 작업 크기를 나눠 맡기는 근거가 된다.

## 측정 방법과 한계

- 문항: `items/qa.json`(일반 질문 30개), `items/tasks.json`(코드 6개, 문서 4개). 코드 테스트는 정답 코드로 먼저 검증했고, 모델 코드는 네트워크·파일 쓰기를 막은 sandbox에서 20초 제한으로 돌렸다.
- ChatGPT 무료 답은 로그인 없이 웹에서 받은 하루치 한 번의 답이다(`results/chatgpt-*.json`). ChatGPT는 웹 검색을 썼다.
- 일반 질문은 Claude가 출처를 가린 A/B로 채점했다(`results/duel*-scores.json`). 4차전에서 바뀐 12개는 ChatGPT 답이 이전과 같아 알아볼 수 있었으므로 ChatGPT 점수는 3차전 값을 유지했다. 3차전 q29 점수는 채점 실수를 바로잡았다.
- 질문 31개, 채점관 1명 기준이라 0.04점 차이는 오차 범위다.
- OmniRoute 오토라우터 채점(`judge-auto.*`, `duel.json`)은 실패가 많고 순서에 따라 승자가 뒤집혀 결론에 쓰지 않았다.
- OmniRoute가 알리지 않고 다른 모델로 바꿔 답한 경우(26번)는 점수에서 뺐다.

## 다시 돌리기

```bash
node bench/run_models.mjs bench/results/raw-free.json <모델...>   # 모델별 답 수집
node bench/grade.mjs auto                                         # 코드·문서 자동 채점
node bench/run_aurora_search.mjs aurora-v3                        # 검색·난이도 분기 오로라
node bench/run_verify.mjs aurora-v3 aurora-v4                     # 숫자 교차 확인
```

OmniRoute 키(`~/.omniroute/claude-code.key`)는 실행 중에만 읽고 출력하지 않는다.
