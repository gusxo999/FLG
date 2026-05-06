/**
 * 모듈 A — 머신 배치 (내부 영역).
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §5 / §7.2 / Q6.
 *
 * 부모 머신과 자식 머신의 상대 위치 (오른쪽 / 아래쪽) 를 받아 자식의 origin
 * 좌표를 결정한다. 부모와 *벨트 길이 ≥ 1* 만 확보하도록 인접 배치 —
 * 즉 자식과 부모 footprint 사이의 거리는 라우팅 형식의 최소 거리에 맞춘다.
 *
 * 하향식: 최상위 머신은 (5, 5) 에 배치하고 (placement-search §3 내부 영역
 * 좌표 기준점), 그 아래 자식·손자가 본 함수의 재귀 호출로 따라온다.
 */

import { EntityType, createEmptyCell } from '../../types/layout';
import type { Direction, GridCell } from '../../types/layout';
import type { Area, Container, PlaceMachine, PlacedCell } from './containerModel';

/**
 * 부모-자식 사이의 최소 gap (= 라우팅 형식의 최소 길이).
 *
 * item 라우팅: 컨테이너—투입기(1)—벨트(≥1)—투입기(1)—컨테이너 = gap 3.
 * fluid 라우팅: 컨테이너—파이프(≥1)—컨테이너 = gap 1.
 *
 * 머신 배치 시점에는 어느 라우팅이 들어올지 미정 (recipe 에 item·fluid 가
 * 섞여 있을 수도). 보수적으로 *큰 쪽* (item, gap 3) 에 맞춘다 — fluid 라우팅은
 * 그 안에 충분히 들어온다.
 */
const ROUTING_GAP = 3;

/** 최상위 머신의 좌표 — placement-search §3 내부 영역 좌표 기준점. */
const ROOT_ORIGIN = { x: 5, y: 5 } as const;

/**
 * 자식 머신을 부모 옆에 배치 (오른쪽 또는 아래쪽).
 *
 * 정렬:
 *  - dir='right': 자식의 y = 부모의 y (top-aligned). x = 부모.x + 부모.w + GAP.
 *  - dir='down' : 자식의 x = 부모의 x (left-aligned). y = 부모.y + 부모.h + GAP.
 *
 * 충돌 시 null. mutate 는 성공한 경우에만.
 */
export const placeMachine: PlaceMachine = (
  parent: Container,
  child: Container,
  dir: 'right' | 'down',
  internal: Area,
): Container | null => {
  const placed: Container = {
    ...child,
    origin: computeChildOrigin(parent, dir),
  };
  if (!canPlace(placed, internal)) return null;
  commitContainer(placed, internal);
  return placed;
};

/**
 * 최상위 머신을 내부 영역 (5, 5) 에 배치. 부모가 없는 경우 (트리 root) 사용.
 *
 * (5, 5) 가 다른 셀과 충돌하면 (= 빈 영역에 root 를 두는 정상 흐름이 아니면)
 * null. 보통 첫 호출이라 충돌은 일어나지 않지만 방어적으로 검사.
 */
export function placeRootMachine(
  machine: Container,
  internal: Area,
): Container | null {
  const placed: Container = { ...machine, origin: { ...ROOT_ORIGIN } };
  if (!canPlace(placed, internal)) return null;
  commitContainer(placed, internal);
  return placed;
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function computeChildOrigin(
  parent: Container,
  dir: 'right' | 'down',
): { x: number; y: number } {
  if (dir === 'right') {
    return {
      x: parent.origin.x + parent.size.w + ROUTING_GAP,
      y: parent.origin.y,
    };
  }
  return {
    x: parent.origin.x,
    y: parent.origin.y + parent.size.h + ROUTING_GAP,
  };
}

function canPlace(c: Container, internal: Area): boolean {
  const occupied = new Set<string>();
  for (const p of internal.placed) {
    occupied.add(cellKey(p.x, p.y));
  }
  for (let dy = 0; dy < c.size.h; dy++) {
    for (let dx = 0; dx < c.size.w; dx++) {
      const k = cellKey(c.origin.x + dx, c.origin.y + dy);
      if (occupied.has(k)) return false;
    }
  }
  return true;
}

function commitContainer(c: Container, internal: Area): void {
  internal.containers.push(c);
  for (let dy = 0; dy < c.size.h; dy++) {
    for (let dx = 0; dx < c.size.w; dx++) {
      internal.placed.push(makeMachineCell(c, dx, dy));
    }
  }
  internal.bbox = expandBbox(internal.bbox, c.origin.x, c.origin.y, c.size.w, c.size.h);
}

function makeMachineCell(c: Container, dx: number, dy: number): PlacedCell {
  const cell: GridCell = {
    ...createEmptyCell(),
    entityId: c.id,
    entityName: c.entityName,
    entityType: machineEntityType(c.entityName),
    direction: 0 satisfies Direction,
    tileOffset: { x: dx, y: dy },
    isOrigin: dx === 0 && dy === 0,
    recipe: c.recipeName,
  };
  return { x: c.origin.x + dx, y: c.origin.y + dy, cell };
}

/**
 * 컨테이너 entityName 을 EntityType 으로 매핑. 무한상자/무한파이프는 별도
 * EntityType, 그 외는 일단 Assembler 로 (1차 구현; 후속에 furnace/silo 분기 추가).
 */
function machineEntityType(entityName: string): GridCell['entityType'] {
  if (entityName === 'infinity-chest') return EntityType.InfinityChest;
  if (entityName === 'infinity-pipe') return EntityType.InfinityPipe;
  return EntityType.Assembler;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function expandBbox(
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
