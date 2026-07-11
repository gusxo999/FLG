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
  UndergroundCorridor,
} from './containerModel';
import { cellKey, faceVector, vectorToDirection } from './util/helper';
import { makeBeltCell, makeInserterCell } from './util/cellBuilder';

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
    turnPenalty?: number;
    routingBounds?: { x0: number; y0: number; x1: number; y1: number };
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
    // 지하벨트는 충돌 회피용으로만 — 지상이 뚫려 있으면 항상 지상을 택한다.
    jumpCostModel: 'length',
    turnPenalty: options.turnPenalty,
    // 타 라우팅 벨트 스트림과 흐름-인접 합류 방지(타일 배타성의 경계 버전).
    beltFlow: collectBeltFlow([area, extra]),
    bounds: options.routingBounds,
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
 * 멀티소스/멀티싱크 item 라우팅 — 포트를 *미리 고르지 않고* 라우팅이 고르게 한다.
 *
 * producer 둘레의 모든 유효 beltStart 를 동시에 seed(개념 ①), consumer 둘레의 모든
 * 유효 beltEnd 를 동시에 싱크(개념 ②)로 둔 단일 Dijkstra 를 한 번 돌린다. 처음 닿는
 * (소스,싱크) = 실제 경로 비용 기준 전역 최적 포트 페어. 이 페어로 `routeItem` 을 호출해
 * 기존과 *동일한* 검증·emit(인서터/벨트 체인)을 거친다.
 *
 * 이로써 `routeWithFallback` 의 enumeration(최대 N×M 회 routeItem = 매번 occupancy
 * 빌드 + Dijkstra)을 buildOccupancy 1 회 + Dijkstra 1 회로 대체하고, manhattan 거리
 * proxy 대신 실제 장애물-인지 비용으로 포트를 고른다.
 *
 * 페어 의존 제약(인서터-인서터 인접, 단일-인서터 코너)은 `routeItem` 이 잡는다 —
 * 승자가 거기서 실패하면 그 싱크를 제외하고 재탐색한다(보통 0~1 회). 어떤 싱크에도
 * 닿지 못하면 두 영역이 점프로도 못 넘는 벽으로 단절된 것 → null(폴백 위임).
 */
