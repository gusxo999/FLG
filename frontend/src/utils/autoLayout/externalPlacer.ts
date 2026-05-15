/**
 * 모듈 B — 외부 컨테이너 배치.
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §3 / §7.1.
 *
 * 무한상자(`infinity-chest`)·무한파이프(`infinity-pipe`) 를 통합 좌표계의
 * *기본 자리* (= machine + routing bbox 의 perimeter ring) 에 배치한다.
 *
 * 위치 결정은 두 함수만 담당한다:
 *   1. `placeExternalContainer` → `nextDefaultPosition` — 최초 배치 (perimeter ring 위)
 *   2. `dragExternalContainer` (areaUnification) — 사용자 드래그 (자유 배치)
 *
 * external 영역에는 컨테이너 메타데이터만 push (placed/bbox 는 internal 이
 * 진실의 근원).
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
 * 기본 자리 = machine + routing bbox 의 perimeter ring 위 첫 번째 빈 셀.
 *  - `near` 가 주어지면 그 머신의 origin 에 manhattan 가장 가까운 perimeter 셀.
 *  - bbox 가 없으면 (5, 4) — root (5,5) 바로 위 fallback.
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
  const origin = nextDefaultPosition(internal, external, near);

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
// 기본 자리 — machine + routing bbox 의 perimeter ring 위
// ─────────────────────────────────────────────────────────────────────────────

function nextDefaultPosition(
  internal: Area,
  external: Area,
  near?: Container,
): { x: number; y: number } {
  const machineBbox = computeMachineBbox(internal, external);

  if (!machineBbox) {
    return { x: 5, y: 4 };
  }

  const ring = perimeterRing(machineBbox);
  const occupied = new Set<string>();
  for (const p of internal.placed) occupied.add(`${p.x},${p.y}`);

  if (near) {
    const sorted = ring.slice().sort((a, b) => {
      const da = Math.abs(a.x - near.origin.x) + Math.abs(a.y - near.origin.y);
      const db = Math.abs(b.x - near.origin.x) + Math.abs(b.y - near.origin.y);
      return da - db;
    });
    for (const c of sorted) {
      if (!occupied.has(`${c.x},${c.y}`)) return c;
    }
  }

  for (const c of ring) {
    if (!occupied.has(`${c.x},${c.y}`)) return c;
  }

  // 안전망 — perimeter 가 모두 점유된 경우: bbox 위로 확장.
  return { x: machineBbox.x, y: machineBbox.y - 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼 — bbox / perimeter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 머신 + 라우팅 셀의 bbox. 이미 배치된 chest ghost 셀은 제외 — perimeter 계산
 * 시 chest 자신을 기준에서 빼야 하기 때문.
 */
function computeMachineBbox(
  internal: Area,
  external: Area,
): { x: number; y: number; w: number; h: number } | undefined {
  const externalIds = new Set<string>();
  for (const c of external.containers) externalIds.add(c.id);

  let bbox: Area['bbox'] = undefined;
  for (const p of internal.placed) {
    if (p.cell.entityId && externalIds.has(p.cell.entityId)) continue;
    bbox = expandBbox(bbox, p.x, p.y, 1, 1);
  }
  return bbox;
}

/**
 * bbox 의 1-cell 두께 perimeter ring. 시계 방향 N → E → S → W.
 */
function perimeterRing(
  bbox: { x: number; y: number; w: number; h: number },
): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  const x0 = bbox.x;
  const y0 = bbox.y;
  const x1 = bbox.x + bbox.w - 1;
  const y1 = bbox.y + bbox.h - 1;

  for (let x = x0 - 1; x <= x1 + 1; x++) cells.push({ x, y: y0 - 1 });
  for (let y = y0; y <= y1; y++) cells.push({ x: x1 + 1, y });
  for (let x = x1 + 1; x >= x0 - 1; x--) cells.push({ x, y: y1 + 1 });
  for (let y = y1; y >= y0; y--) cells.push({ x: x0 - 1, y });
  return cells;
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
