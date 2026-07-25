import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEmptyCell, EntityType } from '../../types/layout';
import { useGameDataStore, type Entity, type Recipe } from '../../store/gameDataStore';
import type { Area, Container, PendingConnection, PlacedCell, Routing } from './containerModel';
import type { RouteOptions } from './routeFallback';
import { wrapExternalsAroundPerimeter, dragExternalContainer, boundsOfCells } from './areaUnification';

// ─────────────────────────────────────────────────────────────────────────────
// 드래그 재라우팅 ring 가둠 — 단일 외곽 ring 불변식
//
// 외부상자를 한 점으로 모으는(드래그) 동안 재라우팅된 belt 가 ring(= 현재 레이아웃
// 직사각형) 바깥으로 새면 안 된다. dragExternalContainer 가 routingBounds 를 자동
// 주입하므로, 성공한 드래그의 모든 라우팅 셀은 레이아웃 bbox 안에 머물러야 한다.
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
afterEach(() => { vi.restoreAllMocks(); });

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

function buildPlacedAreas() {
  const m1 = machineContainer('M1', 5, 5);
  const m2 = machineContainer('M2', 5, 12);
  const internal: Area = {
    kind: 'internal', containers: [m1, m2],
    placed: [...machineCells(m1), ...machineCells(m2)], undergroundCorridors: [],
  };
  const external: Area = {
    kind: 'external', containers: [chestContainer('C1'), chestContainer('C2')],
    placed: [], undergroundCorridors: [],
  };
  const connections: PendingConnection[] = [
    { producerId: 'C1', consumerId: 'M1', kind: 'item' },
    { producerId: 'C2', consumerId: 'M2', kind: 'item' },
  ];
  const routings: Routing[] = [];
  wrapExternalsAroundPerimeter(internal, external, routings, connections, OPTIONS);
  return { internal, external, routings };
}

const routingCells = (routings: Routing[]) =>
  routings.flatMap((r) => r.placed.map((p) => ({ x: p.x, y: p.y })));

describe('dragExternalContainer ring 가둠', () => {
  it('성공한 드래그의 라우팅 셀은 레이아웃 bbox(ring) 안에 머문다', () => {
    const { internal, external, routings } = buildPlacedAreas();

    // 같은 변 위 인접 셀로의 작은 이동(한 점으로 모으는 방향) — 성공해야 하는 케이스.
    const c1 = { ...external.containers.find((c) => c.id === 'C1')!.origin };
    const newOrigin = { x: c1.x + 1, y: c1.y };

    const res = dragExternalContainer('C1', newOrigin, internal, external, routings, OPTIONS);
    expect(res.ok).toBe(true);

    // 이동·재라우팅 후의 레이아웃 직사각형 = ring.
    const ring = boundsOfCells([
      ...internal.placed.map((p) => ({ x: p.x, y: p.y })),
      ...external.placed.map((p) => ({ x: p.x, y: p.y })),
    ]);
    for (const c of routingCells(routings)) {
      expect(c.x).toBeGreaterThanOrEqual(ring.x0);
      expect(c.x).toBeLessThanOrEqual(ring.x1);
      expect(c.y).toBeGreaterThanOrEqual(ring.y0);
      expect(c.y).toBeLessThanOrEqual(ring.y1);
    }
  });

  it('호출자가 지정한 routingBounds 는 존중(자동 주입이 덮어쓰지 않음)', () => {
    const { internal, external, routings } = buildPlacedAreas();
    // 불가능할 만큼 좁은 bounds 를 강제하면 드래그가 거부돼야 한다(자동 bbox 로 무시되지 않음).
    const tiny = { x0: 0, y0: 0, x1: 0, y1: 0 };
    const target = { ...external.containers.find((c) => c.id === 'C2')!.origin };
    const res = dragExternalContainer(
      'C1', { x: target.x, y: target.y - 2 }, internal, external, routings,
      { ...OPTIONS, routingBounds: tiny },
    );
    expect(res.ok).toBe(false);
  });
});
