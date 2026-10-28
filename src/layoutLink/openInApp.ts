/**
 * 브라우저 쪽 — 주소의 배치 링크를 열고, 지금 배치를 링크로 복사한다.
 *
 * ## 링크로 연 탭은 아무것도 저장하지 않는다
 *
 * 앱은 배치를 하나만 기억한다(`layoutStore` → localStorage). 링크로 연 배치가 그 자리를 덮으면 사용자가 만들어 둔
 * 배치가 사라진다. 그래서 링크로 열면 **스토어 넷의 저장을 메모리로 돌린 뒤에** 링크의 배치를 넣는다 —
 * 그리드 · 게임데이터 · 위저드(인서터 보정) · 커스텀 · 칸 설명. 탭을 닫거나 주소에서 `#` 뒤를 지우고 다시 열면 원래 배치다.
 *
 * 배치를 여러 개 기억하는 앱이 정해진 방향이다(2026-10-18 사용자) — 그때는 링크로 연 배치가 새 배치 하나로 들어오고
 * 이 저장 돌리기는 없어진다. 지금은 *AI 와 형태를 토론할 수 있는 만큼만*(같은 날) 만든 것이다.
 *
 * ## 게임데이터는 링크에 실린 것만
 *
 * 링크가 그 배치의 프로토타입을 싣는다 — 브라우저에 무슨 게임데이터가 있든 같은 화면 · 같은 가동률이 나온다.
 * 사용자의 커스텀도 섞지 않는다(메모리에서만 비운다).
 */

import { createJSONStorage } from 'zustand/middleware';
import { EMPTY_CUSTOM_DATA } from '../factorio/customRecipe';
import { useCellNoteStore } from '../UI/store/cellNoteStore';
import { useCustomDataStore } from '../UI/store/customDataStore';
import { useGameDataStore } from '../UI/store/gameDataStore';
import { useLayoutLinkStore } from '../UI/store/layoutLinkStore';
import { useLayoutStore } from '../UI/store/layoutStore';
import { useWizardStore } from '../UI/store/wizardStore';
import { createEmptyCell } from '../types/layout';
import {
  decodeLayoutLink, gameDataOf, gridFromPayload, LAYOUT_LINK_KEY, layoutLinkUrl, payloadFromGrid,
} from './codec';

/** 링크를 연 탭의 주소 끝 표시(`#layout=…&opened`). */
const OPENED_MARK = 'opened';

/** 저장을 받기만 하고 버리는 저장소 — 이 탭이 사는 동안만 기억한다. */
function memoryStorage<S>() {
  const mem = new Map<string, string>();
  return createJSONStorage<S>(() => ({
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  }));
}

/**
 * 주소에 `#layout=…` 이 있으면 그 배치를 연다. **화면을 그리기 전에** 부른다(`main.tsx`).
 * 못 열면 사용자의 배치를 건드리지 않고 까닭을 남긴다(화면 위 띠가 보인다).
 */
