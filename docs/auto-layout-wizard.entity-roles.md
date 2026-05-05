# 자동완성 위저드 — 엔티티 역할 4분류

> **부모 문서:** [auto-layout-wizard.md](auto-layout-wizard.md) — 위저드 인터페이스
> **관련 문서:** [.placement-search](auto-layout-wizard.placement-search.md), [.known-limits](auto-layout-wizard.known-limits.md)

자동완성 위저드가 그리드에 깔아내는 엔티티는 작동 방식 측면에서 **4가지 역할**로 나뉜다.
이 4가지는 placer / router 가 채워야 할 자리를 결정하는 골격이며,
**이 4가지에 속하지 않는 엔티티(heat-pipe / electric-pole / rail / beacon 등) 는 자동완성의 관심사 바깥**이다 —
수동으로 코드/문서를 확장해 5번째 역할을 명시하기 전까지 위저드는 후보로도 노출하지 않고
placer 입력으로도 받지 않는다.

> ⚠ **모델 재설계 진행 중** — 본 문서의 "둘레 슬롯" 어휘는 *구 둘레 슬롯 모델* 시점의 표현. 새 컨테이너 모델 ([.placement-search](auto-layout-wizard.placement-search.md)) 에서는 *컨테이너 port* 로 명명이 바뀌고, **무한상자·무한파이프** 가 컨테이너의 일종으로 추가된다 (외부 영역 I/O). 본 문서는 새 모델 도입이 끝나면 용어를 일괄 정렬한다.

---

## 한 장으로 보기

| 역할 | 대표 type | placer 위치 | router occupancy | 미구현 |
|------|-----------|-------------|------------------|--------|
| **A. 변환기** | `assembling-machine`, `furnace`, `rocket-silo`, `lab`, `mining-drill` … | 머신 origin (curX, curY) + N×M 머신 footprint | `machine` (통과 불가) | 다양한 footprint / 회전 ([known-limits §2](auto-layout-wizard.known-limits.md)) |
| **B. 핸드오프** | `inserter` 와 변형, `loader`, `loader-1x1` | 둘레 슬롯 중 입력/출력 슬롯의 *머신 인접 1셀* | `inserter` (통과 불가) | 머신 수 산정에 throughput 미반영 ([§8](auto-layout-wizard.known-limits.md)), loader 미사용 |
| **C. 고체 운반** | `transport-belt`, `underground-belt`, `splitter` | 둘레 슬롯 중 입력/출력 슬롯의 *머신 바깥 1셀* (stub) + router 가 깐 belt-route 경로 | `belt-fixed` (stub), `belt-route` (라우팅) | splitter 자동 분기 ([§4](auto-layout-wizard.known-limits.md)), underground 자동 점프 ([§5](auto-layout-wizard.known-limits.md)) |
| **D. 액체 운반** | `pipe`, `pipe-to-ground`, `pump` | (M7) 머신 회전별 fluid_boxes positions 에서 파생 | (M7) `pipe-fixed`, `pipe-route` | M7 통과 전까지 emit 없음 ([§1](auto-layout-wizard.known-limits.md)) |

`occupancy` 분류는 router 의 통과 정책 그 자체이며 [router.ts](../frontend/src/utils/autoLayout/router.ts) 에 정의되어 있다.

---

## A. 변환기 (조립기계 그룹)

위저드 2단계에서 사용자가 고르는 "조립기계" 의 실체. 단순 `assembling-machine` 뿐 아니라 **레시피를
처리하는 모든 머신** 이 같은 역할을 수행한다 — 화로 / 채굴기 / 로켓사일로 / 연구실도 같은 자리.

- 입력 재료(item / fluid) 를 받아 레시피에 따라 산출물 생성. **직접 운반 능력 없음** — 인서터·벨트·파이프가 따로 붙어야 입출력이 된다.
- 머신마다 footprint 가 다르다: 조립기 3×3, 화로 3×3, 보일러 3×2, 로켓사일로 9×9.
- `crafting_speed × (1 / energy_required)` 로 초당 처리량이 결정된다.
- 고체 입출력은 측면 아무 셀에서나 인서터로 가능. 액체 입출력은 `fluid_boxes[].connections[].positions` 에 정의된 **고정 셀** 에서만.

