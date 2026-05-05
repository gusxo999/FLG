# 유체 상자(FluidBox) 시맨틱스 — `production_type` vs `flow_direction`

**작성일**: 2026-04-25
**관련 이슈**: `se-casting-machine`이 양방향(input-output)인데 input으로만 표시되던 버그
**영향 범위**: 유체 연결점 시각화, 엔티티 상세 패널

---

## 한 줄 요약

Factorio 유체 상자에는 **의미가 다른 두 개의 방향 필드**가 있으며, 목적에 따라 어느 쪽을 봐야 하는지가 달라진다. 우리 앱(레이아웃 편집기)은 **`flow_direction` (연결 단위)**를 우선 사용한다.

---

## 배경

`FluidBox` 프로토타입은 두 종류의 "방향" 정보를 포함한다.

```
FluidBoxInfo
 ├─ production_type: "input" | "output" | "input-output" | "none"    ← ①
 └─ connections[]
     └─ flow_direction: "input" | "output" | "input-output"           ← ②
```

두 필드의 **의미 층위가 다르다**:

| 필드 | 층위 | 의미 |
|------|------|------|
| `production_type` | 게임플레이 | 이 fluidbox가 **레시피에서** 어떤 용도인가 — 재료(input)/결과물(output)/특수(input-output)/무관(none) |
| `flow_direction` | 물리 엔진 | 이 연결점에서 파이프로 **실제 유체가 어느 방향으로** 흐를 수 있는가 |

공식 API 문서의 `ProductionType` 설명:

> Specifies how the entity will utilize this fluidbox. `input-output` should only be used for **boilers in fluid heating mode**.

즉 `production_type = "input-output"`은 본래 보일러 가열 모드 전용 특수 플래그지만, 일부 mod에서 확장 용도로 쓰인다.

---

## 두 필드의 독립성 — 실제 데이터 검증

3번 export(`factorio-data.json`, vanilla + SE + KR mods 로드됨) 기준 **9가지 조합이 모두 실존**한다:

| production_type | flow_direction | 개수 | 대표 예시 | 의미 |
|-----------------|---------------|------|----------|------|
| `input` | `input` | 112 | `se-big-turbine` | 일반 재료 투입 (단방향) |
| `input` | `input-output` | **18** | **`se-casting-machine`**, `se-electric-boiler` | 재료 슬롯이지만 파이프 양방향 허용 |
| `input-output` | `input` | 16 | `se-energy-transmitter-chamber` | 특수 가열 모드 + 단방향 흐름 |
| `input-output` | `input-output` | 10 | `kr-gas-power-station` | 특수 양쪽 모두 |
| `none` | `input` | 2 | `pump` (입력 쪽) | 펌프 자체는 생산/소비 안 함 |
| `none` | `input-output` | 36 | `pipe`, `pipe-to-ground` | 파이프류 (소비/생산 없음, 양방향 흐름) |
| `none` | `output` | 2 | `pump` (출력 쪽) | 펌프 자체는 생산/소비 안 함 |
| `output` | `input-output` | 5 | `se-fuel-refinery` | 결과물 슬롯이지만 파이프 양방향 |
| `output` | `output` | 149 | `se-electric-boiler` (증기) | 일반 결과물 배출 (단방향) |

**핵심 관찰**:
- 단순 일치 케이스(`input×input`, `output×output`)가 전체의 약 80%
- 나머지 20%는 불일치 — 두 필드가 **다른 것을 측정**하고 있음을 증명
- **파이프/펌프는 `production_type = "none"`** — 엔티티 스스로는 유체를 "소비/생산"하지 않기 때문

---

## 불일치 사례 심층 설명

### 예시 1 — 파이프 (`none` × `input-output`)

```
게임플레이 관점: 파이프는 레시피가 없음 → "none"
물리 관점: 양쪽 끝 어디로든 유체가 흐름 → "input-output"
```

### 예시 2 — 펌프

```
fluid_boxes: [
  { production_type: "none", connections: [{ flow_direction: "input" }] },   // 입력부
  { production_type: "none", connections: [{ flow_direction: "output" }] }   // 출력부
]
```

게임플레이로는 펌프가 재료/결과를 가지지 않지만, 물리적으로 단방향 이송 장치이므로 연결점마다 `flow_direction`이 다르다.

### 예시 3 — `se-casting-machine` (이 문서의 트리거)

