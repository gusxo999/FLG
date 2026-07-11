/**
 * perimeterRouter — 포트(블랙박스 경계 셀) → 전역 perimeter 변까지의 **순수 기하 라우터**.
 *
 * modulePerimeterPass(⑥C)에 엉켜 있던 belt 기하(직선/L-jog/lane 스캔)를 여기로 이관해
 * 재사용·단위테스트가 가능한 한 함수로 만든 것. 모듈/pack/store 를 전혀 모르며, 오직
 *   - anchor: 블랙박스 테두리 위의 포트 셀
 *   - face:   바깥 방향(포트가 향한 면)
 *   - perimeter: seat(상자)가 앉을 전역 외곽 사각형(변 좌표)
 *   - obstacles: 점유 셀 집합(다른 블랙박스 footprint·홉 belt 등)
 * 만 본다.
 *
 * ## 두 모드
 * - **hint 있음(production)**: [perimeterLanePlanner] 가 ⑥A 에서 정한 exitEdge·host 를 그대로
 *   재현한다 — self/margin=직선, channel=face 방향 가로 jog→세로. 기존 동작 불변(회귀 0).
 * - **hint 없음(DevTool·탐색)**: 스스로 "가장 가까운 도달 가능한 변"을 고른다. face 변으로
 *   직선을 먼저 시도하고, 막히면 인접 gap 으로 우회(L), 그래도 막히면 다른 변으로. ⑥C+ 의
 *   미지원 케이스(N/S 면이 형제에 막혀 우회)도 이 경로에서 일반적으로 시도된다.
 *
 * 반환 path 는 anchor **다음** 셀부터 seat 까지의 순서 있는 외곽 경로다(anchor 자신은 제외).
 * 호출자가 anchor 안쪽(feeder 자리)을 앞에 붙여 belt 로 굽는다.
 */

import type { PortFace } from "../containerModel";
import { cellKey, faceVector, segment } from "../util/helper";
import type { ExitEdge, LaneHost } from "./perimeterLanePlanner";

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type Pt = { x: number; y: number };

/** production 재현용 힌트 — lanePlan 이 정한 배정. */
export interface RouteHint {
  exitEdge: ExitEdge;
  host: LaneHost;
  /**
   * 기하 예약(channelGeometryPlanner)이 확정한 세로 주행 열(절대 x) — channel host 에서
   * 스캔 대신 이 트랙을 먼저 재생한다(예약 자리는 홉이 침범 못 하므로 비어 있어야 정상).
   * 막혀 있으면(예약 밖 점유) 기존 스캔으로 폴백.
   */
  laneX?: number;
}

export interface RouteRequest {
  /** 포트 셀(블랙박스 테두리). */
  anchor: Pt;
  /** 바깥 방향 면. */
  face: PortFace;
  /** seat 가 앉을 외곽 사각형. seat 좌표축값 = 해당 변. */
  perimeter: Rect;
  /** 점유 셀(cellKey). anchor 바깥으로 나가는 경로가 이걸 피한다. */
  obstacles: Set<string>;
  /** 있으면 production 배정 그대로 재현. 없으면 자동 결정. */
  hint?: RouteHint;
  /** lane 우회 최대 거리(셀). 기본 16. */
  maxJog?: number;
}

export type RouteResult =
  | {
      ok: true;
      exitEdge: ExitEdge;
      /** 상자(외부 물류 접점)가 앉는 셀 = path 마지막. */
      seat: Pt;
      /** anchor 다음 셀 ~ seat 까지의 belt 경로(anchor 제외, seat 포함). */
      path: Pt[];
    }
  | { ok: false; reason: string };

const DEFAULT_MAX_JOG = 16;

/** 셀들이 전부 비어 있나(occ 에 없나). */
export function checkFree(cells: Pt[], occ: Set<string>): boolean {
  return cells.every((c) => !occ.has(cellKey(c.x, c.y)));
}

/** exitEdge 로 나갈 때 seat 가 앉는 좌표축 값(perimeter 변). */
function edgeCoord(edge: ExitEdge, p: Rect): number {
  switch (edge) {
    case "N": return p.minY;
    case "S": return p.maxY;
    case "W": return p.minX;
    case "E": return p.maxX;
  }
}

/**
 * anchor 에서 N/S 변(edgeY)까지 lane column 을 골라 도달 — 가로 jog(0 이면 직선) → 세로.
 * xOffsets = 시도할 lane column 오프셋(anchor.x 기준). 첫 성공 반환.
 */
function tryNS(
  anchor: Pt,
  edgeY: number,
  occ: Set<string>,
  xOffsets: number[],
): { seat: Pt; path: Pt[] } | null {
  for (const m of xOffsets) {
    const corner: Pt = { x: anchor.x + m, y: anchor.y };
    const seat: Pt = { x: corner.x, y: edgeY };
    const path = [...segment(anchor, corner), ...segment(corner, seat)];
    if (path.length > 0 && checkFree(path, occ)) return { seat, path };
  }
  return null;
}

/**
 * anchor 에서 W/E 변(edgeX)까지 lane row 를 골라 도달 — 세로 jog(0 이면 직선) → 가로.
 */
function tryWE(
  anchor: Pt,
  edgeX: number,
  occ: Set<string>,
  yOffsets: number[],
): { seat: Pt; path: Pt[] } | null {
  for (const m of yOffsets) {
    const corner: Pt = { x: anchor.x, y: anchor.y + m };
    const seat: Pt = { x: edgeX, y: corner.y };
    const path = [...segment(anchor, corner), ...segment(corner, seat)];
    if (path.length > 0 && checkFree(path, occ)) return { seat, path };
  }
  return null;
}

