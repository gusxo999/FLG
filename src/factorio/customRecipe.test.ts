/**
 * customRecipe — **합성식이 실제 게임데이터와 같은 것을 내나.**
 *
 * 이 파일의 기대값은 **실게임 덤프를 옮겨 적은 것**이다(출처: `fluidPorts.test.ts` 의 두
 * fixture — 화학 공장 3×3 은 2026-07-13 브라우저 덤프, SE 랩 9×9 는 SE 0.7.57 원본).
 *
 * > **기대값을 코드에 맞추지 않는다.** 어긋나면 틀린 쪽은 합성식이다. 좌표를 손으로 지어내
 * > 맞추는 순간 *"실제 데이터와 다른 것"* 을 시험하게 된다 — fixture 원주석이 경계하는 바로
 * > 그 함정이다.
 *
 * 그리고 실데이터에 **짝수 크기 유체 머신이 없다.** 그 칸은 대조군이 없으므로
 * `resolveFluidConnection` 왕복으로 시험한다 — 합성식이 그 함수의 역함수라는 주장 자체를
 * 시험하는 것이라, 대조군이 없어도 증명이 된다.
 */
import { describe, it, expect } from 'vitest';
import {
  CUSTOM_FACES,
  compileCustomMachine,
  compileCustomRecipe,
  fluidBoxPosition,
  fluidLinesOf,
  roleOrdinals,
  rot4,
  type CustomFluidBoxSpec,
  type CustomMachineSpec,
} from './customRecipe';
import { resolveFluidConnection } from '../autoLayout/module/fluidPorts';
import type { Direction } from '../types/layout';

const machine = (
  name: string,
  size: number,
  fluidBoxes: CustomFluidBoxSpec[],
): CustomMachineSpec => ({
  name,
  size,
  craftingSpeed: 1,
  craftingCategories: [`custom-${name}`],
  fluidBoxes,
});

