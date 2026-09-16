/**
 * **통로 관심사의 도형** — 행 채널의 칸 범위 · 납품 끝의 절대 행 · 통로 배정의 절대좌표 지시, 그리고 그 배정이
 * 딛는 **추상 셀 모델**(경로 모양 · 충돌 · 셀 순서열).
 *
 * 장부(`channel/ledger`)가 트랙 **번호**를 정하면 여기가 그 번호를 **행 · 열**로 옮긴다. 자리가 선 뒤에만 된다.
 *
 * ## 추상 셀 모델 — 번호를 정하기 **전의** 도형
 *
 * 채널 기하 장부(`channelGeometryPlanner`)가 누가 어느 트랙인지 고를 때 묻는 도형이다. 좌표계는 추상 (열, 행) —
 * 열 = 트랙 index(벽 마진은 `-1` / `capCol`), 행 = abs y. 답이 하나이고 자원을 모른다 — 트랙을 **잡는** 일
 * (배정 · 지하 청구 · 폭 예약)은 장부에, 반출의 진출 변을 **고르는** 일은 `channel/policy` 에 있다.
 * 같은 쪽 판정([sameSideOfCut])도 여기다 — 행 · 벽 비교라 답이 하나이고, 그 답을 받아 고르는 것은 사다리 쪽이다.
 *
 * > **내력.** `modulePacking.packModuleTree` 의 `5)`·`6)`·`6b)` 블록과 `materializeChannelGeometry` 였다
 * > (2026-09-14 계획 구조-2축 · 2 Step 3c-3). `materializeChannelGeometry` 는 **통째로** 옮겼다 — 납품과 반출이
 * > 같은 트랙 풀을 다투므로 관심사로 가르려면 그 다툼을 먼저 풀어야 한다(code-folders).
 * > 추상 셀 모델은 `channelGeometryPlanner.ts` 에서 왔다(2026-09-15 Step 5b).
 */

import type { GeneratedModule, ModulePort } from "../../module/types/module";
import { moduleExtent, type Orientation } from "../../module/moduleTransform";
import type {
  ChannelGeometryPlan,
  ChannelWall,
  DeliveryInput,
  ExportInput,
  GeometryContext,
  NsEdge,
} from "./types";
import type { PerimeterExitPlan } from "../perimeter/types";
import { segment, PERIMETER_MARGIN } from "../../shared/grid";
import { AUTO_LAYOUT_COORD_DUMP } from "../../shared/flags";
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

// ─────────────────────────────────────────────────────────────────────────────
// 같은 쪽 판정 — 문서 §4.2
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 납품 경로의 두 끝이 반출 경로가 긋는 절단선의 같은 쪽인가.
 * 안쪽 ① = "진입 벽과 같은 벽" ∧ "진입 행에서 진출 변 방향"(경계 행 포함 = 보수적:
 * 같은 행이면 가로 진입끼리 겹쳐 어차피 지상 공유 불가).
 */
export function sameSideOfCut(d: DeliveryInput, x: ExportInput, exit: NsEdge): boolean {
  const inside = (wall: ChannelWall, y: number): boolean =>
    wall === x.entryWall && (exit === "N" ? y <= x.entryY : y >= x.entryY);
  // 납품의 출발 끝은 E벽, 도착 끝은 W벽에 붙어 있다.
  return inside("E", d.startY) === inside("W", d.endY);
}

// ─────────────────────────────────────────────────────────────────────────────
// 추상 셀 모델 — 경로 = 가로/세로 직선 몇 개
// ─────────────────────────────────────────────────────────────────────────────

interface HSeg {
  row: number;
  c1: number; // ≤ c2 (열 — 트랙 index, 벽 마진은 -1 / capCol)
  c2: number;
}
interface VSeg {
  col: number; // 트랙 index (벽 마진에는 세로 주행 없음)
  r1: number; // ≤ r2
  r2: number;
}
export interface Shape {
  h: HSeg[];
  v: VSeg[];
}

