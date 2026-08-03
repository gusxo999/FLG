---
tags: [factorio-data, fluid]
---

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
| [scripts/export-gamedata.lua](../../scripts/export-gamedata.lua) `extract_fluid_boxes()` | Lua에서 `production_type`과 각 connection의 `flow_direction` 둘 다 추출 |
| [src/UI/store/gameDataStore.ts](../../src/UI/store/gameDataStore.ts) `FluidBoxInfo`, `PipeConnection` | 두 필드 모두 타입 정의 |
| [src/UI/pixi/pixi-manager.ts](../../src/UI/pixi/pixi-manager.ts) `drawInteractionPoints()` | **연결점별로** `flow_direction ?? production_type` 판정 후 화살표 렌더링 |
| [src/UI/components/EntityDetails.tsx](../../src/UI/components/EntityDetails.tsx) `FluidBoxRow` | 상세 패널에서도 `connections[0].flow_direction ?? production_type`으로 대표 방향 표시 |

---

## 라우팅에서의 함정 — 용도를 안 보면 재료가 출구로 들어간다 (2026-07-13)

`portInference.fluidPorts` 가 **`fb.filter` 만 보고 `production_type` 을 안 봤다.** 그 결과
화학 공장의 **출력** 유체 상자도 재료 파이프의 후보로 올라갔고, `resolvePortPair` 가
"가장 가까운 면"만 보고 골라서 **석유가스가 출력 칸(S면)에 꽂혔다**.

이 버그가 고약한 이유: **조용하다.** 파이프는 멀쩡히 이어져 있고, 그림도 정상이고, 라우팅도
"성공"으로 보고된다. 머신만 굶는다.

**규칙:** 유체 포트를 열거할 때는 그 컨테이너가 이 흐름에서 **생산자냐 소비자냐**를 함께
넘겨서 `production_type` 으로 거른다(`input-output` 은 양쪽 다 허용). 여기서는
`flow_direction`(물리 흐름)이 아니라 **`production_type`(레시피에서의 용도)** 을 본다 —
묻는 것이 "파이프가 흐를 수 있나"가 아니라 **"이 칸이 재료를 받는 칸이냐"** 이기 때문이다.

**딸린 함정 하나 더:** 아이템은 둘레 아무 칸이나 쓸 수 있어서 `resolvePortPair` 가 "마주 보는
면"으로 후보를 좁히는데, **유체는 fluid_box 가 면을 강제**한다. 둘이 부딪히면 후보가 0개가
되어 `null` 이 난다. 그래서 유체는 면을 좁히지 않는다(용도로 이미 걸렀으니 후보가 적다).

## 세 번째 방향 필드 — `connection.direction` (2026-07-13)

위의 두 필드는 "이 유체가 **들어오냐 나가냐**"를 말한다. 둘 다 **어느 면이냐**는 말하지 않는다.
그건 세 번째 필드가 답한다.

```
FluidBoxInfo
 ├─ production_type   ← 게임플레이 용도 (재료냐 결과물이냐)
 └─ connections[]
     ├─ flow_direction ← 물리 흐름 (파이프가 어느 쪽으로 흐르냐)
     └─ direction      ← **면** (이 연결이 머신 밖 어느 쪽으로 뻗냐) 0=N,4=E,8=S,12=W
```

**좌표(`positions`)로 면을 역추정하면 안 된다.** 화학 공장의 유체 상자 좌표는 `(-1,-1)` 처럼
머신 **안쪽 모서리 칸**이라 `|x| = |y|` 이고, 위로 나가는지 옆으로 나가는지 좌표에 정보가 없다.
자세한 사례와 그 대가는 [auto-layout-wizard.trunk-pipe.md §3](../auto-layout/module/trunk-pipe.md)
("유체 상자의 면은 좌표에서 못 뽑는다") 참고.

머신을 `d` 만큼 돌리면 실제 면은 `(direction + d) % 16` 이다. 읽는 규칙은
[`resolveFluidConnection`](../../src/autoLayout/module/fluidPorts.ts) 한 곳에 있다.

## 상자에 들어갈 유체의 **이름** — 그건 머신이 아니라 레시피가 안다 (2026-07-13)

위의 세 필드는 전부 **머신 프로토타입** 쪽 정보다. 그런데 "이 상자에 무슨 유체가 흐르나"는
머신만 봐선 알 수 없다 — 화학 공장의 유체 상자는 `filter` 가 비어 있고, **레시피가 정한다.**

답은 **레시피 쪽 네 번째 필드**에 있다:

