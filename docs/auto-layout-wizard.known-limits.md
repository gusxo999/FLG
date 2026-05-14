# 자동완성 위저드 — 알려진 약점 및 한계

> **부모 문서:** [auto-layout-wizard.md](auto-layout-wizard.md) — 위저드 인터페이스
> **관련 문서:** [.placement-search](auto-layout-wizard.placement-search.md), [.entity-roles](auto-layout-wizard.entity-roles.md), [.control-behavior-scope](auto-layout-wizard.control-behavior-scope.md)

본 문서는 위저드의 **현재 구현물이 제공하지 못하는 것** 을 정확히 기록해 사용자/개발자 모두가
기대치를 맞추기 위한 참조 문서다. 각 항목에는 (1) 증상, (2) 원인, (3) 해결 방향, (4) 우선순위를 기록한다.

> 우선순위 표기: **P0** 다음 마일스톤 / **P1** 베타 진입 전 / **P2** 정상 동작 시 개선 / **P3** 장기 백로그
> 항목이 해결되면 해당 섹션은 삭제하고 우선순위 표만 갱신한다.

> ⚠ **모델 재설계 진행 중** — 본 문서는 *구 둘레 슬롯 모델* 시점의 한계 목록이다. 다수 항목이 새 컨테이너 모델 ([.placement-search](auto-layout-wizard.placement-search.md)) 에서 자동 해소되거나 *비-목표* 로 재분류된다. 상세 매핑은 .placement-search §12 (흡수/폐기) 와 §13 (비-목표/보류). 새 모델 도입이 끝나면 본 문서는 새 모델 기준으로 전면 갱신된다.

---

## 1. 유체(Fluid) 레시피 미지원

**우선순위: P0**

**증상:**
- 화학 공장(petroleum gas + water → sulfur 등) / 정유소(oil processing) 시나리오에서 머신만 배치되고 파이프는 깔리지 않음.
- `recipeHasFluid` 체크에 걸린 레시피 노드에 대해 `fluid-recipe-not-supported` warning 만 표시.

**원인 (현재 코드):**
- 둘레 슬롯 모델은 입출력 셀을 인서터 + belt stub 로만 다룸. 액체는 인서터가 아니라 fluid_box 위치(머신 측면 특정 셀) 에 직접 파이프가 닿아야 함.
- entity 의 `fluid_boxes[].connections[].positions` 는 4-방향 회전별 좌표로 제공되지만 ([gameDataStore.ts](../frontend/src/store/gameDataStore.ts) 참조) slotPlacer 가 이 정보를 사용하지 않음.

**해결 경로:**
[auto-layout-wizard.placement-search.md](auto-layout-wizard.placement-search.md) M7 — 운반 요구 E 에 `kind ∈ {belt, pipe}` 추가, occupancy 에 `pipe-fixed` / `pipe-route` 분류 + fluid 이름 태깅 (C3 mixing 방지). M7 통과 시 본 절 삭제.

**본 항목이 자동으로 흡수하지 *않는* 잔여 항목:**
- **보일러 / 스팀엔진 / 펌프 등 비-crafting fluid 머신** — 레시피 트리 BFS 에 등장하지 않으므로 본 설계의 입력 M 에 자연스럽게 포함되지 않음. 별도 known-limits 항목으로 분리 예정 (M7 통과 시점에 본 절 삭제와 함께 신규 항목 등록).
- **펌프의 direction 의미** — placement-search 가 pipe direction = 0 으로 고정. 펌프 자동 배치를 다루는 시점에 별도 항목.

---

## 2. 머신 footprint 3×3 외 / 회전 / 다양한 배치 패턴 미지원

**우선순위: P0**

**원인 (항목의 본질):**
M1 단계의 둘레 슬롯 모델 *자체* 는 임의 footprint 의 머신을 둘레 `2(w+h)` 슬롯으로 다루는 일반 규칙이지만,
**현재 구현** 은 footprint 를 **3×3 고정**, 회전을 **0 (북쪽)** 으로 가정하고 머신을 **가로로 나란히** 배치한다.
머신의 (x, y, r) 자체를 결정 변수로 풀지 않음. 즉 본 한계는 *모델의 한계가 아니라 구현의 특수화*.

**이로 인해 발생하는 증상 (모두 같은 원인):**
- 머신 footprint 가 3×3 가 아닌 케이스 (보일러 3×2, 로켓사일로 9×9 등) 표현 불가.
- region 가 좁고 높은 세로형이면 머신 1개만 배치되고 나머지는 영역 부족.
- 머신을 회전 배치하는 사용자 의도 표현 자체가 불가.
- 메인 버스 합류 / 좌우에서 동시 입력받는 변형된 배치 패턴 표현 불가.

**해결 방향:**
[auto-layout-wizard.placement-search.md](auto-layout-wizard.placement-search.md) M3 — 회전 후보 +
백트랙 도입. 머신 (x, y, r) 을 결정 변수로 풀고 휴리스틱 §5 가 후보 정렬. M2 (외부 area 단조
탐색) 가 먼저 들어와야 의미 있으므로 마일스톤 순서는 M2 → M3.

