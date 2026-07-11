/**
 * moduleHop — 모듈 간 홉 (조각 4, 순수·무상자 belt-to-belt).
 *
 * 단일 출처: 본 설계안(모듈 출력 경계 / ⑤ 핸드오프 = 벨트-투-벨트 무상자).
 *
 * [modulePacking.packModuleTree] 가 낸 `HopSpec`(자식 출력 포트 → 부모 입력 포트)을
 * 받아, 두 포트의 **경계 무한상자 + 경계 인서터를 떼고** 그 자리를 belt 로 메워
 * 자식 출력 trunk 끝 → 부모 입력 trunk 머리를 **상자 없이 직접** 잇는다.
 *
 * ## 왜 무상자
 * generateModule 은 클러스터를 "루트인 척" 생성해 모든 포트가 무한상자(외부 소스/싱크)로
 * 끝난다. 두 모듈을 *실제로* 연결하려면 그 경계 상자를 떼고 belt 를 이어야 한다 — 안 그러면
 * 끊긴 무한버퍼 두 개가 되어 물류가 가짜가 된다.
 *
 * ## 포트 기하 (계약 추가 없이 anchor+face 에서 유도)
 * emitTrunk 규약상 한 포트는 `chest -- seat(인서터) -- trunkStart(belt)` 가 일직선(2칸)이고
 * `face` 는 바깥 방향(클러스터→ring)이다. 따라서:
 *   - chest    = `anchor`
 *   - seat     = `anchor − faceVec(face)`   (인서터 — 제거 대상)
 *   - trunkStart = `anchor − 2·faceVec(face)` (기존 trunk belt — 유지)
 * 출력(collect)은 trunk 흐름이 chest 쪽(바깥)을 향하고, 입력(supply)은 chest→trunk(안쪽)을
 * 향한다. 그래서 새 belt 체인은 `seat_from → chest_from → …경로… → chest_to → seat_to` 로
 * 흐른다(각 셀 방향 = 다음 셀 향함).
 *
 * ## 경로탐색
 * 검증된 [containerRouting.dijkstraWithJumps] 를 그대로 재사용 — start=chest_from,
 * end=chest_to, blocked=전 모듈 occupancy(이 홉의 두 chest 만 제외).
 *
 * ## 지하벨트 (조각 C)
 * emit 을 [containerRouting.emitItemPath] 로 통일(edge-aware, 단일 출처)해 점프 경로를
 * 지하벨트 입/출구로 materialize 한다. 정책:
 *  - `jumpCostModel: 'length'` — 지상이 뚫려 있으면 항상 지상, 점프는 충돌 회피용으로만.
 *  - 탐색 자체가 entrance/exit-straight 를 강제(진행 방향으로만 점프 시작·출구 후 직진).
 *    남는 구멍은 양 끝 셀뿐이라 `requiredStartJump`(트렁크 유입 방향, half-lane side-load
 *    방지)·`requiredEndJump`(트렁크 유출 방향 — 어기면 출구가 seat 를 안 향해 물류 누수)
 *    로 막는다.
 *  - corridor 는 홉 간 누적 전달(같은 직선 위 페어링 절단 방지)하고 결과로 내보내
 *    호출자(moduleWizard)가 Area/Routing 에 기록한다.
 *  - 게이트: `undergroundBeltEntityName` 이 없거나 distance≤0 이면 지상 전용(기존 동작).
 *
 * 무배선·순수 — Area·store 의존 0. 단위 테스트 + 브라우저 ASCII harness 로만 검증.
 */

import type {
  ContainerPort,
  PlacedCell,
  PortFace,
  PortPair,
  UndergroundCorridor,
} from "../containerModel";
import {
  dijkstraWithJumps,
  emitItemPath,
  type DijkstraResult,
} from "../containerRouting";
import { cellKey, faceVector, segment } from "../util/helper";
import type { ModulePort } from "../module/clusterModule";
import { hopKey, type HopGeometry, type HopSpec, type PackResult } from "./modulePacking";
import { AUTO_LAYOUT_COORD_DUMP } from "../debugFlags";

export interface HopConfig {
  beltEntityName: string;
  /** 지하벨트 점프 거리(>0 이면 underground 허용). v1 기본 0(지상 전용). */
  beltMaxUndergroundDistance?: number;
  /** 지하벨트 prototype(점프 blockGroup). */
  undergroundBeltEntityName?: string;
}

