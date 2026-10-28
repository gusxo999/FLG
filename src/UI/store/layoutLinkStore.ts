/**
 * 링크로 연 배치의 상태 — 이 탭이 링크로 열렸나 · 못 연 까닭. 칸 설명은 `cellNoteStore` 가 든다.
 *
 * **저장하지 않는다.** 링크로 연 탭은 사용자가 기억시킨 배치를 덮지 않으려고 스토어 저장을 메모리로 돌린다
 * (`layoutLink/openInApp.ts`). 이 상태도 그 탭에서만 산다 — 링크를 다시 열면 링크에서 다시 읽는다.
 */

import { create } from 'zustand';

interface LayoutLinkState {
  /** 링크로 열었으면 그 배치의 제목. 아니면 null. */
  opened: { title?: string } | null;
  /** 링크를 못 열었으면 그 까닭. 사용자의 배치는 그대로다. */
  error: string | null;
}

export const useLayoutLinkStore = create<LayoutLinkState>()(() => ({
  opened: null,
  error: null,
}));
