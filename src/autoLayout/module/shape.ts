/**
 * **모듈 도형 — 머신이 놓인 뒤.** 배정(순번 · 면 · 깊이 · 끝)에 머신 좌표를 입혀 **모듈-로컬 좌표**를 낸다.
 *
 * ```
 * layoutModule             몸통 — 머신 좌표 · 틀 · ring (gap 폭은 계획이 준다)
 * placeLinkSeats           좌석 좌표 — 배정의 순번 + 머신 원점(덧셈뿐)
 * machineExtent            기둥 틀 — 머신 전부가 덮는 범위
 * seatsOf · linkFrameOf    링크 틀 — 면 · 좌석(머신 × 행) · 포트 면 · 깊이 · 흐름 끝
 * seatCellsOf              좌석(d1) 칸
 * tapAnchorOf              포트의 machine-side 끝점 — 납품 · 반출 라우팅이 출발하는 칸
 * outputRouteOf            싣는 쪽 길 — 칸 순서와 방향 · 트렁크 끝
 * inputRouteOf             집는 쪽 길 — 칸 순서와 방향 · 흐름의 끝 칸 · 포트가 붙는 칸
 * pipeFrameOf              유체 틀 — 방출 깊이 · 나가는 끝 · 엇갈림 · 기둥 범위 · 포트 두 칸
 * ```
 *
 * ## `linkShape` 와 가르는 선 — 좌표계를 아나
 *
 * [linkShape] 는 순번 축이라 계획(청구 · 검사)과 방출이 **같은 함수**를 부른다. 여기는 **머신 원점을 안다** —
 * 그래서 방출만 부른다. W/E 면의 길은 `linkShape` 의 답을 면 좌표로 얹을 뿐이고, gap(N/S) 면의 길은 계획이
 * 청구하지 않는 모양이라 여기서 짓는다(그 포트 칸이 어느 장부에도 없다 — work-kinds §7 D8).
 *
 * ## 이 파일이 안 하는 것
 *
 * 장부(`occupancy`)를 안 본다 — 칸이 비었는지는 방출기가 **길을 다 받은 뒤** 묻는다(반만 놓인 벨트는 없다).
 * 셀도 안 만든다 — 찍기는 `execution/module/emitModule` 의 일이다.
 *
 * > **내력.** 2026-09-14 까지 틀과 길은 방출기(`emitOutputLinks` · `emitInputLinks` · `emitTrunkPipe`) 안에, 몸통과
 * > 좌석 좌표는 조율자(`clusterModule`) 안에 있었고, 기둥 틀 식이 세 벌이었다(계획 구조-2축 · 2 Step 4).
 */

import { flowEnd, trunkEndKey } from "./arith";
import { layoutCluster } from "./clusterLayout";
import { linkShape, type ShapeCell } from "./linkShape";
import type { PlannedLine } from "./types/line";
import type { ModuleInput, TrunkContext } from "./types/module";
import type { LinkFacePlan, LinkSeats } from "./types/seat";
import type { Container, PortFace } from "../containerModel";
import { enumeratePerimeterCells, faceCell, faceVector } from "../util/helper";

type Cell = { x: number; y: number };

/** 모듈-로컬 틀 — 칸 범위(양 끝 포함). */
export type Extent = { x0: number; y0: number; x1: number; y1: number };

/** 길의 한 칸 — 벨트가 설 자리와 그 칸이 흘려보내는 방향. */
export interface RouteCell {
  at: Cell;
  v: Cell;
}

/** **기둥 틀** — 머신 전부가 덮는 범위. */
export function machineExtent(machines: Container[]): Extent {
  return {
    x0: Math.min(...machines.map((m) => m.origin.x)),
    y0: Math.min(...machines.map((m) => m.origin.y)),
    x1: Math.max(...machines.map((m) => m.origin.x + m.size.w - 1)),
    y1: Math.max(...machines.map((m) => m.origin.y + m.size.h - 1)),
  };
}

/**
 * **좌석** — 배정의 순번에 머신 원점을 더한 행을, 머신 순서대로.
 *
 * 좌석은 머신 여럿에 걸칠 수 있다 — 기둥을 따라 달리는 줄은 모든 머신에 걸친다.
 * 머신이 없는 좌석은 거른다(구성상 없다 — `placeLinkSeats` 가 그런 배정을 통째로 `undefined` 로 낸다).
 */
