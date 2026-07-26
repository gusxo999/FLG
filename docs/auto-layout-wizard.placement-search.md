---
tags: [auto-layout, placement, routing]
---

# 배치 탐색 알고리즘 — 컨테이너 모델 + 전략 레이어

> ## ⚠️ 상태 정정 (2026-07-25)
>
> **이 문서가 "현재 전략"이라 부르는 `S-LAYER` 는 코드에서 삭제됐다** (리팩토링 Phase 3).
> tidy-tree 배치·left-edge 채널·BFS 1:1 라우팅은 더 이상 실행되지 않는다.
>
> 지금 실제로 도는 것은 **모듈 파이프라인**이다:
> `layeredWizard.runLayeredWizard`(진입점 — 트리 전개·머신 선정만) →
> `planner/moduleWizard.tryRunModulePipeline`(배치 전부).
> 흐름은 [[code-folders]], 링크 모델은 [[auto-layout-wizard.machine-link]],
> 채널 예약은 [[auto-layout-wizard.channel-geometry-reservation]] 를 보라.


> **부모 문서:** [auto-layout-wizard.md](auto-layout-wizard.md) — 위저드 인터페이스
> **관련 문서:** [.s-layer-channel-reservation](auto-layout-wizard.s-layer-channel-reservation.md), [.entity-roles](entity-roles.md), [.known-limits](auto-layout-wizard.known-limits.md)
>
> **상태:** 본 문서는 두 부분으로 나뉜다.
> - **Part I — 컨테이너 모델 (§2–§6):** 어떤 배치 전략에서도 변하지 않는 *불변 기반*. 코드와 일치한다.
> - **Part II — 전략 레이어:** *교체 가능한* 전략. 과거의 `S-EXH`(완전탐색)는 롤백되어 더 이상 코드에 없다. `S-DP`·`S-MEMO` 는 미구현 설계 후보다.

---

## 1. 한 줄 요약