function hseg(row: number, a: number, b: number): HSeg {
  return { row, c1: Math.min(a, b), c2: Math.max(a, b) };
}
export function vseg(col: number, a: number, b: number): VSeg {
  return { col, r1: Math.min(a, b), r2: Math.max(a, b) };
}

/** 두 도형이 셀을 공유하나 — 문서 §9 불변식 (a)의 계획 시점 버전. */
function shapesConflict(a: Shape, b: Shape): boolean {
  for (const ha of a.h)
    for (const hb of b.h)
      if (ha.row === hb.row && ha.c1 <= hb.c2 && hb.c1 <= ha.c2) return true;
  for (const va of a.v)
    for (const vb of b.v)
      if (va.col === vb.col && va.r1 <= vb.r2 && vb.r1 <= va.r2) return true;
  const hv = (h: HSeg, v: VSeg): boolean =>
    h.c1 <= v.col && v.col <= h.c2 && v.r1 <= h.row && h.row <= v.r2;
  for (const ha of a.h) for (const vb of b.v) if (hv(ha, vb)) return true;
  for (const va of a.v) for (const hb of b.h) if (hv(hb, va)) return true;
  return false;
}

/**
 * 배정 후보 하나 — 도형 + **무엇이 흐르는가**.
 *
 * 품목을 들고 다니는 이유는 충돌 규칙이 품목에 따라 다르기 때문이다([conflicts]).
 * 벨트끼리는 겹치지만 않으면 되지만, 파이프는 **닿기만 하면 이어진다**.
 */
export interface Placed {
  shape: Shape;
  /** 유체 이름. undefined = 아이템(벨트) 또는 폭 예약용 phantom. */
  fluid?: string;
  /** 인접 판정용 halo(칸 + 4-이웃). 유체일 때만 채운다 — 아이템엔 쓸 일이 없다. */
  halo?: Set<string>;
}

/** 도형의 칸들. */
export function cellsOf(s: Shape): string[] {
  const out: string[] = [];
  for (const h of s.h) for (let c = h.c1; c <= h.c2; c++) out.push(`${c},${h.row}`);
  for (const v of s.v) for (let r = v.r1; r <= v.r2; r++) out.push(`${v.col},${r}`);
  return out;
}

/** 도형의 칸 + 4-이웃. 다른 유체가 여기 들어오면 두 유체가 한 통이 된다. */
function haloOf(s: Shape): Set<string> {
  const halo = new Set<string>();
  for (const h of s.h)
    for (let c = h.c1; c <= h.c2; c++) {
      halo.add(`${c},${h.row}`);
      halo.add(`${c - 1},${h.row}`); halo.add(`${c + 1},${h.row}`);
      halo.add(`${c},${h.row - 1}`); halo.add(`${c},${h.row + 1}`);
    }
  for (const v of s.v)
    for (let r = v.r1; r <= v.r2; r++) {
      halo.add(`${v.col},${r}`);
      halo.add(`${v.col - 1},${r}`); halo.add(`${v.col + 1},${r}`);
      halo.add(`${v.col},${r - 1}`); halo.add(`${v.col},${r + 1}`);
    }
  return halo;
}

/** 유체면 halo 를 붙여서 후보를 만든다(한 번만 계산해 재사용). */
export function placedOf(shape: Shape, fluid?: string): Placed {
  return fluid === undefined ? { shape } : { shape, fluid, halo: haloOf(shape) };
}

/**
 * 두 후보가 같이 있을 수 없나 — **품목이 규칙을 바꾼다**.
 *
 * | 두 경로 | 충돌 조건 |
 * |---|---|
 * | 아이템 ↔ 아이템 | 겹침 |
 * | 아이템 ↔ 유체 | 겹침 (파이프 옆 벨트는 무해) |
 * | 유체 A ↔ 유체 A | 겹침 (같은 유체는 닿아도 합법 — 자연 병합) |
 * | 유체 A ↔ 유체 B | 겹침 **또는 인접** ← 닿으면 두 유체가 한 통이 된다 |
 *
 * 인접 검사는 서로 다른 유체 쌍에서만 돈다. v1 은 모듈당 유체 1줄이라 그런 쌍이 드물어
 * 백트래킹 안에서 불려도 비용이 실질적으로 안 는다(halo 는 후보당 1회 계산).
 */
