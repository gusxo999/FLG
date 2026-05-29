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