/** 한 홉의 라우팅 결과. */
export interface HopRoute {
  item: string;
  ok: boolean;
  /** 홉 belt/지하벨트 셀들(경계 chest/seat 자리 포함). 실패 시 빈 배열. */
  cells: PlacedCell[];
  /** 이 홉이 깐 지하 corridor 들(점프 0 이면 빈 배열). */
  corridors: UndergroundCorridor[];
  reason?: string;
}

export interface ModuleHopResult {
  /** 모든 홉 belt 셀(절대 좌표). */
  cells: PlacedCell[];
  /** 모든 홉의 지하 corridor(절대 좌표) — Area.undergroundCorridors 로 기록 대상. */
  corridors: UndergroundCorridor[];
  /** 떼야 할 무한상자 컨테이너 id(자식 출력 싱크 + 부모 입력 소스). */
  strippedChestIds: Set<string>;
  /** 떼야 할 모듈 셀 좌표("x,y") — 경계 chest ghost + 경계 인서터. */
  strippedCellKeys: Set<string>;
  routes: HopRoute[];
  /** 경로 못 찾은 홉 수. */
  failures: number;
}

/** 포트의 경계 기하 — anchor + face 에서 유도. */
function portGeometry(port: ModulePort): {
  chest: { x: number; y: number };
  seat: { x: number; y: number };
  trunkStart: { x: number; y: number };
} {
  const fv = faceVector(port.face);
  const chest = { x: port.anchor.x, y: port.anchor.y };
  const seat = { x: chest.x - fv.x, y: chest.y - fv.y };
  const trunkStart = { x: chest.x - 2 * fv.x, y: chest.y - 2 * fv.y };
  return { chest, seat, trunkStart };
}

/** makeBeltCell 의 entityId 생성용 최소 PortPair. */
function synthPair(producerId: string, consumerId: string): PortPair {
  const port = (containerId: string): ContainerPort => ({
    containerId,
    cell: { x: 0, y: 0 },
    face: "N" as PortFace,
    kind: "item",
  });
  return { producer: port(producerId), consumer: port(consumerId) };
}

/** 전 모듈의 점유 셀(머신 footprint + 모든 placed 셀, chest ghost 포함). */
function buildOccupancy(pack: PackResult): Set<string> {
  const occ = new Set<string>();
  for (const pl of pack.placements) {
    for (const m of pl.module.machines)
      for (let dx = 0; dx < m.size.w; dx++)
        for (let dy = 0; dy < m.size.h; dy++)
          occ.add(cellKey(m.origin.x + dx, m.origin.y + dy));
    for (const c of pl.module.cells) occ.add(cellKey(c.x, c.y));
  }
  return occ;
}

/**
 * 모든 홉을 라우팅. 결정적 순서(packResult.hops 순서)로 누적 occupancy 를 공유해
 * 뒤 홉이 앞 홉 belt 를 피한다.
 */
