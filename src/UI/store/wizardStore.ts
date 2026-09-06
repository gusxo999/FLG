import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type WizardStep = 'recipe' | 'machine' | 'inserter' | 'belt' | 'pipe' | 'review' | 'debug';

export const WIZARD_STEPS: WizardStep[] = [
  'recipe', 'machine', 'inserter', 'belt', 'pipe', 'review', 'debug',
];

export interface InserterOverrideEntry {
  throughput?: number;
  stackSize?: number;
}

interface WizardState {
  step: WizardStep;
  targetRecipe: string;
  countMode: 'min' | 'manual';
  perTarget: number;
  // Sets are stored as sorted arrays for JSON serialization
  /**
   * 트리에서 **자체 생산으로 펼친** 품목. 비어 있으면 트리는 안 펼쳐진 상태(루트의 직속
   * 재료가 전부 외부 공급)다 — 펼침은 사용자가 행을 눌러 하나씩 고른다.
   */
  internalIngredients: string[];
  selectedMachines: string[];
  selectedInserters: string[];
  selectedBelts: string[];
  selectedUndergroundBelts: string[];
  selectedPipes: string[];
  inserterOverrides: Record<string, InserterOverrideEntry>;
  /** item.name → 사용자가 고른 대체 제작법 이름. 기본 제작법을 쓰는 아이템은 항목 없음. */
  recipeOverrides: Record<string, string>;

  setStep: (s: WizardStep) => void;
  setTargetRecipe: (r: string) => void;
  setCountMode: (m: 'min' | 'manual') => void;
  setPerTarget: (n: number) => void;
  setInternalIngredients: (v: Set<string>) => void;
  setSelectedMachines: (v: Set<string>) => void;
  setSelectedInserters: (v: Set<string>) => void;
  setSelectedBelts: (v: Set<string>) => void;
  setSelectedUndergroundBelts: (v: Set<string>) => void;
  setSelectedPipes: (v: Set<string>) => void;
  setInserterOverrides: (v: Record<string, InserterOverrideEntry>) => void;
  setRecipeOverrides: (v: Record<string, string>) => void;
  reset: () => void;
}

const INITIAL = {
  step: 'recipe' as WizardStep,
  targetRecipe: '',
  countMode: 'min' as const,
  perTarget: 1,
  internalIngredients: [] as string[],
  selectedMachines: [] as string[],
  selectedInserters: [] as string[],
  selectedBelts: [] as string[],
  selectedUndergroundBelts: [] as string[],
  selectedPipes: [] as string[],
  inserterOverrides: {} as Record<string, InserterOverrideEntry>,
  recipeOverrides: {} as Record<string, string>,
};

export const useWizardStore = create<WizardState>()(
  persist(
    (set) => ({
      ...INITIAL,

      setStep: (s) => set({ step: s }),
      setTargetRecipe: (r) => set({ targetRecipe: r }),
      setCountMode: (m) => set({ countMode: m }),
      setPerTarget: (n) => set({ perTarget: n }),
      setInternalIngredients: (v) => set({ internalIngredients: [...v] }),
      setSelectedMachines: (v) => set({ selectedMachines: [...v] }),
      setSelectedInserters: (v) => set({ selectedInserters: [...v] }),
      setSelectedBelts: (v) => set({ selectedBelts: [...v] }),
      setSelectedUndergroundBelts: (v) => set({ selectedUndergroundBelts: [...v] }),
      setSelectedPipes: (v) => set({ selectedPipes: [...v] }),
      setInserterOverrides: (v) => set({ inserterOverrides: v }),
      setRecipeOverrides: (v) => set({ recipeOverrides: v }),
      reset: () => set({ ...INITIAL }),
    }),
    {
      name: 'flg-wizard-state',
      /**
       * v1 — 재료 트리의 극성이 뒤집혔다(2026-09-05). 옛 `externalIngredients` 는 "여기서
       * 끊을 품목", 새 `internalIngredients` 는 "여기서 펼칠 품목"이라 **값을 옮길 수 없다**
       * (뜻이 정반대다). 옛 키는 버리고 새 필드는 초기값 `[]` = 안 펼쳐진 트리로 시작한다.
       */
      version: 1,
      migrate: (persisted, version) => {
        if (version >= 1) return persisted as WizardState;
        const rest = { ...((persisted ?? {}) as Record<string, unknown>) };
        delete rest.externalIngredients;
        return { ...rest, internalIngredients: [] } as unknown as WizardState;
      },
    },
  ),
);
