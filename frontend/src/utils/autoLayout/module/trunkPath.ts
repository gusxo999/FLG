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
 *     · 일반 인서터(reach 1): seat = rim1(p),   tap = rim2(p+f)
 *     · long inserter(reach 2): seat = rim1(p), tap = rim3(p+2f) — 앞 칸 건너뜀
 *
 * 탐색: 머신을 **지배축 투영순**으로 방문(위빙 차단), 각 연결의 탭셀·포트·서브
 *   경로는 **굽힘 페널티 cost** 로 고른다(직선 연장 선호 → 깔끔한 L). 직선/L 로
 *   닿지 않는 머신은 `untapped` 로 빼서 ② 스퍼가 처리한다.
 */

import type { Direction } from '../../../types/layout';
import type { PortFace } from '../containerModel';
import { cellKey, faceVector, vectorToDirection } from '../util/helper';

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

/** 트렁크 계산에 필요한 머신의 최소 정보 (실제 호출자는 `Container` 에서 매핑). */
export interface MachineLike {
  id: string;
  origin: { x: number; y: number };
  size: { w: number; h: number };
}

/** 인서터 집기 거리(seat→pickup, 셀 수). 1=일반, ≥2=긴팔. */
export type Reach = number;

/** 탭의 역할 — belt 기준 흐름 방향. */
export type TapRole =
  /** 머신→belt (소스: 머신에서 집어 belt 에 놓음). 기본값. */
  | 'source'
  /** belt→머신 (싱크/소비자: belt 에서 집어 머신에 넣음). 멀티싱크 버스의 부모 탭. */
  | 'sink';

/** 한 머신이 트렁크를 직접 탭하는 방법 1개. */
export interface TapRecord {
  machineId: string;
  /** 기준 둘레 셀 (rim1) = seat. */
  port: { x: number; y: number };
  face: PortFace;
  reach: Reach;
  /** 인서터가 앉는 셀. */
  seat: { x: number; y: number };
  /** 인서터가 집어가는 트렁크 belt 셀. */
  tapCell: { x: number; y: number };
  /** belt 기준 흐름 역할. `sinkIds` 에 든 머신은 'sink', 그 외 'source'. */
  role: TapRole;
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
  /**
   * seed 경쟁 우승 근거(디버그·표시용) — computeTrunkPath 가 채운다. 사전식 점수
   * [untapped, crossSpan(직선성), endPenalty(끝 선호), trunkLen] + 평가 seed 수.
   * tryGrow 단독 호출 경로에는 없다(optional).
   */
  selectionDebug?: {
    untapped: number;
    crossSpan: number;
    endPenalty: number;
    trunkLen: number;
    seedsEvaluated: number;
  };
  /** [진단] 미탭 머신별 후보 통계 (왜 못 탭됐는지). AUTO_LAYOUT_COORD_DUMP 분석용. */
  untappedInfo?: { id: string; cands: number; oobSeatTap: number; noPath: number; oobPath: number }[];
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
  /**
   * 긴팔(long inserter)의 집기 거리(seat→pickup, 셀 수). undefined / <2 면 긴팔
   * 탭 후보를 생성하지 않는다(reach-1 일반 인서터만). 처리량과 대칭으로 데이터에서
   * 흐르는 파라미터 — 호출자가 prototype `inserter_pickup_position` 에서 산출해 넘긴다.
   */
  longReach?: number;
  /**
   * cross-axis 탭 페널티 — 클러스터 *장축에 평행한* 면(컬럼이면 N/S 끝면)을 탭하면
   * 더해지는 비용. belt 레인을 한 축(컬럼이면 W/E 측면)에 모아 용량 모델(2면×2레인)을
   * 지키게 한다. soft 선호일 뿐이라 장축 수직면이 막혔으면 끝면 탭으로 폴백(미탭 방지).
   */
  wCrossAxis: number;
}

