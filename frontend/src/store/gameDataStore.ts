import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { t } from '../i18n';

export interface RecipeIngredient {
  name: string;
  amount: number;
  type: 'item' | 'fluid';
}

export interface RecipeProduct {
  name: string;
  amount: number;
  probability?: number;
  type: 'item' | 'fluid';
}

/**
 * 표면 조건 (Space Age). 어떤 표면(행성/플랫폼)에서 설치/제작 가능한지 결정.
 * property 예시: "pressure" (Vulcanus 4000, Nauvis 1000, 우주 0),
 *               "gravity" (Aquilo 0.1, Nauvis 1, ...),
 *               "magnetic-field", "solar-power", ...
 * min/max 둘 다 optional. 모두 만족해야 설치 가능.
 */
export interface SurfaceCondition {
  property: string;
  min?: number;
  max?: number;
}

export interface Recipe {
  id: number;
  name: string;
  localised_name: string;
  category: string;
  energy_required: number;
  ingredients: RecipeIngredient[];
  products: RecipeProduct[];
  icon?: string;
  /** 이 레시피가 허용하는 모듈 카테고리 화이트리스트. nil이면 머신 측 화이트리스트만 적용. */
  allowed_module_categories?: string[];
  /** 이 레시피를 만들 수 있는 표면 조건. nil이면 모든 표면. */
  surface_conditions?: SurfaceCondition[];
}

/**
 * 모듈 아이템 (LuaItemPrototype 중 module_effects가 있는 것).
 * 자동완성 / 모듈 셀렉터 UI 에서 사용.
 */
export interface ModuleEffects {
  /** crafting_speed 비율 보너스 (예: +0.5 = +50%) */
  speed?: number;
  /** 추가 산출물 비율 (예: +0.1 = +10%) */
  productivity?: number;
  /** energy_usage 비율 보너스 (음수면 절감, 양수면 증가). 게임 UI의 "효율성" = consumption 의 음수값 */
  consumption?: number;
  /** 오염 배출 비율 보너스 */
  pollution?: number;
  /** 품질 산출 보너스 */
  quality?: number;
}

export interface Module {
  name: string;
  /** "speed" | "productivity" | "effectivity" | "quality" 등 */
  category?: string;
  /** 1, 2, 3 (vanilla 기준) */
  tier?: number;
  localised_name?: string;
  /** module_effects 비율값들. 게임 UI의 "효율성" 모듈은 consumption < 0 으로 표현됨. */
  effects?: ModuleEffects;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface CollisionBox {
  lt: Vec2;
  rb: Vec2;
}

/**
 * 단일 파이프 연결점 정의.
 * positions 배열은 4방향 회전(N/E/S/W) 각각에 대한 엔티티 중심 기준 상대 좌표.
 */
export interface PipeConnection {
  /** 4방향 회전별 좌표 (보통 길이 4) */
  positions: Vec2[];
  /** "input" | "output" | "input-output" */
  flow_direction?: string;
  /** "normal" | "underground" | "linked" */
  connection_type?: string;
  /** underground 연결일 때만 */
  max_underground_distance?: number;
}

/**
 * 엔티티가 가진 유체 상자. 한 엔티티는 여러 fluid_box를 가질 수 있음.
 * (예: Boiler는 물 입력 1 + 증기 출력 1)
 */
export interface FluidBoxInfo {
  index: number;
  /** "input" | "output" | "input-output" | "none" */
  production_type?: string;
  /** 저장 용량 (FluidAmount) */
  volume?: number;
  /** 고정 필터 (해당 fluidbox가 특정 유체만 받을 때) */
  filter?: string;
  connections: PipeConnection[];
}

/**
 * 모든 팩토리오 엔티티 프로토타입을 표현.
 * 타입별로 사용되는 필드가 다르므로 대부분 optional.
 */
export interface Entity {
  id: number;
  name: string;
  localised_name: string;
  type: string;
  tile_width: number;
  tile_height: number;
  collision_box?: CollisionBox;

  // CraftingMachine (assembling-machine, furnace, rocket-silo)
  crafting_speed?: number;
  crafting_categories?: string[];
  module_slots?: number;
  allowed_effects?: string[];
  /**
   * 이 머신에 장착할 수 있는 모듈 카테고리 화이트리스트.
   * nil/빈 배열이면 별도 제약 없음 (allowed_effects만 적용).
   * 예: 일부 머신은 ["speed", "consumption"] 만 허용 → productivity 모듈 거부.
   */
  allowed_module_categories?: string[];

  /**
   * 이 엔티티를 설치할 수 있는 표면 조건 (Space Age).
   * nil/빈 배열이면 모든 표면 허용. 모든 조건을 동시에 만족해야 설치 가능.
   */
  surface_conditions?: SurfaceCondition[];

  // Lab
  lab_inputs?: string[];
  researching_speed?: number;

  // MiningDrill
  mining_speed?: number;
  resource_categories?: string[];
  /** 채굴물 드롭 위치 (엔티티 중심 기준, direction=N 기준) */
  vector_to_place_result?: Vec2;
  /** 자원 탐색 반경 */
  resource_searching_radius?: number;

