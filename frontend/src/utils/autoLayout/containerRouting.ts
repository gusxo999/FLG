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
  PortFace,
  PortKind,
  PortPair,
  PlacedCell,
  RoutePorts,
  Routing,
  RoutingAttempt,
  RoutingKind,
  UndergroundCorridor,
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
  extra?: Area,
): RoutingAttempt => {
  const kind = portKindOf(pair);
  if (!kind) {
    return { ok: false, reason: 'no-port-pair', tried: [pair] };
  }
  if (kind === 'fluid') {
    return routeFluid(pair, area, options, extra);
  }
  return routeItem(pair, area, options, extra);
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
export function buildOccupancy(area: Area, extra?: Area): Set<string> {
  const blocked = new Set<string>();
  for (const p of area.placed) {
    blocked.add(cellKey(p.x, p.y));
  }
  if (extra) {
    for (const p of extra.placed) {
      blocked.add(cellKey(p.x, p.y));
    }
  }
  return blocked;
}

/**
 * 한 라우팅을 area 에 *적용* — 라우팅의 placed cells 를 area.placed 에 push.
 * 라우팅이 깐 지하 corridor 도 area.undergroundCorridors 로 옮긴다
 * (다음 라우팅의 Dijkstra 가 점프 edge 검증에 참조).
 *
 * area.bbox 는 갱신하지 않는다 — bbox 는 머신 footprint 만 반영한다.
 * 라우팅 셀이 bbox 를 밀어내면 O1 squareness 점수가 왜곡되고,
 * chest perimeter 위치도 머신에서 불필요하게 멀어진다.
 */
export function commitRouting(routing: Routing, area: Area): void {
  for (const cell of routing.placed) {
    area.placed.push(cell);
  }
  for (const c of routing.corridors) {
    area.undergroundCorridors.push({ ...c, range: [c.range[0], c.range[1]] });
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
    undergroundBeltEntityName?: string;
    beltMaxUndergroundDistance?: number;
  },
  extra?: Area,
): RoutingAttempt {
  const occupancy = buildOccupancy(area, extra);

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

  // 단일 인서터 모드 — 두 port cell 이 같은 셀에서 만나는 코너 케이스 (= 두
  // 컨테이너가 1 셀 gap 으로 직선상 배치되어 그 gap 셀이 양쪽 모두의 port cell).
  // 이 케이스에서는 벨트 없이 인서터 1 개로 양쪽 컨테이너 직결. 따라서 일반 사전
  // 검사 (beltStart/beltEnd) 를 거치지 않고 *분기 앞* 에서 직접 처리해야 한다 —
  // 그렇지 않으면 beltStart = producer.cell + producerOut 이 consumer 컨테이너
  // 점유 셀이라 사전 검사가 fail 시킨다.
  //  - producer face 와 consumer face 가 opposite (벡터 합 = 0) → 인서터 1 개.
  //    pickup = producer 쪽, drop = consumer 쪽. 벨트 0.
  //  - 그 외 (perpendicular / same face) → 인서터 1 개로 처리 불가. fallback.
  if (
    pair.producer.cell.x === pair.consumer.cell.x &&
    pair.producer.cell.y === pair.consumer.cell.y
  ) {
    const opposite =
      producerOut.x + consumerOut.x === 0 && producerOut.y + consumerOut.y === 0;
    if (!opposite) {
      return { ok: false, reason: 'no-path', tried: [pair] };
    }
    // 인서터 셀 자체가 점유되어 있으면 fail.
    if (occupancy.has(cellKey(pair.producer.cell.x, pair.producer.cell.y))) {
      return { ok: false, reason: 'no-path', tried: [pair] };
    }
    const routingId = nextRoutingId();
    const inserter = makeInserterCell(
      pair.producer.cell,
      { x: -producerOut.x, y: -producerOut.y },
      options.inserterEntityName,
      pair,
    );
    const routing: Routing = {
      id: routingId,
      kind: 'item',
      from: pair.producer,
      to: pair.consumer,
      placed: [{ ...inserter, cell: { ...inserter.cell, entityId: routingId } }],
      corridors: [],
    };
    return { ok: true, routing };
  }

  // 사전 검사 — 인서터·벨트 끝점 셀이 occupancy 와 부딪히지 않는지 확인.
  if (occupancy.has(cellKey(pair.producer.cell.x, pair.producer.cell.y))) {
    return { ok: false, reason: 'no-path', tried: [pair] };
  }
  if (occupancy.has(cellKey(pair.consumer.cell.x, pair.consumer.cell.y))) {
    return { ok: false, reason: 'no-path', tried: [pair] };
  }
  if (
    occupancy.has(cellKey(beltStart.x, beltStart.y)) ||
    occupancy.has(cellKey(beltEnd.x, beltEnd.y))
  ) {
    return { ok: false, reason: 'no-path', tried: [pair] };
  }

  // 인서터-인서터 인접 충돌 — 한쪽 인서터 셀이 다른 쪽 인서터의 벨트 끝점이면
  // 한 인서터의 pickup/drop 이 다른 인서터에 박혀 invalid. fallback 이 더 멀리
  // 떨어진 port 페어를 다시 시도하도록 즉시 fail.
  if (
    (pair.producer.cell.x === beltEnd.x && pair.producer.cell.y === beltEnd.y) ||
    (pair.consumer.cell.x === beltStart.x && pair.consumer.cell.y === beltStart.y)
  ) {
    return { ok: false, reason: 'no-path', tried: [pair] };
  }

  // 두 인서터 셀 자체도 통과 금지 (이후 인서터로 채워질 자리).
  const blocked = new Set(occupancy);
  blocked.add(cellKey(pair.producer.cell.x, pair.producer.cell.y));
  blocked.add(cellKey(pair.consumer.cell.x, pair.consumer.cell.y));

  // 지하벨트 entity 가 안 주어졌거나 maxDistance=0 이면 점프 비활성.
  const canJump = !!options.undergroundBeltEntityName && (options.beltMaxUndergroundDistance ?? 0) > 0;
  const maxJumpDistance = canJump ? (options.beltMaxUndergroundDistance as number) : 0;
  // 벨트의 blockGroup = entityName (같은 prototype 끼리만 차단; 다른 티어는 독립).
  // jump 비활성이어도 group 키는 일관성 위해 정의.
  const blockGroup = options.undergroundBeltEntityName ?? options.beltEntityName;

  const result = dijkstraWithJumps({
    start: beltStart,
    end: beltEnd,
    blocked,
    corridors: area.undergroundCorridors,
    maxJumpDistance,
    blockGroup,
  });
  if (!result) {
    return { ok: false, reason: 'no-path', tried: [pair] };
  }

  const placed: PlacedCell[] = [];

  // 1) producer 측 인서터 — 컨테이너에서 집어 벨트로 놓음.
  //    Factorio 규약: 인서터의 `direction` = *픽업 방향*.
  placed.push(
    makeInserterCell(
      pair.producer.cell,
      { x: -producerOut.x, y: -producerOut.y },
      options.inserterEntityName,
      pair,
    ),
  );

  // 2) 운반체 체인 (벨트 + 지하벨트) emit.
  const itemChain = emitItemPath(result, pair, options, consumerOut);
  for (const p of itemChain.placed) placed.push(p);

  // 3) consumer 측 인서터 — 벨트에서 집어 컨테이너로 놓음.
  placed.push(
    makeInserterCell(
      pair.consumer.cell,
      consumerOut,
      options.inserterEntityName,
      pair,
    ),
  );

  const routingId = nextRoutingId();
  const routing: Routing = {
    id: routingId,
    kind: 'item',
    from: pair.producer,
    to: pair.consumer,
    placed: placed.map(p => ({ ...p, cell: { ...p.cell, entityId: routingId } })),
    corridors: itemChain.corridors,
  };
  return { ok: true, routing };
}

/**
 * Dijkstra 결과를 item 운반체 셀로 변환.
 *
 * 셀 emit 규칙 (i ∈ [0, cells.length)):
 *  - edges[i] 가 jump → cells[i] 는 underground-belt INPUT (type='input').
 *  - edges[i-1] 가 jump → cells[i] 는 underground-belt OUTPUT (type='output').
 *  - 그 외 → 일반 transport-belt.
 *
 * direction 컨벤션 (Factorio): underground-belt 의 `direction` =
 * *벨트 흐름 방향* (= jump 진행 방향). input/output 모두 동일 direction.
 * 일반 벨트는 *다음 셀로의 진행 방향*. 마지막 셀이 일반 벨트면 consumer 쪽으로.
 */
function emitItemPath(
  result: DijkstraResult,
  pair: PortPair,
  options: { beltEntityName: string; undergroundBeltEntityName?: string },
  consumerOut: { x: number; y: number },
): { placed: PlacedCell[]; corridors: UndergroundCorridor[] } {
  const placed: PlacedCell[] = [];
  const corridors: UndergroundCorridor[] = [];
  const { cells, edges } = result;
  const blockGroup = options.undergroundBeltEntityName ?? options.beltEntityName;

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const outEdge = i < edges.length ? edges[i] : null;
    const inEdge = i > 0 ? edges[i - 1] : null;

    if (outEdge && outEdge !== 'surface') {
      // underground-belt INPUT (entrance). direction = jump 진행 방향.
      placed.push(
        makeUndergroundBeltCell(
          c,
          vectorToDirection(outEdge.dx, outEdge.dy),
          'input',
          options.undergroundBeltEntityName!,
          pair,
        ),
      );
      corridors.push(corridorFromJump(c.x, c.y, outEdge, 'belt', blockGroup));
    } else if (inEdge && inEdge !== 'surface') {
      // underground-belt OUTPUT (exit). direction = jump 진행 방향 (input 과 동일).
      placed.push(
        makeUndergroundBeltCell(
          c,
          vectorToDirection(inEdge.dx, inEdge.dy),
          'output',
          options.undergroundBeltEntityName!,
          pair,
        ),
      );
    } else {
      // 일반 벨트. direction = 다음 셀로의 진행 방향. 마지막 셀이면 consumer 쪽.
      let dir: Direction;
      if (outEdge === 'surface') {
        const next = cells[i + 1];
        dir = vectorToDirection(next.x - c.x, next.y - c.y);
      } else {
        // i === cells.length - 1 인 surface 마지막 셀.
        dir = vectorToDirection(-consumerOut.x, -consumerOut.y);
      }
      placed.push(makeBeltCell(c, dir, options.beltEntityName, pair));
    }
  }

  return { placed, corridors };
}

