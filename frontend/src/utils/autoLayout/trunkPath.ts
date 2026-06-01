/**
 * 트렁크 벨트 셀 경로 계산 — 그리디 성장 (Phase 2 첫 단위, 순수 기하).
 *
 * 단일 출처: 계획서 "트렁크 벨트 셀 경로 계산 — 그리디 성장".
 *
 * 같은 외부 재료를 쓰는 여러 머신을 무한상자 1개가 트렁크 벨트 1줄로 공급하는
 * 구조에서, **트렁크 벨트가 지나갈 셀**을 계산한다. 인서터/스퍼 실제 배치(②) ·
 * 그룹화 · area commit 은 이 단위의 범위 밖이다.
 *
 * 핵심 개념 (탭 셀 모델):
 *   탭 = (포트 셀 p, 면 f, reach r) → 트렁크가 관통할 셀 = p + f×r.
 *   머신은 4면 둘레 포트를 모두 후보로 둔다(포트 자유도). 인서터는 트렁크 셀
 *   옆(seat)에 앉아 belt 에서 집어 머신에 넣는다.
 *     · 일반 인서터(reach 1): seat = rim1(p),       tap = rim2(p+f)
 *     · long inserter(reach 2): seat = rim2(p+f),   tap = rim4(p+3f)
 *
 * 탐색: 머신을 **지배축 투영순**으로 방문(위빙 차단), 각 연결의 탭셀·포트·서브
 *   경로는 **굽힘 페널티 cost** 로 고른다(직선 연장 선호 → 깔끔한 L). 직선/L 로
 *   닿지 않는 머신은 `untapped` 로 빼서 ② 스퍼가 처리한다.
 */

import type { Direction } from '../../types/layout';
import type { PortFace } from './containerModel';
import { cellKey, faceVector, vectorToDirection } from './containerRouting';

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

/** 트렁크 계산에 필요한 머신의 최소 정보 (실제 호출자는 `Container` 에서 매핑). */
export interface MachineLike {
  id: string;
  origin: { x: number; y: number };
  size: { w: number; h: number };
}

export type Reach = 1 | 2;

/** 한 머신이 트렁크를 직접 탭하는 방법 1개. */
export interface TapRecord {
  machineId: string;
  /** 기준 둘레 셀 (rim1). seat 과 다를 수 있다(long). */
  port: { x: number; y: number };
  face: PortFace;
  reach: Reach;
  /** 인서터가 앉는 셀. */
  seat: { x: number; y: number };
  /** 인서터가 집어가는 트렁크 belt 셀. */
  tapCell: { x: number; y: number };
}

/** 트렁크 belt 셀 1개 (좌표 + 흐름 방향). 실제 PlacedCell 생성은 commit 단계. */
export interface TrunkCell {
  x: number;
  y: number;
  dir: Direction;
}

export interface TrunkPath {
  /** chest → 끝 순서, 흐름 방향 포함. */
  trunkCells: TrunkCell[];
  /** 상자가 앉을 perimeter 셀. */
  chestCell: { x: number; y: number };
  /** 직접 탭된 머신들. */
  covered: TapRecord[];
  /** 직접 탭 실패 → ② 스퍼가 처리할 머신 id 들. */
  untapped: string[];
}

export type TrunkResult =
  | { ok: true; path: TrunkPath }
  | { ok: false; infeasible: string };

export interface TrunkConfig {
  /** 꺾임 1회당 비용 (직선 연장 선호). */
  wBend: number;
  /** long inserter 사용 페널티 (normal 선호). */
  wReach: number;
  /** 시도할 chest seed 후보 최대 개수. */
  maxSeeds: number;
  /** false 면 reach-2(long inserter) 탭 후보를 생성하지 않는다. */
  allowLongInserter: boolean;
}

export const DEFAULT_TRUNK_CONFIG: TrunkConfig = {
  wBend: 4,
  wReach: 1.5,
  maxSeeds: 8,
  allowLongInserter: true,
};

