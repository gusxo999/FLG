import { create } from 'zustand';

/**
 * 커스텀 레시피 편집기의 **열림 상태만** 들고 있는다.
 *
 * 초안(draft)은 일부러 여기 없다 — 모달의 로컬 state 다. 저장은 언제나
 * `customDataStore.merge()` **한 번**이라, 초안이 어디 살든 버튼과 `flg.custom.add` 가
 * 같은 일을 한다(ai-console.md §2 의 **방식 A**). 초안을 스토어로 올리면 명령이 하나 더
 * 늘 뿐 그 성질은 안 바뀐다.
 */
export interface CustomEditorSeed {
  /** 편집할 기존 커스텀 레시피 이름. */
  editRecipe?: string;
  /** 이 아이템을 산출로 놓고 시작한다 — 재료의 제작법을 만들 때. */
  productName?: string;
}

interface CustomEditorState {
  open: boolean;
  seed: CustomEditorSeed | null;
  /** 목록·삭제 패널. **만드는 자리와 관리하는 자리를 나눈다** — 편집기와 따로 연다. */
  listOpen: boolean;
  openEditor: (seed?: CustomEditorSeed) => void;
  close: () => void;
  openList: () => void;
  closeList: () => void;
}

export const useCustomEditorStore = create<CustomEditorState>((set) => ({
  open: false,
  seed: null,
  listOpen: false,
  openEditor: (seed) => set({ open: true, seed: seed ?? null }),
  close: () => set({ open: false, seed: null }),
  openList: () => set({ listOpen: true }),
  closeList: () => set({ listOpen: false }),
}));
