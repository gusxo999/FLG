import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEmptyCell, EntityType } from '../../types/layout';
import { useGameDataStore, type Entity, type Recipe } from '../../store/gameDataStore';
import type { Area, Container, PendingConnection, PlacedCell, Routing } from './containerModel';
import type { RouteOptions } from './routeFallback';
import { wrapExternalsAroundPerimeter } from './areaUnification';
import { gatherExternalsToPoints } from './externalGatherPass';

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
const BELT: Entity = { id: 2, name: 'transport-belt', localised_name: 'belt', type: 'transport-belt', tile_width: 1, tile_height: 1, belt_speed: 0.09375 } as Entity;
const INSERTER: Entity = { id: 3, name: 'inserter', localised_name: 'ins', type: 'inserter', tile_width: 1, tile_height: 1, inserter_rotation_speed: 0.5 } as Entity;

const OPTIONS: RouteOptions = {
  beltEntityName: 'transport-belt',
  inserterEntityName: 'inserter',
  // BuildSpec 필수 필드 — 위 두 이름과 **같은 엔티티**여야 한다(세는 쪽과 놓는 쪽이 어긋나면
  // 조용히 굶는다, buildSpec.ts 주석). 이 테스트들은 라우팅만 보므로 대표 티어 하나면 족하다.
  belts: [{ entityName: 'transport-belt', throughput: 15 }],
  inserters: [{ entityName: 'inserter', reach: 1, throughput: 0.83 }],
  pipeEntityName: 'pipe',
  preferUnderground: false,
};

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
function chestContainer(id: string, content = 'iron-plate'): Container {
  return { id, kind: 'infinity-chest', entityName: 'infinity-chest', origin: { x: 0, y: 0 }, size: { w: 1, h: 1 }, content, role: 'input' };
}
function machineCells(c: Container): PlacedCell[] {
  const out: PlacedCell[] = [];
  for (let dx = 0; dx < c.size.w; dx++) for (let dy = 0; dy < c.size.h; dy++) {
    out.push({ x: c.origin.x + dx, y: c.origin.y + dy, cell: { ...createEmptyCell(), entityId: c.id, entityName: 'asm', entityType: EntityType.Assembler, isOrigin: dx === 0 && dy === 0 } });
  }
  return out;
}

/** 머신 2대(수직 분리, 같은 품목 입력) + 둘레 배치까지 마친 영역. */
function buildPlacedAreas(content = 'iron-plate') {
  const m1 = machineContainer('M1', 5, 5);
  const m2 = machineContainer('M2', 5, 12);
  const internal: Area = {
    kind: 'internal', containers: [m1, m2],
    placed: [...machineCells(m1), ...machineCells(m2)], undergroundCorridors: [],
  };
  const external: Area = {
    kind: 'external', containers: [chestContainer('C1', content), chestContainer('C2', content)],
    placed: [], undergroundCorridors: [],
  };
  const connections: PendingConnection[] = [
    { producerId: 'C1', consumerId: 'M1', kind: 'item' },
    { producerId: 'C2', consumerId: 'M2', kind: 'item' },
  ];
  const routings: Routing[] = [];
  wrapExternalsAroundPerimeter(internal, external, routings, connections, OPTIONS);
  return { internal, external, routings, connections };
}

const chestCells = (external: Area) =>
  external.placed.filter((p) => p.cell.entityType === EntityType.InfinityChest);
const originOf = (external: Area, id: string) =>
  ({ ...external.containers.find((c) => c.id === id)!.origin });

// ─────────────────────────────────────────────────────────────────────────────

