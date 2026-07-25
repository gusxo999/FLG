/**
 * moduleWizard — 조각 5 (하이브리드 배선). 트리가 **전부 simple-item** 일 때만
 * generateModule+packModuleTree+routeModuleHops 자족 모듈 경로로 후보 1개를 만든다.
 * 유체·미탭(과용량)·홉 실패 중 하나라도 있으면 `null` 반환 → 호출자(layeredWizard)가
 * 옛 경로로 폴백한다(회귀 0).
 *
 * ## 왜 이게 "자식 == 루트" 를 실현하나
 * generateModule 은 클러스터를 **부모-무시** 생성하므로, 같은 (레시피, count) 면 자식이든
 * 루트든 동일 모듈이다. 옛 라이브는 자식만 clusterTrunkMerge(부모-결합)·루트만 자족이라
 * 둘이 달랐다. 본 경로는 **루트·자식 모두** 모듈(ROW_GAP 0 통일)이라 일치한다.
 *
 * ## 배치
 * v1 은 packModuleTree 의 preview 배치(depth 열 × 세로 stack)를 그대로 쓴다 — child==root
 * 는 배치와 무관(생성이 부모-무시)하므로 우선 검증 가능. tidy-tree 정렬·홉 단축은 후속.
 *
 * 무상태·결정적. Routing 객체 emit(piece 7) — 홉=머신→머신(드래그 트리), raw/루트=상자↔머신
 * (IO 라벨). placed=홉 belt 셀(없으면 직선 폴백).
 */

import { useGameDataStore } from "../../../store/gameDataStore";
import { EntityType } from "../../../types/layout";
import type { Area, CandidateLeaf, ContainerPort, ContainerWizardInput, PortFace, Routing } from "../containerModel";
import type { IoLine } from "../module/clusterPortPlanner";
import { externalLineGroups } from "../module/allocateMachineLinks";
import { chooseMachineDirection } from "../module/fluidPorts";
import {
  collectPipeFlow,
  pipeFlowConflict,
  type PipeFlow,
  type PipeFlowMachine,
  type PipeFlowPipe,
} from "../module/pipeFlow";
import type { RecipeTreeNode } from "../types";
import { packModuleTree, edgeMachineLinks, type NodeSpec, type PackConfig } from "./modulePacking";
import { routeModuleHops } from "./moduleHop";
import { rePathToPerimeter } from "./modulePerimeterPass";
import { AUTO_LAYOUT_CHANNEL_GEOMETRY, AUTO_LAYOUT_COORD_DUMP, AUTO_LAYOUT_PERIMETER_PASS } from "../debugFlags";
import { inserterThroughput } from "../inserterThroughput";
import { clusterLineRate } from "../recipeTree";
// 예약 경로는 **탐색기를 안 본다** — 옛 경로의 `routeFallback`(Dijkstra 폴백) 대신
// [BuildSpec](../buildSpec.ts)("무엇으로 지을 수 있나")만 읽는다.
import { makeBuildSpec, tapCapacity } from "../buildSpec";
import { makeEmptyArea, machineSpeedFraction } from "../wizardUtils";
import { commitContainer } from "../machinePlacer";

/** layeredWizard NodeMeta 와 동형(필요한 부분만). */
export interface ModuleNodeMeta {
  entityName: string;
  w: number;
  h: number;
  count: number;
  depth: number;
}

export interface ModulePipelineArgs {
  input: ContainerWizardInput;
  metas: Map<RecipeTreeNode, ModuleNodeMeta>;
  parentOf: Map<RecipeTreeNode, RecipeTreeNode | null>;
  /** DFS pre-order(루트 먼저). */
  order: RecipeTreeNode[];
  /** layeredWizard 의 결정적 id 생성기(nextId). */
  makeId: (prefix: string) => string;
}

/** 신 경로 reject 사유 분류. */
export type RejectReason =
  | { kind: 'multi-fluid'; detail: string }
  | { kind: 'non-square'; detail: string }
  | { kind: 'stale-gamedata'; detail: string }
  | { kind: 'no-pipe-entity'; detail: string }
  | { kind: 'no-rotation'; detail: string }
  | { kind: 'unrouted-lines'; detail: string }
  | { kind: 'hop-failures'; detail: string }
  /**
   * 유체 홉이 채널 기하 장부에서 자리를 못 받았다 — 그래서 **깔지 않는다**.
   *
   * 아이템 홉과 달리 탐색 폴백이 없다(docs/…fluid-hop-reservation.md §4.6): 원칙이 "모든
   * 배치는 처음에 계획할 수 있어야 한다"이므로, 계획 없이 탐색으로 때운 유체 경로를 남기지
   * 않는다. 실질적으로 도달 가능한 원인은 하나 — 한 채널 안에서 **서로 다른 유체 두 줄의
   * 끝점이 엇갈릴 때**. 둘 다 지상을 원하는데 파이프는 지하로 못 비킨다(결정 D2).
   */
  | { kind: 'fluid-unplannable'; detail: string }
  | { kind: 'pipe-merge-conflict'; detail: string };

