---
tags: [auto-layout, placement, routing]
---

# 배치 탐색 알고리즘 — 컨테이너 모델

> ## ⚠️ 상태 정정 (2026-07-25)
>
> **이 문서가 "현재 전략"이라 부르는 `S-LAYER` 는 코드에서 삭제됐다** (리팩토링 Phase 3).
> tidy-tree 배치·left-edge 채널·BFS 1:1 라우팅은 더 이상 실행되지 않는다.
>
> 지금 실제로 도는 것은 **모듈 파이프라인**이다:
> `layeredWizard.runLayeredWizard`(진입점 — 트리 전개·머신 선정만) →
> `planner/moduleWizard.tryRunModulePipeline`(배치 전부).
> 흐름은 [[code-folders]], 링크 모델은 [[machine-link]],
> 채널 예약은 [[channel-geometry-reservation]] 를 보라.


> **부모 문서:** [auto-layout-wizard.md](../wizard.md) — 위저드 인터페이스
> **관련 문서:** [.s-layer-channel-reservation](../channel/s-layer-channel-reservation.md), [.entity-roles](entity-roles.md), [.known-limits](known-limits.md)

---

## 1. 한 줄 요약

[[용어사전#머신 (machine)|머신]]과 [[용어사전#무한상자 (infinity chest)|무한상자]]·[[용어사전#무한파이프 (infinity pipe)|무한파이프]]를 단일 추상 *[[용어사전#컨테이너|컨테이너]]* 로 묶고, 컨테이너끼리의 입출력을 *[[용어사전#벨트 (belt)|벨트]](가변길이) + [[용어사전#투입기 (inserter)|투입기]] 페어* (item) 또는 *[[용어사전#파이프 (pipe)|파이프]] + [[용어사전#지하파이프 (pipe-to-ground)|지하파이프]]* (fluid) 로 [[용어사전#라우팅 (routing)|라우팅]]한다.

이 컨테이너 모델(§2–4)과 [[용어사전#정합성 조건 (C1–C3)|정합성 조건]](§6 C1–C3)은 **어떤 배치 전략에서도 변하지 않는 불변 기반**이다.

---

## 2. 컨테이너

### 2.1 정의

세 종류의 게임 엔티티를 하나의 추상 *컨테이너* 로 묶는다.

| 컨테이너 종류 | 게임 엔티티 | 용도 |
|---|---|---|
| 머신 (machine) | assembling-machine, furnace, rocket-silo 등 | 레시피 처리 |
| 무한상자 (infinity chest) | `infinity-chest` (1×1) | 외부 item I/O |
| 무한파이프 (infinity pipe) | `infinity-pipe` (1×1) | 외부 fluid I/O |

각 컨테이너의 [[용어사전#footprint|footprint]] 는 [`Entity.tile_width × tile_height`](../../../src/UI/store/gameDataStore.ts), fluid I/O 셀 좌표는 [`Entity.fluid_boxes[].connections[].positions`](../../../src/UI/store/gameDataStore.ts) 에서 결정된다. 무한상자는 fluid_boxes 가 없으므로 item port 만 노출.

구현: [containerModel.ts](../../../src/autoLayout/containerModel.ts) `Container`.

### 2.2 ports

각 컨테이너는 외부와 통하는 셀 집합 = **[[용어사전#포트 (port)|port]] 집합** 을 노출한다.

| port 종류 | 좌표 출처 | 머신 | 무한상자 | 무한파이프 |
|---|---|---|---|---|
| item port | footprint 둘레 셀 (`2(w + h)` 개) | ✓ | ✓ | — |
| fluid port (특정 fluid) | `fluid_boxes[].connections[].positions` (회전 0 기준 고정) | ✓ (해당 머신만) | — | ✓ |

`port.kind ∈ {item, fluid:<fluid-name>}`. 라우팅은 같은 kind 의 두 port 사이만 짝지을 수 있다. 구현: [portInference.ts](../../../src/autoLayout/manualEdit/portInference.ts) `enumerateContainerPorts`.

---

## 3. 영역 — 내부 영역 + perimeter ring (외부)

좌표계는 **단일** 이며, 두 영역은 그 좌표계 안에서 *역할 분류* 로 구분된다.

| 영역 | 한국어 | 구성 | 좌표 기준점 |
|---|---|---|---|
| internal area | 내부 영역 | 머신 + 내부 라우팅 (벨트·파이프·투입기) | 머신 footprint 의 bbox |
| external area | 외부 영역 | 무한상자·무한파이프 | **internal 영역의 머신+라우팅 bbox 의 perimeter ring** 위 |

**핵심 규칙** — 외부 컨테이너는 *internal [[용어사전#bbox|bbox]] 의 [[용어사전#perimeter ring|perimeter ring]]* 위에 산다. 별도 좌표계는 없다.

---

## 4. 라우팅 형식

라우팅 = 두 컨테이너의 (producer port, consumer port) 사이를 잇는 운반체 체인.

| kind | 체인 형식 | 메모 |
|---|---|---|
| item | `컨테이너 — 투입기 — 벨트(+지하벨트) — 투입기 — 컨테이너` | 두 컨테이너가 1셀 gap 으로 마주보면 벨트 없이 *인서터 1개* 로 직결(코너 케이스). |
| fluid | `컨테이너 — 파이프(+지하파이프) — 컨테이너` | 투입기 없음. |


### 4.1 지하 변형 (underground-belt / pipe-to-ground)

라우팅 경로 탐색은 *[[용어사전#Dijkstra|Dijkstra]]* — 지상 인접 edge (cost 1) + 지하 점프 페어 edge (cost 2). 점프 edge 는 한 축 방향으로 `k ∈ [1, max_underground_distance]` 떨어진 셀을 입출구 페어로 emit. 사이 통과 셀 = `k − 1` 칸.

**차단 규칙 (Factorio 게임 동작 기준):**

| 종류 | 같은 직선 위 다른 페어 차단 조건 |
|---|---|
| `pipe-to-ground` | **무조건** — entity prototype 이 달라도 서로 차단. 단일 `blockGroup = "pipe-to-ground"`. |
| `underground-belt` | **같은 prototype 만** — 다른 티어는 독립. `blockGroup = entityName`. |

지하 운반체는 입출구가 *직선* 으로만 이어지므로 꺾임은 반드시 지상 셀에서 일어난다. Dijkstra 상태 `(x, y, arr)` (arr = 도착 방식·방향) 가 **출구 직진**(출구 셀은 같은 방향 직진만 + 재점프 금지)·**입구 직진**(점프는 도착 방향과 같은 방향으로만 시작; 시작 셀만 예외) 두 제약을 강제해, 직각 코너에 항상 연결용 지상 한 칸이 남게 한다. 구현: [containerRouting.ts](../../../src/autoLayout/planner/containerRouting.ts) `dijkstraWithJumps`.

> *지하 변형의 게임 메커니즘 자체*(왜 직선만, 왜 차단되는가)는 본 문서 범위 밖이다.

---

## 5. 모듈 구성

| 모듈 | 책임 | 구현 |
|---|---|---|
| **머신 수 산정** | 레시피 throughput → 노드별 머신 대수 | [recipeTree.ts](../../../src/autoLayout/recipeTree.ts) `assignMinimumCounts` / `assignThroughputCounts` *(상세는 범위 밖)* |
| **머신 배치** | 결정된 좌표로 footprint 를 internal 에 commit | [machinePlacer.ts](../../../src/autoLayout/execution/machinePlacer.ts) `commitContainer` |
| **트렁크 병합** | N:1 공유 belt + 머신별 탭 | `execution/module/emitModule.emitTapInserting` |
| **채널 계획** | 모듈 사이 라우팅 채널 폭/트랙 산정 | `channelPlanner.ts` |
| **오케스트레이터** | 위 모듈을 엮어 후보 생성 | `moduleWizard.ts` `tryRunModulePipeline` |

---

## 6. 조건 등록부

> **분류:** **C** = 정합성 조건(모든 전략이 만족하는 불변) / **O** = 정렬 기준.

### C1 — 충돌 없는 배치
모든 컨테이너 footprint, 라우팅 점유 셀, 인서터 셀이 한 셀도 겹치지 않는다.

### C2 — 라우팅 가능
모든 (producer, consumer, content, kind) 페어에 §4 형식의 라우팅이 존재한다.

### C3 — 액체 mixing 방지
한 fluid-route 셀은 단 하나의 fluid 만 운반. 다른 fluid 라우팅끼리 점유 셀이 겹치면 안 된다.

### O1 — 내부 영역 bbox 가 정사각형에 가까울수록 우선
`|W − H|` 가 작을수록 나은 후보. **단, 현재 경로는 후보를 1개만 반환하므로 선택에 쓰이지 않고 메타데이터(`squarenessPenalty`)로만 기록된다.**

### O2 — 지하 변형 우선
지상으로 점유될 셀을 지하 변형 페어로 비울 수 있으면 우선. 라우팅 Dijkstra 의 cost(지상 1 / 점프 2)가 자연히 짧은 우회 시 지상, 막힌 길에서 지하를 선택([§4.1](#41-지하-변형-underground-belt--pipe-to-ground)).

---

## 10. 명시적 비-목표

### 10.1 비-목표 항목
- **공유 자식** — 한 product 가 여러 부모로 공급되는 케이스는 고려하지 않는다(트리 펼침이 품목을 중복 전개).
- **splitter 분기** — 컨테이너 분할 또는 트렁크 병합으로 우회. splitter 미사용.

### 10.2 보류 항목 (재검토 가능)
- **클러스터 형태 일반화** (기둥 → 행/격자) — [known-limits.md](known-limits.md) §1.
- **회전 4방향 후보** — fluid_box 위치가 회전마다 달라지는 머신의 배치 가능성을 늘릴 때.
