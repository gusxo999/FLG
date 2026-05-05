import { EntityType } from '../types/layout';

/**
 * 사이드바에서 사용하는 카테고리.
 * 각 카테고리는 Factorio entity.type 의 집합으로 정의.
 */
export type SidebarCategory =
  | 'assembler'
  | 'production'
  | 'logistics'
  | 'combat'
  | 'circuit'
  | 'rail';

export const CATEGORY_TO_TYPES: Record<SidebarCategory, string[]> = {
  assembler: ['assembling-machine'],
  production: ['furnace', 'rocket-silo', 'lab', 'mining-drill', 'offshore-pump'],
  logistics: [
    // 물류
    'transport-belt', 'underground-belt', 'splitter', 'loader', 'loader-1x1',
    'inserter', 'pipe', 'pipe-to-ground', 'pump',
    // 전력 (구 power)
    'electric-pole', 'solar-panel', 'accumulator', 'boiler', 'generator', 'reactor',
    'heat-pipe', 'fusion-reactor', 'fusion-generator', 'burner-generator',
    // 유틸 (구 utility)
    'beacon', 'roboport', 'container', 'logistic-container', 'linked-container',
    'radar', 'lamp',
  ],
  combat: ['wall', 'gate', 'ammo-turret', 'electric-turret', 'fluid-turret'],
  circuit: ['arithmetic-combinator', 'decider-combinator', 'constant-combinator', 'selector-combinator', 'programmable-speaker'],
  rail: ['straight-rail', 'curved-rail', 'curved-rail-a', 'curved-rail-b', 'half-diagonal-rail', 'train-stop'],
};

export const CATEGORIES: SidebarCategory[] = [
  'assembler', 'production', 'logistics', 'combat', 'circuit', 'rail',
];

/**
 * Factorio entity.type → 내부 EntityType 매핑.
 * 레이아웃 저장/렌더링 시 EntityType이 필요함.
 */
const TYPE_TO_ENTITYTYPE: Record<string, EntityType> = {
  'transport-belt': EntityType.Belt,
  'underground-belt': EntityType.UndergroundBelt,
  'splitter': EntityType.Splitter,
  'loader': EntityType.Belt,
  'loader-1x1': EntityType.Belt,
  'inserter': EntityType.Inserter,
  'pipe': EntityType.Pipe,
  'pipe-to-ground': EntityType.PipeUnderground,
  'pump': EntityType.Pump,
  'assembling-machine': EntityType.Assembler,
  'furnace': EntityType.Furnace,
  'rocket-silo': EntityType.Assembler,
  'lab': EntityType.Lab,
  'mining-drill': EntityType.MiningDrill,
  'offshore-pump': EntityType.OffshorePump,
  'electric-pole': EntityType.Power,
  'solar-panel': EntityType.SolarPanel,
  'accumulator': EntityType.Accumulator,
  'boiler': EntityType.Boiler,
  'generator': EntityType.SteamEngine,
  'reactor': EntityType.SteamEngine,
  'heat-pipe': EntityType.Pipe,
  'fusion-reactor': EntityType.SteamEngine,
  'fusion-generator': EntityType.SteamEngine,
  'burner-generator': EntityType.SteamEngine,
  'beacon': EntityType.Beacon,
  'roboport': EntityType.Roboport,
  'container': EntityType.Chest,
  'logistic-container': EntityType.Chest,
  'linked-container': EntityType.Chest,
  'infinity-container': EntityType.InfinityChest,
  'infinity-pipe': EntityType.InfinityPipe,
  'radar': EntityType.Radar,
  'lamp': EntityType.Chest,
  'arithmetic-combinator': EntityType.Chest,
  'decider-combinator': EntityType.Chest,
  'constant-combinator': EntityType.Chest,
  'selector-combinator': EntityType.Chest,
  'programmable-speaker': EntityType.Chest,
  'wall': EntityType.Wall,
  'gate': EntityType.Gate,
  'ammo-turret': EntityType.Turret,
  'electric-turret': EntityType.Turret,
  'fluid-turret': EntityType.Turret,
  'straight-rail': EntityType.Train,
  'curved-rail': EntityType.Train,
  'curved-rail-a': EntityType.Train,
  'curved-rail-b': EntityType.Train,
  'half-diagonal-rail': EntityType.Train,
  'train-stop': EntityType.TrainStop,
};

export function entityTypeFromFactorioType(factorioType: string): EntityType {
  return TYPE_TO_ENTITYTYPE[factorioType] ?? EntityType.Chest;
}

/**
 * 해당 카테고리 탭에 속하는지 검사.
 */
export function belongsToCategory(factorioType: string, category: SidebarCategory): boolean {
  return CATEGORY_TO_TYPES[category].includes(factorioType);
}
