import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEmptyCell, EntityType } from '../../types/layout';
import { useGameDataStore, type Entity } from '../../store/gameDataStore';
import type { Area, Container, PlacedCell } from './containerModel';
import type { RouteOptions } from './routeFallback';
import { routeWithFallback } from './routeFallback';
import { inwardRingFace } from './areaUnification';

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처
// ─────────────────────────────────────────────────────────────────────────────

const MACHINE: Entity = { id: 1, name: 'asm', localised_name: 'asm', type: 'assembling-machine', tile_width: 3, tile_height: 3, crafting_speed: 1 } as Entity;
const BELT: Entity = { id: 2, name: 'transport-belt', localised_name: 'belt', type: 'transport-belt', tile_width: 1, tile_height: 1, belt_speed: 0.09375 } as Entity;
const INSERTER: Entity = { id: 3, name: 'inserter', localised_name: 'ins', type: 'inserter', tile_width: 1, tile_height: 1, inserter_rotation_speed: 0.5 } as Entity;

const OPTIONS: RouteOptions = {
  beltEntityName: 'transport-belt',
  inserterEntityName: 'inserter',
  pipeEntityName: 'pipe',
  preferUnderground: false,
};

beforeEach(() => {
  vi.spyOn(useGameDataStore, 'getState').mockReturnValue({
    recipeMap: new Map(),
    entityMap: new Map([['asm', MACHINE], ['transport-belt', BELT], ['inserter', INSERTER]]),
  } as unknown as ReturnType<typeof useGameDataStore.getState>);
});
afterEach(() => vi.restoreAllMocks());

function machineContainer(id: string, x: number, y: number): Container {
  return { id, kind: 'machine', entityName: 'asm', origin: { x, y }, size: { w: 3, h: 3 }, recipeName: 'gear' };
}
function machineCells(c: Container): PlacedCell[] {
  const out: PlacedCell[] = [];
  for (let dx = 0; dx < c.size.w; dx++) for (let dy = 0; dy < c.size.h; dy++) {
    out.push({ x: c.origin.x + dx, y: c.origin.y + dy, cell: { ...createEmptyCell(), entityId: c.id, entityName: 'asm', entityType: EntityType.Assembler, isOrigin: dx === 0 && dy === 0 } });
  }
  return out;
}
function chestContainer(id: string, x: number, y: number): Container {
  return { id, kind: 'infinity-chest', entityName: 'infinity-chest', origin: { x, y }, size: { w: 1, h: 1 }, content: 'iron-plate' };
}
function chestCell(c: Container): PlacedCell {
  return { x: c.origin.x, y: c.origin.y, cell: { ...createEmptyCell(), entityId: c.id, entityName: 'infinity-chest', entityType: EntityType.InfinityChest, isOrigin: true } };
}

// ─────────────────────────────────────────────────────────────────────────────
// inwardRingFace — 변 → 내부향 면
// ─────────────────────────────────────────────────────────────────────────────

describe('inwardRingFace', () => {
  const rb = { x0: 0, y0: 0, x1: 10, y1: 10 };
  const interior = machineContainer('M', 4, 4); // 중심 ≈ (5.5, 5.5)

  it('서벽(x=x0) → E', () => {
    expect(inwardRingFace({ x: 0, y: 5 }, rb, interior)).toBe('E');
  });
  it('동벽(x=x1) → W', () => {
    expect(inwardRingFace({ x: 10, y: 5 }, rb, interior)).toBe('W');
  });
  it('북벽(y=y0) → S', () => {
    expect(inwardRingFace({ x: 5, y: 0 }, rb, interior)).toBe('S');
  });
  it('남벽(y=y1) → N', () => {
    expect(inwardRingFace({ x: 5, y: 10 }, rb, interior)).toBe('N');
  });
  it('코너(두 변 동시)는 머신 쪽 면을 고른다', () => {
    // 좌상단 코너 (0,0): 머신이 남동쪽 → 우세축이 가까운 변. 머신 중심 (5.5,5.5)
    // 와의 dx=dy 동률 시 E 우선(score 동률, 안정 정렬). 둘 다 내부향이면 OK.
    const f = inwardRingFace({ x: 0, y: 0 }, rb, interior);
    expect(['E', 'S']).toContain(f);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// routeWithFallback + inwardPortFace — 게이트웨이 제약 플러밍
// ─────────────────────────────────────────────────────────────────────────────

describe('routeWithFallback inwardPortFace', () => {
  // 서벽 상자(1,5) + 동쪽 머신(5..7). 제약 E → 인서터는 상자 동쪽(내부향) 셀에.
  function build() {
    const machine = machineContainer('M', 5, 5);
    const chest = chestContainer('C', 1, 5);
    const internal: Area = { kind: 'internal', containers: [machine], placed: machineCells(machine), undergroundCorridors: [] };
    const external: Area = { kind: 'external', containers: [chest], placed: [chestCell(chest)], undergroundCorridors: [] };
    return { internal, external, chest, machine };
  }

  it('E 제약이면 producer 인서터가 상자의 동쪽(수평) 셀에 놓인다', () => {
    const { internal, external, chest } = build();
    const attempt = routeWithFallback(
      chest, internal.containers[0], 'item', internal,
      { ...OPTIONS, inwardPortFace: { containerId: 'C', face: 'E' } },
      external,
    );
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) return;
    const inserters = attempt.routing.placed.filter((p) => p.cell.entityType === EntityType.Inserter);
    // 상자 둘레 인서터는 동쪽 셀(2,5) 하나뿐 — 수직(같은 x=1) 인서터 없음.
    const adjToChest = inserters.filter((p) => Math.abs(p.x - chest.origin.x) + Math.abs(p.y - chest.origin.y) === 1);
    expect(adjToChest).toHaveLength(1);
    expect(adjToChest[0]).toMatchObject({ x: 2, y: 5 });
  });

  it('제약 없이도 정상 라우팅(기존 동작 보존)', () => {
    const { internal, external, chest } = build();
    const attempt = routeWithFallback(chest, internal.containers[0], 'item', internal, OPTIONS, external);
    expect(attempt.ok).toBe(true);
  });

  it('상자 면이 제약과 어긋나는 그리디는 폐기되고 제약 면으로만 라우팅', () => {
    // S 로 강제하면 상자 남쪽(1,6) 면만 허용. producer 인서터가 거기에 놓이거나,
    // 막히면 실패. 어느 경우든 동쪽(2,5) 수평 인서터는 생기지 않는다.
    const { internal, external, chest } = build();
    const attempt = routeWithFallback(
      chest, internal.containers[0], 'item', internal,
      { ...OPTIONS, inwardPortFace: { containerId: 'C', face: 'S' } },
      external,
    );
    if (attempt.ok) {
      const horiz = attempt.routing.placed.filter(
        (p) => p.cell.entityType === EntityType.Inserter && p.x === 2 && p.y === 5,
      );
      expect(horiz).toHaveLength(0);
    }
  });
});