function makeUndergroundBeltCell(
  cell: { x: number; y: number },
  direction: Direction,
  undergroundType: 'input' | 'output',
  undergroundBeltEntityName: string,
  pair: PortPair,
): PlacedCell {
  const grid: GridCell = {
    ...createEmptyCell(),
    entityId: `r-ubelt-${pair.producer.containerId}-${pair.consumer.containerId}-${cell.x},${cell.y}`,
    entityName: undergroundBeltEntityName,
    entityType: EntityType.UndergroundBelt,
    direction,
    tileOffset: { x: 0, y: 0 },
    isOrigin: true,
    undergroundType,
  };
  return { x: cell.x, y: cell.y, cell: grid };
}

// ─────────────────────────────────────────────────────────────────────────────
// fluid 라우팅
// ─────────────────────────────────────────────────────────────────────────────

/**
 * fluid 라우팅 — 컨테이너—파이프(+지하파이프)—컨테이너.
 *
 * 형식: producer port cell 부터 consumer port cell 까지 Dijkstra 경로의
 * 모든 셀에 entity 1 개씩 emit. 인서터 없음.
 *  - surface edge 로 도착·이탈하는 셀 → 일반 `pipe`.
 *  - jump edge 의 source 셀 → `pipe-to-ground` (entrance), direction = 점프 진행 방향.
 *  - jump edge 의 destination 셀 → `pipe-to-ground` (exit), direction = 점프 반대.
 *
 * 차단 규칙 (Factorio 게임 동작 기준): 어떤 prototype 의 pipe-to-ground 든
 * 같은 직선 위에 끼면 페어링이 끊긴다 → `blockGroup = "pipe-to-ground"` 단일 그룹.
 */