export const DEFAULT_TRUNK_CONFIG: TrunkConfig = {
  wBend: 4,
  wReach: 1.5,
  // centroid 근접·축 평행 두 그룹 각각에서 이만큼 시도(끝-축 평행 seed 까지 포함되도록 여유).
  maxSeeds: 16,
  longReach: 2,
  // bend(4)보다 강해 같은 거리면 장축 수직면(W/E)을 확실히 선호하되, 끝면만 가능하면 허용.
  wCrossAxis: 6,
};

export interface TrunkInput {
  machines: MachineLike[];
  /** 고정 장애물 셀 (buildOccupancy 결과, cellKey 포맷). 머신 footprint 는 내부에서 자동 추가. */
  occupancy: Set<string>;
  /** chest 후보 perimeter 셀 (enumeratePerimeterCells 결과). */
  chestCandidates: { x: number; y: number }[];
  config?: Partial<TrunkConfig>;
  /**
   * 종착(`chestCell`) 셀이 *이미 점유된* 컨테이너 셀인 경우 true.
   *
   * 기본(false): chestCell 은 빈 perimeter 칸이며 거기에 무한상자를 새로 놓는다.
   * true: 종착이 이미 배치된 소비자 머신의 footprint 가장자리 셀이다 — chestCell 의
   *   free 검사와 occ 추가를 건너뛴다(소비자가 이미 점유). feederSeat·trunkStart 는
   *   여전히 free 여야 한다. collect 모드에서 feeder(리시버) 인서터가 트렁크에서 집어
   *   chestCell(=소비자 셀)에 드롭하므로, 별도 상자 없이 소비자에 직접 투입된다.
   */
  terminalOccupied?: boolean;
  /**
   * 트렁크 허용 영역 (포함 경계). 주어지면 트렁크 belt·seat·tap·feeder 가 이 직사각형
   * 밖으로 나가지 못한다 — perimeter ring 단일 외곽선 불변식(ring 바깥 누출 금지).
   * 트렁크는 chest(ring)에서 안쪽으로 자라 대개 이미 내부지만, 안전망으로 클립한다.
   * 미지정이면 제약 없음.
   */
  bounds?: { x0: number; y0: number; x1: number; y1: number };
  /**
   * `machines` 중 **싱크(소비자)** 로 다룰 머신 id 집합. 멀티싱크 버스에서 종착(chest)
   * 부모 외의 부모들을 belt 도중 sink-tap 으로 잇는다. 탐색·기하는 소스와 동일하고,
   * 결과 `TapRecord.role` 만 'sink' 가 된다(emit 이 인서터 픽업 방향을 belt→머신으로
   * 뒤집음). 미지정/빈 집합이면 전부 'source'(기존 동작과 동일).
   */
  sinkIds?: Set<string>;
  /**
   * 머신별 탭 면/reach 제약 — 면 할당기(clusterFaceAllocator)가 각 머신을 어느
   * 슬롯(면+레인)에서 탭할지 못박을 때. 키=머신 id. 미지정 머신은 자유(기존 동작).
   * 한 클러스터의 여러 트렁크(내부버스·외부)가 서로 다른 슬롯을 받아 충돌을 원천 차단한다.
   */
  faceConstraints?: Map<string, { face?: PortFace; reach?: number }>;
  /**
   * 종착(chest=포트) 을 지배축의 어느 **끝**에 둘지 선호 (DOF-B). "min"=축 작은 끝(기둥
   * 이면 위), "max"=큰 끝(아래). full-tap·직선(crossSpan) 동률인 seed 들 중 선호 끝에
   * 가까운 chestCell 을 고른다(트렁크 길이보다 우선). 미지정이면 영향 없음(기존 동작).
   * 합성 단계가 부모↔자식 포트 y 를 마주 보게 정렬(홉 단축)하는 데 쓴다.
   */
  endPreference?: "min" | "max";
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

