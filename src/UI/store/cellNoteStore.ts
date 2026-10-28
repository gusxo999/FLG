/**
 * 칸 설명 — 칸 하나에 붙인 글. AI 가 링크에 실어 보내고(`labels`), 사람이 정보 모달 아래에서 고친다.
 *
 * **번호는 목록의 순서다.** 쓴 사람이 설명하는 차례가 곧 번호라 1 · 2 · 3 으로 읽힌다. 캔버스는 칸 안에 번호를 늘
 * 찍고 글은 자리가 날 때만 쓴다 — 글이 안 보이는 칸도 번호로 목록(`CellNoteList`)과 이어진다(`pixi-renderer`).
 *
 * **좌표에 붙는다**(엔티티가 아니라). 엔티티를 옮기거나 지워도 설명은 그 칸에 남는다 — 빈칸에도 쓸 수 있어야
 * 하기 때문이다(*"여기에 인서터"*).
 *
 * 평소에는 저장한다(`factorio-cell-notes`). 링크로 연 탭은 다른 스토어처럼 메모리에만 둔다(`layoutLink/openInApp`).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LayoutLinkLabel } from '../../layoutLink/codec';
import type { GridCell, LayoutGrid } from '../../types/layout';

type Cell = { x: number; y: number };

export type CellNote = LayoutLinkLabel;

interface CellNoteState {
  notes: CellNote[];
  /** 지금 짚고 있는 칸들 — 정보 모달 · 설명 창이 열린 칸. 캔버스가 굵게 그리고 그 글을 먼저 앉힌다. */
  focus: Array<{ x: number; y: number }>;
  /** 빈칸 설명 창 — 엔티티가 없는 칸의 설명을 열 때(엔티티가 있으면 정보 모달 아래에 뜬다). */
  openCell: { x: number; y: number } | null;

  setAll: (notes: CellNote[]) => void;
  /** 그 칸의 설명을 쓴다 — 없으면 끝에 더한다(번호가 하나 는다). */
  write: (x: number, y: number, text: string) => void;
  remove: (x: number, y: number) => void;
  setFocus: (cells: Array<{ x: number; y: number }>) => void;
  open: (cell: { x: number; y: number } | null) => void;
}

export const useCellNoteStore = create<CellNoteState>()(
  persist(
    (set) => ({
      notes: [],
      focus: [],
      openCell: null,
      setAll: (notes) => set({ notes }),
      write: (x, y, text) =>
        set((s) => {
          const i = s.notes.findIndex((n) => n.x === x && n.y === y);
          if (i < 0) return { notes: [...s.notes, { x, y, text }] };
          const notes = [...s.notes];
          notes[i] = { x, y, text };
          return { notes };
        }),
      remove: (x, y) => set((s) => ({ notes: s.notes.filter((n) => n.x !== x || n.y !== y) })),
      setFocus: (focus) => set({ focus }),
      open: (openCell) => set({ openCell }),
    }),
    { name: 'factorio-cell-notes', partialize: (s) => ({ notes: s.notes }) },
  ),
);

/** 그 칸의 설명과 번호(1 부터). 없으면 null. */
export function noteAt(notes: readonly CellNote[], x: number, y: number): { note: CellNote; number: number } | null {
  const i = notes.findIndex((n) => n.x === x && n.y === y);
  return i < 0 ? null : { note: notes[i], number: i + 1 };
}

/**
 * 정보 모달이 연 엔티티의 설명 칸들. 누른 칸이 있으면 그 칸, 그리고 여러 칸짜리 엔티티(머신)면 그 몸통 전부 —
 * AI 가 머신의 어느 칸에 설명을 달았든 보인다. 한 라우팅의 벨트처럼 1칸짜리가 같은 id 를 나눠 쓰는 경우는 누른 칸만.
 * 새 설명은 누른 칸에, 모르면 엔티티의 위 왼쪽 칸에 쓴다.
 */
export function noteTargetOf(grid: LayoutGrid, entityId: string | null, clicked: Cell | null): { cells: Cell[]; addAt: Cell | null } {
  const mine: Array<Cell & { c: GridCell }> = [];
  if (entityId) {
    for (let i = 0; i < grid.cells.length; i++) {
      const c = grid.cells[i];
      if (c.entityId === entityId) mine.push({ x: i % grid.width, y: Math.floor(i / grid.width), c });
    }
  }
  const multiTile = mine.some((m) => m.c.tileOffset.x !== 0 || m.c.tileOffset.y !== 0);
  const cells: Cell[] = multiTile ? mine.map(({ x, y }) => ({ x, y })) : clicked ? [clicked] : mine.slice(0, 1);
  if (clicked && !cells.some((c) => c.x === clicked.x && c.y === clicked.y)) cells.push(clicked);
  const origin = mine.find((m) => m.c.isOrigin);
  return { cells, addAt: clicked ?? (origin ? { x: origin.x, y: origin.y } : cells[0] ?? null) };
}
