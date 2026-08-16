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
  type IoLine,
  type PlannedLine,
  type PortSide,
  type SupplyCapacity,
  type InsertingDecisionResult,
} from "../planner/module/clusterPortPlanner";
import type { SpecBelt, SpecInserter } from "../buildSpec";
import { fluidLineOf, fluidLinesOnSide, type FluidTrunkInput } from "./fluidPorts";
import { externalLineGroups, readLinkRole, type MachineLinkGroup } from "./machineLinkGroup";
import { layoutCluster } from "./clusterLayout";
// 계획 — 자리 배정 전부. 좌표 이전 단계라 머신을 놓기 전에 돈다(planner/module/ 소관).
import { planModulePorts } from "../planner/module/planModulePorts";
import type { LinkFacePlan, LinkSeats } from "../planner/module/linkPlanner";
// 반출 계획의 입력 — 모듈이 자기 몸통에 대해 답한다(계층 위반 V1 해소, planner/perimeter 소관).
import { fillModuleWayOuts } from "../planner/perimeter/wayOuts";
import type { Container, ModulePortMeta, PlacedCell, PortFace } from "../containerModel";
import { cellKey, enumeratePerimeterCells } from "../util/helper";
import type { PipeFlowPipe } from "../util/pipeFlow";
// 방출 — 계획이 끝난 배정을 셀로 놓는다(배치 실행 계층).
import {
  emitOutputLinks,
  emitInputLinks,
  emitTapInserting,
  emitTrunkPipe,
} from "../execution/module/emitModule";

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
  /** anchor 에 놓인 무한상자(루트 가정의 외부 소스/싱크). 합성 시 벨트 납품 경로로 교체. */
  chest: Container;
  /** 이 포트의 트렁크 belt 셀(spine). Routing.placed 로 써서 선이 벨트를 따라가게 한다. */
  cells: PlacedCell[];
  /** 산출 근거(planner 슬롯 + 트렁크 seed 점수) — 표시·진단 전용, 좌표 없음. */
  meta: ModulePortMeta;
  /**
   * **링크 그룹 신원** — `${childId}→${parentId}:${item}#${groupIndex}`([linkGroupId]).
   * [MachineLinkGroup]에서 난 포트만 갖는다 — 옛 탭/다이렉트 포트는 없다(undefined). 자식·
   * 부모 양쪽 모듈이 packModuleTree 가 간선당 한 번만 계산해 캐시한 **같은 그룹 객체**를
   * 참조하므로 이 값이 항상 일치한다 — [pairDeliveryPorts] 가 배열 위치 대신 이 값으로 조회한다
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
   * 이 모듈의 판정([insertingPlanner]) — **방출이 실제로 이 값에 갈린다**:
   * `"tap"`(트렁크 벨트 한 줄 + 머신별 탭) 또는 `"direct"`(기계별 포트 — 링크 배분기가
   * 자리를 잡고 [emitOutputLinks]/[emitInputLinks] 가 놓는다). 다이렉트면 `reason` 이
   * 왜 탭이 안 됐는지 말하고, 그 문구가 UI 실패 라벨의 참고 사유로 나간다.
   */
  supply?: InsertingDecisionResult;
  /** 직접 탭/라우팅에 실패한 line(유체·미탭) — 진단용. */
  unroutedLines: IoLine[];
  /**
   * **이 모듈이 깐 파이프류 셀 하나하나가 어느 유체를 나르나** — 트렁크·포트·점프 셀 전부.
   *
   * 왜 필요한가: [합류 가드](../util/pipeFlow.ts)는 "이 칸의 파이프가 **무슨 유체**냐"를 알아야
   * 하는데, 모듈이 유체를 여럿 다루면 **모듈 단위로는 답할 수 없다.** 예전엔 호출자가
   * "이 배치의 파이프 셀 = 그 모듈의 유일 유체" 로 태깅했고, 유체가 둘이 되는 순간 자기
   * 파이프를 남의 유체로 오인해 **오염을 못 잡거나 자기 자신을 거절**한다. 그래서 방출한
   * 쪽이 직접 답한다.
   *
   * 지하파이프 셀은 `connectDir`(지상 연결 방향)도 싣는다 — 가드가 **향한 한 면만** 막게
   * 하려면 그 정보가 여기까지 와야 한다. 가드의 입력 자료형을 그대로 쓰는 것이 요점이다.
   */
  pipeCells: PipeFlowPipe[];
}