/**
 * 모듈 경로의 결과 — 성공한 후보이거나, **왜 못 만들었는지**다.
 *
 * 옛 경로가 있던 시절엔 실패가 `null` 이어도 됐다 — 호출자가 옛 경로로 폴백했고 화면엔
 * 무언가 나왔으니까. 옛 경로가 사라진 지금은 **이 사유가 사용자가 받는 설명의 전부**다.
 * 그래서 `null` 로 삼키지 않고 사유를 들려 보낸다(그전엔 호출자가 "유체/회전/비정사각형 등"
 * 이라고 **찍어서** 보여 줬다 — 실제 원인과 무관할 수 있는 문장이었다).
 */
export type ModulePipelineResult =
  | { ok: true; leaf: CandidateLeaf }
  | { ok: false; reason: RejectReason };

/**
 * 사람이 읽을 한 줄 — 실패 후보 라벨·토스트에 그대로 쓴다.
 *
 * "자동배치 실패" 같은 머리말은 **붙이지 않는다** — 이 문자열을 받는 쪽
 * (`layeredWizard.failureResult`)이 이미 그 머리말을 단다. 두 군데서 달면 화면에
 * "자동배치 실패: 자동배치 실패 [multi-fluid] …" 로 겹친다(2026-07-25 브라우저 실측).
 */
export function describeReject(reason: RejectReason): string {
  return `[${reason.kind}] ${reason.detail}`;
}

/**
 * 모듈 경로로 후보 leaf 생성. 적격(전부 item·미탭0·홉성공) 아니면 null.
 *
 * **진단 로그를 후보에 담는다.** 위저드가 계산 중 찍는 로그(`[팔·벨트 상한]`·
 * `[perimeterPass]`·`[channelGeometry]`·`모듈 경로 포기` …)를 콘솔에 바로 뱉지 않고
 * 캡처해 [CandidateLeaf.moduleDiagnostics] 에 담는다 — 후보를 **클릭할 때** 환경 정보와
 * 함께 한 시점에 출력하기 위해서다(그전엔 6번 버튼과 후보 클릭 두 시점으로 흩어졌다).
 * 후보가 안 나오면(null) 담을 데가 없으니 캡처한 로그를 그 자리에서 뱉는다.
 * `AUTO_LAYOUT_COORD_DUMP` 가 꺼져 있으면 캡처하지 않는다(오버헤드 0).
 */
export function tryRunModulePipeline(args: ModulePipelineArgs): ModulePipelineResult {
  if (!AUTO_LAYOUT_COORD_DUMP) return runModulePipeline(args);

  const captured: string[] = [];
  const fmt = (a: unknown): string => (typeof a === "string" ? a : JSON.stringify(a));
  const orig = { log: console.log, warn: console.warn, info: console.info };
  const cap = (tag: string) => (...a: unknown[]): void => { captured.push(tag + a.map(fmt).join(" ")); };
  console.log = cap(""); console.warn = cap("[warn] "); console.info = cap("[info] ");
  let res: ModulePipelineResult;
  try {
    res = runModulePipeline(args);
  } finally {
    console.log = orig.log; console.warn = orig.warn; console.info = orig.info;
  }
  if (res.ok) res.leaf.moduleDiagnostics = captured;
  else captured.forEach((l) => orig.info(l)); // 후보 없음 → 클릭도 없으니 지금 뱉는다
  return res;
}

