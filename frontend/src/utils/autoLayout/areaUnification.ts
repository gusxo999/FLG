/**
 * 영역 통합 — placement-search §3 / §8.3.
 *
 * 좌표계는 단일이며 chest 는 *internal bbox 의 1셀 두께 perimeter ring* 위에
 * 산다. 본 모듈이 제공하는 것:
 *
 *  - `unifyAreas` — 두 영역을 단일 PlacedCell[] 로 평탄화. 좌표계가 이미
 *    단일이라 internal.placed 의 얕은 복제로 끝.
 *  - `wrapExternalsAroundPerimeter` — 모든 머신 + 라우팅 배치가 끝난 뒤,
 *    chest 들을 internal bbox 의 perimeter 위로 재배치하는 후처리. consumer
 *    머신과 가까운 빈 perimeter 셀로 옮기고 라우팅 자동 재시도.
 *  - `dragExternalContainer` — 사용자가 chest 를 옮긴 결과를 반영. 임의의
 *    유효 셀로 이동 + 라우팅 재시도. 실패 시 모든 mutation rollback.
 *  - 헬퍼: `computeMachineRoutingBbox`, `enumeratePerimeterCells`.
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
 * 두 영역을 통합 좌표계 단일 PlacedCell[] 로 합쳐 반환. chest 가 이미
 * `internal.placed` 에 ghost-place 된 상태이므로 internal.placed 를 얕은
 * 복제해서 반환.
 */
export function unifyAreas(internal: Area, _external: Area): UnifyResult {
  const placed = internal.placed.map((p) => ({
    x: p.x,
    y: p.y,
    cell: { ...p.cell, tileOffset: { ...p.cell.tileOffset } },
  }));
  return { placed };
}

// ─────────────────────────────────────────────────────────────────────────────
// machine + routing bbox + perimeter 계산
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 머신 + 내부 라우팅 셀의 bounding box. chest 셀 (= external 영역 컨테이너의
 * ghost) 은 제외 — 이 bbox 의 perimeter 위에 chest 를 정렬할 것이라 자기
 * 자신을 기준에서 빼야 함.
 */
export function computeMachineRoutingBbox(
  internal: Area,
  external: Area,
): { x: number; y: number; w: number; h: number } | undefined {
  const externalIds = new Set<string>();
  for (const c of external.containers) externalIds.add(c.id);

  let bbox: Area['bbox'] = undefined;
  for (const p of internal.placed) {
    // chest ghost cell skip — entityId 가 external 컨테이너 id 와 일치
    if (p.cell.entityId && externalIds.has(p.cell.entityId)) continue;
    bbox = expandBbox(bbox, p.x, p.y, 1, 1);
  }
  return bbox;
}

/**
 * `bbox` 의 1-cell 두께 perimeter ring 셀 좌표 목록.
 *
 * 모서리 4셀 + 위·아래 가로변 + 좌·우 세로변. 시계 방향 N → E → S → W 순으로
 * 나열되어 chest 정렬이 한 면 다 차면 다음 면으로 흐르도록 한다.
 */
export function enumeratePerimeterCells(
  bbox: { x: number; y: number; w: number; h: number },
): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  const x0 = bbox.x;
  const y0 = bbox.y;
  const x1 = bbox.x + bbox.w - 1;
  const y1 = bbox.y + bbox.h - 1;

  // N 면 (y0 - 1) 좌→우, 좌상 모서리 포함
  for (let x = x0 - 1; x <= x1 + 1; x++) cells.push({ x, y: y0 - 1 });
  // E 면 (x1 + 1) 위→아래, 우상 모서리는 위 루프에서 이미 push 됐으므로 y0 부터
  for (let y = y0; y <= y1; y++) cells.push({ x: x1 + 1, y });
  // S 면 (y1 + 1) 우→좌, 우하·좌하 모서리 포함
  for (let x = x1 + 1; x >= x0 - 1; x--) cells.push({ x, y: y1 + 1 });
  // W 면 (x0 - 1) 아래→위, 좌하 모서리는 위 루프에서 push 됐으므로 y1 부터
  for (let y = y1; y >= y0; y--) cells.push({ x: x0 - 1, y });
  return cells;
}

/** 셀 좌표가 perimeter ring 에 속하는지. */
export function isOnPerimeter(
  cell: { x: number; y: number },
  bbox: { x: number; y: number; w: number; h: number },
): boolean {
  const onN = cell.y === bbox.y - 1 && cell.x >= bbox.x - 1 && cell.x <= bbox.x + bbox.w;
  const onS = cell.y === bbox.y + bbox.h && cell.x >= bbox.x - 1 && cell.x <= bbox.x + bbox.w;
  const onW = cell.x === bbox.x - 1 && cell.y >= bbox.y - 1 && cell.y <= bbox.y + bbox.h;
  const onE = cell.x === bbox.x + bbox.w && cell.y >= bbox.y - 1 && cell.y <= bbox.y + bbox.h;
  return onN || onS || onW || onE;
}

