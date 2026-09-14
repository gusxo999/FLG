/**
 * **통로 관심사의 도형** — 행 채널의 칸 범위 · 납품 끝의 절대 행 · 통로 배정의 절대좌표 지시.
 *
 * 장부(`channel/ledger`)가 트랙 **번호**를 정하면 여기가 그 번호를 **행 · 열**로 옮긴다. 자리가 선 뒤에만 된다.
 *
 * > **내력.** `modulePacking.packModuleTree` 의 `5)`·`6)`·`6b)` 블록과 `materializeChannelGeometry` 였다
 * > (2026-09-14 계획 구조-2축 · 2 Step 3c-3). `materializeChannelGeometry` 는 **통째로** 옮겼다 — 납품과 반출이
 * > 같은 트랙 풀을 다투므로 관심사로 가르려면 그 다툼을 먼저 풀어야 한다(code-folders).
 */

import type { GeneratedModule, ModulePort } from "../../module/types/module";
import { moduleExtent, type Orientation } from "../../module/moduleTransform";
import type { ChannelGeometryPlan } from "../channelGeometryPlanner";
import type { PerimeterExitPlan } from "../perimeterExitPlanner";
import { segment, PERIMETER_MARGIN } from "../../util/helper";
import { AUTO_LAYOUT_COORD_DUMP } from "../../debugFlags";
import type {
  DeliveryDirective, ModulePlacement, PackChannelGeometry, RowChannel, RowChannelEntry,
} from "../tree/types";
import type { DeliveryPairing } from "../link/arith";

/**
 * **⑥ 행 채널 자리** — 이제야 좌표가 붙는다. `top`/`bottom` 은 행 채널의 **빈 칸 범위**다.
 *
 *    사이 행 채널는 두 모듈이 경계다([stackColumns] 가 높이만큼 벌려 놓았다). 마진은 바깥이 열려 있으므로
 *    자기 높이만큼 뻗는다 — 예전의 `fitRowChannel` 이 하던 일이 여기로 접혔다.
 */
export function placeRowChannels(
  rowChannels: readonly RowChannel[],
  topY: ReadonlyMap<string, number>,
  oriented: ReadonlyMap<string, { module: GeneratedModule; orientation: Orientation }>,
): void {
  const heightOf = (id: string): number => moduleExtent(oriented.get(id)!.module).h;
  for (const b of rowChannels) {
    if (b.kind === "between") {
      b.top = topY.get(b.above!)! + heightOf(b.above!);
      b.bottom = topY.get(b.below!)! - 1;
    } else if (b.kind === "marginN") {
      b.bottom = topY.get(b.below!)! - 1;
      b.top = b.bottom - (b.height - 1);
    } else {
      b.top = topY.get(b.above!)! + heightOf(b.above!);
      b.bottom = b.top + (b.height - 1);
    }
  }
}

/**
 * **⑥ 납품 끝의 절대 행** — 짝 단계가 미뤄 둔 것들을 여기서 푼다. 그리고 **행 채널 진입 행** — 트랙 번호가
 * 행이 된다(`top + t`). 자리가 선 지금에야 된다.
 */