/** 0, ±1, ±2 … ±n (0 우선, 이후 두 방향 번갈아). dir!=0 이면 그 방향 우선. */
function jogOffsets(maxJog: number, preferDir = 0): number[] {
  const out = [0];
  for (let m = 1; m <= maxJog; m++) {
    if (preferDir >= 0) out.push(m);
    if (preferDir <= 0) out.push(-m);
  }
  return out;
}

/** production 힌트 재현: lanePlan 배정 그대로. */
function routeWithHint(req: RouteRequest, hint: RouteHint, maxJog: number): RouteResult {
  const { anchor, face, perimeter, obstacles: occ } = req;
  const fv = faceVector(face);
  const edge = hint.exitEdge;

  if (hint.host.kind === "self" || hint.host.kind === "margin") {
    // 직선: face 축으로 그 변까지.
    const res =
      edge === "N" || edge === "S"
        ? tryNS(anchor, edgeCoord(edge, perimeter), occ, [0])
        : tryWE(anchor, edgeCoord(edge, perimeter), occ, [0]);
    if (!res) return { ok: false, reason: `straight blocked to ${edge}` };
    return { ok: true, exitEdge: edge, seat: res.seat, path: res.path };
  }

  // channel host: 예약 트랙(laneX)이 있으면 그대로 재생, 없으면 face(가로) 방향 스캔 → N/S 변.
  if (edge !== "N" && edge !== "S") return { ok: false, reason: "channel non-NS" };
  // 반출 elbow 는 가로 진입(anchor → laneX) + 세로 주행(→ N/S 변). laneX 가 확정돼 있으면
  // jog 방향은 laneX−anchor.x 부호가 정하므로 face 축과 무관하다 — face 가 N/S(fv.x=0)라
  // 상자가 코너 어깨에 앉은 경우에도 예약된 트랙을 그대로 재생한다. face 가 가로(fv.x≠0)면
  // laneX 실패 시 그 방향으로 스캔 폴백. laneX 도 face 방향도 없으면(N/S 면 + 미배정) 진입
  // 방향을 정할 수 없어 거부(로컬 ring 유지 = skip-on-failure).
  const offsets: number[] = [];
  if (hint.laneX !== undefined) offsets.push(hint.laneX - anchor.x);
  if (fv.x !== 0) {
    for (let m = 1; m <= maxJog; m++) offsets.push(m * Math.sign(fv.x));
  } else if (hint.laneX === undefined) {
    return { ok: false, reason: "N/S-side channel divert without laneX" };
  }
  const res = tryNS(anchor, edgeCoord(edge, perimeter), occ, offsets);
  if (!res) return { ok: false, reason: "no free lane track in channel" };
  return { ok: true, exitEdge: edge, seat: res.seat, path: res.path };
}

/**
 * 자동 결정(hint 없음): face 변 직선 → 인접 gap L 우회 → 수직 변 → 반대 변 순으로 시도.
 * 첫 성공 반환. 전부 실패면 마지막 사유.
 */
function routeAuto(req: RouteRequest, maxJog: number): RouteResult {
  const { anchor, face, perimeter, obstacles: occ } = req;
  const fv = faceVector(face);
  const faceEdge = face as ExitEdge;

  // 변별 거리(가까운 순 정렬용).
  const dist: Record<ExitEdge, number> = {
    N: anchor.y - perimeter.minY,
    S: perimeter.maxY - anchor.y,
    W: anchor.x - perimeter.minX,
    E: perimeter.maxX - anchor.x,
  };

  // 시도 순서: face 변 먼저, 이후 수직(perp) 변을 가까운 순, 마지막 반대 변.
  const perp: ExitEdge[] =
    fv.x !== 0 ? ["N", "S"] : ["W", "E"]; // 가로 면 → N/S 로 우회, 세로 면 → W/E 로 우회
  perp.sort((a, b) => dist[a] - dist[b]);
  const opposite = oppositeEdge(faceEdge);
  const order: ExitEdge[] = [faceEdge, ...perp, opposite];

  let lastReason = "no route to any perimeter edge";
  const seen = new Set<ExitEdge>();
  for (const edge of order) {
    if (seen.has(edge)) continue;
    seen.add(edge);

    const target = edgeCoord(edge, perimeter);
    let res: { seat: Pt; path: Pt[] } | null;
    if (edge === "N" || edge === "S") {
      // face 가 가로면 그 방향으로 우선 우회, 아니면 직선(0) 우선 후 양방향.
      const prefer = edge === faceEdge ? 0 : Math.sign(fv.x);
      res = tryNS(anchor, target, occ, jogOffsets(maxJog, prefer));
    } else {
      const prefer = edge === faceEdge ? 0 : Math.sign(fv.y);
      res = tryWE(anchor, target, occ, jogOffsets(maxJog, prefer));
    }
    if (res) return { ok: true, exitEdge: edge, seat: res.seat, path: res.path };
    lastReason = `blocked to ${edge}`;
  }
  return { ok: false, reason: lastReason };
}

function oppositeEdge(e: ExitEdge): ExitEdge {
  return e === "N" ? "S" : e === "S" ? "N" : e === "W" ? "E" : "W";
}

/**
 * 포트 → perimeter 변 라우팅. 순수·결정적. hint 있으면 production 배정 재현, 없으면 자동 결정.
 */
export function routePortToPerimeter(req: RouteRequest): RouteResult {
  const maxJog = req.maxJog ?? DEFAULT_MAX_JOG;
  return req.hint
    ? routeWithHint(req, req.hint, maxJog)
    : routeAuto(req, maxJog);
}