export function conflicts(a: Placed, b: Placed): boolean {
  if (shapesConflict(a.shape, b.shape)) return true;
  const differentFluids =
    a.fluid !== undefined && b.fluid !== undefined && a.fluid !== b.fluid;
  if (!differentFluids) return false;
  for (const k of cellsOf(b.shape)) if (a.halo!.has(k)) return true;
  return false;
}

export function conflictsAny(s: Placed, placed: ReadonlyArray<Placed>): boolean {
  return placed.some((p) => conflicts(s, p));
}

/**
 * **채널을 지나는 경로의 끝점** — 납품과 반출이 여기서 하나가 된다.
 *
 * ```
 * wall   채널 벽의 **한 점**(상자가 마주 본 행). 행이 고정이고, 그 행에 **가로 조각**이 붙는다
 * edge   바깥 **N/S 변**. 행이 자유롭고(변의 행), 세로 주행이 **그대로 나가므로** 가로 조각이 없다
 * ```
 *
 * **이 둘의 차이가 곧 납품과 반출의 차이 전부다.** 납품은 양 끝이 `wall`(상자 둘),
 * 반출은 한쪽이 `edge`(면이지 점이 아니다). 그리고 `edge` 쪽의 **행이 자유롭다**는 것이
 * 해소 사다리 ①(진출 변 뒤집기)이 반출에만 있는 이유다 — 납품엔 뒤집을 자유가 없다.
 */
export type ChannelEndpoint =
  | { kind: "wall"; row: number; wall: ChannelWall }
  | { kind: "edge"; edge: NsEdge };

/** 그 끝점이 붙는 **가상 벽 열** — W벽은 `-1`, E벽은 `capCol`. */
const wallColOf = (wall: ChannelWall, capCol: number): number => (wall === "E" ? capCol : -1);

/** 그 끝점의 **행** — `edge` 는 그 변 바깥 한 칸(seat 행). */
const rowOf = (e: ChannelEndpoint, ctx: GeometryContext): number =>
  e.kind === "wall" ? e.row : e.edge === "N" ? ctx.yMin - 1 : ctx.yMax + 1;

/**
 * **경로 하나의 도형** — 가로 진입 + 세로 주행 + 가로 진출.
 *
 * 옛 `staircaseShape`(납품)와 `elbowShape`(반출)를 합친 것이다. **elbow 는 계단꼴에서
 * 마지막 가로 조각을 뗀 것**이었고, 그 차이는 *"도착 끝점이 벽이냐 변이냐"* 하나에서 나온다.
 * `edge` 끝점은 세로 주행이 채널을 그대로 빠져나가므로 붙일 가로 조각이 없다.
 *
 * **양 끝이 벽이고 행이 같으면** 세로 주행이 길이 0이라 **트랙을 안 먹는다** —
 * 가로 조각 하나로 접는다(옛 `straightShape`). 세로 조각을 남기면 `trackCount` 가 그
 * 열을 세어 **안 쓰는 폭이 는다.**
 */
export function routeShape(
  from: ChannelEndpoint,
  to: ChannelEndpoint,
  track: number,
  ctx: GeometryContext,
  capCol: number,
): Shape {
  const r1 = rowOf(from, ctx);
  const r2 = rowOf(to, ctx);
  if (from.kind === "wall" && to.kind === "wall" && r1 === r2) {
    return { h: [hseg(r1, wallColOf(from.wall, capCol), wallColOf(to.wall, capCol))], v: [] };
  }
  const h: HSeg[] = [];
  if (from.kind === "wall") h.push(hseg(r1, track, wallColOf(from.wall, capCol)));
  if (to.kind === "wall") h.push(hseg(r2, track, wallColOf(to.wall, capCol)));
  return { h, v: [vseg(track, r1, r2)] };
}

