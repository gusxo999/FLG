# 채널 장부 충실도 — 공통 컨텍스트

> 상태: **승인 대기** (조사 완료 · 코드 변경 0)

**예약은 실제 점유의 상계여야 하는데, 폭을 정하는 네 자리 중 셋이 하계를 쓴다.**
원인은 상수도 조건문도 아니고 **모델 낟알**이다 — `assignTracksLeftEdge` 는 경로를
*한 축의 구간*으로 보고, 실제 납품은 *팔 달린 계단꼴*(2차원 셀 집합)이다.
전체는 [채널-장부-충실도.md](채널-장부-충실도.md), 미결 판단은 [judgements.md](judgements.md).

```
Step 1  모델의 지위를 이름과 타입에 못 박는다 (하계 ≠ 폭)        ← 확정 · 계산 불변
Step 2  도형을 모르는 자리는 공유를 금지한다 (하계 → 상계)        ← 확정 · 폭이 넓어진다
Step 3  행 채널을 장부로 승격                                     ← 방향 (순환을 먼저 끊어야)
```

**경로 수를 먼저 줄여야 한다 — 그리고 이미 줄었다.** Step 2 는 폭을 넓히는 변경이고, 그 대가는
채널을 지나는 **경로 수에 비례**한다. 원래 선행으로 적은 `링크-약속량` 은 폐기됐지만(2026-08-22),
링크 접기는 [[배선-형태]] Step 3·4 가 해냈다 — glass 벨트 54줄 → 5줄. **선행은 충족됐다**(2026-09-12 확인).

## 착수 전 반드시 읽을 것

| 무엇 | 왜 |
|---|---|
| [docs/auto-layout/channel/channel-geometry-reservation.md](../../docs/auto-layout/channel/channel-geometry-reservation.md) §3·§6 | **이 계획이 지키려는 문장.** *"경로는 숫자 몇 개로 그려지는 도형"* · 폭 역전 |
| [docs/auto-layout/channel/s-layer-channel-reservation.md](../../docs/auto-layout/channel/s-layer-channel-reservation.md) §4·§5 | left-edge 를 폭 공식으로 삼은 **원래 논거**. 그때는 경로가 1차원이라고 봤다 |
| `planner/channelPlanner.ts` 전체 (79줄) | 세 함수의 지위가 이 계획의 대상 |
| `planner/channelGeometryPlanner.ts` `phantom`(669–689) + 그 위 주석 | **장부 안에서 모델이 갈리는 자리.** 1차원을 고른 사유가 주석에 있다 |
| `planner/modulePacking.ts` `channelWidth`(770–776) · `intervalsByDepth`(552·637·723) | 옛 분기와 **기본 경로에서 죽은 장부** |
| `planner/rowChannelPlanner.ts` 머리 주석 §*"왜 위치 반영이 여기 없나 — 순환"* | Step 3 의 관문. 같은 하계 모델을 쓰고 있다 |
| [tempPlanDocs/glass-채널-폭-분석.md](../glass-채널-폭-분석.md) §3-② | 3 vs 6 실측. 이 계획의 관측 출처 |
| [tempPlanDocs/채널-양보-명세/](../채널-양보-명세/) | **양보 규칙·관측의 주인.** 이 계획은 폭만 본다 |

## 하지 않는 것

- **배정 알고리즘을 안 건드린다.** 백트래킹·예산·id 정렬·양보 사다리 전부 그대로.
  ([[채널-양보-명세]] 의 범위다.)
- **`AUTO_LAYOUT_CHANNEL_GEOMETRY` 를 안 지운다.** 진단 레버이고, off 를 쓰는 테스트가 있다.
  off 경로의 **폭이 좁다는 사실**만 정직하게 만든다.
- **링크·다이렉트 폴백을 안 건드린다.** 경로 **수**를 줄이는 일은 [[배선-형태]] 소관이다.
- **행 채널을 이번에 승격하지 않는다.** 순환은 [[행채널-모델]] Step 3 가 끊는다.
- **면적 최적화를 목표로 삼지 않는다.** 이 계획은 폭을 **좁히는** 게 아니라 **정직하게** 만든다.
