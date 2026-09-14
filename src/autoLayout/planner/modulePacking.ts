import type { SpecInserter } from "../buildSpec";
﻿/**
 * modulePacking — 모듈 트리를 좌우 계층형으로 패킹한다 (조각 3, 순수·무배선).
 *
 * 단일 출처: 본 설계안(클러스터 모듈화 — 합성/패킹).
 *
 * 각 노드를 [clusterModule.generateModule] 로 부모-무시 생성한다. 방위는 **생성 단계에서
 * 면=역할로 확정**(출력→W=부모, 입력→E=자식, (B) 정책 넘침은 잔여 면)되므로 D4 사후 회전
 * 없이 항등 방위를 쓴다. 그다음 depth 열 × **tidy-tree(RT) 세로 배치**(부모를 자식들 중앙에)로
 * 배치하고, 부모↔자식 입력 포트를 품목 매칭해 납품 경로 스펙을 낸다.
 *
 * ## 변(side) vs face
 * generateModule 은 포트 `face` 를 트렁크 *축* 방향으로 준다(예: N 깊이를 수평으로 달리는
 * 트렁크의 chest 는 face='W'일 수 있다). 좌우 트리에서 의미 있는 건 포트가 클러스터의
 * **어느 변**(W/E/N/S)에 붙었나이며, 그 단일 출처는 planner 슬롯(`meta.side`)이다 —
 * anchor↔bbox 기하 추측(X변 우선)은 N/S 깊이의 코너 어깨 chest 를 오분류해 폐기했다.
 * face 정의는 불변.
 *
 * 무배선 — 라이브 회귀 0. 단위 테스트 + 전체 트리 ASCII 로만 검증.
 */

import { channelWidthFromTracks, type Interval } from "./channelPlanner";
import { laneCapOfTier } from "../beltThroughput";
import { planRowChannel, ROW_CHANNEL_MIN, type RowCrossing } from "./rowChannelPlanner";
import {
  planChannelGeometry,
  type ChannelGeometryPlan,
  type DeliveryInput,
  type ExportInput,
} from "./channelGeometryPlanner";
import { generateModule } from "../module/clusterModule";
import type { IoLine, Link } from "../module/types/line";
import type { GeneratedModule, ModuleInput, ModulePort } from "../module/types/module";
import type { DepthShortage, LinkFacePlan, LinkFaceStage } from "../module/types/seat";
import { planLinkFaces } from "./module/planModulePorts";
import { seatLinkEdge } from "./module/policy";
import { cloneLinkFaceStage } from "./module/ledger";
import { clusterBeltDepthsOf } from "./module/arith";
import { linkDepthNeed, type LinkDepthNeed } from "./module/depthBudget";
// link 관심사 — 두 모듈의 식별자를 아는 계산(신원 생성·간선 링크 유도·포트 짝짓기).
import { deliveryKey, pairDeliveryPorts, edgeLinkGroups } from "./link/edgeLinks";
import { summarizeBeltForms, shareLanes } from "../module/link";
import { AUTO_LAYOUT_LINK_LADDER, AUTO_LAYOUT_LANE_MERGE, AUTO_LAYOUT_LINK_DIRECT } from "../debugFlags";
// perimeter 관심사 — 전역 외곽으로 나갈 길의 입력 준비(프레임 확장·반출 대상 포트 수집).
import { planExits, expandBbox } from "./perimeter/exits";
import { rowChannelKey } from "./layoutRegions";
import type { PerimeterExitPlan } from "./perimeterExitPlanner";
import { segment , PERIMETER_MARGIN } from "../util/helper";
import { moduleExtent, shiftModule, type Orientation } from "../module/moduleTransform";
import { AUTO_LAYOUT_COORD_DUMP } from "../debugFlags";
import { recordBeltFormStats, recordFaceDepthStats, recordLaneShareStats } from "../../debug/runStats";

// 조율자를 단일 창구로 유지하기 위한 재수출 — 소비처(테스트·deliveryRoute·moduleWizard·
// modulePerimeterPass)는 "배치 결과를 다루는 것"이라 `modulePacking` 에서 가져오는 편이
// 자연스럽다. 정의의 소유자는 각각 `link/edgeLinks` 와 `module/moduleTransform` 이다.
export { deliveryKey, edgeFlows, edgeLinkGroups } from "./link/edgeLinks";
export { moduleExtent } from "../module/moduleTransform";

/** 채널 폭 하한(셀). 단일 납품 경로(트랙 1)도 이 폭은 확보 — 옛 COLUMN_GAP 동치(좁아지지 않음). */
const MODULE_CHANNEL_MIN = 4;

/**
 * **행 채널 하나** — 같은 깊이에서 세로로 이웃한 두 모듈 사이의 빈 가로 통로.
 *
 * [[용어사전#행 채널 (row channel)|행 채널]] 은 [[용어사전#채널 (channel)|채널]]의 직교
 * 짝이다. 채널이 세로로 뻗어 좌우 **깊이**를 가르면, 행 채널은 가로로 뻗어 상하 **모듈 행**을
 * 가른다. → `docs/auto-layout/common/layout-models.md` §2⑤
 *
 * `top`/`bottom` 은 **빈 칸 범위**(양 끝 모듈에 안 물린다). `top > bottom` 인 행 채널은 안 만든다 —
 * 겹침 스윕이 두 모듈을 붙여 놓은 경우다.
 *
 * **`ROW_GAP`(기둥 *안* 머신 간격)과 다르다** — 이건 모듈 *사이* 간격이다.
 */
export interface RowChannel {
  /** 이 행 채널이 속한 깊이(열). */
  depth: number;
  /** 그 깊이에서 위에서 몇 번째 행 채널인가(0부터). */
  index: number;
  /** 행 채널의 첫 행(위 모듈 바로 아래). */
  top: number;
  /** 행 채널의 마지막 행(아래 모듈 바로 위). */
  bottom: number;
  /**
   * **행 채널의 종류** — 마진도 행 채널이다(2026-08-18 실측: 통과 수요 3건 중 2건이 행 채널 없는 깊이였다).
   *
   * ```
   * between   같은 깊이의 두 모듈 **사이**.  above·below 가 둘 다 있다
   * marginN   그 깊이 **맨 위** 모듈의 북쪽 바깥.  below 만 있다
   * marginS   그 깊이 **맨 아래** 모듈의 남쪽 바깥.  above 만 있다
   * ```
   *
   * 마진을 별개 개념으로 두지 않는 이유: **트랙 배정이 똑같이 필요하다.** 같은 마진으로
   * 나가는 경로가 여럿이면 행을 다툰다(2026-08-18 실험2 가 보였다).
   */
  kind: "between" | "marginN" | "marginS";
  /** 위 모듈 id. `marginN` 이면 없다. */
  above?: string;
  /** 아래 모듈 id. `marginS` 이면 없다. */
  below?: string;
  /**
   * 이 행 채널의 **높이** — 통과 경로에서 유도된다(폭 역전, [planRowChannel]).
   *
   * 2026-09-06 이전엔 `wantHeight` 라는 이름이었고 *"수요대로면 얼마여야 하나"* 를 **보고만**
   * 했다. 실제 높이는 `STACK_GAP` 상수가 정했고, 둘이 갈리면 그만큼 행 채널이 모자랐다.
   * 이제 이 값이 **모듈 사이 간격을 정한다** — 갈릴 수가 없다.
   */
  height: number;
  /**
   * 이 행 채널을 지나는 경로 id → **트랙 index**(행 채널 안의 몇 번째 행). 수요가 없으면 없다.
   * 실제 y 는 `top + track` 이다 — 폭이 확정된 뒤에.
   */
  tracks?: ReadonlyMap<string, number>;
}

/** 한 노드의 패킹 입력 — recipe 에서 유도. */
export interface NodeSpec {
  id: string;
  depth: number;
  parentId?: string;
  machine: { entityName: string; w: number; h: number };
  count: number;
  /** ingredients=input, products=output. */
  lines: IoLine[];
  /**
   * [트렁크 파이프](../../../../docs/auto-layout/module/trunk-pipe.md) 계획 — 유체 줄이
   * 있는 노드만. 머신 회전 각도 + 파이프가 달릴 면. `fluid_boxes` 를 봐야 알 수 있어서
   * 게임데이터에 닿는 `run/gamedata` 가 계산해 넣는다.
   */
  fluidTrunk?: ModuleInput["fluidTrunk"];
  /**
   * [Parallel Inserting](../../../../docs/용어사전.md#parallel-inserting) 용량 — 줄별 클러스터
   * rate(items/sec) + 탭(인서터) 처리량. 게임데이터(레시피 시간·머신 속도)를 보는 `run/gamedata` 가
   * 계산해 넣는다(module/ 는 순수). 미지정이면 탭 1개(휴면).
   */
  supplyCapacity?: ModuleInput["supplyCapacity"];
}

export interface PackConfig {
  inserterEntityName: string;
  beltEntityName: string;
  /**
   * 고를 수 있는 벨트 전부([BuildSpec.belts](../buildSpec.ts)) — 수요가 벨트 한 줄을 넘을 때
   * [determineBeltCount] 가 티어를 골라 **줄을 늘린다**. 미지정이면 줄을 안 늘린다(옛 동작:
   * 거절 → 다이렉트).
   */
  belts?: ModuleInput["belts"];
  /**
   * 고를 수 있는 지하벨트 전부([BuildSpec.undergroundBelts](../buildSpec.ts)) — 모듈이
   * **벨트 종착**([resolveBeltTermini](../execution/module/beltTerminus.ts))에 쓴다.
   * `belts` 와 같은 자리(전역 선택)다.
   */
  undergroundBelts?: ModuleInput["undergroundBelts"];
  /** **고른 인서터 전부** — reach 별 하나씩. `belts` 와 같은 자리(전역 선택)다(`docs/용어사전.md §BuildSpec`). */
  inserters: SpecInserter[];
  /**
   * 외부상자 perimeter **반출 트랙** 예약을 켠다(조각 6-①). true 면 채널 폭이 납품 경로 구간에
   * 더해 트랙 세로 구간까지 반영해 넓어지고 bbox 에 N/S/W/E 마진 프레임이 붙는다.
   * 미지정=off(현행 유지) — 골든/단위 테스트 회귀 0. moduleWizard 가 플래그로 전달.
   */
  reservePerimeterExits?: boolean;
  /**
   * 지하벨트 점프 거리 상한 — 장부가 **납품끼리의 교차**를 지하로 계획할 때 쓴다
   * ([channelGeometryPlanner.GeometryContext.maxJump]). 0/미지정 = 지하 불가 → 교차하는
   * 납품은 fallback(dijkstra). [deliveryRoute.DeliveryConfig] 에 넘기는 값과 **같아야** 한다 —
   * 어긋나면 장부가 계획한 점프를 방출기가 거부하고 조용히 dijkstra 로 샌다.
   */
  beltMaxUndergroundDistance?: number;
}

