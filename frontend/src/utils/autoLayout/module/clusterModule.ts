/**
 * clusterModule — 한 레시피 노드의 N대 머신을 **부모-무시 자족 모듈**로 생성한다.
 *
 * 단일 출처: 본 설계안(모듈 출력 경계 / 클러스터 모듈화).
 *
 * ## 왜 "루트처럼"
 * 자식 클러스터를 만들 때 부모를 전혀 보지 않고, 클러스터 자신을 루트로 간주한다 —
 * 입력은 전부 외부 소스(무한상자), 출력은 자기 perimeter ring 으로 수집. 그 결과
 * 모듈은 **자기 ring 위에 입·출력 포트**를 갖는 불투명 블록이 된다. 부모 연결은
 * 합성 단계가 포트끼리 잇는다(별도 단계).
 *
 * ## 헤어핀이 구조적으로 불가능한 이유
 * 깨졌던 [clusterTrunkMerge] 는 트렁크 종착을 **부모 머신**(레이아웃 반대편 끝)으로
 * 잡아, visitOrder 가 반대 끝까지 올라갔다 되돌아오는 U자를 만들었다. 본 모듈은
 * 종착 후보를 **클러스터 자신의 ring**(enumeratePerimeterCells, 자기 bbox)으로 둔다
 * — 이는 검증된 [externalMergePass] 의 전역 ring 패턴을 한 클러스터로 좁힌 것이며,
 * 트렁크가 레이아웃을 가로지르지 않고 자기 변에서 끝난다. 새 라우팅 로직 0.
 *
 * v1 범위: 아이템 belt 만(유체 line 은 unrouted 로 위임). 직접 탭(untapped 0) 실패
 * line 도 unrouted. 배선 전이라 레이아웃 회귀 0 — 단위 테스트로만 검증.
 */

import {
  insertingPlanner,
  type IoLine,
  type PlannedLine,
  type PlannedSide,
  type PortSide,
  type SupplyCapacity,
  type InsertingDecisionResult,
} from "./clusterPortPlanner";
import type { SpecBelt, SpecInserter } from "../buildSpec";
import {
  externalLineGroups,
  isInternalLink,
  maxInsertersPerBelt,
  type MachineLinkGroup,
} from "./allocateMachineLinks";
import { layoutCluster } from "./clusterLayout";
import type { Container, ModulePortMeta, PlacedCell, PortFace, PortPair } from "../containerModel";
import type { Direction } from "../../../types/layout";
import { cellKey, enumeratePerimeterCells, faceVector, vectorToDirection } from "../util/helper";
import {
  makeBeltCell,
  makeContainerCell,
  makeInserterCell,
  makePipeCell,
  makeUndergroundPipeCell,
} from "../util/cellBuilder";

/**
 * 모듈 머신 사이 세로 gap = 0(밀착). 모듈은 **간단 레시피**(W/E 두 면만으로 모든 I/O 를
 * 처리 — demand ≤ 용량이 구조적으로 보장)만 다루므로 N/S 면을 안 쓴다. 트렁크는 W/E 변을
 * 따라 세로로 흐르고 인서터 좌석도 각 머신 면(3칸) 안에 들어가, 머신 사이 공백은 트렁크
 * belt 길이만 늘릴 뿐 아무 기능이 없다 → 밀착. (N/S spill 이 있는 옛 라이브 경로는 ROW_GAP=3
 * 유지.) 복잡 레시피(2D)가 도입되면 그 경로가 자기 gap 을 따로 정한다.
 */
const MODULE_ROW_GAP = 0;

/** 한 모듈 포트 — ring 위 한 점에서 모듈이 외부와 만난다(입력 또는 출력). */
export interface ModulePort {
  /** 이 포트가 운반하는 I/O 줄(품목 + 역할). */
  line: IoLine;
  /** ring 셀 = 모듈 경계 anchor(= 무한상자가 앉는 자리). */
  anchor: { x: number; y: number };
  /**
   * machine-side 탭 셀 = anchor 에서 2칸 안쪽(= 첫 트렁크 belt 셀). anchor 는 chest 가
   * 앉는 ring 자리라, Routing 의 machine 끝점으로 anchor 를 쓰면 chest 끝점과 겹쳐
   * from==to 가 된다. tapAnchor 를 machine 끝점으로 써서 선이 chest↔machine 으로
   * 제대로 이어지게 한다. anchor−2·faceVector(face) 로 결정적·불변(드래그 반전 시
   * chest-side face 는 chest↔tapAnchor 벡터에서 유도). */
  tapAnchor: { x: number; y: number };
  /** 바깥 방향 면(클러스터 → ring). 합성 시 부모 쪽으로 회전 정렬할 기준. */
  face: PortFace;
  /**
   * **moduleWayOuts** — 이 포트의 반출 벨트가 **모듈 자기 몸통**(머신 + 자기/형제 포트의
   * 트렁크·인서터·상자 셀)에 막히지 않고 밖으로 빠져나갈 수 있는 방향들.
   *
   * anchor 에서 각 방향으로 직선을 쏴, 모듈 자기 extent 를 벗어날 때까지 자기 셀에
   * 한 번도 안 막히면 그 방향이 들어간다. 모듈이 **자기 자신에 대해** 답하므로
   * (모듈 = 블랙박스), planner 는 모듈 내부를 들여다보지 않고 이 목록만 본다.
   *
   * 왜 필요한가: 반출 경로 예약([perimeterLanePlanner])이 `meta.side` 만 보고 배정하면
   * 코너 어깨 상자처럼 **그 방향이 형제 트렁크에 막힌** 경우를 못 보고 **못 쓰는 경로를
   * 예약**한다(채널 폭만 낭비되고 방출은 탐색 폴백에 떠넘겨짐). wayOuts 를 주면 예약이
   * 애초에 **뚫린 방향만** 고르므로 "탐색 없이 항상 방출 가능"이라는 예약 철학이 지켜진다.
   *
   * 좌표 무관: 모듈-로컬로 계산해도 방향은 평행이동에 불변이라 절대좌표에서도 그대로 유효.
   */
  moduleWayOuts: PortFace[];
  /** anchor 에 놓인 무한상자(루트 가정의 외부 소스/싱크). 합성 시 벨트 홉으로 교체. */
  chest: Container;
  /** 이 포트의 트렁크 belt 셀(spine). Routing.placed 로 써서 선이 벨트를 따라가게 한다. */
  cells: PlacedCell[];
  /** 산출 근거(planner 슬롯 + 트렁크 seed 점수) — 표시·진단 전용, 좌표 없음. */
  meta: ModulePortMeta;
  /**
   * **링크 그룹 신원** — `${childId}→${parentId}:${item}#${groupIndex}`([linkGroupId]).
   * [MachineLinkGroup]에서 난 포트만 갖는다 — 옛 탭/다이렉트 포트는 없다(undefined). 자식·
   * 부모 양쪽 모듈이 packModuleTree 가 간선당 한 번만 계산해 캐시한 **같은 그룹 객체**를
   * 참조하므로 이 값이 항상 일치한다 — [pairHopPorts] 가 배열 위치 대신 이 값으로 조회한다
   * (2026-07-21, 옛 `seq` 위치-zip 이 방출 실패 시 조용히 밀리던 문제의 근치).
   */
  linkId?: string;
}

export interface GeneratedModule {
  /** 배치된 머신들(모듈-로컬 좌표). */
  machines: Container[];
  /** 포트 무한상자들(입력 source + 출력 sink). */
  chests: Container[];
  /** 트렁크 belt + 인서터 + 상자 ghost 셀(모듈-로컬 좌표). */
  cells: PlacedCell[];
  /** 클러스터 자기 perimeter ring 셀(종착 후보). */
  ring: { x: number; y: number }[];
  /** 입력 포트들(외부 소스 → 머신). */
  inputPorts: ModulePort[];
  /** 출력 포트들(머신 → 외부 싱크). v1 간단 레시피는 보통 1개. */
  outputPorts: ModulePort[];
  /** 머신 bbox(ring 기준). 모듈-로컬에서 항상 {x:0,y:0,...}. */
  bbox: { x: number; y: number; w: number; h: number };
  /**
   * 이 모듈의 판정([insertingPlanner]) — "tap"(트렁크로 합칠 수 있다) 또는 "direct"
   * (1:1 로 남는다) + 거절 사유. **방출기(③) 도착 전까지 판정은 보고만 되고 실제 방출은
   * 늘 다이렉트다** — 계측기가 "몇 모듈이 트렁크가 될 수 있나"를 세는 데 쓴다.
   */
  supply?: InsertingDecisionResult;
  /** 직접 탭/라우팅에 실패한 line(유체·미탭) — 진단용. */
  unroutedLines: IoLine[];
}

export interface ModuleInput {
  /** 머신 prototype + footprint. */
  machine: { entityName: string; w: number; h: number };
  /** 머신 대수(≥ 1). */
  count: number;
  /** 레시피 I/O 줄(입력=ingredients, 출력=products). 등장 순서 보존. */
  lines: IoLine[];
  /** 일반 인서터(reach 1) prototype — 늘 존재 가정. */
  inserterEntityName: string;
  beltEntityName: string;
  /** 긴팔(reach≥2) — 있으면 면당 2레인(용량 4). 없으면 면당 1레인(용량 2). */
  longInserter?: { entityName: string; reach: number };
  /** 인서터별 실제 throughput(items/sec) — depth=운반량 매칭의 슬롯 용량. 미지정=등장순서. */
  throughput?: { normal: number; long: number };
  /** entity id 접두사(결정적). 기본 "mod". */
  idPrefix?: string;
  /**
   * 줄별 포트 끝(DOF-B) 선호 — 키 `${role}:${name}`, 값 "min"(축 작은 끝=위) / "max"
   * (아래). 합성 단계(packModuleTree)가 tidy-tree Y 로 부모↔자식 포트를 마주 보게
   * 정렬할 때 채운다. 미지정 줄은 기존 동작(끝 무선호).
   */
  lineEnds?: Map<string, "min" | "max">;
  /**
   * 노출된 끝면(N/S, 선호 순서) — count=1 완화. external 입력이 W-spill 전에 이 면의
   * 레인을 쓴다(planner E→N/S→W). 노출 판정(열의 끝 + 전역 마진 방향)은 packModuleTree
   * 가 DFS 열-내 순서에서 유도한다. 미지정=기존 동작(W/E 만).
   */
  nsExposure?: ("N" | "S")[];
  /**
   * 트렁크(탭 인서팅) 용량 — 있으면 [insertingPlanner] 의 벨트 처리량 검사가
   * 켜진다. 미지정이면 간단한 레시피 판별만 본다(없는 숫자를 지어내지 않는다).
   */
  supplyCapacity?: SupplyCapacity;
  /**
   * 고를 수 있는 벨트들([BuildSpec.belts](../buildSpec.ts)) — 수요가 벨트 한 줄을 넘을 때
   * [determineBeltCount] 가 여기서 티어를 골라 **줄을 늘린다**. 미지정이면 줄을 안 늘린다
   * (옛 동작: 거절 → 다이렉트). `beltEntityName` 은 기본/폴백 벨트로 남는다.
   */
  belts?: SpecBelt[];
  /**
   * **출력 fan-out 링크** — 이 노드의 출력을 부모 머신들에게 어떻게 나눠 주나
   * ([allocateMachineLinks]). 각 그룹 = 이 클러스터의 한 머신에서 나가는 벨트 하나(목적지
   * 목록 `taps`). 부모를 봐야 정해지므로 부모-무시인 generateModule 이 못 만든다 — 트리를
   * 아는 packModuleTree 가 계산해 넣는다. **있으면 출력 방출이 "줄당 트렁크 하나"(fan-out
   * 병합) 대신 "머신당·목적지별 벨트"로 갈라 나간다.** 미지정(rate 미상 등)이면 옛 트렁크 방출.
   *
   * **그룹 하나 = 물리 벨트 하나 = 포트 한 쌍**([MachineLinkGroup]). v1 은 링크 하나가 곧 그룹 하나다.
   * 신원([linkGroupId])은 그룹 자신의 `id` 필드에 실려 온다 — `ModulePort.linkId` 가 된다.
   */
  outputLinks?: MachineLinkGroup[];
  /**
   * **입력 fan-in 그룹** — `outputLinks` 의 거울: 같은 간선의 같은 그룹을 부모(toMachine)
   * 관점에서 받은 것(같은 [MachineLinkGroup] 객체 — packModuleTree 가 간선당 한 번만 계산해
   * 캐시한 것을 그대로 참조). 그룹마다 입력 트렁크 하나(그룹의 toMachine 들을 세로로 관통하는
   * 벨트 + 머신별 탭)가 나서, 자식 출력 벨트와 **그룹 순서로 1:1** 짝지어진다. 미지정=옛 트렁크 입력.
   */
  inputLinks?: MachineLinkGroup[];
  /**
   * [트렁크 파이프](../../../../docs/auto-layout-wizard.trunk-pipe.md) 계획 — 유체 줄이
   * 있을 때만. 어느 면에 파이프가 달리고 그러려면 머신을 몇 도 돌려야 하는지는 머신
   * 프로토타입의 `fluid_boxes` 가 정하므로, **게임데이터를 보는 호출자**가 계산해 넘긴다
   * (module/ 는 순수 — store 를 안 본다). 계산은 [fluidPorts.chooseMachineDirection].
   */
  fluidTrunk?: {
    /** 이 각도라야 유체 입구가 `side` 면을 본다. 머신 Container.direction 으로 내려간다. */
    direction: Direction;
    /** 파이프가 붙는 면(W 또는 E). 점프 가능하면 상자 칸만, 불가면 depth 1 을 통째로 먹는다. */
    side: PortSide;
    /** 파이프 prototype(예: "pipe"). */
    pipeEntityName: string;
    /**
     * **머신 유체 상자 연결 칸의 footprint 내 위치** — `side` 면 위에서 몇 번째 행/열인가
     * (W/E 면이면 dy, N/S 면이면 dx. = [FluidPortSlot.offset], `chooseMachineDirection` 이
     * 고른 slot 에서 나온다). [pipeJumpToClusterPipe] 는 이 행에서만 점프한다 — 머신마다
     * 자기 행이라 corridor 끼리 안 부딪힌다. 미지정이면 점프 불가(옛 스파인 폴백).
     */
    fluidboxOffset?: number;
    /** 지하파이프 prototype(예: "pipe-to-ground"). 미지정이면 점프 불가(옛 스파인 폴백). */
    undergroundPipeEntityName?: string;
    /** 지하파이프 입출구 좌표 차이 한계([BuildSpec] 동명 필드). 0/미지정 = 점프 불가. */
    pipeMaxUndergroundDistance?: number;
  };
}