  // Belt 계열
  belt_speed?: number;
  max_underground_distance?: number;

  // Inserter
  inserter_pickup_position?: Vec2;
  inserter_drop_position?: Vec2;
  inserter_extension_speed?: number;
  inserter_rotation_speed?: number;

  // Pump
  pumping_speed?: number;

  // 전력
  supply_area_distance?: number;
  max_wire_distance?: number;
  max_power_output?: number;
  fluid_usage_per_tick?: number;
  target_temperature?: number;

  // Beacon
  distribution_effectivity?: number;

  // Roboport
  logistic_radius?: number;
  construction_radius?: number;

  // Container
  inventory_size?: number;

  // 공통 (필요 엔티티만)
  /** 작동 중 소비 (J/tick). 게임 표시 W = energy_usage × 60 */
  energy_usage?: number;
  /** 대기 중 상시 소비 (J/tick). 게임 툴팁의 "Min. Consumption". */
  energy_drain?: number;

  /** 유체 연결점 정보 (pipe, pump, boiler, generator, fluid-using crafter 등) */
  fluid_boxes?: FluidBoxInfo[];

  /**
   * 이 엔티티를 설치하는 아이템 이름들 (LuaEntityPrototype.items_to_place_this).
   * 보통 한 개. 이 아이템을 만드는 레시피를 거꾸로 찾아 → 그 레시피를 unlock-recipe 로
   * 가지는 technology 를 추적하면 머신을 언록하는 기술 체인을 얻을 수 있다.
   */
  items_to_place_this?: string[];

  icon?: string;
}

/**
 * 기술(연구) 노드. unlock_recipes 와 prerequisites 만 데이터 필요.
 * Sidebar / 자동완성에서 "사용자가 선택한 머신/레시피로부터 필요한 모든 선행 연구 집합" 을
 * 계산하기 위한 그래프 정보.
 */
export interface Technology {
  name: string;
  /** 선행 기술 이름 배열. */
  prerequisites: string[];
  /** 이 기술이 unlock-recipe 로 해금하는 레시피 이름 배열. */
  unlock_recipes: string[];
  /** 게임 시작 시 활성. true 면 별도 연구 없이 사용 가능. */
  enabled?: boolean;
  /** 핵심(축약) 트리에 표시되는 기술. */
  essential?: boolean;
  /** 비활성 상태에서도 UI에 노출되는지. */
  visible_when_disabled?: boolean;
  /** 무한 연구 / 단계별 업그레이드 표시. */
  upgrade?: boolean;
  /** 최대 레벨 (무한 연구는 매우 큼). */
  max_level?: number;
}

/**
 * Crafting 가능한 엔티티만 골라내는 파생 뷰.
 * Sidebar의 Machines 탭 등에서 사용.
 */
export type Machine = Entity & {
  crafting_speed: number;
  crafting_categories: string[];
};

export interface GameData {
  recipes: Recipe[];
  entities: Entity[];
  modules?: Module[];
  technologies?: Technology[];
}

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
   * item.name → 그 아이템을 products 로 만드는 첫 레시피의 이름.
   * 머신 entity → items_to_place_this[0] → 이 인덱스 → 레시피 → 기술 체인을 얻는다.
   */
  itemToRecipe: Map<string, string>;
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
   * 한 기술과 그 모든 선행 기술의 집합 (transitive closure).
   * 사이클이 있더라도 안전하게 종료.
   */
  resolvePrerequisites: (techName: string) => Set<string>;
  /**
   * 머신/레시피 입력 집합으로부터 "이게 모두 사용 가능하다" 라고 가정하기 위해 연구되어 있어야 할
   * 기술 이름 집합 (자기 자신 + transitive prereq, 기본 활성 기술 제외).
   */
  resolveRequiredTechs: (input: { machines?: string[]; recipes?: string[] }) => Set<string>;
}

function buildDerived(data: GameData) {
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

  // item.name → 그 아이템을 products 에 포함하는 첫 레시피.
  // 머신 entity → items_to_place_this[0] → 이 인덱스로 → 레시피 → 기술 추적.
  const itemToRecipe = new Map<string, string>();
  for (const r of data.recipes) {
    for (const p of r.products) {
      if (p.type === 'item' && !itemToRecipe.has(p.name)) {
        itemToRecipe.set(p.name, r.name);
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
  };
}

const safeStorage = createJSONStorage(() => ({
  getItem: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      useGameDataStore.setState({
        storageWarning: t('errors.storageQuotaExceeded', { message: (e as Error).message }),
      });
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

      resolvePrerequisites: (techName: string) => {
        const techMap = get().techMap;
        const out = new Set<string>();
        const stack: string[] = [techName];
        while (stack.length > 0) {
          const cur = stack.pop()!;
          const tech = techMap.get(cur);
          if (!tech) continue;
          for (const p of tech.prerequisites) {
            if (out.has(p)) continue;
            out.add(p);
            stack.push(p);
          }
        }
        return out;
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
        }
      },
    }
  )
);