/** 한 노드의 최종 배치 — 절대 좌표로 옮겨진 모듈 + 적용된 방위·이동량. */
export interface ModulePlacement {
  id: string;
  module: GeneratedModule; // 절대 좌표(공유 좌표계)
  orientation: Orientation;
  origin: { x: number; y: number }; // extent 좌상단이 놓인 절대 위치
}

/** 자식 출력 포트 → 부모 입력 포트 (조각 4가 belt-to-belt 라우팅). 절대 좌표. */
export interface DeliverySpec {
  item: string;
  from: ModulePort; // 자식 출력
  to: ModulePort; // 부모 입력
  /** 자식 모듈 id(출력 측 owner). Routing from.containerId 유도용. */
  fromId: string;
  /** 부모 모듈 id(입력 측 owner). Routing to.containerId 유도용. */
  toId: string;
  /**
   * 같은 (from,to,item) 짝들 사이의 index — **신원 없는(옛 탭/다이렉트) 납품 경로만** 쓴다.
   * 포트가 물리적으로 교환 가능해 위치가 곧 정답이라 정직한 값이다. `linkId` 가 있으면
   * 이 값은 무시된다(신원이 있는데 위치로 다시 구분할 이유가 없다) — [deliveryKey] 참고.
   */
  seq: number;
  /**
   * **링크 그룹 신원**([ModulePort.linkId] 의 사본, `from`/`to` 양쪽이 같은 값이라야 짝이
   * 성립했으므로 어느 쪽에서 가져와도 같다). 있으면 [deliveryKey] 가 이 값을 채널 예약 키로
   * 그대로 쓴다 — `seq` 처럼 "성공한 짝 배열의 몇 번째"가 아니라 **그 벨트 자체의 신원**이라
   * 형제 납품 경로가 실패해도 이 값은 안 흔들린다(2026-07-21, seq 의 마지막 남은 위치-의존 제거).
   */
  linkId?: string;
}

/** 납품 경로의 결정적 방출 지시(절대 좌표) — 통합 장부의 배정을 트랙 index→x 로 변환한 것. */
/**
 * **행 채널 접근** — 포트가 기둥 끝이라 세로 채널 벽을 직접 못 마주 볼 때, 그 끝이 행 채널에서
 * 달리는 구간. `row` 가 곧 세로 채널에 넘기는 **진입 행**이다.
 *
 * (E) 결정에 따라 이 구간은 **자기 깊이 열 안에서만** 달린다 — 세로 채널을 안 가로지르므로
 * 교차로가 없다.
 */
/**
 * **행 채널 진입점** — 상자에서 행 채널로 갈아타는 지점.
 *
 * 포트 상자가 [[용어사전#기둥 (column)|기둥]] 끝(N/S)에 있으면 세로 채널 벽을 **직접 마주
 * 보지 않는다**. 계단꼴은 "벽에서 출발"을 전제하므로 그대로는 못 그린다. 그래서 상자에서
 * 이 `row` 까지 **세로로 먼저** 간 뒤, 거기서부터 평소의 계단꼴을 그린다 — 갈아탄 뒤엔
 * 출처가 구별되지 않아서 세로 채널은 `startY` 가 어디서 왔는지 안 묻는다.
 *
 * 세로 채널 쪽 거울은 `perimeterExitPlanner.ExitOption.entry`(채널 진입점)다.
 */
export interface RowChannelEntry {
  /** 배정된 트랙의 **절대 행**. 세로 채널의 `startY`/`endY` 가 이 값이 된다. */
  row: number;
}

export type DeliveryGeometry =
  | { kind: "straight" }
  | { kind: "staircase"; trackX: number }
  | {
      /**
       * **되꺾기 — 계단꼴의 전치(轉置)다.** 계단꼴이 *가로→세로(트랙)→가로* 라면 이쪽은
       * *세로→가로(랩 행)→세로* 다. 모양이 하나 더 는 게 아니라 **축이 바뀐 같은 모양**이다.
       *
       * 왜 필요한가 — 계단꼴은 *"자식 출력 W변 → 채널 → 부모 입력 E변"*, 즉 **둘 다 채널을
       * 마주 본다**를 전제한다([eligible]). 부모 입력이 반대 면(W)으로 스필하면 그 전제가
       * 깨지고, 여태 이 납품은 장부에서 빠져 dijkstra 가 맡았다 — 그리고 그 폴백은 남의
       * 예약을 밟아 연쇄했다(2026-08-17 실측: 완제품 상자가 갇혔다).
       *
       * 스필은 이제 드문 예외가 아니다. 아이템 방출이 링크 경로로 합쳐지며 관통 트렁크가
       * 깊이를 통째로 먹자 W 스필이 흔해졌다. **모델이 따라가는 것이 맞다** — 우회 자체는
       * 남지만 *계획된* 우회가 되어 남의 자리를 안 밟는다.
       *
       * 모양은 **ㄱ자** 하나다: *자기 행을 따라 가로로* → *목표 열에서 세로로*. 세로부터
       * 올라가는 변형도 만들어 봤는데 자기 모듈의 다른 포트 열을 뚫었다(실측 `모듈 몸통
       * (19,6)`) — 상자는 면 위에 있어 **자기 열은 늘 붐비고 자기 행은 대개 비어 있다**.
       *
       * 막혀 있으면 [plannedChainClear] 가 걸러 오늘과 같은 폴백으로 떨어진다(더 나빠지지 않는다).
       */
      kind: "wrapAround";
    }
  | { kind: "columnSwitch"; startTrackX: number; switchY: number; endTrackX: number }
  | {
      /** 계단꼴 + 지하 점프들. 각 점프는 (from)에서 (to)까지 그 사이 셀 **밑으로** 건넌다. */
      kind: "undergroundCrossing";
      trackX: number;
      jumps: { from: { x: number; y: number }; to: { x: number; y: number } }[];
    };

/**
 * 납품 하나의 방출 지시 = **도형 + 행 채널 진입**.
 *
 * 도형은 세로 채널의 일이고(계단꼴 등), 진입은 행 채널의 일이다. 둘이 한 자료형에
 * 실리되 **서로를 안 본다** — 세로 채널은 진입 행만 받고 그게 어디서 왔는지 안 묻는다
 * (2026-08-18 Step 0 확인: `startY` 의 출처를 안 가린다).
 */
export type DeliveryDirective = DeliveryGeometry & {
  /** 자식 쪽 끝이 행 채널에서 온다면 그 진입점. 포트가 채널 벽을 직접 마주 보면 없다. */
  fromRowChannel?: RowChannelEntry;
  /** 부모 쪽 끝이 행 채널로 나간다면 그 진입점. */
  toRowChannel?: RowChannelEntry;
};

/** 채널 기하 예약 결과 — deliveryRoute(납품 방출)·modulePerimeterPass(반출 재생)가 소비. */
export interface PackChannelGeometry {
  /** [deliveryKey] → 방출 지시. 없는 납품 경로 = fallback(기존 dijkstra). */
  deliveries: Map<string, DeliveryDirective>;
  /** 반출 경로 예약 셀(절대 cellKey) — 폴백 dijkstra 납품 경로가 침범하면 안 되는 자리. */
  reservedExportCells: Set<string>;
  /**
   * **장부에 못 들어간 납품 경로와 그 사유** — `deliveries` 에 없는 것들의 이유다.
   *
   * `not-eligible` 이 특히 조용했다: [eligible] 은 *"계단꼴 모델이 전제하는 기하인가"* 인데
   * (자식 출력 W변 · 부모 입력 E변 · 깊이 인접 — 2026-07-11 도입 주석), 그 전제를 못 맞춘
   * 납품은 **루프 첫 줄에서 걸러져 `계획 포기` 로그조차 안 찍혔다.** 흔적이 0이라
   * 2026-08-17 조사에서 게이트·배선을 헛짚었다.
   *
   * 도입 당시엔 스필이 드문 예외라 견딜 만했다. 아이템 방출이 링크 경로로 합쳐지면서
   * 관통 트렁크가 깊이를 통째로 먹자 **W 스필이 흔해졌고**, 그 폴백(dijkstra)은 남의 예약을
   * 밟아 연쇄한다 — 조용하면 안 되는 수가 됐다.
   */
  skips: { key: string; reason: string }[];
}

