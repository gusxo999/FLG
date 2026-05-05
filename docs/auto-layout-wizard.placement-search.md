# 배치 탐색 알고리즘 — 목적함수 기반 설계

> **부모 문서:** [auto-layout-wizard.md](auto-layout-wizard.md) — 위저드 인터페이스
> **관련 문서:** [.entity-roles](auto-layout-wizard.entity-roles.md), [.known-limits](auto-layout-wizard.known-limits.md)
>
> **상태:** §3 M1 (둘레 슬롯 단일 머신 모델) + 머신 두 개 가로 배치 + Lee BFS 라우팅의 코드는 작성되어 있다
> ([slotPlacer.ts](../frontend/src/utils/autoLayout/slotPlacer.ts),
> [runSlotWizard.ts](../frontend/src/utils/autoLayout/runSlotWizard.ts)).
> **단, 두 머신 직렬 시나리오의 실측 동작은 검증되지 않았으며, 사용자 보고에 따르면 정상 동작하지 않는 케이스가 있다.**
> 외부 루프 (T1 + O1, area 단조 탐색) 와 회전 / 백트랙 / 지하 변형 / fluid 는 미구현.

---

## 2. 문제 정의

### 입력

- 트리에서 펼친 비-외부 노드별 머신 인스턴스 집합 **M** = {m₁, …, mₙ}.
  - 각 머신: footprint (wᵢ, hᵢ), 4-방향 회전 가능, 레시피의 ingredient/product (item / fluid 둘 다).
  - fluid I/O 가 있는 머신은 [`entity.fluid_boxes[].connections[].positions`](../frontend/src/store/gameDataStore.ts) 가 회전별 fluid 입출력 셀 좌표를 정의 — 머신 origin 에 더해 절대 좌표가 된다.
- 머신 사이의 운반 요구 집합 **E** = { (p, c, content, kind) }.
  - producer p 의 product 가 consumer c 의 ingredient 로 전달되어야 함.
  - **kind ∈ {`belt`, `pipe`}** — content 가 item 이면 belt, fluid 면 pipe. content 는 item 이름 또는 fluid 이름.
- 사용 가능한 인서터·벨트·파이프 종류 (위저드 3·4·5단계 입력).
- (선택) 사용자 지정 최대 영역 — 그 안에 들어가지 못하면 실패.

### 결정 변수

- 각 머신 mᵢ 의 좌상단 좌표 (xᵢ, yᵢ) ∈ ℤ² 와 회전 rᵢ ∈ {0, 4, 8, 12}.
- 각 *고체 운반* 머신 측면에 붙는 입력/출력 인서터의 좌표 + 방향.
- 각 운반 요구의 경로 (셀 직렬). belt 는 direction 이 진행 방향, pipe 는 direction 무관 (펌프 미지원).

> fluid I/O 셀은 머신·회전이 정해지면 *결정 변수가 아니라 파생값* 이다 ( fluid_boxes positions 가 고정). 인서터처럼 따로 결정하지 않는다.

### 출력

- 결정 변수 전체에 대한 한 배치 P.
- P 의 bounding rectangle (W, H, area = W·H).

---

## 3. 조건 등록부 (확장 가능)

본 알고리즘은 **여기 명시적으로 등록된 조건만** 본문 알고리즘에 영향을 준다. 새 조건을 추가할 때는 반드시 본 절에 항목을 등록하고, "제약(C) / 목적(O) / 모델(M) / 종료(T)" 중 어디에 속하는지 표시한다. 등록부 외 자리에 적힌 추측은 채택하지 않는다 ([feedback_no_speculative_absorption](../C:/Users/HyeonTaeJang/.claude/projects/f--CodeStep-factorio-LayoutGenerator/memory/feedback_no_speculative_absorption.md) 정책).

### C1 — 한 사각형 그리드 안에 충돌 없이 배치된다

