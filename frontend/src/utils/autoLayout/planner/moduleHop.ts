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
  emitFluidPath,
  type DijkstraResult,
} from "../containerRouting";
import { cellKey, faceVector, segment } from "../util/helper";
import type { ModulePort } from "../module/clusterModule";
import { hopMapKey, type HopGeometry, type HopSpec, type PackResult } from "./modulePacking";
import { AUTO_LAYOUT_COORD_DUMP } from "../debugFlags";

export interface HopConfig {
  beltEntityName: string;
  /** 지하벨트 점프 거리(>0 이면 underground 허용). v1 기본 0(지상 전용). */
  beltMaxUndergroundDistance?: number;
  /** 지하벨트 prototype(점프 blockGroup). */
  undergroundBeltEntityName?: string;
  /**
   * 유체 홉(pipe-to-pipe, docs/auto-layout-wizard.fluid-hop.md) 재료. 없으면 유체 홉은
   * 실패 처리(→ 트리 전체 옛 경로 폴백). 파이프는 인서터·방향이 없어 아이템 홉보다 단순하다.
   */
  pipeEntityName?: string;
  pipeMaxUndergroundDistance?: number;
  undergroundPipeEntityName?: string;
  /**
   * 유체별 **금지 칸**(합류 가드) — 홉이 **다른 유체**에 닿지 않게. 키=유체 이름,
   * 값=cellKey 집합(그 유체의 `PipeFlow.blockedTilesHard`). 같은 유체는 안 막는다(공유 허용).
   */
  fluidBlocked?: ReadonlyMap<string, ReadonlySet<string>>;
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
  /**
   * **예약(계획된 체인)으로 깐 홉 수** — 탐색이 없었던 홉.
   *
   * `failures === 0` 은 "길이 났다"만 말하고 **누가 냈는지는 안 말한다.** dijkstra 폴백도
   * 길을 내기 때문이다. 예약 철학이 지켜지는지 보려면 이 수를 봐야 한다
   * (`planned + dijkstraFallback + failures = 아이템 홉 수`).
   */
  planned: number;
  /** 예약이 못 대서 dijkstra 로 넘어간 홉 수 — 0 이 아니면 예약에 구멍이 있다. */
  dijkstraFallback: number;
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

/** p 가 축정렬 구간 a→b 위에 있나(양끝 포함). */
function onSegment(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
): boolean {
  if (a.x === b.x && p.x === a.x) return (p.y - a.y) * (p.y - b.y) <= 0;
  if (a.y === b.y && p.y === a.y) return (p.x - a.x) * (p.x - b.x) <= 0;
  return false;
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
  // 탐색 경계 — 전체 배치 bbox(반출 마진 포함). 홉은 배치 안에서 끝나므로 밖으로 나갈
  // 이유가 없고, 안 가두면 막힌 폴백이 무한 격자를 훑다 터진다.
  const bounds = {
    x0: pack.bbox.x, y0: pack.bbox.y,
    x1: pack.bbox.x + pack.bbox.w - 1, y1: pack.bbox.y + pack.bbox.h - 1,
  };
  const hopBelts = new Set<string>(); // 이미 깐 홉 belt(지하 입/출구 포함)
  const cells: PlacedCell[] = [];
  const corridors: UndergroundCorridor[] = []; // 홉 간 누적 — 같은 직선 위 페어링 절단 방지
  const strippedChestIds = new Set<string>();
  const strippedCellKeys = new Set<string>();
  const routes: HopRoute[] = [];
  let failures = 0;
  let planned = 0;        // 예약 체인으로 깐 홉(탐색 없음)
  let dijkstraFallback = 0; // 예약이 못 대서 탐색으로 넘어간 홉

  // 지하벨트 게이트 — prototype 미지정(위저드에서 지하벨트 미선택)이면 지상 전용(기존
  // 동작). emit 은 emitItemPath(edge-aware)라 점프 경로가 지하벨트 입/출구로 정확히
  // materialize 된다. 'length' 비용 모델이라 지상이 뚫려 있으면 점프는 절대 선택되지
  // 않는다 — 지하는 충돌 회피용으로만.
  const maxJump = config.undergroundBeltEntityName
    ? Math.max(0, config.beltMaxUndergroundDistance ?? 0)
    : 0;
  const blockGroup = config.undergroundBeltEntityName ?? config.beltEntityName;
  // 유체 홉 점프 거리 — 지하파이프를 골랐을 때만. 아이템과 별개(pipe-to-ground blockGroup).
  const maxJumpPipe = config.undergroundPipeEntityName
    ? Math.max(0, config.pipeMaxUndergroundDistance ?? 0)
    : 0;

  // 채널 기하 예약(통합 장부, docs/…channel-geometry-reservation.md) — 계획된 홉은
  // 배정 좌표(계단꼴/열 갈아타기/지하 횡단)를 탐색 없이 체인으로 방출한다. dijkstra 는
  // 최후 폴백으로만 남고, 예약 자리(반출 lane + 다른 계획 홉)를 침범하지 못한다 —
  // "먼저 깔린 경로가 나중 경로의 자리를 뺏는" 예약의 구멍을 여기서 봉인한다.
  const geo = pack.channelGeometry;
  const reservedExport = geo?.reservedExportCells ?? new Set<string>();
  const plannedChains = new Map<string, DijkstraResult>();
  if (geo) {
    for (const hop of pack.hops) {
      const k = hopMapKey(hop);
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
    // 유체 홉(pipe-to-pipe) — 포트가 무한파이프면 유체다. 채널 기하(벨트 크로싱 계획)는
    // 아이템 전용이라 건너뛰고 파이프 경로로 잇는다(docs/auto-layout-wizard.fluid-hop.md).
    if (hop.from.chest.kind === "infinity-pipe") {
      const route = config.pipeEntityName
        ? routeOneFluidHop(hop, base, hopBelts, corridors, maxJumpPipe, config, bounds, config.fluidBlocked?.get(hop.item))
        : { item: hop.item, ok: false, cells: [], corridors: [], reason: "no-pipe-entity" };
      routes.push(route);
      if (!route.ok) { failures += 1; continue; }
      for (const c of route.cells) { cells.push(c); hopBelts.add(cellKey(c.x, c.y)); }
      corridors.push(...route.corridors);
      strippedChestIds.add(hop.from.chest.id);
      strippedChestIds.add(hop.to.chest.id);
      // 유체 포트는 인서터가 없다 — chest(무한파이프) 한 칸만 뗀다(seat=파이프는 남겨 이음).
      for (const key of stripKeys(hop)) strippedCellKeys.add(key);
      continue;
    }

    const k = hopMapKey(hop);
    const chain = plannedChains.get(k);
    let route: HopRoute;
    if (chain && plannedChainClear(chain, k, base, hopBelts, reservedExport, reservedHop)) {
      route = finishChain(hop, chain, config);
      planned += 1;
    } else {
      dijkstraFallback += 1;
      if (chain && AUTO_LAYOUT_COORD_DUMP)
        console.log("[moduleHop] planned chain blocked — dijkstra fallback", k);
      // 다른 예약 자리(반출 lane + 다른 계획 홉)는 dijkstra 도 침범 금지.
      const extra = new Set<string>(reservedExport);
      for (const [k2, cells] of reservedHop) if (k2 !== k) for (const c of cells) extra.add(c);
      route = routeOneHop(hop, base, hopBelts, corridors, maxJump, blockGroup, config, bounds, extra);
      if (!route.ok && extra.size > 0) {
        // 예약이 길을 전부 막은 극단 케이스 — 예약 없이 재시도(홉 실패 = 트리 전체
        // 폴백이므로, 반출 skip-on-failure 보다 훨씬 비싼 회귀를 피한다).
        //
        // **이 재시도는 남의 예약을 밟는다. 그 대가가 연쇄한다**(2026-07-22 조사):
        // 밟힌 계획은 다음 차례에 막혀 자기도 탐색으로 내려가고, 그 탐색이 또 예약을
        // 밟을 수 있다. 관측된 사슬 — 계획 없던 홉 하나가 두 홉을 더 끌고 내려갔다.
        // 그래도 **의도된 거래**다: 여기서 물러나면 홉 실패 → 트리 전체가 옛 경로로
        // 떨어져 훨씬 크게 잃는다. 줄이려면 예약을 "막힘"이 아니라 "비싼 칸"으로 줘서
        // **최소한만 밟게** 해야 하는데, 그건 라우터 비용 모델을 바꾸는 별개 작업이다.
        route = routeOneHop(hop, base, hopBelts, corridors, maxJump, blockGroup, config, bounds);
        if (AUTO_LAYOUT_COORD_DUMP)
          console.log("[moduleHop] 예약 무시 재시도 — 남의 계획을 밟는다(연쇄 가능)", k);
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

  return { cells, corridors, strippedChestIds, strippedCellKeys, routes, failures, planned, dijkstraFallback };
}

/**
 * 한 홉이 떼는 셀 좌표 — **양끝 chest(ghost) 뿐.** 인서터(seat)는 **남긴다.**
 *
 * 1:1 방출(트렁크 비활성)에서 포트는 `[상자][인서터][머신]` 두 칸이다. 그 인서터가
 * **머신에 재료를 넣는 유일한 물건**이라 떼면 머신이 굶는다. 상자 자리에 belt 를 깔면
 * 인서터는 그 belt 에서 집어(픽업 셀 = 상자 자리 = 그대로) 머신에 넣는다 — 픽업 방향이
 * 바뀌지 않으므로 인서터를 그대로 두면 된다.
 */
function stripKeys(hop: HopSpec): string[] {
  const g0 = portGeometry(hop.from);
  const g1 = portGeometry(hop.to);
  return [cellKey(g0.chest.x, g0.chest.y), cellKey(g1.chest.x, g1.chest.y)];
}

function routeOneHop(
  hop: HopSpec,
  base: Set<string>,
  hopBelts: Set<string>,
  corridors: ReadonlyArray<UndergroundCorridor>,
  maxJump: number,
  blockGroup: string,
  config: HopConfig,
  /**
   * 탐색 경계 = 전체 배치 bbox(마진 포함). **없으면 dijkstra 가 무한 격자로 새어나가
   * 폭주한다** — 1:1 방출로 홉이 머신 수만큼 늘고 예약 셀이 길을 좁히면, 막힌 폴백이
   * 바깥으로 끝없이 우회하며 Map 이 터진다(실측: count 4/4/2 에서 46초 후 OOM).
   * 홉은 정의상 배치 안에서 끝나므로 여기에 가둔다.
   */
  bounds: { x0: number; y0: number; x1: number; y1: number },
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
    bounds,
  });
  if (!result) {
    return { item: hop.item, ok: false, cells: [], corridors: [], reason: "no-path" };
  }

  return finishChain(hop, result, config);
}

/**
 * 유체 홉 한 개 — **pipe-to-pipe**(docs/auto-layout-wizard.fluid-hop.md). 아이템 홉보다 단순:
 * 파이프는 인서터가 없어 seat 이음이 없고, 방향이 없어 인접만으로 이어진다. 두 무한파이프
 * (자식 출력 sink · 부모 입력 source)를 떼고 그 자리를 파이프로 메워 잇는다.
 *
 * `fluidBlocked` = **다른 유체** 금지 칸(합류 가드) — 같은 유체는 안 막아 공유 합류를 허용한다.
 * emit 은 검증된 [containerRouting.emitFluidPath] 재사용(지상 pipe + 지하파이프 입/출구).
 */
function routeOneFluidHop(
  hop: HopSpec,
  base: Set<string>,
  hopBelts: Set<string>,
  corridors: ReadonlyArray<UndergroundCorridor>,
  maxJump: number,
  config: HopConfig,
  bounds: { x0: number; y0: number; x1: number; y1: number },
  fluidBlocked?: ReadonlySet<string>,
): HopRoute {
  const from = portGeometry(hop.from); // 자식 출력(collect)
  const to = portGeometry(hop.to); // 부모 입력(supply)
  const fvFrom = faceVector(hop.from.face);
  const fvTo = faceVector(hop.to.face);

  const blocked = new Set<string>(base);
  for (const k of hopBelts) blocked.add(k);
  if (fluidBlocked) for (const k of fluidBlocked) blocked.add(k);
  blocked.delete(cellKey(from.chest.x, from.chest.y));
  blocked.delete(cellKey(to.chest.x, to.chest.y));

  const result = dijkstraWithJumps({
    start: from.chest,
    end: to.chest,
    blocked,
    corridors,
    maxJumpDistance: maxJump,
    // 모든 pipe-to-ground prototype 은 단일 그룹으로 서로 페어링 절단(Factorio 규칙).
    blockGroup: "pipe-to-ground",
    jumpCostModel: "length", // 지상이 뚫려 있으면 항상 지상 — 지하는 충돌 회피용.
    // 끝 셀 점프 방향 강제(지하파이프 입/출구 표면이 트렁크를 향하게). 지상 경로엔 무해.
    requiredStartJump: { dx: fvFrom.x, dy: fvFrom.y },
    requiredEndJump: { dx: -fvTo.x, dy: -fvTo.y },
    bounds,
  });
  if (!result) return { item: hop.item, ok: false, cells: [], corridors: [], reason: "no-path" };

  const pair = synthPair(hop.fromId, hop.toId);
  const emitted = emitFluidPath(result, pair, {
    pipeEntityName: config.pipeEntityName!,
    undergroundPipeEntityName: config.undergroundPipeEntityName,
  });
  return { item: hop.item, ok: true, cells: emitted.placed, corridors: emitted.corridors };
}

/**
 * 체인(chest_from..chest_to) 공통 마무리 — seat 이음, 연속성 불변식, emit.
 * dijkstra 결과와 기하 예약의 결정적 체인이 같은 꼬리를 탄다(단일 출처).
 */
function finishChain(hop: HopSpec, result: DijkstraResult, config: HopConfig): HopRoute {
  const fvTo = faceVector(hop.to.face);

  // 체인 = chest_from … chest_to 그대로. seat(인서터)은 양끝에 **그대로 남아** 있으므로
  // 벨트로 덮지 않는다 — 출력 인서터가 chest_from 자리 belt 에 놓고, 입력 인서터가
  // chest_to 자리 belt 에서 집어 머신에 넣는다.
  const ext: DijkstraResult = result;

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
 * 지하 횡단 = 계단꼴 + 남의 셀 밑을 건너는 점프 여러 개.
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
    case "undergroundCrossing": {
      // 계단꼴의 세 꼭짓점을 순서대로 걷되, 점프 입구를 만나면 지상 대신 지하로 건넌다.
      // 장부가 낸 점프는 계단꼴 위에 순서대로 놓여 있으므로(같은 셀 순서열에서 뽑았다)
      // 여기서 재정렬하지 않는다 — 어긋나면 아래 연속성 검증이 잡아 폴백시킨다.
      const corners = [
        { x: g.trackX, y: s.y },
        { x: g.trackX, y: e.y },
        { ...e },
      ];
      const jumps = [...g.jumps];
      const walkTo = (target: { x: number; y: number }) => {
        for (;;) {
          const cur = cells[cells.length - 1];
          const j = jumps[0];
          // 이 구간(cur→target) 위에서 지하 입구를 만나나?
          //
          // **점프가 이 구간과 같은 방향으로 뻗어야만 이 구간의 것이다**(2026-07-22 수정).
          // [onSegment] 는 끝점을 포함하므로, 계단 **모서리에서 시작하는 점프**는 그 앞
          // 구간(수직)에서도 "구간 위"로 잡힌다. 그걸 먹으면 점프가 우리를 모서리 **너머로**
          // 데려가고, 코드는 여전히 원래 목표(모서리)로 걸어가려 해서 **왔던 길을 되돌아
          // 간다** — 같은 칸을 세 번 지나며 지상 점유로 붙잡는다. 그 가짜 점유가 다른 홉의
          // 정당한 트랙과 부딪히고, 상호 검사가 **둘 다** 폴백시킨다(관측: 홉 5개 중 2개).
          // 방향이 같은지만 보면 그 구간의 점프인지 아닌지가 갈린다.
          const sameDir =
            j !== undefined &&
            Math.sign(target.x - cur.x) === Math.sign(j.to.x - j.from.x) &&
            Math.sign(target.y - cur.y) === Math.sign(j.to.y - j.from.y);
          if (j && sameDir && onSegment(cur, target, j.from)) {
            push(j.from);
            cells.push({ ...j.to });
            const dx = Math.sign(j.to.x - j.from.x);
            const dy = Math.sign(j.to.y - j.from.y);
            edges.push({ dx, dy, k: Math.abs(j.to.x - j.from.x) + Math.abs(j.to.y - j.from.y) });
            jumps.shift();
            continue; // 같은 구간에 점프가 또 있을 수 있다
          }
          push(target);
          return;
        }
      };
      for (const c of corners) walkTo(c);
      if (jumps.length > 0) return null; // 다 못 쓴 점프 = 계단꼴 위에 없던 지시 → 폐기
      break;
    }
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
