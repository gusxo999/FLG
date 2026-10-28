/**
 * 벨트 망 — 물건이 서로 넘어가는 벨트류 칸은 한 망(화면에서 한 색), 아니면 다른 망.
 */

import { describe, expect, it } from 'vitest';
import { computeBeltNetworks } from './beltNetwork';
import { EntityType, createEmptyGrid, getCell, type Direction, type LayoutGrid } from '../types/layout';
import type { Entity } from '../UI/store/gameDataStore';

let nextId = 0;
function put(grid: LayoutGrid, x: number, y: number, patch: Record<string, unknown>) {
  Object.assign(getCell(grid, x, y)!, { entityId: `t${nextId++}`, isOrigin: true, direction: 0, ...patch });
}
const belt = (g: LayoutGrid, x: number, y: number, dir: Direction) =>
  put(g, x, y, { entityType: EntityType.Belt, entityName: 'transport-belt', direction: dir });
const ug = (g: LayoutGrid, x: number, y: number, dir: Direction, undergroundType: 'input' | 'output') =>
  put(g, x, y, { entityType: EntityType.UndergroundBelt, entityName: 'underground-belt', direction: dir, undergroundType });

const entityMap = new Map<string, Entity>([
  ['underground-belt', { name: 'underground-belt', max_underground_distance: 5 } as Entity],
]);

function nets(g: LayoutGrid) {
  const r = computeBeltNetworks(g, entityMap);
  const net = (x: number, y: number) => r.networkOf.get(y * g.width + x);
  const color = (x: number, y: number) => r.colorOf.get(net(x, y)!);
  return { net, color };
}

describe('벨트 망', () => {
  it('옆에서 붙는 벨트(레인 합류)는 한 망이다', () => {
    const g = createEmptyGrid(6, 4);
    for (let x = 0; x < 5; x++) belt(g, x, 2, 4); // 동쪽 줄
    belt(g, 2, 0, 8);
    belt(g, 2, 1, 8); // 위에서 (2,2) 옆으로 붙는다
    const { net, color } = nets(g);
    expect(net(2, 0)).toBe(net(0, 2));
    expect(net(4, 2)).toBe(net(0, 2));
    expect(color(2, 0)).toBe(color(4, 2));
  });

  it('지하 짝은 앞뒤 벨트와 한 망이다 — 사거리 밖의 출구는 아니다', () => {
    const g = createEmptyGrid(12, 3);
    belt(g, 0, 0, 4); ug(g, 1, 0, 4, 'input'); ug(g, 4, 0, 4, 'output'); belt(g, 5, 0, 4);
    belt(g, 0, 2, 4); ug(g, 1, 2, 4, 'input'); ug(g, 8, 2, 4, 'output'); // 7칸 — 사거리 5 밖
    const { net } = nets(g);
    expect(net(5, 0)).toBe(net(0, 0));
    expect(net(8, 2)).not.toBe(net(1, 2));
  });

  it('정면으로 마주 본 벨트는 다른 망이다', () => {
    const g = createEmptyGrid(4, 1);
    belt(g, 0, 0, 4); belt(g, 1, 0, 4); belt(g, 2, 0, 12); belt(g, 3, 0, 12);
    const { net } = nets(g);
    expect(net(1, 0)).not.toBe(net(2, 0));
  });

  it('인서터가 옮기는 두 줄은 다른 망이다', () => {
    const g = createEmptyGrid(4, 3);
    for (let x = 0; x < 4; x++) belt(g, x, 0, 4);
    put(g, 1, 1, { entityType: EntityType.Inserter, entityName: 'inserter', direction: 0 });
    for (let x = 0; x < 4; x++) belt(g, x, 2, 4);
    const { net } = nets(g);
    expect(net(0, 0)).not.toBe(net(0, 2));
  });

  it('붙어 있는 다른 망은 다른 색이다', () => {
    const g = createEmptyGrid(4, 3);
    for (let x = 0; x < 4; x++) belt(g, x, 0, 4);  // 동쪽
    for (let x = 0; x < 4; x++) belt(g, x, 1, 12); // 서쪽 — 위아래와 나란히 붙지만 넘어가지 않는다
    for (let x = 0; x < 4; x++) belt(g, x, 2, 4);  // 동쪽
    const { net, color } = nets(g);
    expect(new Set([net(0, 0), net(0, 1), net(0, 2)]).size).toBe(3);
    expect(color(0, 1)).not.toBe(color(0, 0));
    expect(color(0, 1)).not.toBe(color(0, 2));
  });

  it('분배기의 두 칸은 한 망이다', () => {
    const g = createEmptyGrid(3, 3);
    belt(g, 0, 0, 8); belt(g, 1, 0, 8);
    put(g, 0, 1, { entityType: EntityType.Splitter, entityName: 'splitter', direction: 8, entityId: 'sp' });
    Object.assign(getCell(g, 1, 1)!, { entityType: EntityType.Splitter, entityName: 'splitter', direction: 8, entityId: 'sp', isOrigin: false, tileOffset: { x: 1, y: 0 } });
    belt(g, 0, 2, 8); belt(g, 1, 2, 8);
    const { net } = nets(g);
    expect(net(0, 0)).toBe(net(1, 2));
  });
});
