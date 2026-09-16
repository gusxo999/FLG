import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { t } from '../i18n/index';

import type { Entity, GameData, Machine, Module, Recipe, Technology } from '../../types/gameData';
// 게임데이터 **형식**은 `src/types/gameData.ts` 에 산다 — 여기서는 재수출만 한다(읽는 쪽 무수정).
export { productYield } from '../../types/gameData';
export type {
  CollisionBox, Entity, FluidBoxInfo, GameData, Machine, Module, ModuleEffects, PipeConnection, Recipe,
  RecipeIngredient, RecipeProduct, SurfaceCondition, Technology, Vec2,
} from '../../types/gameData';

function isMachine(e: Entity): e is Machine {
  return !!e.crafting_categories && typeof e.crafting_speed === 'number';
}

interface GameDataState {
  recipes: Recipe[];
  entities: Entity[];
  modules: Module[];
  technologies: Technology[];
  /** crafting 가능한 entities의 파생 뷰 */
  machines: Machine[];
  /** recipe.name → Recipe */
  recipeMap: Map<string, Recipe>;
  /** entity.name → Entity (모든 엔티티) */
  entityMap: Map<string, Entity>;
  /** machine.name → Machine (crafting 가능만) */
  machineMap: Map<string, Machine>;
  /** module.name → Module */
  moduleMap: Map<string, Module>;
  /** tech.name → Technology */
  techMap: Map<string, Technology>;
  /**
   * recipe.name → 그 레시피를 unlock-recipe 로 가지는 기술의 이름.
   * 일반적으로 1:1 이지만 동일 레시피를 여러 기술이 언록하는 모드도 있어 첫 매칭만 보존.
   * 매핑이 없는 레시피는 기본 가용(처음부터 활성)으로 간주한다.
   */
  recipeToTech: Map<string, string>;
  /**
   * 산출물 이름 → 그것을 products 로 만드는 첫 레시피의 이름. **아이템과 유체 모두** 담는다.
   * 쓰이는 곳 ①: 머신 entity → items_to_place_this[0] → 이 인덱스 → 레시피 → 기술 체인.
   * 쓰이는 곳 ②: 레시피 트리 확장(`expandIngredient`) — 여기 없는 이름은 **external 로 확정**된다.
   */
  itemToRecipe: Map<string, string>;
  /**
   * 산출물 이름 → 그것을 만드는 모든 '선택 가능한' 레시피 이름 배열. **아이템과 유체 모두.**
   * 배열 [0] 은 itemToRecipe 의 기본값과 동일(첫 매칭). 길이가 2 이상이면 대체 제작법이 존재.
   * 레시피 트리에서 사용자가 하위 아이템의 제작법을 직접 고를 때 후보 목록으로 쓴다.
   */
  recipesByProduct: Map<string, string[]>;
  loaded: boolean;
  storageWarning: string | null;

  setGameData: (data: GameData) => void;
  reset: () => void;

  getMachinesForCategory: (category: string) => Machine[];
  getMachinesForRecipe: (recipeName: string) => Machine[];
  /** 특정 type의 엔티티들 (e.g. "transport-belt", "inserter") */
  getEntitiesByType: (type: string) => Entity[];
  /**
   * 엔티티/레시피 양쪽의 화이트리스트를 모두 만족하는 모듈만 반환.
   * recipeName이 주어지면 레시피 단위 allowed_module_categories도 추가 제약.
   */
  getModulesAllowedFor: (entityName: string, recipeName?: string) => Module[];

  /**
   * 레시피 이름 → 그 레시피를 직접 언록하는 기술 이름 (없으면 undefined = 기본 활성).
   */
  getTechForRecipe: (recipeName: string) => string | undefined;
  /**
   * 머신(엔티티) 이름 → 그 머신을 언록하는 기술 이름.
   * items_to_place_this[0] → itemToRecipe → recipeToTech 의 체인을 따라간다.
   * 어느 단계든 끊기면 undefined (= 기본 활성으로 간주).
   */
  getTechForMachine: (entityName: string) => string | undefined;
  /**
   * 머신/레시피 입력 집합으로부터 "이게 모두 사용 가능하다" 라고 가정하기 위해 연구되어 있어야 할
   * 기술 이름 집합 (자기 자신 + transitive prereq, 기본 활성 기술 제외).
   */
  resolveRequiredTechs: (input: { machines?: string[]; recipes?: string[] }) => Set<string>;
}

