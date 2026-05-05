# Direction 인코딩 — Factorio 2.0 16-방향 정렬

**상태:** 마이그레이션 완료 (2026-04-29). 내부 `Direction` 모델이 Factorio 2.0 의 `defines.direction` 인코딩과 동일한 의미체계로 통일됨.

---

## TL;DR

- 내부 `Direction = 0 | 4 | 8 | 12` (cardinal: N/E/S/W).
- Factorio 2.0 의 `defines.direction` 은 16개 값(0..15). 1/3/5/7/9/11/13/15 는 22.5° 단위 sub-cardinal — 주로 곡선 레일·half-diagonal-rail 표현용. 2/6/10/14 는 8방향 diagonal (NE/SE/SW/NW).
- 1.x 의 8방향 (0..7) → 2.0 의 동일 방위로 ×2 매핑 (정보 손실 없음).
- export/import 모두 2.0 인코딩 native. 1.x 블루프린트는 import 시 자동 업그레이드.

---

## 1. Factorio 의 direction 인코딩 변천

### 1.x — 8방향 (0..7)

| value | 방위 |
|:-:|---|
| 0 | N |
| 1 | NE |
| 2 | E |
| 3 | SE |
| 4 | S |
| 5 | SW |
| 6 | W |
| 7 | NW |

대부분의 cardinal 엔티티(파이프, 펌프, 인서터 …)는 짝수만 사용 (0/2/4/6). 홀수는 8방향 디아고날.

### 2.0 — 16방향 (0..15)

곡선 레일·half-diagonal-rail 추가에 따라 22.5° 단위로 세분화.

| value | 방위 (`defines.direction`) |
|:-:|---|
| 0 | north |
| 1 | northnortheast |
| 2 | northeast |
| 3 | eastnortheast |
| 4 | east |
| 5 | eastsoutheast |
| 6 | southeast |
| 7 | southsoutheast |
| 8 | south |
| 9 | southsouthwest |
| 10 | southwest |
| 11 | westsouthwest |
| 12 | west |
| 13 | westnorthwest |
| 14 | northwest |
| 15 | northnorthwest |

**중요**: 16방향은 *mirror* 가 아니라 **각도 세분화**. 모든 엔티티가 0..15 의 enum 을 공유하지만, 실제로 그 값을 모두 쓰는 건 곡선/half-diagonal 레일뿐. 일반 엔티티(파이프, 인서터, 조립기 등) 는 cardinal 4방향(0/4/8/12)만 사용.

### 1.x → 2.0 매핑 (×2)

| 방위 | 1.x | 2.0 |
|---|:-:|:-:|
| N | 0 | 0 |
| NE | 1 | 2 |
| E | 2 | 4 |
| SE | 3 | 6 |
| S | 4 | 8 |
| SW | 5 | 10 |
| W | 6 | 12 |
| NW | 7 | 14 |

1.x 의 모든 8방향이 2.0 의 짝수 위치에 그대로 옮겨감. **단순 ×2, 정보 손실 없음.**

Factorio 2.0 게임 자체도 1.x 블루프린트 로딩 시 동일하게 ×2 업그레이드한다.

---

## 2. 우리 앱의 내부 모델

```ts
// types/layout.ts
export type Direction = 0 | 4 | 8 | 12;
```

cardinal 4방향만 지원. sub-cardinal(곡선 레일 등) 은 향후 확장 가능하지만 현재 레이아웃 편집기 범위에서는 불필요.

### 회전 단축키 (R)

```ts
// store/layoutStore.ts: rotateSelected
selectedDirection: ((state.selectedDirection + 4) % 16) as Direction
```

순환: 0 → 4 → 8 → 12 → 0.

### 사이즈 회전 (E/W 면 width↔height swap)

```ts
// utils/entitySize.ts: getEntitySizeRotated
if (direction === 4 || direction === 12) {
  return { width: base.height, height: base.width };
}
```

### 벡터 회전 (인서터 pickup/drop, mining drill 결과물 위치)

```ts
// pixi/pixi-manager.ts: rotateVector
case 4:  return { x: -v.y, y:  v.x }; // E (90° cw)
case 8:  return { x: -v.x, y: -v.y }; // S (180°)
case 12: return { x:  v.y, y: -v.x }; // W (270° cw)
default: return { x: v.x, y: v.y };   // N
```

### 단위 벡터 (엔티티가 향하는 방향)

```ts
// pixi/pixi-manager.ts: directionToVec
case 0:  return { x: 0,  y: -1 }; // N
case 4:  return { x: 1,  y: 0  }; // E
case 8:  return { x: 0,  y: 1  }; // S
case 12: return { x: -1, y: 0  }; // W
```

### 파이프 네트워크

```ts
// utils/pipeNetwork.ts
const sides: Direction[] =
  node.entityType === EntityType.Pipe ? [0, 4, 8, 12] : [node.direction];

function oppositeDir(d: Direction): Direction {
  return ((d + 8) % 16) as Direction;
}
```

`positions[]` 인덱싱 (fluid_box `connections[].positions` 4-요소 배열):

```ts
const dirIdx = direction / 4;  // 0=N, 1=E, 2=S, 3=W
```

