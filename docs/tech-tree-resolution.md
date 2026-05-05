# Tech Tree Resolution

자동완성(Auto-Layout) 시 사용자가 특정 머신/레시피를 지정하면, "이 항목들이 사용 가능하다" 를
자연스럽게 만족하기 위해 연구되어야 할 기술 집합을 자동으로 산출한다.

## 데이터 모델

`factorio-data.json` 의 `technologies[]`:

```json
{
  "name": "advanced-electronics",
  "prerequisites": ["electronics", "plastics"],
  "unlock_recipes": ["advanced-circuit", "processing-unit-prerequisite"],
  "enabled": false,
  "essential": true,
  "visible_when_disabled": false,
  "upgrade": false,
  "max_level": 1
}
```

엔티티에는 추가로 `items_to_place_this` 가 포함된다 — 그 엔티티를 설치하는 인벤토리 아이템.
보통 1개 (`assembling-machine-2` 엔티티 → `assembling-machine-2` 아이템).

## 추론 체인

| 입력 | 단계 | 결과 |
|------|------|------|
| recipeName | `recipeToTech.get(name)` | 해당 레시피를 unlock-recipe 로 가지는 기술 |
| machineName | `entity.items_to_place_this[0]` → `itemToRecipe.get(item)` → `recipeToTech.get(recipe)` | 머신을 언록하는 기술 |

체인이 어느 단계에서든 끊기면 (= 매핑 없음) 해당 항목은 **기본 활성**(연구 불필요)으로 간주.

## prerequisite 클로저

`resolvePrerequisites(techName)` — 해당 기술의 모든 선행 기술을 BFS 로 모은다.
visited set 기반이라 사이클(이론상 없어야 하지만) 안전.

`resolveRequiredTechs({ machines, recipes })` — 입력 집합 → 시드 기술 집합 → 자기 자신 + 모든 선행을
누적. **`enabled === true` 인 기술(게임 시작 시 해금)은 결과에서 제외** — 그 기술은 호출자
입장에서 "추가 연구 없이 자유롭게 사용 가능" 하므로 불필요한 노이즈를 만들지 않는다.

## 한계

- **동일 레시피를 여러 기술이 unlock 하는 모드**에서는 첫 매칭만 보존. (Vanilla 에서는 거의 발생하지 않음.)
- **Trigger-based research** (예: SE 의 일부 explore-condition 기술)는 prerequisites 체인만 따라가며
  trigger 조건은 무시. 사용자가 "그 기술을 충족했다고 본다" 만 표현.
- **무한 연구**(`max_level == 4294967295`) 는 한 단계만 unlock 한 것으로 간주.
- **Quality / Productivity 보너스** 같은 modifier-only 효과는 unlock 추적과 무관 (unlock-recipe 만 본다).

## 백엔드 / API

이 프로젝트는 백엔드 import 엔드포인트가 별도로 존재하지 않으며 (frontend-only), 사용자가
업로드한 JSON 을 그대로 `parseGameData.ts` 에서 변환해 zustand store 에 적재한다.
따라서 기술 트리 인덱스(`techMap`, `recipeToTech`, `itemToRecipe`)는 모두
[gameDataStore.ts](../frontend/src/store/gameDataStore.ts) 의 `buildDerived()` 에서 계산된다.