모든 엔티티(머신·인서터·belt stub·라우팅 belt)의 footprint 가 한 축정렬 사각형 R 안에 들어가야 하며, 두 footprint 가 한 셀이라도 겹치면 안 된다.

### C2 — 모든 운반 요구가 라우팅 가능하다

E 의 모든 (p, c, content, kind) 에 대해 p 의 출력 측 셀에서 c 의 입력 측 셀까지 R 안에 경로가 존재해야 한다.

- kind = `belt`: 다른 머신·인서터·belt-fixed stub 과 충돌하지 않아야 함. 같은 또는 다른 item 의 belt-route 위는 통과 가능 (벨트는 mixing 허용).
- kind = `pipe`: 다른 머신·인서터·belt·pipe-fixed stub (=다른 fluid) 과 충돌하지 않아야 함. 같은 fluid 의 pipe-route 위만 통과 가능 (C3 으로 분리).

### C3 — 액체 mixing 방지

한 pipe-route 셀은 **단 하나의 fluid 만** 운반한다. 두 운반 요구의 fluid 가 서로 다르면 그 두 라우팅의 점유 셀 (entrance/exit + route) 이 한 셀이라도 겹치면 안 된다. 이는 Factorio 의 fluid mixing contamination 규칙을 그대로 옮긴 제약 — 위반 시 머신이 동작 정지한다.

> belt-route 는 본 제약을 받지 않는다. 벨트는 한 셀에 여러 item 이 흘러도 게임 룰 위반이 아니므로, splitter / 정확한 throughput 보장은 별도 항목 ([.known-limits §4](auto-layout-wizard.known-limits.md)) 으로 분리.

**C2.1 (보류) — 한 belt-route 셀은 서로 다른 item 이름 ≤ 2 종류.** 벨트의 두 lane 으로 환원되는 물리적 상한. 현재는 등록부 자리만 비워두고 router 는 belt-route 통과 정책에서 종류 카운팅을 하지 않는다. **라우팅이 안정적으로 동작한 후**, 실측 시나리오에서 3종류 합류가 실제로 발생하는지 확인하고 정의.

### O1 — 사각형 넓이 최소화

두 feasible 배치 P₁, P₂ 에 대해 area(R(P₁)) < area(R(P₂)) 이면 P₁ 이 더 나은 배치다.

### M1 — 단일 머신 둘레 슬롯 모델 (외부 입출력 케이스, 컨텍스트-프리)

**적용 범위:** 한 머신을 *고립* 시켜 보았을 때 — 즉 인접 머신이 없거나 (전후 문맥 부재), 모든 재료가 외부 공급일 때 — 머신 둘레에 깔리는 인서터·벨트 stub 의 자리.

**모델:** w×h footprint 머신의 둘레 `2(w + h)` 셀에 *슬롯 위치* 를 다음 순서로 부여한다.

- 상단 좌→우: `1 .. w`
- 좌측 위→아래: `w+1 .. w+h`
- 우측 위→아래: `w+h+1 .. w+2h`
- 하단 좌→우: `w+2h+1 .. 2(w+h)`

> 3×3 머신 → 12 슬롯, 3×2 보일러 → 10 슬롯, 9×9 로켓사일로 → 36 슬롯. "12-슬롯" 은 3×3 의 인스턴스 이름일 뿐 모델 정의가 아니다. 다음 다이어그램은 3×3 예시.

```
        1  2  3
      ┌─────────┐
   4  │         │  7
   5  │  M M M  │  8
   6  │  M M M  │  9
      │  M M M  │
      └─────────┘
       10 11 12
```

이 번호 부여는 **외부에서 들어오고 나가는 입출력 벨트가 서로 교차하지 않도록 상단·좌·우·하단 면을 각각 한 줄로 흐르게 만드는** 사전 정렬이다 — 임의로 매긴 것이 아니라 *외부 라인이 꼬이지 않게* 보존하기 위한 순서.

