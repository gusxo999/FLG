# MapPosition 파싱 및 정규화 전략

**작성일**: 2026-04-25
**관련 이슈**: `EntityDetails.tsx:93 Uncaught TypeError: Cannot read properties of undefined (reading 'toFixed')`
**영향 범위**: Lua export, 프론트엔드 파서, 렌더링 전반 (inserter/mining vector, collision_box, fluid connection points)

---

## 한 줄 요약

Factorio의 `MapPosition`은 **keyed** 또는 **positional** 두 형태로 올 수 있어 JSON 왕복 중 `{}`로 깨지는 사례가 발생한다. **Lua 추출 → JSON 파싱 → 렌더링의 3지점에서 각각 정규화/방어**하여 단일 실패점을 없앴다.

---

## 배경

Factorio 런타임 API의 `MapPosition` 타입은 다음 **두 가지 형태 중 하나**로 표현된다:

```lua
-- Keyed 형태
{ x = 1.5, y = -0.5 }

-- Positional 형태 (배열처럼)
{ 1.5, -0.5 }   -- [1] = x, [2] = y
```

둘 다 유효한 `MapPosition`이며, 어느 쪽으로 올지는 **API 호출마다 일관되지 않다**. 어떤 mod나 엔티티 타입은 positional만 반환하기도 한다.

### 증상

```javascript
// 프론트엔드 EntityDetails.tsx:93
`(${entity.vector_to_place_result.x.toFixed(1)}, ${entity.vector_to_place_result.y.toFixed(1)})`
//                                ^^^ Cannot read properties of undefined
```

`vector_to_place_result`는 truthy였지만 `.x`가 undefined였다.

### 근본 원인

이전 Lua 코드:

```lua
-- 이전 (순진한 버전)
if v then ent.vector_to_place_result = { x = v.x, y = v.y } end
```

만약 `v`가 positional 형태(`{1.5, -0.5}`)면:
1. `v.x`, `v.y`는 **nil** (positional 테이블에는 `x`, `y` 키 없음)
2. Lua 테이블 `{x=nil, y=nil}`은 **빈 테이블과 동치**
3. `helpers.table_to_json({})`의 결과는 **`{}`** 또는 **`[]`**
4. 프론트엔드는 truthy 객체를 받고 `.x` 접근 → 크래시

---

## 3지점 방어 전략

하나의 지점만 고치면 취약하다. Lua에서 실패하더라도 프론트엔드 파서/렌더링에서 붙잡히도록 **3중 방어선**을 구축했다.

```
┌─────────────────────────────────────────────────────────────────┐
│ Factorio runtime                                                │
│   ↓ (MapPosition as {x=n,y=n} or {[1]=n,[2]=n})                 │
│                                                                 │
│ [1] Lua 정규화 — vec2() 헬퍼                                    │
│   → JSON 출력 전에 항상 {x: number, y: number} 형태로 강제      │
│   → 실패 시 nil 반환 (해당 필드 자체를 안 씀)                   │
│                                                                 │
│   ↓ factorio-data.json                                          │
│                                                                 │
│ [2] 프론트엔드 파서 — normalizeVec2()                           │
│   → localStorage에 캐시된 과거 포맷(버그 있던 시절)도 구제      │
│   → 실패 시 undefined 반환                                      │
│                                                                 │
│   ↓ Entity (in-memory)                                          │
│                                                                 │
│ [3] 렌더링 가드 — isValidVec(), typeof x === 'number'           │
│   → stale 데이터가 통과했을 때도 크래시 대신 무시                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

각 방어선은 **상호 보완**이지 **중복이 아니다**:

| 방어선 | 핵심 역할 | 제거 시 위험 |
|--------|----------|------------|
| [1] Lua 정규화 | 앞으로 생성되는 데이터의 품질 보장 | positional 포맷이 그대로 JSON으로 흘러감 |
| [2] 파서 정규화 | 이미 저장된(stale) 데이터 구제 + 외부 JSON 호환성 | 구버전 localStorage 캐시가 있는 사용자 모두 크래시 |
| [3] 렌더링 가드 | 예상 못한 edge case의 최후 방어선 | 파서에서 놓친 한 건이 앱 전체를 흰 화면으로 |

---

## 구현 세부

### [1] Lua `vec2()` 헬퍼

[scripts/export-gamedata.lua](../scripts/export-gamedata.lua):

```lua
-- Factorio는 {x=n, y=n} 또는 positional {[1]=n, [2]=n} 형태를 모두 쓴다.
local function vec2(v)
  if not v or type(v) ~= "table" then return nil end
  local x = v.x
  local y = v.y
  if x == nil then x = v[1] end
  if y == nil then y = v[2] end
  if type(x) ~= "number" or type(y) ~= "number" then return nil end
  return { x = x, y = y }
