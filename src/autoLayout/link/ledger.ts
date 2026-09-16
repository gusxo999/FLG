/**
 * **연결 관심사의 장부** — 납품 경로가 다투는 칸: 전 모듈 점유 · 계획 체인의 예약(납품 · 반출) · 이미 깐 칸과 corridor ·
 * 뗄 상자와 칸 · 계수 넷. 묻고([plannedChainClear]) 적는다([recordRoute]). 고르지 않는다 — 사다리는 `link/policy`.
 *
 * > **내력.** `planner/deliveryRoute.routeDeliveryRoutes` 의 판 · 계획 · 적기 블록과 `buildOccupancy` · `plannedChainClear`
 * > 였다(2026-09-15 계획 구조-2축 · 2 Step 5c).
 */

import type { PlacedCell, UndergroundCorridor } from "../shared/types";
import type { DijkstraResult } from "../shared/route";
import { cellKey } from "../shared/grid";
import type { DeliverySpec, PackResult } from "../tree/types/pack";
import { deliveryKey } from "./policy/edge";
import { buildPlannedChain, stripKeys } from "./shape";
import type { DeliveryConfig, DeliveryResult, DeliveryRoute } from "./types";

/** 전 모듈의 점유 셀(머신 footprint + 모든 placed 셀, chest ghost 포함). */
export function buildOccupancy(pack: PackResult): Set<string> {
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

/** **ⓑ 의 답** — 납품마다 계획 체인 · 못 쓴 사유 · 계획이 예약한 칸(납품마다) · 반출이 예약한 칸. */
export interface PlannedChains {
  plannedChains: Map<string, DijkstraResult>;
  chainMisses: { key: string; reason: string }[];
  reservedDelivery: Map<string, Set<string>>;
  reservedExport: ReadonlySet<string>;
}

/** **ⓑ 계획** — 납품마다 채널 장부의 지시를 칸으로 편다. 편 체인은 예약이 되고, 못 편 것은 사유를 남긴다. */
export function plannedChainsOf(pack: PackResult, maxJump: number): PlannedChains {
  // 채널 기하 예약(통합 장부, docs/…channel-geometry-reservation.md) — 계획된 납품 경로는
  // 배정 좌표(계단꼴/열 갈아타기/지하 횡단)를 탐색 없이 체인으로 방출한다. dijkstra 는
  // 최후 폴백으로만 남고, 예약 자리(반출 트랙 + 다른 계획 납품 경로)를 침범하지 못한다 —
  // "먼저 깔린 경로가 나중 경로의 자리를 뺏는" 예약의 구멍을 여기서 봉인한다.
  const geo = pack.channelGeometry;
  const reservedExport = geo?.reservedExportCells ?? new Set<string>();
  const plannedChains = new Map<string, DijkstraResult>();
  const chainMisses: { key: string; reason: string }[] = [];
  if (geo) {
    for (const delivery of pack.deliveries) {
      const k = deliveryKey(delivery);
      const g = geo.deliveries.get(k);
      if (!g) {
        // 장부가 남긴 사유가 있으면 그걸 쓴다 — "계획이 없다"만 말하면 처방을 못 고른다.
        const why = geo.skips.find((sk) => sk.key === k)?.reason;
        chainMisses.push({ key: k, reason: why ? `no-plan:${why}` : "no-geometry-plan" });
        continue;
      }
      if (g.kind === "undergroundCrossing" && maxJump < 2) {
        chainMisses.push({ key: k, reason: "underground-not-allowed" }); // 지하 미허용 — dijkstra 로
        continue;
      }
      const chain = buildPlannedChain(delivery, g);
      if (chain) plannedChains.set(k, chain);
      else chainMisses.push({ key: k, reason: `chain-build-failed(${g.kind})` });
    }
  } else {
    for (const delivery of pack.deliveries)
      chainMisses.push({ key: deliveryKey(delivery), reason: "channel-geometry-off" });
  }
  const reservedDelivery = new Map<string, Set<string>>();
  for (const [k, chain] of plannedChains)
    reservedDelivery.set(k, new Set(chain.cells.map((c) => cellKey(c.x, c.y))));
  return { plannedChains, chainMisses, reservedDelivery, reservedExport };
}

/** **ⓓ 장부** — 이 실행이 깐 것과 계수. 뒤 납품이 피하고, 결과로 나간다. */
export interface DeliveryLedger {
  deliveryBelts: Set<string>;
  cells: PlacedCell[];
  corridors: UndergroundCorridor[];
  ledger: UndergroundCorridor[];
  strippedChestIds: Set<string>;
  strippedCellKeys: Set<string>;
  routes: DeliveryRoute[];
  failures: number;
  reservationOverrun: number;
  planned: number;
  dijkstraFallback: number;
}

/** **ⓓ 판** — 빈 장부. 점프 검사용 장부만 씨앗 corridor 를 들고 시작한다. */
export function openDeliveryLedger(config: DeliveryConfig): DeliveryLedger {
  const deliveryBelts = new Set<string>(); // 이미 깐 납품 경로 belt(지하 입/출구 포함)
  const cells: PlacedCell[] = [];
  const corridors: UndergroundCorridor[] = []; // 이 실행이 **깐** corridor (결과로 나간다)
  // 점프 검사용 장부 = 씨앗(모듈 종착) + 깐 것. 결과 배열과 갈라 둔다 —
  // 씨앗은 이 실행이 깐 것이 아니므로 `DeliveryResult.corridors` 에 섞이면 안 된다.
  const ledger: UndergroundCorridor[] = [...(config.seedCorridors ?? [])];
  const strippedChestIds = new Set<string>();
  const strippedCellKeys = new Set<string>();
  const routes: DeliveryRoute[] = [];
  let failures = 0;
  let reservationOverrun = 0;
  let planned = 0;        // 예약 체인으로 깐 납품 경로(탐색 없음)
  let dijkstraFallback = 0; // 예약이 못 대서 탐색으로 넘어간 납품 경로
  return { deliveryBelts, cells, corridors, ledger, strippedChestIds, strippedCellKeys, routes, failures, reservationOverrun, planned, dijkstraFallback };
}

/** **ⓓ-3 적기** — 신원 · 깐 칸 · corridor 둘 · 뗄 것. 못 깐 경로는 신원과 실패 수만 남긴다. */
export function recordRoute(laid: DeliveryLedger, delivery: DeliverySpec, k: string, route: Omit<DeliveryRoute, "key">): void {
  const { deliveryBelts, cells, corridors, ledger, strippedChestIds, strippedCellKeys, routes } = laid;
  routes.push({ ...route, key: k });
  if (!route.ok) {
    laid.failures += 1;
    return;
  }
  for (const c of route.cells) {
    cells.push(c);
    deliveryBelts.add(cellKey(c.x, c.y));
  }
  corridors.push(...route.corridors);
  ledger.push(...route.corridors);
  strippedChestIds.add(delivery.from.chest.id);
  strippedChestIds.add(delivery.to.chest.id);
  for (const sk of stripKeys(delivery)) strippedCellKeys.add(sk);
}

/** **결과** — 장부와 계획의 사유를 한 벌로(키 순서가 오늘 그대로다). */
export function deliveryResultOf(laid: DeliveryLedger, plans: PlannedChains): DeliveryResult {
  const { cells, corridors, strippedChestIds, strippedCellKeys, routes, failures, planned, dijkstraFallback, reservationOverrun } = laid;
  const { chainMisses } = plans;
  return { cells, corridors, strippedChestIds, strippedCellKeys, routes, failures, planned, dijkstraFallback, reservationOverrun, chainMisses };
}

/**
 * 계획 체인의 안전 검증 — 중간 셀(양 끝 chest 제외)이 모듈/기존 belt/다른 예약 자리와
 * 겹치지 않아야 방출한다. 겹치면(장부 추상화가 놓친 점유) dijkstra 폴백 + 로그.
 */
export function plannedChainClear(
  chain: DijkstraResult,
  ownKey: string,
  base: ReadonlySet<string>,
  deliveryBelts: ReadonlySet<string>,
  reservedExport: ReadonlySet<string>,
  reservedDelivery: ReadonlyMap<string, ReadonlySet<string>>,
  /**
   * 유체 납품 경로의 **합류 가드** — 이 유체가 닿으면 안 되는 칸(다른 유체의 hard 지도).
   *
   * 장부는 자기가 배정한 경로들 사이의 인접만 안다. 모듈 **안**에 이미 깔린 남의 유체
   * 트렁크는 장부 밖의 사실이라, 계획 체인이 그 옆을 지나가는 것을 장부가 못 막는다.
   * 옛 탐색 경로([routeOneFluidDelivery])는 이걸 blocked 로 받아 피했다 — 계획 경로도 같은
   * 지도를 봐야 두 유체가 한 통이 되는 사고를 막는다.
   */
  fluidBlocked?: ReadonlySet<string>,
): string | null {
  // **막혔으면 어디서·누구에게 막혔는지 낸다** — `false` 만 내면 소비처가 "막혔다"만 알고
  // 처방을 못 고른다. 계획이 안 쓰이는 것은 예약 철학이 깨진 신호라 사유가 곧 수사 단서다.
  for (let i = 1; i + 1 < chain.cells.length; i++) {
    const c = chain.cells[i];
    const k = cellKey(c.x, c.y);
    if (base.has(k)) return `모듈 몸통 (${c.x},${c.y})`;
    if (deliveryBelts.has(k)) return `이미 깔린 납품 벨트 (${c.x},${c.y})`;
    if (reservedExport.has(k)) return `반출 예약 (${c.x},${c.y})`;
    if (fluidBlocked?.has(k)) return `유체 합류 가드 (${c.x},${c.y})`;
    for (const [k2, cells] of reservedDelivery)
      if (k2 !== ownKey && cells.has(k)) return `남의 납품 예약 ${k2} (${c.x},${c.y})`;
  }
  return null;
}
