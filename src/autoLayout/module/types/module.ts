/**
 * **모듈 하나가 무엇을 받고 무엇을 내나** — 입력([ModuleInput]), 산출([GeneratedModule]),
 * 경계에 선 포트([ModulePort]), 그리고 방출이 되묻는 트렁크 값([TrunkContext])·벨트 끝 칸([BeltTerminus]).
 *
 * > **내력.** `module/build.ts`·`module/late.ts` 에 있다가 2026-09-13
 * > 여기로 왔다(계획 구조-2축 · 2 Step 1). 방출기가 이 타입과 [trunkEndKey] 를 가지러 조율자를
 * > **런타임으로** 불러, 저장소의 유일한 순환(`clusterModule ⇄ emitModule`)이 거기서 났다.
 */

import type { SpecBelt, SpecInserter, SpecUndergroundBelt } from "../../shared/gamedata/spec";
import type {
  Container, ModulePortMeta, PlacedCell, PortFace, PortPair,
} from "../../shared/types";
import type { FluidTrunkInput } from "../gamedata";
import type { IoLine, Link, PlannedLine, PortSide, SupplyCapacity } from "./line";
import type { DepthShortage, LinkFaceStage } from "./seat";
import type { PipeFlowPipe } from "../../shared/pipeFlow";

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
   * (`docs/용어사전.md §BuildSpec` — 유일한 출처). 이제 접지 않고 그대로 통과시킨다.
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
   * **밖에서 이미 끝난 링크 면 배정**(`modulePacking.seatTree`). 없으면 [planModulePorts] 가 직접 돌린다.
   *
   * 배정이 `generateModule` **안에 갇혀 있으면** 그 결과를 보려고 방출까지 해야 하고,
   * 고치려면 밖에서 입력을 고쳐 **다시 만들어야** 한다 — 그게 되먹임 둘의 뿌리였다
   * 이 필드가 그 문을 열어 둔다.
   */
  linkFaceStage?: LinkFaceStage;
  /**
   * 노출된 끝면(N/S, 선호 순서) — count=1 완화. external 입력이 W-spill 전에 이 면의
   * 깊이를 쓴다(planner E→N/S→W). 노출 판정(열의 끝 + 전역 마진 방향)은 packModuleTree
   * 가 DFS 열-내 순서에서 유도한다. 미지정=기존 동작(W/E 만).
   */
  nsExposure?: ("N" | "S")[];
  /**
   * 트렁크(탭 인서팅) 용량 — 있으면 [insertingPlanner] 의 벨트 처리량 검사가
   * 켜진다. 미지정이면 간단한 레시피 판별만 본다(없는 숫자를 지어내지 않는다).
   */
  supplyCapacity?: SupplyCapacity;
  /**
   * 고를 수 있는 벨트들([BuildSpec.belts](../../shared/gamedata/spec.ts)) — 수요가 벨트 한 줄을 넘을 때
   * [determineBeltCount] 가 여기서 티어를 골라 **줄을 늘린다**. 미지정이면 줄을 안 늘린다
   * (옛 동작: 거절 → 다이렉트). `beltEntityName` 은 기본/폴백 벨트로 남는다.
   */
  belts?: SpecBelt[];
  /**
   * 고를 수 있는 지하벨트들([BuildSpec.undergroundBelts](../../shared/gamedata/spec.ts)) — **벨트 흐름의
   * 종착**에 쓴다([resolveBeltTermini]). 끝 칸이 어느 방향으로 꺾어도 남의 품목과 합류하게
   * 되면, 그 칸을 **가장 느린** 지하벨트 입구로 바꿔 흐름을 그 자리에서 끝낸다.
   * 미지정이면 종착을 못 세우고 그 줄을 정직하게 포기한다.
   */
  undergroundBelts?: SpecUndergroundBelt[];
  /**
   * **출력 fan-out 링크** — 이 노드의 출력을 부모 머신들에게 어떻게 나눠 주나
   * ([allocateFlows]). 각 그룹 = 이 클러스터의 한 머신에서 나가는 벨트 하나(목적지
   * 목록 `taps`). 부모를 봐야 정해지므로 부모-무시인 generateModule 이 못 만든다 — 트리를
   * 아는 packModuleTree 가 계산해 넣는다. **있으면 출력 방출이 "줄당 트렁크 하나"(fan-out
   * 병합) 대신 "머신당·목적지별 벨트"로 갈라 나간다.** 미지정(rate 미상 등)이면 옛 트렁크 방출.
   *
   * **그룹 하나 = 물리 벨트 하나 = 포트 한 쌍**([Link]). v1 은 링크 하나가 곧 그룹 하나다.
   * 신원([makeLinkId])은 그룹 자신의 `id` 필드에 실려 온다 — `ModulePort.linkId` 가 된다.
   */
  outputLinks?: Link[];
  /**
   * **입력 fan-in 그룹** — `outputLinks` 의 거울: 같은 간선의 같은 그룹을 부모(toMachine)
   * 관점에서 받은 것(같은 [Link] 객체 — packModuleTree 가 간선당 한 번만 계산해
   * 캐시한 것을 그대로 참조). 그룹마다 입력 트렁크 하나(그룹의 toMachine 들을 세로로 관통하는
   * 벨트 + 머신별 탭)가 나서, 자식 출력 벨트와 **그룹 순서로 1:1** 짝지어진다. 미지정=옛 트렁크 입력.
   */
  inputLinks?: Link[];
  /**
   * [트렁크 파이프](../../../../../docs/auto-layout/module/trunk-pipe.md) 계획 — 유체 줄이
   * 있을 때만. 어느 면에 파이프가 달리고 그러려면 머신을 몇 도 돌려야 하는지는 머신
   * 프로토타입의 `fluid_boxes` 가 정하므로, **게임데이터를 보는 호출자**가 계산해 넘긴다
   * (module/ 는 순수 — store 를 안 본다). 계산은 [fluidPorts.chooseFluidTrunkPlan].
   */
  fluidTrunk?: FluidTrunkInput;
}

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
   * 왜 필요한가: 반출 경로 예약([perimeterExitPlanner])이 `meta.side` 만 보고 배정하면
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
   * **이 포트가 나르는 초당 개수** — 이 포트를 낸 [Link] 의 적재 합([groupRate]).
   * 모르면 `undefined`(지어내지 않는다).
   *
   * **모듈 경계를 넘어 살아남는 유일한 운반량이다.** 이 값이 없으면 납품 경로·반출 경로가
   * *"이 벨트에 얼마가 흐르나"* 를 되물을 곳이 없어, 벨트 티어를 **고를 근거 자체가 없다**
   * (2026-08-23 조사: 그래서 두 경로가 기본 벨트 하나로만 깔리고 있었다).
   */
  rate?: number;
  /**
   * **이 포트의 벨트 줄이 고른 티어** — 모듈 **안쪽** 벨트가 이 이름으로 깔린다
   * ([Link.beltEntityName]). 모르면 `undefined`(기본 벨트).
   *
   * 모듈 **밖**(납품·반출)은 아직 이 값을 안 쓴다 — 쓰려면 지하벨트 티어도 함께 맞춰야
   * 한다(안 맞추면 점프 칸이 그 줄을 목 조른다). → `tempPlanDocs/배선-형태/`
   */
  beltEntityName?: string;
  /**
   * **링크 그룹 신원** — `${childId}→${parentId}:${item}#${groupIndex}`([makeLinkId]).
   * [Link]에서 난 포트만 갖는다 — 옛 탭/다이렉트 포트는 없다(undefined). 자식·
   * 부모 양쪽 모듈이 packModuleTree 가 간선당 한 번만 계산해 캐시한 **같은 그룹 객체**를
   * 참조하므로 이 값이 항상 일치한다 — [pairDeliveryPorts] 가 배열 위치 대신 이 값으로 조회한다
   * (2026-07-21, 옛 `seq` 위치-zip 이 방출 실패 시 조용히 밀리던 문제의 근치).
   */
  linkId?: string;
  /**
   * **이 포트의 줄이 남과 물리 벨트를 나눠 쓰나**([Link.sharedLineId] 를 그대로 복사).
   *
   * 같은 값을 가진 포트 둘은 **같은 칸**에 서 있다(논리 포트 둘 · 물리 벨트 하나).
   * 채널이 이걸 보고 두 납품 경로를 **한 칸에서 합류**시킨다 — 안 보면 둘이 같은 자리를
   * 두고 다투다 하나가 폴백으로 떨어진다.
   *
   * `linkId` 와 같은 규칙으로 산다 — **불투명 토큰이고 이 폴더는 파싱하지 않는다.**
   */
  sharedLineId?: string;
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
   * **몸통이 먹는 로컬 열들**(`x − extent.x`) — 남의 **세로 직진**이 *"네 열 c 를 지나가도
   * 되나"* 를 물을 때의 답이다([bodyColumnsOf]). 여기 없는 열은 위아래로 뚫려 있다.
   *
   * 모듈은 여전히 **블랙박스**다 — 배정기가 보는 것은 이 요약뿐이고 안쪽 배치는 안 본다.
   * `moduleWayOuts` 와 **같은 순간·같은 몸통**에서 나온다([fillModuleWayOuts]): 같은
   * 사실을 두 곳에서 세면 언젠가 어긋나기 때문이다.
   */
  bodyColumns: ReadonlySet<number>;
  /**
   * **못 앉은 내부 링크의 사유** — `linkId` → [DepthShortage]. 사다리 1단의 입력이다.
   * 쪼개는 주체는 `modulePacking` 이다(링크 객체를 양끝이 공유하므로).
   */
  depthShortages?: Map<string, DepthShortage[]>;
  /** 직접 탭/라우팅에 실패한 line(유체·미탭) — 진단용. */
  unroutedLines: IoLine[];
  /**
   * **부을 수조차 없던 줄의 처방** — `${role}:${name}` → 위저드 단계
   * ([ModulePortPlan.unpourableFix]). 화면이 *"어느 단계로 돌아가라"* 를 여기서 읽는다.
   */
  unpourableFix?: Map<string, "belt" | "inserter">;
  /**
   * **이 모듈이 깐 파이프류 셀 하나하나가 어느 유체를 나르나** — 트렁크·포트·점프 셀 전부.
   *
   * 왜 필요한가: [합류 가드](../../shared/pipeFlow.ts)는 "이 칸의 파이프가 **무슨 유체**냐"를 알아야
   * 하는데, 모듈이 유체를 여럿 다루면 **모듈 단위로는 답할 수 없다.** 예전엔 호출자가
   * "이 배치의 파이프 셀 = 그 모듈의 유일 유체" 로 태깅했고, 유체가 둘이 되는 순간 자기
   * 파이프를 남의 유체로 오인해 **오염을 못 잡거나 자기 자신을 거절**한다. 그래서 방출한
   * 쪽이 직접 답한다.
   *
   * 지하파이프 셀은 `connectDir`(지상 연결 방향)도 싣는다 — 가드가 **향한 한 면만** 막게
   * 하려면 그 정보가 여기까지 와야 한다. 가드의 입력 자료형을 그대로 쓰는 것이 요점이다.
   */
  pipeCells: PipeFlowPipe[];
  /**
   * **피할 수 없어 합류한 채로 남긴 끝 칸** — 벨트 흐름의 종착이 어느 방향으로 꺾어도 남의
   * 품목과 만나는데 지하벨트를 하나도 안 골라 [벨트 종착](../late.ts)을
   * 못 세운 자리다. 비어 있는 것이 정상이다.
   *
   * 모듈은 **판정만** 하고 화면에 못 올린다(형제도 위저드도 모른다). `planner/run/policy` 가
   * 이 배열을 `belt-terminus-merge` **경고**로 빚어 그 칸을 화면에 찍는다.
   */
  beltMerges: BeltMerge[];
}

