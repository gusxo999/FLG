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
import type { PortFace } from "../containerModel";

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
  /**
   * [ModulePort.moduleWayOuts] — 이 상자가 **모듈 몸통에 안 막히고** 나갈 수 있는 방향들.
   * 모듈이 자기 자신에 대해 답한 것이라, 여기선 모듈 내부를 안 보고 이 목록만 믿는다.
   *
   * **불변식:** 배정된 출구의 모듈 진출 방향은 반드시 이 안에 있어야 한다. 옛 코드는
   * `side`(= meta.side) 만 보고 배정해서, 코너 어깨 상자처럼 그 방향이 형제 트렁크에
   * 막힌 경우에도 **못 쓰는 채널 우회를 예약**했다(폭만 낭비 + 방출은 탐색 폴백에 의존).
   */
  wayOuts: PortFace[];
}

/**
 * 한 상자가 쓸 수 있는 출구 하나. **모듈 진출 방향(`wayOut`)이 wayOuts 안에 있음이 보장**
 * 되므로, 이 출구로 예약하면 모듈 몸통에 막혀 실패할 일이 없다.
 *
 * 여러 개를 후보로 들고 다니는 이유: 출구 선택은 **자유도**다. 나중에 더 까다로운 제약
 * (절단선이 납품 경로를 가둠·채널 트랙 부족 등)을 가진 장부가 **양보를 요구**할 수 있으므로,
 * planner 가 하나로 못박지 않고 후보를 남겨 장부가 고르게 한다(스도쿠: 제약 센 곳부터).
 */
