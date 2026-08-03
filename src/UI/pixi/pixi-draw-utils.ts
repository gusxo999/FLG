/**
 * pixi-draw-utils.ts
 *
 * 도메인 비종속적 순수 드로잉 원시 함수 모음.
 * 엔티티 종류 지식이 없으며, 전달받은 Graphics 에만 그린다.
 *
 * 파이프 → pixi-draw-pipe.ts
 * 벨트/인서터/채굴기 상수 → pixi-draw-belt.ts
 * 엔티티 상호작용 점 → pixi-draw-entity.ts
 */

import * as PIXI from 'pixi.js';
import { EntityType, type Direction } from '../../types/layout';

// ---------------------------------------------------------------------------
// 좌표 헬퍼
// ---------------------------------------------------------------------------

/**
 * 마우스가 가리키는 타일(hx, hy)이 size×size 엔티티의 중심에 오도록
 * 좌상단 origin 좌표를 계산. 짝수 폭일 땐 hx가 좌측 중앙에 위치.
 */
export function centerAnchorOrigin(
  hx: number,
  hy: number,
  size: { width: number; height: number },
) {
  return {
    x: hx - Math.floor((size.width  - 1) / 2),
    y: hy - Math.floor((size.height - 1) / 2),
  };
}


/**
 * (x,y) 가 auto-layout 외부 영역에 속하는지 판단.
 * 외부 영역 = canvasBbox 안에 있으면서 internalBbox(Blueprint) 밖인 셀 전체.
 */
export function isInExternalArea(
  x: number,
  y: number,
  canvasBbox: { x: number; y: number; w: number; h: number },
  internalBbox: { x: number; y: number; w: number; h: number },
): boolean {
  if (x < canvasBbox.x || x >= canvasBbox.x + canvasBbox.w) return false;
  if (y < canvasBbox.y || y >= canvasBbox.y + canvasBbox.h) return false;
  if (
    x >= internalBbox.x && x < internalBbox.x + internalBbox.w &&
    y >= internalBbox.y && y < internalBbox.y + internalBbox.h
  ) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 배치 가능성 판정
// ---------------------------------------------------------------------------

/** layoutStore.canOverwrite 와 동일 규칙. 모달 띄울지 판정용. */
export function isOverwriteAllowed(selected: EntityType, existing: EntityType): boolean {
  if (selected === EntityType.Belt && existing === EntityType.Belt) return true;
  const isPipeFamily = (t: EntityType) =>
    t === EntityType.Pipe || t === EntityType.PipeUnderground || t === EntityType.InfinityPipe;
  if (isPipeFamily(selected) && isPipeFamily(existing)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 수학 유틸
// ---------------------------------------------------------------------------

export function isValidVec(
  v: { x: number; y: number } | null | undefined,
): v is { x: number; y: number } {
  return !!v && typeof v.x === 'number' && typeof v.y === 'number';
}

/**
 * 엔티티 중심 기준 벡터를 direction으로 회전.
 * Factorio 2.0 direction: 0=N(회전 없음), 4=E(90°cw), 8=S(180°), 12=W(270°cw)
 */
export function rotateVector(
  v: { x: number; y: number },
  direction: Direction,
): { x: number; y: number } {
  switch (direction) {
    case 4:  return { x: -v.y, y:  v.x }; // E (90° cw)
    case 8:  return { x: -v.x, y: -v.y }; // S (180°)
    case 12: return { x:  v.y, y: -v.x }; // W (270° cw)
    default: return { x:  v.x, y:  v.y }; // N
  }
}

/** Direction → 단위 벡터. Factorio 2.0 0/4/8/12. */
export function directionToVec(direction: Direction): { x: number; y: number } {
  switch (direction) {
    case 4:  return { x:  1, y:  0 }; // E
    case 8:  return { x:  0, y:  1 }; // S
    case 12: return { x: -1, y:  0 }; // W
    default: return { x:  0, y: -1 }; // N (0)
  }
}

// ---------------------------------------------------------------------------
// 원시 그래픽 함수 (파이프/벨트/엔티티 파일에서 공용으로 사용)
// ---------------------------------------------------------------------------

export function drawArrowhead(
  target: PIXI.Graphics,
  tipX: number, tipY: number,
  dirX: number, dirY: number,
  size: number,
  color: number,
  alpha: number,
) {
  const perpX = -dirY;
  const perpY =  dirX;
  const baseX = tipX - dirX * size;
  const baseY = tipY - dirY * size;
  const halfWidth = size * 0.6;

  target
    .poly([
      tipX, tipY,
      baseX + perpX * halfWidth, baseY + perpY * halfWidth,
      baseX - perpX * halfWidth, baseY - perpY * halfWidth,
    ])
    .fill({ color, alpha })
    .stroke({ width: 1, color: 0x000000, alpha: alpha * 0.5 });
}

/**
 * 한 방향 화살표. (fromX,fromY) → (toX,toY), 화살촉이 끝점에 위치.
 * 인서터 pickup/drop, 벨트 진행 방향 등에 사용.
 */
export function drawSingleArrow(
  target: PIXI.Graphics,
  fromX: number, fromY: number,
  toX:   number, toY:   number,
  scaledTile: number,
  color: number,
  alpha: number,
  thickness = 0.08,
) {
  const dx  = toX - fromX;
  const dy  = toY - fromY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return;
  const ux = dx / len;
  const uy = dy / len;

  const headSize = Math.max(5, scaledTile * 0.26);
  // 몸체는 화살촉 base까지만 (화살촉과 겹치지 않도록)
  const bodyEndX = toX - ux * headSize * 0.7;
  const bodyEndY = toY - uy * headSize * 0.7;

  target
    .moveTo(fromX, fromY)
    .lineTo(bodyEndX, bodyEndY)
    .stroke({ width: Math.max(1.5, scaledTile * thickness), color, alpha });

  drawArrowhead(target, toX, toY, ux, uy, headSize, color, alpha);
}

export function drawPoint(
  target: PIXI.Graphics,
  px: number, py: number,
  scaledTile: number,
  color: number,
  alpha: number,
) {
  const radius = Math.max(3, scaledTile * 0.18);
  target
    .circle(px, py, radius)
    .fill({ color, alpha })
    .stroke({ width: 1.5, color: 0x000000, alpha: alpha * 0.67 });
}