function runModulePipeline(args: ModulePipelineArgs): ModulePipelineResult {
  const { input, metas, parentOf, order, makeId } = args;
  const { recipeMap, entityMap } = useGameDataStore.getState();

  const options = makeBuildSpec(input);

  /**
   * 모듈 경로 포기 — **왜** 포기했는지 반드시 남긴다.
   *
   * 옛 경로가 있던 시절엔 조용히 `null` 을 내면 화면에 "그냥 옛날 레이아웃"이 나와, 새
   * 기능이 안 켜진 건지 안 만든 건지 구분이 안 됐다(2026-07-13: 유체 트리가 폴백했는데
   * 사유를 몰라 추적 불가). 옛 경로가 사라진 지금은 더 단순하다 — **이 사유가 실패의 전부**다.
   * 로그로 남기고, 호출자에게도 들려 보낸다.
   */
  const reject = (reason: RejectReason): ModulePipelineResult => {
    console.info(`[autoLayout] 모듈 경로 포기 [${reason.kind}]: ${reason.detail}`);
    return { ok: false, reason };
  };

  // 0) 적격성 — 아이템은 전부 OK. 유체는 [트렁크 파이프](docs/auto-layout-wizard.trunk-pipe.md)
  //    §5 범위(**외부 공급 유체 입력 1개**)만 받고 나머지는 옛 경로로 폴백한다.
  //    거절 사유가 다 다르므로 각각 이유를 남긴다(진단).
  const fluidTrunkOf = new Map<RecipeTreeNode, NodeSpec["fluidTrunk"]>();
  /** 노드 → 그 모듈이 다루는 유체 이름. v1 은 노드당 최대 1개(외부 공급 입력). */
  const fluidOf = new Map<RecipeTreeNode, string>();
  for (const node of order) {
    const recipe = recipeMap.get(node.recipeName!);
    if (!recipe) return reject({ kind: 'stale-gamedata', detail: `레시피 없음: ${node.recipeName}` });
    const m = metas.get(node)!;
    const at = `${node.recipeName}`;

    // v1 유체 홉(docs/auto-layout-wizard.fluid-hop.md): **모듈당 유체 1줄**(입력 1 또는 출력 1).
    // 다-유체 머신(정유·크래킹·황산 등)은 4면·회전이 얽혀 별개 문제 → 옛 경로 유지.
    const fluidIn = recipe.ingredients.filter((i) => i.type === "fluid");
    const fluidOut = recipe.products.filter((p) => p.type === "fluid");
    if (fluidIn.length + fluidOut.length === 0) continue; // 아이템 전용 — 회전 없음.
    if (fluidIn.length + fluidOut.length > 1) {
      return reject({ kind: 'multi-fluid', detail: `${at}: 유체 입력 ${fluidIn.length} 출력 ${fluidOut.length}` });
    }

    const isOutput = fluidOut.length === 1;
    const fluid = isOutput ? fluidOut[0] : fluidIn[0];
    const role: "input" | "output" = isOutput ? "output" : "input";
    // 출력 유체는 부모 쪽(W), 입력 유체는 자식 쪽(E) — generateModule 의 outputSide=W 와 정합.
    // 자식-공급 유체 입력은 이제 **홉이 잇는다**(옛 거절 제거). 루트 유체 출력은 반출로 나간다.
    const wantFace = isOutput ? "W" : "E";
    // 회전은 footprint 를 안 바꾼다는 전제 위에 있다 → 정사각형 머신만(§3).
    if (m.w !== m.h) return reject({ kind: 'non-square', detail: `${m.entityName} ${m.w}×${m.h}` });
    if (!options.pipeEntityName) return reject({ kind: 'no-pipe-entity', detail: "빌드 스펙에서 파이프를 선택하지 않음" });

    const entity = entityMap.get(m.entityName);
    if (!entity) return reject({ kind: 'stale-gamedata', detail: `엔티티 게임데이터 없음: ${m.entityName}` });
    // 유체 상자가 `wantFace` 를 보게 하는 회전을 데이터에서 고른다(§3).
    const chosen = chooseMachineDirection(entity, { w: m.w, h: m.h }, fluid.name, wantFace, role);
    if (!chosen) {
      // 유체 상자의 면은 게임데이터의 `PipeConnection.direction` 에서만 나온다 — 좌표로는
      // 못 정한다(모서리 칸이라 안 갈린다. → module/fluidPorts.ts 머리말). 그 필드가 없는
      // **구버전 export** 면 어느 각도로 돌려도 슬롯이 하나도 안 나오므로, 두 실패를 구분해
      // 알려준다. 안 그러면 "머신이 이상하다"로 오진한다.
      const hasDirection = entity.fluid_boxes?.some((fb) =>
        fb.connections.some((c) => c.direction !== undefined),
      );
      if (!hasDirection) {
        return reject({
          kind: 'stale-gamedata',
          detail: `${m.entityName} 의 유체 연결에 direction 이 없다 (구 export). scripts/export-gamedata.lua 로 다시 뽑아야 함`,
        });
      }
      return reject({
        kind: 'no-rotation',
        detail: `${m.entityName}: 어느 각도로도 ${fluid.name} ${role} 유체 상자가 ${wantFace} 면에 안 옴 (fluid_boxes ${entity.fluid_boxes?.length ?? 0}개)`,
      });
    }

    fluidTrunkOf.set(node, {
      direction: chosen.direction,
      side: wantFace,
      pipeEntityName: options.pipeEntityName,
      // [pipeJumpToClusterPipe] 재료 — 상자 연결 칸의 면 위 위치 + 지하파이프 능력(BuildSpec).
      // generateModule 이 이 셋으로 isJumpableToClusterPipe 를 판정한다(부족하면 옛 스파인).
      fluidboxOffset: chosen.slot.offset,
      undergroundPipeEntityName: options.undergroundPipeEntityName,
      pipeMaxUndergroundDistance: options.pipeMaxUndergroundDistance,
    });
    fluidOf.set(node, fluid.name);
  }

  // 1) NodeSpec — 트리에서 유도. id 는 노드별 결정적(order 인덱스 + 레시피).
  const idOf = new Map<RecipeTreeNode, string>();
  const recipeOfId = new Map<string, string>();
  order.forEach((node, i) => {
    const id = `n${i}-${node.recipeName}`;
    idOf.set(node, id);
    recipeOfId.set(id, node.recipeName!);
  });
  // 인서터별 실제 throughput(items/sec) — depth=운반량 매칭의 슬롯 용량(piece 3) +
  // [Parallel Inserting] 의 탭 용량. 노드와 무관(같은 인서터)해서 specs 앞에서 한 번 구한다.
  const ov = input.inserterOverrides;
  const normalTp = inserterThroughput(entityMap.get(options.inserterEntityName), ov?.[options.inserterEntityName]);
  const longName = options.longInserter?.entityName;
  const longTp = longName ? inserterThroughput(entityMap.get(longName), ov?.[longName]) : normalTp;
  // **탭 용량 = 그 좌석에 실제로 앉는 팔의 처리량**([tapCapacity] 가 유일한 출처).
  //
  // 예전엔 여기서 `min(normal, long)` 을 자체 계산했다 — "어느 reach 에 앉든 굶지 않게
  // 보수적으로". 두 팔의 속도가 비슷하면 맞는 보수성이지만, 실측 모드팩은 fast 10/s 대
  // long-handed 1.2/s 로 **8배**였다. 그러면 min 은 보수성이 아니라 오답이다 — 같은 숫자가
  // 성질이 반대인 두 질문에 동시에 쓰이기 때문이다:
  //  - **팔이 몇 개 필요한가** — 느린 값을 쓰면 8배로 세서 면을 넘친다.
  //  - **한 벨트에 몇 개 앉나**(그릇) — 느린 값을 쓰면 `45÷1.2 = 37` 이 되어 **상한이 사라진다**.
  // 그렇게 앉은 팔은 전부 fast 라, 실측에서 벨트 한 줄이 70/s 를 받았다(벨트는 45/s).
  const tapCap = tapCapacity(options.inserters) ?? normalTp;

  const specs: NodeSpec[] = order.map((node) => {
    const m = metas.get(node)!;
    const recipe = recipeMap.get(node.recipeName!)!;
    // 운반체 = 품목 종류. 유체는 파이프, 아이템은 벨트.
    const carrier = (type: string) => (type === "fluid" ? ("pipe" as const) : ("belt" as const));
    const lines: IoLine[] = [
      ...recipe.ingredients.map((i) => ({ name: i.name, kind: carrier(i.type), role: "input" as const, amount: i.amount })),
      ...recipe.products.map((p) => ({ name: p.name, kind: carrier(p.type), role: "output" as const, amount: p.amount })),
    ];
    const parent = parentOf.get(node) ?? undefined;
    // [Parallel Inserting] 배선 — 줄별 클러스터 rate(items/sec) + 탭 용량을 supplyCapacity 로.
    // v1 은 벨트 처리량(beltCapacity)은 안 잰다(벨트 분할이 없어 어차피 폴백뿐 — 후속).
    // **속도는 굶주림 보상과 같은 출처를 읽는다**([machineSpeedFraction]). 팔을 다 앉힐 자리가
    // 없는 머신은 그만큼만 도므로, 이 클러스터가 **실제로** 나르는 양도 그만큼이다. 여기서
    // 100% 수요를 넘기면 배분기는 앉히지도 못할 팔을 요구하고 → 좌석에서 거절 → 옛 경로로
    // 폴백한다. 그런데 머신 **수**는 이미 그 보상만큼 늘어나 있어서, 100% 수요는 애초에
    // 아무도 안 믿는 숫자다(2026-07-17 실측: kr-sand 13+5팔 > 14행 → 폴백. 80%면 10+4=14로 앉는다).
    const ent = entityMap.get(m.entityName);
    const craftingSpeed = ent?.crafting_speed ?? 1;
    const params = {
      craftingSpeed,
      productivityMultiplier: 1,
      speedFraction: ent ? machineSpeedFraction(recipe, ent, craftingSpeed, options.inserters) : undefined,
    };
    // 수량을 모르는 줄(범위 산출물인데 게임데이터에 amount_min/max 가 없는 경우)은 **넣지
    // 않는다** — 그래야 requiredInserterCount 가 `rate === undefined` 로 보고 **판정 보류(1개)로
    // 보류**한다. 지어낸 숫자나 NaN 을 넣으면 탭 수가 조용히 틀어진다.
    const lineRates = new Map<string, number>();
    const putRate = (key: string, rate: number | undefined): void => {
      if (rate !== undefined) lineRates.set(key, rate);
    };
    for (const ing of recipe.ingredients) putRate(`input:${ing.name}`, clusterLineRate(recipe, "input", ing.name, m.count, params));
    for (const p of recipe.products) putRate(`output:${p.name}`, clusterLineRate(recipe, "output", p.name, m.count, params));
    return {
      id: idOf.get(node)!,
      depth: m.depth,
      parentId: parent ? idOf.get(parent) : undefined,
      machine: { entityName: m.entityName, w: m.w, h: m.h },
      count: m.count,
      lines,
      fluidTrunk: fluidTrunkOf.get(node),
      supplyCapacity: tapCap > 0 ? { tapCapacity: tapCap, lineRates } : undefined,
    };
  });

  const packConfig: PackConfig = {
    inserterEntityName: options.inserterEntityName,
    beltEntityName: options.beltEntityName,
    // 고른 벨트 전부 — determineBeltCount 가 수요를 이 티어들로 나눠 덮는다.
    belts: options.belts,
    longInserter: options.longInserter,
    // throughput 데이터 없으면(0) 생략 → planner 가 depth 를 (B) 등장순서로 유지.
    throughput: normalTp > 0 ? { normal: normalTp, long: longTp } : undefined,
    // 외부상자 perimeter exit-lane 예약(조각 6-①) — 채널 폭에 lane 세로 구간 합산.
    reservePerimeterLanes: AUTO_LAYOUT_PERIMETER_PASS,
    // 채널 기하 예약(통합 장부) — 납품·반출 트랙을 패킹 시점에 배정, 폭은 결과에서 유도.
    channelGeometry: AUTO_LAYOUT_CHANNEL_GEOMETRY,
    // 장부가 납품끼리의 교차를 지하로 계획할 때 쓰는 거리 상한. **아래 routeModuleHops 의
    // maxJump 산식과 같아야 한다** — 지하벨트 prototype 이 없으면 방출기는 어차피 지상
    // 전용이므로, 장부도 0(지하 불가)으로 봐야 계획과 방출이 어긋나지 않는다.
    beltMaxUndergroundDistance: options.undergroundBeltEntityName
      ? options.beltMaxUndergroundDistance
      : 0,
  };

  // **왜 팔이 그만큼 앉았나** — 한 벨트에 팔이 몰려 포화된 배치를 봤을 때, 그 수가 어느
  // 식에서 나왔는지 좌표만 보고는 못 가린다. 그런데 줄마다 **누가 세느냐**부터 갈린다:
  //  - **링크 줄**(자식↔부모): [allocateMachineLinks] 가 간선별로 벨트를 쪼갠다. 팔 개수는
  //    링크마다 다르므로 `requiredInserterCount`(아래 팔/머신)는 **쓰이지 않는다** — 참고용.
  //  - **외부 줄**(raw 입력·최종 출력): `requiredInserterCount` 가 그대로 배치를 정한다.
  // 두 줄을 섞어 팔/머신만 보면 링크 줄에서 헛다리를 짚는다(실측 오해). 그래서 갈라 찍는다.
  //
  // 세 상한(팔 개수·그릇·면 좌석)이 같은 값을 낼 수 있어 나란히 둔다. `그릇×normalTp` 열(=
  // 그 벨트가 실제로 받는 부하)이 벨트 처리량을 넘으면 그 자리가 포화다.
  if (AUTO_LAYOUT_COORD_DUMP) {
    const fastest = options.belts?.[0]?.throughput ?? 0;
    const nodeById = new Map(specs.map((s) => [s.id, s]));
    console.log(`[팔·벨트 상한] normalTp=${normalTp} longTp=${longTp} tapCap(reach1최속)=${tapCap} 벨트(최속)=${fastest}`);
    const grail = Math.max(1, Math.floor(fastest / tapCap));
    for (const s of specs) {
      const rows = { WE: s.machine.h, NS: s.machine.w };
      // 이 모듈의 **모든** 벨트 줄을 한 장부로 본다 — 링크 줄은 [edgeMachineLinks],
      // 외부 줄은 [externalLineGroups]. 둘 다 [MachineLinkGroup] 이라 아래 출력이 하나다.
      const ext = new Map(
        externalLineGroups(s.lines, s.count, s.supplyCapacity ?? {}).map((g) => [g.id!, g]),
      );
      for (const [key, rate] of s.supplyCapacity?.lineRates ?? []) {
        const [role, name] = key.split(":");
        // 이 줄이 링크인가 — 출력이면 부모가, 입력이면 자식이 같은 품목을 주고받나.
        const parent = s.parentId ? nodeById.get(s.parentId) : undefined;
        const child = specs.find((c) => c.parentId === s.id && c.lines.some((l) => l.role === "output" && l.name === name));
        const linkEdge =
          role === "output" && parent?.lines.some((l) => l.role === "input" && l.name === name)
            ? edgeMachineLinks(s, parent, name, packConfig)
            : role === "input" && child
              ? edgeMachineLinks(child, s, name, packConfig)
              : undefined;
        const g = ext.get(`ext:${key}`);
        const who = linkEdge ? "링크" : g ? "외부" : "미상";
        // **벨트 줄 수와 줄당 팔**은 두 줄에서 뜻이 조금 다르다 — 누가 셌는지 밝힌다:
        //  - 링크: [allocateMachineLinks] 가 **이미 쪼갠 결과**. 줄마다 팔 수가 다를 수 있다.
        //  - 외부: 그룹은 줄 하나(안 쪼갠다) → 여기서 **그릇으로 유도한 예측**을 찍는다.
        //    실제 쪼개기는 [clusterPortPlanner] 의 배정 수가 하므로, 이 예측과 화면이
        //    어긋나면 그 둘이 다른 수를 보고 있다는 뜻이다(그게 이 로그의 쓸모다).
        const armsOf = (m: Map<number, number>): number => [...m.values()].reduce((a, b) => a + b, 0);
        const total = g ? armsOf(g.from.size > 0 ? g.from : g.to) : 0;
        const belts = linkEdge ? linkEdge.length : g ? Math.ceil(total / grail) : 0;
        const perBelt = linkEdge ? linkEdge.map((l) => l.inserterCount) : g ? [Math.min(total, grail)] : [];
        const load = perBelt.length > 0 ? Math.max(...perBelt) * normalTp : 0;
        console.log(
          `  ${s.id} ${key}: [${who}] 벨트 ${belts}줄, 줄당 팔 [${perBelt}]${g ? ` (총 ${total})` : ""} ` +
            `· 클러스터rate=${rate.toFixed(2)} 머신수=${s.count} · 그릇=${grail} ` +
            `· 면좌석=W/E ${rows.WE} N/S ${rows.NS} ` +
            `|| 최대 실부하 ${load.toFixed(1)}/s vs 벨트 ${fastest}/s${load > fastest ? "  ← 포화" : ""}`,
        );
      }
    }
  }

  const pack = packModuleTree(specs, packConfig);
  // 미탭(과용량 등) 있는 모듈 → 폴백.
  for (const pl of pack.placements) {
    if (pl.module.unroutedLines.length > 0) {
      const names = pl.module.unroutedLines.map((l) => `${l.role}:${l.name}`).join(", ");
      return reject({
        kind: 'unrouted-lines',
        detail: `${pl.id}: [${names}] — ${pl.module.supply?.reason ?? "사유 없음"}`,
      });
    }
  }

  // 1b) [파이프 합류 가드](../module/pipeFlow.ts) — 파이프는 **방향이 없어서** 직교로 닿기만
  //     하면 두 관망이 하나가 된다. 다른 유체끼리 이어지면 오염되고, 남의 머신 **출력** 유체
  //     상자에 스치면 그 머신의 생산물이 내 관망으로 **조용히 샌다** — 화면상으론 멀쩡하고
  //     라우팅도 "성공"이라 보고한다. 그래서 파이프를 깔기 전에 금지 칸 지도를 만들어 둔다.
  //     유체마다 지도가 다르다 — **같은 유체는 닿아도 무해**하기 때문이다(처리량 무한).
  const fluidOfPlacement = new Map<string, string>(); // spec id → 그 모듈의 유체 이름
  for (const node of order) {
    const f = fluidOf.get(node);
    if (f) fluidOfPlacement.set(idOf.get(node)!, f);
  }
  const pipeFlowByFluid = new Map<string, PipeFlow>();
  if (fluidOfPlacement.size > 0) {
    // 유체 머신 — 프로토타입(`fluid_boxes`)이 상자의 **연결 칸**을, 레시피가 그 칸이 **받는
    // 유체 이름**을 정한다(→ docs/fluid-box-semantics.md). 유체 상자가 없는 머신(조립기)은 뺀다.
    const fluidRows = (rows: readonly { type: string; name: string; fluidbox_index?: number }[]) =>
      rows.filter((r) => r.type === "fluid").map((r) => ({ name: r.name, fluidbox_index: r.fluidbox_index }));
    const machines: PipeFlowMachine[] = [];
    for (const pl of pack.placements) {
      const recipe = recipeMap.get(recipeOfId.get(pl.id)!)!;
      const recipeFluids = {
        ingredients: fluidRows(recipe.ingredients),
        products: fluidRows(recipe.products),
      };
      for (const m of pl.module.machines) {
        const entity = entityMap.get(m.entityName);
        if (!entity?.fluid_boxes?.length) continue;
        machines.push({ origin: m.origin, size: m.size, direction: m.direction ?? 0, entity, recipeFluids });
      }
    }
    // 이미 놓인 파이프류 셀 — 모듈의 트렁크/ClusterPipe + 포트 무한파이프 + 지하파이프 **끝**
    // (fluidboxPipeCell·ClusterPipeTapCell — 끝 칸은 표면에 노출돼 접촉 합류가 생긴다.
    // 지하 통과 구간은 타일을 점유하지 않으므로 안 센다). 그 모듈의 유체를 나른다.
    const pipes: PipeFlowPipe[] = [];
    for (const pl of pack.placements) {
      const fluid = fluidOfPlacement.get(pl.id);
      if (!fluid) continue;
      for (const c of pl.module.cells)
        if (
          c.cell.entityType === EntityType.Pipe ||
          c.cell.entityType === EntityType.InfinityPipe ||
          c.cell.entityType === EntityType.PipeUnderground
        )
          pipes.push({ x: c.x, y: c.y, fluid });
    }
    for (const fluid of new Set(fluidOfPlacement.values()))
      pipeFlowByFluid.set(fluid, collectPipeFlow({ fluidName: fluid, pipes, machines }));

    // 트렁크 검사 — 기둥은 자기 머신의 **입력** 상자를 지나가라고 깐 것이므로(같은 유체 →
    // 안 막힘) 여기서 걸리는 건 진짜 사고다: 자기 머신의 출력 상자를 같이 스쳤거나, 옆
    // 모듈의 다른 유체 관망에 붙었거나. 거절은 **항상 안전하다** — 옛 경로로 폴백할 뿐이다.
    for (const pl of pack.placements) {
      const fluid = fluidOfPlacement.get(pl.id);
      if (!fluid) continue;
      const ownPipes = pl.module.cells.filter(
        (c) =>
          c.cell.entityType === EntityType.Pipe ||
          c.cell.entityType === EntityType.InfinityPipe ||
          c.cell.entityType === EntityType.PipeUnderground,
      );
      const hit = pipeFlowConflict(ownPipes, pipeFlowByFluid.get(fluid)!);
      if (hit)
        return reject({
          kind: 'pipe-merge-conflict',
          detail: `${pl.id}: 트렁크 파이프(${fluid})가 (${hit.cell.x},${hit.cell.y}) 에서 ${hit.rule} 규칙 위반`,
        });
    }
  }

  // 유체 홉(pipe-to-pipe)이 **다른 유체**에 안 닿게 할 금지 칸 — 위 합류 가드가 낸 유체별
  // hard 지도를 그대로 넘긴다(같은 유체는 안 막아 공유 허용). 아이템 트리면 비어 있다.
  const fluidBlocked = new Map<string, ReadonlySet<string>>();
  for (const [fluid, pf] of pipeFlowByFluid) fluidBlocked.set(fluid, pf.blockedTilesHard);

  const hopRes = routeModuleHops(pack, {
    beltEntityName: options.beltEntityName,
    beltMaxUndergroundDistance: options.beltMaxUndergroundDistance,
    undergroundBeltEntityName: options.undergroundBeltEntityName,
    pipeEntityName: options.pipeEntityName,
    pipeMaxUndergroundDistance: options.pipeMaxUndergroundDistance,
    undergroundPipeEntityName: options.undergroundPipeEntityName,
    fluidBlocked,
  });
  if (hopRes.failures > 0) {
    // 유체 실패는 따로 말한다 — 원인도 처방도 아이템과 다르다. 아이템 홉 실패는 라우팅이
    // 어려웠다는 뜻이지만, 유체 실패는 **계획 자체가 불가능했다**는 뜻이다(§4.6).
    const fluidFails = hopRes.routes.filter(
      (r) => !r.ok && (r.reason === "fluid-unplannable" || r.reason === "fluid-planned-chain-blocked"),
    );
    if (fluidFails.length > 0) {
      return reject({
        kind: 'fluid-unplannable',
        detail: `${fluidFails.map((r) => `${r.item}(${r.reason})`).join(", ")} — 한 채널에 다른 유체가 겹쳤을 가능성`,
      });
    }
    return reject({ kind: 'hop-failures', detail: `${hopRes.failures}건` });
  }

  // 1c) 외부상자 전역 perimeter 재배치(조각 6-C) — 합성 후 살아남은 raw 입력·루트 출력
  //     상자는 각자 *로컬* 모듈 ring(=배치 내부)에 박혀 있다. ⑥A lanePlan 배정대로 예약된
  //     lane 안에 결정적 belt(직선 or ㄱ자)를 깔아 전역 외곽으로 옮긴다(탐색 없음). lane 이
  //     막히거나 미지원 배정(형제에 막힌 N/S 변→채널)인 상자만 건너뛰어 로컬 ring 에 남기고
  //     트리는 모듈 경로를 유지한다(회귀 0).
  // rePathToPerimeter 는 moduleHop 처럼 **순수**하다(pack 미변형) — 무엇을 떼고
  // (droppedCellKeys) 무엇을 놓고(addedCells) 상자가 어디로 가는지(relocations)를 반환하고,
  // 적용은 아래 어댑터에서 Area 를 지을 때 한다.
  const perim = AUTO_LAYOUT_PERIMETER_PASS
    ? rePathToPerimeter(pack, hopRes.strippedChestIds, hopRes.cells, {
        beltEntityName: options.beltEntityName,
        inserterEntityName: options.inserterEntityName,
        pipeEntityName: options.pipeEntityName, // 유체 포트는 파이프로 반출한다.
        pipeFlow: pipeFlowByFluid, // [파이프 합류 가드] — 반출 파이프가 밟으면 안 되는 칸.
      })
    : null;
  const droppedKeys = perim?.droppedCellKeys ?? new Set<string>();
  const relocOrigin = new Map<string, { x: number; y: number }>();
  const relocBelts = new Map<string, typeof hopRes.cells>();
  for (const r of perim?.relocations ?? []) {
    relocOrigin.set(r.chestId, r.origin);
    relocBelts.set(r.chestId, r.belts);
  }

  // 2) 어댑터 → internal/external Area.
  //    - 머신 → internal.containers
  //    - belt/인서터 셀(strip 제외) → internal.placed
  //    - 유지되는 무한상자(raw 입력·루트 출력) → external.containers + ghost 셀 external.placed
  //    - 홉 belt → internal.placed
  //    strip(경계 chest+seat) 셀/상자는 제외.
  const internal = makeEmptyArea("internal");
  const external = makeEmptyArea("external");
  const stripCells = hopRes.strippedCellKeys;
  const stripChests = hopRes.strippedChestIds;

  for (const pl of pack.placements) {
    const mod = pl.module;
    const recipeName = recipeOfId.get(pl.id);
    for (const machine of mod.machines) {
      // generateModule 은 레시피-무관 생성이라 머신에 recipeName 이 없다. 블루프린트
      // 레시피 배정·디버그 식별을 위해 노드 레시피를 채운 뒤 commitContainer 로
      // **footprint 셀까지** internal.placed 에 펼친다(머신은 컨테이너만으론 그리드에
      // 안 그려진다 — 이 누락이 "머신이 안 보이던" 원인).
      machine.recipeName = recipeName;
      commitContainer(machine, internal);
    }
    for (const c of mod.cells) {
      const k = `${c.x},${c.y}`;
      // stripCells=홉이 뗀 경계 chest/seat, droppedKeys=perimeter 이사한 상자의 옛 ghost/feeder.
      if (stripCells.has(k) || droppedKeys.has(k)) continue;
      if (c.cell.entityType === EntityType.InfinityChest) external.placed.push(c);
      else internal.placed.push(c);
    }
    for (const chest of mod.chests) {
      if (stripChests.has(chest.id)) continue;
      // perimeter 로 이사한 상자는 새 origin 으로(원본 Container 미변형 → 사본).
      const origin = relocOrigin.get(chest.id);
      external.containers.push(origin ? { ...chest, origin } : chest);
    }
  }
  for (const c of hopRes.cells) internal.placed.push(c);
  // perimeter 재배치가 새로 깐 셀(belt+feeder+이사한 chest) — mod.cells 순회와 같은 분류.
  for (const c of perim?.addedCells ?? []) {
    if (c.cell.entityType === EntityType.InfinityChest) external.placed.push(c);
    else internal.placed.push(c);
  }
  // 홉 지하 corridor — Area 인덱스에 기록해 이후 라우팅(드래그 재라우팅 등)이 같은
  // 직선 위 페어링 절단을 피하게 한다. placed 와 같은 직접-기록 규약(비-이중-commit:
  // 이 candidate 의 routings 는 commitRouting 을 타지 않는다).
  internal.undergroundCorridors.push(...hopRes.corridors);

  // 2b) Routing 객체 — 선/IO 라벨/드래그 그룹 복원(옛 routings=[] 한계 해소). 끝점은 실제
  //    컨테이너 id(머신 = `${모듈id}-m0`, 유지된 상자). placed = 홉 belt 셀(직선 폴백 가능).
  //    홉=머신→머신(부모-자식, 드래그 트리), raw 입력=상자→머신, 루트 출력=머신→상자.
  const routings: Routing[] = [];
  const itemPort = (containerId: string, cell: { x: number; y: number }, face: PortFace): ContainerPort =>
    ({ containerId, cell, face, kind: "item" });
  pack.hops.forEach((hop, i) => {
    // belt-following: 자식 트렁크 spine + gap belt + 부모 트렁크 spine (boxless 라 연속).
    const placed = [...hop.from.cells, ...(hopRes.routes[i]?.cells ?? []), ...hop.to.cells];
    routings.push({
      id: makeId("r"),
      kind: "item",
      from: itemPort(`${hop.fromId}-m0`, hop.from.anchor, hop.from.face),
      to: itemPort(`${hop.toId}-m0`, hop.to.anchor, hop.to.face),
      placed,
      // 이 홉이 깐 지하 corridor(표시·수정 모드 정리용 사본 — area 기록이 원본).
      corridors: (hopRes.routes[i]?.corridors ?? []).map((c) => ({ ...c, range: [c.range[0], c.range[1]] as [number, number] })),
      // 포트 산출 근거(표시용) — 자식 출력 포트 / 부모 입력 포트 각각.
      fromPortMeta: hop.from.meta,
      toPortMeta: hop.to.meta,
    });
  });
  for (const pl of pack.placements) {
    for (const chest of pl.module.chests) {
      if (stripChests.has(chest.id)) continue; // boxless 로 떼인 경계 상자는 제외.
      const port = [...pl.module.inputPorts, ...pl.module.outputPorts].find((p) => p.chest.id === chest.id);
      // 유체 포트의 라우팅은 kind=fluid — 선 색·라벨·드래그 재라우팅이 이걸 본다.
      const isFluid = port?.line.kind === "pipe";
      const mkPort = (containerId: string, cell: { x: number; y: number }, face: PortFace): ContainerPort =>
        isFluid
          ? { containerId, cell, face, kind: { fluid: chest.content! } }
          : itemPort(containerId, cell, face);
      // perimeter 로 이사했으면 chest 끝점 = 새 origin, placed = 트렁크 spine + 이사 belt.
      const origin = relocOrigin.get(chest.id) ?? chest.origin;
      // machine 끝점 cell = tapAnchor(anchor 안쪽 2칸). anchor 를 쓰면 chest 끝점과 겹쳐
      // from==to 가 되어 선이 사라진다(⑥B). chest 는 origin, machine 은 tapAnchor 로 분리.
      const machine = mkPort(`${pl.id}-m0`, port?.tapAnchor ?? origin, port?.face ?? "N");
      const chestPort = mkPort(chest.id, origin, port?.face ?? "N");
      const placed = [...(port?.cells ?? []), ...(relocBelts.get(chest.id) ?? [])]; // 트렁크 spine + 이사 belt → belt-following 선.
      const kind = isFluid ? ("fluid" as const) : ("item" as const);
      // raw 입력: 상자→머신(input), 루트 출력: 머신→상자(output). 포트 메타는 머신 끝점 쪽.
      if (chest.role === "input") routings.push({ id: makeId("r"), kind, from: chestPort, to: machine, placed, corridors: [], toPortMeta: port?.meta });
      else routings.push({ id: makeId("r"), kind, from: machine, to: chestPort, placed, corridors: [], fromPortMeta: port?.meta });
    }
  }

  internal.bbox = bboxOf(internal);

  const bbox = internal.bbox;
  return {
    ok: true,
    leaf: {
      id: makeId("c"),
      kind: "candidate",
      internal,
      external,
      routings,
      squarenessPenalty: bbox ? Math.abs(bbox.w - bbox.h) : 0,
      children: [],
      label: `모듈 · ${order.length} 노드 · ${pack.hops.length} 홉 · raw ${pack.rawPorts.length}`,
    },
  };
}

/** 머신 footprint + placed 셀의 외접 bbox (w/h 는 폭/높이). */
function bboxOf(area: Area): { x: number; y: number; w: number; h: number } | undefined {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const mk = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  };
  for (const c of area.containers) mk(c.origin.x, c.origin.y, c.size.w, c.size.h);
  for (const p of area.placed) mk(p.x, p.y, 1, 1);
  if (!isFinite(minX)) return undefined;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
