/**
 * 가동률 분석 — **의도**를 시험한다(스냅샷 수치가 아니다).
 *
 * 번호는 계획서 `tempPlanDocs/가동률-검사/가동률-검사.md` §6 Step 1 의 시험 표와 같다.
 * 좌표 그림에서 인서터 방향은 **픽업 방향**이다(향한 쪽에서 집고 반대쪽에 놓는다).
 */

import { describe, expect, it } from 'vitest';
import { analyzeLayout, machineVerdictAt } from './build';
import type { FlowCtx, FlowResult, MachineVerdict } from './types';
import { computeBeltFlowAt } from '../beltFlow';
import {
  EntityType,
  createEmptyGrid,
  getCell,
  type Direction,
  type LayoutGrid,
} from '../../types/layout';
import type { Entity, Module, Recipe } from '../../types/gameData';
import type { InfinitySettings } from '../../types/blueprint';

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처
// ─────────────────────────────────────────────────────────────────────────────

const ent = (name: string, extra: Partial<Entity> = {}): Entity =>
  ({ id: 1, name, localised_name: name, type: 'test', tile_width: 1, tile_height: 1, ...extra }) as Entity;

const item = (name: string, amount: number) => ({ name, amount, type: 'item' as const });
const recipe = (name: string, ingredients: Recipe['ingredients'], products: Recipe['products'], time = 1): Recipe =>
  ({ id: 1, name, localised_name: name, category: 'crafting', energy_required: time, ingredients, products }) as Recipe;

/** 벨트 15/s → 레인 7.5/s · 느린 벨트 2/s → 레인 1/s. */
const ENTITIES: Entity[] = [
  ent('transport-belt', { belt_speed: 15 / 480 }),
  ent('slow-belt', { belt_speed: 2 / 480 }),
  ent('underground-belt', { belt_speed: 15 / 480 }),
  ent('assembler', { crafting_speed: 1, tile_width: 3, tile_height: 3 }),
  ent('lab', { tile_width: 3, tile_height: 3 }),
  ent('inserter'),
  ent('slow-inserter'),
  ent('unscaled-inserter'),
];

const RECIPES: Recipe[] = [
  recipe('gear', [item('plate', 2)], [item('gear', 1)]),                 // plate 2/s → gear 1/s
  recipe('widget', [item('gear', 1)], [item('widget', 1)], 2),           // gear 0.5/s → widget 0.5/s
  recipe('rod', [item('gear', 1)], [item('rod', 1)]),                    // gear 1/s → rod 1/s
  recipe('rodbox', [item('rod', 1)], [item('rodbox', 1)]),               // rod 1/s → rodbox 1/s
  recipe('eat', [item('plate', 1)], [item('crumb', 1)]),                 // plate 1/s
  recipe('fast-eat', [item('plate', 1)], [item('crumb', 1)], 0.5),       // plate 2/s
  recipe('circuit', [item('plate', 1), item('cable', 3)], [item('circuit', 1)]), // plate 1/s · cable 3/s
  recipe('mystery', [item('plate', 1)], [{ name: 'dust', type: 'item' }]),       // 수율 미상
  recipe('plastic', [item('coal', 1), { name: 'gas', amount: 20, type: 'fluid' }], [item('plastic', 2)]),
];

function makeCtx(): FlowCtx {
  return {
    entityMap: new Map(ENTITIES.map((e) => [e.name, e])),
    recipeMap: new Map(RECIPES.map((r) => [r.name, r])),
    moduleMap: new Map<string, Module>(),
    // 인서터는 저울을 override 로 고정한다(프로토타입 회전 속도 없이도 결정적).
    inserterOverrides: { inserter: { throughput: 4 }, 'slow-inserter': { throughput: 1 } },
  };
}

let nextId = 0;

function put(grid: LayoutGrid, x: number, y: number, patch: Record<string, unknown>) {
  Object.assign(getCell(grid, x, y)!, { entityId: `t${nextId++}`, isOrigin: true, direction: 0, ...patch });
}