export interface PackResult {
  placements: ModulePlacement[];
  deliveries: DeliverySpec[];
  /** child 없는 입력 포트 — raw(무한상자 유지). 절대 좌표. */
  rawPorts: ModulePort[];
  bbox: { x: number; y: number; w: number; h: number };
  /** 외부상자 perimeter 반출 트랙 배정(조각 6-①). ②③(재배치·라우팅)이 소비. */
  exitPlan: PerimeterExitPlan;
  /**
   * 채널 기하 예약(통합 장부) — **언제나 있다.**
   *
   * 2026-09-08 까지 `config.channelGeometry` 스위치가 있어 끄면 *"폭만 예약 + 탐색"* 인
   * 옛 모델로 돌아갔다. **그 세계에는 「경로 예약」이 없다**(폭만 예약한다) — 그래서
   * *"예약된 경로는 항상 방출 가능"* 이라는 이 저장소의 철학이 아예 성립하지 않았다.
   * 두 모델을 함께 이고 갈 값이 없어 지웠다.
   */
  channelGeometry: PackChannelGeometry;
  /**
   * **링크 신원 불일치** — 자식이 `linkId` 를 선언한 그룹을 냈는데 부모 쪽에서 짝을 못 찾은
   * 경우([pairDeliveryPorts]). 정상적으로 있을 수 있는 일이 **아니다**: 신원은 자식·부모가 같은
   * [edgeLinkGroups] 를 독립으로 돌려 나온 값이라 원래는 항상 일치해야 한다. 여기 항목이
   * 있으면 예약 불변식이 깨진 것 — 조사 대상이지 정상 경로가 아니다. 비어 있으면 `[]`.
   */
  linkMismatches: string[];
  /**
   * **행 채널들** — 같은 깊이의 이웃 모듈 사이 빈 가로 통로(Step 1).
   *
   * 아직 **자리만** 낸다. 트랙 배정·폭 역전은 후속이다
   * 소비처가 생기기 전이라도 `flg.report()` 가 읽어
   * **행 채널이 실제로 몇 개 나는지**를 실측할 수 있게 여기 싣는다.
   */
  rowChannels: RowChannel[];
  /**
   * **행 채널을 지나야 하는 경로 끝** — 포트가 기둥 끝이라 세로 채널 벽을 직접 못 마주 보는 것.
   *
   * 이 수가 **0이면 행 채널이 그 트리에 필요 없다**. 0이 아니면 Step 3 이 값을 낸다.
   * 진단(`flg.report()`)이 이 수를 읽어 착수 근거로 쓴다.
   */
  rowChannelNeeds: ReadonlyArray<{ id: string; nodeId: string; depth: number; portY: number; face: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

export function packModuleTree(specs: NodeSpec[], config: PackConfig): PackResult {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const childIdsByParent = new Map<string, string[]>();
  for (const s of specs) {
    if (!s.parentId) continue;
    (childIdsByParent.get(s.parentId) ?? childIdsByParent.set(s.parentId, []).get(s.parentId)!).push(s.id);
  }
  /**
   * 노드가 **부모에게 실제로 넘기는** 품목.
   *
   * 예전엔 첫 출력 라인을 그냥 집었다. 산출물이 하나뿐인 레시피에선 맞지만 **다산출
   * 레시피에선 엉뚱한 걸 집는다** — `empty-sulfuric-acid-barrel` 은 `barrel + sulfuric-acid`
   * 를 내는데 배열 순서상 `barrel` 이 잡혀, 부모(battery)에게서 "barrel 입력"을 찾다
   * 실패했다. 그러면 [pairDeliveryPorts] 가 짝을 못 만들어 **납품 경로가 0개**가 되고, 자식의 산
   * 출력과 부모의 산 입력이 **각각 외부 포트로** 떨어진다. 실측에서는 그 둘이 나란히
   * 붙어 한 관망이 됐다 — 한쪽은 "항상 가득"(at-least 1), 다른 쪽은 "항상 비움"(at-most 0)
   * 인 무한파이프 두 개가 같은 네트워크에(2026-07-26 브라우저 실측).
   *
   * 그래서 **부모가 먹는 것**으로 고른다. 나머지 산출물은 부산물이라 외부로 나간다.
   */
  const productOf = (s: NodeSpec): string | undefined => {
    const outs = s.lines.filter((l) => l.role === "output");
    if (outs.length === 0) return undefined;
    const parent = s.parentId ? byId.get(s.parentId) : undefined;
    if (parent) {
      const wanted = new Set(
        parent.lines.filter((l) => l.role === "input").map((l) => l.name),
      );
      const match = outs.find((o) => wanted.has(o.name));
      if (match) return match.name;
    }
    // 부모가 없거나(루트) 겹치는 게 없으면 옛 동작 — 없는 답을 지어내지 않는다.
    return outs[0].name;
  };
  /** 부모 입력 중 자식-공급인 품목 집합. */
  const childFedItems = (s: NodeSpec): Set<string> => {
    const set = new Set<string>();
    for (const cid of childIdsByParent.get(s.id) ?? []) {
      const p = productOf(byId.get(cid)!);
      if (p) set.add(p);
    }
    return set;
  };

  // 노출 끝면(N/S) — count=1 완화의 노출 판정. 세로 순서는 tidy-tree 가 DFS 방문
  // 순서를 보존하므로(형제 재배열 없음) 좌표 확정 *전에* 열-내 서열로 유도할 수 있다
  // (스도쿠 닻: 트리 구조가 외생). 열의 첫 모듈 위(N)·마지막 모듈 아래(S)는 전역
  // 마진뿐 — 그 방향 깊이가 형제와 충돌하지 않는다.
  const dfsByDepth = new Map<number, string[]>();
  const dfsVisit = (id: string) => {
    const s = byId.get(id)!;
    (dfsByDepth.get(s.depth) ?? dfsByDepth.set(s.depth, []).get(s.depth)!).push(id);
    for (const cid of childIdsByParent.get(id) ?? []) dfsVisit(cid);
  };
  for (const s of specs) if (!s.parentId) dfsVisit(s.id);
  const nsExposureOf = (s: NodeSpec): ("N" | "S")[] | undefined => {
    if (s.count !== 1) return undefined; // 기둥(count≥2)은 N/S 깊이가 끝 머신만 서빙 — 제외.
    const col = dfsByDepth.get(s.depth)!;
    const faces: ("N" | "S")[] = [];
    if (col[0] === s.id) faces.push("N");
    if (col[col.length - 1] === s.id) faces.push("S");
    return faces.length ? faces : undefined;
  };

  // 면=역할은 생성 단계에서 확정되므로 사후 회전 없이 항등 방위.
  const IDENTITY: Orientation = { rotation: 0, reflect: false };

  // 간선당 [edgeLinkGroups] 를 **한 번만** 계산해 자식 id 로 캐시한다(간선 = 자식→부모,
  // 자식 하나는 출력 품목이 하나뿐이므로 childId 만으로 간선이 유일하게 식별된다).
  // 자식 쪽(outputLinksOf)과 부모 쪽(inputLinksOf)이 예전엔 이 계산을 각자 독립으로
  // 두 번 돌려 "결정적 함수+같은 입력이면 같은 출력"이라는 결정성만 믿고 일치를 기대했다
  // (2026-07-21 이전) — 이제 한 번 계산된 같은 객체를 양쪽이 그대로 참조한다.
  /**
   * **형제 순번이 끝을 정한다** — 좌표 없이.
   *
   * `layoutY` 는 자식을 **배열 순서대로 위 → 아래**로 놓고, 부모를 **첫·마지막의 중점**에
   * 둔다(`:489-501`). 그래서 좌표를 몰라도 이것만은 확정이다:
   *
   * ```
   * 앞쪽 형제 → 부모보다 위    → 자식은 **아래 끝**으로 나가고 부모는 **위 끝**에서 받는다
   * 뒤쪽 형제 → 부모보다 아래  → 자식은 **위 끝**,           부모는 **아래 끝**
   * ```
   *
   * **거리가 아니라 교차를 노린다.** *"가장 가까운 끝"* 은 두 기둥의 **모서리**(= topY + 높이)를
   * 알아야 하고, 높이는 `gen` 이 준다 — 그 목표를 지키는 한 `gen → 높이 → 끝 → gen` 이
   * 반드시 닫힌다(**되먹임 A**). 순서만 보면 고리가 없다.
   *
   * 가운데 형제는 부모 중심의 어느 쪽인지 **트리로 못 가른다**(간격 = 높이에 달렸다).
   * 그래도 **절반으로 갈라 두면 서로 안 교차한다** — 위 절반은 부모 위 끝, 아래 절반은
   * 아래 끝. 전부 한 끝으로 몰면 그 줄들이 서로를 건넌다.
   *
   * 형제가 하나뿐이면 부모가 그 위에 겹쳐 있어 선호가 없다 → `undefined`.
   */
  const siblingHalf = (s: NodeSpec): "top" | "bottom" | undefined => {
    if (!s.parentId) return undefined;
    const kids = childIdsByParent.get(s.parentId) ?? [];
    if (kids.length < 2) return undefined;
    const i = kids.indexOf(s.id);
    return i < kids.length / 2 ? "top" : "bottom";
  };

  /**
   * **트렁크 줄의 끝 선호** — 링크와 **같은 규칙**을 쓴다(`min` = 위끝 · `max` = 아래끝).
   *
   * 예전엔 tidy-tree 뒤에서 |Δy| 최소 조합으로 골랐고, 그 값이 `gen` 의 입력으로 돌아가
   * **2차 생성**을 불렀다(되먹임 A). 형제 순번으로 정하면 `gen` 보다 **앞**에서 확정되므로
   * 고리가 열린다. 대가는 거리 최적화를 버린 것이고, 대신 **교차가 없다**.
   */
  const lineEndsById = new Map<string, Map<string, "min" | "max">>();
  {
    const setEnd = (id: string, key: string, end: "min" | "max") => {
      (lineEndsById.get(id) ?? lineEndsById.set(id, new Map()).get(id)!).set(key, end);
    };
    for (const s of specs) {
      if (!s.parentId) continue;
      const product = productOf(s);
      if (!product) continue;
      const half = siblingHalf(s);
      if (!half) continue; // 형제가 하나뿐 — 선호가 없다. 방출의 기본값(`min`)을 쓴다
      setEnd(s.id, `output:${product}`, half === "top" ? "max" : "min");
      setEnd(s.parentId, `input:${product}`, half === "top" ? "min" : "max");
    }
  }

  /** 링크가 들 끝 — 자식 쪽·부모 쪽이 서로 반대다. */
  const linkEndOf = (s: NodeSpec): Link["end"] => {
    const half = siblingHalf(s);
    if (!half) return undefined;
    return half === "top" ? { from: "S", to: "N" } : { from: "N", to: "S" };
  };

  const linkCache = new Map<string, Link[]>();
  for (const s of specs) {
    if (!s.parentId) continue;
    const product = productOf(s);
    if (!product) continue;
    const groups = edgeLinkGroups(s, byId.get(s.parentId)!, product, config);
    // **끝은 여기서 얹는다** — `id` 와 같은 자리, 같은 규칙(위층이 채우고 module/ 은 안 만든다).
    const end = linkEndOf(s);
    if (groups) linkCache.set(s.id, end ? groups.map((g) => ({ ...g, end })) : groups);
  }

  // ── 레인 공유 짝짓기 ───────────────────────────────────────────────────────
  //
  // **줄 둘을 한 물리 벨트의 좌/우 레인에 하나씩** 싣는다
  // (`docs/factorio/belt-lane-semantics.md` · `tempPlanDocs/벨트-레인/`).
  //
  // ## 무엇을 되찾나
  // 인서터는 먼 레인 하나에만 떨구므로 **줄 하나는 벨트의 절반만 쓴다.** 그래서 45/s 수요는
  // [determineBeltCount] 가 줄 **둘**로 낸다. 합류시키면 벨트가 하나로 돌아온다 —
  // **처리량은 안 늘고 물리 벨트 수가 준다.**
  //
  // ## 후보 = **같은 간선의 두 줄** (v1 = 같은 품목)
  // `linkCache` 의 한 항목이 곧 간선 하나(자식→부모, 품목 하나)이고, 그 안에 줄이 여럿이면
  // 그것이 곧 *"수요가 레인 하나를 넘어 갈린 줄들"* 이다. 그 둘이 짝의 자연스러운 단위다.
  //
  // **기하가 공짜로 성립한다** — 관통 줄은 기둥 끝에 포트를 세우는데(`LinkFacePlan.portEnd`),
  // 그 끝은 면마다 장부(`ctx.ends`)로 관리돼 **먼저 앉은 줄이 N 을 잡으면 다음 줄은 S** 를
  // 잡는다. 즉 같은 간선의 두 줄은 기둥의 **위·아래 끝**에서 나가고, 채널에서 그 둘의 세로
  // 주행은 도착 행에 **양옆으로** 닿는다 → 유입이 둘 다 옆이라 **둘 다 접힌다**(각자 한 레인).
  // 같은 쪽에서 오면 위쪽이 아래쪽의 **뒤 유입**이 되어 아래쪽이 조용히 굶는다(규칙 ⑤⑦).
  //
  // **같은 품목이라 필터가 필요 없다** — 집는 팔이 뭘 집든 같은 품목이다(승인 Q1).
  //
  // **[AUTO_LAYOUT_LANE_MERGE] 가 꺼져 있으면 아무 줄에도 안 붙는다** — 아래 모든 갈래가
  // 도달 불가가 되어 **오늘 동작 그대로**다(미완성 기능의 관용구).
  //
  // **배정([allocateTree]) 앞이라야 한다** — 배정이 공유를 보고 부모 면에서 한 벨트를
  // 잡기 때문이다. 배정이 줄을 쪼개면 그 토막은 더 이상 같은 줄이 아니므로
  // [splitLinkAtRows] 가 표시를 **떼어 낸다**.
  // **꺼져 있어도 0 을 적는다** — 안 적으면 앞 실행의 수가 그대로 남아 대조군이 거짓이
  // 된다(2026-09-04: 끈 실행이 켠 실행의 `후보 1` 을 물려받았다). `beginRunStats` 가
  // 가려 주는 자리라 앱에선 안 보이고 테스트에서만 드러난다.
  const share = { candidates: 0, pairs: 0, rejected: 0 };
  if (AUTO_LAYOUT_LANE_MERGE) {
    const laneCapOf = (n: string | undefined): number | undefined => {
      const tier = config.belts?.find((b) => b.entityName === n);
      return tier ? laneCapOfTier(tier) : undefined;
    };
    for (const [childId, groups] of linkCache) {
      // 줄이 하나면 갈린 적이 없다 — 되찾을 절반도 없다.
      for (let i = 0; i + 1 < groups.length; i += 2) {
        share.candidates += 1;
        const made = shareLanes(
          [groups[i], groups[i + 1]],
          laneCapOf,
          () => `${childId}#lane${i / 2}`,
        );
        share.pairs += made;
        share.rejected += made === 0 ? 1 : 0;
      }
    }
  }
  recordLaneShareStats(share);

  // 출력 fan-out 링크 — 이 노드의 출력을 부모 머신들에게 나눠 주는 [Link] 목록.
  // 부모가 있고 rate·처리량이 다 있을 때만(없으면 undefined = 옛 트렁크 방출).
  const outputLinksOf = (s: NodeSpec): Link[] | undefined => linkCache.get(s.id);
  // 입력 fan-in 그룹 — outputLinks 의 거울. 이 노드가 부모인 간선들(자식마다)의 그룹을 모은다.
  // 캐시에서 그대로 가져오므로 자식 쪽과 그룹 객체(및 id)가 완전히 일치한다.
  const inputLinksOf = (s: NodeSpec): Link[] | undefined => {
    const kids = childIdsByParent.get(s.id) ?? [];
    const groups: Link[] = [];
    for (const cid of kids) {
      const g = linkCache.get(cid);
      if (g) groups.push(...g);
    }
    return groups.length > 0 ? groups : undefined;
  };
  /**
   * **P0b — 간선 단위 배정**.
   *
   * 모듈마다 무대(좌석표)를 차린 뒤, **간선마다** 그 간선의 그룹을 **양끝에 함께** 앉힌다.
   * 못이 있으면 **그 자리에서** 쪼개고 토막을 이어서 앉힌다 — 밖에서 `linkCache` 를 고치고
   * 트리를 **다시 만들던** 옛 사다리(되먹임 B)가 여기로 접혔다.
   *
   * 순서는 `specs`(트리 DFS pre-order)를 그대로 쓴다 — **순서를 고르는 것은 Step 6 의 일**이다.
   */
  const moduleInputOf = (s: NodeSpec): ModuleInput => ({
    ...toModuleInput(s, config, childFedItems(s)),
    // **끝 선호를 처음부터 싣는다** — 예전엔 tidy-tree 뒤에 알아내 2차 생성으로 다시 넣었다.
    lineEnds: lineEndsById.get(s.id),
    nsExposure: nsExposureOf(s),
    outputLinks: outputLinksOf(s),
    inputLinks: inputLinksOf(s),
  });

  // ── (가) 다이렉트 — **넘치는 부모의 링크 입력만 `g = 1` 로 다시 붓는다** (플래그 뒤) ──
  //
  // 밸브([EdgeBundle])는 진작 뚫려 있었고 **주는 사람이 없었다.** 여기가 주는 자리다.
  //
  // **두 번 붓는 것이 낭비가 아니다** — `edgeLinkGroups` 가 `undefined` 를 내는 조건
  // (유체 줄 · 흐름 0 · 벨트/인서터 못 고름)은 `bundle` 과 **무관**하다. 그러니 1차가
  // 어떤 간선이 링크가 되는지를 확정해 주고, 그 결과라야 `L_f`(품목 종류 수)를 **방출과
  // 같은 낟알로** 셀 수 있다. 트리에서 자식 수를 세면 유체 간선까지 세어 과대평가한다.
  //
  // **끄면 오늘 동작 그대로다** — 기전: 이 블록 전체가 안 돈다.
  // **레인 합류와 같이 켜지 않는다** — 짝짓기가 이미 `sharedLineId` 를 얹은 뒤라
  // 다시 부으면 그 신원이 사라진다. 둘을 함께 쓰려면 짝짓기를 이 뒤로 옮겨야 하고,
  // 그건 이 계획의 몫이 아니다(`부분-링크` 는 `벨트-레인` 을 안 건드린다).
  if (AUTO_LAYOUT_LINK_DIRECT && !AUTO_LAYOUT_LANE_MERGE) {
    /** 부모별 들어오는 링크(1차 결과 기준) — 이것이 그 면의 `L_E` 다. */
    const inItemsOf = new Map<string, Set<string>>();
    for (const s of specs) {
      if (!s.parentId || !linkCache.get(s.id)?.length) continue;
      const set = inItemsOf.get(s.parentId) ?? inItemsOf.set(s.parentId, new Set()).get(s.parentId)!;
      for (const g of linkCache.get(s.id)!) set.add(g.item);
    }
    for (const p of specs) {
      const L_E = inItemsOf.get(p.id)?.size ?? 0;
      if (L_E === 0) continue;
      const outItem = p.parentId ? productOf(p) : undefined;
      // **깊이는 장부를 안 읽는다**([clusterBeltDepthsOf] 머리말) — `"open"` 무대면 족하다.
      const probe = planLinkFaces(moduleInputOf(p), Math.max(1, p.count), "open");
      const need = linkDepthNeed({
        linesOf: (f) => (f === "W" ? (outItem ? 1 : 0) : L_E),
        depthsOf: (f) => clusterBeltDepthsOf(probe.ctx, f).length,
      });
      if (need === "free") continue;
      // **집는 쪽(`to`) 기준이다** — 넘치는 것은 받는 면이고, `g` 는 그 끝의 값이다.
      for (const s of specs) {
        if (s.parentId !== p.id || !linkCache.get(s.id)?.length) continue;
        const re = edgeLinkGroups(s, p, productOf(s)!, config, { side: "to", g: 1 });
        if (!re?.length) continue; // 다시 부어 빈손이면 **1차 결과를 지키다** — 없애지 않는다
        const end = linkEndOf(s);
        linkCache.set(s.id, end ? re.map((g) => ({ ...g, end })) : re);
      }
    }
  }

  /** 배정이 낸 쪼갬 수 — 진단용(옛 `laddered`). */
  let laddered = 0;

  /**
   * 트리 전체 배정. **`linkCache` 를 제자리에서 최종본으로 갈아 끼우고**(쪼개졌으면 토막),
   * 그에 맞춘 무대와 `ModuleInput` 을 돌려준다. **방출은 안 한다.**
   */
  const allocateTree = (): { stages: Map<string, LinkFaceStage>; inputs: Map<string, ModuleInput> } => {
    const stages = new Map<string, LinkFaceStage>();
    for (const s of specs)
      stages.set(s.id, planLinkFaces(moduleInputOf(s), Math.max(1, s.count), "open"));

    // 모듈마다 최종 링크 목록·계획을 모은다. `in` 은 자식 순서대로 이어 붙는다
    // (`inputLinksOf` 와 같은 순서라야 방출이 짝을 찾는다).
    const outOf = new Map<string, { links: Link[]; plans: (LinkFacePlan | undefined)[]; why: DepthShortage[][] }>();
    const inOf = new Map<string, { links: Link[]; plans: (LinkFacePlan | undefined)[]; why: DepthShortage[][] }>();
    for (const s of specs) {
      outOf.set(s.id, { links: [], plans: [], why: [] });
      inOf.set(s.id, { links: [], plans: [], why: [] });
    }

    for (const s of specs) {
      if (!s.parentId) continue;
      const groups = linkCache.get(s.id);
      if (!groups?.length) continue;
      const child = stages.get(s.id);
      const parent = stages.get(s.parentId);
      if (!child || !parent) continue;
      const r = seatLinkEdge(child, parent, groups, { split: AUTO_LAYOUT_LINK_LADDER });
      laddered += r.splits;
      linkCache.set(s.id, r.groups); // **최종본** — 쪼개졌으면 토막이 들어 있다
      const o = outOf.get(s.id)!;
      o.links.push(...r.groups); o.plans.push(...r.fromPlans); o.why.push(...r.fromWhy);
      const i = inOf.get(s.parentId)!;
      i.links.push(...r.groups); i.plans.push(...r.toPlans); i.why.push(...r.toWhy);
    }

    // **링크가 앉으려면 무엇을 풀어야 했나** — 모듈마다 눈금 하나([linkDepthNeed]).
    //
    // 여기서 세는 이유: `L_f`(그 면의 링크 **줄** 수 = 품목 종류 수)와 `R_f`(그 면의 깊이
    // 수)를 **둘 다 아는 유일한 자리**다. 판정 자체는 앉혀 본 결과를 안 보므로(입력만
    // 본다) 성공한 배치만 세는 편향이 없다 — `tempPlanDocs/부분-링크/` §4 Step 1.
    //
    // 면은 **선호**로 읽는다: 출력은 W, 입력은 E([allocateLinkFaces] 의 기본 면).
    // 링크는 반대 면으로 못 넘어가므로(`spillPair`) 그 선호가 곧 그 줄이 앉을 면이다.
    const needTally: Partial<Record<LinkDepthNeed, number>> = {};
    const needWho: string[] = [];
    for (const s of specs) {
      const st = stages.get(s.id)!;
      const items = (ls: readonly Link[]): number => new Set(ls.map((l) => l.item)).size;
      const L = (f: "W" | "E"): number =>
        items(f === "W" ? outOf.get(s.id)!.links : inOf.get(s.id)!.links);
      const R = (f: "W" | "E"): number => clusterBeltDepthsOf(st.ctx, f).length;
      const need = linkDepthNeed({ linesOf: L, depthsOf: R });
      needTally[need] = (needTally[need] ?? 0) + 1;
      // **넘친 것만 이름을 남긴다** — `L/R` 까지 실어야 *왜* 넘쳤는지가 한 줄에서 읽힌다.
      if (need !== "free")
        needWho.push(`${s.id} → ${need} (W ${L("W")}/${R("W")} · E ${L("E")}/${R("E")})`);
    }
    recordFaceDepthStats({
      linkNeed: needTally as Record<LinkDepthNeed, number>,
      linkNeedWho: needWho,
    });

    // 무대의 링크 목록·배정을 최종본으로 갈아 끼운다 — `generateModule` 이 보는
    // `input.outputLinks` 와 **같은 배열**이어야 방출이 index 로 짝을 찾는다.
    const inputs = new Map<string, ModuleInput>();
    for (const s of specs) {
      const st = stages.get(s.id)!;
      const o = outOf.get(s.id)!;
      const i = inOf.get(s.id)!;
      st.outLinks = o.links;
      st.inLinks = i.links;
      st.out = { plans: o.plans, deferred: [], shortages: o.why };
      st.in = { plans: i.plans, deferred: [], shortages: i.why };
      inputs.set(s.id, {
        ...moduleInputOf(s),
        outputLinks: o.links.length ? o.links : undefined,
        inputLinks: i.links.length ? i.links : undefined,
      });
    }
    // 쪼갬은 **0이 목표다** — 못이 안 생겼다는 뜻이고, 그게 순서 규칙(Step 6)의 과녁이다.
    if (laddered > 0) recordFaceDepthStats({ splits: laddered });
    return { stages, inputs };
  };

  const allocated = allocateTree();

  const stagesRef = allocated.stages;
  const inputsRef = allocated.inputs;

  const gen = (s: NodeSpec): GeneratedModule => {
    const base = inputsRef.get(s.id)!;
    // **사본을 준다** — ③′(기계별 포트)가 이 표에 이어서 앉으므로, 원본을 주면
    // 두 번째 `gen` 이 ①+③′ 이 앉은 표를 보고 시작한다([cloneLinkFaceStage]).
    const st = stagesRef.get(s.id);
    return generateModule({ ...base, linkFaceStage: st && cloneLinkFaceStage(st) });
  };

  // 1) **생성 — 한 번뿐이다.** 끝 선호(`lineEnds`)가 `P0` 에서 확정되므로 다시 돌 이유가 없다.
  //    여기서 잰 높이가 곧 깔릴 높이다(tidy-tree 가 그 값을 쓴다).
  const pass1 = new Map<string, GeneratedModule>();
  for (const s of specs) pass1.set(s.id, gen(s));

  // (옛 `1b) 사다리 1단` 은 **배정 안으로 접혔다** — `seatLinkEdge` 가 못을 만나면
  //  그 자리에서 쪼개고 토막을 이어 앉힌다. `linkCache` 를 밖에서 고치고 1차를 통째로
  //  다시 만들던 자리가 사라졌다 = **되먹임 B 제거**

  // (옛 `3) 포트 끝(DOF-B)` 은 **P0 으로 옮겼다** — 형제 순번으로 정하므로 tidy-tree 가
  //  필요 없다. |Δy| 최소(거리)를 버리고 **교차 없음**을 노린다.
  //  그것이 `gen → 높이 → 끝 → gen` 고리를 여는 유일한 조건이었다 = **되먹임 A 제거**

  // (옛 `4) 2차 생성` 은 **사라졌다** — 끝 선호가 `P0` 에서 확정되므로 1차가 곧 최종이다.
  //  `generateModule` 은 이제 트리마다 **한 번**만 돈다 = **되먹임 0**.
  //  그래서 *"1차가 센 형태는 버린다"* 던 계측 초기화도 필요 없다 — 잰 것이 곧 깔린 것이다.
  const oriented = new Map<string, { module: GeneratedModule; orientation: Orientation }>();
  for (const s of specs)
    oriented.set(s.id, { module: pass1.get(s.id)!, orientation: IDENTITY });
  // 내부 링크(자식→부모)의 형태 — 외부 줄은 `planModulePorts` 가 자기 몫을 센다.
  // 대수가 끝마다 다르다(자식 count ↔ 부모 count)라 그대로 넘긴다.
  recordBeltFormStats(
    summarizeBeltForms(
      [...linkCache].flatMap(([childId, groups]) => {
        const child = byId.get(childId);
        const parent = child?.parentId ? byId.get(child.parentId) : undefined;
        return groups.map((group) => ({
          group, fromCount: child?.count ?? 0, toCount: parent?.count ?? 0,
        }));
      }),
      // **분모는 레인이다** — 줄 하나가 쓸 수 있는 것은 벨트의 절반뿐이므로
      // (`docs/factorio/belt-lane-semantics.md` ①), 물리 처리량으로 재면 이용률이 **절반으로
      // 보이고** 과적재가 안 잡힌다(레인은 넘쳤는데 줄로는 안 넘친 줄이 그렇다).
      (name) => (name === undefined ? undefined : laneCapOfTier(config.belts?.find((b) => b.entityName === name))),
    ),
  );

  // ── 2) 납품 짝짓기 — **좌표 없이** ────────────────────────────────────────
  //
  //    예전엔 이 루프가 `topY` 뒤에 있어 절대 행을 그 자리에서 계산했다. 그러면 행 채널 수요가
  //    좌표보다 뒤가 되고, 행 채널 높이가 배치를 못 민다. 여기서는 **재료만** 담고 절대 행은
  //    6단계로 미룬다 — 짝짓기 자체는 좌표를 하나도 안 본다(`rowChannelPlanner` 머리말).

  // 납품 경로 씨앗 — 기하 예약(5c)의 납품 경로 입력. eligible = 자식 출력이 W변·부모 입력이 E변
  // (= 둘 사이 채널을 정면으로 가로지르는 계단꼴 모델의 전제). 아니면(스필 등) 폭만 예약.
  //    짝짓기는 `oriented` 에서 한 번만 하고(결정적), 짝지은 상자 id 를 아래 5b(트랙 예약)
  //    와 7(납품 경로 생성)이 공유한다 — 세 곳이 따로 판단해 어긋나는 일이 없게.
  const deliverySeeds: {
    depth: number;
    key: string;
    startY: number;
    endY: number;
    /** 절대 행을 나중에 계산할 재료 — 모듈 신원과 **모듈-로컬** 행. */
    fromId: string;
    toId: string;
    fromAnchorY: number;
    toAnchorY: number;
    eligible: boolean;
    /** 유체 이름(파이프 납품 경로). undefined = 아이템. 장부의 인접 규칙·배정 우선순위 입력. */
    fluid?: string;
    /** 자식 쪽 끝의 행 채널 접근(있으면). */
    fromRowChannel?: RowChannelEntry;
    /** 부모 쪽 끝의 행 채널 접근(있으면). */
    toRowChannel?: RowChannelEntry;
  }[] = [];
  const pairedChestIds = new Set<string>();
  /** 이미 납품을 낸 물리 벨트 신원(레인 공유) — 같은 벨트에 두 번 납품을 내지 않는다. */
  const mergeDoneFor = new Set<string>();
  const usedParentIn = new Map<string, Set<string>>();
  /** [pairDeliveryPorts] 가 신원 있는 포트끼리 짝을 못 찾았을 때 쌓는 사유 — 정상 경로가 아니다. */
  const linkMismatches: string[] = [];
  /** [자식 id] → 짝지은 (출력상자 id, 입력상자 id, linkId) 쌍들. 7)이 absById 로 재구성한다. */
  /**
   * **행 채널을 지나야 하는 경로 끝들** — 포트가 기둥 끝(N/S)이라 세로 채널 벽을 직접 못 마주 보는 것.
   *
   * (E) 결정에 따라 이 경로는 **자기 깊이 열 안에서만** 가로로 달린다 — 세로 채널을
   * 가로지르지 않으므로 교차로가 없다.
   *
   * 지금은 **세기만** 한다. 이 수가 0이면 행 채널이 이 트리에 필요 없다는 뜻이고,
   * 0이 아니면 Step 3(트랙 배정 + 두 패스)이 실제로 값을 낸다.
   */
  /** 경로 끝 id(`…:out`/`…:in`) → 행 채널 접근. 5a-2 가 채우고 5c 가 지시에 싣는다. */
  const rowChannelEntryById = new Map<string, RowChannelEntry>();
  const rowChannelNeeds: {
    id: string;
    nodeId: string;
    depth: number;
    /** **나중에 채운다** — 절대 행은 세로 좌표가 선 뒤에 온다(6단계). 진단용이다. */
    portY: number;
    /** 포트의 **모듈-로컬** 행. `portY` 를 나중에 계산하는 재료다. */
    anchorY: number;
    face: ModulePort["face"];
    /**
     * 이 끝이 행 채널에서 달릴 **가로 구간**(모듈-로컬 x). 상자에서 그 열의 **서쪽 변**까지다 —
     * 세로 채널이 서쪽에 있으므로((E) 자기 깊이 안에서만 달린다).
     *
     * 같은 깊이의 모듈은 전부 `colX[depth]` 에 **왼쪽 정렬**되므로, 로컬 x 로 비교해도
     * 절대 x 로 비교한 것과 겹침 판정이 같다. `colX` 는 이 단계보다 뒤에 정해진다.
     */
    x1: number;
    x2: number;
  }[] = [];
  const deliveryPairs = new Map<string, { item: string; outId: string; inId: string; linkId?: string }[]>();
  for (const s of specs) {
    if (!s.parentId) continue;
    const product = productOf(s);
    if (!product) continue;
    const used = usedParentIn.get(s.parentId) ?? usedParentIn.set(s.parentId, new Set()).get(s.parentId)!;
    const pairs = pairDeliveryPorts(oriented.get(s.id)!.module, oriented.get(s.parentId)!.module, product, used, linkMismatches);
    deliveryPairs.set(
      s.id,
      pairs.map((p) => ({ item: product, outId: p.out.chest.id, inId: p.inp.chest.id, linkId: p.out.linkId })),
    );
    pairs.forEach(({ out, inp }, i) => {
      pairedChestIds.add(out.chest.id);
      pairedChestIds.add(inp.chest.id);
      // **행 채널을 지나야 하는 끝** — 포트가 기둥 끝(N/S)이면 상자가 기둥 밖에 있어
      // 세로 채널 벽을 **직접 못 마주 본다**. 자기 깊이 열 안에서 가로로 달려 벽까지 가야
      // 하고, 그 가로 구간이 **행 채널의 트랙**이다((E) — 세로 채널을 안 가로지른다).
      //
      // 여기서는 **세기만** 한다(Step 3 준비). 실제 배정은 통로가 서고 나서다.
      for (const [who, port] of [["out", out], ["in", inp]] as const) {
        if (port.face !== "N" && port.face !== "S") continue;
        const ownerId = who === "out" ? s.id : s.parentId!;
        const ownerExt = moduleExtent(oriented.get(ownerId)!.module);
        rowChannelNeeds.push({
          id: `${deliveryKey({ fromId: s.id, toId: s.parentId!, item: product, seq: i, linkId: out.linkId })}:${who}`,
          nodeId: ownerId,
          depth: who === "out" ? s.depth : s.depth - 1,
          portY: 0, // ← 6단계가 채운다
          anchorY: port.anchor.y,
          face: port.face,
          x1: 0, // 열의 서쪽 변
          x2: port.anchor.x - ownerExt.x, // 상자의 로컬 x
        });
      }
      // **행 채널을 지나는 끝은 진입 행이 곧 출발/도착 행이다.** 세로 채널은 그 행이 포트의
      // 것인지 행 채널 트랙의 것인지 안 가린다(Step 0 확인) — 그래서 여기서 바꿔 넘기면 끝이다.
      // **행 채널 접근은 아직 모른다** — 배정(5a-2)이 이 루프보다 뒤다. 여기선 포트 행으로 두고,
      // 배정이 끝난 뒤 그 자리에서 `startY`/`endY` 와 `fromRowChannel`/`toRowChannel` 를 덮어쓴다.
      const dkey = deliveryKey({ fromId: s.id, toId: s.parentId!, item: product, seq: i, linkId: out.linkId });
      // **레인 합류 — 납품은 하나뿐이다.**
      //
      // 두 줄은 **모듈 출구에서 이미 한 벨트로 합쳐졌고**(`emitOutputLinks` 의 합류 칸),
      // 부모도 한 벨트로 받는다(`seatOnSharedBelt`). 양끝이 각각 **한 칸**이므로 그 사이를
      // 잇는 물리 경로도 하나다 — 뒤에 온 줄은 납품을 **안 만든다**.
      //
      // 채널이 두 경로를 만나게 하던 옛 안(`mergeTail`)은 이것으로 대체됐다: 합류를 자리가
      // 규칙적인 **출구**에서 계산하면 채널이 그 사실을 아예 몰라도 된다.
      if (inp.sharedLineId !== undefined) {
        if (mergeDoneFor.has(inp.sharedLineId)) return;
        mergeDoneFor.add(inp.sharedLineId);
      }
      deliverySeeds.push({
        depth: s.depth,
        key: dkey,
        // **나중에 채운다** — 6단계가 `fromAnchorY`/`toAnchorY` 에서 계산한다.
        startY: 0,
        endY: 0,
        fromId: s.id,
        toId: s.parentId!,
        fromAnchorY: out.anchor.y,
        toAnchorY: inp.anchor.y,
        // **적격 = 두 끝이 채널 벽에 닿을 수 있나.**
        //
        // 예전엔 *"포트가 벽을 마주 본다"*(`side === W`/`E`)로만 봤다. 그게 계단꼴 모델의
        // 전제였다(docs/layout-models §2③). 이제 **기둥 끝 포트도 행 채널을 지나 벽에 닿으므로**
        // 그 경우를 적격에 넣는다 — 조건이 넓어진 게 아니라 **닿는 길이 하나 늘었다.**
        // (2026-08-17 에 조건만 넓히고 도형을 안 늘렸다가 모듈 관통 경로가 나왔다.)
        eligible:
          (out.meta.side === "W" || out.face === "N" || out.face === "S")
          && (inp.meta.side === "E" || inp.face === "N" || inp.face === "S")
          && byId.get(s.parentId!)!.depth === s.depth - 1,
        // 유체 납품 경로는 **항상** 적격이다 — moduleWizard 가 출력 유체를 W, 입력 유체를 E 면에
        // 오도록 회전을 강제하고(wantFace) 못 맞추면 트리째 reject 하기 때문이다. 즉 위
        // eligible 조건과 유체의 존재 조건이 같다(docs/…fluid-delivery-reservation.md §1.1).
        fluid: out.line.kind === "pipe" ? product : undefined,
      });
    });
  }


  // ── 3) 세로 순서 · 행 채널 신원 · 트랙 배정 — **전부 좌표가 없다** ─────────────────
  //
  //    이 셋이 `topY` 보다 앞에 설 수 있다는 것이 이 구조의 전부다. `rowChannelPlanner`
  //    머리말이 한때 여기에 순환이 있다고 적었는데, 그 순환의 둘째 화살표
  //    *「absPortY → 행 채널을 지나는 경로」* 가 거짓이었다 — 배정 입력 넷(면 · 모듈-로컬 x ·
  //    side · 행 채널 신원)이 어느 것도 y 를 안 본다.

  // 3a) **깊이별 세로 순서 — 좌표가 아니라 트리가 답한다.**
  //
  //     `layoutY` 는 자식을 배열 순서대로 위→아래로 놓고, 겹침 스윕은 **아래로만** 민다.
  //     그러니 같은 깊이의 세로 순서 = **트리 DFS 순서**이고, 좌표 없이 나온다.
  const orderByDepth = new Map<number, string[]>();
  {
    const visit = (id: string): void => {
      const d = byId.get(id)!.depth;
      (orderByDepth.get(d) ?? orderByDepth.set(d, []).get(d)!).push(id);
      for (const k of childIdsByParent.get(id) ?? []) visit(k);
    };
    for (const s of specs) if (!s.parentId) visit(s.id);
  }

  // 3b) **행 채널의 신원** — 깊이 · 순번 · 이웃. 자리(`top`/`bottom`)는 5단계가 채운다.
  //
  //     **마진도 행 채널이다** — 이웃이 없을 뿐, 거기로 나가는 경로들이 행을 다투는 것은 같다.
  const rowChannels: RowChannel[] = [];
  for (const [depth, ids] of orderByDepth) {
    const first = ids[0];
    const last = ids[ids.length - 1];
    if (first === undefined || last === undefined) continue;
    rowChannels.push({ depth, index: -1, kind: "marginN", top: 0, bottom: 0, below: first, height: 0 });
    for (let i = 0; i + 1 < ids.length; i++)
      rowChannels.push({
        depth, index: i, kind: "between", top: 0, bottom: 0, above: ids[i], below: ids[i + 1], height: 0,
      });
    rowChannels.push({
      depth, index: ids.length - 1, kind: "marginS", top: 0, bottom: 0, above: last, height: 0,
    });
  }

  // 3c) **행 채널 트랙 배정 → 높이.** 폭 역전 — 높이는 고르는 값이 아니라 배정의 결과다.
  //
  //     수요 하나 = *"이 모듈의 이 면 바깥 행 채널에서 가로로 달린다"*. 면이 N 이면 그 모듈
  //     **위** 행 채널, S 면 **아래** 행 채널이다.
  {
    const rowChannelOf = (nodeId: string, depth: number, face: ModulePort["face"]) =>
      rowChannels.find(
        (b) =>
          b.depth === depth
          && (face === "N" ? b.below === nodeId : b.above === nodeId),
      );
    const byRowChannel = new Map<RowChannel, RowCrossing[]>();
    for (const n of rowChannelNeeds) {
      const rowChannel = rowChannelOf(n.nodeId, n.depth, n.face);
      if (!rowChannel) continue; // 그 면에 행 채널이 없다 — 있을 수 없다(마진이 늘 있다). 안전망.
      // **어느 쪽에서 행 채널로 들어오나** — 면이 답한다. `N` 면이면 행 채널은 모듈 **위**에 있으므로
      // 그 경로는 행 채널의 **아래** 변에서 올라온다. `S` 면은 거울이다. 이 한 값이 교차를
      // 없애는 순서를 정한다([planRowChannel] 의 전순서).
      (byRowChannel.get(rowChannel) ?? byRowChannel.set(rowChannel, []).get(rowChannel)!).push({
        id: n.id, x1: n.x1, x2: n.x2, side: n.face === "N" ? "bottom" : "top",
      });
    }
    // 수요가 없는 행 채널도 하한(`ROW_CHANNEL_MIN`)만큼은 선다 — `planRowChannel([])` 이 그 값이다.
    for (const rowChannel of rowChannels) rowChannel.height = planRowChannel([]).height;
    for (const [rowChannel, crossings] of byRowChannel) {
      const plan = planRowChannel(crossings);
      rowChannel.height = plan.height;
      rowChannel.tracks = plan.tracks;
    }
  }

  // ── 4) 세로 좌표 — **열마다 누적합. 간격은 전부 행 채널 높이다** ────────────────
  //
  //    `colX[d] = colX[d-1] + 열폭 + 채널폭` 의 **세로 판**이다. 열 하나가 순번 0부터
  //    누적합이고, 더하는 것은 **모듈 높이 + 그 아래 행 채널의 높이**뿐 — 상수가 없다.
  //    예전엔 `STACK_GAP = 3` 이 간격이었고 행 채널이 모자라면 경로가 탐색으로 떨어졌다.
  const heightOf = (id: string): number => moduleExtent(pass1.get(id)!).h;
  const heightBelow = new Map<string, number>();
  for (const b of rowChannels)
    if (b.kind === "between") heightBelow.set(`${b.depth}:${b.above}`, b.height);
  /** 순번 `i` 다음에 오는 행 채널의 높이 — 이것이 곧 다음 모듈까지의 간격이다. */
  const gapBelow = (depth: number, id: string): number =>
    heightBelow.get(`${depth}:${id}`) ?? ROW_CHANNEL_MIN;

  // 4a) **누적합** — 순번 → 행. 좌표는 이 식 하나에서 나온다.
  const topY = new Map<string, number>();
  const stack = (): void => {
    for (const [depth, ids] of orderByDepth) {
      let y = 0;
      for (const id of ids) {
        topY.set(id, y);
        y += heightOf(id) + gapBelow(depth, id);
      }
    }
  };
  stack();

  // 4b) **중앙 정렬 — 순번 공간에서**(2026-09-06 사장님 지시로 index 판으로 다시 세움).
  //
  //     부모를 자식들 곁에 두면 납품의 세로 구간이 짧아지고, 그만큼 세로 채널의 트랙이
  //     줄어 **채널이 좁아진다**. 그 이득은 버리지 않는다.
  //
  //     **옛 tidy-tree 와 무엇이 다른가** — 옛 판은 잎을 전역 커서에 상수(`STACK_GAP`)
  //     간격으로 쌓아 **좌표를 먼저 만들고** 부모를 그 좌표의 중점에 놓았다. 그래서 간격이
  //     행 채널과 무관했다. 지금은 자리를 4a 의 누적합이 만들고, 이 단계는 **부모를 옮기기만**
  //     한다 — 옮긴 뒤 4c 가 누적합 하한을 되살리므로 행 채널보다 좁아질 수 없다.
  //
  //     깊은 열부터 올라간다: 자식이 먼저 서야 부모가 맞출 수 있다.
  const depths = [...orderByDepth.keys()].sort((a, b) => b - a);
  for (const d of depths) {
    for (const id of orderByDepth.get(d) ?? []) {
      const kids = childIdsByParent.get(id) ?? [];
      if (kids.length === 0) continue;
      const lo = Math.min(...kids.map((k) => topY.get(k)!));
      const hi = Math.max(...kids.map((k) => topY.get(k)! + heightOf(k)));
      topY.set(id, Math.round((lo + hi) / 2 - heightOf(id) / 2));
    }
  }

  // 4c) **누적합 하한 복원** — 4b 가 부모를 옮겨 이웃과 가까워졌을 수 있다.
  //     순서는 3a 가 정했으므로 **좌표로 다시 정렬하지 않는다.** 위에서부터 아래로만 민다.
  for (const [depth, ids] of orderByDepth) {
    let prevBottom = -Infinity;
    let prevId: string | undefined;
    for (const id of ids) {
      let t = topY.get(id)!;
      if (prevId !== undefined) t = Math.max(t, prevBottom + gapBelow(depth, prevId));
      topY.set(id, t);
      prevBottom = t + heightOf(id);
      prevId = id;
    }
  }

  // 5) **행 채널 자리** — 이제야 좌표가 붙는다. `top`/`bottom` 은 행 채널의 **빈 칸 범위**다.
  //
  //    사이 행 채널는 두 모듈이 경계다(4b 가 높이만큼 벌려 놓았다). 마진은 바깥이 열려 있으므로
  //    자기 높이만큼 뻗는다 — 예전의 `fitRowChannel` 이 하던 일이 여기로 접혔다.
  for (const b of rowChannels) {
    if (b.kind === "between") {
      b.top = topY.get(b.above!)! + heightOf(b.above!);
      b.bottom = topY.get(b.below!)! - 1;
    } else if (b.kind === "marginN") {
      b.bottom = topY.get(b.below!)! - 1;
      b.top = b.bottom - (b.height - 1);
    } else {
      b.top = topY.get(b.above!)! + heightOf(b.above!);
      b.bottom = b.top + (b.height - 1);
    }
  }

  // 6) **절대 행** — 2단계가 미뤄 둔 것들을 여기서 푼다.
  const absPortY = (id: string, anchorY: number): number =>
    anchorY + topY.get(id)! - moduleExtent(oriented.get(id)!.module).y;
  for (const n of rowChannelNeeds) n.portY = absPortY(n.nodeId, n.anchorY);
  for (const seed of deliverySeeds) {
    seed.startY = absPortY(seed.fromId, seed.fromAnchorY);
    seed.endY = absPortY(seed.toId, seed.toAnchorY);
  }

  // 6b) **행 채널 진입 행** — 트랙 번호가 행이 된다(`top + t`). 자리가 선 지금에야 된다.
  {
    for (const b of rowChannels) {
      if (!b.tracks) continue;
      for (const [id, t] of b.tracks) rowChannelEntryById.set(id, { row: b.top + t });
    }
    // **배정이 끝난 지금** seed 에 실어 준다 — 위 짝짓기 루프는 배정을 아직 모른다.
    // 진입 행이 곧 세로 채널의 출발/도착 행이다(Step 0: 출처를 안 가린다).
    for (const seed of deliverySeeds) {
      const fb = rowChannelEntryById.get(`${seed.key}:out`);
      const tb = rowChannelEntryById.get(`${seed.key}:in`);
      if (fb) { seed.fromRowChannel = fb; seed.startY = fb.row; }
      if (tb) { seed.toRowChannel = tb; seed.endY = tb.row; }
      // **행 채널이 필요한데 못 받았으면 계획을 접는다.** 그 끝의 `startY` 는 여전히 포트 행이고,
      // 포트는 기둥 **밖**에 있어 계단꼴의 가로 진입이 모듈 몸통을 지난다. 그리면 반드시
      // 막히므로 **애초에 안 그린다** — 장부는 폭만 예약하고 라우터가 탐색으로 잇는다.
      const wantsRowChannel = (w: "out" | "in") => rowChannelNeeds.some((n) => n.id === `${seed.key}:${w}`);
      if ((!fb && wantsRowChannel("out")) || (!tb && wantsRowChannel("in"))) seed.eligible = false;
    }
  }

  // 5) 열 폭 + 채널 폭(수요 기반) → x 좌표. 채널 d(깊이 d↔d-1)를 가로지르는 납품 경로를 세로
  //    구간 [min(자식포트y, 부모포트y), max(...)] 으로 모아 left-edge 트랙 수 = 폭의 근거.
  //    포트 abs-y = 로컬 anchor.y + (topY - ext.y) (colX 무관 → 배치 전 계산 가능). 끝 정렬
  //    (piece 4)으로 구간이 짧아 트랙↓→폭↓. channelPlanner 코드 무수정(좌표-무지).
  const maxDepth = Math.max(...specs.map((s) => s.depth), 0);
  const colWidth = new Array(maxDepth + 1).fill(0);
  for (const s of specs) colWidth[s.depth] = Math.max(colWidth[s.depth], moduleExtent(oriented.get(s.id)!.module).w);

  // 5b) 외부상자 반출 트랙 예약(조각 6-①) — 살아남은 raw 입력·루트 출력 상자를 인접 gap
  //     으로 빼는 트랙을 planner 에 맡긴다. 채널로 우회하는 트랙의 세로 구간은 위 납품 경로
  //     으로 빼는 출구를 planner 에 맡긴다. colX 전이라 X 없이 abs y+depth 만으로 판정
  //     가능. 항상 계산해 PackResult 에 싣고, 실제 폭/마진 반영은 reservePerimeterExits 게이트.
  //     환승 출구가 먹는 트랙은 5c 의 통합 장부가 배정하고, 그 결과에서 폭이 나온다.
  // **행 채널 관통 판정의 재료** — 가로 트랙이 덮는 최대 로컬 x. 세로 직진이 그 열을
  // 밟는지 판정하는 데 쓴다(`layoutRegions` 의 ③ 관통). 수요 기준이라 보수적이다.
  const rowChannelReach = new Map<string, number>();
  for (const n of rowChannelNeeds) {
    const k = rowChannelKey(n.depth, n.face === "N" ? "below" : "above", n.nodeId);
    rowChannelReach.set(k, Math.max(rowChannelReach.get(k) ?? -1, n.x2));
  }
  const exitPlan = planExits(
    specs, oriented, topY, pairedChestIds, maxDepth, absPortY, orderByDepth, rowChannelReach,
  );

  // 5c) 채널 기하 예약(통합 장부) — 납품·반출 경로를 한 장부에 모아 트랙을 배정한다
  //     (같은 쪽 판정 + 해소 사다리, docs/…channel-geometry-reservation.md). 폭 역전:
  //     아래 channelWidth 가 이 배정 결과(trackCount)에서 폭을 유도한다. 부적격 경로
  //     (스필 납품 경로)는 폭만 예약(reserveIntervals)하고 방출의 dijkstra 에 맡긴다.
  const geometryPlans = new Map<number, ChannelGeometryPlan>();
  let gyMin = Infinity, gyMax = -Infinity;
  for (const s of specs) {
    const top = topY.get(s.id)!;
    gyMin = Math.min(gyMin, top);
    gyMax = Math.max(gyMax, top + moduleExtent(oriented.get(s.id)!.module).h - 1);
  }
  for (let d = 1; d <= maxDepth; d++) {
    const dels: DeliveryInput[] = [];
    const reserve: Interval[] = [];
    for (const seed of deliverySeeds) {
      if (seed.depth !== d) continue;
      if (seed.eligible) dels.push({ id: seed.key, startY: seed.startY, endY: seed.endY, fluid: seed.fluid });
      else reserve.push({ lo: Math.min(seed.startY, seed.endY), hi: Math.max(seed.startY, seed.endY) });
    }
    const exps: ExportInput[] = [];
    if (config.reservePerimeterExits) {
      for (const a of exitPlan.assignments) {
        if (a.exitMode.kind !== "channel" || a.exitMode.depth !== d) continue;
        // **불변식** — 환승 후보는 `entry` 가 언제나 있고 진출 변이 언제나 N/S 다
        // (`channelOpts` 가 `[near, far]` 로 둘 다 N/S 를 낸다). 그 방향으로 못 나가는
        // 포트는 **환승 후보 자체가 안 만들어진다**(`wayOut` 이 W/E 일 때만 도니까).
        // 아래 가드는 그 불변식을 타입에 알려 주는 것뿐이다 — 참이 될 수 없다.
        if (!a.entry || (a.exitEdge !== "N" && a.exitEdge !== "S")) continue;
        exps.push({ id: a.id, entryY: a.entry.y, entryWall: a.entry.wall, preferredExit: a.exitEdge });
      }
    }
    geometryPlans.set(
      d,
      planChannelGeometry(dels, exps, {
        yMin: gyMin,
        yMax: gyMax,
        reserveIntervals: reserve,
        maxJump: config.beltMaxUndergroundDistance ?? 0,
      }),
    );
  }

  /** **폭 역전** — 폭은 우리가 고르는 값이 아니라 기하 배정의 결과(사용 트랙 수)다. */
  const channelWidth = (d: number): number =>
    channelWidthFromTracks(geometryPlans.get(d)?.trackCount ?? 0, MODULE_CHANNEL_MIN);
  const colX = new Array(maxDepth + 1).fill(0);
  for (let d = 1; d <= maxDepth; d++) colX[d] = colX[d - 1] + colWidth[d - 1] + channelWidth(d);

  // 6) 절대 좌표 배치 — 결정적(depth 오름차순, 같은 depth 는 id 순).
  const placements: ModulePlacement[] = [];
  const absById = new Map<string, GeneratedModule>();
  for (const s of [...specs].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id))) {
    const { module, orientation } = oriented.get(s.id)!;
    const ext = moduleExtent(module);
    const y = topY.get(s.id)!;
    const abs = shiftModule(module, colX[s.depth] - ext.x, y - ext.y);
    placements.push({ id: s.id, module: abs, orientation, origin: { x: colX[s.depth], y } });
    absById.set(s.id, abs);
  }

