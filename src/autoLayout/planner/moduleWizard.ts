/**
 * moduleWizard — 조각 5 (하이브리드 배선). 트리가 **전부 simple-item** 일 때만
 * generateModule+packModuleTree+routeDeliveryRoutes 자족 모듈 경로로 후보 1개를 만든다.
 * 유체·미탭(과용량)·납품 경로 실패 중 하나라도 있으면 `null` 반환 → 호출자(layeredWizard)가
 * 옛 경로로 폴백한다(회귀 0).
 *
 * ## 왜 이게 "자식 == 루트" 를 실현하나
 * generateModule 은 클러스터를 **부모-무시** 생성하므로, 같은 (레시피, count) 면 자식이든
 * 루트든 동일 모듈이다. 옛 라이브는 자식만 clusterTrunkMerge(부모-결합)·루트만 자족이라
 * 둘이 달랐다. 본 경로는 **루트·자식 모두** 모듈(ROW_GAP 0 통일)이라 일치한다.
 *
 * ## 배치
 * v1 은 packModuleTree 의 preview 배치(depth 열 × 세로 stack)를 그대로 쓴다 — child==root
 * 는 배치와 무관(생성이 부모-무시)하므로 우선 검증 가능. tidy-tree 정렬·납품 경로 단축은 후속.
 *
 * 무상태·결정적. Routing 객체 emit(piece 7) — 납품 경로=머신→머신(드래그 트리), raw/루트=상자↔머신
 * (IO 라벨). placed=납품 경로 belt 셀(없으면 직선 폴백).
 */

import { useGameDataStore } from "../../UI/store/gameDataStore";
import { EntityType } from "../../types/layout";
import type { Area, CandidateLeaf, ContainerPort, ContainerWizardInput, PortFace, Routing } from "../containerModel";
import type { IoLine } from "./module/clusterPortPlanner";
import { externalLineGroups } from "../module/machineLinkGroup";
import { chooseFluidTrunkPlan, fluidJumpBlocker, type FluidLineSpec } from "../module/fluidPorts";
import {
  collectPipeFlow,
  pipeFlowConflict,
  type PipeFlow,
  type PipeFlowMachine,
  type PipeFlowPipe,
} from "../util/pipeFlow";
import type { RecipeTreeNode } from "../types";
import { packModuleTree, edgeMachineLinks, deliveryKey, type NodeSpec, type PackConfig, type PackResult } from "./modulePacking";
import { routeDeliveryRoutes, type DeliveryResult } from "./deliveryRoute";
import {
  describeIssue,
  type IssueScope,
  type LayoutIssue,
  type LayoutSnapshot,
} from "../layoutIssue";
import { rePathToPerimeter } from "../execution/modulePerimeterPass";
import { AUTO_LAYOUT_CHANNEL_GEOMETRY, AUTO_LAYOUT_COORD_DUMP, AUTO_LAYOUT_PERIMETER_PASS } from "../debugFlags";
import { inserterThroughput } from "../inserterThroughput";
import { clusterLineRate } from "../recipeTree";
// 예약 경로는 **탐색기를 안 본다** — 옛 경로의 `routeFallback`(Dijkstra 폴백) 대신
// [BuildSpec](../buildSpec.ts)("무엇으로 지을 수 있나")만 읽는다.
import { makeBuildSpec, tapCapacity } from "../buildSpec";
import { makeEmptyArea, machineSpeedFraction } from "../wizardUtils";
import { commitContainer } from "../execution/machinePlacer";

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

