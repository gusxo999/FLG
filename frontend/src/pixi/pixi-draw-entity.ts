/**
 * pixi-draw-entity.ts
 *
 * 엔티티 상호작용 점(인서터 pickup/drop, 벨트 방향, 유체 연결, 채굴 드롭) 시각화.
 * pixi-draw-belt.ts / pixi-draw-pipe.ts / pixi-draw-utils.ts 를 조합해
 * 엔티티 한 개의 연결점을 모두 그리는 drawInteractionPoints 를 제공한다.
 */

import * as PIXI from 'pixi.js';
import { EntityType, type Direction } from '../types/layout';
import { getEntitySizeRotated } from '../utils/entitySize';
import { useGameDataStore } from '../store/gameDataStore';
import { isValidVec, rotateVector, directionToVec, drawSingleArrow, drawPoint } from './pixi-draw-utils';
import { COLOR_FLUID_IN, COLOR_FLUID_OUT, COLOR_FLUID_IO, drawConnectionArrow } from './pixi-draw-pipe';
import { BELT_TYPES, COLOR_BELT_FLOW, COLOR_PICKUP, COLOR_DROP, COLOR_MINING } from './pixi-draw-belt';

// ---------------------------------------------------------------------------
// 엔티티 상호작용 점 시각화 (인서터, 벨트, 유체)
// ---------------------------------------------------------------------------

export function drawInteractionPoints(
  target: PIXI.Graphics,
  gridX: number,
  gridY: number,
  entityType: EntityType,
  entityName: string,
  direction: Direction,
  scaledTile: number,
  offsetX: number,
  offsetY: number,
  alpha = 0.9,
) {
  const rotSize    = getEntitySizeRotated(entityType, entityName, direction);
  const centerTileX = gridX + rotSize.width  / 2;
  const centerTileY = gridY + rotSize.height / 2;

  const tileToPx = (tx: number, ty: number) => ({
    px: tx * scaledTile + offsetX,
    py: ty * scaledTile + offsetY,
  });

  const dirIdx = direction / 4; // positions[] 인덱스: 0=N, 1=E, 2=S, 3=W

  const entity   = useGameDataStore.getState().entityMap.get(entityName);
  const centerPx = centerTileX * scaledTile + offsetX;
  const centerPy = centerTileY * scaledTile + offsetY;

  // === 벨트 진행 방향 화살표 ===
  if (entity && BELT_TYPES.has(entity.type)) {
    const v       = directionToVec(direction);
    const halfLen = scaledTile * 0.35;
    drawSingleArrow(
      target,
      centerPx - v.x * halfLen, centerPy - v.y * halfLen,
      centerPx + v.x * halfLen, centerPy + v.y * halfLen,
      scaledTile, COLOR_BELT_FLOW, alpha, 0.12,
    );
  }

  // === 인서터 pickup / drop ===
  // Factorio 규약: direction = 픽업 방향.
  if (isValidVec(entity?.inserter_pickup_position)) {
    const rot       = rotateVector(entity!.inserter_pickup_position!, direction);
    const { px, py } = tileToPx(centerTileX + rot.x, centerTileY + rot.y);
    drawSingleArrow(target, centerPx, centerPy, px, py, scaledTile, COLOR_PICKUP, alpha);
  }
  if (isValidVec(entity?.inserter_drop_position)) {
    const rot       = rotateVector(entity!.inserter_drop_position!, direction);
    const { px, py } = tileToPx(centerTileX + rot.x, centerTileY + rot.y);
    drawSingleArrow(target, centerPx, centerPy, px, py, scaledTile, COLOR_DROP, alpha);
  }

  // === MiningDrill 드롭 위치 ===
  if (isValidVec(entity?.vector_to_place_result)) {
    const rot = rotateVector(entity!.vector_to_place_result!, direction);
    if (rot.x !== 0 || rot.y !== 0) {
      const { px, py } = tileToPx(centerTileX + rot.x, centerTileY + rot.y);
      drawPoint(target, px, py, scaledTile, COLOR_MINING, alpha);
    }
  }

  // === FluidBox 연결점 ===
  // 일반 파이프/heat-pipe 는 네트워크 실선으로 대체하므로 여기서 그리지 않음.
  const isPlainPipe =
    entity?.type === 'pipe'          ||
    entity?.type === 'heat-pipe'     ||
    entity?.type === 'infinity-pipe' ||
    entity?.type === 'pipe-to-ground';
  if (entity?.fluid_boxes && !isPlainPipe) {
    for (const fb of entity.fluid_boxes) {
      for (const conn of fb.connections) {
        const flow  = conn.flow_direction ?? fb.production_type;
        const mode: 'input' | 'output' | 'both' =
          flow === 'input'  ? 'input'  :
          flow === 'output' ? 'output' : 'both';
        const color =
          mode === 'input'  ? COLOR_FLUID_IN  :
          mode === 'output' ? COLOR_FLUID_OUT : COLOR_FLUID_IO;

        const pos = conn.positions[dirIdx] ?? conn.positions[0];
        if (!isValidVec(pos)) continue;
        const { px, py } = tileToPx(centerTileX + pos.x, centerTileY + pos.y);
        drawConnectionArrow(target, px, py, centerPx, centerPy, scaledTile, color, alpha, mode);
      }
    }
  }
}
