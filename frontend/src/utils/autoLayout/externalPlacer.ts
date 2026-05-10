/**
 * 모듈 B — 외부 컨테이너 배치 (임시 자리).
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §3 / §7.1.
 *
 * 무한상자(`infinity-chest`)·무한파이프(`infinity-pipe`) 를 통합 좌표계의
 * *임시 자리* (= consumer 머신 N면 좌상단부터 줄짓기) 에 배치한다. 라우팅
 * BFS 가 이 셀을 occupancy 로 인식해 충돌 회피.
 *
 * **임시 자리** 인 이유: 모든 머신 배치 + 내부 라우팅이 끝나야 *최종 internal
 * bbox* 가 결정되고, 그 bbox 의 perimeter ring 위에 chest 들을 정렬할 수
 * 있다. 정렬은 후처리 단계 `wrapExternalsAroundPerimeter` 가 담당.
 *
 * external 영역에는 컨테이너 메타데이터만 push (placed/bbox 는 internal 이
 * 진실의 근원).
 *
 * 1차 구현 한계:
 *   - L 자형 wrap (N 면 다 차면 W/E/S 면) 미구현 — N 면 위로만 자라남.
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
  const origin = nextDefaultPosition(internal, near);

  const container: Container = {
    id: nextExternalId(spec.kind, idx),
    kind: spec.kind,
    entityName: spec.entityName,
    origin,
    size: { w: 1, h: 1 },
    content: spec.content,
  };

  // external 영역 — 메타데이터만 (placed/bbox 는 internal 이 진실의 근원).
  external.containers.push(container);

  // internal 영역 — ghost cell 로 routing occupancy 갱신 + bbox 확장.
  internal.containers.push(container);
  internal.placed.push(makeContainerCell(container, origin));
  internal.bbox = expandBbox(internal.bbox, origin.x, origin.y, 1, 1);

  return container;
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
 * 컨테이너 셀 1개 생성. `at` 좌표에 박아넣음 — 재배치 시 새 좌표로 셀을 다시
 * 만들기 위해 좌표를 인자로 받는다.
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