export function seatsOf(plan: LinkSeats, machines: Container[]): { m: Container; rows: number[] }[] {
  return [...plan.slots]
    .sort((a, b) => a[0] - b[0])
    .map(([mi, rows]) => ({ m: machines[mi], rows }))
    .filter((s) => s.m);
}

/** **링크 틀** — 그룹 하나의 도형이 서는 좌표 틀. 두 역할이 나눠 쓴다. */
export interface LinkFrame {
  face: PortFace;
  isGap: boolean;
  /** 면 바깥 방향. */
  fv: Cell;
  /** 머신 쪽 — `fv` 의 반대. */
  inward: Cell;
  seats: { m: Container; rows: number[] }[];
  /** 기준 머신 — 좌석의 첫 머신. */
  m0: Container;
  /** 좌석 행 전부, 오름차순. */
  rows: number[];
  /** 깊이를 재는 틀 — gap 이면 **그 머신의 면**, W/E 면이면 기둥 전체. */
  ext: Extent;
  portFace: PortFace;
  pfv: Cell;
  clusterBeltDepth: number;
  exitDepth: number;
  /** 흐름이 향하는 끝이 S 인가([flowEnd]) — 포트가 서는 쪽이다. */
  toSouth: boolean;
  /** 포트 쪽 끝 행. */
  topT: number;
}

/**
 * 링크 틀을 짓는다. 역할이 가르는 것은 **gap 포트 면 하나**다 — 싣는 쪽은 서쪽 변, 집는 쪽은 동쪽 변으로 나간다.
 * `seats` 가 비면 기준 머신이 없다 — 부르는 쪽이 먼저 거른다.
 */
export function linkFrameOf(
  role: "output" | "input",
  plan: LinkSeats,
  seats: { m: Container; rows: number[] }[],
  ext: Extent,
): LinkFrame {
  const face = plan.face;
  const isGap = face === "N" || face === "S";
  const fv = faceVector(face);
  const m0 = seats[0].m;
  const allRows = seats.flatMap((s) => s.rows).sort((a, b) => a - b);
  // depth 는 gap 이면 **그 머신의 면**에서 잰다 — 가운데 머신의 N/S 는 클러스터 끝면이
  // 아니다. W/E 면은 기둥이라 모든 머신의 x 가 같아 전체 ext 와 결과가 같다.
  const mExt = isGap
    ? { x0: m0.origin.x, y0: m0.origin.y, x1: m0.origin.x + m0.size.w - 1, y1: m0.origin.y + m0.size.h - 1 }
    : ext;

  // 출구는 **벨트가 앉은 면을 따른다.** W/E 면 좌석이면 세로 벨트가 그 면 바깥을 보고,
  // N/S(gap) 좌석이면 가로 벨트가 gap 을 따라 서쪽 변까지 와서 90° 꺾인다 — **그 꺾이는
  // 칸이 곧 평범한 W 포트**다(모서리 포트). 그래서 채널 장부가 새 모양을 배울 필요가 없다.
  //
  // 예전엔 **언제나 W** 였다. 링크 출력은 선호 면이 W 고 넘치면 gap 으로만 가서 그게 늘
  // 맞았기 때문이다. 원료·완제품 줄까지 이 배분기를 타면 출력이 E 에 앉을 수 있고, 그때
  // W 를 고집하면 포트 인서터가 **머신 쪽으로** 자라 좌석 줄과 부딪힌다.
  // **관통이면 포트가 기둥 끝**([LinkFacePlan.portEnd]) — 상자가 기둥 밖이라 그 면의 깊은
  // 깊이가 상자를 가두지 못한다. 구간이면 오늘처럼 옆이다.
  // 집는 쪽은 거울이다 — gap 이면 가로 벨트가 동쪽 변에서 90° 꺾여 들어온다(모서리 E 포트).
  const portFace: PortFace = plan.portEnd ?? (isGap ? (role === "output" ? "W" : "E") : face);
  const pfv = faceVector(portFace);
  // 벨트 깊이는 **계획이 정해 들고 온 값**이다 — gap 폭을 유도한 바로 그 값이라
  // 여기서 다른 수를 쓰면 벨트가 gap 밖으로 넘친다([gapRowsFromPlans]).
  const clusterBeltDepth = plan.clusterBeltDepth;
  const exitDepth = plan.exitDepth ?? clusterBeltDepth;
  // 흐름은 **포트 쪽 끝**을 향한다 — N 이면 위(t 작은 쪽), S 면 아래.
  // **구간 줄도 이 값을 갖는다**([flowEnd] · 2026-09-05). 예전엔 `plan.portEnd === "S"`
  // 라서 구간 줄이 언제나 위였다 — 부모가 아래에 있어도.
  const toSouth = flowEnd(plan) === "S";
  const topT = toSouth ? allRows[allRows.length - 1] : allRows[0];
  return {
    face, isGap, fv, inward: { x: -fv.x, y: -fv.y }, seats, m0, rows: allRows, ext: mExt,
    portFace, pfv, clusterBeltDepth, exitDepth, toSouth, topT,
  };
}

