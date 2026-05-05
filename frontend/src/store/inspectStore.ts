import { create } from 'zustand';

/**
 * 전역 "엔티티 정보 모달" 상태.
 * - Sidebar의 ⓘ 버튼: 현재 팔레트에서 선택된 엔티티 inspect (entityId=null)
 * - 캔버스에서 배치된 엔티티 클릭: 그 엔티티 instance inspect (entityId=cell.entityId)
 *
 * entityId가 set 되어 있으면 "배치된 인스턴스" 모드 → 레시피 바인딩 등
 * 인스턴스 단위 편집이 가능하다.
 */
interface InspectState {
  entityName: string | null;
  /** 배치된 인스턴스의 cell.entityId (팔레트 inspect 시엔 null) */
  entityId: string | null;
  inspect: (name: string | null, entityId?: string | null) => void;
  close: () => void;
}

export const useInspectStore = create<InspectState>((set) => ({
  entityName: null,
  entityId: null,
  inspect: (entityName, entityId = null) => set({ entityName, entityId }),
  close: () => set({ entityName: null, entityId: null }),
}));
