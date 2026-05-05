# parameter-0 ~ parameter-9 처리 — 보류

**상태:** 인지하고 있음. 현재 export에서 제외하지 않음. 향후 parametrized blueprint 자동완성 기능 구현 시 함께 다룬다.

## 정체

Factorio 2.0의 **parametrized blueprint** (매개변수화 청사진) 시스템용 placeholder prototype.
- `prototypes.recipe["parameter-0" ~ "parameter-9"]` — 10개의 placeholder 레시피
- `prototypes.item["parameter-0" ~ "parameter-9"]` — 10개의 placeholder 아이템
- 가상 신호 `parameter-0 ~ 9` — combinator 와일드카드

`LuaRecipePrototype.is_parameter == true` 로 식별 가능.

## 현재 영향

| UI 위치 | 노출 여부 | 부작용 |
|---|:-:|---|
| 사이드바 **Recipes 탭** | ✅ (10개 노출) | 검색/스크롤에 약간 노이즈 |
| **RecipeBinding** (조립기 클릭) | ❌ (자동 제외) | `crafting_categories` 필터로 자연스럽게 걸러짐 |
| **ModuleBinding** | ❌ (확인 필요) | parameter 아이템에 `module_effects` 없으면 자동 제외 |
| Blueprint export | (영향 없음) | 사용자가 직접 placeholder를 그리드에 둘 일 없음 |

## 왜 지금 제외하지 않는가

향후 **parametrized blueprint 자동완성** 기능을 구현할 때 placeholder가 필요할 수도 있다:
- 사용자가 일반 레시피 대신 `parameter-0` 을 슬롯에 넣고 청사진 export → 다른 곳에 stamp할 때 게임이 채움
- 자동완성 알고리즘이 "이 자리는 어떤 아이템이 들어와도 동작" 같은 abstract template 생성

지금 제외하면 그때 다시 활성화해야 함. 노이즈 비용이 크지 않으므로 보류.

## 향후 처리 안 (구현 시)

1. **export 분리**: 일반 recipes/items 와 별도 array로 (`o.parameter_slots = {...}`)
2. **UI 토글**: RecipeBinding에 "Parameter slot" 탭 추가 — 의도적으로 parameter 슬롯 바인딩 가능
3. **자동완성 통합**: [auto-layout-wizard.md](auto-layout-wizard.md) 의 레시피 트리에서 parameter 슬롯을 "abstract leaf" 로 처리해 머신 매핑 단계를 스킵

## 빠른 제외법 (필요해질 경우)

`scripts/export-gamedata.lua` 의 레시피/아이템/모듈 루프에 다음 한 줄:

```lua
if r.is_parameter then goto continue end  -- 또는 if not r.is_parameter then ... end
```

또는 이름 패턴 `^parameter%-%d$` 매칭. 둘 다 한 줄 작업.

## 참고

- Factorio 0.46+ (2.0) parametrized blueprint 출시 노트
- `LuaRecipePrototype.is_parameter` (runtime API)
- 위저드 설계 + 알고리즘: [auto-layout-wizard.md](auto-layout-wizard.md)
