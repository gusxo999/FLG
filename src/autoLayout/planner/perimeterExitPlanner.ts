/**
 * perimeterExitPlanner — 모듈 외부상자를 전역 perimeter 로 빼는 **반출 출구 배정**
 * (조각 6-①, 순수·좌표 산정만).
 *
 * ## 모델은 하나다 — **주행선 하나를 고르고 그 축의 바깥 변까지 간다**
 *
 * ```
 * exitEdge   어느 바깥 변으로 나가나 (N·S·W·E) — **축을 이 값이 정한다**
 * exitMode   그 주행선을 **어디서 얻나**
 *              직진(direct)   후보 1개  — 상자 좌표 그대로.  늘릴 수 없다
 *              환승(channel)  후보 여럿 — 통로가 배정한다.   모자라면 채널이 넓어진다
 * ```
 *
 * 2026-09-08 이전엔 출구가 셋(`self`·`margin`·`channel`)이었는데, `self`(세로 직진)와
 * `margin`(가로 직출)은 **같은 것의 두 축**이었다 — 저장소의 어떤 소비자도 둘을 구분하지
 * 않았고(방출은 `exitEdge` 로만 축을 골랐다), `margin.edge` 는 언제나 `exitEdge` 와 같았다.
 * 합치면서 `track` 이라는 낱말도 이 파일에서 걷어냈다 — 저장소의 다른 곳에서 `track` 은
 * **통로가 배급하는 주행선 번호**를 뜻하는데 여기선 「반출 경로」를 뜻해 두 뜻이었다.
 *
 * ## 무엇을/왜
 * 모듈 파이프라인은 살아남은 외부상자(raw 입력 + 루트 출력)를 각자의 **로컬 모듈 ring**
 * 에 둔다. depth 열 타일링 후엔 그 ring 들이 조립 블루프린트의 **내부**로 들어가 상자가
 * 흩어진다. 해법은 각 상자를 **인접 gap(모듈 사이 채널 / 바깥 마진) 안의 트랙** 으로 빼
 * 가장 가까운 전역 외곽 변으로 보내는 것 — 그러려면 채널 폭 계산처럼 **트랙 공간을 패킹
 * 단계에서 미리 예약**해야 한다.
 *
 * ## 일반화 (black box)
 * 모듈 내부(클러스터 기둥/단일 머신)를 보지 않는다. 입력은 **경계 포트(어느 *변*에
 * 붙었나 + abs y) + 배치 gap 기하**뿐. exit 방향은 belt 흐름이 아니라 "어느 gap 이
 * 인접한가"에서 나온다. N/S 우세는 가로 타일링의 *결과*지 가정이 아니다.
 *
 * ## (A) 폭만 예약 — 트랙 index 는 못박지 않음
 * 채널로 들어가는 트랙은 자기 **세로 점유 구간**만 내놓고, packModuleTree 가 이를 납품 경로
 * 구간과 **합쳐** [channelPlanner.assignTracksLeftEdge] 로 트랙 수(=폭)만 산정한다. 실제
 * 몇 번째 트랙에 깔릴지는 검증된 라우터가 정한다(납품 경로와 동일 관행).
 *
 * ## 출구 후보 규칙 (포트 *변* + depth 위치)
 * - **N/S 변**: 세로 직진 → N/S 마진 행에 상자 seat. 같은 열 위/아래 형제에 막히면
 *   인접 채널로 **환승**해 그 채널 안에서 가까운 N/S 로.
 * - **W 변**: 최좌 열(depth 0)이면 가로 직진으로 바깥 W 마진. 아니면 왼쪽 채널로 환승 → 가까운 N/S.
 * - **E 변**: 최우 열(maxDepth)이면 가로 직진으로 바깥 E 마진. 아니면 오른쪽 채널로 환승 → 가까운 N/S.
 *
 * **직진의 자격을 재는 것은 두 질문뿐이다** — `wayOuts`(모듈 몸통이 막나)와 위 조건
 * (세로는 [selfBlocked], 가로는 끝 열인가). 그 직선이 지나는 **마진 행 채널**은 아직
 * 아무도 안 본다 → `tempPlanDocs/반출-환승/` 이 그 빈칸을 메운다.
 *
 * 좌표 주의: colX 확정 *전* 에 불린다(채널 폭이 colX 를 정하므로). 그래서 X 는 안 쓰고
 * abs **y** 와 depth 만으로 판정한다(납품 경로 구간 산정과 동일 관행).
 */

