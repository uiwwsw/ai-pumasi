# Contributing

## 개발 환경

Node.js 24 이상에서 실행합니다.

```bash
npm ci
npm start
npm run build
npm test
npm run test:desktop
```

데스크톱 테스트는 독립 임시 프로필을 생성하고, 결과를 `artifacts/`에 기록합니다.

## 변경 제출

- 버그는 재현 단계, OS, Node.js 버전, 관련 로그와 함께 이슈로 등록합니다.
- 큰 기능이나 의존성 변경은 구현 전에 이슈에서 범위를 논의합니다.
- PR에는 변경 목적과 검증 결과를 적습니다. UI 변경에는 스크린샷을 첨부합니다.
- 동작을 변경하면 관련 테스트를 확인하고, 검증하지 않은 플랫폼은 명시합니다.
- 비밀값, 개인 대화, 계정 토큰과 로컬 프로필은 포함하지 않습니다.

화면에는 측정한 값만 보여 줍니다. 토큰 사용량은 제공자가 알려 준 숫자만 쓰고, 보내기 전에 짐작해서 보여 주지 않습니다. 테스트에서는 키를 비우고 API 응답을 모의 처리합니다.

## 함께하기를 같이 만들 분

함께하기는 토큰을 한곳에 모아 나눠 주는 대신, 문제를 공유하고 돕는 사람이 스스로 푼 결과를 돌려받는 구조입니다. 지금 앱에는 다른 사용자의 앱이 작업 하나를 자기 키로 처리하는 첫 조각만 있습니다. 사람이 리더가 나눈 역할을 맡아 답을 다듬고 넘기는 부분은 아직 없습니다.

- 중계 서버: `relay/`, 앱 쪽: `electron/pumasi.cjs`, 화면: `src/pumasi.tsx`
- 시작 전에 이슈로 어떤 부분을 맡을지 알려 주세요. 역할 나누기, 결과 신고·차단, 공개 가입이 먼저 필요한 부분입니다.

Pitch in shares the problem instead of pooling tokens: a helper solves it on their own and sends back the result. Only the first piece exists today. If you want to help build the rest, open an issue and say which part you'd like to take.

## 라이선스

기여 코드는 프로젝트와 동일한 [MIT 라이선스](LICENSE)를 따릅니다.
