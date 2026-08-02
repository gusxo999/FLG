/**
 * 드래그 재라우팅 — **비활성 구역**(수동 편집).
 *
 * 사용자가 무한상자·조립기 그룹을 마우스로 끌면 새 자리로 옮기고 영향받은 라우팅을
 * 다시 깔던 코드다. 배치 파이프라인이 아니라 **사후 편집** 경로다.
 *
 * 지금은 호출자가 없다 — `setRoutingEditSession` 이 제거돼 세션이 항상 null 이다.
 * 무엇을 하려던 코드인지는 [README.md](../../../../docs/README.md) 참조.
 */

import type {
  Area,
  Container,
  PortKind,
  Routing,
} from '../containerModel';
import { commitRouting } from '../execution/emitPath';
import { AUTO_LAYOUT_COORD_DUMP } from '../debugFlags';
import { expandBbox } from '../util/helper';
import { makeContainerCell } from '../util/cellBuilder';
import { routeWithFallback, type RouteOptions } from './routeFallback';
import { computeMachineRoutingBbox } from '../areaUnification';

/**
 * 외부상자 드래그 재라우팅에서 쓰는 벨트 꺾임 penalty. 양수면 곧은 벨트를 선호해
 * 계단/대각형 벨트를 줄이고, 상자 같은 장애물을 *우회* 대신 *직진 점프* 로 넘긴다
 * (상자 우회는 무의미; 벨트 우회는 별도로 여전히 허용됨). 사용자가 외부상자를 한
 * 점으로 모으려 드래그할 때 가독성을 높인다.
 */