export function routeModuleHops(pack: PackResult, config: HopConfig): ModuleHopResult {
  const base = buildOccupancy(pack);
  const hopBelts = new Set<string>(); // 이미 깐 홉 belt(지하 입/출구 포함)
  const cells: PlacedCell[] = [];
  const corridors: UndergroundCorridor[] = []; // 홉 간 누적 — 같은 직선 위 페어링 절단 방지
  const strippedChestIds = new Set<string>();
  const strippedCellKeys = new Set<string>();
  const routes: HopRoute[] = [];
  let failures = 0;

  // 지하벨트 게이트 — prototype 미지정(위저드에서 지하벨트 미선택)이면 지상 전용(기존
  // 동작). emit 은 emitItemPath(edge-aware)라 점프 경로가 지하벨트 입/출구로 정확히
  // materialize 된다. 'length' 비용 모델이라 지상이 뚫려 있으면 점프는 절대 선택되지
  // 않는다 — 지하는 충돌 회피용으로만.
  const maxJump = config.undergroundBeltEntityName
    ? Math.max(0, config.beltMaxUndergroundDistance ?? 0)
    : 0;
  const blockGroup = config.undergroundBeltEntityName ?? config.beltEntityName;

  // 채널 기하 예약(통합 장부, docs/…channel-geometry-reservation.md) — 계획된 홉은
  // 배정 좌표(계단꼴/열 갈아타기/지하 횡단)를 탐색 없이 체인으로 방출한다. dijkstra 는
  // 최후 폴백으로만 남고, 예약 자리(반출 lane + 다른 계획 홉)를 침범하지 못한다 —
  // "먼저 깔린 경로가 나중 경로의 자리를 뺏는" 예약의 구멍을 여기서 봉인한다.
  const geo = pack.channelGeometry;
  const reservedExport = geo?.reservedExportCells ?? new Set<string>();
  const plannedChains = new Map<string, DijkstraResult>();
  if (geo) {
    for (const hop of pack.hops) {
      const k = hopKey(hop.fromId, hop.toId, hop.item);
      const g = geo.hops.get(k);
      if (!g) continue;
      if (g.kind === "undergroundCrossing" && maxJump < 2) continue; // 지하 미허용 — dijkstra 로
      const chain = buildPlannedChain(hop, g);
      if (chain) plannedChains.set(k, chain);
    }
  }
  const reservedHop = new Map<string, Set<string>>();
  for (const [k, chain] of plannedChains)
    reservedHop.set(k, new Set(chain.cells.map((c) => cellKey(c.x, c.y))));

  for (const hop of pack.hops) {
    const k = hopKey(hop.fromId, hop.toId, hop.item);
    const chain = plannedChains.get(k);
    let route: HopRoute;
    if (chain && plannedChainClear(chain, k, base, hopBelts, reservedExport, reservedHop)) {
      route = finishChain(hop, chain, config);
    } else {
      if (chain && AUTO_LAYOUT_COORD_DUMP)
        console.log("[moduleHop] planned chain blocked — dijkstra fallback", k);
      // 다른 예약 자리(반출 lane + 다른 계획 홉)는 dijkstra 도 침범 금지.
      const extra = new Set<string>(reservedExport);
      for (const [k2, cells] of reservedHop) if (k2 !== k) for (const c of cells) extra.add(c);
      route = routeOneHop(hop, base, hopBelts, corridors, maxJump, blockGroup, config, extra);
      if (!route.ok && extra.size > 0) {
        // 예약이 길을 전부 막은 극단 케이스 — 예약 없이 재시도(홉 실패 = 트리 전체
        // 폴백이므로, 반출 skip-on-failure 보다 훨씬 비싼 회귀를 피한다).
        route = routeOneHop(hop, base, hopBelts, corridors, maxJump, blockGroup, config);
      }
    }
    routes.push(route);
    if (!route.ok) {
      failures += 1;
      continue;
    }
    for (const c of route.cells) {
      cells.push(c);
      hopBelts.add(cellKey(c.x, c.y));
    }
    corridors.push(...route.corridors);
    strippedChestIds.add(hop.from.chest.id);
    strippedChestIds.add(hop.to.chest.id);
    for (const k of stripKeys(hop)) strippedCellKeys.add(k);
  }

  return { cells, corridors, strippedChestIds, strippedCellKeys, routes, failures };
}

/** 한 홉이 떼는 셀 좌표 — 양끝 chest(ghost) + 양끝 seat(인서터). */
function stripKeys(hop: HopSpec): string[] {
  const g0 = portGeometry(hop.from);
  const g1 = portGeometry(hop.to);
  return [
    cellKey(g0.chest.x, g0.chest.y),
    cellKey(g0.seat.x, g0.seat.y),
    cellKey(g1.chest.x, g1.chest.y),
    cellKey(g1.seat.x, g1.seat.y),
  ];
}

