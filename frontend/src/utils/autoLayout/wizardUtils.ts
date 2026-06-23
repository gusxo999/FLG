import { useGameDataStore } from "../../store/gameDataStore";
import type { Area, ContainerWizardInput } from "./containerModel";
import type { MachineParamsLookup } from "./recipeTree";

// ─── Area 유틸 ───────────────────────────────────────────────────────────────

export function makeEmptyArea(kind: Area["kind"]): Area {
  return { kind, containers: [], placed: [], undergroundCorridors: [] };
}

// ─── 머신 픽커 ───────────────────────────────────────────────────────────────

export function makeMachinePicker(
  input: ContainerWizardInput,
): (recipeName: string) => { name: string } | undefined {
  return (recipeName: string) => {
    const state = useGameDataStore.getState();
    const recipe = state.recipeMap.get(recipeName);
    if (!recipe) return undefined;
    for (const name of input.selectedMachines) {
      const ent = state.entityMap.get(name);
      if (ent?.crafting_categories?.includes(recipe.category)) return { name };
    }
    return undefined;
  };
}

/**
 * 처리량 카운트용 머신 파라미터 lookup. `makeMachinePicker` 와 동일하게
 * "선택된 머신 중 카테고리가 맞는 첫 머신" 을 고르고, 그 머신의 base crafting_speed 를
 * 반환한다. 모듈은 v1 미반영(productivityMultiplier=1).
 */
export function makeMachineParamsLookup(
  selectedMachines: ReadonlyArray<string>,
): MachineParamsLookup {
  return (recipeName: string) => {
    const state = useGameDataStore.getState();
    const recipe = state.recipeMap.get(recipeName);
    if (!recipe) return undefined;
    for (const name of selectedMachines) {
      const ent = state.entityMap.get(name);
      if (ent?.crafting_categories?.includes(recipe.category)) {
        return {
          craftingSpeed: ent.crafting_speed ?? 1,
          productivityMultiplier: 1,
        };
      }
    }
    return undefined;
  };
}