**메타:** 머신 footprint 다양화 / 회전 / 비-격자 배치는 *같은 원인 (결정 변수 미해방) 의 다른
증상* 이므로 한 항목으로 묶는다. 한 증상만 풀어도 다른 증상은 그대로 남기 때문.

---

## 3. 첫 매칭 머신만 사용

**우선순위: P2**

**증상:**
- 사용자가 조립기 1·2·3 모두 체크해도 카테고리에 매칭되는 첫 머신만 모든 unit 에 사용됨.
- "후반 레시피만 조립기3, 단순 라인은 조립기1" 같은 의도 표현 불가.

**원인:**
- `pickMachineForRecipe` 가 `crafting_categories.includes(recipe.category)` 로 first-match.
- 사용자에게 우선순위/매핑 UI 없음.

**해결 방향:**
1. 머신 선택 단계에서 사용자가 명시적 우선순위 (drag-reorder) 또는 레시피별 매핑 가능하게 UI 확장.
2. 기본 정렬: `crafting_speed` 내림차순 (가장 빠른 머신 우선).
3. allowed/forbidden 토글 (예: 일부 레시피는 화로에서만, 일부는 조립기에서만).

---

## 4. 다중 자식 합류 / 분기 미구현

**우선순위: P1**

**증상:**
- 같은 ingredient 를 여러 부모가 요청하거나, 같은 부모가 여러 자식의 출력을 받아야 할 때 한 belt 위로만 흐르며 splitter / underground 분기 없음.
- 예: 강철 라인에서 철판이 코크스용·자체용 두 곳에 필요해도 한 belt 가 그 위치를 지나치며 첫 unit 에서만 받음.

**원인:**
- `collectRoutes` 가 `producerByItem` 의 첫 매칭만 사용.
- router 가 belt-route 위 통과는 허용하지만 splitter 삽입 / 분기 인식 없음.

**해결 방향:**
1. `producerByItem` 을 `producerByItem: Map<itemName, UnitLayout[]>` 로 확장.
2. 처리량 모드일 때 자식의 product/sec 합 ≥ 부모 ingredient/sec 합 이면 OK, 아니면 throughput 부족 warning.
3. 한 itemName 의 belt 가 여러 source 에서 합류해야 하면 splitter 자동 삽입 (entityType=Splitter, 2×1).
4. underground belt: 장애물 회피 시 router 가 `pipe-to-ground` 변형으로 삽입 (다음 항목 참조).

---

## 6. region 좌표가 캔버스 선택과 분리됨

**우선순위: P2**

**증상:**
- 사용자가 캔버스에서 영역을 드래그 선택해도 위저드의 region 입력에 반영되지 않음.
- 좌표 4개를 폼에 직접 입력해야 함 → UX 마찰.

**원인:**
- `layoutStore.selection` 은 다중 선택용. 위저드용 region 별도 트리거 없음.

**해결 방향:**
1. 위저드 6단계에 "캔버스에서 영역 선택" 버튼 활성화 (현재 disabled).
2. 클릭 시 모달을 임시 hide → 캔버스에 region selector 모드 진입 → 선택 완료 시 모달 복귀 + 좌표 자동 입력.
3. layoutStore 에 `regionPick: { active, onComplete }` 임시 상태 추가.

---

## 7. 충돌 검사 없이 덮어쓰기

**우선순위: P0**

**증상:**
- `applyPlacedCells` 가 좌표 위 기존 셀을 무조건 덮어쓰기 → 사용자의 기존 배치가 사라질 수 있음.
- 사용자에게 경고 없이 데이터 손실.

**원인:**
- [layoutStore.ts](../frontend/src/store/layoutStore.ts) 의 `applyPlacedCells` 가 단순 인덱스 write.
- `placeEntity` 의 점유 검사 / 같은 카테고리 덮어쓰기 정책 미적용.

**해결 방향:**
1. `applyPlacedCells` 에 `mode: 'overwrite' | 'skip-occupied' | 'abort-on-conflict'` 추가, 기본값은 `'skip-occupied'`.
2. 위저드의 review 단계에서 "이 영역에 이미 N개 셀이 점유되어 있습니다 — 덮어쓸까요?" 확인 토스트.
3. `runAutoLayoutWizard` 에 `obstacles: ReadonlySet<string>` 입력 추가 → router/packer 가 점유 셀을 회피.

---

## 8. inserter throughput 이 머신 수 산정에 미반영

**우선순위: P3**

**증상:**
- 인서터 처리량 (사용자 override 또는 묶음 갯수 자동 계산) 은 둘레 슬롯 모델의 *출력 슬롯 수* 산정에는
  반영되지만, "사용자 지정" 모드의 머신 *대수* 산정에는 영향 없음.
