import type { GridCell } from '../../types/layout';
import type { Recipe } from '../../store/gameDataStore';

/**
 * 그리드에 적용할 좌표 + 셀 페어. caller 가 (x, y) 로 layoutStore 에 직접 쓴다.
 */
export interface PlacedCell {
  x: number;
  y: number;
  cell: GridCell;
}

/**
 * 레시피에 fluid ingredient 또는 fluid product 가 하나라도 있는지.
 * 12-슬롯 모델은 fluid 라인을 다루지 않으므로 fluid 레시피는 머신만 배치되고 warning 이 발행된다.
 */
export function recipeHasFluid(recipe: Recipe | undefined): boolean {
  if (!recipe) return false;
  return (
    recipe.ingredients.some((i) => i.type === 'fluid') ||
    recipe.products.some((p) => p.type === 'fluid')
  );
}
