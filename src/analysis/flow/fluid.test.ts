/**
 * 유체 — 관망은 용량 무한의 풀이다. 누가 넣고 누가 빼나, 모자라면 비례로 나눈다.
 *
 * 머신 프로토타입은 3×3 에 유체 상자 둘: **입력은 W 면 가운데**, **출력은 E 면 가운데**.
 * 그래서 origin (ox,oy) 인 머신의 입력 칸은 (ox−1, oy+1), 출력 칸은 (ox+3, oy+1) 이다.
 */

import { describe, expect, it } from 'vitest';
import { analyzeLayout, machineVerdictAt } from './build';
import type { FlowCtx, FlowResult, MachineVerdict } from './types';
import { EntityType, createEmptyGrid, getCell, type Direction, type LayoutGrid } from '../../types/layout';
import type { Entity, Module, Recipe } from '../../types/gameData';
import type { InfinityPipeSettings, InfinitySettings } from '../../types/blueprint';

const conn = (dx: number, dy: number, direction: number) => ({
  // 회전 0 · 90 · 180 · 270 — 이 시험은 회전 0 만 쓴다.
  positions: [{ x: dx, y: dy }, { x: -dy, y: dx }, { x: -dx, y: -dy }, { x: dy, y: -dx }],
  direction,
});

const PLANT = {
  id: 1, name: 'plant', localised_name: 'plant', type: 'assembling-machine',
  tile_width: 3, tile_height: 3, crafting_speed: 1,
  fluid_boxes: [
    { index: 0, production_type: 'input', connections: [conn(-1, 0, 12)] },
    { index: 1, production_type: 'output', connections: [conn(1, 0, 4)] },
  ],
} as unknown as Entity;

const fluid = (name: string, amount: number) => ({ name, amount, type: 'fluid' as const });
const item = (name: string, amount: number) => ({ name, amount, type: 'item' as const });
const recipe = (name: string, ingredients: Recipe['ingredients'], products: Recipe['products']): Recipe =>
  ({ id: 1, name, localised_name: name, category: 'crafting', energy_required: 1, ingredients, products }) as Recipe;

function ctx(): FlowCtx {
  return {
    entityMap: new Map<string, Entity>([
      ['plant', PLANT],
      ['pipe', { name: 'pipe', type: 'pipe', tile_width: 1, tile_height: 1 } as Entity],
      ['pipe-to-ground', { name: 'pipe-to-ground', type: 'pipe-to-ground', tile_width: 1, tile_height: 1, max_underground_distance: 10 } as Entity],
    ]),
    recipeMap: new Map(
      [
        recipe('boil', [fluid('gas', 10)], [fluid('steam', 10)]),       // gas 10/s → steam 10/s
        recipe('use-20', [fluid('steam', 20)], [item('work', 1)]),       // steam 20/s
        recipe('use-10', [fluid('steam', 10)], [item('work', 1)]),       // steam 10/s
        recipe('use-5', [fluid('steam', 5)], [item('work', 1)]),         // steam 5/s
      ].map((r) => [r.name, r]),
    ),
    moduleMap: new Map<string, Module>(),
    inserterOverrides: { arm: { throughput: 10 } },
  };
}

let nextId = 0;
function put(grid: LayoutGrid, x: number, y: number, patch: Record<string, unknown>) {
  Object.assign(getCell(grid, x, y)!, { entityId: `f${nextId++}`, isOrigin: true, direction: 0, ...patch });
}
function plant(grid: LayoutGrid, ox: number, oy: number, rec: string) {
  const id = `p${nextId++}`;
  for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) {
    Object.assign(getCell(grid, ox + dx, oy + dy)!, {
      entityId: id, entityName: 'plant', entityType: EntityType.Assembler, direction: 0,
      tileOffset: { x: dx, y: dy }, isOrigin: dx === 0 && dy === 0, recipe: dx === 0 && dy === 0 ? rec : undefined,
    });
  }
}
const pipe = (g: LayoutGrid, x: number, y: number) => put(g, x, y, { entityType: EntityType.Pipe, entityName: 'pipe' });
const infPipe = (g: LayoutGrid, x: number, y: number, s: InfinityPipeSettings) =>
  put(g, x, y, { entityType: EntityType.InfinityPipe, entityName: 'infinity-pipe', infinitySettings: s });
const supplyGas = (g: LayoutGrid, x: number, y: number) => infPipe(g, x, y, { name: 'gas', percentage: 1, mode: 'at-least' });
const sinkSteam = (g: LayoutGrid, x: number, y: number) => infPipe(g, x, y, { name: 'steam', percentage: 0, mode: 'at-most' });
/** 아이템 산출을 머신 아래 가운데에서 회수 — 팔 (ox+1, oy+3) 이 N 에서 집어 (ox+1, oy+4) 상자에. */
function drainBelow(g: LayoutGrid, ox: number, oy: number) {
  put(g, ox + 1, oy + 3, { entityType: EntityType.Inserter, entityName: 'arm', direction: 0 as Direction });
  put(g, ox + 1, oy + 4, {
    entityType: EntityType.InfinityChest, entityName: 'infinity-chest',
    infinitySettings: { remove_unfiltered_items: true, filters: [] } as InfinitySettings,
  });
}