/**
 * **포트의 machine-side 끝점**(`tapAnchor`) — 납품/반출 라우팅이 여기서 출발하고, 포트 계약이
 * `anchor − 2·faceVector` 를 요구한다([modulePacking] ⑥B). `end` 는 포트가 붙는 칸(싣는 쪽 트렁크 끝 · 집는 쪽 벨트 머리).
 *
 * gap(N/S) 그룹은 벨트가 가로로 달려 **변에서 꺾이므로** 그 꺾이는 칸(= 포트가 선 변 쪽 머신 가장자리)이
 * 끝점이다. W/E 그룹은 벨트가 세로라 끝점이 **벨트 칸 자체**(d`clusterBeltDepth`)다 — 예전엔 둘 다
 * 머신 가장자리를 썼는데, 그러면 W/E 포트의 끝점이 머신 발자국 **안**으로 들어가 반출
 * 재배치가 통째로 실패한다(2026-08-17 실측 — skip 3). 옛 탭 경로가 이 줄들을 맡던 동안엔
 * 안 드러났다.
 *
 * 두 역할의 식을 그대로 둔다 — 싣는 쪽은 *"E 면이면 동쪽 끝"*, 집는 쪽은 *"W 면이면 서쪽 끝"* 으로 적혀 있었다.
 */
export function tapAnchorOf(role: "output" | "input", f: LinkFrame, end: Cell): Cell {
  const { isGap, portFace, m0 } = f;
  if (role === "output") {
    return isGap
      ? { x: portFace === "E" ? m0.origin.x + m0.size.w - 1 : m0.origin.x, y: end.y }
      : { ...end };
  }
  return isGap
    ? { x: portFace === "W" ? m0.origin.x : m0.origin.x + m0.size.w - 1, y: end.y }
    : { ...end };
}

/** 좌석(d1) 칸 — 좌석 행마다 하나. */
export function seatCellsOf(f: LinkFrame): Cell[] {
  return f.rows.map((t) => faceCell(f.ext, f.face, 1, t));
}

/**
 * **싣는 쪽 길** — 벨트가 흐르는 순서대로 칸과 방향, 그리고 트렁크 끝(포트가 붙는 칸).
 *
 * W/E 면은 계획이 청구할 때 부른 그 도형([linkShape])을 면 좌표로 얹는다. gap(N/S) 은 여기서 짓는다 —
 * ① 수집 ② 자기 줄로 내려가기 ③ 반출. 칸은 **오늘 방출이 놓던 순서 그대로** 담는다(셀 순서가 곧 결과 순서다).
 */