- [`FluidIngredientPrototype.fluidbox_index`](https://lua-api.factorio.com/latest/types/FluidIngredientPrototype.html)
- [`FluidProductPrototype.fluidbox_index`](https://lua-api.factorio.com/latest/types/FluidProductPrototype.html)

> "Used to specify which `CraftingMachinePrototype::fluid_boxes` this ingredient should use.
> It will use this one fluidbox. The index is **1-based and separate for input and output fluidboxes**."

**기본값이 `0`(미지정)이고, 그때의 동작이 핵심이다.** 개발자(boskid)가
[포럼](https://forums.factorio.com/viewtopic.php?p=689913)에서 못박은 대로, 미지정이면 그 유체는
해당 역할의 상자 **전부**에 들어갈 수 있다("falling back into usage of all input fluid boxes").

그래서 **화학 공장이 입력 상자를 두 개 갖고 있으면서 유체 하나짜리 레시피(예: 플라스틱)에서
양쪽 다 파이프를 받는다.** 개발자가 든 대비 예시: 경유 분해는 두 입력 상자가 **다른 유체**를
받고(각 재료가 index 를 명시), 윤활유 레시피는 두 상자가 **같은 유체**를 받는다(미지정).

### 규칙

```
상자 하나 → 유체 이름 "하나"가 아니라 이름의 "집합".

  상자에 프로토타입 filter 가 있으면        → 그 유체 하나.
  없으면, 그 상자가 (production_type 별로 따로 세는) 입력 상자 몇 번째인지 구하고:
    fluidbox_index = k 인 재료   → k번 입력 상자에만
    fluidbox_index = 0 인 재료   → 모든 입력 상자에
  산출물과 출력 상자도 똑같이.
```

### 실데이터로 확인한 것 (2026-07-14, 재추출본)

exporter 를 고쳐 `fluidbox_index` 를 뽑은 뒤 실제 게임데이터를 확인했다.

- **미지정이 압도적으로 많다.** 전체 레시피 중 이 필드를 가진 건 **딱 둘**이다. 나머지는
  전부 미지정 → 그 역할의 상자 **전부**에 들어간다. 즉 "상자 하나 → 유체 이름 **집합**"은
  예외가 아니라 **보통**이다.
  - `plastic-bar` 의 석유 가스 → 미지정. 화학 공장의 입력 상자 **둘 다** 받는다.
  - `light-oil-cracking` 의 물·경유 → **둘 다 미지정**. 개발자가 "입력 상자가 갈리는 예"로
    든 레시피인데도 이 데이터(모드팩)에선 안 갈린다. **문서의 예를 데이터라고 믿지 말 것.**
- **위의 "미검증 가정"은 이제 검증됐다.** 필드를 가진 두 레시피가 둘 다 규칙과 맞는다:
  - `basic-oil-processing` 산출물 석유 가스 = `3`. 정유소 상자는 1·2=입력, 3·4·5=출력이니
    "출력끼리 따로 세서 3번째" = 프로토타입 5번 상자 — 바닐라에서 석유 가스가 나오는 그 칸이다.
  - `kr-restore-used-pollution-filter` 재료 물 = `1`. kr-bio-lab 상자는 1·2=입력, 3=출력이니
    "입력끼리 따로 세서 1번째" = 프로토타입 1번 상자.
  - 다만 `basic-oil-processing` 하나만 놓고 보면 "역할별로 센 3번째"와 "배열 전체의 3번째"가
    **같은 칸을 가리켜** 구분이 안 된다. 두 사례를 합쳐야 역할별 계수가 맞는다는 게 보인다.
- **화학 공장의 유체 상자엔 `filter` 가 없다.** 즉 유체 이름은 프로토타입이 아니라
  **레시피에서만** 나온다는 게 다시 확인됐다.

`0` 은 데이터에 절대 안 나온다 — 미지정이면 Lua 가 `nil` 을 주고 JSON 에서 **키가 통째로
빠진다**. 그래서 코드는 `fluidbox_index === 0` 이 아니라 **"없으면 전부"** 로 읽어야 한다.

## 향후 고려 사항

1. **한 fluidbox 내 서로 다른 `flow_direction`을 가진 연결이 있을 경우**: 현재 상세 패널은 `connections[0]`을 대표로 삼음. 여러 방향을 가진 fluidbox가 나타나면 "mixed" 표시로 개선 필요.

2. **`connection_category`** (파이프 연결 카테고리): 현재 추출하지 않음. 일부 mod가 특정 파이프끼리만 연결되게 제한할 때 사용. 필요 시 추가.

3. **`filter`** (고정 유체): 이미 추출 중. 상세 패널에 표시. 해당 연결점이 특정 유체만 허용하는 경우 추가 시각 표현 고려 가능.