/**
 * 한 클러스터를 자족 모듈로 생성. 입력 line 은 supply 트렁크, 출력 line 은 collect
 * 트렁크로 자기 ring 까지 깐다. 각 트렁크의 종착 ring 셀 = 그 line 의 포트 anchor.
 *
 * 결정적: [clusterPortPlanner] 가 줄마다 슬롯(면 W/E·레인 near/far·인서터)을 먼저
 * 못박고, 각 트렁크를 그 슬롯에만 가둔다(faceConstraints). 누적 occupancy 로 같은 면
 * 두 레인의 seat 행이 겹치지 않게 한다. 슬롯은 columnTapCapacity 로 보장돼 미탭 불가.
 */
export function generateModule(input: ModuleInput): GeneratedModule {
  const prefix = input.idPrefix ?? "mod";
  const count = Math.max(1, input.count);

  // ── 링크 면 배정 — **머신을 놓기 전에** ────────────────────────────────────
  // 순서가 뒤집힌 이유: gap 으로 넘어간 그룹은 gap 안에 가로 벨트를 놓고, **gap 폭 = 그
  // gap 을 지나는 가로 벨트 수**다. 폭이 곧 머신 좌표를 정하므로 좌표보다 면이 먼저다.
  // 이 단계는 팔 **수**만 본다(좌표 없음) — 논리 층이 기하를 안 보는 그 성질 그대로다.
  const linkOut = input.outputLinks ?? [];
  const linkIn = input.inputLinks ?? [];

  // **외부 줄(원료·완제품)도 같은 그룹으로 만든다** — 2026-07-23 사장님 결정. 밖과 주고받는
  // 것도 머신 면에 팔을 앉히고 벨트로 나르는 같은 일이라, 상대가 밖이라는 것만 빈 쪽으로
  // 표현하면 아래 배정·방출이 그대로 먹는다([externalLineGroups]).
  // 벨트 한 줄의 운반량 — 고른 벨트 중 가장 빠른 것, 없으면 [SupplyCapacity] 가 들고 온 값.
  const beltTp =
    input.belts?.reduce((m, b) => Math.max(m, b.throughput), 0) || input.supplyCapacity?.beltCapacity;
  const tapTp = input.supplyCapacity?.tapCapacity ?? 0;
  /**
   * **그릇** — 벨트 한 줄에 앉힐 수 있는 팔 수. 쪼갤 때도([externalLineGroups]) 합칠 때도
   * ([mergeParallelBelts]) **같은 수를 본다** — 다르게 보면 한쪽이 쪼갠 걸 다른 쪽이 도로
   * 합쳐 벨트가 넘친다. 모르면 `Infinity`(상한 없음)가 아니라 **합치지 않는다**로 간다.
   */
  const mergeGrail = beltTp && beltTp > 0 && tapTp > 0 ? maxInsertersPerBelt(beltTp, tapTp) : 0;
  const extAll = externalLineGroups(input.lines, count, input.supplyCapacity ?? {}, {
    linkedKeys: new Set([
      ...linkOut.map((g) => `output:${g.item}`),
      ...linkIn.map((g) => `input:${g.item}`),
    ]),
    beltThroughput: beltTp,
    seatsPerFace: input.machine.h, // 선호 면은 언제나 W/E
  });
  const extOut = extAll.filter((g) => g.to.size === 0);
  const extIn = extAll.filter((g) => g.from.size === 0);

  /** 면 배정 한 판 — 장부가 새것이라 몇 번이고 다시 돌릴 수 있다(순수). */
  const assign = (out: MachineLinkGroup[], inn: MachineLinkGroup[]) => {
    const seatLedger = new Map<string, number>();
    // 면마다 **그룹이 몇 개** 앉았나 — 막힌 면의 [[ParallelBelt]](몇 번째가 몇 칸 깊이로 달리나)를
    // 순번으로 정한다. 좌석 장부(팔 수)에서 유도되지 않는 별개의 수다.
    const groupLedger = new Map<string, number>();
    const o = allocateLinkFaces(input.machine, count, out, "from", "W", seatLedger, groupLedger);
    const i = allocateLinkFaces(input.machine, count, inn, "to", "E", seatLedger, groupLedger);
    // 넘침은 나중 — 양쪽의 선호 면 수요가 먼저 자리를 잡은 뒤에 남은 gap 을 다툰다.
    spillLinkFacesToGap(input.machine, count, out, "from", seatLedger, o, groupLedger);
    spillLinkFacesToGap(input.machine, count, inn, "to", seatLedger, i, groupLedger);
    return { out, inn, o, i, seatLedger, groupLedger };
  };

  // **하나라도 자리를 못 잡으면 외부 줄 전체를 물린다** — 그러면 [insertingPlanner] 가 예전처럼
  // 그 줄들을 맡으므로 **오늘 되던 모듈은 계속 된다**. 새 경로는 순수 이득만 가져간다
  // (사장님 방향: "B는 항상 되니 모듈이 안 죽는다").
  //
  // 보는 것이 **외부 줄만이 아니라 전부**인 이유: 외부 줄이 자리를 잡느라 gap 을 먹으면, 정작
  // 밀려나는 건 뒤에 배정되는 **링크 줄**이다(입력 링크가 E 면을 넘쳐 gap 을 찾는데 이미
  // 외부 출력이 앉아 있는 모양 — 2026-07-23 확인). 외부만 보면 그 손해가 안 보인다.
  const ext = extOut.length + extIn.length;
  let asg = assign([...linkOut, ...extOut], [...linkIn, ...extIn]);
  if (ext > 0 && !(asg.o.plans.every((p) => p) && asg.i.plans.every((p) => p)))
    asg = assign(linkOut, linkIn);

  const outLinkGroups = asg.out;
  const inLinkGroups = asg.inn;
  const faceLedger = asg.seatLedger;
  const outFaces = asg.o;
  const inFaces = asg.i;
  const rowGaps = gapRowsFromPlans(count, [outFaces.plans, inFaces.plans]);

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

  // 점유 셀 — 머신 footprint + 이미 놓은 상자·인서터. 1:1 은 슬롯이 겹치지 않아
  // 충돌이 구조적으로 없지만, 안전망으로 유지한다.
  const occupancy = new Set<string>();
  for (const m of machines)
    for (let dx = 0; dx < m.size.w; dx++)
      for (let dy = 0; dy < m.size.h; dy++) occupancy.add(cellKey(m.origin.x + dx, m.origin.y + dy));
  const cells: PlacedCell[] = [];
  const chests: Container[] = [];
  const inputPorts: ModulePort[] = [];
  const outputPorts: ModulePort[] = [];
  const unroutedLines: IoLine[] = [];

  // 유체(pipe) 줄도 planner 로 보낸다 — [트렁크 파이프]가 자리를 잡는다(trunk-pipe §4).
  // fluidTrunk 가 없으면(=호출자가 회전을 못 풀었으면) planner 가 complex 로 위임한다.
  const plannedLines = input.lines;

  // 안내원(planner): 보장된 columnTapCapacity 슬롯을 줄마다 1:1 못박는다
  // (natural-divergence 대체). 각 줄 → {면 W/E, 레인 near/far, 인서터}. 결과 순서가
  // 곧 처리 순서(입력 먼저·near 면부터). complex(과용량·무인서터)면 전부 위임.
  // 공급 방식 판정(docs/auto-layout-wizard.trunk-redesign.md §10) — 트렁크로 합칠 수
  // 있으면 "tap", 안 되면 "direct"(1:1). 거절은 **항상 안전**하다: 1:1 은 구성으로 성립한다.
  //
  // slotsPerFace = 다이렉트 인서팅의 면 용량(그 면의 둘레 칸 수). 이 수는 아래 방출 루프의
  // `lateral`(슬롯 상한)과 **같아야** 한다 — 어긋나면 planner 가 없는 자리를 배정하거나
  // (미탭) 있는 자리를 안 쓴다(스필). 탭 인서팅(면당 2)을 1:1 에 쓰면 3×3 머신의 셋째
  // 입력이 자리가 남는데도 출력면(W)으로 넘친다. (용어: docs/용어사전.md §D)
  // ModuleInput 의 이진 인서터 필드(reach 1 기본 + 긴팔 하나)를 planner 가 먹는 reach
  // 목록으로 번역한다. planner 는 서로 다른 reach 하나당 [ClusterBelt] 한 줄을 세운다 —
  // 지금은 최대 2종(1·긴팔)이라 옛 동작과 동일하지만, 여기 목록이 늘면 벨트 줄도 는다.
  // (BuildSpec.inserters 를 ModuleInput 까지 직접 통과시키는 일은 후속.)
  const plannerInserters: SpecInserter[] = [
    { entityName: input.inserterEntityName, reach: 1, throughput: input.throughput?.normal ?? 0 },
    ...(input.longInserter
      ? [{
          entityName: input.longInserter.entityName,
          reach: input.longInserter.reach,
          throughput: input.throughput?.long ?? 0,
        }]
      : []),
  ];
  // [isJumpableToClusterPipe] — "유체 면에서 파이프가 좌석을 비우고 밖으로 점프할 수 있나".
  // 셋 다 성립해야 true (하나라도 어긋나면 옛 스파인 = 케이스 B 로 **연속적 저하**):
  //  ① 상자 칸 위치를 안다(fluidboxOffset) + 지하파이프를 골랐다.
  //  ② 점프 거리가 최악 폭을 감당한다 — 입구 d1 → 출구 d(2+최대reach), 좌표 차 = 최대reach+1.
  //     (실제 폭은 그 면에 배정된 벨트로 정해져 더 좁을 수 있다 — 여기선 보수적으로 최악.)
  //  ③ 좌석 줄에서 상자 행 1개를 빼고도 벨트 좌석이 남는다: 벨트 수 ≤ 면 좌석 − 1.
  const ft = input.fluidTrunk;
  const maxReach = plannerInserters.reduce((a, i) => Math.max(a, i.reach), 0);
  const isJumpableToClusterPipe =
    !!ft &&
    ft.fluidboxOffset !== undefined &&
    !!ft.undergroundPipeEntityName &&
    (ft.pipeMaxUndergroundDistance ?? 0) >= maxReach + 1 &&
    plannerInserters.length <= input.machine.h - 1;

  // ── 링크 줄 분리 ──────────────────────────────────────────────────────────
  // 링크가 있는 줄은 **자기 기하를 스스로 갖는다**(emitOutputLinks/emitInputLinks) — 그래서
  // tap/direct 판정 대상이 아니다. planner 에서 빼고, 대신 그 줄이 **먹을 좌석을 예약**해
  // 남은 줄들이 정확한 예산을 보게 한다. 안 빼면 두 문제가 생긴다:
  //  ① 링크 줄이 좌석을 넘겨 planner 가 direct 로 떨어지면, 링크 방출이 안 불려 포트가 통째로
  //     사라진다(자식 direct + 부모 tap → 포트 모양이 어긋나 홉이 샌다 — 2026-07-19 실측).
  //  ② planner 가 이미 링크가 찜한 자리를 또 배정해 셀이 겹친다.
  const linkedKeys = new Set([
    ...outLinkGroups.map((g) => `output:${g.item}`),
    ...inLinkGroups.map((g) => `input:${g.item}`),
  ]);
  // 면 배정(위, 좌표 이전)에 이제 좌표를 입힌다.
  //
  // **장부를 둘로 나눈다** — 두 방향이 gap 면을 **양쪽 끝에서 마주 보고** 채우기 때문이다
  // (출력은 서→동, 입력은 동→서). 하나를 같이 쓰면 "이미 1칸 찼다"를 양쪽이 **자기 끝에서**
  // 세어, 출력이 서쪽 첫 칸을, 입력이 "동쪽에서 1칸 건너뛴" 칸을 잡는다 — 폭이 3이면 그 둘이
  // 같은 칸이다(2026-07-23 발견: 좌석 장부는 "3칸 중 3칸"이라 통과시키는데 좌표가 겹쳐, 입력
  // 링크가 emit 단계에서 조용히 unrouted 로 떨어졌다).
  //
  // 총량 검사는 이미 [tryLinkFace] 가 **합친** 장부(faceLedger)로 했다. 합이 면 칸 수 이하이면
  // 서쪽 n칸과 동쪽 m칸은 구조적으로 안 겹치므로, 여기서는 각자 자기 쪽만 세면 된다.
  const outSeats = placeLinkSeats(machines, outFaces.plans, new Map(), false);
  const inSeats = placeLinkSeats(machines, inFaces.plans, new Map(), true); // 입력 포트는 동쪽
  const seatRowsUsed = seatRowsByFace(faceLedger);

  const plannerInput = {
    lines: plannedLines.filter((l) => !linkedKeys.has(`${l.role}:${l.name}`)),
    inserters: plannerInserters,
    outputSide: "W" as const, // 좌우 계층형: 부모=좌=W. 출력을 W 에 먼저 확정((B) 정책).
    nsFaces: input.nsExposure, // 노출 끝면 — external 입력의 W-spill 완화(E→N/S→W).
    slotsPerFace: { WE: input.machine.h, NS: input.machine.w },
    seatRowsUsed, // 링크 방출이 먼저 먹는 행
    pipeSide: input.fluidTrunk?.side, // 유체가 붙는 면.
    isJumpableToClusterPipe, // true=좌석 살림(일반 면), false=옛 스파인(케이스 B).
    belts: input.belts,
  };
  const supply: InsertingDecisionResult = insertingPlanner(
    plannerInput,
    machines.length,
    input.supplyCapacity,
  );

  // ── 링크 방출 — tap/direct 판정과 **무관하게, 언제나 먼저** ────────────────
  // 링크 줄은 planner 를 안 거쳤고(위에서 linkedKeys 로 뺐다) 자기 좌석·벨트·포트를 스스로
  // 놓는다. **아래 !plan.ok 는 링크와 무관한 나머지 줄의 판정**이다 — 그 판정으로 링크
  // 방출을 막으면, 이미 성공한 예약(면 배정·gap 폭이 layoutCluster 에 반영됨)을 시도조차
  // 안 하고 버리게 된다(2026-07-21 발견 — 무관한 판정이 끝난 예약을 삼키는 순서 버그였다).
  // 먼저 놓아야 occupancy 가 채워져, 아래 나머지 줄 방출이 그 자리를 피한다.
  const lineOf = new Map(plannedLines.map((l) => [`${l.role}:${l.name}`, l]));

  /**
   * **합쳐서 깔아 보고, 하나라도 막히면 [[ParallelBelt]] 그대로 다시 깐다.**
   *
   * 되돌리기가 싸다: 막힌 그룹은 셀·상자·점유에 **아무 흔적도 안 남기고** 물러나고
   * ([emitOutputLinks] 의 `push`/`blocked`), 이미 성공한 그룹만 지우면 된다. 그래서 길이
   * 되돌리기 + 점유 스냅샷이면 충분하다.
   *
   * 실패가 손해가 아니라는 것이 이 순서의 전부다 — 합치기는 통로 트랙을 아끼는 **최적화**일
   * 뿐이고, 못 아끼면 원래 모양이 그대로 남는다.
   */
  const tryMerged = (
    emit: (groups: MachineLinkGroup[], seats: (LinkSeats | undefined)[]) => void,
    groups: MachineLinkGroup[],
    seats: (LinkSeats | undefined)[],
    side: "from" | "to",
    ports: ModulePort[],
  ): void => {
    if (groups.length === 0) return;
    const merged = mergeParallelBelts(groups, seats, side, mergeGrail);
    if (merged.groups.length === groups.length) return emit(groups, seats); // 합칠 게 없었다
    const snap = {
      cells: cells.length, chests: chests.length, ports: ports.length,
      unrouted: unroutedLines.length, occ: new Set(occupancy),
    };
    emit(merged.groups, merged.seats);
    if (unroutedLines.length === snap.unrouted) return; // 전부 깔렸다 — 합친 채로 간다
    cells.length = snap.cells;
    chests.length = snap.chests;
    ports.length = snap.ports;
    unroutedLines.length = snap.unrouted;
    occupancy.clear();
    for (const k of snap.occ) occupancy.add(k);
    emit(groups, seats);
  };

  tryMerged(
    (g, s) => {
      const m = new Map(g.map((x) => [x.item, lineOf.get(`output:${x.item}`)!]));
      emitOutputLinks({ groups: g, seats: s, lineOf: m, machines, input, prefix, occupancy, cells, chests, outputPorts, unroutedLines });
    },
    outLinkGroups, outSeats, "from", outputPorts,
  );
  tryMerged(
    (g, s) => {
      const m = new Map(g.map((x) => [x.item, lineOf.get(`input:${x.item}`)!]));
      emitInputLinks({ groups: g, seats: s, lineOf: m, machines, input, prefix, occupancy, cells, chests, inputPorts, unroutedLines });
    },
    inLinkGroups, inSeats, "to", inputPorts,
  );

  const plan = supply.plan;
  if (!plan.ok) {
    // 링크가 없는 나머지 줄만 unrouted — 링크 줄은 위에서 이미 성패가 갈렸다(자기 몫만
    // unroutedLines 에 넣거나 포트를 냈다). 여기서 다시 넣으면 성공한 링크까지 오염된다.
    for (const l of plannedLines) if (!linkedKeys.has(`${l.role}:${l.name}`)) unroutedLines.push(l);
    fillModuleWayOuts(machines, cells, [...inputPorts, ...outputPorts]);
    return { machines, chests, cells, ring, inputPorts, outputPorts, bbox, unroutedLines, supply };
  }

  // ── 방출 ────────────────────────────────────────────────────────────────────
  // [insertingPlanner] 의 판정에 따라 갈라진다:
  //
  //  - **탭 인서팅**(트렁크): 면을 belt 한 줄이 훑고 머신들이 그 줄을 인서터로 나눠 집는다.
  //    포트 = 벨트 끝 하나 → 모듈 경계 포트가 **품목당 1개**로 준다.
  //  - **다이렉트 인서팅**(1:1): 머신마다 자기 상자+인서터. 포트 = 머신 × 품목.
  //
  // 어느 쪽이든 **탐색이 없다** — 자리는 planner 가 이미 못박았고 방출기는 깔기만 한다.
  if (supply.mode === "tap") {
    // 나머지 줄(유체·링크 없는 줄)만 — 링크 줄은 위에서 이미 놓았고 plan 에도 없다.
    // [탭 인서팅]([emitTapInserting])과 [트렁크 파이프]([emitTrunkPipe])는 용어사전이 이미
    // "나란한 유체판"으로 갈라놓은 두 개념이다 — 둘 다 같은 [buildTrunkContext](기둥 extent·
    // stagger 기준)를 보고, 같은 seqRef 로 chestId 순번을 이어 쓰되, 서로의 줄을 건드리지
    // 않는다(item ↔ pipe 는 line.kind 로 배타적).
    const ctx = buildTrunkContext(plan, machines, input, isJumpableToClusterPipe);
    const seqRef = { n: 0 };
    emitTapInserting({
      plan, machines, input, prefix, occupancy,
      cells, chests, inputPorts, outputPorts, unroutedLines,
      ctx, seqRef,
    });
    emitTrunkPipe({
      plan, machines, input, prefix, occupancy,
      cells, chests, inputPorts, outputPorts, unroutedLines,
      ctx, seqRef,
    });
    fillModuleWayOuts(machines, cells, [...inputPorts, ...outputPorts]);
    return { machines, chests, cells, ring, inputPorts, outputPorts, bbox, unroutedLines, supply };
  }

  // ── 다이렉트 인서팅(1:1) 방출 ───────────────────────────────────────────────
  // 한 (머신, 품목, 팔 하나) = 두 칸뿐이다:
  //     [상자] [인서터] [머신 …]      (W 면 예: x=-2, x=-1, x=0..2)
  // 같은 면의 줄들은 **서로 다른 행**(슬롯)을 쓰므로 절대 부딪히지 않는다 — 자리 잡기가
  // 곧 성공이고, 탐색이 없다. 상자 바깥쪽은 늘 비어 있어 **모든 포트의 바깥 탈출로가
  // 구성으로 보장**된다(우선순위 ②).
  //
  // 트렁크가 이 경로를 대체하지 **않는다** — 트렁크가 거절되면(복잡한 레시피·용량 초과)
  // 언제나 여기로 돌아온다. 그게 "거절은 항상 안전하다"의 실체다.
  //
  // **[requiredInserterCount] 만큼 팔을 놓는다.** 인서터 하나가 나르는 양은 유한하므로,
  // 머신 한 대의 수요가 그걸 넘으면 팔이 여러 개 필요하다 — 이건 탭이냐 다이렉트냐와
  // 무관한 물리량이다. 탭은 그 팔들을 같은 [ClusterBelt] 에 앉히고([Parallel Inserting]),
  // 다이렉트는 **팔마다 자기 상자**를 준다: 상자 한 칸의 이웃은 4칸뿐이고 인서터는 상자와
  // 머신 **양쪽에 닿아야** 하므로 팔을 늘리려면 상자도 늘어야 한다. 그래서 한 줄이 면의
  // 행을 `arms` 개 먹고, 포트도 그만큼 는다(= 상자 여러 개가 머신 한 대를 먹인다).
  //
  // 예전엔 이 수를 **묻지도 않고** 줄당 팔 하나만 놓고 "성공"이라 보고했다 — 초당 8개를
  // 먹는 머신에 초당 0.667개짜리 인서터 하나가 붙은 배치가 나왔다(2026-07-16 실측).
  const slotOnFace = new Map<PlannedSide, number>(); // 면별로 소비한 행/열 슬롯 수
  let seq = 0;
  for (const planned of plan.lines) {
    const line = planned.line;
    if (line.kind !== "belt") {
      // 다이렉트 인서팅은 유체를 못 다룬다(인서터로 유체를 옮길 수 없다) — planner 가 이미
      // complex 로 막지만(fluid-requires-trunk-pipe) 안전망으로 둔다.
      unroutedLines.push(line);
      continue;
    }
    const face = planned.side as PortFace;
    const fv = faceVector(face);
    const lateral = face === "W" || face === "E" ? input.machine.h : input.machine.w;
    // 수량을 모르면(lineRates 에 없던 줄) 보류값 1 — 없는 숫자를 지어내지 않는다.
    const arms = Math.max(1, planned.requiredInserterCount ?? 1);
    const slot = slotOnFace.get(planned.side) ?? 0;
    if (slot + arms > lateral) {
      // 이 면에 팔을 다 앉힐 행이 없다. 팔 개수는 협상 대상이 아니므로(레시피·머신·인서터가
      // 정한다) 줄여서 놓으면 **굶는 배치**가 된다 — 못 놓는다고 정직하게 말한다.
      unroutedLines.push(line);
      continue;
    }
    slotOnFace.set(planned.side, slot + arms);

    for (const m of machines) {
      for (let k = 0; k < arms; k++) {
      // 인서터가 앉는 머신 둘레 칸(rim) — 면 위에서 slot+k 번째. 팔마다 자기 행.
      const seat = rimCell(m, face, slot + k);
      const chestAt = { x: seat.x + fv.x, y: seat.y + fv.y };
      if (occupancy.has(cellKey(seat.x, seat.y)) || occupancy.has(cellKey(chestAt.x, chestAt.y))) {
        continue; // 기둥 중간 머신의 N/S 면 등 — 슬롯 모델상 안 생기지만 안전망.
      }

      const chestId = `${prefix}-${line.role}-${line.name}-${seq++}`;
      const chest: Container = {
        id: chestId,
        kind: "infinity-chest",
        entityName: "infinity-chest",
        origin: { ...chestAt },
        size: { w: 1, h: 1 },
        content: line.name,
        role: line.role,
      };
      chests.push(chest);

      // 인서터 방향 = **집는 쪽**(cellBuilder 규약). 입력이면 상자(바깥)에서 집어 머신에
      // 넣고, 출력이면 머신(안쪽)에서 집어 상자에 놓는다.
      const pickup = line.role === "input" ? fv : { x: -fv.x, y: -fv.y };
      const pair: PortPair = {
        producer: { containerId: line.role === "input" ? chestId : m.id, cell: { ...seat }, face, kind: "item" },
        consumer: { containerId: line.role === "input" ? m.id : chestId, cell: { ...seat }, face, kind: "item" },
      };
      const lineCells: PlacedCell[] = [
        makeContainerCell(chest, chestAt),
        makeInserterCell(seat, pickup, input.inserterEntityName, pair),
      ];
      for (const c of lineCells) {
        cells.push(c);
        occupancy.add(cellKey(c.x, c.y));
      }

      const port: ModulePort = {
        line,
        anchor: { ...chestAt },
        // machine-side 끝점 = anchor 에서 안쪽 2칸 = 머신 가장자리 칸. Routing 선이
        // chest↔machine 으로 이어지게 한다(from==to 방지). 벨트가 없어도 규약은 같다.
        tapAnchor: { x: chestAt.x - 2 * fv.x, y: chestAt.y - 2 * fv.y },
        face,
        // 전 포트 emit 후 한꺼번에 채운다(아래 fillModuleWayOuts).
        moduleWayOuts: [],
        chest,
        cells: [], // 모듈 안에 벨트가 없다 — 트렁크 spine 부재.
        meta: {
          item: line.name,
          side: planned.side,
          laneDepth: 2, // 상자는 머신 면에서 늘 2칸(인서터 1 + 상자 1).
          inserter: "normal", // 1:1 은 reach 1 로 충분 — 긴팔 불필요.
          amount: line.amount,
          endPreference: input.lineEnds?.get(`${line.role}:${line.name}`),
        },
      };
      if (line.role === "output") outputPorts.push(port);
      else inputPorts.push(port);
      }
    }
  }

  // 전 포트 emit 완료 → 모듈 몸통이 확정됐으니 각 포트의 moduleWayOuts 를 채운다.
  fillModuleWayOuts(machines, cells, [...inputPorts, ...outputPorts]);

  return {
    machines,
    chests,
    cells,
    ring,
    inputPorts,
    outputPorts,
    bbox,
    unroutedLines,
    supply,
  };
}