  // chest seed 후보 선정 — 두 부류를 합친다:
  //  (1) centroid 근접 seed: 뭉친(blob) 클러스터용 (기존 동작).
  //  (2) 축 평행 seed: inwardCardinal 이 *지배축*을 따르는 후보. 클러스터 끝에서
  //      축에 평행하게 성장 → 한 줄(기둥/행)을 한쪽 변에서 직선으로 전부 탭한다.
  //      (centroid 근접 seed 는 줄에 수직으로 파고들어 1~2대만 닿고 끝나기 쉬움.)
  // 그리고 첫-매치 반환이 아니라 *모든 seed 를 평가해 untapped 최소(이상 0)* 를 고른다.
  const byCentroid = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    manhattan(a, centroid) - manhattan(b, centroid);
  const horizontal = dominantAxisHorizontal(machines);
  const nearest = [...input.chestCandidates].sort(byCentroid).slice(0, cfg.maxSeeds);

  // 클러스터 footprint 의 지배축 범위 [aMin, aMax]. 그 밖(끝 너머)에서 시작하는 평행
  // seed 라야 축 전체를 한쪽 변으로 훑는다. 안쪽(중간) 평행 seed 는 중앙에서 자라
  // 한쪽 끝밖에 못 닿거나 감아돈다 → 끝-너머 seed 를 우선해 slice 에 살아남게 한다.
  let aMin = Infinity, aMax = -Infinity;
  for (const m of machines) {
    const lo = horizontal ? m.origin.x : m.origin.y;
    const hi = horizontal ? m.origin.x + m.size.w - 1 : m.origin.y + m.size.h - 1;
    if (lo < aMin) aMin = lo;
    if (hi > aMax) aMax = hi;
  }
  const along = (c: { x: number; y: number }) => (horizontal ? c.x : c.y);
  // 끝 너머 거리 (작을수록 클러스터 끝에 바짝, 짧은 feeder). 안쪽이면 0.
  const endDist = (c: { x: number; y: number }) => {
    const a = along(c);
    return a < aMin ? aMin - a : a > aMax ? a - aMax : 0;
  };
  // 평행 + 끝 너머 seed = 한쪽 변 직선 spine 후보. 얕은 끝(짧은 cap)부터, 충분히
  // 많이 평가한다(경계 slice 로 좋은 측면-열 seed 가 잘려나가지 않도록 여유 cap).
  const endSeeds = input.chestCandidates
    .filter((c) => {
      const f = inwardFromWall(c, centroid, input.bounds);
      const par = horizontal ? f.y === 0 : f.x === 0; // 성장 방향이 지배축과 평행한가.
      return par && endDist(c) > 0;
    })
    .sort((a, b) => endDist(a) - endDist(b) || byCentroid(a, b))
    .slice(0, cfg.maxSeeds * 4);

