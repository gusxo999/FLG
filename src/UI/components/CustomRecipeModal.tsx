/**
 * CustomRecipeModal — 커스텀 레시피/머신 편집기.
 *
 * **얇은 폼이다.** 검증도 합성도 여기 없다 — `validateCustomData` 로 묻고
 * `customDataStore.merge()` 로 저장한다. 그래서 콘솔(`flg.custom.add`)과 이 버튼이 **같은
 * 일**을 하고, 화면 없이도 레시피가 만들어진다(docs/debug/ai-console.md §2 방식 A).
 *
 * ## 유체 상자를 좌표로 안 받는다
 *
 * 게임데이터의 유체 상자 좌표는 `(-1.5, -1.5)` 같은 **칸 중심 반정수**다. 그걸 사용자에게
 * 입력받으면 짝수 크기 머신에서 반드시 틀린다. 그래서 **머신 바깥 칸을 누르게** 한다 —
 * 면과 행이 클릭 자체로 정해지고, 좌표는 [compileFluidBox](../../factorio/customRecipe.ts) 가
 * 만든다.
 *
 * 머신 **안쪽** 칸을 누르게 하지 않는 것도 이유가 있다: 모서리 칸은 두 면에 동시에 속해
 * (화학 공장의 `(-1,-1)` 이 그렇다) 클릭만으로 면을 못 정한다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { useGameDataStore } from '../store/gameDataStore';
import {
  findCustomRecipe,
  gameDataContext,
  useCustomDataStore,
} from '../store/customDataStore';
import { useCustomEditorStore, type CustomEditorSeed } from '../store/customEditorStore';
import { useToastStore } from '../store/toastStore';
import {
  roleOrdinals,
  type CustomFace,
  type CustomFluidBoxSpec,
  type CustomMachineSpec,
  type CustomRecipeSpec,
  type CustomStackSpec,
} from '../../factorio/customRecipe';
import {
  fitFluidLines,
  validateCustomData,
  type CustomDataIssue,
} from '../../factorio/customRecipeValidate';

// ─────────────────────────────────────────────────────────────────────────────
// 초안
// ─────────────────────────────────────────────────────────────────────────────

interface Draft {
  /** null 이면 새 머신을 만든다. 이름이면 이미 있는 커스텀 머신을 쓴다. */
  useMachine: string | null;
  machine: CustomMachineSpec;
  recipe: CustomRecipeSpec;
}

/** 초안 하나 + 어디서 왔는지. 재료의 제작법을 만들면 이 위에 쌓인다. */
interface Frame {
  draft: Draft;
  /** 부모의 몇 번째 재료에서 왔나. 루트면 null. */
  fromIngredient: number | null;
}

const CATEGORY_OF = (recipeName: string) => `custom-${recipeName || 'recipe'}`;

function blankDraft(productName?: string): Draft {
  const recipeName = productName ?? '';
  return {
    useMachine: null,
    machine: {
      name: recipeName ? `${recipeName}-plant` : '',
      size: 3,
      craftingSpeed: 1,
      craftingCategories: [CATEGORY_OF(recipeName)],
      moduleSlots: 0,
      fluidBoxes: [],
    },
    recipe: {
      name: recipeName,
      category: CATEGORY_OF(recipeName),
      energyRequired: 1,
      ingredients: [],
      products: productName ? [{ name: productName, amount: 1, type: 'item' }] : [],
    },
  };
}