  // 7) 납품 경로 = 위(5)에서 이미 짝지은 쌍을 절대좌표 포트로 재구성. raw = 짝 못 지은 포트 전부
  //    (입력이면 외부 공급 무한상자, 출력이면 무한 sink) — 둘 다 perimeter 로 나가야 한다.
  const deliveries: DeliverySpec[] = [];
  const rawPorts: ModulePort[] = [];
  const portByChestId = new Map<string, ModulePort>();
  for (const s of specs) {
    const mod = absById.get(s.id)!;
    for (const p of [...mod.inputPorts, ...mod.outputPorts]) portByChestId.set(p.chest.id, p);
  }
  /**
   * **레인 공유 — 납품은 물리 벨트마다 하나다.**
   *
   * 두 줄이 한 물리 벨트를 쓰면(`sharedLineId`) 양끝이 각각 **한 칸**이다 — 자식은 출구에서
   * 이미 합쳐졌고 부모도 한 벨트로 받는다. 그 사이를 잇는 물리 경로도 하나여야 한다.
   * 두 번째 줄까지 납품을 내면 **같은 두 칸 사이에 벨트를 두 번 깔려 든다.**
   */
  const deliveredLines = new Set<string>();
  for (const s of specs) {
    for (const [i, pr] of (deliveryPairs.get(s.id) ?? []).entries()) {
      const from = portByChestId.get(pr.outId);
      const to = portByChestId.get(pr.inId);
      if (!from || !to) continue;
      const shared = to.sharedLineId;
      if (shared !== undefined) {
        if (deliveredLines.has(shared)) continue;
        deliveredLines.add(shared);
      }
      deliveries.push({ item: pr.item, from, to, fromId: s.id, toId: s.parentId!, seq: i, linkId: pr.linkId });
    }
  }
  for (const s of specs) {
    const mod = absById.get(s.id)!;
    for (const p of [...mod.inputPorts, ...mod.outputPorts])
      if (!pairedChestIds.has(p.chest.id)) rawPorts.push(p);
  }

