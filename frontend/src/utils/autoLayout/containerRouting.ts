/**
 * 모듈 4 — 라우팅.
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §4 / §7.4 / Q3 / Q4 / Q18.
 *
 * 두 port (producer.port, consumer.port) 사이의 운반체 체인을 BFS 로 깐다.
 * port.kind 에 따라 형식이 갈린다:
 *  - item  : 컨테이너—투입기—벨트(가변길이 ≥ 1)—투입기—컨테이너
 *  - fluid : 컨테이너—파이프 + 지하파이프—컨테이너 (투입기 없음)
 *
 * 본 모듈은 *컨테이너 모델 v2 의 라우팅* 이며, legacy `router.ts` (Lee BFS,
 * item-only) 와 별개의 파일이다 — 이름 충돌을 피하려고
 * `containerRouting.ts` 로 분리. legacy 는 새 위저드 통합 시점에 삭제.
 *
 * 1차 구현 범위: item kind 만. fluid kind / underground 변형은 후속 커밋에서.
 */

import { EntityType, createEmptyCell } from '../../types/layout';
import type { Direction, GridCell } from '../../types/layout';
import type {
  Area,
  ContainerPort,
  PortFace,
  PortKind,
  PortPair,
  PlacedCell,
  RoutePorts,
  Routing,
  RoutingAttempt,
  RoutingKind,
} from './containerModel';

/**
 * 한 port 페어에 대한 운반체 체인을 깐다. 실패 시 RoutingAttempt 의
 * ok=false 로 반환 — 오케스트레이터가 §7.4 fallback 으로 다른 port 페어 시도.
 */
export const routePorts: RoutePorts = (
  pair: PortPair,
  area: Area,
  options: {
    beltEntityName: string;
    inserterEntityName: string;
    pipeEntityName: string;
    undergroundPipeEntityName?: string;
    preferUnderground: boolean;
  },
): RoutingAttempt => {
  const kind = portKindOf(pair);
  if (!kind) {
    return { ok: false, reason: 'no-port-pair', tried: [pair] };
  }

  // 1차 구현: item 만. fluid 는 follow-up.
  if (kind === 'fluid') {
    return { ok: false, reason: 'no-path', tried: [pair] };
  }

  return routeItem(pair, area, options);
};

/**
 * 한 area 의 placed cells 를 occupancy map 으로 변환.
 *
 * 통과 정책 (placement-search §4 / §7.4):
 *  - machine / inserter / belt-fixed / pipe-fixed: 통과 불가.
 *  - belt-route: item routing 만 통과 가능 (현재는 통과 불가로 단순화).
 *  - pipe-route(같은 fluid): fluid routing 만 통과 가능 (1차 미구현).
 *
 * 1차 구현은 *모든 placed cell 을 통과 불가* 로 단순화 — 라우팅이 라우팅 위를
 * 지나는 케이스는 후속 커밋에서 belt-mixing 정책과 함께 도입.
 */
export function buildOccupancy(area: Area): Set<string> {
  const blocked = new Set<string>();
  for (const p of area.placed) {
    blocked.add(cellKey(p.x, p.y));
  }
  return blocked;
}

/**
 * 한 라우팅을 area 에 *적용* — 라우팅의 placed cells 를 area.placed 에 push,
 * area.bbox 갱신.
 */
