/**
 * customRecipeValidate — **저장하기 전에 막는다.**
 *
 * 커스텀 머신이 파이프라인에 안 맞는 방식은 대부분 **조용하다**. 유체 상자가 엉뚱한 면에
 * 있으면 화면도 저장도 멀쩡하고, 배치를 돌려서야 *"물러설 곳이 없었습니다"* 가 나온다.
 * 그래서 판정을 **만드는 시점**으로 당긴다.
 *
 * ## 규칙을 다시 적지 않는다 — 그 함수를 부른다
 *
 * 가장 센 제약(입력은 E · 출력은 W 인 회전이 있어야 한다)은 여기서 재현하지 않고
 * [chooseFluidTrunkPlan](../autoLayout/module/fluidPorts.ts) 을 **실제로 돌린다.**
 * `resolveFluidConnection` 의 주석이 그 이유를 이미 적어 뒀다 —
 * *"유체 상자의 면을 읽는 규칙이 두 벌 있으면 한쪽만 고쳐지고 다른 쪽이 조용히 틀린다."*
 *
 * 그래서 이 파일은 `src/factorio/` 에 있으면서 `src/autoLayout/` 을 **위로 참조한다**.
 * 뒤집힌 방향인 걸 알고 그렇게 뒀다: 규칙의 집이 하나여야 하고, 그 집은 파이프라인이다.
 * (순환은 없다 — `autoLayout/` 은 `factorio/` 를 참조하지 않는다.)
 *
 * ## 순수하다
 *
 * 스토어를 안 본다. 기존 이름·기존 머신은 [ValidateContext] 로 **주입**받는다 — 그래야
 * 게임데이터 없이 테스트할 수 있고, 콘솔과 편집기가 같은 함수를 부를 수 있다.
 */

import type { Entity } from '../UI/store/gameDataStore';
import {
  chooseFluidTrunkPlan,
  type FluidLinePlan,
  type FluidLineSpec,
} from '../autoLayout/module/fluidPorts';
import {
  compileCustomMachine,
  fluidLinesOf,
  roleOrdinals,
  type CustomDataSpec,
  type CustomFace,
  type CustomMachineSpec,
  type CustomRecipeSpec,
} from './customRecipe';

// ─────────────────────────────────────────────────────────────────────────────
// 사유 — 문장이 아니라 필드로 낸다
// ─────────────────────────────────────────────────────────────────────────────

export type CustomIssueKind =
  | 'blank-name'
  | 'duplicate-name'
  | 'name-taken'
  | 'bad-size'
  | 'offset-range'
  | 'offset-clash'
  | 'no-fluid-box'
  | 'category-orphan'
  | 'fluidbox-index'
  | 'fluid-no-rotation'
  | 'bad-amount'
  | 'no-product'
  | 'seats-tight';

/**
 * 어긋남 하나.
 *
 * `fix` 는 **다음에 할 일**이다 — 사유만 있으면 사용자는 다시 묻는다.
 * 콘솔 `registry` 의 `available` 이 같은 규약을 쓴다.
 */
export interface CustomDataIssue {
  kind: CustomIssueKind;
  /** `reject` 는 저장을 막고, `warn` 은 알리기만 한다. */
  severity: 'reject' | 'warn';
  /** 어디가 — `machine:my-plant` · `recipe:my-recipe.ingredients[2]` */
  where: string;
  detail: string;
  fix: string;
}

export interface ValidateContext {
  /** 게임데이터에 이미 있는 레시피 이름(커스텀 제외). */
  existingRecipeNames: ReadonlySet<string>;
  /** 게임데이터에 이미 있는 엔티티 이름(커스텀 제외). */
  existingEntityNames: ReadonlySet<string>;
  /** 이 카테고리를 맡는 **기존 게임** 머신들. 커스텀 머신은 spec 안에서 찾는다. */
  gameMachinesForCategory: (category: string) => Entity[];
}

export const EMPTY_VALIDATE_CONTEXT: ValidateContext = {
  existingRecipeNames: new Set(),
  existingEntityNames: new Set(),
  gameMachinesForCategory: () => [],
};

// ─────────────────────────────────────────────────────────────────────────────
// 유체 적합 판정 — 한 (레시피, 머신) 짝
// ─────────────────────────────────────────────────────────────────────────────

export type FluidFit =
  | { ok: true; direction: number; lines: FluidLinePlan[]; unused: Partial<Record<CustomFace, number[]>> }
  | { ok: false; kind: 'fluidbox-index' | 'fluid-no-rotation'; detail: string };

