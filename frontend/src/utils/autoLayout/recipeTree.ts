import { productYield, type Recipe } from '../../store/gameDataStore';
import type { RecipeTreeNode } from './types';

interface ExpandContext {
  recipeMap: Map<string, Recipe>;
  itemToRecipe: Map<string, string>;
  externalIngredients: ReadonlySet<string>;
  /**
   * item.name → 사용자가 직접 고른 제작법 이름. 비어 있으면 itemToRecipe 의 기본값을 쓴다.
   * 대체 제작법(여러 레시피가 같은 아이템을 만들 때) 선택을 트리에 반영하기 위한 override.
   */
  recipeOverrides: ReadonlyMap<string, string>;
  /** 사이클 차단을 위해 현재 선조 경로의 레시피 이름들 */
  ancestors: Set<string>;
}

/**
 * 타깃 레시피를 루트로, 모든 ingredient → 그 ingredient 를 만드는 레시피를 자식으로 펼친다.
 * 기본은 첫 매칭(itemToRecipe)이지만 recipeOverrides 에 항목이 있으면 그 제작법을 우선한다.
 * external 로 토글된 ingredient 는 leaf 로만 기록 (그 자식 펼침 X).
 * 사이클(직간접 자기 참조)은 자식 무시.
 */
export function expandRecipeTree(
  targetRecipe: string,
  recipeMap: Map<string, Recipe>,
  itemToRecipe: Map<string, string>,
  externalIngredients: ReadonlySet<string>,
  recipeOverrides: ReadonlyMap<string, string> = new Map(),
): RecipeTreeNode {
  const recipe = recipeMap.get(targetRecipe);
  if (!recipe) {
    return {
      recipeName: undefined,
      itemName: targetRecipe,
      external: true,
      children: [],
      machineCount: 0,
    };
  }
  const rootItemName = recipe.products[0]?.name ?? targetRecipe;
  const ctx: ExpandContext = {
    recipeMap,
    itemToRecipe,
    externalIngredients,
    recipeOverrides,
    ancestors: new Set([targetRecipe]),
  };
  return {
    recipeName: targetRecipe,
    itemName: rootItemName,
    external: false,
    children: recipe.ingredients.map((ing) => expandIngredient(ing.name, ctx)),
    machineCount: 0,
  };
}

function expandIngredient(itemName: string, ctx: ExpandContext): RecipeTreeNode {
  if (ctx.externalIngredients.has(itemName)) {
    return {
      recipeName: undefined,
      itemName,
      external: true,
      children: [],
      machineCount: 0,
    };
  }

  const recipeName = ctx.recipeOverrides.get(itemName) ?? ctx.itemToRecipe.get(itemName);
  if (!recipeName || ctx.ancestors.has(recipeName)) {
    return {
      recipeName: undefined,
      itemName,
      external: true,
      children: [],
      machineCount: 0,
    };
  }

  const recipe = ctx.recipeMap.get(recipeName);
  if (!recipe) {
    return {
      recipeName: undefined,
      itemName,
      external: true,
      children: [],
      machineCount: 0,
    };
  }

  ctx.ancestors.add(recipeName);
  const children = recipe.ingredients.map((ing) => expandIngredient(ing.name, ctx));
  ctx.ancestors.delete(recipeName);

  return {
    recipeName,
    itemName,
    external: false,
    children,
    machineCount: 0,
  };
}

/**
 * 트리 전체 노드를 BFS 순서로 평면화. 머신 수 산정 / placement 에서 사용.
 */
export function flattenTree(root: RecipeTreeNode): RecipeTreeNode[] {
  const out: RecipeTreeNode[] = [];
  const queue: RecipeTreeNode[] = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    out.push(node);
    for (const child of node.children) queue.push(child);
  }
  return out;
}

/**
 * 트리 안에 등장한 모든 비-외부 레시피 이름의 집합. 자동 체크 / 기술 closure 시드로 사용.
 */
export function collectInternalRecipes(root: RecipeTreeNode): Set<string> {
  const out = new Set<string>();
  for (const node of flattenTree(root)) {
    if (!node.external && node.recipeName) out.add(node.recipeName);
  }
  return out;
}

/**
 * '최소값' 모드: 비-외부 노드마다 머신 1대씩.
 *
 * 의미: "타깃 레시피가 (생산량과 무관하게) 일단 만들어지기만 하면 된다" 는 가장 단순한 구성.
 * 자식 머신 1대로 부모의 요구 처리량을 채우지 못해 라인이 부분 가동될 수 있지만, 본 모드는
 * 그것을 의도적으로 허용한다 — "되는 만큼만 만든다" 가 사용자 의도.
 *
 * 트리를 in-place 로 수정하지 않고 동일 모양의 새 트리를 반환.
 */
export function assignMinimumCounts(root: RecipeTreeNode): RecipeTreeNode {
  return {
    ...root,
    machineCount: root.external ? 0 : 1,
    children: root.children.map(assignMinimumCounts),
  };
}

