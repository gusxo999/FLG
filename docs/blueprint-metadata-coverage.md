# Blueprint 메타데이터 커버리지 — 현황 + 확장 계획

**상태:** 추적 문서 (구현 진행 중). 현재 export는 최소 4필드(`entity_number`, `name`, `position`, `direction`)만 채우며, `recipe`만 추가로 바인딩 가능. 게임 내에서 발생할 수 있는 모든 entity 메타데이터를 점진적으로 커버하는 게 목표.

**목표:** "게임에서 어떤 엔티티 상태를 만들어 blueprint로 잡든, 우리 앱에서 import → 시각/편집 → export 가 의미 손실 없이 동작" — **단, 각 단계는 실제 게임에서 round-trip 테스트 후 머지**한다 (스펙만 보고 추측한 코드는 깨지기 쉬움).

---

## 1. Factorio 2.0 BlueprintEntity 정식 스키마

`runtime-api.json` `BlueprintEntity` concept (10 fields):

| 필드 | 타입 | 필수 | 현재 export | 비고 |
|---|---|:-:|:-:|---|
| `entity_number` | uint32 | ✅ | ✅ | 1부터 순차 |
| `name` | string | ✅ | ✅ | Factorio 내부 이름 |
| `position` | MapPosition | ✅ | ✅ | 그리드 좌표(x,y) |
| `direction` | defines.direction | | ✅ | Factorio 2.0 16-방향 인코딩(0/4/8/12 = N/E/S/W). cardinal 4방향만 현재 지원, sub-cardinal(곡선 레일) 미지원. 1.x 블루프린트 import 시 ×2 자동 업그레이드. 자세한 의미는 [direction-encoding.md](direction-encoding.md) |
| `recipe` (entity별 확장) | string | | ✅ | 별도 RecipeBinding UI |
| `items` | BlueprintInsertPlan[] | | ❌ | **모듈, 연료, 인벤토리 아이템 (BIG)** |
| `quality` | string | | ❌ | 일반/uncommon/rare/epic/legendary |
| `tags` | Tags | | ❌ | 사용자 정의 메타데이터 (드물게 사용) |
| `mirror` | boolean | | ❌ | 좌우 거울 (e.g. 일부 비대칭 엔티티) |
| `burner_fuel_inventory` | BlueprintInventoryWithFilters | | ❌ | 화로/보일러 연료 슬롯 |
| `wires` | BlueprintWire[] | | ❌ | **회로/구리 와이어 연결 (BIG)** |

또한 `BlueprintEntity` 외부의 entity-별 control_behavior 필드들은 별도 concept으로 정의됨 — 이 부분이 가장 복잡함.

---

## 2. Control Behavior — 32개 엔티티 타입별 변종

`*BlueprintControlBehavior` concept 전체 목록 (entity 타입별 회로 동작 설정):

| 엔티티 타입 | 대표 필드 |
|---|---|
| Accumulator | `output_signal`, `read_charge` |
| AgriculturalTower | `circuit_condition`, `read_contents` |
| ArithmeticCombinator | `arithmetic_conditions` (입력+연산자+출력) |
| ArtilleryTurret | `read_ammo` |
| AssemblingMachine | `set_recipe`, `read_ingredients`, `read_recipe_finished`, `read_working`, `working_signal`, `recipe_finished_signal`, `include_in_crafting`, `include_fuel` |
| AsteroidCollector | `circuit_set_filters`, `circuit_read_contents`, `include_hands` |
| CargoLandingPad | (Space Age) |
| ConstantCombinator | `sections`, `is_on` (가장 많이 쓰이는 회로 소자) |
| Container, ProxyContainer, LogisticContainer | `read_contents`, `circuit_mode_of_operation` |
| DeciderCombinator | `decider_conditions` (조건+출력) |
| DisplayPanel | `parameters`, `text` |
| Furnace | `set_recipe` 등 (AssemblingMachine과 유사) |
| Inserter | `circuit_set_filter`, `circuit_set_stack_size`, `circuit_read_hand_contents`, `pickup_position`, `drop_position`, `circuit_mode_of_operation` |
| Lamp | `use_colors`, `red_signal`, `green_signal`, `blue_signal` |
| Loader | `circuit_condition`, `read_contents` |
| MiningDrill | `circuit_read_resources`, `resource_read_mode` |
| PowerSwitch | `circuit_condition` |
| ProgrammableSpeaker | `parameters`, `alert_parameters`, `circuit_parameters` |
| Pump | `circuit_condition` |
| RailSignalBase | `red_output_signal`, `orange_output_signal`, `green_output_signal`, `blue_output_signal`, `read_signal` |
| Reactor | `read_temperature`, `temperature_signal` |
| Roboport | `read_logistics`, `read_robot_stats`, `available_logistic_output_signal` 등 (~10 필드) |
| RocketSilo | `read_orbital_requests`, `transitional_request_index` |
| SpacePlatformHub | (Space Age) |
| Splitter | `output_priority`, `input_priority`, `filter` |
| StorageTank | `read_contents` |
| TrainStop | `send_to_train`, `read_from_train`, `train_stopped_signal`, `trains_count_signal`, `set_priority`, `set_trains_limit` 등 |
| TransportBelt | `circuit_condition`, `circuit_read_hand_contents`, `read_contents_mode`, `circuit_enable_disable` |
| Turret | `read_ammo`, `circuit_condition` |
| Wall | `output_signal`, `read_sensor` (게이트 감지) |