/**
 * 이 머신이 이 레시피의 유체 줄을 **앉힐 수 있나** — 그리고 그때 몇 도로 도나.
 *
 * 콘솔의 `flg.custom.check`·`flg.custom.map` 도 이걸 부른다. 판정과 그림이 같은 답을 봐야
 * *"검사는 통과인데 그림은 다르다"* 가 안 생긴다.
 */
export function fitFluidLines(
  machine: CustomMachineSpec,
  recipe: CustomRecipeSpec,
  entity?: Entity,
): FluidFit {
  const lines = fluidLinesOf(recipe) as FluidLineSpec[];
  if (lines.length === 0) {
    return { ok: true, direction: 0, lines: [], unused: {} };
  }

  // 못박은 서수가 상자 수를 넘는지 **먼저** 본다. 안 그러면 chooseFluidTrunkPlan 이
  // "쓸 유체 상자 없음" 이라는 뭉뚱그린 사유를 내고, 사용자는 어느 줄이 문제인지 모른다.
  for (const role of ['input', 'output'] as const) {
    const count = roleOrdinals(machine.fluidBoxes, role).size;
    for (const line of lines) {
      if (line.role !== role || line.fluidboxIndex === undefined) continue;
      if (line.fluidboxIndex > count || line.fluidboxIndex < 1) {
        return {
          ok: false,
          kind: 'fluidbox-index',
          detail: `${line.name} 이(가) ${role} 유체 상자 ${line.fluidboxIndex}번을 못박았는데 ${machine.name} 의 ${role} 상자는 ${count}개다`,
        };
      }
    }
  }

  const ent = entity ?? compileCustomMachine(machine, 0);
  const plan = chooseFluidTrunkPlan(ent, { w: machine.size, h: machine.size }, lines);
  if (!plan.ok) {
    return { ok: false, kind: 'fluid-no-rotation', detail: plan.detail };
  }
  return {
    ok: true,
    direction: plan.direction,
    lines: plan.lines,
    unused: plan.unusedFluidboxRows as Partial<Record<CustomFace, number[]>>,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 검증
// ─────────────────────────────────────────────────────────────────────────────

/** 한 벌 전체를 판정한다. 빈 배열이면 저장해도 된다. */
export function validateCustomData(
  spec: CustomDataSpec,
  ctx: ValidateContext = EMPTY_VALIDATE_CONTEXT,
): CustomDataIssue[] {
  const issues: CustomDataIssue[] = [];
  const seenMachines = new Set<string>();
  const seenRecipes = new Set<string>();

  for (const m of spec.machines) {
    validateMachine(m, spec, ctx, seenMachines, issues);
  }
  for (const r of spec.recipes) {
    validateRecipe(r, spec, ctx, seenRecipes, issues);
  }
  return issues;
}

/** 저장을 막는 것만. 편집기의 [저장] 버튼이 이것으로 판단한다. */
export function rejectionsOf(issues: readonly CustomDataIssue[]): CustomDataIssue[] {
  return issues.filter((i) => i.severity === 'reject');
}

function validateMachine(
  m: CustomMachineSpec,
  spec: CustomDataSpec,
  ctx: ValidateContext,
  seen: Set<string>,
  out: CustomDataIssue[],
): void {
  const where = `machine:${m.name || '(이름 없음)'}`;

  if (!m.name.trim()) {
    out.push({
      kind: 'blank-name', severity: 'reject', where,
      detail: '머신 이름이 비어 있다',
      fix: '이름을 적는다 — 엔티티는 이름으로만 지목된다',
    });
  } else if (seen.has(m.name)) {
    out.push({
      kind: 'duplicate-name', severity: 'reject', where,
      detail: `커스텀 머신 이름이 겹친다: ${m.name}`,
      fix: '한쪽 이름을 바꾼다',
    });
  } else if (ctx.existingEntityNames.has(m.name)) {
    out.push({
      kind: 'name-taken', severity: 'reject', where,
      detail: `게임데이터에 이미 있는 엔티티 이름이다: ${m.name}`,
      fix: 'entityMap 은 Map 이라 나중 것이 조용히 이긴다 — 다른 이름을 쓴다',
    });
  }
  seen.add(m.name);

  if (!Number.isInteger(m.size) || m.size < 1) {
    out.push({
      kind: 'bad-size', severity: 'reject', where,
      detail: `크기가 ${m.size} 다 — 1 이상의 정수라야 한다`,
      fix: '머신은 정사각이고 변 길이는 타일 수다',
    });
    return; // 크기를 모르면 아래 행 검사가 무의미하다.
  }

  if (m.craftingCategories.filter((c) => c.trim()).length === 0) {
    out.push({
      kind: 'category-orphan', severity: 'reject', where,
      detail: '제작 카테고리가 없다',
      fix: '이 머신이 맡을 카테고리를 하나 이상 적는다 — 레시피는 카테고리로만 머신을 찾는다',
    });
  }

  // 행 범위와 같은 면 안 중복.
  const takenByFace = new Map<CustomFace, Map<number, number>>();
  m.fluidBoxes.forEach((fb, i) => {
    if (!Number.isInteger(fb.offset) || fb.offset < 0 || fb.offset >= m.size) {
      out.push({
        kind: 'offset-range', severity: 'reject', where: `${where}.fluidBoxes[${i}]`,
        detail: `${fb.face} 면 ${fb.offset} 행 — ${m.size}×${m.size} 머신의 행은 0 … ${m.size - 1} 다`,
        fix: 'resolveFluidConnection 의 clamp 가 조용히 끌어당긴다 — 범위 안으로 고친다',
      });
      return;
    }
    const rows = takenByFace.get(fb.face) ?? new Map<number, number>();
    const prev = rows.get(fb.offset);
    if (prev !== undefined) {
      out.push({
        kind: 'offset-clash', severity: 'reject', where: `${where}.fluidBoxes[${i}]`,
        detail: `${fb.face} 면 ${fb.offset} 행을 유체 상자 #${prev + 1} 과 #${i + 1} 이 함께 쓴다`,
        fix: '배정은 상자 하나가 칸 하나를 **배타적으로** 먹는다 — 행을 달리한다',
      });
    }
    rows.set(fb.offset, i);
    takenByFace.set(fb.face, rows);
  });

  // 이 머신을 쓰는 커스텀 레시피가 유체를 쓰는데 상자가 하나도 없으면 미리 말해 준다.
  const usesFluid = spec.recipes.some(
    (r) => m.craftingCategories.includes(r.category) && fluidLinesOf(r).length > 0,
  );
  if (usesFluid && m.fluidBoxes.length === 0) {
    out.push({
      kind: 'no-fluid-box', severity: 'reject', where,
      detail: `${m.name} 에 유체 상자가 없는데 이 머신이 맡는 레시피가 유체를 쓴다`,
      fix: '유체 상자를 넣는다 — 파이프는 팔이 없어 프로토타입이 정한 칸에만 닿는다',
    });
  }
}

function validateRecipe(
  r: CustomRecipeSpec,
  spec: CustomDataSpec,
  ctx: ValidateContext,
  seen: Set<string>,
  out: CustomDataIssue[],
): void {
  const where = `recipe:${r.name || '(이름 없음)'}`;

  if (!r.name.trim()) {
    out.push({
      kind: 'blank-name', severity: 'reject', where,
      detail: '레시피 이름이 비어 있다',
      fix: '이름을 적는다',
    });
  } else if (seen.has(r.name)) {
    out.push({
      kind: 'duplicate-name', severity: 'reject', where,
      detail: `커스텀 레시피 이름이 겹친다: ${r.name}`,
      fix: '한쪽 이름을 바꾼다',
    });
  } else if (ctx.existingRecipeNames.has(r.name)) {
    out.push({
      kind: 'name-taken', severity: 'reject', where,
      detail: `게임데이터에 이미 있는 레시피 이름이다: ${r.name}`,
      fix: 'recipeMap 은 Map 이라 나중 것이 조용히 이긴다 — 다른 이름을 쓴다',
    });
  }
  seen.add(r.name);

  if (r.products.length === 0) {
    out.push({
      kind: 'no-product', severity: 'reject', where,
      detail: '산출물이 없다',
      fix: '산출물이 없으면 이 레시피를 부를 수 있는 트리가 없다 — 하나 이상 넣는다',
    });
  }

  for (const [field, list] of [
    ['ingredients', r.ingredients],
    ['products', r.products],
  ] as const) {
    list.forEach((s, i) => {
      if (!s.name.trim()) {
        out.push({
          kind: 'blank-name', severity: 'reject', where: `${where}.${field}[${i}]`,
          detail: '품목 이름이 비어 있다',
          fix: '아이템/유체 이름을 적는다',
        });
      }
      if (!Number.isFinite(s.amount) || s.amount <= 0) {
        out.push({
          kind: 'bad-amount', severity: 'reject', where: `${where}.${field}[${i}]`,
          detail: `${s.name || '(이름 없음)'} 의 수량이 ${s.amount} 다`,
          fix: '0 이하·비수치는 productYield 를 NaN 으로 만들고, 그 NaN 이 탭 수를 지나 인서터를 조용히 0개로 만든다',
        });
      }
      if (s.fluidboxIndex !== undefined && s.type !== 'fluid') {
        out.push({
          kind: 'fluidbox-index', severity: 'warn', where: `${where}.${field}[${i}]`,
          detail: `${s.name} 은 아이템인데 유체 상자 번호가 붙어 있다`,
          fix: '아이템엔 그 필드가 없다 — 합성에서 버려진다',
        });
      }
    });
  }

  // 이 레시피를 맡을 머신 — 커스텀 + 기존 게임 머신.
  const customMachines = spec.machines.filter((m) => m.craftingCategories.includes(r.category));
  const gameMachines = ctx.gameMachinesForCategory(r.category);
  if (customMachines.length === 0 && gameMachines.length === 0) {
    out.push({
      kind: 'category-orphan', severity: 'reject', where,
      detail: `카테고리 "${r.category}" 를 맡는 머신이 없다`,
      fix: '커스텀 머신의 제작 카테고리에 이 이름을 넣거나, 기존 카테고리를 고른다 — 후보가 0이면 2단계가 비어 배치가 안 선다',
    });
    return;
  }

  // 유체 적합 — 커스텀 머신에 대해서만 본다. 기존 게임 머신은 실물이라 우리가 판정할 것이
  // 아니고(그 머신으로 못 돌리면 사용자가 다른 머신을 고른다), 우리가 만든 머신이 못 앉히는
  // 것은 **우리 잘못**이다.
  const fits = customMachines.map((m) => ({ m, fit: fitFluidLines(m, r) }));
  const bad = fits.filter((f) => !f.fit.ok);
  if (bad.length > 0 && bad.length === fits.length && gameMachines.length === 0) {
    for (const { m, fit } of bad) {
      if (fit.ok) continue;
      out.push({
        kind: fit.kind, severity: 'reject', where,
        detail: `${m.name}: ${fit.detail}`,
        fix:
          fit.kind === 'fluidbox-index'
            ? '못박은 상자 번호를 지우거나(미지정 = 그 역할 상자 전부) 상자를 더 넣는다'
            : '입력 유체 상자와 출력 유체 상자를 **마주보는 면**에 둔다 — 파이프라인은 입력이 E, 출력이 W 로 오는 회전을 찾는다',
      });
    }
  } else {
    for (const { m, fit } of bad) {
      if (fit.ok) continue;
      out.push({
        kind: fit.kind, severity: 'warn', where,
        detail: `${m.name} 으로는 못 돈다: ${fit.detail}`,
        fix: '다른 머신을 고르거나 이 머신의 유체 상자를 고친다',
      });
    }
  }

  // 좌석 예산 — 유체가 면을 다 먹으면 아이템 벨트가 못 앉는다.
  // fluidJumpBlocker 의 거절식(`beltDepths > seatRows − n`)에서 beltDepths 의 하한 1 을 넣은 것:
  // 아이템 줄이 하나라도 있으면 `n ≥ size` 인 순간 거절된다.
  const fluidIn = r.ingredients.filter((s) => s.type === 'fluid').length;
  const fluidOut = r.products.filter((s) => s.type === 'fluid').length;
  const itemIn = r.ingredients.filter((s) => s.type === 'item').length;
  const itemOut = r.products.filter((s) => s.type === 'item').length;
  for (const { m } of fits) {
    if (itemIn > 0 && fluidIn >= m.size) {
      out.push({
        kind: 'seats-tight', severity: 'warn', where,
        detail: `${m.name} 의 E 면 좌석 ${m.size}행에서 유체 ${fluidIn}행을 빼면 ${m.size - fluidIn}행 — 아이템 벨트가 안 들어간다`,
        fix: `머신을 ${fluidIn + 1}×${fluidIn + 1} 이상으로 키우거나 유체 재료를 줄인다`,
      });
    }
    if (itemOut > 0 && fluidOut >= m.size) {
      out.push({
        kind: 'seats-tight', severity: 'warn', where,
        detail: `${m.name} 의 W 면 좌석 ${m.size}행에서 유체 ${fluidOut}행을 빼면 ${m.size - fluidOut}행 — 아이템 벨트가 안 들어간다`,
        fix: `머신을 ${fluidOut + 1}×${fluidOut + 1} 이상으로 키우거나 유체 산출을 줄인다`,
      });
    }
  }
}
