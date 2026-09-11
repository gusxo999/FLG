/**
 * customRecipeValidate — **저장 시점에 무엇을 막나.**
 *
 * 여기서 가장 중요한 것은 §면 규약이다: 파이프라인은 *"모든 줄이 자기 역할 면(출력 W ·
 * 입력 E)에 오는"* 회전을 찾으므로, 입력 면과 출력 면이 **마주보지 않으면** 네 회전 어디에도
 * 안 앉는다. 그 판정을 우리가 재현하지 않고 `chooseFluidTrunkPlan` 을 그대로 부르는 것이
 * 설계라서, 이 테스트는 **그 위임이 살아 있는지**를 본다 — 규칙을 베껴 적었다면 여기 90°·
 * 180° 케이스가 통과하면서도 실제 배치는 거절될 수 있다.
 */
import { describe, it, expect } from 'vitest';
import {
  fitFluidLines,
  rejectionsOf,
  validateCustomData,
  type ValidateContext,
} from './customRecipeValidate';
import type {
  CustomDataSpec,
  CustomFace,
  CustomMachineSpec,
  CustomRecipeSpec,
  CustomStackSpec,
} from './customRecipe';

const CAT = 'custom-cat';

const mach = (fluidBoxes: CustomMachineSpec['fluidBoxes'], size = 3): CustomMachineSpec => ({
  name: 'plant',
  size,
  craftingSpeed: 1,
  craftingCategories: [CAT],
  fluidBoxes,
});

const rec = (
  ingredients: CustomStackSpec[],
  products: CustomStackSpec[],
): CustomRecipeSpec => ({
  name: 'thing',
  category: CAT,
  energyRequired: 1,
  ingredients,
  products,
});

const item = (name: string, amount = 1): CustomStackSpec => ({ name, amount, type: 'item' });
const fluid = (name: string, amount = 10, fluidboxIndex?: number): CustomStackSpec => ({
  name, amount, type: 'fluid', ...(fluidboxIndex !== undefined ? { fluidboxIndex } : {}),
});

const bundle = (m: CustomMachineSpec, r: CustomRecipeSpec): CustomDataSpec => ({
  machines: [m],
  recipes: [r],
});

const kinds = (spec: CustomDataSpec, ctx?: ValidateContext) =>
  validateCustomData(spec, ctx).map((i) => `${i.severity}:${i.kind}`);

describe('면 규약 — 입력과 출력은 마주봐야 앉는다', () => {
  const inOut = (inFace: CustomFace, outFace: CustomFace) =>
    mach([
      { role: 'input', face: inFace, offset: 0 },
      { role: 'output', face: outFace, offset: 2 },
    ]);
  const oneEach = rec([fluid('water')], [fluid('steam')]);

  it('입력 N · 출력 S — 90° 로 성립', () => {
    const fit = fitFluidLines(inOut('N', 'S'), oneEach);
    expect(fit.ok).toBe(true);
    // 입력이 E 로 오려면 N(0) + 4 = E. 그 각도에서 출력 S(8) + 4 = 12 = W 로 맞아떨어진다.
    expect(fit.ok && fit.direction).toBe(4);
  });

  it('입력 W · 출력 E — 180° 로 성립 (SE 랩과 같은 모양)', () => {
    const fit = fitFluidLines(inOut('W', 'E'), oneEach);
    expect(fit.ok && fit.direction).toBe(8);
  });

  it('입력 N · 출력 E — 90° 어긋나 어떤 회전에도 안 앉는다', () => {
    const fit = fitFluidLines(inOut('N', 'E'), oneEach);
    expect(fit.ok).toBe(false);
    expect(!fit.ok && fit.kind).toBe('fluid-no-rotation');
  });

  it('입력과 출력이 같은 면이면 안 앉는다', () => {
    expect(fitFluidLines(inOut('N', 'N'), oneEach).ok).toBe(false);
  });

  it('안 앉는 머신뿐이면 저장을 막는다', () => {
    expect(kinds(bundle(inOut('N', 'E'), oneEach))).toContain('reject:fluid-no-rotation');
  });

  it('유체를 안 쓰는 레시피는 상자 배치와 무관하게 통과', () => {
    const onlyItems = rec([item('iron-plate', 2)], [item('thing')]);
    expect(fitFluidLines(inOut('N', 'E'), onlyItems).ok).toBe(true);
    expect(rejectionsOf(validateCustomData(bundle(inOut('N', 'E'), onlyItems)))).toEqual([]);
  });

  it('유체 줄이 상자보다 많으면 안 앉는다', () => {
    const oneInputBox = mach([
      { role: 'input', face: 'W', offset: 0 },
      { role: 'output', face: 'E', offset: 2 },
    ]);
    const twoFluidIn = rec([fluid('water'), fluid('acid')], [item('thing')]);
    expect(fitFluidLines(oneInputBox, twoFluidIn).ok).toBe(false);
  });

  it('상자가 줄보다 많으면 남는 칸을 보고한다 — 트렁크가 스치면 안 되는 행이다', () => {
    const twoInputBoxes = mach([
      { role: 'input', face: 'W', offset: 0 },
      { role: 'input', face: 'W', offset: 2 },
      { role: 'output', face: 'E', offset: 1 },
    ]);
    const fit = fitFluidLines(twoInputBoxes, rec([fluid('water')], [fluid('steam')]));
    expect(fit.ok).toBe(true);
    // 180° 에서 W 면 상자는 E 로 온다. 한 줄만 쓰므로 나머지 한 칸이 남는다.
    expect(fit.ok && fit.unused.E).toHaveLength(1);
  });
});