export function openLayoutLinkFromLocation(): void {
  // 이미 열린 탭의 주소창에 링크를 붙여 넣으면 `#` 뒤만 바뀌어 페이지가 다시 안 뜬다 — 그때는 새로 띄워 이 길을 다시 탄다.
  window.addEventListener('hashchange', () => {
    if (window.location.hash.includes(`${LAYOUT_LINK_KEY}=`)) window.location.reload();
  });
  if (!window.location.hash.includes(`${LAYOUT_LINK_KEY}=`)) return;

  let payload;
  let grid;
  try {
    payload = decodeLayoutLink(window.location.hash);
    grid = gridFromPayload(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[layoutLink] 링크를 못 열었다 — ${message}`);
    useLayoutLinkStore.setState({ error: message });
    return;
  }

  // ① 저장을 끊는다 — 이 아래의 모든 set 은 메모리에만 남는다.
  useLayoutStore.persist.setOptions({ storage: memoryStorage() });
  useGameDataStore.persist.setOptions({ storage: memoryStorage() });
  useWizardStore.persist.setOptions({ storage: memoryStorage() });
  useCustomDataStore.persist.setOptions({ storage: memoryStorage() });
  useCellNoteStore.persist.setOptions({ storage: memoryStorage() });

  // ② 커스텀을 비운다 — 부팅 때 예약된 합류(`syncCustomData`)가 사용자의 커스텀을 링크의 게임데이터에 섞지 않게.
  useCustomDataStore.setState({ data: EMPTY_CUSTOM_DATA });
  // ③ 게임데이터 = 링크에 실린 프로토타입만.
  useGameDataStore.getState().setGameData(gameDataOf(payload));
  // ④ 측정 조건 — 가동률은 위저드의 인서터 보정을 읽는다(`flowStore.currentFlow`).
  useWizardStore.getState().setInserterOverrides(payload.inserterOverrides ?? {});
  // ⑤ 그리드 — 사용자가 이어서 손볼 수 있게 지금 그리드보다 작게 줄이지 않는다.
  const layout = useLayoutStore.getState();
  const w = Math.max(grid.width, layout.grid.width);
  const h = Math.max(grid.height, layout.grid.height);
  const cells = Array.from({ length: w * h }, (_, i) => {
    const x = i % w;
    const y = Math.floor(i / w);
    return x < grid.width && y < grid.height ? grid.cells[y * grid.width + x] : createEmptyCell();
  });
  layout.fillGridFromCells(cells, w, h);
  layout.setExternalAreaBbox(payload.interiorBbox ?? null);
  layout.setAutoLayoutCanvasBbox(null);
  layout.resetViewport();

  // ⑥ 칸 설명 — 링크의 글이 이 탭의 설명이 된다(사람이 정보 모달 아래에서 고친다).
  useCellNoteStore.getState().setAll(payload.labels ?? []);
  useLayoutLinkStore.setState({ opened: { title: payload.title } });

  // ⑦ 주소 끝에 표시를 붙인다 — 그래야 같은 탭에 **처음 링크를 다시 붙여 넣으면** 주소가 달라져 다시 뜬다.
  //    표시가 없으면 브라우저는 같은 주소로 보고 아무것도 안 해서, 손본 배치가 그대로 남는다(2026-10-19 사용자 시험).
  //    새로 고침(F5)은 표시가 있어도 `layout=` 을 찾으므로 링크를 다시 연다.
  if (!new RegExp(`[#&]${OPENED_MARK}(&|$)`).test(window.location.hash)) {
    window.history.replaceState(null, '', `${window.location.href}&${OPENED_MARK}`);
  }
}

/**
 * 지금 그리드를 배치 링크로. 쓰인 이름이 게임데이터에 없으면 `missing` 에 담는다 — 링크는 만들되 그 칸은 못 잰다.
 * 칸 설명을 함께 싣는다. 링크로 연 탭이면 그 링크의 제목도.
 */
export function currentLayoutLink(): { url: string; chars: number; cells: number; missing: string[] } {
  const { grid, externalAreaBbox } = useLayoutStore.getState();
  const { entityMap, recipeMap, moduleMap } = useGameDataStore.getState();
  const { inserterOverrides } = useWizardStore.getState();
  const opened = useLayoutLinkStore.getState().opened;
  const { payload, missing } = payloadFromGrid(grid, { entityMap, recipeMap, moduleMap }, {
    title: opened?.title,
    labels: useCellNoteStore.getState().notes,
    inserterOverrides,
    interiorBbox: externalAreaBbox,
  });
  const base = `${window.location.origin}${window.location.pathname}`;
  const url = layoutLinkUrl(base, payload);
  return { url, chars: url.length, cells: payload.cells.length, missing };
}

/** 링크로 연 탭에서 나간다 — 주소의 `#` 뒤를 지우고 다시 연다. 스토어는 원래 저장소에서 다시 읽힌다. */
export function leaveLayoutLink(): void {
  window.location.replace(`${window.location.origin}${window.location.pathname}${window.location.search}`);
}