/** 납품의 두 끝점 — 자식 출력은 **E벽**, 부모 입력은 **W벽**을 마주 본다. */
const deliveryEnds = (d: DeliveryInput): [ChannelEndpoint, ChannelEndpoint] => [
  { kind: "wall", row: d.startY, wall: "E" },
  { kind: "wall", row: d.endY, wall: "W" },
];

/** 반출의 두 끝점 — 상자가 마주 본 벽에서 들어와 **바깥 변**으로 나간다. */
const exportEnds = (x: ExportInput, exit: NsEdge): [ChannelEndpoint, ChannelEndpoint] => [
  { kind: "wall", row: x.entryY, wall: x.entryWall },
  { kind: "edge", edge: exit },
];

/** 납품 계단꼴(일자 수평선 포함) — [routeShape] 의 납품판. */
export function staircaseShape(d: DeliveryInput, track: number, ctx: GeometryContext, capCol: number): Shape {
  return routeShape(...deliveryEnds(d), track, ctx, capCol);
}

/** 납품 열 갈아타기: 계단꼴 + 중간 한 번 트랙 변경(문서 §5-2). */
export function columnSwitchShape(
  d: DeliveryInput,
  t1: number,
  switchY: number,
  t2: number,
  capCol: number,
): Shape {
  return {
    h: [hseg(d.startY, t1, capCol), hseg(switchY, t1, t2), hseg(d.endY, -1, t2)],
    v: [vseg(t1, d.startY, switchY), vseg(t2, switchY, d.endY)],
  };
}

/** 반출 한꺾임꼴 — [routeShape] 의 반출판. 도착이 `edge` 라 가로 진출 조각이 없다. */
export function elbowShape(x: ExportInput, track: number, exit: NsEdge, ctx: GeometryContext, capCol: number): Shape {
  return routeShape(...exportEnds(x, exit), track, ctx, capCol);
}

// ─────────────────────────────────────────────────────────────────────────────
// 지하 횡단 — 막힌 셀 밑을 건너 계단꼴을 성립시킨다 (문서 §4.4 사다리 ②)
// ─────────────────────────────────────────────────────────────────────────────

export interface Cell {
  col: number;
  row: number;
}

/** 계단꼴을 **셀 순서열**로 편다: E벽 → 트랙(가로) → 세로 주행 → W벽(가로). 코너 중복 없음. */
export function staircaseCells(d: DeliveryInput, track: number, capCol: number): Cell[] {
  const cells: Cell[] = [];
  const push = (col: number, row: number) => {
    const last = cells[cells.length - 1];
    if (last && last.col === col && last.row === row) return;
    cells.push({ col, row });
  };
  for (let c = capCol; c >= track; c--) push(c, d.startY); // 가로 진입(동→서)
  const step = d.endY >= d.startY ? 1 : -1;
  for (let r = d.startY; r !== d.endY + step; r += step) push(track, r); // 세로 주행
  for (let c = track; c >= -1; c--) push(c, d.endY); // 가로 진출(→W벽)
  return cells;
}

/** 지상에 남는 셀들(점프 구간 제외)을 축정렬 조각으로 되접어 Shape 으로. */
export function shapeFromCells(cells: ReadonlyArray<Cell>, underground: ReadonlyArray<boolean>): Shape {
  const s: Shape = { h: [], v: [] };
  let run: Cell[] = [];
  const flush = () => {
    let i = 0;
    while (i < run.length) {
      let j = i;
      while (j + 1 < run.length && run[j + 1].row === run[i].row) j++;
      if (j > i) {
        s.h.push(hseg(run[i].row, run[i].col, run[j].col));
        i = j;
        continue;
      }
      let k = i;
      while (k + 1 < run.length && run[k + 1].col === run[i].col) k++;
      if (k > i) {
        s.v.push(vseg(run[i].col, run[i].row, run[k].row));
        i = k;
        continue;
      }
      s.h.push(hseg(run[i].row, run[i].col, run[i].col)); // 외톨이 셀
      i++;
    }
    run = [];
  };
  for (let i = 0; i < cells.length; i++) {
    if (underground[i]) flush();
    else run.push(cells[i]);
  }
  flush();
  return s;
}