  const rawBbox = unionExtent(placements);

  // 7b) 기하 예약의 절대좌표 변환 — 트랙 index → 채널 내부 x, 반출 배정 확정(exitEdge
  //     뒤집힘 반영 + trackX 기록), 반출 예약 셀 산출. marginNeeds 를 갱신할 수 있으므로
  //     expandBbox 보다 먼저.
  const channelGeometry = materializeChannelGeometry({
    geometryPlans,
    deliverySeeds,
    exitPlan,
    placements,
    channelStartX: (d: number) => colX[d - 1] + colWidth[d - 1],
    rawBbox,
    reserveTracks: config.reservePerimeterExits === true,
  });

  const bbox = config.reservePerimeterExits ? expandBbox(rawBbox, exitPlan.marginNeeds) : rawBbox;
  return { placements, deliveries, rawPorts, bbox, exitPlan, channelGeometry, linkMismatches, rowChannels, rowChannelNeeds };
}

/**
 * 통합 장부의 추상 배정(트랙 index)을 절대좌표 지시로 변환한다.
 * - 납품: DeliveryGeometry(트랙 x·갈아타는 행·지하 횡단 좌표) — deliveryRoute 이 탐색 없이 방출.
 * - 반출: ExitAssignment 에 trackX·(뒤집혔으면) exitEdge 를 기록 — ⑥C 가 그대로 재생.
 * - 예약 셀: 모든 확정 반출 경로(환승 elbow + 직진 직선)의 절대 셀 —
 *   폴백 dijkstra 납품 경로의 침범을 막아 "먼저 깐 경로가 자리를 뺏는" 원래 구멍을 봉인한다.
 */
