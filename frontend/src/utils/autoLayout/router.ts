import type { GridCell, Direction } from '../../types/layout';
import { EntityType } from '../../types/layout';
import { nanoid } from '../../store/nanoid';
import type { PlacedCell } from './placedCell';

/**
 * 부모 unit 의 "입력 belt" 와 자식 unit 의 "출력 belt" 사이를 belt 로 연결한다.
 *
 * 알고리즘: 4-방향 BFS (Lee). 비용은 모든 통과 가능한 셀에 대해 1.
 *
 * 충돌 정책:
 *   - 이미 배치된 머신/인서터/벨트(머신 인접 1줄)는 절대 통과 X.
 *   - 이전에 깔린 라우팅 belt 위는 통과 가능 (같은 아이템이 합류하더라도 일단 한 belt 위로 흐른다 — 단순화).
 *
 * 결과:
 *   - 경로 셀들에 새 belt PlacedCell 추가.
 *   - belt 의 direction 은 "이 셀에서 다음 셀로 향하는 방향" 으로 결정. 끝 셀(타깃)은 마지막 진행 방향 유지.
 */

export type Occupancy = Map<string, OccupancyKind>;
export type OccupancyKind = 'machine' | 'inserter' | 'belt-fixed' | 'belt-route';

export interface RouteEndpoint {
  x: number;
  y: number;
}

export interface RouteRequest {
  from: RouteEndpoint;
  to: RouteEndpoint;
  itemName: string;
  beltName: string;
}

export interface RouteResult {
  ok: boolean;
  /** 새로 깔린 belt 셀들 (기존 placed 와 합치면 최종 layout) */
  added: PlacedCell[];
  /** 같은 좌표가 이미 belt 라서 재사용한 셀 수 */
  reused: number;
}

const dirs: Array<{ dx: number; dy: number; dir: Direction }> = [
  { dx: 0, dy: -1, dir: 0 }, // N (위로)
  { dx: 1, dy: 0, dir: 4 }, // E (우)
  { dx: 0, dy: 1, dir: 8 }, // S (아래)
  { dx: -1, dy: 0, dir: 12 }, // W (좌)
];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * placed 배열로부터 occupancy 맵을 구축. 같은 좌표가 여러 번 등장해도 가장 강한 카테고리를 유지한다.
 * 우선순위: machine > inserter > belt-fixed > belt-route.
 */
export function buildOccupancy(placed: ReadonlyArray<PlacedCell>): Occupancy {
  const occ: Occupancy = new Map();
  const rank: Record<OccupancyKind, number> = {
    'machine': 3,
    'inserter': 2,
    'belt-fixed': 1,
    'belt-route': 0,
  };
  for (const p of placed) {
    const kind = classify(p.cell);
    const k = key(p.x, p.y);
    const cur = occ.get(k);
    if (!cur || rank[kind] > rank[cur]) occ.set(k, kind);
  }
  return occ;
}

function classify(cell: GridCell): OccupancyKind {
  if (cell.entityType === EntityType.Inserter) return 'inserter';
  if (cell.entityType === EntityType.Belt) return 'belt-fixed';
  // 머신, 화로, 보일러, 등 그 외 모든 footprint 엔티티는 통과 불가
  return 'machine';
}

/**
 * BFS Lee 라우팅. region 박스 안에서만 탐색.
 * `from` 과 `to` 가 occupancy 에서 belt-fixed 인 경우는 시작/종료 셀로 허용한다 (입출력 stub).
 */
export function routeBelt(
  req: RouteRequest,
  region: { x: number; y: number; w: number; h: number },
  occ: Occupancy,
): RouteResult {
  const { from, to, beltName } = req;
  const startKey = key(from.x, from.y);
  const goalKey = key(to.x, to.y);

  // 시작/도착 셀이 우리가 둔 belt-fixed/route 라면 통과 허용. 아니면 라우팅 불가.
  if (!isPassableEndpoint(occ.get(startKey)) || !isPassableEndpoint(occ.get(goalKey))) {
    return { ok: false, added: [], reused: 0 };
  }

  if (startKey === goalKey) {
    return { ok: true, added: [], reused: 1 };
  }

  // BFS
  const came = new Map<string, { px: number; py: number; dir: Direction }>();
  const visited = new Set<string>([startKey]);
  const queue: Array<{ x: number; y: number }> = [{ x: from.x, y: from.y }];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.x === to.x && cur.y === to.y) break;
    for (const d of dirs) {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      if (nx < region.x || ny < region.y) continue;
      if (nx >= region.x + region.w || ny >= region.y + region.h) continue;
      const nk = key(nx, ny);
      if (visited.has(nk)) continue;
      const k = occ.get(nk);
      const isGoal = nx === to.x && ny === to.y;
      if (!isGoal && !isPassable(k)) continue;
      if (isGoal && !isPassableEndpoint(k)) continue;
      visited.add(nk);
      came.set(nk, { px: cur.x, py: cur.y, dir: d.dir });
      queue.push({ x: nx, y: ny });
    }
  }

  if (!came.has(goalKey)) {
    return { ok: false, added: [], reused: 0 };
  }

  // 경로 복원 (도착 → 시작) 후 뒤집기
  const path: Array<{ x: number; y: number; dir: Direction }> = [];
  let curK = goalKey;
  let cx = to.x;
  let cy = to.y;
  while (curK !== startKey) {
    const prev = came.get(curK)!;
    path.push({ x: cx, y: cy, dir: prev.dir });
    cx = prev.px;
    cy = prev.py;
    curK = key(cx, cy);
  }
  path.push({ x: from.x, y: from.y, dir: path[path.length - 1]?.dir ?? 4 });
  path.reverse();

  // came.dir 은 "이전 셀 → 이 셀" 의 진입 방향이라 path[i].dir 도 진입 방향이 들어 있다.
  // 벨트는 "이 셀 → 다음 셀" 의 진출 방향으로 그려져야 하므로 한 칸 시프트한다 —
  // 꼭짓점 셀이 다음 벨트가 아닌 이전 벨트와 같은 방향을 가리키던 버그의 수정.
  // 마지막 셀(goal) 은 belt-fixed endpoint 라 emit 되지 않으므로 그대로 둔다.
  for (let i = 0; i < path.length - 1; i++) {
    path[i].dir = path[i + 1].dir;
  }

  // path 의 각 셀에 belt 를 깐다. 이미 belt-fixed/route 인 셀은 reused 로 카운트.
  const added: PlacedCell[] = [];
  let reused = 0;
  for (const step of path) {
    const k = key(step.x, step.y);
    const occCur = occ.get(k);
    if (occCur === 'belt-fixed' || occCur === 'belt-route') {
      reused++;
      continue;
    }
    added.push({
      x: step.x,
      y: step.y,
      cell: {
        entityId: nanoid(),
        entityName: beltName,
        entityType: EntityType.Belt,
        direction: step.dir,
        tileOffset: { x: 0, y: 0 },
        isOrigin: true,
      },
    });
    occ.set(k, 'belt-route');
  }

  return { ok: true, added, reused };
}

function isPassable(kind: OccupancyKind | undefined): boolean {
  // 빈 칸 또는 라우팅이 깔린 belt 위는 통과 가능. 머신/인서터/고정 belt 는 통과 불가.
  // 단, 고정 belt(입출력 stub) 는 endpoint 로만 허용 — 중간 통과는 불가.
  return kind === undefined || kind === 'belt-route';
}

function isPassableEndpoint(kind: OccupancyKind | undefined): boolean {
  return kind === undefined || kind === 'belt-fixed' || kind === 'belt-route';
}
