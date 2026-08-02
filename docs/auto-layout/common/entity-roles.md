---
tags: [auto-layout, routing]
---

# 자동완성 위저드 — 엔티티 역할 4분류

> **독립 문서** — 위저드 밖(라우팅·블루프린트·유체)에서도 참조하므로 `auto-layout-wizard.` 접두어를 떼었다.
> **주 소비처:** [auto-layout-wizard.md](../wizard.md) · [.placement-search](placement-search.md) · [.known-limits](known-limits.md) · [pipe-semantics](../../factorio/pipe-semantics.md)

자동완성 [[용어사전#위저드 (wizard)|위저드]]가 그리드에 깔아내는 엔티티는 작동 방식 측면에서 **[[용어사전#엔티티 4역할|4가지 역할]]**로 나뉜다.
이 4가지는 placer / router 가 채워야 할 자리를 결정하는 골격이며,
**이 4가지에 속하지 않는 엔티티(heat-pipe / electric-pole / rail / beacon 등) 는 자동완성의 관심사 바깥**이다 —
수동으로 코드/문서를 확장해 5번째 역할을 명시하기 전까지 위저드는 후보로도 노출하지 않고
placer 입력으로도 받지 않는다.

---

## 한 장으로 보기

| 역할 | 대표 type | placer 위치 | router occupancy | 남은 한계 |
|------|-----------|-------------|------------------|--------|
| **A. [[용어사전#변환기|변환기]]** | `assembling-machine`, `furnace`, `rocket-silo`, `lab`, `mining-drill` … | 머신 origin + `tile_width×tile_height` footprint (가변) | `machine` (통과 불가) | 회전 0 고정 ([known-limits §6](known-limits.md)); [[용어사전#EntityType|EntityType]] 단순화(전부 Assembler) |
| **B. [[용어사전#핸드오프|핸드오프]]** | `inserter` 와 변형, `loader` | 머신 면 셀(seat)에 인서터 1셀, direction=픽업 방향 | `inserter` (통과 불가) | 머신 수 산정에 [[용어사전#처리량 (throughput)|throughput]] 미반영 ([§8](known-limits.md)), loader 미사용 |
| **C. [[용어사전#고체 운반|고체 운반]]** | `transport-belt`, `underground-belt`, `splitter` | router([[용어사전#Dijkstra|Dijkstra]])가 깐 belt + 지하벨트 점프 경로 | 모든 belt 셀 통과 불가([[용어사전#mixing|mixing]] 미구현) | belt/pipe mixing ([§5](known-limits.md)), splitter 자동 분기 미사용 |
| **D. [[용어사전#액체 운반|액체 운반]]** | `pipe`, `pipe-to-ground`, `pump` | 머신 `fluid_boxes` 연결 칸(면은 `PipeConnection.direction`) + [트렁크 파이프](../module/trunk-pipe.md) 기둥 / 옛 경로는 Dijkstra | 모든 pipe 셀 통과 불가 + [합류 가드](../../factorio/pipe-semantics.md#5-잘못-이어지면-조용하다--그래서-가드가-필요하다) 금지 칸 | pump 자동배치 미사용 |

---

## A. 변환기 (조립기계 그룹)

위저드 2단계에서 사용자가 고르는 "조립기계" 의 실체. 단순 `assembling-machine` 뿐 아니라 **레시피를
처리하는 모든 머신** 이 같은 역할을 수행한다 — 화로 / 채굴기 / 로켓사일로 / 연구실도 같은 자리.

- 입력 재료(item / fluid) 를 받아 레시피에 따라 산출물 생성. **직접 운반 능력 없음** — 인서터·벨트·파이프가 따로 붙어야 입출력이 된다.
- 머신마다 footprint 가 다르다: 조립기 3×3, 화로 3×3, 보일러 3×2, 로켓사일로 9×9.
- `crafting_speed × (1 / energy_required)` 로 초당 처리량이 결정된다.
- 고체 입출력은 측면 아무 셀에서나 인서터로 가능. 액체 입출력은 `fluid_boxes[].connections[].positions` 에 정의된 **고정 셀** 에서만.

**현재 알고리즘:** 머신 footprint 는 `tile_width × tile_height` 를 그대로 써 **가변 지원**(보일러 3×2, 사일로 9×9 등도 배치)되지만, **회전은 0(북쪽) 고정**이다. 회전·fluidbox 면 제약은 [known-limits §6](known-limits.md). 단, 모든 변환기는 렌더 `EntityType` 이 Assembler 로 단순 매핑된다([machinePlacer.ts](../../../frontend/src/utils/autoLayout/execution/machinePlacer.ts) `machineEntityType`).

---

## B. 핸드오프 (투입기 / 로더)

머신과 운반체(벨트·체스트·다른 머신) 사이를 잇는 다리. 자체적으로는 거의 이동하지 않지만, 머신이
운반체와 떨어져 있으면 항상 이 역할의 엔티티가 끼어 있어야 한다.

- **inserter** (1×1): direction 이 "픽업 → 드랍" 을 가리키며, 자기 양옆 1칸씩 두 셀에 닿아 운반.
- 변형: `long-handed-inserter` (2칸 사거리), `fast-inserter`, `bulk-inserter` (한 번에 여러 개).
- **[[용어사전#loader (로더)|loader]] / loader-1x1**: 머신/체스트의 한 면에 붙으면 인서터 없이 자동 적재/배출. 인서터 + 짧은 벨트의 융합.
- throughput 은 `rotation_speed × stack_size` 로 결정. 인서터 처리량 모델은 [inserterThroughput.ts](../../../frontend/src/utils/autoLayout/inserterThroughput.ts) 참조 — 사용자 override 우선.

---

## C. 고체 운반 (벨트)

머신끼리 item 을 흘려 보내는 동맥. router 가 실제로 깔아내는 거의 유일한 운반체.

- **transport-belt** (1×1): 한 방향, 좌/우 두 줄([[용어사전#레인 (lane)|lane]]) 을 같은 방향으로 흘림. tick 당 일정량 이동.
- **underground-belt** (1×1 두 개): 입구·출구 페어. 사이는 다른 entity 가 통과 가능.
- **[[용어사전#splitter|splitter]]** (2×1): 두 입력 → 두 출력. 분배 / 우선순위 / 필터 가능.
- 진행 방향 = `direction` 필드. 라인 합류는 splitter 또는 측면 합류로만.

**두 lane 의 의미:** 게임상 한 belt 는 좌/우 두 lane 으로 서로 다른 두 item 까지 동시 운반 가능하다. **현재 router 는 이를 활용하지 않는다** — occupancy 가 모든 belt 셀을 통과 불가로 처리해 라우팅끼리 벨트를 공유하지 못한다(belt mixing 미구현, [known-limits §5](known-limits.md)). 한 라우팅 = 한 컨테이너 = 한 belt 줄.

**벨트 연결 = 타일 겹침 + [[용어사전#흐름-인접 (flow adjacency)|흐름-인접]] 둘 다.** 게임에서 두 벨트는 **같은 타일을 공유할 때만** 이어지는 게
아니다 — *한 벨트의 지표 출력이 옆 타일의 벨트로 떨어지면* 타일을 공유하지 않아도 물리적으로 이어진다
(직진 투입 / [[용어사전#side-load|side-load]]). 지하벨트 **출구**도 진행 방향 앞 칸의 벨트로 토출하므로 같다(지하벨트 **입구**는
터널로 들어가 지표 출력이 없다). 라우팅마다 독립 아이템 스트림이므로 이 흐름-인접 연결은 **항상 의도치
않은 오염**이다. 따라서 [[용어사전#occupancy|occupancy]] 의 "타일 배타성"(겹침 금지)만으로는 부족하고, 그 **경계 버전**이 필요하다:

> **서로 다른 라우팅의 벨트 셀은 흐름 방향으로 인접해선 안 된다** — 내 벨트의 출력 칸이 외부 벨트
> 타일이 되거나, 외부 벨트의 출력 칸 위에 내 벨트가 놓여선 안 된다.

이 불변식은 [containerRouting.ts](../../../frontend/src/utils/autoLayout/planner/containerRouting.ts) 의 [[용어사전#collectBeltFlow|`collectBeltFlow`]]
(이미 배치된 벨트의 타일 + 지표 출력 칸 수집) + `dijkstraWithJumps` 의 lazy-constraint 가드
(`beltFlowConflictCell` — 합류하는 셀을 `blocked` 에 넣고 재탐색)로 강제된다. 트렁크 방출도
외부 벨트의 출력 칸을 occupancy 에 더해 그 위에 트렁크 벨트를 놓지 않는다. 어느 패스가 먼저
깔리든 **나중에 깔리는 쪽**이 이미 배치된 벨트를 보고 우회하므로 순서와 무관하게 성립한다.

> **참고(파이프):** D 의 파이프는 방향과 무관하게 4면 인접이면 자동 연결되므로 이 흐름-인접 모델이
> 아니라 **인접 자체**가 합류다. 그 무방향 버전의 가드가 [`collectPipeFlow`](../../../frontend/src/utils/autoLayout/util/pipeFlow.ts)
> 다(2026-07-14 구현, 새 모듈 경로 한정). 벨트와의 차이 전부는 [pipe-semantics](../../factorio/pipe-semantics.md).

---

## D. 액체 운반 (파이프)

**벨트의 fluid 버전이 아니다.** 규칙이 근본적으로 다르고 그 차이가 배치의 거의 모든 선택을 바꾼다 —
전부는 **[pipe-semantics](../../factorio/pipe-semantics.md)** 에 있다(벨트와 항목별로 대조). 요약:

- **pipe** (1×1): **방향이 없다**(0 고정). 직교로 닿으면 **무조건** 한 관망이 된다.
- **처리량 무한**(우리 모델의 결정) → 유체판 `determineBeltCount` 가 없고, **같은 유체 합류는 무해**하다.
- 파이프는 머신 벽 아무 데나가 아니라 **유체 상자의 연결 칸**에만 붙는다 → 유체 줄의 면은 우리가 고르는
  게 아니라 머신이 정한다. 그래서 **머신을 돌린다**([fluidPorts.chooseMachineDirection](../../../frontend/src/utils/autoLayout/module/fluidPorts.ts)).
  그 칸이 어디인지는 좌표가 아니라 `PipeConnection.direction` 이 답한다 → [fluid-box-semantics](../../factorio/fluid-box-semantics.md).
- **pipe-to-ground** (1×1 두 개): prototype 무관 **전부** 간섭(벨트와 다르다) → 단일 blockGroup.
- **[[용어사전#pump (펌프)|pump]]** (1×2): **자동 배치 미사용**.
- **합류 가드**: [`collectPipeFlow` / `PipeFlow`](../../../frontend/src/utils/autoLayout/util/pipeFlow.ts) — 다른 유체
  파이프의 사방 + 머신 유체 상자의 연결 칸. 새 모듈 경로(트렁크·반출)에만 걸려 있다.

### 본 역할이 자동으로 흡수하지 *않는* 인접 항목

- **boiler / steam-engine / pump 등 비-crafting fluid 머신** — 레시피 트리에 등장하지 않으므로 본 설계의
  입력 머신 집합 M 에 들어오지 않는다. 별도 명시적 확장이 필요. heat 라인을 함께 끌어들일 경우
  5번째 역할 "열 전달" 까지 검토.
- **펌프의 direction 의미** — pipe direction 은 항상 0 으로 고정한다. 펌프 자동 배치를 다루기 시작하는
  시점에 별도 known-limits 항목으로 등록.

---

## 4가지 외 엔티티 — 자동완성 범위 밖

다음 엔티티들은 게임 내에서 운반/처리 역할을 하긴 하지만, **현재 위저드의 4분류 어디에도 들어가지
않는다.** 추가하려면 이 문서에 새 역할을 정의하고 placer/router 코드를 명시적으로 확장해야 한다 —
"비슷하니까 자동으로 흡수될 것" 이라는 가정은 하지 않는다.

| 엔티티 | 게임 내 역할 | 자동완성에 포함되지 않은 이유 |
|--------|---------------|--------------------------------|
| `heat-pipe` | 원자로 → 열교환기 사이 열 전달 | 액체도 아이템도 아니라 D 파이프 로직과 통합 불가. 별도 occupancy / 라우팅 정책 필요 |
| `electric-pole` | 전력 송출 | 운반체가 아니라 wireless coverage. 거리 기반 자동 배치 알고리즘 필요 |
| `straight-rail` / `curved-rail` / `train-stop` | 기차 운송 | 곡선·교차 라우팅 / 신호 / 스케줄까지 별도 영역 |
| `beacon` | 인근 머신 효과 부여 | 운반/처리 어느 쪽도 아님. 모듈 시스템과 함께 별도 단계 |
| `chest` 류 | 버퍼 / 패시브 저장 | 라인의 능동 운반체가 아니라 placer 가 자동으로 끼워 넣을 자리가 없음 |

이 표는 "안 다룬다" 는 사실의 기록이지, 향후 어디에 끼워 넣을지의 청사진이 아니다.
