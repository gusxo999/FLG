---
tags: [auto-layout, fluid, routing, placement, planning]
aliases: [유체홉예약, fluid-hop-reservation]
---

# 유체 홉을 채널 기하 예약 안으로 — 설계 계획서

> **부모 문서:** [[channel-geometry-reservation]] — 통합 장부(같은 쪽 판정)의 원 설계
> **관련:** [[fluid-hop]] · [[trunk-pipe]] · [[pipe-semantics]]

> **상태(2026-07-25): 구현 완료.** 리팩토링 Phase 4-B(P4-4 · P4-5).
> 검증 = `planner/fluidHopReservation.test.ts`(11개) + 전체 521 테스트.
> 구현 중 설계가 두 군데 바뀌었다 — §8 참조.

## 0. 한 줄 요약

원칙은 **"모든 배치는 처음에 계획할 수 있어야 한다"** 이다. 지금 유체 홉만 이 원칙 밖에 있다 —
장부가 유체 홉의 트랙을 **이미 잡아 두는데도** 라우터가 그 계획을 버리고 탐색으로 길을 낸다.

고치는 방법 셋:
1. 계획을 **살려 쓴다** — `buildPlannedChain` 은 이미 품목-무관하다. 방출 꼬리 하나만 새로 만든다(§3).
2. 장부가 **파이프의 인접 규칙**을 배운다 — 다른 유체는 닿기만 해도 한 통이 된다(§2).
3. 유체가 **지상을 먼저 가진다** — 교차는 아이템이 밑으로 지나가 푼다(§4.3).

그리고 유체에서 탐색 폴백을 **없앤다**. 계획을 못 받으면 탐색이 아니라 거절이다(§4.6).

---

## 1. 지금 실제로 일어나는 일 (코드 실측)

문제는 "유체가 계획에서 빠져 있다" 가 아니다. 그보다 나쁘다.

### 1.1 유체 홉은 이미 장부에 들어가 있다

홉 입력 목록을 만드는 자리에 **품목 종류를 거르는 코드가 없다**:

