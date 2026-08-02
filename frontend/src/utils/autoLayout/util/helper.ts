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
import type { Area, PortFace } from "../containerModel";

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

/** bbox 를 (x, y, w, h) 사각형 하나만큼 넓힌 결과. 기존 bbox 가 없으면 그 사각형 자체. */
export function expandBbox(
  bbox: Area['bbox'],
  x: number,
  y: number,
  w: number,
  h: number,
): NonNullable<Area['bbox']> {
  if (!bbox) return { x, y, w, h };
  const minX = Math.min(bbox.x, x);
  const minY = Math.min(bbox.y, y);
  const maxX = Math.max(bbox.x + bbox.w, x + w);
  const maxY = Math.max(bbox.y + bbox.h, y + h);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}


/**
 * 한 면(face)의 depth `d` 칸 — 머신 면에서 바깥으로 d 칸, 그 면을 따라 `t` 위치.
 * `d=0` 은 머신 자신의 가장자리, `d=1` 은 인서터 좌석, `d≥2` 는 belt 레인.
 * W/E 면이면 `t` 는 y(행), N/S 면이면 `t` 는 x(열)다.
 *
 * 여기 있는 이유: **계획(면 배정)과 실행(방출) 양쪽이 쓴다.** 어느 한쪽 계층에 두면
 * 반대쪽이 그 계층을 import 하게 된다. `faceVector` 와 같은 성격(면 → 좌표)의 순수 셈이다.
 */
export function faceCell(
  ext: { x0: number; y0: number; x1: number; y1: number },
  face: PortFace,
  d: number,
  t: number,
): { x: number; y: number } {
  switch (face) {
    case "W": return { x: ext.x0 - d, y: t };
    case "E": return { x: ext.x1 + d, y: t };
    case "N": return { x: t, y: ext.y0 - d };
    case "S": return { x: t, y: ext.y1 + d };
  }
}

/** enumeratePerimeterCells 가 훑는 바깥 반경의 상한. */
export const MAX_EXTERNAL_SEARCH_RADIUS = 12;

/**
 * 차단 그룹 — 모든 pipe-to-ground prototype 은 단일 그룹으로 묶여 서로
 * 차단된다 (Factorio 게임 동작 기준, 사용자 결정 4).
 *
 * 여기 있는 이유: 탐색(`containerRouting.routeFluid`)과 방출(`execution/emitPath`)이
 * **둘 다** 쓴다. 어느 한쪽에 두면 두 파일이 서로를 참조해 순환이 된다.
 */
export const PIPE_BLOCK_GROUP = 'pipe-to-ground';

/**
 * 전역 외곽(perimeter)이 모듈 union 에서 몇 칸 바깥인가 — **반출 상자가 앉는 변까지의 거리.**
 *
 * 반출 체인은 모듈 경계에서 바깥으로 이렇게 간다:
 *
 *     [머신][인서터][anchor=벨트] … [인서터][상자]
 *                    ↑ 옛 상자 자리      ↑ 마진        ↑ 외곽 변
 *
 * anchor(옛 상자 자리)는 모듈 extent 의 가장자리이고, 거기서 **벨트 → 인서터 → 상자** 로
 * 최소 두 칸이 더 필요하다. 그래서 2.
 *
 * 옛 트렁크 시절엔 1이었다 — 그땐 anchor 안쪽의 feeder 인서터 자리를 벨트로 **재활용**해
 * 한 칸을 벌었기 때문이다. 1:1 에선 그 자리에 **머신을 먹이는 인서터**가 앉아 있어 덮을 수
 * 없다(덮으면 머신이 굶는다) → 한 칸을 바깥에서 돌려받아야 한다.
 *
 * **세 곳이 이 값을 공유해야 한다**(어긋나면 예약과 방출이 다른 변을 가리킨다):
 * modulePacking 의 `expandBbox`·`seatRow/seatCol`, modulePerimeterPass 의 `perimeterOf`.
 */
export const PERIMETER_MARGIN = 2;

/**
 * bbox 바깥 minRadius~maxRadius 칸 전체 외부 영역의 셀 좌표 목록.
 * 각 반경(ring)을 시계 방향 N → E → S → W 로 열거한다.
 * 호출자가 머신 기준 manhattan 거리로 재정렬하므로 가까운 ring 부터 열거해
 * 정렬 비용을 줄인다.
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
