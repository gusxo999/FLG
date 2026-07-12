/**
 * 모듈 A — 머신 배치 (내부 영역).
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §5 / §7.2 / Q6.
 *
 * 컨테이너를 내부 영역에 commit 하는 공용 헬퍼를 제공한다. 머신의 좌표 결정
 * 자체는 배치 전략(S-LAYER)이 담당하고, 여기서는 결정된 컨테이너를 셀로 펼쳐
 * `internal.placed`/`bbox` 에 반영한다.
 */

import { EntityType, createEmptyCell } from '../../types/layout';
import type { Direction, GridCell } from '../../types/layout';
import type { Area, Container, PlacedCell } from './containerModel';

/**
 * 컨테이너를 내부 영역에 commit — footprint 셀을 `placed` 에 펼치고 bbox 확장.
 */
export function commitContainer(c: Container, internal: Area): void {
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
    // 머신 회전 — 유체 레시피는 fluid_box 가 원하는 면을 보도록 머신을 돌린다
    // (docs/auto-layout-wizard.trunk-pipe.md §3). 아이템 전용 머신은 늘 0.
    direction: (c.direction ?? 0) satisfies Direction,
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
