/**
 * 칸 설명 목록 — 캔버스 왼쪽 아래. 캔버스는 글이 겹칠 자리면 글을 빼고 번호만 남기므로(`pixi-renderer` 칸 설명),
 * 번호 → 글을 여기서 읽는다. 누르면 그 칸의 설명 창이 열린다(엔티티 칸이면 정보 모달과 함께).
 */

import { useState } from 'react';
import { getCell } from '../../types/layout';
import { useT } from '../i18n/index';
import { useCellNoteStore } from '../store/cellNoteStore';
import { useInspectStore } from '../store/inspectStore';
import { useLayoutStore } from '../store/layoutStore';

export default function CellNoteList() {
  const t = useT();
  const notes = useCellNoteStore((s) => s.notes);
  const [open, setOpen] = useState(true);
  if (notes.length === 0) return null;

  const openNote = (x: number, y: number) => {
    const cell = getCell(useLayoutStore.getState().grid, x, y);
    if (cell?.entityName) useInspectStore.getState().inspect(cell.entityName, cell.entityId, { x, y });
    else useCellNoteStore.getState().open({ x, y });
  };

  return (
    <div className="absolute bottom-2 left-2 z-30 max-w-xs bg-gray-950/90 border border-sky-800/70 rounded-lg shadow-lg text-xs">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 px-2.5 py-1 text-sky-300 font-semibold"
      >
        <span>{t('cellNote.list', { count: notes.length })}</span>
        <span className="text-gray-500">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ol className="max-h-56 overflow-y-auto px-1.5 pb-1.5 space-y-0.5">
          {notes.map((n, i) => (
            <li key={`${n.x},${n.y}`}>
              <button
                onClick={() => openNote(n.x, n.y)}
                className="w-full flex items-start gap-1.5 text-left rounded px-1 py-0.5 hover:bg-gray-800"
                title={`(${n.x},${n.y})`}
              >
                <span className="shrink-0 min-w-5 text-center font-bold rounded bg-sky-300 text-gray-950 px-1">{i + 1}</span>
                <span className="text-gray-200 break-all">{n.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