**총 32개 타입 × 평균 5-10 필드 = 약 200-300개의 개별 회로 설정 필드.** 정밀 구현은 큰 작업.

---

## 3. 단계별 구현 계획

각 단계는 **반드시 실제 게임에서 round-trip 테스트** (앱에서 export → 게임에서 import → 동일 동작 확인) 후 머지.

### Phase 0 — 현재 (완료)
- `entity_number`, `name`, `position`, `direction`, `recipe`
- 게임 import 시 위치/회전/레시피 정상 복원 확인됨

### Phase 1 — 손쉬운 기본 메타 (테스트 부담 낮음)
- `quality`: 단순 string 추가, RecipeBinding과 같은 패턴의 단일 셀렉터 UI
- `mirror`: 단일 boolean. 거울 엔티티(예: 일부 정유소 회전 변형)에서 의미. 우선순위 낮음
- `tags`: 임의 key-value. 우리 앱에서 편집 UI 없이도 import 시 보존만 하면 round-trip 보장

### Phase 2 — Items / Modules (높은 가치, 중간 복잡도)
`items: BlueprintInsertPlan[]` 가 모듈 슬롯 + 연료 인벤토리를 모두 커버.

```ts
{ id: { name: "speed-module-3", quality: "rare" },
  items: { in_inventory: [{ inventory: 1, stack: 0 }], grid_count: 0 } }
```

- entityMap의 `module_slots` 필드 활용해 슬롯 수만큼 모듈 셀렉터 노출
- EntityInfoModal에 "Modules" 섹션 추가
- `burner_fuel_inventory` 도 같은 BlueprintInventoryWithFilters 패턴

**테스트 케이스:**
- 빈 모듈 슬롯
- speed-module / productivity-module 혼합
- quality 모듈 (Space Age)
- 연료 슬롯 (steel-furnace에 coal)

### Phase 3 — Wires (가장 큰 작업)
`wires: BlueprintWire[]` — 회로 / 구리 와이어 연결.

```ts
[entity_number_a, source_terminal, entity_number_b, target_terminal]
// terminal 정의 매크로: defines.wire_connector_id.* (1=red, 2=green, 5=copper, ...)
```

- 그리드에 와이어 UI 추가 (전선 끌어 연결)
- 데이터 모델에 wire 그래프 자료구조 (entity_id → connections)
- 렌더링: PixiJS에 와이어 layer (셀 위에 그리는 라인)
- export 시 entity_number로 변환

**테스트 케이스:**
- 빨강/초록 회로 와이어
- 구리 와이어 (전봇대-전봇대, 전봇대-스위치)
- 한 entity 에서 여러 와이어 fan-out
- combinator 입력 vs 출력 단자 분리

### Phase 4 — Control Behavior (가장 복잡)
32개 엔티티 타입별로 각자 다른 UI 필요. **단계 분할 필수:**

**4a. 가장 자주 쓰이는 것부터:**
- ConstantCombinator (sections + signal slots)
- ArithmeticCombinator (operand+op+result)
- DeciderCombinator (conditions+output)
- Inserter (circuit_set_filter, circuit_mode_of_operation)
- TrainStop (limits + signals)

**4b. 보조:**
- Lamp (color signals)
- Pump, PowerSwitch (circuit_condition)
- TransportBelt (enable/disable)
- Wall (gate sensor)

**4c. 고급:**
- AssemblingMachine 회로 (set_recipe + 13 fields)
- Roboport, RocketSilo
- ProgrammableSpeaker (가장 복잡: alert + tune)
- Space Age 전용 (AgriculturalTower, AsteroidCollector, CargoLandingPad, SpacePlatformHub)

각 항목은 **자체 컴포넌트** + **자체 테스트 케이스 (게임 round-trip)**.

---

## 4. 진행 추적 체크리스트