export function outputRouteOf(f: LinkFrame, plan: LinkSeats): { path: RouteCell[]; trunkStart: Cell } {
  const { face, isGap, fv, m0, rows: allRows, ext: mExt, pfv, clusterBeltDepth, exitDepth, toSouth, topT } = f;
  /**
   * **이 배정의 도형** — 계획이 청구할 때 부른 그 함수다([linkShape] · work-kinds §7 D1).
   * gap 은 없다 — 계획이 그 칸을 청구하지 않아 아래 else 가 여기서 짓는다(포트 칸이 어느 장부에도 없다 · work-kinds §7 D8).
   */
  const shape = isGap ? undefined : linkShape({
    role: "output",
    clusterBeltDepth,
    portEnd: plan.portEnd,
    flowToSouth: toSouth,
    mergeRole: plan.mergeRole,
    rows: allRows,
    outRow: plan.portEnd === "S" ? mExt.y1 + 1 : mExt.y0 - 1,
  });
  const cellAt = (c: { depth: number; t: number }) => faceCell(mExt, face, c.depth, c.t);
  const path: RouteCell[] = [];
  const push = (at: Cell, v: Cell): void => {
    path.push({ at, v });
  };
  // 흐름은 언제나 **트렁크 끝(t 가 작은 쪽)을 향한다** — W/E 면은 위로, N/S 면은 서쪽으로.
  const beltDirV = isGap ? { x: -1, y: 0 } : { x: 0, y: toSouth ? 1 : -1 };
  // **끝 칸은 면을 따라 계속 흐르지 않고 포트 쪽으로 꺾는다.** 안 꺾으면 이 그룹의 물건이
  // 면을 따라 더 흘러 **이웃 그룹의 벨트로 넘어간다**(머신 사이 gap 이 0 이면 두 벨트가 실제로
  // 맞닿는다). 품목이 같아 오염은 안 나지만 장부가 통째로 거짓이 된다 — 이쪽 부모는 굶고
  // 저쪽 부모는 넘친다. 셀 겹침(occupancy)만 봐서는 못 잡는 종류다(2026-07-22 수정).
  // 꺾은 칸의 다음 칸은 이 그룹의 포트 인서터라 언제나 비어 있다(다른 그룹의 행과 안 겹친다).
  if (shape) {
    // **도형은 [linkShape] 가 든다** — 수집 · 합류(이끔/따름) · 포트가 거기서 나온다.
    // 여기 남은 일은 셋뿐이다: 면 좌표로 얹고, **방향을 다음 칸에서 읽고**, 칸을 채운다.
    //
    // 방향을 도형이 안 들고 다니는 이유: 벡터는 면이 W냐 E냐로 부호가 뒤집혀 **좌표계의
    // 일**이다. 순서만 있으면 방향은 유도된다 — 그래서 도형이 좌표를 몰라도 된다.
    shape.path.forEach((c: ShapeCell, idx: number) => {
      const at = cellAt(c);
      const to = cellAt(shape.path[idx + 1] ?? shape.after);
      push(at, { x: Math.sign(to.x - at.x), y: Math.sign(to.y - at.y) });
    });
  } else {
    // ── gap(N/S) — 계획이 장부를 안 드는 자원 모양이라 도형이 여기 남는다 ──────────
    // ① **수집** — 자기 좌석 **구간**(첫 좌석 행 ~ 마지막 좌석 행)을 빠짐없이 덮는다.
    // **목록이 아니라 범위다** — 좌석이 머신 여럿에 걸치면 사이 행이 빠져 벨트가 끊긴다
    // (2026-08-17 실측: concrete 출력이 네 칸으로 흩어져 머신 셋의 산출이 갇혔다).
    for (let t = Math.min(...allRows); t <= Math.max(...allRows); t++) {
      // 끝 칸: 자기 줄로 내려가야 하면 **더 깊은 줄 쪽**(fv)으로, 아니면 포트 쪽(pfv)으로.
      const turn = exitDepth > clusterBeltDepth ? fv : pfv;
      push(faceCell(mExt, face, clusterBeltDepth, t), t === topT ? turn : beltDirV);
    }
    // ② **자기 줄로 내려가기** — 막힌 면이라 벨트가 깊이로 갈린다([[ParallelBelt]]). 내려가는
    // 건 **벨트가 벨트를 먹이는** 것이라 팔 길이와 무관하다(팔은 수집 줄까지만 닿으면 된다).
    for (let d = clusterBeltDepth + 1; d <= exitDepth; d++) {
      push(faceCell(mExt, face, d, topT), d === exitDepth ? pfv : fv); // 반출 줄에 닿으면 서쪽으로
    }
    // ③ **반출** — 반출 줄을 따라 서쪽 변까지. 먼저 앉은 그룹들의 줄보다 **깊고**, 그들의
    // 열보다 **동쪽에서** 출발하므로 남의 줄을 밟지 않는다.
    if (exitDepth > clusterBeltDepth)
      for (let t = topT - 1; t >= m0.origin.x; t--) push(faceCell(mExt, face, exitDepth, t), pfv);
  }
  // 트렁크 끝(= 납품 경로 계약의 trunkStart) — W 면이면 belt 줄의 맨 위, N/S 면이면 **반출 줄의**
  // 맨 서쪽(자기 줄로 내려온 뒤 서쪽 변에 닿는 칸).
  // **포트가 붙는 칸은 도형의 끝이다** — 싣는 쪽은 흐름이 포트로 모이므로 마지막 칸이다
  // (합류 이끄는 줄이면 그게 곧 합류 칸이다). gap 은 서쪽 변에서 꺾이는 칸.
  const trunkStart = shape
    ? cellAt(shape.path[shape.path.length - 1])
    : { x: m0.origin.x, y: faceCell(mExt, face, exitDepth, topT).y };
  return { path, trunkStart };
}

