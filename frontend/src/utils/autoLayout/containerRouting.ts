/**
 * 모듈 4 — 라우팅.
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §4.
 *
 * 두 port (producer.port, consumer.port) 사이의 운반체 체인을 BFS 로 깐다.
 * port.kind 에 따라 형식이 갈린다:
 *  - item  : 컨테이너—투입기—벨트(가변길이 ≥ 1)—투입기—컨테이너
 *  - fluid : 컨테이너—파이프 + 지하파이프—컨테이너 (투입기 없음)
 *
 * 본 모듈은 *컨테이너 모델 v2 의 라우팅* 이며, legacy `router.ts` (Lee BFS,
 * item-only) 와 별개의 파일이다 — 이름 충돌을 피하려고
 * `containerRouting.ts` 로 분리. legacy 는 새 위저드 통합 시점에 삭제.
 *
 * 1차 구현 범위: item kind 만. fluid kind / underground 변형은 후속 커밋에서.
 */

import { EntityType } from '../../types/layout';
import type { Direction } from '../../types/layout';
import type { Area, UndergroundCorridor } from './containerModel';
import { cellKey } from './util/helper';

export function buildOccupancy(area: Area, extra?: Area): Set<string> {
  const blocked = new Set<string>();
  for (const p of area.placed) {
    blocked.add(cellKey(p.x, p.y));
  }
  if (extra) {
    for (const p of extra.placed) {
      blocked.add(cellKey(p.x, p.y));
    }
  }
  return blocked;
}


// ─────────────────────────────────────────────────────────────────────────────
// item 라우팅
// ─────────────────────────────────────────────────────────────────────────────


export interface JumpEdge {
  dx: number;
  dy: number;
  k: number;
}

/** Dijkstra 경로의 한 edge — 지상 인접 또는 지하 점프 */
export type RouteEdge = 'surface' | JumpEdge;

/** `dijkstraWithJumps` 의 결과 — 셀 시퀀스 + 각 step 의 edge 종류. */
export interface DijkstraResult {
  /** start 부터 end 까지의 셀 시퀀스. 길이 ≥ 1 */
  cells: Array<{ x: number; y: number }>;
  /** 각 인접한 두 cell 사이의 edge 종류. 길이 = `cells.length - 1` */
  edges: RouteEdge[];
  /** 총 cost (지상 1 + 점프 2) */
  cost: number;
}

/**
 * 다중 소스/싱크용 끝점. 점프 방향 제약을 *끝점별* 로 가진다 (단일 `requiredStartJump`/
 * `requiredEndJump` 의 멀티 버전 — 소스마다 머신을 향하는 면이 다를 수 있으므로).
 */
export interface DijkstraEndpoint {
  x: number;
  y: number;
  /** 이 끝점에서 출발(소스)/도착(싱크)하는 점프를 이 방향으로만 허용. */
  requiredJump?: { dx: number; dy: number };
}