function routeFluid(
  pair: PortPair,
  area: Area,
  options: {
    pipeEntityName: string;
    undergroundPipeEntityName?: string;
    pipeMaxUndergroundDistance?: number;
  },
  extra?: Area,
): RoutingAttempt {
  const occupancy = buildOccupancy(area, extra);

  // 두 port cell 자체가 점유되어 있으면 즉시 실패.
  if (occupancy.has(cellKey(pair.producer.cell.x, pair.producer.cell.y))) {
    return { ok: false, reason: 'no-path', tried: [pair] };
  }
  if (occupancy.has(cellKey(pair.consumer.cell.x, pair.consumer.cell.y))) {
    return { ok: false, reason: 'no-path', tried: [pair] };
  }

  // 지하파이프 entity 가 안 주어졌거나 maxDistance=0 이면 점프 비활성.
  const canJump = !!options.undergroundPipeEntityName && (options.pipeMaxUndergroundDistance ?? 0) > 0;
  const maxJumpDistance = canJump ? (options.pipeMaxUndergroundDistance as number) : 0;

  const result = dijkstraWithJumps({
    start: pair.producer.cell,
    end: pair.consumer.cell,
    blocked: occupancy,
    corridors: area.undergroundCorridors,
    maxJumpDistance,
    blockGroup: PIPE_BLOCK_GROUP,
  });
  if (!result) {
    return { ok: false, reason: 'no-path', tried: [pair] };
  }

  const emitted = emitFluidPath(result, pair, options);

  const routingId = nextRoutingId();
  const routing: Routing = {
    id: routingId,
    kind: 'fluid',
    from: pair.producer,
    to: pair.consumer,
    placed: emitted.placed.map(p => ({ ...p, cell: { ...p.cell, entityId: routingId } })),
    corridors: emitted.corridors,
  };
  return { ok: true, routing };
}

