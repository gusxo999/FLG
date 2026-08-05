/**
 * 영역 통합 — 배치가 끝난 leaf 를 **레이아웃 좌표(F1) → 그리드 좌표(F2)** 로 넘긴다.
 *
 *  - `unifyLeaf` — leaf **전체**를 그리드 좌표로 옮기고, 그리드에 쓸 셀 배열과 bbox 를 낸다.
 *  - `computeMachineRoutingBbox` — 머신+라우팅 셀의 bbox. 편집기 viewport 계산에 사용.
 *
 * ## 오프셋을 데이터와 나란히 들고 다니지 않는다
 *
 * 예전엔 `placed` 만 옮기고 **오프셋을 함께 반환**했다. 컨테이너·라우팅은 레이아웃 좌표에
 * 남아 있어서, 그것을 그리는 쪽이 전부 `+ offset` 을 기억해야 했다. 소비자가 셋(모듈
 * 오버레이·실패 스냅샷·콘솔 API)이었고 그중 둘이 잊었다 —
 * `LayoutIssue.cells` 는 오프셋 없이 그려져 **문제 칸 마커가 엉뚱한 자리**에 찍혔고,
 * 콘솔 API 는 죽은 세션에서 오프셋을 읽어 **항상 (0,0)** 이었다(2026-08-05).
 *
 * 이제 경계를 넘는 것은 **이 함수 하나**이고, 넘고 나면 오프셋은 존재하지 않는다.
 *
 * ## 음수 좌표는 존재하지 않는다
 *
 * 정규화는 leaf 의 전체 bbox 좌상단을 **(1,1)** 로 보낸다 — 사방 1칸 여백이 곧
 * 외부 영역(초록)의 최소치다. 그래서 이 함수의 산출물은 **모든 좌표가 ≥ 1** 이고,
 * `applyPlacedCells` 는 그리드를 밀 일이 없다(사용자 결정, 2026-08-05).
 *
 * **드래그 재라우팅은 여기 없다** — `manualEdit/dragArea.ts` 로 격리됐다(비활성).
 */

import type {
  Area,
  CandidateLeaf,
  Container,
  ContainerPort,
  PlacedCell,
  Routing,
  UndergroundCorridor,
  UnifyResult,
} from './containerModel';
import { expandBbox } from './util/helper';

// ─────────────────────────────────────────────────────────────────────────────
// 좌표 프레임을 넘기는 총 변환 — 좌표를 가진 필드를 **전부 명시**한다
// ─────────────────────────────────────────────────────────────────────────────
//
// 스프레드(`...x`)로 펴고 좌표만 덮어쓰는 방식은 쓰지 않는다. 그러면 좌표 필드를
// 빠뜨려도 **타입이 통과하고**, 그 필드는 사라지는 대신 **낡은 좌표로 살아남는다.**
// 명시하면 필드가 늘 때 누락 필드 타입 에러가 난다.

const shiftPoint = (p: { x: number; y: number }, dx: number, dy: number) =>
  ({ x: p.x + dx, y: p.y + dy });

const shiftContainer = (c: Container, dx: number, dy: number): Container => ({
  id: c.id,
  kind: c.kind,
  entityName: c.entityName,
  origin: shiftPoint(c.origin, dx, dy),
  size: c.size,
  direction: c.direction,
  recipeName: c.recipeName,
  content: c.content,
  role: c.role,
});

const shiftCell = (p: PlacedCell, dx: number, dy: number): PlacedCell => ({
  x: p.x + dx,
  y: p.y + dy,
  // `tileOffset` 은 엔티티 안에서의 상대 위치라 평행이동에 불변이다.
  cell: { ...p.cell, tileOffset: { ...p.cell.tileOffset } },
});

const shiftPort = (p: ContainerPort, dx: number, dy: number): ContainerPort => ({
  containerId: p.containerId,
  cell: shiftPoint(p.cell, dx, dy),
  face: p.face,
  kind: p.kind,
});

/** 지하 corridor — `line`(축에 수직인 좌표)과 `range`(축 방향 구간)가 **다른 축**이다. */
const shiftCorridor = (c: UndergroundCorridor, dx: number, dy: number): UndergroundCorridor => {
  const along = c.axis === 'h' ? dx : dy;   // range 가 달리는 축
  const across = c.axis === 'h' ? dy : dx;  // line 이 가리키는 축
  return {
    axis: c.axis,
    line: c.line + across,
    range: [c.range[0] + along, c.range[1] + along],
    blockGroup: c.blockGroup,
    kind: c.kind,
  };
};