export function settleDeliveryRows(
  pairing: Pick<DeliveryPairing, "deliverySeeds" | "rowChannelNeeds">,
  rowChannels: readonly RowChannel[],
  absPortY: (id: string, anchorY: number) => number,
): void {
  const { deliverySeeds, rowChannelNeeds } = pairing;
  for (const n of rowChannelNeeds) n.portY = absPortY(n.nodeId, n.anchorY);
  for (const seed of deliverySeeds) {
    seed.startY = absPortY(seed.fromId, seed.fromAnchorY);
    seed.endY = absPortY(seed.toId, seed.toAnchorY);
  }

  /** 경로 끝 id(`…:out`/`…:in`) → 행 채널 접근. 여기서 채우고 [materializeChannelGeometry] 가 지시에 싣는다. */
  const rowChannelEntryById = new Map<string, RowChannelEntry>();
  {
    for (const b of rowChannels) {
      if (!b.tracks) continue;
      for (const [id, t] of b.tracks) rowChannelEntryById.set(id, { row: b.top + t });
    }
    // **배정이 끝난 지금** seed 에 실어 준다 — 위 짝짓기 루프는 배정을 아직 모른다.
    // 진입 행이 곧 세로 채널의 출발/도착 행이다(Step 0: 출처를 안 가린다).
    for (const seed of deliverySeeds) {
      const fb = rowChannelEntryById.get(`${seed.key}:out`);
      const tb = rowChannelEntryById.get(`${seed.key}:in`);
      if (fb) { seed.fromRowChannel = fb; seed.startY = fb.row; }
      if (tb) { seed.toRowChannel = tb; seed.endY = tb.row; }
      // **행 채널이 필요한데 못 받았으면 계획을 접는다.** 그 끝의 `startY` 는 여전히 포트 행이고,
      // 포트는 기둥 **밖**에 있어 계단꼴의 가로 진입이 모듈 몸통을 지난다. 그리면 반드시
      // 막히므로 **애초에 안 그린다** — 장부는 폭만 예약하고 라우터가 탐색으로 잇는다.
      const wantsRowChannel = (w: "out" | "in") => rowChannelNeeds.some((n) => n.id === `${seed.key}:${w}`);
      if ((!fb && wantsRowChannel("out")) || (!tb && wantsRowChannel("in"))) seed.eligible = false;
    }
  }
}

/**
 * 통합 장부의 추상 배정(트랙 index)을 절대좌표 지시로 변환한다.
 * - 납품: DeliveryGeometry(트랙 x·갈아타는 행·지하 횡단 좌표) — deliveryRoute 이 탐색 없이 방출.
 * - 반출: ExitAssignment 에 trackX·(뒤집혔으면) exitEdge 를 기록 — ⑥C 가 그대로 재생.
 * - 예약 셀: 모든 확정 반출 경로(환승 elbow + 직진 직선)의 절대 셀 —
 *   폴백 dijkstra 납품 경로의 침범을 막아 "먼저 깐 경로가 자리를 뺏는" 원래 구멍을 봉인한다.
 */