> 현재 구현은 footprint 를 3×3 으로 *고정* 하고 있다 — 모델 자체와는 별개의 구현 한계. 자세히는 [.known-limits §2](auto-layout-wizard.known-limits.md).

**입력/출력 분배 규칙 (외부 입력 + 외부 출력 가정):**

- 필요한 입력 슬롯 수 = `ceil(레시피 재료 가짓수 / 2)` — 벨트가 내부적으로 두 줄(lane) 이라 한 슬롯 한 벨트가 서로 다른 두 재료를 운반할 수 있음.
- 필요한 출력 슬롯 수 = `ceil(recipe_output_throughput / min(belt_throughput, inserter_throughput))`.
- 입력은 *낮은 번호부터*, 출력은 *높은 번호부터* 채운다. 빈 슬롯은 비워두며 한 면을 다 쓰지 않아도 무방 (한 면 사용 패턴은 본 모델의 제약이 아님).
- 합 (입력 + 출력) > `2(w+h)` → 본 모델로는 단일 머신 케이스 수용 불가. 별도 보고.

**O3 (보류) — 인접 머신 슬롯 공유로 인접 거리 단축.** 두 머신 사이의 출력 슬롯과 입력 슬롯이 *물리적으로 같은 셀* 을 공유하면 머신 간격이 4칸에서 1칸으로 줄어들고 사이의 인서터·belt-route 가 차감된다. 단일 머신 모델은 이 흡수가 없는 경우의 *베이스라인*. **라우팅이 안정적으로 동작한 후** 다중 머신 시나리오에서 정의 + 회전 호환 매트릭스와 함께 등록부에 본격 항목으로 승격.

### O2 — 운반체가 내부 공간을 비울 수 있을 때 지하 변형을 우선 사용

벨트 / 파이프 라우팅에서 한 구간을 **지상 (transport-belt / pipe) 으로 깔면 그 셀들이 점유되어 다른 운반체·머신 통로로 못 쓰지만**, 지하 변형 (`underground-belt` / `pipe-to-ground`) 페어로 동등한 연결이 가능하면 사이 셀이 자유 공간으로 남는다. 이때 지하 변형이 더 나은 선택이다.

비교 우선순위 (낮을수록 우선):

```
지하 변형으로 비워진 내부 셀 수에 패널티가 더 작은 라우팅
< 같은 거리의 지상 라우팅
```

즉 같은 from→to 를 잇는 두 라우팅 R₁ (일부를 지하로 우회) 와 R₂ (전구간 지상) 이 모두 feasible 일 때, 두 라우팅의 *지상 점유 셀 수* 가 더 작은 쪽이 더 나은 라우팅이다. 거리 자체의 동일성은 요구하지 않으며 — 지하 사용으로 인해 약간의 우회가 생겨도 비워지는 셀이 그 이상이면 채택.

**O1 과의 관계 — 충돌 아니라 정렬:** 같은 from→to 를 잇는 지상 후보와 지하 후보는 시작점-끝점 spread 가 같으므로 used bbox 에 미치는 영향이 같다. 지하의 점유 셀 집합은 지상의 점유 셀 집합의 subset (entrance·exit 2 셀, 사이 셀 비점유). 따라서 **O2 를 따르면 O1 도 같거나 더 좋아지며**, 두 목적이 충돌하는 후보 쌍은 본 알고리즘의 라우팅에서 자연스럽게 만들어지지 않는다.

방어선 차원에서 비교 정책은 **사전식 O1 → O2** 로 둔다 — area 가 더 작은 후보를 항상 우선, 같은 area 안에서 O2 의 지상 점유 셀 수가 더 작은 라우팅을 선택. 이 사전식 순서는 *발생하지 않는 충돌* 에 대한 방어가 아니라, 향후 다른 조건이 추가되어 라우팅이 spread 가 다른 후보를 만들기 시작하면 그때 O1 우위를 유지하기 위한 사전 명시이다.

