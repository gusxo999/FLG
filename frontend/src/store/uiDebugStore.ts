import { create } from 'zustand';

/**
 * UI 디버그 토글 — 컴포넌트가 반응형으로 구독해야 하는 디버그 플래그.
 * (콘솔 dump 용 모듈 상수 `debugFlags.ts` 와 달리, 여기 값은 zustand 라서
 *  토글 시 관련 컴포넌트가 즉시 리렌더된다.)
 *
 * - showEntityDebugInfo: 엔티티 정보 모달에 인스턴스 ID·좌표 등 디버깅용
 *   정보를 노출한다. 기본 false(숨김). 디버그 탭에서 토글.
 */
interface UiDebugState {
  showEntityDebugInfo: boolean;
  setShowEntityDebugInfo: (v: boolean) => void;
}

export const useUiDebugStore = create<UiDebugState>((set) => ({
  showEntityDebugInfo: false,
  setShowEntityDebugInfo: (showEntityDebugInfo) => set({ showEntityDebugInfo }),
}));
