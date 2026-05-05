# 표면 제약 처리의 한계 — 모드 의존성과 사용자 위임

**작성일:** 2026-04-29

## 한 줄 요약

엔티티의 "어느 표면에 설치 가능한가" 를 **앱이 자동으로 판단하는 것을 포기**한다. vanilla Space Age 와 모드(SE 등)가 서로 다른 메커니즘과 임의의 필드명을 사용하므로, 앱은 표면 제약을 검증하지 않고 **사용자가 사용할 조립 기계를 매번 명시적으로 선택**하게 한다.

## 문제 / 배경

레이아웃 자동완성 기능 구현 시 "어떤 조립 기계를 쓸 것인가" 를 결정해야 한다. 후보가 여럿일 때 (예: `assembling-machine-3` vs `se-space-manufactory` 둘 다 `crafting` 카테고리를 다룸) 자동 선택을 위해서는 "현재 작업 중인 블루프린트가 지상용인가 우주용인가" 를 알아야 한다.

처음에는 엔티티 prototype 에서 표면 제약을 추출해 자동 분류하는 방향을 검토했다. 두 케이스를 직접 비교한 결과 **메커니즘이 모드마다 완전히 다르다**:

### 실측 데이터 ([scripts/debug-export-two-machines.lua](../scripts/debug-export-two-machines.lua) 결과)

| 필드 | `assembling-machine-3` (vanilla) | `se-space-manufactory` (SE 모드) |
|------|------|------|
| `surface_conditions` | `nil` | `nil` |
| `tile_buildability_rules` | `nil` | `nil` |
| `collision_mask.layers` | `[..., space_tile, water_tile]` | `[ground_tile, ..., water_tile]` |
| `crafting_categories` | `crafting`, `crafting-with-fluid`, ... | 위와 동일 + `space-crafting`, `space-manufacturing` |

→ vanilla 에서는 `surface_conditions` 로 우주/지상을 표현하지만, SE 는 **`collision_mask` 의 `space_tile`/`ground_tile` layer 부정 매칭**으로 표현한다. 이름도 `space_tile` 이 아니라 다른 모드는 또 다른 layer 명을 쓸 수 있다.

## 왜 자동 판단을 포기했는가

1. **필드명 비결정성** — `space_tile`, `ground_tile` 은 SE 가 자체 정의한 collision layer 이름이다. 다른 모드가 같은 의도로 `zone-tile`, `vacuum-tile`, `orbit-floor` 등 임의 이름을 쓸 수 있고, 우리는 그 mapping 을 미리 알 수 없다.
2. **표면 정의의 모드 의존성** — 행성/우주 surface 는 모드가 동적으로 추가한다. SE 는 행성 궤도마다 별도 surface 를 만들고, 다른 모드는 또 다른 표면 체계를 쓸 수 있다. `KNOWN_SURFACES` 같은 enum 으로는 커버 불가.
3. **양립 메커니즘 부재** — vanilla 의 `surface_conditions` 와 SE 의 `collision_mask` 는 **데이터 상으로 직교**한다. SPM 의 `surface_conditions` 는 비어있고, AM3 의 collision_mask 도 vanilla 우주 플랫폼을 구분하지 못한다. 두 메커니즘을 동시에 검사한다 해도 **검출되지 않은 모드 메커니즘이 있을 가능성** 을 영구히 닫을 수 없다.
4. **잘못된 자동 분류의 비용** — 사용자가 의도한 표면과 다른 머신을 자동으로 골라 자동완성하면 결과 블루프린트가 game 에서 통째로 invalid 가 된다. silent failure 보다 명시적 선택이 안전하다.

## 채택한 정책

### 1. 자동완성에서 **머신은 사용자 입력 항목**

- 레시피 → 머신 자동 매핑 금지.
- 자동완성 UI 는 매번 "이 레시피에 어떤 머신을 사용할지" 를 사용자가 고르게 한다 (`getMachinesForCategory` 결과를 그대로 셀렉터에 노출).
- 사용자가 한 번 고른 선택은 해당 자동완성 세션 내에서 기억하되, 다음 세션에 자동 적용하지 않는다.

### 2. 앱은 **표면 호환성 검증을 하지 않음**