> 신규 항목은 사용자가 지정한 시점에 본 절에 추가한다. *예고된 자리는 비워두지 않는다* — 미등록 조건은 알고리즘에 들어오지 않는다.

---

## 4. 알고리즘 구조

본 절은 **현재 코드** ([runSlotWizard.ts](../frontend/src/utils/autoLayout/runSlotWizard.ts), [slotPlacer.ts](../frontend/src/utils/autoLayout/slotPlacer.ts), [router.ts](../frontend/src/utils/autoLayout/router.ts)) 의 구조를 서술. 외부 area 단조 탐색 / 휴리스틱 / 백트랙 / 회전 후보 / 지하 변형 / fluid 라우팅은 모두 미구현.

### 단일 패스 골격

```
runSlotAutoLayoutWizard(input)
├─ 1. 레시피 트리 펼침 (expandRecipeTree)
├─ 2. 머신 수 산정 (assignMinimumCounts / assignProportionalCounts)
├─ 3. 트리 평탄화 + 머신 매핑 (flattenTree + pickMachineForRecipe)
│      └─ fluid 레시피 검사 → warning, 머신만 배치
├─ 4. primary 인서터 / 벨트 선택 (pickPrimary)
├─ 5. 슬롯 배치 (packUnitsBySlot)
│      └─ region 안에 머신을 가로로 한 줄 펴기
└─ 6. 라우팅 (collectSlotRoutes + routeBelt)
       └─ producer / consumer itemName 첫 매칭, 단일 BFS
```

§3 조건 등록부와의 대응:

| 항목 | 현재 처리 |
|---|---|
| C1 (충돌 없음) | packer 가 슬롯 좌표를 직접 계산해 충돌 없는 위치만 emit. 백트랙 없이 한 번에 결정 |
| C2 (라우팅 가능) | §4-C 의 BFS. 실패 시 `route-failed` warning |
| C3 (액체 mixing 방지) | 미구현. fluid 등장 시 §4-A 단계에서 warning 만 |
| O1 (area 최소화) | 미구현. 사용자 region 안에 들어가는지 단순 시도 |
| O2 (지하 변형 우선) | 미구현. BFS 는 4-방향 인접만 |
| O3 (인접 슬롯 공유) | 미구현 |
| T1 (첫 feasible 종료) | 단일 패스라 자동 만족 — 후보가 하나뿐 |

### 4-A. 머신 매핑 (runSlotWizard 단계 1~4)

1. `expandRecipeTree(targetRecipe, recipeMap, itemToRecipe, externalIngredients)` — 타깃에서 BFS 로 트리 펼침. cycle 은 silently external leaf.
2. 머신 수: `min` 모드는 비-external 노드별 1대, 비례 모드는 `assignProportionalCounts(tree, perTarget, ...)`.
3. `flattenTree(tree)` 의 각 비-external recipe 노드에 대해 `pickMachineForRecipe` 로 카테고리 매칭 머신 선택. fluid 가 한 번이라도 등장하면 `fluid-recipe-not-supported` warning 1회 발행. `node.machineCount` 만큼 unit 객체 push (한 unit = (노드, 머신)).
4. `pickPrimary` 로 인서터 1개 + 벨트 1개 선택 (사용자 primary 또는 selected 첫 번째).

### 4-B. 슬롯 배치 (slotPlacer.packUnitsBySlot)

상수 (현재 구현):
- `MACHINE_W = 3` — footprint 3×3 가정 ([known-limits §2](auto-layout-wizard.known-limits.md))
- `SLOT_PAD = 2` — 좌측·상단 슬롯 stub 공간
- `STEP_X = MACHINE_W + SLOT_PAD = 5` — 두 머신 origin 사이 거리