describe('유체 상자 합성 — 실게임 덤프와 대조', () => {
  /**
   * 화학 공장 3×3. 입력은 위쪽 두 모서리(N 면 0·2행), 출력은 아래쪽 두 모서리(S 면 0·2행).
   * **`positions` 네 개를 통째로** 대조한다 — 여기가 `rot4` 의 유일한 실측 검증 자리다.
   */
  it('화학 공장 3×3 — direction 과 positions 네 개가 덤프와 같다', () => {
    const ent = compileCustomMachine(
      machine('chemical-plant', 3, [
        { role: 'input', face: 'N', offset: 0 },
        { role: 'input', face: 'N', offset: 2 },
        { role: 'output', face: 'S', offset: 0 },
        { role: 'output', face: 'S', offset: 2 },
      ]),
      1,
    );

    expect(ent.fluid_boxes?.map((fb) => fb.connections[0])).toEqual([
      // 실측: 입력 상자는 위로 나간다(direction 0), 좌표는 **머신 안쪽 모서리 칸**이다.
      { direction: 0, positions: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }] },
      { direction: 0, positions: [{ x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }] },
      // 실측: 출력은 아래로 나간다(direction 8).
      { direction: 8, positions: [{ x: -1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }] },
      { direction: 8, positions: [{ x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }] },
    ]);
  });

  /**
   * `se-space-biochemical-laboratory` 9×9 — 유체 상자 **12개**. 입력이 W·N 에 3개씩,
   * 출력이 E·S 에 3개씩이라 **우리 규약(입력 E · 출력 W)과 반대로 생긴** 머신이다.
   *
   * 여기서는 회전 0 좌표와 방향만 본다(`rot4` 는 위에서 이미 통째로 검증됐다).
   * 홀수·큰 크기에서 `edge`·`along` 이 맞는지가 이 케이스의 몫이다.
   */
  it('SE 랩 9×9 — 면·행에서 나온 좌표가 모드 원본과 같다', () => {
    const spec = machine('se-space-biochemical-laboratory', 9, [
      { role: 'input', face: 'W', offset: 6 },
      { role: 'input', face: 'N', offset: 2 },
      { role: 'input', face: 'W', offset: 4 },
      { role: 'input', face: 'N', offset: 4 },
      { role: 'input', face: 'W', offset: 2 },
      { role: 'input', face: 'N', offset: 6 },
      { role: 'output', face: 'S', offset: 2 },
      { role: 'output', face: 'E', offset: 6 },
      { role: 'output', face: 'S', offset: 4 },
      { role: 'output', face: 'E', offset: 4 },
      { role: 'output', face: 'S', offset: 6 },
      { role: 'output', face: 'E', offset: 2 },
    ]);
    const ent = compileCustomMachine(spec, 1);

    // 모드 원본 순서 그대로 — (direction, 회전 0 좌표).
    expect(
      ent.fluid_boxes?.map((fb) => [fb.connections[0].direction, fb.connections[0].positions[0]]),
    ).toEqual([
      [12, { x: -4, y: 2 }],
      [0, { x: -2, y: -4 }],
      [12, { x: -4, y: 0 }],
      [0, { x: 0, y: -4 }],
      [12, { x: -4, y: -2 }],
      [0, { x: 2, y: -4 }],
      [8, { x: -2, y: 4 }],
      [4, { x: 4, y: 2 }],
      [8, { x: 0, y: 4 }],
      [4, { x: 4, y: 0 }],
      [8, { x: 2, y: 4 }],
      [4, { x: 4, y: -2 }],
    ]);
  });

  it('index 는 배열 자리 + 1 — parseGameData 와 같은 규칙', () => {
    const ent = compileCustomMachine(
      machine('m', 3, [
        { role: 'input', face: 'W', offset: 0 },
        { role: 'output', face: 'E', offset: 0 },
      ]),
      1,
    );
    expect(ent.fluid_boxes?.map((fb) => fb.index)).toEqual([1, 2]);
  });

  it('유체 상자가 없으면 fluid_boxes 는 빈 배열이 아니라 없다', () => {
    const ent = compileCustomMachine(machine('m', 3, []), 1);
    expect(ent.fluid_boxes).toBeUndefined();
  });

  it('flow_direction 은 안 채운다 — 소비처가 production_type 으로 떨어지게 둔다', () => {
    const ent = compileCustomMachine(
      machine('m', 3, [{ role: 'input', face: 'W', offset: 1 }]),
      1,
    );
    const conn = ent.fluid_boxes![0].connections[0];
    expect(conn.flow_direction).toBeUndefined();
    expect(ent.fluid_boxes![0].production_type).toBe('input');
  });
});

describe('합성식은 resolveFluidConnection 의 역함수다', () => {
  /**
   * **대조군이 없는 칸을 여기서 막는다.** 실데이터에 짝수 크기 유체 머신이 없어 위 두
   * 케이스가 1·3·5… 만 본다. 왕복은 크기와 무관하게 성립해야 한다 — 짝수에서 반정수
   * 좌표가 나오는데, 그게 `Math.floor` 를 지나 같은 행으로 돌아오는지가 요점이다.
   */
  it.each([1, 2, 3, 4, 5, 6, 9])('%i×%i — 면·행이 그대로 돌아온다 (회전 0)', (size) => {
    for (const face of CUSTOM_FACES) {
      for (let offset = 0; offset < size; offset++) {
        const ent = compileCustomMachine(machine('m', size, [{ role: 'input', face, offset }]), 1);
        const conn = ent.fluid_boxes![0].connections[0];
        expect(resolveFluidConnection(conn, { w: size, h: size }, 0)).toEqual({ face, offset });
      }
    }
  });

  /**
   * 머신을 돌리면 면이 따라 돈다 — `(direction + d) % 16`. 이게 맞아야 `positions` 배열의
   * **순서**가 `direction` 과 짝이 맞는 것이다(둘이 어긋나면 회전했을 때만 틀린다).
   */
  it.each([
    [0 as Direction, 'W'],
    [4 as Direction, 'N'],
    [8 as Direction, 'E'],
    [12 as Direction, 'S'],
  ])('회전 %i 에서 W 면 상자는 %s 면에 온다', (direction, expectedFace) => {
    const ent = compileCustomMachine(
      machine('m', 5, [{ role: 'input', face: 'W', offset: 1 }]),
      1,
    );
    const conn = ent.fluid_boxes![0].connections[0];
    expect(resolveFluidConnection(conn, { w: 5, h: 5 }, direction)?.face).toBe(expectedFace);
  });

  it('짝수 크기에서 좌표는 반정수다 — 칸 중심이라 그렇다', () => {
    expect(fluidBoxPosition(4, 'N', 0)).toEqual({ x: -1.5, y: -1.5 });
    expect(fluidBoxPosition(4, 'E', 3)).toEqual({ x: 1.5, y: 1.5 });
  });

  it('rot4 는 네 개를 내고 한 바퀴 돌면 제자리다', () => {
    const p = { x: 2, y: -1 };
    const four = rot4(p);
    expect(four).toHaveLength(4);
    expect(rot4(four[3])[1]).toEqual(p);
  });
});