/**
 * 한 머신의 유효 파라미터. v1 은 base `crafting_speed` 와 `productivityMultiplier = 1`.
 *
 * 모듈 지원을 붙일 때는 [moduleEffects.ts](./../moduleEffects.ts) 의
 * `applyEffectsToMachine` 결과(`craftingSpeed`, `productivityMultiplier`)를 그대로
 * 넣으면 처리량 계산이 모듈을 반영한다 — 알고리즘은 손대지 않아도 된다.
 */
export interface NodeMachineParams {
  /** 유효 제작 속도. 모듈 미적용 시 머신의 base crafting_speed */
  craftingSpeed: number;
  /** 산출물 배수 (1 + productivity). 모듈 미적용 시 1 */
  productivityMultiplier: number;
  /**
   * **머신이 실제로 도는 비율**(0 < f ≤ 1). 미지정 = 1(안 굶는다).
   *
   * 인서터 팔을 다 앉힐 자리가 없으면 머신은 **가장 굶는 줄의 속도로만** 돈다
   * ([allocateArms](planner/module/clusterPortPlanner.ts) 가 계산). 그 사실을 여기 담아 산출·수요에
   * 곱하면, **머신 수가 자연히 늘어나 부족분을 보상**한다(2026-07-16 사용자 설계).
   *
   * 순환하지 않는다: 비율은 **전속력 기준 수요**로 정하고, 그렇게 앉힌 팔이 나르는 양이 곧
   * 실제 수요다 — 자기 자신과 일치한다. 그리고 팔 개수는 머신 수와 무관하므로
   * ([requiredInserterCount]) 머신 수를 늘려도 비율이 안 바뀐다.
   */
  speedFraction?: number;
}

/** recipeName → 그 레시피를 돌릴 머신의 유효 파라미터. 머신 매칭 실패 시 undefined */
export type MachineParamsLookup = (recipeName: string) => NodeMachineParams | undefined;

/** energy_required(초)가 0/누락이면 1초로 간주해 0 나눗셈 방지 */
function craftTime(recipe: Recipe): number {
  return recipe.energy_required > 0 ? recipe.energy_required : 1;
}

/**
 * 머신 1대가 `producedItem` 을 초당 몇 개 산출하는지. **수량을 모르면 `undefined`.**
 * = [[productYield]] × productivityMultiplier × craftingSpeed / energy_required
 *
 * 확률·범위 산출물의 기대 수율은 `productYield` 가 계산한다. 그게 `undefined` 를 내면
 * (= 게임데이터에 수량이 없다) 여기서도 숫자를 지어내지 않는다 — 0 을 내면 "산출이 없다" 는
 * **다른 뜻**이 되고, 곱해버리면 NaN 이 조용히 퍼진다.
 */
export function perMachineItemsPerSec(
  recipe: Recipe,
  producedItem: string,
  params: NodeMachineParams,
): number | undefined {
  const product =
    recipe.products.find((p) => p.name === producedItem) ?? recipe.products[0];
  if (!product) return 0; // 이 레시피는 그걸 안 만든다 = 진짜 0.
  const yieldPerCraft = productYield(product);
  if (yieldPerCraft === undefined) return undefined; // 수량 미상 — 판정 보류.
  // speedFraction — 팔을 다 못 앉혀 굶는 머신은 그만큼만 낸다(미지정=1). 이걸 곱해야
  // countForDemand 가 부족분만큼 **머신을 더 놓아 보상**한다.
  return (
    (yieldPerCraft * params.productivityMultiplier * params.craftingSpeed * (params.speedFraction ?? 1)) /
    craftTime(recipe)
  );
}

/**
 * **클러스터 전체**(머신 N대)가 한 I/O 줄을 초당 몇 개 다루나 — 입력이면 소비 rate,
 * 출력이면 산출 rate. [Parallel Inserting](../../../../docs/용어사전.md#parallel-inserting)의
 * `SupplyCapacity.lineRates` 를 채우는 값이다.
 *  - 입력: 제작 횟수 × ingredient.amount. (재료엔 범위 수량이 없다 — 실데이터 확인)
 *  - 출력: 제작 횟수 × [[productYield]] × productivityMultiplier.
 *
 * **수량을 모르면 `undefined`** 를 낸다. 호출부(moduleWizard)는 그 줄을 `lineRates` 에 아예
 * 안 넣고, `requiredInserterCount` 가 `rate === undefined` → **판정 보류(1개)** 한다.
 */
