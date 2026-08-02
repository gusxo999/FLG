import { describe, it, expect } from 'vitest';
import type { Entity } from '../store/gameDataStore';
import { beltThroughput, determineBeltCount } from './beltThroughput';
import type { SpecBelt } from './buildSpec';

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

/**
 * **determineBeltCount** — 수요를 벨트 티어로 나눠 덮는다(2026-07-16 사용자 지정 규칙).
 *
 * 가장 빠른 벨트로 채우고, 남는 조각은 **그걸 감당하는 가장 싼 벨트**로 덮는다. 넉넉한 건
 * 괜찮지만 **모자라면 절대 안 된다** — 부모가 굶는다.
 *
 * 이 함수가 모듈 경계를 안정시킨다: 줄 수를 **수요에서** 유도하므로 자식·부모가 같은 수요를
 * 보면 같은 줄 수를 낸다. (팔 개수에서 유도하면 양쪽 머신이 달라 어긋난다 — 실측에서 자식
 * 출력 26포트 vs 부모 입력 14포트로 12개가 갈 곳을 잃었다.)
 */
describe('determineBeltCount — 수요를 벨트 티어로 덮는다', () => {
  const B = (name: string, throughput: number): SpecBelt => ({ entityName: name, throughput });
  const express = B('express-transport-belt', 45);
  const fast = B('fast-transport-belt', 30);
  const basic = B('transport-belt', 15);
  const tiers = [express, fast, basic];
  const names = (r: SpecBelt[]) => r.map((b) => b.entityName);
  const total = (r: SpecBelt[]) => r.reduce((s, b) => s + b.throughput, 0);

  it('딱 나눠떨어지면 가장 빠른 벨트만 쓴다', () => {
    expect(names(determineBeltCount(90, tiers))).toEqual([
      'express-transport-belt',
      'express-transport-belt',
    ]);
  });

  it('남는 조각은 그걸 감당하는 **가장 싼** 벨트로 덮는다', () => {
    // 46 = express(45) + 나머지 1 → 1을 감당하는 가장 느린 벨트 = basic(15)
    expect(names(determineBeltCount(46, tiers))).toEqual([
      'express-transport-belt',
      'transport-belt',
    ]);
  });

  it('나머지가 싼 벨트를 넘으면 한 티어 위로 — 넉넉한 건 괜찮다', () => {
    // 65 = express(45) + 나머지 20 → basic(15)으론 모자람 → fast(30)
    expect(names(determineBeltCount(65, tiers))).toEqual([
      'express-transport-belt',
      'fast-transport-belt',
    ]);
    expect(total(determineBeltCount(65, tiers))).toBe(75); // 초과 OK
  });

  it('수요가 가장 빠른 벨트보다 작으면 감당하는 가장 싼 벨트 한 줄', () => {
    expect(names(determineBeltCount(10, tiers))).toEqual(['transport-belt']);
    expect(names(determineBeltCount(16, tiers))).toEqual(['fast-transport-belt']);
  });

  it('[불변식] 합계는 언제나 수요 이상 — 부모는 굶지 않는다', () => {
    for (let rate = 1; rate <= 200; rate++) {
      const got = determineBeltCount(rate, tiers);
      expect(total(got), `수요 ${rate} 에 ${names(got)} = ${total(got)}`).toBeGreaterThanOrEqual(
        rate,
      );
    }
  });

  it('[불변식] 벨트를 한 종류만 골라도 성립한다 — ceil(수요÷용량)', () => {
    for (const rate of [1, 15, 16, 30, 31, 100]) {
      const got = determineBeltCount(rate, [fast]);
      expect(got.length, `수요 ${rate}`).toBe(Math.ceil(rate / 30));
      expect(total(got)).toBeGreaterThanOrEqual(rate);
    }
  });

  it('순서 무관 — 티어를 아무렇게나 줘도 같은 답', () => {
    expect(names(determineBeltCount(46, [basic, express, fast]))).toEqual(
      names(determineBeltCount(46, tiers)),
    );
  });

  it('수요를 모르거나 0 이하면 빈 배열 — 없는 숫자로 벨트를 깔지 않는다', () => {
    expect(determineBeltCount(undefined, tiers)).toEqual([]);
    expect(determineBeltCount(0, tiers)).toEqual([]);
    expect(determineBeltCount(-5, tiers)).toEqual([]);
    expect(determineBeltCount(NaN, tiers)).toEqual([]); // NaN 이 뚫고 들어오지 못한다
  });

  it('벨트를 하나도 안 골랐으면 빈 배열 — 호출부가 "못 놓는다"를 고른다', () => {
    expect(determineBeltCount(30, [])).toEqual([]);
    expect(determineBeltCount(30, [B('broken', 0)])).toEqual([]);
  });
});