export interface ModuleInput {
  /** 머신 prototype + footprint. */
  machine: { entityName: string; w: number; h: number };
  /** 머신 대수(≥ 1). */
  count: number;
  /** 레시피 I/O 줄(입력=ingredients, 출력=products). 등장 순서 보존. */
  lines: IoLine[];
  /**
   * 일반 인서터(reach 1) prototype — **계획이 팔을 지목하지 못했을 때의 폴백**이다.
   * 실제로 놓는 팔은 [PlannedLine.inserterEntityName] 가 정한다.
   */
  inserterEntityName: string;
  beltEntityName: string;
  /**
   * **고른 인서터 전부** — reach 별 하나씩([BuildSpec.inserters] 그대로).
   *
   * 예전엔 `longInserter` + `throughput{normal, long}` 이라는 **이진 필드**로 접혀 왔고
   * `planModulePorts.toPlannerInserters` 가 다시 폈다. 그 접힘이 슬롯을 **정확히 둘**로
   * 잘라, *"reach 종류가 늘면 벨트 줄도 는다"* 는 배분기의 주장을 배선이 배신하고 있었다
   * (계획서 §18). 이제 접지 않고 그대로 통과시킨다.
   */
  inserters: SpecInserter[];
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
   * [트렁크 파이프](../../../../docs/auto-layout/module/trunk-pipe.md) 계획 — 유체 줄이
   * 있을 때만. 어느 면에 파이프가 달리고 그러려면 머신을 몇 도 돌려야 하는지는 머신
   * 프로토타입의 `fluid_boxes` 가 정하므로, **게임데이터를 보는 호출자**가 계산해 넘긴다
   * (module/ 는 순수 — store 를 안 본다). 계산은 [fluidPorts.chooseFluidTrunkPlan].
   */
  fluidTrunk?: FluidTrunkInput;
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
  const outLinkGroups = input.outputLinks ?? [];
  const inLinkGroups = input.inputLinks ?? [];

  // ── 계획 — **머신을 놓기 전에 전부 끝난다** ───────────────────────────────
  // 자리를 정하는 일은 여기 한 번뿐이다([planModulePorts]). 좌표가 없어야 이 순서가 성립한다:
  // gap 으로 넘어간 링크는 gap 안에 가로 벨트를 놓고, **gap 폭 = 그 gap 을 지나는 가로 벨트
  // 수**인데, 그 폭이 다시 머신 좌표를 정하기 때문이다(닭과 달걀을 푸는 지점).
  //
  // 아래는 전부 **방출**이다 — 계획이 못박은 자리에 놓기만 하고, 탐색이 없다.
  const plan = planModulePorts(input, count);