  // 모든 후보 seed 를 평가해 *가장 깔끔한 full-tap* 을 고른다. 점수(작을수록 좋음):
  //   [ untapped 수, 횡축 span, 트렁크 길이 ].
  // 횡축 span = 지배축에 수직인 좌표의 폭. 한쪽 변에 붙은 직선 spine 은 span 0,
  // 클러스터를 가로질러 감아도는 경로는 span 큼 → 후자를 배제한다. 이로써 한 줄을
  // 한쪽 변에서 깔끔히 탭하고 반대 변을 비워 2차 패스(입력↔출력)가 충돌 없이 깔린다.
  const crossSpan = (p: TrunkPath): number => {
    if (p.trunkCells.length === 0) return 0;
    let lo = Infinity, hi = -Infinity;
    for (const c of p.trunkCells) {
      const v = horizontal ? c.y : c.x;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return hi - lo;
  };
  // 선호 끝(DOF-B) 페널티 — 작을수록 선호 끝에 가깝다. 미지정이면 0(무영향).
  const endPenalty = (p: TrunkPath): number => {
    if (!input.endPreference) return 0;
    const a = horizontal ? p.chestCell.x : p.chestCell.y;
    return input.endPreference === "min" ? a : -a;
  };
  const seen = new Set<string>();
  let best: TrunkPath | null = null;
  let bestScore: number[] | null = null;
  let seedsEvaluated = 0;
  for (const chestCell of [...endSeeds, ...nearest]) {
    const k = key(chestCell);
    if (seen.has(k)) continue;
    seen.add(k);
    const grown = tryGrow(chestCell, order, centroid, baseOcc, cfg, input.terminalOccupied ?? false, horizontal, input.sinkIds, input.bounds, input.faceConstraints);
    if (!grown) continue;
    seedsEvaluated++;
    // [untapped, 횡축 span, 선호 끝, 트렁크 길이]. 끝 선호는 직선(span) 다음·길이 앞.
    const score: number[] = [grown.untapped.length, crossSpan(grown), endPenalty(grown), grown.trunkCells.length];
    if (bestScore === null || lexLt(score, bestScore)) {
      best = grown;
      bestScore = score;
    }
  }
  if (best && bestScore) {
    best.selectionDebug = {
      untapped: bestScore[0],
      crossSpan: bestScore[1],
      endPenalty: bestScore[2],
      trunkLen: bestScore[3],
      seedsEvaluated,
    };
    return { ok: true, path: best };
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
  terminalOccupied: boolean,
  /** 클러스터 지배축이 가로인가 — cross-axis(장축 평행면) 탭 페널티 판정용. */
  horizontal: boolean,
  /** belt→머신 픽업으로 다룰 싱크 머신 id (멀티싱크 버스의 부모 탭). */
  sinkIds?: Set<string>,
  /** 트렁크 허용 영역 (포함 경계). bounds 밖 셀은 못 쓴다(ring 바깥 누출 금지). */
  bounds?: { x0: number; y0: number; x1: number; y1: number },
  /** 머신별 탭 면/reach 제약 (면 할당기). */
  faceConstraints?: Map<string, { face?: PortFace; reach?: number }>,
): TrunkPath | null {
  const occ = new Set(baseOcc);
  const inBounds = (c: { x: number; y: number }): boolean =>
    bounds === undefined ||
    (c.x >= bounds.x0 && c.x <= bounds.x1 && c.y >= bounds.y0 && c.y <= bounds.y1);

  // chest 는 1×1, chest→트렁크도 인서터(normal). f = 벽 법선 inward (게이트웨이 규칙:
  // 서/동벽=수평, 북/남벽=수직). bounds 없거나 코너면 centroid 향 폴백.
  // terminalOccupied: chestCell 은 이미 배치된 소비자 셀 → free 검사·occ 추가를 건너뛴다.
  const f = inwardFromWall(chestCell, centroid, bounds);
  const feederSeat = add(chestCell, f);
  const trunkStart = add(chestCell, mul(f, 2));
  const chestBlocked = !terminalOccupied && occ.has(key(chestCell));
  if (chestBlocked || occ.has(key(feederSeat)) || occ.has(key(trunkStart))) {
    return null; // 이 seed 는 시작조차 불가 → 다음 seed.
  }
  // 시작 셀이 ring 직사각형 밖이면 이 seed 폐기(트렁크가 바깥으로 시작 불가).
  if (!inBounds(chestCell) || !inBounds(feederSeat) || !inBounds(trunkStart)) {
    return null;
  }
  if (!terminalOccupied) occ.add(key(chestCell));
  occ.add(key(feederSeat));
  occ.add(key(trunkStart));

  // 방문 순서를 *이 seed* 의 접근 방향에 맞춘다. `order` 는 지배축 투영 오름차순
  // (전역, seed 무관)이라, chest 가 축의 높은 쪽 끝에 있으면 head 가 머신들을
  // 내림차순으로 만난다. 오름차순 그대로 방문하면 먼(높은 투영) 머신으로 가는
  // 경로가 그 사이 가까운 머신의 자연 탭 셀을 깔고 앉아, 그 머신이 긴팔+우회로로
  // 밀려난다. trunkStart 가 클러스터 투영 중점보다 높은 쪽이면 뒤집어, 항상
  // "가까운 머신부터" 단조 방문(위빙 없음)하게 한다.
  const projOf = (m: MachineLike) =>
    horizontal ? m.origin.x + m.size.w / 2 : m.origin.y + m.size.h / 2;
  const projStart = horizontal ? trunkStart.x : trunkStart.y;
  let pMin = Infinity, pMax = -Infinity;
  for (const m of order) {
    const p = projOf(m);
    if (p < pMin) pMin = p;
    if (p > pMax) pMax = p;
  }
  const visit = projStart > (pMin + pMax) / 2 ? [...order].reverse() : order;

  const trunkCells: TrunkCell[] = [{ x: trunkStart.x, y: trunkStart.y, dir: dirOf(f) }];
  let headIdx = 0;
  let head = trunkStart;
  let headDir = dirOf(f);

  const covered: TapRecord[] = [];
  const untapped: string[] = [];
  const untappedInfo: NonNullable<TrunkPath['untappedInfo']> = [];

  for (const m of visit) {
    let best: { cand: TapRecord; path: SubPath } | null = null;
    let bestCost = Infinity;
    let nCands = 0, nOobSeatTap = 0, nNoPath = 0, nOobPath = 0;

    for (const cand of tapCandidates(m, occ, head, cfg.longReach, faceConstraints?.get(m.id))) {
      nCands += 1;
      // seat·tap 이 ring 직사각형 밖이면 이 후보 폐기(바깥 누출 금지).
      if (!inBounds(cand.seat) || !inBounds(cand.tapCell)) { nOobSeatTap += 1; continue; }
      const path = findBeltSubPath(head, headDir, cand.tapCell, occ, cand.seat);
      if (!path) { nNoPath += 1; continue; }
      // 서브 경로 셀이 하나라도 bounds 밖이면 폐기.
      if (path.cells.some((c) => !inBounds(c))) { nOobPath += 1; continue; }
      const bends = (path.firstDir !== headDir ? 1 : 0) + path.internalBends;
      // cross-axis = 탭 면이 지배축과 평행(컬럼이면 N/S 끝면). 한 축 정렬을 위해 페널티.
      const fv = faceVector(cand.face);
      const crossAxis = horizontal ? fv.x !== 0 : fv.y !== 0;
      const cost =
        path.cells.length +
        cfg.wBend * bends +
        cfg.wReach * (cand.reach > 1 ? 1 : 0) +
        (crossAxis ? cfg.wCrossAxis : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = { cand, path };
      }
    }

    if (!best) {
      // 직접 탭 불가 → ② 스퍼에 위임.
      untapped.push(m.id);
      untappedInfo.push({ id: m.id, cands: nCands, oobSeatTap: nOobSeatTap, noPath: nNoPath, oobPath: nOobPath });
      continue;
    }

    // commit. 싱크 머신이면 belt→머신 흐름(role='sink') — emit 이 픽업 방향을 뒤집는다.
    const { cand, path } = best;
    cand.role = sinkIds?.has(m.id) ? 'sink' : 'source';
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

  return { trunkCells, chestCell, covered, untapped, untappedInfo };
}

// ─────────────────────────────────────────────────────────────────────────────
// 탭 후보
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 머신 1개의 직접 탭 후보들. seat 은 비어있어야 하고, tapCell 은 비어있거나
 * (이미 깔린) 현재 트렁크 head 여야 한다 — head 면 새 벨트 없이 그 셀을 그대로
 * 탭한다. 긴팔(`longReach`≥2)은 seat=port·pickup=port+longReach·v 로 앞 칸들을
 * 건너뛰며, 중간 칸(port+v … port+(longReach−1)v)은 팔이 위로 넘으므로 검사하지
 * 않는다(인서터 정의 확장). `longReach` 미지정/<2 면 긴팔 후보를 만들지 않는다.
 * 4면 둘레 포트 전부를 본다(포트 자유도).
 */
export function tapCandidates(
  m: MachineLike,
  occ: Set<string>,
  head?: { x: number; y: number },
  longReach?: number,
  /**
   * 면/reach 제약 — 면 할당기(clusterFaceAllocator)가 한 스트림을 배정한 슬롯
   * (예: W면·reach2)으로 탭을 가둘 때. `face` 지정 시 그 면 포트만, `reach` 지정 시
   * 그 거리 후보만 생성한다. 미지정이면 전체(기존 동작).
   */
  constraint?: { face?: PortFace; reach?: number },
): TapRecord[] {
  const tapOk = (c: { x: number; y: number }) =>
    free(occ, c) || (head !== undefined && c.x === head.x && c.y === head.y);
  const out: TapRecord[] = [];
  for (const { cell: port, face } of machinePorts(m)) {
    if (constraint?.face && face !== constraint.face) continue;
    const v = faceVector(face);
    // normal: seat=rim1(port), tap=rim2(port+v)
    const nTap = add(port, v);
    if ((constraint?.reach === undefined || constraint.reach === 1) && free(occ, port) && tapOk(nTap)) {
      out.push({ machineId: m.id, port, face, reach: 1, seat: port, tapCell: nTap, role: 'source' });
    }
    // 긴팔(reach R): seat=rim1(port, 머신 옆), pickup=port+R·v(앞 칸들 건너 뒷 칸).
    // 중간 칸(port+v … port+(R−1)v)은 팔이 위로 넘으므로 검사하지 않는다(인서터 정의
    // 확장). drop = seat−R·v 쪽 머신 내부. 내 자리(seat) + 집는 칸(pickup)만 따진다.
    if (longReach !== undefined && longReach >= 2 &&
        (constraint?.reach === undefined || constraint.reach === longReach)) {
      const lTap = add(port, mul(v, longReach));
      if (free(occ, port) && tapOk(lTap)) {
        out.push({ machineId: m.id, port, face, reach: longReach, seat: port, tapCell: lTap, role: 'source' });
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

/** 지배축(머신 중심 분포가 넓은 쪽)이 가로인지. true=가로(행), false=세로(기둥). */
function dominantAxisHorizontal(machines: MachineLike[]): boolean {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const m of machines) {
    const cx = m.origin.x + m.size.w / 2;
    const cy = m.origin.y + m.size.h / 2;
    minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
    minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
  }
  return maxX - minX >= maxY - minY;
}

/** 지배축(넓은 쪽) 투영순 정렬. 머신은 안 움직이고 방문 순서만 매긴다. */
function visitOrder(machines: MachineLike[]): MachineLike[] {
  const horizontal = dominantAxisHorizontal(machines);
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

/**
 * 트렁크가 chest 에서 자라나갈 inward 방향. **벽 법선으로 고정**해 게이트웨이 규칙
 * (1:1 경로의 `inwardRingFace`)과 통일한다 — 서/동벽 상자는 수평(E/W) feeder,
 * 북/남벽 상자는 수직(S/N) feeder 로, ring 이 한 칸씩 후퇴하며 chest↔centroid 상대
 * 위치가 바뀌어도 면이 흔들리지 않게 한다.
 *
 * `bounds` 가 주어지고 cell 이 한 변 위에만 있으면 그 변의 inward 법선. 코너(두 변
 * 동시)·내부·bounds 미지정이면 centroid 향 `inwardCardinal` 로 폴백(축은 여전히
 * cardinal). 폴백조차 코너에선 두 벽 법선 중 centroid 우세축을 고르므로 axis-aligned.
 */
function inwardFromWall(
  cell: { x: number; y: number },
  centroid: { x: number; y: number },
  bounds?: { x0: number; y0: number; x1: number; y1: number },
): { x: number; y: number } {
  if (bounds) {
    const onW = cell.x === bounds.x0;
    const onE = cell.x === bounds.x1;
    const onN = cell.y === bounds.y0;
    const onS = cell.y === bounds.y1;
    const vWall = onW || onE; // 세로 변(서/동) → 수평 법선
    const hWall = onN || onS; // 가로 변(북/남) → 수직 법선
    if (vWall && !hWall) return { x: onW ? 1 : -1, y: 0 };
    if (hWall && !vWall) return { x: 0, y: onN ? 1 : -1 };
  }
  return inwardCardinal(cell, centroid);
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

/** 동일 길이 숫자 튜플 사전식 비교 — a < b 면 true. (seed 점수 선택용.) */
function lexLt(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

function key(c: { x: number; y: number }): string {
  return cellKey(c.x, c.y);
}

function free(occ: Set<string>, c: { x: number; y: number }): boolean {
  return !occ.has(cellKey(c.x, c.y));
}