/**
 * 차단 그룹 — 모든 pipe-to-ground prototype 은 단일 그룹으로 묶여 서로
 * 차단된다 (Factorio 게임 동작 기준, 사용자 결정 4).
 */
const PIPE_BLOCK_GROUP = 'pipe-to-ground';

/**
 * Dijkstra 결과를 fluid 운반체 셀로 변환.
 *
 * 셀 emit 규칙 (i ∈ [0, cells.length)):
 *  - edges[i] 가 jump → cells[i] 는 jump source = pipe-to-ground (entrance).
 *  - edges[i-1] 가 jump → cells[i] 는 jump destination = pipe-to-ground (exit).
 *  - 그 외 → 일반 pipe.
 *
 * arrivedViaJump 가 막아주므로 (edges[i-1] === jump && edges[i] === jump) 케이스
 * 는 발생하지 않는다.
 *
 * direction 컨벤션 (pipeNetwork.ts:226): pipe-to-ground 의 `direction` =
 * *지상 입구가 향하는 방향* (= 표면 연결 측). 터널은 그 반대 방향으로 진행.
 *  - entrance: 터널이 jump 진행 방향으로 나아가므로 surface = `-jump`.
 *  - exit:    터널이 jump 진행 방향에서 들어오므로 surface = `+jump`.
 */
function emitFluidPath(
  result: DijkstraResult,
  pair: PortPair,
  options: { pipeEntityName: string; undergroundPipeEntityName?: string },
): { placed: PlacedCell[]; corridors: UndergroundCorridor[] } {
  const placed: PlacedCell[] = [];
  const corridors: UndergroundCorridor[] = [];
  const { cells, edges } = result;

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const outEdge = i < edges.length ? edges[i] : null;
    const inEdge = i > 0 ? edges[i - 1] : null;

    if (outEdge && outEdge !== 'surface') {
      // jump source = entrance. surface 측 = jump 반대 방향.
      placed.push(
        makeUndergroundPipeCell(
          c,
          vectorToDirection(-outEdge.dx, -outEdge.dy),
          options.undergroundPipeEntityName!,
          pair,
        ),
      );
      corridors.push(corridorFromJump(c.x, c.y, outEdge, 'pipe', PIPE_BLOCK_GROUP));
    } else if (inEdge && inEdge !== 'surface') {
      // jump destination = exit. surface 측 = jump 진행 방향.
      placed.push(
        makeUndergroundPipeCell(
          c,
          vectorToDirection(inEdge.dx, inEdge.dy),
          options.undergroundPipeEntityName!,
          pair,
        ),
      );
    } else {
      placed.push(makePipeCell(c, options.pipeEntityName, pair));
    }
  }

  return { placed, corridors };
}