/**
 * 모듈 경로의 결과 — 성공한 후보이거나, **왜 못 만들었는지**다.
 *
 * 옛 경로가 있던 시절엔 실패가 `null` 이어도 됐다 — 호출자가 옛 경로로 폴백했고 화면엔
 * 무언가 나왔으니까. 옛 경로가 사라진 지금은 **이 사유가 사용자가 받는 설명의 전부**다.
 *
 * 사유는 예전엔 `RejectReason`(`[kind] detail` 한 줄)이었다. 사람은 읽을 수 있어도
 * 화면이 그걸로 할 수 있는 게 없어서 — **어디가** 막혔는지, 사용자가 **무엇을 고쳐야**
 * 하는지가 문장 안에 녹아 있었다 — [LayoutIssue] 로 흡수했다(2026-08-04).
 *
 * 실패해도 **부분 배치는 내지 않는다.** `snapshot` 은 그림일 뿐 `CandidateLeaf` 가 아니라
 * 배치 경로로 흘러갈 수 없다.
 */
export type ModulePipelineResult =
  | { ok: true; leaf: CandidateLeaf; warnings: LayoutIssue[] }
  | { ok: false; issues: LayoutIssue[]; snapshot?: LayoutSnapshot };

/**
 * issue 하나 조립 — 카탈로그(개요 §5)의 한 줄에 대응한다.
 *
 * `recoverable` 기본값이 `false` 인 이유: 여기 오는 것은 **이미 물러설 데가 없어서**
 * 실패로 올라온 것들이다. 폴백을 거쳐 온 자리에서만 명시적으로 `true` 를 준다.
 */
function fail(
  code: string,
  scope: IssueScope,
  detail: string,
  extra: Partial<Omit<LayoutIssue, "code" | "scope" | "detail">> = {},
): LayoutIssue {
  return { code, scope, severity: "error", recoverable: false, detail, ...extra };
}

/** 게임데이터가 낡았다 — 처방이 하나뿐이라(다시 import) 따로 둔다. */
function gameDataIssue(detail: string, recipeName?: string): LayoutIssue {
  return fail("stale-gamedata", "게임데이터", detail, { target: { recipeName } });
}

