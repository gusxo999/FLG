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
 * **직진은 여기서 장부에도 오른다.** 직진은 통로의 자리를 **안 산다**(후보가 하나뿐이라
 * 고를 게 없다) — 그런데 **선은 긋는다.** 그 선이 어디에도 없으면 두 직진이 만났을 때
 * 방출 순서로 갈리고 진 쪽 상자가 안 나간다. 그래서 확정된 직진마다 반직선([DirectRay])을
 * 등록하고, 뒤 상자의 직진 후보가 겹치면 **그 후보를 만들지 않는다**(후보 강등).
 *
 * **아직 안 보는 것** — 2홉(`tempPlanDocs/통로-갈아타기/`). 가로 광선이 열 채널에서
 * 멈추면 거기서 환승할 뿐, 그 너머 열로 **갈아타지는** 못한다.
 *
 * 좌표 주의: colX 확정 *전* 에 불린다(채널 폭이 colX 를 정하므로). **자격 판정은 좌표를
 * 아예 안 쓴다** — 광선이 순번으로 답한다. abs `y` 는 *"가까운 N/S 가 어느 쪽인가"* 라는
 * **선호 순서**에만 쓴다.
 */

import type { PortFace } from "../containerModel";
import { regionsAlong, reachesOutside, rowChannelKey, type LayoutGrid } from "./layoutRegions";
import { directRaysCross, crossCellKey, type DirectRay } from "./perimeter/directRay";

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
 * 여러 개를 후보로 들고 다니는 이유: 출구 선택은 **자유도**다. 더 까다로운 제약을 가진
 * 장부가 앞 후보를 **강등**시킬 수 있으므로, planner 가 하나로 못박지 않고 후보를 남겨
 * 장부가 고르게 한다(스도쿠: 제약 센 곳부터 — 그래서 순회도 `options.length` 순이다).
 *
 * **「양보」라고 쓰지 않는다.** 그 낱말은 *이미 잡은 주인이 비켜 주는 것*(철회·선점)을
 * 뜻하고 그건 자리마다 `owner` 가 있어야 성립한다. 여기서 일어나는 것은 **아직 확정 안 된
 * 후보를 건너뛰는 것**뿐이라 철회가 없다 — 그것이 **후보 강등**이다.
 *
 * 실제로 강등시키는 장부는 오늘 하나다 — **직진 장부**([DirectRay]). 뒤에 다른 제약이
 * 후보 강등을 요구하면 같은 자리에 붙는다.
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
  /**
   * 모듈 id → 그 모듈의 **몸통이 먹는 로컬 열**([GeneratedModule.bodyColumns]).
   *
   * 세로 직진이 남의 모듈을 만났을 때 *"네 로컬 열 c 가 비었나"* 를 묻는 자리다.
   * **모듈은 여전히 블랙박스다** — 배정기가 보는 것은 이 요약 하나뿐이고, 요약을 만드는
   * 것은 모듈 쪽이다(`fillModuleWayOuts` 가 `moduleWayOuts` 와 함께 낸다).
   *
   * 없는 모듈은 **막힌 것으로 친다** — 요약이 안 실려 오는 경로가 생기면 정확도를
   * 잃을지언정 없는 자리를 뚫지는 않는다.
   */
  moduleBodyColumns: ReadonlyMap<string, ReadonlySet<number>>;
}

