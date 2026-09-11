/**
 * customDataStore — 커스텀 레시피/머신의 **원천**(spec)을 들고 있는다.
 *
 * ## 왜 게임데이터에 바로 안 넣고 그릇을 따로 두나
 *
 * 넣기만 하면 되는 것처럼 보인다 — `gameDataStore` 가 이미 `recipes`·`entities` 를
 * localStorage 에 저장하므로 세션도 넘는다. 그런데 둘이 안 된다:
 *
 * ```
 * 파일을 새로 올리면          setGameData 가 배열을 통째로 갈아 끼운다 → 커스텀이 사라진다
 * 무엇이 커스텀인지 모르면     골라 지울 수도, 편집기로 다시 열 수도 없다
 * ```
 *
 * 그래서 **원천은 여기, 파생은 게임데이터**다. `Recipe.custom`/`Entity.custom` 표시가 둘을
 * 잇는다 — 합류할 때 그 표시를 가진 것만 걷어내고 새로 넣는다.
 *
 * 반대 안(소비처마다 병합)을 안 고른 이유는 docs/factorio/custom-recipe.md §3 에 있다. 요약하면
 * `infinity-pipe` 가 이미 그 길의 대가를 보여 준다 — 프로토타입 없는 이름은 `portInference`
 * 에 특례(`synthesizeCardinalFluidPorts`)를 낳았다. 커스텀 머신은 `entityMap` 에 **진짜로**
 * 들어가야 한다.
 *
 * ## 합류는 한 함수다
 *
 * [syncCustomData] 만이 게임데이터를 건드린다. 부르는 자리가 셋이고 전부 "게임데이터가 막
 * 바뀐 직후" 다 — 커스텀 변경 · 파일 업로드 · 앱 부팅.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  compileCustomData,
  EMPTY_CUSTOM_DATA,
  type CustomDataSpec,
  type CustomMachineSpec,
  type CustomRecipeSpec,
} from '../../factorio/customRecipe';
import {
  rejectionsOf,
  validateCustomData,
  type CustomDataIssue,
  type ValidateContext,
} from '../../factorio/customRecipeValidate';
import { useGameDataStore, type Entity } from './gameDataStore';

interface CustomDataState {
  data: CustomDataSpec;

  /**
   * 들어온 머신/레시피를 **이름으로 덮어쓰며** 합친다.
   * 검증에 걸리면 **아무것도 안 바꾸고** 거절 사유를 돌려준다(빈 배열 = 성공).
   */
  merge: (incoming: Partial<CustomDataSpec>) => CustomDataIssue[];
  /** 한 벌을 통째로 교체. 가져오기(import)가 쓴다. */
  replace: (spec: CustomDataSpec) => CustomDataIssue[];
  removeMachine: (name: string) => boolean;
  removeRecipe: (name: string) => boolean;
  clear: () => void;
}

/** 이름으로 덮어쓰며 합친다 — 같은 이름이면 나중 것이 이긴다(편집 = 같은 이름 재저장). */
function upsert<T extends { name: string }>(base: readonly T[], incoming: readonly T[]): T[] {
  const out = [...base];
  for (const item of incoming) {
    const at = out.findIndex((x) => x.name === item.name);
    if (at >= 0) out[at] = item;
    else out.push(item);
  }
  return out;
}