/**
 * 각 포트의 [ModulePort.moduleWayOuts] 를 채운다 — 모듈이 **자기 몸통**을 근거로
 * "이 포트가 어느 쪽으로 나갈 수 있나"에 답하는 자리.
 *
 * 몸통 = 머신 footprint + 모든 placed 셀(트렁크·인서터·상자 ghost). 상자 ghost 와 그
 * 인서터도 장애물로 센다 — 재배치 때 그 두 칸은 belt 로 다시 깔리므로(modulePerimeterPass
 * 가 path=[feeder, anchor, …] 로 재사용) **여전히 점유 상태**이기 때문이다.
 *
 * 판정: anchor 바로 다음 칸부터 그 방향으로 걸어가며, 몸통 extent 안에 있는 동안 한 칸도
 * 막히지 않고 extent 를 벗어나면 그 방향은 "나갈 수 있다". extent 밖 = 모듈 바깥(채널·마진)
 * 이라 여기선 관심 없다(그쪽은 채널 장부가 따로 예약한다).
 */
function fillModuleWayOuts(
  machines: Container[],
  cells: PlacedCell[],
  ports: ModulePort[],
): void {
  const occ = new Set<string>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const mark = (x: number, y: number) => {
    occ.add(cellKey(x, y));
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const m of machines)
    for (let dx = 0; dx < m.size.w; dx++)
      for (let dy = 0; dy < m.size.h; dy++) mark(m.origin.x + dx, m.origin.y + dy);
  for (const c of cells) mark(c.x, c.y);

  const FACES: PortFace[] = ["N", "E", "S", "W"];
  for (const port of ports) {
    const wayOuts: PortFace[] = [];
    for (const face of FACES) {
      const fv = faceVector(face);
      let x = port.anchor.x + fv.x;
      let y = port.anchor.y + fv.y;
      let clear = true;
      // 몸통 extent 안에 있는 동안만 검사 — 벗어나면 탈출 성공.
      while (x >= minX && x <= maxX && y >= minY && y <= maxY) {
        if (occ.has(cellKey(x, y))) { clear = false; break; }
        x += fv.x;
        y += fv.y;
      }
      if (clear) wayOuts.push(face);
    }
    port.moduleWayOuts = wayOuts;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 탭 인서팅 방출 — 트렁크 belt 한 줄 + 머신마다 탭 인서터 1개
// (docs/auto-layout-wizard.trunk-redesign.md §10.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 면(face)의 depth `d` 칸 — 머신 면에서 바깥으로 d 칸, 그 면을 따라 `t` 위치.
 * `d=0` 은 머신 자신의 가장자리, `d=1` 은 인서터 좌석, `d≥2` 는 belt 레인.
 * W/E 면이면 `t` 는 y(행), N/S 면이면 `t` 는 x(열)다.
 */
function faceCell(
  ext: { x0: number; y0: number; x1: number; y1: number },
  face: PortFace,
  d: number,
  t: number,
): { x: number; y: number } {
  switch (face) {
    case "W": return { x: ext.x0 - d, y: t };
    case "E": return { x: ext.x1 + d, y: t };
    case "N": return { x: t, y: ext.y0 - d };
    case "S": return { x: t, y: ext.y1 + d };
  }
}

/**
 * reach≥2 [ClusterBelt](docs/용어사전.md)는 가까운 벨트를 **넘어서** 집어야 하므로 긴팔이어야
 * 한다. (ModuleInput 이 긴팔 하나만 담는 v1: reach≥2 → 그 긴팔, reach 1 → 기본 인서터.)
 */
function tapInserterName(input: ModuleInput, planned: PlannedLine): string {
  return (planned.reach ?? 1) >= 2 && input.longInserter
    ? input.longInserter.entityName
    : input.inserterEntityName;
}

/**
 * **링크 포트의 상자·짝** — 트렁크 끝(포트가 붙는 belt 칸)에서 `[belt끝][인서터][상자]` 의
 * 상자 자리(anchor)와 그 짝([PortPair])을 낸다. [emitOutputLinks]·[emitInputLinks] 공통.
 *
 * belt 셀들이 이 `portPair` 를 참조하므로 **belt 를 깔기 전에** 불러야 한다. 방출 방식이
 * 출력/입력에서 뒤집히는 축은 **흐름 방향** 하나뿐이다: 출력은 머신→상자(collect), 입력은
 * 상자→머신(supply). 그래서 producer/consumer 만 role 로 갈린다.
 */
function makeLinkPortChest(o: {
  role: "input" | "output";
  trunkEnd: { x: number; y: number };
  portFace: PortFace;
  pfv: { x: number; y: number };
  line: IoLine;
  machineId: string;
  chestId: string;
}): { chest: Container; portPair: PortPair; seatCell: { x: number; y: number }; chestAt: { x: number; y: number } } {
  const seatCell = { x: o.trunkEnd.x + o.pfv.x, y: o.trunkEnd.y + o.pfv.y }; // 포트 인서터
  const chestAt = { x: o.trunkEnd.x + 2 * o.pfv.x, y: o.trunkEnd.y + 2 * o.pfv.y }; // 포트 상자(anchor)
  const chest: Container = {
    id: o.chestId, kind: "infinity-chest", entityName: "infinity-chest",
    origin: { ...chestAt }, size: { w: 1, h: 1 }, content: o.line.name, role: o.role,
  };
  const port = (id: string) => ({ containerId: id, cell: { ...o.trunkEnd }, face: o.portFace, kind: "item" as const });
  const portPair: PortPair =
    o.role === "output"
      ? { producer: port(o.machineId), consumer: port(o.chestId) } // 머신 → 상자
      : { producer: port(o.chestId), consumer: port(o.machineId) }; // 상자 → 머신
  return { chest, portPair, seatCell, chestAt };
}

/**
 * **링크 포트의 끝을 놓는다** — belt 를 깐 뒤 `[포트 인서터][상자]` 를 세우고 [ModulePort]
 * 를 push 한다. [emitOutputLinks]·[emitInputLinks] 공통. belt 셀은 caller 가 이미 만들어
 * 넘긴다(`beltCells`). 좌석 탭 인서터도 caller 가 이 함수 **전에** 놓는다(cells 순서 보존).
 *
 * role 로 갈리는 것: 포트 인서터의 **집는 쪽**(출력은 belt→상자 = −pfv, 입력은 상자→belt =
 * pfv), 포트가 서는 **변**(meta.side: 출력 W · 입력 E), `endPreference` 조회 키.
 */
function pushLinkPortEnd(o: {
  role: "input" | "output";
  seatCell: { x: number; y: number };
  chestAt: { x: number; y: number };
  chest: Container;
  portPair: PortPair;
  portFace: PortFace;
  pfv: { x: number; y: number };
  beltCells: PlacedCell[];
  line: IoLine;
  linkId?: string;
  tapAnchor: { x: number; y: number };
  laneDepth: number;
  inserterEntityName: string;
  lineEnds: ModuleInput["lineEnds"];
  cells: PlacedCell[];
  chests: Container[];
  occupancy: Set<string>;
  ports: ModulePort[];
}): void {
  const pickup = o.role === "output" ? { x: -o.pfv.x, y: -o.pfv.y } : o.pfv;
  o.cells.push(
    ...o.beltCells,
    makeInserterCell(o.seatCell, pickup, o.inserterEntityName, o.portPair),
    makeContainerCell(o.chest, o.chestAt),
  );
  for (const c of o.beltCells) o.occupancy.add(cellKey(c.x, c.y));
  o.occupancy.add(cellKey(o.seatCell.x, o.seatCell.y));
  o.occupancy.add(cellKey(o.chestAt.x, o.chestAt.y));
  o.chests.push(o.chest);
  o.ports.push({
    line: o.line, anchor: { ...o.chestAt }, tapAnchor: o.tapAnchor, face: o.portFace,
    moduleWayOuts: [], chest: o.chest, cells: o.beltCells, linkId: o.linkId,
    meta: {
      item: o.line.name, side: o.role === "output" ? "W" : "E", laneDepth: o.laneDepth,
      inserter: o.laneDepth === 2 ? "normal" : "long",
      amount: o.line.amount, endPreference: o.lineEnds?.get(`${o.role}:${o.line.name}`),
    },
  });
}

/**
 * **탭 인서터가 앉는 clusterBeltDepth** — 벨트 깊이에서 인서터의 팔 길이(reach)를 뺀 값.
 *
 * 인서터는 자기 자리에서 reach 만큼 **바깥에서 집고 안쪽에 놓는다**. 그러니 `벨트 깊이 − reach`
 * 가 곧 앉을 자리다. 세 경우가 한 식에서 나온다:
 *
 * | 벨트 | clusterBeltDepth | reach | 좌석 |
 * |---|---|---|---|
 * | 가까운(reach 1)       | 2 | 1 | **1** |
 * | 먼(reach 2)           | 3 | 2 | **1** |
 * | 케이스 B(파이프 넘김) | 4 | 2 | **2** ← 1칸은 트렁크 파이프가 먹었다 |
 */
function tapSeatDepth(planned: PlannedLine): number {
  return planned.clusterBeltDepth - (planned.reach ?? 1);
}

/**
 * 링크 그룹 하나가 앉을 **면** — 좌표가 생기기 **전에** 팔 수만으로 정한다.
 *
 * 순서가 이렇게 뒤집힌 이유: N/S 면(=gap)에 앉는 그룹은 gap 안에 가로 벨트 한 줄을 놓고,
 * **gap 폭 = 그 gap 을 지나는 가로 벨트 수**다. 폭이 머신 좌표를 정하므로, 좌표를 알기 전에
 * 면부터 정해야 한다(폭은 우리가 고르는 값이 아니라 배정의 부산물).
 */
interface LinkFacePlan {
  /** W/E = 머신 옆면(세로 벨트) · N/S = gap(가로 벨트). */
  face: PortFace;
  /** N/S 일 때 가로 벨트를 놓을 gap index — 머신 `gap` 과 `gap+1` 사이. */
  gap?: number;
  /**
   * 이 그룹의 벨트가 앉을 **면에서의 깊이**([faceCell] 의 `d`). 좌석은 언제나 d1 이므로
   * 이 값이 곧 **이 그룹이 면 바깥으로 먹는 줄 수**다 — gap 폭이 여기서 나온다
   * ([gapRowsFromPlans])**이자** 방출기가 벨트를 놓는 깊이다([emitOutputLinks]).
   * 두 곳이 같은 필드를 보므로 폭과 기하가 어긋날 수 없다.
   */
  laneDepth: number;
  /**
   * **반출 깊이 — gap 전용**(docs/auto-layout-wizard.cluster-redesign.md 의 "반출" 단).
   *
   * W/E 면에서는 빠져나가는 방향이 면과 **수직**이라, 벨트가 자기 좌석 구간만 덮고 끝에서
   * 꺾으면 그만이다(그래서 여러 그룹이 같은 깊이를 나눠 쓴다). gap 은 다르다 — 나가는 쪽
   * (부모=서쪽)이 면과 **평행**이라 모든 벨트가 서쪽 변까지 달려야 하고, 같은 줄 두 벨트는
   * 반드시 합쳐진다.
   *
   * 그래서 이 면의 **n 번째 그룹은 한 칸 더 깊은 줄로 내려가서** 달린다. 내려가는 건
   * **벨트가 벨트를 먹이는 것**이라 팔 길이와 무관하다 — 팔은 `laneDepth`(수집 줄)까지만
   * 닿으면 된다. 첫 그룹은 `laneDepth` 와 같다(내려갈 것도 없이 이미 서쪽 변에서 시작).
   */
  exitDepth?: number;
  /** 이 그룹이 쓰는 머신 index → 팔 수. */
  arms: Map<number, number>;
}

/**
 * 링크 그룹 하나가 실제로 앉은 자리 — 면 + 머신마다 쓰는 **면 위 위치** `t`.
 * `t` 는 [faceCell] 과 같은 뜻이다: W/E 면이면 y(행), N/S 면이면 x(열).
 */
interface LinkSeats extends LinkFacePlan {
  /** 머신 index → 그 머신 면에서 이 그룹이 쓰는 연속 `t` 값들. */
  slots: Map<number, number[]>;
}

/** 좌석 장부의 열쇠 — 머신 하나의 한 면. 면마다 예산이 따로다(`machine.h` 행). */
function seatKey(machineIndex: number, face: PortFace): string {
  return `${machineIndex}:${face}`;
}

/**
 * 그룹이 머신마다 몇 팔을 쓰나. `side` 는 이 그룹을 **어느 쪽 관점**에서 보나다 —
 * "from"(출력, 자식 머신 하나 고정) 이면 항목이 하나뿐이고, "to"(입력, 부모 머신 여럿)
 * 이면 `taps` 를 그대로 목적지별로 편다.
 */
function armsByMachine(group: MachineLinkGroup, side: "from" | "to"): Map<number, number> {
  // 구조가 대칭이라 그냥 그쪽을 본다([MachineLinkGroup] — 2026-07-23 정의 확장 전에는
  // fromMachine(스칼라)과 taps(배열)를 각각 풀어 Map 으로 만들어야 했다).
  return group[side];
}

/**
 * 링크 벨트의 기본 깊이 — 좌석(d1) 바로 바깥. v1 은 그룹마다 이 한 줄뿐이다
 * (레인 늘리기 = 긴팔로 d≥3 을 집는 것은 후속).
 */
const LINK_LANE_DEPTH = 2;

/**
 * 그룹 하나를 이 면에 앉혀 본다 — **장부는 안 건드린다**(확정은 호출자가 한다).
 * 그룹이 여러 머신을 관통하면(입력 트렁크) **전부** 들어가야 성공이다 — 벨트 하나를 반만
 * 옮길 수는 없다.
 *
 * 면마다 한계가 **좌석 수 하나**다(2026-07-22). 예전엔 좌석과 별개로 **depth(레인)** 도
 * 다퉜다 — 벨트가 면을 따라 끝까지 달렸기 때문에 같은 depth 두 줄이 반드시 부딪혔고, 그래서
 * 한 면의 줄 수가 팔 길이 종류 수에 묶였다. 이제 벨트는 **자기 좌석 구간만 덮고 끝에서 포트
 * 쪽으로 꺾으므로**([emitOutputLinks]) 행 구간이 안 겹치는 그룹끼리는 **같은 depth 를 그냥
 * 나눠 쓴다.** 다툴 게 없으니 장부도 없다.
 *
 *  - **W/E**: 머신 옆면의 d1 칸 = `machine.h` 개. 여러 그룹이 행을 나눠 쓴다.
 *  - **N/S(gap)**: 머신 위/아래 면의 d1 칸 = `machine.w` 개. v1 은 **면당 그룹 하나**
 *    (가로 벨트 한 줄만 깐다). 그리고 그 방향에 **gap 이 실제로 있어야** 한다: 맨 위 머신에
 *    N gap 은 없고, 맨 아래 머신에 S gap 은 없다.
 */
function tryLinkFace(
  machine: { w: number; h: number },
  count: number,
  group: MachineLinkGroup,
  side: "from" | "to",
  face: PortFace,
  used: Map<string, number>,
  faceGroups: Map<string, number>,
): LinkFacePlan | undefined {
  const arms = armsByMachine(group, side);
  for (const mi of arms.keys()) if (mi < 0 || mi >= count) return undefined;
  // **머신 여럿에 걸친 그룹은 v1 이 앉히지 못한다** — 그러려면 벨트가 남의 머신 행을 관통해야
  // 하고, 관통하는 순간 다른 그룹과 depth 를 다퉈야 한다(그 다툼을 없앤 게 이번 재설계다).
  // v1 의 [edgeLinkGroups] 는 tap 이 하나뿐인 그룹만 내므로 여기 걸릴 일이 없지만, 걸리면
  // 조용히 겹치는 대신 **정직하게 자리 없음**으로 떨어뜨린다(병합을 되살릴 때 여기가 관문).
  if (arms.size !== 1) return undefined;

  if (face === "N" || face === "S") {
    const [mi, k] = [...arms][0];
    // **클러스터 양 끝은 gap 이 아니라 바깥이다.** 맨 위 머신의 N, 맨 아래 머신의 S 에는
    // 이웃이 없어 벨트가 모듈 밖으로 나간다 — 그래서 `gap` 이 `undefined` 이고, 벌릴 gap 도
    // 없다([gapRowsFromPlans] 가 안 센다). 자리는 그냥 **바깥으로 자란다**: 모듈이 차지하는
    // 범위는 `moduleExtent`(머신 ∪ 모든 셀)라 배치가 이 셀들을 이미 셈에 넣는다.
    const g = face === "S" ? mi : mi - 1;
    const gap = g >= 0 && g < count - 1 ? g : undefined;
    const base = used.get(seatKey(mi, face)) ?? 0;
    if (base + k > machine.w) return undefined; // 이 면의 좌석(열)이 다 찼다
    // **[[ParallelBelt]] — 막힌 면** — 이 면의 몇 번째 그룹인가가 곧 자기 줄의 깊이다
    // (탐색 없이 순번으로 결정. 줄이 달라야 두 벨트가 **합류하지 않는다**).
    // 좌석 수가 아니라 **그룹 수**로 세는 이유: 서쪽으로 달리는 줄은 그룹마다 하나씩이지
    // 팔마다 하나가 아니다. 첫 그룹은 서쪽 변에서 시작하므로 내려갈 필요가 없다.
    const nth = faceGroups.get(seatKey(mi, face)) ?? 0;
    return { face, gap, arms, laneDepth: LINK_LANE_DEPTH, exitDepth: LINK_LANE_DEPTH + nth };
  }

  for (const [mi, k] of arms) {
    if ((used.get(seatKey(mi, face)) ?? 0) + k > machine.h) return undefined;
  }
  return { face, arms, laneDepth: LINK_LANE_DEPTH };
}

/**
 * [tryLinkFace] 가 낸 배정을 장부에 확정한다 — 좌석(팔 수)과 그룹 수를 따로 센다.
 * 둘은 유도가 안 된다: 좌석은 **팔마다** 하나, 반출 줄은 **그룹마다** 하나다.
 */
function commitLinkFace(plan: LinkFacePlan, used: Map<string, number>, faceGroups: Map<string, number>): void {
  for (const [mi, k] of plan.arms) {
    const key = seatKey(mi, plan.face);
    used.set(key, (used.get(key) ?? 0) + k);
    faceGroups.set(key, (faceGroups.get(key) ?? 0) + 1);
  }
}

/**
 * **링크 면 배정 — 선호 면부터 채우고, 차면 gap 으로 넘어간다.**
 *
 * 머신 하나의 한 면에는 인서터가 `machine.h` 개까지만 앉는다(d1 칸이 그것뿐이다). 팔이 그보다
 * 많으면(거대 출력) 다른 면으로 넘길 수밖에 없다. **넘어갈 곳은 N/S(gap) 뿐이다:**
 * 반대 옆면(E)으로 넘기면 벨트가 채널 반대쪽에서 출발해 **되돌아올 길이 없다**(gap 이 0 이면
 * 클러스터를 통째로 돌아야 한다). N/S 로 넘기면 가로 벨트가 gap 을 따라 서쪽 변까지 와서
 * 90° 꺾이고, **그 꺾이는 칸이 곧 평범한 W 포트**가 된다 — 채널 장부가 이미 아는 모양이다.
 *
 * 두 단계로 나눈 이유(굶주림 방지): 출력은 W, 입력은 E 를 선호한다. 출력을 통째로 먼저
 * 처리하면 출력의 넘침이 gap 을 먼저 먹어 입력이 굶는다. 그래서
 *  - 1단계: 출력·입력 **양쪽의 선호 면 수요**를 먼저 앉히고,
 *  - 2단계: 그러고 남은 gap 을 넘침끼리 다툰다.
 *
 * 못 앉은 그룹은 `undefined` — 방출기가 정직하게 `unrouted` 로 낸다.
 */
function allocateLinkFaces(
  machine: { w: number; h: number },
  count: number,
  groups: MachineLinkGroup[],
  side: "from" | "to",
  prefer: PortFace,
  used: Map<string, number>,
  faceGroups: Map<string, number>,
): { plans: (LinkFacePlan | undefined)[]; deferred: number[] } {
  const plans: (LinkFacePlan | undefined)[] = groups.map(() => undefined);
  const deferred: number[] = [];
  groups.forEach((g, i) => {
    const plan = tryLinkFace(machine, count, g, side, prefer, used, faceGroups);
    if (plan) {
      commitLinkFace(plan, used, faceGroups);
      plans[i] = plan;
    } else deferred.push(i);
  });
  return { plans, deferred };
}

/**
 * [allocateLinkFaces] 의 2단계 — 선호 면이 찬 그룹을 gap 으로 넘긴다.
 * 아래 gap(S)을 먼저 본다: 링크 수열이 위→아래 단조라 아래쪽이 뒤에 오는 목적지와 가깝다.
 */
function spillLinkFacesToGap(
  machine: { w: number; h: number },
  count: number,
  groups: MachineLinkGroup[],
  side: "from" | "to",
  used: Map<string, number>,
  out: { plans: (LinkFacePlan | undefined)[]; deferred: number[] },
  faceGroups: Map<string, number>,
): void {
  for (const i of out.deferred) {
    for (const face of ["S", "N"] as const) {
      const plan = tryLinkFace(machine, count, groups[i], side, face, used, faceGroups);
      if (!plan) continue;
      commitLinkFace(plan, used, faceGroups);
      out.plans[i] = plan;
      break;
    }
  }
}

/**
 * **gap 폭 = 그 gap 에 놓일 것들이 먹는 줄 수.** 우리가 고르는 값이 아니라 배정의 부산물이다.
 *
 * 한쪽 면이 먹는 줄 = 좌석(d1) … 벨트(d`laneDepth`) = `laneDepth` 줄. 양쪽이 쓰면 각자
 * 자기 머신 면에서 재므로 그냥 더해진다(위 머신은 위에서, 아래 머신은 아래에서 센다).
 *
 * 이 수는 방출기가 벨트를 놓을 때 쓰는 `laneDepth` **바로 그 값**이다 — 상수를 따로 적어두면
 * 방출 기하가 바뀔 때 폭이 조용히 안 따라와 벨트가 옆 머신 몸통에 놓인다.
 *
 * **더하기가 맞는 이유는 전제 하나에 달려 있다: 한 면에는 그룹이 하나뿐**([tryLinkFace] 의
 * N/S 분기가 `used > 0` 이면 거절하고, 그 장부는 출력·입력이 공유한다). 그래서 한 gap 에
 * 들어오는 계획은 최대 둘이고 그 둘은 **반드시 다른 면**(위 머신의 S, 아래 머신의 N)이라,
 * 각자 자기 쪽에서 세므로 그냥 더하면 된다.
 *
 * **그 전제를 푸는 사람에게(면당 여러 줄):** 같은 면의 둘째 그룹은 첫 그룹을 **덮는 게 아니라
 * 한 줄 더 바깥**이므로(d2 옆에 d3), 그때는 같은 면끼리 `max` 를 잡고 **면 둘을 더해야** 한다.
 * 지금처럼 전부 더하면 안 쓰는 줄만큼 클러스터가 조용히 벌어진다(2026-07-22 확인 — 지금은
 * 발현 불가라 산술을 미리 안 바꿨다).
 */
function gapRowsFromPlans(count: number, plans: (LinkFacePlan | undefined)[][]): number[] {
  // 같은 면의 그룹들은 **덮어쓰는 게 아니라 한 줄씩 더 깊어지므로** 가장 깊은 것 하나만
  // 세고(max), 마주 보는 두 면은 각자 자기 쪽에서 재므로 더한다(sum).
  const deepest = new Map<string, number>(); // `gap:face` → 그 면이 먹는 줄 수
  for (const list of plans)
    for (const p of list) {
      if (!p || p.gap === undefined) continue;
      const key = `${p.gap}:${p.face}`;
      const d = p.exitDepth ?? p.laneDepth;
      deepest.set(key, Math.max(deepest.get(key) ?? 0, d));
    }
  const rows = new Array(Math.max(0, count - 1)).fill(0);
  for (const [key, d] of deepest) rows[Number(key.split(":")[0])] += d;
  return rows;
}

/**
 * 면마다 링크가 먹은 **최대 좌석 수**(머신 하나 기준) — planner 의 좌석 예산에서 뺄 값.
 *
 * W/E 만 반환하지 않는다 — `used` 의 키는 [tryLinkFace] 가 N/S(gap 스필)에도 똑같이
 * 적는다(`seatKey(mi, "N"|"S")`). **지금은** planner 가 N/S 를 시도하는 유일한 경로
 * (`input.nsFaces`)가 count=1 일 때만 켜지고, gap 스필은 count≥2 일 때만 생겨 서로
 * 상호배타라 이 값이 없어도 조용히 안 터졌다 — 그건 우연이지 설계가 아니다. 계산해 둔
 * 값을 버리지 않는 쪽이 항상 맞다(2026-07-21, [발견 ③] 근치).
 */
function seatRowsByFace(used: Map<string, number>): Partial<Record<PlannedSide, number>> {
  const by: Partial<Record<PlannedSide, number>> = {};
  for (const [k, v] of used) {
    const face = k.slice(k.indexOf(":") + 1) as PlannedSide;
    by[face] = Math.max(by[face] ?? 0, v);
  }
  return by;
}

/**
 * 면 배정(팔 수)에 좌표를 입힌다 — 머신이 놓인 뒤에 부른다.
 * `t` 의 뜻은 [faceCell] 과 같다: W/E 면이면 y(행), N/S 면이면 x(열).
 *
 * **gap 면의 좌석은 포트 쪽부터 채운다.** 막힌 면의 [[ParallelBelt]]는 "포트에 가까운 그룹이 얕은 줄"이라야
 * 성립하기 때문이다 — 먼 그룹이 얕은 줄을 차지하면 그 줄이 가까운 그룹의 열 위를 지나며
 * 남의 자리를 밟는다. 출력은 포트가 서쪽이라 서→동, 입력은 동쪽이라 **동→서**다.
 * (W/E 면은 나가는 쪽이 면과 수직이라 이 순서와 무관하다 — 늘 위→아래.)
 */
function placeLinkSeats(
  machines: Container[],
  plans: (LinkFacePlan | undefined)[],
  used: Map<string, number>,
  gapFromEast: boolean,
): (LinkSeats | undefined)[] {
  return plans.map((plan) => {
    if (!plan) return undefined;
    const slots = new Map<number, number[]>();
    for (const [mi, k] of [...plan.arms].sort((a, b) => a[0] - b[0])) {
      const m = machines[mi];
      if (!m) return undefined;
      const key = seatKey(mi, plan.face);
      const base = used.get(key) ?? 0;
      used.set(key, base + k);
      const isGap = plan.face === "N" || plan.face === "S";
      if (isGap && gapFromEast) {
        const east = m.origin.x + m.size.w - 1;
        slots.set(mi, Array.from({ length: k }, (_, t) => east - base - t).reverse());
      } else {
        const origin = isGap ? m.origin.x : m.origin.y;
        slots.set(mi, Array.from({ length: k }, (_, t) => origin + base + t));
      }
    }
    return { ...plan, slots };
  });
}

/**
 * **[[ParallelBelt]] 를 관통 한 줄로 합친다 — 모양 B → 모양 A** (2026-07-23 사장님 방향).
 *
 * ```
 *   B: 머신마다 자기 벨트          A: 관통 한 줄
 *      ┌────┐ ▓→포트                 ┌────┐ ▓→포트
 *      │ m0 │◄▓                      │ m0 │◄▓
 *      └────┘                        └────┘ ▓
 *      ┌────┐ ▓→포트                 ┌────┐ ▓
 *      │ m1 │◄▓                      │ m1 │◄▓
 *      └────┘                        └────┘
 * ```
 *
 * A가 사는 것 = **모듈 밖으로 나가는 줄 수**(포트 = 통로 트랙). 치르는 것 = 머신 사이를
 * 건너는 벨트 칸. 그래서 **되면 이득, 안 되면 B 그대로**다 — 실패가 손해가 아닌 순서다.
 *
 * ## 합치지 않는 것 셋
 *  - **안에서 끝나는 링크**([isInternalLink]) — 자식·부모 모듈이 서로 대화 없이 포트를 1:1로
 *    맞추고 있다. 한쪽만 합치면 그 짝이 어긋나 홉이 샌다. (양쪽이 **같은 규칙으로** 합치게
 *    만들면 그때 열 수 있다 — 지금은 안 연다.)
 *  - **gap(N/S) 면** — 그쪽은 나가는 방향이 면과 평행이라 이미 깊이로 갈려 달린다. 합치는
 *    기하가 다르므로 따로 다룬다.
 *  - **그릇을 넘는 합** — 합친 벨트가 못 나르면 합치는 순간 조용히 굶는다. 넘으면 거기서
 *    끊고 **다음 벨트를 새로 시작**한다(합칠 수 있는 만큼은 합친다).
 *
 * 실제로 자리가 비었는지는 **여기서 안 본다** — 방출기가 칸마다 점유를 보고 막히면 통째로
 * 물러나고([emitOutputLinks] 의 `push`), 호출자가 B로 다시 깐다. 좌표를 아는 쪽이 보는 게
 * 맞고, 그러면 이 함수가 기하를 두 번 유도하지 않는다.
 */
function mergeParallelBelts(
  groups: MachineLinkGroup[],
  seats: (LinkSeats | undefined)[],
  side: "from" | "to",
  perBelt: number,
): { groups: MachineLinkGroup[]; seats: (LinkSeats | undefined)[] } {
  const outG: MachineLinkGroup[] = [];
  const outS: (LinkSeats | undefined)[] = [];
  const openAt = new Map<string, number>(); // 아직 더 받을 수 있는 벨트 → outG 의 index
  const total = (m: Map<number, number>): number => [...m.values()].reduce((a, b) => a + b, 0);
  const start = (g: MachineLinkGroup, s: LinkSeats, key: string): void => {
    openAt.set(key, outG.length);
    outG.push({ ...g, from: new Map(g.from), to: new Map(g.to) });
    outS.push({ ...s, arms: new Map(s.arms), slots: new Map(s.slots) });
  };

  groups.forEach((g, i) => {
    const s = seats[i];
    // 합칠 수 없는 것은 그대로 통과 — 순서도 유지한다(짝짓기가 순서를 본다).
    if (!s || isInternalLink(g) || s.face === "N" || s.face === "S") {
      outG.push(g);
      outS.push(s);
      return;
    }
    const key = `${g.item}:${s.face}:${s.laneDepth}:${s.exitDepth ?? s.laneDepth}`;
    const at = openAt.get(key);
    if (at === undefined) return start(g, s, key);

    const tg = outG[at];
    const ts = outS[at]!;
    if (total(ts.arms) + total(s.arms) > perBelt) return start(g, s, key); // 그릇 초과 → 새 벨트

    for (const [mi, k] of s.arms) {
      tg[side].set(mi, (tg[side].get(mi) ?? 0) + k);
      ts.arms.set(mi, (ts.arms.get(mi) ?? 0) + k);
      ts.slots.set(mi, [...(ts.slots.get(mi) ?? []), ...(s.slots.get(mi) ?? [])]);
    }
  });
  return { groups: outG, seats: outS };
}

/**
 * **출력 fan-out 방출** — 그룹마다 [allocateLinkSeats] 가 정한 면·행에 탭을 앉히고, 그 팔들을
 * 모으는 세로 belt 를 깔아 **그 면 바깥으로** 포트 하나를 낸다.
 *
 * 면은 W 를 선호한다: 부모는 항상 왼쪽(W)이라 채널로 곧장 이어진다. W 가 차면 **gap(N/S)**
 * 으로 넘어가고(E 아님 — [allocateLinkFaces] 참고), gap 은 그때 비로소 벌어진다
 * ([gapRowsFromPlans]). **팔을 깎으면 머신이 조용히 굶으므로** 넘치는 쪽을 버리지 않는다.
 *
 * 기하(면 바깥 방향 `fv`, 그룹이 쓰는 행 `rows`, 출구 행 `topT`=맨 위):
 *   탭     = faceCell d1, 행마다 — 머신에서 집어 belt 에 놓음(픽업 = 안쪽 = −fv)
 *   belt   = faceCell d2, 세로로 rows 를 덮고 topT 쪽으로 흐름
 *   출구인서터 = beltTop + fv   — belt 에서 집어 chest 에 놓음
 *   chest(포트) = beltTop + 2fv
 */
function emitOutputLinks(args: {
  groups: MachineLinkGroup[];
  seats: (LinkSeats | undefined)[];
  lineOf: Map<string, IoLine>;
  machines: Container[];
  input: ModuleInput;
  prefix: string;
  occupancy: Set<string>;
  cells: PlacedCell[];
  chests: Container[];
  outputPorts: ModulePort[];
  unroutedLines: IoLine[];
}): void {
  const { groups, machines, input, prefix, occupancy, cells, chests, outputPorts, unroutedLines } = args;
  const ext = {
    x0: Math.min(...machines.map((m) => m.origin.x)),
    y0: Math.min(...machines.map((m) => m.origin.y)),
    x1: Math.max(...machines.map((m) => m.origin.x + m.size.w - 1)),
    y1: Math.max(...machines.map((m) => m.origin.y + m.size.h - 1)),
  };
  let seq = 0;

  groups.forEach((group, gi) => {
    const line = args.lineOf.get(group.item);
    if (!line) return;
    const plan = args.seats[gi];
    if (!plan) {
      unroutedLines.push(line); // 두 면 다 찼다(거대 출력) → 정직 폴백(N/S gap 은 후속)
      return;
    }
    const face = plan.face;
    const isGap = face === "N" || face === "S";
    const fv = faceVector(face);
    // **좌석은 머신 여럿에 걸칠 수 있다**(입력과 같은 구조). v1 링크 그룹은 자식 머신 하나뿐
    // 이라 항상 길이 1이지만, 외부 줄(모든 머신이 내는 최종 산출)은 전 머신에 걸친다 —
    // [emitTapInserting] 을 [[ParallelBelt]] 로 대체하려면 이 형태여야 한다(규칙 2).
    const seats = [...plan.slots]
      .sort((a, b) => a[0] - b[0])
      .map(([mi, rows]) => ({ m: machines[mi], rows }))
      .filter((s) => s.m);
    if (seats.length === 0) return;
    const m0 = seats[0].m;
    const allRows = seats.flatMap((s) => s.rows).sort((a, b) => a - b);
    // depth 는 gap 이면 **그 머신의 면**에서 잰다 — 가운데 머신의 N/S 는 클러스터 끝면이
    // 아니다. W/E 면은 기둥이라 모든 머신의 x 가 같아 전체 ext 와 결과가 같다.
    const mExt = isGap
      ? { x0: m0.origin.x, y0: m0.origin.y, x1: m0.origin.x + m0.size.w - 1, y1: m0.origin.y + m0.size.h - 1 }
      : ext;

    // 출구는 **언제나 W**다. W 면 좌석이면 세로 벨트가 그대로 서쪽을 보고, N/S(gap) 좌석이면
    // 가로 벨트가 gap 을 따라 서쪽 변까지 와서 90° 꺾인다 — **그 꺾이는 칸이 곧 평범한 W
    // 포트**다(모서리 포트). 그래서 채널 장부가 새 모양을 배울 필요가 없다.
    const portFace: PortFace = "W";
    const pfv = faceVector(portFace);
    // 벨트 깊이는 **계획이 정해 들고 온 값**이다 — gap 폭을 유도한 바로 그 값이라
    // 여기서 다른 수를 쓰면 벨트가 gap 밖으로 넘친다([gapRowsFromPlans]).
    const laneDepth = plan.laneDepth;
    const exitDepth = plan.exitDepth ?? laneDepth;
    const topT = allRows[0];
    const belt0 = faceCell(mExt, face, laneDepth, topT); // 벨트 줄의 시작 칸
    // 트렁크 끝(= 홉 계약의 trunkStart) — W 면이면 belt 줄의 맨 위, N/S 면이면 **반출 줄의**
    // 맨 서쪽(자기 줄로 내려온 뒤 서쪽 변에 닿는 칸).
    const trunkStart =
      face === "W" ? belt0 : { x: m0.origin.x, y: faceCell(mExt, face, exitDepth, topT).y };
    const chestId = `${prefix}-output-${line.name}-${seq++}`;
    const { chest, portPair, seatCell, chestAt } = makeLinkPortChest({
      role: "output", trunkEnd: trunkStart, portFace, pfv, line, machineId: m0.id, chestId,
    });

    // 흐름은 언제나 **트렁크 끝(t 가 작은 쪽)을 향한다** — W 면은 위로, N/S 면은 서쪽으로.
    const beltDirV = face === "W" ? { x: 0, y: -1 } : { x: -1, y: 0 };
    // **끝 칸은 면을 따라 계속 흐르지 않고 포트 쪽으로 꺾는다.** 안 꺾으면 이 그룹의 물건이
    // 면을 따라 더 흘러 **이웃 그룹의 벨트로 넘어간다**(머신 사이 gap 이 0 이면 두 벨트가 실제로
    // 맞닿는다). 품목이 같아 오염은 안 나지만 장부가 통째로 거짓이 된다 — 이쪽 부모는 굶고
    // 저쪽 부모는 넘친다. 셀 겹침(occupancy)만 봐서는 못 잡는 종류다(2026-07-22 수정).
    // 꺾은 칸의 다음 칸은 이 그룹의 포트 인서터라 언제나 비어 있다(다른 그룹의 행과 안 겹친다).
    const beltCells: PlacedCell[] = [];
    let blocked = false;
    const push = (at: { x: number; y: number }, v: { x: number; y: number }): void => {
      if (occupancy.has(cellKey(at.x, at.y))) { blocked = true; return; }
      beltCells.push(makeBeltCell(at, vectorToDirection(v.x, v.y), input.beltEntityName, portPair)); // 티어는 후속
    };
    // ① **수집** — 자기 좌석 구간을 덮는다. **목록이 아니라 구간**으로 돈다([emitInputLinks] ③
    // 과 같은 모양): 좌석이 머신 여럿에 걸치면 그 사이에 **좌석 없는 행**이 생기는데, 목록만
    // 깔면 거기가 비어 **벨트가 끊긴다**. 끊긴 벨트는 겹침 검사로 안 잡힌다 — 겹치는 게 아니라
    // 비어 있는 것이라, 그림은 멀쩡하고 물건만 안 흐른다.
    //
    // 머신 하나짜리 그룹(지금 전부)은 좌석이 연속이라 구간 == 목록이다 — 동작 변화 0.
    // 관통 그룹이 지나가는 남의 행은 `push` 가 점유를 보고 막으므로, 못 지나가면 그룹 통째로
    // 물러난다(반만 깔린 벨트를 남기지 않는다).
    const botT = allRows[allRows.length - 1];
    for (let t = topT; t <= botT && !blocked; t++) {
      // 끝 칸: 자기 줄로 내려가야 하면 **더 깊은 줄 쪽**(fv)으로, 아니면 포트 쪽(pfv)으로.
      const turn = exitDepth > laneDepth ? fv : pfv;
      push(faceCell(mExt, face, laneDepth, t), t === topT ? turn : beltDirV);
    }
    // ② **자기 줄로 내려가기** — 막힌 면이라 벨트가 깊이로 갈린다([[ParallelBelt]]). 내려가는
    // 건 **벨트가 벨트를 먹이는** 것이라 팔 길이와 무관하다(팔은 수집 줄 d`laneDepth` 까지만).
    for (let d = laneDepth + 1; d <= exitDepth && !blocked; d++) {
      push(faceCell(mExt, face, d, topT), d === exitDepth ? pfv : fv); // 반출 줄에 닿으면 서쪽으로
    }
    // ③ **반출** — 반출 줄을 따라 서쪽 변까지. 먼저 앉은 그룹들의 줄보다 **깊고**, 그들의
    // 열보다 **동쪽에서** 출발하므로 남의 줄을 밟지 않는다.
    if (exitDepth > laneDepth)
      for (let t = topT - 1; t >= m0.origin.x && !blocked; t--) push(faceCell(mExt, face, exitDepth, t), pfv);
    if (blocked || occupancy.has(cellKey(seatCell.x, seatCell.y)) || occupancy.has(cellKey(chestAt.x, chestAt.y))) {
      unroutedLines.push(line); // 안전망(구성상 발생 안 함)
      return;
    }

    // 탭 픽업 = 좌석 면의 안쪽(−fv, 머신에서 집어 belt 로).
    // **팔 종류는 레인 깊이와 짝이다** — 좌석은 언제나 d1 이므로 벨트가 d`laneDepth` 면 팔이
    // `laneDepth-1` 칸을 던져야 한다. v1 은 모든 링크 벨트가 기본 레인(d2)이라 기본 팔이
    // 언제나 맞다. 깊은 레인이 다시 생기면 **여기가 그 짝을 따라가야 한다** —
    // 상수를 쓰면 짧은 팔이 벨트에 못 닿아 그 자리가 조용히 굶는다.
    const inward = { x: -fv.x, y: -fv.y };
    for (const s of seats) {
      for (const t of s.rows) {
        const seat = faceCell(mExt, face, 1, t);
        const pair: PortPair = {
          producer: { containerId: s.m.id, cell: { ...seat }, face, kind: "item" },
          consumer: { containerId: chestId, cell: { ...seat }, face, kind: "item" },
        };
        cells.push(makeInserterCell(seat, inward, input.inserterEntityName, pair));
        occupancy.add(cellKey(seat.x, seat.y));
      }
    }
    // 포트 끝은 공통 방출기가 놓는다(belt 에서 집어 chest 로). tapAnchor: W 는 서쪽 끝.
    pushLinkPortEnd({
      role: "output", seatCell, chestAt, chest, portPair, portFace, pfv, beltCells,
      // 신원은 **안에서 끝나는 링크에만** 단다 — 밖으로 나가는 줄에 달면 짝이 없어 홉이 통째로
      // 건너뛰어진다([isInternalLink]).
      line, linkId: isInternalLink(group) ? group.id : undefined, tapAnchor: { x: m0.origin.x, y: trunkStart.y },
      laneDepth, inserterEntityName: input.inserterEntityName, lineEnds: input.lineEnds,
      cells, chests, occupancy, ports: outputPorts,
    });
  });
}

/**
 * **입력 fan-in 방출** — [emitOutputLinks] 의 거울. 링크마다 부모 머신(toMachine) 하나의
 * 연속 좌석 k개에 입력 탭을 앉히고, 세로 belt 를 깔아 **E변(자식 쪽)으로** 포트 하나를 낸다.
 * 자식 출력 포트와 **링크 순서로 1:1** 짝지어지도록 링크 순서대로 낸다.
 *
 * 기하(E면, 머신 origin (mx,my), base, k): 탭=faceCell d1 (mx+w, ...) 벨트에서 집어 머신에
 * 넣음; belt=d2 세로(아래로 흐름 — 포트에서 받아 탭에 분배); 포트 인서터=d3, chest=d4(동).
 */
function emitInputLinks(args: {
  groups: MachineLinkGroup[];
  seats: (LinkSeats | undefined)[];
  lineOf: Map<string, IoLine>;
  machines: Container[];
  input: ModuleInput;
  prefix: string;
  occupancy: Set<string>;
  cells: PlacedCell[];
  chests: Container[];
  inputPorts: ModulePort[];
  unroutedLines: IoLine[];
}): void {
  const { groups, machines, input, prefix, occupancy, cells, chests, inputPorts, unroutedLines } = args;
  const ext = {
    x0: Math.min(...machines.map((m) => m.origin.x)),
    y0: Math.min(...machines.map((m) => m.origin.y)),
    x1: Math.max(...machines.map((m) => m.origin.x + m.size.w - 1)),
    y1: Math.max(...machines.map((m) => m.origin.y + m.size.h - 1)),
  };
  let seq = 0;

  groups.forEach((group, gi) => {
    const line = args.lineOf.get(group.item);
    if (!line) return;
    const plan = args.seats[gi];
    if (!plan) { unroutedLines.push(line); return; } // 두 면 다 찼다 → 정직 폴백
    const face = plan.face;
    const isGap = face === "N" || face === "S";

    // 좌석은 [allocateLinkFaces]+[placeLinkSeats] 가 이미 정했다 — 여기선 깔기만 한다.
    const seats = [...plan.slots]
      .sort((a, b) => a[0] - b[0])
      .map(([mi, rows]) => ({ m: machines[mi], rows }));
    const m0 = seats[0].m;
    // gap 좌석이면 depth 를 **그 머신의 면**에서 잰다(가운데 머신의 N/S 는 클러스터 끝면이 아니다).
    const geomExt = isGap
      ? { x0: m0.origin.x, y0: m0.origin.y, x1: m0.origin.x + m0.size.w - 1, y1: m0.origin.y + m0.size.h - 1 }
      : ext;
    const allRows = seats.flatMap((s) => s.rows);
    const topT = Math.min(...allRows);
    // gap 벨트는 머신 **동쪽 끝까지** 뻗어야 포트가 클러스터 밖에 선다. 자기 줄로 내려가는 그룹은
    // 그 구간을 **반출 줄**에서 달리고 자기 열에서 올라오므로, 여기선 자기 좌석 끝까지만.
    const exitDepth = plan.exitDepth ?? plan.laneDepth;
    const ownEast = Math.max(...allRows);
    const botT = isGap ? (exitDepth > plan.laneDepth ? ownEast : m0.origin.x + m0.size.w - 1) : ownEast;

    // 입구는 **언제나 E**다(자식이 동쪽). gap 좌석이면 가로 벨트가 동쪽 변에서 90° 꺾여
    // 들어온다 — 그 꺾이는 칸이 곧 평범한 E 포트(모서리 포트)다.
    const portFace: PortFace = "E";
    const pfv = faceVector(portFace);

    // 좌석(d1)이 막히면 폴백. 레인은 막히면 다음 후보로.
    const seatCells = allRows.map((t) => faceCell(geomExt, face, 1, t));
    if (seatCells.some((c) => occupancy.has(cellKey(c.x, c.y)))) { unroutedLines.push(line); return; }
    /**
     * 트렁크 끝(포트가 붙는 칸) — E 면이면 belt 줄의 맨 위, gap 이면 **반출 줄의** 맨 동쪽
     * (자기 줄로 내려가든 아니든 포트는 언제나 클러스터 동쪽 변에 선다).
     */
    const trunkEndOf = (d: number): { x: number; y: number } => {
      const b = faceCell(geomExt, face, d, topT);
      return isGap ? { x: m0.origin.x + m0.size.w - 1, y: faceCell(geomExt, face, exitDepth, topT).y } : b;
    };
    // 레인(depth)은 배정이 정해 들고 온 값이다 — 여기선 탐색하지 않는다. v1 은 링크 하나가
    // 곧 벨트 하나라 관통 벨트가 없고, 벨트가 자기 구간만 덮으므로 다툴 depth 자체가 없다.
    const lane = { d: plan.laneDepth, inserter: input.inserterEntityName };
    const fv = faceVector(face);
    // 흐름은 포트(트렁크 끝)에서 **멀어지는** 쪽 — E 면은 아래로, gap 이면 서쪽으로.
    const beltDirV = isGap ? { x: -1, y: 0 } : { x: 0, y: 1 };
    const inward = { x: -fv.x, y: -fv.y };

    // 벨트 경로를 **먼저 전부 계산하고**, 다 놓을 수 있을 때만 놓는다. 반만 놓인 벨트는
    // 포트에서 물건이 사라지는 것과 같아서, 한 칸이라도 막히면 통째로 물러난다.
    const path: { at: { x: number; y: number }; v: { x: number; y: number } }[] = [];
    // ① **반출** — 포트(동쪽 변)에서 자기 열까지 반출 줄로 달려온다([emitOutputLinks] 의 거울,
    // 흐름만 반대다). 내려갈 필요 없는 첫 그룹은 이 구간이 없다(수집이 곧 동쪽 변까지).
    if (isGap && exitDepth > lane.d)
      for (let t = m0.origin.x + m0.size.w - 1; t > ownEast; t--)
        path.push({ at: faceCell(geomExt, face, exitDepth, t), v: beltDirV });
    // ② **자기 줄에서 올라오기** — 자기 열에서 수집 줄까지 **올라온다**(머신 쪽). 벨트→벨트라 팔 길이 무관.
    for (let d = exitDepth; d > lane.d; d--)
      path.push({ at: faceCell(geomExt, face, d, ownEast), v: inward });
    // ③ **수집** — 자기 좌석 구간을 덮으며 탭에 나눠 준다. 먼 쪽 끝 칸은 면을 따라 더 흐르면
    // **이웃 그룹의 벨트로 넘어가므로** 머신 쪽으로 꺾어 멈춘다 — 그 칸은 이 그룹 자신의
    // 좌석(인서터)이라 언제나 안전하다.
    for (let t = topT; t <= botT; t++) {
      const far = isGap ? t === topT : t === botT;
      path.push({ at: faceCell(geomExt, face, lane.d, t), v: far ? inward : beltDirV });
    }

    const te = trunkEndOf(lane.d);
    const span = [
      ...path.map((c) => c.at),
      { x: te.x + pfv.x, y: te.y + pfv.y },
      { x: te.x + 2 * pfv.x, y: te.y + 2 * pfv.y }, // 포트 인서터·상자
    ];
    if (span.some((c) => occupancy.has(cellKey(c.x, c.y)))) {
      unroutedLines.push(line); // 안전망(구성상 발생 안 함 — 좌석 장부가 이미 막았어야 한다)
      return;
    }

    // ── 배치 확정 ──
    const beltTop = trunkEndOf(lane.d);
    const chestId = `${prefix}-input-${line.name}-${seq++}`;
    const { chest, portPair, seatCell, chestAt } = makeLinkPortChest({
      role: "input", trunkEnd: beltTop, portFace, pfv, line, machineId: m0.id, chestId,
    });

    const beltCells: PlacedCell[] = path.map((c) =>
      makeBeltCell(c.at, vectorToDirection(c.v.x, c.v.y), input.beltEntityName, portPair), // 티어는 후속
    );
    for (const c of beltCells) occupancy.add(cellKey(c.x, c.y));
    for (const s of seats) {
      for (const t of s.rows) {
        const seat = faceCell(geomExt, face, 1, t);
        const pair: PortPair = {
          producer: { containerId: chestId, cell: { ...seat }, face, kind: "item" },
          consumer: { containerId: s.m.id, cell: { ...seat }, face, kind: "item" },
        };
        cells.push(makeInserterCell(seat, fv, lane.inserter, pair)); // 픽업 = 바깥(트렁크) → 머신에 놓음
        occupancy.add(cellKey(seat.x, seat.y));
      }
    }
    // 포트 끝은 공통 방출기가 놓는다(상자에서 집어 belt 로). tapAnchor: E 는 동쪽 끝.
    pushLinkPortEnd({
      role: "input", seatCell, chestAt, chest, portPair, portFace, pfv, beltCells,
      // 신원은 **안에서 끝나는 링크에만** — [emitOutputLinks] 와 같은 이유.
      line, linkId: isInternalLink(group) ? group.id : undefined, tapAnchor: { x: m0.origin.x + m0.size.w - 1, y: beltTop.y },
      laneDepth: lane.d, inserterEntityName: input.inserterEntityName, lineEnds: input.lineEnds,
      cells, chests, occupancy, ports: inputPorts,
    });
  });
}

/**
 * **탭 인서팅 방출** — 품목 줄마다 belt 한 줄을 머신 기둥 전체에 직선으로 깔고, 머신마다
 * 탭 인서터를 하나씩 붙인다. 포트는 **벨트 끝 하나뿐**이라 모듈 경계 포트가 품목당 1개가 된다.
 *
 * ## 기하 (W 면 · 3×3 머신 2대 · 가까운 레인 d=2)
 * ```
 *        x=-2 -1  0  1  2       d = 머신 면에서 바깥 칸 수
 *  y=-2    C   .  .  .  .       C = 포트 상자(anchor)  ← belt 열 위, 기둥 밖 2칸
 *  y=-1    I   .  .  .  .       I = 포트 인서터(seat)
 *  y= 0    B   i  M  M  M       B = 트렁크 belt (d=2)
 *  y= 1    B   .  M  M  M       i = 탭 인서터 (d=1)
 *  y= 2    B   .  M  M  M
 *  y= 3    B   i  M  M  M
 *  y= 4    B   .  M  M  M
 *  y= 5    B   .  M  M  M
 * ```
 *
 * ## 왜 이 배치인가 — [moduleHop] 의 포트 계약을 코드 수정 없이 만족시킨다
 * `moduleHop.portGeometry` 는 포트 기하를 **anchor 와 face 만으로** 유도한다:
 * `chest = anchor` · `seat = anchor − faceVec` · `trunkStart = anchor − 2·faceVec`.
 * 그래서 트렁크 끝에서 바깥으로 `[인서터][상자]` 를 일직선으로 세우고 `face` 를 **그 나가는
 * 방향**(N/S)으로 주면 홉이 그대로 붙는다. 홉이 상자를 떼고 그 자리에 belt 를 깔면 —
 * 출력 인서터가 그 belt 에 놓고, 입력 인서터가 그 belt 에서 집는다(양끝 인서터는 보존됨).
 *
 * `meta.side`(W/E)는 유지된다 — 채널 장부·반출 계획이 보는 건 **어느 변**이냐이고,
 * `face`(N/S)는 **어느 쪽으로 나가느냐**다. 둘은 다르다(모듈 머리말 "변 vs face" 참고).
 *
 * ## 왜 [untapped](../../../../docs/용어사전.md) 가 생길 수 없나
 * belt 가 기둥 **전체를 직선으로** 지나므로 모든 머신의 그 면 행이 belt 와 맞닿는다.
 * 옛 트렁크(씨앗에서 그리디로 성장)처럼 "둘러싸여 못 닿는 머신"이 **구성상** 없다.
 */
/**
 * [emitTapInserting]·[emitTrunkPipe] 가 함께 보는 값 — 기둥 extent, [pipeJumpToClusterPipe]
 * 모드 여부, stagger 계산 기준. 두 방출기가 **각자 독립으로 재계산하면 어긋날 수 있는 값**을
 * 한 곳에서 만들어 공유한다(예: 아이템 stagger 는 같은 면·같은 끝의 파이프 레인 깊이까지
 * 알아야 하고, 그 반대도 마찬가지 — 둘이 따로 계산하면 두 계산이 다른 답을 낼 수 있다).
 */
interface TrunkContext {
  ext: { x0: number; y0: number; x1: number; y1: number };
  /** [pipeJumpToClusterPipe] 가 실제로 켜졌는가(가능 판정 + 그 면에 벨트가 있음). */
  pipeJumpMode: boolean;
  /** ClusterPipe 깊이 = 그 면 벨트 최대 깊이 + 2. */
  clusterPipeDepth: number;
  /** 줄의 **실제 배치 깊이** — 유체 줄은 점프 모드면 ClusterPipe 깊이, 아니면 계획값 그대로. */
  emitDepthOf: (p: PlannedLine) => number;
  /** 같은 면·같은 끝으로 나가는 줄들의 최대 레인 깊이 — stagger 계산의 기준. */
  maxDepthAtEnd: Map<string, number>;
}

/** [TrunkContext.maxDepthAtEnd] 의 조회 키 — 같은 면·같은 끝(min/max)이면 같은 키. */
function trunkEndKey(p: PlannedLine, lineEnds: ModuleInput["lineEnds"]): string {
  return `${p.side}:${lineEnds?.get(`${p.line.role}:${p.line.name}`) ?? "min"}`;
}

/**
 * [TrunkContext] 를 만든다 — 좌표 배치 전, `plan.lines` 전체(아이템+유체)를 한 번 훑어야
 * 나오는 값들이라 [emitTapInserting]/[emitTrunkPipe] 가 갈리기 **전**에 한 번만 계산한다.
 *
 * ── [pipeJumpToClusterPipe] 모드 — 유체 줄이 좌석 줄 대신 바깥 [ClusterPipe] 로 ──
 * 점프 가능 판정(isJumpableToClusterPipe)이 참이어도, 그 면에 **벨트가 하나도 안 앉았으면**
 * 넘을 것이 없다 → 옛 스파인(d=1)이 그대로 최선이라 점프하지 않는다(폭 낭비 0).
 *
 * ClusterPipe 깊이 = 그 면 벨트 최대 깊이 + 2:
 *   +1 = [ClusterPipeTapCell] — 지하파이프는 **지하 방향으로만** 합류하고 옆(수직)으론
 *        못 이어서, 탭이 ClusterPipe 줄 위에 앉으면 세로 연속이 끊긴다 → 1칸 안쪽.
 *   +2 = ClusterPipe 본체(일반 파이프 세로줄).
 * (나중에: 벨트를 지하벨트로 접으면 탭·ClusterPipe 를 더 안쪽으로 당길 수 있다 — 최적화 보류.)
 */
function buildTrunkContext(
  plan: { ok: true; lines: PlannedLine[] },
  machines: Container[],
  input: ModuleInput,
  isJumpableToClusterPipe: boolean,
): TrunkContext {
  const ext = {
    x0: Math.min(...machines.map((m) => m.origin.x)),
    y0: Math.min(...machines.map((m) => m.origin.y)),
    x1: Math.max(...machines.map((m) => m.origin.x + m.size.w - 1)),
    y1: Math.max(...machines.map((m) => m.origin.y + m.size.h - 1)),
  };

  const pipeFaceBeltMax = plan.lines.reduce(
    (a, p) =>
      p.line.kind === "belt" && p.side === input.fluidTrunk?.side
        ? Math.max(a, p.clusterBeltDepth)
        : a,
    0,
  );
  const pipeJumpMode = isJumpableToClusterPipe && pipeFaceBeltMax > 0;
  const clusterPipeDepth = pipeFaceBeltMax + 2;
  const emitDepthOf = (p: PlannedLine): number =>
    p.line.kind === "pipe" && pipeJumpMode ? clusterPipeDepth : p.clusterBeltDepth;

  const maxDepthAtEnd = new Map<string, number>();
  for (const p of plan.lines) {
    const k = trunkEndKey(p, input.lineEnds);
    maxDepthAtEnd.set(k, Math.max(maxDepthAtEnd.get(k) ?? 0, emitDepthOf(p)));
  }

  return { ext, pipeJumpMode, clusterPipeDepth, emitDepthOf, maxDepthAtEnd };
}

function emitTapInserting(args: {
  plan: { ok: true; lines: PlannedLine[] };
  machines: Container[];
  input: ModuleInput;
  prefix: string;
  occupancy: Set<string>;
  cells: PlacedCell[];
  chests: Container[];
  inputPorts: ModulePort[];
  outputPorts: ModulePort[];
  unroutedLines: IoLine[];
  ctx: TrunkContext;
  /** [emitTrunkPipe] 와 chestId 순번을 이어 쓰기 위한 공유 카운터. */
  seqRef: { n: number };
}): void {
  const { plan, machines, input, prefix, occupancy, cells, chests, ctx } = args;
  const ext = ctx.ext;

  // 면별로 이미 쓴 탭 좌석 행. 같은 면의 두 줄(가까운/먼 레인)은 belt 열은 다르지만
  // **좌석은 같은 d=1 열**에 앉으므로, 줄마다 다른 행을 줘야 겹치지 않는다.
  const slotOnFace = new Map<PlannedSide, number>();

  for (const planned of plan.lines) {
    if (planned.line.kind === "pipe") continue; // 유체는 [emitTrunkPipe] 가 처리한다.
    const line = planned.line;
    const face = planned.side as PortFace;
    const fv = faceVector(face); // 바깥 방향(머신 → 면)
    const d = ctx.emitDepthOf(planned); // 가까운 belt=2, 먼=3, 케이스 B=4.

    // [Parallel Inserting]: 한 줄이 머신마다 탭 `taps` 개를 쓰면 좌석 행도 그만큼 연속으로 먹는다.
    const taps = Math.max(1, planned.requiredInserterCount ?? 1);
    const lateralCap = face === "W" || face === "E" ? input.machine.h : input.machine.w;
    const slot = slotOnFace.get(planned.side) ?? 0;
    if (slot + taps > lateralCap) {
      args.unroutedLines.push(line); // 좌석 행 부족 — planner 용량과 어긋난 것(안전망).
      continue;
    }
    slotOnFace.set(planned.side, slot + taps);

    // 트렁크가 달리는 축(W/E 면 → 세로, N/S 면 → 가로)과 포트가 나가는 끝.
    const vertical = face === "W" || face === "E";
    const t0 = vertical ? ext.y0 : ext.x0;
    const t1 = vertical ? ext.y1 : ext.x1;
    // 끝 선호 — 합성 단계(packModuleTree)가 부모↔자식 포트를 마주 보게 정렬해 넣어준다.
    const atMin = (input.lineEnds?.get(`${line.role}:${line.name}`) ?? "min") === "min";
    const exitFace: PortFace = vertical ? (atMin ? "N" : "S") : atMin ? "W" : "E";
    const ev = faceVector(exitFace);

    // **끝을 어긋나게 한다(stagger) — 안쪽 레인일수록 더 멀리 뽑는다.**
    //
    // 같은 면의 두 줄이 끝을 나란히 맞추면, 바깥 레인(d=3)의 belt 열이 안쪽 레인(d=2)
    // 상자의 **옆구리를 막아** 그 상자가 바깥으로 못 나간다(2026-07-12 실측: n2 의
    // copper-cable 상자가 동쪽으로 못 나가 skip). 바깥 레인의 열은 상자·좌석·belt 가
    // 연속이라 **어디를 밀어도 여전히 옆을 막는다** — 바깥을 더 뽑는 건 답이 아니다.
    //
    // 답은 반대다: **안쪽 레인을 바깥 레인의 끝보다 더 멀리** 뽑아, 안쪽 상자가 바깥 열이
    // 끝난 지점 너머에 앉게 한다. 그러면 안쪽 상자의 옆이 비어 길이 열린다.
    // belt·seat·chest 는 여전히 일직선·연속이라 [moduleHop] 계약은 그대로다.
    // (기준값은 [buildTrunkContext] 가 아이템·파이프 줄을 함께 훑어 낸 것 — 같은 면의
    // 파이프 레인이 더 깊으면 아이템도 그 깊이에 맞춰 물러난다.)
    const stagger = (ctx.maxDepthAtEnd.get(trunkEndKey(planned, input.lineEnds)) ?? d) - d;
    const tBeltEnd = atMin ? t0 - stagger : t1 + stagger;

    const beltEnd = faceCell(ext, face, d, tBeltEnd); // 트렁크의 포트 쪽 끝(= trunkStart)
    const seat = { x: beltEnd.x + ev.x, y: beltEnd.y + ev.y }; // 포트 인서터
    const chestAt = { x: beltEnd.x + 2 * ev.x, y: beltEnd.y + 2 * ev.y }; // 포트 상자(anchor)

    const chestId = `${prefix}-${line.role}-${line.name}-${args.seqRef.n++}`;
    const chest: Container = {
      id: chestId,
      kind: "infinity-chest",
      entityName: "infinity-chest",
      origin: { ...chestAt },
      size: { w: 1, h: 1 },
      content: line.name,
      role: line.role,
    };
    chests.push(chest);

    // belt 흐름 — 출력(collect)은 머신들이 놓은 것이 **포트 쪽으로** 모여 흐르고,
    // 입력(supply)은 포트로 들어온 것이 **기둥 안쪽으로** 퍼진다. 정반대다.
    const flow = line.role === "output" ? ev : { x: -ev.x, y: -ev.y };
    const beltDir = vectorToDirection(flow.x, flow.y);

    const beltPair: PortPair = {
      producer: {
        containerId: line.role === "input" ? chestId : machines[0].id,
        cell: { ...beltEnd }, face, kind: "item",
      },
      consumer: {
        containerId: line.role === "input" ? machines[0].id : chestId,
        cell: { ...beltEnd }, face, kind: "item",
      },
    };

    // ── 트렁크 belt 한 줄 — 기둥 전체(+stagger)를 직선으로. 탐색 0. ──
    const beltCells: PlacedCell[] = [];
    const lo = Math.min(t0, tBeltEnd);
    const hi = Math.max(t1, tBeltEnd);
    for (let t = lo; t <= hi; t++) {
      const at = faceCell(ext, face, d, t);
      if (occupancy.has(cellKey(at.x, at.y))) continue; // 안전망(구성상 발생 안 함)
      beltCells.push(makeBeltCell(at, beltDir, planned.beltEntityName ?? input.beltEntityName, beltPair));
    }

    // ── 포트 끝 — 트렁크 끝 바깥에 [인서터][상자] 일직선 ──
    // 칸 배치(anchor−ev, anchor−2·ev)는 [moduleHop] 포트 계약과 같다.
    const portPickup = line.role === "input" ? ev : { x: -ev.x, y: -ev.y };
    const portCells: PlacedCell[] = [
      makeContainerCell(chest, chestAt),
      makeInserterCell(seat, portPickup, input.inserterEntityName, beltPair),
    ];

    // ── 탭 인서터 — 머신마다 [taps]개. 한 belt 를 나눠 집는다. ──
    //
    // 점프 모드의 유체 면: 좌석 줄(d=1)에서 **상자 행 하나는 [fluidboxPipeCell] 자리**다
    // ([emitTrunkPipe] 가 그 행에 파이프를 놓는다). 이 아이템 줄이 **같은 면**을 쓰면 벨트
    // 좌석은 그 행을 건너뛰어 앉아야 한다 — 이게 "머신 유체 상자에 닿아야 하는 칸을 제외한
    // 남는 공간을 활용한다"의 실체다. (용량은 insertingPlanner 좌석 예산이 이미 보장.)
    const skipRow =
      ctx.pipeJumpMode && planned.side === input.fluidTrunk?.side
        ? input.fluidTrunk!.fluidboxOffset!
        : undefined;
    const remapRow = (r: number) => (skipRow !== undefined && r >= skipRow ? r + 1 : r);
    const tapCells: PlacedCell[] = [];
    const seatDepth = tapSeatDepth(planned);
    for (const m of machines) {
      for (let k = 0; k < taps; k++) {
        const seatRow = remapRow(slot + k);
        const t = (vertical ? m.origin.y : m.origin.x) + seatRow;
        const tapAt = faceCell(ext, face, seatDepth, t);
        if (occupancy.has(cellKey(tapAt.x, tapAt.y))) continue;
        // 집는 쪽: 입력이면 belt(바깥 +fv), 출력이면 머신(안쪽 −fv). 1:1 과 같은 규약.
        const pickup = line.role === "input" ? fv : { x: -fv.x, y: -fv.y };
        const pair: PortPair = {
          producer: {
            containerId: line.role === "input" ? chestId : m.id,
            cell: { ...tapAt }, face, kind: "item",
          },
          consumer: {
            containerId: line.role === "input" ? m.id : chestId,
            cell: { ...tapAt }, face, kind: "item",
          },
        };
        tapCells.push(makeInserterCell(tapAt, pickup, tapInserterName(input, planned), pair));
      }
    }

    for (const c of [...beltCells, ...portCells, ...tapCells]) {
      cells.push(c);
      occupancy.add(cellKey(c.x, c.y));
    }

    const port: ModulePort = {
      line,
      anchor: { ...chestAt },
      tapAnchor: { ...beltEnd }, // = anchor − 2·faceVec(exitFace). moduleHop 계약.
      face: exitFace, // **나가는 방향**(N/S) — 변(meta.side, W/E)과 다르다.
      moduleWayOuts: [], // 전 포트 emit 후 fillModuleWayOuts 가 채운다.
      chest,
      cells: beltCells, // 트렁크 spine — Routing 선이 벨트를 따라간다.
      meta: {
        item: line.name,
        side: planned.side, // 채널 장부·반출 계획이 보는 값 — 어느 **변**이냐.
        laneDepth: d,
        // meta.inserter 는 소비자(채널 장부·골든)가 보는 'normal'|'long' 라벨이다 — planner 의
        // reach 를 여기서 이진 라벨로 접는다.
        inserter:
          planned.reach === undefined ? undefined : planned.reach >= 2 ? "long" : "normal",
        amount: line.amount,
        endPreference: input.lineEnds?.get(`${line.role}:${line.name}`),
      },
    };
    if (line.role === "output") args.outputPorts.push(port);
    else args.inputPorts.push(port);
  }
}

/**
 * **트렁크 파이프 방출** — [emitTapInserting](탭 인서팅)과 나란한 유체판(용어사전 정의).
 * 유체 줄마다 파이프 한 줄을 머신 기둥 전체에 직선으로 깔아 모든 머신의 유체 입구 칸에
 * 직접 닿게 한다. **인서터가 없다** — 유체는 인서터로 못 옮긴다. 포트는 무한**파이프**로
 * 끝난다. 기하 계약([moduleHop] anchor/seat/trunkStart)과 stagger 기준은 [emitTapInserting]
 * 과 같은 [TrunkContext] 를 보므로 서로 어긋나지 않는다.
 *
 * 점프 모드([pipeJumpToClusterPipe])면 좌석 줄(d=1)의 유체 상자 칸만 먹고, 벨트들을 지하로
 * 넘어 바깥 [ClusterPipe] 로 합류한다 — 그래야 그 면의 나머지 좌석이 아이템 줄에 돌아간다.
 */
function emitTrunkPipe(args: {
  plan: { ok: true; lines: PlannedLine[] };
  machines: Container[];
  input: ModuleInput;
  prefix: string;
  occupancy: Set<string>;
  cells: PlacedCell[];
  chests: Container[];
  inputPorts: ModulePort[];
  outputPorts: ModulePort[];
  unroutedLines: IoLine[];
  ctx: TrunkContext;
  /** [emitTapInserting] 과 chestId 순번을 이어 쓰기 위한 공유 카운터. */
  seqRef: { n: number };
}): void {
  const { plan, machines, input, prefix, occupancy, cells, chests, ctx } = args;
  const ext = ctx.ext;

  for (const planned of plan.lines) {
    if (planned.line.kind !== "pipe") continue; // 아이템은 [emitTapInserting] 이 처리한다.
    const line = planned.line;
    const face = planned.side as PortFace;
    const fv = faceVector(face); // 바깥 방향 — 점프 지하파이프의 방향 계산에만 쓰인다.
    const d = ctx.emitDepthOf(planned); // 파이프=1 또는 ClusterPipe 깊이.

    const vertical = face === "W" || face === "E";
    const t0 = vertical ? ext.y0 : ext.x0;
    const t1 = vertical ? ext.y1 : ext.x1;
    const atMin = (input.lineEnds?.get(`${line.role}:${line.name}`) ?? "min") === "min";
    const exitFace: PortFace = vertical ? (atMin ? "N" : "S") : atMin ? "W" : "E";
    const ev = faceVector(exitFace);

    // stagger — [emitTapInserting] 과 같은 기준([TrunkContext.maxDepthAtEnd]).
    const stagger = (ctx.maxDepthAtEnd.get(trunkEndKey(planned, input.lineEnds)) ?? d) - d;
    const tBeltEnd = atMin ? t0 - stagger : t1 + stagger;

    const beltEnd = faceCell(ext, face, d, tBeltEnd);
    const seat = { x: beltEnd.x + ev.x, y: beltEnd.y + ev.y };
    const chestAt = { x: beltEnd.x + 2 * ev.x, y: beltEnd.y + 2 * ev.y };

    const chestId = `${prefix}-${line.role}-${line.name}-${args.seqRef.n++}`;
    const chest: Container = {
      id: chestId,
      kind: "infinity-pipe",
      entityName: "infinity-pipe",
      origin: { ...chestAt },
      size: { w: 1, h: 1 },
      content: line.name,
      role: line.role,
    };
    chests.push(chest);

    // 파이프는 흐름 방향이 없다 — 압력이 알아서 흐른다.
    const beltPair: PortPair = {
      producer: {
        containerId: line.role === "input" ? chestId : machines[0].id,
        cell: { ...beltEnd }, face, kind: { fluid: line.name },
      },
      consumer: {
        containerId: line.role === "input" ? machines[0].id : chestId,
        cell: { ...beltEnd }, face, kind: { fluid: line.name },
      },
    };

    // ── 트렁크 파이프 한 줄 — depth 1 이면 이 직선이 모든 머신의 유체 입구 칸을 지나간다
    // (trunk-pipe §1) — 그래서 인서터도, 탭도, 분기도 필요 없다.
    const beltCells: PlacedCell[] = [];
    const lo = Math.min(t0, tBeltEnd);
    const hi = Math.max(t1, tBeltEnd);
    for (let t = lo; t <= hi; t++) {
      const at = faceCell(ext, face, d, t);
      if (occupancy.has(cellKey(at.x, at.y))) continue; // 안전망(구성상 발생 안 함)
      beltCells.push(makePipeCell(at, input.fluidTrunk!.pipeEntityName, beltPair));
    }

    // ── 포트 끝 — [파이프][무한파이프] 일직선. 인서터가 없다. ──
    const portCells: PlacedCell[] = [
      makeContainerCell(chest, chestAt),
      makePipeCell(seat, input.fluidTrunk!.pipeEntityName, beltPair),
    ];

    // ── [pipeJumpToClusterPipe] — 머신마다 상자 칸에서 지하로 벨트들을 넘어 ClusterPipe 로 ──
    //
    //   머신 | d1 fluidboxPipeCell | d2..dN 벨트(지하로 통과) | dN+1 ClusterPipeTapCell | dN+2 ClusterPipe
    //
    // 각 머신은 **자기 상자 행**에서만 점프한다 — 행이 서로 달라 corridor 끼리 안 부딪힌다.
    // 지하파이프 direction = **지상 입구가 향하는 방향**(표면 연결 측, containerRouting 컨벤션):
    //  - fluidboxPipeCell: 표면이 머신 유체 상자를 향한다(−fv). 터널은 +fv 로 진행.
    //  - ClusterPipeTapCell: 표면이 바깥 ClusterPipe 를 향한다(+fv).
    const jumpCells: PlacedCell[] = [];
    if (ctx.pipeJumpMode) {
      const fbOffset = input.fluidTrunk!.fluidboxOffset!;
      const tapDepth = ctx.clusterPipeDepth - 1;
      for (const m of machines) {
        const row = (vertical ? m.origin.y : m.origin.x) + fbOffset;
        const boxCell = faceCell(ext, face, 1, row);
        const tapCell = faceCell(ext, face, tapDepth, row);
        if (occupancy.has(cellKey(boxCell.x, boxCell.y)) || occupancy.has(cellKey(tapCell.x, tapCell.y))) {
          continue; // 안전망(구성상 발생 안 함 — 좌석 remap 이 상자 행을 비워 둔다).
        }
        jumpCells.push(
          makeUndergroundPipeCell(
            boxCell,
            vectorToDirection(-fv.x, -fv.y),
            input.fluidTrunk!.undergroundPipeEntityName!,
            beltPair,
          ),
          makeUndergroundPipeCell(
            tapCell,
            vectorToDirection(fv.x, fv.y),
            input.fluidTrunk!.undergroundPipeEntityName!,
            beltPair,
          ),
        );
      }
    }

    for (const c of [...beltCells, ...portCells, ...jumpCells]) {
      cells.push(c);
      occupancy.add(cellKey(c.x, c.y));
    }

    const port: ModulePort = {
      line,
      anchor: { ...chestAt },
      tapAnchor: { ...beltEnd },
      face: exitFace,
      moduleWayOuts: [],
      chest,
      cells: beltCells,
      meta: {
        item: line.name,
        side: planned.side,
        laneDepth: d,
        // 파이프는 인서터가 없어 undefined.
        inserter:
          planned.reach === undefined ? undefined : planned.reach >= 2 ? "long" : "normal",
        amount: line.amount,
        endPreference: input.lineEnds?.get(`${line.role}:${line.name}`),
      },
    };
    if (line.role === "output") args.outputPorts.push(port);
    else args.inputPorts.push(port);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 머신 둘레(rim) 칸 하나 — `face` 면 위에서 `slot` 번째. 인서터가 여기 앉는다.
 * W/E 면은 행이 `h` 개, N/S 면은 열이 `w` 개 → 그게 그 면의 1:1 슬롯 수다.
 */
function rimCell(m: Container, face: PortFace, slot: number): { x: number; y: number } {
  const { x, y } = m.origin;
  const { w, h } = m.size;
  switch (face) {
    case "W": return { x: x - 1, y: y + slot };
    case "E": return { x: x + w, y: y + slot };
    case "N": return { x: x + slot, y: y - 1 };
    case "S": return { x: x + slot, y: y + h };
  }
}
