import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/**
 * customDataStore — **합류가 실제로 일어나나.**
 *
 * 이 파일이 지키는 것은 하나다: 커스텀을 넣으면 게임데이터의 **파생 인덱스까지** 그것을
 * 안다는 것. `recipeMap` 만 보고 통과시키면 안 된다 — 자동배치가 실제로 쓰는 길은
 * `itemToRecipe`(트리 확장)와 `machines`(2단계 후보)라, 거기 안 실리면 **만들어 놓고도
 * 배치가 안 선다**. 그게 조용한 고장이다.
 *
 * 그리고 재임포트. `setGameData` 는 배열을 통째로 갈아 끼우므로 파일을 새로 올리면 커스텀이
 * 날아가는 것이 **정상**이고, 그 직후 `syncCustomData()` 가 되살리는 것이 설계다. 그 왕복이
 * 여기 있다 — 없으면 "다른 세션에도 보인다" 는 약속이 파일 한 번에 깨진다.
 */

// vitest 환경이 node 라 localStorage 가 없다. 스토어 import 전에 심어야 한다.
const backing = new Map<string, string>();
beforeAll(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, String(v)),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: (i: number) => [...backing.keys()][i] ?? null,
    get length() {
      return backing.size;
    },
  };
});

/** 바닐라 한 조각 — 이름 충돌과 "기존 머신이 맡는 카테고리" 를 시험할 만큼만. */
const GAME_DATA = {
  recipes: [
    {
      id: 1,
      name: 'iron-gear-wheel',
      localised_name: 'iron-gear-wheel',
      category: 'crafting',
      energy_required: 0.5,
      enabled: true,
      ingredients: [{ name: 'iron-plate', amount: 2, type: 'item' as const }],
      products: [{ name: 'iron-gear-wheel', amount: 1, type: 'item' as const }],
    },
  ],
  entities: [
    {
      id: 1,
      name: 'assembling-machine-2',
      localised_name: 'assembling-machine-2',
      type: 'assembling-machine',
      tile_width: 3,
      tile_height: 3,
      crafting_speed: 0.75,
      crafting_categories: ['crafting'],
    },
  ],
};

const SPEC = {
  machines: [
    {
      name: 'my-plant',
      size: 5,
      craftingSpeed: 2,
      craftingCategories: ['custom-my-thing'],
      fluidBoxes: [
        { role: 'input' as const, face: 'W' as const, offset: 1 },
        { role: 'output' as const, face: 'E' as const, offset: 3 },
      ],
    },
  ],
  recipes: [
    {
      name: 'my-thing',
      category: 'custom-my-thing',
      energyRequired: 4,
      ingredients: [
        { name: 'iron-plate', amount: 3, type: 'item' as const },
        { name: 'water', amount: 50, type: 'fluid' as const },
      ],
      products: [{ name: 'my-thing', amount: 1, type: 'item' as const }],
    },
  ],
};

async function stores() {
  const gd = await import('./gameDataStore');
  const cd = await import('./customDataStore');
  return { gd, cd };
}

beforeEach(async () => {
  const { gd, cd } = await stores();
  cd.useCustomDataStore.setState({ data: { machines: [], recipes: [] } });
  gd.useGameDataStore.getState().setGameData(structuredClone(GAME_DATA));
});

