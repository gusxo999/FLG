import { useEffect, useMemo } from 'react';
import Toolbar from './components/Toolbar';
import Sidebar from './components/Sidebar';
import GridCanvas from './components/GridCanvas';
import Tutorial from './components/Tutorial';
import ToastContainer from './components/ToastContainer';
import EntityInfoModal from './components/EntityInfoModal';
import RoutingConnectionModal from './components/RoutingConnectionModal';
import AutoLayoutSidebar from './components/AutoLayoutModal';
import { useInspectStore } from './store/inspectStore';
import { EntityType, ENTITY_SIZES } from './types/layout';
import { useLayoutStore } from './store/layoutStore';
import { useGameDataStore } from './store/gameDataStore';
import type { Entity } from './store/gameDataStore';
import { useT } from './i18n';

export default function App() {
  const t = useT();
  const storageWarning = useGameDataStore((s) => s.storageWarning);
  const autoLayoutRunning = useLayoutStore((s) => s.autoLayoutRunning);
  const selectedRoutingId = useLayoutStore((s) => s.selectedRoutingId);
  const setSelectedRouting = useLayoutStore((s) => s.setSelectedRouting);
  const inspectName = useInspectStore((s) => s.entityName);
  const inspectId = useInspectStore((s) => s.entityId);
  const closeInspect = useInspectStore((s) => s.close);
  const inspectedEntity = useGameDataStore(
    (s) => (inspectName ? s.entityMap.get(inspectName) ?? null : null),
  );
  const grid = useLayoutStore((s) => s.grid);

  // 게임 데이터에 프로토타입이 없는 배치 인스턴스(예: 무한상자 — lua export 대상이
  // 아님)도 정보 모달이 뜨도록 셀에서 최소 Entity 를 합성한다. 그래야 무한상자의
  // 아이템 정보 패널(InfinityChestInfo)이 노출된다.
  const modalEntity = useMemo<Entity | null>(() => {
    if (inspectedEntity || !inspectName) return inspectedEntity;
    const cell = inspectId
      ? grid.cells.find((c) => c.entityId === inspectId)
      : undefined;
    if (!cell) return null;
    const size = ENTITY_SIZES[cell.entityType];
    return {
      id: -1,
      name: inspectName,
      localised_name: inspectName,
      type: cell.entityType,
      tile_width: size?.width ?? 1,
      tile_height: size?.height ?? 1,
    };
  }, [inspectedEntity, inspectName, inspectId, grid]);

  // persist hydration 직후: stale selectedEntityName 자동 정리
  // (이전 세션에서 선택한 엔티티가 현재 entityMap에 없으면 1x1 fallback이 발생)
  useEffect(() => {
    const layout = useLayoutStore.getState();
    const gd = useGameDataStore.getState();
    if (layout.selectedEntityName && gd.loaded && !gd.entityMap.has(layout.selectedEntityName)) {
      layout.setSelectedEntity(EntityType.Empty, '');
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore when typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const store = useLayoutStore.getState();

      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) store.redo(); else store.undo();
        } else if (k === 'y') {
          e.preventDefault();
          store.redo();
        }
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        store.rotateSelected();
        return;
      }

      // Esc: 엔티티 선택 해제 + 다중 선택 해제 + inspect/routing 닫기
      if (e.key === 'Escape') {
        store.setSelectedEntity(EntityType.Empty, '');
        store.clearMultiSelection();
        useInspectStore.getState().close();
        store.setSelectedRouting(null);
        return;
      }

      // Delete/Backspace: 다중 선택된 엔티티 삭제
      if (e.key === 'Delete' || e.key === 'Backspace') {
        store.deleteSelectedEntities();
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col w-full h-full">
      <ToastContainer />
      <EntityInfoModal
        entity={modalEntity}
        instanceId={inspectId}
        open={!!inspectName}
        onClose={closeInspect}
      />
      <RoutingConnectionModal
        open={!!selectedRoutingId}
        onClose={() => setSelectedRouting(null)}
      />

      {/* Top toolbar */}
      <Toolbar />

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <Sidebar />

        {/* Canvas area */}
        <main className="flex-1 relative overflow-hidden bg-[#1a1a2e]">
          <GridCanvas />
          <Tutorial />

          {storageWarning && (
            <div className="absolute top-2 right-2 bg-yellow-900/80 text-yellow-300 text-xs px-3 py-1.5 rounded max-w-xs">
              {storageWarning}
            </div>
          )}

          {/* Keyboard shortcut hint */}
          <div className="absolute bottom-2 right-2 text-gray-600 text-[10px] space-y-0.5 text-right pointer-events-none">
            <div>{t('shortcuts.pan')}</div>
            <div>{t('shortcuts.scroll')}</div>
            <div>{t('shortcuts.rotateUndo')}</div>
          </div>
        </main>

        {/* Right sidebar — 자동 레이아웃 패널 (항상 표시) */}
        <AutoLayoutSidebar />
      </div>

      {/* 화면 하단 처리중 인디케이터 */}
      {autoLayoutRunning && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 bg-gray-950/90 backdrop-blur border border-purple-700/60 text-purple-200 text-sm px-5 py-2.5 rounded-full shadow-2xl pointer-events-none">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-purple-400 border-t-transparent animate-spin shrink-0" />
          처리중...
        </div>
      )}
    </div>
  );
}