- 한 블루프린트에 `assembling-machine-3` 과 `se-space-manufactory` 가 섞여있어도 앱은 경고하지 않는다.
- 사용자가 그 블루프린트를 Factorio 에 import 하면 게임이 알아서 거부할 것이고, 그 책임은 사용자에게 있다.
- "이 블루프린트가 우주용인가 지상용인가" 를 추적하는 메타데이터도 두지 않는다.

### 3. `surface_conditions` / `collision_mask` 데이터는 **참조용으로 export 만**

- `export-gamedata.lua` 는 가능한 한 원본 정보를 보존해서 export 한다 (현재 `surface_conditions`, 향후 `collision_mask.layers` 추가).
- 앱 코드는 이 데이터를 **표시 (info 패널) 와 검색 필터에만 사용**하고, 자동 결정 로직에는 입력으로 쓰지 않는다.
- 사용자가 정보를 보고 직접 머신을 선택할 수 있게 하는 보조 도구의 역할만 한다.

## 대안 검토 — 왜 다른 길을 가지 않았나

| 대안 | 기각 이유 |
|------|------|
| `KNOWN_SURFACES` 에 SE 표면 추가 | SE 의 zone surface 는 사용자가 행성마다 동적으로 만들고 이름도 임의적이다. 정적 enum 으로 못 잡음. |
| `surface_kind: 'planet' \| 'space' \| 'any'` 자동 분류 | "space tile layer 이름 = `space_tile`" 가정이 SE 에만 맞고 다른 모드에 깨진다. False negative 가 더 위험. |
| 모드별 어댑터 작성 (vanilla / SE / 기타) | 무한히 늘어남. 새 모드가 나올 때마다 코드 변경 필요 — 우리 앱의 "JSON 업로드 기반, 코드 변경 없이 임의 모드 지원" 설계 원칙과 충돌. |
| 게임에 import 시 검증 책임 떠넘기기 (현재 정책) | **채택**. 단순하고, 실패 시 게임이 명확한 에러를 준다. |

## 구현 위치

- **머신 셀렉터:** [frontend/src/components/EntityDetails.tsx](../frontend/src/components/EntityDetails.tsx) 등에서 자동완성 호출 시 `getMachinesForRecipe(recipeName)` 결과를 사용자에게 그대로 노출. 자동 picking 금지.
- **자동완성 알고리즘:** 머신 인스턴스를 입력으로 받고, 직접 결정하지 않음 ([docs/auto-layout-wizard.md](auto-layout-wizard.md) 의 위저드 2단계가 사용자 머신 선택을 입력으로 가정).
- **표면 데이터 export:** [scripts/export-gamedata.lua](../scripts/export-gamedata.lua) — `surface_conditions` 추출 유지, `collision_mask.layers` 는 향후 표시용으로만 추가 검토.
- **블루프린트 import/export:** 표면 호환성 검증 로직 추가하지 **않는다**.

## 사용자에게 노출할 메시지

자동완성 UI 에서 머신 셀렉터를 보일 때 다음 안내를 함께 표시한다 (i18n 키 권장):

> "이 레시피를 만들 수 있는 모든 조립 기계입니다. 작업 중인 블루프린트가 사용될 표면(행성/우주 등)에 맞는 기계를 직접 선택해 주세요. 본 도구는 표면 호환성을 자동 검증하지 않습니다."

## 한계의 영향 범위

- **자동완성 기능:** 매번 머신 입력이 필요해 UX 가 한 단계 늘어남. 기본값으로 "마지막에 사용한 머신" 정도는 기억해도 됨.
- **블루프린트 import 검증:** 우주/지상 혼합 블루프린트도 그대로 받아들임. 게임에서 일부 엔티티가 회색으로 뜨면 사용자 책임.
- **레시피 → 머신 카운트 계산:** 머신이 정해지지 않은 상태에서는 "이 레시피 1개당 N개 머신" 같은 통계도 계산 불가. 사용자가 머신을 고른 뒤에야 계산 가능.

## 향후 재검토 조건

다음 중 하나가 충족되면 이 정책을 재고할 수 있다:

1. Factorio API 가 모든 모드가 따르는 표준 "표면 호환성" 필드를 제공 (현재 없음).
2. 사용자가 "내 모드 셋업의 표면 매핑" 을 직접 정의해 업로드할 수 있는 기능을 별도로 도입.
3. 우리가 vanilla Space Age **만** 지원하기로 범위를 좁힐 경우 — `surface_conditions` 단일 메커니즘으로 충분.