export interface DijkstraInput {
  /** 단일 소스. `starts` 가 주어지면 무시된다(하위 호환). */
  start?: { x: number; y: number };
  /** 단일 싱크. `ends` 가 주어지면 무시된다(하위 호환). */
  end?: { x: number; y: number };
  /**
   * 다중 소스 — 전부 cost 0 으로 *동시에* seed 한다(개념 ①: 출발의 평등).
   * 주어지면 `start`/`requiredStartJump` 를 대체. 어느 소스에서 출발하든 동등하므로
   * 처음 싱크에 닿는 흐름이 전 포트 페어 통틀어 전역 최적(실제 경로 비용 기준)이다.
   */
  starts?: ReadonlyArray<DijkstraEndpoint>;
  /**
   * 다중 싱크 — 어느 하나에 *처음* 도달하면 종료(개념 ②: 도착의 평등 + 멤버십 종료).
   * 주어지면 `end`/`requiredEndJump` 를 대체.
   */
  ends?: ReadonlyArray<DijkstraEndpoint>;
  /** 통과 불가 셀 집합 (지상 occupancy). 싱크 셀들은 포함되어도 무방(개념 ③). */
  blocked: ReadonlySet<string>;
  /** 기존 corridor 들. 같은 `blockGroup` 만 점프 edge 충돌 검사 대상. */
  corridors: ReadonlyArray<UndergroundCorridor>;
  /**
   * 점프 edge 의 최대 `k` (입출구 좌표 차이). 0 이면 점프 비활성 (= pure surface BFS).
   * prototype 의 `max_underground_distance` 그대로.
   */
  maxJumpDistance: number;
  /** 이 라우팅이 깔게 될 corridor 의 blockGroup (pipe="pipe-to-ground" / belt=entityName) */
  blockGroup: string;
  /**
   * 외부(타 라우팅) 벨트 흐름 정보. 주어지면, 결과 경로의 벨트 셀이 외부 벨트 스트림과
   * *흐름 방향으로 인접해 합류*하는 배치를 거부한다(타일 배타성의 경계 버전). 아이템
   * 라우팅만 전달한다(파이프는 무방향 연결이라 별도 모델). 미지정이면 검사 안 함.
   */
  beltFlow?: BeltFlow;
  /**
   * start 셀에서 *출발하는* 점프를 이 방향으로만 허용. 미지정이면 제약 없음.
   * pipe-to-ground 는 표면에서 한 면(direction)으로만 연결되므로, 머신에 닿는
   * 끝 셀이 지하 입구가 될 때 그 표면 면이 머신을 향하도록 강제하는 데 쓴다.
   */
  requiredStartJump?: { dx: number; dy: number };
  /** end 셀에 *도착하는* 점프를 이 방향으로만 허용. 미지정이면 제약 없음. */
  requiredEndJump?: { dx: number; dy: number };
  /**
   * 지하 점프 edge 의 cost 모델.
   *  - `'flat'`(기본): 점프 1회 = cost 2 (운반체 2개 기준). 점프 길이 `k` 와 무관하므로
   *    `k ≥ 3` 인 긴 직선 구간에서는 점프(2)가 지상(k)보다 싸다 → 장애물이 없어도 점프가
   *    선택된다. 파이프 라우팅이 이 모델을 쓴다.
   *  - `'length'`: 점프 cost = `k + 1` (= 지상 직선 `k` 칸보다 항상 1 비쌈). 지상이
   *    뚫려 있으면 항상 지상이 이기고, 점프는 지상 우회가 더 비쌀 때(=충돌 회피)만
   *    선택된다. 벨트 라우팅이 "지하벨트는 충돌 회피용으로만" 정책을 위해 이 모델을 쓴다.
   */
  jumpCostModel?: 'flat' | 'length';
  /**
   * 지상 벨트가 *방향을 꺾을 때마다* 더해지는 추가 cost. 0/미지정이면 꺾임 무비용
   * (기존 동작 — 직선과 계단형 경로가 동률이라 임의 tie-break). 양수면 꺾임이 적은
   * 경로가 이기므로 (1) 계단/대각처럼 보이는 벨트 대신 곧은 벨트를, (2) 상자 같은
   * 장애물을 *우회(2회 꺾임)* 하기보다 *직진 점프* 로 넘기를 선호하게 된다. 외부상자
   * 드래그 재라우팅처럼 가독성이 중요한 경로에서 켠다. 점프 edge 에는 적용하지 않는다
   * (점프는 entrance-straight 규약상 진행 방향을 유지하므로 꺾임이 아니다).
   */
  turnPenalty?: number;
  /**
   * 라우팅 허용 영역 (포함 경계, inclusive). 주어지면 이 직사각형 **바깥** 셀로는
   * 진입할 수 없다(지상 인접·지하 점프 타겟 모두). 단 `ends` 셀은 예외(blocked 와 동일).
   * perimeter ring 의 단일 외곽선 불변식 — 라우팅이 ring 직사각형 밖으로 새지 못하게
   * 한다. 미지정이면 제약 없음(기존 동작). 영역을 유한히 가두므로 도달 불가 end 의
   * 무한 frontier 확장도 방지한다.
   */
  bounds?: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Dijkstra — 지상 인접 + 지하 점프 페어 통합 탐색.
 *
 * 상태 = `(x, y, arr)`. arr 는 *이 셀에 도착한 방식·방향* 을 인코딩한다:
 *   -1   = 시작 셀 (아직 진행 방향 없음).
 *   0..3 = 지상으로 surfaceDirs[arr] 방향 진행하며 도착.
 *   4..7 = 점프(지하 출구)로 surfaceDirs[arr-4] 방향 진행하며 도착 (출구 셀).
 * 한 셀은 도착 방식·방향에 따라 여러 상태로 갈라진다.
 *
 * 점프(지하벨트/지하파이프)는 입출구가 *직선* 으로만 이어진다. 출구는 진행 방향으로만
 * 토출하고, 입구는 진행 방향 반대(뒤)로만 받는다 (이 모델은 sideload 를 배제한다).
 * 따라서 꺾임은 반드시 *지상 셀* 위에서 일어나야 하며, 두 지하 운반체가 직각으로
 * 맞붙으면 물리적으로 끊긴다. 이를 막는 두 제약:
 *  - 출구 직진 (exit-straight): 출구 셀(arr>=4)에서는 같은 방향 지상 직진만 허용,
 *    재점프 금지. 출구 entity 위에 입구가 겹치는 것도 함께 방지.
 *  - 입구 직진 (entrance-straight): 점프는 *그 셀에 진행해 온 방향과 같은 방향* 으로만
 *    시작할 수 있다 (지상 도착 arr=0..3 → 같은 방향 점프만). 시작 셀(arr=-1)은
 *    예외로 임의 방향 허용 — 머신이 뒤에서 공급하기 때문.
 * 두 제약이 함께 작동해 꺾임-직후-점프 / 점프-직후-꺾임을 모두 지상 셀로 밀어내므로,
 * 직각 코너에는 항상 연결용 지상 벨트/파이프 한 칸이 놓인다.
 *
 * 결정성: 동률 cost 시 expand 순서 = 지상 N→E→S→W → 점프 (k 작은 것부터,
 * 축 N→E→S→W). PQ tie-break = (cost, enqueueSeq).
 *
 * 점프 edge 의 유효성 (placement-search §4.1, Factorio 게임 동작 기준):
 *  - 점프 입출구 두 셀 모두 `blocked` 에 없어야 함.
 *  - 기존 같은 `blockGroup` corridor 와 *같은 axis + 같은 line* 위에서
 *    interval 이 strict disjoint 여야 함 (= 한쪽 endpoint 가 다른 쪽 open
 *    interior 에 끼는 케이스 모두 거부).
 *  - 다른 axis · 다른 line · 다른 blockGroup corridor 는 간섭 없음.
 */
function searchWithJumps(input: DijkstraInput): DijkstraResult | null {
  const { blocked, corridors, maxJumpDistance, blockGroup, bounds } = input;
  const jumpCostModel = input.jumpCostModel ?? 'flat';
  const turnPenalty = input.turnPenalty ?? 0;
  // bounds 밖 셀 진입 금지(ends 는 예외 — blocked 와 동일 취급). 미지정이면 항상 false.
  const outOfBounds = (x: number, y: number): boolean =>
    bounds !== undefined &&
    (x < bounds.x0 || x > bounds.x1 || y < bounds.y0 || y > bounds.y1);

  // 단일/다중 입력을 끝점 배열로 정규화. 단일 start/end 는 1-원소 배열로 흡수하므로
  // 기존 호출부(routeItem/routeFluid/moduleHop/…)는 동작이 그대로 보존된다.
  const starts: ReadonlyArray<DijkstraEndpoint> =
    input.starts ??
    (input.start
      ? [{ x: input.start.x, y: input.start.y, requiredJump: input.requiredStartJump }]
      : []);
  const ends: ReadonlyArray<DijkstraEndpoint> =
    input.ends ??
    (input.end
      ? [{ x: input.end.x, y: input.end.y, requiredJump: input.requiredEndJump }]
      : []);
  if (starts.length === 0 || ends.length === 0) return null;

  // 싱크 멤버십(개념 ②)·끝점별 점프 제약을 O(1) 조회용으로 인덱싱.
  const endSet = new Set<string>(ends.map((e) => cellKey(e.x, e.y)));
  const endJump = new Map<string, { dx: number; dy: number }>();
  for (const e of ends) if (e.requiredJump) endJump.set(cellKey(e.x, e.y), e.requiredJump);
  const startJump = new Map<string, { dx: number; dy: number }>();
  for (const s of starts) if (s.requiredJump) startJump.set(cellKey(s.x, s.y), s.requiredJump);

  // 시작이 곧 싱크면 0-길이 경로.
  for (const s of starts) {
    if (endSet.has(cellKey(s.x, s.y))) {
      return { cells: [{ x: s.x, y: s.y }], edges: [], cost: 0 };
    }
  }

  // 상태의 arr: -1 = 시작 셀. 0..3 = surfaceDirs[arr] 방향 지상 진행으로 도착.
  // 4..7 = surfaceDirs[arr-4] 방향 점프로 도착(= 지하 출구 셀). 출구(arr>=4)는 같은
  // 방향 지상 직진만 + 재점프 금지(exit-straight). 점프는 도착 방향과 같은 방향으로만
  // 시작 가능(entrance-straight); 시작 셀(arr=-1)만 임의 방향 허용.
  type PQEntry = { x: number; y: number; arr: number; cost: number; seq: number };
  const pq: PQEntry[] = [];
  let seqCounter = 0;
  const pqLess = (a: PQEntry, b: PQEntry): boolean =>
    a.cost < b.cost || (a.cost === b.cost && a.seq < b.seq);
  const enqueue = (x: number, y: number, arr: number, cost: number): void => {
    const node: PQEntry = { x, y, arr, cost, seq: seqCounter++ };
    pq.push(node);
    let i = pq.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pqLess(pq[parent], pq[i])) break;
      [pq[parent], pq[i]] = [pq[i], pq[parent]];
      i = parent;
    }
  };
  const dequeue = (): PQEntry | undefined => {
    if (pq.length === 0) return undefined;
    const head = pq[0];
    const last = pq.pop()!;
    if (pq.length > 0) {
      pq[0] = last;
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let best = i;
        if (l < pq.length && pqLess(pq[l], pq[best])) best = l;
        if (r < pq.length && pqLess(pq[r], pq[best])) best = r;
        if (best === i) break;
        [pq[best], pq[i]] = [pq[i], pq[best]];
        i = best;
      }
    }
    return head;
  };

  type CameFromEntry = {
    prev: { x: number; y: number; arr: number };
    edge: RouteEdge;
  };
  const stateKey = (x: number, y: number, arr: number): string =>
    `${x},${y},${arr}`;
  const bestCost = new Map<string, number>();
  const cameFrom = new Map<string, CameFromEntry>();
  // 개념 ①: 모든 소스를 동등하게(cost 0) 동시에 seed. 같은 셀 중복은 한 번만.
  for (const s of starts) {
    const sk = stateKey(s.x, s.y, -1);
    if (bestCost.has(sk)) continue;
    bestCost.set(sk, 0);
    enqueue(s.x, s.y, -1, 0);
  }

  // 같은 blockGroup corridor 만 점프 edge 검증 대상.
  const groupCorridors = corridors.filter((c) => c.blockGroup === blockGroup);

  // 결정성: N → E → S → W
  const surfaceDirs: Array<{ dx: number; dy: number }> = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ];

  while (true) {
    const cur = dequeue();
    if (!cur) return null;
    const curKey = stateKey(cur.x, cur.y, cur.arr);
    const known = bestCost.get(curKey);
    if (known !== undefined && cur.cost > known) continue;

    if (endSet.has(cellKey(cur.x, cur.y))) {
      const cellsRev: Array<{ x: number; y: number }> = [{ x: cur.x, y: cur.y }];
      const edgesRev: RouteEdge[] = [];
      let nx = cur.x;
      let ny = cur.y;
      let nj = cur.arr;
      while (true) {
        const entry = cameFrom.get(stateKey(nx, ny, nj));
        if (!entry) break;
        edgesRev.push(entry.edge);
        nx = entry.prev.x;
        ny = entry.prev.y;
        nj = entry.prev.arr;
        cellsRev.push({ x: nx, y: ny });
      }
      return {
        cells: cellsRev.reverse(),
        edges: edgesRev.reverse(),
        cost: cur.cost,
      };
    }

    const isExit = cur.arr >= 4;
    const exitDir = isExit ? cur.arr - 4 : -1;

    // 지상 인접 edge (cost 1). 지하 출구(arr>=4)에서는 출구 방향으로만 직진 —
    // 출구는 진행 방향으로만 토출하므로 꺾으면 다음 운반체와 물리적으로 안 이어진다.
    for (let di = 0; di < surfaceDirs.length; di++) {
      if (isExit && di !== exitDir) continue;
      const d = surfaceDirs[di];
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      const nk = stateKey(nx, ny, di);
      if (blocked.has(cellKey(nx, ny)) && !endSet.has(cellKey(nx, ny))) continue;
      if (outOfBounds(nx, ny) && !endSet.has(cellKey(nx, ny))) continue;
      // 꺾임 비용: 직전 진행 방향(arr)과 다른 방향으로 나아가면 turnPenalty 가산.
      // arr=-1(시작)은 진행 방향이 없어 무비용. 출구(arr>=4)는 위에서 di===exitDir 만
      // 통과하므로 꺾임이 될 수 없다.
      const prevDir = cur.arr >= 4 ? cur.arr - 4 : cur.arr;
      const isTurn = prevDir >= 0 && di !== prevDir;
      const newCost = cur.cost + 1 + (isTurn ? turnPenalty : 0);
      const prev = bestCost.get(nk);
      if (prev !== undefined && prev <= newCost) continue;
      bestCost.set(nk, newCost);
      cameFrom.set(nk, {
        prev: { x: cur.x, y: cur.y, arr: cur.arr },
        edge: 'surface',
      });
      enqueue(nx, ny, di, newCost);
    }

    // 지하 점프 edge (cost 2). 출구 셀(arr>=4)에서는 재점프 금지(출구 entity 위에
    // 입구가 겹침 + 직진 토출). 점프는 entrance-straight — 이 셀에 진행해 온 방향과
    // 같은 방향으로만 시작 가능. 시작 셀(arr=-1)만 임의 방향(또는 requiredStartJump) 허용.
    if (maxJumpDistance > 0 && !isExit) {
      const atStart = cur.arr === -1;
      for (let di = 0; di < surfaceDirs.length; di++) {
        const d = surfaceDirs[di];
        if (atStart) {
          // 머신에 닿는 입구(start 출발 점프)는 정해진 방향으로만 — 입구의 표면 면이
          // 머신을 향하도록 (pipe-to-ground 표면 single-side 규칙).
          const rsj = startJump.get(cellKey(cur.x, cur.y));
          if (rsj && (d.dx !== rsj.dx || d.dy !== rsj.dy)) continue;
        } else {
          // entrance-straight: 지상 도착 방향(arr)과 같은 방향 점프만. 꺾으려면 먼저
          // 지상 셀에서 방향을 바꾼 뒤 그 다음 셀에서 점프 → 코너에 연결용 셀이 남는다.
          if (di !== cur.arr) continue;
        }
        for (let k = 1; k <= maxJumpDistance; k++) {
          const nx = cur.x + d.dx * k;
          const ny = cur.y + d.dy * k;
          const nk = stateKey(nx, ny, 4 + di);
          if (blocked.has(cellKey(nx, ny)) && !endSet.has(cellKey(nx, ny))) continue;
          if (outOfBounds(nx, ny) && !endSet.has(cellKey(nx, ny))) continue;
          // 머신에 닿는 출구(end 도착 점프)도 정해진 방향으로만 — 출구의 표면 면이
          // 머신을 향하도록.
          const rej = endJump.get(cellKey(nx, ny));
          if (rej && (d.dx !== rej.dx || d.dy !== rej.dy)) continue;
          if (!isJumpAllowed(cur.x, cur.y, nx, ny, groupCorridors)) continue;
          // 'flat': 점프=2 (긴 직선에서 지상보다 쌈 → 무조건 점프). 'length': k+1 (항상
          // 지상 직선 k 칸보다 1 비쌈 → 지상이 뚫려 있으면 지상, 막혔을 때만 점프=충돌 회피).
          const newCost = cur.cost + (jumpCostModel === 'length' ? k + 1 : 2);
          const prev = bestCost.get(nk);
          if (prev !== undefined && prev <= newCost) continue;
          bestCost.set(nk, newCost);
          cameFrom.set(nk, {
            prev: { x: cur.x, y: cur.y, arr: cur.arr },
            edge: { dx: d.dx, dy: d.dy, k },
          });
          enqueue(nx, ny, 4 + di, newCost);
        }
      }
    }
  }
}

