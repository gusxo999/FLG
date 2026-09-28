import { describe, it, expect, beforeAll } from 'vitest';

/**
 * 엔티티를 **옮겨도 내용물이 남는지** 지키는 회귀 테스트.
 *
 * 2026-09-28 에 가동률 검사로 "갇힌 상자"를 시험하려다 발견했다. `moveEntityById` 는 옮길 칸을
 * 새로 짓는데 origin 칸이 지고 있던 것 중 `recipe` 만 베껴 갔다 — 무한상자를 드래그하면
 * `infinitySettings`(무슨 품목을 얼마나 공급/회수하나)가 **조용히** 사라져서, 겉보기엔 상자가
 * 그대로인데 블루프린트로 내보내면 빈 상자가 나갔다. 예외도 경고도 없는 종류의 고장이라
 * 테스트로 못 박는다.
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

describe('moveEntityById — 옮긴 칸이 내용물을 지고 간다', () => {
  it('무한상자를 옮겨도 infinitySettings 가 남는다', async () => {
    const { useLayoutStore } = await import('./layoutStore');
    const { EntityType, createEmptyCell } = await import('../../types/layout');

    const settings = {
      remove_unfiltered_items: true,
      filters: [{ index: 1, name: 'iron-plate', count: 100, mode: 'at-least' as const }],
    };
    useLayoutStore.getState().applyPlacedCells([
      {
        x: 2,
        y: 2,
        cell: {
          ...createEmptyCell(),
          entityId: 'chest-1',
          entityName: 'infinity-chest',
          entityType: EntityType.InfinityChest,
          isOrigin: true,
          infinitySettings: settings,
        },
      },
    ]);

    const moved = useLayoutStore.getState().moveEntityById('chest-1', 7, 9);
    expect(moved).toBe(true);

    const grid = useLayoutStore.getState().grid;
    const at = (x: number, y: number) => grid.cells[y * grid.width + x];
    expect(at(2, 2).entityId).toBeNull();
    expect(at(7, 9).entityName).toBe('infinity-chest');
    expect(at(7, 9).infinitySettings).toEqual(settings);
  });

  it('여러 칸 머신은 레시피가 모든 칸에, 모듈·품질은 origin 에 남는다', async () => {
    const { useLayoutStore } = await import('./layoutStore');
    const { EntityType, createEmptyCell } = await import('../../types/layout');

    const modules = [{ name: 'productivity-module', count: 2 }];
    const placed = [];
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const isOrigin = dx === 0 && dy === 0;
        placed.push({
          x: 20 + dx,
          y: 20 + dy,
          cell: {
            ...createEmptyCell(),
            entityId: 'asm-1',
            entityName: 'assembling-machine-2',
            entityType: EntityType.Assembler,
            tileOffset: { x: dx, y: dy },
            isOrigin,
            recipe: 'iron-gear-wheel',
            ...(isOrigin ? { modules, quality: 'rare' } : {}),
          },
        });
      }
    }
    useLayoutStore.getState().applyPlacedCells(placed);

    expect(useLayoutStore.getState().moveEntityById('asm-1', 30, 30)).toBe(true);

    const grid = useLayoutStore.getState().grid;
    const at = (x: number, y: number) => grid.cells[y * grid.width + x];
    // 레시피는 `setCellRecipe` 관례대로 모든 칸에.
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        expect(at(30 + dx, 30 + dy).recipe).toBe('iron-gear-wheel');
      }
    }
    // origin 만 지는 것은 origin 에만 — 안 옮기면 블루프린트 export 에서 사라진다.
    expect(at(30, 30).modules).toEqual(modules);
    expect(at(30, 30).quality).toBe('rare');
    expect(at(31, 30).modules).toBeUndefined();
  });
});
