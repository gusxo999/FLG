import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useShallow } from 'zustand/shallow';
import { useGameDataStore } from '../store/gameDataStore';
import type { Entity, Recipe } from '../store/gameDataStore';
import { useT } from '../i18n';
import {
  expandRecipeTree,
  flattenTree,
  collectInternalRecipes,
  assignMinimumCounts,
  assignThroughputCounts,
} from '../utils/autoLayout/recipeTree';
import { makeMachineParamsLookup } from '../utils/autoLayout/wizardUtils';
import { expandSelectionByPrereq } from '../utils/autoLayout/techGroup';
import type { RecipeTreeNode } from '../utils/autoLayout/types';
import AutoLayoutContainerPanel from './AutoLayoutContainerPanel';
import AutoLayoutDebugTab from './AutoLayoutDebugTab';
import {
  inserterThroughput,
  defaultInserterThroughput,
} from '../utils/autoLayout/inserterThroughput';
import {
  useWizardStore,
  WIZARD_STEPS,
  type WizardStep,
  type InserterOverrideEntry,
} from '../store/wizardStore';
import { useSettingsStore } from '../store/settingsStore';

type Step = WizardStep;
const STEPS = WIZARD_STEPS;

export default function AutoLayoutSidebar() {
  const t = useT();

  const autoLayoutSidebarWidth = useSettingsStore((s) => s.autoLayoutSidebarWidth);
  const setAutoLayoutSidebarWidth = useSettingsStore((s) => s.setAutoLayoutSidebarWidth);
  const resizingRef = useRef(false);

  const handleMove = useCallback((e: MouseEvent) => {
    if (!resizingRef.current) return;
    setAutoLayoutSidebarWidth(window.innerWidth - e.clientX);
  }, [setAutoLayoutSidebarWidth]);

  const handleUp = useCallback(() => {
    if (!resizingRef.current) return;
    resizingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [handleMove, handleUp]);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  const {
    recipes,
    recipeMap,
    itemToRecipe,
    recipesByProduct,
    entityMap,
    techMap,
    loaded,
    getMachinesForCategory,
    getTechForMachine,
    resolvePrerequisites,
  } = useGameDataStore(
    useShallow((s) => ({
      recipes: s.recipes,
      recipeMap: s.recipeMap,
      itemToRecipe: s.itemToRecipe,
      recipesByProduct: s.recipesByProduct,
      entityMap: s.entityMap,
      techMap: s.techMap,
      loaded: s.loaded,
      getMachinesForCategory: s.getMachinesForCategory,
      getTechForMachine: s.getTechForMachine,
      resolvePrerequisites: s.resolvePrerequisites,
    })),
  );

  // 위저드 선택 상태 — wizardStore (persist) 에서 읽음
  const step = useWizardStore((s) => s.step);
  const setStep = useWizardStore((s) => s.setStep);
  const targetRecipe = useWizardStore((s) => s.targetRecipe);
  const setTargetRecipe = useWizardStore((s) => s.setTargetRecipe);
  const countMode = useWizardStore((s) => s.countMode);
  const setCountMode = useWizardStore((s) => s.setCountMode);
  const perTarget = useWizardStore((s) => s.perTarget);
  const setPerTarget = useWizardStore((s) => s.setPerTarget);
  const inserterOverrides = useWizardStore((s) => s.inserterOverrides);
  const setInserterOverrides = useWizardStore((s) => s.setInserterOverrides);
  const recipeOverrides = useWizardStore((s) => s.recipeOverrides);
  const setRecipeOverrides = useWizardStore((s) => s.setRecipeOverrides);
  const recipeOverridesMap = useMemo(
    () => new Map(Object.entries(recipeOverrides)),
    [recipeOverrides],
  );

  // Set 값은 배열로 저장되므로 useMemo 로 변환
  const _extIngr = useWizardStore((s) => s.externalIngredients);
  const _selMachines = useWizardStore((s) => s.selectedMachines);
  const _selInserters = useWizardStore((s) => s.selectedInserters);
  const _selBelts = useWizardStore((s) => s.selectedBelts);
  const _selUgBelts = useWizardStore((s) => s.selectedUndergroundBelts);
  const _selPipes = useWizardStore((s) => s.selectedPipes);
  const externalIngredients = useMemo(() => new Set(_extIngr), [_extIngr]);
  const selectedMachines = useMemo(() => new Set(_selMachines), [_selMachines]);
  const selectedInserters = useMemo(() => new Set(_selInserters), [_selInserters]);
  const selectedBelts = useMemo(() => new Set(_selBelts), [_selBelts]);
  const selectedUndergroundBelts = useMemo(() => new Set(_selUgBelts), [_selUgBelts]);
  const selectedPipes = useMemo(() => new Set(_selPipes), [_selPipes]);
  const setExternalIngredients = useWizardStore((s) => s.setExternalIngredients);
  const setSelectedMachines = useWizardStore((s) => s.setSelectedMachines);
  const setSelectedInserters = useWizardStore((s) => s.setSelectedInserters);
  const setSelectedBelts = useWizardStore((s) => s.setSelectedBelts);
  const setSelectedUndergroundBelts = useWizardStore((s) => s.setSelectedUndergroundBelts);
  const setSelectedPipes = useWizardStore((s) => s.setSelectedPipes);

  const recipeOptions = useMemo(
    () =>
      recipes
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [recipes],
  );

  // 1단계 트리 미리보기 (외부 토글 + countMode 반영)
  // manual 모드의 처리량 카운트는 선택된 머신의 crafting_speed 가 필요하므로 selectedMachines 로 lookup.
  // (effectiveMachines 는 machineCandidates→previewTree 에 의존해 순환되므로 raw set 사용; 머신 미선택 시 1대 폴백)
  const previewTree: RecipeTreeNode | null = useMemo(() => {
    if (!targetRecipe) return null;
    const tree = expandRecipeTree(
      targetRecipe,
      recipeMap,
      itemToRecipe,
      externalIngredients,
      recipeOverridesMap,
    );
    if (countMode === 'manual') {
      return assignThroughputCounts(
        tree,
        perTarget,
        recipeMap,
        makeMachineParamsLookup(Array.from(selectedMachines)),
      );
    }
    return assignMinimumCounts(tree);
  }, [targetRecipe, recipeMap, itemToRecipe, externalIngredients, recipeOverridesMap, countMode, perTarget, selectedMachines]);

  // 2단계 머신 후보: 트리 안 비-외부 레시피의 category 합집합을 처리할 수 있는 머신
  const machineCandidates: Entity[] = useMemo(() => {
    if (!previewTree) return [];
    const internalRecipes = collectInternalRecipes(previewTree);
    const categories = new Set<string>();
    for (const name of internalRecipes) {
      const r = recipeMap.get(name);
      if (r) categories.add(r.category);
    }
    const cand = new Set<string>();
    const entities: Entity[] = [];
    for (const cat of categories) {
      for (const m of getMachinesForCategory(cat)) {
        if (cand.has(m.name)) continue;
        cand.add(m.name);
        entities.push(m);
      }
    }
    return entities;
  }, [previewTree, recipeMap, getMachinesForCategory]);

  const inserterCandidates: Entity[] = useMemo(
    () => Array.from(entityMap.values()).filter((e) => e.type === 'inserter'),
    [entityMap],
  );

  const beltCandidates: Entity[] = useMemo(
    () => Array.from(entityMap.values()).filter((e) => e.type === 'transport-belt'),
    [entityMap],
  );

  const undergroundPipeCandidates: Entity[] = useMemo(
    () => Array.from(entityMap.values()).filter((e) => e.type === 'pipe-to-ground'),
    [entityMap],
  );

  const undergroundBeltCandidates: Entity[] = useMemo(
    () => Array.from(entityMap.values()).filter((e) => e.type === 'underground-belt'),
    [entityMap],
  );

  // 후보 1개뿐인 단계는 자동 선택 + 다음 단계로 점프 시 스킵
  function shouldSkip(s: Step): boolean {
    if (s === 'machine') return machineCandidates.length <= 1;
    if (s === 'inserter') return inserterCandidates.length <= 1;
    if (s === 'belt') return beltCandidates.length <= 1;
    if (s === 'pipe') return undergroundPipeCandidates.length <= 1;
    if (s === 'debug') return true; // next/prev 흐름에서는 건너뜀 — stepper 직접 클릭으로만 진입
    return false;
  }

  // 후보가 1개뿐인 단계의 자동 선택은 derived 값으로 처리 — 사용자 토글이 우선.
  const effectiveMachines = useMemo(
    () =>
      selectedMachines.size === 0 && machineCandidates.length === 1
        ? new Set([machineCandidates[0].name])
        : selectedMachines,
    [selectedMachines, machineCandidates],
  );
  const effectiveInserters = useMemo(
    () =>
      selectedInserters.size === 0 && inserterCandidates.length === 1
        ? new Set([inserterCandidates[0].name])
        : selectedInserters,
    [selectedInserters, inserterCandidates],
  );
  const effectiveBelts = useMemo(
    () =>
      selectedBelts.size === 0 && beltCandidates.length === 1
        ? new Set([beltCandidates[0].name])
        : selectedBelts,
    [selectedBelts, beltCandidates],
  );
  const effectivePipes = useMemo(
    () =>
      selectedPipes.size === 0 && undergroundPipeCandidates.length === 1
        ? new Set([undergroundPipeCandidates[0].name])
        : selectedPipes,
    [selectedPipes, undergroundPipeCandidates],
  );
  const effectiveUndergroundBelts = useMemo(
    () =>
      selectedUndergroundBelts.size === 0 && undergroundBeltCandidates.length === 1
        ? new Set([undergroundBeltCandidates[0].name])
        : selectedUndergroundBelts,
    [selectedUndergroundBelts, undergroundBeltCandidates],
  );

  function toggle(set: Set<string>, name: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setter(next);
  }

  // 인서터/벨트/파이프 토글: 선택 → 자동 체크 규칙으로 같은 type 의 prereq closure 도 함께 체크.
  function toggleWithPrereq(
    cur: Set<string>,
    name: string,
    candidates: Entity[],
    setter: (s: Set<string>) => void,
  ) {
    const next = new Set(cur);
    if (next.has(name)) {
      next.delete(name);
      setter(next);
      return;
    }
    next.add(name);
    const expanded = expandSelectionByPrereq({
      candidates,
      selected: next,
      techMap,
      getTechForMachine,
      resolvePrereqs: resolvePrerequisites,
    });
    setter(expanded);
  }

  function nextStep() {
    const idx = STEPS.indexOf(step);
    for (let i = idx + 1; i < STEPS.length; i++) {
      if (!shouldSkip(STEPS[i])) {
        setStep(STEPS[i]);
        return;
      }
    }
    setStep('review');
  }

  function prevStep() {
    const idx = STEPS.indexOf(step);
    for (let i = idx - 1; i >= 0; i--) {
      if (!shouldSkip(STEPS[i])) {
        setStep(STEPS[i]);
        return;
      }
    }
    setStep('recipe');
  }

  function handleReset() {
    useWizardStore.getState().reset();
  }

  const internalRecipes = previewTree ? collectInternalRecipes(previewTree) : new Set<string>();
  const totalMachines = previewTree ? sumMachineCounts(previewTree) : 0;

  return (
    <div className="relative shrink-0 border-l border-gray-700 bg-gray-900 flex flex-col h-full overflow-hidden" style={{ width: `${autoLayoutSidebarWidth}px` }}>
      {/* 리사이저 — 왼쪽 가장자리 드래그로 폭 조절 */}
      <div
        onMouseDown={startResize}
        onDoubleClick={() => setAutoLayoutSidebarWidth(320)}
        title="드래그하여 폭 조절 / 더블클릭으로 초기화"
        className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-orange-500/60 active:bg-orange-500 transition-colors z-10"
      />
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-2 border-b border-gray-800 shrink-0">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="text-white font-bold text-sm">
              {t('autoLayoutModal.title')}
            </h2>
            <span className="text-[10px] uppercase tracking-wider text-yellow-300 bg-yellow-900/40 border border-yellow-700/50 rounded px-1.5 py-0.5">
              {t('autoLayoutModal.experimentalBadge')}
            </span>
          </div>
          <p className="text-gray-400 text-[11px] leading-relaxed">
            {t('autoLayoutModal.subtitle')}
          </p>
        </div>
      </div>

        {/* Stepper — 칸 클릭 시 해당 단계로 즉시 이동 (skip 단계도 클릭 가능) */}
        <div className="flex items-center gap-1 px-4 pt-2 pb-1 text-[10px] overflow-x-auto shrink-0 flex-wrap gap-y-1">
          {STEPS.map((s, i) => {
            const skip = shouldSkip(s);
            const active = step === s;
            return (
              <div key={s} className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setStep(s)}
                  className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                    active
                      ? 'bg-orange-500 text-white'
                      : skip
                      ? 'bg-gray-800 text-gray-600 line-through hover:bg-gray-700 hover:text-gray-400'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  {i + 1}. {t(`autoLayoutModal.steps.${s}`)}
                </button>
                {i < STEPS.length - 1 && <span className="text-gray-600">›</span>}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {step === 'recipe' && (
            <RecipeStep
              recipes={recipeOptions}
              recipeMap={recipeMap}
              recipesByProduct={recipesByProduct}
              targetRecipe={targetRecipe}
              setTargetRecipe={setTargetRecipe}
              countMode={countMode}
              setCountMode={setCountMode}
              perTarget={perTarget}
              setPerTarget={setPerTarget}
              tree={previewTree}
              externalIngredients={externalIngredients}
              setExternalIngredients={setExternalIngredients}
              recipeOverrides={recipeOverrides}
              setRecipeOverrides={setRecipeOverrides}
              loaded={loaded}
              t={t}
            />
          )}

          {step === 'machine' && (
            <CheckboxStep
              title={t('autoLayoutModal.steps.machine')}
              description={t('autoLayoutModal.machineHelp')}
              candidates={machineCandidates}
              selected={effectiveMachines}
              onToggle={(name) => toggle(selectedMachines, name, setSelectedMachines)}
              autoCheckedHint={null}
              t={t}
            />
          )}

          {step === 'inserter' && (
            <>
              <CheckboxStep
                title={t('autoLayoutModal.steps.inserter')}
                description={t('autoLayoutModal.inserterHelp')}
                candidates={inserterCandidates}
                selected={effectiveInserters}
                onToggle={(name) =>
                  toggleWithPrereq(selectedInserters, name, inserterCandidates, setSelectedInserters)
                }
                autoCheckedHint={t('autoLayoutModal.autoCheckHint')}
                t={t}
              />
              <InserterThroughputOverrides
                inserters={inserterCandidates.filter((e) => effectiveInserters.has(e.name))}
                overrides={inserterOverrides}
                setOverrides={setInserterOverrides}
              />
            </>
          )}

          {step === 'belt' && (
            <>
              <CheckboxStep
                title={t('autoLayoutModal.steps.belt')}
                description={t('autoLayoutModal.beltHelp')}
                candidates={beltCandidates}
                selected={effectiveBelts}
                onToggle={(name) =>
                  toggleWithPrereq(selectedBelts, name, beltCandidates, setSelectedBelts)
                }
                autoCheckedHint={t('autoLayoutModal.autoCheckHint')}
                t={t}
              />
              {undergroundBeltCandidates.length > 0 && (
                <CheckboxStep
                  title={t('autoLayoutModal.steps.undergroundBelt')}
                  description={t('autoLayoutModal.undergroundBeltHelp')}
                  candidates={undergroundBeltCandidates}
                  selected={effectiveUndergroundBelts}
                  onToggle={(name) =>
                    toggleWithPrereq(
                      selectedUndergroundBelts,
                      name,
                      undergroundBeltCandidates,
                      setSelectedUndergroundBelts,
                    )
                  }
                  autoCheckedHint={t('autoLayoutModal.autoCheckHint')}
                  t={t}
                />
              )}
            </>
          )}

          {step === 'pipe' && (
            <CheckboxStep
              title={t('autoLayoutModal.steps.pipe')}
              description={t('autoLayoutModal.pipeHelp')}
              candidates={undergroundPipeCandidates}
              selected={effectivePipes}
              onToggle={(name) =>
                toggleWithPrereq(selectedPipes, name, undergroundPipeCandidates, setSelectedPipes)
              }
              autoCheckedHint={t('autoLayoutModal.autoCheckHint')}
              t={t}
            />
          )}

          {step === 'review' && (
            <>
              <ReviewStep
                targetRecipe={targetRecipe}
                totalMachines={totalMachines}
                internalRecipes={internalRecipes}
                selectedMachines={effectiveMachines}
                selectedInserters={effectiveInserters}
                selectedBelts={effectiveBelts}
                t={t}
              />
              <AutoLayoutContainerPanel
                targetRecipe={targetRecipe}
                countMode={countMode}
                perTarget={perTarget}
                externalIngredients={externalIngredients}
                recipeOverrides={recipeOverrides}
                selectedMachines={effectiveMachines}
                selectedInserters={effectiveInserters}
                selectedBelts={effectiveBelts}
                selectedUndergroundPipes={effectivePipes}
                selectedUndergroundBelts={effectiveUndergroundBelts}
                onClose={handleReset}
              />
            </>
          )}

          {step === 'debug' && <AutoLayoutDebugTab />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-gray-800 shrink-0">
          <button
            onClick={handleReset}
            className="text-xs text-red-500 hover:text-red-300 px-2 py-1"
          >
            {t('autoLayoutModal.reset')}
          </button>
          <div className="flex items-center gap-2">
            {step !== 'recipe' && (
              <button
                onClick={prevStep}
                className="text-xs text-gray-300 hover:text-white px-3 py-1 border border-gray-700 rounded-lg"
              >
                {t('autoLayoutModal.prev')}
              </button>
            )}
            {step !== 'review' && step !== 'debug' && (
              <button
                onClick={nextStep}
                disabled={step === 'recipe' && !targetRecipe}
                className="bg-orange-500 hover:bg-orange-400 disabled:bg-orange-700 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-1 rounded-lg transition-colors"
              >
                {t('autoLayoutModal.next')}
              </button>
            )}
          </div>
        </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Step components (file-internal)
// ─────────────────────────────────────────────────────────────────────

interface RecipeStepProps {
  recipes: { name: string; localised_name: string }[];
  /** 진짜 Recipe 타입을 쓴다 — 인라인 복제는 `amount: number` 같은 거짓 전제를 퍼뜨린다. */
  recipeMap: Map<string, Recipe>;
  recipesByProduct: Map<string, string[]>;
  targetRecipe: string;
  setTargetRecipe: (v: string) => void;
  countMode: 'min' | 'manual';
  setCountMode: (v: 'min' | 'manual') => void;
  perTarget: number;
  setPerTarget: (v: number) => void;
  tree: RecipeTreeNode | null;
  externalIngredients: Set<string>;
  setExternalIngredients: (v: Set<string>) => void;
  recipeOverrides: Record<string, string>;
  setRecipeOverrides: (v: Record<string, string>) => void;
  loaded: boolean;
  t: (k: string, p?: Record<string, string | number>) => string;
}

function RecipeStep(props: RecipeStepProps) {
  const {
    recipes,
    recipeMap,
    recipesByProduct,
    targetRecipe,
    setTargetRecipe,
    countMode,
    setCountMode,
    perTarget,
    setPerTarget,
    tree,
    externalIngredients,
    setExternalIngredients,
    recipeOverrides,
    setRecipeOverrides,
    loaded,
    t,
  } = props;

  const recipe = targetRecipe ? recipeMap.get(targetRecipe) : null;

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs uppercase tracking-wider text-gray-400 block mb-1">
          {t('autoLayoutModal.targetRecipe')}
        </label>
        <RecipeCombobox
          recipes={recipes}
          value={targetRecipe}
          onChange={setTargetRecipe}
          disabled={!loaded}
          placeholder={t('autoLayoutModal.recipeDefault')}
          searchPlaceholder={t('autoLayoutModal.recipeSearchPlaceholder')}
          emptyMessage={t('autoLayoutModal.recipeNoMatch')}
        />
      </div>

      {recipe && (
        <div className="bg-gray-800/40 border border-gray-700 rounded p-3 text-xs text-gray-300 space-y-1">
          <div>
            <span className="text-gray-500">{t('autoLayoutModal.recipeCategory')}: </span>
            {recipe.category}
          </div>
          <div>
            <span className="text-gray-500">{t('autoLayoutModal.recipeTime')}: </span>
            {recipe.energy_required}s
          </div>
          <div>
            <span className="text-gray-500">{t('autoLayoutModal.recipeIngredients')}: </span>
            {recipe.ingredients.map((i) => `${i.amount}× ${i.name}`).join(', ') || '—'}
          </div>
          <div>
            <span className="text-gray-500">{t('autoLayoutModal.recipeProducts')}: </span>
            {recipe.products.map((p) => `${p.amount}× ${p.name}`).join(', ') || '—'}
          </div>
        </div>
      )}

      <div>
        <label className="text-xs uppercase tracking-wider text-gray-400 block mb-1">
          {t('autoLayoutModal.countMode')}
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCountMode('min')}
            className={`text-xs px-3 py-1 rounded border transition-colors ${
              countMode === 'min'
                ? 'border-orange-500 bg-orange-500/10 text-orange-300'
                : 'border-gray-700 text-gray-400 hover:border-gray-600'
            }`}
          >
            {t('autoLayoutModal.countMin')}
          </button>
          <button
            onClick={() => setCountMode('manual')}
            className={`text-xs px-3 py-1 rounded border transition-colors ${
              countMode === 'manual'
                ? 'border-orange-500 bg-orange-500/10 text-orange-300'
                : 'border-gray-700 text-gray-400 hover:border-gray-600'
            }`}
          >
            {t('autoLayoutModal.countManual')}
          </button>
          {countMode === 'manual' && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                step={0.1}
                value={perTarget}
                onChange={(e) => setPerTarget(Math.max(0, Number(e.target.value)))}
                className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100"
              />
              <span className="text-[10px] text-gray-400">{t('autoLayoutModal.countUnit')}</span>
            </div>
          )}
        </div>
        <p className="text-[10px] text-gray-500 mt-1">{t('autoLayoutModal.countHelp')}</p>
      </div>

      {tree && (
        <>
          <div>
            <label className="text-xs uppercase tracking-wider text-gray-400 block mb-1">
              {t('autoLayoutModal.ingredientTree')}
            </label>
            <p className="text-[10px] text-gray-500 mb-1">
              {t('autoLayoutModal.ingredientTreeHelp')}
            </p>
            <div className="bg-gray-800/40 border border-gray-700 rounded p-2 text-xs max-h-64 overflow-y-auto">
              <TreeView
                node={tree}
                recipeMap={recipeMap}
                recipesByProduct={recipesByProduct}
                externalIngredients={externalIngredients}
                setExternalIngredients={setExternalIngredients}
                recipeOverrides={recipeOverrides}
                setRecipeOverrides={setRecipeOverrides}
                t={t}
              />
            </div>
          </div>
          <SelfProducedChips
            tree={tree}
            externalIngredients={externalIngredients}
            setExternalIngredients={setExternalIngredients}
            t={t}
          />
        </>
      )}
    </div>
  );
}

interface RecipeOption {
  name: string;
  localised_name: string;
}

interface RecipeComboboxProps {
  recipes: RecipeOption[];
  value: string;
  onChange: (name: string) => void;
  disabled: boolean;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
}

function RecipeCombobox({
  recipes,
  value,
  onChange,
  disabled,
  placeholder,
  searchPlaceholder,
  emptyMessage,
}: RecipeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(
    () => recipes.find((r) => r.name === value),
    [recipes, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.localised_name && r.localised_name.toLowerCase().includes(q)),
    );
  }, [recipes, query]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
      // 다음 paint 직후 input 포커스
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function handleSelect(name: string) {
    onChange(name);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[highlight];
      if (pick) handleSelect(pick.name);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between bg-gray-800 border rounded px-2 py-1.5 text-sm text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          open ? 'border-orange-500' : 'border-gray-700 hover:border-gray-600'
        }`}
      >
        <span className={selected ? 'text-gray-100 truncate' : 'text-gray-500 truncate'}>
          {selected ? selected.localised_name || selected.name : placeholder}
        </span>
        <span className="text-gray-500 text-xs ml-2 shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-full bg-gray-900 border border-gray-700 rounded shadow-xl">
          <div className="p-1.5 border-b border-gray-800">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-orange-500"
            />
          </div>
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-500 italic">{emptyMessage}</div>
          ) : (
            <ul
              ref={listRef}
              className="max-h-64 overflow-y-auto py-1"
            >
              {filtered.map((r, i) => {
                const isSelected = r.name === value;
                const isHighlighted = i === highlight;
                return (
                  <li
                    key={r.name}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => handleSelect(r.name)}
                    className={`px-3 py-1 text-xs cursor-pointer flex items-center justify-between ${
                      isHighlighted
                        ? 'bg-orange-500/20 text-orange-100'
                        : isSelected
                        ? 'text-orange-200'
                        : 'text-gray-200 hover:bg-gray-800/60'
                    }`}
                  >
                    <span className="truncate">{r.localised_name || r.name}</span>
                    {r.localised_name && r.localised_name !== r.name && (
                      <span className="text-[10px] text-gray-500 ml-2 shrink-0">{r.name}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface SelfProducedChipsProps {
  tree: RecipeTreeNode;
  externalIngredients: Set<string>;
  setExternalIngredients: (v: Set<string>) => void;
  t: (k: string, p?: Record<string, string | number>) => string;
}

function SelfProducedChips({
  tree,
  externalIngredients,
  setExternalIngredients,
  t,
}: SelfProducedChipsProps) {
  const items: string[] = [];
  const seen = new Set<string>();
  const all = flattenTree(tree);
  // skip root (index 0): root is the target product, not an ingredient.
  for (let i = 1; i < all.length; i++) {
    const n = all[i];
    if (n.external || !n.recipeName) continue;
    if (seen.has(n.itemName)) continue;
    seen.add(n.itemName);
    items.push(n.itemName);
  }

  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-gray-400 block mb-1">
        {t('autoLayoutModal.selfProducedTitle')}
      </label>
      <p className="text-[10px] text-gray-500 mb-1.5">
        {t('autoLayoutModal.selfProducedHint')}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 ? (
          <span className="text-[11px] text-gray-500 italic">
            {t('autoLayoutModal.selfProducedEmpty')}
          </span>
        ) : (
          items.map((name) => (
            <button
              key={name}
              onClick={() => {
                const next = new Set(externalIngredients);
                next.add(name);
                setExternalIngredients(next);
              }}
              title={t('autoLayoutModal.selfProducedChipTooltip')}
              className="group flex items-center gap-1 text-[11px] bg-orange-500/10 border border-orange-600/50 text-orange-100 px-2 py-0.5 rounded-full hover:bg-red-500/20 hover:border-red-500 hover:text-red-100 transition-colors"
            >
              <span>{name}</span>
              <span className="opacity-50 group-hover:opacity-100">×</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * 진짜 `Recipe` 를 쓴다. 예전엔 여기에 레시피 모양을 **인라인으로 복제**해 뒀는데, 그 복제본이
 * `amount: number` 라고 단언하는 바람에 **범위 산출물(amount 없음)의 존재를 타입이 가렸다**
 * (2026-07-16). 복제하지 말 것 — 거짓 전제가 조용히 퍼진다.
 */
type RecipeMapLike = Map<string, Recipe>;

interface TreeViewProps {
  node: RecipeTreeNode;
  depth?: number;
  recipeMap: RecipeMapLike;
  recipesByProduct: Map<string, string[]>;
  externalIngredients: Set<string>;
  setExternalIngredients: (v: Set<string>) => void;
  recipeOverrides: Record<string, string>;
  setRecipeOverrides: (v: Record<string, string>) => void;
  t: (k: string, p?: Record<string, string | number>) => string;
}

function TreeView({
  node,
  depth = 0,
  recipeMap,
  recipesByProduct,
  externalIngredients,
  setExternalIngredients,
  recipeOverrides,
  setRecipeOverrides,
  t,
}: TreeViewProps) {
  const isExternal = node.external;
  const isRoot = depth === 0;
  const canToggle = !isRoot; // root 는 항상 내부 생산

  // 이 아이템을 만들 수 있는 레시피들. 2개 이상이면 대체 제작법 선택 UI 노출.
  const altRecipes = isRoot ? [] : recipesByProduct.get(node.itemName) ?? [];
  const hasAlternatives = !isExternal && altRecipes.length > 1 && !!node.recipeName;

  function handleToggle() {
    if (!canToggle) return;
    const next = new Set(externalIngredients);
    if (next.has(node.itemName)) next.delete(node.itemName);
    else next.add(node.itemName);
    setExternalIngredients(next);
  }

  function handlePickRecipe(recipeName: string) {
    const next = { ...recipeOverrides };
    // 기본(첫 번째) 제작법을 고르면 override 제거 — 깔끔하게 유지.
    if (altRecipes[0] === recipeName) delete next[node.itemName];
    else next[node.itemName] = recipeName;
    setRecipeOverrides(next);
  }

  function recipeLabel(name: string): string {
    const r = recipeMap.get(name);
    const loc = r?.localised_name;
    return loc && loc !== name ? `${loc} (${name})` : name;
  }

  let rowClass: string;
  let badgeText: string;
  let badgeClass: string;
  if (isRoot) {
    rowClass = 'bg-gray-800/60 border border-gray-600 text-gray-100';
    badgeText = t('autoLayoutModal.badgeTarget');
    badgeClass = 'bg-gray-700 text-gray-200';
  } else if (isExternal) {
    rowClass =
      'bg-gray-900/40 border border-dashed border-gray-700 text-gray-500 italic cursor-pointer hover:bg-gray-800/60 hover:border-gray-600';
    badgeText = t('autoLayoutModal.badgeExternal');
    badgeClass = 'bg-gray-700/60 text-gray-400 not-italic';
  } else {
    rowClass =
      'bg-orange-500/10 border border-orange-600/50 text-orange-50 cursor-pointer hover:bg-orange-500/20 hover:border-orange-500';
    badgeText = t('autoLayoutModal.badgeInternal');
    badgeClass = 'bg-orange-600/40 text-orange-100';
  }

  const tooltip = canToggle
    ? isExternal
      ? t('autoLayoutModal.markInternal')
      : t('autoLayoutModal.markExternal')
    : undefined;

  return (
    <div style={{ paddingLeft: depth * 14 }}>
      <div
        onClick={handleToggle}
        title={tooltip}
        className={`flex items-center gap-2 px-2 py-1 my-0.5 rounded transition-colors ${rowClass}`}
      >
        <span
          className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold shrink-0 ${badgeClass}`}
        >
          {badgeText}
        </span>
        <span className="font-medium">{node.itemName}</span>
        {hasAlternatives ? (
          <select
            value={node.recipeName}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => handlePickRecipe(e.target.value)}
            title={t('autoLayoutModal.altRecipeTooltip', { count: altRecipes.length })}
            className="ml-1 max-w-[55%] bg-gray-900 border border-amber-600/60 text-amber-100 text-[10px] rounded px-1 py-0.5 cursor-pointer hover:border-amber-400 focus:outline-none focus:border-amber-400"
          >
            {altRecipes.map((rn) => (
              <option key={rn} value={rn} className="bg-gray-900 text-gray-100">
                {recipeLabel(rn)}
              </option>
            ))}
          </select>
        ) : (
          node.recipeName && node.recipeName !== node.itemName && (
            <span className="text-[10px] opacity-60">({node.recipeName})</span>
          )
        )}
        {!isExternal && node.recipeName && (
          <span className="text-[10px] ml-auto opacity-80">×{node.machineCount}</span>
        )}
      </div>
      {node.children.map((c, i) => (
        <TreeView
          key={c.itemName + ':' + i}
          node={c}
          depth={depth + 1}
          recipeMap={recipeMap}
          recipesByProduct={recipesByProduct}
          externalIngredients={externalIngredients}
          setExternalIngredients={setExternalIngredients}
          recipeOverrides={recipeOverrides}
          setRecipeOverrides={setRecipeOverrides}
          t={t}
        />
      ))}
    </div>
  );
}