describe('합류 — 커스텀이 파생 인덱스까지 실린다', () => {
  it('머신은 machines·entityMap 에, 레시피는 recipeMap 에 들어간다', async () => {
    const { gd, cd } = await stores();
    expect(cd.useCustomDataStore.getState().merge(SPEC)).toEqual([]);

    const s = gd.useGameDataStore.getState();
    expect(s.recipeMap.get('my-thing')?.energy_required).toBe(4);
    expect(s.entityMap.get('my-plant')?.tile_width).toBe(5);
    expect(s.machineMap.get('my-plant')?.crafting_speed).toBe(2);
    // 바닐라는 그대로 있어야 한다 — 합류는 덮어쓰기가 아니다.
    expect(s.recipeMap.has('iron-gear-wheel')).toBe(true);
  });

  it('itemToRecipe 에 실린다 — 이게 없으면 트리가 이 레시피를 못 편다', async () => {
    const { gd, cd } = await stores();
    cd.useCustomDataStore.getState().merge(SPEC);
    // enabled:true 가 강제이므로 isRecipeSelectable 을 통과한다.
    expect(gd.useGameDataStore.getState().itemToRecipe.get('my-thing')).toBe('my-thing');
  });

  it('getMachinesForRecipe 가 그 머신을 낸다 — 2단계 후보가 선다', async () => {
    const { gd, cd } = await stores();
    cd.useCustomDataStore.getState().merge(SPEC);
    expect(
      gd.useGameDataStore.getState().getMachinesForRecipe('my-thing').map((m) => m.name),
    ).toEqual(['my-plant']);
  });

  it('유체 상자가 회전 배열째 들어간다 — 하나만 있으면 회전 시 엉뚱한 행에 앉는다', async () => {
    const { gd, cd } = await stores();
    cd.useCustomDataStore.getState().merge(SPEC);
    const conn = gd.useGameDataStore.getState().entityMap.get('my-plant')!.fluid_boxes![0]
      .connections[0];
    expect(conn.direction).toBe(12); // W
    expect(conn.positions).toHaveLength(4);
  });

  /**
   * **검증이 본 것과 파이프라인이 볼 것이 같은가.**
   *
   * `fitFluidLines` 는 spec 을 그 자리에서 합성해 판정한다. 파이프라인은 `entityMap` 에
   * 들어앉은 엔티티를 본다. 둘이 어긋나면 *"저장은 통과했는데 배치는 거절"* 이 되고, 그건
   * 사용자가 고칠 수 없는 종류의 고장이다. 여기서 **저장된 엔티티로 직접** 돌려 닫는다.
   */
  it('저장된 엔티티를 파이프라인 함수에 그대로 넣어도 같은 회전이 나온다', async () => {
    const { gd, cd } = await stores();
    cd.useCustomDataStore.getState().merge(SPEC);

    const { chooseFluidTrunkPlan } = await import('../../autoLayout/module/fluidPorts');
    const { fluidLinesOf } = await import('../../factorio/customRecipe');
    const { fitFluidLines } = await import('../../factorio/customRecipeValidate');

    const entity = gd.useGameDataStore.getState().entityMap.get('my-plant')!;
    const fromStore = chooseFluidTrunkPlan(entity, { w: 5, h: 5 }, fluidLinesOf(SPEC.recipes[0]));
    const fromSpec = fitFluidLines(SPEC.machines[0], SPEC.recipes[0]);

    expect(fromStore.ok).toBe(true);
    expect(fromSpec.ok).toBe(true);
    expect(fromStore.ok && fromStore.direction).toBe(fromSpec.ok && fromSpec.direction);
    expect(fromStore.ok && fromStore.lines.map((l) => `${l.side}${l.fluidboxOffset}`)).toEqual(
      fromSpec.ok ? fromSpec.lines.map((l) => `${l.side}${l.fluidboxOffset}`) : [],
    );
  });
});

