/**
 * customRecipe — 사용자가 말하는 어휘를 **게임데이터 어휘로 옮긴다.**
 *
 * [parseGameData](parseGameData.ts) 의 **형제**다. 원천만 다르고(파일 대신 편집기/콘솔)
 * 도착지가 같다 — `gameDataStore` 가 그대로 삼킬 수 있는 `Recipe` · `Entity`.
 * 그래서 같은 규칙을 진다: **여기서 만든 필드만 앱 안으로 들어온다.**
 *
 * ## 이 파일의 전부는 유체 상자 좌표 합성이다
 *
 * 사용자는 *"입력은 W 면 1행"* 이라고 말한다. 게임데이터는 `{ direction, positions[4] }` 를
 * 요구한다. 그 변환이 여기 있고, 나머지는 받아 적기다.
 *
 * 식은 지어낸 것이 아니라 [resolveFluidConnection](../autoLayout/module/fluidPorts.ts) 의
 * **역함수**다. 그쪽이 좌표에서 행을 이렇게 뽑으므로
 *
 * ```
 * offset = floor(w / 2 + pos.x)      // N/S 면
 * offset = floor(h / 2 + pos.y)      // E/W 면
 * ```
 *
 * 역으로 행 `k` 의 좌표는 `k − size/2 + 0.5` 다(칸 **중심**). 짝수 크기 머신에서 반정수가
 * 나오는 것이 정상이다 — 4×4 의 칸 중심은 ±0.5 · ±1.5 다.
 *
 * ## 두 가지를 절대 안 한다
 *
 * **① 면을 좌표로 말하지 않는다.** 면은 `direction` 에만 있다 — *"진짜 답은
 * `PipeConnection.direction` 이다 … 추정 없음"*([fluidPorts](../autoLayout/module/fluidPorts.ts)
 * 머리말). `direction` 이 빠진 연결은 `resolveFluidConnection` 이 `null` 로 돌려보내고,
 * 그 머신은 유체를 **못 쓴다**.
 *
 * **② `positions` 를 하나만 넣지 않는다.** 그 배열은 N/E/S/W 로 **미리 돌려 둔** 좌표이고
 * 회전은 곧 배열 인덱스다. 하나만 넣으면 소비처가 `?? positions[0]` 로 폴백해 **엉뚱한 행**에
 * 앉는다 — 조용히.
 *
 * 두 규칙이 지켜졌는지는 추측이 아니라 **실측으로** 확인한다: `customRecipe.test.ts` 가
 * 화학 공장 3×3 과 SE 랩 9×9(둘 다 실게임 덤프)를 spec 으로 적어 여기 통과시킨 뒤
 * fixture 와 대조한다.
 */

import type {
  Entity,
  FluidBoxInfo,
  Recipe,
  RecipeIngredient,
  RecipeProduct,
  Vec2,
} from '../UI/store/gameDataStore';

// ─────────────────────────────────────────────────────────────────────────────
// 원천 자료형 — **사용자의 어휘**. 게임데이터 어휘가 아니라서 camelCase 다.
// ─────────────────────────────────────────────────────────────────────────────

/** 머신의 네 면. 전부 **회전 0 기준**이다. */
export type CustomFace = 'N' | 'E' | 'S' | 'W';

export const CUSTOM_FACES: CustomFace[] = ['N', 'E', 'S', 'W'];

export interface CustomFluidBoxSpec {
  /**
   * 레시피에서의 **용도**. `flow_direction`(물리 흐름)이 아니다 —
   * → docs/factorio/fluid-box-semantics.md
   */
  role: 'input' | 'output' | 'input-output';
  /** 이 상자가 붙는 면 (회전 0 기준). */
  face: CustomFace;
  /** 면 위 행/열. `0 … size−1`. */
  offset: number;
  /** 이 상자가 특정 유체만 받는다면 그 이름. */
  filter?: string;
  volume?: number;
}

export interface CustomMachineSpec {
  /** 엔티티 이름. **기본값 없음** — 이름과 저울(제작 속도)은 함께 온다. */
  name: string;
  /** N×N. 정사각만 — 유체 회전 배열이 정사각에서만 자명하다. */
  size: number;
  craftingSpeed: number;
  /** 최소 하나. 레시피의 `category` 가 여기 들어 있어야 그 레시피를 맡는다. */
  craftingCategories: string[];
  moduleSlots?: number;
  fluidBoxes: CustomFluidBoxSpec[];
}

export interface CustomStackSpec {
  name: string;
  amount: number;
  type: 'item' | 'fluid';
  /**
   * 유체만. **미지정이 정상이다** — 미지정이면 그 역할의 유체 상자 **전부**에 들어갈 수
   * 있다. `0` 은 실데이터에 절대 안 나오므로 **채우지 않는다**.
   * → docs/factorio/fluid-box-semantics.md
   */
  fluidboxIndex?: number;
  /** 산출에서만. */
  probability?: number;
}

export interface CustomRecipeSpec {
  name: string;
  /** 어떤 머신의 `craftingCategories` 에 들어 있어야 한다. */
  category: string;
  /** 제작 시간(초). */
  energyRequired: number;
  ingredients: CustomStackSpec[];
  products: CustomStackSpec[];
}

