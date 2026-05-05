# 레이아웃 자동완성 — 위저드 인터페이스 (parent)

**상태:** UI 골격 + *구 둘레 슬롯 모델* 기반 배치 알고리즘 코드가 부분 작성되어 있으나 **모델 재설계 진행 중**. 새 모델 = **컨테이너 모델** ([auto-layout-wizard.placement-search.md](auto-layout-wizard.placement-search.md)). 현재 코드는 새 모델로 단계적 (타입 → 모듈 스켈레톤 → 구현) 교체 예정.

이 문서는 **자동완성 위저드 기능의 부모 문서**다. 위저드는 여러 하위 기능(트리 펼침, 머신 수 산정,
컨테이너 배치, 라우팅 등)이 단일 UI 흐름 안에 합쳐진 복합 기능이며, 각 하위 기능의 상세는 하위
문서로 분리되어 있다.

## 관련 문서 (이 위저드의 하위)

| 문서 | 주제 |
|------|------|
| [auto-layout-wizard.placement-search.md](auto-layout-wizard.placement-search.md) | ↳ **알고리즘 단일 출처** — 컨테이너 모델 + 조건 등록부 (C/O/M 항목) |
| [auto-layout-wizard.entity-roles.md](auto-layout-wizard.entity-roles.md) | ↳ 위저드가 다루는 엔티티 4분류 (변환기 / 핸드오프 / 고체운반 / 액체운반) |
| [auto-layout-wizard.known-limits.md](auto-layout-wizard.known-limits.md) | ↳ 알려진 한계 + 우선순위(P0~P3) |
| [auto-layout-wizard.control-behavior-scope.md](auto-layout-wizard.control-behavior-scope.md) | ↳ 위저드가 추적하는 ControlBehavior 필드 범위 |

---

## 한 줄 요약

사용자가 (1) 만들 레시피와 (2) 사용할 엔티티 군을 단일 흐름의 위저드로 선택하면, 시스템이 필요한 머신 수를
자동 산출하고 그리드에 직접 배치한다.

레시피 + 사용 엔티티들 → 필요한 조립기/투입기/벨트 카운트 산출 → 격자 packer 로 직접 배치.

## 위저드 단계

총 5단계. 각 단계의 출력은 다음 단계의 후보 집합을 좁힌다.

### 1단계 — 레시피 + 수량

- 사용자가 만들 **타깃 레시피** 1개를 선택한다.
- 레시피 정보(재료/산출물/카테고리/소요 시간)를 패널에 표시.
- **수량 모드:**
  - **`최소값` (기본)** — "타깃 레시피가 (얼마나 느리든 간에) 일단 만들어지기만 하면 되는" 가장 단순한 구성.
    트리의 모든 비-외부 노드에 조립기 1대씩 둔다. 결과 머신 수 = 트리의 비-외부 노드 수.
    **처리량 균형은 보장되지 않으며, 자식 1대로 부모 요구를 못 채우면 라인이 부분 가동될 수 있다.** 의도된 동작.
  - **사용자 지정** — 타깃 레시피 머신 수를 정수로 입력. 하위 레시피 머신 수는 비례 산정 (`ceil(rate × t_sub / t_target)`).
- **하위 재료 트리:** 타깃 레시피 → 재료 → 그 재료의 첫 매칭 레시피 → … 를 BFS 로 펼쳐 보여준다.
  사용자가 트리에서 노드별로 "외부 공급(이 라인에서 만들지 않음)" 으로 토글하면 그 노드와 후손 재료는 라인 입력 벨트로만 수급한다.
- **선행 기술 사전 체크:** 이 시점에서 `gameDataStore.resolveRequiredTechs()` 로 타깃 + 하위 레시피들의
  필요 기술 closure 를 구해, 다음 단계들에서 "사용자가 자유롭게 골랐다" 고 가정해도 일관성이 깨지지 않도록
  벨트/투입기/지하 파이프 후보의 자동 체크 기준값으로 사용한다.

### 2단계 — 조립기계 선택

- 후보: 1단계에서 결정된 타깃 + 하위 재료 레시피들의 `category` 합집합을 모두 처리할 수 있는 머신.
  (`gameDataStore.getMachinesForCategory()` 의 합집합)
- 다중 체크박스. 한 카테고리에 머신이 1개뿐이면 자동 선택 + 그 카테고리는 UI 에서 생략.
- 후보가 카테고리별로 **단 하나뿐** 이면 단계 자체를 스킵.
- 사용자가 표면 호환성을 직접 책임 (`docs/surface-restriction-limits.md` 정책). 우주/지상 자동 판단 X.

### 3단계 — 투입기 선택

- 후보: `entity.type === 'inserter'` 인 모든 엔티티.
- **자동 체크 규칙:** 사용자가 후반 투입기(예: stack-inserter) 를 체크하면, 그 투입기를 언록하는 기술의
  prerequisite closure 안에서 unlock 되는 다른 투입기들도 함께 체크된다.
  (예: `stack-inserter` 체크 → `bulk-inserter` / `fast-inserter` / `long-handed-inserter` 도 자동 체크)
- **stack size 파라미터:** 인서터별로 한 번에 집을 수 있는 최대 개수를 슬라이더/입력으로 노출.
  기본값은 stack-size override 가 없는 본래 게임 한도. 처리량 계산에는 아직 반영되지 않음 (Phase 2).