```
fluid_boxes: [
  {
    production_type: "input",      ← 레시피상 재료 슬롯 #1
    connections: [{ flow_direction: "input-output" }]  ← 파이프는 양방향 허용
  },
  {
    production_type: "input",      ← 레시피상 재료 슬롯 #2
    connections: [{ flow_direction: "input-output" }]  ← 파이프는 양방향 허용
  }
]
```

SE의 cast-machine은 **재료 투입 슬롯이지만 파이프 자체는 양방향**. 아마도 잉여 유체 회수나 파이프 네트워크 공유 목적으로 보인다.

**플레이어의 직관은 `flow_direction` 쪽과 일치한다** — "이 파이프 연결로 어떻게 흐를 수 있나?"가 주 관심사이기 때문.

---

## 우리 앱의 선택

**레이아웃 편집기** 관점에서 사용자는 "파이프를 어느 방향으로 이어야 하나?"를 알고 싶어 한다. 따라서:

### 규칙

```typescript
// 각 connection별로 독립 판정
const effectiveFlow = connection.flow_direction ?? fluidbox.production_type;
```

1. **`connection.flow_direction`을 우선**
2. 없을 경우에만 **`fluidbox.production_type`으로 fallback**
3. **연결점마다 독립 판정** — 한 fluidbox 내에서도 연결별로 다를 수 있으므로 fluidbox 단위로 묶지 않음

### 색상/아이콘 매핑

| 판정된 flow | 색상 | 화살표 |
|------------|------|--------|
| `input` | 청색 `#40c8ff` | 엔티티 중심을 향함 (←) |
| `output` | 주황 `#ff8030` | 엔티티 바깥을 향함 (→) |
| `input-output` | 자주 `#cc80ff` | 양방향 (↔) |

---

## 다른 선택지는 없었나?

| 대안 | 결론 |
|------|------|
| `production_type`만 사용 | ❌ 파이프(`none`)를 표현 못 함. `se-casting-machine` 같은 불일치 케이스 오표시 |
| `flow_direction`만 사용 | △ 불완전 — `flow_direction`이 없는 데이터도 있을 수 있음 |
| 두 필드 AND/OR 결합 | ❌ 의미가 달라 결합 규칙이 자의적이 됨 |
| **`flow_direction` 우선 + `production_type` fallback** | **✓ 가장 직관적, 실데이터의 모든 케이스 처리 가능** |

---

## 예외/주의 사항

### 보일러의 `input-output`

공식 문서가 명시한 **유일한 정당 용도**. 가열 모드에서 같은 fluidbox로 들어와 가열 후 나간다. 우리 시각화에서는 양방향 화살표로 표현되어 직관적.

### `production_type = "input-output"`이 다른 엔티티에도 나타남 (26개)

mod 제작자들이 공식 범위를 벗어나 사용한 경우. 우리 로직은 `connection.flow_direction`을 우선하므로 영향 최소.

### `connections` 배열이 비어있을 경우

`fb.connections[0]`이 undefined → fallback으로 `fb.production_type` 사용. UI 렌더링에서도 `connections.length > 0`을 체크하므로 안전.

---

## 구현 위치

| 파일 | 역할 |
|------|------|
| [scripts/export-gamedata.lua](../scripts/export-gamedata.lua) `extract_fluid_boxes()` | Lua에서 `production_type`과 각 connection의 `flow_direction` 둘 다 추출 |
| [frontend/src/store/gameDataStore.ts](../frontend/src/store/gameDataStore.ts) `FluidBoxInfo`, `PipeConnection` | 두 필드 모두 타입 정의 |
| [frontend/src/pixi/pixi-manager.ts](../frontend/src/pixi/pixi-manager.ts) `drawInteractionPoints()` | **연결점별로** `flow_direction ?? production_type` 판정 후 화살표 렌더링 |
| [frontend/src/components/EntityDetails.tsx](../frontend/src/components/EntityDetails.tsx) `FluidBoxRow` | 상세 패널에서도 `connections[0].flow_direction ?? production_type`으로 대표 방향 표시 |

---

## 향후 고려 사항

1. **한 fluidbox 내 서로 다른 `flow_direction`을 가진 연결이 있을 경우**: 현재 상세 패널은 `connections[0]`을 대표로 삼음. 여러 방향을 가진 fluidbox가 나타나면 "mixed" 표시로 개선 필요.

2. **`connection_category`** (파이프 연결 카테고리): 현재 추출하지 않음. 일부 mod가 특정 파이프끼리만 연결되게 제한할 때 사용. 필요 시 추가.

3. **`filter`** (고정 유체): 이미 추출 중. 상세 패널에 표시. 해당 연결점이 특정 유체만 허용하는 경우 추가 시각 표현 고려 가능.
