/**
 * 모듈 B — 외부 컨테이너 등록 (배치 지연).
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §3 / §7.1.
 *
 * `placeExternalContainer` 는 무한상자/무한파이프를 두 영역의 containers 에만
 * 등록한다. ghost cell · placed · bbox 는 추가하지 않는다.
 *
 * 실제 perimeter 배치 + 라우팅은 모든 머신 배치 완료 후
 * `wrapExternalsAroundPerimeter` (areaUnification) 이 전담한다.
 */

import { EntityType, createEmptyCell } from "../../types/layout";
import type { Direction, GridCell } from "../../types/layout";
import type {
  Area,
  Container,
  ContainerKind,
  PlacedCell,
} from "./containerModel";

/**
 * 외부 컨테이너 1개를 두 영역의 containers 에 등록한다.
 *
 * ghost cell / placed / bbox 는 `wrapExternalsAroundPerimeter` 가 추가한다.
 * spec.content 는 후속 라우팅·블루프린트 export 단계에서 사용된다.
 */
export function placeExternalContainer(
  spec: {
    kind: "infinity-chest" | "infinity-pipe";
    entityName: string;
    content: string;
  },
  external: Area,
  internal: Area,
): Container {
  const idx = external.containers.length;

  const container: Container = {
    id: nextExternalId(spec.kind, idx),
    kind: spec.kind,
    entityName: spec.entityName,
    origin: { x: 0, y: 0 }, // wrapExternalsAroundPerimeter 이 최종 위치로 덮어쓴다.
    size: { w: 1, h: 1 },
    content: spec.content,
  };

  external.containers.push(container);
  internal.containers.push(container);

  return container;
}

// ─────────────────────────────────────────────────────────────────────────────
// 셀 / id / bbox 헬퍼 (areaUnification 에서도 import 해 사용)
// ─────────────────────────────────────────────────────────────────────────────

function nextExternalId(kind: ContainerKind, n: number): string {
  return `ext-${kind === "infinity-chest" ? "chest" : "pipe"}-${n}`;
}

/**
 * 컨테이너 셀 1개 생성. `at` 좌표에 박아넣음.
 */
export function makeContainerCell(
  c: Container,
  at: { x: number; y: number },
): PlacedCell {
  const cell: GridCell = {
    ...createEmptyCell(),
    entityId: c.id,
    entityName: c.entityName,
    entityType:
      c.kind === "infinity-chest"
        ? EntityType.InfinityChest
        : EntityType.InfinityPipe,
    direction: 0 satisfies Direction,
    tileOffset: { x: 0, y: 0 },
    isOrigin: true,
  };
  return { x: at.x, y: at.y, cell };
}

export function expandBbox(
  bbox: Area["bbox"],
  x: number,
  y: number,
  w: number,
  h: number,
): NonNullable<Area["bbox"]> {
  if (!bbox) return { x, y, w, h };
  const minX = Math.min(bbox.x, x);
  const minY = Math.min(bbox.y, y);
  const maxX = Math.max(bbox.x + bbox.w, x + w);
  const maxY = Math.max(bbox.y + bbox.h, y + h);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