function makePipeCell(
  cell: { x: number; y: number },
  pipeEntityName: string,
  pair: PortPair,
): PlacedCell {
  const grid: GridCell = {
    ...createEmptyCell(),
    entityId: `r-pipe-${pair.producer.containerId}-${pair.consumer.containerId}-${cell.x},${cell.y}`,
    entityName: pipeEntityName,
    entityType: EntityType.Pipe,
    direction: 0,
    tileOffset: { x: 0, y: 0 },
    isOrigin: true,
  };
  return { x: cell.x, y: cell.y, cell: grid };
}

function makeUndergroundPipeCell(
  cell: { x: number; y: number },
  direction: Direction,
  undergroundPipeEntityName: string,
  pair: PortPair,
): PlacedCell {
  const grid: GridCell = {
    ...createEmptyCell(),
    entityId: `r-upipe-${pair.producer.containerId}-${pair.consumer.containerId}-${cell.x},${cell.y}`,
    entityName: undergroundPipeEntityName,
    entityType: EntityType.PipeUnderground,
    direction,
    tileOffset: { x: 0, y: 0 },
    isOrigin: true,
  };
  return { x: cell.x, y: cell.y, cell: grid };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dijkstra 경로 탐색 — 지상 인접 (cost 1) + 지하 점프 페어 (cost 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 지하 점프 edge 의 단위 벡터 + 거리.
 *
 * `(dx, dy)` 는 4 방향 단위 벡터 (N/E/S/W), `k` 는 입출구의 좌표 차이
 * (= prototype 의 `max_underground_distance` 가 허용하는 최대값까지).
 * 사이 통과 셀 개수 = `k - 1`.
 */
export interface JumpEdge {
  dx: number;
  dy: number;
  k: number;
}

/** Dijkstra 경로의 한 edge — 지상 인접 또는 지하 점프 */
export type RouteEdge = 'surface' | JumpEdge;

/** `dijkstraWithJumps` 의 결과 — 셀 시퀀스 + 각 step 의 edge 종류. */
export interface DijkstraResult {
  /** start 부터 end 까지의 셀 시퀀스. 길이 ≥ 1 */
  cells: Array<{ x: number; y: number }>;
  /** 각 인접한 두 cell 사이의 edge 종류. 길이 = `cells.length - 1` */
  edges: RouteEdge[];
  /** 총 cost (지상 1 + 점프 2) */
  cost: number;
}

export interface DijkstraInput {
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** 통과 불가 셀 집합 (지상 occupancy). end 셀은 포함되어도 무방. */
  blocked: ReadonlySet<string>;
  /** 기존 corridor 들. 같은 `blockGroup` 만 점프 edge 충돌 검사 대상. */
  corridors: ReadonlyArray<UndergroundCorridor>;
  /**
   * 점프 edge 의 최대 `k` (입출구 좌표 차이). 0 이면 점프 비활성 (= pure surface BFS).
   * prototype 의 `max_underground_distance` 그대로.
   */
  maxJumpDistance: number;
  /** 이 라우팅이 깔게 될 corridor 의 blockGroup (pipe="pipe-to-ground" / belt=entityName) */
  blockGroup: string;
}

/**
 * Dijkstra — 지상 인접 + 지하 점프 페어 통합 탐색.
 *
 * 상태 = `(x, y, arr)`. arr 는 *이 셀에 도착한 방식·방향* 을 인코딩한다:
 *   -1   = 시작 셀 (아직 진행 방향 없음).
 *   0..3 = 지상으로 surfaceDirs[arr] 방향 진행하며 도착.
 *   4..7 = 점프(지하 출구)로 surfaceDirs[arr-4] 방향 진행하며 도착 (출구 셀).
 * 한 셀은 도착 방식·방향에 따라 여러 상태로 갈라진다.
 *
 * 점프(지하벨트/지하파이프)는 입출구가 *직선* 으로만 이어진다. 출구는 진행 방향으로만
 * 토출하고, 입구는 진행 방향 반대(뒤)로만 받는다 (이 모델은 sideload 를 배제한다).
 * 따라서 꺾임은 반드시 *지상 셀* 위에서 일어나야 하며, 두 지하 운반체가 직각으로
 * 맞붙으면 물리적으로 끊긴다. 이를 막는 두 제약:
 *  - 출구 직진 (exit-straight): 출구 셀(arr>=4)에서는 같은 방향 지상 직진만 허용,
 *    재점프 금지. 출구 entity 위에 입구가 겹치는 것도 함께 방지.
 *  - 입구 직진 (entrance-straight): 점프는 *그 셀에 진행해 온 방향과 같은 방향* 으로만
 *    시작할 수 있다 (지상 도착 arr=0..3 → 같은 방향 점프만). 시작 셀(arr=-1)은
 *    예외로 임의 방향 허용 — 머신이 뒤에서 공급하기 때문.
 * 두 제약이 함께 작동해 꺾임-직후-점프 / 점프-직후-꺾임을 모두 지상 셀로 밀어내므로,
 * 직각 코너에는 항상 연결용 지상 벨트/파이프 한 칸이 놓인다.
 *
 * 결정성: 동률 cost 시 expand 순서 = 지상 N→E→S→W → 점프 (k 작은 것부터,
 * 축 N→E→S→W). PQ tie-break = (cost, enqueueSeq).
 *
 * 점프 edge 의 유효성 (placement-search §4 / Q18, Factorio 게임 동작 기준):
 *  - 점프 입출구 두 셀 모두 `blocked` 에 없어야 함.
 *  - 기존 같은 `blockGroup` corridor 와 *같은 axis + 같은 line* 위에서
 *    interval 이 strict disjoint 여야 함 (= 한쪽 endpoint 가 다른 쪽 open
 *    interior 에 끼는 케이스 모두 거부).
 *  - 다른 axis · 다른 line · 다른 blockGroup corridor 는 간섭 없음.
 */
export function dijkstraWithJumps(input: DijkstraInput): DijkstraResult | null {
  const { start, end, blocked, corridors, maxJumpDistance, blockGroup } = input;

  if (start.x === end.x && start.y === end.y) {
    return { cells: [{ x: start.x, y: start.y }], edges: [], cost: 0 };
  }

  // 상태의 arr: -1 = 시작 셀. 0..3 = surfaceDirs[arr] 방향 지상 진행으로 도착.
  // 4..7 = surfaceDirs[arr-4] 방향 점프로 도착(= 지하 출구 셀). 출구(arr>=4)는 같은
  // 방향 지상 직진만 + 재점프 금지(exit-straight). 점프는 도착 방향과 같은 방향으로만
  // 시작 가능(entrance-straight); 시작 셀(arr=-1)만 임의 방향 허용.
  type PQEntry = { x: number; y: number; arr: number; cost: number; seq: number };
  const pq: PQEntry[] = [];
  let seqCounter = 0;
  const pqLess = (a: PQEntry, b: PQEntry): boolean =>
    a.cost < b.cost || (a.cost === b.cost && a.seq < b.seq);
  const enqueue = (x: number, y: number, arr: number, cost: number): void => {
    const node: PQEntry = { x, y, arr, cost, seq: seqCounter++ };
    pq.push(node);
    let i = pq.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pqLess(pq[parent], pq[i])) break;
      [pq[parent], pq[i]] = [pq[i], pq[parent]];
      i = parent;
    }
  };
  const dequeue = (): PQEntry | undefined => {
    if (pq.length === 0) return undefined;
    const head = pq[0];
    const last = pq.pop()!;
    if (pq.length > 0) {
      pq[0] = last;
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let best = i;
        if (l < pq.length && pqLess(pq[l], pq[best])) best = l;
        if (r < pq.length && pqLess(pq[r], pq[best])) best = r;
        if (best === i) break;
        [pq[best], pq[i]] = [pq[i], pq[best]];
        i = best;
      }
    }
    return head;
  };

  type CameFromEntry = {
    prev: { x: number; y: number; arr: number };
    edge: RouteEdge;
  };
  const stateKey = (x: number, y: number, arr: number): string =>
    `${x},${y},${arr}`;
  const bestCost = new Map<string, number>();
  const cameFrom = new Map<string, CameFromEntry>();
  bestCost.set(stateKey(start.x, start.y, -1), 0);
  enqueue(start.x, start.y, -1, 0);

  // 같은 blockGroup corridor 만 점프 edge 검증 대상.
  const groupCorridors = corridors.filter((c) => c.blockGroup === blockGroup);

  // 결정성: N → E → S → W
  const surfaceDirs: Array<{ dx: number; dy: number }> = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ];

  while (true) {
    const cur = dequeue();
    if (!cur) return null;
    const curKey = stateKey(cur.x, cur.y, cur.arr);
    const known = bestCost.get(curKey);
    if (known !== undefined && cur.cost > known) continue;

    if (cur.x === end.x && cur.y === end.y) {
      const cellsRev: Array<{ x: number; y: number }> = [{ x: cur.x, y: cur.y }];
      const edgesRev: RouteEdge[] = [];
      let nx = cur.x;
      let ny = cur.y;
      let nj = cur.arr;
      while (true) {
        const entry = cameFrom.get(stateKey(nx, ny, nj));
        if (!entry) break;
        edgesRev.push(entry.edge);
        nx = entry.prev.x;
        ny = entry.prev.y;
        nj = entry.prev.arr;
        cellsRev.push({ x: nx, y: ny });
      }
      return {
        cells: cellsRev.reverse(),
        edges: edgesRev.reverse(),
        cost: cur.cost,
      };
    }

    const isExit = cur.arr >= 4;
    const exitDir = isExit ? cur.arr - 4 : -1;

    // 지상 인접 edge (cost 1). 지하 출구(arr>=4)에서는 출구 방향으로만 직진 —
    // 출구는 진행 방향으로만 토출하므로 꺾으면 다음 운반체와 물리적으로 안 이어진다.
    for (let di = 0; di < surfaceDirs.length; di++) {
      if (isExit && di !== exitDir) continue;
      const d = surfaceDirs[di];
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      const nk = stateKey(nx, ny, di);
      if (blocked.has(cellKey(nx, ny)) && !(nx === end.x && ny === end.y)) continue;
      const newCost = cur.cost + 1;
      const prev = bestCost.get(nk);
      if (prev !== undefined && prev <= newCost) continue;
      bestCost.set(nk, newCost);
      cameFrom.set(nk, {
        prev: { x: cur.x, y: cur.y, arr: cur.arr },
        edge: 'surface',
      });
      enqueue(nx, ny, di, newCost);
    }

    // 지하 점프 edge (cost 2). 출구 셀(arr>=4)에서는 재점프 금지(출구 entity 위에
    // 입구가 겹침 + 직진 토출). 점프는 entrance-straight — 이 셀에 진행해 온 방향과
    // 같은 방향으로만 시작 가능. 시작 셀(arr=-1)만 임의 방향 허용.
    if (maxJumpDistance > 0 && !isExit) {
      const atStart = cur.arr === -1;
      for (let di = 0; di < surfaceDirs.length; di++) {
        // entrance-straight: 지상 도착 방향(arr)과 같은 방향 점프만. 꺾으려면 먼저
        // 지상 셀에서 방향을 바꾼 뒤 그 다음 셀에서 점프 → 코너에 연결용 셀이 남는다.
        if (!atStart && di !== cur.arr) continue;
        const d = surfaceDirs[di];
        for (let k = 1; k <= maxJumpDistance; k++) {
          const nx = cur.x + d.dx * k;
          const ny = cur.y + d.dy * k;
          const nk = stateKey(nx, ny, 4 + di);
          if (blocked.has(cellKey(nx, ny)) && !(nx === end.x && ny === end.y)) continue;
          if (!isJumpAllowed(cur.x, cur.y, nx, ny, groupCorridors)) continue;
          const newCost = cur.cost + 2;
          const prev = bestCost.get(nk);
          if (prev !== undefined && prev <= newCost) continue;
          bestCost.set(nk, newCost);
          cameFrom.set(nk, {
            prev: { x: cur.x, y: cur.y, arr: cur.arr },
            edge: { dx: d.dx, dy: d.dy, k },
          });
          enqueue(nx, ny, 4 + di, newCost);
        }
      }
    }
  }
}

