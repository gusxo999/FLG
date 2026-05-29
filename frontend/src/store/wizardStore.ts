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
  externalIngredients: string[];
  selectedMachines: string[];
  selectedInserters: string[];
  selectedBelts: string[];
  selectedUndergroundBelts: string[];
  selectedPipes: string[];
  inserterOverrides: Record<string, InserterOverrideEntry>;

  setStep: (s: WizardStep) => void;
  setTargetRecipe: (r: string) => void;
  setCountMode: (m: 'min' | 'manual') => void;
  setPerTarget: (n: number) => void;
  setExternalIngredients: (v: Set<string>) => void;
  setSelectedMachines: (v: Set<string>) => void;
  setSelectedInserters: (v: Set<string>) => void;
  setSelectedBelts: (v: Set<string>) => void;
  setSelectedUndergroundBelts: (v: Set<string>) => void;
  setSelectedPipes: (v: Set<string>) => void;
  setInserterOverrides: (v: Record<string, InserterOverrideEntry>) => void;
  reset: () => void;
}

const INITIAL = {
  step: 'recipe' as WizardStep,
  targetRecipe: '',
  countMode: 'min' as const,
  perTarget: 1,
  externalIngredients: [] as string[],
  selectedMachines: [] as string[],
  selectedInserters: [] as string[],
  selectedBelts: [] as string[],
  selectedUndergroundBelts: [] as string[],
  selectedPipes: [] as string[],
  inserterOverrides: {} as Record<string, InserterOverrideEntry>,
};

export const useWizardStore = create<WizardState>()(
  persist(
    (set) => ({
      ...INITIAL,

      setStep: (s) => set({ step: s }),
      setTargetRecipe: (r) => set({ targetRecipe: r }),
      setCountMode: (m) => set({ countMode: m }),
      setPerTarget: (n) => set({ perTarget: n }),
      setExternalIngredients: (v) => set({ externalIngredients: [...v] }),
      setSelectedMachines: (v) => set({ selectedMachines: [...v] }),
      setSelectedInserters: (v) => set({ selectedInserters: [...v] }),
      setSelectedBelts: (v) => set({ selectedBelts: [...v] }),
      setSelectedUndergroundBelts: (v) => set({ selectedUndergroundBelts: [...v] }),
      setSelectedPipes: (v) => set({ selectedPipes: [...v] }),
      setInserterOverrides: (v) => set({ inserterOverrides: v }),
      reset: () => set({ ...INITIAL }),
    }),
    {
      name: 'flg-wizard-state',
    },
  ),
);