const shiftRouting = (r: Routing, dx: number, dy: number): Routing => ({
  id: r.id,
  kind: r.kind,
  from: shiftPort(r.from, dx, dy),
  to: shiftPort(r.to, dx, dy),
  // `*PortMeta` 는 좌표가 없다(면·레인·수량뿐) — 주석이 그렇게 못 박고 있다.
  fromPortMeta: r.fromPortMeta,
  toPortMeta: r.toPortMeta,
  placed: r.placed.map((p) => shiftCell(p, dx, dy)),
  corridors: r.corridors.map((c) => shiftCorridor(c, dx, dy)),
});

const shiftArea = (a: Area, dx: number, dy: number): Area => ({
  kind: a.kind,
  containers: a.containers.map((c) => shiftContainer(c, dx, dy)),
  placed: a.placed.map((p) => shiftCell(p, dx, dy)),
  bbox: a.bbox ? { ...a.bbox, x: a.bbox.x + dx, y: a.bbox.y + dy } : undefined,
  undergroundCorridors: a.undergroundCorridors.map((c) => shiftCorridor(c, dx, dy)),
});

const shiftLeaf = (leaf: CandidateLeaf, dx: number, dy: number): CandidateLeaf => ({
  id: leaf.id,
  kind: leaf.kind,
  children: leaf.children,   // leaf 는 자식이 없다(빈 배열).
  label: leaf.label,
  internal: shiftArea(leaf.internal, dx, dy),
  external: shiftArea(leaf.external, dx, dy),
  routings: leaf.routings.map((r) => shiftRouting(r, dx, dy)),
  squarenessPenalty: leaf.squarenessPenalty,
  moduleDiagnostics: leaf.moduleDiagnostics,
});

// ─────────────────────────────────────────────────────────────────────────────
// unifyLeaf — 그리드 좌표로 넘긴다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * leaf 를 그리드 좌표로 옮기고, 그리드에 쓸 셀 배열과 두 bbox 를 낸다.
 *
 * 정규화: **그리드에 쓸 셀 전부**(`internal.placed` ∪ `external.placed`)의 bbox 좌상단이
 * **(1,1)** 에 오게 옮긴다.
 *
 * 예전엔 `internal.placed` 만을 기준으로 삼고 *"chest 는 ring 1칸 바깥이니 정규화 후
 * 0 이 된다"* 에 기댔다. 그 가정은 반출(perimeter export)이 상자를 [PERIMETER_MARGIN]=2
 * 칸 바깥으로 옮기면 깨진다 — external 셀이 **−1** 이 된다. 예전에는 `applyPlacedCells`
 * 가 그리드를 밀어 조용히 흡수했지만, 음수 좌표를 금지한 지금은 **셀이 유실**된다.
 * 쓸 것 전부를 기준으로 삼으면 그 가정 자체가 사라진다.
 *
 * `internalBbox` = 머신 컨테이너 footprint 의 bbox.
 * chest ↔ machine 연결 인서터는 제외 — 렌더러가 internalBbox 바깥을 초록 영역으로
 * 표시하므로, 인서터가 포함되면 초록 영역이 머신쪽으로 침범한다.
 *
 * `canvasBbox` = internalBbox 사방 1칸 여백 + 모든 placed 셀의 합집합.
 * chest 가 없는 방향에도 최소 1칸 초록 영역이 확보된다.
 */
export function unifyLeaf(leaf: CandidateLeaf): UnifyResult {
  // 오프셋 계산용: **그리드에 쓸 셀 전부**의 bbox. 머신 없는 배치는 옮길 기준이 없어 항등.
  let writtenBbox: Area['bbox'] = undefined;
  for (const p of leaf.internal.placed) writtenBbox = expandBbox(writtenBbox, p.x, p.y, 1, 1);
  for (const p of leaf.external.placed) writtenBbox = expandBbox(writtenBbox, p.x, p.y, 1, 1);

  // internalBbox 용: 머신 컨테이너 footprint 만 사용.
  let machineBbox: Area['bbox'] = undefined;
  for (const c of leaf.internal.containers) {
    if (c.kind === 'machine') {
      machineBbox = expandBbox(machineBbox, c.origin.x, c.origin.y, c.size.w, c.size.h);
    }
  }

  const bboxForOffset = machineBbox ? (writtenBbox ?? machineBbox) : undefined;
  const dx = bboxForOffset ? 1 - bboxForOffset.x : 0;
  const dy = bboxForOffset ? 1 - bboxForOffset.y : 0;

  const moved = dx === 0 && dy === 0 ? leaf : shiftLeaf(leaf, dx, dy);
  const placed = [...moved.internal.placed, ...moved.external.placed];

  if (!machineBbox) {
    let canvasBbox: NonNullable<Area['bbox']> | undefined;
    for (const p of placed) canvasBbox = expandBbox(canvasBbox, p.x, p.y, 1, 1);
    return { leaf: moved, placed, internalBbox: undefined, canvasBbox };
  }

  const internalBbox = {
    x: machineBbox.x + dx,
    y: machineBbox.y + dy,
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

  return { leaf: moved, placed, internalBbox, canvasBbox };
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
