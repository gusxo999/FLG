import { useGameDataStore } from '../store/gameDataStore';
import {
  ENTITY_SIZES,
  type Direction,
  type EntityType,
  type EntitySize,
} from '../types/layout';

/**
 * 엔티티의 실제 타일 크기 조회 (회전 미반영).
 * 로드된 게임 데이터에 있으면 tile_width/tile_height 사용,
 * 없으면 정적 ENTITY_SIZES fallback, 그것도 없으면 1x1.
 */
export function getEntitySize(
  entityType: EntityType,
  entityName: string | null | undefined
): EntitySize {
  if (entityName) {
    const entity = useGameDataStore.getState().entityMap.get(entityName);
    if (entity) {
      return { width: entity.tile_width, height: entity.tile_height };
    }
  }
  return ENTITY_SIZES[entityType] ?? { width: 1, height: 1 };
}

/**
 * 엔티티 크기를 direction 기준으로 회전하여 반환.
 * Factorio 2.0 direction: 0=N, 4=E, 8=S, 12=W.
 * E/W (4/12)는 90° 회전이므로 width/height를 swap한다.
 */
export function getEntitySizeRotated(
  entityType: EntityType,
  entityName: string | null | undefined,
  direction: Direction
): EntitySize {
  const base = getEntitySize(entityType, entityName);
  if (direction === 4 || direction === 12) {
    return { width: base.height, height: base.width };
  }
  return base;
}
