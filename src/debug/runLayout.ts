/**
 * runLayout — `flg.run()`. **위저드 설정 그대로, 한 줄로 생성까지.**
 *
 * ## 왜 명령이 필요한가
 *
 * 화면에서 한 번 돌리려면 `6단계로 이동 → 레이아웃 생성 클릭 → 결과 확인` 이고, 그
 * 앞에 설정 단계가 붙는다. 게다가 위저드 단계는 persist 라 새로고침하면 **엉뚱한
 * 단계에 클릭이 맞는다**(2026-08-17: 5단계 지하파이프 화면이 떠 있었다). 진단은 같은
 * 실행을 수십 번 반복하는 일이라, 그 왕복이 조사 자체보다 비싸다.
 *
 * ## 화면의 "레이아웃 생성" 과 무엇이 같고 다른가
 *
 * **같은 것:** 입력을 짓는 방법(후보 1개짜리 단계의 자동 선택 포함), 서명, 실행 주체
 * (`autoLayoutRunStore.run`), 실패 처리.
 *
 * **다른 것 하나 — 그리드 적용.** 결과를 그리드에 올리는 일은 6단계 패널의 이펙트가
 * 한다. 패널이 안 떠 있으면 계산은 되고 화면은 빈 채로 남는다(`run` 이 시작할 때
 * `clearGrid()` 를 부르기 때문). 진단에 필요한 자료는 결과 leaf 에 다 있으므로
 * [layoutView] 는 그리드를 안 보지만, **화면으로도 보고 싶으면 6단계를 열어 둔다.**
 * 이 함수는 어느 쪽이었는지 반환값에 적는다.
 */

import { collectInternalRecipes, expandRecipeTree } from '../autoLayout/recipeTree';
import type { ContainerWizardInput } from '../autoLayout/containerModel';
import { signatureOf, useAutoLayoutRunStore } from '../UI/store/autoLayoutRunStore';
import { useGameDataStore } from '../UI/store/gameDataStore';
import { useWizardStore } from '../UI/store/wizardStore';
import { hasScope } from './registry';

export interface RunOverrides {
  /** 타깃 레시피 이름. */
  target?: string;
  /** 'min' = 노드마다 1대 / 'manual' = perTarget(개/초) 비례 배정. */
  mode?: 'min' | 'manual';
  /** manual 모드의 목표 처리량(개/초). 주면 mode 는 자동으로 'manual'. */
  perTarget?: number;
  machines?: string[];
  inserters?: string[];
  belts?: string[];
  ugBelts?: string[];
  pipes?: string[];
  /** 외부에서 공급받을 품목(트리를 여기서 끊는다). */
  external?: string[];
  /**
   * 위저드 스토어에 반영할까. 기본 **true** — 화면이 방금 돌린 설정과 어긋나면
   * 다음에 사람이 누르는 버튼이 다른 것을 돌린다.
   */
  persist?: boolean;
}

export interface RunSummary {
  status: string;
  ms: number;
  /** 성공 시 모듈 수. */
  modules?: number;
  cells?: number;
  issues: number;
  /** 그리드에 올라갔나(6단계 패널이 떠 있어야 한다). */
  appliedToGrid: boolean;
  error?: string;
}

/** 후보가 1개뿐인 단계는 화면이 자동 선택한다 — 명령도 같아야 한다. */
function effective(selected: string[], candidates: string[]): string[] {
  if (selected.length > 0) return selected;
  return candidates.length === 1 ? [candidates[0]] : [];
}

function entitiesOfType(type: string): string[] {
  const { entityMap } = useGameDataStore.getState();
  return [...entityMap.values()].filter((e) => e.type === type).map((e) => e.name);
}

/**
 * 지금 화면이 쓸 머신 후보 — 트리 안 비-외부 레시피의 category 를 처리할 수 있는 머신.
 * (`AutoLayoutModal.machineCandidates` 와 같은 계산. 자동 선택 판정에 필요하다.)
 */
function machineCandidates(target: string, external: Set<string>, overrides: Record<string, string>): string[] {
  const { recipeMap, itemToRecipe, getMachinesForCategory } = useGameDataStore.getState();
  if (!target) return [];
  const tree = expandRecipeTree(target, recipeMap, itemToRecipe, external, new Map(Object.entries(overrides)));
  const cats = new Set<string>();
  for (const name of collectInternalRecipes(tree)) {
    const r = recipeMap.get(name);
    if (r) cats.add(r.category);
  }
  const out = new Set<string>();
  for (const c of cats) for (const m of getMachinesForCategory(c)) out.add(m.name);
  return [...out];
}