- 1개뿐이면 스킵.

### 4단계 — 벨트 선택

- 후보: `entity.type === 'transport-belt'` 의 트랜스포트 벨트, 그리고 짝이 되는 underground/splitter 변종.
- 자동 체크 규칙은 투입기와 동일 (선택된 후반 벨트의 선행 기술 체인 안에 있는 모든 벨트 체크).
- 1개뿐이면 스킵.

### 5단계 — 지하 파이프 선택

- 후보: `entity.type === 'pipe-to-ground'`.
- 1개뿐이면 스킵.
- 자동 체크 규칙 동일.
- **재설계 적용 시 (M7):** 사용자가 선택한 지하 파이프는 pipe kind 라우팅의 점프 edge 활성화 여부를 결정 — 비어 있으면 점프 edge 비활성, 지상 pipe 만 사용. 일반 (지상) `pipe` 는 게임 데이터에서 1종이라 자동 선택.

### 6단계 이후 — 모듈 / 빔(beacon)

**미구현, 보류.** UI 자리 표시만 두고 알고리즘 단계에서는 전혀 사용하지 않는다.

## 알고리즘

알고리즘 본문 (컨테이너 모델, 조건 등록부, 라우팅, 모듈 구성) 은
[auto-layout-wizard.placement-search.md](auto-layout-wizard.placement-search.md) 가
**단일 출처**다. 본 문서에서는 위저드 UI 와 알고리즘 입출력의 연결만 다룬다.

### 입력 — `WizardInput`

```
{
  targetRecipe: string,
  countMode: 'min' | { perTarget: number },
  externalIngredients: Set<string>,        // 1단계에서 "외부 공급" 토글된 재료
  selectedMachines: string[],              // 2단계
  selectedInserters: string[],             // 3단계
  inserterOverrides:                       // 3단계 — 인서터별 처리량/묶음 갯수 override
    Record<string, { throughput?: number; stackSize?: number }>,
  selectedBelts: string[],                 // 4단계
  selectedUndergroundPipes: string[],      // 5단계 (현재 라우팅에서 미사용)
  region: { x, y, w, h },                  // 폼 입력
}
```

### 결정성

- 같은 입력에 항상 같은 결과. 난수 사용 금지.
- 머신 수 산출은 항상 비음수, 정수, 단조 (수량 ↑ → 머신 수 ↑).

### 현재 구현 범위

레거시 (구 둘레 슬롯 모델 기반, 새 모델로 교체 예정):

- ✅ 레시피 트리 펼치기 (`expandRecipeTree`) — *유지, 새 모델에서도 동일하게 사용*
- ✅ 최소 / 처리량 모드 머신 수 계산 — *유지*
- ✅ 카테고리별 호환 머신 선택 (`pickMachineForRecipe`) — *유지*
- ✅ 인서터 처리량 사용자 override (`inserterThroughput`) — *유지*
- ⚠ 둘레 슬롯 모델 placer (`packUnitsBySlot`) — **폐기 예정**. 새 모델의 모듈 A·B 로 교체
- ⚠ I/O 라우팅 (Lee BFS, 부모 ingredient ↔ 자식 product 첫 매칭만 연결) — **재작성 예정**. 새 모듈 4 로 교체

새 모델 (컨테이너 모델) 의 도입 단계는 [.placement-search](auto-layout-wizard.placement-search.md) 참조. [.known-limits](auto-layout-wizard.known-limits.md) 의 한계 항목 다수가 새 모델에서 자동 해소되거나 비-목표로 재분류된다 (자세한 처리는 .placement-search §12 / §13).

### 구현 위치

- [frontend/src/utils/autoLayout/types.ts](../frontend/src/utils/autoLayout/types.ts) — 위저드 입출력 타입
- [frontend/src/utils/autoLayout/recipeTree.ts](../frontend/src/utils/autoLayout/recipeTree.ts) — 1단계 (재료 트리 + 카운트)
- [frontend/src/utils/autoLayout/techGroup.ts](../frontend/src/utils/autoLayout/techGroup.ts) — 3·4·5단계 자동 체크 규칙
- [frontend/src/utils/autoLayout/inserterThroughput.ts](../frontend/src/utils/autoLayout/inserterThroughput.ts) — 투입기/벨트 처리량 모델 (사용자 override)
- [frontend/src/utils/autoLayout/slotPlacer.ts](../frontend/src/utils/autoLayout/slotPlacer.ts) — *(legacy)* 둘레 슬롯 모델 배치 — 새 모델의 모듈 A·B 로 교체 예정
- [frontend/src/utils/autoLayout/placedCell.ts](../frontend/src/utils/autoLayout/placedCell.ts) — 공용 PlacedCell 타입 + recipeHasFluid
- [frontend/src/utils/autoLayout/router.ts](../frontend/src/utils/autoLayout/router.ts) — *(legacy)* Lee BFS belt 라우팅 — 새 모듈 4 (item/fluid 통합) 로 교체 예정
- [frontend/src/utils/autoLayout/runSlotWizard.ts](../frontend/src/utils/autoLayout/runSlotWizard.ts) — *(legacy)* 단계 합성 진입점 — 새 오케스트레이터로 교체 예정
- [frontend/src/components/AutoLayoutModal.tsx](../frontend/src/components/AutoLayoutModal.tsx) — 위저드 UI
