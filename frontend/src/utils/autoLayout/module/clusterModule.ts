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
import type { MachineLink } from "./allocateMachineLinks";
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
   * ([allocateMachineLinks]). 각 링크 = 이 클러스터의 한 머신에서 나가는 벨트 하나(팔 n개).
   * 부모를 봐야 정해지므로 부모-무시인 generateModule 이 못 만든다 — 트리를 아는
   * packModuleTree 가 계산해 넣는다. **있으면 출력 방출이 "줄당 트렁크 하나"(fan-out 병합)
   * 대신 "머신당·목적지별 벨트"로 갈라 나간다.** 미지정(rate 미상 등)이면 옛 트렁크 방출.
   */
  outputLinks?: MachineLink[];
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
  const layout = layoutCluster(
    {
      w: input.machine.w,
      h: input.machine.h,
      count: Math.max(1, input.count),
    },
    MODULE_ROW_GAP,
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

  const plannerInput = {
    lines: plannedLines,
    inserters: plannerInserters,
    outputSide: "W" as const, // 좌우 계층형: 부모=좌=W. 출력을 W 에 먼저 확정((B) 정책).
    nsFaces: input.nsExposure, // 노출 끝면 — external 입력의 W-spill 완화(E→N/S→W).
    slotsPerFace: { WE: input.machine.h, NS: input.machine.w },
    pipeSide: input.fluidTrunk?.side, // 유체가 붙는 면.
    isJumpableToClusterPipe, // true=좌석 살림(일반 면), false=옛 스파인(케이스 B).
    belts: input.belts,
  };
  const supply: InsertingDecisionResult = insertingPlanner(
    plannerInput,
    machines.length,
    input.supplyCapacity,
  );

  const plan = supply.plan;
  if (!plan.ok) {
    for (const l of plannedLines) unroutedLines.push(l);
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
    emitTapInserting({
      plan, machines, input, prefix, occupancy,
      cells, chests, inputPorts, outputPorts, unroutedLines,
      isJumpableToClusterPipe,
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
  /** generateModule 이 계산한 [isJumpableToClusterPipe] — planner 와 같은 값을 봐야 한다. */
  isJumpableToClusterPipe: boolean;
}): void {
  const { plan, machines, input, prefix, occupancy, cells, chests } = args;

  // 머신 기둥의 실제 extent — belt 가 덮어야 할 범위.
  const ext = {
    x0: Math.min(...machines.map((m) => m.origin.x)),
    y0: Math.min(...machines.map((m) => m.origin.y)),
    x1: Math.max(...machines.map((m) => m.origin.x + m.size.w - 1)),
    y1: Math.max(...machines.map((m) => m.origin.y + m.size.h - 1)),
  };

  // 면별로 이미 쓴 탭 좌석 행. 같은 면의 두 줄(가까운/먼 레인)은 belt 열은 다르지만
  // **좌석은 같은 d=1 열**에 앉으므로, 줄마다 다른 행을 줘야 겹치지 않는다.
  const slotOnFace = new Map<PlannedSide, number>();
  let seq = 0;

  // ── [pipeJumpToClusterPipe] 모드 — 유체 줄이 좌석 줄 대신 바깥 [ClusterPipe] 로 ──
  //
  // 점프 가능 판정(isJumpableToClusterPipe)이 참이어도, 그 면에 **벨트가 하나도 안 앉았으면**
  // 넘을 것이 없다 → 옛 스파인(d=1)이 그대로 최선이라 점프하지 않는다(폭 낭비 0).
  //
  // ClusterPipe 깊이 = 그 면 벨트 최대 깊이 + 2:
  //   +1 = [ClusterPipeTapCell] — 지하파이프는 **지하 방향으로만** 합류하고 옆(수직)으론
  //        못 이어서, 탭이 ClusterPipe 줄 위에 앉으면 세로 연속이 끊긴다 → 1칸 안쪽.
  //   +2 = ClusterPipe 본체(일반 파이프 세로줄).
  // (나중에: 벨트를 지하벨트로 접으면 탭·ClusterPipe 를 더 안쪽으로 당길 수 있다 — 최적화 보류.)
  const pipeFaceBeltMax = plan.lines.reduce(
    (a, p) =>
      p.line.kind === "belt" && p.side === input.fluidTrunk?.side
        ? Math.max(a, p.clusterBeltDepth)
        : a,
    0,
  );
  const pipeJumpMode = args.isJumpableToClusterPipe && pipeFaceBeltMax > 0;
  const clusterPipeDepth = pipeFaceBeltMax + 2;
  /** 줄의 **실제 배치 깊이** — 유체 줄은 점프 모드면 ClusterPipe 깊이, 아니면 계획값 그대로. */
  const emitDepthOf = (p: PlannedLine): number =>
    p.line.kind === "pipe" && pipeJumpMode ? clusterPipeDepth : p.clusterBeltDepth;

  /** 같은 면·같은 끝으로 나가는 줄들의 최대 레인 깊이 — stagger 계산의 기준(아래 참고). */
  const endKey = (p: PlannedLine): string =>
    `${p.side}:${(input.lineEnds?.get(`${p.line.role}:${p.line.name}`) ?? "min")}`;
  const maxDepthAtEnd = new Map<string, number>();
  for (const p of plan.lines) {
    const k = endKey(p);
    maxDepthAtEnd.set(k, Math.max(maxDepthAtEnd.get(k) ?? 0, emitDepthOf(p)));
  }

  for (const planned of plan.lines) {
    const line = planned.line;
    const face = planned.side as PortFace;
    const fv = faceVector(face); // 바깥 방향(머신 → 면)
    const d = emitDepthOf(planned); // 가까운 belt=2, 먼=3, 케이스 B=4. 파이프=1 또는 ClusterPipe 깊이.
    const isPipe = line.kind === "pipe";

    // 좌석 행 배정은 **인서터가 있는 줄만** 한다 — 트렁크 파이프는 인서터가 없어서 좌석
    // 행을 안 먹는다(머신 유체 입구에 직접 닿는다). [Parallel Inserting]: 한 줄이 머신마다
    // 탭 `taps` 개를 쓰면 좌석 행도 그만큼 연속으로 먹는다.
    const taps = isPipe ? 0 : Math.max(1, planned.requiredInserterCount ?? 1);
    let slot = 0;
    if (!isPipe) {
      const lateralCap = face === "W" || face === "E" ? input.machine.h : input.machine.w;
      slot = slotOnFace.get(planned.side) ?? 0;
      if (slot + taps > lateralCap) {
        args.unroutedLines.push(line); // 좌석 행 부족 — planner 용량과 어긋난 것(안전망).
        continue;
      }
      slotOnFace.set(planned.side, slot + taps);
    }

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
    const stagger = (maxDepthAtEnd.get(endKey(planned)) ?? d) - d;
    const tBeltEnd = atMin ? t0 - stagger : t1 + stagger;

    const beltEnd = faceCell(ext, face, d, tBeltEnd); // 트렁크의 포트 쪽 끝(= trunkStart)
    const seat = { x: beltEnd.x + ev.x, y: beltEnd.y + ev.y }; // 포트 인서터
    const chestAt = { x: beltEnd.x + 2 * ev.x, y: beltEnd.y + 2 * ev.y }; // 포트 상자(anchor)

    const chestId = `${prefix}-${line.role}-${line.name}-${seq++}`;
    // 유체는 무한**파이프**, 아이템은 무한**상자**로 외부와 만난다.
    const chest: Container = {
      id: chestId,
      kind: isPipe ? "infinity-pipe" : "infinity-chest",
      entityName: isPipe ? "infinity-pipe" : "infinity-chest",
      origin: { ...chestAt },
      size: { w: 1, h: 1 },
      content: line.name,
      role: line.role,
    };
    chests.push(chest);

    // belt 흐름 — 출력(collect)은 머신들이 놓은 것이 **포트 쪽으로** 모여 흐르고,
    // 입력(supply)은 포트로 들어온 것이 **기둥 안쪽으로** 퍼진다. 정반대다.
    // (파이프는 흐름 방향이 없다 — 압력이 알아서 흐른다. beltDir 을 안 쓴다.)
    const flow = line.role === "output" ? ev : { x: -ev.x, y: -ev.y };
    const beltDir = vectorToDirection(flow.x, flow.y);

    const beltPair: PortPair = {
      producer: {
        containerId: line.role === "input" ? chestId : machines[0].id,
        cell: { ...beltEnd }, face, kind: isPipe ? { fluid: line.name } : "item",
      },
      consumer: {
        containerId: line.role === "input" ? machines[0].id : chestId,
        cell: { ...beltEnd }, face, kind: isPipe ? { fluid: line.name } : "item",
      },
    };

    // ── 트렁크 한 줄 — 기둥 전체(+stagger)를 직선으로. 탐색 0. ──
    // 아이템이면 belt, 유체면 [트렁크 파이프]. 파이프는 depth 1 이라 이 직선이 **모든 머신의
    // 유체 입구 칸을 지나간다** — 그래서 인서터도, 탭도, 분기도 필요 없다(trunk-pipe §1).
    const beltCells: PlacedCell[] = [];
    const lo = Math.min(t0, tBeltEnd);
    const hi = Math.max(t1, tBeltEnd);
    for (let t = lo; t <= hi; t++) {
      const at = faceCell(ext, face, d, t);
      if (occupancy.has(cellKey(at.x, at.y))) continue; // 안전망(구성상 발생 안 함)
      beltCells.push(
        isPipe
          ? makePipeCell(at, input.fluidTrunk!.pipeEntityName, beltPair)
          : makeBeltCell(at, beltDir, planned.beltEntityName ?? input.beltEntityName, beltPair),
      );
    }

    // ── 포트 끝 — 트렁크 끝 바깥에 일직선 ──
    // 아이템: [인서터][상자]. 유체: [파이프][무한파이프] — **인서터가 없다**(유체는 인서터로
    // 못 옮긴다). 칸 배치(anchor−ev, anchor−2·ev)는 같아서 [moduleHop] 포트 계약은 그대로다.
    const portPickup = line.role === "input" ? ev : { x: -ev.x, y: -ev.y };
    const portCells: PlacedCell[] = [
      makeContainerCell(chest, chestAt),
      isPipe
        ? makePipeCell(seat, input.fluidTrunk!.pipeEntityName, beltPair)
        : makeInserterCell(seat, portPickup, input.inserterEntityName, beltPair),
    ];

    // ── 탭 인서터 — 머신마다 [taps]개. 한 belt 를 나눠 집는다. 파이프는 탭이 없다. ──
    //
    // [Parallel Inserting]: 머신당 수요가 인서터 하나를 넘으면 좌석을 더 써서 **같은
    // ClusterBelt 를 여러 번** 집는다. taps 개를 slot..slot+taps−1 연속 행에 앉힌다.
    //
    // 점프 모드의 유체 면: 좌석 줄(d=1)에서 **상자 행 하나는 [fluidboxPipeCell] 자리**다.
    // 벨트 좌석은 그 행을 건너뛰어 앉는다 — 이게 "머신 유체 상자에 닿아야 하는 칸을 제외한
    // 남는 공간을 활용한다"의 실체다. (용량은 insertingPlanner 좌석 예산이 이미 보장.)
    const skipRow =
      pipeJumpMode && planned.side === input.fluidTrunk?.side
        ? input.fluidTrunk!.fluidboxOffset!
        : undefined;
    const remapRow = (r: number) => (skipRow !== undefined && r >= skipRow ? r + 1 : r);
    const tapCells: PlacedCell[] = [];
    const seatDepth = tapSeatDepth(planned);
    for (const m of isPipe ? [] : machines) {
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

    // ── [pipeJumpToClusterPipe] — 머신마다 상자 칸에서 지하로 벨트들을 넘어 ClusterPipe 로 ──
    //
    //   머신 | d1 fluidboxPipeCell | d2..dN 벨트(지하로 통과) | dN+1 ClusterPipeTapCell | dN+2 ClusterPipe
    //
    // 각 머신은 **자기 상자 행**에서만 점프한다 — 행이 서로 달라 corridor 끼리 안 부딪힌다.
    // 지하파이프 direction = **지상 입구가 향하는 방향**(표면 연결 측, containerRouting 컨벤션):
    //  - fluidboxPipeCell: 표면이 머신 유체 상자를 향한다(−fv). 터널은 +fv 로 진행.
    //  - ClusterPipeTapCell: 표면이 바깥 ClusterPipe 를 향한다(+fv).
    const jumpCells: PlacedCell[] = [];
    if (isPipe && pipeJumpMode) {
      const fbOffset = input.fluidTrunk!.fluidboxOffset!;
      const tapDepth = clusterPipeDepth - 1;
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

    for (const c of [...beltCells, ...portCells, ...tapCells, ...jumpCells]) {
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
        // reach 를 여기서 이진 라벨로 접는다. 파이프는 인서터가 없어 undefined. (reach>2 가
        // ModuleInput 까지 흘러오면 이 라벨은 무손실이 아니게 되나, v1 은 1·긴팔뿐이라 안전.)
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