[[용어사전#머신 (machine)|머신]]과 [[용어사전#무한상자 (infinity chest)|무한상자]]·[[용어사전#무한파이프 (infinity pipe)|무한파이프]]를 단일 추상 *[[용어사전#컨테이너|컨테이너]]* 로 묶고, 컨테이너끼리의 입출력을 *[[용어사전#벨트 (belt)|벨트]](가변길이) + [[용어사전#투입기 (inserter)|투입기]] 페어* (item) 또는 *[[용어사전#파이프 (pipe)|파이프]] + [[용어사전#지하파이프 (pipe-to-ground)|지하파이프]]* (fluid) 로 [[용어사전#라우팅 (routing)|라우팅]]한다.

이 컨테이너 모델(§2–4)과 [[용어사전#정합성 조건 (C1–C3)|정합성 조건]](§6 C1–C3)은 **어떤 배치 전략에서도 변하지 않는 불변 기반**이다. 반면 *머신 좌표를 어떻게 정하고, 무엇을 열거하며, 무엇을 반환하는지* 는 교체 가능한 **[[용어사전#배치 전략 레이어|배치 전략 레이어]](§5.5)** 의 몫이다.

---

# Part I — 컨테이너 모델 (불변 기반)

## 2. 컨테이너

### 2.1 정의

세 종류의 게임 엔티티를 하나의 추상 *컨테이너* 로 묶는다.

| 컨테이너 종류 | 게임 엔티티 | 용도 |
|---|---|---|
| 머신 (machine) | assembling-machine, furnace, rocket-silo 등 | 레시피 처리 |
| 무한상자 (infinity chest) | `infinity-chest` (1×1) | 외부 item I/O |
| 무한파이프 (infinity pipe) | `infinity-pipe` (1×1) | 외부 fluid I/O |

각 컨테이너의 [[용어사전#footprint|footprint]] 는 [`Entity.tile_width × tile_height`](../frontend/src/store/gameDataStore.ts), fluid I/O 셀 좌표는 [`Entity.fluid_boxes[].connections[].positions`](../frontend/src/store/gameDataStore.ts) 에서 결정된다. 무한상자는 fluid_boxes 가 없으므로 item port 만 노출.

구현: [containerModel.ts](../frontend/src/utils/autoLayout/containerModel.ts) `Container`.

### 2.2 ports

각 컨테이너는 외부와 통하는 셀 집합 = **[[용어사전#포트 (port)|port]] 집합** 을 노출한다.

| port 종류 | 좌표 출처 | 머신 | 무한상자 | 무한파이프 |
|---|---|---|---|---|
| item port | footprint 둘레 셀 (`2(w + h)` 개) | ✓ | ✓ | — |
| fluid port (특정 fluid) | `fluid_boxes[].connections[].positions` (회전 0 기준 고정) | ✓ (해당 머신만) | — | ✓ |

`port.kind ∈ {item, fluid:<fluid-name>}`. 라우팅은 같은 kind 의 두 port 사이만 짝지을 수 있다. 구현: [portInference.ts](../frontend/src/utils/autoLayout/portInference.ts) `enumerateContainerPorts`.

> 회전은 미고려 ([§13.1](#131-비-목표-항목)). prototype 의 기본 회전(0=N)에서의 positions 만 사용한다.

---

## 3. 영역 — 내부 영역 + perimeter ring (외부)

좌표계는 **단일** 이며, 두 영역은 그 좌표계 안에서 *역할 분류* 로 구분된다.

| 영역 | 한국어 | 구성 | 좌표 기준점 |
|---|---|---|---|
| internal area | 내부 영역 | 머신 + 내부 라우팅 (벨트·파이프·투입기) | 머신 footprint 의 bbox |
| external area | 외부 영역 | 무한상자·무한파이프 | **internal 영역의 머신+라우팅 bbox 의 perimeter ring** 위 |

**핵심 규칙** — 외부 컨테이너는 *internal [[용어사전#bbox|bbox]] 의 [[용어사전#perimeter ring|perimeter ring]]* 위에 산다. 별도 좌표계는 없다.

**알고리즘 순서:**
1. 외부 컨테이너는 일단 두 영역의 `containers` 에만 *지연 등록* 한다 (`origin` 미정, [externalPlacer.ts](../frontend/src/utils/autoLayout/externalPlacer.ts) `placeExternalContainer`).
2. 모든 머신 + 내부 라우팅이 끝난 **후처리 단계** ([areaUnification.ts](../frontend/src/utils/autoLayout/areaUnification.ts) `wrapExternalsAroundPerimeter`) 에서 consumer/producer 머신과 가장 가까운 빈 perimeter 셀로 배치하고 라우팅한다. 실패하면 graceful degradation.
3. 사용자 드래그는 **perimeter ring 셀로만 제한** *(드래그 동작 상세는 본 문서 범위 밖)*.

---

## 4. 라우팅 형식

라우팅 = 두 컨테이너의 (producer port, consumer port) 사이를 잇는 운반체 체인. 구현: [containerRouting.ts](../frontend/src/utils/autoLayout/containerRouting.ts) `routePorts`.

| kind | 체인 형식 | 메모 |
|---|---|---|
| item | `컨테이너 — 투입기 — 벨트(+지하벨트) — 투입기 — 컨테이너` | 두 컨테이너가 1셀 gap 으로 마주보면 벨트 없이 *인서터 1개* 로 직결(코너 케이스). 너무 가까워 못 끼우면 *다른 port 셀* 로 우회 ([§7.4](#74-fallback)). |
| fluid | `컨테이너 — 파이프(+지하파이프) — 컨테이너` | 투입기 없음. |

**원칙:** 라우팅 1개 = 컨테이너 1개. 한 라우팅이 처리량을 못 채우면 *컨테이너 수* 를 늘려 별도 라우팅으로 분할한다.

### 4.1 지하 변형 (underground-belt / pipe-to-ground)

라우팅 경로 탐색은 *[[용어사전#Dijkstra|Dijkstra]]* — 지상 인접 edge (cost 1) + 지하 점프 페어 edge (cost 2). 점프 edge 는 한 축 방향으로 `k ∈ [1, max_underground_distance]` 떨어진 셀을 입출구 페어로 emit. 사이 통과 셀 = `k − 1` 칸.

**차단 규칙 (Factorio 게임 동작 기준):**

| 종류 | 같은 직선 위 다른 페어 차단 조건 |
|---|---|
| `pipe-to-ground` | **무조건** — entity prototype 이 달라도 서로 차단. 단일 `blockGroup = "pipe-to-ground"`. |
| `underground-belt` | **같은 prototype 만** — 다른 티어는 독립. `blockGroup = entityName`. |

지하 운반체는 입출구가 *직선* 으로만 이어지므로 꺾임은 반드시 지상 셀에서 일어난다. Dijkstra 상태 `(x, y, arr)` (arr = 도착 방식·방향) 가 **출구 직진**(출구 셀은 같은 방향 직진만 + 재점프 금지)·**입구 직진**(점프는 도착 방향과 같은 방향으로만 시작; 시작 셀만 예외) 두 제약을 강제해, 직각 코너에 항상 연결용 지상 한 칸이 남게 한다. 구현: [containerRouting.ts](../frontend/src/utils/autoLayout/containerRouting.ts) `dijkstraWithJumps`.

> *지하 변형의 게임 메커니즘 자체*(왜 직선만, 왜 차단되는가)는 본 문서 범위 밖이다.

---

## 5. 모듈 구성

| 모듈 | 책임 | 구현 |
|---|---|---|
| **port 유추** | 두 컨테이너의 상대 위치 → 가장 가까운 면의 port 페어 그리디 결정 | [portInference.ts](../frontend/src/utils/autoLayout/portInference.ts) `resolvePortPair` |
| **머신 수 산정** | 레시피 throughput → 노드별 머신 대수 | [recipeTree.ts](../frontend/src/utils/autoLayout/recipeTree.ts) `assignMinimumCounts` / `assignThroughputCounts` *(상세는 범위 밖)* |
| **머신 배치** | 결정된 좌표로 footprint 를 internal 에 commit | [machinePlacer.ts](../frontend/src/utils/autoLayout/machinePlacer.ts) `commitContainer` |
| **외부 컨테이너** | 무한상자/파이프 지연 등록 + perimeter 배치 | [externalPlacer.ts](../frontend/src/utils/autoLayout/externalPlacer.ts), [areaUnification.ts](../frontend/src/utils/autoLayout/areaUnification.ts) |
| **라우팅** | port 페어 → 운반체 체인 (item/fluid, Dijkstra, 지하) | [containerRouting.ts](../frontend/src/utils/autoLayout/containerRouting.ts) `routePorts` + [routeFallback.ts](../frontend/src/utils/autoLayout/routeFallback.ts) `routeWithFallback` |
| **트렁크 병합** | N:1 공유 belt + 머신별 탭 | `trunkPath.ts`, `trunkEmit.ts` |
| **채널 계획** | 모듈 사이 라우팅 채널 폭/트랙 산정 | `channelPlanner.ts` |
| **오케스트레이터** | 위 모듈을 엮어 후보 생성 | `moduleWizard.ts` `tryRunModulePipeline` |

---

## 5.5 배치 전략 레이어 (pluggable)

§2–4 의 컨테이너 모델·라우팅 형식과 §6 의 정합성 조건(C1–C3)은 **전략과 무관한 불변 기반**이다. 그 위에서 *머신 좌표를 어떻게 정하고 무엇을 반환하는지* 는 **교체 가능한 전략**이다.

**모든 전략의 공통 계약:**
- 출력은 C1(무충돌)·C2(라우팅 가능)·C3(액체 mixing 방지)를 만족한다.
- 결정성·종료(§10)를 만족한다.

### 전략 등록부

| ID | 빌드 방향 | 열거 | 반환 | 상태 |
|---|---|---|---|---|
| S-LAYER | 계층화(레이어=열) | 없음 (tidy-tree 결정적 단일 패스) | 후보 1개 | ❌ 폐기 (Phase 3 삭제, 코드 없음) |
| S-EXH | 하향식 | 형제 순서 `n!` × 방향 2 완전 열거 | 모든 성공 후보 | ❌ 폐기 (롤백, 코드 없음) |
| S-MEMO | 하향식 | S-EXH + 부분트리 메모이제이션 | 모든 성공 후보 | 미구현 설계 후보 |
| S-DP | 상향식 (post-order) | 부분트리 모듈의 shape-curve 합성 | Pareto-최적 소수 | 미구현 설계 후보 ([§7B](#7b-미구현-설계-후보-s-dp--상향식-모듈-합성)) |

---

## 6. 조건 등록부

> **분류:** **C** = 정합성 조건(모든 전략이 만족하는 불변) / **O** = 정렬 기준 / **M** = 모델 관련.

### C1 — 충돌 없는 배치
모든 컨테이너 footprint, 라우팅 점유 셀, 인서터 셀이 한 셀도 겹치지 않는다.

### C2 — 라우팅 가능
모든 (producer, consumer, content, kind) 페어에 §4 형식의 라우팅이 존재한다.

### C3 — 액체 mixing 방지
한 fluid-route 셀은 단 하나의 fluid 만 운반. 다른 fluid 라우팅끼리 점유 셀이 겹치면 안 된다.

### O1 — 내부 영역 bbox 가 정사각형에 가까울수록 우선
`|W − H|` 가 작을수록 나은 후보. **단, 현재 경로는 후보를 1개만 반환하므로 선택에 쓰이지 않고 메타데이터(`squarenessPenalty`)로만 기록된다.** 다수 후보를 반환하는 전략(S-EXH 등)에서 정렬 기준.

### O2 — 지하 변형 우선
지상으로 점유될 셀을 지하 변형 페어로 비울 수 있으면 우선. 라우팅 Dijkstra 의 cost(지상 1 / 점프 2)가 자연히 짧은 우회 시 지상, 막힌 길에서 지하를 선택([§4.1](#41-지하-변형-underground-belt--pipe-to-ground)).

### M1 — 컨테이너 추상화
§2 의 정의를 사용. 구 *둘레 슬롯 번호 모델* (`ceil(재료/2)`, 슬롯 번호 부여)은 **폐기**. 새 모델은 둘레 셀 자체가 port 후보.

### M2 — (구) S-EXH 정의 — **폐기**
> 이전 M2 는 기준 전략 S-EXH 의 "A↔B 사이클 + 하향식 + 완전 탐색" 정의였다. S-EXH 롤백으로 폐기. 전략 무관 불변은 "부모-자식은 §4 라우팅 형식으로 연결된다" 뿐이다.

---

# Part II — 전략 레이어

## 7B. (미구현 설계 후보) S-DP — 상향식 모듈 합성

> **상태: 미구현 · 설계 메모.** 코드에 없다. 본 절은 향후 "다수의 near-square 후보를 빠르게" 원할 때를 위한 설계 보존용이며, 채택 시 자체 흐름·구현이 필요하다.

**핵심 아이디어:** 부분트리(레시피 노드 + 자손)를 불투명 **모듈** 로 동결하고 leaf→root **post-order** 로 합성한다. 각 모듈은 단일 배치가 아니라 **비지배 형상 집합(shape curve)** `{(W, H, attachFace, connectorPort)}` 를 들고 다닌다 — 목적함수 `|W−H|` 가 분리 불가능하므로(자식 혼자 최적 ≠ 부모와 합성 시 최적) 부모가 자기에게 맞는 형상을 고를 수 있어야 하기 때문이다.

- **합성:** 부모 박스 + 자식 모듈을 right(수평 절단: `W=W₁+GAP+W₂, H=max`)/down(수직 절단)으로 결합 후 Pareto 필터.
- **attachFace 파라미터화:** 붙는 면을 모를 때를 대비해 `{left, top}` 각각 곡선을 만들고, connector(루트) 머신을 그 면 가장자리에 핀고정.
- **형제 순서:** `k!` 완전열거 대신 축 제한(전부 right 또는 전부 down) 1차안.
- **trade-off:** 완전성 포기(Pareto 소수만), 모듈 불투명성으로 packing 느슨, 외부 IO 는 최종 단계 분리. 최적성은 "모듈 추상화 ∧ 완전열거" 이중 전제 하에서만 O1 최적, 축 제한 시 근사.

> S-MEMO(메모이제이션만 떼어 S-EXH 완전성 유지) 도 같은 미구현 후보다. 둘 다 도입 전까지 본 등록부의 행으로만 존재한다.

---

## 8. 결정성 · 종료 · 완전성

| 속성 | 현재 경로 |
|---|---|
| 결정성 (동일 입력 → 동일 후보) | ✓ 난수 미사용. 정렬·seed 평가·Dijkstra tie-break 모두 결정적 |
| 종료 | ✓ 단일 패스, 자연 종료 (Esc 시 부분 결과) |
| 완전성 (모든 배치 탐색) | ✗ 후보 1개만 생성 (탐색 안 함) — 다수 후보가 필요하면 다른 전략 |
| 최적성 (near-square) | ✗ O1 미사용(후보 1개). squarenessPenalty 는 기록만 |

---

## 9. 흡수된 / 폐기된 항목

| 구 항목 | 처리 |
|---|---|
| 둘레 슬롯 번호 (1..2(w+h)) | **폐기** — 둘레 셀 자체가 port 후보 (M1) |
| `inputSlots = ceil(재료/2)` (lane=2 가정) | **폐기** — 컨테이너 1개 = 라우팅 1개 |
| S-EXH 완전탐색 (`containerWizard.ts`) | **폐기(롤백)** — S-LAYER 로 대체. 코드 없음 |
| `slotPlacer` / `springPlacer` | **폐기** — 존재하지 않음. 머신 배치는 `machinePlacer.commitContainer` |
| S-EXH 의 A↔B 사이클·perm×dir·FailureLeaf 백트래킹 | **폐기** — S-LAYER 는 채널 예약으로 백트래킹 불필요 |

---

## 10. 명시적 비-목표

### 10.1 비-목표 항목
- **머신 회전** — 0(N) 고정. fluid_box positions 도 회전 0 기준만.
- **공유 자식** — 한 product 가 여러 부모로 공급되는 케이스는 고려하지 않는다(트리 펼침이 품목을 중복 전개).
- **splitter 분기 / 측면 합류** — 컨테이너 분할 또는 트렁크 병합으로 우회. splitter 미사용.

### 10.2 보류 항목 (재검토 가능)
- **클러스터 형태 일반화** (기둥 → 행/격자) — [known-limits.md](auto-layout-wizard.known-limits.md) §1.
- **포트-버짓 기반 적응 gap** — [known-limits.md](auto-layout-wizard.known-limits.md) §2.
- **다수 후보 전략** (S-EXH/S-MEMO/S-DP) — §5.5·§7B.
- **회전 4방향 후보** — fluid_box 위치가 회전마다 달라지는 머신의 배치 가능성을 늘릴 때.
