/**
 * factorio-data.json (게임 콘솔 export 포맷) →
 * gameDataStore가 사용하는 GameData 포맷으로 변환
 */

import type {
  GameData,
  Recipe,
  Entity,
  Module,
  ModuleEffects,
  SurfaceCondition,
  Technology,
  Vec2,
  CollisionBox,
  FluidBoxInfo,
  PipeConnection,
} from '../store/gameDataStore';
import { t } from '../i18n';

interface RawIngredient {
  type: string;
  name: string;
  amount: number;
}

interface RawProduct {
  type: string;
  name: string;
  amount: number;
  probability?: number;
}

interface RawSurfaceCondition {
  property: string;
  min?: number;
  max?: number;
}

interface RawRecipe {
  name: string;
  category: string;
  energy: number;
  enabled?: boolean;
  ingredients: RawIngredient[] | Record<string, RawIngredient>;
  products: RawProduct[] | Record<string, RawProduct>;
  allowed_module_categories?: string[] | Record<string, unknown>;
  surface_conditions?: RawSurfaceCondition[] | Record<string, RawSurfaceCondition>;
}

interface RawEntity {
  name: string;
  type: string;
  tile_width: number;
  tile_height: number;
  collision_box?: CollisionBox;

  crafting_speed?: number;
  crafting_categories?: string[] | Record<string, unknown>;
  module_slots?: number;
  allowed_effects?: string[] | Record<string, unknown>;
  allowed_module_categories?: string[] | Record<string, unknown>;
  surface_conditions?: RawSurfaceCondition[] | Record<string, RawSurfaceCondition>;

  lab_inputs?: string[] | Record<string, unknown>;
  researching_speed?: number;

  mining_speed?: number;
  resource_categories?: string[] | Record<string, unknown>;

  belt_speed?: number;
  max_underground_distance?: number;

  inserter_pickup_position?: Vec2;
  inserter_drop_position?: Vec2;
  inserter_extension_speed?: number;
  inserter_rotation_speed?: number;

  pumping_speed?: number;

  supply_area_distance?: number;
  max_wire_distance?: number;
  max_power_output?: number;
  fluid_usage_per_tick?: number;
  target_temperature?: number;

  distribution_effectivity?: number;
  logistic_radius?: number;
  construction_radius?: number;

  inventory_size?: number;
  energy_usage?: number;
  energy_drain?: number;

  vector_to_place_result?: Vec2;
  resource_searching_radius?: number;

  items_to_place_this?: string[] | Record<string, unknown>;

  fluid_boxes?: Array<{
    index?: number;
    production_type?: string;
    volume?: number;
    filter?: string;
    connections?: Array<{
      positions?: Vec2[];
      flow_direction?: string;
      connection_type?: string;
      max_underground_distance?: number;
    }>;
  }>;
}

interface RawModule {
  name: string;
  category?: string;
  tier?: number;
  effects?: Record<string, unknown> | unknown[];
}

interface RawTechnology {
  name: string;
  prerequisites?: string[] | Record<string, unknown>;
  unlock_recipes?: string[] | Record<string, unknown>;
  enabled?: boolean;
  essential?: boolean;
  visible_when_disabled?: boolean;
  upgrade?: boolean;
  max_level?: number;
}

function parseModuleEffects(raw: unknown): ModuleEffects | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const out: ModuleEffects = {};
  let any = false;
  for (const key of ['speed', 'productivity', 'consumption', 'pollution', 'quality'] as const) {
    const v = obj[key];
    if (typeof v === 'number') {
      out[key] = v;
      any = true;
    }
  }
  return any ? out : undefined;
}

function parseSurfaceConditions(
  raw: RawSurfaceCondition[] | Record<string, RawSurfaceCondition> | undefined,
): SurfaceCondition[] | undefined {
  const arr = toArray(raw);
  if (arr.length === 0) return undefined;
  return arr
    .filter((c): c is RawSurfaceCondition => !!c && typeof c.property === 'string')
    .map((c) => ({
      property: c.property,
      min: typeof c.min === 'number' ? c.min : undefined,
      max: typeof c.max === 'number' ? c.max : undefined,
    }));
}

interface RawGameData {
  recipes: RawRecipe[];
  entities?: RawEntity[];
  /** 구버전 호환: machines 키도 읽기 */
  machines?: RawEntity[];
  modules?: RawModule[];
  technologies?: RawTechnology[];
}

/** Lua 테이블이 JSON 변환 시 array 또는 object로 올 수 있으므로 항상 배열로 정규화 */
function toArray<T>(val: T[] | Record<string, T> | null | undefined): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return Object.values(val);
}

/** Record<string, true> 또는 string[] → string[] */
function toStringArray(
  val: string[] | Record<string, unknown> | null | undefined
): string[] | undefined {
  if (!val) return undefined;
  if (Array.isArray(val)) return val;
  return Object.keys(val);
}

/**
 * MapPosition 형태 검증 후 정규화.
 * Factorio JSON에는 {x,y} 또는 [x,y] 또는 잘못된 {} 도 올 수 있음.
 */
function normalizeCollisionBox(cb: unknown): CollisionBox | undefined {
  if (!cb || typeof cb !== 'object') return undefined;
  const obj = cb as Record<string, unknown>;
  const lt = normalizeVec2(obj.lt);
  const rb = normalizeVec2(obj.rb);
  if (!lt || !rb) return undefined;
  return { lt, rb };
}

function normalizeVec2(v: unknown): Vec2 | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const obj = v as Record<string | number, unknown>;
  const x = obj.x ?? obj[0];
  const y = obj.y ?? obj[1];
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  return { x, y };
}