/**
 * Dijkstra — 지상 인접 + 지하 점프 페어 통합 탐색. **결과 경로는 한 타일에 두 운반체를
 * 놓지 않는다**(타일 단위 배타성 — 라우터의 당연한 불변식).
 *
 * 내부 코어 `searchWithJumps` 의 상태 키는 `(x, y, 도착방식 arr)` 이라, 한 타일을 *지상 벨트*
 * 로 한 번·*지하 입구/출구* 로 한 번, 서로 다른 방식으로 두 번 밟는 최소-cost 경로가 탐색상
 * 합법으로 나올 수 있다(`blocked` 에는 경로 자신의 셀이 안 들어가므로). 그러면
 * `emitItemPath`/pipe emit 이 그 타일에 엔티티 2개(예: transport-belt + underground-belt
 * 입구)를 emit해 **겹침**이 된다. 이를 막기 위해, 결과 경로에 중복 타일이 있으면 그 타일을
 * `blocked` 에 추가해 **재탐색**하는 lazy-constraint 루프로 감싼다. 매 반복마다 타일 ≥1 개를
 * 새로 차단하므로 유한 타일 안에서 종료한다. 타일 중복 없는 경로를 찾으면 반환, 못 찾으면
 * `null`(→ routeWithFallback 이 다른 포트 페어로 폴백). 정적 occupancy·corridor·방향 제약
 * 검사는 코어에 그대로 위임한다.
 *
 * `input.beltFlow` 가 주어지면 같은 lazy-constraint 루프에서 **외부 벨트 스트림과의
 * 흐름-인접 합류**(타일 배타성의 경계 버전)도 검사한다 — 타일을 공유하지 않더라도 한
 * 벨트의 지표 출력이 다른 라우팅의 벨트 칸으로 떨어지면 두 아이템 스트림이 합쳐지므로,
 * 그 출구/수신 셀을 `blocked` 에 넣어 재탐색한다. {@link beltFlowConflictCell} 참고.
 */
