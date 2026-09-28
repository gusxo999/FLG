/**
 * ⑫ 진짜 파이프라인의 배치를 푼다 — `runLayeredWizard` 합성 → 패널과 같은 `unifyLeaf` → 그리드.
 *
 * 이 파일의 둘째 시험은 **바깥 공급 팔 가정**을 못박는다(사용자 결정 2026-09-28 · `flow-model` §2.6):
 * 블루프린트 그대로면 포트 인서터 하나(2.4/s)가 광석 4/s 를 먹여야 해 하위 머신이 60% 지만,
 * 사용자는 **자기 외부 입력을 그 상자에 잇는다** — 그래서 검사는 그 팔을 벨트 한 줄 운반량으로 본다.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useGameDataStore } from '../../UI/store/gameDataStore';
import type { Entity, GameData, Recipe } from '../../types/gameData';
import { runLayeredWizard } from '../../autoLayout/run/build/layered';
import { unifyLeaf } from '../../autoLayout/shared/frames';
import type { ContainerWizardInput } from '../../autoLayout/shared/types';
import { createEmptyGrid, type LayoutGrid } from '../../types/layout';
import { analyzeLayout } from './build';
import type { FlowCtx, FlowResult } from './types';

const item = (name: string, amount = 1) => ({ name, amount, type: 'item' as const });
const recipe = (name: string, ingredients: Recipe['ingredients'], products: Recipe['products'], time: number): Recipe =>
  ({ name, category: 'crafting', energy_required: time, enabled: true, ingredients, products }) as Recipe;

/** 인서터 2.4/s(= 60 × 0.04) · 노랑 벨트 15/s. */
const DATA: GameData = {
  entities: [
    { name: 'assembler', type: 'assembling-machine', tile_width: 3, tile_height: 3, crafting_speed: 1, crafting_categories: ['crafting'] },
    { name: 'inserter', type: 'inserter', tile_width: 1, tile_height: 1,
      inserter_pickup_position: { x: 0, y: -1 }, inserter_drop_position: { x: 0, y: 1.2 }, inserter_rotation_speed: 0.04 },
    { name: 'transport-belt', type: 'transport-belt', tile_width: 1, tile_height: 1, belt_speed: 0.03125 },
    { name: 'underground-belt', type: 'underground-belt', tile_width: 1, tile_height: 1, belt_speed: 0.03125, max_underground_distance: 5 },
  ] as unknown as Entity[],
  recipes: [
    // 상위: sub 2 + plate 1 → 1, 2초 → sub 1/s · plate 0.5/s
    recipe('target-item', [item('sub-item', 2), item('plate', 1)], [item('target-item')], 2),
    // 하위: ore 2 → 1, 0.5초 → ore 4/s · sub 2/s
    recipe('sub-item', [item('ore', 2)], [item('sub-item')], 0.5),
  ],
};

const INPUT: ContainerWizardInput = {
  targetRecipe: 'target-item',
  countMode: { perTarget: 2 },
  internalIngredients: new Set(['sub-item']),
  selectedMachines: ['assembler'],
  selectedInserters: ['inserter'],
  selectedBelts: ['transport-belt'],
  selectedUndergroundPipes: [],
  selectedUndergroundBelts: ['underground-belt'],
  externalPortsDefault: 'top-left',
};

let grid: LayoutGrid;
let ctx: FlowCtx;

beforeAll(async () => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  useGameDataStore.getState().setGameData(DATA);
  const res = await runLayeredWizard(INPUT);
  const leaf = res.tree.candidates[0];
  expect(leaf).toBeDefined();
  // 패널의 handleApplyCandidate 와 같은 길 — 그리드 좌표로 넘기고 셀을 쓴다.
  const { placed } = unifyLeaf(leaf);
  let w = 0;
  let h = 0;
  for (const p of placed) { w = Math.max(w, p.x + 2); h = Math.max(h, p.y + 2); }
  grid = createEmptyGrid(w, h);
  for (const p of placed) grid.cells[p.y * w + p.x] = p.cell;
  const gd = useGameDataStore.getState();
  ctx = { entityMap: gd.entityMap, recipeMap: gd.recipeMap, moduleMap: gd.moduleMap };
});

function byRecipe(r: FlowResult, name: string) {
  return r.machines.filter((m) => m.recipe === name);
}