/**
 * 새 점프 페어 (in=(x0,y0), out=(x1,y1)) 가 기존 같은 blockGroup corridor 들과
 * 충돌하는지 검사. 충돌 없음 → true.
 *
 * 충돌 규칙: 같은 axis · 같은 line 위에서 interval 이 strict disjoint 여야 함.
 * (= 한 corridor 의 endpoint 가 다른 corridor 의 open interior 에 끼는 모든
 * 케이스 거부 — nested · partial overlap 모두 broken 으로 처리.)
 */
function isJumpAllowed(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  groupCorridors: ReadonlyArray<UndergroundCorridor>,
): boolean {
  const axis: 'h' | 'v' = y0 === y1 ? 'h' : 'v';
  const line = axis === 'h' ? y0 : x0;
  const a = axis === 'h' ? x0 : y0;
  const b = axis === 'h' ? x1 : y1;
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  for (const c of groupCorridors) {
    if (c.axis !== axis) continue;
    if (c.line !== line) continue;
    const [ca, cb] = c.range;
    const clo = ca < cb ? ca : cb;
    const chi = ca < cb ? cb : ca;
    // strict disjoint: hi < clo || chi < lo
    if (!(hi < clo || chi < lo)) return false;
  }
  return true;
}

/**
 * 한 점프 edge → 그 페어가 만들 corridor 메타데이터 반환.
 * 결과를 `area.undergroundCorridors` 에 push 하면 됨.
 */
