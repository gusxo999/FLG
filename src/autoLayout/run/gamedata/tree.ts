/**
 * **실행의 어댑터** — 트리와 게임데이터를 배치가 읽는 우리 타입으로 옮긴다.
 *
 * ```
 * resolveNodes           노드 이름 → 레시피 · 엔티티 · 유체 줄       (조회는 여기서 한 번)
 * nodeSpecsOf            노드 → NodeSpec(줄 · rate · 속도)            (packModuleTree 의 입력)
 * fluidMachinesOf        배치된 머신 → 유체 상자가 있는 머신          (파이프 합류 가드의 입력)
 * undergroundDistanceOf  엔티티 이름 → 지하 사거리                    (종착 구간의 입력)
 * ```
 *
 * `GameDataLookup` 을 받는 함수는 이 파일과 `buildSpec` · `wizardUtils` 뿐이다 — 게임데이터를 **보는** 층이
 * 그 셋이라는 뜻이다. 판정([policy](../policy.ts))·장부([ledger](../ledger.ts))·찍기([emit](../emit.ts))는
 * 여기서 옮겨 둔 값만 받는다.
 *
 * > **내력.** `run/build/module.ts` 의 `runModulePipeline` 안에 흩어져 있었다(조회 9곳).
 * > 2026-09-14 한 파일로 모았다(계획 구조-2축 · 2 Step 2b). 본문은 옮기기만 했다.
 */

import type { Entity, GameDataLookup, Recipe } from "../../../types/gameData";
import type { RecipeTreeNode } from "../../tree/types/recipe";
import type { IoLine } from "../../module/types/line";
import type { FluidLineSpec } from "../../module/gamedata";
import { externalLineGroups, groupRate, readLinkRole } from "../../module/arith/link";
import type { PipeFlowMachine } from "../../shared/pipeFlow";
import { edgeLinkGroups } from "../../tree/build";
import type { NodeSpec, PackConfig, PackResult } from "../../tree/types/pack";
import { laneCapOfTier } from "../../shared/arith/belt";
import { clusterLineRate } from "../../tree/arith/recipe";
import type { BuildSpec } from "../../shared/gamedata/spec";
import { machineSpeedFraction } from "./picker";

/** layeredWizard NodeMeta 와 동형(필요한 부분만). */
export interface ModuleNodeMeta {
  entityName: string;
  w: number;
  h: number;
  count: number;
  depth: number;
}

/**
 * **노드 하나를 게임데이터로 풀어 둔 것.** 레시피·엔티티가 없으면 `undefined` 로 둔다 — 없다고 판정하는 것은
 * [admitFluidTrunks] 의 몫이다(사유와 처방이 거기 있다).
 */
export interface ResolvedNode {
  node: RecipeTreeNode;
  meta: ModuleNodeMeta;
  recipe: Recipe | undefined;
  entity: Entity | undefined;
  /** 이 레시피의 유체 줄 — 입력 먼저, 레시피 순서 그대로. 레시피가 없으면 빈 배열. */
  fluidLines: FluidLineSpec[];
  /** 이 레시피의 **아이템** 줄 수(재료 + 산출). 유체 점프 예산의 `beltDepths` 상한이다. */
  itemLineCount: number;
}

export function resolveNodes(
  order: readonly RecipeTreeNode[],
  metas: ReadonlyMap<RecipeTreeNode, ModuleNodeMeta>,
  gameData: GameDataLookup,
): ResolvedNode[] {
  const { recipeMap, entityMap } = gameData;
  return order.map((node) => {
    const meta = metas.get(node)!;
    const recipe = recipeMap.get(node.recipeName!);
    const fluidLines: FluidLineSpec[] = recipe
      ? [
          ...recipe.ingredients
            .filter((i) => i.type === "fluid")
            .map((i) => ({ name: i.name, role: "input" as const, fluidboxIndex: i.fluidbox_index })),
          ...recipe.products
            .filter((p) => p.type === "fluid")
            .map((p) => ({ name: p.name, role: "output" as const, fluidboxIndex: p.fluidbox_index })),
        ]
      : [];
    const itemLineCount = recipe
      ? recipe.ingredients.filter((i) => i.type !== 'fluid').length +
        recipe.products.filter((p) => p.type !== 'fluid').length
      : 0;
    return { node, meta, recipe, entity: entityMap.get(meta.entityName), fluidLines, itemLineCount };
  });
}

/** [nodeSpecsOf] 의 산출 — 명세와, 모듈 id → 레시피 이름(뒤 단계가 머신에 레시피를 되붙일 때 쓴다). */
export interface NodeSpecs {
  specs: NodeSpec[];
  recipeOfId: Map<string, string>;
}

/**
 * **모듈마다 무엇을 몇 대·얼마나 나르나** — 트리에서 유도한 [NodeSpec]. id 는 노드별 결정적(order 인덱스 + 레시피).
 */