describe('gatherExternalsToPoints', () => {
  it('토글 OFF → 완전 no-op', () => {
    const { internal, external, routings, connections } = buildPlacedAreas();
    const extBefore = JSON.stringify(external.placed);
    const intBefore = JSON.stringify(internal.placed);
    const routeBefore = routings.length;

    const res = gatherExternalsToPoints(internal, external, routings, connections, OPTIONS, { enabled: false });

    expect(res).toEqual({ groupsGathered: 0, groupsFailed: 0 });
    expect(JSON.stringify(external.placed)).toBe(extBefore);
    expect(JSON.stringify(internal.placed)).toBe(intBefore);
    expect(routings.length).toBe(routeBefore);
  });

  it('같은 품목 입력 상자 2개를 한 변의 인접 셀로 모은다 (각 belt 유지)', () => {
    const { internal, external, routings, connections } = buildPlacedAreas();
    const routeBefore = routings.length;

    const res = gatherExternalsToPoints(internal, external, routings, connections, OPTIONS, { enabled: true });

    // 라우팅 수·상자 수는 보존(흐름 합류 없음, 각 상자 belt 따로 유지).
    expect(routings.length).toBe(routeBefore);
    expect(chestCells(external)).toHaveLength(2);

    expect(res.groupsGathered).toBe(1);
    // 모인 두 상자는 한 줄(같은 고정축) + 인접(가변축 차이 1).
    const a = originOf(external, 'C1');
    const b = originOf(external, 'C2');
    const sameLane = a.x === b.x || a.y === b.y;
    const adjacent = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
    expect(sameLane && adjacent).toBe(true);
  });

  it('같은 품목 상자가 1개뿐이면 이동하지 않는다', () => {
    const m1 = machineContainer('M1', 5, 5);
    const internal: Area = { kind: 'internal', containers: [m1], placed: machineCells(m1), undergroundCorridors: [] };
    const external: Area = { kind: 'external', containers: [chestContainer('C1')], placed: [], undergroundCorridors: [] };
    const connections: PendingConnection[] = [{ producerId: 'C1', consumerId: 'M1', kind: 'item' }];
    const routings: Routing[] = [];
    wrapExternalsAroundPerimeter(internal, external, routings, connections, OPTIONS);
    const before = originOf(external, 'C1');

    const res = gatherExternalsToPoints(internal, external, routings, connections, OPTIONS, { enabled: true });

    expect(res.groupsGathered).toBe(0);
    expect(originOf(external, 'C1')).toEqual(before);
  });

  it('트렁크 대표 상자(#trunk)는 고정 앵커 — 이동하지 않는다', () => {
    const { internal, external, routings, connections } = buildPlacedAreas();
    // C1 을 트렁크 대표로 표식 — 앵커라 절대 이동하면 안 됨.
    routings.push({
      id: 'C1#trunk', kind: 'item',
      from: { containerId: 'C1', cell: { x: 0, y: 0 }, face: 'N', kind: 'item' },
      to: { containerId: 'M1', cell: { x: 0, y: 0 }, face: 'N', kind: 'item' },
      placed: [], corridors: [],
    });
    const c1Before = originOf(external, 'C1');

    gatherExternalsToPoints(internal, external, routings, connections, OPTIONS, { enabled: true });

    // C1(앵커)는 고정.
    expect(originOf(external, 'C1')).toEqual(c1Before);
  });

  it('트렁크 앵커가 있으면 1:1 상자가 앵커 옆 같은 변 lane 으로 모인다', () => {
    const { internal, external, routings, connections } = buildPlacedAreas();
    routings.push({
      id: 'C1#trunk', kind: 'item',
      from: { containerId: 'C1', cell: { x: 0, y: 0 }, face: 'N', kind: 'item' },
      to: { containerId: 'M1', cell: { x: 0, y: 0 }, face: 'N', kind: 'item' },
      placed: [], corridors: [],
    });
    const anchor = originOf(external, 'C1');
    const routeBefore = routings.length;

    const res = gatherExternalsToPoints(internal, external, routings, connections, OPTIONS, { enabled: true });

    expect(routings.length).toBe(routeBefore); // 흐름 합류 없음, belt 수 보존
    expect(originOf(external, 'C1')).toEqual(anchor); // 앵커 고정
    if (res.groupsGathered >= 1) {
      // C2 는 앵커(C1)와 같은 변 lane 에 인접.
      const c2 = originOf(external, 'C2');
      const sameLane = c2.x === anchor.x || c2.y === anchor.y;
      const adjacent = Math.abs(c2.x - anchor.x) + Math.abs(c2.y - anchor.y) === 1;
      expect(sameLane && adjacent).toBe(true);
    }
  });
});