/** 기존 커스텀 레시피를 초안으로 되살린다. 머신은 그 카테고리를 맡는 커스텀 머신. */
function draftFrom(recipe: CustomRecipeSpec, machines: readonly CustomMachineSpec[]): Draft {
  const owner = machines.find((m) => m.craftingCategories.includes(recipe.category));
  return owner
    ? { useMachine: null, machine: structuredClone(owner), recipe: structuredClone(recipe) }
    : { ...blankDraft(), recipe: structuredClone(recipe) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 모달
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 열림/닫힘만 본다. 초안은 [Editor] 가 들고 있고, **`key` 로 리마운트**시켜 새로 세운다.
 *
 * 예전엔 이걸 이펙트에서 `setStack` 으로 했는데, 그건 *"열렸다"* 라는 React 상태를 다시
 * React 상태로 옮기는 일이라 렌더가 한 번 더 돈다(`react-hooks/set-state-in-effect`).
 * 초기값이 씨앗에서 곧바로 나오면 이펙트가 아예 필요 없다.
 */
export default function CustomRecipeModal() {
  const open = useCustomEditorStore((s) => s.open);
  const seed = useCustomEditorStore((s) => s.seed);
  const close = useCustomEditorStore((s) => s.close);

  if (!open) return null;
  return (
    <Editor
      key={`${seed?.editRecipe ?? ''}|${seed?.productName ?? ''}`}
      seed={seed}
      onClose={close}
    />
  );
}

function Editor({
  seed,
  onClose: close,
}: {
  seed: CustomEditorSeed | null;
  onClose: () => void;
}) {
  const t = useT();
  const customMachines = useCustomDataStore((s) => s.data.machines);
  const recipes = useGameDataStore((s) => s.recipes);
  const storeData = useCustomDataStore((s) => s.data);

  const [stack, setStack] = useState<Frame[]>(() => {
    const existing = seed?.editRecipe ? findCustomRecipe(seed.editRecipe) : undefined;
    const draft = existing
      ? draftFrom(existing, useCustomDataStore.getState().data.machines)
      : blankDraft(seed?.productName);
    return [{ draft, fromIngredient: null }];
  });

  const frame = stack[stack.length - 1];
  const draft = frame?.draft;

  const setDraft = useCallback((next: Draft) => {
    setStack((s) => (s.length === 0 ? s : [...s.slice(0, -1), { ...s[s.length - 1], draft: next }]));
  }, []);

  /** 지금 쓰는 머신 — 새로 만드는 것이거나, 고른 기존 커스텀 머신. */
  const activeMachine: CustomMachineSpec | undefined = useMemo(() => {
    if (!draft) return undefined;
    return draft.useMachine
      ? customMachines.find((m) => m.name === draft.useMachine)
      : draft.machine;
  }, [draft, customMachines]);

  /**
   * 저장했을 때와 **같은 것**을 판정한다 — 초안만 따로 보면 다른 커스텀 항목과의 이름 충돌이
   * 저장 순간에야 나온다. `merge` 가 만드는 한 벌을 미리 만들어 검사한다.
   */
  const issues: CustomDataIssue[] = useMemo(() => {
    if (!draft || !activeMachine) return [];
    const upsert = <T extends { name: string }>(base: readonly T[], one: T): T[] => {
      const at = base.findIndex((x) => x.name === one.name);
      return at >= 0 ? [...base.slice(0, at), one, ...base.slice(at + 1)] : [...base, one];
    };
    return validateCustomData(
      {
        machines: draft.useMachine
          ? storeData.machines
          : upsert(storeData.machines, draft.machine),
        recipes: upsert(storeData.recipes, draft.recipe),
      },
      gameDataContext(),
    );
  }, [draft, activeMachine, storeData]);

  const rejects = issues.filter((i) => i.severity === 'reject');
  const warns = issues.filter((i) => i.severity === 'warn');

  /** 아이템/유체 이름 자동완성 후보 — 게임데이터에 이름 목록이 따로 없어 레시피에서 뽑는다. */
  const knownNames = useMemo(() => {
    const set = new Set<string>();
    for (const r of recipes) {
      for (const s of r.ingredients) set.add(s.name);
      for (const p of r.products) set.add(p.name);
    }
    return [...set].sort();
  }, [recipes]);

  const handleSave = useCallback(() => {
    if (!draft) return;
    const result = useCustomDataStore.getState().merge({
      machines: draft.useMachine ? [] : [draft.machine],
      recipes: [draft.recipe],
    });
    if (result.length > 0) return; // 버튼이 막고 있어야 하지만, 경쟁 상태 방어.

    if (stack.length > 1) {
      // 자식을 저장하면 부모로 돌아간다. 부모의 그 재료 이름을 자식의 산출 이름에 맞춘다 —
      // 자식에서 산출 이름을 바꿨으면 연결이 끊기기 때문이다.
      const childProduct = draft.recipe.products[0]?.name;
      setStack((s) => {
        const child = s[s.length - 1];
        const parent = s[s.length - 2];
        if (child.fromIngredient === null || !childProduct) return s.slice(0, -1);
        const ingredients = [...parent.draft.recipe.ingredients];
        ingredients[child.fromIngredient] = {
          ...ingredients[child.fromIngredient],
          name: childProduct,
        };
        const next: Frame = {
          ...parent,
          draft: { ...parent.draft, recipe: { ...parent.draft.recipe, ingredients } },
        };
        return [...s.slice(0, -2), next];
      });
      useToastStore.getState().show(t('customRecipe.savedToast'), 'success');
      return;
    }
    useToastStore.getState().show(t('customRecipe.savedToast'), 'success');
    close();
  }, [draft, stack.length, close, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!draft || !activeMachine) return null;

  const isChild = stack.length > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={close}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[88vh] flex flex-col overflow-hidden"
      >
        {/* 헤더 + 빵부스러기 */}
        <div className="px-4 py-2.5 border-b border-gray-700 bg-gray-950">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-bold text-sm">
              {seed?.editRecipe ? t('customRecipe.editTitle') : t('customRecipe.title')}
            </h2>
            <button onClick={close} className="text-gray-500 hover:text-gray-200 text-xl leading-none">
              ×
            </button>
          </div>
          {isChild && (
            <div className="mt-1 text-[10px] text-amber-400/90">
              {stack.map((f) => f.draft.recipe.name || '…').join('  ›  ')} — {t('customRecipe.breadcrumbHint')}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <MachineSection
            draft={draft}
            setDraft={setDraft}
            activeMachine={activeMachine}
            customMachines={customMachines}
            t={t}
          />
          <RecipeSection
            draft={draft}
            setDraft={setDraft}
            activeMachine={activeMachine}
            knownNames={knownNames}
            onMakeSubRecipe={(index) => {
              const name = draft.recipe.ingredients[index]?.name ?? '';
              setStack((s) => [...s, { draft: blankDraft(name), fromIngredient: index }]);
            }}
            t={t}
          />
          <IssueList issues={[...rejects, ...warns]} />
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={close}
              className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:border-gray-600"
            >
              {t('customRecipe.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={rejects.length > 0}
              className="text-xs px-4 py-1.5 rounded border border-orange-500 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isChild ? t('customRecipe.saveChild') : t('customRecipe.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 머신 구획
// ─────────────────────────────────────────────────────────────────────────────

type T = (k: string, p?: Record<string, string | number>) => string;

function MachineSection({
  draft,
  setDraft,
  activeMachine,
  customMachines,
  t,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  activeMachine: CustomMachineSpec;
  customMachines: readonly CustomMachineSpec[];
  t: T;
}) {
  const editable = draft.useMachine === null;
  const patchMachine = (p: Partial<CustomMachineSpec>) =>
    setDraft({ ...draft, machine: { ...draft.machine, ...p } });

  return (
    <section className="bg-gray-800/40 border border-gray-700 rounded p-3 space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-gray-400">{t('customRecipe.machineSection')}</h3>

      {customMachines.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">{t('customRecipe.machineMode')}</span>
          <select
            value={draft.useMachine ?? ''}
            onChange={(e) => {
              const name = e.target.value || null;
              const picked = customMachines.find((m) => m.name === name);
              setDraft({
                ...draft,
                useMachine: name,
                recipe: picked
                  ? { ...draft.recipe, category: picked.craftingCategories[0] ?? draft.recipe.category }
                  : draft.recipe,
              });
            }}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100"
          >
            <option value="">{t('customRecipe.machineNew')}</option>
            {customMachines.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} ({m.size}×{m.size})
              </option>
            ))}
          </select>
        </div>
      )}

      {editable && (
        <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
          <Field label={t('customRecipe.machineName')}>
            <input
              value={draft.machine.name}
              onChange={(e) => patchMachine({ name: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
            />
          </Field>
          <Field label={t('customRecipe.machineSize')}>
            <input
              type="number"
              min={1}
              max={16}
              value={draft.machine.size}
              onChange={(e) => {
                const size = Math.max(1, Math.min(16, Math.floor(Number(e.target.value) || 1)));
                // 크기를 줄이면 범위를 벗어난 상자가 생긴다 — 조용히 clamp 되면 사용자가
                // 모르는 자리로 옮겨 앉으므로 **버린다**.
                patchMachine({
                  size,
                  fluidBoxes: draft.machine.fluidBoxes.filter((fb) => fb.offset < size),
                });
              }}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
            />
          </Field>
          <Field label={t('customRecipe.craftingSpeed')}>
            <input
              type="number"
              min={0.01}
              step={0.25}
              value={draft.machine.craftingSpeed}
              onChange={(e) => patchMachine({ craftingSpeed: Number(e.target.value) })}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
            />
          </Field>
          <Field label={t('customRecipe.moduleSlots')}>
            <input
              type="number"
              min={0}
              max={8}
              value={draft.machine.moduleSlots ?? 0}
              onChange={(e) => patchMachine({ moduleSlots: Math.max(0, Number(e.target.value) || 0) })}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
            />
          </Field>
        </div>
      )}

      <div>
        <div className="text-[10px] text-gray-400 mb-1">{t('customRecipe.fluidBoxes')}</div>
        <p className="text-[10px] text-gray-500 mb-2">{t('customRecipe.fluidBoxHint')}</p>
        <FluidBoxGrid
          machine={activeMachine}
          readOnly={!editable}
          onChange={(fluidBoxes) => patchMachine({ fluidBoxes })}
          t={t}
        />
      </div>

      <RotationNote machine={activeMachine} recipe={draft.recipe} t={t} />
    </section>
  );
}

/** 면·행을 **클릭으로** 고르는 격자. 바깥 테두리 칸이 유체 상자 자리다. */
function FluidBoxGrid({
  machine,
  readOnly,
  onChange,
  t,
}: {
  machine: CustomMachineSpec;
  readOnly: boolean;
  onChange: (boxes: CustomFluidBoxSpec[]) => void;
  t: T;
}) {
  const n = machine.size;
  const byCell = new Map<string, CustomFluidBoxSpec>();
  for (const fb of machine.fluidBoxes) byCell.set(`${fb.face}${fb.offset}`, fb);

  const ins = roleOrdinals(machine.fluidBoxes, 'input');
  const outs = roleOrdinals(machine.fluidBoxes, 'output');
  const ordinalOf = (fb: CustomFluidBoxSpec) => {
    const i = machine.fluidBoxes.indexOf(fb);
    return fb.role === 'output' ? `o${outs.get(i)}` : fb.role === 'input' ? `i${ins.get(i)}` : `io`;
  };

  // 없음 → 입력 → 출력 → 입출력 → 없음.
  const cycle = (face: CustomFace, offset: number) => {
    if (readOnly) return;
    const key = `${face}${offset}`;
    const cur = byCell.get(key);
    const nextRole: CustomFluidBoxSpec['role'] | null =
      !cur ? 'input' : cur.role === 'input' ? 'output' : cur.role === 'output' ? 'input-output' : null;
    const rest = machine.fluidBoxes.filter((fb) => `${fb.face}${fb.offset}` !== key);
    onChange(nextRole ? [...rest, { face, offset, role: nextRole }] : rest);
  };

  const cellClass = (fb?: CustomFluidBoxSpec) =>
    !fb
      ? 'border-gray-700/60 text-gray-700 hover:border-gray-500 hover:text-gray-400'
      : fb.role === 'input'
        ? 'border-sky-500 bg-sky-500/15 text-sky-300'
        : fb.role === 'output'
          ? 'border-orange-500 bg-orange-500/15 text-orange-300'
          : 'border-purple-500 bg-purple-500/15 text-purple-300';

  const gutter = (face: CustomFace, offset: number) => {
    const fb = byCell.get(`${face}${offset}`);
    return (
      <button
        key={`${face}${offset}`}
        onClick={() => cycle(face, offset)}
        disabled={readOnly}
        title={`${face} ${offset}${fb ? ` · ${t(`customRecipe.fluidBox${fb.role === 'input' ? 'Input' : fb.role === 'output' ? 'Output' : 'Both'}`)}` : ''}`}
        className={`h-7 min-w-7 rounded border text-[10px] font-mono transition-colors disabled:cursor-default ${cellClass(fb)}`}
      >
        {fb ? ordinalOf(fb) : '·'}
      </button>
    );
  };

  const cols = Array.from({ length: n }, (_, k) => k);
  return (
    <div className="inline-block">
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${n + 2}, minmax(28px, 1fr))` }}
      >
        {/* N 면 */}
        <div />
        {cols.map((k) => gutter('N', k))}
        <div />

        {/* 본체 행 — 왼쪽 W · 오른쪽 E */}
        {cols.map((r) => (
          <FragmentRow key={r}>
            {gutter('W', r)}
            {cols.map((c) => (
              <div
                key={c}
                className="h-7 rounded border border-gray-800 bg-gray-800/40 text-gray-700 text-[10px] flex items-center justify-center"
              >
                ·
              </div>
            ))}
            {gutter('E', r)}
          </FragmentRow>
        ))}

        {/* S 면 */}
        <div />
        {cols.map((k) => gutter('S', k))}
        <div />
      </div>
      <div className="mt-1 text-[10px] text-gray-500 flex gap-3">
        <span className="text-sky-400">i = {t('customRecipe.fluidBoxInput')}</span>
        <span className="text-orange-400">o = {t('customRecipe.fluidBoxOutput')}</span>
        <span className="text-purple-400">io = {t('customRecipe.fluidBoxBoth')}</span>
      </div>
    </div>
  );
}

/** grid 안에서 행을 이루는 셀들을 그대로 펼친다(래퍼 div 가 생기면 격자가 깨진다). */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/**
 * 지금 배치로 **파이프라인이 몇 도를 고를지** 알려 준다.
 *
 * 이 줄이 이 화면에서 가장 중요하다 — 유체 상자가 어긋나 있으면 저장은 막히지만, *왜*
 * 막히는지는 각도 이야기라서 그림만 봐서는 안 보인다.
 */
function RotationNote({
  machine,
  recipe,
  t,
}: {
  machine: CustomMachineSpec;
  recipe: CustomRecipeSpec;
  t: T;
}) {
  const fit = fitFluidLines(machine, recipe);
  const hasFluid =
    recipe.ingredients.some((s) => s.type === 'fluid') || recipe.products.some((s) => s.type === 'fluid');
  if (!hasFluid) return <p className="text-[10px] text-gray-500">{t('customRecipe.noFluidLines')}</p>;
  if (!fit.ok) {
    return (
      <p className="text-[10px] text-red-400">
        {t('customRecipe.rotationNone')} <span className="text-red-300/70">({fit.detail})</span>
      </p>
    );
  }
  const deg = { 0: '0°', 4: '90°', 8: '180°', 12: '270°' }[fit.direction] ?? `${fit.direction}`;
  return (
    <p className="text-[10px] text-emerald-400">
      {t('customRecipe.rotationOk', { deg })}
      {fit.lines.length > 0 && (
        <span className="text-emerald-300/60">
          {' '}
          — {fit.lines.map((l) => `${l.name}→${l.side}${l.fluidboxOffset}`).join(' · ')}
        </span>
      )}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 레시피 구획
// ─────────────────────────────────────────────────────────────────────────────

function RecipeSection({
  draft,
  setDraft,
  activeMachine,
  knownNames,
  onMakeSubRecipe,
  t,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  activeMachine: CustomMachineSpec;
  knownNames: string[];
  onMakeSubRecipe: (index: number) => void;
  t: T;
}) {
  const patchRecipe = (p: Partial<CustomRecipeSpec>) =>
    setDraft({ ...draft, recipe: { ...draft.recipe, ...p } });

  /** 레시피 이름을 바꾸면 **아직 손 안 댄** 카테고리·머신 이름을 따라 바꾼다. */
  const renameRecipe = (name: string) => {
    const oldCat = CATEGORY_OF(draft.recipe.name);
    const followCategory = draft.recipe.category === oldCat;
    const next: Draft = {
      ...draft,
      recipe: {
        ...draft.recipe,
        name,
        category: followCategory ? CATEGORY_OF(name) : draft.recipe.category,
      },
    };
    if (!draft.useMachine) {
      const followName = draft.machine.name === `${draft.recipe.name}-plant` || draft.machine.name === '';
      next.machine = {
        ...draft.machine,
        name: followName ? `${name}-plant` : draft.machine.name,
        craftingCategories: followCategory ? [CATEGORY_OF(name)] : draft.machine.craftingCategories,
      };
    }
    setDraft(next);
  };

  const setStacks = (field: 'ingredients' | 'products', list: CustomStackSpec[]) =>
    patchRecipe({ [field]: list } as Partial<CustomRecipeSpec>);

  return (
    <section className="bg-gray-800/40 border border-gray-700 rounded p-3 space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-gray-400">{t('customRecipe.recipeSection')}</h3>

      <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-3">
        <Field label={t('customRecipe.recipeName')}>
          <input
            value={draft.recipe.name}
            onChange={(e) => renameRecipe(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
          />
        </Field>
        <Field label={t('customRecipe.energyRequired')}>
          <input
            type="number"
            min={0.01}
            step={0.25}
            value={draft.recipe.energyRequired}
            onChange={(e) => patchRecipe({ energyRequired: Number(e.target.value) })}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
          />
        </Field>
        <Field label={t('customRecipe.craftingCategory')} hint={t('customRecipe.categoryHint')}>
          <input
            value={draft.recipe.category}
            disabled={!!draft.useMachine}
            onChange={(e) => {
              const category = e.target.value;
              setDraft({
                ...draft,
                recipe: { ...draft.recipe, category },
                machine: draft.useMachine ? draft.machine : { ...draft.machine, craftingCategories: [category] },
              });
            }}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100 disabled:opacity-50"
          />
        </Field>
      </div>

      <StackRows
        title={t('customRecipe.ingredients')}
        field="ingredients"
        role="input"
        stacks={draft.recipe.ingredients}
        machine={activeMachine}
        knownNames={knownNames}
        onChange={(list) => setStacks('ingredients', list)}
        onMakeSubRecipe={onMakeSubRecipe}
        t={t}
      />
      <StackRows
        title={t('customRecipe.products')}
        field="products"
        role="output"
        stacks={draft.recipe.products}
        machine={activeMachine}
        knownNames={knownNames}
        onChange={(list) => setStacks('products', list)}
        t={t}
      />
    </section>
  );
}

function StackRows({
  title,
  field,
  role,
  stacks,
  machine,
  knownNames,
  onChange,
  onMakeSubRecipe,
  t,
}: {
  title: string;
  field: 'ingredients' | 'products';
  role: 'input' | 'output';
  stacks: CustomStackSpec[];
  machine: CustomMachineSpec;
  knownNames: string[];
  onChange: (list: CustomStackSpec[]) => void;
  onMakeSubRecipe?: (index: number) => void;
  t: T;
}) {
  const boxCount = roleOrdinals(machine.fluidBoxes, role).size;
  const patch = (i: number, p: Partial<CustomStackSpec>) =>
    onChange(stacks.map((s, k) => (k === i ? { ...s, ...p } : s)));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-400">{title}</span>
        <button
          onClick={() => onChange([...stacks, { name: '', amount: 1, type: 'item' }])}
          className="text-[10px] px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:border-gray-500"
        >
          {t('customRecipe.addRow')}
        </button>
      </div>
      <div className="space-y-1">
        {stacks.map((s, i) => (
          <div key={`${field}-${i}`} className="flex items-center gap-1 text-xs">
            <input
              list="flg-known-names"
              value={s.name}
              placeholder={t('customRecipe.itemName')}
              onChange={(e) => patch(i, { name: e.target.value })}
              className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
            />
            <input
              type="number"
              min={0}
              step={1}
              value={s.amount}
              title={t('customRecipe.amount')}
              onChange={(e) => patch(i, { amount: Number(e.target.value) })}
              className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100"
            />
            <select
              value={s.type}
              onChange={(e) => {
                const type = e.target.value as 'item' | 'fluid';
                // 아이템으로 되돌리면 상자 번호를 버린다 — 아이템엔 그 필드가 없다.
                patch(i, type === 'item' ? { type, fluidboxIndex: undefined } : { type });
              }}
              className="bg-gray-800 border border-gray-700 rounded px-1 py-1 text-gray-100"
            >
              <option value="item">{t('customRecipe.typeItem')}</option>
              <option value="fluid">{t('customRecipe.typeFluid')}</option>
            </select>
            {s.type === 'fluid' && (
              <select
                value={s.fluidboxIndex ?? ''}
                title={t('customRecipe.fluidBoxAutoHint')}
                onChange={(e) =>
                  patch(i, { fluidboxIndex: e.target.value ? Number(e.target.value) : undefined })
                }
                className="bg-gray-800 border border-gray-700 rounded px-1 py-1 text-gray-100"
              >
                <option value="">{t('customRecipe.fluidBoxAuto')}</option>
                {Array.from({ length: boxCount }, (_, k) => k + 1).map((k) => (
                  <option key={k} value={k}>
                    #{k}
                  </option>
                ))}
              </select>
            )}
            {onMakeSubRecipe && s.type === 'item' && (
              <button
                onClick={() => onMakeSubRecipe(i)}
                disabled={!s.name.trim()}
                title={t('customRecipe.makeSubRecipe')}
                className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:border-orange-600 hover:text-orange-300 disabled:opacity-30"
              >
                ⤵
              </button>
            )}
            <button
              onClick={() => onChange(stacks.filter((_, k) => k !== i))}
              title={t('customRecipe.removeRow')}
              className="text-gray-600 hover:text-red-400 px-1"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <datalist id="flg-known-names">
        {knownNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 공통
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[10px] text-gray-500 block mb-0.5" title={hint}>
        {label}
      </span>
      {children}
    </label>
  );
}

/** 거절은 빨강, 경고는 호박. `fix` 가 **다음에 할 일**이라 항상 함께 보여 준다. */
function IssueList({ issues }: { issues: CustomDataIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1">
      {issues.map((i, k) => (
        <li
          key={k}
          className={`text-[11px] rounded border px-2 py-1 ${
            i.severity === 'reject'
              ? 'border-red-800 bg-red-900/20 text-red-300'
              : 'border-amber-800 bg-amber-900/20 text-amber-300'
          }`}
        >
          <div>
            {i.severity === 'reject' ? '✗' : '⚠'} {i.detail}
          </div>
          <div className="opacity-70">→ {i.fix}</div>
        </li>
      ))}
    </ul>
  );
}
