/**
 * flowView — 콘솔 표가 **판정을 그대로** 옮기나. 캔버스를 못 보는 쪽이 읽는 유일한 채널이라
 * 미달·판정 불가·까닭이 표에서 빠지면 그 판정은 없는 것과 같다.
 */

import { describe, expect, it } from 'vitest';
import { analyzeLayout } from '../analysis/flow/build';
import { EntityType, createEmptyGrid, getCell, type Direction, type LayoutGrid } from '../types/layout';
import type { Entity, Recipe } from '../types/gameData';
import type { InfinitySettings } from '../types/blueprint';
import { flowSummaryLine, renderAt, renderMachines } from './flowView';

const ctx = {
  entityMap: new Map<string, Entity>([
    ['belt', { name: 'belt', belt_speed: 15 / 480, tile_width: 1, tile_height: 1 } as Entity],
    ['asm', { name: 'asm', crafting_speed: 1, tile_width: 3, tile_height: 3 } as Entity],
  ]),
  recipeMap: new Map<string, Recipe>([
    ['gear', { name: 'gear', energy_required: 1, ingredients: [{ name: 'plate', amount: 2, type: 'item' }], products: [{ name: 'gear', amount: 1, type: 'item' }] } as Recipe],
  ]),
  moduleMap: new Map(),
  inserterOverrides: { arm: { throughput: 1 } },
};

function put(grid: LayoutGrid, x: number, y: number, patch: Record<string, unknown>) {
  Object.assign(getCell(grid, x, y)!, { entityId: `${x},${y}`, isOrigin: true, direction: 0, ...patch });
}

/** 판 1/s 공급(팔 1/s) → 벨트 → 팔 → gear 머신(판 2/s 필요) → 회수. 머신은 50%. */
function grid(): LayoutGrid {
  const g = createEmptyGrid(12, 10);
  put(g, 1, 1, { entityType: EntityType.InfinityChest, infinitySettings: { remove_unfiltered_items: false, filters: [{ name: 'plate', count: 1, mode: 'at-least', index: 1 }] } as InfinitySettings });
  put(g, 1, 2, { entityType: EntityType.Inserter, entityName: 'arm', direction: 0 as Direction });
  for (let x = 1; x <= 5; x++) put(g, x, 3, { entityType: EntityType.Belt, entityName: 'belt', direction: 4 as Direction });
  put(g, 4, 4, { entityType: EntityType.Inserter, entityName: 'arm', direction: 0 as Direction });
  for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) {
    Object.assign(getCell(g, 3 + dx, 5 + dy)!, {
      entityId: 'm', entityName: 'asm', entityType: EntityType.Assembler, direction: 0,
      tileOffset: { x: dx, y: dy }, isOrigin: dx === 0 && dy === 0, recipe: dx === 0 && dy === 0 ? 'gear' : undefined,
    });
  }
  put(g, 6, 6, { entityType: EntityType.Inserter, entityName: 'arm', direction: 12 as Direction });
  put(g, 7, 6, { entityType: EntityType.InfinityChest, infinitySettings: { remove_unfiltered_items: true, filters: [] } as InfinitySettings });
  return g;
}

describe('flowView', () => {
  const r = analyzeLayout(grid(), ctx);

  it('요약 줄이 미달 수를 낸다', () => {
    expect(flowSummaryLine(r)).toContain('**미달 1**');
  });

  it('머신 표에 ✗ · 백분율 · 까닭이 나온다', () => {
    const s = renderMachines(r);
    expect(s).toMatch(/✗ \(3,5\)\s+gear\s+50%/);
    expect(s).toContain('입력 plate 1.00/2.00 — 넣는 팔이 모자란다');
  });

  it('벨트 칸은 레인별 흐름과 팔을 낸다', () => {
    const s = renderAt(r, 4, 3);
    expect(s).toContain('오른 레인 1.00/7.50');
    expect(s).toContain('집기 팔 (4,4)');
  });

  it('머신 칸은 footprint 어디를 짚어도 같은 판정', () => {
    expect(renderAt(r, 5, 7)).toContain('머신 (3,5) asm · gear · 50%');
  });
});
