---
tags: [auto-layout, placement, routing]
---

> **부모 문서:** [wizard.md](../wizard.md)
> **관련 문서:** [module-way-outs](module-way-outs.md) — ①단계 계약 상세 ·
> [channel-geometry-reservation](../channel/channel-geometry-reservation.md) — ②단계 기하 상세 ·
> [ns-face-relief](../module/ns-face-relief.md) — 코너 어깨 상자가 생기는 경위 ·
> [pipe-semantics](../../factorio/pipe-semantics.md) — 유체 반출의 합류 가드

# perimeter 반출 — 살아남은 무한상자를 전역 외곽으로

> **이 문서를 읽어야 하는 때**
> - `execution/modulePerimeterPass.ts` · `planner/perimeterLanePlanner.ts` · `planner/perimeterRouter.ts` ·
> `planner/perimeter/{wayOuts,lanes}.ts` 를 수정할 때
> - `PERIMETER_MARGIN` · `reservedExportCells` · `LaneAssignment` · `rePathToPerimeter` 를 건드릴 때
> - 무한상자가 배치 **안쪽에 남아 있다**는 증상을 조사할 때 (콘솔 `[perimeterPass] SKIP`)
> - "상자를 바깥으로 빼는 탐색 로직을 새로 짜자"는 생각이 들 때 → **§4 를 먼저 읽을 것**

## 0. 한 줄 요약

무한상자는 **플레이어가 실제로 벨트를 무는 외부 물류 접점**이라 청사진 바깥 테두리에 있어야
하는데, 모듈을 타일링하면 각 모듈의 로컬 ring 이 배치 **내부**로 들어가 상자가 갇힌다. 이를
**계약(①) → 예약(②) → 방출(③)** 3단으로 푼다 — 나갈 통로를 **채널 폭 계산의 입력으로 당겨서**
자리를 먼저 확보하고, 깔 때는 탐색 없이 재생만 한다.

---

## 1. 왜 외곽이어야 하나 — 요구사항의 출처

