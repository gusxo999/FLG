/**
 * perimeterLanePlanner — 모듈 외부상자를 전역 perimeter 로 빼기 위한 **exit-lane 예약**
 * (조각 6-①, 순수·좌표 산정만).
 *
 * ## 무엇을/왜
 * 모듈 파이프라인은 살아남은 외부상자(raw 입력 + 루트 출력)를 각자의 **로컬 모듈 ring**
 * 에 둔다. depth 열 타일링 후엔 그 ring 들이 조립 블루프린트의 **내부**로 들어가 상자가
 * 흩어진다. 해법은 각 상자를 **인접 gap(모듈 사이 채널 / 바깥 마진) 안의 lane** 으로 빼
 * 가장 가까운 전역 외곽 변으로 보내는 것 — 그러려면 채널 폭 계산처럼 **lane 공간을 패킹
 * 단계에서 미리 예약**해야 한다.
 *
 * ## 일반화 (black box)
 * 모듈 내부(클러스터 기둥/단일 머신)를 보지 않는다. 입력은 **경계 포트(어느 *변*에
 * 붙었나 + abs y) + 배치 gap 기하**뿐. exit 방향은 belt 흐름이 아니라 "어느 gap 이
 * 인접한가"에서 나온다. N/S 우세는 가로 타일링의 *결과*지 가정이 아니다.
 *
 * ## (A) 폭만 예약 — 트랙 index 는 못박지 않음
 * 채널로 들어가는 lane 은 자기 **세로 점유 구간**만 내놓고, packModuleTree 가 이를 홉
 * 구간과 **합쳐** [channelPlanner.assignTracksLeftEdge] 로 트랙 수(=폭)만 산정한다. 실제
 * 몇 번째 트랙에 깔릴지는 검증된 라우터가 정한다(홉과 동일 관행).
 *
 * ## host 판정 규칙 (포트 *변* + depth 위치)
 * - **N/S 변**: 자기 열 직진(self) → N/S 마진 행에 상자 seat. 같은 열 위/아래 형제에
 *   막히면 인접 채널로 우회해 그 채널 안에서 가까운 N/S 로.
 * - **W 변**: 최좌 열(depth 0)이면 바깥 W 마진으로 직출. 아니면 왼쪽 채널로 우회 → 가까운 N/S.
 * - **E 변**: 최우 열(maxDepth)이면 바깥 E 마진으로 직출. 아니면 오른쪽 채널로 우회 → 가까운 N/S.
 *
 * 좌표 주의: colX 확정 *전* 에 불린다(채널 폭이 colX 를 정하므로). 그래서 X 는 안 쓰고
 * abs **y** 와 depth 만으로 판정한다(홉 구간 산정과 동일 관행).
 */

import type { Interval } from "./channelPlanner";

export type ExitEdge = "N" | "S" | "W" | "E";

/** lane 이 지나갈 통로. */
export type LaneHost =
  | { kind: "self" } // 자기 열 직진(N/S 마진 행만 소비)
  | { kind: "channel"; depth: number } // 채널 depth 안에서 세로 주행(트랙 1 소비)
  | { kind: "margin"; edge: "W" | "E" }; // 바깥 W/E 마진으로 직출

/** 살아남은 외부상자 포트 하나 — 모듈 내부를 안 보는 최소 입력. */
export interface LanePortInput {
  /** 안정 식별자(상자 id). */
  id: string;
  role: "input" | "output";
  depth: number;
  /** 포트가 붙은 모듈 *변* (anchor vs 머신 bbox). */
  side: ExitEdge;
  /** 포트 anchor 의 abs y (topY 반영). */
  anchorY: number;
}

/** 한 depth 열의 모듈 세로 밴드(abs y) — 자기-열 막힘 판정용. */
export interface ColumnBand {
  id: string;
  top: number;
  bottom: number;
}

export interface LaneContext {
  /** 전역 세로 범위(모듈 union). */
  globalY: { min: number; max: number };
  maxDepth: number;
  /** depth → 그 열의 모듈 밴드들. */
  bandsByDepth: Map<number, ColumnBand[]>;
}

export interface LaneAssignment {
  id: string;
  role: "input" | "output";
  exitEdge: ExitEdge;
  host: LaneHost;
  /** host 가 channel 일 때의 세로 점유 구간(트랙 풀 합류용). */
  interval?: Interval;
  /**
   * 채널 진입점 — 접점 행(anchor y) + 어느 벽에서 들어오나(W=부모 열 쪽 / E=자식 열 쪽).
   * 기하 예약(channelGeometryPlanner)의 반출 경로 입력. W/E 변 포트만 채워진다 —
   * N/S 변의 채널 우회는 진입 기하가 달라 미지원(폭만 예약).
   */
  entry?: { y: number; wall: "W" | "E" };
  /**
   * 기하 예약이 확정한 세로 주행 열(절대 x) — modulePacking 이 배정 후 기록하고
   * ⑥C(perimeterRouter)가 스캔 없이 그대로 재생한다.
   */
  laneX?: number;
}

export interface LanePlan {
  assignments: LaneAssignment[];
  /** 채널 depth → 그 채널에 더할 lane 세로 구간들(홉 구간과 합쳐 폭 산정). */
  channelLaneIntervals: Map<number, Interval[]>;
  /** 바깥/변 마진 수요. N/S = 상자 seat 행 필요 여부, W/E = 마진 열 필요 여부. */
  marginNeeds: { N: boolean; S: boolean; W: boolean; E: boolean };
}