function belt(grid: LayoutGrid, x: number, y: number, dir: Direction, name = 'transport-belt') {
  put(grid, x, y, { entityType: EntityType.Belt, entityName: name, direction: dir });
}
function beltRow(grid: LayoutGrid, y: number, x1: number, x2: number, name = 'transport-belt') {
  for (let x = x1; x <= x2; x++) belt(grid, x, y, 4, name);
}
/** 공급 상자 — `at-least` 필터(자동 배치가 합성하는 모양). */
function supply(grid: LayoutGrid, x: number, y: number, it: string) {
  put(grid, x, y, {
    entityType: EntityType.InfinityChest, entityName: 'infinity-chest',
    infinitySettings: { remove_unfiltered_items: false, filters: [{ name: it, count: 100, mode: 'at-least', index: 1 }] } as InfinitySettings,
  });
}
/** 회수 상자 — `remove_unfiltered_items`. */
function sink(grid: LayoutGrid, x: number, y: number) {
  put(grid, x, y, {
    entityType: EntityType.InfinityChest, entityName: 'infinity-chest',
    infinitySettings: { remove_unfiltered_items: true, filters: [] } as InfinitySettings,
  });
}
function arm(grid: LayoutGrid, x: number, y: number, pickDir: Direction, name = 'inserter') {
  put(grid, x, y, { entityType: EntityType.Inserter, entityName: name, direction: pickDir });
}
function machine(grid: LayoutGrid, ox: number, oy: number, rec: string | undefined, name = 'assembler', type: EntityType = EntityType.Assembler) {
  const id = `m${nextId++}`;
  for (let dx = 0; dx < 3; dx++) {
    for (let dy = 0; dy < 3; dy++) {
      Object.assign(getCell(grid, ox + dx, oy + dy)!, {
        entityId: id, entityName: name, entityType: type, direction: 0,
        tileOffset: { x: dx, y: dy }, isOrigin: dx === 0 && dy === 0,
        recipe: dx === 0 && dy === 0 ? rec : undefined,
      });
    }
  }
}

/** 머신 (ox,oy) 왼쪽 가운데로 공급 상자를 직결한다: 상자(ox-2) → 팔(ox-1, W 집기) → 머신. */
function feedLeft(grid: LayoutGrid, ox: number, oy: number, it: string, armName = 'inserter') {
  supply(grid, ox - 2, oy + 1, it);
  arm(grid, ox - 1, oy + 1, 12, armName);
}
/** 머신 (ox,oy) 오른쪽 가운데로 회수 상자를 직결한다: 머신 → 팔(ox+3, W 집기) → 상자(ox+4). */
function drainRight(grid: LayoutGrid, ox: number, oy: number, armName = 'inserter') {
  arm(grid, ox + 3, oy + 1, 12, armName);
  sink(grid, ox + 4, oy + 1);
}

const at = (r: FlowResult, x: number, y: number): MachineVerdict => machineVerdictAt(r, x, y)!;