- `productOf(s)` = 출력 라인 이름 ([modulePacking.ts:338](../../../frontend/src/autoLayout/planner/modulePacking.ts#L338)).
  라인의 `kind`(belt/pipe)를 안 본다 → 유체 출력 노드도 그대로 통과.
- `pairHopPorts` 는 이름이 같은 출력·입력 포트를 짝짓는다
  ([modulePacking.ts:205](../../../frontend/src/autoLayout/planner/modulePacking.ts#L205)).
  유체 포트는 `linkId` 가 없어 ②번 위치-zip 으로 짝이 된다(v1 모듈당 유체 1포트 → 자명).
- 그 짝이 그대로 홉 입력에 쌓인다
  ([modulePacking.ts:521](../../../frontend/src/autoLayout/planner/modulePacking.ts#L521)).
  `eligible` 판정은 **변(side)만** 본다 — 자식 출력이 W변, 부모 입력이 E변, 깊이 인접.
  유체 포트도 `meta.side` 를 똑같이 갖는다
  ([clusterModule.ts:1749](../../../frontend/src/autoLayout/module/clusterModule.ts#L1749)).
- 적격이면 `DeliveryInput` 으로 장부에 들어가고, 아니면 폭만 예약
  ([modulePacking.ts:558-561](../../../frontend/src/autoLayout/planner/modulePacking.ts#L558-L561)).

**즉 유체 상자가 W/E 변에 오면 그 홉은 계단꼴 계획을 받고 트랙을 하나 차지한다.**

그리고 **유체는 항상 W/E 변에 온다** — 선택이 아니라 강제다
([moduleWizard.ts:149](../../../frontend/src/autoLayout/planner/moduleWizard.ts#L149)):

```ts
// 출력 유체는 부모 쪽(W), 입력 유체는 자식 쪽(E)
const wantFace = isOutput ? "W" : "E";
const chosen = chooseMachineDirection(entity, ..., wantFace, role);
if (!chosen) return reject({ kind: 'no-rotation', ... });  // ← 트리 자체가 안 만들어진다
```

이 조건은 `eligible` 판정(`out.meta.side === "W" && inp.meta.side === "E"`)과 **정확히 같다**.
따라서 **모든 유체 홉은 예외 없이 장부에 들어간다.** 아이템에는 있는 N/S 스필 홉이 유체엔 없다.

> 이게 중요한 이유: "유체가 계획을 못 받는 경우"는 **장부가 배정에 실패한 경우 하나뿐**이다.
> 입구가 막힌 게 아니라 자리가 없어서 못 앉는 것이라면, 자리를 먼저 주면 된다(§4.3).

### 1.2 그런데 라우터가 그 계획을 버린다

`routeModuleHops` 의 루프 첫 줄이 유체를 먼저 걷어낸다
([moduleHop.ts:253](../../../frontend/src/autoLayout/planner/moduleHop.ts#L253)):

```ts
if (hop.from.chest.kind === "infinity-pipe") {
  const route = routeOneFluidHop(...);   // ← plannedChains 조회 없음. dijkstra 직행
  ...
  continue;                              // ← 아래 계획 경로 분기에 도달하지 않는다
}
```

계획 체인(`plannedChains`)은 이 홉 것도 만들어져 있지만 조회되지 않는다.

### 1.3 그 dijkstra 는 남의 예약도 안 본다

`routeOneFluidHop` 의 금지 집합은 `base + hopBelts + fluidBlocked` 뿐이다
([moduleHop.ts:411-415](../../../frontend/src/autoLayout/planner/moduleHop.ts#L411-L415)).
아이템 쪽이 쓰는 `reservedExport`(반출 레인)·`reservedHop`(다른 홉의 계획 칸)이 빠져 있다.

### 1.4 결론 — 손해가 두 번 난다

| | 지금 |
|---|---|
| 장부 | 유체 홉 몫으로 트랙을 **잡는다** |
| 라우터 | 그 트랙을 **안 쓴다**(탐색으로 딴 길) |
| 그 탐색 | 아이템의 예약 칸을 **밟을 수 있다** |
| 밟힌 아이템 홉 | `plannedChainClear` 실패 → dijkstra 폴백 → **연쇄**([moduleHop.ts:286](../../../frontend/src/autoLayout/planner/moduleHop.ts#L286) 주석의 그 연쇄) |

채널은 유체 몫만큼 넓어졌는데 그 자리는 비어 있고, 유체는 아이템 자리를 밟는다.
**"계획할 수 없어서" 가 아니라 "계획해 놓고 안 써서" 생긴 손해다.**

---

## 2. 유체가 아이템과 다른 점 — 장부가 새로 알아야 할 것 하나

장부의 충돌 판정은 **겹침(overlap)** 하나뿐이다
([channelGeometryPlanner.ts:180](../../../frontend/src/autoLayout/planner/channelGeometryPlanner.ts#L180)):
두 도형이 같은 칸을 쓰면 충돌.

벨트는 이걸로 충분하다. **파이프는 아니다** — 파이프는 **닿기만 하면 이어진다**(방향 없음,
자연 병합, [[pipe-semantics]]). 그래서:

| 두 경로 | 충돌 조건 |
|---|---|
| 아이템 ↔ 아이템 | 겹침 (지금 그대로) |
| 아이템 ↔ 유체 | 겹침 (파이프 옆에 벨트는 괜찮다) |
| 유체 A ↔ 유체 A (같은 유체) | 겹침 (닿아도 합법 — 지금 `fluidBlocked` 도 같은 유체는 안 막는다) |
| **유체 A ↔ 유체 B (다른 유체)** | **겹침 + 인접** ← 장부가 지금 모르는 규칙 |

다른 유체가 나란히 지나가면 두 유체가 한 통이 된다 = 공장이 조용히 망가진다.
지금은 이걸 `pipeFlow` 의 `blockedTilesHard` 가 **탐색 시점에** 막고 있다
([moduleWizard.ts:417](../../../frontend/src/autoLayout/planner/moduleWizard.ts#L417)).
계획 시점으로 올리려면 장부가 같은 규칙을 알아야 한다.

**이 한 줄이 이번 작업의 알고리즘 변경 전부다.** 나머지는 배선이다.

---

## 3. 살릴 수 있는 것 — 다시 만들지 않는다

조사에서 가장 반가운 사실:

**`buildPlannedChain` 은 이미 품목-무관하다**
([moduleHop.ts:514](../../../frontend/src/autoLayout/planner/moduleHop.ts#L514)).
상자 좌표 두 개와 기하 지시(straight/staircase/columnSwitch/undergroundCrossing)를 받아
칸 순서열로 펴는 순수 함수다. 벨트라서 되는 게 하나도 없다.

품목에 묶인 곳은 **꼬리(방출) 하나뿐**이다:

| 함수 | 하는 일 | 유체에 그대로 되나 |
|---|---|---|
| `buildPlannedChain` | 기하 → 칸 순서열 | **그대로 됨** |
| `plannedChainClear` | 계획 칸이 비었나 | 그대로 됨(+ 인접 검사 추가) |
| `finishChain` | 좌석 이음 + `emitItemPath` | ✗ 벨트 전용 |
| `routeOneFluidHop` | dijkstra + `emitFluidPath` | 폴백으로 유지 |

그래서 새로 만들 것은 **`finishFluidChain`(계획 체인 → 파이프 방출)** 하나다.
좌석 이음이 없어 `finishChain` 보다 짧다 — 파이프 포트는 인서터가 없고, 좌석 자리의 파이프는
떼지 않고 그대로 이음에 쓴다([moduleHop.ts:263](../../../frontend/src/autoLayout/planner/moduleHop.ts#L263)).

---

## 4. 설계

### 4.1 장부 입력에 품목 종류를 싣는다

```ts
export interface DeliveryInput {
  id: string;
  startY: number;
  endY: number;
  /** 유체 이름. undefined = 아이템. 같은 유체끼리는 인접 허용, 다른 유체는 금지. */
  fluid?: string;
}
```

`hopSeeds` 에도 같은 필드를 실어 보낸다(포트의 `line.kind === "pipe"` 로 판정).

### 4.2 충돌 판정을 품목-인식으로

`shapesConflict(a, b)` 를 `conflicts(a, b, kindA, kindB)` 로 승격한다.
다른 유체 쌍일 때만 **halo 검사**(한쪽 도형의 칸 + 4-이웃 vs 다른 쪽 칸)를 더한다.

성능: 이 판정은 백트래킹 안에서 수십만 번 불린다(`SEARCH_BUDGET` 200k).
그래서 halo 는 **유체 도형에만, 후보(id, track)별로 한 번만** 만들어 캐시한다.
v1 은 모듈당 유체 1줄이라 유체 경로 수가 적다 — 비용이 실질적으로 안 는다.

### 4.3 배정 우선순위를 "실패 비용" 순으로 — 유체가 지상을 먼저 가진다

장부는 이미 **제약이 센 것부터** 앉힌다: 반출이 먼저(지상 전용), 납품이 나중(막히면 지하로).
여기에 유체를 넣을 자리는 **맨 앞**이다. 근거는 제약이 아니라 **실패했을 때 잃는 것**이다:

| 순위 | 경로 | 배정 실패하면 |
|---|---|---|
| 1 | **유체 납품** | 지하로 못 도망감 → **트리 전체가 실패** |
| 2 | 반출 | 상자가 로컬 ring 에 남음 — 되돌릴 수 있는 손해 |
| 3 | 아이템 납품 | ③ 지하 횡단이 회수 — 사실상 손해 없음 |

그래서 `items` 배열 순서를 **유체 납품 → 반출 → 아이템 납품**으로 바꾼다
([channelGeometryPlanner.ts:429-442](../../../frontend/src/autoLayout/planner/channelGeometryPlanner.ts#L429-L442)).

이 한 줄이 §4.4 를 성립시킨다. 유체와 아이템이 교차할 때(끝점이 엇갈리면 교차는 **기하학적으로
불가피**하다 — `DeliveryPlan.undergroundCrossing` 주석의 Jordan 논증), 지상을 유체가 가지고
**아이템이 밑으로 지나간다**. 아이템의 지하 횡단은 이미 구현돼 있다(`placeWithJumps`, 사다리 ②).
즉 새 코드 없이 순서만으로 교차가 풀린다.

### 4.4 지하 횡단은 아이템만 (결정 D2)

`placeWithJumps` 를 유체에 쓰려면 **pipe-to-ground 페어링 절단**을 장부가 모델링해야 한다 —
지하파이프는 프로토타입과 무관하게 같은 직선 위에서 서로 짝을 끊는다([[pipe-semantics]]).
겹침·인접과 성질이 다른 세 번째 제약이라 이번 범위 밖으로 둔다.

§4.3 의 우선순위가 이 제외를 감당해 준다 — 유체는 지하로 도망갈 필요가 없다.
**남는 미계획 케이스는 하나뿐이다: 한 채널 안에서 서로 다른 유체 두 줄의 끝점이 엇갈릴 때.**
둘 다 지상을 원하는데 둘 다 못 비킨다. 이 경우의 처리는 §4.6.

### 4.5 라우터 — 유체도 계획 체인을 탄다

```
for (const hop of pack.hops) {
  const chain = plannedChains.get(k);
  if (chain && plannedChainClear(...)) {
    route = isFluid(hop) ? finishFluidChain(hop, chain, config)   // ← 신규
                         : finishChain(hop, chain, config);
    planned += 1;
  } else if (isFluid(hop)) {
    return reject({ kind: 'fluid-unplannable', ... });            // ← §4.6
  } else {
    dijkstraFallback += 1;
    route = routeOneHop(...);
  }
}
```

유체 분기의 조기 반환이 사라진다.

### 4.6 유체에 dijkstra 폴백은 없다 (결정 D3)

원칙이 **"모든 배치는 처음에 계획할 수 있어야 한다"** 이므로, 계획 없이 탐색으로 길을 내는
경로를 유체에 남겨 두지 않는다. 계획을 못 받은 유체 홉은 **탐색으로 때우지 않고 거절한다** —
새 사유 `RejectReason.kind = 'fluid-unplannable'`.

**따라서 `routeOneFluidHop` 은 삭제된다.**
(`emitFluidPath` 는 `finishFluidChain` 이 계속 쓴다 — 방출은 그대로다.)

거절은 "계획 실패를 조용히 덮지 않는다"는 뜻이지 품질 포기가 아니다. §4.3 이 유체에 지상
우선권을 주므로 실제로 거절에 도달하는 경우는 §4.4 의 잔여 케이스 하나로 좁혀진다.

**이 선택은 회귀를 만든다:** 지금 dijkstra 가 어떻게든 이어 주던 유체 배치 일부가 실패로
바뀐다. 그 대가로 "성공했다는데 어디로 지나가는지 아무도 모르는" 배치가 사라진다.
P4-4a 계측이 그 빈도를 먼저 재고, 예상보다 크면 §6 의 잔여 결정으로 되돌아온다.

---

## 5. 작업 단계

| 단계 | 내용 | 완료 판정 |
|---|---|---|
| **P4-4a** | 계측 — 유체 홉이 계획을 받는지/버려지는지, 거절로 갈 빈도는 얼마인지 | 유체 홉의 `계획 있음/버림` 카운트 로그. §1·§2.5 확증 또는 반증 |
| **P4-4b** | `DeliveryInput.fluid` + 홉 입력에 종류 싣기 | tsc 통과. 장부 입력에 유체 표시가 도달(단위 테스트 1개) |
| **P4-4c** | 충돌 판정 품목-인식(halo) | 다른 유체 두 경로가 인접 배정되지 않는 단위 테스트. 기존 채널 테스트 전부 유지 |
| **P4-4d** | 배정 우선순위 재정렬(유체 → 반출 → 아이템) | 유체·아이템이 교차하는 트리에서 유체가 지상, 아이템이 지하로 가는 단위 테스트 |
| **P4-5a** | `finishFluidChain` — 계획 체인을 파이프로 방출 | 계획받은 유체 홉이 `emitFluidPath` 로 깔림. 셀이 pipe |
| **P4-5b** | 라우터 분기 통합 + `routeOneFluidHop` 삭제 + `fluid-unplannable` 사유 추가 | 유체가 `planned` 로 집계됨. 유체 dijkstra 호출 0 |
| **P4-5c** | 회귀 확인 | `wood ← water`(유체 홉) 실패 0 유지. 510 테스트 유지 |

**커밋 경계:** P4-4a 는 단독(계측만). P4-4b+c+d 는 장부 변경 한 덩어리. P4-5a+b 는 라우터
변경 한 덩어리. 섞으면 회귀가 났을 때 어느 쪽인지 못 가른다.

### 명칭 정리 (마지막, 선택)

`hopSeeds` 의 "Seed" 는 부적절하다 — 난수 생성을 연상시키는데 실제로는 **미리 정한 경로 입력**이다.
`hopPlanInputs` 또는 `deliveryInputs`(장부 용어와 일치)로 바꾼다.
기능 변경이 끝난 뒤 별도 커밋으로 — 섞으면 diff 가 읽히지 않는다.

---

## 6. 결정 기록 (2026-07-25 확정)

| # | 항목 | 결정 |
|---|---|---|
| **D1** | 인접 금지 구현 | **halo 확장** — 유체 도형의 칸 + 4-이웃을 후보별 1회 캐시. 유체 전용 트랙 대역은 채널을 무조건 넓혀 v1 에 과하다 |
| **D2** | 유체 지하 횡단 계획 | **v1 제외** — pipe-to-ground 페어링은 성질이 다른 세 번째 제약. §4.3 우선순위가 이 제외를 감당한다 |
| **D3** | 유체 dijkstra 폴백 | **없앤다** — 유체는 계획을 못 받을 수 없어야 한다. 못 받으면 탐색이 아니라 **거절**. `routeOneFluidHop` 삭제 |

D3 이 D2 를 다시 열었고, 그 답이 §4.3(우선순위 재정렬)이다. 유체가 지하로 못 가는 대신
지상을 먼저 갖고, 아이템이 밑으로 지나간다.

### 잔여 결정 — P4-4a 계측 후에 판단

**한 채널 안에서 서로 다른 유체 두 줄의 끝점이 엇갈리는 경우** 둘 다 지상을 원하는데 둘 다
못 비킨다. 지금 계획은 이걸 거절로 보낸다. 계측에서 이 케이스가 실제로 흔하면 두 갈래가 있다:

- **(가) 지하파이프 횡단 도입** — D2 를 뒤집어 pipe-to-ground 페어링까지 장부에 모델링.
  → **설계 완료: [[fluid-underground-crossing]]**. 조사해 보니 페어링
  규칙(`isJumpAllowed`)이 라우터에 이미 있고 장부의 행이 이미 절대 좌표라, 예상보다 작다.
- **(나) 채널 밖 우회** — 유체 한 줄을 채널이 아니라 모듈 위/아래(N/S 마진)로 돌린다. 장부에 네 번째 경로 종류가 생긴다.

> **정정(2026-07-25):** D2 를 권고할 때 "폴백 품질은 지금과 동일"이라고 적었는데 **틀렸다**.
> 옛 `routeOneFluidHop` 의 dijkstra 는 `fluidBlocked` 를 피해 넓게 점프하면 이 교차를 풀 수
> 있었다. 따라서 지금의 거절은 옛 경로 대비 **실제 회귀**다 — (가)를 넣어 되찾아야 한다.

---

## 7. 스코프 밖

- **다-유체** — 회전이 얽히는 별개 문제. 지금도 fallback.
- **반출 경로(export)의 유체** — 외부 유체 상자를 외곽으로 빼는 `rePathToPerimeter`/`layPipePath`
  경로. 같은 인접 규칙이 걸리지만 장부의 반출 쪽 확장은 이번 범위 밖.
- **유체 링크 할당** — `allocateMachineLinks` 는 유체에 여전히 불필요
  (인서터·팔·그릇 개념 없음). **할당은 건너뛰고 예약에만 참여**한다는 구분이 이 문서의 전제다.

---

## 8. 구현 중 바뀐 것 (2026-07-25)

계획서를 그대로 따르지 않은 두 곳. 둘 다 구현하며 드러난 사실 때문이다.

### 8.1 `routeOneFluidHop` 을 지우지 않았다 — 장부-off 모드가 남는다

§4.6 은 삭제를 적었다. 그런데 `AUTO_LAYOUT_CHANNEL_GEOMETRY` 를 끄면 **아이템도 전부** 탐색으로
간다 — 그건 "계획 없음" 모드다. 그 모드에서 유체만 유별나게 실패시킬 이유가 없다.

그래서 유체 탐색은 **장부가 꺼졌을 때만** 도는 경로로 남겼다. 장부가 켜진 실제 운용에서는
절대 안 탄다(계획을 못 받으면 거절). 플래그를 없애는 Phase 5 에서 함께 지운다.

### 8.2 라우팅 **순서**도 실패 비용 순이어야 했다 (계획서에 없던 것)

§4.3 은 *배정* 순서만 다뤘다. 그런데 방출 루프에도 같은 문제가 있었다:

아이템 홉이 막히면 "예약 무시 재시도"로 **남의 계획 칸을 밟는다**
([moduleHop.ts](../../../frontend/src/autoLayout/planner/moduleHop.ts) 의 그 거래). 밟힌 게
유체의 자리였으면 유체는 물러설 데가 없어 트리가 통째로 죽는다.

→ `routeModuleHops` 가 **유체 홉을 먼저 깐다**. 유체가 실제로 칸을 차지한 뒤(`hopBelts`)라야
그 재시도가 밟을 수 없다. 순서 한 줄로 최악을 막는다.

### 8.3 계획 경로에 합류 가드를 다시 붙였다

장부는 **자기가 배정한 경로들 사이**의 인접만 안다. 모듈 *안*에 이미 깔린 남의 유체 트렁크는
장부 밖의 사실이다. 옛 탐색 경로는 `fluidBlocked`(pipeFlow 의 유체별 hard 지도)를 blocked 로
받아 피했는데, 계획 경로로 갈아타며 그 검사가 빠질 뻔했다.

→ `plannedChainClear` 가 `fluidBlocked` 를 함께 본다. 걸리면 조용히 깔지 않고 거절한다.
