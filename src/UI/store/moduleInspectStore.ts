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
  /**
   * **지금 강조 중인 대상** — 캔버스와 사이드바 목록이 **같은 상태를 공유**한다.
   *
   * 강조 자체는 렌더러가 자기 모듈 스코프 변수(`hoveredModuleKey`·`hoveredRoutingId`)로
   * 들고 있는데 그건 React 밖이라 목록이 못 읽는다. 여기가 그 다리다 — 새 store 를
   * 만들기보다 이미 "무엇을 보고 있나" 를 담당하는 이 store 를 늘리는 편이 자연스럽다.
   *
   * **한 방향만 쓴다**: 마우스가 실제로 올라간 쪽이 값을 넣고, 반대쪽은 읽어서 표시만
   * 한다. 양쪽이 서로를 트리거하면 되먹임으로 돈다.
   */
  hoveredModuleKey: string | null;
  hoveredLineId: string | null;

  open: (key: string) => void;
  close: () => void;
  /** 목록에서 hover — 캔버스가 이 값을 읽어 강조한다. */
  setHovered: (v: { moduleKey?: string | null; lineId?: string | null }) => void;
}

export const useModuleInspectStore = create<ModuleInspectState>((set) => ({
  moduleKey: null,
  hoveredModuleKey: null,
  hoveredLineId: null,
  open: (key) => set({ moduleKey: key }),
  close: () => set({ moduleKey: null }),
  setHovered: (v) =>
    set({
      hoveredModuleKey: v.moduleKey !== undefined ? v.moduleKey : null,
      hoveredLineId: v.lineId !== undefined ? v.lineId : null,
    }),
}));