const at = (r: FlowResult, x: number, y: number): MachineVerdict => machineVerdictAt(r, x, y)!;

describe('유체 관망', () => {
  it('무한파이프 공급 → 머신 → 무한파이프 회수면 100% — 유체 머신도 이제 판정한다', () => {
    const g = createEmptyGrid(12, 8);
    plant(g, 2, 2, 'boil');
    supplyGas(g, 1, 3);
    sinkSteam(g, 5, 3);
    const v = at(analyzeLayout(g, ctx()), 2, 2);
    expect(v.state).toBe('full');
    expect(v.unknown).toEqual([]);
    expect(v.inputs).toEqual([{ item: 'gas', got: 10, need: 10, fluid: true }]);
  });

  it('유체 재료가 어느 관망에도 안 닿으면 0% — 까닭은 관', () => {
    const g = createEmptyGrid(12, 8);
    plant(g, 2, 2, 'boil');
    sinkSteam(g, 5, 3);
    const v = at(analyzeLayout(g, ctx()), 2, 2);
    expect(v.state).toBe('short');
    expect(v.u).toBe(0);
    expect(v.limit).toEqual({ side: 'input', item: 'gas', by: 'pipe' });
  });

  /** P(boil, steam 10/s) 의 E 칸 → 파이프 → C 의 W 칸. */
  function chain(consumer: string, link: 'pipe' | 'underground'): LayoutGrid {
    const g = createEmptyGrid(20, 10);
    plant(g, 2, 2, 'boil');
    supplyGas(g, 1, 3);
    if (link === 'pipe') {
      pipe(g, 5, 3);
      pipe(g, 6, 3);
      pipe(g, 7, 3);
      plant(g, 8, 2, consumer);
      drainBelow(g, 8, 2);
    } else {
      // 지하 짝: 지표 쪽이 머신을 본다(입구 W 가 P 쪽, 출구 E 가 C 쪽). 사이에 아무것도 없어도 된다.
      put(g, 5, 3, { entityType: EntityType.PipeUnderground, entityName: 'pipe-to-ground', direction: 12 });
      put(g, 10, 3, { entityType: EntityType.PipeUnderground, entityName: 'pipe-to-ground', direction: 4 });
      plant(g, 11, 2, consumer);
      drainBelow(g, 11, 2);
    }
    return g;
  }

  it('생산자가 모자라면 소비자가 굶는다 — 공급 10 · 수요 20 → 50%', () => {
    const r = analyzeLayout(chain('use-20', 'pipe'), ctx());
    expect(at(r, 2, 2).state).toBe('full');
    const c = at(r, 8, 2);
    expect(c.u).toBeCloseTo(0.5);
    expect(c.limit).toEqual({ side: 'input', item: 'steam', by: 'pipe' });
  });

  it('생산자가 넘치면 생산자가 막힌다 — 공급 10 · 수요 5 → 생산자 50%', () => {
    const r = analyzeLayout(chain('use-5', 'pipe'), ctx());
    expect(at(r, 8, 2).state).toBe('full');
    const p = at(r, 2, 2);
    expect(p.u).toBeCloseTo(0.5);
    expect(p.limit).toEqual({ side: 'output', item: 'steam', by: 'pipe' });
  });

  it('지하 파이프 짝을 건너도 한 관망이다', () => {
    const r = analyzeLayout(chain('use-10', 'underground'), ctx());
    expect(at(r, 2, 2).state).toBe('full');
    expect(at(r, 11, 2).state).toBe('full');
  });

  it('지하 파이프가 머신을 등지면 안 닿는다', () => {
    const g = chain('use-10', 'underground');
    getCell(g, 5, 3)!.direction = 4; // 지표 쪽이 P 를 등진다
    const r = analyzeLayout(g, ctx());
    expect(at(r, 2, 2).limit).toEqual({ side: 'output', item: 'steam', by: 'pipe' });
  });

  it('소비자 둘이 모자란 공급을 비례로 나눈다 — 공급 10 · 수요 10+10 → 각 50%', () => {
    const g = createEmptyGrid(20, 14);
    plant(g, 2, 2, 'boil');
    supplyGas(g, 1, 3);
    for (let x = 5; x <= 7; x++) pipe(g, x, 3);
    for (let y = 4; y <= 8; y++) pipe(g, 6, y);
    pipe(g, 7, 8);
    plant(g, 8, 2, 'use-10');
    drainBelow(g, 8, 2);
    plant(g, 8, 7, 'use-10');
    drainBelow(g, 8, 7);
    const r = analyzeLayout(g, ctx());
    expect(at(r, 8, 2).u).toBeCloseTo(0.5);
    expect(at(r, 8, 7).u).toBeCloseTo(0.5);
    expect(at(r, 2, 2).state).toBe('full');
  });

  it('공급 무한파이프가 붙은 관망에는 생산자가 못 넣는다 — 늘 차 있다', () => {
    const g = createEmptyGrid(12, 8);
    plant(g, 2, 2, 'boil');
    supplyGas(g, 1, 3);
    infPipe(g, 5, 3, { name: 'steam', percentage: 1, mode: 'at-least' });
    const v = at(analyzeLayout(g, ctx()), 2, 2);
    expect(v.u).toBe(0);
    expect(v.limit).toEqual({ side: 'output', item: 'steam', by: 'pipe' });
  });
});