export const DRAG_BELT_TURN_PENALTY = 2;


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
 *  2. external.placed 의 chest 셀을 새 자리로 이동
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

  const _dumpCell = (p: { x: number; y: number; cell: { entityType: string; entityId?: string | null; direction?: number | null } }) =>
    ({ x: p.x, y: p.y, entityType: p.cell.entityType, entityId: p.cell.entityId, direction: p.cell.direction });

  if (AUTO_LAYOUT_COORD_DUMP) {
    console.log('[autoLayout debug] dragExternalContainer — attempt\n' + JSON.stringify({
      containerId,
      from: oldOrigin,
      to: newOrigin,
      'grid.before.internal': internal.placed.map(_dumpCell),
      'grid.before.external': external.placed.map(_dumpCell),
    }, null, 2));
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

  // 1.5) 간격 0 스냅 — 새 위치가 연결 머신에 딱 붙으면(인서터 자리 없음) 우회가
  // 강제된다. 요청한 열/행은 유지한 채 머신에서 1칸 바깥으로 밀어 1칸 간격이
  // 생기는 자유 셀로 보정 → 깔끔한 단일 인서터가 재형성된다. 보정 불가면 요청 위치 유지.
  {
    const selfKey = `${oldOrigin.x},${oldOrigin.y}`;
    const originFree = (x: number, y: number): boolean =>
      !internal.placed.some((p) => p.x === x && p.y === y && !affectedRoutingCells.has(`${p.x},${p.y}`)) &&
      !external.placed.some((p) => p.x === x && p.y === y && `${p.x},${p.y}` !== selfKey);
    const rectAt = (x: number, y: number): Rect => ({ x, y, w: chest.size.w, h: chest.size.h });

    const touched = affected.find((r) => {
      if (r.kind !== 'item') return false;
      const otherId = r.from.containerId === containerId ? r.to.containerId : r.from.containerId;
      const other = findContainer(otherId, internal, external);
      return !!other && other.kind === 'machine'
        && lacksInserterGap(rectAt(newOrigin.x, newOrigin.y), containerRect(other));
    });
    if (touched) {
      const otherId = touched.from.containerId === containerId ? touched.to.containerId : touched.from.containerId;
      const machine = findContainer(otherId, internal, external)!;
      // 머신 중심 → 상자 중심 방향의 우세 축으로 바깥 방향 결정.
      const ddx = (newOrigin.x + chest.size.w / 2) - (machine.origin.x + machine.size.w / 2);
      const ddy = (newOrigin.y + chest.size.h / 2) - (machine.origin.y + machine.size.h / 2);
      const dir = Math.abs(ddy) >= Math.abs(ddx)
        ? { x: 0, y: ddy >= 0 ? 1 : -1 }
        : { x: ddx >= 0 ? 1 : -1, y: 0 };
      let sx = newOrigin.x, sy = newOrigin.y;
      const SNAP_MAX = 4;
      for (let i = 0; i < SNAP_MAX && lacksInserterGap(rectAt(sx, sy), containerRect(machine)); i++) {
        sx += dir.x; sy += dir.y;
      }
      if (!lacksInserterGap(rectAt(sx, sy), containerRect(machine)) && originFree(sx, sy)) {
        if (AUTO_LAYOUT_COORD_DUMP) {
          console.log('[autoLayout debug] dragExternalContainer — snap (gap0)\n' + JSON.stringify({
            containerId, requested: newOrigin, snappedTo: { x: sx, y: sy }, partner: otherId,
          }, null, 2));
        }
        newOrigin = { x: sx, y: sy };
      }
    }
  }

  // 2) 새 자리가 자유 셀인지 확인 (자기 셀 + 영향분 라우팅 셀 제외).
  const internalCollision = internal.placed.some(
    (p) =>
      !affectedRoutingCells.has(`${p.x},${p.y}`) &&
      p.x === newOrigin.x &&
      p.y === newOrigin.y,
  );
  const externalSelfKey = `${oldOrigin.x},${oldOrigin.y}`;
  const externalCollision = external.placed.some(
    (p) =>
      `${p.x},${p.y}` !== externalSelfKey &&
      p.x === newOrigin.x &&
      p.y === newOrigin.y,
  );
  if (internalCollision || externalCollision) {
    if (AUTO_LAYOUT_COORD_DUMP) {
      console.log('[autoLayout debug] dragExternalContainer — FAILED (collision)\n' + JSON.stringify({
        containerId,
        from: oldOrigin,
        to: newOrigin,
        internalCollision,
        externalCollision,
      }, null, 2));
    }
    return { ok: false, reason: 'collision' };
  }

  // 3) 영향분 라우팅 셀 (internal) + 옛 chest 셀 (external) 제거.
  const removedCells: typeof internal.placed = [];
  internal.placed = internal.placed.filter((p) => {
    if (affectedRoutingCells.has(`${p.x},${p.y}`)) {
      removedCells.push(p);
      return false;
    }
    return true;
  });
  external.placed = external.placed.filter(
    (p) => !(p.x === oldOrigin.x && p.y === oldOrigin.y && p.cell.entityId === chest.id),
  );

  // 4) chest 위치 갱신 + 새 chest 셀 push.
  chest.origin = { ...newOrigin };
  if (chestInInternal && chestInInternal !== chest) {
    chestInInternal.origin = { ...newOrigin };
  }
  external.placed.push(makeContainerCell(chest, newOrigin));

  // 5) 영향분 라우팅 재시도.
  const originalRoutings = [...routings];
  const remaining = routings.filter(
    (r) => !(r.from.containerId === containerId || r.to.containerId === containerId),
  );

  // 드래그 재라우팅 옵션 — 호출자가 명시한 값은 존중하고, 미지정 항목만 드래그 기본값으로 채운다.
  //  • turnPenalty: 가독성 우선(곧은 벨트 + 상자 직진 점프, 상자 우회 회피).
  //  • routingBounds: 단일 외곽 ring 불변식 — 재라우팅 belt 가 ring 바깥으로 새지 못하게
  //    가둔다(상자를 한 점으로 모을 때도 통로가 둘레 밖으로 돌면 안 됨). ring = 현재 레이아웃
  //    직사각형 = 내부 머신 + 외부 chest 전체의 bbox(이 시점엔 상자가 이미 새 위치로 이동·셀
  //    갱신된 상태라 = 새 레이아웃 범위). ring 안에서 길을 못 찾으면 라우팅 실패 → 드래그 거부(롤백).
  const layoutBounds = boundsOfCells([
    ...internal.placed.map((p) => ({ x: p.x, y: p.y })),
    ...external.placed.map((p) => ({ x: p.x, y: p.y })),
  ]);
  const dragOptions: RouteOptions = {
    ...options,
    turnPenalty: options.turnPenalty ?? DRAG_BELT_TURN_PENALTY,
    routingBounds: options.routingBounds ?? layoutBounds,
  };

  const newRoutings: Routing[] = [];
  for (const r of affected) {
    const otherId =
      r.from.containerId === containerId ? r.to.containerId : r.from.containerId;
    const other = findContainer(otherId, internal, external);
    if (!other) {
      rollback();
      if (AUTO_LAYOUT_COORD_DUMP) {
        console.log('[autoLayout debug] dragExternalContainer — FAILED (no-port-pair: other container not found)\n' + JSON.stringify({
          containerId, from: oldOrigin, to: newOrigin, failedRouting: r.id,
        }, null, 2));
      }
      return { ok: false, reason: 'no-port-pair', failedRouting: r.id };
    }
    const producer = r.from.containerId === containerId ? chest : other;
    const consumer = r.to.containerId === containerId ? chest : other;
    const kind: PortKind = r.kind === 'fluid'
      ? { fluid: deriveFluidName(r) ?? '' }
      : 'item';
    const attempt = routeWithFallback(producer, consumer, kind, internal, dragOptions, external, true);
    if (!attempt.ok) {
      rollback();
      if (AUTO_LAYOUT_COORD_DUMP) {
        console.log('[autoLayout debug] dragExternalContainer — FAILED (routing)\n' + JSON.stringify({
          containerId, from: oldOrigin, to: newOrigin,
          failedRouting: r.id, reason: attempt.reason,
        }, null, 2));
      }
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

  if (AUTO_LAYOUT_COORD_DUMP) {
    console.log('[autoLayout debug] dragExternalContainer — SUCCESS\n' + JSON.stringify({
      containerId,
      from: oldOrigin,
      to: newOrigin,
      reroutedCount: newRoutings.length,
      'grid.after.internal': internal.placed.map(_dumpCell),
      'grid.after.external': external.placed.map(_dumpCell),
    }, null, 2));
  }
  return { ok: true, rerouted: newRoutings };

  function rollback(): void {
    // chest 위치 복구 (두 영역 객체 모두).
    chest!.origin = oldOrigin;
    if (chestInInternal && chestInInternal !== chest) {
      chestInInternal.origin = oldOrigin;
    }
    // 새로 push 한 chest 셀 (external) 제거.
    external.placed = external.placed.filter(
      (p) => !(p.x === newOrigin.x && p.y === newOrigin.y && p.cell.entityId === chest!.id),
    );
    // 새로 commit 된 라우팅 셀 (internal) 제거.
    const newRoutingCells = new Set<string>();
    for (const r of newRoutings) {
      for (const p of r.placed) newRoutingCells.add(`${p.x},${p.y}`);
    }
    if (newRoutingCells.size > 0) {
      internal.placed = internal.placed.filter((p) => !newRoutingCells.has(`${p.x},${p.y}`));
    }
    // 옛 chest 셀 (external) + 옛 라우팅 셀 (internal) 복구.
    external.placed.push(makeContainerCell(chest!, oldOrigin));
    for (const p of removedCells) internal.placed.push(p);

    recomputeBbox(internal);
    routings.length = 0;
    for (const r of originalRoutings) routings.push(r);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// dragAssemblerGroup — 조립기계 그룹(부모+자손)을 (dx,dy) 이동 + 라우팅 재시도
// ─────────────────────────────────────────────────────────────────────────────

export type AssemblerDragResult =
  | {
      ok: true;
      rerouted: Routing[];
      shiftedInternalRoutingIds: string[];
      perimeterBbox: { x: number; y: number; w: number; h: number } | undefined;
    }
  | { ok: false; reason: 'no-port-pair' | 'no-path' | 'collision'; failedRouting?: string };

/**
 * 조립기계 그룹을 (dx,dy) 평행이동하고 영향받은 라우팅을 재시도한다.
 *
 * - 그룹 = containerId + machineChildren 후손 머신 (BFS).
 * - 그룹 내부 라우팅(both ends in group): (dx,dy) 평행이동만.
 * - 경계 라우팅(one end in group): 새 위치 기준 routeWithFallback 재시도.
 * - 외부상자 위치는 고정 — 사용자 의도대로 perimeter 재배치는 하지 않는다.
 * - 어떤 단계든 실패 시 모든 mutation rollback.
 *
 * `dragExternalContainer` 와 같은 패턴: 호출자가 Area 객체를 deep-clone 해서 넘기면
 * 이 함수가 직접 mutate. 성공 시 호출자는 그대로 commit, 실패 시 clone 을 버리면 된다.
 */
export function dragAssemblerGroup(
  containerId: string,
  dx: number,
  dy: number,
  machineChildren: Record<string, string[]>,
  internal: Area,
  external: Area,
  routings: Routing[],
  options: RouteOptions,
): AssemblerDragResult {
  if (dx === 0 && dy === 0) {
    return {
      ok: true,
      rerouted: [],
      shiftedInternalRoutingIds: [],
      perimeterBbox: computeMachineRoutingBbox(internal),
    };
  }

  // 1) BFS — 그룹 = containerId + 후손 머신
  const groupIds = new Set<string>([containerId]);
  const queue: string[] = [containerId];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const child of (machineChildren[curr] ?? [])) {
      if (!groupIds.has(child)) {
        groupIds.add(child);
        queue.push(child);
      }
    }
  }

  // 2) 영향받은 라우팅 분류
  const internalGroupRoutings: Routing[] = [];
  const boundaryRoutings: Routing[] = [];
  for (const r of routings) {
    const fi = groupIds.has(r.from.containerId);
    const ti = groupIds.has(r.to.containerId);
    if (fi && ti) internalGroupRoutings.push(r);
    else if (fi || ti) boundaryRoutings.push(r);
  }
  const affectedRoutingIds = new Set<string>([
    ...internalGroupRoutings.map((r) => r.id),
    ...boundaryRoutings.map((r) => r.id),
  ]);

  // 3) 그룹 머신 셀 + 영향분 라우팅 셀 좌표 수집
  const groupMachineCells = internal.placed.filter(
    (p) => p.cell.entityId !== null && groupIds.has(p.cell.entityId),
  );
  const affectedRoutingCellKeys = new Set<string>();
  for (const r of [...internalGroupRoutings, ...boundaryRoutings]) {
    for (const p of r.placed) affectedRoutingCellKeys.add(`${p.x},${p.y}`);
  }

  const _dumpCell = (p: {
    x: number; y: number;
    cell: { entityType: string; entityId?: string | null; direction?: number | null };
  }) => ({
    x: p.x, y: p.y,
    entityType: p.cell.entityType,
    entityId: p.cell.entityId,
    direction: p.cell.direction,
  });

  if (AUTO_LAYOUT_COORD_DUMP) {
    console.log('[autoLayout debug] dragAssemblerGroup — attempt\n' + JSON.stringify({
      containerId,
      groupIds: [...groupIds],
      delta: { dx, dy },
      'grid.before.internal': internal.placed.map(_dumpCell),
      'grid.before.external': external.placed.map(_dumpCell),
      affectedRoutings: {
        internal: internalGroupRoutings.map((r) => r.id),
        boundary: boundaryRoutings.map((r) => r.id),
      },
    }, null, 2));
  }

  // 4) 충돌 검사 — 그룹 셀들의 새 좌표가 (그룹 셀 + 영향분 라우팅 셀) 외 셀과 부딪히는지
  const groupCellKeys = new Set(groupMachineCells.map((p) => `${p.x},${p.y}`));
  const skipKeys = new Set<string>([...groupCellKeys, ...affectedRoutingCellKeys]);

  for (const p of groupMachineCells) {
    const nx = p.x + dx;
    const ny = p.y + dy;
    const nKey = `${nx},${ny}`;
    if (skipKeys.has(nKey)) continue;
    const internalCollision = internal.placed.some(
      (q) => q.x === nx && q.y === ny && !skipKeys.has(`${q.x},${q.y}`),
    );
    const externalCollision = external.placed.some((q) => q.x === nx && q.y === ny);
    if (internalCollision || externalCollision) {
      if (AUTO_LAYOUT_COORD_DUMP) {
        console.log('[autoLayout debug] dragAssemblerGroup — FAILED (collision)\n' + JSON.stringify({
          containerId,
          groupIds: [...groupIds],
          delta: { dx, dy },
          collidingAt: { x: nx, y: ny },
          internalCollision,
          externalCollision,
        }, null, 2));
      }
      return { ok: false, reason: 'collision' };
    }
  }

  // 5) Mutate — rollback 을 위해 원본 상태 저장
  const originalContainerOrigins = new Map<string, { x: number; y: number }>();
  for (const c of internal.containers) {
    if (groupIds.has(c.id)) originalContainerOrigins.set(c.id, { ...c.origin });
  }
  for (const c of external.containers) {
    if (groupIds.has(c.id) && !originalContainerOrigins.has(c.id)) {
      originalContainerOrigins.set(c.id, { ...c.origin });
    }
  }
  const originalRoutings = [...routings];
  const removedMachineCells: typeof internal.placed = [];
  const removedRoutingCells: typeof internal.placed = [];

  // 5a) 영향분 라우팅 셀 제거
  internal.placed = internal.placed.filter((p) => {
    if (affectedRoutingCellKeys.has(`${p.x},${p.y}`)) {
      removedRoutingCells.push(p);
      return false;
    }
    return true;
  });

  // 5b) 그룹 머신 셀 제거 후 새 좌표로 재배치
  internal.placed = internal.placed.filter((p) => {
    if (p.cell.entityId !== null && groupIds.has(p.cell.entityId)) {
      removedMachineCells.push(p);
      return false;
    }
    return true;
  });
  for (const p of removedMachineCells) {
    internal.placed.push({ x: p.x + dx, y: p.y + dy, cell: p.cell });
  }

  // 5c) 그룹 컨테이너 origin 갱신 (internal/external 양쪽)
  for (const c of internal.containers) {
    if (groupIds.has(c.id)) c.origin = { x: c.origin.x + dx, y: c.origin.y + dy };
  }
  for (const c of external.containers) {
    if (groupIds.has(c.id)) c.origin = { x: c.origin.x + dx, y: c.origin.y + dy };
  }

  // 5d) 그룹 내부 라우팅은 (dx,dy) 평행이동 후 다시 push
  for (const r of internalGroupRoutings) {
    r.placed = r.placed.map((p) => ({ x: p.x + dx, y: p.y + dy, cell: p.cell }));
    for (const p of r.placed) internal.placed.push(p);
  }

  // 6) 새 머신 bbox 계산 (반환값·디버그용)
  const newMachineBbox = computeMachineRoutingBbox(internal);

  // 7) 경계 라우팅 재시도
  const remaining = routings.filter((r) => !affectedRoutingIds.has(r.id));
  const newRoutings: Routing[] = [];
  for (const r of boundaryRoutings) {
    const fromC = findContainer(r.from.containerId, internal, external);
    const toC = findContainer(r.to.containerId, internal, external);
    if (!fromC || !toC) {
      rollback();
      if (AUTO_LAYOUT_COORD_DUMP) {
        console.log('[autoLayout debug] dragAssemblerGroup — FAILED (no-port-pair)\n' + JSON.stringify({
          containerId, delta: { dx, dy }, failedRouting: r.id,
        }, null, 2));
      }
      return { ok: false, reason: 'no-port-pair', failedRouting: r.id };
    }
    const kind: PortKind = r.kind === 'fluid'
      ? { fluid: deriveFluidName(r) ?? '' }
      : 'item';
    const attempt = routeWithFallback(fromC, toC, kind, internal, options, external, true);
    if (!attempt.ok) {
      rollback();
      if (AUTO_LAYOUT_COORD_DUMP) {
        console.log('[autoLayout debug] dragAssemblerGroup — FAILED (routing)\n' + JSON.stringify({
          containerId,
          delta: { dx, dy },
          failedRouting: r.id,
          reason: attempt.reason,
        }, null, 2));
      }
      return { ok: false, reason: attempt.reason, failedRouting: r.id };
    }
    commitRouting(attempt.routing, internal);
    newRoutings.push(attempt.routing);
  }

  // 8) routings 배열 갱신: remaining + 그룹내부(평행이동) + 경계(새 라우팅)
  routings.length = 0;
  for (const r of remaining) routings.push(r);
  for (const r of internalGroupRoutings) routings.push(r);
  for (const r of newRoutings) routings.push(r);

  recomputeBbox(internal);

  if (AUTO_LAYOUT_COORD_DUMP) {
    console.log('[autoLayout debug] dragAssemblerGroup — SUCCESS\n' + JSON.stringify({
      containerId,
      groupIds: [...groupIds],
      delta: { dx, dy },
      reroutedCount: newRoutings.length,
      shiftedInternalRoutingCount: internalGroupRoutings.length,
      perimeterBbox: newMachineBbox,
      'grid.after.internal': internal.placed.map(_dumpCell),
      'grid.after.external': external.placed.map(_dumpCell),
    }, null, 2));
  }

  return {
    ok: true,
    rerouted: newRoutings,
    shiftedInternalRoutingIds: internalGroupRoutings.map((r) => r.id),
    perimeterBbox: newMachineBbox,
  };

  function rollback(): void {
    // 새로 commit 된 라우팅 셀 제거
    const newRoutingCellKeys = new Set<string>();
    for (const r of newRoutings) {
      for (const p of r.placed) newRoutingCellKeys.add(`${p.x},${p.y}`);
    }
    if (newRoutingCellKeys.size > 0) {
      internal.placed = internal.placed.filter(
        (p) => !newRoutingCellKeys.has(`${p.x},${p.y}`),
      );
    }

    // 그룹 내부 라우팅 셀 (이미 평행이동 후 push 됨) 제거
    const shiftedInternalCellKeys = new Set<string>();
    for (const r of internalGroupRoutings) {
      for (const p of r.placed) shiftedInternalCellKeys.add(`${p.x},${p.y}`);
    }
    if (shiftedInternalCellKeys.size > 0) {
      internal.placed = internal.placed.filter(
        (p) => !shiftedInternalCellKeys.has(`${p.x},${p.y}`),
      );
    }

    // 그룹 머신 셀 (평행이동 후) 제거 → 원래 좌표로 복원
    internal.placed = internal.placed.filter(
      (p) => !(p.cell.entityId !== null && groupIds.has(p.cell.entityId)),
    );
    for (const p of removedMachineCells) internal.placed.push(p);

    // 영향분 라우팅 셀 원복
    for (const p of removedRoutingCells) internal.placed.push(p);

    // 그룹 내부 라우팅 좌표 원복
    for (const r of internalGroupRoutings) {
      r.placed = r.placed.map((p) => ({ x: p.x - dx, y: p.y - dy, cell: p.cell }));
    }

    // 컨테이너 origin 원복
    for (const c of internal.containers) {
      const orig = originalContainerOrigins.get(c.id);
      if (orig) c.origin = { ...orig };
    }
    for (const c of external.containers) {
      const orig = originalContainerOrigins.get(c.id);
      if (orig) c.origin = { ...orig };
    }

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
    // 포트 산출 메타 — 불변 결정 데이터라 참조 공유로 충분(드래그 후에도 유지).
    fromPortMeta: r.fromPortMeta,
    toPortMeta: r.toPortMeta,
  };
}

function cloneKind(k: PortKind): PortKind {
  return typeof k === 'object' ? { fluid: k.fluid } : k;
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

type Rect = { x: number; y: number; w: number; h: number };

function containerRect(c: Container): Rect {
  return { x: c.origin.x, y: c.origin.y, w: c.size.w, h: c.size.h };
}

/**
 * 두 footprint 사이에 아이템 인서터가 들어갈 1칸 간격이 없으면 true.
 * gapX/gapY = 두 사각형 사이의 빈 열/행 수(겹치면 음수, 맞닿으면 0, 떨어지면 ≥1).
 * 둘 다 0 이하 → 맞닿거나 겹침 → 인서터 자리 없음 → 직결 불가(우회 강제).
 */
function lacksInserterGap(a: Rect, b: Rect): boolean {
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  return gapX <= 0 && gapY <= 0;
}

function deriveFluidName(r: Routing): string | undefined {
  const k = r.from.kind;
  if (typeof k === 'object' && 'fluid' in k) return k.fluid;
  const k2 = r.to.kind;
  if (typeof k2 === 'object' && 'fluid' in k2) return k2.fluid;
  return undefined;
}

/** 셀 목록의 포함 경계(min/max). ring 직사각형 → routingBounds 변환에 사용. */
export function boundsOfCells(
  cells: ReadonlyArray<{ x: number; y: number }>,
): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) {
    if (c.x < x0) x0 = c.x;
    if (c.y < y0) y0 = c.y;
    if (c.x > x1) x1 = c.x;
    if (c.y > y1) y1 = c.y;
  }
  return { x0, y0, x1, y1 };
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

