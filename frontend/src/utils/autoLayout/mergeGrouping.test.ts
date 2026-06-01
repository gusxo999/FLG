import { describe, it, expect } from 'vitest';
import type { Recipe, Entity } from '../../store/gameDataStore';
import type { PendingConnection } from './containerModel';
import {
  computeIngredientDemand,
  groupConnections,
  type MergeCandidate,
  type GroupConfig,
} from './mergeGrouping';

// ─────────────────────────────────────────────────────────────────────────────
// computeIngredientDemand
// ─────────────────────────────────────────────────────────────────────────────

const recipe = (energy_required: number, ings: Array<{ name: string; amount: number }>): Recipe =>
  ({
    id: 1, name: 'r', localised_name: 'r', category: 'crafting',
    energy_required,
    ingredients: ings.map((i) => ({ ...i, type: 'item' as const })),
    products: [],
  } as Recipe);

const machine = (crafting_speed?: number): Entity =>
  ({ id: 1, name: 'asm', localised_name: 'asm', type: 'assembling-machine', tile_width: 3, tile_height: 3, crafting_speed } as Entity);

describe('computeIngredientDemand', () => {
  it('computes crafting_speed / energy_required * amount', () => {
    // 1/0.5=2 crafts/s × 2 = 4
    expect(computeIngredientDemand(recipe(0.5, [{ name: 'iron', amount: 2 }]), machine(1), 'iron')).toBeCloseTo(4, 6);
    // 1.25/0.5=2.5 crafts/s × 1 = 2.5
    expect(computeIngredientDemand(recipe(0.5, [{ name: 'iron', amount: 1 }]), machine(1.25), 'iron')).toBeCloseTo(2.5, 6);
  });

  it('returns Infinity (force 1:1) when data is missing or invalid', () => {
    expect(computeIngredientDemand(undefined, machine(1), 'iron')).toBe(Infinity);
    expect(computeIngredientDemand(recipe(0.5, [{ name: 'iron', amount: 2 }]), undefined, 'iron')).toBe(Infinity);
    expect(computeIngredientDemand(recipe(0, [{ name: 'iron', amount: 2 }]), machine(1), 'iron')).toBe(Infinity);
    expect(computeIngredientDemand(recipe(0.5, [{ name: 'iron', amount: 2 }]), machine(0), 'iron')).toBe(Infinity);
    expect(computeIngredientDemand(recipe(0.5, [{ name: 'iron', amount: 2 }]), machine(1), 'copper')).toBe(Infinity);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// groupConnections
// ─────────────────────────────────────────────────────────────────────────────

let idSeq = 0;
function cand(content: string, demand: number, pos: { x: number; y: number }): MergeCandidate {
  idSeq += 1;
  const connection: PendingConnection = {
    producerId: `chest-${idSeq}`,
    consumerId: `machine-${idSeq}`,
    kind: 'item',
  };
  return { connection, content, demand, pos };
}

const cfg = (over: Partial<GroupConfig> = {}): GroupConfig => ({
  maxTaps: 4,
  beltCapacity: 1000,
  tapCapacity: 1000,
  ...over,
});

describe('groupConnections', () => {
  it('buckets by content', () => {
    const groups = groupConnections(
      [cand('iron', 1, { x: 0, y: 0 }), cand('copper', 1, { x: 1, y: 0 }), cand('iron', 1, { x: 2, y: 0 })],
      cfg(),
    );
    const byContent = new Map(groups.map((g) => [g.content, g]));
    expect(byContent.get('iron')!.members).toHaveLength(2);
    expect(byContent.get('copper')!.members).toHaveLength(1);
  });

  it('chunks a bucket by maxTaps', () => {
    const cands = Array.from({ length: 5 }, (_, i) => cand('iron', 1, { x: i, y: 0 }));
    const groups = groupConnections(cands, cfg({ maxTaps: 4 }));
    expect(groups.map((g) => g.members.length).sort((a, b) => b - a)).toEqual([4, 1]);
  });

  it('splits a group when total demand would exceed belt capacity', () => {
    // 각 demand 4, beltCapacity 10 → 한 그룹에 2개(8)까지, 3번째는 새 그룹.
    const cands = Array.from({ length: 3 }, (_, i) => cand('iron', 4, { x: i, y: 0 }));
    const groups = groupConnections(cands, cfg({ beltCapacity: 10, maxTaps: 4 }));
    expect(groups.map((g) => g.members.length).sort((a, b) => b - a)).toEqual([2, 1]);
  });

  it('leaves an over-tap-capacity consumer as a singleton', () => {
    const groups = groupConnections(
      [cand('iron', 100, { x: 0, y: 0 }), cand('iron', 1, { x: 1, y: 0 }), cand('iron', 1, { x: 2, y: 0 })],
      cfg({ tapCapacity: 10, beltCapacity: 1000 }),
    );
    expect(groups.map((g) => g.members.length).sort((a, b) => b - a)).toEqual([2, 1]);
  });

  it('treats Infinity-demand consumers as singletons (forced 1:1)', () => {
    const groups = groupConnections(
      [cand('iron', Infinity, { x: 0, y: 0 }), cand('iron', 1, { x: 1, y: 0 })],
      cfg(),
    );
    expect(groups.map((g) => g.members.length).sort((a, b) => b - a)).toEqual([1, 1]);
  });

  it('sorts along the dominant spread axis so chunks are spatially local', () => {
    const cands = [
      cand('iron', 1, { x: 30, y: 0 }),
      cand('iron', 1, { x: 0, y: 1 }),
      cand('iron', 1, { x: 10, y: 0 }),
      cand('iron', 1, { x: 20, y: 1 }),
      cand('iron', 1, { x: 40, y: 0 }),
    ];
    const groups = groupConnections(cands, cfg({ maxTaps: 4 }));
    expect(groups[0].members).toHaveLength(4); // x = 0,10,20,30
    expect(groups[1].members).toHaveLength(1); // x = 40 (far)
    expect(groups[1].members[0].pos.x).toBe(40);
  });

  it('single consumer yields a size-1 group (effectively 1:1)', () => {
    const groups = groupConnections([cand('iron', 1, { x: 0, y: 0 })], cfg());
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(1);
  });
});
