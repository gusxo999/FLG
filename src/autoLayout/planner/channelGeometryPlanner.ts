/**
 * channelGeometryPlanner — 채널 예약을 "폭(트랙 수)"에서 "기하(누가 어느 트랙)"로
 * 승격하는 **통합 장부** (같은 쪽 판정).
 *
 * 단일 출처: docs/auto-layout-wizard.channel-geometry-reservation.md
 *
 * 한 채널을 지나는 두 종류 경로를 **한 장부에서** 같이 배정한다:
 *  - **납품 경로(deliveryRoute**, 현 코드 delivery): 자식 출력(E벽) → 부모 입력(W벽).
 *    양 끝 행은 포트가 정했고 자유는 세로 주행 트랙 하나 → 모양은 **계단꼴(staircase)**.
 *    출발 행 = 도착 행이면 일자 수평선(트랙 소비 0).
 *  - **반출 경로(exportRoute**, 현 코드 track): 갇힌 외부상자(벽의 한 점) → 열린 N/S 변.
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
 * **이 모델이 못 그리는 것**은 `docs/auto-layout/common/layout-models.md` §2③ 에 있다 —
 * 특히 *"포트가 채널 벽을 마주 본다"* 는 전제(코드에서의 이름은 `modulePacking.eligible`).
 * 그 전제가 깨지면 계단꼴이 모듈 몸통을 관통하는 경로를 그린다(2026-08-18 실측 `planned = 0`).
 *
 * 좌표계: 추상 (열, 행). 열 = 트랙 0..T-1(서→동) + 가상 벽 마진(W쪽 -1, E쪽 trackCap).
 * 절대 x 변환(트랙 → 채널 내부 x)은 호출자 책임. 순수·결정적.
 *
 * ## 사슬 — 한 칸 갈 때마다 모르던 것이 하나 정해진다
 *
 * ```
 * ⓪ 판       트랙 상한 · 벽 열 · id 순 · 유체와 아이템                   openChannelSheet
 * ① 진출 변   반출마다 N/S · 갇힌 납품 · 물러난 반출(사다리 1단)          channel/policy.settleExitSides
 * ② 지상     후보(실패 비용 순) → 누가 어느 트랙 → 계획 객체              channel/policy.surfaceItemsOf · assignSurface · writeSurfacePlans
 * ③ 지하     막힌 셀 밑으로(사다리 2단) → 유체 폴백의 사유                crossUnderground · channel/policy.nameFluidFallbacks
 * ④ 폭       폴백 경로 · 잔여 구간의 유령 세로선 → trackCount(폭 역전)     reserveWidth · trackCountOf
 * ```
 *
 * 앞 칸은 뒤 칸의 산출을 안 읽는다 — ① 은 점유를, ② 는 지하 계획을 모른다. 경로의 모양 · 충돌 · 셀 순서열은
 * `channel/shape`(도형), 진출 변과 순서를 고르는 일은 `channel/policy`(정책)에 있다. **이 파일에 남는 것은 트랙을 잡는
 * 장부**(배정 · 지하 청구 · 폭 예약)와 순서를 쥐는 뼈대다. 장부 단계를 통로 장부 파일(`channel/ledger`)로 안 옮긴 이유는
 * 그 파일의 `planChannels` 가 이 함수를 부르기 때문이다 — 옮기면 두 파일이 서로를 런타임으로 부른다.
 */

import type {
  ChannelGeometryPlan,
  DeliveryInput,
  DeliveryPlan,
  ExportInput,
  ExportPlan,
  GeometryContext,
  Jump,
} from "./channel/types";
import {
  cellsOf,
  columnSwitchShape,
  conflicts,
  conflictsAny,
  placedOf,
  shapeFromCells,
  staircaseCells,
  vseg,
  type Cell,
  type Placed,
  type Shape,
} from "./channel/shape";
import {
  nameFluidFallbacks,
  settleExitSides,
  surfaceItemsOf,
  type ExitSides,
  type SurfaceItem,
} from "./channel/policy";

