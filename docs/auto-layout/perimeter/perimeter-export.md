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
> - `execution/modulePerimeterPass.ts` · `planner/perimeterExitPlanner.ts` · `planner/perimeterRouter.ts` ·
> `planner/perimeter/{wayOuts,lanes}.ts` 를 수정할 때
> - `PERIMETER_MARGIN` · `reservedExportCells` · `ExitAssignment` · `rePathToPerimeter` 를 건드릴 때
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

살아남은 상자만 대상인 이유는 [[용어사전#납품 경로 (deliveryRoute)|납품 경로]] 때문이다 — "철판 상자"와 "철판을 만드는
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

**구현:** [`planner/perimeterExitPlanner.ts`](../../../src/autoLayout/planner/perimeterExitPlanner.ts) `planPerimeterExits`
+ [`planner/modulePacking.ts`](../../../src/autoLayout/planner/modulePacking.ts) `packModuleTree`

상자마다 **어느 변으로(`exitEdge`), 주행선을 어디서 얻어(`exitMode`)** 나갈지 배정한다.

> **모델은 하나다 — 주행선 하나를 고르고 그 축의 바깥 변까지 간다.** 갈리는 것은 그
> 주행선의 **후보가 어디서 오나**뿐이고, **축은 `exitEdge` 가 이미 말한다**(N/S 면 세로
> 주행, W/E 면 가로 주행).

| `exitMode` | 주행선 후보 | 경로 | 채널 트랙 소비 |
|---|---|---|---|
| `direct` (**직진**) | **1개** — 상자 좌표 그대로. 늘릴 수 없다 | 그 축으로 곧장 바깥 변까지 | 없음 |
| `channel` (**환승**) | 여럿 — 그 채널이 배정한다. 모자라면 채널이 넓어진다 | 채널로 **가로 진입** → 채널 안에서 N/S 변으로 **세로 주행**(ㄱ자) | **1** |

> **2026-09-08 이전엔 셋이었다** — `self`(세로 직진)·`margin`(가로 직출)·`channel`.
> 앞 둘은 **같은 것의 두 축**이었고 저장소의 어떤 소비자도 구분하지 않아 합쳤다
> (방출은 `exitEdge` 로만 축을 골랐고, `margin.edge` 는 언제나 `exitEdge` 와 같았다).

배정은 하나로 못박지 않고 **선호 순 후보 목록**(`ExitAssignment.options`)으로 남긴다. 뒤에
더 센 제약을 가진 장부가 앞 후보를 **강등**시킬 수 있기 때문이다(스도쿠: 제약 센 곳부터).
모든 후보는 `wayOut ∈ moduleWayOuts` 를 만족한다. 실제로 강등시키는 장부는 아래 **직진
장부** 하나다(2026-09-10 — 그전까지 `options` 를 읽는 코드는 하나도 없었다).

#### 직진 장부 — **자리를 안 사는 경로도 등록은 해야 한다**

**구현:** [`planner/perimeter/directRay.ts`](../../../src/autoLayout/planner/perimeter/directRay.ts) `DirectRay` · `directRaysCross`

이 저장소의 자리 모델은 한 문장이다 — *"통로가 자기 축의 줄을 판다 → 경로가 자기 축의 줄을
산다 → 모자라면 통로가 넓어진다."* **직진은 이 모델 밖이다.** 주행선 후보가 하나뿐이라 고를
게 없고, 그래서 사지 않는다. 그런데 **선은 긋는다.**

```
사는 것      여럿 중 하나를 고르고, 모자라면 통로를 늘린다   ← 고를 게 있어야 성립
등록하는 것   내가 여기 있다                              ← **고를 게 없어도 할 수 있다**
```

그 선이 어느 장부에도 없으면 두 직진이 만났을 때 **방출 순서로 갈린다** — 방출은 상자를
하나씩 깔면서 `occ` 를 그때그때 갱신하므로 먼저 깔린 쪽이 이기고, 나중 것은
`straight blocked` 로 skip 돼 상자가 조립 블루프린트 **한복판에** 남는다.

> **고칠 수 있는 것은 「부딪힌다」가 아니라 「너무 늦게 안다」다.** 방출에서 알면 남은 수가
> 포기뿐이다(직진은 `offsets: [0]` 이라 옆으로 한 칸도 못 비끼고, 방출은 배정을 재생만
> 한다). **배정에서 알면 다른 길이 있다** — `options` 의 다음 후보로 내려가면 되고,
> 환승은 통로가 자리를 팔아 **대가를 폭으로 치환한다.**

**끝점이 필요 없다 — 직진은 반직선이다.** seat 행/열은 `rawBbox` 에서 나오고 그건 배치
뒤인데, 직진의 선은 *"상자에서 도면 끝까지"* 라 한쪽이 열려 있다:

```
세로 직진   (열 c, 상자 행 y₀, N)  =  { (c, y) : y ≤ y₀ }
가로 직진   (행 r, 상자 열 x₀, E)  =  { (x, r) : x ≥ x₀ }
```

**교차 판정은 `toward` 를 반드시 읽는다.** 축만 보면 **등지고 뻗는** 쌍을 겹친다고 오판한다:

```
세로(c, y₀, ↑N) × 가로(r, x₀, →E)   ⟺  r ≤ y₀ ∧ c ≥ x₀     (방향 조합마다 부등식이 다르다)
세로(c, y₀, ↑N) × 세로(c′, y₁, ↑N)  ⟺  c = c′               (같은 방향이면 반드시 겹친다)
세로(c, y₀, ↑N) × 세로(c′, y₁, ↓S)  ⟺  c = c′ ∧ y₁ ≤ y₀      (마주 볼 때만)
```

**넷이면 완전하다 — `(깊이, 로컬 열, 절대 행, 방향)`.** 가로 직진은 **끝 열에서만** 나오고
바깥쪽으로 뻗으므로 다른 열의 세로선과는 만날 수가 없고, 같은 깊이의 모듈은 전부 `colX[d]`
에 왼쪽 정렬되므로 **로컬 x 끼리의 비교가 절대 x 로 비교한 것과 답이 같다.** 그래서 `colX`
도 `rawBbox` 도 기다리지 않는다.

**바뀌는 것은 승자가 아니라 패자의 대가다.** *"먼저 온 쪽이 이긴다"* 는 그대로다 — 방출에
있던 선점이 배정으로 **옮겨 왔을 뿐**이고, 진 쪽이 치르는 값이 바뀐다:

```
옛   방출에서 선점  →  진 쪽의 대가 = skip   (상자가 블루프린트 한복판에 남는다)
새   배정에서 선점  →  진 쪽의 대가 = 환승   (트랙 1 + 폭)
```

**순회는 `options.length` 오름차순**(동률은 `id`)이다. 옛 순회는 `id` 순이라 결정적이긴
해도 **제약과 아무 상관이 없었다** — 후보가 셋인 상자가 후보 하나뿐인 상자보다 먼저 골라
버린다. 후보가 없어질 수 있는 쪽부터 고르게 한다(→ [[priority-ordering]]).

> **강등할 데가 없는 경우가 실재한다** — 깊이 0 의 W 상자·최대 깊이의 E 상자·단일 열 트리는
> 열 채널이 없어 후보가 직진 하나뿐이다. 그때는 **오늘 그대로 두고**(`options[0]`) 방출에
> 맡긴다. 그 갈래를 안 적으면 배정이 통째로 사라져 **확정 skip** 이라 오늘보다 나쁘다.

**낙선 기록**(`PerimeterExitPlan.demotions`)은 강등이 일어난 자리를 `{상자, 버린 변, 승자,
칸}` 으로 쌓는다. **동작을 안 바꾼다** — *"셋 이상이 다투는 자리가 몇 건인가"* 를 처음으로
셀 수 있게 하는 계측이다(`tempPlanDocs/셀장부/judgements.md` **J-충돌차수**).

> **여기 있는 것은 「양보」가 아니다.** 그 용어는 *이미 잡은 주인이 비켜 주는 것*(철회·선점)을
> 뜻하고 자리마다 `owner` 가 있어야 성립한다. 여기서 일어나는 것은 **아직 확정 안 된 후보를
> 건너뛰는 것**뿐이라 철회가 없다 — **후보 강등**이다.

**핵심 — 폭 역전.** 환승으로 배정된 상자는 **진입점**(`entry` — 행 + 어느 벽)을 내고,
`packModuleTree` 가 이를 [[용어사전#납품 경로 (deliveryRoute)|납품 경로]] 와 **한 장부**
([[channel-geometry-reservation]])에 함께 넣는다. 장부가 도형을 배정하고, **쓴 트랙 수가
곧 채널 폭**이다.

> 2026-09-08 까지는 반출이 세로 구간(`Interval`)만 내고 `assignTracksLeftEdge` 가 폭을
> 셌다. 그 계산은 `AUTO_LAYOUT_CHANNEL_GEOMETRY` **off 모드 전용**이었고, off 모드를
> 지우면서 함께 사라졌다 — 폭의 출처가 **통합 장부 하나**가 됐다.

> 즉 **"상자가 나갈 길"이 채널 폭 계산의 입력**이 된다. 그래서 배치가 끝났을 때 그 길은
> **이미 비어 있음이 보장**된다. 이것이 "예약 철학"이며, [[channel-geometry-reservation]]
> 이 상위 문서다.

**직진** 상자를 위해서는 bbox 사방에 [`PERIMETER_MARGIN`](../../../src/autoLayout/shared/grid.ts) `= 2`
칸 프레임을 붙인다(`marginNeeds` 가 요구한 변만). 예약한 경로 셀은 `reservedExportCells` 에
등록해 납품 벨트가 침범하지 못하게 한다.

> **`PERIMETER_MARGIN` 이 2인 이유** — 옛 트렁크 시절엔 1이었다. 그땐 anchor 안쪽 feeder
> 인서터 자리를 벨트로 **재활용**해 한 칸을 벌었다. 1:1 방출에선 그 자리에 **머신을 먹이는
> 인서터**가 앉아 있어 덮을 수 없다(덮으면 머신이 굶는다) → 한 칸을 바깥에서 돌려받아야 한다.
> **이 값은 세 곳이 공유한다**: `modulePacking` 의 `expandBbox` · `seatRow/seatCol`,
> `modulePerimeterPass` 의 `perimeterOf`. 어긋나면 예약과 방출이 다른 변을 가리킨다.

이 단계는 **좌표 계획서(`PerimeterExitPlan`)만 만든다. 셀은 하나도 안 놓는다.**

### ③ 방출 — 계획서대로 그린다

**구현:** [`execution/modulePerimeterPass.ts`](../../../src/autoLayout/execution/modulePerimeterPass.ts) `rePathToPerimeter`
+ [`planner/perimeterRouter.ts`](../../../src/autoLayout/planner/perimeterRouter.ts) `routePortToPerimeter`

```
1. 점유 셀 지도(occ) + 전역 외곽 사각형(perimeter) 계산
2. 살아남은 포트를 상자 id 순 정렬            ← 결정적 결과 보장
3. 포트마다:
     a. ②의 배정(exitEdge·host·trackX)을 hint 로 넘겨 경로 재생   ← 탐색 없음
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

> **주의:** `shared/frames.ts` 는 지금도 살아 있다. 남은 것은 반출과 무관한
> `unifyLeaf` — **레이아웃 좌표 → 그리드 좌표 경계를 넘는 문**이다(→ [[용어사전#좌표 프레임 (coordinate frame)]]).
> 드래그 재라우팅(`dragExternalContainer`/`dragAssemblerGroup`)은 `manualEdit/` 으로 갔다가 2026-09-16 에 삭제됐다(→ [[manual-edit]]).
> 그래서 `shared/frames.ts` 에 남은 것은 좌표 프레임의 문 둘뿐이다.
>
> **반출은 이 문에 영향을 준다.** 반출된 상자는 `internal.placed` 바깥
> [PERIMETER_MARGIN]=2 칸에 앉으므로, `unifyLeaf` 는 정규화 기준을 `internal` 이 아니라
> **그리드에 쓸 셀 전부**로 잡는다. internal 만 보면 반출 상자가 음수로 밀려나고,
> 음수 좌표가 금지된 지금은 그 셀이 **유실**된다(2026-08-05).

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
| ① 산출 | `planner/perimeter/wayOuts.ts` | `fillModuleWayOuts` — 모듈이 자기 몸통에 대해 답한다(`moduleWayOuts` + `bodyColumns`) |
| ② 배정 | `planner/perimeterExitPlanner.ts` · `planner/perimeter/types.ts` | `planPerimeterExits` · 타입 `ExitMode` · `ExitAssignment` · `PerimeterExitPlan` |
| ② 직진 장부 | `planner/perimeter/directRay.ts` | `DirectRay` · `directRaysCross` — 자리를 안 사는 경로의 등록부 |
| ② 폭 반영 | `planner/modulePacking.ts` · `planner/channel/shape.ts` | `planExits` · `expandBbox` 호출 · `reservedExportCells`(materializeChannelGeometry) |
| ② 트랙 확정 | `planner/channelGeometryPlanner.ts` | `trackX` 배정 |
| ③ 방출 | `execution/modulePerimeterPass.ts` | `rePathToPerimeter` · `PerimeterPassResult` |
| ③ 기하 | `planner/perimeterRouter.ts` | `routePortToPerimeter` · `RouteHint` |
| 적용 | `planner/moduleWizard.ts` | `droppedCellKeys` · `relocOrigin` 반영 |
| 상수 | `shared/grid.ts` | `PERIMETER_MARGIN = 2` |

> **읽을 때 함정 — `seat` 가 두 뜻이다.**
> `modulePerimeterPass` 의 지역변수 `seat` = `anchor − faceVector` = **머신에 물건을 넣는 인서터**.
> `perimeterRouter` 의 반환 `seat` = **상자가 새로 앉을 전역 외곽 자리**. 어느 파일의 `seat` 인지 확인할 것.