export interface ExitAssignment {
  id: string;
  role: "input" | "output";
  /**
   * 쓸 수 있는 출구 후보들(선호 순, 전부 wayOuts 를 만족). 아래 평평한 필드
   * (exitEdge/exitMode/entry)가 **확정**이고, 겹치는 것이 없으면 `options[0]` 이다.
   * 직진 장부가 앞 후보를 **강등**시키면 뒤 후보가 확정된다 — 그때 이 필드들도 함께 간다.
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

/**
 * **낙선 기록** — 후보 강등이 일어난 자리 하나. **동작을 안 바꾼다**(읽기 전용 계측).
 *
 * 여기 있는 이유는 이 파일 밖이다: `tempPlanDocs/셀장부/judgements.md` 의 **J-충돌차수**
 * 는 착수 조건이 *"셋 이상이 다투는 자리가 몇 건인가"* 인데 **지금 아무도 그 수를 모른다.**
 * 이게 그 수가 처음 나오는 자리다.
 *
 * 세는 법: `cell` 로 묶는다. 같은 열쇠가 **두 번 이상** 나오면 그 자리를 셋 이상이 다툰
 * 것이다(먼저 앉은 하나 + 강등된 둘 이상). 다만 `cell` 은 **대표 칸**이지 다툰 구간
 * 전체가 아니다 — 같은 자리라도 막은 상자가 다르면 열쇠가 갈릴 수 있다([crossCellKey]).
 */
export interface ExitDemotion {
  /** 강등된 상자. */
  id: string;
  /** 그 상자가 못 쓰게 된 **직진 후보**의 진출 변. */
  droppedEdge: ExitEdge;
  /** 그 선을 이미 긋고 있던 상자 — **승자**(정책 A: 먼저 온 쪽). */
  blockedBy: string;
  /** 다툰 자리 — `깊이:로컬열,절대행`. */
  cell: string;
}

export interface PerimeterExitPlan {
  assignments: ExitAssignment[];
  /** 바깥/변 마진 수요. N/S = 상자 seat 행 필요 여부, W/E = 마진 열 필요 여부. */
  marginNeeds: { N: boolean; S: boolean; W: boolean; E: boolean };
  /** 후보 강등이 일어난 자리들 — **계측 전용**. 소비처가 없어도 정상이다. */
  demotions: ExitDemotion[];
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
 * 나중에 폭 최소화 등 다른 기준으로 재정렬해도 되고, 장부가 앞 후보를 강등시켜도 된다.
 *
 * **이 함수는 순서와 무관하다** — `regionsAlong` 이 (모듈·방향·격자)의 순수 함수라 어떤
 * 순서로 물어도 같은 목록이 나온다. 앞선 상자의 선택을 보는 것은 [planPerimeterExits]
 * 쪽이고, 그 경계가 여기 있다.
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
   *  ② **지나는 것들이 내 한 열을 비워 두나** — 남의 모듈이면 그 모듈에게 묻고,
   *     행 채널이면 가로 트랙이 거기까지 뻗는지 본다. 하나라도 밟으면 그 방향은 끝.
   *
   * 예전엔 이 판정이 축마다 달랐다 — 세로는 `selfBlocked`(형제 모듈의 y 구간 비교),
   * 가로는 *"끝 열인가"*. **둘 다 「광선이 남의 모듈을 만나나 / 바깥에 닿나」의 특수형**
   * 이었다. 같은 답을 낸다: 세로는 순번 목록의 앞(N)/뒤(S)에 모듈이 있으면 막히는데
   * 순번 순서가 곧 `top` 순서이고(4a 누적합 + 4c 하한 복원), 가로는 끝 열이 아니면
   * 광선이 열 채널에서 멈춘다.
   *
   * ①은 **블랙박스에게 묻는다** — *"네 로컬 열 c 가 비었나"*([ExitContext.moduleBodyColumns]).
   * 예전엔 *"모듈이 있기만 하면 막힘"* 으로 쳤는데, 그 보수성이 **우연히 직진 장부 노릇**을
   * 하고 있었다(2026-09-08 실측: 정확하게 만들자마자 가로 직진 6건이 방출에서 막혔다).
   * 이제 그 장부가 명시적으로 있으므로([DirectRay]) 정확도를 올릴 수 있다.
   */
  const directOpt = (e: ExitEdge): ExitOption | null => {
    if (!can(e)) return null;
    const regions = ray(e);
    if (!reachesOutside(regions)) return null;
    for (const r of regions.slice(1)) {
      // ① 남의 모듈 몸통 — **협상 불가지만 블랙박스는 아니다.** 내가 설 그 한 열이
      //    그 모듈 안에서도 비어 있으면 지나갈 수 있다. 여기서 먹는 칸은 남의 extent
      //    **안**이라 어느 통로 장부에도 안 잡히는데, 그래서 [DirectRay] 가 필요했다.
      if (r.kind === "module") {
        // 가로 광선은 남의 모듈을 만날 수 없다 — 1홉이라 첫 통로/마진에서 멈춘다
        // ([regionsAlong]). 도달 불가지만, 만나면 안전한 쪽으로 끝낸다.
        if (e === "W" || e === "E") return null;
        const cols = ctx.moduleBodyColumns.get(r.id);
        if (!cols || cols.has(p.localX)) return null;
        continue;
      }
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
 * 이 후보가 긋는 **반직선**. 환승이면 없다 — 통로가 자리를 팔고, 그 다툼은 채널 통합
 * 장부가 본다. 자리를 **안 사는** 직진만 여기 등록된다.
 *
 * 좌표계는 [DirectRay] 의 규약 그대로다 — 세로는 `line`=로컬 열/`from`=절대 행, 가로는
 * 그 반대. 둘 다 **배정 시점에 이미 있는 값**이라 `colX`·`rawBbox` 를 안 기다린다.
 */
function directRayOf(o: ExitOption, p: ExitPortInput): DirectRay | null {
  if (o.exitMode.kind !== "direct") return null;
  return o.exitEdge === "N" || o.exitEdge === "S"
    ? { depth: p.depth, axis: "V", line: p.localX, from: p.anchorY, toward: o.exitEdge }
    : { depth: p.depth, axis: "H", line: p.anchorY, from: p.localX, toward: o.exitEdge };
}

/**
 * 반출 트랙 배정. 순수·결정적. 모듈 내부를 안 본다(모듈이 답해준 `wayOuts` 만 믿는다).
 *
 * 각 상자마다 **쓸 수 있는 출구 후보**를 나열하고, 앞에서부터 **직진 장부에 안 걸리는**
 * 첫 후보를 확정한다. 폭/마진 수요는 **확정된 출구 하나**에서만 계산한다(후보 전부가
 * 아니라) — 안 쓸 출구를 위해 채널을 넓히던 옛 낭비가 여기서 사라진다.
 *
 * 나갈 길이 하나도 없는 상자는 **배정을 만들지 않는다** → 예약도 0, 재배치도 skip(로컬 ring
 * 유지). 못 쓸 경로를 예약해 폭만 잡아먹는 것보다 정직하다.
 *
 * ## **직진 장부** — 자리를 안 사는 경로도 등록은 해야 한다
 *
 * 직진은 통로의 자리를 안 산다(후보가 하나뿐이라 고를 게 없다). 그건 맞다 — 그런데
 * **선은 긋는다.** 그 선이 어디에도 없으면 두 직진이 만났을 때 **방출 순서로 갈리고**
 * 진 쪽 상자가 안 나간다(`straight blocked` → skip → 상자가 블루프린트 한복판에 남는다).
 *
 * ```
 * 옛  ① A 의 직진 확정(안 적힘) → ② B 의 직진 확정(A 를 모름) → ③ 방출에서 충돌 → **B 포기**
 * 새  ① A 의 직진 확정 + **등록** → ② B 의 후보가 겹치면 **안 만든다** → 환승이 확정된다
 * ```
 *
 * **바뀌는 것은 승자가 아니라 패자의 대가다.** *"먼저 온 쪽이 이긴다"* 는 그대로고
 * (방출에 있던 선점이 배정으로 옮겨 왔을 뿐이다), 진 쪽이 치르는 값이 *"상자가 안 나간다"*
 * 에서 *"폭이 는다"* 로 바뀐다. 그 방향은 피해 등급(머신 > 유체 > 납품 > 반출 > **폭**)이
 * 이미 정해 둔 것이다.
 *
 * > **그래서 자격이 「상태 있는 술어」가 된다.** [enumerateOptions] 자체는 여전히 순수하고
 * > 순서와 무관하지만, **어느 후보가 확정되나**는 앞선 상자의 선택에 달린다. 되먹임은
 * > 아니다 — 한 번 훑고 끝나고, 자격의 입력(순번·로컬 x·`rowChannelReach`)은 전부 배정보다
 * > 먼저 확정되며, 확정된 직진은 뒤에서 다시 안 고쳐진다.
 *
 * ## 순회는 **후보가 적은 상자부터**
 *
 * 옛 순회는 `id` 오름차순이었다. 결정적이지만 **제약과 아무 상관이 없다** — 후보가 셋인
 * 상자가 후보 하나뿐인 상자보다 먼저 골라 버린다. 스도쿠와 같은 이유로 **제약 센 곳부터**
 * 고르게 한다. 동률은 `id` 로 깨서 결정성을 지킨다.
 *
 * **결과 배열은 여전히 `id` 순이다** — 순회 순서와 출력 순서를 가른다. 뒤 단계(통합 장부의
 * 신고 순서 등)가 배열 순서에 달려 있을 수 있어, 겹치는 직진이 없으면 산출이 **한 글자도**
 * 안 바뀌게 둔다.
 */
export function planPerimeterExits(ports: ReadonlyArray<ExitPortInput>, ctx: ExitContext): PerimeterExitPlan {
  const marginNeeds = { N: false, S: false, W: false, E: false };
  const demotions: ExitDemotion[] = [];

  // 후보를 **먼저** 전부 나열한다 — 순회 순서가 후보 수에 달려 있기 때문이다.
  const cands = ports
    .map((p) => ({ p, options: enumerateOptions(p, ctx) }))
    .filter((c) => c.options.length > 0); // 나갈 길 없음 — 예약 0, 계획된 skip.

  // **제약 센 곳부터.** 후보가 하나뿐인 상자는 강등할 데가 없으니 먼저 고른다.
  const order = [...cands].sort(
    (a, b) => a.options.length - b.options.length || a.p.id.localeCompare(b.p.id),
  );

  /** 이미 그어진 직진들 — *"내가 여기 있다"* 만 담는다. 자리를 사지는 않는다. */
  const laid: { id: string; ray: DirectRay }[] = [];
  const chosenById = new Map<string, ExitOption>();

  for (const { p, options } of order) {
    let chosen: ExitOption | undefined;
    for (const o of options) {
      const ray = directRayOf(o, p);
      if (!ray) { chosen = o; break; } // 환승 — 이 장부의 소관이 아니다(통로가 판다).
      const hit = laid.find((l) => directRaysCross(ray, l.ray));
      if (!hit) { chosen = o; break; }
      demotions.push({
        id: p.id,
        droppedEdge: o.exitEdge,
        blockedBy: hit.id,
        cell: crossCellKey(ray, hit.ray),
      });
    }

    // **강등할 데가 없는 경우가 실재한다** — `channelOpts` 는 광선이 열 채널을 못 만나면
    // 빈 배열을 낸다(깊이 0 의 W · 최대 깊이의 E · `maxDepth === 0` 인 단일 열 트리).
    // 그때 후보가 직진 하나뿐이라 위 루프가 아무것도 못 고른다. 그 갈래를 안 적으면
    // **배정이 통째로 사라져 확정 skip** 이 된다 — 오늘보다 나쁘다. 그러니 오늘 그대로
    // 두고(`options[0]`) 방출에 맡긴다. 이 자리를 구제하는 것은 다른 계획의 몫이다.
    const pick = chosen ?? options[0];

    // 상자 seat 는 진출 변의 마진에 앉는다 — 직진이든 환승이든 같다.
    marginNeeds[pick.exitEdge] = true;
    chosenById.set(p.id, pick);
    // 확정된 직진은 **겹치더라도** 등록한다. 장부는 *"배정이 무엇을 그었나"* 를 말하지
    // *"방출이 성공하나"* 를 말하지 않는다 — 빼면 뒤 상자가 같은 선을 또 고른다.
    const ray = directRayOf(pick, p);
    if (ray) laid.push({ id: p.id, ray });
  }

  const assignments = [...cands]
    .sort((a, b) => a.p.id.localeCompare(b.p.id))
    .map(({ p, options }): ExitAssignment => {
      const c = chosenById.get(p.id)!;
      return { id: p.id, role: p.role, options, exitEdge: c.exitEdge, exitMode: c.exitMode, entry: c.entry };
    });

  return { assignments, marginNeeds, demotions };
}
