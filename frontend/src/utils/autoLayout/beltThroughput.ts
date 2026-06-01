import type { Entity } from '../../store/gameDataStore';

/**
 * 벨트 처리량 모델 — items/sec.
 *
 * 게임 데이터의 `belt_speed` 는 tiles/tick 단위다. 벨트 한 줄(2 레인)이 나르는
 * 초당 아이템 수는:
 *
 *   itemsPerSec = belt_speed × 480
 *   (= belt_speed × 2 레인 × 4 아이템/타일 × 60 틱/초)
 *
 * vanilla anchor: transport 0.03125→15, fast 0.0625→30, express 0.09375→45.
 *
 * `override` (items/sec) 가 양수면 그 값을 그대로 쓴다(사용자 보정용). entity 나
 * belt_speed 가 없으면 0 (= 처리 불가).
 */
const ITEMS_PER_SEC_PER_BELT_SPEED = 480;

export function beltThroughput(entity: Entity | undefined, override?: number): number {
  if (override !== undefined && override > 0) return override;
  if (!entity || !entity.belt_speed || entity.belt_speed <= 0) return 0;
  return entity.belt_speed * ITEMS_PER_SEC_PER_BELT_SPEED;
}