export function corridorFromJump(
  fromX: number,
  fromY: number,
  edge: JumpEdge,
  kind: UndergroundCorridor['kind'],
  blockGroup: string,
): UndergroundCorridor {
  const toX = fromX + edge.dx * edge.k;
  const toY = fromY + edge.dy * edge.k;
  const axis: 'h' | 'v' = edge.dy === 0 ? 'h' : 'v';
  const line = axis === 'h' ? fromY : fromX;
  const a = axis === 'h' ? fromX : fromY;
  const b = axis === 'h' ? toX : toY;
  const range: [number, number] = a < b ? [a, b] : [b, a];
  return { axis, line, range, blockGroup, kind };
}

// ─────────────────────────────────────────────────────────────────────────────
// 셀 / 방향 유틸
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 인서터 1셀 emit. `pickupVec` = 인서터의 *픽업 방향* 단위벡터 (= 손 뻗는 쪽).
 * Factorio 규약: `LuaEntity.direction` = 픽업 방향. prototype 의
 * `inserter_pickup_position` 을 그대로 direction 만큼 회전한 위치가 픽업 셀.
 *
 * 예: direction=0 (N) → 북쪽에서 집고 남쪽에 놓는다.
 *     direction=4 (E) → 동쪽에서 집고 서쪽에 놓는다.
 */