/** N/S 중 anchor 에 더 가까운 변. */
function nearerNS(anchorY: number, gy: { min: number; max: number }): "N" | "S" {
  return anchorY - gy.min <= gy.max - anchorY ? "N" : "S";
}

/** 그 변으로 나갈 때 세로로 달릴 목표 edge y. */
function edgeY(edge: "N" | "S", gy: { min: number; max: number }): number {
  return edge === "N" ? gy.min : gy.max;
}

/**
 * 같은 열에서 이 포트가 `edge`(N/S) 로 직진할 때 형제 모듈에 막히나?
 * N: 나보다 위(top 이 더 작은) 모듈이 있으면 막힘. S: 아래(bottom 이 더 큰) 모듈.
 * 자기 밴드는 anchorY 를 품는 밴드로 식별한다(없으면 안 막힘으로 간주).
 */
function selfBlocked(
  depth: number,
  anchorY: number,
  edge: "N" | "S",
  ctx: LaneContext,
): boolean {
  const bands = ctx.bandsByDepth.get(depth) ?? [];
  const mine = bands.find((b) => anchorY >= b.top && anchorY <= b.bottom) ?? null;
  const myTop = mine ? mine.top : anchorY;
  const myBottom = mine ? mine.bottom : anchorY;
  for (const b of bands) {
    if (b === mine) continue;
    if (edge === "N" && b.top < myTop) return true;
    if (edge === "S" && b.bottom > myBottom) return true;
  }
  return false;
}

/** 형제에 막힌 N/S 변 포트가 우회할 채널 depth. 부모 쪽(왼쪽 채널) 우선. */
function divertChannel(depth: number, maxDepth: number): number | null {
  if (depth >= 1) return depth; // 채널 depth = 열 depth-1↔depth (왼쪽)
  if (depth < maxDepth) return depth + 1; // 루트 열이면 오른쪽 채널
  return null; // 단일 열 — 채널 없음
}

/**
 * exit-lane 배정. 순수·결정적. 모듈 내부를 안 본다.
 */
export function planPerimeterLanes(ports: ReadonlyArray<LanePortInput>, ctx: LaneContext): LanePlan {
  const assignments: LaneAssignment[] = [];
  const channelLaneIntervals = new Map<number, Interval[]>();
  const marginNeeds = { N: false, S: false, W: false, E: false };
  const gy = ctx.globalY;

  const pushChannel = (depth: number, iv: Interval) => {
    (channelLaneIntervals.get(depth) ?? channelLaneIntervals.set(depth, []).get(depth)!).push(iv);
  };
  const toChannel = (
    p: LanePortInput,
    depth: number,
    edge: "N" | "S",
    wall?: "W" | "E",
  ): LaneAssignment => {
    const iv: Interval = { lo: Math.min(p.anchorY, edgeY(edge, gy)), hi: Math.max(p.anchorY, edgeY(edge, gy)) };
    pushChannel(depth, iv);
    marginNeeds[edge] = true; // 상자 seat 는 N/S 마진 행.
    return {
      id: p.id,
      role: p.role,
      exitEdge: edge,
      host: { kind: "channel", depth },
      interval: iv,
      entry: wall ? { y: p.anchorY, wall } : undefined,
    };
  };

  // 결정적: id 오름차순.
  const sorted = [...ports].sort((a, b) => a.id.localeCompare(b.id));
  for (const p of sorted) {
    if (p.side === "N" || p.side === "S") {
      const edge = p.side; // 변 그대로 나감
      if (!selfBlocked(p.depth, p.anchorY, edge, ctx)) {
        marginNeeds[edge] = true;
        assignments.push({ id: p.id, role: p.role, exitEdge: edge, host: { kind: "self" } });
      } else {
        const ch = divertChannel(p.depth, ctx.maxDepth);
        if (ch === null) {
          // 단일 열 + 막힘 — 반대 N/S 로 self 폴백(둘 다 막힐 일은 없음: 최상단/최하단 존재).
          const alt = edge === "N" ? "S" : "N";
          marginNeeds[alt] = true;
          assignments.push({ id: p.id, role: p.role, exitEdge: alt, host: { kind: "self" } });
        } else {
          assignments.push(toChannel(p, ch, nearerNS(p.anchorY, gy)));
        }
      }
    } else if (p.side === "W") {
      if (p.depth === 0) {
        marginNeeds.W = true;
        assignments.push({ id: p.id, role: p.role, exitEdge: "W", host: { kind: "margin", edge: "W" } });
      } else {
        // 왼쪽 채널 — 모듈이 그 채널의 동쪽 열이므로 E벽에서 진입.
        assignments.push(toChannel(p, p.depth, nearerNS(p.anchorY, gy), "E"));
      }
    } else {
      // side === "E"
      if (p.depth === ctx.maxDepth) {
        marginNeeds.E = true;
        assignments.push({ id: p.id, role: p.role, exitEdge: "E", host: { kind: "margin", edge: "E" } });
      } else {
        // 오른쪽 채널 — 모듈이 그 채널의 서쪽 열이므로 W벽에서 진입.
        assignments.push(toChannel(p, p.depth + 1, nearerNS(p.anchorY, gy), "W"));
      }
    }
  }

  return { assignments, channelLaneIntervals, marginNeeds };
}