function routeOneHop(
  hop: HopSpec,
  base: Set<string>,
  hopBelts: Set<string>,
  corridors: ReadonlyArray<UndergroundCorridor>,
  maxJump: number,
  blockGroup: string,
  config: HopConfig,
  extraBlocked?: ReadonlySet<string>,
): HopRoute {
  const from = portGeometry(hop.from); // 자식 출력(collect)
  const to = portGeometry(hop.to); // 부모 입력(supply)
  const fvFrom = faceVector(hop.from.face);
  const fvTo = faceVector(hop.to.face);

  // blocked = 전 모듈 + 이미 깐 홉 belt + 예약 자리(기하 예약) − 이 홉의 두 chest(start/end).
  // seat 은 막은 채로 둬 경로가 클러스터 안쪽으로 새지 않게 한다.
  const blocked = new Set<string>(base);
  for (const k of hopBelts) blocked.add(k);
  if (extraBlocked) for (const k of extraBlocked) blocked.add(k);
  blocked.delete(cellKey(from.chest.x, from.chest.y));
  blocked.delete(cellKey(to.chest.x, to.chest.y));

  const result = dijkstraWithJumps({
    start: from.chest,
    end: to.chest,
    blocked,
    corridors,
    maxJumpDistance: maxJump,
    blockGroup,
    // 지하벨트는 충돌 회피용으로만 — 지상이 뚫려 있으면 항상 지상을 택한다.
    jumpCostModel: 'length',
    // 끝 셀 점프의 방향 강제. 탐색이 entrance/exit-straight 를 이미 보장하므로 남는
    // 구멍은 양 끝뿐: 시작 점프는 seat_from→chest_from 유입 방향(+fv, 어기면 half-lane
    // side-load), 끝 점프는 chest_to→seat_to 유출 방향(−fv, 어기면 출구가 seat 를 안
    // 향해 아이템이 다른 칸으로 샘 = 누수).
    requiredStartJump: { dx: fvFrom.x, dy: fvFrom.y },
    requiredEndJump: { dx: -fvTo.x, dy: -fvTo.y },
  });
  if (!result) {
    return { item: hop.item, ok: false, cells: [], corridors: [], reason: "no-path" };
  }

  return finishChain(hop, result, config);
}

/**
 * 체인(chest_from..chest_to) 공통 마무리 — seat 이음, 연속성 불변식, emit.
 * dijkstra 결과와 기하 예약의 결정적 체인이 같은 꼬리를 탄다(단일 출처).
 */