/** 이 앱이 아는 커스텀 전부. 스토어가 이것 **하나**를 들고 있는다. */
export interface CustomDataSpec {
  machines: CustomMachineSpec[];
  recipes: CustomRecipeSpec[];
}

export const EMPTY_CUSTOM_DATA: CustomDataSpec = { machines: [], recipes: [] };

// ─────────────────────────────────────────────────────────────────────────────
// 좌표 합성 — 이 파일의 핵심
// ─────────────────────────────────────────────────────────────────────────────

/** 면 → Factorio 방향(회전 0 기준). 머신을 `d` 돌리면 실제 면은 `(direction + d) % 16`. */
export const FACE_TO_DIRECTION: Record<CustomFace, number> = { N: 0, E: 4, S: 8, W: 12 };

/** 방향 → 면. `FACE_TO_DIRECTION` 의 역. 편집기가 기존 머신을 읽어올 때 쓴다. */
export const DIRECTION_TO_FACE: Record<number, CustomFace> = { 0: 'N', 4: 'E', 8: 'S', 12: 'W' };

/**
 * 면 `face` · 행 `offset` 인 유체 상자의 **회전 0 좌표** (머신 중심 기준, 칸 중심).
 *
 * `resolveFluidConnection` 의 역함수다(머리말). 면에 **나란한** 성분이 행을 정하고,
 * **수직** 성분은 그 면의 맨 바깥 칸으로 고정된다.
 */
export function fluidBoxPosition(size: number, face: CustomFace, offset: number): Vec2 {
  const along = offset - size / 2 + 0.5; // 면 위 k번째 칸의 중심
  const edge = size / 2 - 0.5; // 그 면 쪽 맨 바깥 칸의 중심
  switch (face) {
    case 'N':
      return { x: z(along), y: z(-edge) };
    case 'S':
      return { x: z(along), y: z(edge) };
    case 'W':
      return { x: z(-edge), y: z(along) };
    case 'E':
      return { x: z(edge), y: z(along) };
  }
}

/**
 * `-0` 을 `0` 으로. **계산에는 영향이 없고**(`floor(1.5 + -0) === floor(1.5 + 0)`), 값이
 * 한 가지 모양으로만 저장되게 하려는 것이다 — 3×3 의 가운데 행이나 1×1 머신이 부호 있는
 * 영을 만든다. 비교(`Object.is`)와 눈으로 읽는 덤프에서만 갈리는 차이라 여기서 없앤다.
 */
function z(n: number): number {
  return n === 0 ? 0 : n;
}

/**
 * 좌표 하나 → **N/E/S/W 네 방향으로 돌린 배열**.
 *
 * 회전은 `(x, y) → (−y, x)` 다. 화면 좌표(y 아래로 증가)에서 이건 **시계 방향**이고,
 * 그래서 N 을 보던 연결이 한 칸 뒤엔 E 를 본다 — `direction + 4` 와 짝이 맞는다.
 */
export function rot4(p: Vec2): Vec2[] {
  const out: Vec2[] = [{ x: z(p.x), y: z(p.y) }];
  for (let i = 0; i < 3; i++) {
    const prev = out[out.length - 1];
    out.push({ x: z(-prev.y), y: z(prev.x) });
  }
  return out;
}

