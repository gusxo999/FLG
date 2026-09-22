/**
 * 흐름 분석 — **지금 그리드**의 가동률 결과를 한 곳에서 꺼내고, 캔버스 표시를 끄고 켠다.
 *
 * 분석(`analysis/flow`)은 순수 함수라 입력을 넘겨야 하는데, 입력이 스토어 셋에 흩어져 있다 —
 * 그리드(`layoutStore`) · 게임데이터(`gameDataStore`) · 인서터 보정(`wizardStore`). 그걸 모으는
 * 자리가 여럿이면(캔버스 · 정보 모달 · 콘솔) 한 곳이 보정을 빠뜨리는 순간 **같은 그리드에 두 답**이
 * 나온다. 그래서 모으는 곳을 여기 하나로 둔다.
 *
 * **메모는 입력 참조로 한다.** 그리드는 바뀔 때마다 새 객체이고(`layoutStore` 의 모든 `set`),
 * 캔버스는 팬·줌마다 다시 그리므로 참조가 같으면 다시 풀지 않는다.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { analyzeLayout } from '../../analysis/flow/build';
import type { FlowResult } from '../../analysis/flow/types';
import { useGameDataStore } from './gameDataStore';
import { useLayoutStore } from './layoutStore';
import { useWizardStore } from './wizardStore';

let memo: { key: readonly unknown[]; result: FlowResult } | null = null;

/** 지금 그리드의 분석 결과. 입력이 그대로면 지난 결과를 돌려준다. */
export function currentFlow(): FlowResult {
  const { grid } = useLayoutStore.getState();
  const { entityMap, recipeMap, moduleMap } = useGameDataStore.getState();
  const { inserterOverrides } = useWizardStore.getState();
  const key = [grid, entityMap, recipeMap, moduleMap, inserterOverrides] as const;
  if (memo && memo.key.every((v, i) => v === key[i])) return memo.result;
  const result = analyzeLayout(grid, { entityMap, recipeMap, moduleMap, inserterOverrides });
  memo = { key, result };
  return result;
}

interface FlowUiState {
  /** 캔버스에 머신 가동률 테두리를 그리나. 기본 켜짐(`docs/UI/flow-inspection.md` §2.1). */
  showMachines: boolean;
  setShowMachines: (v: boolean) => void;
}

export const useFlowStore = create<FlowUiState>()(
  persist(
    (set) => ({
      showMachines: true,
      setShowMachines: (showMachines) => set({ showMachines }),
    }),
    { name: 'factorio-layout-flow' },
  ),
);

/**
 * React 에서 쓰는 판 — 입력 셋을 구독해 **바뀔 때만** 다시 읽는다. 풀이는 `currentFlow` 의 메모가
 * 맡으므로 여러 컴포넌트가 불러도 한 번만 푼다.
 */
export function useCurrentFlow(): FlowResult {
  useLayoutStore((s) => s.grid);
  useGameDataStore((s) => s.entityMap);
  useGameDataStore((s) => s.recipeMap);
  useGameDataStore((s) => s.moduleMap);
  useWizardStore((s) => s.inserterOverrides);
  return currentFlow();
}