export function clusterLineRate(
  recipe: Recipe,
  role: "input" | "output",
  name: string,
  machineCount: number,
  params: NodeMachineParams,
): number | undefined {
  // 굶는 머신은 덜 돌므로 **덜 먹고 덜 낸다** — 전속력 수요를 그대로 쓰면 벨트도 팔도
  // 과하게 잡힌다. (speedFraction 미지정=1 → 옛 동작.)
  const crafts = (machineCount * params.craftingSpeed * (params.speedFraction ?? 1)) / craftTime(recipe);
  if (role === "output") {
    const p = recipe.products.find((x) => x.name === name);
    if (!p) return 0; // 이 줄은 이 레시피의 산출이 아니다 = 진짜 0.
    const y = productYield(p);
    return y === undefined ? undefined : crafts * y * params.productivityMultiplier;
  }
  const ing = recipe.ingredients.find((x) => x.name === name);
  return ing ? crafts * ing.amount : 0;
}

/**
 * 머신 N대의 초당 제작 횟수 (productivity 는 횟수가 아닌 산출량에만 영향).
 *
 * **굶는 머신은 덜 돌므로 덜 만든다** — `speedFraction` 을 곱해야 한다(미지정=1).
 * 안 곱하면 `buildThroughput` 이 자식에게 **안 먹을 양을 요구**해 자식 머신이 과잉으로
 * 놓인다: 80%로 도는 부모 10대의 실제 제작은 8대분인데 10대분을 내려보내게 된다.
 * (2026-07-17 발견 — 바로 위 `clusterLineRate` 는 같은 값을 곱하고 있었다.)
 */
function craftsPerSec(
  recipe: Recipe,
  machineCount: number,
  params: NodeMachineParams,
): number {
  return (
    (machineCount * params.craftingSpeed * (params.speedFraction ?? 1)) / craftTime(recipe)
  );
}

/** 요구 산출 rate(items/sec)를 만족하는 최소 머신 수. 비-외부 노드는 최소 1대. */
function countForDemand(
  node: RecipeTreeNode,
  demandItemsPerSec: number,
  recipeMap: Map<string, Recipe>,
  lookup: MachineParamsLookup,
): number {
  if (node.external || !node.recipeName) return 0;
  const recipe = recipeMap.get(node.recipeName);
  const params = lookup(node.recipeName);
  // 레시피/머신 정보가 없으면 안전하게 1대 — 위저드가 머신 미매칭을 별도로 보고한다.
  if (!recipe || !params) return 1;
  const per = perMachineItemsPerSec(recipe, node.itemName, params);
  // 수량 미상(undefined)도 "정보 없음" — 위 `!recipe || !params` 와 같이 안전하게 1대.
  // (`per <= 0` 만 보면 undefined 가 비교를 통과해 Math.ceil(d/undefined) = NaN 이 된다.)
  if (per === undefined || per <= 0) return 1;
  return Math.max(1, Math.ceil(demandItemsPerSec / per));
}

/** 머신 수가 결정된 노드의 자식 demand 를 계산해 재귀적으로 카운트 배정 */
function buildThroughput(
  node: RecipeTreeNode,
  machineCount: number,
  recipeMap: Map<string, Recipe>,
  lookup: MachineParamsLookup,
): RecipeTreeNode {
  if (node.external || !node.recipeName) {
    return {
      ...node,
      machineCount: 0,
      children: node.children.map((c) =>
        buildThroughput(c, 0, recipeMap, lookup),
      ),
    };
  }

  const recipe = recipeMap.get(node.recipeName);
  const params = lookup(node.recipeName);
  const crafts =
    recipe && params ? craftsPerSec(recipe, machineCount, params) : 0;

  const children = node.children.map((child) => {
    const ingredient = recipe?.ingredients.find(
      (i) => i.name === child.itemName,
    );
    // 이 부모가 child.itemName 을 초당 소비하는 양 = 제작 횟수 × ingredient.amount
    const demand = crafts * (ingredient?.amount ?? 0);
    const childCount = countForDemand(child, demand, recipeMap, lookup);
    return buildThroughput(child, childCount, recipeMap, lookup);
  });

  return { ...node, machineCount, children };
}

/**
 * '처리량' 모드: 루트가 `targetItemsPerSec` 개/초를 산출하도록 머신 수를 정하고,
 * 각 자식의 머신 수를 부모의 요구 처리량을 채우도록 위에서 아래로 비례 배정한다.
 *
 * - 분수 머신 수는 올림(ceil) → 모든 라인이 완전 공급(약간의 과잉 생산 허용).
 * - 확률성/다중 산출물은 기대 수율(amount × probability)로 계산.
 * - 모듈은 v1 에서 미반영(`lookup` 이 base crafting_speed, productivityMultiplier=1 반환).
 *   `lookup` 이 모듈 반영 파라미터를 주면 알고리즘 수정 없이 모듈이 적용된다.
 *
 * 트리를 in-place 로 수정하지 않고 동일 모양의 새 트리를 반환.
 */
export function assignThroughputCounts(
  root: RecipeTreeNode,
  targetItemsPerSec: number,
  recipeMap: Map<string, Recipe>,
  lookup: MachineParamsLookup,
): RecipeTreeNode {
  const rootCount = countForDemand(root, targetItemsPerSec, recipeMap, lookup);
  return buildThroughput(root, rootCount, recipeMap, lookup);
}