end
```

**적용 대상** (모든 MapPosition 필드):
- `collision_box.left_top`, `collision_box.right_bottom`
- `inserter_pickup_position`, `inserter_drop_position`
- `vector_to_place_result` (mining drill)
- `fluid_boxes[].connections[].positions[]` (4방향 모두)

**호출 패턴**:
```lua
ent.vector_to_place_result = vec2(safe_get(function() return e.vector_to_place_result end))
```
- `safe_get`으로 접근 에러(타입별 제약) 방지
- `vec2`로 형태 정규화
- 실패 시 nil → JSON 필드 자체가 빠짐

### [2] 프론트엔드 `normalizeVec2()`

[frontend/src/utils/parseGameData.ts](../frontend/src/utils/parseGameData.ts):

```typescript
/**
 * MapPosition 형태 검증 후 정규화.
 * Factorio JSON에는 {x,y} 또는 [x,y] 또는 잘못된 {} 도 올 수 있음.
 */
function normalizeVec2(v: unknown): Vec2 | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const obj = v as Record<string | number, unknown>;
  const x = obj.x ?? obj[0];
  const y = obj.y ?? obj[1];
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  return { x, y };
}

function normalizeCollisionBox(cb: unknown): CollisionBox | undefined {
  if (!cb || typeof cb !== 'object') return undefined;
  const obj = cb as Record<string, unknown>;
  const lt = normalizeVec2(obj.lt);
  const rb = normalizeVec2(obj.rb);
  if (!lt || !rb) return undefined;
  return { lt, rb };
}
```

**중요**: 이 함수들은 파싱 시점에 호출되므로, 새로운 데이터가 들어올 때마다 정규화된다. 과거 버그로 localStorage에 저장된 손상된 데이터도 재파싱 시 자동 정리된다.

### [3] 렌더링 가드

[frontend/src/pixi/pixi-manager.ts](../frontend/src/pixi/pixi-manager.ts):

```typescript
function isValidVec(v: { x: number; y: number } | null | undefined): v is { x: number; y: number } {
  return !!v && typeof v.x === 'number' && typeof v.y === 'number';
}

