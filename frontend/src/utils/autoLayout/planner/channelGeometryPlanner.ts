/**
 * channelGeometryPlanner — 채널 예약을 "폭(트랙 수)"에서 "기하(누가 어느 트랙)"로
 * 승격하는 **통합 장부** (같은 쪽 판정).
 *
 * 단일 출처: docs/auto-layout-wizard.channel-geometry-reservation.md
 *
 * 한 채널을 지나는 두 종류 경로를 **한 장부에서** 같이 배정한다:
 *  - **납품 경로(deliveryRoute**, 현 코드 hop): 자식 출력(E벽) → 부모 입력(W벽).
 *    양 끝 행은 포트가 정했고 자유는 세로 주행 트랙 하나 → 모양은 **계단꼴(staircase)**.
 *    출발 행 = 도착 행이면 일자 수평선(트랙 소비 0).
 *  - **반출 경로(exportRoute**, 현 코드 lane): 갇힌 외부상자(벽의 한 점) → 열린 N/S 변.
 *    모양은 **한꺾임꼴(elbow)** — 채널에 **절단선(cut)** 을 긋는다.
 *
 * 핵심 판정 [sameSideOfCut]: 납품 경로의 두 끝이 절단선의 **같은 쪽**이면 지상 계단꼴이
 * 존재하고, **다른 쪽**이면 지상 경로가 기하적으로 존재하지 않는다 — 행·트랙 숫자
 * 비교만으로, 벨트를 깔기 전에 끝난다. 다른 쪽이면 **해소 사다리**(문서 §4.4):
 *   ① 반출 경로 재배정(진출 변 N↔S 뒤집기 — 다른 납품을 새로 가두지 않을 때만)
 *   ② 지하 횡단(undergroundCrossing — 절단선 밑을 지하벨트로, 탐색 아닌 좌표 배정)
 *   ③ fallback 마킹 — 호출자가 그 경로만 기존 dijkstra 로 (감지·로그, 조용한 회귀 아님).
 *
 * 납품끼리(문서 §5): 분리=트랙 공유(백트래킹이 자연 해결), 부분 겹침=**열 갈아타기
 * (columnSwitch)**, 완전 교차=사다리로.
 *
 * **폭 역전(문서 §6)**: 트랙·행 배정을 먼저 끝내고 `trackCount` 는 그 결과에서 나온다.
 * 채널 폭 = `channelWidthFromTracks(trackCount, …)` 는 호출자(modulePacking) 책임.
 *
 * 좌표계: 추상 (열, 행). 열 = 트랙 0..T-1(서→동) + 가상 벽 마진(W쪽 -1, E쪽 trackCap).
 * 절대 x 변환(트랙 → 채널 내부 x)은 호출자 책임. 순수·결정적.
 */

import type { Interval } from "./channelPlanner";

export type ChannelWall = "W" | "E";
export type NsEdge = "N" | "S";

/** 납품 경로 입력 — 자식 출력(E벽) 행 → 부모 입력(W벽) 행. */
export interface DeliveryInput {
  /** 홉 키 — 결과 맵의 키로 그대로 돌아온다. */
  id: string;
  /** 출발 행 = 자식 출력 포트의 abs y (E벽 접점). */
  startY: number;
  /** 도착 행 = 부모 입력 포트의 abs y (W벽 접점). */
  endY: number;
}

/** 반출 경로 입력 — 벽의 한 점에서 열린 N/S 변으로. */
export interface ExportInput {
  /** 상자 id — 결과 맵의 키. */
  id: string;
  /** 상자 접점 행 (포트 anchor 의 abs y). */
  entryY: number;
  /** 어느 벽에서 채널로 들어오나 (W벽 = 부모 열 쪽, E벽 = 자식 열 쪽). */
  entryWall: ChannelWall;
  /** 선호 진출 변(가까운 N/S) — 해소 사다리 ①이 뒤집을 수 있다. */
  preferredExit: NsEdge;
}

