/**
 * **게임데이터의 형식** — 레시피·엔티티·모듈·기술의 모양과, 그 모양에서 바로 나오는 셈 하나(`productYield`).
 *
 * 여기 사는 이유는 **읽는 쪽이 넷이고 그중 누구의 것도 아니어서**다 — UI(스토어·화면) ·
 * `factorio/`(파싱) · `analysis/` · `autoLayout/` 이 함께 읽는다. `src/types/` 의 다른 둘
 * (`layout.ts` 내부 격자 · `blueprint.ts` 블루프린트 형식)과 같은 자리다. (2026-09-14 사용자 확인)
 *
 * > **내력.** `UI/store/gameDataStore.ts` 안에 있었다. 스토어가 **그대로 재수출**하므로 UI·factorio·analysis
 * > 는 한 줄도 안 바뀌었다. 옮긴 이유는 `autoLayout/` 이 타입 하나를 가지러 UI 계층(스토어 · zustand ·
 * > i18n)을 import 하고 있었기 때문이다(계획 구조-2축 · 2 Step 2a).
 */

/**
 * 이 유체가 머신의 **몇 번째 유체 상자**로 들어가는지. **1-based** 이며 입력 상자와 출력
 * 상자를 **따로** 센다. `0`/미지정이면 그 유체는 해당 역할의 상자 **전부**에 들어갈 수 있다
 * (화학 공장이 입력 상자 2개를 갖고도 유체 하나짜리 레시피에서 양쪽 다 파이프를 받는 이유).
 * 아이템 재료엔 없는 필드. → docs/fluid-box-semantics.md
 */
type FluidBoxIndex = number;

export interface RecipeIngredient {
  name: string;
  amount: number;
  type: 'item' | 'fluid';
  fluidbox_index?: FluidBoxIndex;
}

/**
 * 산출물. 수량은 **고정 `amount`** 이거나 **범위 `amount_min`/`amount_max`** 다(예: `kr-sand`,
 * `se-core-fragment-*`). 범위형이면 `amount` 가 **없다** — 그래서 optional 이다.
 *
 * `amount` 를 직접 곱하지 말 것. `product.amount * probability` 는 범위형에서 **NaN** 이 되고,
 * 그 NaN 이 `Math.ceil` 을 지나 탭 수까지 흘러가 인서터를 **조용히 0개**로 만든다
 * (2026-07-16 발견). 수량이 필요하면 [[productYield]] 를 쓴다 — 모를 땐 `undefined` 를 내
 * 호출부가 "판정 보류" 를 고를 수 있게 한다.
 */
export interface RecipeProduct {
  name: string;
  /** 고정 수량. 범위형(`amount_min`/`amount_max`) 산출물에는 없다. */
  amount?: number;
  /** 범위 산출의 하한. `amount` 가 없을 때 `amount_max` 와 짝으로 온다. */
  amount_min?: number;
  /** 범위 산출의 상한. */
  amount_max?: number;
  probability?: number;
  type: 'item' | 'fluid';
  fluidbox_index?: FluidBoxIndex;
}

/**
 * 산출물 1회 제작당 **기대 수량** — 모르면 `undefined`.
 *
 *  - 고정 `amount` → 그대로.
 *  - 범위 `amount_min`/`amount_max` → **중앙값**(기대값).
 *  - `probability` 가 있으면 곱한다(확률 산출의 기대 수율).
 *
 * **왜 `undefined` 를 내나:** 수량을 모를 때 숫자를 지어내면 **조용히 틀린 배치**가 나온다.
 * 모른다고 말하면 호출부가 "판정 보류"(예: 탭 1개)를 고를 수 있다. 이건 이미 있던 설계다 —
 * `requiredInserterCount` 는 `rate === undefined` 면 `undefined`(판정 보류)를 낸다. 문제는 `NaN` 이
 * `undefined` 가 아니라서 그 방어를 **뚫고** 지나가 탭 수를 NaN 으로 만들었던 것이다
 * (`for (k = 0; k < NaN; k++)` → 0회 → 인서터가 조용히 사라짐).
 */