/**
 * **집는 쪽 길** — 포트에서 받아 좌석 구간에 나눠 주는 순서대로 칸과 방향. 싣는 쪽의 거울이다.
 *
 * ```
 * farIdx     흐름의 끝 칸 — 그 칸의 최종 방향은 벨트가 다 깔린 뒤 resolveBeltTermini 가 정한다(늦은 결정)
 * flow       들어오는 흐름 방향 — 끝 칸 판정의 재료
 * trunkEnd   포트가 붙는 칸 — 검사가 포트 두 칸을 여기서 잰다
 * beltTop    포트 자리로 쓰는 칸 — W/E 면이면 도형의 첫 칸
 * ```
 */
export function inputRouteOf(
  f: LinkFrame,
  plan: LinkSeats,
): { path: RouteCell[]; farIdx: number; flow: Cell; trunkEnd: Cell; beltTop: Cell } {
  const { face, isGap, m0, rows: allRows, ext: geomExt, clusterBeltDepth, exitDepth, toSouth, topT, inward } = f;
  // gap 벨트는 머신 **동쪽 끝까지** 뻗어야 포트가 클러스터 밖에 선다. 자기 줄로 내려가는 그룹은
  // 그 구간을 **반출 줄**에서 달리고 자기 열에서 올라오므로, 여기선 자기 좌석 끝까지만.
  const ownEast = Math.max(...allRows);
  const botT = isGap
    ? (exitDepth > plan.clusterBeltDepth ? ownEast : m0.origin.x + m0.size.w - 1)
    : toSouth ? Math.min(...allRows) : ownEast;
  /**
   * 트렁크 끝(포트가 붙는 칸) — E 면이면 belt 줄의 맨 위, gap 이면 **반출 줄의** 맨 동쪽
   * (자기 줄로 내려가든 아니든 포트는 언제나 클러스터 동쪽 변에 선다).
   */
  const trunkEndOf = (d: number): { x: number; y: number } => {
    const b = faceCell(geomExt, face, d, topT);
    return isGap ? { x: m0.origin.x + m0.size.w - 1, y: faceCell(geomExt, face, exitDepth, topT).y } : b;
  };
  // 흐름은 포트(트렁크 끝)에서 **멀어지는** 쪽 — E 면은 아래로, gap 이면 서쪽으로.
  const beltDirV = isGap ? { x: -1, y: 0 } : { x: 0, y: toSouth ? -1 : 1 };
  // 벨트 경로를 **먼저 전부 계산하고**, 다 놓을 수 있을 때만 놓는다. 반만 놓인 벨트는
  // 포트에서 물건이 사라지는 것과 같아서, 한 칸이라도 막히면 통째로 물러난다.
  const path: RouteCell[] = [];
  /**
   * **이 배정의 도형** — 싣는 쪽과 **같은 함수**다([linkShape]). 집는 쪽은 흐름만 반대라
   * 포트에서 받아 좌석 구간에 나눠 주고, 먼 끝에서 머신 쪽으로 꺾어 멈춘다.
   * gap 은 없다(계획이 청구하지 않는다) — 그 기하는 아래 else 가 여기서 짓는다.
   */
  const shape = isGap ? undefined : linkShape({
    role: "input",
    clusterBeltDepth,
    portEnd: plan.portEnd,
    flowToSouth: toSouth,
    rows: allRows,
    outRow: 0, // 집는 쪽엔 합류 도형이 없다 — 안 쓰인다
  });
  const cellAt = (c: { depth: number; t: number }) => faceCell(geomExt, face, c.depth, c.t);
  /** 흐름의 **끝 칸** index — [resolveBeltTermini] 가 방향을 마무리할 자리. */
  let farIdx = -1;
  if (shape) {
    shape.path.forEach((c: ShapeCell, idx: number) => {
      const at = cellAt(c);
      const to = cellAt(shape.path[idx + 1] ?? shape.after);
      path.push({ at, v: { x: Math.sign(to.x - at.x), y: Math.sign(to.y - at.y) } });
    });
    farIdx = path.length - 1; // 흐름 순서라 끝 칸이 곧 마지막이다
  } else {
    // ── gap(N/S) — 계획이 장부를 안 드는 자원 모양이라 도형이 여기 남는다 ──────────
    // ① **반출** — 포트(동쪽 변)에서 자기 열까지 반출 줄로 달려온다([emitOutputLinks] 의
    // 거울, 흐름만 반대다). 내려갈 필요 없는 첫 그룹은 이 구간이 없다.
    if (exitDepth > clusterBeltDepth)
      for (let t = m0.origin.x + m0.size.w - 1; t > ownEast; t--)
        path.push({ at: faceCell(geomExt, face, exitDepth, t), v: beltDirV });
    // ② **자기 줄에서 올라오기** — 벨트가 벨트를 먹이는 것이라 팔 길이와 무관하다.
    for (let d = exitDepth; d > clusterBeltDepth; d--)
      path.push({ at: faceCell(geomExt, face, d, ownEast), v: inward });
    // ③ **수집** — 자기 좌석 구간을 덮으며 탭에 나눠 준다. 먼 쪽 끝 칸은 면을 따라 더
    // 흐르면 **이웃 그룹의 벨트로 넘어가므로** 머신 쪽으로 꺾어 멈춘다(기본값일 뿐이다 —
    // 최종 방향은 [resolveBeltTermini] 가 정한다).
    for (let t = Math.min(topT, botT); t <= Math.max(topT, botT); t++) {
      if (t === topT) farIdx = path.length;
      path.push({ at: faceCell(geomExt, face, clusterBeltDepth, t), v: t === topT ? inward : beltDirV });
    }
  }
  const trunkEnd = trunkEndOf(clusterBeltDepth);
  return { path, farIdx, flow: beltDirV, trunkEnd, beltTop: shape ? cellAt(shape.path[0]) : trunkEnd };
}

