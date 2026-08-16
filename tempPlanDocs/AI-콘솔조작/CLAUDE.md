# AI-콘솔조작 — 상태와 고유 컨텍스트

> 상태: **승인 대기**

화면의 버튼·조작을 콘솔 명령으로 노출해, AI 가 스크린샷 대신 **명령을 치고 로그를 읽어**
앱을 몰 수 있게 한다. 계획서는 [AI-콘솔조작.md](AI-콘솔조작.md).

## 착수 전 반드시 읽을 것

| 무엇 | 왜 |
|---|---|
| [src/debug/debugApi.ts](../../src/debug/debugApi.ts) | **이미 있는 것.** `window.flg` 14개 명령 + `registerAutoLayoutDebug` 등록 패턴. 새로 만드는 게 아니라 이걸 키운다 |
| [src/UI/pixi/pixi-manager.ts](../../src/UI/pixi/pixi-manager.ts) `handlePointerDown` | 캔버스 클릭은 스토어 액션 하나가 아니라 **분기 6개**다. 이걸 안 보면 `placeEntity` 를 클릭이라고 착각한다 |
| [src/UI/components/AutoLayoutModal.tsx](../../src/UI/components/AutoLayoutModal.tsx) `nextStep`·`shouldSkip` | "다음" 은 `setStep` 이 아니다. 스킵 로직이 붙어 있다 |
| [docs/변수명사전.md](../../docs/변수명사전.md) §"왜 이것만 담나" | 문서화 방침이 여기서 **유도된다**. 런타임이 답할 수 있는 것은 문서에 안 담는다 |
| [docs/CLAUDE.md](../../docs/CLAUDE.md) §"다시 제안하지 말 것" | 검사 스크립트 철회 선례. 동기화를 스크립트로 잡자는 제안은 이 계획에 없다 |

## 하지 않는 것

- **E2E 자동화 대체가 아니다.** Playwright/브라우저 드라이버를 붙이지 않는다 —
  사람이 콘솔에 붙여 넣는 왕복이 전제다.
- **버튼↔명령 동기화 검사 스크립트를 만들지 않는다.** 구조(같은 함수를 가리키게)로 집행한다.
- **프로덕션 빌드 게이팅을 건드리지 않는다.** 지금처럼 항상 설치된다.
- **`src/autoLayout/manualEdit/` 는 제외.** 호출자 0 · 타입검사 제외 구역이라 누를 버튼이 없다.
- **자동 배치 알고리즘을 건드리지 않는다.** 이 계획은 조작 표면만 다룬다.

## 실제로 밟은 함정

(착수 후 채운다. 계획서를 지울 때 여기 남은 것만 `docs/` 로 옮긴다.)
