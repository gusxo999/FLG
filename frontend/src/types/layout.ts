/**
 * Internal layout types used by the layout generator.
 * These are independent of the Factorio Blueprint format and
 * represent our working in-memory grid state.
 *
 * Note: TypeScript `enum` is avoided here because `erasableSyntaxOnly` is
 * enabled in tsconfig. We use a `const` object + derived union type instead,
 * which is fully erasable and behaves identically at runtime.
 */

export const EntityType = {
  Belt:            'Belt',
  UndergroundBelt: 'UndergroundBelt',
  Splitter:        'Splitter',
  Assembler:       'Assembler',
  Furnace:         'Furnace',
  Pipe:            'Pipe',
  PipeUnderground: 'PipeUnderground',
  Pump:            'Pump',
  Power:           'Power',           // electric pole
  Wall:            'Wall',
  Gate:            'Gate',
  Turret:          'Turret',
  Beacon:          'Beacon',
  Inserter:        'Inserter',
  LongInserter:    'LongInserter',
  Chest:           'Chest',
  InfinityChest:   'InfinityChest',   // infinity-container — 자동완성 위저드 외부 영역 IO
  InfinityPipe:    'InfinityPipe',    // infinity-pipe      — 자동완성 위저드 외부 영역 fluid IO
  Roboport:        'Roboport',
  Lab:             'Lab',
  Radar:           'Radar',
  SolarPanel:      'SolarPanel',
  Accumulator:     'Accumulator',
  MiningDrill:     'MiningDrill',
  OffshorePump:    'OffshorePump',
  Boiler:          'Boiler',
  SteamEngine:     'SteamEngine',
  Train:           'Train',           // rail
  TrainStop:       'TrainStop',
  Empty:           'Empty',
} as const;

export type EntityType = (typeof EntityType)[keyof typeof EntityType];

/**
 * Direction a placed entity faces — Factorio 2.0 16-방향 인코딩의 cardinal 4방향.
 * 0=N, 4=E, 8=S, 12=W. (1/3/5/7/9/11/13/15 은 22.5° 단위 sub-cardinal — 곡선 레일용,
 * 2/6/10/14 는 8방향 diagonal — 추후 필요 시 확장)
 */
export type Direction = 0 | 4 | 8 | 12;

export interface GridPosition {
  x: number;
  y: number;
}

/**
 * 모듈 슬롯 1칸의 내용 (Phase 2 export).
 * BlueprintInsertPlan으로 변환되어 export된다.
 */
export interface ModuleSlot {
  /** Factorio item name (예: "speed-module-3") */
  name: string;
  /** Space Age quality (normal/uncommon/rare/epic/legendary). 미지정 시 normal */
  quality?: string;
}

/**
 * A single cell in the layout grid.
 * Multi-tile entities (e.g. 3x3 assemblers) occupy multiple cells;
 * all cells of the same entity share the same `entityId`.
 */
export interface GridCell {
  /** Unique identifier for the entity instance placed at this cell. null = empty */
  entityId: string | null;
  /** Factorio internal name of the entity (e.g. "assembling-machine-2") */
  entityName: string | null;
  entityType: EntityType;
  direction: Direction;
  /**
   * For multi-tile entities: which tile within the entity's bounding box this cell represents.
   * (0,0) is always the top-left / origin tile.
   */
  tileOffset: GridPosition;
  /**
   * True for every cell that belongs to a multi-tile entity except the origin cell.
   * Origin cell has isOrigin=true and holds the entity metadata.
   */
  isOrigin: boolean;
  /** Optional recipe assigned to machines */
  recipe?: string;
  /**
   * 슬롯별 모듈 (Phase 2). 슬롯 인덱스 = 배열 인덱스.
   * 빈 슬롯은 null. 길이는 entity.module_slots를 넘지 않는다.
   */
  modules?: Array<ModuleSlot | null>;
  /** Space Age 엔티티 quality (normal/uncommon/rare/epic/legendary). 미지정 시 normal */
  quality?: string;
  /** import 시 보존만 — round-trip 위해 */
  mirror?: boolean;
  /** import 시 보존만 — round-trip 위해 */
  tags?: Record<string, unknown>;
  /** Rendering hint color (hex string) */
  color?: string;
}

export interface EntitySize {
  width: number;
  height: number;
}

/** Per-entity-type size lookup (in tiles). Defaults to 1x1 if not listed. */
export const ENTITY_SIZES: Partial<Record<EntityType, EntitySize>> = {
  [EntityType.Assembler]:  { width: 3, height: 3 },
  [EntityType.Furnace]:    { width: 3, height: 3 },
  [EntityType.Roboport]:   { width: 4, height: 4 },
  [EntityType.SolarPanel]: { width: 3, height: 3 },
  [EntityType.Radar]:      { width: 3, height: 3 },
  [EntityType.Beacon]:     { width: 3, height: 3 },
  [EntityType.Lab]:        { width: 3, height: 3 },
  [EntityType.Boiler]:     { width: 3, height: 2 },
  [EntityType.SteamEngine]:{ width: 5, height: 3 },
  [EntityType.MiningDrill]:{ width: 3, height: 3 },
  [EntityType.Splitter]:   { width: 2, height: 1 },
  [EntityType.InfinityChest]: { width: 1, height: 1 },
  [EntityType.InfinityPipe]:  { width: 1, height: 1 },
};

export interface LayoutGrid {
  /** Width of the grid in tiles */
  width: number;
  /** Height of the grid in tiles */
  height: number;
  /**
   * Flat array of cells, row-major order.
   * Index = y * width + x
   */
  cells: GridCell[];
}

export function createEmptyCell(): GridCell {
  return {
    entityId: null,
    entityName: null,
    entityType: EntityType.Empty,
    direction: 0,
    tileOffset: { x: 0, y: 0 },
    isOrigin: false,
  };
}

export function createEmptyGrid(width: number, height: number): LayoutGrid {
  return {
    width,
    height,
    cells: Array.from({ length: width * height }, createEmptyCell),
  };
}

export function cellIndex(grid: LayoutGrid, x: number, y: number): number {
  return y * grid.width + x;
}

export function getCell(grid: LayoutGrid, x: number, y: number): GridCell | null {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
  return grid.cells[cellIndex(grid, x, y)];
}

/** Viewport / camera state used by the canvas renderer */
export interface ViewportState {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

/** Selection state */
export interface SelectionState {
  active: boolean;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}