  const layout = layoutCluster(
    { w: input.machine.w, h: input.machine.h, count },
    plan.rowGaps.some((g) => g > 0) ? plan.rowGaps : MODULE_ROW_GAP,
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
  // 파이프 셀의 유체 — 방출기가 놓는 자리에서 채운다([GeneratedModule.pipeCells]).
  const pipeCells: PipeFlowPipe[] = [];
  const inputPorts: ModulePort[] = [];
  const outputPorts: ModulePort[] = [];
  const unroutedLines: IoLine[] = [];

  const supply = plan.supply;

  // ── 링크 방출 — 먼저 ───────────────────────────────────────────────────────
  // 링크 줄은 계획에서 이미 자기 좌석·면·순번을 받았고([ModulePortPlan.linkFaces]), 여기서
  // 자기 벨트·포트를 스스로 놓는다. 먼저 놓아야 occupancy 가 채워져, 아래 나머지 줄 방출이
  // 그 자리를 피한다.
  //
  // **나머지 줄의 판정([ModulePortPlan.rest])은 여기 관여하지 않는다.** 예전엔 그 판정이
  // `!plan.ok` 라는 이름으로 링크 방출보다 앞에 있어, 무관한 판정이 이미 성공한 링크 예약을
  // 통째로 삼켰다(2026-07-21). 이름이 `rest` 로 갈라진 지금은 그 착각이 생길 자리가 없다.
  const outSeats = placeLinkSeats(machines, plan.linkFaces.out);
  const inSeats = placeLinkSeats(machines, plan.linkFaces.in);
  const lineOf = new Map(input.lines.map((l) => [`${l.role}:${l.name}`, l]));
  if (outLinkGroups.length > 0) {
    const m = new Map(outLinkGroups.map((g) => [g.item, lineOf.get(`output:${g.item}`)!]));
    emitOutputLinks({ groups: outLinkGroups, seats: outSeats, lineOf: m, machines, input, prefix, occupancy, cells, chests, outputPorts, unroutedLines });
  }
  if (inLinkGroups.length > 0) {
    const m = new Map(inLinkGroups.map((g) => [g.item, lineOf.get(`input:${g.item}`)!]));
    emitInputLinks({ groups: inLinkGroups, seats: inSeats, lineOf: m, machines, input, prefix, occupancy, cells, chests, inputPorts, unroutedLines });
  }

  // 나머지 줄이 못 앉았으면 그 줄들만 unrouted 로 낸다 — **못 앉은 줄이 계획에 적혀 있어서**
  // 여기서 다시 고를 필요가 없다([ModulePortPlan.rest.unplaced]). 링크 줄은 위에서 이미
  // 성패가 갈렸으므로 그 목록에 없다.
  if (!plan.rest.ok) {
    unroutedLines.push(...plan.rest.unplaced);
    fillModuleWayOuts(machines, cells, [...inputPorts, ...outputPorts]);
    return { machines, chests, cells, ring, inputPorts, outputPorts, bbox, unroutedLines, supply, pipeCells };
  }

  // ── 방출 ────────────────────────────────────────────────────────────────────
  // [insertingPlanner] 의 판정에 따라 갈라진다:
  //
  //  - **탭 인서팅**(트렁크): 면을 belt 한 줄이 훑고 머신들이 그 줄을 인서터로 나눠 집는다.
  //    포트 = 벨트 끝 하나 → 모듈 경계 포트가 **품목당 1개**로 준다.
  //  - **다이렉트 인서팅**(1:1): 머신마다 자기 상자+인서터. 포트 = 머신 × 품목.
  //
  // 어느 쪽이든 **탐색이 없다** — 자리는 planner 가 이미 못박았고 방출기는 깔기만 한다.
  // 나머지 줄(유체·링크 없는 줄)만 — 링크 줄은 위에서 이미 놓았고 plan 에도 없다.
  // [탭 인서팅]([emitTapInserting])과 [트렁크 파이프]([emitTrunkPipe])는 용어사전이 이미
  // "나란한 유체판"으로 갈라놓은 두 개념이다 — 둘 다 같은 [buildTrunkContext](기둥 extent·
  // stagger 기준)를 보고, 같은 seqRef 로 chestId 순번을 이어 쓰되, 서로의 줄을 건드리지
  // 않는다(item ↔ pipe 는 line.kind 로 배타적).
  // 아이템 plan(planner)과 유체 배정(pipePlanned, generateModule 이 직접 조립)을 합쳐 트렁크
  // 기하를 **함께** 본다 — stagger 와 pipeJumpMode 는 아이템·유체를 한 번에 훑어야 어긋나지
  // 않는다([buildTrunkContext]). 유체 PlannedLine 은 옛 planner 가 찍던 것과 값이 같아
  // (side=fluidTrunk.side·depth=1) 기하·수치 불변이다.
  const trunkPlan = { ok: true as const, lines: [...plan.rest.lines, ...plan.pipePlanned] };
  const ctx = buildTrunkContext(
    trunkPlan, machines, input, plan.isJumpableToClusterPipe, plan.gapExitSides, plan.linkFaceDepths,
  );
  const seqRef = { n: 0 };

  if (supply.mode === "tap") {
    // **외부 줄(원료·완제품)을 [MachineLinkGroup] 으로 — 방출기가 링크와 같은 자료구조를 본다.**
    // 링크 방출([emitOutputLinks])이 이미 group 을 주 자료로 보므로, 탭 방출도 여기 맞춘다
    // (자료구조 통일 1단계). 팔 수는 [requiredInserterCount] 에서 오므로 planner 값과 **같다** →
    // 기하·수치 불변(점수 불변). 다음 단계에서 group 의 `from`/`to`(머신마다 팔)를 실제로 쓴다.
    const groupOf = new Map<string, MachineLinkGroup>();
    for (const g of externalLineGroups(input.lines, count, input.supplyCapacity ?? {}, input.inserters, plan.linkedKeys)) {
      groupOf.set(`${readLinkRole(g)}:${g.item}`, g);
    }
    emitTapInserting({
      plan: trunkPlan, machines, input, prefix, occupancy,
      cells, chests, inputPorts, outputPorts, unroutedLines,
      ctx, seqRef, groupOf,
    });
  } else {
    // ── (나) 기계별 포트 — **링크와 같은 방출기** ────────────────────────────────
    // 배정이 링크와 같은 자료([LinkFacePlan])로 왔으므로 놓는 것도 같은 코드다. 그래서
    // gap(위/아래)에 앉은 그룹도 **새 코드 없이** 가로 벨트로 나간다 — 이 통합의 실질이다.
    // 상자 id 는 방출기가 품목 이름으로 만드는데, 링크가 맡은 줄과 여기 줄은 `linkedKeys` 로
    // 배타적이라 이름이 겹칠 수 없다.
    const rest = plan.restLinks!; // (나) 면 배정은 mode==="direct" 와 함께 온다([planModulePorts]).
    const restOutSeats = placeLinkSeats(machines, rest.out.plans);
    const restInSeats = placeLinkSeats(machines, rest.in.plans);
    const restLineOf = new Map(input.lines.map((l) => [l.name, l]));
    emitOutputLinks({ groups: rest.out.groups, seats: restOutSeats, lineOf: restLineOf, machines, input, prefix, occupancy, cells, chests, outputPorts, unroutedLines });
    emitInputLinks({ groups: rest.in.groups, seats: restInSeats, lineOf: restLineOf, machines, input, prefix, occupancy, cells, chests, inputPorts, unroutedLines });
  }

  // ── [트렁크 파이프] — **아이템 공급 방식 밖에서 한 번** ─────────────────────────
  // 파이프 기하는 아이템을 어떻게 나르는지와 무관하다: 면은 머신 `fluid_boxes` 가 강제하고,
  // 파이프는 팔이 없어 그 칸에 직접 닿아야 하므로 탭이든 1:1 이든 같은 줄을 같은 깊이로 지난다.
  // 예전엔 이 호출이 tap 가지 **안에** 있었다 — 그래서 아이템이 1:1 로 물러나는 순간 유체가
  // 조용히 사라졌고, 그 조용한 실패를 막으려고 [planModulePorts] 가 유체 모듈을 통째로
  // 거절해야 했다(`fluidNeedsTap`). 방출을 갈래 밖으로 꺼내면 그 거절의 근거가 없어진다.
  //
  // **그 관문(`fluidNeedsTap`)은 이제 없다** — [planModulePorts] 가 근거와 함께 지웠고,
  // 남은 유체 실패는 "배정을 못 받은 유체 줄이 있다"(`fluidUnplaceable`) 하나뿐이다.
  // 그래서 **1:1 가지에서도 여기 도달한다.** 도달해도 기하는 같다는 것이 위 문단의 요지이고,
  // 그 사실은 방출기 단위 테스트가 지킨다.
  emitTrunkPipe({
    plan: trunkPlan, machines, input, prefix, occupancy,
    cells, chests, inputPorts, outputPorts, unroutedLines,
    ctx, seqRef, pipeCells,
  });

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
    pipeCells,
  };
}
/**
 * 면 배정에 **좌표를 입힌다** — 머신이 놓인 뒤에 부른다. 하는 일은 덧셈뿐이다.
 *
 * "면에서 몇 번째 칸" 은 배정의 일이라 [commitLinkFace] 가 이미 끝냈고
 * ([LinkFacePlan.slotIndex] — 채우는 방향까지 거기서 정해진다), 여기서는 그 순번에
 * 머신 원점을 더해 `t` 로 바꾼다. `t` 의 뜻은 [faceCell] 과 같다:
 * W/E 면이면 y(행), N/S 면이면 x(열).
 *
 * **이 함수가 장부를 안 쓴다는 것이 요점이다.** 예전엔 여기서 빈 장부(`placeLedger`)를
 * 새로 만들어 배정이 이미 센 누적을 처음부터 다시 셌다 — 같은 사실을 두 주체가 두 번
 * 계산하면 언젠가 어긋난다.
 */
