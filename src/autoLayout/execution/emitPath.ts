/**
 * 방출 원시 — Dijkstra 결과(좌표)를 실제 셀로 바꾸고 area 에 적용한다.
 *
 * `containerRouting`(탐색·파사드)에서 **셀을 만드는 부분만** 떼어낸 것이다.
 * 여기 있는 함수는 경로를 *찾지* 않는다 — 이미 찾은 경로를 *놓는다*.
 *
 * 소비자:
 *  - `planner/moduleHop` — 납품(홉) 벨트·파이프 방출
 *  - `containerRouting` 의 파사드(`routeItem`·`routeFluid`) — 자기 결과를 셀로
 *  - `areaUnification`·`planner/moduleWizard` — `commitRouting`
 */

import { EntityType, createEmptyCell } from '../../types/layout';
import type { Direction, GridCell } from '../../types/layout';
import type {
  Area,
  PlacedCell,
  PortPair,
  Routing,
  UndergroundCorridor,
} from '../containerModel';
import { vectorToDirection, PIPE_BLOCK_GROUP } from '../util/helper';
import { makeBeltCell } from '../util/cellBuilder';
// 타입 전용 — 런타임 간선이 아니므로 containerRouting 과 순환이 되지 않는다.
import type { DijkstraResult, JumpEdge } from '../planner/containerRouting';

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
 *
 * ## Deprecated Dijkstra Guard
 * **여기서 깔리는 파이프는 합류 가드를 안 거친다.** 파이프는 방향이 없어 닿기만 하면
 * 남의 관망과 합쳐지는데(다른 유체면 오염, 남의 머신 출력 상자를 스치면 생산물 유실),
 * 그 가드(`collectPipeFlow`/`PipeFlow`)는 **새 모듈 파이프라인에만** 걸려 있다. 여기는
 * 폐기 예정인 옛 경로라 골든 스냅샷 회귀를 피하려고 **일부러** 안 걸었다.
 *
 * 유체 배치에서 원인 모를 오염·유실이 보이면 이 표식(`Deprecated Dijkstra Guard`)으로
 * 코드와 [docs/auto-layout-wizard.known-limits.md] 를 함께 grep 할 것.
 */
export function emitFluidPath(
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