export interface TrunkInput {
  machines: MachineLike[];
  /** 고정 장애물 셀 (buildOccupancy 결과, cellKey 포맷). 머신 footprint 는 내부에서 자동 추가. */
  occupancy: Set<string>;
  /** chest 후보 perimeter 셀 (enumeratePerimeterCells 결과). */
  chestCandidates: { x: number; y: number }[];
  config?: Partial<TrunkConfig>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

export function computeTrunkPath(input: TrunkInput): TrunkResult {
  const cfg: TrunkConfig = { ...DEFAULT_TRUNK_CONFIG, ...input.config };
  const { machines } = input;
  if (machines.length === 0) return { ok: false, infeasible: 'no-machines' };

  const centroid = clusterCentroid(machines);
  const order = visitOrder(machines);

  // 고정 장애물 + 모든 머신 footprint → base occupancy (seed 마다 clone).
  const baseOcc = new Set(input.occupancy);
  for (const m of machines) {
    for (let dx = 0; dx < m.size.w; dx++) {
      for (let dy = 0; dy < m.size.h; dy++) {
        baseOcc.add(cellKey(m.origin.x + dx, m.origin.y + dy));
      }
    }
  }

  // chest 후보를 centroid 근접순으로 정렬 후 상위 maxSeeds 개 시도.
  const seeds = [...input.chestCandidates]
    .sort((a, b) => manhattan(a, centroid) - manhattan(b, centroid))
    .slice(0, cfg.maxSeeds);

  for (const chestCell of seeds) {
    const grown = tryGrow(chestCell, order, centroid, baseOcc, cfg);
    if (grown) return { ok: true, path: grown };
  }
  return { ok: false, infeasible: 'all-seeds-failed' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 그리디 성장 (한 chest seed)
// ─────────────────────────────────────────────────────────────────────────────

function tryGrow(
  chestCell: { x: number; y: number },
  order: MachineLike[],
  centroid: { x: number; y: number },
  baseOcc: Set<string>,
  cfg: TrunkConfig,
): TrunkPath | null {
  const occ = new Set(baseOcc);

  // chest 는 1×1, chest→트렁크도 인서터(normal). f = 클러스터 향 cardinal.
  const f = inwardCardinal(chestCell, centroid);
  const feederSeat = add(chestCell, f);
  const trunkStart = add(chestCell, mul(f, 2));
  if (occ.has(key(chestCell)) || occ.has(key(feederSeat)) || occ.has(key(trunkStart))) {
    return null; // 이 seed 는 시작조차 불가 → 다음 seed.
  }
  occ.add(key(chestCell));
  occ.add(key(feederSeat));
  occ.add(key(trunkStart));

  const trunkCells: TrunkCell[] = [{ x: trunkStart.x, y: trunkStart.y, dir: dirOf(f) }];
  let headIdx = 0;
  let head = trunkStart;
  let headDir = dirOf(f);

  const covered: TapRecord[] = [];
  const untapped: string[] = [];

  for (const m of order) {
    let best: { cand: TapRecord; path: SubPath } | null = null;
    let bestCost = Infinity;

    for (const cand of tapCandidates(m, occ, head, cfg.allowLongInserter)) {
      const path = findBeltSubPath(head, headDir, cand.tapCell, occ, cand.seat);
      if (!path) continue;
      const bends = (path.firstDir !== headDir ? 1 : 0) + path.internalBends;
      const cost = path.cells.length + cfg.wBend * bends + cfg.wReach * (cand.reach === 2 ? 1 : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = { cand, path };
      }
    }

    if (!best) {
      // 직접 탭 불가 → ② 스퍼에 위임.
      untapped.push(m.id);
      continue;
    }

    // commit.
    const { cand, path } = best;
    if (path.cells.length > 0) {
      trunkCells[headIdx].dir = path.firstDir; // head 를 새 경로로 꺾음.
      for (const c of path.cells) {
        trunkCells.push(c);
        occ.add(key(c));
      }
      headIdx = trunkCells.length - 1;
      head = cand.tapCell;
      headDir = path.lastDir;
    }
    occ.add(key(cand.seat));
    covered.push(cand);
  }

  return { trunkCells, chestCell, covered, untapped };
}

// ─────────────────────────────────────────────────────────────────────────────
// 탭 후보
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 머신 1개의 직접 탭 후보들. seat 은 비어있어야 하고, tapCell 은 비어있거나
 * (이미 깔린) 현재 트렁크 head 여야 한다 — head 면 새 벨트 없이 그 셀을 그대로
 * 탭한다. long 은 팔 아래 중간 셀(rim1·rim3)도 보수적으로 free 요구. 4면 둘레
 * 포트 전부를 본다(포트 자유도).
 */
export function tapCandidates(
  m: MachineLike,
  occ: Set<string>,
  head?: { x: number; y: number },
  allowLong = true,
): TapRecord[] {
  const tapOk = (c: { x: number; y: number }) =>
    free(occ, c) || (head !== undefined && c.x === head.x && c.y === head.y);
  const out: TapRecord[] = [];
  for (const { cell: port, face } of machinePorts(m)) {
    const v = faceVector(face);
    // normal: seat=rim1(port), tap=rim2(port+v)
    const nTap = add(port, v);
    if (free(occ, port) && tapOk(nTap)) {
      out.push({ machineId: m.id, port, face, reach: 1, seat: port, tapCell: nTap });
    }
    // long: seat=rim2(port+v), tap=rim4(port+3v); 중간 rim1(port)·rim3(port+2v) free.
    if (allowLong) {
      const lSeat = add(port, v);
      const rim3 = add(port, mul(v, 2));
      const lTap = add(port, mul(v, 3));
      if (free(occ, lSeat) && tapOk(lTap) && free(occ, port) && free(occ, rim3)) {
        out.push({ machineId: m.id, port, face, reach: 2, seat: lSeat, tapCell: lTap });
      }
    }
  }
  return out;
}

/**
 * 머신 footprint 4면의 둘레 셀 + 면. portInference.itemPorts 의 기하를 미러링한다
 * (이 단위를 gameDataStore 의존 없이 순수하게 유지하기 위해 인라인).
 */
function machinePorts(m: MachineLike): { cell: { x: number; y: number }; face: PortFace }[] {
  const { x: ox, y: oy } = m.origin;
  const { w, h } = m.size;
  const ports: { cell: { x: number; y: number }; face: PortFace }[] = [];
  for (let dx = 0; dx < w; dx++) ports.push({ cell: { x: ox + dx, y: oy - 1 }, face: 'N' });
  for (let dx = 0; dx < w; dx++) ports.push({ cell: { x: ox + dx, y: oy + h }, face: 'S' });
  for (let dy = 0; dy < h; dy++) ports.push({ cell: { x: ox - 1, y: oy + dy }, face: 'W' });
  for (let dy = 0; dy < h; dy++) ports.push({ cell: { x: ox + w, y: oy + dy }, face: 'E' });
  return ports;
}

// ─────────────────────────────────────────────────────────────────────────────
// 서브 경로 (head → target, 직선 or L)
// ─────────────────────────────────────────────────────────────────────────────

interface SubPath {
  /** head 제외, target 포함. 각 셀 dir = 다음 셀로의 흐름(꺾임 셀은 회전됨). */
  cells: TrunkCell[];
  firstDir: Direction;
  lastDir: Direction;
  internalBends: number;
}

/**
 * head 에서 target 까지 belt 를 까는 미니 경로. L-bend 허용: 직선(정렬 시) 또는
 * L 2방향(가로먼저/세로먼저) 중 occupancy·seat 와 충돌 없는, 꺾임 적은 것.
 * 닿지 못하면 null. target==head 면 빈 경로(기존 트렁크 셀을 그대로 탭).
 */
export function findBeltSubPath(
  head: { x: number; y: number },
  headDir: Direction,
  target: { x: number; y: number },
  occ: Set<string>,
  seat: { x: number; y: number },
): SubPath | null {
  if (head.x === target.x && head.y === target.y) {
    return { cells: [], firstDir: headDir, lastDir: headDir, internalBends: 0 };
  }

  const variants: SubPath[] = [];
  if (head.x === target.x || head.y === target.y) {
    variants.push(straightRun(head, target));
  } else {
    variants.push(lRun(head, target, 'HV'));
    variants.push(lRun(head, target, 'VH'));
  }

  let best: SubPath | null = null;
  let bestScore = Infinity;
  for (const v of variants) {
    if (!validPath(v.cells, occ, seat)) continue;
    const score = (v.firstDir !== headDir ? 1 : 0) + v.internalBends;
    if (score < bestScore || (score === bestScore && best !== null && v.cells.length < best.cells.length)) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

/** 모든 셀이 비어있고 seat 를 밟지 않는지. (cells 는 head 를 제외한다.) */
function validPath(cells: TrunkCell[], occ: Set<string>, seat: { x: number; y: number }): boolean {
  for (const c of cells) {
    if (occ.has(cellKey(c.x, c.y))) return false;
    if (c.x === seat.x && c.y === seat.y) return false;
  }
  return true;
}

/** 정렬된 두 점 사이 직선. from 제외, to 포함. */
function straightRun(from: { x: number; y: number }, to: { x: number; y: number }): SubPath {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const d = vectorToDirection(dx, dy);
  const cells: TrunkCell[] = [];
  let cur = { x: from.x, y: from.y };
  while (!(cur.x === to.x && cur.y === to.y)) {
    cur = { x: cur.x + dx, y: cur.y + dy };
    cells.push({ x: cur.x, y: cur.y, dir: d });
  }
  return { cells, firstDir: d, lastDir: d, internalBends: 0 };
}

/** L 경로. order 'HV' = 가로 먼저, 'VH' = 세로 먼저. from.x≠to.x && from.y≠to.y 전제. */
function lRun(
  from: { x: number; y: number },
  to: { x: number; y: number },
  order: 'HV' | 'VH',
): SubPath {
  const corner = order === 'HV' ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  const s1 = straightRun(from, corner);
  const s2 = straightRun(corner, to);
  const cells = [...s1.cells];
  // corner = s1 마지막 셀. 흐름이 s2 방향으로 꺾이므로 corner.dir 을 s2 첫 방향으로.
  cells[cells.length - 1] = { ...cells[cells.length - 1], dir: s2.firstDir };
  for (const c of s2.cells) cells.push(c);
  return { cells, firstDir: s1.firstDir, lastDir: s2.lastDir, internalBends: 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// 기하 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function clusterCentroid(machines: MachineLike[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const m of machines) {
    sx += m.origin.x + m.size.w / 2;
    sy += m.origin.y + m.size.h / 2;
  }
  return { x: sx / machines.length, y: sy / machines.length };
}

/** 지배축(넓은 쪽) 투영순 정렬. 머신은 안 움직이고 방문 순서만 매긴다. */
function visitOrder(machines: MachineLike[]): MachineLike[] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const m of machines) {
    const cx = m.origin.x + m.size.w / 2;
    const cy = m.origin.y + m.size.h / 2;
    minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
    minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
  }
  const horizontal = maxX - minX >= maxY - minY;
  const keyOf = (m: MachineLike) => {
    const cx = m.origin.x + m.size.w / 2;
    const cy = m.origin.y + m.size.h / 2;
    return horizontal ? [cx, cy] : [cy, cx];
  };
  return [...machines].sort((a, b) => {
    const ka = keyOf(a); const kb = keyOf(b);
    return ka[0] - kb[0] || ka[1] - kb[1];
  });
}

/** perimeter 셀에서 centroid 를 향하는 cardinal 단위벡터 (지배 성분). */
function inwardCardinal(
  cell: { x: number; y: number },
  centroid: { x: number; y: number },
): { x: number; y: number } {
  const dx = centroid.x - cell.x;
  const dy = centroid.y - cell.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: Math.sign(dx) || 1, y: 0 };
  return { x: 0, y: Math.sign(dy) || 1 };
}

function dirOf(v: { x: number; y: number }): Direction {
  return vectorToDirection(v.x, v.y);
}

function add(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function mul(v: { x: number; y: number }, k: number) {
  return { x: v.x * k, y: v.y * k };
}

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function key(c: { x: number; y: number }): string {
  return cellKey(c.x, c.y);
}

function free(occ: Set<string>, c: { x: number; y: number }): boolean {
  return !occ.has(cellKey(c.x, c.y));
}
