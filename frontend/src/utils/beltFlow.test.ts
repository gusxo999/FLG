import { describe, it, expect } from 'vitest';
import { computeBeltFlowAt, type BeltFlowCtx } from './beltFlow';
import {
  EntityType,
  createEmptyGrid,
  getCell,
  type Direction,
  type LayoutGrid,
} from '../types/layout';
import type { Entity, Module, Recipe } from '../store/gameDataStore';
import type { InfinitySettings } from '../types/blueprint';

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처
// ─────────────────────────────────────────────────────────────────────────────

function ent(name: string, extra: Partial<Entity> = {}): Entity {
  return {
    id: 1,
    name,
    localised_name: name,
    type: 'test',
    tile_width: 1,
    tile_height: 1,
    ...extra,
  } as Entity;
}

/** transport-belt 15/s (belt_speed 0.03125 × 480). */
const BELT = ent('transport-belt', { belt_speed: 15 / 480 });
/** 느린 벨트 2/s — 용량 클램프 테스트용. */
const SLOW_BELT = ent('slow-belt', { belt_speed: 2 / 480 });
const UG_BELT = ent('underground-belt', { belt_speed: 15 / 480 });
const ASSEMBLER = ent('assembling-machine-2', { crafting_speed: 1, tile_width: 3, tile_height: 3 });

const GEAR_RECIPE: Recipe = {
  id: 1,
  name: 'iron-gear-wheel',
  localised_name: '기어',
  category: 'crafting',
  energy_required: 1,
  ingredients: [{ name: 'iron-plate', amount: 2, type: 'item' }],
  products: [{ name: 'iron-gear-wheel', amount: 1, type: 'item' }],
};

function makeCtx(): BeltFlowCtx {
  return {
    entityMap: new Map<string, Entity>([
      ['transport-belt', BELT],
      ['slow-belt', SLOW_BELT],
      ['underground-belt', UG_BELT],
      ['assembling-machine-2', ASSEMBLER],
    ]),
    recipeMap: new Map<string, Recipe>([['iron-gear-wheel', GEAR_RECIPE]]),
    moduleMap: new Map<string, Module>(),
    // 인서터 프로토타입 없이도 결정적 처리량이 나오게 override 로 4/s 고정.
    inserterOverrides: { inserter: { throughput: 4 } },
  };
}

let nextId = 0;

function put(
  grid: LayoutGrid,
  x: number,
  y: number,
  patch: {
    entityType: EntityType;
    entityName: string;
    direction?: Direction;
    undergroundType?: 'input' | 'output';
    infinitySettings?: InfinitySettings;
    recipe?: string;
  },
): void {
  const c = getCell(grid, x, y)!;
  Object.assign(c, {
    entityId: `t${nextId++}`,
    isOrigin: true,
    direction: patch.direction ?? 0,
    ...patch,
  });
}

/** 가로 벨트 라인 (dir=4 E). */
function beltLine(grid: LayoutGrid, y: number, x1: number, x2: number, name = 'transport-belt') {
  for (let x = x1; x <= x2; x++) put(grid, x, y, { entityType: EntityType.Belt, entityName: name, direction: 4 });
}

/** 상자 1칸 (필터 품목 지정 가능). */
function chest(grid: LayoutGrid, x: number, y: number, item?: string) {
  put(grid, x, y, {
    entityType: EntityType.InfinityChest,
    entityName: 'infinity-chest',
    infinitySettings: item ? ({ filters: [{ name: item, mode: 'at-least' }] } as InfinitySettings) : undefined,
  });
}

/** 인서터 1칸 — direction 은 *픽업* 방향. */
function inserter(grid: LayoutGrid, x: number, y: number, pickupDir: Direction) {
  put(grid, x, y, { entityType: EntityType.Inserter, entityName: 'inserter', direction: pickupDir });
}

