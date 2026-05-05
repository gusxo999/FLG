# 자동완성 위저드 — ControlBehavior 추적 범위

> **부모 문서:** [auto-layout-wizard.md](auto-layout-wizard.md) — 위저드 인터페이스
> **관련 문서:** [.algorithm](auto-layout-wizard.algorithm.md), [.binary-search](auto-layout-wizard.binary-search.md), [.known-limits](auto-layout-wizard.known-limits.md), [.refactor-notes](auto-layout-wizard.refactor-notes.md)

**목적:** 위저드가 의미 있는 결과를 내려면 일부 ControlBehavior 필드가 입력으로 필요하다 (예: 인서터 stack size 가 처리량을 좌우). 32개 변종 전부를 다루기보다 **레이아웃 자동완성에 영향이 있는 것만 추적**한다.

**상태 컬럼:**
- 🔴 in-scope: feasibility/throughput 계산에 직접 영향
- 🟡 partial: passthrough만 (값 보존, 자동완성 로직 미사용)
- ⚪ out-of-scope: 회로 프로그래밍/UI/디버그 용도

---

## In-scope (🔴)

| Entity | 필드 | 자동완성에서의 역할 |
|---|---|---|
| **Inserter** | `circuit_set_stack_size`, `circuit_stack_size_signal` | 인서터 처리량의 핵심 변수. stack size = 1 vs 12 는 처리량 12배 차이. 자동완성이 throughput target을 만족하려면 stack size를 가정하거나 명시해야 함 |
| Inserter | `circuit_set_filter`, `circuit_mode_of_operation` | 필터 인서터의 분배 결정 — multi-output 분기 패턴에 사용 |
| **Splitter** | `output_priority`, `input_priority`, `filter` | 메인 버스 / 분기점에서 균형 vs 우선순위 결정. throughput 분기 비율 직접 제어 |
| **AssemblingMachine** | `set_recipe` (회로로 레시피 변경) | 자동완성이 다중 레시피 라인을 설계할 때 활용. 단순 케이스에선 무시 가능 |
| **Pump** | `circuit_condition` | 유체 라인 분기/차단 — 자동완성이 fluid balancing 패턴 만들 때 사용 |
| **TransportBelt** | `circuit_enable_disable`, `circuit_condition` | "X가 가득 차면 라인 정지" 같은 조건. 자동완성의 backpressure 처리 |

## Passthrough (🟡)

import한 값을 그대로 보존만 하고, 자동완성 로직은 무시. round-trip 보장이 목적.

| Entity | 필드 | 비고 |
|---|---|---|
| Container, LogisticContainer, StorageTank | `read_contents`, `circuit_mode_of_operation` | 출력 신호 — 외부 회로용 |
| MiningDrill | `circuit_read_resources`, `resource_read_mode` | 자원 모니터링 |
| TrainStop | `set_priority`, `set_trains_limit`, `*_signal` | 열차 스케줄 |
| Roboport | `read_logistics`, `read_robot_stats`, `*_signal` | 봇 네트워크 모니터 |
| Reactor | `read_temperature`, `temperature_signal` | 원자로 모니터 |
| Accumulator | `output_signal`, `read_charge` | 전력 모니터 |
| Loader | `circuit_condition`, `read_contents` | 거의 안 쓰임 |
| Wall | `output_signal`, `read_sensor` | 게이트 감지 |
| Furnace, RocketSilo | `set_recipe` 등 | AssemblingMachine과 동일 패턴이지만 자동완성 단순화 위해 보존만 |
| AsteroidCollector, AgriculturalTower, CargoLandingPad, SpacePlatformHub | (Space Age 전체) | DLC, 자동완성 1차 범위 외 |

## Out-of-scope (⚪) — 자동완성 무관

| Entity | 사유 |
|---|---|
| ConstantCombinator | 사용자 회로 신호 정의 — 레이아웃 결정과 무관 |
| ArithmeticCombinator | 수식 계산 — 레이아웃 결정과 무관 |
| DeciderCombinator | 조건 분기 — 레이아웃 결정과 무관 |
| Lamp | `use_colors`, RGB signal — 시각/표시용 |
| DisplayPanel | text/icon 표시 — 시각/표시용 |
| ProgrammableSpeaker | 알람/음악 — UX |
| RailSignalBase | 열차 신호 출력 — 자동완성은 비-철도 영역 우선 |
| PowerSwitch | 단순 enable/disable — 자동완성이 만들 일 없음 |
| ArtilleryTurret, Turret | `read_ammo` — 모니터링 |

---

## 적용 우선순위 (자동완성 구현 시)

1. **MUST handle**: Inserter `circuit_set_stack_size`, Splitter priorities — throughput 계산 결과가 이 값에 따라 달라짐
2. **SHOULD handle**: Pump/TransportBelt enable conditions — 백프레셔 패턴
3. **CAN ignore**: 그 외 전부. import passthrough만 유지

자동완성이 새 엔티티를 만들어 그리드에 놓을 때는 **기본값(필드 누락)** 으로 두는 게 안전. 사용자가 직접 회로를 짜고 싶으면 EntityInfoModal에서 따로 편집.

## 참고

- 32개 BlueprintControlBehavior 변종 전체 목록과 export 스키마: [blueprint-metadata-coverage.md](blueprint-metadata-coverage.md) 2절
- 위저드 부모 문서: [auto-layout-wizard.md](auto-layout-wizard.md)
- 알고리즘 상세: [auto-layout-wizard.algorithm.md](auto-layout-wizard.algorithm.md)