export function commitRouting(routing: Routing, area: Area): void {
  for (const cell of routing.placed) {
    area.placed.push(cell);
    area.bbox = expandBbox(area.bbox, cell.x, cell.y, 1, 1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// item 라우팅
// ─────────────────────────────────────────────────────────────────────────────

function routeItem(
  pair: PortPair,
  area: Area,
  options: {
    beltEntityName: string;
    inserterEntityName: string;
  },
): RoutingAttempt {
  const occupancy = buildOccupancy(area);

  // 인서터는 port cell 에 앉고, 벨트는 port cell + face 외측 방향에서 시작.
  const producerOut = faceVector(pair.producer.face);
  const consumerOut = faceVector(pair.consumer.face);

  const beltStart = {
    x: pair.producer.cell.x + producerOut.x,
    y: pair.producer.cell.y + producerOut.y,
  };
  const beltEnd = {
    x: pair.consumer.cell.x + consumerOut.x,
    y: pair.consumer.cell.y + consumerOut.y,
  };

  // BFS 시작 전, 인서터·벨트 끝점 셀이 occupancy 와 부딪히지 않는지 확인.
  // (port cell 자체는 occupancy 에 없어야 함 — 인서터가 들어갈 자리).
  if (occupancy.has(cellKey(pair.producer.cell.x, pair.producer.cell.y))) {
    return { ok: false, reason: 'no-path', tried: [pair] };
  }
  if (occupancy.has(cellKey(pair.consumer.cell.x, pair.consumer.cell.y))) {
    return { ok: false, reason: 'no-path', tried: [pair] };
  }

  // beltStart / beltEnd 가 occupancy 에 있으면 즉시 실패 (= 벨트가 못 들어감).
  if (
    occupancy.has(cellKey(beltStart.x, beltStart.y)) ||
    occupancy.has(cellKey(beltEnd.x, beltEnd.y))
  ) {
    return { ok: false, reason: 'no-path', tried: [pair] };
  }

  // 두 인서터 셀 자체도 BFS 통과 금지 (이후 인서터로 채워질 자리).
  const blocked = new Set(occupancy);
  blocked.add(cellKey(pair.producer.cell.x, pair.producer.cell.y));
  blocked.add(cellKey(pair.consumer.cell.x, pair.consumer.cell.y));

  const path = bfs(beltStart, beltEnd, blocked);
  if (!path) {
    return { ok: false, reason: 'no-path', tried: [pair] };
  }

  // 운반체 체인 emit.
  const placed: PlacedCell[] = [];

  // 1) producer 측 인서터 — 컨테이너에서 벨트 방향 (= face 외측) 으로 향함.
  placed.push(makeInserterCell(pair.producer.cell, producerOut, options.inserterEntityName, pair));

  // 2) 벨트 셀들 — 각 셀의 direction 은 *다음 셀로의 진행 방향*.
  for (let i = 0; i < path.length; i++) {
    const here = path[i];
    const next = i + 1 < path.length ? path[i + 1] : null;
    const dir: Direction = next
      ? vectorToDirection(next.x - here.x, next.y - here.y)
      : oppositeFaceVectorAsDirection(pair.consumer.face);
    placed.push(makeBeltCell(here, dir, options.beltEntityName, pair));
  }

  // 3) consumer 측 인서터 — 벨트에서 컨테이너 방향 (= face 내측) 으로 향함.
  placed.push(
    makeInserterCell(
      pair.consumer.cell,
      { x: -consumerOut.x, y: -consumerOut.y },
      options.inserterEntityName,
      pair,
    ),
  );

  const routing: Routing = {
    id: nextRoutingId(),
    kind: 'item',
    from: pair.producer,
    to: pair.consumer,
    placed,
    area: area.kind,
  };
  return { ok: true, routing };
}

// ─────────────────────────────────────────────────────────────────────────────
// BFS 경로 탐색
// ─────────────────────────────────────────────────────────────────────────────

function bfs(
  start: { x: number; y: number },
  end: { x: number; y: number },
  blocked: Set<string>,
): { x: number; y: number }[] | null {
  if (start.x === end.x && start.y === end.y) {
    return [{ ...start }];
  }
  const queue: { x: number; y: number }[] = [start];
  const cameFrom = new Map<string, { x: number; y: number } | null>();
  cameFrom.set(cellKey(start.x, start.y), null);

  const dirs = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.x === end.x && cur.y === end.y) {
      // 경로 복원
      const out: { x: number; y: number }[] = [];
      let node: { x: number; y: number } | null = cur;
      while (node) {
        out.push(node);
        const prev = cameFrom.get(cellKey(node.x, node.y));
        node = prev ?? null;
      }
      return out.reverse();
    }
    for (const d of dirs) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      const k = cellKey(nx, ny);
      if (cameFrom.has(k)) continue;
      // end 셀은 blocked 에 있지 않은 자유 셀이라고 가정 (호출자가 사전 검증).
      // 중간 셀은 blocked 검사.
      if (blocked.has(k) && !(nx === end.x && ny === end.y)) continue;
      cameFrom.set(k, cur);
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 셀 / 방향 유틸
// ─────────────────────────────────────────────────────────────────────────────

function makeInserterCell(
  cell: { x: number; y: number },
  facingVec: { x: number; y: number },
  inserterEntityName: string,
  pair: PortPair,
): PlacedCell {
  const grid: GridCell = {
    ...createEmptyCell(),
    entityId: `r-ins-${pair.producer.containerId}-${pair.consumer.containerId}-${cell.x},${cell.y}`,
    entityName: inserterEntityName,
    entityType: EntityType.Inserter,
    direction: vectorToDirection(facingVec.x, facingVec.y),
    tileOffset: { x: 0, y: 0 },
    isOrigin: true,
  };
  return { x: cell.x, y: cell.y, cell: grid };
}

function makeBeltCell(
  cell: { x: number; y: number },
  direction: Direction,
  beltEntityName: string,
  pair: PortPair,
): PlacedCell {
  const grid: GridCell = {
    ...createEmptyCell(),
    entityId: `r-belt-${pair.producer.containerId}-${pair.consumer.containerId}-${cell.x},${cell.y}`,
    entityName: beltEntityName,
    entityType: EntityType.Belt,
    direction,
    tileOffset: { x: 0, y: 0 },
    isOrigin: true,
  };
  return { x: cell.x, y: cell.y, cell: grid };
}

function faceVector(face: PortFace): { x: number; y: number } {
  switch (face) {
    case 'N': return { x: 0, y: -1 };
    case 'S': return { x: 0, y: 1 };
    case 'E': return { x: 1, y: 0 };
    case 'W': return { x: -1, y: 0 };
  }
}

function oppositeFaceVectorAsDirection(face: PortFace): Direction {
  // consumer 측 마지막 벨트 셀의 진행 방향 = consumer 컨테이너로 들어가는 방향
  // = face 의 *반대* 방향 (face 는 외측을 가리키므로).
  const v = faceVector(face);
  return vectorToDirection(-v.x, -v.y);
}

function vectorToDirection(dx: number, dy: number): Direction {
  if (dx === 0 && dy < 0) return 0;
  if (dx > 0 && dy === 0) return 4;
  if (dx === 0 && dy > 0) return 8;
  if (dx < 0 && dy === 0) return 12;
  // diagonal/zero — fallback to N (방어, 정상 흐름에서는 발생하지 않음)
  return 0;
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

// ─────────────────────────────────────────────────────────────────────────────
// 기타
// ─────────────────────────────────────────────────────────────────────────────

function portKindOf(pair: PortPair): RoutingKind | null {
  return matchKinds(pair.producer.kind, pair.consumer.kind);
}

function matchKinds(a: PortKind, b: PortKind): RoutingKind | null {
  if (a === 'item' && b === 'item') return 'item';
  if (typeof a === 'object' && typeof b === 'object' && a.fluid === b.fluid) return 'fluid';
  return null;
}

let routingIdCounter = 0;
function nextRoutingId(): string {
  routingIdCounter += 1;
  return `routing-${routingIdCounter}`;
}