/** 3×3 조립기 (origin 셀에 레시피). */
function assembler(grid: LayoutGrid, ox: number, oy: number, recipe: string) {
  for (let dx = 0; dx < 3; dx++) {
    for (let dy = 0; dy < 3; dy++) {
      const c = getCell(grid, ox + dx, oy + dy)!;
      Object.assign(c, {
        entityId: `a${nextId}`,
        entityName: 'assembling-machine-2',
        entityType: EntityType.Assembler,
        direction: 0,
        tileOffset: { x: dx, y: dy },
        isOrigin: dx === 0 && dy === 0,
        recipe: dx === 0 && dy === 0 ? recipe : undefined,
      });
    }
  }
  nextId++;
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────────────────────────────────────

describe('computeBeltFlowAt', () => {
  it('벨트류가 아닌 셀은 null', () => {
    const grid = createEmptyGrid(12, 12);
    expect(computeBeltFlowAt(grid, 3, 3, makeCtx())).toBeNull();
  });

  it('투입기 지점마다 흐름량이 달라진다 (드랍 2 + 픽업 1)', () => {
    const grid = createEmptyGrid(14, 14);
    beltLine(grid, 5, 1, 9);
    // 드랍 1: 상자(2,3) → 인서터(2,4) 픽업N → 벨트(2,5)
    chest(grid, 2, 3, 'iron-plate');
    inserter(grid, 2, 4, 0);
    // 드랍 2: 상자(5,3) → 인서터(5,4) 픽업N → 벨트(5,5)
    chest(grid, 5, 3, 'iron-plate');
    inserter(grid, 5, 4, 0);
    // 픽업: 벨트(7,5) → 인서터(7,4) 픽업S → 상자(7,3)
    chest(grid, 7, 3);
    inserter(grid, 7, 4, 8);

    const ctx = makeCtx();
    // 첫 드랍 직후 구간: 4/s
    expect(computeBeltFlowAt(grid, 3, 5, ctx)!.outflow).toBeCloseTo(4);
    // 둘째 드랍 직후 구간: 8/s
    expect(computeBeltFlowAt(grid, 6, 5, ctx)!.outflow).toBeCloseTo(8);
    // 픽업 셀: 유입 8, 유출 4
    const atPick = computeBeltFlowAt(grid, 7, 5, ctx)!;
    expect(atPick.inflow).toBeCloseTo(8);
    expect(atPick.outflow).toBeCloseTo(4);
    expect(atPick.tapsAtCell).toHaveLength(1);
    expect(atPick.tapsAtCell[0].kind).toBe('pick');
    // 픽업 하류 구간: 4/s
    expect(computeBeltFlowAt(grid, 9, 5, ctx)!.outflow).toBeCloseTo(4);
    // 품목은 상자 필터에서 유도
    expect(computeBeltFlowAt(grid, 9, 5, ctx)!.items).toEqual(['iron-plate']);
  });

  it('머신 생산율이 인서터 처리량보다 작으면 머신율로 캡', () => {
    const grid = createEmptyGrid(14, 14);
    beltLine(grid, 5, 1, 8);
    // 조립기(1,1)~(3,3), 기어 1/s 생산. 인서터(2,4) 픽업N → 머신 셀(2,3).
    assembler(grid, 1, 1, 'iron-gear-wheel');
    inserter(grid, 2, 4, 0);

    const flow = computeBeltFlowAt(grid, 6, 5, makeCtx())!;
    expect(flow.outflow).toBeCloseTo(1); // min(인서터 4, 머신 1)
    expect(flow.items).toEqual(['iron-gear-wheel']);
    expect(flow.machineRateUnknownCount).toBe(0);
  });

  it('지하벨트 페어를 건너 흐름이 이어진다', () => {
    const grid = createEmptyGrid(14, 14);
    put(grid, 1, 5, { entityType: EntityType.Belt, entityName: 'transport-belt', direction: 4 });
    put(grid, 2, 5, { entityType: EntityType.UndergroundBelt, entityName: 'underground-belt', direction: 4, undergroundType: 'input' });
    put(grid, 5, 5, { entityType: EntityType.UndergroundBelt, entityName: 'underground-belt', direction: 4, undergroundType: 'output' });
    put(grid, 6, 5, { entityType: EntityType.Belt, entityName: 'transport-belt', direction: 4 });
    chest(grid, 1, 3, 'copper-plate');
    inserter(grid, 1, 4, 0); // 드랍 → 벨트(1,5)

    const flow = computeBeltFlowAt(grid, 6, 5, makeCtx())!;
    expect(flow.outflow).toBeCloseTo(4);
    expect(flow.items).toEqual(['copper-plate']);
  });

  it('벨트 용량으로 클램프 + saturated 플래그', () => {
    const grid = createEmptyGrid(14, 14);
    beltLine(grid, 5, 1, 8, 'slow-belt'); // 용량 2/s
    chest(grid, 2, 3, 'iron-plate');
    inserter(grid, 2, 4, 0); // +4/s
    chest(grid, 5, 3, 'iron-plate');
    inserter(grid, 5, 4, 0); // +4/s

    const flow = computeBeltFlowAt(grid, 7, 5, makeCtx())!;
    expect(flow.outflow).toBeCloseTo(2);
    expect(flow.saturated).toBe(true);
    expect(flow.capacity).toBeCloseTo(2);
  });

  it('side-load 합류: 두 상류 스트림이 더해진다', () => {
    const grid = createEmptyGrid(14, 14);
    beltLine(grid, 5, 1, 5); // 본선 E
    // 지선: (3,2)→(3,4) 남향 → (3,5) 에 side-load
    for (let y = 2; y <= 4; y++) {
      put(grid, 3, y, { entityType: EntityType.Belt, entityName: 'transport-belt', direction: 8 });
    }
    // 본선 드랍: 상자(1,3) → 인서터(1,4) 픽업N → 벨트(1,5)
    chest(grid, 1, 3, 'iron-plate');
    inserter(grid, 1, 4, 0);
    // 지선 드랍: 상자(1,2) → 인서터(2,2) 픽업W → 벨트(3,2)
    chest(grid, 1, 2, 'iron-plate');
    inserter(grid, 2, 2, 12);

    const flow = computeBeltFlowAt(grid, 5, 5, makeCtx())!;
    expect(flow.outflow).toBeCloseTo(8);
    expect(flow.upstreamTaps.drops).toBe(2);
  });
});