// ─────────────────────────────────────────────────────────────────────────────
// 시험
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeLayout — 머신 가동률', () => {
  it('① 공급 = 소비인 머신은 100%', () => {
    const grid = createEmptyGrid(12, 10);
    machine(grid, 3, 3, 'gear');
    feedLeft(grid, 3, 3, 'plate');
    drainRight(grid, 3, 3);
    const v = at(analyzeLayout(grid, makeCtx()), 3, 3);
    expect(v.state).toBe('full');
    expect(v.u).toBeCloseTo(1);
    expect(v.inputs).toEqual([{ item: 'plate', got: 2, need: 2 }]);
  });

  /**
   * P(gear 1/s) ─▶ 벨트 ─▶ Q(widget, gear 0.5/s)
   *
   *   y=4..6  P (2,4)            y=8  벨트 → → → (x=1..12, 막다른 끝)
   *   y=7     P 출력 팔 (3,7) N    y=9  Q 입력 팔 (9,9) N  ·  Q (8,10)
   */
  function overproduce(): LayoutGrid {
    const grid = createEmptyGrid(16, 16);
    machine(grid, 2, 4, 'gear');
    feedLeft(grid, 2, 4, 'plate');
    arm(grid, 3, 7, 0);
    beltRow(grid, 8, 1, 12);
    arm(grid, 9, 9, 0);
    machine(grid, 8, 10, 'widget');
    drainRight(grid, 8, 10);
    return grid;
  }

  it('② 과잉 생산 → 생산자가 미달(출력 막힘) · 소비자는 100%', () => {
    const r = analyzeLayout(overproduce(), makeCtx());
    const p = at(r, 2, 4);
    const q = at(r, 8, 10);
    expect(q.state).toBe('full');
    expect(p.state).toBe('short');
    expect(p.u).toBeCloseTo(0.5);
    expect(p.limit).toEqual({ side: 'output', item: 'gear', by: 'belt' });
  });

  it('② 대조 — 막다른 끝에 회수를 붙이면 생산자도 100% (정체가 풀린다)', () => {
    const grid = overproduce();
    arm(grid, 12, 7, 8); // (12,8) 에서 집어 북쪽 (12,6) 에
    sink(grid, 12, 6);
    const r = analyzeLayout(grid, makeCtx());
    expect(at(r, 2, 4).state).toBe('full');
  });

  /**
   * 느린 벨트(레인 1/s) 에 공급 팔 둘 — 소비자 fast-eat 은 판 2/s.
   * 팔이 **같은 쪽**이면 둘 다 먼 레인 하나에 실어 1/s, **양쪽**이면 두 레인에 실어 2/s.
   */
  function laneGrid(bothSides: boolean): LayoutGrid {
    const grid = createEmptyGrid(16, 16);
    beltRow(grid, 5, 1, 10, 'slow-belt');
    supply(grid, 2, 3, 'plate');
    arm(grid, 2, 4, 0); // 북쪽에서 → 먼(남) 레인
    if (bothSides) {
      supply(grid, 4, 7, 'plate');
      arm(grid, 4, 6, 8); // 남쪽에서 → 먼(북) 레인
    } else {
      supply(grid, 4, 3, 'plate');
      arm(grid, 4, 4, 0);
    }
    arm(grid, 8, 6, 0); // (8,5) 에서 집어 (8,7) 머신에
    machine(grid, 7, 7, 'fast-eat');
    drainRight(grid, 7, 7);
    return grid;
  }

  it('③ 한쪽 팔들이 싣는 줄은 벨트 절반에서 막힌다 → 소비자 미달', () => {
    const r = analyzeLayout(laneGrid(false), makeCtx());
    const v = at(r, 7, 7);
    expect(v.state).toBe('short');
    expect(v.u).toBeCloseTo(0.5);
    expect(v.limit).toEqual({ side: 'input', item: 'plate', by: 'belt' });
    const cell = r.belts.get('6,5')!;
    expect(cell.lanes.right.rate).toBeCloseTo(1);
    expect(cell.lanes.right.saturated).toBe(true);
    expect(cell.lanes.left.rate).toBeCloseTo(0);
  });

  it('③ 대조 — 양쪽에서 실으면 두 레인이 차서 100%', () => {
    const r = analyzeLayout(laneGrid(true), makeCtx());
    expect(at(r, 7, 7).state).toBe('full');
  });

  /**
   * 본선(느린 벨트, y=5, 동쪽) 오른(남) 레인을 P1 이 채운다. P2 는 남쪽 지선(x=6, 북쪽으로)에서
   * 본선 (6,5) 로 **옆에서** 올라탄다 — 닿은 쪽이 남쪽이라 오른 레인으로 접힌다(③). 본선에 뒤
   * 유입이 있으니 직진이 먼저다(⑦).
   */
  function mergeGrid(withP1: boolean): LayoutGrid {
    const grid = createEmptyGrid(16, 12);
    beltRow(grid, 5, 0, 12, 'slow-belt');
    machine(grid, 2, 1, 'gear');
    feedLeft(grid, 2, 1, 'plate');
    if (withP1) arm(grid, 3, 4, 0); // (3,3) P1 → (3,5) 본선, 북쪽에서 → 먼(남=오른) 레인
    for (let y = 6; y <= 8; y++) belt(grid, 6, y, 0, 'slow-belt');
    machine(grid, 8, 6, 'gear');
    arm(grid, 7, 7, 4); // (8,7) P2 → (6,7) 지선
    supply(grid, 12, 7, 'plate');
    arm(grid, 11, 7, 4);
    arm(grid, 11, 4, 8); // (11,5) 에서 집어 (11,3) 회수에
    sink(grid, 11, 3);
    return grid;
  }

  it('④ 합류 칸에서 직진이 레인을 채우면 옆 유입의 생산자가 미달', () => {
    const r = analyzeLayout(mergeGrid(true), makeCtx());
    expect(at(r, 2, 1).state).toBe('full');
    const p2 = at(r, 8, 6);
    expect(p2.state).toBe('short');
    expect(p2.u).toBeCloseTo(0);
    expect(p2.limit).toEqual({ side: 'output', item: 'gear', by: 'belt' });
  });

  it('④ 대조 — 직진이 비면 옆 유입이 100%', () => {
    const r = analyzeLayout(mergeGrid(false), makeCtx());
    expect(at(r, 8, 6).state).toBe('full');
  });

  /**
   * circuit 머신(plate 1/s · cable 3/s) 이 두 벨트에서 제 재료를 각각 받는다.
   *   y=1 판 벨트 ← 공급 팔 (2,0)   ·   y=9 선 벨트 ← 공급 팔 (2,10)
   *   머신 (4,4)~(6,6) · 판 팔 (5,2)→(5,3)?  — 판 팔은 (5,3) 에서 N 집기: (5,2) 벨트…
   */
  function circuitGrid(): LayoutGrid {
    const grid = createEmptyGrid(14, 14);
    beltRow(grid, 2, 1, 8);
    supply(grid, 2, 0, 'plate');
    arm(grid, 2, 1, 0);          // (2,0) → (2,2)
    arm(grid, 5, 3, 0);          // (5,2) 판 벨트 → (5,4) 머신
    machine(grid, 4, 4, 'circuit');
    arm(grid, 5, 7, 8);          // (5,8) 선 벨트 → (5,6) 머신
    beltRow(grid, 8, 1, 8);
    supply(grid, 2, 10, 'cable');
    arm(grid, 2, 9, 8);          // (2,10) → (2,8)
    drainRight(grid, 4, 4);
    return grid;
  }

  it('⑤ 다재료 머신은 벨트에 실린 것으로 제 재료를 고른다', () => {
    const grid = circuitGrid();
    const r = analyzeLayout(grid, makeCtx());
    const v = at(r, 4, 4);
    expect(v.state).toBe('full');
    expect(v.inputs).toEqual(expect.arrayContaining([
      { item: 'plate', got: 1, need: 1 },
      { item: 'cable', got: 3, need: 3 },
    ]));
    const cableTap = r.belts.get('5,8')!.taps.find((t) => t.kind === 'pick')!;
    expect(cableTap.rate).toBeCloseTo(3);
  });

  it('⑤ 대조 — 옛 beltFlow 는 선 벨트의 집기를 **첫 재료(판)** 율로 잡는다(결함 ㉡)', () => {
    const grid = circuitGrid();
    const old = computeBeltFlowAt(grid, 5, 8, makeCtx())!;
    expect(old.tapsAtCell.find((t) => t.kind === 'pick')!.rate).toBeCloseTo(1);
  });

  /** A(gear) → B(rod) → C(rodbox) 직결. 공급 팔·회수 팔 이름으로 병목을 고른다. */
  function chainGrid(feedArm: string, drainArm: string): LayoutGrid {
    const grid = createEmptyGrid(20, 8);
    machine(grid, 2, 2, 'gear');
    feedLeft(grid, 2, 2, 'plate', feedArm);
    arm(grid, 5, 3, 12);         // (4,3) A → (6,3) B
    machine(grid, 6, 2, 'rod');
    arm(grid, 9, 3, 12);         // (8,3) B → (10,3) C
    machine(grid, 10, 2, 'rodbox');
    drainRight(grid, 10, 2, drainArm);
    return grid;
  }

  it('⑥ 굶주림이 사슬을 타고 번진다 — A 가 굶으면 B·C 까지', () => {
    const r = analyzeLayout(chainGrid('slow-inserter', 'inserter'), makeCtx());
    const a = at(r, 2, 2);
    expect(a.u).toBeCloseTo(0.5);
    expect(a.limit).toEqual({ side: 'input', item: 'plate', by: 'arms' });
    expect(at(r, 6, 2).u).toBeCloseTo(0.5);
    expect(at(r, 10, 2).u).toBeCloseTo(0.5);
    expect(at(r, 10, 2).limit?.side).toBe('input');
  });

  it('⑦ 정체가 거꾸로 번진다 — C 의 출력이 막히면 B·A 까지', () => {
    const grid = chainGrid('inserter', 'slow-inserter');
    // C 의 회수 팔을 0.5/s 로 — slow-inserter 는 1/s 라 하나 더 느리게 덮어쓴다.
    const ctx = makeCtx();
    ctx.inserterOverrides = { ...ctx.inserterOverrides, 'slow-inserter': { throughput: 0.5 } };
    const r = analyzeLayout(grid, ctx);
    expect(at(r, 10, 2).u).toBeCloseTo(0.5);
    expect(at(r, 10, 2).limit).toEqual({ side: 'output', item: 'rodbox', by: 'arms' });
    expect(at(r, 6, 2).u).toBeCloseTo(0.5);
    expect(at(r, 2, 2).u).toBeCloseTo(0.5);
    expect(at(r, 2, 2).limit?.side).toBe('output');
  });

  /** 공급 1.5/s 인 벨트에 소비자 둘(각 1/s). */
  function priorityGrid(): LayoutGrid {
    const grid = createEmptyGrid(20, 12);
    beltRow(grid, 2, 1, 16);
    supply(grid, 2, 0, 'plate');
    arm(grid, 2, 1, 0, 'slow-inserter');
    supply(grid, 3, 0, 'plate');
    arm(grid, 3, 1, 0, 'half-inserter');
    arm(grid, 5, 3, 0);          // (5,2) → (5,4) Q1
    machine(grid, 4, 4, 'eat');
    drainRight(grid, 4, 4);
    arm(grid, 12, 3, 0);         // (12,2) → (12,4) Q2
    machine(grid, 11, 4, 'eat');
    drainRight(grid, 11, 4);
    return grid;
  }

  it('⑧ 같은 줄의 상류 소비자가 먼저 채워진다', () => {
    const ctx = makeCtx();
    ctx.inserterOverrides = { ...ctx.inserterOverrides, 'half-inserter': { throughput: 0.5 } };
    const r = analyzeLayout(priorityGrid(), ctx);
    const q1 = at(r, 4, 4);
    const q2 = at(r, 11, 4);
    expect(q1.state).toBe('full');
    expect(q2.u).toBeCloseTo(0.5);
    expect(q2.limit).toEqual({ side: 'input', item: 'plate', by: 'belt' });
  });

  it('⑨ 아무것도 안 이어진 머신은 0% — 팔이 없으니 까닭은 arms', () => {
    const grid = createEmptyGrid(8, 8);
    machine(grid, 2, 2, 'gear');
    const v = at(analyzeLayout(grid, makeCtx()), 2, 2);
    expect(v.state).toBe('short');
    expect(v.u).toBe(0);
    expect(v.limit).toEqual({ side: 'input', item: 'plate', by: 'arms' });
  });
});

