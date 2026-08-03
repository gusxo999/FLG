/**
 * 영역 통합 — 배치가 끝난 두 영역을 화면이 쓰는 형태로 다듬는다.
 *
 *  - `unifyAreas` — 두 영역을 단일 PlacedCell[] 로 평탄화. 좌표계가 이미
 *    단일이라 internal.placed 의 얕은 복제로 끝.
 *  - `computeMachineRoutingBbox` — 머신+라우팅 셀의 bbox. 편집기 viewport 계산에 사용.
 *
 * **드래그 재라우팅은 여기 없다** — `manualEdit/dragArea.ts` 로 격리됐다(비활성).
 */

import type { Area, UnifyResult } from './containerModel';
import { expandBbox } from './util/helper';

// ─────────────────────────────────────────────────────────────────────────────
// unifyAreas — 단일 좌표계 평탄화
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 두 영역을 정규화된 단일 PlacedCell[] 로 합쳐 반환.
 *
 * 정규화: internal.placed 전체 bbox(chest 연결 인서터 포함) 기준으로 오프셋을
 * 산정해 external.placed 의 chest 셀이 음수 좌표를 갖지 않도록 한다.
 *
 * `internalBbox` = 머신 컨테이너 footprint 의 정규화 bbox.
 * chest ↔ machine 연결 인서터는 제외 — 렌더러가 internalBbox 바깥을 초록 영역으로
 * 표시하므로, 인서터가 포함되면 초록 영역이 머신쪽으로 침범한다.
 *
 * `canvasBbox` = internalBbox 사방 1칸 여백 + 모든 placed 셀의 합집합.
 * chest 가 없는 방향에도 최소 1칸 초록 영역이 확보된다.
 */
export function unifyAreas(internal: Area, external: Area): UnifyResult {
  // 오프셋 계산용: internal.placed 전체 bbox (chest 연결 인서터 포함).
  // 이 bbox 의 min 좌표를 기준으로 offset 을 산정해야 external.placed 의
  // chest 셀이 정규화 후 음수 좌표를 갖지 않는다.
  const fullPlacedBbox = computeMachineRoutingBbox(internal);

  // internalBbox 용: 머신 컨테이너 footprint 만 사용.
  // chest ↔ machine 연결 인서터는 외부(초록) 영역에 속하므로 제외한다.
  let machineBbox: Area['bbox'] = undefined;
  for (const c of internal.containers) {
    if (c.kind === 'machine') {
      machineBbox = expandBbox(machineBbox, c.origin.x, c.origin.y, c.size.w, c.size.h);
    }
  }

  if (!machineBbox) {
    const placed = [...internal.placed, ...external.placed].map((p) => ({
      x: p.x,
      y: p.y,
      cell: { ...p.cell, tileOffset: { ...p.cell.tileOffset } },
    }));
    let canvasBbox: NonNullable<Area['bbox']> | undefined;
    for (const p of placed) canvasBbox = expandBbox(canvasBbox, p.x, p.y, 1, 1);
    // 머신 없음 분기는 셀을 시프트하지 않으므로 offset 은 항등(0,0).
    return { placed, internalBbox: undefined, canvasBbox, offset: { x: 0, y: 0 } };
  }

  // offset: fullPlacedBbox(chest 인서터 포함) 기준으로 산정.
  // fullPlacedBbox 가 없으면(머신만 있고 placed 가 비어있을 리 없지만) machineBbox 사용.
  const bboxForOffset = fullPlacedBbox ?? machineBbox;
  const offsetX = 1 - bboxForOffset.x;
  const offsetY = 1 - bboxForOffset.y;

  const placed = [...internal.placed, ...external.placed].map((p) => ({
    x: p.x + offsetX,
    y: p.y + offsetY,
    cell: { ...p.cell, tileOffset: { ...p.cell.tileOffset } },
  }));

  // internalBbox: 머신 컨테이너 bbox 를 정규화 좌표계로 변환.
  // chest 연결 인서터를 제외하므로 실제 "청사진 영역" 경계가 정확해진다.
  const internalBbox = {
    x: machineBbox.x + offsetX,
    y: machineBbox.y + offsetY,
    w: machineBbox.w,
    h: machineBbox.h,
  };

  // canvasBbox: internalBbox 사방 1칸 여백을 초기값으로 설정 후
  // 모든 placed 셀로 확장 → chest 가 없는 방향에도 최소 1칸 초록 영역 확보.
  let canvasBbox: NonNullable<Area['bbox']> = {
    x: internalBbox.x - 1,
    y: internalBbox.y - 1,
    w: internalBbox.w + 2,
    h: internalBbox.h + 2,
  };
  for (const p of placed) canvasBbox = expandBbox(canvasBbox, p.x, p.y, 1, 1);

  // offset = leaf → 정규화 변환(placed 셀에 적용한 것과 동일). 라우팅 선/드래그가
  // 그리드 셀과 정확히 겹치려면 containerOriginOffset 이 이 값과 같아야 한다.
  return { placed, internalBbox, canvasBbox, offset: { x: offsetX, y: offsetY } };
}

// ─────────────────────────────────────────────────────────────────────────────
// machine + routing bbox + perimeter 계산
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 머신 + 내부 라우팅 셀의 bounding box.
 * internal.placed 는 ghost cell 없이 머신·라우팅 셀만 포함하므로 그대로 iterate.
 */
export function computeMachineRoutingBbox(
  internal: Area,
): { x: number; y: number; w: number; h: number } | undefined {
  let bbox: Area['bbox'] = undefined;
  for (const p of internal.placed) {
    bbox = expandBbox(bbox, p.x, p.y, 1, 1);
  }
  return bbox;
}
