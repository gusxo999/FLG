/**
 * 외부 상자 집결(External Chest Consolidation) — 맨 마지막 후처리 패스.
 *
 * 같은 품목(content)·같은 role(입력/출력)의 외부 무한상자들을 공간적으로 한 군데로
 * 인접 이동시켜, 품목당 **외부 물류 접점이 한 곳**이 되게 한다(봇/메인버스 등 외부
 * 연결 간소화). 흐름을 합치는 게 *아니다* — 각 상자는 자기 머신으로 가는 자기 belt를
 * 그대로 따로 유지하며(상자 N개 = belt N줄), 위치만 모이고 belt가 연장될 뿐이다.
 *
 *   그룹화(품목+role) → 앵커 결정 → 읽기순서로 인접 이송 → 그룹 폴백
 *
 * 앵커(집결 지점) 결정:
 *   - 그 품목에 **트렁크 대표 상자**(`${id}#trunk` 라우팅 보유)가 있으면, 대표는 *고정*
 *     (트렁크 belt 무손상)하고 1:1 상자들을 가장 가까운 대표 옆 같은 변 lane 으로 모은다.
 *     대표가 여러 개면 1:1 상자는 가장 가까운 대표로 배정(대표별 다중 점 허용).
 *   - 트렁크 대표가 없으면, 1:1 상자들끼리 머신 centroid 최근접 변으로 모은다.
 *
 * 트렁크 병합(`externalMergePass`)의 "병합"과 혼동 금지: 병합은 여러 상자를 대표 1개+
 * 트렁크 1줄로 *합치고* 흐름을 합류시키지만, 집결은 상자를 *합치지 않고* 한 자리에
 * 모으기만 한다. 트렁크 대표 자체는 본 패스에서 **이동하지 않는다**(고정 앵커).
 *
 * 안전: 한 상자라도 이동/재라우팅이 실패하면 *그 하위그룹만* 스냅샷으로 원상복구한다
 * (= 집결 전 배치 그대로). 다른 그룹·트렁크·타 라우팅에는 영향이 없다.
 */

import {
  computeMachineFootprintBbox,
  dragExternalContainer,
  sideOfMachine,
  MIN_EXTERNAL_OFFSET,
  MAX_EXTERNAL_SEARCH_RADIUS,
  type PerimeterSide,
} from './areaUnification';
import { AUTO_LAYOUT_COORD_DUMP } from './debugFlags';
import type { Area, PendingConnection, Routing } from './containerModel';
import type { RouteOptions } from './routeFallback';

export interface GatherConfig {
  enabled: boolean;
}

export const DEFAULT_GATHER_CONFIG: GatherConfig = {
  enabled: false,
};

/** 모듈 토글 — `AUTO_LAYOUT_MERGE_BOXES` 와 같은 패턴. UI/콘솔 런타임 on/off. 기본 ON. */
export let AUTO_LAYOUT_GATHER_EXTERNALS = true;

export function setAutoLayoutGatherExternals(v: boolean): void {
  AUTO_LAYOUT_GATHER_EXTERNALS = v;
}

type Role = 'input' | 'output';
type Pt = { x: number; y: number };
type Bbox = { x: number; y: number; w: number; h: number };

interface GatherMember {
  chestId: string;
  /** 연결된 머신의 origin (centroid·정렬 기준). */
  machineOrigin: Pt;
  /** 현재 상자 origin (이송 전). */
  current: Pt;
}

/** 트렁크 대표 상자 — 이동하지 않는 고정 집결 지점. */
interface Anchor {
  chestId: string;
  origin: Pt;
}

