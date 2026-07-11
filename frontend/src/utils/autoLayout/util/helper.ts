/**
 * helper — 격자 위에서 셈만 하는 함수 모음.
 *
 * 여기 있는 함수는 **아무것도 놓지 않는다.** 칸의 좌표를 받아 다른 숫자나 칸 목록을
 * 돌려줄 뿐이다. 그래서 배치 정책도, 길찾기도, 게임 데이터도 모른다.
 *
 * 새 함수를 여기 넣기 전 확인: 이 함수가 "어디에 무엇을 놓을지" 를 고르는가?
 * 고른다면 여기가 아니다.
 */

import type { Direction } from "../../../types/layout";
import type { PortFace } from "../containerModel";

/** 칸 하나를 집합·사전의 열쇠로 쓰기 위한 문자열. */
export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** "동쪽 변" 같은 말을 "오른쪽으로 한 칸" 이라는 화살표로. */
export function faceVector(face: PortFace): { x: number; y: number } {
  switch (face) {
    case 'N': return { x: 0, y: -1 };
    case 'S': return { x: 0, y: 1 };
    case 'E': return { x: 1, y: 0 };
    case 'W': return { x: -1, y: 0 };
  }
}

/** 한 칸 화살표를 팩토리오가 아는 방향 값으로. */
export function vectorToDirection(dx: number, dy: number): Direction {
  if (dx === 0 && dy < 0) return 0;
  if (dx > 0 && dy === 0) return 4;
  if (dx === 0 && dy > 0) return 8;
  if (dx < 0 && dy === 0) return 12;
  // diagonal/zero — fallback to N (방어, 정상 흐름에서는 발생하지 않음)
  return 0;
}

/** 두 축정렬 점 사이를 단위 셀로 확장(start 제외, end 포함). */
export function segment(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x;
  let y = from.y;
  while (x !== to.x || y !== to.y) {
    x += dx;
    y += dy;
    out.push({ x, y });
  }
  return out;
}

/** enumeratePerimeterCells 가 훑는 바깥 반경의 상한. */
export const MAX_EXTERNAL_SEARCH_RADIUS = 12;

/**
 * bbox 바깥 minRadius~maxRadius 칸 전체 외부 영역의 셀 좌표 목록.
 * 각 반경(ring)을 시계 방향 N → E → S → W 로 열거한다.
 * wrapExternalsAroundPerimeter 가 머신 기준 manhattan 거리로 재정렬하므로
 * 가까운 ring 부터 열거해 정렬 비용을 줄인다.
 *
 * minRadius 기본값 = 2 — chest 와 머신 사이 1 셀 gap 확보. 그 gap 셀에
 * 단일 인서터를 두면 chest ↔ machine 직결이 가능하다 (routeItem 의 단일
 * 인서터 모드). r=1 에 chest 를 두면 인서터 자리가 없어 라우팅이 chest
 * 위쪽으로 우회하고 internalBbox 가 chest 까지 확장되는 시각 버그가 생긴다.
 */
export function enumeratePerimeterCells(
  bbox: { x: number; y: number; w: number; h: number },
  maxRadius = MAX_EXTERNAL_SEARCH_RADIUS,
  minRadius = 2,
): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (let r = minRadius; r <= maxRadius; r++) {
    const x0 = bbox.x - r;
    const y0 = bbox.y - r;
    const x1 = bbox.x + bbox.w - 1 + r;
    const y1 = bbox.y + bbox.h - 1 + r;
    for (let x = x0; x <= x1; x++) cells.push({ x, y: y0 });           // N
    for (let y = y0 + 1; y <= y1; y++) cells.push({ x: x1, y });       // E
    for (let x = x1 - 1; x >= x0; x--) cells.push({ x, y: y1 });      // S
    for (let y = y1 - 1; y >= y0 + 1; y--) cells.push({ x: x0, y });  // W
  }
  return cells;
}
