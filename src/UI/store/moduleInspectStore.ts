/**
 * moduleInspectStore — 그리드에서 선택된 "모듈"(자족 클러스터) 하나를 추적.
 *
 * 모듈 이름표(레시피 라벨) 클릭이 `open(key)` 를 호출하고, ModuleInfoPanel(비차단
 * 플로팅 패널)이 이 key 로 collectModules() 에서 상세를 뽑아 표시한다. entity inspect
 * (useInspectStore) 와 대칭이되, 모달이 아니라 캔버스 위 플로팅 패널이라 편집을 막지 않는다.
 */

import { create } from "zustand";

interface ModuleInspectState {
  /** 선택된 모듈 키(collectModules().key). null 이면 패널 닫힘. */
  moduleKey: string | null;
  open: (key: string) => void;
  close: () => void;
}

export const useModuleInspectStore = create<ModuleInspectState>((set) => ({
  moduleKey: null,
  open: (key) => set({ moduleKey: key }),
  close: () => set({ moduleKey: null }),
}));