// 사용
if (isValidVec(entity?.inserter_pickup_position)) {
  const rot = rotateVector(entity!.inserter_pickup_position!, direction);
  // ... 안전하게 .x, .y 접근
}
```

[frontend/src/components/EntityDetails.tsx](../frontend/src/components/EntityDetails.tsx):

```tsx
{entity.vector_to_place_result && typeof entity.vector_to_place_result.x === 'number' && (
  <Row value={`(${entity.vector_to_place_result.x.toFixed(1)}, ...)`} />
)}
```

---

## 설계 원칙

### 원칙 1 — "깨진 필드는 **조용히 생략**, 크래시하지 않는다"

레이아웃 편집기에서 한 엔티티의 드롭 위치 표시가 빠진다고 치명적이지 않다. 반면 크래시는 전체 기능을 멈춘다.

→ 실패 시 `nil`/`undefined`로 fallthrough. 조건부 렌더링으로 해당 row/시각화만 빠짐.

### 원칙 2 — "가장 가까운 지점에서 1차 방어, 더 멀리서 2·3차 방어"

단일 지점 방어는 그 지점의 버그에 취약하다. **각 경계(trust boundary)에서 재검증**:

- Lua → JSON 경계
- JSON → in-memory 경계
- in-memory → 렌더링 경계

### 원칙 3 — "타입 시스템만으로는 부족하다"

TypeScript는 `Vec2 | undefined`를 강제하지만, 런타임에서 `{x: undefined, y: undefined}`로 들어오는 객체는 타입 검증을 **통과하고도** `.x` 접근 시 undefined. 런타임 가드(`typeof x === 'number'`)가 필요한 이유.

---

## 실패 케이스 사례

이 방어 전략이 붙잡은 (또는 피한) 실제 시나리오:

| 시나리오 | 어느 방어선에서 막힘 |
|---------|------------------|
| 새 mod가 positional MapPosition을 반환 | [1] Lua 정규화 |
| 과거 버그 있던 포맷으로 저장된 localStorage 캐시 | [2] 파서 정규화 |
| Factorio 업데이트로 새 필드가 unexpected 형태를 반환 | [3] 렌더링 가드 |
| mod가 floating point 아닌 `false`/문자열을 반환 | [1] + [2] (`typeof === 'number'` 체크) |

---

## 다른 선택지는 없었나?

| 대안 | 결론 |
|------|------|
| Lua에서만 정규화 | ❌ localStorage 캐시된 stale 데이터를 구제 못 함 |
| 프론트엔드에서만 정규화 | ❌ 항상 모든 필드에 검증 코드 반복, 실수로 누락 가능 |
| Zod 같은 런타임 스키마 검증 도입 | △ 과잉 — Vec2는 단순 구조, 의존성 추가 비용 > 이득 |
| 타입 가드 대신 try/catch | ❌ 크래시는 막지만 디버깅 어려움, 의도가 불명확 |
| **3중 방어 (현재 방식)** | **✓ 각 경계에서 독립 검증, 명시적, 단순** |

---

## 구현 위치 요약

| 레이어 | 파일 | 함수 |
|--------|------|------|
| [1] Lua 정규화 | [scripts/export-gamedata.lua](../scripts/export-gamedata.lua) | `vec2()` |
| [1] Lua 정규화 (min) | [scripts/export-gamedata.min.lua](../scripts/export-gamedata.min.lua) | `V2()` |
| [2] 파서 정규화 | [frontend/src/utils/parseGameData.ts](../frontend/src/utils/parseGameData.ts) | `normalizeVec2()`, `normalizeCollisionBox()`, `parseFluidBoxes()` |
| [3] 렌더링 가드 | [frontend/src/pixi/pixi-manager.ts](../frontend/src/pixi/pixi-manager.ts) | `isValidVec()` |
| [3] 렌더링 가드 | [frontend/src/components/EntityDetails.tsx](../frontend/src/components/EntityDetails.tsx) | inline `typeof x === 'number'` |

---

## 향후 고려 사항

1. **`BoundingBox`, `Vector3D` 등 유사 구조**: 같은 문제 잠재. 새로운 필드 추가 시 `vec2()` 스타일 헬퍼로 감쌀 것.

2. **배열 형태 `Vec2[]`**: `conn.positions`가 이미 이 패턴. 배열 내부 각 요소를 `normalizeVec2`로 필터링하여 이미 처리 중.

3. **direction 필드**: `defines.direction`은 Factorio 2.0 16-방향 인코딩 (integer 0..15). 우리 내부 `Direction` 은 cardinal 4방향만 사용 (`0 | 4 | 8 | 12`). mod 이상치 또는 sub-cardinal(곡선 레일 등) 입력은 `Toolbar.tsx` 의 `normalizeDir` 에서 가장 가까운 cardinal 로 round. 자세한 의미는 [direction-encoding.md](direction-encoding.md).

4. **타입 시스템 강화 검토**: 현재 `Entity` 타입의 optional 필드들은 모두 `| undefined`. branded type (`type ValidVec2 = Vec2 & { readonly __brand: 'valid' }`)으로 강제하는 건 오버엔지니어링. 지금 방식 유지.
