/**
 * 모듈 B — 외부 컨테이너 배치 (외부 영역 + 내부 영역).
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §3 / §7.1 / §8.3 /
 * Q23 / Q24.
 *
 * CG2: 외부 입력/출력 무한상자(`infinity-chest`)·무한파이프(`infinity-pipe`)
 * 는 두 영역에 *둘 다 실제 좌표* 로 등록된다:
 *
 *  - **외부 영역** — `Container.externalOrigin` = 외부 좌표계의 (0,0) 부터
 *    1×1 줄짓기 자리. `external.placed` 에 셀 push, `external.bbox` 갱신.
 *    UI 가 외부 영역을 별도 그리드로 표시할 수 있고, 사용자 드래그의 출발점
 *    이 된다.
 *  - **내부 영역** — `Container.origin` = *통합 좌표* (= 통합 후 최종 자리).
 *    `near` 머신의 N면 좌상단부터 줄짓기. `internal.placed` 에 셀 push,
 *    라우팅 BFS 가 그 셀을 occupancy 로 인식해 충돌 회피한다. 블루프린트
 *    export · 그리드 적용은 *이 좌표* 를 진실의 근원으로 삼는다.
 *
 * 두 좌표계의 차이 = `origin - externalOrigin` = 컨테이너별 *통합 평행이동*.
 * 사용자 드래그 시 둘이 같은 delta 로 함께 이동해 invariant 가 유지된다 —
 * 자세한 건 `areaUnification.ts` 의 `dragExternalContainer`.
 *
 * 1차 구현 한계:
 *   - L 자형 wrap (N 면 다 차면 W/E/S 면) 미구현. 위로만 자라남.
 *   - 외부 영역 줄짓기는 단일 행 — 줄바꿈 없음 (사용자 드래그로 재배치 가정).
 */

import { EntityType, createEmptyCell } from '../../types/layout';
import type { Direction, GridCell } from '../../types/layout';
import type {
  Area,
  Container,
  ContainerKind,
  PlacedCell,
} from './containerModel';

/**
 * 외부 컨테이너 1개를 두 영역에 등록한다.
 *
 * 외부 좌표 (= `externalOrigin`) — 외부 영역 단일 행에 (k, 0) 자리. `k` =
 * 외부 영역에 이미 등록된 컨테이너 수.
 *
 * 통합 좌표 (= `origin`) — `near` 머신의 N면 좌상단부터 줄짓기.
 *  - `near` 가 주어지면 그 머신의 N면 (y = near.origin.y - 1) 좌상단부터.
 *  - 한 줄이 다 차면 한 줄 위로 (y -= 1), 최대 64 줄.
 *  - `near` 가 없거나 그 줄이 다 차면 내부 bbox 좌상단 위로 fallback.
 *  - 내부 bbox 가 비어있으면 (5, 4) — root (5,5) 바로 위.
 *
 * spec.content 는 컨테이너의 `content` 필드에 저장되어 후속 라우팅·블루프린트
 * export 단계에서 port.kind 매칭 / `infinity_settings.filters` 작성에 쓰인다.
 */
export function placeExternalContainer(
  spec: { kind: 'infinity-chest' | 'infinity-pipe'; entityName: string; content: string },
  external: Area,
  internal: Area,
  near?: Container,
): Container {
  const idx = external.containers.length;
  const externalCoord = nextExternalRowPosition(external);
  const unifiedCoord = nextDefaultPosition(internal, near);

  const container: Container = {
    id: nextExternalId(spec.kind, idx),
    kind: spec.kind,
    entityName: spec.entityName,
    origin: unifiedCoord,
    externalOrigin: externalCoord,
    size: { w: 1, h: 1 },
    content: spec.content,
  };

  // 외부 영역 등록 — 외부 좌표계의 실제 자리 (placed + bbox).
  external.containers.push(container);
  external.placed.push(makeContainerCell(container, externalCoord));
  external.bbox = expandBbox(external.bbox, externalCoord.x, externalCoord.y, 1, 1);

  // 내부 영역 등록 — 통합 좌표계의 실제 자리 (placed + bbox). 라우팅 occupancy
  // 가 이 셀을 통과 불가로 인식한다.
  internal.containers.push(container);
  internal.placed.push(makeContainerCell(container, unifiedCoord));
  internal.bbox = expandBbox(internal.bbox, unifiedCoord.x, unifiedCoord.y, 1, 1);

  return container;
}