describe('analyzeLayout — ⑩ 판정 불가', () => {
  it('레시피가 없으면 no-recipe · 가동률은 NaN', () => {
    const grid = createEmptyGrid(10, 8);
    machine(grid, 3, 2, undefined);
    const v = at(analyzeLayout(grid, makeCtx()), 3, 2);
    expect(v.state).toBe('unknown');
    expect(v.unknown).toEqual(['no-recipe']);
    expect(Number.isNaN(v.u)).toBe(true);
  });

  it('연구실은 kind', () => {
    const grid = createEmptyGrid(10, 8);
    machine(grid, 3, 2, undefined, 'lab', EntityType.Lab);
    expect(at(analyzeLayout(grid, makeCtx()), 3, 2).unknown).toEqual(['kind']);
  });

  it('수율 미상 산출은 비율에서 빠지고 yield — 나머지가 충분하면 판정 불가', () => {
    const grid = createEmptyGrid(12, 8);
    machine(grid, 3, 2, 'mystery');
    feedLeft(grid, 3, 2, 'plate');
    drainRight(grid, 3, 2);
    const v = at(analyzeLayout(grid, makeCtx()), 3, 2);
    expect(v.state).toBe('unknown');
    expect(v.unknown).toEqual(['yield']);
  });

  it('저울 없는 팔은 무한으로 가정하고 scale — 충분하면 판정 불가', () => {
    const grid = createEmptyGrid(12, 8);
    machine(grid, 3, 2, 'gear');
    feedLeft(grid, 3, 2, 'plate', 'unscaled-inserter');
    drainRight(grid, 3, 2);
    const v = at(analyzeLayout(grid, makeCtx()), 3, 2);
    expect(v.state).toBe('unknown');
    expect(v.unknown).toEqual(['scale']);
  });

  it('유체 재료가 있고 아이템이 충분하면 fluid 로 판정 불가 (D4)', () => {
    const grid = createEmptyGrid(12, 8);
    machine(grid, 3, 2, 'plastic');
    feedLeft(grid, 3, 2, 'coal');
    drainRight(grid, 3, 2);
    const v = at(analyzeLayout(grid, makeCtx()), 3, 2);
    expect(v.state).toBe('unknown');
    expect(v.unknown).toEqual(['fluid']);
  });

  it('유체 재료가 있어도 아이템이 모자라면 미달이 확정이다 (D4)', () => {
    const grid = createEmptyGrid(12, 8);
    machine(grid, 3, 2, 'plastic');
    feedLeft(grid, 3, 2, 'coal', 'slow-inserter');
    const ctx = makeCtx();
    ctx.inserterOverrides = { ...ctx.inserterOverrides, 'slow-inserter': { throughput: 0.25 } };
    drainRight(grid, 3, 2);
    const v = at(analyzeLayout(grid, ctx), 3, 2);
    expect(v.state).toBe('short');
    expect(v.u).toBeCloseTo(0.25);
    expect(v.unknown).toEqual(['fluid']);
  });

  it('율을 모르는 머신과 벨트를 나눠 쓰면 assumed', () => {
    const grid = createEmptyGrid(16, 12);
    beltRow(grid, 2, 1, 14);
    supply(grid, 2, 0, 'plate');
    arm(grid, 2, 1, 0);
    arm(grid, 5, 3, 0);
    machine(grid, 4, 4, undefined);
    arm(grid, 11, 3, 0);
    machine(grid, 10, 4, 'eat');
    drainRight(grid, 10, 4);
    const r = analyzeLayout(grid, makeCtx());
    expect(at(r, 10, 4).assumed).toBe(true);
    expect(at(r, 10, 4).state).toBe('full');
  });
});