describe('유체 상자 번호 — 못박은 서수', () => {
  const twoIn = mach([
    { role: 'input', face: 'W', offset: 0 },
    { role: 'input', face: 'W', offset: 2 },
    { role: 'output', face: 'E', offset: 1 },
  ]);

  it('있는 번호를 못박으면 그 상자에 앉는다', () => {
    const fit = fitFluidLines(twoIn, rec([fluid('water', 10, 2)], [item('thing')]));
    expect(fit.ok).toBe(true);
  });

  it('없는 번호를 못박으면 "회전 없음" 이 아니라 그 사유가 나온다', () => {
    const fit = fitFluidLines(twoIn, rec([fluid('water', 10, 3)], [item('thing')]));
    expect(!fit.ok && fit.kind).toBe('fluidbox-index');
    expect(!fit.ok && fit.detail).toContain('3번');
  });

  it('아이템에 붙은 상자 번호는 경고만 — 합성에서 버려진다', () => {
    const r = rec([{ name: 'iron-plate', amount: 1, type: 'item', fluidboxIndex: 1 }], [item('thing')]);
    expect(kinds(bundle(mach([]), r))).toContain('warn:fluidbox-index');
  });
});

describe('이름 · 수치 · 카테고리', () => {
  it('게임데이터에 있는 이름은 막는다 — Map 은 나중 것이 조용히 이긴다', () => {
    const ctx: ValidateContext = {
      existingRecipeNames: new Set(['thing']),
      existingEntityNames: new Set(['plant']),
      gameMachinesForCategory: () => [],
    };
    const got = kinds(bundle(mach([]), rec([item('a')], [item('thing')])), ctx);
    expect(got.filter((k) => k === 'reject:name-taken')).toHaveLength(2);
  });

  it('커스텀끼리 이름이 겹쳐도 막는다', () => {
    const spec: CustomDataSpec = {
      machines: [mach([]), mach([])],
      recipes: [],
    };
    expect(kinds(spec)).toContain('reject:duplicate-name');
  });

  it('수량 0 은 막는다 — NaN 이 탭 수를 지나 인서터를 조용히 0개로 만든다', () => {
    expect(kinds(bundle(mach([]), rec([item('iron-plate', 0)], [item('thing')])))).toContain(
      'reject:bad-amount',
    );
  });

  it('산출물이 없으면 막는다', () => {
    expect(kinds(bundle(mach([]), rec([item('a')], [])))).toContain('reject:no-product');
  });

  it('카테고리를 맡는 머신이 없으면 막는다', () => {
    const orphan: CustomDataSpec = {
      machines: [],
      recipes: [{ ...rec([item('a')], [item('thing')]), category: 'nobody' }],
    };
    expect(kinds(orphan)).toContain('reject:category-orphan');
  });

  it('기존 게임 머신이 그 카테고리를 맡으면 통과', () => {
    const ctx: ValidateContext = {
      existingRecipeNames: new Set(),
      existingEntityNames: new Set(),
      gameMachinesForCategory: (c) => (c === 'crafting' ? [{ name: 'assembling-machine-2' } as never] : []),
    };
    const onVanilla: CustomDataSpec = {
      machines: [],
      recipes: [{ ...rec([item('a')], [item('thing')]), category: 'crafting' }],
    };
    expect(rejectionsOf(validateCustomData(onVanilla, ctx))).toEqual([]);
  });

  it('행이 범위 밖이면 막는다 — clamp 가 조용히 끌어당긴다', () => {
    expect(kinds(bundle(mach([{ role: 'input', face: 'W', offset: 3 }]), rec([item('a')], [item('b')])))).toContain(
      'reject:offset-range',
    );
  });

  it('같은 면 같은 행에 상자 둘이면 막는다 — 배정은 배타적이다', () => {
    const clash = mach([
      { role: 'input', face: 'W', offset: 1 },
      { role: 'output', face: 'W', offset: 1 },
    ]);
    expect(kinds(bundle(clash, rec([item('a')], [item('b')])))).toContain('reject:offset-clash');
  });

  it('유체를 쓰는데 상자가 없으면 막는다', () => {
    expect(kinds(bundle(mach([]), rec([fluid('water')], [item('thing')])))).toContain(
      'reject:no-fluid-box',
    );
  });
});

describe('좌석 예산 — 경고이지 거절이 아니다', () => {
  it('3×3 에 유체 입력 3줄 + 아이템 재료 → 벨트가 안 들어간다고 알린다', () => {
    const threeIn = mach([
      { role: 'input', face: 'W', offset: 0 },
      { role: 'input', face: 'W', offset: 1 },
      { role: 'input', face: 'W', offset: 2 },
      { role: 'output', face: 'E', offset: 0 },
    ]);
    const r = rec([fluid('a'), fluid('b'), fluid('c'), item('iron-plate')], [item('thing')]);
    const got = kinds(bundle(threeIn, r));
    expect(got).toContain('warn:seats-tight');
    expect(got).not.toContain('reject:seats-tight');
  });

  it('아이템 재료가 없으면 유체가 면을 다 먹어도 조용하다 — 경유 분해가 그렇다', () => {
    const threeIn = mach([
      { role: 'input', face: 'W', offset: 0 },
      { role: 'input', face: 'W', offset: 1 },
      { role: 'input', face: 'W', offset: 2 },
      { role: 'output', face: 'E', offset: 0 },
    ]);
    const r = rec([fluid('a'), fluid('b'), fluid('c')], [fluid('d')]);
    expect(kinds(bundle(threeIn, r))).not.toContain('warn:seats-tight');
  });
});