- 결과적으로 인서터가 bottleneck 인 라인에서도 머신만 늘어남.

**원인:**
- `assignProportionalCounts` 는 머신의 `crafting_speed × product_amount` 만 사용. 인서터 throughput bottleneck 무시.

**해결 방향:**
1. `assignProportionalCounts` 가 inserter effective rate 도 입력으로 받아 `min(machine, inserter)` 를 effective rate 로 사용.
2. UI 의 인서터 처리량 override 가 자동으로 머신 수 산정에도 흘러가도록 deps 연결.

**부분 해소:**
- 출력 슬롯 수 산정은 [inserterThroughput.ts](../frontend/src/utils/autoLayout/inserterThroughput.ts) + UI override 로 이미 반영됨 — 본 항목은 *머신 수* 산정에 한정.

---

## 9. 카테고리 매칭 한계 — 동일 레시피의 여러 머신

**우선순위: P3**

**증상:**
- "rocket-silo 의 카테고리 == 'rocket-building'" 같이 한 카테고리에 한 머신만 있는 경우는 OK.
- 그러나 모드(추가 컨텐츠) 에서 한 카테고리에 여러 머신이 들어가면 첫 매칭이 항상 가장 빠르거나 가장 적절하다는 보장 없음.

**원인:** §3 와 동일.

**해결 방향:** §3 와 함께 처리.

---

## 10. 사이클 / 자기참조 처리

**우선순위: P3**

**증상:**
- 트리 BFS 중 ancestors set 으로 cycle 차단 → 해당 ingredient 가 silently external leaf 로 표시.
- 사용자는 "내가 외부 공급으로 토글했나? 아니면 cycle 이라 자동 leaf 로 처리되었나?" 구분 불가.

**원인:**
- `RecipeTreeNode.external = true` 만 표기, cycle reason 보존 안 함.

**해결 방향:**
1. `RecipeTreeNode.externalReason: 'user' | 'cycle' | 'no-recipe' | 'depth-limit'` 추가.
2. UI 트리에서 reason 별 다른 라벨/툴팁 표시.

---

## 11. 단일 시점 트리 펼침 — 깊이 제한 없음

**우선순위: P3**

**증상:**
- "복잡한 레시피 (예: utility-science-pack)" 선택 시 트리가 수십 노드로 펼쳐져 UI 가 무거워짐.
- BFS 가 모든 비-cycle 노드를 펼침.

**원인:**
- depth limit 없음.

**해결 방향:**
1. `expandRecipeTree` 에 `maxDepth` 파라미터 추가 (기본 6 등).
2. 깊이 초과 노드는 `externalReason: 'depth-limit'` 으로 leaf 처리.
3. UI 에서 "더 펼치기" 버튼 제공.

---

## 12. 자동 체크 규칙의 일관성

**우선순위: P3**

**증상:**
- `expandSelectionByPrereq` 는 "선택된 후보의 prereq closure 안에서 unlock 되는 같은 type 후보를 자동 체크" 한다.
- 그러나 사용자가 후반 후보를 체크 후 다시 해제했을 때, 전에 자동 체크된 후보들은 남아있음 (해제 안 됨).

**원인:**
- 자동 체크는 단방향 (선택 시 추가만). 해제 시 reverse closure 미적용.

**해결 방향:**
1. 사용자 의도가 모호 — "내가 빼고 싶은 건 후반만? 아니면 전체?"
2. 옵션 A: 명시적 "이 체인 모두 해제" 버튼.
3. 옵션 B: closure 자동 적용을 끄는 토글 ("manual mode").

---

## 13. 폼 입력만의 region 크기 검증 부족

**우선순위: P3**

**증상:**
- region.w < 5 또는 region.h < 7 이면 unit 0개 배치되지만 명시적 에러 없음 (partial-overflow warning 만).
- 사용자는 왜 0개인지 짐작해야 함.

**해결 방향:**
1. region 입력 단계에서 최소 unit 사이즈 5×7 hint 표시.
2. region.w 또는 region.h 가 부족하면 별도 warning code.

---

## 14. 동일 시드에서 결정성 미검증

**우선순위: P3**

**증상:**
- placer/router 모두 결정적이라고 주장하지만 fuzz test 없음.

**원인:** 단위 테스트 미작성.

**해결 방향:**
1. `frontend/src/utils/autoLayout/__tests__/` 추가.
2. (입력 → 출력) snapshot 기반 회귀 테스트.

---

## 우선순위 별 정리

| 우선순위 | 항목 |
|----------|------|
| **P0** | §1 fluid 미지원 / §2 unit shape 단일 (인서터 N/S 고정) / §7 충돌 검사 없음 |
| **P1** | §4 다중 합류 |
| **P2** | §3 첫 매칭 머신 / §6 캔버스 region picker |
| **P3** | §8 stack-size, §9 카테고리, §10 cycle reason, §11 depth limit, §12 자동 체크 해제, §13 region 검증, §14 결정성 테스트 |