export interface GeometryContext {
  /** 전역 모듈 밴드(abs y) — 반출 세로 주행이 이 밖(±1 = perimeter seat 행)까지 달린다. */
  yMin: number;
  yMax: number;
  /** 폭만 예약할 잔여 세로 구간(부적격 홉·미지원 반출 등) — trackCount 에만 반영. */
  reserveIntervals?: Interval[];
  /** 트랙 수 상한. 기본 8. */
  trackCap?: number;
}

export type DeliveryPlan =
  | { kind: "straight" } // 출발 행 = 도착 행 — 일자 수평선, 트랙 소비 0
  | { kind: "staircase"; track: number }
  | { kind: "columnSwitch"; startTrack: number; switchY: number; endTrack: number }
  | {
      /**
       * 절단선 밑 지하 횡단 — 계단꼴이되 절단선과 만나는 셀 하나를 지하벨트로 건넌다.
       * axis="col": 반출의 세로 주행(crossCol 열)을 crossRow 행에서 가로로 점프.
       * axis="row": 반출의 가로 진입(crossRow 행)을 자기 트랙 위에서 세로로 점프.
       */
      kind: "undergroundCrossing";
      track: number;
      axis: "col" | "row";
      crossCol: number;
      crossRow: number;
    }
  | { kind: "fallback"; reason: string };

export type ExportPlan =
  | { kind: "elbow"; track: number; exitEdge: NsEdge }
  | { kind: "fallback"; reason: string };