// ─────────────────────────────────────────────────────────────────────────────
// wrapExternalsAroundPerimeter — 후처리
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 모든 머신 + 라우팅 배치 후, chest 들을 internal bbox 의 perimeter 위로
 * 재배치한다.
 *
 * 알고리즘:
 *  1. machine + routing bbox 계산
 *  2. perimeter 셀 목록 (시계 방향)
 *  3. 각 chest 에 대해:
 *     a. 이미 perimeter 위에 있으면 skip
 *     b. 아니면 빈 perimeter 셀들 중 *현재 origin 에 manhattan 가장 가까운
 *        셀* 을 선택
 *     c. `dragExternalContainer` 로 이동 시도 (라우팅 자동 재시도)
 *     d. 실패 시 다음 후보 셀 시도
 *     e. 모든 후보 실패 시 chest 는 원위치 유지 (graceful degradation)
 *  4. internal.bbox / external.bbox 재계산
 *
 * 본 함수는 후보 leaf 의 internal/external/routings 를 직접 mutate. 호출자는
 * 보통 wizard 결과 직전에 호출.
 */
export function wrapExternalsAroundPerimeter(
  internal: Area,
  external: Area,
  routings: Routing[],
  options: RouteOptions,
): { relocated: number; skipped: number; failed: number } {
  const bbox = computeMachineRoutingBbox(internal, external);
  if (!bbox) return { relocated: 0, skipped: 0, failed: 0 };

  const perimeter = enumeratePerimeterCells(bbox);
  let relocated = 0;
  let skipped = 0;
  let failed = 0;

  // chest 처리 순서: consumer 머신과 가까운 chest 부터 — perimeter 좋은 자리
  // 를 먼저 점유. (현재는 단순 등록 순서로 순회 — 추후 우선순위 정렬 도입 가능)
  for (const chest of external.containers) {
    if (isOnPerimeter(chest.origin, bbox)) {
      skipped += 1;
      continue;
    }

    const sortedTargets = [...perimeter].sort((a, b) => {
      const da = Math.abs(a.x - chest.origin.x) + Math.abs(a.y - chest.origin.y);
      const db = Math.abs(b.x - chest.origin.x) + Math.abs(b.y - chest.origin.y);
      return da - db;
    });

    let moved = false;
    for (const target of sortedTargets) {
      const result = dragExternalContainer(
        chest.id,
        target,
        internal,
        external,
        routings,
        options,
      );
      if (result.ok) {
        moved = true;
        break;
      }
    }
    if (moved) relocated += 1;
    else failed += 1;
  }

  return { relocated, skipped, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// dragExternalContainer — chest 를 새 통합 좌표로 이동 + 라우팅 재시도
// ─────────────────────────────────────────────────────────────────────────────

export type DragResult =
  | { ok: true; rerouted: Routing[] }
  | { ok: false; reason: 'no-port-pair' | 'no-path' | 'collision'; failedRouting?: string };

/**
 * 외부 컨테이너를 새 통합 좌표로 이동하고 영향받은 라우팅을 재시도한다.
 *
 * 절차:
 *  1. 두 영역의 컨테이너 객체에서 origin 을 newOrigin 으로 갱신
 *  2. internal.placed 의 chest ghost cell 을 새 자리로 이동
 *  3. 그 컨테이너를 from/to 로 가진 라우팅을 internal.placed 에서 uncommit
 *  4. 새 위치 기준으로 routeWithFallback 로 재시도
 *  5. 모두 성공: commit, ok=true. 하나라도 실패: 모든 mutation rollback.
 */
export function dragExternalContainer(
  containerId: string,
  newOrigin: { x: number; y: number },
  internal: Area,
  external: Area,
  routings: Routing[],
  options: RouteOptions,
): DragResult {
  // 같은 chest 가 두 영역에 모두 존재 — cloneArea 가 영역마다 별도 객체를
  // 만들 수 있어 *두 객체 모두* 갱신해야 한다.
  const chest = external.containers.find((c) => c.id === containerId);
  const chestInInternal = internal.containers.find((c) => c.id === containerId);
  if (!chest) {
    return { ok: false, reason: 'no-port-pair' };
  }

  const oldOrigin = { ...chest.origin };
  if (oldOrigin.x === newOrigin.x && oldOrigin.y === newOrigin.y) {
    return { ok: true, rerouted: [] };
  }

  // 1) 영향받은 라우팅 식별.
  const affected: Routing[] = [];
  for (const r of routings) {
    if (r.from.containerId === containerId || r.to.containerId === containerId) {
      affected.push(r);
    }
  }
  const affectedRoutingCells = new Set<string>();
  for (const r of affected) {
    for (const p of r.placed) affectedRoutingCells.add(`${p.x},${p.y}`);
  }

  // 2) 새 자리가 자유 셀인지 확인 (자기 셀 + 영향분 라우팅 셀 제외).
  const internalSelfKey = `${oldOrigin.x},${oldOrigin.y}`;
  const internalCollision = internal.placed.some(
    (p) =>
      `${p.x},${p.y}` !== internalSelfKey &&
      !affectedRoutingCells.has(`${p.x},${p.y}`) &&
      p.x === newOrigin.x &&
      p.y === newOrigin.y,
  );
  if (internalCollision) {
    return { ok: false, reason: 'collision' };
  }

  // 3) 영향분 라우팅 셀 + 옛 chest 셀을 internal.placed 에서 제거.
  const removedCells: typeof internal.placed = [];
  internal.placed = internal.placed.filter((p) => {
    if (affectedRoutingCells.has(`${p.x},${p.y}`)) {
      removedCells.push(p);
      return false;
    }
    return true;
  });
  internal.placed = internal.placed.filter(
    (p) => !(p.x === oldOrigin.x && p.y === oldOrigin.y && p.cell.entityId === chest.id),
  );

  // 4) chest 위치 갱신 + 새 ghost cell push.
  chest.origin = { ...newOrigin };
  if (chestInInternal && chestInInternal !== chest) {
    chestInInternal.origin = { ...newOrigin };
  }
  internal.placed.push(makeContainerCell(chest, newOrigin));

  // 5) 영향분 라우팅 재시도.
  const originalRoutings = [...routings];
  const remaining = routings.filter(
    (r) => !(r.from.containerId === containerId || r.to.containerId === containerId),
  );
  const newRoutings: Routing[] = [];
  for (const r of affected) {
    const otherId =
      r.from.containerId === containerId ? r.to.containerId : r.from.containerId;
    const other = findContainer(otherId, internal, external);
    if (!other) {
      rollback();
      return { ok: false, reason: 'no-port-pair', failedRouting: r.id };
    }
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

  // 6) bbox 재계산 + routings 배열 갱신.
  recomputeBbox(internal);
  routings.length = 0;
  for (const r of remaining) routings.push(r);
  for (const r of newRoutings) routings.push(r);

  return { ok: true, rerouted: newRoutings };

  function rollback(): void {
    // chest 위치 복구 (두 영역 객체 모두).
    chest!.origin = oldOrigin;
    if (chestInInternal && chestInInternal !== chest) {
      chestInInternal.origin = oldOrigin;
    }
    // 새로 push 한 chest 셀 제거.
    internal.placed = internal.placed.filter(
      (p) => !(p.x === newOrigin.x && p.y === newOrigin.y && p.cell.entityId === chest!.id),
    );
    // 새로 commit 된 라우팅 셀 제거.
    const newRoutingCells = new Set<string>();
    for (const r of newRoutings) {
      for (const p of r.placed) newRoutingCells.add(`${p.x},${p.y}`);
    }
    if (newRoutingCells.size > 0) {
      internal.placed = internal.placed.filter((p) => !newRoutingCells.has(`${p.x},${p.y}`));
    }
    // 옛 chest 셀 + 옛 라우팅 셀 복구.
    internal.placed.push(makeContainerCell(chest!, oldOrigin));
    for (const p of removedCells) internal.placed.push(p);

    recomputeBbox(internal);
    routings.length = 0;
    for (const r of originalRoutings) routings.push(r);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 클론 — UI 가 드래그를 시도하는 동안 원본 후보를 보호하기 위한 deep-clone.
// ─────────────────────────────────────────────────────────────────────────────

export function cloneArea(a: Area): Area {
  return {
    kind: a.kind,
    containers: a.containers.map((c) => ({
      ...c,
      origin: { ...c.origin },
      size: { ...c.size },
    })),
    placed: a.placed.map((p) => ({
      x: p.x,
      y: p.y,
      cell: { ...p.cell, tileOffset: { ...p.cell.tileOffset } },
    })),
    bbox: a.bbox ? { ...a.bbox } : undefined,
    undergroundCorridors: a.undergroundCorridors.map((c) => ({
      ...c,
      range: [c.range[0], c.range[1]],
    })),
  };
}

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
    corridors: r.corridors.map((c) => ({ ...c, range: [c.range[0], c.range[1]] })),
    area: r.area,
  };
}

function cloneKind(k: PortKind): PortKind {
  return typeof k === 'object' ? { fluid: k.fluid } : k;
}

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

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function findContainer(id: string, internal: Area, external: Area): Container | undefined {
  return (
    internal.containers.find((c) => c.id === id) ??
    external.containers.find((c) => c.id === id)
  );
}

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
