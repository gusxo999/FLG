import type { Recipe } from '../../store/gameDataStore';
import type { RecipeTreeNode } from './types';

interface ExpandContext {
  recipeMap: Map<string, Recipe>;
  itemToRecipe: Map<string, string>;
  externalIngredients: ReadonlySet<string>;
  /** 사이클 차단을 위해 현재 선조 경로의 레시피 이름들 */
  ancestors: Set<string>;
}

/**
 * 타깃 레시피를 루트로, 모든 ingredient → 그 ingredient 를 만드는 첫 매칭 레시피를 자식으로 펼친다.
 * external 로 토글된 ingredient 는 leaf 로만 기록 (그 자식 펼침 X).
 * 사이클(직간접 자기 참조)은 자식 무시.
 */
export function expandRecipeTree(
  targetRecipe: string,
  recipeMap: Map<string, Recipe>,
  itemToRecipe: Map<string, string>,
  externalIngredients: ReadonlySet<string>,
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

  const recipeName = ctx.itemToRecipe.get(itemName);
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

interface RatioContext {
  recipeMap: Map<string, Recipe>;
  /** itemName → 이 라인이 1초당 필요한 양 (ingredients amount × 부모 처리량으로 누적) */
  needPerSec: Map<string, number>;
  /** 머신당 처리 속도 — 호출자 책임으로 전달. 카테고리 매칭 후 결정된 첫 머신의 crafting_speed 사용 */
  craftingSpeedFor: (recipeName: string) => number | undefined;
}

/**
 * 사용자 지정 모드: 타깃 레시피의 머신 N대 → 처리량 → 자식 ingredient 처리량 → 자식 머신 수.
 *
 * 반환된 트리의 machineCount 는 ceil(처리량/머신당속도) 로 산정. 외부/매칭 실패 노드는 0.
 */
export function assignProportionalCounts(
  root: RecipeTreeNode,
  perTargetMachines: number,
  recipeMap: Map<string, Recipe>,
  craftingSpeedFor: (recipeName: string) => number | undefined,
): RecipeTreeNode {
  // 첫째 패스: 각 노드의 "초당 산출이 얼마나 필요한가" 누적
  const needPerSec = new Map<string, number>();
  const ctx: RatioContext = { recipeMap, needPerSec, craftingSpeedFor };

  const rootRecipe = root.recipeName ? recipeMap.get(root.recipeName) : undefined;
  if (!rootRecipe || !root.recipeName) return assignMinimumCounts(root);

  const rootSpeed = craftingSpeedFor(root.recipeName) ?? 1;
  const rootProduct = rootRecipe.products[0];
  const productPerSec = rootProduct
    ? perTargetMachines *
      (rootSpeed / Math.max(rootRecipe.energy_required, 0.0001)) *
      rootProduct.amount
    : perTargetMachines;
  needPerSec.set(rootProduct?.name ?? root.itemName, productPerSec);

  return walkProportional(root, productPerSec, ctx);
}

function walkProportional(
  node: RecipeTreeNode,
  outputPerSec: number,
  ctx: RatioContext,
): RecipeTreeNode {
  if (node.external || !node.recipeName) {
    return { ...node, machineCount: 0, children: [] };
  }
  const recipe = ctx.recipeMap.get(node.recipeName);
  if (!recipe) return { ...node, machineCount: 0, children: [] };

  const speed = ctx.craftingSpeedFor(node.recipeName) ?? 1;
  const product = recipe.products[0];
  const ratePerMachine = product
    ? (speed / Math.max(recipe.energy_required, 0.0001)) * product.amount
    : speed;
  const machineCount = Math.max(1, Math.ceil(outputPerSec / Math.max(ratePerMachine, 0.0001)));

  const children = recipe.ingredients.map((ing) => {
    const childNode = node.children.find((c) => c.itemName === ing.name);
    if (!childNode) {
      return {
        recipeName: undefined,
        itemName: ing.name,
        external: true,
        children: [],
        machineCount: 0,
      } satisfies RecipeTreeNode;
    }
    if (childNode.external) {
      return { ...childNode, children: [], machineCount: 0 };
    }
    const ratio = product ? ing.amount / product.amount : ing.amount;
    const required = outputPerSec * ratio;
    return walkProportional(childNode, required, ctx);
  });

  return { ...node, machineCount, children };
}