/** 현재 위저드 설정(+ 덮어쓰기)으로 실행 입력을 짓는다. */
export function buildInput(ov: RunOverrides = {}): { input: ContainerWizardInput; signature: string } {
  const w = useWizardStore.getState();
  const target = ov.target ?? w.targetRecipe;
  const mode = ov.mode ?? (ov.perTarget !== undefined ? 'manual' : w.countMode);
  const perTarget = ov.perTarget ?? w.perTarget;
  const external = new Set(ov.external ?? w.externalIngredients);

  const machines = effective(
    ov.machines ?? w.selectedMachines,
    machineCandidates(target, external, w.recipeOverrides),
  );
  const inserters = effective(ov.inserters ?? w.selectedInserters, entitiesOfType('inserter'));
  const belts = effective(ov.belts ?? w.selectedBelts, entitiesOfType('transport-belt'));
  const ugBelts = effective(ov.ugBelts ?? w.selectedUndergroundBelts, entitiesOfType('underground-belt'));
  const pipes = effective(ov.pipes ?? w.selectedPipes, entitiesOfType('pipe-to-ground'));

  const input: ContainerWizardInput = {
    targetRecipe: target,
    countMode: mode === 'manual' ? { perTarget } : 'min',
    externalIngredients: external,
    recipeOverrides: w.recipeOverrides,
    selectedMachines: machines,
    selectedInserters: inserters,
    selectedBelts: belts,
    selectedUndergroundPipes: pipes,
    selectedUndergroundBelts: ugBelts,
    inserterOverrides: w.inserterOverrides,
    externalPortsDefault: 'top-left',
  };
  return { input, signature: signatureOf(input) };
}

/** 덮어쓴 설정을 화면(위저드 스토어)에도 반영 — 화면과 명령이 다른 것을 돌리지 않게. */
function persistOverrides(ov: RunOverrides, input: ContainerWizardInput): void {
  const w = useWizardStore.getState();
  if (ov.target !== undefined) w.setTargetRecipe(ov.target);
  if (ov.mode !== undefined || ov.perTarget !== undefined) {
    w.setCountMode(typeof input.countMode === 'object' ? 'manual' : 'min');
    if (ov.perTarget !== undefined) w.setPerTarget(ov.perTarget);
  }
  if (ov.external !== undefined) w.setExternalIngredients(new Set(ov.external));
  if (ov.machines !== undefined) w.setSelectedMachines(new Set(ov.machines));
  if (ov.inserters !== undefined) w.setSelectedInserters(new Set(ov.inserters));
  if (ov.belts !== undefined) w.setSelectedBelts(new Set(ov.belts));
  if (ov.ugBelts !== undefined) w.setSelectedUndergroundBelts(new Set(ov.ugBelts));
  if (ov.pipes !== undefined) w.setSelectedPipes(new Set(ov.pipes));
}

/**
 * 결과가 그리드에 올라가기를 잠깐 기다린다.
 *
 * 적용은 6단계 패널의 **React 이펙트**가 하므로 store 가 `done` 이 된 시점에는 아직
 * 안 올라가 있다. 여기서 안 기다리면 요약이 언제나 "적용 안 됨" 이라고 거짓을 말한다.
 */
async function waitForApply(timeoutMs = 300): Promise<void> {
  if (!hasScope('autoLayoutPanel')) return;
  const t0 = performance.now();
  while (!useAutoLayoutRunStore.getState().applied && performance.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 16));
  }
}

/** 실행이 끝날 때까지 기다린다(`done` 또는 `error`). */
function waitForRun(): Promise<void> {
  return new Promise((resolve) => {
    const s = useAutoLayoutRunStore.getState().status;
    if (s !== 'running') return resolve();
    const unsub = useAutoLayoutRunStore.subscribe((st) => {
      if (st.status === 'done' || st.status === 'error') {
        unsub();
        resolve();
      }
    });
  });
}

/**
 * 실행 1회 — 입력을 짓고, 돌리고, 끝날 때까지 기다린 뒤 요약을 낸다.
 * 게임데이터·머신이 없으면 **돌리기 전에** 처방과 함께 거절한다(화면의 `canRun` 과 같은 판정).
 */
export async function runLayout(ov: RunOverrides = {}): Promise<RunSummary> {
  const { loaded } = useGameDataStore.getState();
  if (!loaded) throw new Error('게임데이터 없음 — 툴바의 "게임데이터 불러오기" 를 먼저.');

  const { input, signature } = buildInput(ov);
  if (!input.targetRecipe) {
    throw new Error("타깃 레시피 없음 — flg.run({ target: '레시피이름' }) 로 주거나 1단계에서 고른다.");
  }
  if (input.selectedMachines.length === 0) {
    throw new Error(
      `머신 미선택 — flg.run({ machines: ['assembling-machine-2'] }) 로 주거나 2단계에서 고른다.`,
    );
  }
  if (ov.persist !== false) persistOverrides(ov, input);

  const t0 = performance.now();
  void useAutoLayoutRunStore.getState().run(input, signature);
  await waitForRun();
  await waitForApply();
  const ms = Math.round(performance.now() - t0);

  const s = useAutoLayoutRunStore.getState();
  const leaf = s.result?.tree.candidates[0] ?? null;
  return {
    status: s.status,
    ms,
    modules: leaf ? new Set(
      leaf.internal.containers
        .filter((c) => c.kind === 'machine')
        .map((c) => c.id.replace(/-m\d+$/, '')),
    ).size : undefined,
    cells: leaf ? leaf.internal.placed.length + leaf.external.placed.length : undefined,
    issues: s.issues.length,
    // 적용은 6단계 패널의 이펙트가 한다 — 패널이 등록돼 있는지로 판정한다.
    appliedToGrid: hasScope('autoLayoutPanel') && s.applied,
    error: s.error ?? undefined,
  };
}
