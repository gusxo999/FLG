import { describe, it, expect } from 'vitest';
import type { Entity } from '../../../UI/store/gameDataStore';
import { beltThroughput, laneThroughput, determineBeltCount } from './belt';
import type { SpecBelt } from '../gamedata/spec';

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
 * 보면 같은 줄 수를 낸다.
 *
 * ## 세는 단위는 **줄이 아니라 레인**이다 (2026-09-03)
 *
 * 인서터는 먼 레인 하나에만 떨구고, 우리 모듈은 머신이 벨트 한쪽에만 있다. 그래서 줄 하나에
 * 실리는 것은 **벨트의 절반**이다(익스프레스 45 → 22.5). 아래 기대값은 전부 그 단위다 —
 * 숫자를 갱신한 게 아니라 **재는 자가 바뀌었다.**
 */
describe('determineBeltCount — 수요를 벨트 티어로 덮는다', () => {
  const B = (name: string, throughput: number): SpecBelt => ({ entityName: name, throughput });
  const express = B('express-transport-belt', 45); // 레인 22.5
  const fast = B('fast-transport-belt', 30);       // 레인 15
  const basic = B('transport-belt', 15);           // 레인 7.5
  const tiers = [express, fast, basic];
  const names = (r: SpecBelt[]) => r.map((b) => b.entityName);
  /** **실을 수 있는 양**의 합 — 물리 처리량이 아니라 레인 기준이다. */
  const loadable = (r: SpecBelt[]) => r.reduce((s, b) => s + b.throughput / 2, 0);

  it('**한 줄은 벨트의 절반만 싣는다** — 인서터가 먼 레인에만 떨구기 때문', () => {
    // 이 한 줄이 이 파일의 나머지 전부를 설명한다. 예전엔 45 를 한 줄로 봤다.
    expect(determineBeltCount(22.5, [express])).toHaveLength(1);
    expect(determineBeltCount(23, [express])).toHaveLength(2);
  });

  it('딱 나눠떨어지면 가장 빠른 벨트만 쓴다', () => {
    expect(names(determineBeltCount(45, tiers))).toEqual([
      'express-transport-belt',
      'express-transport-belt',
    ]);
  });

  it('남는 조각은 그걸 감당하는 **가장 싼** 벨트로 덮는다', () => {
    // 23 = express 레인(22.5) + 나머지 0.5 → 0.5 를 감당하는 가장 느린 벨트 = basic(레인 7.5)
    expect(names(determineBeltCount(23, tiers))).toEqual([
      'express-transport-belt',
      'transport-belt',
    ]);
  });

  it('나머지가 싼 벨트를 넘으면 한 티어 위로 — 넉넉한 건 괜찮다', () => {
    // 32.5 = express 레인(22.5) + 나머지 10 → basic 레인(7.5)으론 모자람 → fast 레인(15)
    expect(names(determineBeltCount(32.5, tiers))).toEqual([
      'express-transport-belt',
      'fast-transport-belt',
    ]);
    expect(loadable(determineBeltCount(32.5, tiers))).toBe(37.5); // 초과 OK
  });

  it('수요가 가장 빠른 벨트의 레인보다 작으면 감당하는 가장 싼 벨트 한 줄', () => {
    expect(names(determineBeltCount(5, tiers))).toEqual(['transport-belt']);
    expect(names(determineBeltCount(8, tiers))).toEqual(['fast-transport-belt']);
  });

  it('[불변식] 합계는 언제나 수요 이상 — 부모는 굶지 않는다', () => {
    for (let rate = 1; rate <= 200; rate++) {
      const got = determineBeltCount(rate, tiers);
      expect(loadable(got), `수요 ${rate} 에 ${names(got)} = ${loadable(got)}`)
        .toBeGreaterThanOrEqual(rate);
    }
  });

  it('[불변식] 벨트를 한 종류만 골라도 성립한다 — ceil(수요 ÷ **레인**)', () => {
    for (const rate of [1, 15, 16, 30, 31, 100]) {
      const got = determineBeltCount(rate, [fast]); // 레인 15
      expect(got.length, `수요 ${rate}`).toBe(Math.ceil(rate / 15));
      expect(loadable(got)).toBeGreaterThanOrEqual(rate);
    }
  });

  it('순서 무관 — 티어를 아무렇게나 줘도 같은 답', () => {
    expect(names(determineBeltCount(23, [basic, express, fast]))).toEqual(
      names(determineBeltCount(23, tiers)),
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

describe('laneThroughput — 줄의 정확히 절반', () => {
  it('45/s 줄이면 레인 하나는 22.5/s', () => {
    expect(laneThroughput(belt(0.09375))).toBeCloseTo(22.5, 6); // express
    expect(laneThroughput(belt(0.0625))).toBeCloseTo(15, 6);    // fast
    expect(laneThroughput(belt(0.03125))).toBeCloseTo(7.5, 6);  // transport
  });

  it('override 도 절반이 된다 — 사용자가 준 값도 줄 전체를 뜻한다', () => {
    expect(laneThroughput(belt(0.03125), 90)).toBeCloseTo(45, 6);
  });

  it('모르면 0 — 지어내지 않는다', () => {
    expect(laneThroughput(undefined)).toBe(0);
    expect(laneThroughput(belt(0))).toBe(0);
  });

  it('**줄 수가 이 값에서 나온다** — 40/s 는 익스프레스 두 줄이다', () => {
    // 예전엔 45 로 세서 한 줄이었고, 게임에선 22.5 만 흘러 부모가 굶었다.
    const tiers: SpecBelt[] = [{ entityName: 'express', throughput: 45 }];
    expect(determineBeltCount(40, tiers)).toHaveLength(2);
  });
});
