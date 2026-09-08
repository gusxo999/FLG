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
 * ## 출구 후보 규칙 — **네 방향에 규칙 하나**([layoutRegions] 의 광선)
 *
 * 2026-09-08 이전엔 축마다 판정이 달랐다 — 세로는 `selfBlocked`(형제 모듈의 y 구간 비교),
 * 가로는 *"끝 열인가"*. **둘 다 같은 질문의 특수형**이었다:
 *
 * ```
 * 그 방향으로 광선을 쏜다
 *   그대로 바깥에 닿고 · 남의 모듈을 안 만난다  →  **직진**
 *   열 채널에서 멈춘다                        →  **환승**(그 채널 안에서 가까운 N/S 로)
 *   남의 모듈을 만난다                        →  그 방향은 후보가 아니다
 * ```
 *
 * **아직 안 보는 것** — 광선이 지나는 **통로가 비었는지**(계획서 §2.4 ③ 관통), 그리고
 * 남의 모듈에게 *"네 로컬 열이 비었나"* 를 안 묻고 **있기만 하면 막힘**으로 친다.
 * → `tempPlanDocs/두점-잇기/` Step 2b·2c.
 *
 * 좌표 주의: colX 확정 *전* 에 불린다(채널 폭이 colX 를 정하므로). **자격 판정은 좌표를
 * 아예 안 쓴다** — 광선이 순번으로 답한다. abs `y` 는 *"가까운 N/S 가 어느 쪽인가"* 라는
 * **선호 순서**에만 쓴다.
 */

import type { PortFace } from "../containerModel";
import { regionsAlong, reachesOutside, rowChannelKey, type LayoutGrid } from "./layoutRegions";

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
  /** 이 포트를 가진 **모듈**의 id — 광선이 격자에서 나를 찾는 열쇠다. */
  moduleId: string;
  /**
   * 상자의 **모듈-로컬 x**(extent 왼쪽 변 기준). 세로 직진이 설 **열**이다.
   *
   * 같은 깊이의 모듈은 전부 `colX[depth]` 에 왼쪽 정렬되므로, 이 값끼리의 비교는
   * 절대 x 로 비교한 것과 답이 같다 — 그래서 좌표 없이 판정할 수 있다.
   */
  localX: number;
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

export interface ExitContext {
  /**
   * 전역 세로 범위(모듈 union). **선호 순서에만 쓴다** — 가까운 N/S 를 고르는 데.
   * 자격 판정은 이 값을 안 본다(광선이 순번으로 답한다).
   */
  globalY: { min: number; max: number };
  maxDepth: number;
  /** 광선이 훑을 격자 — **좌표가 없다**. 순번과 깊이뿐이다([layoutRegions]). */
  grid: LayoutGrid;
  /**
   * [rowChannelKey] → 그 행 채널의 **가로 트랙이 덮는 최대 로컬 x**. 수요가 없으면 없다.
   *
   * 세로 직진이 행 채널을 **관통**할 때 밟는지 판정하는 데 쓴다(계획서 §2.4 ③).
   * 가로 트랙은 전부 *상자 → 그 열의 서쪽 변(로컬 0)* 까지 뻗으므로 구간이 `[0, x2]` 이고,
   * 그래서 **최댓값 하나**면 충분하다.
   *
   * **수요를 본다(배정이 아니라).** 배정에서 밀린 경로도 그 자리를 원했으므로,
   * 보수적으로 세는 쪽이 맞다.
   */
  rowChannelReach: ReadonlyMap<string, number>;
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

  /** 이 방향으로 나갈 때 **지나는 영역들**([layoutRegions]). 좌표를 안 쓴다. */
  const ray = (e: ExitEdge) => regionsAlong({ id: p.moduleId, depth: p.depth }, e, ctx.grid);

  /**
   * **직진** — 상자 좌표 그대로 그 변까지. 네 방향에 **같은 규칙**이다.
   *
   * 광선을 쏴서 두 가지만 본다:
   *  ① **그대로 바깥에 닿나** — 통로에서 멈추면(가로 광선이 열 채널을 만나면) 직진이 아니다.
   *     거기서 **환승**해야 나간다.
   *  ② **남의 모듈 몸통을 지나나** — 모듈은 협상 불가라 하나라도 있으면 그 방향은 끝.
   *
   * 예전엔 이 판정이 축마다 달랐다 — 세로는 `selfBlocked`(형제 모듈의 y 구간 비교),
   * 가로는 *"끝 열인가"*. **둘 다 「광선이 남의 모듈을 만나나 / 바깥에 닿나」의 특수형**
   * 이었다. 같은 답을 낸다: 세로는 순번 목록의 앞(N)/뒤(S)에 모듈이 있으면 막히는데
   * 순번 순서가 곧 `top` 순서이고(4a 누적합 + 4c 하한 복원), 가로는 끝 열이 아니면
   * 광선이 열 채널에서 멈춘다.
   *
   * **아직 안 보는 것:** 광선이 지나는 **통로**가 비었는지(계획서 §2.4 ③ 관통).
   * 그리고 남의 모듈에게 *"네 로컬 열이 비었나"* 를 묻지 않고 **있기만 하면 막힘**으로
   * 친다 — 보수적이라 뚫린 길을 버린다.
   */
  const directOpt = (e: ExitEdge): ExitOption | null => {
    if (!can(e)) return null;
    const regions = ray(e);
    if (!reachesOutside(regions)) return null;
    for (const r of regions.slice(1)) {
      // ① 남의 모듈 몸통 — 협상 불가.
      if (r.kind === "module") return null;
      // ③ **관통** — 이 통로는 가로줄을 파는데 나는 세로로 지난다. **살 게 없다.**
      //    남는 질문은 하나 — *"내가 설 그 한 열이 비었나?"*
      //    통로를 넓혀도 안 풀린다(가로줄을 더 줘도 내 세로 열은 그대로 밟힌다).
      if (r.kind === "rowChannel") {
        const reach = Math.max(
          r.above === undefined ? -1 : ctx.rowChannelReach.get(rowChannelKey(r.depth, "above", r.above)) ?? -1,
          r.below === undefined ? -1 : ctx.rowChannelReach.get(rowChannelKey(r.depth, "below", r.below)) ?? -1,
        );
        if (p.localX <= reach) return null; // 가로 트랙이 `[0, reach]` 를 덮는다 → 밟는다
      }
    }
    return { exitEdge: e, exitMode: { kind: "direct" }, wayOut: e };
  };
  const directNS = (e: "N" | "S") => directOpt(e);
  const directWE = (e: "W" | "E") => directOpt(e);

  /**
   * **환승** — 광선이 만난 열 채널을 따라 꺾어 N/S 변으로. 채널 트랙을 하나 먹는다(폭 +).
   * 모듈은 그 채널의 반대 벽에 붙으므로 진입 벽은 `wayOut` 의 반대.
   */
  const channelOpts = (wayOut: "W" | "E"): ExitOption[] => {
    if (!can(wayOut)) return [];
    const found = ray(wayOut).find((r) => r.kind === "columnChannel");
    if (!found) return []; // 끝 열 — 그쪽엔 채널이 없다(마진이다).
    const depth = found.depth;
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