describe('레시피 합성', () => {
  it('enabled 는 항상 true — 아니면 후보 목록에 안 뜬다', () => {
    const r = compileCustomRecipe(
      { name: 'r', category: 'c', energyRequired: 2, ingredients: [], products: [] },
      1,
    );
    expect(r.enabled).toBe(true);
    expect(r.custom).toBe(true);
  });

  it('아이템 재료에는 fluidbox_index 를 안 붙인다', () => {
    const r = compileCustomRecipe(
      {
        name: 'r',
        category: 'c',
        energyRequired: 1,
        ingredients: [
          { name: 'iron-plate', amount: 2, type: 'item', fluidboxIndex: 1 },
          { name: 'water', amount: 50, type: 'fluid', fluidboxIndex: 2 },
          { name: 'steam', amount: 10, type: 'fluid' },
        ],
        products: [{ name: 'thing', amount: 1, type: 'item' }],
      },
      1,
    );
    expect(r.ingredients[0].fluidbox_index).toBeUndefined();
    expect(r.ingredients[1].fluidbox_index).toBe(2);
    // 미지정은 **키가 아예 없어야** 한다 — 0 을 채우면 "그 역할 전부" 의 뜻이 사라진다.
    expect('fluidbox_index' in r.ingredients[2]).toBe(false);
  });

  it('유체 줄은 재료→입력 · 산출→출력 순으로 뽑힌다', () => {
    expect(
      fluidLinesOf({
        name: 'r',
        category: 'c',
        energyRequired: 1,
        ingredients: [
          { name: 'iron-plate', amount: 1, type: 'item' },
          { name: 'water', amount: 50, type: 'fluid' },
        ],
        products: [
          { name: 'steam', amount: 10, type: 'fluid', fluidboxIndex: 1 },
          { name: 'ash', amount: 1, type: 'item' },
        ],
      }),
    ).toEqual([
      { name: 'water', role: 'input', fluidboxIndex: undefined },
      { name: 'steam', role: 'output', fluidboxIndex: 1 },
    ]);
  });

  it('역할별 서수는 입력끼리 · 출력끼리 따로 센다', () => {
    const boxes: CustomFluidBoxSpec[] = [
      { role: 'input', face: 'W', offset: 0 },
      { role: 'output', face: 'E', offset: 0 },
      { role: 'input', face: 'W', offset: 2 },
      { role: 'input-output', face: 'W', offset: 1 },
    ];
    // 배열 자리 0·2·3 이 입력 1·2·3 (input-output 도 입력을 맡는다).
    expect([...roleOrdinals(boxes, 'input')]).toEqual([[0, 1], [2, 2], [3, 3]]);
    // 출력은 자리 1·3 이 1·2.
    expect([...roleOrdinals(boxes, 'output')]).toEqual([[1, 1], [3, 2]]);
  });
});
