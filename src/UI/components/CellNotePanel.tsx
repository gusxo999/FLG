/**
 * 칸 설명 창 — 정보 모달 바로 아래(엔티티 칸) 또는 혼자(빈칸) 뜬다. 사람이 AI 의 설명을 읽고 고치고, 새로 쓴다.
 *
 * 열려 있는 동안 그 칸들을 캔버스가 흰색으로 짚는다(`cellNoteStore.focus`) — 창의 글과 칸이 이어져 보이게.
 */

import { useEffect, useState } from 'react';
import { useT } from '../i18n/index';
import { noteAt, useCellNoteStore } from '../store/cellNoteStore';

type Cell = { x: number; y: number };

export default function CellNotePanel({ cells, addAt }: { cells: Cell[]; addAt: Cell | null }) {
  const t = useT();
  const notes = useCellNoteStore((s) => s.notes);
  const write = useCellNoteStore((s) => s.write);
  const remove = useCellNoteStore((s) => s.remove);
  const [draft, setDraft] = useState('');

  // 이 창이 짚는 칸 — 캔버스가 흰색으로 그린다.
  const key = cells.map((c) => `${c.x},${c.y}`).join(' ');
  useEffect(() => {
    useCellNoteStore.getState().setFocus(cells);
    return () => useCellNoteStore.getState().setFocus([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const shown = cells
    .map((c) => noteAt(notes, c.x, c.y))
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .sort((a, b) => a.number - b.number);
  // 새 설명은 그 칸들에 설명이 하나도 없을 때만 — 머신의 다른 칸에 이미 있으면 그것을 고친다(한 머신에 둘이 생기지 않게).
  const canAdd = addAt !== null && shown.length === 0;
  const add = () => {
    if (!addAt || !draft.trim()) return;
    write(addAt.x, addAt.y, draft.trim());
    setDraft('');
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="bg-gray-900 border border-sky-700/70 rounded-xl shadow-2xl px-4 py-3 space-y-2"
    >
      <h3 className="text-sky-300 font-bold text-xs">{t('cellNote.title')}</h3>
      {shown.map(({ note, number }) => (
        <div key={`${note.x},${note.y}`} className="flex items-start gap-2">
          <span className="shrink-0 mt-1 min-w-5 text-center text-[11px] font-bold rounded bg-sky-300 text-gray-950 px-1">{number}</span>
          <div className="flex-1 space-y-0.5">
            <div className="text-[10px] text-gray-500">({note.x},{note.y})</div>
            <textarea
              value={note.text}
              onChange={(e) => write(note.x, note.y, e.target.value)}
              onBlur={(e) => { if (!e.target.value.trim()) remove(note.x, note.y); }}
              rows={Math.min(4, Math.max(1, Math.ceil(note.text.length / 40)))}
              className="w-full resize-y bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-sky-500"
            />
          </div>
          <button
            onClick={() => remove(note.x, note.y)}
            title={t('cellNote.remove')}
            className="shrink-0 mt-4 text-gray-500 hover:text-red-400 text-sm leading-none"
          >
            ✕
          </button>
        </div>
      ))}
      {canAdd && (
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder={t('cellNote.placeholder', { x: addAt.x, y: addAt.y })}
            className="flex-1 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-sky-500"
          />
          <button onClick={add} disabled={!draft.trim()} className="toolbar-btn text-xs disabled:opacity-40">
            {t('cellNote.add')}
          </button>
        </div>
      )}
      {shown.length === 0 && !canAdd && <div className="text-xs text-gray-500">{t('cellNote.empty')}</div>}
    </div>
  );
}

/** 빈칸의 설명 창 — 엔티티가 없는 칸을 눌렀을 때(그 칸에 설명이 있으면) · 목록에서 빈칸 설명을 눌렀을 때. */
export function CellNoteModal() {
  const cell = useCellNoteStore((s) => s.openCell);
  const close = () => useCellNoteStore.getState().open(null);
  useEffect(() => {
    if (!cell) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useCellNoteStore.getState().open(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cell]);
  if (!cell) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={close}>
      <div className="w-full max-w-md mx-4">
        <CellNotePanel cells={[cell]} addAt={cell} />
      </div>
    </div>
  );
}
