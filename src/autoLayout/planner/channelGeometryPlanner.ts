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
  /**
   * 유체 이름. `undefined` = 아이템(벨트).
   *
   * 유체는 두 가지가 다르다(docs/auto-layout-wizard.fluid-hop-reservation.md):
   *  - **인접 금지** — 파이프는 닿기만 하면 이어진다. *다른* 유체와는 겹침뿐 아니라
   *    4-인접도 충돌이다. 같은 유체끼리는 닿아도 합법이라 겹침만 본다.
   *  - **지하로 못 도망간다** — 지하파이프 페어링 절단이 별개 제약이라 v1 에선 유체에
   *    지하 횡단을 안 쓴다. 대신 **지상 우선권**을 준다(배정 순서 맨 앞).
   */
  fluid?: string;
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
  /**
   * 지하벨트 점프 거리 상한(입구↔출구 셀 거리). 0(기본) = 지하 불가 = 지상만.
   *
   * **납품 경로에만 쓴다.** 반출 경로는 [perimeterRouter] 가 지상 belt 로만 깔기 때문에
   * 지하로 도망갈 수 없다 — 그래서 반출이 **제약이 센 쪽**이고, 배정에서 먼저 자리를
   * 잡는다(제약 센 것부터). 납품은 [moduleHop] 이 지하벨트를 방출할 수 있어 막히면
   * 밑으로 건널 수 있다.
   */
  maxJump?: number;
  /** 폭만 예약할 잔여 세로 구간(부적격 홉·미지원 반출 등) — trackCount 에만 반영. */
  reserveIntervals?: Interval[];
  /**
   * 트랙 수 상한. 미지정이면 **경로 수**에서 유도한다(아래 planChannelGeometry).
   *
   * 옛 상한 8은 트렁크 시절의 값이다 — 품목당 포트가 하나뿐이라 한 채널을 지나는 경로가
   * 품목 수(≤ 몇 개)였다. 1:1 에선 포트가 (머신 × 품목) 이라 한 채널에 경로가 수십 개
   * 들어올 수 있고, 상한에 걸린 경로는 전부 fallback → dijkstra 로 떨어져 채널 밖을 돌다
   * 반출 레인을 끊는다. 최악의 경우 경로마다 자기 트랙이 필요하므로 상한 = 경로 수면 족하다.
   */
  trackCap?: number;
}

/**
 * 지하 점프 하나 — `from`(지하 입구)에서 `to`(지하 출구)까지, **그 사이 셀들 밑으로** 간다.
 * 두 셀은 축이 같고(같은 행 또는 같은 열) 둘 다 **지상 belt** 다. 거리 = |Δ| ≥ 2.
 * 좌표계는 계획과 같은 추상 (열, 행) — 열 = 트랙 index, 행 = abs y.
 */
export interface Jump {
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
}