[[용어사전#무한상자 (infinity chest)|무한상자]]는 게임 안에서 물건을 만들어내는 기계가 아니다.
**"여기가 이 청사진과 외부 세계가 만나는 지점"이라는 표시**다. 사용자가 이 청사진을 게임에
찍고 나면, 무한상자 자리에 자기 공장의 벨트를 물어 원료를 넣고 완제품을 빼간다.

그래서 무한상자의 위치는 미학이 아니라 **기능 요구사항**이다:

- 상자가 배치 **한복판**에 있으면 → 벨트를 끌어올 방법이 없다. 청사진을 뜯어야 한다.
- 상자가 **바깥 테두리**에 있으면 → 어느 방향에서든 접근 가능하다.

> **이것이 반출 3단 구조가 존재하는 유일한 이유다.** 아래의 모든 복잡도(예약·트랙·마진·
> 절단선)는 이 한 줄을 만족시키기 위한 비용이다.

살아남은 상자만 대상인 이유는 [[용어사전#홉 (hop)|홉]] 때문이다 — "철판 상자"와 "철판을 만드는
화로"가 둘 다 배치되면 상자는 필요 없어지고 화로에서 벨트로 직결된다. 끝까지 짝을 못 찾은
상자 = **트리의 진짜 입력(raw 원료)과 진짜 출력(최종 제품)** 만 반출 대상이 된다.

---

## 2. 왜 상자가 안쪽에 갇히나 — 문제

[`clusterModule.generateModule`](../../../src/autoLayout/module/clusterModule.ts) 은 각
클러스터를 **"자기가 트리의 루트인 척"** 만든다(부모를 전혀 보지 않는다). 그래서 완성된 모듈은
자기 [[용어사전#perimeter ring|ring]] 위에 입·출력 무한상자를 갖는다.

그다음 [`modulePacking.packModuleTree`](../../../src/autoLayout/planner/modulePacking.ts) 가
모듈들을 **depth(트리 깊이) 별 세로 열**로 타일링하면서 사이에 [[용어사전#채널 (channel)|채널]]을 둔다.
이 순간 **로컬 ring 들이 전체 배치의 내부가 된다**:

```
 ┌──────────────────────────────────────────────┐ ← 전역 외곽
 │ depth 0      채널      depth 1      채널      │
 │ ┌────────┐   ║║║    ┌────────┐   ║║║        │
 │ │  □ ←───────────── 여기 갇힘  │   ║║║        │
 │ │ [철판] │   ║║║    │ [톱니] │   ║║║        │
 │ └────────┘   ║║║    └────□───┘   ║║║        │
 │                          ↑ 여기도                │
 └──────────────────────────────────────────────┘
```

모듈이 자족적으로 잘 만들어졌다는 것과, 그 모듈들을 합쳤을 때 외부 접점이 살아 있다는 것은
**다른 문제**다. 반출은 이 간극을 메운다.

---

## 3. 3단 흐름

### ① 계약 — 모듈이 자기에 대해 답한다

**구현:** [`module/clusterModule.ts`](../../../src/autoLayout/module/clusterModule.ts) `generateModule`

모듈은 바깥에서 볼 때 **불투명한 블랙박스**이고, 포트마다 다음만 공개한다:

| 필드 | 뜻 |
|---|---|
| `anchor` | ring 위의 셀 = 무한상자가 앉은 자리 |
| `tapAnchor` | `anchor − 2×faceVector(face)` = 트렁크 벨트의 첫 칸. 라우팅의 machine 쪽 끝점 |
| `face` | 포트가 향한 바깥 방향 |
| `meta.side` | 포트 계획기가 배정한 **변**(N/S/W/E). 출구 후보의 1순위 근거 |
| `moduleWayOuts` | **이 상자가 자기 몸통에 안 막히고 나갈 수 있는 방향들** |

`moduleWayOuts` 가 3단 구조를 성립시키는 계약이다 — 모듈이 **자기 자신에게** 물어본 답이라,
②단계는 모듈 내부를 들여다보지 않고도 **실제로 뚫린 방향만** 고를 수 있다.
근거와 실측 사례는 [[module-way-outs]] 참조.

### ② 예약 — 자리를 먼저 잡는다

**구현:** [`planner/perimeterLanePlanner.ts`](../../../src/autoLayout/planner/perimeterLanePlanner.ts) `planPerimeterLanes`
+ [`planner/modulePacking.ts`](../../../src/autoLayout/planner/modulePacking.ts) `packModuleTree`

상자마다 **어느 변으로, 어느 통로를 타고** 나갈지 배정한다. 통로(`LaneHost`)는 세 가지:

| host | 경로 | 채널 트랙 소비 |
|---|---|---|
| `self` | 자기 열에서 N/S 마진 행까지 **직진** | 없음 |
| `margin` | 최좌(depth 0)/최우(maxDepth) 열이면 바깥 W/E 마진으로 **직출** | 없음 |
| `channel` | 인접 채널로 **가로 jog** → 채널 안에서 가까운 N/S 변으로 **세로 주행**(ㄱ자) | **1** |

배정은 하나로 못박지 않고 **선호 순 후보 목록**(`LaneAssignment.options`)으로 남긴다. 뒤에
더 센 제약을 가진 장부가 **양보를 요구**할 수 있기 때문이다(스도쿠: 제약 센 곳부터).
모든 후보는 `wayOut ∈ moduleWayOuts` 를 만족한다.

**핵심 — 폭 역전.** `channel` 로 배정된 상자는 자기가 채널에서 쓸 **세로 구간**(`Interval`)을
내놓고, `packModuleTree` 가 이를 [[용어사전#납품 경로 (deliveryRoute)|납품 경로]] 구간과 **합쳐서**
[`channelPlanner.assignTracksLeftEdge`](../../../src/autoLayout/planner/channelPlanner.ts) 에
넘긴다. 나온 트랙 수가 곧 채널 폭이다.

> 즉 **"상자가 나갈 길"이 채널 폭 계산의 입력**이 된다. 그래서 배치가 끝났을 때 그 길은
> **이미 비어 있음이 보장**된다. 이것이 "예약 철학"이며, [[channel-geometry-reservation]]
> 이 상위 문서다.

`self`/`margin` 상자를 위해서는 bbox 사방에 [`PERIMETER_MARGIN`](../../../src/autoLayout/util/helper.ts) `= 2`
칸 프레임을 붙인다(`marginNeeds` 가 요구한 변만). 예약한 경로 셀은 `reservedExportCells` 에
등록해 납품 벨트가 침범하지 못하게 한다.

> **`PERIMETER_MARGIN` 이 2인 이유** — 옛 트렁크 시절엔 1이었다. 그땐 anchor 안쪽 feeder
> 인서터 자리를 벨트로 **재활용**해 한 칸을 벌었다. 1:1 방출에선 그 자리에 **머신을 먹이는
> 인서터**가 앉아 있어 덮을 수 없다(덮으면 머신이 굶는다) → 한 칸을 바깥에서 돌려받아야 한다.
> **이 값은 세 곳이 공유한다**: `modulePacking` 의 `expandBbox` · `seatRow/seatCol`,
> `modulePerimeterPass` 의 `perimeterOf`. 어긋나면 예약과 방출이 다른 변을 가리킨다.

이 단계는 **좌표 계획서(`LanePlan`)만 만든다. 셀은 하나도 안 놓는다.**

### ③ 방출 — 계획서대로 그린다

**구현:** [`execution/modulePerimeterPass.ts`](../../../src/autoLayout/execution/modulePerimeterPass.ts) `rePathToPerimeter`
+ [`planner/perimeterRouter.ts`](../../../src/autoLayout/planner/perimeterRouter.ts) `routePortToPerimeter`

```
1. 점유 셀 지도(occ) + 전역 외곽 사각형(perimeter) 계산
2. 살아남은 포트를 상자 id 순 정렬            ← 결정적 결과 보장
3. 포트마다:
     a. ②의 배정(exitEdge·host·laneX)을 hint 로 넘겨 경로 재생   ← 탐색 없음
     b. 옛 상자 자리(anchor)·옛 feeder 를 "뗄 목록"에 등록
     c. 경로에 belt + feeder 인서터 + 상자를 놓는다
     d. 실패 → 그 상자만 skip
```

`rePathToPerimeter` 는 **순수 함수**다 — 아무것도 직접 고치지 않고 무엇을 떼고(`droppedCellKeys`)
무엇을 놓고(`addedCells`) 상자가 어디로 갔는지(`relocations`)를 **반환만** 한다. 적용은
[`moduleWizard.ts`](../../../src/autoLayout/planner/moduleWizard.ts) 가 `Area` 를 조립할 때
한다. 덕분에 store 없이 좌표만으로 단위 테스트가 된다.

**탐색 폴백을 일부러 두지 않는다.** 예약이 "뚫린 방향만"(①의 `wayOuts`) 골랐고 채널 구간은
장부가 비워뒀으므로, **예약된 경로는 항상 방출 가능해야 한다.** 따라서 실패는 우회할 일이
아니라 **예약 불변식이 깨졌다는 신호**다. 가짜 물류(끊긴 벨트·겹친 상자)를 만드느니 그 상자만
로컬 ring 에 남기고 사유를 남긴다.

---

## 4. 대안 검토 — 옛 탐색형을 왜 버렸나

**2026-07-27 삭제됨:** `areaUnification.wrapExternalsAroundPerimeter` 와 그 하위 8개 함수(398줄).

### 옛 방식

```
상자를 반경 2 링에 놓아본다 → 자리 없음 → 반경 3 → … → 최대 12(MAX_EXTERNAL_SEARCH_RADIUS)
자리를 찾으면 routeWithFallback(Dijkstra + 포트 조합 완전탐색)으로 벨트를 깐다
실패하면 다시 반경을 키운다
```

### 왜 실패했나

**자리를 다 쓴 뒤에 통로를 찾으려 했다.** 기계와 벨트가 이미 꽉 찬 상태에서 빈틈을 뒤지니
실패하거나 경로가 괴상하게 돌아갔다. 반경을 키우면 배치가 불필요하게 커졌다.

### 전환

| | 옛 방식 | 현재 |
|---|---|---|
| 철학 | **탐색** — 놓고 나서 길을 찾는다 | **예약** — 길 몫을 세어두고 놓는다 |
| 링 폭 | 동적(2~12) | 고정 `PERIMETER_MARGIN = 2` + 채널이 lane 흡수 |
| 라우팅 | Dijkstra + 완전탐색 | 예약 lane 안 직선/ㄱ자 (탐색 0) |
| 실패 시 | 반경 +1 재시도 | 그 상자만 skip, 나머지는 성공 |

### 삭제 이력 (재조사 방지)

| 커밋 | 사건 |
|---|---|
| `9529d85` | Phase 3 — 옛 S-LAYER 배치 경로 본체 삭제. **유일한 프로덕션 호출자가 이때 사라짐** |
| `f22c37f` | 같이 죽은 4개 모듈은 삭제. 이 함수만 "`dragRingBounds.test` 의 셋업으로 쓰인다"는 이유로 존치 |
| 2026-07-27 | 그 테스트의 fixture 를 손으로 재작성해 의존을 끊고 삭제. `ringGateway.test.ts`(죽은 함수만 테스트)도 함께 |

> **주의:** `areaUnification.ts` 는 지금도 살아 있다. 남은 것은 반출과 무관한
> `unifyAreas`(화면용 평탄화)·`dragExternalContainer`/`dragAssemblerGroup`(사용자 드래그
> 재라우팅)이다. 드래그 경로는 여전히 `routeWithFallback` 탐색을 쓴다 — **배치 경로가 아니라
> 수동 편집 경로**이기 때문이다.

---

## 5. 실패 시 동작 — skip-on-failure

| 사유(콘솔 `[perimeterPass] SKIP`) | 뜻 |
|---|---|
| `no lane assignment` | ②가 이 상자에 출구를 안 줬다 |
| `reservation not emittable: <reason>` | 예약된 경로가 막혀 있다 = **예약 불변식 위반** |
| `perimeter too close (<n>)` | 경로가 2칸 미만이라 feeder 가 anchor 를 덮는다. 유체는 feeder 가 없어 이 제약 없음 |

실패한 상자는 **로컬 ring 에 트렁크째 남는다** — 물류는 정상이고 위치만 안쪽이다. 트리 전체를
폴백시키지 않으므로 회귀가 0 이다.

**진단:** `AUTO_LAYOUT_PERIMETER_PASS = false` 로 반출 단계 자체를 꺼서 격리할 수 있다
([[변수명사전]]).

---

## 6. 구현 위치

| 단계 | 파일 | 핵심 심볼 |
|---|---|---|
| ① 계약 | `module/clusterModule.ts` | `generateModule` · `ModulePort` · `moduleWayOuts` |
| ① 산출 | `planner/perimeter/wayOuts.ts` | `fillModuleWayOuts` — 모듈이 자기 몸통에 대해 답한다 |
| ② 배정 | `planner/perimeterLanePlanner.ts` | `planPerimeterLanes` · `LaneHost` · `LaneAssignment` · `LanePlan` |
| ② 폭 반영 | `planner/modulePacking.ts` | `planLanes` · `expandBbox` · `reservedExportCells` |
| ② 트랙 확정 | `planner/channelGeometryPlanner.ts` | `laneX` 배정 |
| ③ 방출 | `execution/modulePerimeterPass.ts` | `rePathToPerimeter` · `PerimeterPassResult` |
| ③ 기하 | `planner/perimeterRouter.ts` | `routePortToPerimeter` · `RouteHint` |
| 적용 | `planner/moduleWizard.ts` | `droppedCellKeys` · `relocOrigin` 반영 |
| 상수 | `util/helper.ts` | `PERIMETER_MARGIN = 2` |

> **읽을 때 함정 — `seat` 가 두 뜻이다.**
> `modulePerimeterPass` 의 지역변수 `seat` = `anchor − faceVector` = **머신에 물건을 넣는 인서터**.
> `perimeterRouter` 의 반환 `seat` = **상자가 새로 앉을 전역 외곽 자리**. 어느 파일의 `seat` 인지 확인할 것.