import type { PortFace } from "../containerModel";

export type ExitEdge = "N" | "S" | "W" | "E";

/**
 * **주행선을 어디서 얻나** — 반출의 모델은 하나다. *"주행선 하나를 고르고 그 축의 바깥 변까지
 * 간다."* 갈리는 것은 그 주행선의 **후보가 어디서 오나**뿐이다.
 *
 * ```
 * 직진(direct)   후보 **1개** — 상자 좌표 그대로.  늘릴 수 없다
 * 환승(channel)  후보 여럿    — 통로가 배정한다.   모자라면 채널이 넓어진다
 * ```
 *
 * **축은 `exitEdge` 가 이미 말한다** — N/S 면 세로 주행, W/E 면 가로 주행. 그래서 옛
 * `self`(세로 직진)와 `margin`(가로 직출)은 **같은 것의 두 축**이었고, 실제로 저장소의
 * 어떤 소비자도 둘을 구분하지 않았다(방출은 `exitEdge` 로만 축을 고른다).
 *
 * **직진은 자유도가 0이다** — 방출이 `offsets = [0]` 으로 재생하므로 옆으로 한 칸도 못
 * 비킨다. 그래서 그 한 칸이 비어 있음을 **배정이 확인해 줘야** 한다(예약 철학).
 */
export type ExitMode =
  | { kind: "direct" } // 직진 — 상자 좌표가 곧 주행선. exitEdge 가 축을 말한다
  | { kind: "channel"; depth: number }; // 환승 — 그 depth 의 열 채널이 주행선을 배정(트랙 1 소비)