export function routeItemMulti(
  producerPorts: ReadonlyArray<ContainerPort>,
  consumerPorts: ReadonlyArray<ContainerPort>,
  area: Area,
  options: Parameters<typeof routeItem>[2],
  extra?: Area,
): RoutingAttempt | null {
  if (producerPorts.length === 0 || consumerPorts.length === 0) return null;
  const occupancy = buildOccupancy(area, extra);

  // 단일 외곽 링 불변식: 포트(인서터 자리)와 그 belt 끝점이 ring 직사각형 안에 있어야
  // 한다. 바깥을 향한 상자 포트(ring 밖으로 인서터·belt 끝점이 나가는)는 제외한다.
  // 끝점은 Dijkstra 에서 endSet 예외라 경로 bounds 만으론 못 막는다 → 여기서 거른다.
  const rb = options.routingBounds;
  const inRB = (x: number, y: number): boolean =>
    rb === undefined || (x >= rb.x0 && x <= rb.x1 && y >= rb.y0 && y <= rb.y1);

  // 모든 후보 포트 셀(=인서터 자리)은 통과 금지 — 경로가 둘레 접점 위를 지나면 안 된다.
  // beltStart/beltEnd 는 footprint 에서 한 칸 더 바깥이라 이 집합에 포함되지 않는다.
  const blocked = new Set<string>(occupancy);
  for (const p of producerPorts) blocked.add(cellKey(p.cell.x, p.cell.y));
  for (const c of consumerPorts) blocked.add(cellKey(c.cell.x, c.cell.y));

  // 소스: 포트 셀·beltStart 가 모두 비어 있는 producer 포트. beltStart → 포트 역매핑.
  const startMap = new Map<string, ContainerPort>();
  const starts: DijkstraEndpoint[] = [];
  for (const p of producerPorts) {
    if (occupancy.has(cellKey(p.cell.x, p.cell.y))) continue;
    if (!inRB(p.cell.x, p.cell.y)) continue;
    const out = faceVector(p.face);
    const bx = p.cell.x + out.x;
    const by = p.cell.y + out.y;
    if (!inRB(bx, by)) continue;
    const k = cellKey(bx, by);
    if (occupancy.has(k) || startMap.has(k)) continue;
    startMap.set(k, p);
    starts.push({ x: bx, y: by });
  }
  // 싱크: 대칭. routeItem 에서 실패 시 제외하고 재탐색하기 위해 key 도 보관.
  const endMap = new Map<string, ContainerPort>();
  const endList: Array<{ key: string; ep: DijkstraEndpoint }> = [];
  for (const c of consumerPorts) {
    if (occupancy.has(cellKey(c.cell.x, c.cell.y))) continue;
    if (!inRB(c.cell.x, c.cell.y)) continue;
    const out = faceVector(c.face);
    const bx = c.cell.x + out.x;
    const by = c.cell.y + out.y;
    if (!inRB(bx, by)) continue;
    const k = cellKey(bx, by);
    if (occupancy.has(k) || endMap.has(k)) continue;
    endMap.set(k, c);
    endList.push({ key: k, ep: { x: bx, y: by } });
  }
  if (starts.length === 0 || endList.length === 0) return null;

  const canJump =
    !!options.undergroundBeltEntityName && (options.beltMaxUndergroundDistance ?? 0) > 0;
  const maxJumpDistance = canJump ? (options.beltMaxUndergroundDistance as number) : 0;
  const blockGroup = options.undergroundBeltEntityName ?? options.beltEntityName;
  const beltFlow = collectBeltFlow([area, extra]);

  const excluded = new Set<string>();
  for (let guard = 0; guard <= endList.length; guard++) {
    const ends = endList.filter((e) => !excluded.has(e.key)).map((e) => e.ep);
    if (ends.length === 0) return null;
    const result = dijkstraWithJumps({
      starts,
      ends,
      blocked,
      corridors: area.undergroundCorridors,
      maxJumpDistance,
      blockGroup,
      // 지하벨트는 충돌 회피용으로만 — 지상이 뚫려 있으면 항상 지상을 택한다.
      jumpCostModel: 'length',
      beltFlow,
      bounds: options.routingBounds,
    });
    if (!result) return null; // 어떤 싱크에도 못 닿음 = 진짜 단절.
    const first = result.cells[0];
    const last = result.cells[result.cells.length - 1];
    const producer = startMap.get(cellKey(first.x, first.y));
    const consumer = endMap.get(cellKey(last.x, last.y));
    if (!producer || !consumer) return null; // 방어(역매핑 누락 — 발생하면 안 됨).
    const attempt = routeItem({ producer, consumer }, area, options, extra);
    if (attempt.ok) return attempt;
    excluded.add(cellKey(last.x, last.y)); // 승자가 페어 제약에 걸림 → 이 싱크 제외 후 재탐색.
  }
  return null;
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
 *
 * export — moduleHop(모듈 간 belt-to-belt 홉)이 같은 규칙으로 재사용한다(단일 출처).
 */
export function emitItemPath(
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
    routingBounds?: { x0: number; y0: number; x1: number; y1: number };
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

  // 머신에 닿는 양 끝 셀이 pipe-to-ground 가 될 경우, 그 표면(입구) 면이 반드시
  // 머신을 향하도록 점프 방향을 제약한다 (pipe-to-ground 는 표면에서 direction
  // 한 면으로만 연결 — pipeNetwork.ts surface 규칙과 정합). port cell 은 footprint
  // 바로 바깥에 있어 머신은 -faceVector 쪽에 있다.
  //  - start(producer port) 입구: entrance.direction = -jump 이므로 머신(-producerOut)
  //    을 향하려면 jump = producerOut (바깥 방향).
  //  - end(consumer port) 출구: exit.direction = +jump 이므로 머신(-consumerOut)
  //    을 향하려면 jump = -consumerOut (머신 방향).
  const producerOut = faceVector(pair.producer.face);
  const consumerOut = faceVector(pair.consumer.face);

  const result = dijkstraWithJumps({
    start: pair.producer.cell,
    end: pair.consumer.cell,
    blocked: occupancy,
    corridors: area.undergroundCorridors,
    maxJumpDistance,
    blockGroup: PIPE_BLOCK_GROUP,
    requiredStartJump: { dx: producerOut.x, dy: producerOut.y },
    requiredEndJump: { dx: -consumerOut.x, dy: -consumerOut.y },
    bounds: options.routingBounds,
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

/**
 * 다중 소스/싱크용 끝점. 점프 방향 제약을 *끝점별* 로 가진다 (단일 `requiredStartJump`/
 * `requiredEndJump` 의 멀티 버전 — 소스마다 머신을 향하는 면이 다를 수 있으므로).
 */
export interface DijkstraEndpoint {
  x: number;
  y: number;
  /** 이 끝점에서 출발(소스)/도착(싱크)하는 점프를 이 방향으로만 허용. */
  requiredJump?: { dx: number; dy: number };
}

export interface DijkstraInput {
  /** 단일 소스. `starts` 가 주어지면 무시된다(하위 호환). */
  start?: { x: number; y: number };
  /** 단일 싱크. `ends` 가 주어지면 무시된다(하위 호환). */
  end?: { x: number; y: number };
  /**
   * 다중 소스 — 전부 cost 0 으로 *동시에* seed 한다(개념 ①: 출발의 평등).
   * 주어지면 `start`/`requiredStartJump` 를 대체. 어느 소스에서 출발하든 동등하므로
   * 처음 싱크에 닿는 흐름이 전 포트 페어 통틀어 전역 최적(실제 경로 비용 기준)이다.
   */
  starts?: ReadonlyArray<DijkstraEndpoint>;
  /**
   * 다중 싱크 — 어느 하나에 *처음* 도달하면 종료(개념 ②: 도착의 평등 + 멤버십 종료).
   * 주어지면 `end`/`requiredEndJump` 를 대체.
   */
  ends?: ReadonlyArray<DijkstraEndpoint>;
  /** 통과 불가 셀 집합 (지상 occupancy). 싱크 셀들은 포함되어도 무방(개념 ③). */
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
  /**
   * 외부(타 라우팅) 벨트 흐름 정보. 주어지면, 결과 경로의 벨트 셀이 외부 벨트 스트림과
   * *흐름 방향으로 인접해 합류*하는 배치를 거부한다(타일 배타성의 경계 버전). 아이템
   * 라우팅만 전달한다(파이프는 무방향 연결이라 별도 모델). 미지정이면 검사 안 함.
   */
  beltFlow?: BeltFlow;
  /**
   * start 셀에서 *출발하는* 점프를 이 방향으로만 허용. 미지정이면 제약 없음.
   * pipe-to-ground 는 표면에서 한 면(direction)으로만 연결되므로, 머신에 닿는
   * 끝 셀이 지하 입구가 될 때 그 표면 면이 머신을 향하도록 강제하는 데 쓴다.
   */
  requiredStartJump?: { dx: number; dy: number };
  /** end 셀에 *도착하는* 점프를 이 방향으로만 허용. 미지정이면 제약 없음. */
  requiredEndJump?: { dx: number; dy: number };
  /**
   * 지하 점프 edge 의 cost 모델.
   *  - `'flat'`(기본): 점프 1회 = cost 2 (운반체 2개 기준). 점프 길이 `k` 와 무관하므로
   *    `k ≥ 3` 인 긴 직선 구간에서는 점프(2)가 지상(k)보다 싸다 → 장애물이 없어도 점프가
   *    선택된다. 파이프 라우팅이 이 모델을 쓴다.
   *  - `'length'`: 점프 cost = `k + 1` (= 지상 직선 `k` 칸보다 항상 1 비쌈). 지상이
   *    뚫려 있으면 항상 지상이 이기고, 점프는 지상 우회가 더 비쌀 때(=충돌 회피)만
   *    선택된다. 벨트 라우팅이 "지하벨트는 충돌 회피용으로만" 정책을 위해 이 모델을 쓴다.
   */
  jumpCostModel?: 'flat' | 'length';
  /**
   * 지상 벨트가 *방향을 꺾을 때마다* 더해지는 추가 cost. 0/미지정이면 꺾임 무비용
   * (기존 동작 — 직선과 계단형 경로가 동률이라 임의 tie-break). 양수면 꺾임이 적은
   * 경로가 이기므로 (1) 계단/대각처럼 보이는 벨트 대신 곧은 벨트를, (2) 상자 같은
   * 장애물을 *우회(2회 꺾임)* 하기보다 *직진 점프* 로 넘기를 선호하게 된다. 외부상자
   * 드래그 재라우팅처럼 가독성이 중요한 경로에서 켠다. 점프 edge 에는 적용하지 않는다
   * (점프는 entrance-straight 규약상 진행 방향을 유지하므로 꺾임이 아니다).
   */
  turnPenalty?: number;
  /**
   * 라우팅 허용 영역 (포함 경계, inclusive). 주어지면 이 직사각형 **바깥** 셀로는
   * 진입할 수 없다(지상 인접·지하 점프 타겟 모두). 단 `ends` 셀은 예외(blocked 와 동일).
   * perimeter ring 의 단일 외곽선 불변식 — 라우팅이 ring 직사각형 밖으로 새지 못하게
   * 한다. 미지정이면 제약 없음(기존 동작). 영역을 유한히 가두므로 도달 불가 end 의
   * 무한 frontier 확장도 방지한다.
   */
  bounds?: { x0: number; y0: number; x1: number; y1: number };
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
function searchWithJumps(input: DijkstraInput): DijkstraResult | null {
  const { blocked, corridors, maxJumpDistance, blockGroup, bounds } = input;
  const jumpCostModel = input.jumpCostModel ?? 'flat';
  const turnPenalty = input.turnPenalty ?? 0;
  // bounds 밖 셀 진입 금지(ends 는 예외 — blocked 와 동일 취급). 미지정이면 항상 false.
  const outOfBounds = (x: number, y: number): boolean =>
    bounds !== undefined &&
    (x < bounds.x0 || x > bounds.x1 || y < bounds.y0 || y > bounds.y1);

  // 단일/다중 입력을 끝점 배열로 정규화. 단일 start/end 는 1-원소 배열로 흡수하므로
  // 기존 호출부(routeItem/routeFluid/moduleHop/…)는 동작이 그대로 보존된다.
  const starts: ReadonlyArray<DijkstraEndpoint> =
    input.starts ??
    (input.start
      ? [{ x: input.start.x, y: input.start.y, requiredJump: input.requiredStartJump }]
      : []);
  const ends: ReadonlyArray<DijkstraEndpoint> =
    input.ends ??
    (input.end
      ? [{ x: input.end.x, y: input.end.y, requiredJump: input.requiredEndJump }]
      : []);
  if (starts.length === 0 || ends.length === 0) return null;

  // 싱크 멤버십(개념 ②)·끝점별 점프 제약을 O(1) 조회용으로 인덱싱.
  const endSet = new Set<string>(ends.map((e) => cellKey(e.x, e.y)));
  const endJump = new Map<string, { dx: number; dy: number }>();
  for (const e of ends) if (e.requiredJump) endJump.set(cellKey(e.x, e.y), e.requiredJump);
  const startJump = new Map<string, { dx: number; dy: number }>();
  for (const s of starts) if (s.requiredJump) startJump.set(cellKey(s.x, s.y), s.requiredJump);

  // 시작이 곧 싱크면 0-길이 경로.
  for (const s of starts) {
    if (endSet.has(cellKey(s.x, s.y))) {
      return { cells: [{ x: s.x, y: s.y }], edges: [], cost: 0 };
    }
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
  // 개념 ①: 모든 소스를 동등하게(cost 0) 동시에 seed. 같은 셀 중복은 한 번만.
  for (const s of starts) {
    const sk = stateKey(s.x, s.y, -1);
    if (bestCost.has(sk)) continue;
    bestCost.set(sk, 0);
    enqueue(s.x, s.y, -1, 0);
  }

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

    if (endSet.has(cellKey(cur.x, cur.y))) {
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
      if (blocked.has(cellKey(nx, ny)) && !endSet.has(cellKey(nx, ny))) continue;
      if (outOfBounds(nx, ny) && !endSet.has(cellKey(nx, ny))) continue;
      // 꺾임 비용: 직전 진행 방향(arr)과 다른 방향으로 나아가면 turnPenalty 가산.
      // arr=-1(시작)은 진행 방향이 없어 무비용. 출구(arr>=4)는 위에서 di===exitDir 만
      // 통과하므로 꺾임이 될 수 없다.
      const prevDir = cur.arr >= 4 ? cur.arr - 4 : cur.arr;
      const isTurn = prevDir >= 0 && di !== prevDir;
      const newCost = cur.cost + 1 + (isTurn ? turnPenalty : 0);
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
    // 같은 방향으로만 시작 가능. 시작 셀(arr=-1)만 임의 방향(또는 requiredStartJump) 허용.
    if (maxJumpDistance > 0 && !isExit) {
      const atStart = cur.arr === -1;
      for (let di = 0; di < surfaceDirs.length; di++) {
        const d = surfaceDirs[di];
        if (atStart) {
          // 머신에 닿는 입구(start 출발 점프)는 정해진 방향으로만 — 입구의 표면 면이
          // 머신을 향하도록 (pipe-to-ground 표면 single-side 규칙).
          const rsj = startJump.get(cellKey(cur.x, cur.y));
          if (rsj && (d.dx !== rsj.dx || d.dy !== rsj.dy)) continue;
        } else {
          // entrance-straight: 지상 도착 방향(arr)과 같은 방향 점프만. 꺾으려면 먼저
          // 지상 셀에서 방향을 바꾼 뒤 그 다음 셀에서 점프 → 코너에 연결용 셀이 남는다.
          if (di !== cur.arr) continue;
        }
        for (let k = 1; k <= maxJumpDistance; k++) {
          const nx = cur.x + d.dx * k;
          const ny = cur.y + d.dy * k;
          const nk = stateKey(nx, ny, 4 + di);
          if (blocked.has(cellKey(nx, ny)) && !endSet.has(cellKey(nx, ny))) continue;
          if (outOfBounds(nx, ny) && !endSet.has(cellKey(nx, ny))) continue;
          // 머신에 닿는 출구(end 도착 점프)도 정해진 방향으로만 — 출구의 표면 면이
          // 머신을 향하도록.
          const rej = endJump.get(cellKey(nx, ny));
          if (rej && (d.dx !== rej.dx || d.dy !== rej.dy)) continue;
          if (!isJumpAllowed(cur.x, cur.y, nx, ny, groupCorridors)) continue;
          // 'flat': 점프=2 (긴 직선에서 지상보다 쌈 → 무조건 점프). 'length': k+1 (항상
          // 지상 직선 k 칸보다 1 비쌈 → 지상이 뚫려 있으면 지상, 막혔을 때만 점프=충돌 회피).
          const newCost = cur.cost + (jumpCostModel === 'length' ? k + 1 : 2);
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
 * Dijkstra — 지상 인접 + 지하 점프 페어 통합 탐색. **결과 경로는 한 타일에 두 운반체를
 * 놓지 않는다**(타일 단위 배타성 — 라우터의 당연한 불변식).
 *
 * 내부 코어 `searchWithJumps` 의 상태 키는 `(x, y, 도착방식 arr)` 이라, 한 타일을 *지상 벨트*
 * 로 한 번·*지하 입구/출구* 로 한 번, 서로 다른 방식으로 두 번 밟는 최소-cost 경로가 탐색상
 * 합법으로 나올 수 있다(`blocked` 에는 경로 자신의 셀이 안 들어가므로). 그러면
 * `emitItemPath`/pipe emit 이 그 타일에 엔티티 2개(예: transport-belt + underground-belt
 * 입구)를 emit해 **겹침**이 된다. 이를 막기 위해, 결과 경로에 중복 타일이 있으면 그 타일을
 * `blocked` 에 추가해 **재탐색**하는 lazy-constraint 루프로 감싼다. 매 반복마다 타일 ≥1 개를
 * 새로 차단하므로 유한 타일 안에서 종료한다. 타일 중복 없는 경로를 찾으면 반환, 못 찾으면
 * `null`(→ routeWithFallback 이 다른 포트 페어로 폴백). 정적 occupancy·corridor·방향 제약
 * 검사는 코어에 그대로 위임한다.
 *
 * `input.beltFlow` 가 주어지면 같은 lazy-constraint 루프에서 **외부 벨트 스트림과의
 * 흐름-인접 합류**(타일 배타성의 경계 버전)도 검사한다 — 타일을 공유하지 않더라도 한
 * 벨트의 지표 출력이 다른 라우팅의 벨트 칸으로 떨어지면 두 아이템 스트림이 합쳐지므로,
 * 그 출구/수신 셀을 `blocked` 에 넣어 재탐색한다. {@link beltFlowConflictCell} 참고.
 */
export function dijkstraWithJumps(input: DijkstraInput): DijkstraResult | null {
  let blocked: ReadonlySet<string> = input.blocked;
  // 차단 불가 셀(모든 소스·싱크) — 탐색이 이 셀들 진입을 허용하므로 lazy 재탐색에서
  // 이들을 blocked 에 넣을 수 없다. 단일 start/end 와 다중 starts/ends 양쪽을 흡수.
  const protectedCells = new Set<string>();
  for (const s of input.starts ?? (input.start ? [input.start] : [])) {
    protectedCells.add(cellKey(s.x, s.y));
  }
  for (const e of input.ends ?? (input.end ? [input.end] : [])) {
    protectedCells.add(cellKey(e.x, e.y));
  }
  // 상한: 매 반복 새 타일 1개 이상 차단 → 종료 보장(여유 cap).
  for (let guard = 0; guard < 256; guard++) {
    const result = searchWithJumps({ ...input, blocked });
    if (!result) return null;

    const seen = new Set<string>();
    let bad: { x: number; y: number } | null = null;
    for (const c of result.cells) {
      const k = cellKey(c.x, c.y);
      if (seen.has(k)) {
        bad = c;
        break;
      }
      seen.add(k);
    }

    // 타일 중복이 없으면 외부 벨트 스트림과의 흐름-인접 합류를 검사한다.
    if (!bad && input.beltFlow) {
      bad = beltFlowConflictCell(result, input.beltFlow);
    }

    if (!bad) return result; // 깨끗한 경로.

    // 소스/싱크 셀은 차단 불가(탐색이 진입을 허용) → 이 충돌은 못 피함, 폴백에 위임.
    if (protectedCells.has(cellKey(bad.x, bad.y))) {
      return null;
    }
    const next = new Set(blocked);
    next.add(cellKey(bad.x, bad.y));
    blocked = next;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 벨트 흐름 인접 합류 — 타일 배타성의 *경계* 버전
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 외부(이미 배치된 타 라우팅) 벨트 스트림의 흐름 정보.
 *
 * Factorio 에서 두 벨트는 타일을 공유하지 않아도, *한 벨트의 지표 출력이 다른 벨트의
 * 칸으로 떨어지면* 물리적으로 이어져 아이템이 합류한다(직진 투입·side-load). 라우팅마다
 * 독립 아이템 스트림이므로 이 합류는 항상 의도치 않은 오염이다. 이를 막으려면 새 벨트가:
 *  - 외부 벨트의 출력 칸(`sinkTargets`) 위에 놓이거나(= 외부가 나에게 흘려보냄),
 *  - 자신의 출력 칸이 외부 벨트 타일(`tiles`)이 되어선(= 내가 외부로 흘려보냄) 안 된다.
 */
export interface BeltFlow {
  /** 외부 벨트/지하벨트가 점유한 모든 타일(cellKey). 내 출력이 여기로 향하면 합류. */
  tiles: Set<string>;
  /** 외부 벨트가 지표로 흘려보내는 칸(cellKey). 여기에 내 벨트를 놓으면 외부 흐름을 받음. */
  sinkTargets: Set<string>;
}

/** `direction` 열거값 → 단위 흐름 벡터. (0=N,4=E,8=S,12=W) */
export function directionToVector(dir: Direction): { x: number; y: number } {
  switch (dir) {
    case 0: return { x: 0, y: -1 };
    case 4: return { x: 1, y: 0 };
    case 8: return { x: 0, y: 1 };
    case 12: return { x: -1, y: 0 };
    default: return { x: 0, y: 0 };
  }
}

/**
 * 이미 배치된 area 들의 placed 셀에서 벨트 흐름 정보를 모은다(라우팅을 새로 깔기 전에
 * 호출 — 그 결과의 셀은 아직 area 에 없으므로 자기 자신은 외부로 잡히지 않는다).
 *
 * 지표 출력 칸은 *일반 벨트*와 *지하벨트 출구*만 만든다(지하벨트 입구는 지표로 토출하지
 * 않고 터널로 들어가므로 출력 칸 없음 — 다만 입구 타일 자체는 `tiles` 에 포함되어,
 * 내가 그 타일로 흘려보내는 것은 막는다).
 */
export function collectBeltFlow(areas: ReadonlyArray<Area | undefined>): BeltFlow {
  const tiles = new Set<string>();
  const sinkTargets = new Set<string>();
  for (const area of areas) {
    if (!area) continue;
    for (const p of area.placed) {
      const cell = p.cell;
      const t = cell.entityType;
      if (t !== EntityType.Belt && t !== EntityType.UndergroundBelt) continue;
      tiles.add(cellKey(p.x, p.y));
      if (t === EntityType.UndergroundBelt && cell.undergroundType === 'input') continue;
      const v = directionToVector(cell.direction);
      if (v.x === 0 && v.y === 0) continue;
      sinkTargets.add(cellKey(p.x + v.x, p.y + v.y));
    }
  }
  return { tiles, sinkTargets };
}

/**
 * Dijkstra 결과 경로가 외부 벨트 스트림과 흐름-인접해 합류하는 *첫 셀* 을 반환(없으면
 * null). 충돌 셀을 `blocked` 에 넣고 재탐색하면 그 인접을 피해 우회한다.
 *
 * 각 경로 셀의 종류·지표 출력 방향은 `result.edges` 로 판정한다(emitItemPath 와 동일):
 *  - 나가는 edge 가 점프 → 그 셀은 지하 입구(지표 출력 없음).
 *  - 들어온 edge 가 점프 → 그 셀은 지하 출구(지표 출력 = 점프 방향).
 *  - 그 외 → 일반 벨트(지표 출력 = 다음 셀 방향). 마지막 지상 셀은 소비자(인서터/머신)
 *    쪽으로 흐르므로 "내가 외부로" 검사에서 제외한다(소비자는 벨트가 아니다).
 * 모든 벨트 셀은 "외부가 나에게"(sinkTargets) 검사 대상이다.
 */
function beltFlowConflictCell(
  result: DijkstraResult,
  flow: BeltFlow,
): { x: number; y: number } | null {
  const { cells, edges } = result;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    // 외부 벨트가 이 칸으로 흘려보냄 → 합류.
    if (flow.sinkTargets.has(cellKey(c.x, c.y))) return c;

    const outEdge = i < edges.length ? edges[i] : null;
    const inEdge = i > 0 ? edges[i - 1] : null;
    let outV: { x: number; y: number } | null = null;
    if (outEdge && outEdge !== 'surface') {
      outV = null; // 지하 입구 — 지표 출력 없음.
    } else if (inEdge && inEdge !== 'surface') {
      outV = { x: Math.sign(inEdge.dx), y: Math.sign(inEdge.dy) }; // 지하 출구.
    } else if (outEdge === 'surface') {
      const n = cells[i + 1];
      outV = { x: Math.sign(n.x - c.x), y: Math.sign(n.y - c.y) }; // 일반 벨트(중간).
    } else {
      outV = null; // 마지막 지상 셀 — 소비자 쪽(벨트 아님)으로 흐름.
    }
    // 내 출력이 외부 벨트 타일로 떨어짐 → 합류.
    if (outV && flow.tiles.has(cellKey(c.x + outV.x, c.y + outV.y))) return c;
  }
  return null;
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