/** 원본 게임데이터 → 조회용 파생 인덱스. (export 는 테스트용 — 스토어 밖에서 쓰지 말 것) */
export function buildDerived(data: GameData) {
  const recipeMap = new Map<string, Recipe>();
  for (const r of data.recipes) recipeMap.set(r.name, r);

  const entityMap = new Map<string, Entity>();
  for (const e of data.entities) entityMap.set(e.name, e);

  const machines = data.entities.filter(isMachine);
  const machineMap = new Map<string, Machine>();
  for (const m of machines) machineMap.set(m.name, m);

  const modules = data.modules ?? [];
  const moduleMap = new Map<string, Module>();
  for (const m of modules) moduleMap.set(m.name, m);

  const technologies = data.technologies ?? [];
  const techMap = new Map<string, Technology>();
  for (const t of technologies) techMap.set(t.name, t);

  // recipe.name → 그것을 unlock 하는 첫 번째 기술. 동일 레시피를 여러 기술이
  // 언록하는 모드에서는 후속 기술을 무시 (= 더 이른 prerequisite 체인을 따라가게 됨).
  const recipeToTech = new Map<string, string>();
  for (const tech of technologies) {
    for (const recipeName of tech.unlock_recipes) {
      if (!recipeToTech.has(recipeName)) recipeToTech.set(recipeName, tech.name);
    }
  }

  // 플레이어가 실제로 선택 가능한 레시피인지 판별.
  // enabled === true 면 시작부터 활성, 그 외에는 어떤 기술이든 unlock 해야 선택 가능.
  // 둘 다 아니면 (예: vanilla 'glass' 4 모래→1 유리처럼 모드가 비활성화하고 어떤 기술도
  // 해금하지 않는 레시피) 플레이어가 영영 만들 수 없으므로 자동완성 후보에서 제외한다.
  const isRecipeSelectable = (r: Recipe): boolean =>
    r.enabled === true || recipeToTech.has(r.name);

  // 산출물 이름 → 그것을 만드는 첫 '선택 가능한' 레시피 / 그 모든 레시피(등장 순서 유지).
  // recipes 배열 순서대로 push 하므로 recipesByProduct[0] 은 itemToRecipe 의 기본 매칭과 일치한다.
  // 쓰이는 곳은 둘: ① 머신 entity → items_to_place_this[0] → 이 인덱스 → 레시피 → 기술 추적,
  // ② 레시피 트리 확장(expandIngredient)과 대체 제작법 후보.
  //
  // **유체도 담는다.** 한때 `p.type !== 'item'` 로 유체 산출물을 버렸는데, 그 필터는 ① 의
  // 전제("머신은 아이템이다")에서 나온 것이라 ② 에는 맞지 않았다. 결과로 유체가 트리에서
  // **무조건 external** 이 되어 "자식이 유체를 만들어 부모가 쓰는" 트리를 만들 수 없었다
  // (2026-07-16 실측에서 발견 — 유체 납품 경로 코드 전체가 도달 불가였다).
  // 개발자용·미해금 레시피 제외는 위 `isRecipeSelectable` 이 이미 담당한다(그쪽이 의도한 필터).
  //
  // 유체를 담으면 물 같은 1차 자원이 기본 '자체 생산'으로 펼쳐진다. 그건 **의도된 것**이다 —
  // 무엇이 1차 자원인지는 데이터가 모른다(iron-ore 도 kr-crush-iron-ore 로 만들 수 있다).
  // 1차 자원 선정은 사용자가 트리에서 external 로 토글해 정한다(유체도 철광석과 동등하게).
  const itemToRecipe = new Map<string, string>();
  const recipesByProduct = new Map<string, string[]>();
  for (const r of data.recipes) {
    if (!isRecipeSelectable(r)) continue;
    for (const p of r.products) {
      if (!itemToRecipe.has(p.name)) itemToRecipe.set(p.name, r.name);
      const list = recipesByProduct.get(p.name);
      if (list) {
        if (!list.includes(r.name)) list.push(r.name);
      } else {
        recipesByProduct.set(p.name, [r.name]);
      }
    }
  }

  return {
    recipeMap,
    entityMap,
    machines,
    machineMap,
    modules,
    moduleMap,
    technologies,
    techMap,
    recipeToTech,
    itemToRecipe,
    recipesByProduct,
  };
}