export const useCustomDataStore = create<CustomDataState>()(
  persist(
    (set, get) => ({
      data: EMPTY_CUSTOM_DATA,

      merge: (incoming) => {
        const next: CustomDataSpec = {
          machines: upsert(get().data.machines, incoming.machines ?? []),
          recipes: upsert(get().data.recipes, incoming.recipes ?? []),
        };
        return commit(next, set);
      },

      replace: (spec) => commit(spec, set),

      removeMachine: (name) => {
        const { machines, recipes } = get().data;
        if (!machines.some((m) => m.name === name)) return false;
        set({ data: { machines: machines.filter((m) => m.name !== name), recipes } });
        syncCustomData();
        return true;
      },

      removeRecipe: (name) => {
        const { machines, recipes } = get().data;
        if (!recipes.some((r) => r.name === name)) return false;
        set({ data: { machines, recipes: recipes.filter((r) => r.name !== name) } });
        syncCustomData();
        return true;
      },

      clear: () => {
        set({ data: EMPTY_CUSTOM_DATA });
        syncCustomData();
      },
    }),
    {
      name: 'flg-custom-data',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ data: s.data }),
      /**
       * 저장된 spec 과 게임데이터가 **어긋난 채** 떠 있을 수 있다 — 한쪽 저장만 실패했거나
       * (용량 초과), 다른 탭이 게임데이터를 갈아 끼웠을 때. 부팅 때 한 번 맞춘다.
       *
       * `gameDataStore` 의 rehydrate 와 순서가 보장되지 않으므로 다음 틱으로 미룬다 —
       * 그래야 `setGameData` 가 되살아난 배열 위에서 돈다.
       */
      onRehydrateStorage: () => () => {
        setTimeout(() => syncCustomData(), 0);
      },
    },
  ),
);

/** 검증 → 통과하면 저장하고 합류. 실패면 아무것도 안 바꾼다. */
function commit(
  next: CustomDataSpec,
  set: (partial: Partial<CustomDataState>) => void,
): CustomDataIssue[] {
  const issues = validateCustomData(next, gameDataContext());
  const rejects = rejectionsOf(issues);
  if (rejects.length > 0) return rejects;
  set({ data: next });
  syncCustomData();
  return [];
}

/**
 * 현재 게임데이터로부터 검증 컨텍스트를 만든다.
 *
 * **커스텀 항목은 빼고 센다.** 안 그러면 같은 이름으로 다시 저장할 때(= 편집) 자기 자신을
 * 보고 "이미 있는 이름" 이라고 거절한다.
 */
export function gameDataContext(): ValidateContext {
  const gd = useGameDataStore.getState();
  return {
    existingRecipeNames: new Set(gd.recipes.filter((r) => !r.custom).map((r) => r.name)),
    existingEntityNames: new Set(gd.entities.filter((e) => !e.custom).map((e) => e.name)),
    gameMachinesForCategory: (category) =>
      gd.machines.filter((m) => !m.custom && m.crafting_categories.includes(category)) as Entity[],
  };
}

/**
 * **원천 → 게임데이터.** 이 함수만이 커스텀을 게임데이터에 넣는다.
 *
 * 하는 일은 둘뿐이다: 커스텀 표시가 붙은 항목을 걷어내고, 지금 spec 을 합성해 다시 넣는다.
 * `setGameData` 가 파생 인덱스(`recipeMap`·`itemToRecipe`·`machines` …)를 통째로 다시 세우므로
 * 소비처는 **아무것도 몰라도 된다** — 그게 이 설계의 요점이다.
 */
export function syncCustomData(): void {
  const gd = useGameDataStore.getState();
  const spec = useCustomDataStore.getState().data;

  const hasSpec = spec.machines.length > 0 || spec.recipes.length > 0;
  const hasStale = gd.recipes.some((r) => r.custom) || gd.entities.some((e) => e.custom);
  // 넣을 것도 걷어낼 것도 없으면 건드리지 않는다 — 부팅 때마다 저장을 다시 쓰지 않으려고.
  if (!hasSpec && !hasStale) return;

  const compiled = compileCustomData(spec);
  gd.setGameData({
    recipes: [...gd.recipes.filter((r) => !r.custom), ...compiled.recipes],
    entities: [...gd.entities.filter((e) => !e.custom), ...compiled.entities],
    modules: gd.modules,
    technologies: gd.technologies,
  });
}

/** 편집기가 기존 항목을 열 때. 없으면 undefined. */
export function findCustomMachine(name: string): CustomMachineSpec | undefined {
  return useCustomDataStore.getState().data.machines.find((m) => m.name === name);
}

export function findCustomRecipe(name: string): CustomRecipeSpec | undefined {
  return useCustomDataStore.getState().data.recipes.find((r) => r.name === name);
}
