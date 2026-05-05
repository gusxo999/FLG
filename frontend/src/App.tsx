import { useEffect } from 'react';
import Toolbar from './components/Toolbar';
import Sidebar from './components/Sidebar';
import GridCanvas from './components/GridCanvas';
import Tutorial from './components/Tutorial';
import ToastContainer from './components/ToastContainer';
import EntityInfoModal from './components/EntityInfoModal';
import { useInspectStore } from './store/inspectStore';
import { EntityType } from './types/layout';
import { useLayoutStore } from './store/layoutStore';
import { useGameDataStore } from './store/gameDataStore';
import { useT } from './i18n';

export default function App() {
  const t = useT();
  const storageWarning = useGameDataStore((s) => s.storageWarning);
  const inspectName = useInspectStore((s) => s.entityName);
  const inspectId = useInspectStore((s) => s.entityId);
  const closeInspect = useInspectStore((s) => s.close);
  const inspectedEntity = useGameDataStore(
    (s) => (inspectName ? s.entityMap.get(inspectName) ?? null : null),
  );

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

      // Esc: 엔티티 선택 해제 + 다중 선택 해제 + inspect 닫기
      if (e.key === 'Escape') {
        store.setSelectedEntity(EntityType.Empty, '');
        store.clearMultiSelection();
        useInspectStore.getState().close();
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
        entity={inspectedEntity}
        instanceId={inspectId}
        open={!!inspectName}
        onClose={closeInspect}
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
      </div>
    </div>
  );
}
