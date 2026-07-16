/**
 * runLayeredWizard — 사용자가 고른 **대체 제작법(recipeOverrides)** 을 실행이 지켜야 한다.
 *
 * 이 파일이 있는 이유: 실행 진입점(`runLayeredWizard`)을 돌리는 테스트가 **하나도 없어서**
 * 다음 버그가 살아남았다 — `layeredWizard` 가 `expandRecipeTree` 에 5번째 인자
 * (recipeOverrides)를 안 넘겨, **화면에 보이는 트리와 실제로 배치되는 트리가 달랐다.**
 * 패널은 값을 넘기고 있었고 타입에도 있었는데, 읽는 쪽만 빠져 있었다(2026-07-16 실측에서 발견).
 *
 * 검증 방법: 첫 매칭 레시피는 **머신이 없는 카테고리**로, override 로 고른 레시피는 **머신이 있는
 * 카테고리**로 둔다. override 를 지키면 성공하고, 무시하면 "첫 매칭 카테고리 머신 없음" 으로
 * 실패한다 → 성공/실패가 곧 override 반영 여부다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameDataStore, type Entity, type GameData, type Recipe } from '../../store/gameDataStore';
import { runLayeredWizard } from './layeredWizard';
import type { ContainerWizardInput } from './containerModel';

const item = (name: string, amount = 1) => ({ name, amount, type: 'item' as const });

const recipe = (
  name: string,
  category: string,
  ingredients: Recipe['ingredients'],
  products: Recipe['products'],
): Recipe =>
  ({ name, category, energy_required: 1, enabled: true, ingredients, products }) as Recipe;

const machine = (name: string, categories: string[]): Entity =>
  ({
    name,
    type: 'assembling-machine',
    tile_width: 3,
    tile_height: 3,
    crafting_speed: 1,
    crafting_categories: categories,
  }) as unknown as Entity;

/**
 * `sub-item` 을 만드는 레시피가 **둘**이다. 배열 순서상 `bad-sub` 가 첫 매칭이고,
 * 그 카테고리(`no-machine-category`)를 처리할 머신은 아무도 없다.
 * 사용자는 `good-sub` 를 골랐다(= recipeOverrides).
 *
 * 유체를 쓰지 않는다 — 여기서 검증할 건 **override 반영 여부**뿐이고, 유체를 섞으면
 * 회전·유체 상자 같은 무관한 이유로 깨진다.
 */
const DATA: GameData = {
  entities: [
    machine('assembler', ['crafting']),
    machine('special-assembler', ['special-crafting']),
    { name: 'inserter', type: 'inserter', tile_width: 1, tile_height: 1 } as unknown as Entity,
    { name: 'transport-belt', type: 'transport-belt', tile_width: 1, tile_height: 1 } as unknown as Entity,
  ],
  recipes: [
    recipe('target-item', 'crafting', [item('sub-item')], [item('target-item')]),
    recipe('bad-sub', 'no-machine-category', [item('ore')], [item('sub-item')]), // 첫 매칭 — 머신 없음
    recipe('good-sub', 'special-crafting', [item('ore')], [item('sub-item')]), // 사용자가 고른 것
  ],
};

const baseInput = (recipeOverrides?: Record<string, string>): ContainerWizardInput => ({
  targetRecipe: 'target-item',
  countMode: 'min',
  externalIngredients: new Set(['ore']),
  recipeOverrides,
  selectedMachines: ['assembler', 'special-assembler'],
  selectedInserters: ['inserter'],
  selectedBelts: ['transport-belt'],
  selectedUndergroundPipes: [],
  selectedUndergroundBelts: [],
  externalPortsDefault: 'top-left',
});

describe('runLayeredWizard — 대체 제작법을 실행이 지킨다', () => {
  beforeEach(() => {
    // 스토어가 persist(localStorage) 를 쓴다. 테스트 환경엔 없어서 스텁한다.
    // (스텁 없이 두면 저장 실패 → storageWarning setState → 다시 저장 시도 → **무한 재귀**로
    //  스택이 터진다. gameDataStore 의 별개 버그이나 여기서 고칠 범위는 아니다.)
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    useGameDataStore.getState().setGameData(DATA);
  });

  it('override 로 고른 제작법(good-sub)으로 트리를 짓는다', async () => {
    const res = await runLayeredWizard(baseInput({ 'sub-item': 'good-sub' }));
    // override 를 무시하면 첫 매칭 bad-sub 로 펼쳐 "머신 없음" 으로 실패한다.
    expect(res.tree.stats.failuresGenerated).toBe(0);
    expect(res.tree.candidates.length).toBeGreaterThan(0);
  });

  it('override 가 없으면 첫 매칭(bad-sub)을 쓰고, 머신이 없어 실패한다 — 대조군', async () => {
    const res = await runLayeredWizard(baseInput());
    expect(res.tree.candidates.length).toBe(0);
  });
});
