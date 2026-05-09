/**
 * 영역 통합 — placement-search §3 / §8.3 / Q24 의 마지막 단계.
 *
 * CG2 구현: chest 가 이미 `internal.placed` 에 *통합 좌표* 로 박혀있고
 * `external.placed` 에는 *외부 좌표* 로 동일 chest 의 셀이 박혀있다 (두 좌표
 * 계의 같은 컨테이너). 통합 함수는:
 *
 *  - `unifyAreas` — 두 영역을 단일 PlacedCell[] 로 평탄화. blueprint export 와
 *    그리드 적용의 입력. 1차 CG2 에서는 `internal.placed` 가 이미 통합 좌표라
 *    그대로 반환.
 *  - `dragExternalContainer` — 사용자가 외부 영역에서 chest 를 옮긴 결과를
 *    반영. 외부 좌표 변경분을 통합 좌표에도 같은 delta 로 적용해 평행이동
 *    invariant 를 보존하고, 그 chest 를 끝점으로 가진 모든 라우팅을 재시도.
 *    하나라도 실패하면 모든 mutation rollback.
 */

import type {
  Area,
  CandidateLeaf,
  Container,
  PortKind,
  Routing,
  UnifyResult,
} from './containerModel';
import { commitRouting } from './containerRouting';
import { expandBbox, makeContainerCell } from './externalPlacer';
import { routeWithFallback, type RouteOptions } from './routeFallback';

// ─────────────────────────────────────────────────────────────────────────────
// unifyAreas — 단일 좌표계 평탄화
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 두 영역을 통합 좌표계 단일 PlacedCell[] 로 합쳐 반환.
 *
 * 1차 CG2: chest 가 이미 `internal.placed` 에 통합 좌표로 존재하므로 단순히
 * `internal.placed` 를 얕은 복제해서 반환. `external.placed` 는 외부 좌표라
 * export 에 직접 못 쓰며, 외부 영역 UI 패널 표시 용도로만 보존됨.
 *
 * `translations` 는 컨테이너별 `(origin - externalOrigin)` 평행이동 — 사용자
 * 드래그 검증·해석에 필요한 정보를 미리 추출해 둔다.
 */
export function unifyAreas(internal: Area, external: Area): UnifyResult {
  const placed = internal.placed.map((p) => ({
    x: p.x,
    y: p.y,
    cell: { ...p.cell, tileOffset: { ...p.cell.tileOffset } },
  }));

  const translations = new Map<string, { dx: number; dy: number }>();
  for (const c of external.containers) {
    if (!c.externalOrigin) continue;
    translations.set(c.id, {
      dx: c.origin.x - c.externalOrigin.x,
      dy: c.origin.y - c.externalOrigin.y,
    });
  }
  return { placed, translations };
}

// ─────────────────────────────────────────────────────────────────────────────
// dragExternalContainer — 드래그 후 영향분 라우팅 재시도
// ─────────────────────────────────────────────────────────────────────────────

export type DragResult =
  | { ok: true; rerouted: Routing[] }
  | { ok: false; reason: 'no-port-pair' | 'no-path' | 'collision'; failedRouting?: string };

/**
 * 외부 컨테이너를 새 외부 좌표로 옮기고 영향받은 라우팅을 재시도한다.
 *
 * 절차:
 *  1. delta = newExternalOrigin - oldExternalOrigin
 *  2. delta 만큼 통합 좌표 (`origin`) 도 이동
 *  3. 두 영역의 placed cell · bbox 갱신
 *  4. 그 컨테이너를 from/to 로 가진 라우팅들 internal 에서 uncommit + 배열 제거
 *  5. 새 위치의 컨테이너 ↔ 상대 컨테이너 사이를 `routeWithFallback` 로 재시도
 *  6. 모두 성공: commit, ok=true. 하나라도 실패: 모든 mutation rollback.
 *
 * 호출자는 인자로 받은 `internal`, `external`, `routings` 가 *직접 mutate*
 * 됨에 유의 — 후보 trees 의 candidate leaf 를 그대로 넘기고 싶다면 호출 전에
 * deep-clone 후 결과 적용 여부를 사용자가 확인하게 하는 흐름을 권장.
 */
