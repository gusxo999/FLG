import { describe, it, expect, beforeAll } from 'vitest';

/**
 * localStorage 영속화 회귀 테스트.
 *
 * 2026-07-25 에 **저장이 조용히 죽어 있는 것**을 발견했다. `compressedGridStorage` 는
 * 문자열 기반(zustand v3 모양) 어댑터인데 v5 의 `persist` 에 그대로 넘겨져 있었다.
 * v5 는 `PersistStorage`(객체를 주고받는 모양)를 기대하므로 `setItem` 이 객체를 받고,
 * `JSON.parse(객체)` 가 던진 예외를 어댑터의 빈 `catch` 가 삼켰다. 결과: 예외도 없고
 * 저장도 없다. 증상이 안 보이는 종류의 고장이라 테스트로 못 박는다.
 *
 * 여기서 검증하는 것:
 *  1. 저장이 실제로 일어난다 (키가 생긴다)
 *  2. sparse 압축이 걸린다 (빈 셀은 안 나간다) — 어댑터를 정말로 통과했다는 증거
 *  3. 읽을 때 빈 셀이 복원된다 (왕복)
 */

// vitest 환경이 node 라 localStorage 가 없다. 스토어 import 전에 심어야 한다.
const store = new Map<string, string>();
beforeAll(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
});

const KEY = 'factorio-layout-store';

describe('layoutStore persist', () => {
  it('셀을 놓으면 localStorage 에 sparse 로 저장된다', async () => {
    const { useLayoutStore } = await import('./layoutStore');
    const { EntityType } = await import('../../types/layout');

    // placeEntity 는 좌표만 받는다 — 무엇을 놓을지는 선택 상태에서 온다.
    useLayoutStore.getState().setSelectedEntity(EntityType.Belt, 'transport-belt');
    const ok = useLayoutStore.getState().placeEntity(3, 4);
    expect(ok, 'placeEntity 가 실패했다 (테스트 픽스처 문제)').toBe(true);

    const raw = store.get(KEY);
    expect(raw, 'persist 가 아무것도 쓰지 않았다').toBeTruthy();

    const parsed = JSON.parse(raw!);
    const cells = parsed.state.grid.cells;

    // 배열이 아니라 인덱스 키 객체여야 한다 = 압축 어댑터를 통과했다는 증거
    expect(Array.isArray(cells)).toBe(false);

    const { width } = parsed.state.grid;
    const idx = 4 * width + 3;
    expect(cells[String(idx)]).toBeTruthy();
    expect(cells[String(idx)].entityName).toBe('transport-belt');

    // 빈 셀은 안 나간다
    expect(Object.keys(cells).length).toBeLessThan(width * parsed.state.grid.height);
  });

  it('다시 읽으면 빈 셀이 복원되어 전체 길이 배열이 된다', async () => {
    const { useLayoutStore } = await import('./layoutStore');
    const opts = useLayoutStore.persist.getOptions();
    const revived = await opts.storage!.getItem(KEY);

    const grid = (revived as { state: { grid: { width: number; height: number; cells: unknown[] } } })
      .state.grid;
    expect(Array.isArray(grid.cells)).toBe(true);
    expect(grid.cells.length).toBe(grid.width * grid.height);
  });
});
