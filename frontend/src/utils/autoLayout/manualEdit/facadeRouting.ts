/**
 * 라우팅 파사드 — **비활성 구역**(수동 편집).
 *
 * "포트 페어 하나 → 완성된 라우팅" 을 돌려주던 고수준 API 다. 탐색(dijkstra)과
 * 방출(emit*)을 **한 함수 안에서 엮는 것**이 이 계층의 책임이었다 — 결함이 아니라
 * 파사드의 일이다.
 *
 * 배치 파이프라인은 이걸 쓰지 않는다. 저수준 원시(`dijkstraWithJumps`·`emitItemPath`)를
 * 직접 조합한다. 이 파일의 소비자는 `routeFallback` 하나뿐이고, 그 위는 드래그·라우팅
 * 편집이다. 무엇을 하려던 코드인지는 [README.md](../../../../../docs/README.md) 참조.
 */

import type {
  Area,
  ContainerPort,
  PortKind,
  PortPair,
  PlacedCell,
  RoutePorts,
  Routing,
  RoutingAttempt,
  RoutingKind,
} from '../containerModel';
import { cellKey, faceVector, PIPE_BLOCK_GROUP } from '../util/helper';
import { makeInserterCell } from '../util/cellBuilder';
import { emitItemPath, emitFluidPath } from '../execution/emitPath';
import {
  buildOccupancy,
  dijkstraWithJumps,
  collectBeltFlow,
  type DijkstraEndpoint,
} from '../planner/containerRouting';


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
 * 통과 정책 (placement-search §4):
 *  - machine / inserter / belt-fixed / pipe-fixed: 통과 불가.
 *  - belt-route: item routing 만 통과 가능 (현재는 통과 불가로 단순화).
 *  - pipe-route(같은 fluid): fluid routing 만 통과 가능 (1차 미구현).
 *
 * 1차 구현은 *모든 placed cell 을 통과 불가* 로 단순화 — 라우팅이 라우팅 위를
 * 지나는 케이스는 후속 커밋에서 belt-mixing 정책과 함께 도입.
 */
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