describe('재임포트 — 파일을 새로 올려도 살아남는다', () => {
  it('setGameData 는 커스텀을 지우고, syncCustomData 가 되살린다', async () => {
    const { gd, cd } = await stores();
    cd.useCustomDataStore.getState().merge(SPEC);
    expect(gd.useGameDataStore.getState().recipeMap.has('my-thing')).toBe(true);

    // 파일 업로드 = 배열 통째 교체. 여기서 사라지는 것이 **정상**이다.
    gd.useGameDataStore.getState().setGameData(structuredClone(GAME_DATA));
    expect(gd.useGameDataStore.getState().recipeMap.has('my-thing')).toBe(false);

    cd.syncCustomData();
    expect(gd.useGameDataStore.getState().recipeMap.has('my-thing')).toBe(true);
    expect(gd.useGameDataStore.getState().machineMap.has('my-plant')).toBe(true);
  });

  it('두 번 합류해도 항목이 안 불어난다 — 걷어내고 다시 넣기 때문', async () => {
    const { gd, cd } = await stores();
    cd.useCustomDataStore.getState().merge(SPEC);
    cd.syncCustomData();
    cd.syncCustomData();
    expect(gd.useGameDataStore.getState().recipes.filter((r) => r.custom)).toHaveLength(1);
    expect(gd.useGameDataStore.getState().entities.filter((e) => e.custom)).toHaveLength(1);
  });
});

describe('편집과 삭제', () => {
  it('같은 이름으로 다시 저장하면 덮어쓴다 — 자기 자신을 "이미 있는 이름" 으로 안 본다', async () => {
    const { gd, cd } = await stores();
    cd.useCustomDataStore.getState().merge(SPEC);
    const edited = {
      ...SPEC,
      recipes: [{ ...SPEC.recipes[0], energyRequired: 9 }],
    };
    expect(cd.useCustomDataStore.getState().merge(edited)).toEqual([]);
    expect(gd.useGameDataStore.getState().recipeMap.get('my-thing')?.energy_required).toBe(9);
    expect(cd.useCustomDataStore.getState().data.recipes).toHaveLength(1);
  });

  it('삭제하면 게임데이터에서도 빠진다', async () => {
    const { gd, cd } = await stores();
    cd.useCustomDataStore.getState().merge(SPEC);
    expect(cd.useCustomDataStore.getState().removeRecipe('my-thing')).toBe(true);
    expect(gd.useGameDataStore.getState().recipeMap.has('my-thing')).toBe(false);
    // 머신은 아직 남는다 — 따로 지운다.
    expect(gd.useGameDataStore.getState().machineMap.has('my-plant')).toBe(true);
    cd.useCustomDataStore.getState().removeMachine('my-plant');
    expect(gd.useGameDataStore.getState().machineMap.has('my-plant')).toBe(false);
  });

  it('바닐라 이름을 쓰면 거절하고 **아무것도 안 바꾼다**', async () => {
    const { gd, cd } = await stores();
    const clash = {
      machines: SPEC.machines,
      recipes: [{ ...SPEC.recipes[0], name: 'iron-gear-wheel' }],
    };
    const rejects = cd.useCustomDataStore.getState().merge(clash);
    expect(rejects.map((r) => r.kind)).toContain('name-taken');
    // 머신도 안 들어갔어야 한다 — 한 벌은 통째로 성공하거나 통째로 실패한다.
    expect(cd.useCustomDataStore.getState().data.machines).toHaveLength(0);
    expect(gd.useGameDataStore.getState().entityMap.has('my-plant')).toBe(false);
    // 바닐라 레시피는 멀쩡해야 한다.
    expect(gd.useGameDataStore.getState().recipeMap.get('iron-gear-wheel')?.energy_required).toBe(0.5);
  });

  it('면이 안 마주보면 거절한다 — 배치를 돌리기 전에 막는다', async () => {
    const { cd } = await stores();
    const bad = {
      machines: [
        {
          ...SPEC.machines[0],
          fluidBoxes: [
            { role: 'input' as const, face: 'N' as const, offset: 1 },
            { role: 'output' as const, face: 'E' as const, offset: 3 },
          ],
        },
      ],
      recipes: [
        {
          ...SPEC.recipes[0],
          products: [{ name: 'steam', amount: 10, type: 'fluid' as const }],
        },
      ],
    };
    expect(cd.useCustomDataStore.getState().merge(bad).map((r) => r.kind)).toContain(
      'fluid-no-rotation',
    );
  });
});