처리:
1. `curX = region.x + SLOT_PAD`, `curY = region.y + SLOT_PAD` — 모든 머신이 같은 row 에서 시작.
2. unit 배열을 *입력 순서대로* (트리 위상 정렬 없음):
   1. `curX + 5 > region 우측` 또는 `curY + 5 > region 하단` → break (영역 부족, partial-region-overflow warning).
   2. `computeSlotCountsFromUnit` 로 슬롯 수 계산:
      - `inputSlots = ceil(node.children.length / 2)`
      - `outputSlots = max(1, ceil(머신 crafting_speed / min(인서터 throughput, belt lane throughput)))`
   3. `inputSlots + outputSlots > 12` → `oversizedUnits++` 후 다음 unit 으로.
   4. 머신 footprint (3×3) 셀 emit. (0,0) 만 isOrigin, recipe 필드 부착.
   5. `slotCells(curX, curY)` 가 슬롯 1..12 좌표 반환 — 입력 슬롯 = 1..inputSlots, 출력 슬롯 = 12..(13-outputSlots).
      - 각 슬롯에 인서터 셀 + belt stub 셀 emit. direction 은 슬롯의 면 (N/E/S/W) 으로부터 자동.
   6. `curX += 5`.
3. 결과: `placed` (셀 배열), `layouts` (머신별 입출력 stub 좌표), `oversizedUnits`, `usedRegion`.

### 4-C. 라우팅 (runSlotWizard 단계 6 + router.routeBelt)

`pack.layouts.length > 1` 이고 belt 가 선택되어 있을 때만 실행.

1. `buildOccupancy(allCells)` — 모든 placed 셀을 occupancy 맵으로 변환. 4종 분류:

| Kind | 분류 기준 | 통과 (중간) | endpoint |
|---|---|---|---|
| `machine` | 인서터·벨트 외 모든 footprint | ✕ | ✕ |
| `inserter` | `EntityType.Inserter` | ✕ | ✕ |
| `belt-fixed` | `EntityType.Belt` (slotPlacer 가 깐 stub) | ✕ | ✓ |
| `belt-route` | router 가 깐 transport-belt | ✓ | ✓ |

같은 좌표 중복 시 우선순위: `machine > inserter > belt-fixed > belt-route`.

2. `collectSlotRoutes(layouts)` — 한 itemName 마다 *처음 매칭* 된 producer 의 output stub 1개만 사용. 그 좌표 → consumer 의 input stub 좌표 페어 생성. self-route skip.
3. 각 route 마다 `routeBelt({from, to, itemName, beltName}, region, occ)`:
   - 4-방향 BFS (Lee algorithm), 모든 통과 가능 셀 비용 1 (균일).
   - region 박스 안에서만 탐색.
   - `from` / `to` 가 `belt-fixed` 이므로 endpoint 통과 허용.
   - 중간 셀 통과 정책: 빈 셀 OR `belt-route` 만. `machine` / `inserter` / `belt-fixed` 는 중간 통과 불가.
   - 처음 도착 시 BFS 종료. `came` map 으로 경로 복원 후 reverse.
   - 경로 셀마다 transport-belt emit. direction = "이 셀에서 다음 셀로" 의 진행 방향. 마지막 셀은 직전 방향 유지.
   - 이미 belt-fixed/belt-route 인 셀은 reused 카운트만 증가.
   - 경로 미발견 → 해당 route 만 fail, `route-failed` warning.

### 4-D. §3 등록 항목 중 미구현

- **C3** fluid mixing 방지
- **O1** area 최소화 외부 루프
- **O2** 지하 변형 우선 — belt / pipe 양쪽
- **O3** 인접 머신 슬롯 공유
- **회전 후보 + 백트랙**
- **휴리스틱 점수화**
- **pipe kind 라우팅** + occupancy `pipe-fixed` / `pipe-route`
- **다중 producer 합류 / splitter 분기** ([known-limits §4](auto-layout-wizard.known-limits.md))
- **보일러 / 스팀엔진 / 펌프 등 비-crafting fluid 머신** — 레시피 트리 BFS 에 들어오지 않으므로 별도 확장 필요

---

## 5. 휴리스틱 (보류)

