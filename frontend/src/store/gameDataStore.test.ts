/**
 * buildDerived — 원본 게임데이터 → 조회용 파생 인덱스.
 *
 * 여기서 지키는 사실은 두 가지고, 서로 헷갈리기 쉬워서 함께 검증한다:
 *  1. **개발자용·미해금 레시피는 제외**한다 (`isRecipeSelectable`). 이게 "필터"의 의도다.
 *  2. **유체 산출물도 담는다.** 한때 `p.type !== 'item'` 이 유체를 버렸는데, 그건 1번의 의도를
 *     구현한 게 아니라(개발자용 아이템도 `type:'item'` 이라 그냥 통과한다) 유체만 막고 있었다.
 *     그 결과 유체가 레시피 트리에서 무조건 external 이 되어 유체 홉 전체가 도달 불가였다
 *     (2026-07-16 브라우저 실측에서 발견).
 */

import { describe, expect, it } from 'vitest';
import { buildDerived, type GameData } from './gameDataStore';
import { expandRecipeTree } from '../utils/autoLayout/recipeTree';
import type { Recipe } from './gameDataStore';

const r = (
  name: string,
  ingredients: Recipe['ingredients'],
  products: Recipe['products'],
  enabled = true,
): Recipe =>
  ({ name, category: 'crafting', energy_required: 1, enabled, ingredients, products }) as Recipe;

const item = (name: string, amount = 1) => ({ name, amount, type: 'item' as const });
const fluid = (name: string, amount = 1) => ({ name, amount, type: 'fluid' as const });

/**
 * 실데이터(kr 모드)에서 확인한 모양 그대로의 축소판:
 *  - `kr-water-from-atmosphere` — 재료 없이 **물(유체)만** 낸다. 유체 홉의 자식 후보.
 *  - `concrete` — 물(유체) + 아이템을 먹는다. 부모 후보.
 *  - `kr-crush-iron-ore` — **철광석에도 레시피가 있다**(1차 자원을 데이터가 모른다는 증거).
 *  - `dev-only` — enabled=false 이고 어떤 기술도 해금하지 않는다 → 후보에서 빠져야 한다.
 */
const DATA: GameData = {
  entities: [],
  recipes: [
    r('kr-water-from-atmosphere', [], [fluid('water', 30)]),
    r('concrete', [item('kr-sand', 10), fluid('water', 100)], [item('concrete', 10)]),
    r('kr-crush-iron-ore', [item('kr-stone-chunk')], [item('iron-ore', 2)]),
    r('dev-only', [item('kr-sand')], [item('dev-item')], false),
  ],
};

describe('buildDerived — 산출물 인덱스', () => {
  it('유체 산출물도 담는다 — 담지 않으면 트리가 유체 자식을 못 만든다', () => {
    const d = buildDerived(DATA);
    expect(d.itemToRecipe.get('water')).toBe('kr-water-from-atmosphere');
    expect(d.recipesByProduct.get('water')).toEqual(['kr-water-from-atmosphere']);
  });

  it('아이템 산출물은 그대로 담는다', () => {
    const d = buildDerived(DATA);
    expect(d.itemToRecipe.get('concrete')).toBe('concrete');
    // 1차 자원이라고 흔히 믿는 철광석에도 레시피가 있다 — 데이터는 1차 자원을 모른다.
    expect(d.itemToRecipe.get('iron-ore')).toBe('kr-crush-iron-ore');
  });

  it('선택 불가 레시피(enabled=false·미해금)는 유체든 아이템이든 제외한다', () => {
    const d = buildDerived(DATA);
    expect(d.itemToRecipe.has('dev-item')).toBe(false);
    expect(d.recipesByProduct.has('dev-item')).toBe(false);
  });
});

describe('레시피 트리에서 유체가 자식이 된다 (유체 홉의 입구)', () => {
  const d = buildDerived(DATA);

  it('유체 재료가 external 이 아니면 그 유체를 만드는 자식 노드로 펼쳐진다', () => {
    const tree = expandRecipeTree('concrete', d.recipeMap, d.itemToRecipe, new Set());
    const water = tree.children.find((c) => c.itemName === 'water');
    expect(water).toBeDefined();
    expect(water!.external).toBe(false);
    expect(water!.recipeName).toBe('kr-water-from-atmosphere');
  });

  it('유체도 철광석과 동등하다 — external 로 토글하면 leaf 로 멈춘다', () => {
    // 1차 자원 선정은 데이터가 아니라 **사용자**가 한다(트리에서 external 토글).
    const tree = expandRecipeTree('concrete', d.recipeMap, d.itemToRecipe, new Set(['water']));
    const water = tree.children.find((c) => c.itemName === 'water');
    expect(water!.external).toBe(true);
    expect(water!.recipeName).toBeUndefined();
    expect(water!.children).toEqual([]);
  });
});