interface SubLog {
  key: string;
  mode: 'anchored' | 'centroid';
  size: number;
  result: 'moved' | 'no-slot' | 'fallback';
  reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 외부 상자 집결 패스. `wrapExternals*` 직후, 가장 마지막에 호출한다.
 * 비활성/머신없음/대상없음이면 no-op(기존 동작 불변).
 */
export function gatherExternalsToPoints(
  internal: Area,
  external: Area,
  routings: Routing[],
  connections: PendingConnection[],
  options: RouteOptions,
  cfg: GatherConfig,
): { groupsGathered: number; groupsFailed: number } {
  const machineBbox = computeMachineFootprintBbox(internal);
  if (!cfg.enabled || !machineBbox) {
    return { groupsGathered: 0, groupsFailed: 0 };
  }

  const externalIds = new Set(external.containers.map((c) => c.id));

  // chestId → 연결 머신 id (item 연결만). 현재 모델은 chest 1개당 머신 1개(1:1).
  const machineIdByChest = new Map<string, string>();
  for (const conn of connections) {
    if (conn.kind !== 'item') continue;
    const prodIsChest = externalIds.has(conn.producerId);
    const consIsChest = externalIds.has(conn.consumerId);
    if (prodIsChest && !consIsChest) machineIdByChest.set(conn.producerId, conn.consumerId);
    else if (consIsChest && !prodIsChest) machineIdByChest.set(conn.consumerId, conn.producerId);
  }

  // 트렁크 대표 상자 id — `${chestId}#trunk` 라우팅 보유. 고정 앵커로 쓰고 이동하지 않는다.
  const trunkChestIds = new Set<string>();
  for (const r of routings) {
    const m = /^(.*)#trunk$/.exec(r.id);
    if (m) trunkChestIds.add(m[1]);
  }

  // 그룹화: (role, content) → 1:1 멤버 + 트렁크 앵커.
  const membersByKey = new Map<string, GatherMember[]>();
  const anchorsByKey = new Map<string, Anchor[]>();
  for (const chest of external.containers) {
    if (chest.kind !== 'infinity-chest') continue; // fluid(파이프) 제외
    if (!chest.content || !chest.role) continue;
    const key = `${chest.role}::${chest.content}`;
    if (trunkChestIds.has(chest.id)) {
      pushTo(anchorsByKey, key, { chestId: chest.id, origin: { ...chest.origin } });
      continue;
    }
    const machineId = machineIdByChest.get(chest.id);
    if (!machineId) continue;
    const machine = internal.containers.find((c) => c.id === machineId);
    if (!machine) continue;
    pushTo(membersByKey, key, {
      chestId: chest.id,
      machineOrigin: { ...machine.origin },
      current: { ...chest.origin },
    });
  }

  // 그룹 간 ≥1칸 공백을 위해 패스 전체에 걸쳐 확정된 셀을 reserve.
  const reserved = new Set<string>();
  const logs: SubLog[] = [];
  let groupsGathered = 0;
  let groupsFailed = 0;

  const account = (key: string, mode: SubLog['mode'], size: number,
    r: { ok: true; reservedCells: string[] } | { ok: false; reason: string }) => {
    if (r.ok) {
      groupsGathered += 1;
      for (const k of r.reservedCells) reserved.add(k);
      logs.push({ key, mode, size, result: 'moved' });
    } else {
      groupsFailed += 1;
      logs.push({ key, mode, size, result: r.reason === 'no-slot' ? 'no-slot' : 'fallback', reason: r.reason });
    }
  };

  // 결정적 순서(키 정렬)로 그룹 처리.
  for (const key of [...membersByKey.keys()].sort()) {
    const members = membersByKey.get(key)!;
    const anchors = anchorsByKey.get(key) ?? [];

    if (anchors.length === 0) {
      // 앵커 없음 → 1:1 상자들끼리 centroid 최근접 변으로. 단독은 모을 것 없음.
      if (members.length < 2) continue;
      const side = nearestSide(members, machineBbox);
      account(key, 'centroid', members.length,
        gatherCentroid(members, side, machineBbox, internal, external, routings, options, reserved));
      continue;
    }

    // 앵커 있음 → 각 1:1 상자를 가장 가까운 앵커로 배정해 그 옆으로 모은다.
    const byAnchor = new Map<number, GatherMember[]>();
    for (const m of members) {
      let bestI = 0, bestD = Infinity;
      for (let i = 0; i < anchors.length; i++) {
        const d = manhattan(m.current, anchors[i].origin);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      pushTo(byAnchor, bestI, m);
    }
    for (const [ai, assigned] of byAnchor) {
      account(key, 'anchored', assigned.length,
        gatherAnchored(anchors[ai], assigned, machineBbox, internal, external, routings, options, reserved));
    }
  }

  recomputeInternalBbox(internal);

  if (AUTO_LAYOUT_COORD_DUMP) {
    console.log('[autoLayout debug] gatherExternalsToPoints\n' + JSON.stringify({
      subgroups: logs, groupsGathered, groupsFailed,
    }, null, 2));
  }

  return { groupsGathered, groupsFailed };
}

// ─────────────────────────────────────────────────────────────────────────────
// 집결 — centroid(앵커 없음) / anchored(트렁크 대표 옆)
// ─────────────────────────────────────────────────────────────────────────────

type GatherResult = { ok: true; reservedCells: string[] } | { ok: false; reason: string };

/** 앵커 없는 그룹: 머신 centroid 최근접 변의 한 줄로 모은다. */
function gatherCentroid(
  members: GatherMember[],
  side: PerimeterSide,
  mb: Bbox,
  internal: Area,
  external: Area,
  routings: Routing[],
  options: RouteOptions,
  reserved: Set<string>,
): GatherResult {
  const size = members.length;
  const horiz = isHorizontalSide(side);

  let center = 0;
  for (const m of members) center += horiz ? m.machineOrigin.x : m.machineOrigin.y;
  center = Math.round(center / size);

  const free = cellFreeFn(members, internal, external, reserved);

  // 슬롯 탐색: 안쪽 반경부터(ring 최소 확장) 바깥으로. 중심 부근의 연속 size칸 +
  // 양끝 1칸(타 그룹과 ≥1 공백) 을 찾는다.
  const span = (horiz ? mb.w : mb.h) + size * 2 + 4;
  let slot: { R: number; t0: number } | null = null;
  for (let R = MIN_EXTERNAL_OFFSET; R <= MAX_EXTERNAL_SEARCH_RADIUS && !slot; R++) {
    const centeredStart = center - Math.floor((size - 1) / 2);
    for (let d = 0; d <= span && !slot; d++) {
      for (const t0 of d === 0 ? [centeredStart] : [centeredStart + d, centeredStart - d]) {
        const run: Pt[] = [];
        for (let i = 0; i < size; i++) run.push(laneCell(side, R, t0 + i, mb));
        if (!run.every(free)) continue;
        const before = laneCell(side, R, t0 - 1, mb);
        const after = laneCell(side, R, t0 + size, mb);
        if (reserved.has(key(before)) || reserved.has(key(after))) continue;
        slot = { R, t0 };
        break;
      }
    }
  }
  if (!slot) return { ok: false, reason: 'no-slot' };

  const targets: Pt[] = [];
  for (let i = 0; i < size; i++) targets.push(laneCell(side, slot.R, slot.t0 + i, mb));
  return runMoves(members, targets, horiz, internal, external, routings, options);
}

/**
 * 트렁크 대표(앵커) 옆으로 모은다 — 앵커는 *이동하지 않고*, 1:1 상자들을 앵커와
 * 같은 변·반경 lane 의 인접 셀로 채운다. 앵커 한쪽 방향(읽기순서 우선)에 연속 자리가
 * 없으면 반대 방향을 시도하고, 둘 다 막히면 폴백.
 */
function gatherAnchored(
  anchor: Anchor,
  members: GatherMember[],
  mb: Bbox,
  internal: Area,
  external: Area,
  routings: Routing[],
  options: RouteOptions,
  reserved: Set<string>,
): GatherResult {
  const size = members.length;
  const { side, R } = sideRadiusOf(anchor.origin, mb);
  const horiz = isHorizontalSide(side);
  const anchorT = horiz ? anchor.origin.x : anchor.origin.y;

  const free = cellFreeFn(members, internal, external, reserved);

  let targets: Pt[] | null = null;
  for (const dir of [1, -1]) {
    const run: Pt[] = [];
    for (let i = 1; i <= size; i++) run.push(laneCell(side, R, anchorT + dir * i, mb));
    if (!run.every(free)) continue;
    // 먼 끝 버퍼만 타 그룹과 ≥1 공백 확인(앵커 쪽 끝은 같은 그룹이라 붙어도 됨).
    const buffer = laneCell(side, R, anchorT + dir * (size + 1), mb);
    if (reserved.has(key(buffer))) continue;
    run.sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
    targets = run;
    break;
  }
  if (!targets) return { ok: false, reason: 'no-slot' };

  const res = runMoves(members, targets, horiz, internal, external, routings, options);
  // 앵커 셀도 reserve 에 포함해 이웃 그룹이 ≥1 공백을 두게 한다.
  if (res.ok) res.reservedCells.push(key(anchor.origin));
  return res;
}

/**
 * members 를 targets 로 원자적 이송(가변축 오름차순 매칭). 한 상자라도 실패하면
 * 스냅샷으로 전체 복원하고 ok=false.
 */
function runMoves(
  members: GatherMember[],
  targets: Pt[],
  horiz: boolean,
  internal: Area,
  external: Area,
  routings: Routing[],
  options: RouteOptions,
): GatherResult {
  const ordered = [...members].sort((a, b) =>
    (horiz ? a.current.x - b.current.x : a.current.y - b.current.y),
  );
  const snap = snapshot(internal, external, routings);
  for (let i = 0; i < ordered.length; i++) {
    const m = ordered[i];
    const target = targets[i];
    if (m.current.x === target.x && m.current.y === target.y) continue;
    const res = dragExternalContainer(m.chestId, { ...target }, internal, external, routings, options);
    if (!res.ok) {
      restore(internal, external, routings, snap);
      return { ok: false, reason: res.reason };
    }
  }
  return { ok: true, reservedCells: targets.map(key) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 기하 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function pushTo<K, V>(map: Map<K, V[]>, k: K, v: V): void {
  const arr = map.get(k);
  if (arr) arr.push(v);
  else map.set(k, [v]);
}

const isHorizontalSide = (s: PerimeterSide): boolean => s === 'n' || s === 's';
const key = (p: Pt): string => `${p.x},${p.y}`;
const manhattan = (a: Pt, b: Pt): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** 그룹 머신 centroid 의 머신 footprint bbox 최근접 변. */
function nearestSide(members: GatherMember[], machineBbox: Bbox): PerimeterSide {
  let cx = 0, cy = 0;
  for (const m of members) { cx += m.machineOrigin.x; cy += m.machineOrigin.y; }
  cx = Math.round(cx / members.length);
  cy = Math.round(cy / members.length);
  return sideOfMachine({ origin: { x: cx, y: cy }, size: { w: 1, h: 1 } }, machineBbox);
}

/** 앵커 origin 이 놓인 변과 그 변에서의 바깥 오프셋(반경). */
function sideRadiusOf(o: Pt, mb: Bbox): { side: PerimeterSide; R: number } {
  const dW = mb.x - o.x;
  const dE = o.x - (mb.x + mb.w - 1);
  const dN = mb.y - o.y;
  const dS = o.y - (mb.y + mb.h - 1);
  const m = Math.max(dW, dE, dN, dS);
  if (m === dW) return { side: 'w', R: Math.max(dW, 1) };
  if (m === dE) return { side: 'e', R: Math.max(dE, 1) };
  if (m === dN) return { side: 'n', R: Math.max(dN, 1) };
  return { side: 's', R: Math.max(dS, 1) };
}

/** 변 `side`, 반경 `R`, 가변축 인덱스 `t` 의 셀 좌표. */
function laneCell(side: PerimeterSide, R: number, t: number, mb: Bbox): Pt {
  switch (side) {
    case 'n': return { x: t, y: mb.y - R };
    case 's': return { x: t, y: mb.y + mb.h - 1 + R };
    case 'w': return { x: mb.x - R, y: t };
    case 'e': return { x: mb.x + mb.w - 1 + R, y: t };
  }
}

/**
 * "이 셀에 상자를 둘 수 있는가" 판정자. 그룹 멤버의 현재 셀은 비울 것이라 free 취급.
 * 호출 시점의 placed(이전 하위그룹 이동 반영) 로 occupancy 를 새로 계산한다.
 */
function cellFreeFn(
  members: GatherMember[],
  internal: Area,
  external: Area,
  reserved: Set<string>,
): (p: Pt) => boolean {
  const ownCells = new Set(members.map((m) => key(m.current)));
  const occupied = new Set<string>();
  for (const p of internal.placed) occupied.add(`${p.x},${p.y}`);
  for (const p of external.placed) occupied.add(`${p.x},${p.y}`);
  return (p: Pt): boolean => {
    const k = key(p);
    if (reserved.has(k)) return false;
    if (ownCells.has(k)) return true;
    return !occupied.has(k);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 하위그룹 원자성 — 스냅샷/복원
// ─────────────────────────────────────────────────────────────────────────────

interface Snap {
  ext: Area['placed'];
  int: Area['placed'];
  routings: Routing[];
  intOrigins: Map<string, Pt>;
  extOrigins: Map<string, Pt>;
}

function snapshot(internal: Area, external: Area, routings: Routing[]): Snap {
  return {
    ext: [...external.placed],
    int: [...internal.placed],
    routings: [...routings],
    intOrigins: new Map(internal.containers.map((c) => [c.id, { ...c.origin }])),
    extOrigins: new Map(external.containers.map((c) => [c.id, { ...c.origin }])),
  };
}

function restore(internal: Area, external: Area, routings: Routing[], s: Snap): void {
  external.placed = s.ext;
  internal.placed = s.int;
  routings.length = 0;
  for (const r of s.routings) routings.push(r);
  for (const c of internal.containers) {
    const o = s.intOrigins.get(c.id);
    if (o) c.origin = { ...o };
  }
  for (const c of external.containers) {
    const o = s.extOrigins.get(c.id);
    if (o) c.origin = { ...o };
  }
}

/** internal.bbox 를 placed 셀에서 재계산 (drag 가 변경 후 일관성 유지). */
function recomputeInternalBbox(internal: Area): void {
  if (internal.placed.length === 0) { internal.bbox = undefined; return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of internal.placed) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  internal.bbox = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
