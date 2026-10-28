/**
 * pixi-draw-belt.ts
 *
 * 벨트 / 인서터 / 채굴기 관련 상수 모음 + 지하벨트 덮개 드로잉.
 * 화살표 드로잉은 pixi-draw-entity.ts 의 drawInteractionPoints 에서
 * pixi-draw-utils.ts 의 drawSingleArrow / drawPoint 를 호출해 수행한다.
 */

import * as PIXI from 'pixi.js';
import type { Direction } from '../../types/layout';

// ---------------------------------------------------------------------------
// 벨트 계열 entity type 문자열 집합
// ---------------------------------------------------------------------------
export const BELT_TYPES = new Set([
  'transport-belt',
  'underground-belt',
  'splitter',
  'loader',
  'loader-1x1',
]);

// ---------------------------------------------------------------------------
// 벨트 / 인서터 / 채굴기 시각화 색상
// ---------------------------------------------------------------------------
export const COLOR_BELT_FLOW = 0xf5f5ff; // 벨트 진행 방향
export const COLOR_PICKUP    = 0x40aaff; // 인서터 집기
export const COLOR_DROP      = 0xffaa20; // 인서터 놓기
export const COLOR_MINING    = 0xffcc20; // 채굴 드롭

// ---------------------------------------------------------------------------
// 지하벨트 덮개
// ---------------------------------------------------------------------------

/**
 * 지하벨트 한 칸의 **덮개 쪽 반**을 어둡게 칠하고, 덮개 쪽 칸 끝에 굵은 선을 긋는다 — 게임 모양 그대로.
 *
 * - 입구: 앞쪽 반(땅속으로 들어가는 쪽)이 덮개, 뒤쪽 반에 벨트가 드러난다.
 * - 출구: 뒤쪽 반(땅속에서 나오는 쪽)이 덮개, 앞쪽 반에 벨트가 드러난다.
 *
 * direction 은 입구 · 출구 모두 물건이 가는 방향이다. 옆에서 붙인 벨트는 드러난 반에 닿는
 * 레인만 들어간다(docs/factorio/belt-lane-semantics.md — 2026-10-08 · 10-15 확인).
 * 칸 몸통(px+1, py+1, scaledTile-2)과 같은 안쪽 사각형에 그린다.
 */
export function drawUndergroundBeltCover(
  target: PIXI.Graphics,
  gridX: number,
  gridY: number,
  direction: Direction,
  undergroundType: 'input' | 'output',
  scaledTile: number,
  offsetX: number,
  offsetY: number,
) {
  const px   = gridX * scaledTile + offsetX + 1;
  const py   = gridY * scaledTile + offsetY + 1;
  const s    = scaledTile - 2;
  const h    = s / 2;
  const edge = Math.max(2, scaledTile * 0.14);
  // 덮개가 놓이는 쪽 — 입구는 진행 방향, 출구는 그 반대.
  const side = undergroundType === 'input' ? direction : (((direction + 8) % 16) as Direction);

  switch (side) {
    case 0: // N
      target.rect(px, py, s, h).fill({ color: 0x000000, alpha: 0.5 });
      target.rect(px, py, s, edge).fill({ color: 0xffffff, alpha: 0.85 });
      break;
    case 4: // E
      target.rect(px + h, py, h, s).fill({ color: 0x000000, alpha: 0.5 });
      target.rect(px + s - edge, py, edge, s).fill({ color: 0xffffff, alpha: 0.85 });
      break;
    case 8: // S
      target.rect(px, py + h, s, h).fill({ color: 0x000000, alpha: 0.5 });
      target.rect(px, py + s - edge, s, edge).fill({ color: 0xffffff, alpha: 0.85 });
      break;
    default: // W
      target.rect(px, py, h, s).fill({ color: 0x000000, alpha: 0.5 });
      target.rect(px, py, edge, s).fill({ color: 0xffffff, alpha: 0.85 });
      break;
  }
}