/**
 * **트렁크 방출이 줄마다 되묻는 값** — [buildTrunkContext] 가 머신이 놓인 뒤 `plan.lines`(유체 줄)
 * 전체를 한 번 훑어 만든다. 방출기 [emitTrunkPipe] 가 읽는다.
 */
export interface TrunkContext {
  ext: { x0: number; y0: number; x1: number; y1: number };
  /** **면별** [pipeJumpToClusterPipe] 가 실제로 켜졌는가. 면마다 벨트 수·유체 줄 수가 달라 갈린다. */
  pipeJumpMode: (side: PortSide) => boolean;
  /** 순번 `rank` 유체 줄의 ClusterPipe 깊이 — `base + 2 + 2·rank`(trunk-pipe §5.1). 탭은 그 −1. */
  clusterPipeDepth: (side: PortSide, rank: number) => number;
  /** 줄의 **실제 배치 깊이** — 유체 줄은 점프 모드면 자기 순번의 ClusterPipe 깊이, 아니면 계획값. */
  emitDepthOf: (p: PlannedLine) => number;
  /** 같은 면·같은 끝으로 나가는 줄들의 최대 깊이 — stagger 계산의 기준. */
  maxDepthAtEnd: Map<string, number>;
}

/** 흐름의 끝 칸 하나 — 방출기가 등록하고 [resolveBeltTermini] 가 마무리한다. */
export interface BeltTerminus {
  /**
   * 끝 칸의 셀 **그 자체**(사본이 아니다). 해결은 이 객체를 **제자리에서** 고친다 —
   * 같은 객체가 `GeneratedModule.cells` 와 `ModulePort.cells` 양쪽에 들어가 있어서,
   * 새 객체로 갈아끼우면 한쪽만 바뀌고 다른 쪽이 옛 벨트로 남는다.
   */
  cell: PlacedCell;
  /** 이 줄이 나르는 품목 — 같은 품목이면 합류가 오염이 아니다. */
  item: string;
  /** 들어오는 흐름 방향(= 벨트 진행 방향). 역방향이 금지 방향이고, 지하 종착이 볼 방향이다. */
  flow: { x: number; y: number };
  /** 머신 쪽(= 오늘까지의 기본값). 나머지 후보(바깥 쪽)는 이것의 반대다. */
  inward: { x: number; y: number };
  /** 지하 종착으로 바꿀 때 쓸 `entityId` 재료. */
  pair: PortPair;
}

/**
 * **피할 수 없어 합류한 채로 남긴 끝 칸** — 화면 경고([LayoutIssue] `belt-terminus-merge`)의
 * 재료다. 세 방향이 다 남의 품목이고 지하벨트도 없을 때만 생긴다.
 *
 * 좌표는 **모듈-로컬**이다 — `moduleTransform` 이 셀과 **같은 변환**으로 옮긴다.
 */
export interface BeltMerge {
  x: number;
  y: number;
  /** 이 끝 칸이 나르던 품목. */
  item: string;
  /** 흘러드는 상대 품목. */
  into: string;
}