/** **유체 틀** — 유체 줄 하나의 기둥이 서는 좌표. */
export interface PipeFrame {
  face: PortFace;
  /** 면 바깥 방향 — 점프 지하파이프의 방향 계산에만 쓰인다. */
  fv: Cell;
  /** 방출 깊이 — 파이프 1 또는 ClusterPipe 깊이([TrunkContext.emitDepthOf]). */
  d: number;
  vertical: boolean;
  /** 기둥 틀([TrunkContext.ext]). */
  ext: Extent;
  /** 포트가 나가는 끝. */
  exitFace: PortFace;
  /** 기둥이 끝나는 칸 — 포트가 붙는다. */
  beltEnd: Cell;
  seat: Cell;
  chestAt: Cell;
  /** 기둥이 덮는 `t` 범위(엇갈림 포함). */
  lo: number;
  hi: number;
}

/**
 * **유체 틀** — [TrunkContext] 가 정한 방출 깊이와 엇갈림 기준(같은 끝의 가장 깊은 줄)을 좌표로 옮긴다.
 * 포트 두 칸은 기둥 끝에서 나가는 끝 쪽으로 일직선이다.
 */
export function pipeFrameOf(planned: PlannedLine, ctx: TrunkContext, lineEnds: ModuleInput["lineEnds"]): PipeFrame {
  const ext = ctx.ext;
  const line = planned.line;
  const face = planned.side as PortFace;
  const fv = faceVector(face); // 바깥 방향 — 점프 지하파이프의 방향 계산에만 쓰인다.
  const d = ctx.emitDepthOf(planned); // 파이프=1 또는 ClusterPipe 깊이.

  const vertical = face === "W" || face === "E";
  const t0 = vertical ? ext.y0 : ext.x0;
  const t1 = vertical ? ext.y1 : ext.x1;
  const atMin = (lineEnds?.get(`${line.role}:${line.name}`) ?? "min") === "min";
  const exitFace: PortFace = vertical ? (atMin ? "N" : "S") : atMin ? "W" : "E";
  const ev = faceVector(exitFace);

  // stagger — 같은 면·같은 끝으로 나가는 줄 중 가장 깊은 줄에 끝을 맞춘다([TrunkContext.maxDepthAtEnd]).
  const stagger = (ctx.maxDepthAtEnd.get(trunkEndKey(planned, lineEnds)) ?? d) - d;
  const tBeltEnd = atMin ? t0 - stagger : t1 + stagger;

  const beltEnd = faceCell(ext, face, d, tBeltEnd);
  const seat = { x: beltEnd.x + ev.x, y: beltEnd.y + ev.y };
  const chestAt = { x: beltEnd.x + 2 * ev.x, y: beltEnd.y + 2 * ev.y };
  const lo = Math.min(t0, tBeltEnd);
  const hi = Math.max(t1, tBeltEnd);
  return { face, fv, d, vertical, ext, exitFace, beltEnd, seat, chestAt, lo, hi };
}