/** trackCap 미지정 시의 하한 — 경로가 적어도 이만큼의 트랙은 골라 쓸 수 있게. */
const MIN_TRACK_CAP = 8;
/** 백트래킹 탐색 노드 예산 — 소진 시 탐욕 단계로 넘어간다(결정적). */
const SEARCH_BUDGET = 200000;

// ─────────────────────────────────────────────────────────────────────────────
// 지하 횡단 — 막힌 셀 밑을 건너 계단꼴을 성립시킨다 (문서 §4.4 사다리 ②)
// ─────────────────────────────────────────────────────────────────────────────

/** placedShapes 를 셀 집합으로 편다 — 점프 계산은 셀 단위라야 거리(k)가 정확하다. */
function occupiedCells(placed: ReadonlyArray<Placed>): Set<string> {
  const occ = new Set<string>();
  for (const p of placed) for (const k of cellsOf(p.shape)) occ.add(k);
  return occ;
}

/**
 * 납품 하나를 **막힌 셀 밑을 건너서** 배치한다 — 지상 배정이 실패한 경로의 해법.
 *
 * 트랙을 오름차순으로 훑으며, 그 트랙의 계단꼴을 셀 순서열로 펴고 **막힌 구간마다 점프**를
 * 만든다. 점프가 성립하려면:
 *  - 세로 주행이 통째로 비어 있어야 한다(트랙은 지상 전용 — 몸통이 지하로 숨으면 다른
 *    경로가 그 위를 지나가도 되는지 알 수 없다).
 *  - 막힌 구간의 **양 끝 바깥 셀**(지하 입구·출구)이 비어 있어야 한다.
 *  - 입구·출구가 **같은 축**이어야 한다 — 코너를 물면 지하벨트가 못 꺾어 기각.
 *  - 거리가 지하벨트 한계(maxJump) 안이어야 한다.
 *  - 체인 양 끝(상자 자리)은 점프로 못 덮는다.
 */
