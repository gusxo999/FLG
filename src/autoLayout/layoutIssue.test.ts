/**
 * 실패가 **구조화돼서, 빠짐없이** 나오는가.
 *
 * 이 파일이 지키는 것 둘:
 *  1. **A-2 해소** — 층 0·1 실패가 첫 개에서 멈추지 않는다. 예전엔 `failure ??=` 로
 *     첫 개만 남아, 노드 3개가 막혀 있으면 사용자가 **세 번 고치고 세 번 다시 돌려야**
 *     전체를 알 수 있었다.
 *  2. **귀속이 카탈로그와 맞는다** — `scope`·`fixStep` 이 "무엇을 고쳐야 하나" 를 정확히
 *     가리켜야 화면이 사용자를 그 단계로 보낼 수 있다.
 *
 * 성공 경로도 함께 본다 — 성공했는데 `error` 가 섞여 나오면 그게 더 나쁜 회귀다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameDataStore, type Entity, type GameData, type Recipe } from '../UI/store/gameDataStore';
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
    name, type: 'assembling-machine', tile_width: 3, tile_height: 3,
    crafting_speed: 1, crafting_categories: categories,
  }) as unknown as Entity;

/**
 * **세 노드가 동시에 막힌 트리.** `bad-a`·`bad-b` 는 머신 없는 카테고리이고
 * `target-item` 은 정상이다. 첫 개에서 멈추면 issue 가 1개, 끝까지 모으면 2개다.
 */
const DATA: GameData = {
  entities: [
    machine('assembler', ['crafting']),
    { name: 'inserter', type: 'inserter', tile_width: 1, tile_height: 1 } as unknown as Entity,
    { name: 'transport-belt', type: 'transport-belt', tile_width: 1, tile_height: 1 } as unknown as Entity,
  ],
  recipes: [
    recipe('target-item', 'crafting', [item('sub-a'), item('sub-b')], [item('target-item')]),
    recipe('sub-a', 'no-machine-a', [item('ore')], [item('sub-a')]),
    recipe('sub-b', 'no-machine-b', [item('ore')], [item('sub-b')]),
  ],
};

/** 전부 정상인 트리 — 성공 경로 대조군. */
const OK_DATA: GameData = {
  ...DATA,
  recipes: [
    recipe('target-item', 'crafting', [item('sub-a')], [item('target-item')]),
    recipe('sub-a', 'crafting', [item('ore')], [item('sub-a')]),
  ],
};

const input = (targetRecipe = 'target-item'): ContainerWizardInput => ({
  targetRecipe,
  countMode: 'min',
  externalIngredients: new Set(['ore']),
  selectedMachines: ['assembler'],
  selectedInserters: ['inserter'],
  selectedBelts: ['transport-belt'],
  selectedUndergroundPipes: [],
  selectedUndergroundBelts: [],
  externalPortsDefault: 'top-left',
});

function stubStorage() {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
}

describe('실패 카탈로그 — 구조화 + 전수', () => {
  beforeEach(() => stubStorage());

  it('막힌 노드가 둘이면 issue 도 둘 — 첫 개에서 안 멈춘다 (A-2)', async () => {
    useGameDataStore.getState().setGameData(DATA);
    const res = await runLayeredWizard(input());
    expect(res.ok).toBe(false);

    const codes = (res.issues ?? []).map((i) => i.code);
    expect(
      codes.filter((c) => c === 'no-machine-for-category').length,
      '첫 실패에서 멈추면 1개만 나온다 — A-2 회귀',
    ).toBe(2);
  });

  it('귀속과 처방이 붙어 온다 — 화면이 사용자를 그 단계로 보낼 수 있게', async () => {
    useGameDataStore.getState().setGameData(DATA);
    const res = await runLayeredWizard(input());
    for (const i of res.issues ?? []) {
      if (i.code !== 'no-machine-for-category') continue;
      expect(i.scope).toBe('입력');
      expect(i.fixStep, '머신 선택 단계로 보내야 한다').toBe('machine');
      expect(i.severity).toBe('error');
      expect(i.target?.recipeName, '어느 레시피인지 없으면 목록이 못 짚는다').toBeTruthy();
      expect(i.detail.length).toBeGreaterThan(0);
    }
  });

  it('실패 트리의 실패 노드도 issue 수만큼 — 라벨이 한 줄로 뭉치지 않는다', async () => {
    useGameDataStore.getState().setGameData(DATA);
    const res = await runLayeredWizard(input());
    const errors = (res.issues ?? []).filter((i) => i.severity === 'error');
    expect(res.tree.root.children.length).toBe(errors.length);
    expect(res.tree.stats.failuresGenerated).toBe(errors.length);
  });

  it('타깃 레시피가 없으면 그 사유 하나 — 1단계로 보낸다', async () => {
    useGameDataStore.getState().setGameData(DATA);
    const res = await runLayeredWizard(input('nonexistent-recipe'));
    expect(res.ok).toBe(false);
    const i = (res.issues ?? [])[0];
    expect(i.code).toBe('no-target-recipe');
    expect(i.scope).toBe('입력');
    expect(i.fixStep).toBe('recipe');
  });

  it('성공하면 error 가 하나도 없다 — 대조군', async () => {
    useGameDataStore.getState().setGameData(OK_DATA);
    const res = await runLayeredWizard(input());
    expect(res.ok).toBe(true);
    const errors = (res.issues ?? []).filter((i) => i.severity === 'error');
    expect(errors, '성공했는데 error 가 있다 — 더 나쁜 회귀').toEqual([]);
  });

  it('배치 전 실패는 그림이 없다 — snapshot 은 pack 까지 갔을 때만', async () => {
    useGameDataStore.getState().setGameData(DATA);
    const res = await runLayeredWizard(input());
    expect(res.snapshot, '층 0 실패엔 배치가 아예 없다').toBeUndefined();
  });
});