interface CheckboxStepProps {
  title: string;
  description: string;
  candidates: Entity[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  autoCheckedHint: string | null;
  t: (k: string, p?: Record<string, string | number>) => string;
}

function CheckboxStep({
  title,
  description,
  candidates,
  selected,
  onToggle,
  autoCheckedHint,
  t,
}: CheckboxStepProps) {
  if (candidates.length === 0) {
    return (
      <div className="text-sm text-gray-400 italic">
        {t('autoLayoutModal.noCandidates', { what: title })}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-400">{description}</p>
      {autoCheckedHint && <p className="text-[10px] text-gray-500">{autoCheckedHint}</p>}
      <div className="grid grid-cols-2 gap-1.5 max-h-72 overflow-y-auto">
        {candidates.map((c) => {
          const checked = selected.has(c.name);
          return (
            <label
              key={c.name}
              className={`flex items-center gap-2 px-2 py-1 rounded border text-xs cursor-pointer transition-colors ${
                checked
                  ? 'border-orange-500 bg-orange-500/10 text-orange-200'
                  : 'border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-600'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(c.name)}
                className="accent-orange-500"
              />
              <span className="truncate">{c.localised_name || c.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 위저드 3단계의 인서터 처리량 override 입력.
 *
 * 인서터별로 두 입력 (묶음 갯수 / 처리량) 을 가지지만 **상호 배타적**:
 *  - 처리량을 입력하면 묶음 갯수 입력은 disabled 상태가 되고 무시됨.
 *  - 처리량 입력을 비우면 묶음 갯수가 다시 활성화되어 자동 계산에 사용됨.
 *
 * 두 입력 모두 비워 두면 stack=1 의 기본 추정 처리량이 placeholder 로 표시되고
 * 알고리즘에서도 그 값을 사용한다.
 */
interface InserterThroughputOverridesProps {
  inserters: Entity[];
  overrides: Record<string, InserterOverrideEntry>;
  setOverrides: (next: Record<string, InserterOverrideEntry>) => void;
}

function InserterThroughputOverrides({
  inserters,
  overrides,
  setOverrides,
}: InserterThroughputOverridesProps) {
  if (inserters.length === 0) return null;

  const update = (name: string, patch: InserterOverrideEntry) => {
    const cur = overrides[name] ?? {};
    const merged = { ...cur, ...patch };
    if (merged.throughput === undefined && merged.stackSize === undefined) {
      const next = { ...overrides };
      delete next[name];
      setOverrides(next);
    } else {
      setOverrides({ ...overrides, [name]: merged });
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-800">
      <h4 className="text-xs uppercase tracking-wider text-gray-400 mb-2">
        투입기 처리량 보정 (선택)
      </h4>
      <p className="text-[10px] text-gray-500 mb-2 leading-relaxed">
        묶음 갯수만 입력하면 처리량은 자동 계산됩니다. 처리량을 직접 입력하면 묶음 갯수는 무시됩니다.
        둘 다 비우면 기본 추정값(괄호 안)이 사용됩니다.
      </p>
      <div className="space-y-1.5">
        {inserters.map((ins) => {
          const ov = overrides[ins.name] ?? {};
          const hasThroughput = ov.throughput !== undefined && ov.throughput > 0;
          const def = defaultInserterThroughput(ins);
          const eff = inserterThroughput(ins, ov);
          return (
            <div
              key={ins.name}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 text-xs"
            >
              <span className="truncate text-gray-200">{ins.localised_name || ins.name}</span>
              <label className="flex items-center gap-1 text-gray-400">
                <span className="text-[10px]">묶음</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  disabled={hasThroughput}
                  value={ov.stackSize ?? ''}
                  placeholder="1"
                  onChange={(e) => {
                    const v = e.target.value === '' ? undefined : Math.max(1, Number(e.target.value));
                    update(ins.name, { stackSize: v });
                  }}
                  className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-right disabled:opacity-30"
                />
              </label>
              <label className="flex items-center gap-1 text-gray-400">
                <span className="text-[10px]">/s</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={ov.throughput ?? ''}
                  placeholder={def > 0 ? def.toFixed(2) : '—'}
                  onChange={(e) => {
                    const v = e.target.value === '' ? undefined : Math.max(0, Number(e.target.value));
                    update(ins.name, { throughput: v });
                  }}
                  className="w-16 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-right"
                />
              </label>
              <span className="text-[10px] text-gray-500 w-20 text-right">
                = {eff > 0 ? `${eff.toFixed(2)} /s` : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ReviewStepProps {
  targetRecipe: string;
  totalMachines: number;
  internalRecipes: Set<string>;
  selectedMachines: Set<string>;
  selectedInserters: Set<string>;
  selectedBelts: Set<string>;
  t: (k: string, p?: Record<string, string | number>) => string;
}

function ReviewStep(props: ReviewStepProps) {
  const {
    targetRecipe,
    totalMachines,
    internalRecipes,
    selectedMachines,
    selectedInserters,
    selectedBelts,
    t,
  } = props;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-xs">
        <SummaryRow label={t('autoLayoutModal.summary.target')} value={targetRecipe || '—'} />
        <SummaryRow
          label={t('autoLayoutModal.summary.machinesRequired')}
          value={String(totalMachines)}
        />
        <SummaryRow
          label={t('autoLayoutModal.summary.recipesInTree')}
          value={String(internalRecipes.size)}
        />
        <SummaryRow
          label={t('autoLayoutModal.summary.selectedMachines')}
          value={String(selectedMachines.size)}
        />
        <SummaryRow
          label={t('autoLayoutModal.summary.selectedInserters')}
          value={String(selectedInserters.size)}
        />
        <SummaryRow
          label={t('autoLayoutModal.summary.selectedBelts')}
          value={String(selectedBelts.size)}
        />
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between bg-gray-800/40 border border-gray-700 rounded px-2 py-1">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-100 font-mono">{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function sumMachineCounts(node: RecipeTreeNode): number {
  let total = 0;
  for (const n of flattenTree(node)) {
    total += n.machineCount;
  }
  return total;
}