/**
 * 모듈 머신 사이 세로 gap = 0(밀착). 모듈은 **간단 레시피**(W/E 두 면만으로 모든 I/O 를
 * 처리 — demand ≤ 용량이 구조적으로 보장)만 다루므로 N/S 면을 안 쓴다. 트렁크는 W/E 변을
 * 따라 세로로 흐르고 인서터 좌석도 각 머신 면(3칸) 안에 들어가, 머신 사이 공백은 트렁크
 * belt 길이만 늘릴 뿐 아무 기능이 없다 → 밀착. (N/S spill 이 있는 옛 라이브 경로는 ROW_GAP=3
 * 유지.) 복잡 레시피(2D)가 도입되면 그 경로가 자기 gap 을 따로 정한다.
 */
const MODULE_ROW_GAP = 0;

/** **몸통** — 머신 좌표(모듈-로컬) · 머신 bbox · 자기 perimeter ring. */
export interface ModuleBody {
  machines: Container[];
  bbox: { x: number; y: number; w: number; h: number };
  ring: { x: number; y: number }[];
}

/**
 * **몸통을 놓는다** — 계획이 준 gap 폭(`rowGaps`)으로 머신 N대의 좌표를 낸다. gap 폭은 우리가 고르는 값이 아니라
 * 면 배정의 부산물이고, 그래서 이 함수는 계획 **뒤**에만 불린다.
 */
export function layoutModule(input: ModuleInput, count: number, rowGaps: number[], prefix: string): ModuleBody {
  const layout = layoutCluster(
    { w: input.machine.w, h: input.machine.h, count },
    rowGaps.some((g) => g > 0) ? rowGaps : MODULE_ROW_GAP,
  );

  const machines: Container[] = layout.positions.map((pos, i) => ({
    id: `${prefix}-m${i}`,
    kind: "machine",
    entityName: input.machine.entityName,
    origin: { x: pos.dx, y: pos.dy },
    size: { w: input.machine.w, h: input.machine.h },
    // 유체 레시피면 머신을 돌려 유체 입구가 트렁크 파이프 쪽(W/E)을 보게 한다. 아이템
    // 전용이면 0 — 인서터는 어느 면에나 붙으므로 돌릴 이유가 없다(trunk-pipe §3).
    direction: input.fluidTrunk?.direction,
  }));

  const bbox = { x: 0, y: 0, w: layout.size.w, h: layout.size.h };
  const ring = enumeratePerimeterCells(bbox);
  return { machines, bbox, ring };
}

/**
 * 면 배정에 **좌표를 입힌다** — 머신이 놓인 뒤에 부른다. 하는 일은 덧셈뿐이다.
 *
 * "면에서 몇 번째 칸" 은 배정의 일이라 [commitLinkFace] 가 이미 끝냈고
 * ([LinkFacePlan.slotIndex] — 채우는 방향까지 거기서 정해진다), 여기서는 그 순번에
 * 머신 원점을 더해 `t` 로 바꾼다. `t` 의 뜻은 [faceCell] 과 같다:
 * W/E 면이면 y(행), N/S 면이면 x(열).
 *
 * **이 함수가 장부를 안 쓴다는 것이 요점이다.** 예전엔 여기서 빈 장부(`placeLedger`)를
 * 새로 만들어 배정이 이미 센 누적을 처음부터 다시 셌다 — 같은 사실을 두 주체가 두 번
 * 계산하면 언젠가 어긋난다.
 */
export function placeLinkSeats(
  machines: Container[],
  plans: (LinkFacePlan | undefined)[],
): (LinkSeats | undefined)[] {
  return plans.map((plan) => {
    if (!plan) return undefined;
    const isGap = plan.face === "N" || plan.face === "S";
    const slots = new Map<number, number[]>();
    for (const [mi, idx] of plan.slotIndex) {
      const m = machines[mi];
      if (!m) return undefined;
      const origin = isGap ? m.origin.x : m.origin.y;
      slots.set(mi, idx.map((i) => origin + i));
    }
    return { ...plan, slots };
  });
}
