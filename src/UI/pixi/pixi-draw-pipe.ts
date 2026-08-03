/**
 * pixi-draw-pipe.ts
 *
 * 파이프 / 지하 파이프 / 유체 연결점 드로잉 유틸.
 * pixi-draw-utils.ts 의 원시 함수(drawArrowhead)만 의존하며,
 * 외부 상태(store, pixiObjects)를 읽지 않는 순수 드로잉 함수 모음.
 */

import * as PIXI from 'pixi.js';
import { EntityType, type Direction } from '../../types/layout';
import { drawArrowhead } from './pixi-draw-utils';

// ---------------------------------------------------------------------------
// 유체 연결점 색상
// ---------------------------------------------------------------------------
export const COLOR_FLUID_IN  = 0x40c8ff; // 유체 입력
export const COLOR_FLUID_OUT = 0xff8030; // 유체 출력
export const COLOR_FLUID_IO  = 0xcc80ff; // 유체 양방향

// ---------------------------------------------------------------------------
// 파이프 셀 드로잉
// ---------------------------------------------------------------------------

/**
 * 파이프(Pipe / PipeUnderground) 한 셀을 직사각형 형태로 그린다.
 * - 셀 중심에 정사각형 코어
 * - 인접 방향에 surface 연결이 있으면 그 방향으로 셀 가장자리까지 직사각형 팔을 뻗음
 * - PipeUnderground 는 direction 방향 가장자리에 어두운 입구 표식 추가
 */
export function drawPipeShape(
  target: PIXI.Graphics,
  gridX: number,
  gridY: number,
  entityType: EntityType,
  direction: Direction,
  color: number,
  scaledTile: number,
  offsetX: number,
  offsetY: number,
  cellConnections: Map<string, Set<Direction>>,
) {
  const px = gridX * scaledTile + offsetX;
  const py = gridY * scaledTile + offsetY;
  const cx = px + scaledTile / 2;
  const cy = py + scaledTile / 2;
  const armW    = Math.max(4, scaledTile * 0.5);
  const half    = armW / 2;
  const halfTile = scaledTile / 2;

  if (entityType === EntityType.PipeUnderground) {
    // ── PipeUnderground 디자인 ──
    // 1) 셀 정중앙에 "divider 직사각형"을 둔다.
    // 2) divider 의 지상 쪽(=direction)에 일반 파이프와 동일한 팔을 그린다.
    const isHoriz      = direction === 4 || direction === 12;
    const dividerLong  = Math.max(6, scaledTile * 0.9);
    const dividerThin  = Math.max(3, scaledTile * 0.18);

    switch (direction) {
      case 0:  target.rect(cx - half, py, armW, halfTile).fill({ color }); break; // N
      case 8:  target.rect(cx - half, cy, armW, halfTile).fill({ color }); break; // S
      case 12: target.rect(px, cy - half, halfTile, armW).fill({ color }); break; // W
      case 4:  target.rect(cx, cy - half, halfTile, armW).fill({ color }); break; // E
    }

    let dx0: number, dy0: number, dw: number, dh: number;
    if (isHoriz) {
      dw = dividerThin; dh = dividerLong;
      dx0 = cx - dw / 2; dy0 = cy - dh / 2;
    } else {
      dw = dividerLong; dh = dividerThin;
      dx0 = cx - dw / 2; dy0 = cy - dh / 2;
    }
    target.rect(dx0, dy0, dw, dh).fill({ color });
    target.rect(dx0, dy0, dw, dh).stroke({ width: 1.5, color: 0x000000, alpha: 0.55 });
  } else {
    // ── 일반 Pipe ── 코어 + 연결 팔
    target.rect(cx - half, cy - half, armW, armW).fill({ color });
    const conns = cellConnections.get(`${gridX},${gridY}`);
    if (conns) {
      if (conns.has(0))  target.rect(cx - half, py, armW, halfTile).fill({ color }); // N
      if (conns.has(8))  target.rect(cx - half, cy, armW, halfTile).fill({ color }); // S
      if (conns.has(12)) target.rect(px, cy - half, halfTile, armW).fill({ color }); // W
      if (conns.has(4))  target.rect(cx, cy - half, halfTile, armW).fill({ color }); // E
    }
  }
}

// ---------------------------------------------------------------------------
// 유체 연결 화살표
// ---------------------------------------------------------------------------

/**
 * 유체 연결점에 방향성 화살표를 그린다.
 * - input:  엔티티 중심을 가리킴
 * - output: 엔티티 바깥을 가리킴
 * - both:   양방향
 */
export function drawConnectionArrow(
  target: PIXI.Graphics,
  px: number, py: number,
  cx: number, cy: number,
  scaledTile: number,
  color: number,
  alpha: number,
  mode: 'input' | 'output' | 'both',
) {
  const dx  = px - cx;
  const dy  = py - cy;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return;
  const ux = dx / len;
  const uy = dy / len;

  const arrowLen = Math.max(10, scaledTile * 0.55);
  const half     = arrowLen / 2;
  const innerX   = px - ux * half;
  const innerY   = py - uy * half;
  const outerX   = px + ux * half;
  const outerY   = py + uy * half;

  target
    .moveTo(innerX, innerY)
    .lineTo(outerX, outerY)
    .stroke({ width: Math.max(1.5, scaledTile * 0.06), color, alpha });

  const headSize = Math.max(4, scaledTile * 0.22);
  if (mode === 'output' || mode === 'both') drawArrowhead(target, outerX, outerY,  ux,  uy, headSize, color, alpha);
  if (mode === 'input'  || mode === 'both') drawArrowhead(target, innerX, innerY, -ux, -uy, headSize, color, alpha);
}