---

## 3. Boundary 변환 (import/export)

### Export

```ts
// components/Toolbar.tsx
const blueprintStr = exportBlueprint({
  blueprint: {
    ...
    entities,  // entity.direction 은 그대로 0/4/8/12
    version: 562949953421312,  // Factorio 2.0.x.x
  },
});
```

내부 `Direction` 이 이미 2.0 인코딩이므로 추가 변환 없이 직접 출력. `version` 도 2.0 으로 박아 Factorio 가 1.x 자동 업그레이드를 시도하지 않게 함.

이전엔 `version: 281474976710656` (1.0.0.0) 을 박고 Factorio 의 ×2 자동 마이그레이션에 의존하던 hack 이 있었으나 제거됨.

### Import

```ts
// components/Toolbar.tsx: handleImportString → normalizeDir
const FACTORIO_2_VERSION = 562949953421312; // 2 << 48
const isLegacyV1 =
  typeof bp.version === 'number' && bp.version < FACTORIO_2_VERSION;

const normalizeDir = (d: number | undefined): Direction => {
  const raw = d ?? 0;
  const v2 = isLegacyV1 ? raw * 2 : raw;
  // sub-cardinal(곡선 레일 등)은 가장 가까운 cardinal 로 round.
  const card = Math.round(v2 / 4) * 4;
  return (((card % 16) + 16) % 16) as Direction;
};
```

- 1.x 블루프린트: ×2 로 2.0 화 후 cardinal round.
- 2.0 블루프린트: 그대로 cardinal round.
- sub-cardinal 입력(곡선 레일·half-diagonal 등) 은 가장 가까운 N/E/S/W 로 클램프. 현재 우리 모델이 cardinal 만 지원하므로 정보 손실 발생 — 곡선 레일 import 가 의미 있어지면 모델 확장 필요.

---

## 4. localStorage 마이그레이션

기존 사용자 저장본(1.x 인코딩) 은 zustand persist `migrate` 가 자동 처리:

```ts
// store/layoutStore.ts
{
  version: 1,
  migrate: (persisted, fromVersion) => {
    if (fromVersion < 1) {
      // 모든 cell.direction 에 ×2 적용
      ...
    }
    return persisted;
  },
}
```

별도 사용자 액션 불필요. 기존 데이터는 다음 로드 시 자동 변환.

---

## 5. UI 라벨

```ts
// components/Sidebar.tsx
const DIRECTION_LABELS: Record<number, string> = {
  0: 'N',  1: 'NNE', 2: 'NE', 3: 'ENE',
  4: 'E',  5: 'ESE', 6: 'SE', 7: 'SSE',
  8: 'S',  9: 'SSW', 10: 'SW', 11: 'WSW',
  12: 'W', 13: 'WNW', 14: 'NW', 15: 'NNW',
};
```

cardinal 외 라벨은 향후 sub-cardinal 지원 시 자동으로 의미를 가짐.

---

## 6. 향후 확장 여지

| 단계 | 추가 방향 | 대상 엔티티 |
|---|---|---|
| 현재 | 0/4/8/12 (cardinal 4방향) | 일반 엔티티 |
| 8방향 | + 2/6/10/14 (NE/SE/SW/NW) | 8방향 diagonal 인서터, 일부 mod |
| 16방향 | + 1/3/5/7/9/11/13/15 (sub-cardinal) | 곡선 레일, half-diagonal-rail |

확장 시 변경 지점:

1. `types/layout.ts`: `Direction` 타입에 값 추가
2. `entitySize.ts`, `pixi-manager.ts`: 회전 switch 케이스 확장
3. `pipeNetwork.ts`: `dirVec` 에 케이스 추가 (cardinal 만 쓰면 무관)
4. `Sidebar.tsx`: `DIRECTION_LABELS` 는 이미 0..15 전체 정의되어 있어 변경 불필요
5. `Toolbar.tsx` `normalizeDir`: cardinal round 제거 또는 8방향 round 로 완화

---

## 7. 관련 파일

| 파일 | 역할 |
|---|---|
| [frontend/src/types/layout.ts](../frontend/src/types/layout.ts) | `Direction` 타입 정의 |
| [frontend/src/types/blueprint.ts](../frontend/src/types/blueprint.ts) | `BlueprintEntity.direction` 외부 포맷 (0..15) |
| [frontend/src/utils/entitySize.ts](../frontend/src/utils/entitySize.ts) | 사이즈 회전 |
| [frontend/src/utils/pipeNetwork.ts](../frontend/src/utils/pipeNetwork.ts) | 파이프 연결 방향 계산 |
| [frontend/src/pixi/pixi-manager.ts](../frontend/src/pixi/pixi-manager.ts) | 벡터 회전, 단위 벡터, 파이프 모양 그리기 |
| [frontend/src/components/Sidebar.tsx](../frontend/src/components/Sidebar.tsx) | 방향 라벨 UI |
| [frontend/src/components/Toolbar.tsx](../frontend/src/components/Toolbar.tsx) | import `normalizeDir`, export `version` |
| [frontend/src/store/layoutStore.ts](../frontend/src/store/layoutStore.ts) | `rotateSelected`, persist `migrate` |