export interface ChannelGeometryPlan {
  deliveries: Map<string, DeliveryPlan>;
  exports: Map<string, ExportPlan>;
  /** 사용한 트랙 수(fallback 경로의 폭 예약 포함) — 채널 폭의 근거. */
  trackCount: number;
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
interface Shape {
  h: HSeg[];
  v: VSeg[];
}

const DEFAULT_TRACK_CAP = 8;
/** 백트래킹 탐색 노드 예산 — 소진 시 탐욕 단계로 넘어간다(결정적). */
const SEARCH_BUDGET = 20000;

function hseg(row: number, a: number, b: number): HSeg {
  return { row, c1: Math.min(a, b), c2: Math.max(a, b) };
}
function vseg(col: number, a: number, b: number): VSeg {
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

function conflictsAny(s: Shape, placed: ReadonlyArray<Shape>): boolean {
  return placed.some((p) => shapesConflict(s, p));
}

/** 납품 계단꼴: 가로 진입(E벽→트랙) + 세로 주행 + 가로 진출(트랙→W벽). */
function staircaseShape(d: DeliveryInput, track: number, capCol: number): Shape {
  return {
    h: [hseg(d.startY, track, capCol), hseg(d.endY, -1, track)],
    v: [vseg(track, d.startY, d.endY)],
  };
}

/** 납품 일자 수평선(출발 행 = 도착 행) — 채널 전 열을 그 행에서 가로지른다. */
function straightShape(d: DeliveryInput, capCol: number): Shape {
  return { h: [hseg(d.startY, -1, capCol)], v: [] };
}

/** 납품 열 갈아타기: 계단꼴 + 중간 한 번 트랙 변경(문서 §5-2). */
function columnSwitchShape(
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

/** 반출 한꺾임꼴: 가로 진입(벽→트랙) + 열린 변 밖(seat 행)까지 세로 주행. */
function elbowShape(x: ExportInput, track: number, exit: NsEdge, ctx: GeometryContext, capCol: number): Shape {
  const wallCol = x.entryWall === "E" ? capCol : -1;
  const edgeRow = exit === "N" ? ctx.yMin - 1 : ctx.yMax + 1;
  return {
    h: [hseg(x.entryY, track, wallCol)],
    v: [vseg(track, x.entryY, edgeRow)],
  };
}

/**
 * 지하 횡단: 계단꼴이되 절단선과 만나는 셀 하나를 건너뛴다(그 셀은 반출 경로 소유).
 * axis="col" — 가로선이 crossCol 열을 건너뜀(반출 세로 주행 밑). 실제 점프가 성립하려면
 * 그 가로선이 crossCol 을 실제로 지나야 하며, 아니면 분할이 안 일어나 충돌로 기각된다.
 * axis="row" — 세로 주행이 crossRow 행을 건너뜀(반출 가로 진입 밑). 동일 원리.
 */
function undergroundShape(
  d: DeliveryInput,
  track: number,
  axis: "col" | "row",
  crossCol: number,
  crossRow: number,
  capCol: number,
): Shape {
  const s: Shape = { h: [], v: [] };
  const pushH = (row: number, a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (axis === "col" && row === crossRow && lo < crossCol && crossCol < hi) {
      s.h.push(hseg(row, lo, crossCol - 1), hseg(row, crossCol + 1, hi));
    } else {
      s.h.push(hseg(row, lo, hi));
    }
  };
  const pushV = (col: number, a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (axis === "row" && col === track && lo < crossRow && crossRow < hi) {
      s.v.push(vseg(col, lo, crossRow - 1), vseg(col, crossRow + 1, hi));
    } else {
      s.v.push(vseg(col, lo, hi));
    }
  };
  pushH(d.startY, track, capCol);
  pushV(track, d.startY, d.endY);
  pushH(d.endY, -1, track);
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

export function planChannelGeometry(
  deliveriesIn: ReadonlyArray<DeliveryInput>,
  exportsIn: ReadonlyArray<ExportInput>,
  ctx: GeometryContext,
): ChannelGeometryPlan {
  const cap = ctx.trackCap ?? DEFAULT_TRACK_CAP;
  const capCol = cap; // E벽 마진의 추상 열 번호(트랙 index 는 항상 < cap)
  const deliveries = [...deliveriesIn].sort((a, b) => a.id.localeCompare(b.id));
  const exports_ = [...exportsIn].sort((a, b) => a.id.localeCompare(b.id));

  const deliveryPlans = new Map<string, DeliveryPlan>();
  const exportPlans = new Map<string, ExportPlan>();

  // ── ① 같은 쪽 판정 + 반출 재배정(사다리 1단) ──
  // 각 반출의 진출 변을 선호값으로 시작해, 어떤 납품을 가두면 뒤집어 본다.
  // 뒤집기는 "모든 납품이 새 변에서 같은 쪽"일 때만 — 다른 납품을 새로 가두지 않는다.
  const exitOf = new Map<string, NsEdge>(exports_.map((x) => [x.id, x.preferredExit]));
  /** 지상 불가로 판명난 납품 → 그 납품을 가둔 반출 id (지하 횡단 후보). */
  const cutOff = new Map<string, string>();
  for (const d of deliveries) {
    for (const x of exports_) {
      if (sameSideOfCut(d, x, exitOf.get(x.id)!)) continue;
      const flipped: NsEdge = exitOf.get(x.id) === "N" ? "S" : "N";
      const flipOk =
        sameSideOfCut(d, x, flipped) &&
        deliveries.every((d2) => cutOff.has(d2.id) || sameSideOfCut(d2, x, flipped));
      if (flipOk) {
        exitOf.set(x.id, flipped);
      } else {
        cutOff.set(d.id, x.id); // ②(지하 횡단) 후보 — 지상 배정에서 제외
      }
    }
  }

  // ── ② 지상 배정 — iterative-deepening 백트래킹(폭 최소 우선, 결정적) ──
  // 경로 순서: 반출(id 순) → 지상 가능한 납품(id 순). 트랙 후보는 0..T-1 오름차순.
  type Item = { id: string; candidates: (t: number) => Shape | null; max: number };
  const items: Item[] = [];
  for (const x of exports_) {
    const exit = exitOf.get(x.id)!;
    items.push({ id: x.id, candidates: (t) => elbowShape(x, t, exit, ctx, capCol), max: cap });
  }
  const surfaceDels = deliveries.filter((d) => !cutOff.has(d.id));
  for (const d of surfaceDels) {
    if (d.startY === d.endY) {
      // 일자 수평선 — 트랙 무관, 후보 1개(t=0 로만 호출되게 max=1).
      items.push({ id: d.id, candidates: () => straightShape(d, capCol), max: 1 });
    } else {
      items.push({ id: d.id, candidates: (t) => staircaseShape(d, t, capCol), max: cap });
    }
  }

  const placedShapes: Shape[] = []; // 확정된 모든 도형(불변식: 서로소)
  const assigned = new Map<string, { shape: Shape; track: number | null }>();
  const budget = { left: SEARCH_BUDGET };
  const search = (idx: number, T: number, acc: { id: string; shape: Shape; track: number }[]): boolean => {
    if (idx === items.length) return true;
    const item = items[idx];
    const tMax = Math.min(item.max, T);
    for (let t = 0; t < tMax; t++) {
      if (budget.left-- <= 0) return false;
      const shape = item.candidates(t);
      if (!shape) continue;
      if (acc.some((a) => shapesConflict(shape, a.shape))) continue;
      acc.push({ id: item.id, shape, track: t });
      if (search(idx + 1, T, acc)) return true;
      acc.pop();
    }
    return false;
  };
  let solved: { id: string; shape: Shape; track: number }[] | null = null;
  for (let T = 1; T <= cap && !solved; T++) {
    const acc: { id: string; shape: Shape; track: number }[] = [];
    if (search(0, T, acc)) solved = acc;
    if (budget.left <= 0) break;
  }

  if (solved) {
    for (const a of solved) {
      assigned.set(a.id, { shape: a.shape, track: a.track });
      placedShapes.push(a.shape);
    }
  } else {
    // 탐욕 폴백(드묾): 반출 → 납품 순 first-fit, 납품은 실패 시 열 갈아타기까지.
    for (const item of items) {
      let done = false;
      for (let t = 0; t < item.max && !done; t++) {
        const shape = item.candidates(t);
        if (shape && !conflictsAny(shape, placedShapes)) {
          assigned.set(item.id, { shape, track: t });
          placedShapes.push(shape);
          done = true;
        }
      }
      if (done) continue;
      const d = surfaceDels.find((dd) => dd.id === item.id);
      if (d && d.startY !== d.endY) {
        const sw = tryColumnSwitch(d, placedShapes, cap, capCol);
        if (sw) {
          deliveryPlans.set(d.id, sw.plan);
          placedShapes.push(sw.shape);
          continue;
        }
      }
      // 배정 실패 — fallback(③) + 폭 예약은 아래 phantom 단계에서.
      if (d) deliveryPlans.set(item.id, { kind: "fallback", reason: "no-surface-assignment" });
      else exportPlans.set(item.id, { kind: "fallback", reason: "no-surface-assignment" });
    }
  }

  // 배정 결과 → 계획 객체.
  for (const x of exports_) {
    if (exportPlans.has(x.id)) continue;
    const a = assigned.get(x.id);
    if (a) exportPlans.set(x.id, { kind: "elbow", track: a.track!, exitEdge: exitOf.get(x.id)! });
    else exportPlans.set(x.id, { kind: "fallback", reason: "no-surface-assignment" });
  }
  for (const d of surfaceDels) {
    if (deliveryPlans.has(d.id)) continue;
    const a = assigned.get(d.id);
    if (!a) {
      deliveryPlans.set(d.id, { kind: "fallback", reason: "no-surface-assignment" });
    } else if (d.startY === d.endY) {
      deliveryPlans.set(d.id, { kind: "straight" });
    } else {
      deliveryPlans.set(d.id, { kind: "staircase", track: a.track! });
    }
  }

  // ── ③ 지하 횡단(사다리 2단) — 가둔 반출의 확정 트랙 밑을 좌표 배정으로 건넌다 ──
  for (const d of deliveries) {
    const xid = cutOff.get(d.id);
    if (!xid) continue;
    const xPlan = exportPlans.get(xid);
    const x = exports_.find((e) => e.id === xid)!;
    if (!xPlan || xPlan.kind !== "elbow") {
      // 가둔 반출 자체가 fallback — 절단선이 확정되지 않았으니 납품도 dijkstra 로.
      deliveryPlans.set(d.id, { kind: "fallback", reason: "cut-different-side" });
      continue;
    }
    const inside = (wall: ChannelWall, y: number): boolean =>
      wall === x.entryWall && (xPlan.exitEdge === "N" ? y <= x.entryY : y >= x.entryY);
    // 갇힌 끝(안쪽 ①)의 가로선 행 — axis="col" 변형이 이 행에서 반출 세로 주행을 건넌다.
    const trappedRow = inside("E", d.startY) ? d.startY : d.endY;
    let planted = false;
    for (let t = 0; t < cap && !planted; t++) {
      // (a) 반출의 세로 주행(트랙 열)을 가로 점프 / (b) 반출의 가로 진입(접점 행)을 세로 점프.
      // 어느 변형이 성립하는지는 트랙이 절단선의 어느 쪽이냐가 정한다 — 분할이 실제로
      // 일어나지 않은 모양은 절단선 셀을 포함해 충돌 검사에서 저절로 기각된다.
      const variants: { axis: "col" | "row"; crossCol: number; crossRow: number }[] = [
        { axis: "col", crossCol: xPlan.track, crossRow: trappedRow },
        { axis: "row", crossCol: t, crossRow: x.entryY },
      ];
      for (const vr of variants) {
        if (vr.axis === "col" && t === vr.crossCol) continue;
        const shape = undergroundShape(d, t, vr.axis, vr.crossCol, vr.crossRow, capCol);
        if (!conflictsAny(shape, placedShapes)) {
          deliveryPlans.set(d.id, { kind: "undergroundCrossing", track: t, axis: vr.axis, crossCol: vr.crossCol, crossRow: vr.crossRow });
          placedShapes.push(shape);
          planted = true;
          break;
        }
      }
    }
    if (!planted) deliveryPlans.set(d.id, { kind: "fallback", reason: "cut-different-side" });
  }

  // ── ④ 폭 예약(phantom) — fallback 경로·잔여 구간도 세로 구간만큼 트랙을 확보해,
  //      dijkstra/스캔이 들어갈 자리가 폭에서 사라지지 않게 한다(모듈 폴백 방지).
  //      폭은 세로 용량 문제라 세로선끼리만 비교한다 — 가로선과의 교차는 dijkstra 가
  //      지하벨트 등으로 풀 몫이고, 여기서 막으면 자리만 사라진다.
  const phantom = (lo: number, hi: number) => {
    for (let t = 0; t < cap; t++) {
      const clash = placedShapes.some((p) => p.v.some((v) => v.col === t && v.r1 <= hi && lo <= v.r2));
      if (!clash) {
        placedShapes.push({ h: [], v: [vseg(t, lo, hi)] });
        return;
      }
    }
  };
  for (const d of deliveries) {
    const p = deliveryPlans.get(d.id);
    if (p?.kind === "fallback") phantom(Math.min(d.startY, d.endY), Math.max(d.startY, d.endY));
  }
  for (const x of exports_) {
    const p = exportPlans.get(x.id);
    if (p?.kind === "fallback") {
      const edgeRow = x.preferredExit === "N" ? ctx.yMin - 1 : ctx.yMax + 1;
      phantom(Math.min(x.entryY, edgeRow), Math.max(x.entryY, edgeRow));
    }
  }
  for (const iv of ctx.reserveIntervals ?? []) phantom(iv.lo, iv.hi);

  // 폭 역전 — 폭의 근거는 배정 결과(사용한 최고 트랙 번호).
  let trackCount = 0;
  for (const s of placedShapes) for (const v of s.v) trackCount = Math.max(trackCount, v.col + 1);

  return { deliveries: deliveryPlans, exports: exportPlans, trackCount };
}

/** 열 갈아타기 소탐색 — 트랙 쌍 × 갈아타는 행(구간 내부) 오름차순 첫 성공. */
function tryColumnSwitch(
  d: DeliveryInput,
  placed: ReadonlyArray<Shape>,
  cap: number,
  capCol: number,
): { plan: DeliveryPlan; shape: Shape } | null {
  const lo = Math.min(d.startY, d.endY);
  const hi = Math.max(d.startY, d.endY);
  for (let t1 = 0; t1 < cap; t1++) {
    for (let t2 = 0; t2 < cap; t2++) {
      if (t1 === t2) continue;
      for (let sy = lo + 1; sy <= hi - 1; sy++) {
        const shape = columnSwitchShape(d, t1, sy, t2, capCol);
        if (!conflictsAny(shape, placed)) {
          return { plan: { kind: "columnSwitch", startTrack: t1, switchY: sy, endTrack: t2 }, shape };
        }
      }
    }
  }
  return null;
}