**현재 알고리즘:** 둘레 슬롯 모델 자체는 임의 footprint 를 가정한 일반 규칙이지만, 현재 구현은 머신 footprint 를 3×3 으로 가정하고 회전 0 (북쪽) 으로 고정한다. 다른 footprint / 회전은 [known-limits §2](auto-layout-wizard.known-limits.md).

---

## B. 핸드오프 (투입기 / 로더)

머신과 운반체(벨트·체스트·다른 머신) 사이를 잇는 다리. 자체적으로는 거의 이동하지 않지만, 머신이
운반체와 떨어져 있으면 항상 이 역할의 엔티티가 끼어 있어야 한다.

- **inserter** (1×1): direction 이 "픽업 → 드랍" 을 가리키며, 자기 양옆 1칸씩 두 셀에 닿아 운반.
- 변형: `long-handed-inserter` (2칸 사거리), `fast-inserter`, `bulk-inserter` (한 번에 여러 개).
- **loader / loader-1x1**: 머신/체스트의 한 면에 붙으면 인서터 없이 자동 적재/배출. 인서터 + 짧은 벨트의 융합.
- throughput 은 `rotation_speed × stack_size` 로 결정. 인서터 처리량 모델은 [inserterThroughput.ts](../frontend/src/utils/autoLayout/inserterThroughput.ts) 참조 — 사용자 override 우선.

**현재 알고리즘:** 둘레 슬롯 중 사용 슬롯의 머신 인접 셀에 인서터 emit. direction 은 슬롯의 면에 따라
입력(벨트→머신) / 출력(머신→벨트) 의 두 종류로 자동 결정.

---

## C. 고체 운반 (벨트)

머신끼리 item 을 흘려 보내는 동맥. router 가 실제로 깔아내는 거의 유일한 운반체.

- **transport-belt** (1×1): 한 방향, 좌/우 두 줄(lane) 을 같은 방향으로 흘림. tick 당 일정량 이동.
- **underground-belt** (1×1 두 개): 입구·출구 페어. 사이는 다른 entity 가 통과 가능.
- **splitter** (2×1): 두 입력 → 두 출력. 분배 / 우선순위 / 필터 가능.
- 진행 방향 = `direction` 필드. 라인 합류는 splitter 또는 측면 합류로만.

**두 lane 의 의미:** 한 belt-route 셀은 서로 다른 두 item 까지 동시 운반 가능. 이는 router 의 belt-route
통과 정책 (item 종류 무관 통과) 에 반영되며, 둘레 슬롯 모델의 입력 슬롯 수가 `ceil(재료 가짓수 / 2)` 인
이유이기도 하다. 셀당 ≤ 2 종류 상한은 [.placement-search §3 C2.1](auto-layout-wizard.placement-search.md)
에 보류 자리로 등록.

**현재 알고리즘:** 둘레 슬롯 중 사용 슬롯의 머신 바깥 셀에 belt stub emit (occupancy `belt-fixed`).
머신 사이는 router 가 Lee BFS 로 belt-route 를 깐다 (occupancy `belt-route`, 통과 자유).

---

## D. 액체 운반 (파이프)

벨트의 fluid 버전. **현재 위저드 알고리즘은 이 역할을 전혀 다루지 않는다.**

- **pipe** (1×1): 인접한 fluid_box 와 **자동으로** 연결. direction 의미 없음.
- **pipe-to-ground** (1×1 두 개): underground-belt 와 동일 패턴.
- **pump** (1×2): 한 방향으로만 흐름, 압력 boost. 파이프 네트워크의 분리·역류 방지에 사용.
- **fluid mixing 금지** — 같은 네트워크에 다른 액체가 섞이면 머신 동작 정지.
- **머신 fluid_box 위치는 회전별 고정** — `entity.fluid_boxes[].connections[].positions` 가 4-방향 회전마다 다른 좌표 정의.

**현재 코드:** emit 없음. `recipeHasFluid` 가 true 인 레시피를 만나면 `fluid-recipe-not-supported`
warning 만 발행하고 머신만 배치한다. 사용자가 위저드 5단계에서 underground pipe 를 골라도 결과
placement 에 반영되지 않는다.

**도입 경로 (M7):** [.placement-search M7](auto-layout-wizard.placement-search.md) — 운반 요구 E 에
`kind ∈ {belt, pipe}` 추가, occupancy `pipe-fixed` / `pipe-route` 분류 + fluid 이름 태깅 (C3 mixing 방지).

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
