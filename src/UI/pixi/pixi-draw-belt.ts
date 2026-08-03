/**
 * pixi-draw-belt.ts
 *
 * 벨트 / 인서터 / 채굴기 관련 상수 모음.
 * 실제 드로잉은 pixi-draw-entity.ts 의 drawInteractionPoints 에서
 * pixi-draw-utils.ts 의 drawSingleArrow / drawPoint 를 호출해 수행한다.
 */

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