export function materializeChannelGeometry(args: {
  geometryPlans: Map<number, ChannelGeometryPlan>;
  deliverySeeds: {
    depth: number; key: string; eligible: boolean; fluid?: string;
    /** 합류의 멈춤 행을 여기서 유도한다(`mergeTail`) — 계획이 쓴 것과 **같은 행**이라야 한다. */
    startY: number; endY: number;
    fromRowChannel?: RowChannelEntry; toRowChannel?: RowChannelEntry;
  }[];
  exitPlan: PerimeterExitPlan;
  placements: ModulePlacement[];
  channelStartX: (d: number) => number;
  rawBbox: { x: number; y: number; w: number; h: number };
  reserveTracks: boolean;
}): PackChannelGeometry {
  const { geometryPlans, deliverySeeds, exitPlan, placements, channelStartX, rawBbox, reserveTracks } = args;
  const deliveries = new Map<string, DeliveryDirective>();
  const skips: { key: string; reason: string }[] = [];
  for (const seed of deliverySeeds) {
    // 행 채널 접근은 도형과 무관하게 붙는다 — 세로 채널은 진입 행만 받고 출처를 안 묻는다.
    const rcEntries = { fromRowChannel: seed.fromRowChannel, toRowChannel: seed.toRowChannel };
    if (!seed.eligible) {
      // **계단꼴이 못 그리는 기하 → 되꺾기로 계획한다**(2026-08-17). 대개 부모 입력이 반대
      // 면으로 스필한 경우다. 여태 여기서 조용히 빠져 dijkstra 가 맡았고, 그 폴백이 남의
      // 예약을 밟아 연쇄했다. 모양은 **ㄱ자** — 자기 행을 따라 가로로 간 뒤 목표 열에서
      // 세로로 (근거는 `wrapAround` 자료형 주석: 상자의 자기 열은 늘 붐빈다).
      // 유체는 제외한다(유체는 언제나 적격이라 여기 오면 그게 사고다).
      if (seed.fluid !== undefined) {
        skips.push({ key: seed.key, reason: "not-eligible-fluid" });
        if (AUTO_LAYOUT_COORD_DUMP)
          console.log("[channelGeometry] 장부에서 제외 —", seed.key, "not-eligible(유체인데 전제 위반 — 사고)");
        continue;
      }
      deliveries.set(seed.key, { kind: "wrapAround", ...rcEntries });
      continue;
    }
    const plan = geometryPlans.get(seed.depth)?.deliveries.get(seed.key);
    if (!plan || plan.kind === "fallback") {
      // **장부가 왜 포기했는지는 여기서만 알 수 있다** — 아래로 안 내려보내면 소비처는
      // "계획이 없다"만 보고 이유를 영영 못 본다(2026-07-22 조사에서 계측을 새로 만들어야
      // 했던 자리). 포기한 납품 경로 하나가 탐색으로 내려가면 남의 계획까지 밟아 **연쇄**하므로
      // ([deliveryRoute] 의 "예약 무시 재시도"), 이 한 줄이 그 연쇄의 출발점을 가리킨다.
      skips.push({ key: seed.key, reason: plan ? plan.reason : "no-plan" });
      if (AUTO_LAYOUT_COORD_DUMP)
        console.log("[channelGeometry] 계획 포기 —", seed.key, plan ? plan.reason : "계획 자체가 없음");
      continue;
    }
    const tx = (t: number) => channelStartX(seed.depth) + 1 + t;
    if (plan.kind === "straight") deliveries.set(seed.key, { kind: "straight", ...rcEntries });
    else if (plan.kind === "staircase")
      deliveries.set(seed.key, { kind: "staircase", trackX: tx(plan.track), ...rcEntries });
    else if (plan.kind === "columnSwitch")
      deliveries.set(seed.key, {
        ...rcEntries,
        kind: "columnSwitch",
        startTrackX: tx(plan.startTrack),
        switchY: plan.switchY,
        endTrackX: tx(plan.endTrack),
      });
    else
      deliveries.set(seed.key, {
        ...rcEntries,
        kind: "undergroundCrossing",
        trackX: tx(plan.track),
        // 행은 이미 abs y. 열만 트랙 index → 절대 x. 벽 마진 열(-1 / capCol)은 점프에
        // 안 나온다(점프는 트랙 밴드 안에서만 생긴다) — tx 가 그 밖으로 새지 않는다.
        jumps: plan.jumps.map((j) => ({
          from: { x: tx(j.fromCol), y: j.fromRow },
          to: { x: tx(j.toCol), y: j.toRow },
        })),
      });
  }

  const reservedExportCells = new Set<string>();
  if (reserveTracks) {
    // 포트 anchor(절대) — 상자 id 로 조회.
    const portByChest = new Map<string, ModulePort>();
    for (const pl of placements)
      for (const p of [...pl.module.inputPorts, ...pl.module.outputPorts]) portByChest.set(p.chest.id, p);
    const M = PERIMETER_MARGIN;
    const seatRow = (edge: "N" | "S") => (edge === "N" ? rawBbox.y - M : rawBbox.y + rawBbox.h - 1 + M);
    const seatCol = (edge: "W" | "E") => (edge === "W" ? rawBbox.x - M : rawBbox.x + rawBbox.w - 1 + M);
    const addSeg = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      for (const c of segment(from, to)) reservedExportCells.add(`${c.x},${c.y}`);
    };
    for (const a of exitPlan.assignments) {
      const port = portByChest.get(a.id);
      if (!port) continue;
      const anchor = { x: port.anchor.x, y: port.anchor.y };
      if (a.exitMode.kind === "channel") {
        const plan = geometryPlans.get(a.exitMode.depth)?.exports.get(a.id);
        if (plan?.kind !== "elbow") continue; // fallback — 예약 없음(스캔·skip 유지)
        const trackX = channelStartX(a.exitMode.depth) + 1 + plan.track;
        a.exitEdge = plan.exitEdge; // 해소 사다리 ①에서 뒤집혔을 수 있다
        a.trackX = trackX;
        exitPlan.marginNeeds[plan.exitEdge] = true;
        const corner = { x: trackX, y: anchor.y };
        addSeg(anchor, corner);
        addSeg(corner, { x: trackX, y: seatRow(plan.exitEdge) });
      } else if (a.exitEdge === "N" || a.exitEdge === "S") {
        addSeg(anchor, { x: anchor.x, y: seatRow(a.exitEdge) });
      } else {
        addSeg(anchor, { x: seatCol(a.exitEdge), y: anchor.y });
      }
    }
  }

  return { deliveries, reservedExportCells, skips };
}