function materializeChannelGeometry(args: {
  geometryPlans: Map<number, ChannelGeometryPlan>;
  deliverySeeds: {
    depth: number; key: string; eligible: boolean; fluid?: string;
    /** 합류의 멈춤 행을 여기서 유도한다(`mergeTail`) — 계획이 쓴 것과 **같은 행**이라야 한다. */
    startY: number; endY: number;
    fromRowChannel?: RowChannelEntry; toRowChannel?: RowChannelEntry;
  }[];
  exitPlan: PerimeterExitPlan;
  placements: ModulePlacement[];
  channelStartX: (d: number) => number;
  rawBbox: { x: number; y: number; w: number; h: number };
  reserveTracks: boolean;
}): PackChannelGeometry {
  const { geometryPlans, deliverySeeds, exitPlan, placements, channelStartX, rawBbox, reserveTracks } = args;
  const deliveries = new Map<string, DeliveryDirective>();
  const skips: { key: string; reason: string }[] = [];
  for (const seed of deliverySeeds) {
    // 행 채널 접근은 도형과 무관하게 붙는다 — 세로 채널은 진입 행만 받고 출처를 안 묻는다.
    const rcEntries = { fromRowChannel: seed.fromRowChannel, toRowChannel: seed.toRowChannel };
    if (!seed.eligible) {
      // **계단꼴이 못 그리는 기하 → 되꺾기로 계획한다**(2026-08-17). 대개 부모 입력이 반대
      // 면으로 스필한 경우다. 여태 여기서 조용히 빠져 dijkstra 가 맡았고, 그 폴백이 남의
      // 예약을 밟아 연쇄했다. 모양은 **ㄱ자** — 자기 행을 따라 가로로 간 뒤 목표 열에서
      // 세로로 (근거는 `wrapAround` 자료형 주석: 상자의 자기 열은 늘 붐빈다).
      // 유체는 제외한다(유체는 언제나 적격이라 여기 오면 그게 사고다).
      if (seed.fluid !== undefined) {
        skips.push({ key: seed.key, reason: "not-eligible-fluid" });
        if (AUTO_LAYOUT_COORD_DUMP)
          console.log("[channelGeometry] 장부에서 제외 —", seed.key, "not-eligible(유체인데 전제 위반 — 사고)");
        continue;
      }
      deliveries.set(seed.key, { kind: "wrapAround", ...rcEntries });
      continue;
    }
    const plan = geometryPlans.get(seed.depth)?.deliveries.get(seed.key);
    if (!plan || plan.kind === "fallback") {
      // **장부가 왜 포기했는지는 여기서만 알 수 있다** — 아래로 안 내려보내면 소비처는
      // "계획이 없다"만 보고 이유를 영영 못 본다(2026-07-22 조사에서 계측을 새로 만들어야
      // 했던 자리). 포기한 납품 경로 하나가 탐색으로 내려가면 남의 계획까지 밟아 **연쇄**하므로
      // ([deliveryRoute] 의 "예약 무시 재시도"), 이 한 줄이 그 연쇄의 출발점을 가리킨다.
      skips.push({ key: seed.key, reason: plan ? plan.reason : "no-plan" });
      if (AUTO_LAYOUT_COORD_DUMP)
        console.log("[channelGeometry] 계획 포기 —", seed.key, plan ? plan.reason : "계획 자체가 없음");
      continue;
    }
    const tx = (t: number) => channelStartX(seed.depth) + 1 + t;
    if (plan.kind === "straight") deliveries.set(seed.key, { kind: "straight", ...rcEntries });
    else if (plan.kind === "staircase")
      deliveries.set(seed.key, { kind: "staircase", trackX: tx(plan.track), ...rcEntries });
    else if (plan.kind === "columnSwitch")
      deliveries.set(seed.key, {
        ...rcEntries,
        kind: "columnSwitch",
        startTrackX: tx(plan.startTrack),
        switchY: plan.switchY,
        endTrackX: tx(plan.endTrack),
      });
    else
      deliveries.set(seed.key, {
        ...rcEntries,
        kind: "undergroundCrossing",
        trackX: tx(plan.track),
        // 행은 이미 abs y. 열만 트랙 index → 절대 x. 벽 마진 열(-1 / capCol)은 점프에
        // 안 나온다(점프는 트랙 밴드 안에서만 생긴다) — tx 가 그 밖으로 새지 않는다.
        jumps: plan.jumps.map((j) => ({
          from: { x: tx(j.fromCol), y: j.fromRow },
          to: { x: tx(j.toCol), y: j.toRow },
        })),
      });
  }

  const reservedExportCells = new Set<string>();
  if (reserveTracks) {
    // 포트 anchor(절대) — 상자 id 로 조회.
    const portByChest = new Map<string, ModulePort>();
    for (const pl of placements)
      for (const p of [...pl.module.inputPorts, ...pl.module.outputPorts]) portByChest.set(p.chest.id, p);
    const M = PERIMETER_MARGIN;
    const seatRow = (edge: "N" | "S") => (edge === "N" ? rawBbox.y - M : rawBbox.y + rawBbox.h - 1 + M);
    const seatCol = (edge: "W" | "E") => (edge === "W" ? rawBbox.x - M : rawBbox.x + rawBbox.w - 1 + M);
    const addSeg = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      for (const c of segment(from, to)) reservedExportCells.add(`${c.x},${c.y}`);
    };
    for (const a of exitPlan.assignments) {
      const port = portByChest.get(a.id);
      if (!port) continue;
      const anchor = { x: port.anchor.x, y: port.anchor.y };
      if (a.exitMode.kind === "channel") {
        const plan = geometryPlans.get(a.exitMode.depth)?.exports.get(a.id);
        if (plan?.kind !== "elbow") continue; // fallback — 예약 없음(스캔·skip 유지)
        const trackX = channelStartX(a.exitMode.depth) + 1 + plan.track;
        a.exitEdge = plan.exitEdge; // 해소 사다리 ①에서 뒤집혔을 수 있다
        a.trackX = trackX;
        exitPlan.marginNeeds[plan.exitEdge] = true;
        const corner = { x: trackX, y: anchor.y };
        addSeg(anchor, corner);
        addSeg(corner, { x: trackX, y: seatRow(plan.exitEdge) });
      } else if (a.exitEdge === "N" || a.exitEdge === "S") {
        addSeg(anchor, { x: anchor.x, y: seatRow(a.exitEdge) });
      } else {
        addSeg(anchor, { x: seatCol(a.exitEdge), y: anchor.y });
      }
    }
  }

  return { deliveries, reservedExportCells, skips };
}