describe('⑫ 파이프라인 배치의 가동률', () => {
  it('모든 머신이 판정되고, 트렁크의 물질이 보존된다(하위가 내보낸 양 = 상위가 받은 양)', () => {
    const r = analyzeLayout(grid, ctx);
    expect(r.converged).toBe(true);
    expect(r.summary.unknown).toBe(0);
    const subs = byRecipe(r, 'sub-item');
    const tops = byRecipe(r, 'target-item');
    expect(subs.length).toBeGreaterThan(0);
    expect(tops.length).toBeGreaterThan(0);
    const made = subs.reduce((s, m) => s + m.u * m.outputs[0].made, 0);
    const eaten = tops.reduce((s, m) => s + m.u * m.inputs.find((i) => i.item === 'sub-item')!.need, 0);
    expect(made).toBeCloseTo(eaten, 6);
  });

  it('바깥 공급 팔은 벨트 운반량 — 손셈대로 전부 100% 다', () => {
    const r = analyzeLayout(grid, ctx);
    // 광석 4/s · 하위 2대 → 노랑 벨트 레인(7.5/s) 안. 팔(2.4/s)이 아니라 **줄**이 상한이다.
    for (const s of byRecipe(r, 'sub-item')) expect(s.u).toBeCloseTo(1, 6);
    for (const t of byRecipe(r, 'target-item')) expect(t.u).toBeCloseTo(1, 6);
    expect(r.summary.failed).toBe(0);
  });

  it('대조 — 그 상자가 블루프린트 **안쪽**이면 가정이 안 걸리고, 포트 실패로 잡힌다', () => {
    // 갇힌 상자(고아)는 사용자가 못 잇는다 — 가정의 근거가 없어지고, 그 포트의 머신은 실패다.
    const whole = { x: 0, y: 0, w: grid.width, h: grid.height };
    const r = analyzeLayout(grid, { ...ctx, interiorBbox: whole });
    expect(r.orphanChests.length).toBeGreaterThan(0);
    expect(r.summary.failed).toBeGreaterThan(0);
    const subs = byRecipe(r, 'sub-item');
    expect(subs.every((s) => s.portFail.length > 0)).toBe(true);
    expect(subs.some((s) => s.u < 1)).toBe(true);
  });
});

/**
 * 유체 트리 — 가스(유체)를 만드는 머신이 관을 타고 플라스틱 머신을 먹인다.
 * 머신은 커스텀 레시피 합성기(`factorio/customRecipe`)로 만든다 — 유체 상자 좌표를 손으로 적으면
 * 배치기와 분석이 같은 어긋남을 같이 믿는다.
 *
 * 손셈: 플라스틱 2대 × 가스 20/s = 40 = 가스 머신 2대 × 20/s. 석탄·원유는 팔 하나(2.4/s)로 1/s 씩.
 * 그래서 **전부 100%** 이고, 판정 불가(유체)가 **하나도 없어야** 한다.
 */
describe('⑫ 파이프라인 배치의 가동률 — 유체', () => {
  it('유체를 만들고 쓰는 머신이 모두 판정되고 전부 100%', async () => {
    const { compileCustomData } = await import('../../factorio/customRecipe');
    const custom = compileCustomData({
      machines: [{
        name: 'chem', size: 3, craftingSpeed: 1, craftingCategories: ['chem'],
        fluidBoxes: [{ role: 'input', face: 'W', offset: 1 }, { role: 'output', face: 'E', offset: 1 }],
      }],
      recipes: [
        { name: 'plastic', category: 'chem', energyRequired: 1,
          ingredients: [{ name: 'coal', amount: 1, type: 'item' }, { name: 'gas', amount: 20, type: 'fluid' }],
          products: [{ name: 'plastic', amount: 1, type: 'item' }] },
        { name: 'gas', category: 'chem', energyRequired: 1,
          ingredients: [{ name: 'crude', amount: 1, type: 'item' }],
          products: [{ name: 'gas', amount: 20, type: 'fluid' }] },
      ],
    });
    useGameDataStore.getState().setGameData({
      entities: [
        ...custom.entities,
        ...DATA.entities.filter((e) => e.type !== 'assembling-machine'),
        { name: 'pipe', type: 'pipe', tile_width: 1, tile_height: 1 },
        { name: 'pipe-to-ground', type: 'pipe-to-ground', tile_width: 1, tile_height: 1, max_underground_distance: 10 },
      ] as unknown as Entity[],
      recipes: custom.recipes,
    });
    const res = await runLayeredWizard({
      ...INPUT,
      targetRecipe: 'plastic',
      internalIngredients: new Set(['gas']),
      selectedMachines: ['chem'],
      selectedUndergroundPipes: ['pipe-to-ground'],
    });
    const leaf = res.tree.candidates[0];
    expect(leaf).toBeDefined();
    const { placed } = unifyLeaf(leaf);
    let w = 0;
    let h = 0;
    for (const p of placed) { w = Math.max(w, p.x + 2); h = Math.max(h, p.y + 2); }
    const g = createEmptyGrid(w, h);
    for (const p of placed) g.cells[p.y * w + p.x] = p.cell;
    const gd = useGameDataStore.getState();
    const r = analyzeLayout(g, { entityMap: gd.entityMap, recipeMap: gd.recipeMap, moduleMap: gd.moduleMap });

    expect(r.summary.unknown).toBe(0);
    expect(byRecipe(r, 'gas').length).toBeGreaterThan(0);
    expect(r.summary.full).toBe(r.summary.total);
    for (const m of byRecipe(r, 'plastic')) {
      expect(m.inputs.find((i) => i.item === 'gas')).toMatchObject({ got: 20, need: 20, fluid: true });
    }
  });
});