export function makeInserterCell(
  cell: { x: number; y: number },
  pickupVec: { x: number; y: number },
  inserterEntityName: string,
  pair: PortPair,
): PlacedCell {
  const grid: GridCell = {
    ...createEmptyCell(),
    entityId: `r-ins-${pair.producer.containerId}-${pair.consumer.containerId}-${cell.x},${cell.y}`,
    entityName: inserterEntityName,
    entityType: EntityType.Inserter,
    direction: vectorToDirection(pickupVec.x, pickupVec.y),
    tileOffset: { x: 0, y: 0 },
    isOrigin: true,
  };
  return { x: cell.x, y: cell.y, cell: grid };
}

export function makeBeltCell(
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

export function faceVector(face: PortFace): { x: number; y: number } {
  switch (face) {
    case 'N': return { x: 0, y: -1 };
    case 'S': return { x: 0, y: 1 };
    case 'E': return { x: 1, y: 0 };
    case 'W': return { x: -1, y: 0 };
  }
}

export function vectorToDirection(dx: number, dy: number): Direction {
  if (dx === 0 && dy < 0) return 0;
  if (dx > 0 && dy === 0) return 4;
  if (dx === 0 && dy > 0) return 8;
  if (dx < 0 && dy === 0) return 12;
  // diagonal/zero — fallback to N (방어, 정상 흐름에서는 발생하지 않음)
  return 0;
}

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
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
