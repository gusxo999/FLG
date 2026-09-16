/**
 * **외곽 관심사의 타입** — 반출 출구 배정의 입력(`ExitPortInput` · `ExitContext` 와 그 격자 `LayoutGrid`)과
 * 결과(`PerimeterExitPlan` 과 그 필드들 — 배정 · 후보 · 강등과 막힘 기록).
 *
 * 배정(`perimeterExitPlanner.planPerimeterExits`)이 받고 내는 어휘이고, 읽는 쪽이 넓다 — 입력 준비(`perimeter/exits`) ·
 * 광선(`layoutRegions`) · 직진 장부(`perimeter/directRay`) · 통로(`channel/ledger` · `channel/shape`) · 트리 결과(`tree/types`) ·
 * 재생(`perimeterRouter` · `modulePerimeterPass`) · 계측(`debug/runStats`).
 *
 * **왜 배정 파일 밖인가.** 그 파일을 종류로 가르면 떼어 낸 자격 도형(`perimeter/shape`)이 이 타입을 읽는다.
 * 타입이 뼈대 파일에 남으면 조각이 뼈대를 **올려다보게** 된다. `LayoutGrid` 가 함께 온 것은 `ExitContext.grid` 의
 * 필드 타입이라서다 — 두 파일에 갈라 두면 `layoutRegions ⇄ perimeterExitPlanner` 가 타입으로 왕복했다
 * (계획 구조-2축 · 2 Step 5a, 2026-09-15 `perimeter/policy.ts` · `perimeter/shape/rays.ts` 에서 옮겼다).
 */

import type { PortFace } from "../shared/types";

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
 * **「양보」라고 쓰지 않는다.** 그 용어는 *이미 잡은 주인이 비켜 주는 것*(철회·선점)을
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

/**
 * 광선이 훑을 격자. **좌표가 하나도 없다** — 순번과 깊이뿐이다.
 *
 * 둘 다 좌표 이전 단계(`tree/arith.treeIndexOf` · `channel/ledger.rowChannelsOf`)에서 나오고 `topY` 보다 **앞**이다.
 */
export interface LayoutGrid {
  /** 깊이 → 그 열의 모듈 id 들, **위에서 아래** 순서(트리 DFS 순서 = 세로 순서). */
  orderByDepth: ReadonlyMap<number, readonly string[]>;
  /** 가장 깊은 깊이. 가로 목록의 길이를 정한다. */
  maxDepth: number;
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

/**
 * **막힌 상자** — 오늘 나갈 길이 **없는** 자리 하나. 읽기 전용 계측이라 동작을 안 바꾼다.
 *
 * 왜 따로 세나: *"행 채널 환승(`exit-ray.md` §4 의 빈칸 — 미구현)이 없어서 못 나가는 상자가
 * 몇 건인가"* 는 **[ExitDemotion] 이 원리적으로 못 센다.** 강등은 *"직진이 막혔다"* 를 세지
 * *"갈 데가 없다"* 를 안 세고, 후보가 0인 상자는 강등 루프에 **들어가기도 전에**
 * 걸러지기 때문이다([planPerimeterExits]
 * 의 `cands` 필터). 그래서 두 부류를 **여기서 따로** 센다.
 *
 * ```
 * noOption  후보가 0 — 배정 자체가 없다 → 방출이 `no exit assignment` 로 skip
 * forced    후보가 전부 강등됐는데 대안이 없어 `options[0]` 강행 → 방출에서 `straight blocked`
 * ```
 *
 * **분류가 곧 계측의 값이다.** 수 하나로는 *"무엇을 지어야 그 상자가 나가나"* 를 못 묻는다:
 * `canEnterRowChannel` 이 거짓이면 행 채널을 지어도 못 구하고(모듈 몸통이 막았다),
 * 참이면 `hops` 가 **어느 조각이 필요한지**를 말한다(끝 열 1홉 · 중간 깊이 2홉).
 */
export interface ExitBlocked {
  /** 막힌 상자. */
  id: string;
  /** 후보가 0인가(`noOption`), 전부 강등됐는데 대안이 없었나(`forced`). */
  kind: "noOption" | "forced";
  /** 그 상자가 있는 열. */
  depth: number;
  /**
   * **행 채널로 들어갈 수 있나** — `wayOuts` 에 N 이나 S 가 있나.
   * 거짓이면 행 채널 환승을 지어도 못 구한다(모듈 몸통이 막고 있으니 다른 계획의 몫).
   */
  canEnterRowChannel: boolean;
  /**
   * 행 채널을 타고 달렸을 때 **몇 홉이면 바깥인가**. `null` = 행 채널에 못 들어감.
   *
   * 끝 열(`depth 0` 의 서쪽 · `maxDepth` 의 동쪽)은 그 방향이 바깥 마진이라 **1홉**이고,
   * 중간 깊이는 옆 열 채널에서 한 번 더 갈아타야 하므로 **2홉**이다.
   */
  hops: 1 | 2 | null;
  /** 네 방향이 각각 왜 떨어졌나 — `direct:N=남의모듈(sib0) channel:W=끝열` 꼴. */
  why: string;
}

export interface PerimeterExitPlan {
  assignments: ExitAssignment[];
  /** 바깥/변 마진 수요. N/S = 상자 seat 행 필요 여부, W/E = 마진 열 필요 여부. */
  marginNeeds: { N: boolean; S: boolean; W: boolean; E: boolean };
  /** 후보 강등이 일어난 자리들 — **계측 전용**. 소비처가 없어도 정상이다. */
  demotions: ExitDemotion[];
  /** 나갈 길이 없는 상자들 — **계측 전용**. 빈 배열이 정상이고, 그게 곧 답이다. */
  blocked: ExitBlocked[];
  /**
   * **위험군** — 모듈이 W·E 를 **둘 다** 막은 반출 포트 수. 계측 전용.
   *
   * `blocked` 가 0 일 때 *"왜 0인가"* 를 가르는 수다. W 나 E 중 하나만 열려 있으면
   * 중간 깊이 상자는 **언제나** 열 채널 환승 후보를 둘 받고(`channelOpts`), 끝 열 상자는
   * 가로 직진을 받는다 — 즉 **막히려면 먼저 이 조건을 통과해야** 한다.
   *
   * 그래서 `noSideWayOut === 0` 이면 막힘 0 은 *"운이 좋았다"* 가 아니라 **구조적**이고,
   * `> 0` 인데 막힘이 0 이면 그 포트들은 N/S 직진으로 나간 것이다.
   */
  noSideWayOut: number;
}