export interface LaneOption {
  exitEdge: ExitEdge;
  host: LaneHost;
  /** 이 출구가 모듈을 빠져나가는 방향 — 반드시 wayOuts 에 포함. */
  wayOut: PortFace;
  /** channel host 일 때의 세로 점유 구간(트랙 풀 합류용). */
  interval?: Interval;
  /** channel host 일 때의 진입 벽/행(장부의 반출 경로 입력). */
  entry?: { y: number; wall: "W" | "E" };
  /** 이 출구가 채널 트랙을 먹는가(= 폭을 넓히는가). margin/self 는 false. */
  usesChannelTrack: boolean;
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
  /**
   * 쓸 수 있는 출구 후보들(선호 순, 전부 wayOuts 를 만족). 아래 평평한 필드
   * (exitEdge/host/interval/entry)는 **현재 확정** = 기본값 `options[0]`.
   * 장부가 제약 때문에 다른 후보로 **양보**시킬 수 있다 — 그때 확정 필드도 함께 갱신한다.
   */
  options: LaneOption[];
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

/**
 * 한 포트가 쓸 수 있는 출구 후보를 **선호 순**으로 전부 나열한다.
 *
 * 모든 후보는 `wayOut ∈ p.wayOuts` 를 만족한다 — 즉 **모듈 몸통에 막히지 않음이 보장**된
 * 출구만 나온다. 이것이 "예약한 경로는 항상 방출 가능"이라는 예약 철학의 핵심이다.
 *
 * 선호 순서는 **자유도**다(무엇을 먼저 놓든 정합성은 안 깨짐). 여기선 회귀를 줄이려고
 * 옛 규칙(side 기반)을 1순위로 재현하고, 그게 막혔을 때 나머지 가능한 출구로 흘린다.
 * 나중에 폭 최소화 등 다른 기준으로 재정렬해도 되고, 장부가 뒤 후보로 양보시켜도 된다.
 */
function enumerateOptions(p: LanePortInput, ctx: LaneContext): LaneOption[] {
  const gy = ctx.globalY;
  const can = (d: PortFace) => p.wayOuts.includes(d);
  const opts: LaneOption[] = [];

  /** 자기 열 직진(N/S 마진 행으로). 채널 트랙 안 먹음. */
  const selfOpt = (e: "N" | "S"): LaneOption | null =>
    can(e) && !selfBlocked(p.depth, p.anchorY, e, ctx)
      ? { exitEdge: e, host: { kind: "self" }, wayOut: e, usesChannelTrack: false }
      : null;

  /** 바깥 W/E 마진 직출 — 끝 열에서만. 채널 트랙 안 먹음. */
  const marginOpt = (e: "W" | "E"): LaneOption | null => {
    if (!can(e)) return null;
    if (e === "W" && p.depth !== 0) return null;
    if (e === "E" && p.depth !== ctx.maxDepth) return null;
    return { exitEdge: e, host: { kind: "margin", edge: e }, wayOut: e, usesChannelTrack: false };
  };

  /**
   * 인접 채널로 우회 → 채널 안에서 N/S 변으로. 채널 트랙을 하나 먹는다(폭 +).
   * wayOut=W 면 왼쪽 채널(depth), wayOut=E 면 오른쪽 채널(depth+1).
   * 모듈은 그 채널의 반대 벽에 붙으므로 진입 벽은 wayOut 의 반대.
   */
  const channelOpts = (wayOut: "W" | "E"): LaneOption[] => {
    if (!can(wayOut)) return [];
    const depth = wayOut === "W" ? p.depth : p.depth + 1;
    if (wayOut === "W" && p.depth < 1) return []; // 최좌 열의 왼쪽엔 채널이 없다(마진).
    if (wayOut === "E" && p.depth >= ctx.maxDepth) return []; // 최우 열의 오른쪽도 마찬가지.
    const wall: "W" | "E" = wayOut === "W" ? "E" : "W";
    const near = nearerNS(p.anchorY, gy);
    const far: "N" | "S" = near === "N" ? "S" : "N";
    return [near, far].map((e) => ({
      exitEdge: e,
      host: { kind: "channel", depth } as LaneHost,
      wayOut,
      interval: {
        lo: Math.min(p.anchorY, edgeY(e, gy)),
        hi: Math.max(p.anchorY, edgeY(e, gy)),
      } as Interval,
      entry: { y: p.anchorY, wall },
      usesChannelTrack: true,
    }));
  };

  // ── 1순위: 옛 규칙 재현(회귀 최소) ──
  if (p.side === "N" || p.side === "S") {
    opts.push(...[selfOpt(p.side)].filter((o): o is LaneOption => !!o));
    // 막히면 채널 우회 — 옛 divertChannel: depth≥1 이면 왼쪽, 아니면 오른쪽.
    opts.push(...(p.depth >= 1 ? channelOpts("W") : channelOpts("E")));
    opts.push(...[selfOpt(p.side === "N" ? "S" : "N")].filter((o): o is LaneOption => !!o));
  } else if (p.side === "W") {
    opts.push(...[marginOpt("W")].filter((o): o is LaneOption => !!o));
    opts.push(...channelOpts("W"));
  } else {
    opts.push(...[marginOpt("E")].filter((o): o is LaneOption => !!o));
    opts.push(...channelOpts("E"));
  }

  // ── 2순위: 그래도 없거나 부족하면, 남은 모든 가능한 출구(자유도 최대화·고립 방지) ──
  // 코너 어깨 상자(face 가 N/S인데 side 가 E/W)가 여기서 구제된다 — 옛 규칙의 채널
  // 우회는 wayOuts 에 막혀 후보가 안 되고, 뚫린 face 쪽 self/margin 이 잡힌다.
  for (const e of ["N", "S"] as const) opts.push(...[selfOpt(e)].filter((o): o is LaneOption => !!o));
  for (const e of ["W", "E"] as const) opts.push(...[marginOpt(e)].filter((o): o is LaneOption => !!o));
  opts.push(...channelOpts("W"), ...channelOpts("E"));

  // 중복 제거(선호 순 보존).
  const seen = new Set<string>();
  return opts.filter((o) => {
    const k = `${o.host.kind}:${o.host.kind === "channel" ? o.host.depth : o.host.kind === "margin" ? o.host.edge : ""}:${o.exitEdge}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * exit-lane 배정. 순수·결정적. 모듈 내부를 안 본다(모듈이 답해준 `wayOuts` 만 믿는다).
 *
 * 각 상자마다 **쓸 수 있는 출구 후보**를 나열하고 `options[0]` 을 기본 확정으로 삼는다.
 * 폭/마진 수요는 **확정된 출구 하나**에서만 계산한다(후보 전부가 아니라) — 안 쓸 출구를
 * 위해 채널을 넓히던 옛 낭비가 여기서 사라진다.
 *
 * 나갈 길이 하나도 없는 상자는 **배정을 만들지 않는다** → 예약도 0, 재배치도 skip(로컬 ring
 * 유지). 못 쓸 경로를 예약해 폭만 잡아먹는 것보다 정직하다.
 */
export function planPerimeterLanes(ports: ReadonlyArray<LanePortInput>, ctx: LaneContext): LanePlan {
  const assignments: LaneAssignment[] = [];
  const channelLaneIntervals = new Map<number, Interval[]>();
  const marginNeeds = { N: false, S: false, W: false, E: false };

  // 결정적: id 오름차순.
  const sorted = [...ports].sort((a, b) => a.id.localeCompare(b.id));
  for (const p of sorted) {
    const options = enumerateOptions(p, ctx);
    if (options.length === 0) continue; // 나갈 길 없음 — 예약 0, 계획된 skip.
    const chosen = options[0];

    if (chosen.host.kind === "channel" && chosen.interval) {
      const d = chosen.host.depth;
      (channelLaneIntervals.get(d) ?? channelLaneIntervals.set(d, []).get(d)!).push(chosen.interval);
      marginNeeds[chosen.exitEdge] = true; // 상자 seat 는 N/S 마진 행.
    } else {
      marginNeeds[chosen.exitEdge] = true;
    }

    assignments.push({
      id: p.id,
      role: p.role,
      options,
      exitEdge: chosen.exitEdge,
      host: chosen.host,
      interval: chosen.interval,
      entry: chosen.entry,
    });
  }

  return { assignments, channelLaneIntervals, marginNeeds };
}