// ─────────────────────────────────────────────────────────────────────────────
// extent / 이동 / 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function unionExtent(placements: ModulePlacement[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of placements) {
    const e = moduleExtent(pl.module);
    minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + e.w - 1); maxY = Math.max(maxY, e.y + e.h - 1);
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function toModuleInput(s: NodeSpec, config: PackConfig, fed: Set<string>): ModuleInput {
  return {
    machine: s.machine,
    count: s.count,
    // external = 트리 안 생산자 없는 입력(무한상자로 살아남음) — planner 의 노출
    // N/S 완화 대상. 내부 간선(납품 경로 대체 예정)·출력은 W/E 유지.
    lines: s.lines.map((l) => ({ ...l, external: l.role === "input" && !fed.has(l.name) })),
    inserterEntityName: config.inserterEntityName,
    beltEntityName: config.beltEntityName,
    belts: config.belts,
    undergroundBelts: config.undergroundBelts,
    inserters: config.inserters,
    idPrefix: s.id,
    // 트렁크 파이프 계획 — 게임데이터(fluid_boxes)를 보는 호출자(`run/policy` · `run/gamedata`)가 이미
    // 풀어서 spec 에 실어 보낸다. module/ 는 store 를 안 본다(순수).
    fluidTrunk: s.fluidTrunk,
    // [Parallel Inserting] 용량 — 마찬가지로 게임데이터를 보는 `run/gamedata` 가 계산해 실었다.
    supplyCapacity: s.supplyCapacity,
  };
}