function placeLinkSeats(
  machines: Container[],
  plans: (LinkFacePlan | undefined)[],
): (LinkSeats | undefined)[] {
  return plans.map((plan) => {
    if (!plan) return undefined;
    const isGap = plan.face === "N" || plan.face === "S";
    const slots = new Map<number, number[]>();
    for (const [mi, idx] of plan.slotIndex) {
      const m = machines[mi];
      if (!m) return undefined;
      const origin = isGap ? m.origin.x : m.origin.y;
      slots.set(mi, idx.map((i) => origin + i));
    }
    return { ...plan, slots };
  });
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
export interface TrunkContext {
  ext: { x0: number; y0: number; x1: number; y1: number };
  /** **면별** [pipeJumpToClusterPipe] 가 실제로 켜졌는가. 면마다 벨트 수·유체 줄 수가 달라 갈린다. */
  pipeJumpMode: (side: PortSide) => boolean;
  /** 순번 `rank` 유체 줄의 ClusterPipe 깊이 — `base + 2 + 2·rank`(trunk-pipe §5.1). 탭은 그 −1. */
  clusterPipeDepth: (side: PortSide, rank: number) => number;
  /** 줄의 **실제 배치 깊이** — 유체 줄은 점프 모드면 자기 순번의 ClusterPipe 깊이, 아니면 계획값. */
  emitDepthOf: (p: PlannedLine) => number;
  /** 같은 면·같은 끝으로 나가는 줄들의 최대 레인 깊이 — stagger 계산의 기준. */
  maxDepthAtEnd: Map<string, number>;
}

/** [TrunkContext.maxDepthAtEnd] 의 조회 키 — 같은 면·같은 끝(min/max)이면 같은 키. */
export function trunkEndKey(p: PlannedLine, lineEnds: ModuleInput["lineEnds"]): string {
  // 구간이 자기 끝을 지목했으면 그것이 우선이다 — 같은 줄의 두 구간은 **반대 끝**으로 나간다.
  const end = p.exitEnd ?? lineEnds?.get(`${p.line.role}:${p.line.name}`) ?? "min";
  return `${p.side}:${end}`;
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
  isJumpableToClusterPipe: (side: PortSide) => boolean,
  gapExitSides: ReadonlySet<PortFace>,
  linkFaceDepths: Partial<Record<PortFace, number>>,
): TrunkContext {
  const ext = {
    x0: Math.min(...machines.map((m) => m.origin.x)),
    y0: Math.min(...machines.map((m) => m.origin.y)),
    x1: Math.max(...machines.map((m) => m.origin.x + m.size.w - 1)),
    y1: Math.max(...machines.map((m) => m.origin.y + m.size.h - 1)),
  };

  // ── 면별 값 — trunk-pipe §5.1 공식 한 곳 ────────────────────────────────────────────────
  //   base = max(그 면 벨트 최대 깊이, 1) · D_r = base + 2 + 2r · 탭 = D_r − 1
  // `n=1, beltMax>0` 을 넣으면 `beltMax + 2` — **현행과 같은 수**다(회귀 0).
  // **탭 벨트와 링크 벨트를 함께 센다.** `plan.lines` 는 탭 계획뿐이라, 링크·다이렉트가 앉은
  // 면에서는 이것만 보면 0 을 답한다 — 그러면 ClusterPipe 가 링크 포트 끝(d`laneDepth+2`)
  // **위로** 지나가고, 파이프가 끊겨도 겹침도 미배치도 아니라 아무도 못 알아챈다.
  // 오늘은 [tryLinkFace] 가 유체 면을 통째로 거절하므로 유체 면의 링크 깊이는 언제나 없고,
  // 따라서 이 항은 **아직 아무 배치도 바꾸지 않는다** — 유체 면을 여는 다음 단계의 안전망이다.
  const beltMaxOn = (side: PortSide): number =>
    Math.max(
      plan.lines.reduce((a, p) => (p.line.kind === "belt" && p.side === side ? Math.max(a, p.clusterBeltDepth) : a), 0),
      linkFaceDepths[side] ?? 0,
    );
  const baseOn = (side: PortSide): number => Math.max(beltMaxOn(side), 1);

  // 점프 게이트 — 좌석 줄(d1)을 통째로 먹는 옛 스파인이 **무언가를 밟을 때** 점프한다:
  //  ① 넘을 벨트가 있다(옛 조건).
  //  ② 유체가 둘 이상 — 스파인이 둘째 유체의 상자 칸을 막는다(trunk-pipe §5.1).
  //  ③ **이 레시피가 안 쓰는 유체 상자 칸이 그 면에 있다**(2026-08-05 추가). 화학공장은 입력
  //     상자가 E 면에 둘인데 battery 는 하나만 쓴다 — 스파인이 안 쓰는 칸까지 지나 거기 붙고,
  //     합류 가드가 hard 위반으로 모듈을 거절한다. 넘을 벨트가 없어도 **비켜 가야 한다.**
  //     (실측 전에는 아이템이 늘 그 면에 있어 ①이 우연히 가려 주고 있었다.)
  //  ④ **gap 벨트가 이 면으로 빠져나간다**(2026-08-05 추가 — [gapExitSidesFromPlans]).
  //     ①이 못 보는 자리다: gap 벨트는 `plan.lines` 가 아니라 링크 배정에서 나오므로
  //     `beltMaxOn` 이 0 을 답한다. 그 벨트의 포트 끝(인서터 d1 · 상자 d2)이 gap 행에서
  //     좌석 줄을 먹고, 스파인은 거기서 **끊긴다** — 아래쪽 머신이 유체를 못 받는데 겹침도
  //     미배치도 아니라 아무도 모른다. 점프하면 파이프가 d3 으로 물러나 d1·d2 를 비운다.
  const unusedBoxRowsOn = (side: PortSide): number =>
    (input.fluidTrunk?.unusedFluidboxRows?.[side] ?? []).length;
  const pipeJumpMode = (side: PortSide): boolean =>
    isJumpableToClusterPipe(side) &&
    (beltMaxOn(side) > 0 ||
      fluidLinesOnSide(input.fluidTrunk, side).length >= 2 ||
      unusedBoxRowsOn(side) > 0 ||
      gapExitSides.has(side));
  const clusterPipeDepth = (side: PortSide, rank: number): number => baseOn(side) + 2 + 2 * rank;

  const emitDepthOf = (p: PlannedLine): number => {
    if (p.line.kind !== "pipe") return p.clusterBeltDepth;
    const side = p.side as PortSide;
    if (!pipeJumpMode(side)) return p.clusterBeltDepth; // 옛 스파인 — d1 로 기둥 전체.
    return clusterPipeDepth(side, fluidLineOf(input.fluidTrunk, p.line)?.rank ?? 0);
  };

  const maxDepthAtEnd = new Map<string, number>();
  for (const p of plan.lines) {
    const k = trunkEndKey(p, input.lineEnds);
    maxDepthAtEnd.set(k, Math.max(maxDepthAtEnd.get(k) ?? 0, emitDepthOf(p)));
  }

  return { ext, pipeJumpMode, clusterPipeDepth, emitDepthOf, maxDepthAtEnd };
}