export function nodeSpecsOf(
  nodes: readonly ResolvedNode[],
  parentOf: ReadonlyMap<RecipeTreeNode, RecipeTreeNode | null>,
  fluidTrunkOf: ReadonlyMap<RecipeTreeNode, NodeSpec["fluidTrunk"]>,
  options: BuildSpec,
): NodeSpecs {
  const idOf = new Map<RecipeTreeNode, string>();
  const recipeOfId = new Map<string, string>();
  nodes.forEach(({ node }, i) => {
    const id = `n${i}-${node.recipeName}`;
    idOf.set(node, id);
    recipeOfId.set(id, node.recipeName!);
  });
  // **팔 속도는 스칼라가 아니다** — *어느 인서터가 앉느냐*의 함수이고, 그건 벨트를 어느
  // 칸에 두느냐가 정한다(`reach` 는 고정 거리 — 계획서 §16). 그래서 여기서 수를 접지 않고
  // **인서터 목록 자체**를 봉투에 담아 보낸다. 접는 쪽이 곧 어긋나는 쪽이었다:
  //
  // 예전엔 `min(normal, long)` 을 자체 계산했다 — "어느 reach 에 앉든 굶지 않게 보수적으로".
  // 두 팔의 속도가 비슷하면 맞는 보수성이지만, 실측 모드팩은 fast 10/s 대 long-handed 1.2/s 로
  // **8배**였다. 그러면 min 은 보수성이 아니라 오답이다 — 같은 숫자가 성질이 반대인 두 질문에
  // 동시에 쓰이기 때문이다:
  //  - **팔이 몇 개 필요한가** — 느린 값을 쓰면 8배로 세서 면을 넘친다.
  //  - **한 벨트에 몇 개 앉나**(그릇) — 느린 값을 쓰면 `45÷1.2 = 37` 이 되어 **상한이 사라진다**.
  // 그 뒤 `reach 1` 고정으로 옮겼는데, 이번엔 **깊은 벨트를 쓰는 줄이 조용히 굶었다**(`docs/auto-layout/module/module-planning.md §4.5`).
  // 답은 "하나의 보수적인 수"가 아니라 **`(줄, 슬롯)` 마다 다른 수**다.
  //
  // (여기엔 `options.inserters` 가 비었을 때의 폴백 갈래가 있었다. 뼈대의 설정 관문이 빈 목록에서 이미
  //  돌아가므로 도달할 수 없어 지웠다 — 2026-09-14.)
  const specInserters = options.inserters;

  const specs: NodeSpec[] = nodes.map(({ node, meta: m, recipe: maybeRecipe, entity: ent }) => {
    const recipe = maybeRecipe!;
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
    // 100% 수요를 넘기면 배분기는 앉히지도 못할 팔을 요구하고 → 좌석에서 거절된다. 그런데
    // 머신 **수**는 이미 그 보상만큼 늘어나 있어서, 100% 수요는 애초에 아무도 안 믿는
    // 숫자다(2026-07-17 실측: kr-sand 13+5팔 > 14행 → 거절. 80%면 10+4=14로 앉는다).
    const craftingSpeed = ent?.crafting_speed ?? 1;
    const params = {
      craftingSpeed,
      productivityMultiplier: 1,
      speedFraction: ent ? machineSpeedFraction(recipe, ent, craftingSpeed, options.inserters, options.belts) : undefined,
    };
    // 수량을 모르는 줄(범위 산출물인데 게임데이터에 amount_min/max 가 없는 경우)은 **넣지
    // 않는다** — 그래야 붓기가 그 줄을 *양을 모르는 줄* 로 보고 안 만든다([externalLineGroups]).
    // 지어낸 숫자나 NaN 을 넣으면 팔 수가 조용히 틀어진다.
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
      supplyCapacity: { inserters: specInserters, lineRates },
    };
  });
  return { specs, recipeOfId };
}

/**
 * **유체 머신** — 프로토타입(`fluid_boxes`)이 유체 상자의 **연결 칸**을, 레시피가 그 칸이 **받는
 * 유체 이름**을 정한다(→ docs/fluid-box-semantics.md). 유체 상자가 없는 머신(조립기)은 뺀다.
 */
export function fluidMachinesOf(
  pack: PackResult,
  recipeOfId: ReadonlyMap<string, string>,
  gameData: GameDataLookup,
): PipeFlowMachine[] {
  const { recipeMap, entityMap } = gameData;
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
  return machines;
}

/** 엔티티 이름 → 지하 사거리. 모르면 0 — 지어내지 않는다. */
export function undergroundDistanceOf(gameData: GameDataLookup): (entityName: string) => number {
  return (entityName) => gameData.entityMap.get(entityName)?.max_underground_distance ?? 0;
}

