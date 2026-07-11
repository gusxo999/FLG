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
  /**
   * 클릭한 그리드 셀 좌표 (캔버스 클릭 inspect 시에만 set).
   * 벨트류 셀이면 정보 모달이 그 지점의 흐름량(beltFlow)을 함께 표시한다.
   */
  cell: { x: number; y: number } | null;
  inspect: (name: string | null, entityId?: string | null, cell?: { x: number; y: number } | null) => void;
  close: () => void;
}

export const useInspectStore = create<InspectState>((set) => ({
  entityName: null,
  entityId: null,
  cell: null,
  inspect: (entityName, entityId = null, cell = null) => set({ entityName, entityId, cell }),
  close: () => set({ entityName: null, entityId: null, cell: null }),
}));