describe('analyzeLayout — ⑪ 벨트 칸 흐름(옛 beltFlow 시험의 의도를 정상상태로)', () => {
  it('투입기 지점마다 흐름량이 달라진다 — 드랍 둘 + 픽업 둘', () => {
    const grid = createEmptyGrid(14, 10);
    beltRow(grid, 5, 1, 10);
    supply(grid, 2, 3, 'plate');
    arm(grid, 2, 4, 0);          // +4 @ x=2, 북쪽에서 → 오른 레인
    supply(grid, 5, 7, 'plate');
    arm(grid, 5, 6, 8);          // +4 @ x=5, 남쪽에서 → 왼 레인(한 레인은 7.5/s 라 8 을 못 싣는다)
    arm(grid, 7, 4, 8);          // −4 @ x=7 → 회수 (7,3)
    sink(grid, 7, 3);
    arm(grid, 9, 4, 8);          // −4 @ x=9 → 회수 (9,3)
    sink(grid, 9, 3);
    const r = analyzeLayout(grid, makeCtx());
    const flow = (x: number) => {
      const c = r.belts.get(`${x},5`)!;
      return c.lanes.left.rate + c.lanes.right.rate;
    };
    expect(flow(3)).toBeCloseTo(4);
    expect(flow(6)).toBeCloseTo(8);
    expect(flow(8)).toBeCloseTo(4);
    expect(flow(10)).toBeCloseTo(0); // 마지막 픽업 뒤는 비어 있다(정상상태)
    expect(r.belts.get('3,5')!.lanes.right.items).toEqual([{ item: 'plate', rate: 4 }]);
  });

  it('하류에 소비가 없으면 투입이 막힌다 — 옛 계산은 흐른다고 했던 자리(결함 ㉢)', () => {
    const grid = createEmptyGrid(14, 8);
    beltRow(grid, 5, 1, 10);
    supply(grid, 2, 3, 'plate');
    arm(grid, 2, 4, 0);
    const r = analyzeLayout(grid, makeCtx());
    expect(r.belts.get('6,5')!.lanes.right.rate).toBe(0);
    const tap = r.belts.get('2,5')!.taps[0];
    expect(tap.rate).toBe(0);
    expect(tap.refused).toBeCloseTo(4);
    expect(computeBeltFlowAt(grid, 6, 5, makeCtx())!.outflow).toBeCloseTo(4);
  });

  it('머신 생산율이 인서터 처리량보다 작으면 머신율로 캡', () => {
    const grid = createEmptyGrid(14, 10);
    beltRow(grid, 5, 1, 10);
    machine(grid, 3, 1, 'gear');
    feedLeft(grid, 3, 1, 'plate');
    arm(grid, 4, 4, 0);          // (4,3) 머신 → (4,5)
    arm(grid, 9, 4, 8);
    sink(grid, 9, 3);
    const r = analyzeLayout(grid, makeCtx());
    expect(r.belts.get('6,5')!.lanes.right.rate).toBeCloseTo(1);
    expect(r.belts.get('6,5')!.lanes.right.items[0].item).toBe('gear');
  });

  it('지하벨트 페어를 건너 흐름이 이어진다', () => {
    const grid = createEmptyGrid(14, 8);
    belt(grid, 1, 5, 4);
    put(grid, 2, 5, { entityType: EntityType.UndergroundBelt, entityName: 'underground-belt', direction: 4, undergroundType: 'input' });
    put(grid, 5, 5, { entityType: EntityType.UndergroundBelt, entityName: 'underground-belt', direction: 4, undergroundType: 'output' });
    beltRow(grid, 5, 6, 9);
    supply(grid, 1, 3, 'copper');
    arm(grid, 1, 4, 0);
    arm(grid, 8, 4, 8);
    sink(grid, 8, 3);
    const r = analyzeLayout(grid, makeCtx());
    expect(r.belts.get('6,5')!.lanes.right.rate).toBeCloseTo(4);
    expect(r.belts.get('6,5')!.lanes.right.items[0].item).toBe('copper');
  });

  it('레인 용량으로 막히고 saturated — 둘째 드랍은 거절된다', () => {
    const grid = createEmptyGrid(14, 8);
    beltRow(grid, 5, 1, 10, 'slow-belt');
    supply(grid, 2, 3, 'plate');
    arm(grid, 2, 4, 0);
    supply(grid, 5, 3, 'plate');
    arm(grid, 5, 4, 0);
    arm(grid, 8, 4, 8);
    sink(grid, 8, 3);
    const r = analyzeLayout(grid, makeCtx());
    const lane = r.belts.get('7,5')!.lanes.right;
    expect(lane.rate).toBeCloseTo(1);
    expect(lane.capacity).toBeCloseTo(1);
    expect(lane.saturated).toBe(true);
    expect(r.belts.get('5,5')!.taps.find((t) => t.kind === 'drop')!.rate).toBeCloseTo(0);
  });

  it('side-load 합류: 두 상류가 각자의 레인으로 더해진다', () => {
    const grid = createEmptyGrid(14, 10);
    beltRow(grid, 5, 1, 9);
    for (let y = 2; y <= 4; y++) belt(grid, 3, y, 8); // 지선 남향 → (3,5) 에 북쪽에서 옆 유입
    supply(grid, 1, 3, 'plate');
    arm(grid, 1, 4, 0);          // 본선 (1,5), 북쪽에서 → 오른(남) 레인
    supply(grid, 1, 2, 'plate');
    arm(grid, 2, 2, 12);         // 지선 (3,2)
    arm(grid, 7, 6, 0);          // (7,5) 에서 집어 (7,7) 회수에
    sink(grid, 7, 7);
    arm(grid, 8, 4, 8);          // 한 팔(4/s)로는 8/s 를 못 받으니 하나 더
    sink(grid, 8, 3);
    const r = analyzeLayout(grid, makeCtx());
    const c = r.belts.get('5,5')!;
    expect(c.lanes.right.rate).toBeCloseTo(4); // 본선 직진
    expect(c.lanes.left.rate).toBeCloseTo(4);  // 지선은 닿은(북=왼) 레인으로 접힌다
  });
});
