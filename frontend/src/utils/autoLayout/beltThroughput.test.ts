import { describe, it, expect } from 'vitest';
import type { Entity } from '../../store/gameDataStore';
import { beltThroughput } from './beltThroughput';

const belt = (belt_speed?: number): Entity =>
  ({ id: 1, name: 'b', localised_name: 'b', type: 'transport-belt', tile_width: 1, tile_height: 1, belt_speed } as Entity);

describe('beltThroughput', () => {
  it('matches vanilla anchors (items/sec)', () => {
    expect(beltThroughput(belt(0.03125))).toBeCloseTo(15, 6); // transport-belt
    expect(beltThroughput(belt(0.0625))).toBeCloseTo(30, 6);  // fast-belt
    expect(beltThroughput(belt(0.09375))).toBeCloseTo(45, 6); // express-belt
  });

  it('returns 0 when entity or belt_speed is missing/zero', () => {
    expect(beltThroughput(undefined)).toBe(0);
    expect(beltThroughput(belt(undefined))).toBe(0);
    expect(beltThroughput(belt(0))).toBe(0);
  });

  it('uses a positive override and ignores a non-positive one', () => {
    expect(beltThroughput(belt(0.03125), 99)).toBe(99);
    expect(beltThroughput(undefined, 42)).toBe(42);
    expect(beltThroughput(belt(0.03125), 0)).toBeCloseTo(15, 6);
    expect(beltThroughput(belt(0.03125), -5)).toBeCloseTo(15, 6);
  });
});
