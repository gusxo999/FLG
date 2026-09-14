/**
 * **트리 관심사의 타입** — 패킹의 입력(`NodeSpec` · `PackConfig`)과 결과(`PackResult` 와 그 필드들).
 *
 * 조율자(`modulePacking.packModuleTree`)가 받고 내는 어휘이고, 그 결과를 읽는 쪽이 넓다 —
 * 납품(`deliveryRoute`) · 반출 재생(`modulePerimeterPass`) · 실행 전체(`moduleWizard` · `run/`) ·
 * 이웃 관심사(`link/edgeLinks` · `perimeter/exits`).
 *
 * **왜 조율자 파일 밖인가.** 조율자에서 떼어 낸 조각(`tree/` · `link/` · `channel/`)이 이 타입을
 * 읽는다. 타입이 조율자 파일에 있으면 조각이 조율자를 **올려다보게** 된다 — 역방향 타입 간선도
 * D4(런타임 순환)의 모양이다(계획 구조-2축 · 2 Step 3c-1, 2026-09-14 `modulePacking.ts` 에서 옮겼다).
 */

import type { SpecInserter } from "../../buildSpec";
import type { IoLine } from "../../module/types/line";
import type { GeneratedModule, ModuleInput, ModulePort } from "../../module/types/module";
import type { Orientation } from "../../module/moduleTransform";
import type { PerimeterExitPlan } from "../perimeterExitPlanner";

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

/**
 * **행 채널 진입점** — 상자에서 행 채널로 갈아타는 지점.
 *
 * 포트 상자가 [[용어사전#기둥 (column)|기둥]] 끝(N/S)에 있으면 세로 채널 벽을 **직접 마주
 * 보지 않는다**. 계단꼴은 "벽에서 출발"을 전제하므로 그대로는 못 그린다. 그래서 상자에서
 * 이 `row` 까지 **세로로 먼저** 간 뒤, 거기서부터 평소의 계단꼴을 그린다 — 갈아탄 뒤엔
 * 출처가 구별되지 않아서 세로 채널은 `startY` 가 어디서 왔는지 안 묻는다.
 *
 * 포트가 기둥 끝이라 세로 채널 벽을 직접 못 마주 볼 때, 그 끝이 행 채널에서 달리는 구간의
 * `row` 가 곧 세로 채널에 넘기는 **진입 행**이다. (E) 결정에 따라 그 구간은 **자기 깊이 열 안에서만**
 * 달린다 — 세로 채널을 안 가로지르므로 교차로가 없다.
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
 * 납품 하나의 방출 지시 = **도형 + 행 채널 진입** — 통합 장부의 배정을 트랙 index→x 로 변환한 것(절대 좌표).
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