export function productYield(p: RecipeProduct): number | undefined {
  const base =
    p.amount ??
    (p.amount_min !== undefined && p.amount_max !== undefined
      ? (p.amount_min + p.amount_max) / 2
      : undefined);
  return base === undefined ? undefined : base * (p.probability ?? 1);
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
  /**
   * 게임 시작 시점부터 제작 가능(연구 불필요)한지 여부.
   * enabled === false 이고 어떤 기술도 unlock 하지 않는 레시피는
   * 플레이어가 영영 선택할 수 없으므로 자동 레이아웃 ingredient 해결에서 제외한다.
   */
  enabled?: boolean;
  /** 이 레시피가 허용하는 모듈 카테고리 화이트리스트. nil이면 머신 측 화이트리스트만 적용. */
  allowed_module_categories?: string[];
  /** 이 레시피를 만들 수 있는 표면 조건. nil이면 모든 표면. */
  surface_conditions?: SurfaceCondition[];
  /**
   * 사용자가 앱 안에서 만든 항목 — 게임 export 에서 온 것이 아니다.
   * 원천(spec)은 `customDataStore` 가 들고 있고, 여기 있는 것은 그 **합성 결과**다.
   * 이 표시가 있어야 재임포트 때 커스텀만 골라 걷어내고 다시 넣을 수 있다.
   * → src/factorio/customRecipe.ts
   */
  custom?: true;
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
  /**
   * 이 연결이 **엔티티 밖으로 뻗는 쪽** (0=N, 4=E, 8=S, 12=W; 엔티티 회전 0 기준).
   * 엔티티를 `d` 만큼 돌리면 실제 면은 `(direction + d) % 16`.
   *
   * `positions` 좌표만으론 면을 알 수 없다 — 화학 공장의 유체 상자 좌표는 (-1,-1) 같은
   * **모서리 칸**이라 위로 나가는지 옆으로 나가는지 부호로 갈리지 않는다.
   * 구버전 export 에는 없을 수 있어 optional.
   */
  direction?: number;
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

  /**
   * 사용자가 앱 안에서 만든 머신 — 게임 export 에서 온 것이 아니다.
   * [Recipe.custom] 과 같은 뜻이고 같은 이유로 있다. → src/factorio/customRecipe.ts
   *
   * **블루프린트에 실리면 게임이 거부한다** — 이 이름의 프로토타입이 게임에 없기 때문이다.
   * 내보내기가 이 표시를 세어 경고한다.
   */
  custom?: true;
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

/**
 * **배치가 게임데이터에서 읽는 조회 셋** — 스토어가 가진 것 중 **배치에 필요한 셋만** 담는다.
 *
 * 스토어에는 원본 배열 넷 · 파생 인덱스 여덟 · 조회 함수 · 저장 경고가 함께 산다. 배치가 쓰는 것은 레시피 ·
 * 엔티티 · 산출물→레시피 세 인덱스뿐이라, **넘기는 순간 그 셋으로 좁힌다**([gameDataLookupOf]). 좁혀 두면
 * *"배치는 무엇을 읽나"* 가 이 타입 하나로 답해지고, 배치가 스토어의 다른 필드에 기대기 시작하면 타입이 막는다.
 *
 * 한 번의 실행은 **이 값 하나**를 입구([runLayeredWizard])에서 받아 끝까지 넘긴다. 스토어는 조회 Map 을
 * 제자리에서 고치지 않고 `setGameData`·`reset`·재수화 때만 **갈아 끼우므로**, 한 번 읽어 넘긴 값이 실행 내내
 * 같은 게임데이터다 — 여러 번 읽으면 그 사이 갈아 끼워진 새 값이 섞일 수 있다.
 */
export interface GameDataLookup {
  recipeMap: Map<string, Recipe>;
  entityMap: Map<string, Entity>;
  itemToRecipe: Map<string, string>;
}

/**
 * **게임데이터를 배치에 넘기는 단계** — 가진 것에서 [GameDataLookup] 셋만 떼어 새 값으로 낸다.
 *
 * 화면(스토어 상태)과 실행 입구가 **같은 이 함수로** 넘긴다. 떼어 낸 Map 은 사본이 아니라 **같은 객체**다 —
 * 조회만 좁히고 내용은 안 바꾼다(스토어가 Map 을 제자리에서 안 고치므로 사본이 필요 없다).
 */
export function gameDataLookupOf(source: GameDataLookup): GameDataLookup {
  return { recipeMap: source.recipeMap, entityMap: source.entityMap, itemToRecipe: source.itemToRecipe };
}