function finishChain(hop: HopSpec, result: DijkstraResult, config: HopConfig): HopRoute {
  const from = portGeometry(hop.from);
  const to = portGeometry(hop.to);
  const fvTo = faceVector(hop.to.face);

  // 새 체인: seat_from → [경로 셀들(chest_from..chest_to)] → seat_to. 양 끝 이음매는
  // 정의상 surface(seat↔chest 는 인접 1칸)라 edge 'surface' 로 붙인다.
  const ext: DijkstraResult = {
    cells: [from.seat, ...result.cells, to.seat],
    edges: ["surface", ...result.edges, "surface"],
    cost: result.cost,
  };

  // INVARIANT: 체인은 텔레포트하지 않는다 — surface edge 는 인접 1칸, jump edge 는
  // 축 정렬 + 거리 k 여야 한다. emitItemPath 는 edge 를 신뢰하므로 어긋난 결과를
  // *조용히 내보내지 말고* 홉 실패로 처리해 트리가 옛 경로로 폴백하게 한다(가짜 물류 방지).
  for (let i = 0; i + 1 < ext.cells.length; i++) {
    const a = ext.cells[i];
    const b = ext.cells[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const edge = ext.edges[i];
    const okStep =
      edge === "surface"
        ? Math.abs(dx) + Math.abs(dy) === 1
        : dx === edge.dx * edge.k && dy === edge.dy * edge.k;
    if (!okStep) {
      return { item: hop.item, ok: false, cells: [], corridors: [], reason: "discontinuous-chain" };
    }
  }

  const pair = synthPair(hop.from.chest.id, hop.to.chest.id);
  // 마지막 셀(seat_to)의 방향 = trunkStart_to 쪽 = −fv_to. emitItemPath 는
  // `-consumerOut` 방향으로 emit 하므로 consumerOut = +fv_to 를 넘긴다.
  const emitted = emitItemPath(
    ext,
    pair,
    {
      beltEntityName: config.beltEntityName,
      undergroundBeltEntityName: config.undergroundBeltEntityName,
    },
    { x: fvTo.x, y: fvTo.y },
  );
  return { item: hop.item, ok: true, cells: emitted.placed, corridors: emitted.corridors };
}

/**
 * 기하 예약의 방출 지시 → 결정적 체인(chest_from..chest_to, 탐색 없음).
 * 계단꼴 = 가로 진입·세로 주행·가로 진출, 열 갈아타기 = 중간 트랙 변경 1회,
 * 지하 횡단 = 절단선(반출 트랙) 셀 하나를 점프(k=2)로 건너뜀.
 * 축 정렬이 깨진 지시(예: straight 인데 행이 다름)는 null — 호출자가 dijkstra 폴백.
 */
function buildPlannedChain(hop: HopSpec, g: HopGeometry): DijkstraResult | null {
  const s = portGeometry(hop.from).chest;
  const e = portGeometry(hop.to).chest;
  const cells: { x: number; y: number }[] = [{ ...s }];
  const edges: DijkstraResult["edges"][number][] = [];
  const push = (to: { x: number; y: number }) => {
    const cur = cells[cells.length - 1];
    for (const c of segment(cur, to)) {
      cells.push(c);
      edges.push("surface");
    }
  };
  // 지하 횡단(가로) — (crossX+1) → (crossX-1), 서쪽 진행(자식 E → 부모 W) 점프.
  const jumpWest = (row: number, crossX: number) => {
    push({ x: crossX + 1, y: row });
    cells.push({ x: crossX - 1, y: row });
    edges.push({ dx: -1, dy: 0, k: 2 });
  };
  // 지하 횡단(세로) — 세로 주행 도중 crossRow 를 진행 방향(dir)으로 점프.
  const jumpVertical = (col: number, crossRow: number, dir: 1 | -1) => {
    push({ x: col, y: crossRow - dir });
    cells.push({ x: col, y: crossRow + dir });
    edges.push({ dx: 0, dy: dir, k: 2 });
  };

  switch (g.kind) {
    case "straight":
      if (s.y !== e.y) return null;
      push(e);
      break;
    case "staircase":
      push({ x: g.trackX, y: s.y });
      push({ x: g.trackX, y: e.y });
      push(e);
      break;
    case "columnSwitch":
      push({ x: g.startTrackX, y: s.y });
      push({ x: g.startTrackX, y: g.switchY });
      push({ x: g.endTrackX, y: g.switchY });
      push({ x: g.endTrackX, y: e.y });
      push(e);
      break;
    case "undergroundCrossing":
      if (g.axis === "row") {
        // 세로 주행 도중 반출의 가로 진입 행(crossRow)을 세로 점프.
        if (!(Math.min(s.y, e.y) < g.crossRow && g.crossRow < Math.max(s.y, e.y))) return null;
        push({ x: g.trackX, y: s.y });
        jumpVertical(g.trackX, g.crossRow, e.y > s.y ? 1 : -1);
        push({ x: g.trackX, y: e.y });
      } else if (g.crossRow === s.y) {
        // 가로 진입 도중 반출의 세로 주행 열(crossX)을 가로 점프.
        jumpWest(s.y, g.crossX);
        push({ x: g.trackX, y: s.y });
        push({ x: g.trackX, y: e.y });
      } else {
        push({ x: g.trackX, y: s.y });
        push({ x: g.trackX, y: e.y });
        jumpWest(e.y, g.crossX);
      }
      push(e);
      break;
  }

  // segment() 는 축 정렬 입력만 안전 — 연속성 검증에 실패한 지시는 폐기(폴백).
  for (let i = 0; i + 1 < cells.length; i++) {
    const dx = cells[i + 1].x - cells[i].x;
    const dy = cells[i + 1].y - cells[i].y;
    const edge = edges[i];
    const okStep =
      edge === "surface"
        ? Math.abs(dx) + Math.abs(dy) === 1
        : dx === edge.dx * edge.k && dy === edge.dy * edge.k;
    if (!okStep) return null;
  }
  return { cells, edges, cost: cells.length };
}

/**
 * 계획 체인의 안전 검증 — 중간 셀(양 끝 chest 제외)이 모듈/기존 belt/다른 예약 자리와
 * 겹치지 않아야 방출한다. 겹치면(장부 추상화가 놓친 점유) dijkstra 폴백 + 로그.
 */
function plannedChainClear(
  chain: DijkstraResult,
  ownKey: string,
  base: ReadonlySet<string>,
  hopBelts: ReadonlySet<string>,
  reservedExport: ReadonlySet<string>,
  reservedHop: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  for (let i = 1; i + 1 < chain.cells.length; i++) {
    const k = cellKey(chain.cells[i].x, chain.cells[i].y);
    if (base.has(k) || hopBelts.has(k) || reservedExport.has(k)) return false;
    for (const [k2, cells] of reservedHop) if (k2 !== ownKey && cells.has(k)) return false;
  }
  return true;
}
