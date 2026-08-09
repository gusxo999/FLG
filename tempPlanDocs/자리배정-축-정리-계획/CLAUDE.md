# 자리배정-축-정리 — 작업 컨텍스트

> **상태: 진행 중** — ㉮·㉯ 완료 · ㉰(도달 경로) **보류**

문서 작업이다. **코드 변경 0.** 애초 계획의 ㉰(주석 한 줄)는 보류했다 — 주석은 경로가
아니라 땜질이라는 판단이다(계획서 §5 ㉰에 조사 결과가 있다).

## 착수 전 반드시 읽을 것

| 무엇 | 왜 |
|---|---|
| [`docs/auto-layout/module/module-planning.md`](../../docs/auto-layout/module/module-planning.md) §5 | 산출물 ㉮가 들어갈 자리. **기존 문장은 고치지 않고 추가만** 한다 |
| [`planner/module/linkPlanner.ts`](../../src/autoLayout/planner/module/linkPlanner.ts) `commitLinkFace` | 축 1~4의 사실 확인 — 링크가 순번을 **확정 시점에** 낸다 |
| [`execution/module/emitModule.ts`](../../src/autoLayout/execution/module/emitModule.ts) `slotOnFace`·`remapRow` | 축 4·9의 사실 확인 — 탭이 같은 값을 **방출에서** 다시 센다 |
| [`module/clusterModule.ts`](../../src/autoLayout/module/clusterModule.ts) `buildTrunkContext` | 축 5·8. §4 견적 전체가 *"산출 다섯 중 `ext` 만 좌표를 쓴다"* 에 기대고 있다 |
| `docs/CLAUDE.md` Q2·Q3 | ㉮와 ㉯를 가르는 판정 |

## 하지 않는 것

- **비대칭 해소** — 축을 계획으로 옮기는 것은 이 계획서 밖이다. 견적만 낸다
- **기존 §5 문장 수정** — 추가만
- **옛 평면 계획서 이관** — 이 폴더 구조는 새 계획부터다
- **코드 변경 전부** — 주석 한 줄도 넣지 않는다(㉰ 보류)
- **`RejectReason` 세분** — 도달 경로의 진짜 해법일 수 있지만 별도 판단이다

## 이 작업의 함정

**견적표를 `docs/` 에 넣고 싶어진다.** 한 문서에 두면 읽기는 편한데, 견적은 실물
트리·우선순위와 함께 썩고 `docs/` 에는 그 부패를 잡을 장치가 없다. ㉮와 ㉯가 갈리는
지점이 정확히 여기다.

**주석으로 도달 경로를 만들고 싶어진다.** 주석은 그 줄을 읽는 사람에게만 보이고,
코드를 옮기면 끊기고, 문서를 지우면 거짓말이 된다. **경로는 관측 가능한 신호에서
자라야 한다** — 이 프로젝트에서는 실패 사유(`RejectReason`)가 그 신호다.
