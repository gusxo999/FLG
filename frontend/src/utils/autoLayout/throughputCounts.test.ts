import { describe, it, expect } from 'vitest';
import { assignThroughputCounts, type MachineParamsLookup } from './recipeTree';
import type { RecipeTreeNode } from './types';
import type { Recipe } from '../../store/gameDataStore';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const recipe = (
  name: string,
  energy_required: number,
  products: { name: string; amount: number; probability?: number }[],
  ingredients: { name: string; amount: number }[],
): Recipe => ({
  id: 0,
  name,
  localised_name: name,
  category: 'crafting',
  energy_required,
  products: products.map((p) => ({ ...p, type: 'item' as const })),
  ingredients: ingredients.map((i) => ({ ...i, type: 'item' as const })),
});

const node = (
  recipeName: string | undefined,
  itemName: string,
  external: boolean,
  children: RecipeTreeNode[] = [],
): RecipeTreeNode => ({ recipeName, itemName, external, children, machineCount: 0 });

// iron-gear ← iron-plate ← iron-ore(external)
const tree = node('iron-gear', 'iron-gear', false, [
  node('iron-plate', 'iron-plate', false, [
    node(undefined, 'iron-ore', true, []),
  ]),
]);

const recipeMap = new Map<string, Recipe>([
  ['iron-gear', recipe('iron-gear', 0.5, [{ name: 'iron-gear', amount: 1 }], [{ name: 'iron-plate', amount: 2 }])],
  ['iron-plate', recipe('iron-plate', 3.2, [{ name: 'iron-plate', amount: 1 }], [{ name: 'iron-ore', amount: 1 }])],
]);

const speed = (s: number, prod = 1, speedFraction?: number): MachineParamsLookup => () => ({
  craftingSpeed: s,
  productivityMultiplier: prod,
  speedFraction,
});

const find = (root: RecipeTreeNode, item: string): RecipeTreeNode => {
  const stack = [root];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.itemName === item) return n;
    stack.push(...n.children);
  }
  throw new Error(`node ${item} not found`);
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('assignThroughputCounts', () => {
  it('scales counts top-down to satisfy the target output rate (speed 1)', () => {
    // root out/machine = 1 / 0.5 = 2 gears/s → ceil(5/2) = 3 machines
    // root crafts/s = 3 / 0.5 = 6 → plate demand = 6 × 2 = 12 plates/s
    // plate out/machine = 1 / 3.2 = 0.3125 → ceil(12 / 0.3125) = 39 machines
    const out = assignThroughputCounts(tree, 5, recipeMap, speed(1));
    expect(out.machineCount).toBe(3);
    expect(find(out, 'iron-plate').machineCount).toBe(39);
    expect(find(out, 'iron-ore').machineCount).toBe(0); // external
  });

  it('clamps the root to at least 1, then fully supplies that machine', () => {
    // target 0.1 < 2/s per machine → root clamps to 1 machine.
    // That machine still runs full out (1/0.5 = 2 crafts/s), so the plate line is
    // sized to fully feed it: demand 4 plates/s → ceil(4 / 0.3125) = 13.
    const out = assignThroughputCounts(tree, 0.1, recipeMap, speed(1));
    expect(out.machineCount).toBe(1);
    expect(find(out, 'iron-plate').machineCount).toBe(13);
  });

  it('accounts for crafting speed (faster machine → fewer)', () => {
    // root out/machine = 1 × 4 / 0.5 = 8 → ceil(5/8) = 1
    const out = assignThroughputCounts(tree, 5, recipeMap, speed(4));
    expect(out.machineCount).toBe(1);
  });

  it('uses expected yield (amount × probability)', () => {
    const probMap = new Map<string, Recipe>([
      ['iron-gear', recipe('iron-gear', 0.5, [{ name: 'iron-gear', amount: 1, probability: 0.5 }], [{ name: 'iron-plate', amount: 2 }])],
      ['iron-plate', recipeMap.get('iron-plate')!],
    ]);
    // root out/machine = 1 × 0.5 / 0.5 = 1 gear/s → ceil(5/1) = 5 (vs 3 at prob 1)
    const out = assignThroughputCounts(tree, 5, probMap, speed(1));
    expect(out.machineCount).toBe(5);
  });

  it('factors productivity into output yield', () => {
    // prod 2 → root out/machine = 1 × 2 / 0.5 = 4 → ceil(5/4) = 2
    const out = assignThroughputCounts(tree, 5, recipeMap, speed(1, 2));
    expect(out.machineCount).toBe(2);
  });

  it('a starved machine both produces less AND demands less of its children', () => {
    // speedFraction 0.5 — the machine can only be fed half its full-speed demand.
    // root out/machine = 1 × 1 × 0.5 / 0.5 = 1 gear/s → ceil(5/1) = 5 machines.
    // Those 5 machines craft at half speed: 5 × 0.5 / 0.5 = 5 crafts/s, so they eat
    // 10 plates/s — NOT the 20 they would eat at full speed. Sizing the child off the
    // full-speed figure over-provisions it by exactly 1/speedFraction.
    // plate out/machine = 1 × 0.5 / 3.2 = 0.15625 → ceil(10 / 0.15625) = 64.
    const out = assignThroughputCounts(tree, 5, recipeMap, speed(1, 1, 0.5));
    expect(out.machineCount).toBe(5);
    expect(find(out, 'iron-plate').machineCount).toBe(64);
  });

  it('falls back to 1 machine when no machine params are available', () => {
    const noMachine: MachineParamsLookup = () => undefined;
    const out = assignThroughputCounts(tree, 5, recipeMap, noMachine);
    expect(out.machineCount).toBe(1);
    expect(find(out, 'iron-plate').machineCount).toBe(1);
  });
});