/**
 * **왜 팔이 그만큼 앉았나** — 관측 전용 표식(`AUTO_LAYOUT_COORD_DUMP` 일 때만). 계산·분기·반환값을 안 바꾼다.
 *
 * 한 벨트에 팔이 몰려 포화된 배치를 봤을 때, 그 수가 어느 식에서 나왔는지 좌표만 보고는 못 가린다.
 * 줄마다 **누가 붓느냐**가 갈린다 — 링크 줄(자식↔부모)은 [edgeLinkGroups], 원료 · 완제품 줄은 [externalLineGroups].
 * 둘 다 [Link] 를 내므로 찍는 모양은 하나다: 벨트 줄 수 · 줄마다 실린 양 · 그 줄들에 단 팔의 합.
 *
 * **부하는 실린 양으로 잰다**(2026-08-22). `팔 수 × 인서터 운반량` 은 **올림된 용량**이라 언제나 실제보다 커서
 * 멀쩡한 줄을 "포화" 라고 거짓 경고했다. 견주는 상대는 **벨트 한 줄의 상한**(레인 하나 — [laneCapOfTier])이다.
 * 2026-10-06 까지는 `그릇 = ⌊벨트 ÷ 인서터⌋` 열과 벨트 전체(두 레인 합)를 찍었다 — 앞의 것은 2026-08-22 에 버린 식이고
 * 뒤의 것은 계획이 보는 상한의 두 배였다.
 *
 * 명세(이 파일의 산출)를 설명하는 표식이라 여기 산다 — 태그는 태그하는 종류의 파일에 둔다.
 */
export function logArmBeltLimits(
  specs: readonly NodeSpec[],
  packConfig: PackConfig,
  options: BuildSpec,
): void {
  const specInserters = options.inserters;
  const lineCap = laneCapOfTier(options.belts?.[0]);
  const nodeById = new Map(specs.map((s) => [s.id, s]));
  // 팔 운반량은 **reach 마다 다르다**(계획서 §16) — 하나로 접어 찍으면 덤프가 거짓말을 한다.
  const perReach = specInserters
    .map((i) => `reach${i.reach}=${i.throughput}(${i.entityName})`)
    .join(" ");
  console.log(`[팔·벨트 상한] ${perReach} | 벨트 한 줄의 상한(최속 · 레인 하나)=${lineCap}`);
  for (const s of specs) {
    const rows = { WE: s.machine.h, NS: s.machine.w };
    const ext = externalLineGroups(s.lines, s.count, s.supplyCapacity ?? {}, specInserters, undefined, {
      belts: options.belts,
      machineFaceCells: s.machine.h,
    });
    for (const [key, rate] of s.supplyCapacity?.lineRates ?? []) {
      const [role, name] = key.split(":");
      // 이 줄이 링크인가 — 출력이면 부모가, 입력이면 자식이 같은 품목을 주고받나.
      const parent = s.parentId ? nodeById.get(s.parentId) : undefined;
      const child = specs.find((c) => c.parentId === s.id && c.lines.some((l) => l.role === "output" && l.name === name));
      const linkEdge =
        role === "output" && parent?.lines.some((l) => l.role === "input" && l.name === name)
          ? edgeLinkGroups(s, parent, name, packConfig)
          : role === "input" && child
            ? edgeLinkGroups(child, s, name, packConfig)
            : undefined;
      // 원료 · 완제품 줄은 깊이 예산이 뒤에서 묶음을 다시 정할 수 있다 — 여기 찍는 것은 그 전의 붓기다.
      const links = linkEdge ?? ext.filter((g) => g.item === name && readLinkRole(g) === role);
      const who = linkEdge ? "링크" : links.length > 0 ? "외부" : "미상";
      // 이 모듈의 머신들이 그 줄들에 단 팔 — 출력이면 싣는 쪽(`from`), 입력이면 집는 쪽(`to`).
      const mine = role === "output" ? ("from" as const) : ("to" as const);
      const arms = links.reduce((sum, l) => sum + [...l[mine].values()].reduce((a, b) => a + b, 0), 0);
      const perBelt = links.map((l) => Number((groupRate(l) ?? 0).toFixed(1)));
      const load = perBelt.length > 0 ? Math.max(...perBelt) : 0;
      console.log(
        `  ${s.id} ${key}: [${who}] 벨트 ${links.length}줄, 줄마다 실린 양 [${perBelt}]/s (팔 ${arms}) ` +
          `· 클러스터rate=${rate.toFixed(2)} 머신수=${s.count} ` +
          `· 면좌석=W/E ${rows.WE} N/S ${rows.NS} ` +
          `|| 가장 많이 실린 줄 ${load.toFixed(1)}/s vs 한 줄의 상한 ${lineCap}/s${load > lineCap + 1e-9 ? "  ← 포화" : ""}`,
      );
    }
  }
}