/**
 * 저장 실패를 사용자에게 알리는 중인가.
 *
 * **없으면 무한 재귀로 앱이 죽는다.** persist 는 `setState` 가 일어날 때마다 저장을 시도한다.
 * 그래서 저장 실패 → `setState({storageWarning})` → **또 저장 시도** → 또 실패 → … 가 된다.
 * `partialize` 가 storageWarning 을 저장 대상에서 빼고 있어도 소용없다 — 문제는 저장 **내용**이
 * 아니라 저장 **시도** 자체이기 때문이다. 하필 "용량이 초과됐다" 고 알리려다 스택을 터뜨렸다.
 */
let reportingStorageFailure = false;

const safeStorage = createJSONStorage(() => ({
  getItem: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    // 경고를 세팅하는 도중 persist 가 다시 부른 저장 → 무시한다(어차피 또 실패한다).
    if (reportingStorageFailure) return;
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      reportingStorageFailure = true;
      try {
        useGameDataStore.setState({
          storageWarning: t('errors.storageQuotaExceeded', { message: (e as Error).message }),
        });
      } finally {
        reportingStorageFailure = false;
      }
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
}));

export const useGameDataStore = create<GameDataState>()(
  persist(
    (set, get) => ({
      recipes: [],
      entities: [],
      modules: [],
      technologies: [],
      machines: [],
      recipeMap: new Map<string, Recipe>(),
      entityMap: new Map<string, Entity>(),
      machineMap: new Map<string, Machine>(),
      moduleMap: new Map<string, Module>(),
      techMap: new Map<string, Technology>(),
      recipeToTech: new Map<string, string>(),
      itemToRecipe: new Map<string, string>(),
      recipesByProduct: new Map<string, string[]>(),
      loaded: false,
      storageWarning: null,

      setGameData: (data: GameData) => {
        const derived = buildDerived(data);
        set({
          recipes: data.recipes,
          entities: data.entities,
          modules: derived.modules,
          technologies: derived.technologies,
          machines: derived.machines,
          recipeMap: derived.recipeMap,
          entityMap: derived.entityMap,
          machineMap: derived.machineMap,
          moduleMap: derived.moduleMap,
          techMap: derived.techMap,
          recipeToTech: derived.recipeToTech,
          itemToRecipe: derived.itemToRecipe,
          recipesByProduct: derived.recipesByProduct,
          loaded: true,
          storageWarning: null,
        });
      },

      reset: () =>
        set({
          recipes: [],
          entities: [],
          modules: [],
          technologies: [],
          machines: [],
          recipeMap: new Map(),
          entityMap: new Map(),
          machineMap: new Map(),
          moduleMap: new Map(),
          techMap: new Map(),
          recipeToTech: new Map(),
          itemToRecipe: new Map(),
          recipesByProduct: new Map(),
          loaded: false,
          storageWarning: null,
        }),

      getMachinesForCategory: (category: string) =>
        get().machines.filter((m) => m.crafting_categories.includes(category)),

      getMachinesForRecipe: (recipeName: string) => {
        const recipe = get().recipeMap.get(recipeName);
        if (!recipe) return [];
        return get().getMachinesForCategory(recipe.category);
      },

      getEntitiesByType: (type: string) =>
        get().entities.filter((e) => e.type === type),

      getModulesAllowedFor: (entityName: string, recipeName?: string) => {
        const entity = get().entityMap.get(entityName);
        const allModules = get().modules;
        if (!entity) return allModules;

        // 1) entity.allowed_module_categories — 머신 단위 카테고리 화이트리스트
        const entCats = entity.allowed_module_categories;
        const entCatSet = entCats && entCats.length > 0 ? new Set(entCats) : null;

        // 2) recipe.allowed_module_categories — 레시피 단위 화이트리스트 (있으면 추가 제약)
        const recipe = recipeName ? get().recipeMap.get(recipeName) : undefined;
        const recCats = recipe?.allowed_module_categories;
        const recCatSet = recCats && recCats.length > 0 ? new Set(recCats) : null;

        // 3) entity.allowed_effects — 모듈이 가진 effect 키들이 모두 머신 허용 효과 안에 들어와야 함.
        // 게임 UI 의 "효율성(Efficiency)" 모듈은 module.category="effectivity" 이지만
        // 실제 effects 키는 "consumption" — 따라서 effects 가 있을 때만 effects 키로 검사하고,
        // 없을 때(legacy export) 는 category 와 effects-key 매핑을 통해 보존한다.
        const allowedEffects = entity.allowed_effects;
        const effectSet = allowedEffects && allowedEffects.length > 0 ? new Set(allowedEffects) : null;

        // legacy fallback: module.category → 실제 effect key.
        // "effectivity" 는 consumption 음수값이므로 consumption 으로 매핑.
        const CATEGORY_TO_EFFECT_KEY: Record<string, string> = {
          speed: 'speed',
          productivity: 'productivity',
          consumption: 'consumption',
          effectivity: 'consumption',
          pollution: 'pollution',
          quality: 'quality',
        };

        return allModules.filter((m) => {
          // 카테고리 화이트리스트
          if (entCatSet && (!m.category || !entCatSet.has(m.category))) return false;
          if (recCatSet && (!m.category || !recCatSet.has(m.category))) return false;
          if (!effectSet) return true;

          if (m.effects && Object.keys(m.effects).length > 0) {
            // 모든 비-zero 효과 키가 entity.allowed_effects 안에 들어와야 함
            for (const key of Object.keys(m.effects)) {
              const v = (m.effects as Record<string, number | undefined>)[key];
              if (v === undefined || v === 0) continue;
              if (!effectSet.has(key)) return false;
            }
            return true;
          }
          // legacy: effects 데이터가 없을 때 — category 를 effect-key 로 매핑해 검사
          if (m.category) {
            const effectKey = CATEGORY_TO_EFFECT_KEY[m.category] ?? m.category;
            if (!effectSet.has(effectKey)) return false;
          }
          return true;
        });
      },

      getTechForRecipe: (recipeName: string) => get().recipeToTech.get(recipeName),

      getTechForMachine: (entityName: string) => {
        const entity = get().entityMap.get(entityName);
        if (!entity) return undefined;
        const items = entity.items_to_place_this;
        if (!items || items.length === 0) return undefined;
        // 첫 placement 아이템의 제조 레시피를 따라간다.
        // 동일 머신을 여러 아이템이 설치하는 케이스(드뭄)는 첫 매칭만 고려.
        const itemToRecipe = get().itemToRecipe;
        const recipeToTech = get().recipeToTech;
        for (const itemName of items) {
          const recipeName = itemToRecipe.get(itemName);
          if (!recipeName) continue;
          const techName = recipeToTech.get(recipeName);
          if (techName) return techName;
        }
        return undefined;
      },

      resolveRequiredTechs: (input) => {
        const out = new Set<string>();
        const techMap = get().techMap;
        const recipeToTech = get().recipeToTech;
        const getTechForMachine = get().getTechForMachine;

        // 처음부터 활성(enabled === true)인 기술은 "별도 연구 필요 없음" 으로 간주.
        // 단, 여전히 그 기술 이름은 결과 set 에서 제외 (= 호출자 입장에서는 자유 활성).
        const isFreelyEnabled = (name: string) => techMap.get(name)?.enabled === true;

        const seedTechs: string[] = [];
        if (input.recipes) {
          for (const r of input.recipes) {
            const t = recipeToTech.get(r);
            if (t) seedTechs.push(t);
          }
        }
        if (input.machines) {
          for (const m of input.machines) {
            const t = getTechForMachine(m);
            if (t) seedTechs.push(t);
          }
        }

        const stack = [...seedTechs];
        while (stack.length > 0) {
          const cur = stack.pop()!;
          if (out.has(cur)) continue;
          if (isFreelyEnabled(cur)) continue;
          out.add(cur);
          const tech = techMap.get(cur);
          if (!tech) continue;
          for (const p of tech.prerequisites) {
            if (!out.has(p) && !isFreelyEnabled(p)) stack.push(p);
          }
        }
        return out;
      },
    }),
    {
      name: 'factorio-game-data',
      storage: safeStorage,
      partialize: (state) => ({
        recipes: state.recipes,
        entities: state.entities,
        modules: state.modules,
        technologies: state.technologies,
        loaded: state.loaded,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && state.entities && state.entities.length > 0) {
          const derived = buildDerived({
            recipes: state.recipes,
            entities: state.entities,
            modules: state.modules,
            technologies: state.technologies,
          });
          state.recipeMap = derived.recipeMap;
          state.entityMap = derived.entityMap;
          state.machines = derived.machines;
          state.machineMap = derived.machineMap;
          state.modules = derived.modules;
          state.moduleMap = derived.moduleMap;
          state.technologies = derived.technologies;
          state.techMap = derived.techMap;
          state.recipeToTech = derived.recipeToTech;
          state.itemToRecipe = derived.itemToRecipe;
          state.recipesByProduct = derived.recipesByProduct;
        }
      },
    }
  )
);