export type DeliveryPlan =
  | { kind: "straight" } // 출발 행 = 도착 행 — 일자 수평선, 트랙 소비 0
  | { kind: "staircase"; track: number }
  | { kind: "columnSwitch"; startTrack: number; switchY: number; endTrack: number }
  | {
      /**
       * 지하 횡단 — 계단꼴이되, 길을 막는 **다른 경로의 셀들** 밑을 지하벨트로 건넌다.
       *
       * 왜 여러 개인가: 1:1 방출에서 납품 경로는 서로 **반드시 교차한다**. 부모 열 서쪽,
       * 자식 둘(위·아래)이 동쪽인 채널을 생각해 보라 — 위 자식에서 아래 부모 머신으로
       * 가는 벨트와, 아래 자식에서 위 부모 머신으로 가는 벨트는 채널 테두리 위에서 끝점이
       * **엇갈려** 있다. 원판 안에서 끝점이 엇갈린 두 곡선은 반드시 만난다(Jordan). 즉
       * 교차는 배정을 잘해서 없앨 수 있는 게 아니라 **기하학적으로 불가피**하고, 지상에서
       * 벨트는 교차할 수 없으니 **지하가 유일한 답**이다. 채널을 지나는 납품이 늘수록
       * 한 경로가 건너야 할 남의 세로선도 늘어난다 → 점프가 여러 개.
       *
       * 세로 주행(track)은 늘 지상이다 — 빈 트랙을 골랐기 때문. 점프는 가로선(진입·진출)
       * 위에서 남의 세로선을 건너거나, 세로선 위에서 남의 가로선을 건널 때 생긴다.
       */
      kind: "undergroundCrossing";
      track: number;
      jumps: Jump[];
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

/** trackCap 미지정 시의 하한 — 경로가 적어도 이만큼의 트랙은 골라 쓸 수 있게. */
const MIN_TRACK_CAP = 8;
/** 백트래킹 탐색 노드 예산 — 소진 시 탐욕 단계로 넘어간다(결정적). */
const SEARCH_BUDGET = 200000;

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

/**
 * 배정 후보 하나 — 도형 + **무엇이 흐르는가**.
 *
 * 품목을 들고 다니는 이유는 충돌 규칙이 품목에 따라 다르기 때문이다([conflicts]).
 * 벨트끼리는 겹치지만 않으면 되지만, 파이프는 **닿기만 하면 이어진다**.
 */
interface Placed {
  shape: Shape;
  /** 유체 이름. undefined = 아이템(벨트) 또는 폭 예약용 phantom. */
  fluid?: string;
  /** 인접 판정용 halo(칸 + 4-이웃). 유체일 때만 채운다 — 아이템엔 쓸 일이 없다. */
  halo?: Set<string>;
}

/** 도형의 칸들. */
function cellsOf(s: Shape): string[] {
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
function placedOf(shape: Shape, fluid?: string): Placed {
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
function conflicts(a: Placed, b: Placed): boolean {
  if (shapesConflict(a.shape, b.shape)) return true;
  const differentFluids =
    a.fluid !== undefined && b.fluid !== undefined && a.fluid !== b.fluid;
  if (!differentFluids) return false;
  for (const k of cellsOf(b.shape)) if (a.halo!.has(k)) return true;
  return false;
}

function conflictsAny(s: Placed, placed: ReadonlyArray<Placed>): boolean {
  return placed.some((p) => conflicts(s, p));
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

// ─────────────────────────────────────────────────────────────────────────────
// 지하 횡단 — 막힌 셀 밑을 건너 계단꼴을 성립시킨다 (문서 §4.4 사다리 ②)
// ─────────────────────────────────────────────────────────────────────────────

interface Cell {
  col: number;
  row: number;
}

/** 계단꼴을 **셀 순서열**로 편다: E벽 → 트랙(가로) → 세로 주행 → W벽(가로). 코너 중복 없음. */
function staircaseCells(d: DeliveryInput, track: number, capCol: number): Cell[] {
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

/** placedShapes 를 셀 집합으로 편다 — 점프 계산은 셀 단위라야 거리(k)가 정확하다. */
function occupiedCells(placed: ReadonlyArray<Placed>): Set<string> {
  const occ = new Set<string>();
  for (const p of placed) for (const k of cellsOf(p.shape)) occ.add(k);
  return occ;
}

/** 지상에 남는 셀들(점프 구간 제외)을 축정렬 조각으로 되접어 Shape 으로. */
function shapeFromCells(cells: ReadonlyArray<Cell>, underground: ReadonlyArray<boolean>): Shape {
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

  // 실패 비용 순 — 이 순서가 아래 ①·②를 모두 지배한다(docs/…fluid-hop-reservation.md §4.3).
  //   1. 유체 납품 — 지하로 못 도망간다(§D2). 배정 실패 = **트리 전체 실패**.
  //   2. 반출     — 실패해도 상자가 로컬 ring 에 남는다. 되돌릴 수 있는 손해.
  //   3. 아이템 납품 — 실패하면 ③ 지하 횡단이 회수한다. 사실상 손해 없음.
  // 그래서 유체가 지상을 먼저 갖고, 교차하는 아이템이 **밑으로 지나간다**. 교차 자체는
  // 배정을 잘해서 없앨 수 있는 게 아니다(Jordan — DeliveryPlan.undergroundCrossing 주석).
  const fluidDels = deliveries.filter((d) => d.fluid !== undefined);
  const itemDels = deliveries.filter((d) => d.fluid === undefined);

  // ── ① 같은 쪽 판정 + 반출 재배정(사다리 1단) ──
  // 각 반출의 진출 변을 선호값으로 시작해, 어떤 납품을 가두면 뒤집어 본다.
  // 뒤집기는 "모든 납품이 새 변에서 같은 쪽"일 때만 — 다른 납품을 새로 가두지 않는다.
  const exitOf = new Map<string, NsEdge>(exports_.map((x) => [x.id, x.preferredExit]));
  /** 지상 불가로 판명난 아이템 납품 → 그 납품을 가둔 반출 id (지하 횡단 후보). */
  const cutOff = new Map<string, string>();
  /** 유체를 가둔 죄로 지상 배정을 포기한 반출 — 상자는 로컬 ring 에 남는다. */
  const yieldedExports = new Set<string>();

  const tryFlip = (d: DeliveryInput, x: ExportInput): boolean => {
    const flipped: NsEdge = exitOf.get(x.id) === "N" ? "S" : "N";
    const ok =
      sameSideOfCut(d, x, flipped) &&
      deliveries.every((d2) => cutOff.has(d2.id) || sameSideOfCut(d2, x, flipped));
    if (ok) exitOf.set(x.id, flipped);
    return ok;
  };

  // 1라운드 — 유체. 뒤집어서 안 풀리면 **반출이 물러난다**(유체가 갇히면 트리째 죽으므로).
  for (const d of fluidDels) {
    for (const x of exports_) {
      if (yieldedExports.has(x.id)) continue;
      if (sameSideOfCut(d, x, exitOf.get(x.id)!)) continue;
      if (!tryFlip(d, x)) yieldedExports.add(x.id);
    }
  }
  // 2라운드 — 아이템. 기존 그대로: 안 풀리면 그 납품이 지하 횡단 후보가 된다.
  for (const d of itemDels) {
    for (const x of exports_) {
      if (yieldedExports.has(x.id)) continue;
      if (sameSideOfCut(d, x, exitOf.get(x.id)!)) continue;
      if (!tryFlip(d, x)) cutOff.set(d.id, x.id);
    }
  }
  for (const id of yieldedExports) exportPlans.set(id, { kind: "fallback", reason: "yielded-to-fluid" });

  // ── ② 지상 배정 — iterative-deepening 백트래킹(폭 최소 우선, 결정적) ──
  // 경로 순서: 반출(id 순) → 지상 가능한 납품(id 순). 트랙 후보는 0..T-1 오름차순.
  type Item = { id: string; candidates: (t: number) => Shape | null; max: number; fluid?: string };
  const delItem = (d: DeliveryInput): Item =>
    d.startY === d.endY
      ? // 일자 수평선 — 트랙 무관, 후보 1개(t=0 로만 호출되게 max=1).
        { id: d.id, candidates: () => straightShape(d, capCol), max: 1, fluid: d.fluid }
      : { id: d.id, candidates: (t) => staircaseShape(d, t, capCol), max: cap, fluid: d.fluid };

  const surfaceDels = deliveries.filter((d) => !cutOff.has(d.id));
  // 순서 = 실패 비용 순(위 주석). 탐욕 폴백에서 앞선 것이 자리를 먼저 가진다.
  const items: Item[] = [];
  for (const d of surfaceDels) if (d.fluid !== undefined) items.push(delItem(d));
  for (const x of exports_) {
    if (yieldedExports.has(x.id)) continue;
    const exit = exitOf.get(x.id)!;
    items.push({ id: x.id, candidates: (t) => elbowShape(x, t, exit, ctx, capCol), max: cap });
  }
  for (const d of surfaceDels) if (d.fluid === undefined) items.push(delItem(d));

  const placedShapes: Placed[] = []; // 확정된 모든 도형(불변식: 서로소 + 유체 인접 없음)
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
  const maxJump = ctx.maxJump ?? 0;
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

  // 유체가 지상에 못 앉았다면 남은 수는 없다 — 지하도(D2) 탐색 폴백도(D3) 안 준다.
  // 사유를 갈라 둔다: 소비자(moduleWizard)가 거절 메시지에 그대로 싣는다.
  for (const d of fluidDels) {
    if (deliveryPlans.get(d.id)?.kind !== "fallback") continue;
    deliveryPlans.set(d.id, { kind: "fallback", reason: "fluid-no-surface-assignment" });
  }

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

  // 폭 역전 — 폭의 근거는 배정 결과(사용한 최고 트랙 번호).
  let trackCount = 0;
  for (const p of placedShapes) for (const v of p.shape.v) trackCount = Math.max(trackCount, v.col + 1);

  return { deliveries: deliveryPlans, exports: exportPlans, trackCount };
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