| 단계 | 항목 | 구현 | UI | round-trip 테스트 |
|---|---|:-:|:-:|:-:|
| 0 | entity_number / name / position / direction | ✅ | — | ✅ |
| 0 | recipe | ✅ | ✅ | (확인 필요) |
| 1 | quality (passthrough) | ✅ | ❌ | ❌ |
| 1 | mirror (passthrough) | ✅ | ❌ | ❌ |
| 1 | tags (passthrough) | ✅ | — | ❌ |
| 2 | items (modules) | ✅ | ✅ | ❌ |
| 2 | items (fuel) | ❌ | ❌ | ❌ |
| 2 | burner_fuel_inventory | ❌ | ❌ | ❌ |
| 3 | wires (circuit) | ❌ | ❌ | ❌ |
| 3 | wires (copper) | ❌ | ❌ | ❌ |
| 4a | ConstantCombinator | ❌ | ❌ | ❌ |
| 4a | Arithmetic/Decider Combinator | ❌ | ❌ | ❌ |
| 4a | Inserter circuit | ❌ | ❌ | ❌ |
| 4a | TrainStop | ❌ | ❌ | ❌ |
| 4b | Lamp / Pump / PowerSwitch | ❌ | ❌ | ❌ |
| 4b | Belt enable/disable | ❌ | ❌ | ❌ |
| 4c | AssemblingMachine 회로 | ❌ | ❌ | ❌ |
| 4c | Roboport / RocketSilo | ❌ | ❌ | ❌ |
| 4c | ProgrammableSpeaker | ❌ | ❌ | ❌ |
| 4c | Space Age 엔티티 | ❌ | ❌ | ❌ |

### 다음 round-trip 테스트 권장 시나리오 (Phase 1+2)

게임 → 우리 앱 → 게임 흐름에서 검증해야 할 케이스:

1. **Modules 단일 종류**: 조립기-2 (4슬롯)에 speed-module-3 4개 → BP 추출 → 우리 앱 import → 모듈 표시 확인 → re-export → 게임 import 시 동일 4모듈 유지
2. **Modules 혼합**: 조립기-3에 speed-module-3 2개 + productivity-module-3 2개 → 위와 동일
3. **모듈 슬롯 인덱스 확인**: 빈 슬롯과 채운 슬롯이 섞인 경우 (예: 슬롯 0,2 만 채움) → 정확한 stack index로 export되는지
4. **다른 entity type**: 채굴기(2슬롯), 비콘(1슬롯), 화학플랜트(3슬롯, 변형 가능). `MODULE_INVENTORY_BY_TYPE` 매핑 검증
5. **Quality**: epic 엔티티 한 개 배치 → BP 추출 → 우리 앱 import → re-export → 동일 quality 보존
6. **Tags**: Foreman2 등으로 tags 들어간 BP → 우리 앱 import → re-export → tags 동일

각 시나리오에서 **실패가 발견되면**: 1) 어떤 필드가 다른지 캡쳐, 2) `inventory:` ID 매핑 (`blueprintItemsCodec.ts`) 수정, 3) 체크리스트의 round-trip 컬럼은 **테스트 통과 후에만** ✅ 처리.

---

## 5. 작업 원칙

1. **데이터 보존이 UI보다 먼저**: 어떤 필드든 import 시 cell 메타데이터에 저장만 해두고 export 시 그대로 다시 내보내면 round-trip이 깨지지 않는다. UI 편집 기능은 그 다음 단계.
2. **PixiJS 렌더링은 최후**: 와이어/회로 시각화는 코드 변경이 가장 큰 영역. 데이터 모델 + import/export 안정화 후 시각화.
3. **테스트 시나리오는 실제 sav 파일 기반**: 게임에서 다양한 회로 패턴을 직접 만들어 BP 추출 → 우리 앱 import → 다시 export → 게임에서 비교. 추측 코드 금지.
4. **BlueprintBook은 후순위**: 단일 blueprint round-trip이 안정될 때까지 보류.

---

## 6. 외부 참고

- Factorio 공식 API 문서 (로컬): `F:\Program Files (x86)\Steam\steamapps\common\Factorio\doc-html\concepts.html` — `BlueprintEntity` 와 32개 `*BlueprintControlBehavior` concept
- Factorio Wiki: https://wiki.factorio.com/Blueprint_string_format
- 비교 대상 도구:
  - **Factorio Prints**, **Foreman2**: 회로/모듈까지 정상 round-trip
  - **Factoriolab**: 처리량 계산 위주, BP round-trip은 부분 지원
  - **Factorio School**: BP 표시만, 편집 X

---

## 7. 현재 한계 명시 (UI 표기 검토)

사용자가 "왜 모듈이 사라졌지?" 같은 혼란을 겪지 않도록:
- import 시 알려진 누락 필드(`items`, `wires`, `*_control_behavior`) 가 있으면 토스트로 1회 안내
- export 후에도 "회로/모듈 정보는 보존되지 않습니다 — 단순 배치만 export됨" 같은 안내
- 이 안내는 Phase 2/3가 머지될 때마다 점진적으로 제거

→ 별도 작업 단위로 추적 (이 문서 5절 체크리스트의 항목과 무관).