export function dijkstraWithJumps(input: DijkstraInput): DijkstraResult | null {
  let blocked: ReadonlySet<string> = input.blocked;
  // 차단 불가 셀(모든 소스·싱크) — 탐색이 이 셀들 진입을 허용하므로 lazy 재탐색에서
  // 이들을 blocked 에 넣을 수 없다. 단일 start/end 와 다중 starts/ends 양쪽을 흡수.
  const protectedCells = new Set<string>();
  for (const s of input.starts ?? (input.start ? [input.start] : [])) {
    protectedCells.add(cellKey(s.x, s.y));
  }
  for (const e of input.ends ?? (input.end ? [input.end] : [])) {
    protectedCells.add(cellKey(e.x, e.y));
  }
  // 상한: 매 반복 새 타일 1개 이상 차단 → 종료 보장(여유 cap).
  for (let guard = 0; guard < 256; guard++) {
    const result = searchWithJumps({ ...input, blocked });
    if (!result) return null;

    const seen = new Set<string>();
    let bad: { x: number; y: number } | null = null;
    for (const c of result.cells) {
      const k = cellKey(c.x, c.y);
      if (seen.has(k)) {
        bad = c;
        break;
      }
      seen.add(k);
    }

    // 타일 중복이 없으면 외부 벨트 스트림과의 흐름-인접 합류를 검사한다.
    if (!bad && input.beltFlow) {
      bad = beltFlowConflictCell(result, input.beltFlow);
    }

    if (!bad) return result; // 깨끗한 경로.

    // 소스/싱크 셀은 차단 불가(탐색이 진입을 허용) → 이 충돌은 못 피함, 폴백에 위임.
    if (protectedCells.has(cellKey(bad.x, bad.y))) {
      return null;
    }
    const next = new Set(blocked);
    next.add(cellKey(bad.x, bad.y));
    blocked = next;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 벨트 흐름 인접 합류 — 타일 배타성의 *경계* 버전
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 외부(이미 배치된 타 라우팅) 벨트 스트림의 흐름 정보.
 *
 * Factorio 에서 두 벨트는 타일을 공유하지 않아도, *한 벨트의 지표 출력이 다른 벨트의
 * 칸으로 떨어지면* 물리적으로 이어져 아이템이 합류한다(직진 투입·side-load). 라우팅마다
 * 독립 아이템 스트림이므로 이 합류는 항상 의도치 않은 오염이다. 이를 막으려면 새 벨트가:
 *  - 외부 벨트의 출력 칸(`sinkTargets`) 위에 놓이거나(= 외부가 나에게 흘려보냄),
 *  - 자신의 출력 칸이 외부 벨트 타일(`tiles`)이 되어선(= 내가 외부로 흘려보냄) 안 된다.
 */
export interface BeltFlow {
  /** 외부 벨트/지하벨트가 점유한 모든 타일(cellKey). 내 출력이 여기로 향하면 합류. */
  tiles: Set<string>;
  /** 외부 벨트가 지표로 흘려보내는 칸(cellKey). 여기에 내 벨트를 놓으면 외부 흐름을 받음. */
  sinkTargets: Set<string>;
}

/** `direction` 열거값 → 단위 흐름 벡터. (0=N,4=E,8=S,12=W) */
export function directionToVector(dir: Direction): { x: number; y: number } {
  switch (dir) {
    case 0: return { x: 0, y: -1 };
    case 4: return { x: 1, y: 0 };
    case 8: return { x: 0, y: 1 };
    case 12: return { x: -1, y: 0 };
    default: return { x: 0, y: 0 };
  }
}

/**
 * 이미 배치된 area 들의 placed 셀에서 벨트 흐름 정보를 모은다(라우팅을 새로 깔기 전에
 * 호출 — 그 결과의 셀은 아직 area 에 없으므로 자기 자신은 외부로 잡히지 않는다).
 *
 * 지표 출력 칸은 *일반 벨트*와 *지하벨트 출구*만 만든다(지하벨트 입구는 지표로 토출하지
 * 않고 터널로 들어가므로 출력 칸 없음 — 다만 입구 타일 자체는 `tiles` 에 포함되어,
 * 내가 그 타일로 흘려보내는 것은 막는다).
 */
export function collectBeltFlow(areas: ReadonlyArray<Area | undefined>): BeltFlow {
  const tiles = new Set<string>();
  const sinkTargets = new Set<string>();
  for (const area of areas) {
    if (!area) continue;
    for (const p of area.placed) {
      const cell = p.cell;
      const t = cell.entityType;
      if (t !== EntityType.Belt && t !== EntityType.UndergroundBelt) continue;
      tiles.add(cellKey(p.x, p.y));
      if (t === EntityType.UndergroundBelt && cell.undergroundType === 'input') continue;
      const v = directionToVector(cell.direction);
      if (v.x === 0 && v.y === 0) continue;
      sinkTargets.add(cellKey(p.x + v.x, p.y + v.y));
    }
  }
  return { tiles, sinkTargets };
}

/**
 * Dijkstra 결과 경로가 외부 벨트 스트림과 흐름-인접해 합류하는 *첫 셀* 을 반환(없으면
 * null). 충돌 셀을 `blocked` 에 넣고 재탐색하면 그 인접을 피해 우회한다.
 *
 * 각 경로 셀의 종류·지표 출력 방향은 `result.edges` 로 판정한다(emitItemPath 와 동일):
 *  - 나가는 edge 가 점프 → 그 셀은 지하 입구(지표 출력 없음).
 *  - 들어온 edge 가 점프 → 그 셀은 지하 출구(지표 출력 = 점프 방향).
 *  - 그 외 → 일반 벨트(지표 출력 = 다음 셀 방향). 마지막 지상 셀은 소비자(인서터/머신)
 *    쪽으로 흐르므로 "내가 외부로" 검사에서 제외한다(소비자는 벨트가 아니다).
 * 모든 벨트 셀은 "외부가 나에게"(sinkTargets) 검사 대상이다.
 */
function beltFlowConflictCell(
  result: DijkstraResult,
  flow: BeltFlow,
): { x: number; y: number } | null {
  const { cells, edges } = result;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    // 외부 벨트가 이 칸으로 흘려보냄 → 합류.
    if (flow.sinkTargets.has(cellKey(c.x, c.y))) return c;

    const outEdge = i < edges.length ? edges[i] : null;
    const inEdge = i > 0 ? edges[i - 1] : null;
    let outV: { x: number; y: number } | null = null;
    if (outEdge && outEdge !== 'surface') {
      outV = null; // 지하 입구 — 지표 출력 없음.
    } else if (inEdge && inEdge !== 'surface') {
      outV = { x: Math.sign(inEdge.dx), y: Math.sign(inEdge.dy) }; // 지하 출구.
    } else if (outEdge === 'surface') {
      const n = cells[i + 1];
      outV = { x: Math.sign(n.x - c.x), y: Math.sign(n.y - c.y) }; // 일반 벨트(중간).
    } else {
      outV = null; // 마지막 지상 셀 — 소비자 쪽(벨트 아님)으로 흐름.
    }
    // 내 출력이 외부 벨트 타일로 떨어짐 → 합류.
    if (outV && flow.tiles.has(cellKey(c.x + outV.x, c.y + outV.y))) return c;
  }
  return null;
}

/**
 * 새 점프 페어 (in=(x0,y0), out=(x1,y1)) 가 기존 같은 blockGroup corridor 들과
 * 충돌하는지 검사. 충돌 없음 → true.
 *
 * 충돌 규칙: 같은 axis · 같은 line 위에서 interval 이 strict disjoint 여야 함.
 * (= 한 corridor 의 endpoint 가 다른 corridor 의 open interior 에 끼는 모든
 * 케이스 거부 — nested · partial overlap 모두 broken 으로 처리.)
 */
function isJumpAllowed(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  groupCorridors: ReadonlyArray<UndergroundCorridor>,
): boolean {
  const axis: 'h' | 'v' = y0 === y1 ? 'h' : 'v';
  const line = axis === 'h' ? y0 : x0;
  const a = axis === 'h' ? x0 : y0;
  const b = axis === 'h' ? x1 : y1;
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  for (const c of groupCorridors) {
    if (c.axis !== axis) continue;
    if (c.line !== line) continue;
    const [ca, cb] = c.range;
    const clo = ca < cb ? ca : cb;
    const chi = ca < cb ? cb : ca;
    // strict disjoint: hi < clo || chi < lo
    if (!(hi < clo || chi < lo)) return false;
  }
  return true;
}


// ─────────────────────────────────────────────────────────────────────────────
// 기타
// ─────────────────────────────────────────────────────────────────────────────