/**
 * 모듈 경로로 후보 leaf 생성. 적격(전부 item·미탭0·납품 경로성공) 아니면 null.
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
   * 이 실행에서 모은 문제 전부 — **왜** 안 됐는지 반드시 남긴다.
   *
   * 옛 경로가 있던 시절엔 조용히 `null` 을 내면 화면에 "그냥 옛날 레이아웃"이 나와, 새
   * 기능이 안 켜진 건지 안 만든 건지 구분이 안 됐다(2026-07-13). 옛 경로가 사라진 지금은
   * **이것이 사용자가 받는 설명의 전부**다.
   *
   * **첫 개에서 멈추지 않는다** — 노드 3개가 막혀 있으면 예전엔 세 번 고치고 세 번 다시
   * 돌려야 전체를 알 수 있었다(2026-08-04 A-2 해소).
   */
  const issues: LayoutIssue[] = [];

  /** 여기서 끝난다 — 모은 것 전부와, 있으면 그림을 함께 낸다. */
  const abort = (snapshot?: LayoutSnapshot): ModulePipelineResult => {
    for (const i of issues) console.info(`[autoLayout] 모듈 경로 포기 ${describeIssue(i)}`);
    return { ok: false, issues, snapshot };
  };

  // 0) 적격성 — 아이템은 전부 OK. 유체는 [트렁크 파이프](../../../../docs/auto-layout/module/trunk-pipe.md)
  //    §5 범위(**외부 공급 유체 입력 1개**)만 받고 나머지는 옛 경로로 폴백한다.
  //    거절 사유가 다 다르므로 각각 이유를 남긴다(진단).
  const fluidTrunkOf = new Map<RecipeTreeNode, NodeSpec["fluidTrunk"]>();
  /** 노드 → 그 모듈이 다루는 유체 이름들. 단계 A 는 면당 1줄이라 최대 2개(입력 E + 출력 W). */
  const fluidsOf = new Map<RecipeTreeNode, string[]>();
  for (const node of order) {
    const at = `${node.recipeName}`;
    const recipe = recipeMap.get(node.recipeName!);
    if (!recipe) { issues.push(gameDataIssue(`레시피 없음: ${node.recipeName}`, at)); continue; }
    const m = metas.get(node)!;

    // 유체 줄 전부를 **한 회전 안에** 앉힌다([chooseFluidTrunkPlan]). 면은 역할이 정하고
    // (출력 W = 부모 쪽 · 입력 E = 자식 쪽), 회전은 머신 속성이라 모듈당 하나다.
    // 면당 줄 수에 상한을 두지 않는다 — 한 면에 여러 줄이 서는 기하는 유체 하나당 폭 2칸
    // (탭 1 + 관 1)으로 성립하고, 실제 상한은 **지하파이프 사거리**가 정한다(아래 게이트).
    const fluidLines: FluidLineSpec[] = [
      ...recipe.ingredients
        .filter((i) => i.type === "fluid")
        .map((i) => ({ name: i.name, role: "input" as const, fluidboxIndex: i.fluidbox_index })),
      ...recipe.products
        .filter((p) => p.type === "fluid")
        .map((p) => ({ name: p.name, role: "output" as const, fluidboxIndex: p.fluidbox_index })),
    ];
    if (fluidLines.length === 0) continue; // 아이템 전용 — 회전 없음.

    // 회전은 footprint 를 안 바꾼다는 전제 위에 있다 → 정사각형 머신만(§3).
    if (m.w !== m.h) {
      issues.push(fail('non-square', '모듈', `${at}: ${m.entityName} ${m.w}×${m.h} — 정사각형이 아니라 유체 회전 불가`,
        { carrier: 'fluid', fixStep: 'machine', target: { recipeName: at } }));
      continue;
    }
    if (!options.pipeEntityName) {
      issues.push(fail('no-pipe-entity', '입력', '빌드 스펙에서 파이프를 선택하지 않음',
        { carrier: 'fluid', fixStep: 'pipe', target: { recipeName: at } }));
      continue;
    }

    const entity = entityMap.get(m.entityName);
    if (!entity) { issues.push(gameDataIssue(`엔티티 게임데이터 없음: ${m.entityName}`, at)); continue; }
    const plan = chooseFluidTrunkPlan(entity, { w: m.w, h: m.h }, fluidLines);
    if (!plan.ok) {
      // 사유를 그대로 흘린다 — 둘은 처방이 다르다. `no-rotation`(머신이 안 맞는다) ·
      // `stale-gamedata`(게임데이터를 다시 뽑아야 한다).
      if (plan.reason === 'stale-gamedata') {
        issues.push(gameDataIssue(`${m.entityName}: ${plan.detail}`, at));
      } else {
        issues.push(fail('no-rotation', '모듈', `${at} ${m.entityName}: ${plan.detail}`,
          { carrier: 'fluid', fixStep: 'machine', target: { recipeName: at } }));
      }
      continue;
    }

    // **한 면에 유체가 2줄 이상이면 점프가 필수다** — 옛 스파인(d1)은 기둥 전체를 먹어
    // 둘째 줄의 유체 상자 칸을 막는다. 물러설 곳이 없으니 여기서 정직하게 거절한다.
    // 판정은 [fluidJumpBlocker] 하나가 갖는다 — 계획([planModulePorts])이 같은 함수를 본다.
    // 삼키면 스파인 둘이 같은 d1 을 다투다 한 줄이 끊겨(`unrouted-lines`) **원인에서 멀리
    // 떨어진 곳**에 증상만 남는다.
    const jumpBudget = {
      undergroundPipeEntityName: options.undergroundPipeEntityName,
      pipeMaxUndergroundDistance: options.pipeMaxUndergroundDistance,
      seatRows: m.h,
      beltLanes: Math.min(
        options.longInserter ? 2 : 1,
        recipe.ingredients.filter((i) => i.type !== 'fluid').length +
          recipe.products.filter((p) => p.type !== 'fluid').length,
      ),
      maxInserterReach: options.longInserter?.reach ?? 1,
    };
    let crowded: LayoutIssue | undefined;
    for (const side of ['W', 'E'] as const) {
      const n = plan.lines.filter((l) => l.side === side).length;
      if (n < 2) continue;
      const blocked = fluidJumpBlocker(n, jumpBudget);
      if (!blocked) continue;
      // 처방이 갈린다: 파이프 단계로 돌아가라(지하파이프) vs 더 큰 머신을 골라라(좌석).
      crowded = blocked.kind === 'seats-exhausted'
        ? fail('fluid-face-seats-exhausted', '모듈', `${at} ${m.entityName} ${side} 면: ${blocked.detail}`,
            { carrier: 'fluid', fixStep: 'machine', target: { recipeName: at } })
        : fail('fluid-underground-too-short', '입력', `${at} ${m.entityName} ${side} 면: ${blocked.detail}`,
            { carrier: 'fluid', fixStep: 'pipe', target: { recipeName: at } });
      break;
    }
    if (crowded) { issues.push(crowded); continue; }

    fluidTrunkOf.set(node, {
      direction: plan.direction,
      pipeEntityName: options.pipeEntityName,
      // [pipeJumpToClusterPipe] 재료 — 지하파이프 능력(BuildSpec). 줄마다의 유체 상자 행은
      // `lines` 안에 있다. generateModule 이 이 둘로 면별 점프 가능 여부를 판정한다.
      undergroundPipeEntityName: options.undergroundPipeEntityName,
      pipeMaxUndergroundDistance: options.pipeMaxUndergroundDistance,
      lines: plan.lines,
      // 이 레시피가 안 쓰는 유체 상자 칸 — 그 면은 스파인이 통째로 지나면 안 된다(점프 필수).
      unusedFluidboxRows: plan.unusedFluidboxRows,
    });
    fluidsOf.set(node, plan.lines.map((l) => l.name));
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
    // 장부가 납품끼리의 교차를 지하로 계획할 때 쓰는 거리 상한. **아래 routeDeliveryRoutes 의
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

  // **링크 신원 불일치**(A-3) — 여태 `pack.linkMismatches` 를 아무도 안 읽었다.
  // 그 필드 주석이 "정상적으로 있을 수 있는 일이 아니다 … 예약 불변식이 깨진 것"
  // 이라고 말하는데도 조용히 버려지고 있었다(2026-08-04 배선).
  for (const mm of pack.linkMismatches) {
    issues.push(fail('link-mismatch', '링크', `링크 신원 불일치: ${mm}`, { carrier: 'item' }));
  }

  // 미탭(과용량 등) 있는 모듈.
  for (const pl of pack.placements) {
    if (pl.module.unroutedLines.length === 0) continue;
    const names = pl.module.unroutedLines.map((l) => `${l.role}:${l.name}`).join(", ");
    // `supply.reason` 은 처방이 갈린다. **두 사유를 섞으면 안 된다** — 이름이 둘 다 "belt" 로
    // 시작해서 예전엔 정확히 반대로 붙어 있었다(2026-08-04 실측):
    //  - `lanes-exceed-capacity` — 면당 [ClusterBelt] 수(= 서로 다른 reach 개수)가 모자란다.
    //    **벨트 티어와 무관**한데 4단계(벨트)로 보내고 있었다. 지렛대는 긴팔 인서터 → 3단계.
    //  - `belt: demand>beltCap` — 진짜 벨트 처리량 부족. 4단계가 맞는데 옛 조건
    //    (`includes('belt-demand')`)에 안 걸려 **처방이 아예 없었다**.
    const why = pl.module.supply?.mode === "direct" ? pl.module.supply.reason : "사유 없음";
    const fixStep = why.includes('no-inserter') || why.includes('lanes-exceed-capacity')
      ? 'inserter' as const
      : why.includes('demand>beltCap') ? 'belt' as const
      : undefined;
    const scope: IssueScope = why.includes('no-inserter') ? '입력' : '모듈';
    // **`supply.reason` 은 여기 오면 사인이 아니다.** 탭이 깨지는 것은 이제 실패가 아니라
    // 기계별 포트로의 강등일 뿐이라(공급 모델 통합, 2026-08-05), 여기까지 왔다는 건 그 강등
    // **뒤에도** 못 앉은 줄이 있다는 뜻이다 — 사유는 참고로 붙이고 처방은 그대로 둔다.
    // (예전엔 *"유체 레시피는 1:1 폴백이 없다 → 모듈 전체 실패"* 를 덧붙였다. 그 폴백이
    //  생겼으므로 그 문장은 삭제했다 — 남겨 두면 화면이 없는 원인을 가리킨다.)
    const carrier = pl.module.unroutedLines.some((l) => l.kind === 'pipe')
      ? ('fluid' as const)
      : ('item' as const);
    issues.push(fail('unrouted-lines', scope,
      `${pl.id}: [${names}] — ${why}`,
      { target: { moduleId: pl.id }, fixStep, carrier }));
  }
  if (issues.length > 0) return abort(snapshotOf(pack, issues));

  // 1b) [파이프 합류 가드](../util/pipeFlow.ts) — 파이프는 **방향이 없어서** 직교로 닿기만
  //     하면 두 관망이 하나가 된다. 다른 유체끼리 이어지면 오염되고, 남의 머신
  //     **유체 출력 상자**에 스치면 그 머신의 생산물이 내 관망으로 **조용히 샌다** — 화면상으론 멀쩡하고
  //     라우팅도 "성공"이라 보고한다. 그래서 파이프를 깔기 전에 금지 칸 지도를 만들어 둔다.
  //     유체마다 지도가 다르다 — **같은 유체는 닿아도 무해**하기 때문이다(처리량 무한).
  //
  //     **유체는 모듈이 아니라 셀마다 다르다.** 예전엔 "이 배치의 파이프 셀 = 그 모듈의 유일
  //     유체" 로 태깅했는데, 모듈이 유체를 둘 다루는 순간 자기 파이프를 남의 유체로 오인해
  //     오염을 못 잡거나 자기 자신을 거절한다. 그래서 **방출기가 놓으면서 적어 둔**
  //     [GeneratedModule.pipeCells] 를 읽는다.
  const allFluids = new Set<string>();
  for (const node of order) for (const f of fluidsOf.get(node) ?? []) allFluids.add(f);
  const pipeFlowByFluid = new Map<string, PipeFlow>();
  if (allFluids.size > 0) {
    // 유체 머신 — 프로토타입(`fluid_boxes`)이 유체 상자의 **연결 칸**을, 레시피가 그 칸이 **받는
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
    for (const pl of pack.placements) pipes.push(...pl.module.pipeCells);
    for (const fluid of allFluids)
      pipeFlowByFluid.set(fluid, collectPipeFlow({ fluidName: fluid, pipes, machines }));

    // 트렁크 검사 — 기둥은 자기 머신의 **유체 입력 상자**를 지나가라고 깐 것이므로(같은 유체 →
    // 안 막힘) 여기서 걸리는 건 진짜 사고다: 자기 머신의 유체 출력 상자를 같이 스쳤거나, 옆
    // 모듈의 다른 유체 관망에 붙었거나. 거절은 **항상 안전하다** — 옛 경로로 폴백할 뿐이다.
    //
    //     **유체별로 나눠서 검사한다** — 한 모듈의 파이프를 통째로 한 유체의 지도에 대면,
    //     유체가 둘일 때 서로를 "남의 파이프"로 보고 자기 자신을 거절한다.
    for (const pl of pack.placements) {
      for (const fluid of new Set(pl.module.pipeCells.map((c) => c.fluid))) {
        const ownPipes = pl.module.pipeCells.filter((c) => c.fluid === fluid);
        const hit = pipeFlowConflict(ownPipes, pipeFlowByFluid.get(fluid)!);
        if (hit)
          issues.push(fail('pipe-merge-conflict', '모듈',
            `${pl.id}: 트렁크 파이프(${fluid})가 (${hit.cell.x},${hit.cell.y}) 에서 ${hit.rule} 규칙 위반`,
            { carrier: 'fluid', target: { moduleId: pl.id }, cells: [{ ...hit.cell }] }));
      }
    }
    if (issues.length > 0) return abort(snapshotOf(pack, issues));
  }

  // 유체 납품 경로(pipe-to-pipe)이 **다른 유체**에 안 닿게 할 금지 칸 — 위 합류 가드가 낸 유체별
  // hard 지도를 그대로 넘긴다(같은 유체는 안 막아 공유 허용). 아이템 트리면 비어 있다.
  const fluidBlocked = new Map<string, ReadonlySet<string>>();
  for (const [fluid, pf] of pipeFlowByFluid) fluidBlocked.set(fluid, pf.blockedTilesHard);

  const deliveryRes = routeDeliveryRoutes(pack, {
    beltEntityName: options.beltEntityName,
    beltMaxUndergroundDistance: options.beltMaxUndergroundDistance,
    undergroundBeltEntityName: options.undergroundBeltEntityName,
    pipeEntityName: options.pipeEntityName,
    pipeMaxUndergroundDistance: options.pipeMaxUndergroundDistance,
    undergroundPipeEntityName: options.undergroundPipeEntityName,
    fluidBlocked,
  });
  if (deliveryRes.failures > 0) {
    // **경로마다 하나씩** 낸다 — 예전엔 "3건" 이라는 숫자 하나였다. 어느 납품 경로가 왜
    // 막혔는지는 `routes` 에 이미 있었는데 화면까지 못 갔다.
    //
    // 유체와 아이템을 가른다 — 원인도 처방도 다르다. 아이템 실패는 라우팅이 어려웠다는
    // 뜻(dijkstra 폴백까지 갔다 = `recoverable`)이지만, 유체 실패는 **계획 자체가
    // 불가능했다**는 뜻이다(§4.6, 폴백 없음 = `recoverable: false`).
    for (const r of deliveryRes.routes) {
      if (r.ok) continue;
      const isFluidPlan = r.reason === "fluid-unplannable" || r.reason === "fluid-planned-chain-blocked";
      if (isFluidPlan) {
        issues.push(fail('fluid-unplannable', '채널',
          `${r.item}(${r.reason}) — 한 채널에 다른 유체가 겹쳤을 가능성`,
          { carrier: 'fluid', target: { deliveryKey: r.key } }));
      } else {
        issues.push(fail('delivery-failures', '납품경로',
          `${r.item}: ${r.reason ?? "사유 없음"}`,
          { carrier: 'item', recoverable: true, target: { deliveryKey: r.key } }));
      }
    }
    return abort(snapshotOf(pack, issues, deliveryRes));
  }

  // 1c) 외부상자 전역 perimeter 재배치(조각 6-C) — 합성 후 살아남은 raw 입력·루트 출력
  //     상자는 각자 *로컬* 모듈 ring(=배치 내부)에 박혀 있다. ⑥A lanePlan 배정대로 예약된
  //     lane 안에 결정적 belt(직선 or ㄱ자)를 깔아 전역 외곽으로 옮긴다(탐색 없음). lane 이
  //     막히거나 미지원 배정(형제에 막힌 N/S 변→채널)인 상자만 건너뛰어 로컬 ring 에 남기고
  //     트리는 모듈 경로를 유지한다(회귀 0).
  // rePathToPerimeter 는 deliveryRoute 처럼 **순수**하다(pack 미변형) — 무엇을 떼고
  // (droppedCellKeys) 무엇을 놓고(addedCells) 상자가 어디로 가는지(relocations)를 반환하고,
  // 적용은 아래 어댑터에서 Area 를 지을 때 한다.
  const perim = AUTO_LAYOUT_PERIMETER_PASS
    ? rePathToPerimeter(pack, deliveryRes.strippedChestIds, deliveryRes.cells, {
        beltEntityName: options.beltEntityName,
        inserterEntityName: options.inserterEntityName,
        pipeEntityName: options.pipeEntityName, // 유체 포트는 파이프로 반출한다.
        pipeFlow: pipeFlowByFluid, // [파이프 합류 가드] — 반출 파이프가 밟으면 안 되는 칸.
      })
    : null;
  // **반출 skip 경고**(A-4) — 여태 `skipped` 와 사유를 아무도 안 읽었다. 상자가 외곽으로
  // 못 나가 로컬 ring 에 남아도 사용자는 알 길이 없었다. 물류 자체는 정상이므로(회귀 0
  // 설계: 트렁크째 남아 여전히 이어진다) 실패가 아니라 **경고**다.
  if (perim && perim.skipped > 0) {
    issues.push({
      code: 'perimeter-skip', scope: '반출경로', severity: 'warning', recoverable: true,
      detail: `상자 ${perim.skipped}개가 외곽으로 못 나가 모듈 안에 남음${perim.reason ? ` — ${perim.reason}` : ''}`,
    });
  }
  const droppedKeys = perim?.droppedCellKeys ?? new Set<string>();
  const relocOrigin = new Map<string, { x: number; y: number }>();
  const relocBelts = new Map<string, typeof deliveryRes.cells>();
  for (const r of perim?.relocations ?? []) {
    relocOrigin.set(r.chestId, r.origin);
    relocBelts.set(r.chestId, r.belts);
  }

  // 2) 어댑터 → internal/external Area.
  //    - 머신 → internal.containers
  //    - belt/인서터 셀(strip 제외) → internal.placed
  //    - 유지되는 무한상자(raw 입력·루트 출력) → external.containers + ghost 셀 external.placed
  //    - 납품 경로 belt → internal.placed
  //    strip(경계 chest+seat) 셀/상자는 제외.
  const internal = makeEmptyArea("internal");
  const external = makeEmptyArea("external");
  const stripCells = deliveryRes.strippedCellKeys;
  const stripChests = deliveryRes.strippedChestIds;

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
      // stripCells=납품 경로가 뗀 경계 chest/seat, droppedKeys=perimeter 이사한 상자의 옛 ghost/feeder.
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
  for (const c of deliveryRes.cells) internal.placed.push(c);
  // perimeter 재배치가 새로 깐 셀(belt+feeder+이사한 chest) — mod.cells 순회와 같은 분류.
  for (const c of perim?.addedCells ?? []) {
    if (c.cell.entityType === EntityType.InfinityChest) external.placed.push(c);
    else internal.placed.push(c);
  }
  // 납품 경로 지하 corridor — Area 인덱스에 기록해 이후 라우팅(드래그 재라우팅 등)이 같은
  // 직선 위 페어링 절단을 피하게 한다. placed 와 같은 직접-기록 규약(비-이중-commit:
  // 이 candidate 의 routings 는 commitRouting 을 타지 않는다).
  internal.undergroundCorridors.push(...deliveryRes.corridors);

  // 2b) Routing 객체 — 선/IO 라벨/드래그 그룹 복원(옛 routings=[] 한계 해소). 끝점은 실제
  //    컨테이너 id(머신 = `${모듈id}-m0`, 유지된 상자). placed = 납품 경로 belt 셀(직선 폴백 가능).
  //    납품 경로=머신→머신(부모-자식, 드래그 트리), raw 입력=상자→머신, 루트 출력=머신→상자.
  const routings: Routing[] = [];
  const itemPort = (containerId: string, cell: { x: number; y: number }, face: PortFace): ContainerPort =>
    ({ containerId, cell, face, kind: "item" });
  // **위치가 아니라 신원으로 짝짓는다.** `routeDeliveryRoutes` 는 유체를 먼저 깔려고
  // `pack.deliveries` 를 재정렬해서 돌므로 결과 배열의 순서가 계획 순서와 다르다 —
  // `routes[i]` 로 읽으면 유체와 아이템이 섞이는 순간 **다른 경로의 셀이 이 라우팅에 붙는다**
  // (2026-08-04 수정. 안정 정렬이라 한 종류뿐이면 안 드러났고, 그 값을 쓰는 연결선 렌더까지
  //  죽어 있어 화면에도 안 나왔다).
  const routeByKey = new Map(deliveryRes.routes.map((r) => [r.key, r]));
  pack.deliveries.forEach((delivery) => {
    const route = routeByKey.get(deliveryKey(delivery));
    // belt-following: 자식 트렁크 spine + gap belt + 부모 트렁크 spine (boxless 라 연속).
    const placed = [...delivery.from.cells, ...(route?.cells ?? []), ...delivery.to.cells];
    routings.push({
      id: makeId("r"),
      kind: "item",
      from: itemPort(`${delivery.fromId}-m0`, delivery.from.anchor, delivery.from.face),
      to: itemPort(`${delivery.toId}-m0`, delivery.to.anchor, delivery.to.face),
      placed,
      // 이 납품 경로가 깐 지하 corridor(표시·수정 모드 정리용 사본 — area 기록이 원본).
      corridors: (route?.corridors ?? []).map((c) => ({ ...c, range: [c.range[0], c.range[1]] as [number, number] })),
      // 포트 산출 근거(표시용) — 자식 출력 포트 / 부모 입력 포트 각각.
      fromPortMeta: delivery.from.meta,
      toPortMeta: delivery.to.meta,
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
      label: `모듈 · ${order.length} 노드 · ${pack.deliveries.length} 납품 경로 · raw ${pack.rawPorts.length}`,
    },
    // 성공한 배치에도 경고가 붙을 수 있다 — 반출 skip 이 그 유일한 예다.
    warnings: issues,
  };
}

/**
 * 실패를 **짚기 위한 그림** — `pack` 에서 유도만 한다(재계산 금지).
 *
 * 같은 기하를 다시 계산하면 그것이 곧 "두 번째 렌더러"가 되고, 렌더러가 아니라
 * **데이터 층에서** 어긋난다는 점에서 더 나쁘다.
 */
function snapshotOf(
  pack: PackResult,
  issues: readonly LayoutIssue[],
  deliveryRes?: DeliveryResult,
): LayoutSnapshot {
  const problemModules = new Set(
    issues.filter((i) => i.severity === 'error' && i.target?.moduleId).map((i) => i.target!.moduleId!),
  );
  const okByKey = new Map((deliveryRes?.routes ?? []).map((r) => [r.key, r.ok]));
  return {
    modules: pack.placements.map((pl) => ({
      id: pl.id,
      recipeName: undefined,
      entityName: pl.module.machines[0]?.entityName ?? 'unknown',
      machineCount: pl.module.machines.length,
      bbox: { ...pl.module.bbox },
      status: problemModules.has(pl.id) ? 'problem' : 'ok',
    })),
    deliveries: pack.deliveries.map((d) => {
      const key = deliveryKey(d);
      return {
        key,
        item: d.item,
        from: { ...d.from.anchor },
        to: { ...d.to.anchor },
        // 라우팅까지 못 간 실패(층 2 등)면 결과가 없다 — 그건 "아직 안 깔림" 이지 실패가 아니다.
        ok: okByKey.get(key) ?? true,
      };
    }),
    bbox: { ...pack.bbox },
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