내부 루프의 후보 정렬용 — 회전 후보 / 백트랙이 도입되는 시점에 본격 도입. 현재 구현은 머신을
*가로로 나란히 배치* 하는 단순 규칙만 사용 (회전 없음, 백트랙 없음, 휴리스틱 점수 없음).

향후 도입 시 후보:
- **인접 보너스**: 운반 요구로 연결된 머신과의 Manhattan 거리 합이 작을수록 우선.
- **bbox 유지 보너스**: 현재까지 배치된 머신들의 bounding box 를 *더 늘리지 않는* 위치를 우선.
- **그리드 정렬 보너스**: 같은 row 또는 column 에 이미 머신이 있는 위치 우선.
- **회전 후보**: 4-방향 모두 시도. rᵢ 에 따라 인서터·belt stub 이 머신의 어느 면에 붙는지가 결정된다.
- **지하 점프 비용** (O2 반영): 라우팅 BFS 의 cost 함수를 "셀 점유 1 / 지하 페어 2 (사이 셀은 0)" 로 둠.

도입 시점에 가중치 결합 방식과 동점 처리 (좌→우, 상→하) 를 본 절에 명시한다.

---

## 6. 입출력 인터페이스

[WizardInput / WizardResult](../frontend/src/utils/autoLayout/types.ts).

| 필드 | 의미 |
|------|------|
| `WizardInput.region` | 배치 가능 영역 (현재는 그 안에 가로로 머신을 늘어놓는 용량 상한) |
| `WizardInput.inserterOverrides` | 인서터별 처리량/묶음 갯수 사용자 보정 ([inserterThroughput.ts](../frontend/src/utils/autoLayout/inserterThroughput.ts)) |
| `WizardInput.selectedUndergroundPipes` | 현재 라우팅에서 미사용 — pipe kind 도입 시 (M7) 점프 edge 활성화 결정 |
| `WizardResult.usedRegion` | 배치된 영역의 bounding rectangle |
| `WizardResult.placedWithCoords` | 그리드에 적용할 (x, y, GridCell) 페어 |
| `WizardWarning.code` `fluid-recipe-not-supported` | 본 모델은 fluid 미지원 — 머신만 배치, 사용자에게 알림. fluid 라우팅 (pipe kind + C3) 도입 시 삭제 |

---

## 8. 단조성 · 결정성 · 종료 · 최적성

| 속성 | 보장 정도 | 근거 |
|------|-----------|------|
| 결정성 (같은 입력 → 같은 출력) | ✓ | 난수 미사용. 후보 정렬은 안정 정렬, 동점 규칙 명시 |
| area 단조성 (큰 R 이면 더 쉬움) | 약함 (휴리스틱) | 후보 집합은 superset 이지만 같은 시간 한도에서 fail 가능 |
| 종료 | ✓ | 외부 루프가 area_max 도달 시 강제 종료. T1 으로 첫 ok 즉시 종료 |
| 최적성 (= 이론적 최소 area) | ✗ | 휴리스틱이 작은 area 를 풀지 못해도 다음 area 로 넘어감. T1 의 정의상 "발견 가능한 최소" 이지 "이론적 최소" 아님 |

> 이론적 최소를 보장하려면 같은 area 안에서 모든 (W,H) × 모든 후보를 소진해야 한다. T1 은 그 비용을 명시적으로 거부한다.

---

## 9. 새 조건이 들어올 때의 처리 절차

1. §3 조건 등록부에 항목 번호 (C3 / O2 / T2 또는 dotted 확장 C2.1 등) 와 한 줄 정의 추가.
2. 그 조건이 **외부 루프 / 내부 루프 / 라우팅** 중 어느 단계에 들어가는지 §4 에 명시.
3. 휴리스틱이 새 조건을 반영해야 하면 §5 갱신.
4. 등록부 외 자리에서 *암묵적으로 가정되는* 조건은 채택하지 않는다.