/** 유체 상자 하나 → 게임데이터 `FluidBoxInfo`. `index` 규칙은 parseGameData 와 같다(`i + 1`). */
export function compileFluidBox(
  spec: CustomFluidBoxSpec,
  size: number,
  i: number,
): FluidBoxInfo {
  return {
    index: i + 1,
    production_type: spec.role,
    ...(spec.volume !== undefined ? { volume: spec.volume } : {}),
    ...(spec.filter ? { filter: spec.filter } : {}),
    connections: [
      {
        direction: FACE_TO_DIRECTION[spec.face],
        positions: rot4(fluidBoxPosition(size, spec.face, spec.offset)),
        // `flow_direction` 은 **비운다.** 그 필드는 "파이프가 물리적으로 어느 쪽으로 흐르나"
        // 라 `production_type`(레시피에서의 용도)과 다른 것을 잰다. 편집기는 용도만 물으므로
        // 흐름에 대해 할 말이 없다. 소비처는 전부 `flow_direction ?? production_type` 으로
        // 읽으니 비워 두면 용도가 그대로 답이 된다 — 모르는 칸을 지어내지 않는다.
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 합성 — spec → 게임데이터
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 커스텀 항목의 `id` 시작 번호.
 *
 * `Recipe.id`/`Entity.id` 는 `parseGameData` 가 **배열 인덱스 + 1** 로 매기고, 소비처는
 * React `key` 하나뿐이다. 그래도 겹치면 같은 키가 둘 생겨 목록이 튄다 — 실데이터 엔티티가
 * 수천 개라 백만부터 시작하면 부딪힐 일이 없다.
 */
export const CUSTOM_ID_BASE = 1_000_000;

/** 커스텀 머신 → `Entity`. */
export function compileCustomMachine(spec: CustomMachineSpec, id: number): Entity {
  const fluidBoxes = spec.fluidBoxes.map((fb, i) => compileFluidBox(fb, spec.size, i));
  return {
    id,
    name: spec.name,
    localised_name: spec.name,
    // 조립기로 고정한다 — 사이드바 assembler 탭 · `EntityType.Assembler` 로 간다.
    // 화로/광산은 파이프라인 취급이 달라 크기·유체 상자만으로 흉내 낼 수 없다.
    type: 'assembling-machine',
    tile_width: spec.size,
    tile_height: spec.size,
    crafting_speed: spec.craftingSpeed,
    crafting_categories: [...spec.craftingCategories],
    ...(spec.moduleSlots !== undefined ? { module_slots: spec.moduleSlots } : {}),
    // 빈 배열 대신 `undefined` — parseFluidBoxes 가 그렇게 한다(`length === 0` 이면 nil).
    ...(fluidBoxes.length > 0 ? { fluid_boxes: fluidBoxes } : {}),
    custom: true,
  };
}

/** 커스텀 레시피 → `Recipe`. */
export function compileCustomRecipe(spec: CustomRecipeSpec, id: number): Recipe {
  return {
    id,
    name: spec.name,
    localised_name: spec.name,
    category: spec.category,
    energy_required: spec.energyRequired,
    // **강제다.** `buildDerived.isRecipeSelectable` 이 `enabled === true` 이거나 어떤 기술이
    // 언록하는 레시피만 `itemToRecipe`·`recipesByProduct` 에 넣는다. 커스텀은 기술이 없으므로
    // 이게 아니면 만들어 놓고도 콤보박스에 안 뜬다. 사용자에게 묻지 않는다 — 선택지가 아니다.
    enabled: true,
    ingredients: spec.ingredients.map(toIngredient),
    products: spec.products.map(toProduct),
    custom: true,
  };
}

function toIngredient(s: CustomStackSpec): RecipeIngredient {
  return {
    name: s.name,
    amount: s.amount,
    type: s.type,
    ...(s.type === 'fluid' && s.fluidboxIndex !== undefined
      ? { fluidbox_index: s.fluidboxIndex }
      : {}),
  };
}

function toProduct(s: CustomStackSpec): RecipeProduct {
  return {
    name: s.name,
    amount: s.amount,
    type: s.type,
    ...(s.probability !== undefined ? { probability: s.probability } : {}),
    ...(s.type === 'fluid' && s.fluidboxIndex !== undefined
      ? { fluidbox_index: s.fluidboxIndex }
      : {}),
  };
}

/**
 * 한 벌 전체 → 게임데이터 조각.
 *
 * **검증하지 않는다.** 합성은 순수한 번역이고, 판정은 [customRecipeValidate] 가 맡는다.
 * 어긋난 spec 도 합성은 되어야 한다 — 그래야 `flg.custom.map()` 이 *"무엇이 잘못 앉았나"* 를
 * 그려 보여 줄 수 있다.
 */
export function compileCustomData(spec: CustomDataSpec): {
  recipes: Recipe[];
  entities: Entity[];
} {
  return {
    entities: spec.machines.map((m, i) => compileCustomMachine(m, CUSTOM_ID_BASE + i)),
    recipes: spec.recipes.map((r, i) => compileCustomRecipe(r, CUSTOM_ID_BASE + i)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 조회 헬퍼 — 검증기·콘솔·편집기가 함께 쓴다
// ─────────────────────────────────────────────────────────────────────────────

/** 이 상자가 그 역할을 맡나. `input-output` 은 양쪽 다. */
export function fluidBoxAcceptsRole(
  role: CustomFluidBoxSpec['role'],
  want: 'input' | 'output',
): boolean {
  return role === want || role === 'input-output';
}

/**
 * 유체 상자의 **역할별 서수**(1-based) — 레시피 `fluidbox_index` 가 세는 방식과 같다.
 * 입력끼리 1,2… 출력끼리 1,2… 로 **따로** 세고 순서는 배열 등장 순서다.
 * → docs/factorio/fluid-box-semantics.md
 */
export function roleOrdinals(
  boxes: readonly CustomFluidBoxSpec[],
  want: 'input' | 'output',
): Map<number, number> {
  const out = new Map<number, number>();
  let n = 0;
  boxes.forEach((fb, i) => {
    if (fluidBoxAcceptsRole(fb.role, want)) out.set(i, ++n);
  });
  return out;
}

/** 이 레시피가 쓰는 유체 줄 — 검증기가 `chooseFluidTrunkPlan` 에 그대로 넘긴다. */
export function fluidLinesOf(
  recipe: CustomRecipeSpec,
): Array<{ name: string; role: 'input' | 'output'; fluidboxIndex?: number }> {
  return [
    ...recipe.ingredients
      .filter((s) => s.type === 'fluid')
      .map((s) => ({ name: s.name, role: 'input' as const, fluidboxIndex: s.fluidboxIndex })),
    ...recipe.products
      .filter((s) => s.type === 'fluid')
      .map((s) => ({ name: s.name, role: 'output' as const, fluidboxIndex: s.fluidboxIndex })),
  ];
}