export function dragExternalContainer(
  containerId: string,
  newExternalOrigin: { x: number; y: number },
  internal: Area,
  external: Area,
  routings: Routing[],
  options: RouteOptions,
): DragResult {
  // 같은 chest 가 두 영역에 모두 존재 (placeExternalContainer 가 두 영역 모두에
  // push). cloneArea 가 영역마다 별도 객체를 만들 수 있어 *두 객체 모두* 갱신
  // 해야 invariant 가 보존된다.
  const chest = external.containers.find((c) => c.id === containerId);
  const chestInInternal = internal.containers.find((c) => c.id === containerId);
  if (!chest || !chest.externalOrigin) {
    return { ok: false, reason: 'no-port-pair' };
  }

  const oldExternal = { ...chest.externalOrigin };
  const oldOrigin = { ...chest.origin };
  const delta = {
    dx: newExternalOrigin.x - oldExternal.x,
    dy: newExternalOrigin.y - oldExternal.y,
  };
  if (delta.dx === 0 && delta.dy === 0) {
    return { ok: true, rerouted: [] };
  }

  const newOrigin = { x: oldOrigin.x + delta.dx, y: oldOrigin.y + delta.dy };

  // 1) 영향받은 라우팅 식별 + 상대 컨테이너 lookup.
  const affected: Routing[] = [];
  for (const r of routings) {
    if (r.from.containerId === containerId || r.to.containerId === containerId) {
      affected.push(r);
    }
  }

  // 2) 새 위치가 두 영역 모두에서 자유 셀인지 확인 (자기 자신 셀은 곧 비울
  // 거니까 제외, 영향받은 라우팅의 셀들도 곧 uncommit 되니 제외).
  const externalSelfCellKey = `${oldExternal.x},${oldExternal.y}`;
  const internalSelfCellKey = `${oldOrigin.x},${oldOrigin.y}`;
  const affectedRoutingCells = new Set<string>();
  for (const r of affected) {
    for (const p of r.placed) affectedRoutingCells.add(`${p.x},${p.y}`);
  }

  const externalCollision = external.placed.some(
    (p) =>
      `${p.x},${p.y}` !== externalSelfCellKey &&
      p.x === newExternalOrigin.x &&
      p.y === newExternalOrigin.y,
  );
  if (externalCollision) {
    return { ok: false, reason: 'collision' };
  }
  const internalCollision = internal.placed.some(
    (p) =>
      `${p.x},${p.y}` !== internalSelfCellKey &&
      !affectedRoutingCells.has(`${p.x},${p.y}`) &&
      p.x === newOrigin.x &&
      p.y === newOrigin.y,
  );
  if (internalCollision) {
    return { ok: false, reason: 'collision' };
  }

  // 3) 영향받은 라우팅을 internal.placed 에서 uncommit. 외부 영역에는 라우팅이
  // 없으므로 internal 만 손대면 됨.
  const removedFromInternal: typeof internal.placed = [];
  internal.placed = internal.placed.filter((p) => {
    if (affectedRoutingCells.has(`${p.x},${p.y}`)) {
      removedFromInternal.push(p);
      return false;
    }
    return true;
  });
  // chest 셀도 두 영역에서 우선 제거 (새 자리에서 다시 push).
  internal.placed = internal.placed.filter(
    (p) => !(p.x === oldOrigin.x && p.y === oldOrigin.y && p.cell.entityId === chest.id),
  );
  external.placed = external.placed.filter(
    (p) => !(p.x === oldExternal.x && p.y === oldExternal.y && p.cell.entityId === chest.id),
  );

  // 4) chest 위치 갱신 + 두 영역에 새 셀 push. 두 영역의 컨테이너 객체가 별도
  // 라면 (cloneArea 결과) 둘 다 갱신.
  chest.externalOrigin = { ...newExternalOrigin };
  chest.origin = { ...newOrigin };
  if (chestInInternal && chestInInternal !== chest) {
    chestInInternal.externalOrigin = { ...newExternalOrigin };
    chestInInternal.origin = { ...newOrigin };
  }
  external.placed.push(makeContainerCell(chest, newExternalOrigin));
  internal.placed.push(makeContainerCell(chest, newOrigin));

  // 5) 영향받은 라우팅 인덱스 보관 (rollback 용) + 라우팅 배열에서 제거.
  const originalRoutings = [...routings];
  const remainingRoutings = routings.filter(
    (r) => !(r.from.containerId === containerId || r.to.containerId === containerId),
  );

  // 6) 각 affected 라우팅 재시도. 라우팅 1개의 두 끝점은 from / to 의 컨테이너
  // id 로 식별되며, 한쪽이 chest 인 경우와 다른 한쪽이 chest 인 경우를 구분.
  const newRoutings: Routing[] = [];
  for (const r of affected) {
    const otherId =
      r.from.containerId === containerId ? r.to.containerId : r.from.containerId;
    const other = findContainer(otherId, internal, external);
    if (!other) {
      rollback();
      return { ok: false, reason: 'no-port-pair', failedRouting: r.id };
    }
    // 흐름 방향: 원래 from→to 그대로. chest 가 from 이면 producer=chest,
    // 아니면 consumer=chest.
    const producer = r.from.containerId === containerId ? chest : other;
    const consumer = r.to.containerId === containerId ? chest : other;
    const kind: PortKind = r.kind === 'fluid'
      ? { fluid: deriveFluidName(r) ?? '' }
      : 'item';
    const attempt = routeWithFallback(producer, consumer, kind, internal, options);
    if (!attempt.ok) {
      rollback();
      return { ok: false, reason: attempt.reason, failedRouting: r.id };
    }
    commitRouting(attempt.routing, internal);
    newRoutings.push(attempt.routing);
  }

  // 7) bbox 재계산 — 단순 전수 갱신.
  recomputeBbox(internal);
  recomputeBbox(external);

  // 8) routings 배열 갱신 — 영향받지 않은 + 새로 깐 라우팅.
  routings.length = 0;
  for (const r of remainingRoutings) routings.push(r);
  for (const r of newRoutings) routings.push(r);

  return { ok: true, rerouted: newRoutings };

  // ───────────────────────── rollback closure ─────────────────────────
  function rollback(): void {
    // chest 위치 복구 (두 영역의 객체 모두).
    chest!.externalOrigin = oldExternal;
    chest!.origin = oldOrigin;
    if (chestInInternal && chestInInternal !== chest) {
      chestInInternal.externalOrigin = oldExternal;
      chestInInternal.origin = oldOrigin;
    }

    // 새로 push 한 chest 셀 제거.
    internal.placed = internal.placed.filter(
      (p) => !(p.x === newOrigin.x && p.y === newOrigin.y && p.cell.entityId === chest!.id),
    );
    external.placed = external.placed.filter(
      (p) =>
        !(
          p.x === newExternalOrigin.x &&
          p.y === newExternalOrigin.y &&
          p.cell.entityId === chest!.id
        ),
    );

    // 새로 commit 된 라우팅 제거.
    const newRoutingCells = new Set<string>();
    for (const r of newRoutings) {
      for (const p of r.placed) newRoutingCells.add(`${p.x},${p.y}`);
    }
    if (newRoutingCells.size > 0) {
      internal.placed = internal.placed.filter((p) => !newRoutingCells.has(`${p.x},${p.y}`));
    }

    // 옛 chest 셀 복구.
    external.placed.push(makeContainerCell(chest!, oldExternal));
    internal.placed.push(makeContainerCell(chest!, oldOrigin));
    // 옛 라우팅 셀 복구.
    for (const p of removedFromInternal) internal.placed.push(p);

    // bbox 복구.
    recomputeBbox(internal);
    recomputeBbox(external);

    // routings 배열 복구.
    routings.length = 0;
    for (const r of originalRoutings) routings.push(r);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function findContainer(id: string, internal: Area, external: Area): Container | undefined {
  return (
    internal.containers.find((c) => c.id === id) ??
    external.containers.find((c) => c.id === id)
  );
}

/**
 * Routing 의 fluid 이름 추출 — `from.kind` (또는 `to.kind`) 가
 * `{fluid: name}` 형태인 경우. item 라우팅이면 undefined.
 */
function deriveFluidName(r: Routing): string | undefined {
  const k = r.from.kind;
  if (typeof k === 'object' && 'fluid' in k) return k.fluid;
  const k2 = r.to.kind;
  if (typeof k2 === 'object' && 'fluid' in k2) return k2.fluid;
  return undefined;
}

function recomputeBbox(area: Area): void {
  if (area.placed.length === 0) {
    area.bbox = undefined;
    return;
  }
  let bbox: Area['bbox'] = undefined;
  for (const p of area.placed) {
    bbox = expandBbox(bbox, p.x, p.y, 1, 1);
  }
  area.bbox = bbox;
}

// ─────────────────────────────────────────────────────────────────────────────
// 클론 — UI 가 드래그를 시도하는 동안 원본 후보를 보호하기 위한 deep-clone.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 영역을 deep-clone. `dragExternalContainer` 가 mutate 해도 원본이 그대로
 * 보존되도록 containers / placed / bbox 모두 복제. 같은 컨테이너 객체가 두
 * 영역에 공유돼있던 경우도 cloneArea 결과는 영역마다 별개의 Container 사본
 * 이며, drag 함수는 두 사본을 모두 동기화한다.
 */
export function cloneArea(a: Area): Area {
  return {
    kind: a.kind,
    containers: a.containers.map((c) => ({
      ...c,
      origin: { ...c.origin },
      size: { ...c.size },
      externalOrigin: c.externalOrigin ? { ...c.externalOrigin } : undefined,
    })),
    placed: a.placed.map((p) => ({
      x: p.x,
      y: p.y,
      cell: { ...p.cell, tileOffset: { ...p.cell.tileOffset } },
    })),
    bbox: a.bbox ? { ...a.bbox } : undefined,
  };
}

/**
 * 한 라우팅을 deep-clone. `dragExternalContainer` 가 routings 배열 자체를
 * mutate (length=0 + push) 하므로 사본이 필요. placed cells 까지 복제.
 */
export function cloneRouting(r: Routing): Routing {
  return {
    id: r.id,
    kind: r.kind,
    from: { ...r.from, cell: { ...r.from.cell }, kind: cloneKind(r.from.kind) },
    to: { ...r.to, cell: { ...r.to.cell }, kind: cloneKind(r.to.kind) },
    placed: r.placed.map((p) => ({
      x: p.x,
      y: p.y,
      cell: { ...p.cell, tileOffset: { ...p.cell.tileOffset } },
    })),
    area: r.area,
  };
}

function cloneKind(k: PortKind): PortKind {
  return typeof k === 'object' ? { fluid: k.fluid } : k;
}

/**
 * 한 후보 leaf 를 drag 작업용으로 clone.
 *
 * 외부 영역 편집기는 이 사본 위에서 drag 를 시도하고, 사용자가 "반영" 을
 * 누르면 원본 트리의 후보를 사본으로 교체한다. "취소" 면 사본을 버린다.
 *
 * `children` 은 트리 구조 (디버깅용 노드들) 라 복제하지 않고 ref 그대로
 * 가져간다 — drag 는 children 을 건드리지 않는다.
 */
export function cloneCandidate(c: CandidateLeaf): CandidateLeaf {
  return {
    ...c,
    internal: cloneArea(c.internal),
    external: cloneArea(c.external),
    routings: c.routings.map(cloneRouting),
    children: c.children,
    snapshot: c.snapshot,
  };
}
