/**
 * 파서는 **문지기다** — exporter 가 뽑아도 여기서 안 담으면 그 필드는 앱에 없다.
 *
 * 실제로 그렇게 죽고 있었다(2026-07-16): `export-gamedata.lua` 에 `amount_min`/`amount_max`
 * 를 추가하고 게임에서 재추출까지 했는데도, 이 파서가 `name`/`amount`/`probability`/`type`
 * 넷만 골라 담아 **범위 수량이 문 앞에서 사라졌다.** `fluidbox_index` 도 마찬가지였다 —
 * exporter 는 뽑고 moduleWizard 는 읽는데, 중간에서 잘려 늘 undefined 였다.
 *
 * 그래서 여기 검사는 "파싱이 되나"가 아니라 **"뽑은 필드가 살아서 반대편에 나오나"** 다.
 */
import { describe, it, expect } from 'vitest';
import { parseGameData } from './parseGameData';
import { productYield } from '../store/gameDataStore';

/** 최소 원본 — 실데이터(factorio-data.json)의 모양만 그대로 흉내낸다. */
const raw = {
  entities: [],
  recipes: [
    {
      name: 'kr-sand',
      category: 'crafting',
      energy: 1,
      enabled: true,
      ingredients: [{ type: 'item', name: 'stone', amount: 1 }],
      // 범위 산출물 — `amount` 가 **아예 없다**(실데이터 43개가 이 모양).
      products: [{ type: 'item', name: 'kr-sand', amount_min: 7, amount_max: 8 }],
    },
    {
      name: 'kr-filter-iron-ore-from-dirty-water',
      category: 'crafting',
      energy: 1,
      enabled: true,
      ingredients: [{ type: 'fluid', name: 'kr-dirty-water', amount: 100, fluidbox_index: 2 }],
      products: [
        { type: 'item', name: 'iron-ore', amount_min: 2, amount_max: 5, probability: 0.5 },
      ],
    },
    {
      name: 'iron-plate',
      category: 'smelting',
      energy: 3.2,
      enabled: true,
      ingredients: [{ type: 'item', name: 'iron-ore', amount: 1 }],
      products: [{ type: 'item', name: 'iron-plate', amount: 1, probability: 1 }],
    },
    {
      // 빈 Lua 테이블은 JSON 에서 `[]` 이 아니라 `{}` 로 나온다(실데이터 72개).
      // 산출물이 없는 void 레시피 — 파서가 배열로 정규화해야 소비처가 안 터진다.
      name: 'se-electric-boiling-void',
      category: 'se-void',
      energy: 1,
      enabled: true,
      ingredients: {},
      products: {},
    },
  ],
};

const byName = (name: string) => parseGameData(raw).recipes.find((r) => r.name === name)!;

describe('parseGameData — 뽑은 필드가 문을 통과한다', () => {
  it('범위 수량(amount_min/max)이 살아서 나온다 — 잘리면 수량이 미상이 된다', () => {
    const p = byName('kr-sand').products[0];
    expect(p.amount_min).toBe(7);
    expect(p.amount_max).toBe(8);
    expect(p.amount).toBeUndefined(); // 없는 값을 0 이나 1 로 지어내지 않는다
    expect(productYield(p)).toBe(7.5);
  });

  it('범위 + 확률이 함께 살아 기대 수율이 나온다', () => {
    const p = byName('kr-filter-iron-ore-from-dirty-water').products[0];
    expect(productYield(p)).toBe(1.75); // (2+5)/2 × 0.5
  });

  it('고정 수량은 그대로 (회귀 없음)', () => {
    expect(productYield(byName('iron-plate').products[0])).toBe(1);
  });

  it('fluidbox_index 가 재료에서 살아 나온다 — 잘리면 늘 undefined 라 상자 지정이 무시된다', () => {
    expect(byName('kr-filter-iron-ore-from-dirty-water').ingredients[0].fluidbox_index).toBe(2);
  });

  it('빈 Lua 테이블(`{}`)은 배열로 정규화된다 — 소비처가 for...of 로 돈다', () => {
    const r = byName('se-electric-boiling-void');
    expect(Array.isArray(r.products)).toBe(true);
    expect(r.products).toHaveLength(0);
    expect(Array.isArray(r.ingredients)).toBe(true);
  });
});