/** 살아남은 외부상자 포트 하나 — 모듈 내부를 안 보는 최소 입력. */
export interface ExitPortInput {
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
export interface ExitOption {
  exitEdge: ExitEdge;
  exitMode: ExitMode;
  /** 이 출구가 모듈을 빠져나가는 방향 — 반드시 wayOuts 에 포함. */
  wayOut: PortFace;
  /** 환승일 때의 진입 벽/행(장부의 반출 경로 입력). */
  entry?: { y: number; wall: "W" | "E" };
}

/**
 * 한 레이어(depth 열)에서 **모듈 하나가 차지한** 세로 구간(abs y) — 자기-열 막힘 판정용.
 *
 * **[[용어사전#채널 (channel)|채널]]이 아니다** — 채널(행·열 둘 다)은 머신이 안 놓이는
 * *빈* 통로이고 이건 그 반대인 *점유* 구간이다. 2026-08-19 까지 `ColumnBand` 였는데,
 * 같은 `top`/`bottom` 필드로 빈칸을 담는 `RowChannel` 과 뜻이 정반대라 개명했다
 * ("Column" 도 어긋났다 — `spansByDepth` 이므로 기둥(ColumnCluster)이 아니라 레이어다).
 *
 * **높이가 아니라 위치다** — `selfBlocked` 이 `b.top < myTop` 으로 *"형제가 내 위에 있나"*
 * 를 묻는다. 크기(`bottom - top + 1`)는 아무도 안 쓴다.
 */
export interface ModuleSpan {
  id: string;
  top: number;
  bottom: number;
}

export interface ExitContext {
  /** 전역 세로 범위(모듈 union). */
  globalY: { min: number; max: number };
  maxDepth: number;
  /** depth → 그 열의 모듈 구간들. */
  spansByDepth: Map<number, ModuleSpan[]>;
}

export interface ExitAssignment {
  id: string;
  role: "input" | "output";
  /**
   * 쓸 수 있는 출구 후보들(선호 순, 전부 wayOuts 를 만족). 아래 평평한 필드
   * (exitEdge/exitMode/entry)는 **현재 확정** = 기본값 `options[0]`.
   * 장부가 제약 때문에 다른 후보로 **양보**시킬 수 있다 — 그때 확정 필드도 함께 갱신한다.
   */
  options: ExitOption[];
  exitEdge: ExitEdge;
  exitMode: ExitMode;
  /**
   * 채널 진입점 — 접점 행(anchor y) + 어느 벽에서 들어오나(W=부모 열 쪽 / E=자식 열 쪽).
   * 기하 예약(channelGeometryPlanner)의 반출 경로 입력.
   *
   * **환승이면 반드시 있다** — `channelOpts` 가 예외 없이 채운다. 그 방향으로 못 나가는
   * 포트는 환승 후보 **자체가 안 만들어진다**(`wayOut` 이 W/E 일 때만 도니까).
   */
  entry?: { y: number; wall: "W" | "E" };
  /**
   * 기하 예약이 확정한 세로 주행 열(절대 x) — modulePacking 이 배정 후 기록하고
   * ⑥C(perimeterRouter)가 스캔 없이 그대로 재생한다.
   */
  trackX?: number;
}

export interface PerimeterExitPlan {
  assignments: ExitAssignment[];
  /** 바깥/변 마진 수요. N/S = 상자 seat 행 필요 여부, W/E = 마진 열 필요 여부. */
  marginNeeds: { N: boolean; S: boolean; W: boolean; E: boolean };
}

/** N/S 중 anchor 에 더 가까운 변. */
function nearerNS(anchorY: number, gy: { min: number; max: number }): "N" | "S" {
  return anchorY - gy.min <= gy.max - anchorY ? "N" : "S";
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
  ctx: ExitContext,
): boolean {
  const spans = ctx.spansByDepth.get(depth) ?? [];
  const mine = spans.find((b) => anchorY >= b.top && anchorY <= b.bottom) ?? null;
  const myTop = mine ? mine.top : anchorY;
  const myBottom = mine ? mine.bottom : anchorY;
  for (const b of spans) {
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
function enumerateOptions(p: ExitPortInput, ctx: ExitContext): ExitOption[] {
  const gy = ctx.globalY;
  const can = (d: PortFace) => p.wayOuts.includes(d);
  const opts: ExitOption[] = [];

  /** **세로 직진** — 자기 열로 N/S 바깥 변까지. 채널 트랙 안 먹음. */
  const directNS = (e: "N" | "S"): ExitOption | null =>
    can(e) && !selfBlocked(p.depth, p.anchorY, e, ctx)
      ? { exitEdge: e, exitMode: { kind: "direct" }, wayOut: e }
      : null;

  /**
   * **가로 직진** — 자기 행으로 바깥 W/E 마진까지. 끝 열에서만 가능하다.
   *
   * 세로 직진의 **전치**다. 막는 것을 묻는 질문도 같다 — *"직진 경로에 남의 열/모듈이
   * 있나"*. 세로는 같은 열의 형제 모듈([selfBlocked])이 답하고, 가로는 **끝 열인가**가
   * 답한다(끝 열이 아니면 옆에 다른 깊이의 열이 있다).
   */
  const directWE = (e: "W" | "E"): ExitOption | null => {
    if (!can(e)) return null;
    if (e === "W" && p.depth !== 0) return null;
    if (e === "E" && p.depth !== ctx.maxDepth) return null;
    return { exitEdge: e, exitMode: { kind: "direct" }, wayOut: e };
  };

  /**
   * 인접 채널로 우회 → 채널 안에서 N/S 변으로. 채널 트랙을 하나 먹는다(폭 +).
   * wayOut=W 면 왼쪽 채널(depth), wayOut=E 면 오른쪽 채널(depth+1).
   * 모듈은 그 채널의 반대 벽에 붙으므로 진입 벽은 wayOut 의 반대.
   */
  const channelOpts = (wayOut: "W" | "E"): ExitOption[] => {
    if (!can(wayOut)) return [];
    const depth = wayOut === "W" ? p.depth : p.depth + 1;
    if (wayOut === "W" && p.depth < 1) return []; // 최좌 열의 왼쪽엔 채널이 없다(마진).
    if (wayOut === "E" && p.depth >= ctx.maxDepth) return []; // 최우 열의 오른쪽도 마찬가지.
    const wall: "W" | "E" = wayOut === "W" ? "E" : "W";
    const near = nearerNS(p.anchorY, gy);
    const far: "N" | "S" = near === "N" ? "S" : "N";
    return [near, far].map((e) => ({
      exitEdge: e,
      exitMode: { kind: "channel", depth } as ExitMode,
      wayOut,
      entry: { y: p.anchorY, wall },
    }));
  };

  // ── 1순위: 옛 규칙 재현(회귀 최소) ──
  if (p.side === "N" || p.side === "S") {
    opts.push(...[directNS(p.side)].filter((o): o is ExitOption => !!o));
    // 막히면 채널 우회 — 옛 divertChannel: depth≥1 이면 왼쪽, 아니면 오른쪽.
    opts.push(...(p.depth >= 1 ? channelOpts("W") : channelOpts("E")));
    opts.push(...[directNS(p.side === "N" ? "S" : "N")].filter((o): o is ExitOption => !!o));
  } else if (p.side === "W") {
    opts.push(...[directWE("W")].filter((o): o is ExitOption => !!o));
    opts.push(...channelOpts("W"));
  } else {
    opts.push(...[directWE("E")].filter((o): o is ExitOption => !!o));
    opts.push(...channelOpts("E"));
  }

  // ── 2순위: 그래도 없거나 부족하면, 남은 모든 가능한 출구(자유도 최대화·고립 방지) ──
  // 코너 어깨 상자(face 가 N/S인데 side 가 E/W)가 여기서 구제된다 — 옛 규칙의 채널
  // 우회는 wayOuts 에 막혀 후보가 안 되고, 뚫린 face 쪽 self/margin 이 잡힌다.
  for (const e of ["N", "S"] as const) opts.push(...[directNS(e)].filter((o): o is ExitOption => !!o));
  for (const e of ["W", "E"] as const) opts.push(...[directWE(e)].filter((o): o is ExitOption => !!o));
  opts.push(...channelOpts("W"), ...channelOpts("E"));

  // 중복 제거(선호 순 보존).
  const seen = new Set<string>();
  return opts.filter((o) => {
    // 옛 열쇠는 `margin` 의 `edge` 도 섞었는데 그 값은 **언제나 `exitEdge` 와 같아서**
    // 아무것도 더 가르지 않았다(`directWE` 가 둘 다 `e` 로 넣는다).
    const k = `${o.exitMode.kind}:${o.exitMode.kind === "channel" ? o.exitMode.depth : ""}:${o.exitEdge}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 반출 트랙 배정. 순수·결정적. 모듈 내부를 안 본다(모듈이 답해준 `wayOuts` 만 믿는다).
 *
 * 각 상자마다 **쓸 수 있는 출구 후보**를 나열하고 `options[0]` 을 기본 확정으로 삼는다.
 * 폭/마진 수요는 **확정된 출구 하나**에서만 계산한다(후보 전부가 아니라) — 안 쓸 출구를
 * 위해 채널을 넓히던 옛 낭비가 여기서 사라진다.
 *
 * 나갈 길이 하나도 없는 상자는 **배정을 만들지 않는다** → 예약도 0, 재배치도 skip(로컬 ring
 * 유지). 못 쓸 경로를 예약해 폭만 잡아먹는 것보다 정직하다.
 */
export function planPerimeterExits(ports: ReadonlyArray<ExitPortInput>, ctx: ExitContext): PerimeterExitPlan {
  const assignments: ExitAssignment[] = [];
  const marginNeeds = { N: false, S: false, W: false, E: false };

  // 결정적: id 오름차순.
  const sorted = [...ports].sort((a, b) => a.id.localeCompare(b.id));
  for (const p of sorted) {
    const options = enumerateOptions(p, ctx);
    if (options.length === 0) continue; // 나갈 길 없음 — 예약 0, 계획된 skip.
    const chosen = options[0];

    // 상자 seat 는 진출 변의 마진에 앉는다 — 직진이든 환승이든 같다.
    marginNeeds[chosen.exitEdge] = true;

    assignments.push({
      id: p.id,
      role: p.role,
      options,
      exitEdge: chosen.exitEdge,
      exitMode: chosen.exitMode,
      entry: chosen.entry,
    });
  }

  return { assignments, marginNeeds };
}