function parseFluidBoxes(
  raw: RawEntity['fluid_boxes']
): FluidBoxInfo[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  return raw.map((fb, i) => {
    const connections: PipeConnection[] = toArray(fb.connections as unknown as PipeConnection[] | Record<string, PipeConnection> | undefined).map(
      (c) => ({
        positions: toArray(c.positions as unknown as Vec2[] | Record<string, Vec2> | undefined)
          .map(normalizeVec2)
          .filter((v): v is Vec2 => v !== undefined),
        flow_direction: c.flow_direction,
        connection_type: c.connection_type,
        max_underground_distance: c.max_underground_distance,
      })
    );
    return {
      index: fb.index ?? i + 1,
      production_type: fb.production_type,
      volume: fb.volume,
      filter: fb.filter,
      connections,
    };
  });
}

export function parseGameData(raw: unknown): GameData {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(t('errors.invalidJson'));
  }

  const data = raw as RawGameData;

  if (!Array.isArray(data.recipes)) {
    throw new Error(t('errors.missingKeys'));
  }

  // entities 필드가 없으면 구버전 machines 필드 사용
  const rawEntities = data.entities ?? data.machines;
  if (!Array.isArray(rawEntities)) {
    throw new Error(t('errors.missingKeys'));
  }

  const recipes: Recipe[] = data.recipes.map((r, i) => ({
    id: i + 1,
    name: r.name,
    localised_name: r.name,
    category: r.category,
    energy_required: r.energy ?? 0.5,
    ingredients: toArray(r.ingredients).map((ing) => ({
      name: ing.name,
      amount: ing.amount,
      type: (ing.type ?? 'item') as 'item' | 'fluid',
    })),
    products: toArray(r.products).map((p) => ({
      name: p.name,
      amount: p.amount,
      probability: p.probability,
      type: (p.type ?? 'item') as 'item' | 'fluid',
    })),
    allowed_module_categories: toStringArray(r.allowed_module_categories),
    surface_conditions: parseSurfaceConditions(r.surface_conditions),
  }));

  const entities: Entity[] = rawEntities.map((e, i) => ({
    id: i + 1,
    name: e.name,
    localised_name: e.name,
    type: e.type,
    tile_width: e.tile_width,
    tile_height: e.tile_height,
    collision_box: normalizeCollisionBox(e.collision_box),

    crafting_speed: e.crafting_speed,
    crafting_categories: toStringArray(e.crafting_categories),
    module_slots: e.module_slots,
    allowed_effects: toStringArray(e.allowed_effects),
    allowed_module_categories: toStringArray(e.allowed_module_categories),
    surface_conditions: parseSurfaceConditions(e.surface_conditions),

    lab_inputs: toStringArray(e.lab_inputs),
    researching_speed: e.researching_speed,

    mining_speed: e.mining_speed,
    resource_categories: toStringArray(e.resource_categories),

    belt_speed: e.belt_speed,
    max_underground_distance: e.max_underground_distance,

    inserter_pickup_position: normalizeVec2(e.inserter_pickup_position),
    inserter_drop_position: normalizeVec2(e.inserter_drop_position),
    inserter_extension_speed: e.inserter_extension_speed,
    inserter_rotation_speed: e.inserter_rotation_speed,

    pumping_speed: e.pumping_speed,

    supply_area_distance: e.supply_area_distance,
    max_wire_distance: e.max_wire_distance,
    max_power_output: e.max_power_output,
    fluid_usage_per_tick: e.fluid_usage_per_tick,
    target_temperature: e.target_temperature,

    distribution_effectivity: e.distribution_effectivity,
    logistic_radius: e.logistic_radius,
    construction_radius: e.construction_radius,

    inventory_size: e.inventory_size,
    energy_usage: e.energy_usage,
    energy_drain: e.energy_drain,

    vector_to_place_result: normalizeVec2(e.vector_to_place_result),
    resource_searching_radius: e.resource_searching_radius,

    items_to_place_this: toStringArray(e.items_to_place_this),

    fluid_boxes: parseFluidBoxes(e.fluid_boxes),
  }));

  const modules: Module[] = Array.isArray(data.modules)
    ? data.modules
        .filter((m): m is RawModule => !!m && typeof m.name === 'string')
        .map((m) => ({
          name: m.name,
          category: typeof m.category === 'string' ? m.category : undefined,
          tier: typeof m.tier === 'number' ? m.tier : undefined,
          localised_name: m.name,
          effects: parseModuleEffects(m.effects),
        }))
    : [];

  const technologies: Technology[] = Array.isArray(data.technologies)
    ? data.technologies
        .filter((tc): tc is RawTechnology => !!tc && typeof tc.name === 'string')
        .map((tc) => ({
          name: tc.name,
          prerequisites: toStringArray(tc.prerequisites) ?? [],
          unlock_recipes: toStringArray(tc.unlock_recipes) ?? [],
          enabled: typeof tc.enabled === 'boolean' ? tc.enabled : undefined,
          essential: typeof tc.essential === 'boolean' ? tc.essential : undefined,
          visible_when_disabled:
            typeof tc.visible_when_disabled === 'boolean' ? tc.visible_when_disabled : undefined,
          upgrade: typeof tc.upgrade === 'boolean' ? tc.upgrade : undefined,
          max_level: typeof tc.max_level === 'number' ? tc.max_level : undefined,
        }))
    : [];

  return { recipes, entities, modules, technologies };
}
