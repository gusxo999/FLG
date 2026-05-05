import { useEffect } from 'react';
import type { Entity } from '../store/gameDataStore';
import { useT } from '../i18n';
import EntityDetails from './EntityDetails';

interface Props {
  entity: Entity | null;
  /** 배치된 인스턴스의 cell.entityId. set 되어 있으면 인스턴스 편집 UI 노출 */
  instanceId?: string | null;
  open: boolean;
  onClose: () => void;
}

export default function EntityInfoModal({ entity, instanceId, open, onClose }: Props) {
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700 bg-gray-950">
          <h2 className="text-white font-bold text-sm flex items-center gap-2">
            <span className="text-blue-400">ⓘ</span>
            {t('sidebar.details.title')}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 text-xl leading-none"
            title={t('sidebar.details.closeModal')}
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <EntityDetails entity={entity} instanceId={instanceId ?? null} />
        </div>
      </div>
    </div>
  );
}