function placeWithJumps(
  d: DeliveryInput,
  placed: ReadonlyArray<Placed>,
  cap: number,
  capCol: number,
  maxJump: number,
): { track: number; jumps: Jump[]; shape: Shape } | null {
  if (maxJump < 2) return null; // 지하벨트 없음 — 건널 방법이 없다.
  const occ = occupiedCells(placed);
  const free = (c: Cell) => !occ.has(`${c.col},${c.row}`);

  const lo = Math.min(d.startY, d.endY);
  const hi = Math.max(d.startY, d.endY);

  for (let t = 0; t < cap; t++) {
    // 세로 주행은 **지상 전용**이다 — 다른 세로선이 같은 트랙의 같은 행에 있으면 후보 탈락.
    // (남의 *가로선* 이 내 세로선을 가로지르는 건 괜찮다 — 그건 아래 점프가 건넌다.)
    const trackTaken = placed.some((p) => p.shape.v.some((v) => v.col === t && v.r1 <= hi && lo <= v.r2));
    if (trackTaken) continue;

    const cells = staircaseCells(d, t, capCol);
    const blocked = cells.map((c) => !free(c));
    if (blocked[0] || blocked[cells.length - 1]) continue; // 상자 자리가 막힘

    const jumps: Jump[] = [];
    const underground = new Array(cells.length).fill(false);
    let ok = true;
    for (let i = 0; i < cells.length && ok; ) {
      if (!blocked[i]) { i += 1; continue; }
      // 지하 입구는 **지상 belt** 여야 한다. 셀 순서열의 첫 칸은 E벽 마진(capCol)이고,
      // 그 열이 입구가 되면 절대 x 로 옮길 근거가 없다(capCol 은 가상 열이라 트랙처럼
      // 1:1 로 대응되지 않는다) → 거부. 반대로 **마지막 칸(-1)은 진짜 채널 셀**이다
      // (tx(-1) = 채널 첫 열). 상자는 그보다 한 칸 더 서쪽이라 순서열에 없다 — 그래서
      // 출구가 -1 이어도 상자를 덮지 않는다. 여기를 막으면 "트랙 바로 서쪽이 막힌" 흔한
      // 반출-납품 교차가 통째로 폴백으로 샌다.
      if (i - 1 === 0) { ok = false; break; }

      // 출구 자리 고르기. 지하벨트는 **위에 뭐가 있든 상관없이** 입구에서 출구까지
      // 통째로 지나간다 — 그래서 막힌 칸만 딱 맞춰 건널 이유가 없고, 필요하면 빈 칸
      // 밑으로도 지나간다. 출구는 두 조건을 만족하는 첫 칸이다:
      //   ① 그 칸이 비어 있다(지상 belt 를 놓을 자리).
      //   ② 바로 다음 칸이 막혀 있지 않다.
      // ②가 없으면 이 점프의 **출구와 다음 점프의 입구가 같은 칸**이 된다 — 한 칸에
      // 지하벨트 두 개는 못 놓는다. 그래서 "빈 칸 하나만 두고 또 막힌" 배치는 두 번
      // 나눠 건너지 못하고 **한 번에 길게** 건넌다(그래서 아래 dist 가 자란다).
      let e = i;
      while (e < cells.length && (blocked[e] || (e + 1 < cells.length && blocked[e + 1]))) e += 1;
      if (e >= cells.length) { ok = false; break; } // 끝까지 막힘 — 나갈 자리가 없다

      const from = cells[i - 1];
      const to = cells[e];
      const straight = from.col === to.col || from.row === to.row;
      const dist = Math.abs(to.col - from.col) + Math.abs(to.row - from.row);
      // 코너를 물면 입구·출구가 축이 어긋나거나(straight 실패) 거리가 셀 수와 안 맞는다.
      const spansCorner = dist !== e - i + 1;
      if (!straight || spansCorner || dist > maxJump) { ok = false; break; }
      jumps.push({ fromCol: from.col, fromRow: from.row, toCol: to.col, toRow: to.row });
      for (let m = i; m < e; m++) underground[m] = true;
      i = e;
    }
    if (!ok || jumps.length === 0) continue;

    const shape = shapeFromCells(cells, underground);
    // 지하 횡단은 아이템 전용(§D2)이라 후보에 유체 표시가 없다 — 인접 규칙이 안 걸린다.
    if (conflictsAny(placedOf(shape), placed)) continue; // 방어 — 위 판정이 놓친 겹침
    return { track: t, jumps, shape };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

export function planChannelGeometry(
  deliveriesIn: ReadonlyArray<DeliveryInput>,
  exportsIn: ReadonlyArray<ExportInput>,
  ctx: GeometryContext,
): ChannelGeometryPlan {
  // ⓪ 판 — 트랙 상한 · 벽 열 · id 순 · 유체와 아이템 · 빈 계획. 아직 어느 경로도 트랙이 없다
  const sheet = openChannelSheet(deliveriesIn, exportsIn, ctx);
  // ① 진출 변 — 반출마다 N/S · 갇힌 아이템 납품 · 유체에 물러난 반출. 행 비교만(사다리 1단)
  const sides = settleExitSides(sheet.deliveries, sheet.exports_, sheet.fluidDels, sheet.itemDels, sheet.exportPlans);
  // ② 지상 — 누가 어느 트랙. 실패 비용 순 → 폭 최소 백트래킹 → 막히면 탐욕 + 열 갈아타기
  const items = surfaceItemsOf(sides, sheet.exports_, ctx, sheet.cap, sheet.capCol);
  const assigned = assignSurface(sheet, sides, items);
  writeSurfacePlans(sheet, sides, assigned);
  // ③ 지하 — 지상에 자리가 없는 아이템 납품은 막힌 셀 밑으로(사다리 2단). 유체에게는 남은 수가 없다
  crossUnderground(sheet, sides, ctx.maxJump ?? 0);
  nameFluidFallbacks(sheet.fluidDels, sheet.deliveryPlans);
  // ④ 폭 — 폴백 경로 · 잔여 구간도 세로 구간만큼 트랙을 잡는다. 폭은 이 결과다(폭 역전)
  reserveWidth(sheet, ctx);
  return { deliveries: sheet.deliveryPlans, exports: sheet.exportPlans, trackCount: trackCountOf(sheet.placedShapes) };
}

/**
 * **⓪ 판** — 한 번의 배정이 처음부터 끝까지 함께 쓰는 것. 단계가 새로 아는 것(진출 변 · 누가 어느 트랙)은 여기
 * 안 싣고 단계의 반환으로 넘긴다 — 그래야 뼈대에서 *"누가 무엇을 알고 들어오나"* 가 보인다.
 *
 * 계획 둘과 `placedShapes` 는 단계마다 **쌓인다.** 넣는 순서(계획)와 쌓는 순서(도형)가 뒤 단계의 답을 바꾸는
 * 입력이라, 단계 순서가 곧 결과다.
 */
interface ChannelSheet {
  /** 트랙 수 상한. */
  cap: number;
  /** E벽 마진의 추상 열(`cap + 1`). */
  capCol: number;
  /** id 순. */
  deliveries: DeliveryInput[];
  /** id 순. */
  exports_: ExportInput[];
  fluidDels: DeliveryInput[];
  itemDels: DeliveryInput[];
  deliveryPlans: Map<string, DeliveryPlan>;
  exportPlans: Map<string, ExportPlan>;
  placedShapes: Placed[];
}

/** 경로 하나의 지상 배정 — 확정 도형(유체면 halo 포함)과 트랙. */
type Assignment = { placed: Placed; track: number | null };

/** **⓪ 판 차리기** — 트랙 상한 · 벽 열 · id 순 · 유체와 아이템 · 빈 계획 둘 · 빈 점유. */
function openChannelSheet(
  deliveriesIn: ReadonlyArray<DeliveryInput>,
  exportsIn: ReadonlyArray<ExportInput>,
  ctx: GeometryContext,
): ChannelSheet {
  // 경로마다 자기 트랙을 줘도 충분하다는 것이 상한의 근거(세로선은 트랙이 다르면 절대
   // 안 겹친다). 폭은 여기서 안 정해진다 — 배정 결과(trackCount)에서 나온다(폭 역전).
  const cap = ctx.trackCap ?? Math.max(MIN_TRACK_CAP, deliveriesIn.length + exportsIn.length);
  // E벽 마진의 추상 열. **트랙보다 두 칸 위**에 둔다 — 그래야 "가장 동쪽 트랙"이 막혀도
  // 지하 입구가 그 동쪽의 *실재하는* 채널 셀에 앉는다(capCol 자신은 가상 열이라 안 됨).
  const capCol = cap + 1;
  const deliveries = [...deliveriesIn].sort((a, b) => a.id.localeCompare(b.id));
  const exports_ = [...exportsIn].sort((a, b) => a.id.localeCompare(b.id));

  const deliveryPlans = new Map<string, DeliveryPlan>();
  const exportPlans = new Map<string, ExportPlan>();

  // 실패 비용 순 — 이 순서가 아래 ①·②를 모두 지배한다(docs/…fluid-delivery-reservation.md §4.3).
  //   1. 유체 납품 — 지하로 못 도망간다(§D2). 배정 실패 = **트리 전체 실패**.
  //   2. 반출     — 실패해도 상자가 로컬 ring 에 남는다. 되돌릴 수 있는 손해.
  //   3. 아이템 납품 — 실패하면 ③ 지하 횡단이 회수한다. 사실상 손해 없음.
  // 그래서 유체가 지상을 먼저 갖고, 교차하는 아이템이 **밑으로 지나간다**. 교차 자체는
  // 배정을 잘해서 없앨 수 있는 게 아니다(Jordan — DeliveryPlan.undergroundCrossing 주석).
  const fluidDels = deliveries.filter((d) => d.fluid !== undefined);
  const itemDels = deliveries.filter((d) => d.fluid === undefined);

  const placedShapes: Placed[] = []; // 확정된 모든 도형(불변식: 서로소 + 유체 인접 없음)
  return { cap, capCol, deliveries, exports_, fluidDels, itemDels, deliveryPlans, exportPlans, placedShapes };
}

/**
 * **② 배정** — 누가 어느 트랙. 폭 최소 백트래킹이 풀면 그 해를, 못 풀면(예산 소진 포함) 탐욕 + 열 갈아타기.
 * 탐욕이 못 앉힌 경로와 열 갈아타기는 계획을 여기서 **먼저** 적는다 — [writeSurfacePlans] 가 그 계획을 건너뛴다.
 */
function assignSurface(
  sheet: ChannelSheet,
  sides: ExitSides,
  items: ReadonlyArray<SurfaceItem>,
): Map<string, Assignment> {
  const { cap, capCol, deliveryPlans, exportPlans, placedShapes } = sheet;
  const { surfaceDels } = sides;
  // ── ② 지상 배정 — iterative-deepening 백트래킹(폭 최소 우선, 결정적) ──
  const assigned = new Map<string, { placed: Placed; track: number | null }>();
  const budget = { left: SEARCH_BUDGET };
  type Acc = { id: string; placed: Placed; track: number };
  const search = (idx: number, T: number, acc: Acc[]): boolean => {
    if (idx === items.length) return true;
    const item = items[idx];
    const tMax = Math.min(item.max, T);
    for (let t = 0; t < tMax; t++) {
      if (budget.left-- <= 0) return false;
      const shape = item.candidates(t);
      if (!shape) continue;
      const cand = placedOf(shape, item.fluid);
      if (acc.some((a) => conflicts(cand, a.placed))) continue;
      acc.push({ id: item.id, placed: cand, track: t });
      if (search(idx + 1, T, acc)) return true;
      acc.pop();
    }
    return false;
  };
  let solved: Acc[] | null = null;
  for (let T = 1; T <= cap && !solved; T++) {
    const acc: Acc[] = [];
    if (search(0, T, acc)) solved = acc;
    if (budget.left <= 0) break;
  }

  if (solved) {
    for (const a of solved) {
      assigned.set(a.id, { placed: a.placed, track: a.track });
      placedShapes.push(a.placed);
    }
  } else {
    // 탐욕 폴백(드묾): items 순서대로 first-fit, 납품은 실패 시 열 갈아타기까지.
    // **여기서 유체가 맨 앞이라는 사실이 값을 한다** — 전 배정 탐색이 실패하는 트리
    // (교차가 불가피하면 늘 실패한다)에서 유체가 지상 자리를 먼저 집는다.
    for (const item of items) {
      let done = false;
      for (let t = 0; t < item.max && !done; t++) {
        const shape = item.candidates(t);
        const cand = shape && placedOf(shape, item.fluid);
        if (cand && !conflictsAny(cand, placedShapes)) {
          assigned.set(item.id, { placed: cand, track: t });
          placedShapes.push(cand);
          done = true;
        }
      }
      if (done) continue;
      const d = surfaceDels.find((dd) => dd.id === item.id);
      if (d && d.startY !== d.endY) {
        const sw = tryColumnSwitch(d, placedShapes, cap, capCol);
        if (sw) {
          deliveryPlans.set(d.id, sw.plan);
          placedShapes.push(placedOf(sw.shape, d.fluid));
          continue;
        }
      }
      // 배정 실패 — fallback(③) + 폭 예약은 아래 phantom 단계에서.
      if (d) deliveryPlans.set(item.id, { kind: "fallback", reason: "no-surface-assignment" });
      else exportPlans.set(item.id, { kind: "fallback", reason: "no-surface-assignment" });
    }
  }
  return assigned;
}

/** **②′ 계획** — 배정을 계획 객체로 적는다. 배정을 **읽기만** 한다. */
function writeSurfacePlans(sheet: ChannelSheet, sides: ExitSides, assigned: ReadonlyMap<string, Assignment>): void {
  const { exports_, deliveryPlans, exportPlans } = sheet;
  const { exitOf, surfaceDels } = sides;
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
}

/** **③ 지하** — 막힌 셀 밑으로 건넌 도형을 쌓고(청구), 못 건넌 납품에는 폴백의 사유를 적는다. */
function crossUnderground(sheet: ChannelSheet, sides: ExitSides, maxJump: number): void {
  const { cap, capCol, itemDels, deliveryPlans, placedShapes } = sheet;
  const { cutOff } = sides;
  // ── ③ 지하 횡단(사다리 2단) — 지상에 자리가 없는 납품은 막힌 셀 **밑으로** 건넌다 ──
  //
  // 지상 배정(②)이 못 앉힌 납품은 두 부류다: 반출의 절단선에 갇힌 것(①이 cutOff 로
  // 표시), 그리고 **다른 납품과 교차하는 것**. 1:1 에선 후자가 압도적으로 많다 — 교차는
  // 불가피하기 때문이다(DeliveryPlan.undergroundCrossing 주석의 Jordan 논증). 둘을 구분할
  // 이유가 없다: 어느 쪽이든 "내 길을 막은 셀 밑을 건넌다"는 같은 해법이다.
  //
  // 반출은 여기 안 온다 — [perimeterRouter] 가 지상 belt 로만 깔아 지하로 못 도망간다.
  // **유체 납품도 안 온다**(결정 D2) — 지하파이프는 프로토타입과 무관하게 같은 직선 위에서
  // 서로 페어링이 끊긴다. 겹침·인접과 성질이 다른 세 번째 제약이라 v1 장부가 모델링하지
  // 않는다. 그 대신 유체는 ①②에서 **지상 우선권**을 받았다(§4.3) — 밑으로 갈 일이 없다.
  for (const d of itemDels) {
    const cur = deliveryPlans.get(d.id);
    if (cur && cur.kind !== "fallback") continue;
    const res = placeWithJumps(d, placedShapes, cap, capCol, maxJump);
    if (res) {
      deliveryPlans.set(d.id, { kind: "undergroundCrossing", track: res.track, jumps: res.jumps });
      placedShapes.push(placedOf(res.shape));
    } else {
      deliveryPlans.set(d.id, {
        kind: "fallback",
        reason: cutOff.has(d.id) ? "cut-different-side" : "crossing-needs-underground",
      });
    }
  }
}

/** **④ 폭** — 폴백 경로 · 잔여 구간의 유령 세로선을 쌓는다(청구만 — 계획은 안 바꾼다). */
function reserveWidth(sheet: ChannelSheet, ctx: GeometryContext): void {
  const { cap, deliveries, exports_, deliveryPlans, exportPlans, placedShapes } = sheet;
  // ── ④ 폭 예약(phantom) — fallback 경로·잔여 구간도 세로 구간만큼 트랙을 확보해,
  //      dijkstra/스캔이 들어갈 자리가 폭에서 사라지지 않게 한다(모듈 폴백 방지).
  //      폭은 세로 용량 문제라 세로선끼리만 비교한다 — 가로선과의 교차는 dijkstra 가
  //      지하벨트 등으로 풀 몫이고, 여기서 막으면 자리만 사라진다.
  const phantom = (lo: number, hi: number) => {
    for (let t = 0; t < cap; t++) {
      const clash = placedShapes.some((p) => p.shape.v.some((v) => v.col === t && v.r1 <= hi && lo <= v.r2));
      if (!clash) {
        placedShapes.push(placedOf({ h: [], v: [vseg(t, lo, hi)] }));
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
}

/** **⑤ 폭 역전** — 쌓인 도형이 쓴 최고 트랙 번호 + 1. */
function trackCountOf(placedShapes: ReadonlyArray<Placed>): number {
  // 폭 역전 — 폭의 근거는 배정 결과(사용한 최고 트랙 번호).
  let trackCount = 0;
  for (const p of placedShapes) for (const v of p.shape.v) trackCount = Math.max(trackCount, v.col + 1);
  return trackCount;
}

/** 열 갈아타기 소탐색 — 트랙 쌍 × 갈아타는 행(구간 내부) 오름차순 첫 성공. */
function tryColumnSwitch(
  d: DeliveryInput,
  placed: ReadonlyArray<Placed>,
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
        if (!conflictsAny(placedOf(shape, d.fluid), placed)) {
          return { plan: { kind: "columnSwitch", startTrack: t1, switchY: sy, endTrack: t2 }, shape };
        }
      }
    }
  }
  return null;
}
