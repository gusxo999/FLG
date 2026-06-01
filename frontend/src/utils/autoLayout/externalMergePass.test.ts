import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEmptyCell, EntityType } from '../../types/layout';
import { useGameDataStore, type Entity, type Recipe } from '../../store/gameDataStore';
import type { Area, Container, PendingConnection, PlacedCell } from './containerModel';
import type { RouteOptions } from './routeFallback';
import { wrapExternalsWithMerge } from './externalMergePass';

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처 — 게임데이터 + 영역
// ─────────────────────────────────────────────────────────────────────────────

const RECIPE: Recipe = {
  id: 1, name: 'gear', localised_name: 'gear', category: 'crafting',
  energy_required: 0.5,
  ingredients: [{ name: 'iron-plate', amount: 1, type: 'item' }],
  products: [{ name: 'gear', amount: 1, type: 'item' }],
};

const MACHINE: Entity = { id: 1, name: 'asm', localised_name: 'asm', type: 'assembling-machine', tile_width: 3, tile_height: 3, crafting_speed: 1 } as Entity;
const BELT: Entity = { id: 2, name: 'transport-belt', localised_name: 'belt', type: 'transport-belt', tile_width: 1, tile_height: 1, belt_speed: 0.09375 } as Entity; // 45/s
const INSERTER: Entity = { id: 3, name: 'inserter', localised_name: 'ins', type: 'inserter', tile_width: 1, tile_height: 1, inserter_rotation_speed: 0.5 } as Entity; // tapCap ~8.3/s

const OPTIONS: RouteOptions = {
  beltEntityName: 'transport-belt',
  inserterEntityName: 'inserter',
  pipeEntityName: 'pipe',
  preferUnderground: false,
};

// 스토어는 persist 미들웨어가 있어 node 에서 setState 가 재귀한다 → getState 만 모킹.
beforeEach(() => {
  vi.spyOn(useGameDataStore, 'getState').mockReturnValue({
    recipeMap: new Map([['gear', RECIPE]]),
    entityMap: new Map([['asm', MACHINE], ['transport-belt', BELT], ['inserter', INSERTER]]),
  } as unknown as ReturnType<typeof useGameDataStore.getState>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function machineContainer(id: string, x: number, y: number): Container {
  return { id, kind: 'machine', entityName: 'asm', origin: { x, y }, size: { w: 3, h: 3 }, recipeName: 'gear' };
}
function chestContainer(id: string): Container {
  return { id, kind: 'infinity-chest', entityName: 'infinity-chest', origin: { x: 0, y: 0 }, size: { w: 1, h: 1 }, content: 'iron-plate' };
}
function machineCells(c: Container): PlacedCell[] {
  const out: PlacedCell[] = [];
  for (let dx = 0; dx < c.size.w; dx++) for (let dy = 0; dy < c.size.h; dy++) {
    out.push({ x: c.origin.x + dx, y: c.origin.y + dy, cell: { ...createEmptyCell(), entityId: c.id, entityName: 'asm', entityType: EntityType.Assembler, isOrigin: dx === 0 && dy === 0 } });
  }
  return out;
}

function buildAreas() {
  const m1 = machineContainer('M1', 5, 5);
  const m2 = machineContainer('M2', 10, 5);
  const internal: Area = {
    kind: 'internal',
    containers: [m1, m2],
    placed: [...machineCells(m1), ...machineCells(m2)],
    undergroundCorridors: [],
  };
  const external: Area = {
    kind: 'external',
    containers: [chestContainer('C1'), chestContainer('C2')],
    placed: [],
    undergroundCorridors: [],
  };
  const connections: PendingConnection[] = [
    { producerId: 'C1', consumerId: 'M1', kind: 'item' },
    { producerId: 'C2', consumerId: 'M2', kind: 'item' },
  ];
  return { internal, external, connections };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('wrapExternalsWithMerge', () => {
  it('merges two same-item machines into one chest + trunk when enabled', () => {
    const { internal, external, connections } = buildAreas();
    const machineCellCount = internal.placed.length;

    wrapExternalsWithMerge(internal, external, [], connections, OPTIONS, { enabled: true, maxTaps: 6 });

    // 상자 2 → 1 로 병합.
    expect(external.containers).toHaveLength(1);
    expect(external.placed).toHaveLength(1); // 대표 상자만 배치
    expect(external.placed[0].cell.entityType).toBe(EntityType.InfinityChest);

    // 트렁크 벨트 + 인서터가 internal 에 commit (머신 셀 외에 추가됨).
    const added = internal.placed.slice(machineCellCount);
    expect(added.some((p) => p.cell.entityType === EntityType.Belt)).toBe(true);
    expect(added.some((p) => p.cell.entityType === EntityType.Inserter)).toBe(true);

    // 트렁크/인서터 셀이 머신 footprint 와 안 겹침.
    const machineSet = new Set<string>();
    for (const m of [{ x: 5, y: 5 }, { x: 10, y: 5 }]) for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) machineSet.add(`${m.x + dx},${m.y + dy}`);
    for (const p of added) expect(machineSet.has(`${p.x},${p.y}`)).toBe(false);
  });

  it('falls back to 1:1 (two chests) when disabled', () => {
    const { internal, external, connections } = buildAreas();

    wrapExternalsWithMerge(internal, external, [], connections, OPTIONS, { enabled: false, maxTaps: 6 });

    // 병합 안 함 → 두 상자 모두 그대로 1:1 배치.
    expect(external.containers).toHaveLength(2);
    expect(external.placed).toHaveLength(2);
  });

  it('does not merge when items differ (separate buckets, both 1:1)', () => {
    const { internal, external, connections } = buildAreas();
    // C2 의 품목을 다른 것으로 → 같은 버킷이 아니라 각자 단독 → 1:1.
    external.containers[1].content = 'copper-plate';
    // copper-plate 수요 계산용으로 레시피에 재료 추가는 불필요 — demand Infinity 라도 단독이면 1:1.

    wrapExternalsWithMerge(internal, external, [], connections, OPTIONS, { enabled: true, maxTaps: 6 });

    expect(external.containers).toHaveLength(2);
    expect(external.placed).toHaveLength(2);
  });
});