// ─────────────────────────────────────────────────────────────────────────────
// 외부 좌표 — 단일 행 (k, 0) 줄짓기
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 외부 영역의 다음 빈 자리. 단일 행 (y = 0) 에서 x = 0, 1, 2, ... 순으로
 * 비어있는 첫 셀. 모든 외부 컨테이너는 1×1 이라고 가정.
 *
 * 줄바꿈은 1차 미구현 — 사용자 드래그로 재배치 가능하므로 정렬을 알고리즘이
 * 강제하지 않음.
 */
function nextExternalRowPosition(external: Area): { x: number; y: number } {
  const occupied = new Set<string>();
  for (const p of external.placed) occupied.add(`${p.x},${p.y}`);
  for (let x = 0; ; x++) {
    if (!occupied.has(`${x},0`)) return { x, y: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 통합 좌표 — 머신 N면 좌상단 줄짓기 (한 줄 차면 위로)
// ─────────────────────────────────────────────────────────────────────────────

function nextDefaultPosition(
  internal: Area,
  near?: Container,
): { x: number; y: number } {
  const occupied = new Set<string>();
  for (const p of internal.placed) {
    occupied.add(`${p.x},${p.y}`);
  }

  // 1) near 머신이 있으면 그 머신의 N면부터.
  if (near) {
    const x0 = near.origin.x;
    const xEnd = near.origin.x + near.size.w;
    for (let dy = 1; dy <= 64; dy++) {
      const y = near.origin.y - dy;
      for (let x = x0; x < xEnd; x++) {
        if (!occupied.has(`${x},${y}`)) return { x, y };
      }
    }
  }

  // 2) fallback — 내부 bbox 좌상단부터 줄짓기.
  const bbox = internal.bbox;
  if (!bbox) {
    return { x: 5, y: 4 };
  }
  for (let dy = 1; dy <= 64; dy++) {
    const y = bbox.y - dy;
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      if (!occupied.has(`${x},${y}`)) return { x, y };
    }
  }
  // 안전망 — 정상 흐름에서는 도달하지 않음.
  return { x: bbox.x, y: bbox.y - 65 };
}

// ─────────────────────────────────────────────────────────────────────────────
// 셀 / id / bbox 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function nextExternalId(kind: ContainerKind, n: number): string {
  return `ext-${kind === 'infinity-chest' ? 'chest' : 'pipe'}-${n}`;
}

/**
 * 컨테이너 셀 1개 생성. `at` 좌표에 박아넣음 — 두 영역에 서로 다른 좌표로
 * 동일 컨테이너 셀을 push 하기 위해 좌표를 인자로 받는다.
 */
export function makeContainerCell(c: Container, at: { x: number; y: number }): PlacedCell {
  const cell: GridCell = {
    ...createEmptyCell(),
    entityId: c.id,
    entityName: c.entityName,
    entityType: c.kind === 'infinity-chest' ? EntityType.InfinityChest : EntityType.InfinityPipe,
    direction: 0 satisfies Direction,
    tileOffset: { x: 0, y: 0 },
    isOrigin: true,
  };
  return { x: at.x, y: at.y, cell };
}

export function expandBbox(
  bbox: Area['bbox'],
  x: number,
  y: number,
  w: number,
  h: number,
): NonNullable<Area['bbox']> {
  if (!bbox) return { x, y, w, h };
  const minX = Math.min(bbox.x, x);
  const minY = Math.min(bbox.y, y);
  const maxX = Math.max(bbox.x + bbox.w, x + w);
  const maxY = Math.max(bbox.y + bbox.h, y + h);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
