/**
 * 클러스터 출력 트렁크 병합 — 자식 클러스터(N대 동일 머신)의 *아이템* 출력을 단일
 * collect 트렁크 벨트 1줄로 묶어 소비자 머신에 전달한다 (트리 간선 버전).
 *
 * 단일 출처: 계획서 "클러스터 → 소비자 트렁크 벨트 병합".
 *
 * 기존 [containerWizard.recurseMachineImpl] 은 클러스터 N대를 각자 독립 벨트
 * (`routeWithFallback`)로 소비자에 라우팅한다. 본 모듈은 N대를 무한상자 없이
 * **트렁크 belt 1줄 + 머신별 탭 인서터 + 소비자 투입 인서터 1개**로 병합한다.
 *
 * 핵심: 소비자는 이미 배치된 다중 셀 머신이므로 트렁크의 "chest"(종착)를 소비자
 * footprint 가장자리 셀로 두고 `terminalOccupied` 로 계산한다. collect 모드의
 * feeder(리시버) 인서터가 트렁크에서 집어 그 셀(=소비자)에 드롭 → 직접 투입.
 *
 * 외부 chest 경로([externalMergePass.ts])와 달리 결과를 raw `.placed` 가 아닌
 * **Routing 객체**로 래핑해 반환한다 — recurseMachine 의 routings 가 후보 트리·렌더·
 * 청사진으로 흐르므로 일관성 유지.
 *
 * v1 범위: 단일 트렁크, reach-1 직접 탭만. 전원 직접 탭(untapped 0) 실패·fluid·
 * 머신 1대면 `null` 반환 → 호출자가 기존 머신별 라우팅으로 폴백 (all-or-nothing).
 */

import type { Area, Container, ContainerPort, PortFace, Routing } from './containerModel';
import { buildOccupancy, cellKey, collectBeltFlow, faceVector } from './containerRouting';
import { AUTO_LAYOUT_COORD_DUMP } from './debugFlags';
import type { RouteOptions } from './routeFallback';
import { emitTrunk } from './trunkEmit';
import { computeTrunkPath, type MachineLike } from './trunkPath';

/**
 * 클러스터 N대의 아이템 출력을 단일 트렁크로 병합 시도. 성공 시 병합 결과를 담은
 * `Routing[]`(현재 단일 원소), 실패 시 `null`(→ 호출자 폴백).
 *
 * 호출 전제: `machines` 는 모두 같은 product 를 `consumer` 로 보내는 동일 레시피
 * 머신이고, 모두 `internal.placed` 에 배치 완료, `consumer` 도 배치 완료.
 * 아이템 전용 — fluid 는 호출자가 게이트한다.
 */
export function tryMergeClusterOutput(
  machines: Container[],
  consumer: Container,
  internal: Area,
  external: Area,
  options: RouteOptions,
): Routing[] | null {
  if (machines.length < 2) return null;

  const machineLikes: MachineLike[] = machines.map((m) => ({
    id: m.id,
    origin: { ...m.origin },
    size: { ...m.size },
  }));

  // 외부 벨트 수신 칸도 차단 — 트렁크가 타 라우팅 벨트 스트림과 합류하지 않게.
  const occupancy = buildOccupancy(internal, external);
  for (const k of collectBeltFlow([internal, external]).sinkTargets) occupancy.add(k);
  const result = computeTrunkPath({
    machines: machineLikes,
    occupancy,
    chestCandidates: consumerEdgeCells(consumer),
    config: { longReach: options.longInserter?.reach }, // 긴팔 보유 시 reach≥2 탭 허용
    terminalOccupied: true, // 종착 = 이미 배치된 소비자 셀
  });

  // v1 "전원 직접 탭" 가정 — 일부라도 미탭이면 통째로 폴백.
  if (!result.ok || result.path.untapped.length > 0) {
    if (AUTO_LAYOUT_COORD_DUMP) {
      console.log(
        '[autoLayout debug] clusterTrunkMerge\n' +
          JSON.stringify(
            {
              consumer: consumer.id,
              consumerRecipe: consumer.recipeName ?? null,
              producerRecipe: machines[0]?.recipeName ?? null,
              machineIds: machines.map((m) => m.id),
              machines: machines.length,
              mode: 'fallback-independent',
              reason: result.ok ? `untapped=${result.path.untapped.length}` : result.infeasible,
            },
            null,
            2,
          ),
      );
    }
    return null;
  }

  const path = result.path;
  const emission = emitTrunk(path, {
    chestId: consumer.id,
    beltEntityName: options.beltEntityName,
    inserterEntityName: options.inserterEntityName,
    longInserterEntityName: options.longInserter?.entityName ?? options.inserterEntityName,
    mode: 'collect',
  });

  // emission 셀들을 단일 Routing 으로 래핑. 셀 entityId 는 emitTrunk 가 이미 부여.
  const placed = [
    ...emission.beltCells,
    ...(emission.feeder ? [emission.feeder] : []),
    ...emission.taps.map((t) => t.inserter),
  ];

  const first = path.covered[0];
  const from: ContainerPort = {
    containerId: first.machineId,
    cell: { ...first.port },
    face: first.face,
    kind: 'item',
  };
  const to: ContainerPort = {
    containerId: consumer.id,
    cell: { ...path.chestCell },
    face: terminalFace(path),
    kind: 'item',
  };

  const routing: Routing = {
    id: nextClusterTrunkId(),
    kind: 'item',
    from,
    to,
    placed,
    corridors: [],
  };

  if (AUTO_LAYOUT_COORD_DUMP) {
    console.log(
      '[autoLayout debug] clusterTrunkMerge\n' +
        JSON.stringify(
          {
            consumer: consumer.id,
            consumerRecipe: consumer.recipeName ?? null,
            producerRecipe: machines[0]?.recipeName ?? null,
            machineIds: machines.map((m) => m.id),
            machines: machines.length,
            mode: 'trunk',
            beltCells: emission.beltCells.length,
            taps: emission.taps.length,
          },
          null,
          2,
        ),
    );
  }

  return [routing];
}

// ─────────────────────────────────────────────────────────────────────────────
// 멀티싱크 버스 — 클러스터 출력을 *여러* 소비자 부모에 분배
// ─────────────────────────────────────────────────────────────────────────────

export interface BusMergeOptions {
  /** 자식 클러스터 총 출력 (items/sec). 트렁크(벨트) 수 산정용. */
  childTotalOutput: number;
  /** 벨트 한 줄 처리량 (items/sec). 0/음수면 분할하지 않음(트렁크 1개). */
  beltThroughputPerSec: number;
}

/**
 * 자식 클러스터(N대 동일 머신)의 아이템 출력을 **여러 소비자 부모**에 분배하는
 * 멀티싱크 버스. 한 트렁크 belt 1줄이 자식 출력을 모아 여러 부모를 지나며 각 부모에
 * 리시버 인서터(sink-tap)로 투입한다. 자식 총출력이 벨트 1줄 처리량을 넘으면
 * `ceil(출력/처리량)` 개의 트렁크로 자식·부모를 균형 분할한다(벨트 용량만큼).
 *
 * 각 트렁크의 종착(chest=feeder)은 **자식 centroid 에서 가장 먼 부모**다 — 그래야 자식·다른
 * 부모가 모두 한 쪽에 몰려 단조 방문(깔끔한 단일 belt)이 가능하다. 나머지 부모는 belt
 * 도중 sink-tap. collect belt 흐름상 자식(소스)이 올리고 부모(싱크)가 내린다.
 *
 * 전제: `machines` 는 같은 product 를 만드는 동일 레시피 자식 N대(배치 완료), `consumers`
 * 는 그 product 를 쓰는 동일 부모 클러스터(2대 이상, 배치 완료). 아이템 전용.
 * 일부 트렁크라도 미탭/자식없음이면 통째로 `null`(→ 호출자 폴백, all-or-nothing).
 */
export function tryMergeClusterOutputBus(
  machines: Container[],
  consumers: Container[],
  internal: Area,
  external: Area,
  options: RouteOptions,
  busOpts: BusMergeOptions,
  /**
   * 부모(소비자) 클러스터 sink-탭을 가둘 면/reach (면 할당기). 같은 부모에 들어오는
   * 여러 자식 버스가 서로 다른 슬롯(예: E-near / E-far)을 받아 충돌·미탭을 막는다.
   * 미지정이면 자유(기존 동작).
   */
  parentConstraint?: { face?: PortFace; reach?: number },
): Routing[] | null {
  if (machines.length < 1 || consumers.length < 2) return null;

  // 트렁크 수 = ceil(총출력 / 벨트처리량). 부모/자식 수를 넘지 못한다(트렁크마다 ≥1 부모·자식).
  const rawN =
    busOpts.beltThroughputPerSec > 0
      ? Math.max(1, Math.ceil(busOpts.childTotalOutput / busOpts.beltThroughputPerSec))
      : 1;
  const nTrunks = Math.min(rawN, consumers.length, machines.length);

  // 결정적 분할 — 좌표(y,x)순 정렬 후 인접 균형 그룹(국소성 유지).
  const sortedParents = [...consumers].sort(byCoord);
  const sortedChildren = [...machines].sort(byCoord);
  const parentGroups = splitBalanced(sortedParents, nTrunks);
  const childGroups = splitBalanced(sortedChildren, nTrunks);

  // 누적 occupancy — 앞 트렁크가 깐 셀을 뒤 트렁크가 피한다(머신 footprint 는
  // computeTrunkPath 가 자동 추가하므로 여기엔 base + 트렁크 셀만 쌓는다).
  const occ = buildOccupancy(internal, external);
  // 외부 벨트 수신 칸도 차단 — 버스가 타 라우팅 벨트 스트림과 합류하지 않게.
  for (const k of collectBeltFlow([internal, external]).sinkTargets) occ.add(k);
  const routings: Routing[] = [];

  for (let g = 0; g < nTrunks; g++) {
    const childGroup = childGroups[g];
    const parentGroup = parentGroups[g];
    if (childGroup.length === 0 || parentGroup.length === 0) return null;

    // 종착 = 자식 centroid 에서 가장 먼 부모. 나머지 부모 = sink-tap.
    const childCentroid = centroidOf(childGroup);
    const terminal = farthestFrom(parentGroup, childCentroid);
    const sinks = parentGroup.filter((p) => p.id !== terminal.id);

    const machineLikes: MachineLike[] = [...childGroup, ...sinks].map((m) => ({
      id: m.id,
      origin: { ...m.origin },
      size: { ...m.size },
    }));

    // 면 할당: 부모 sink 들을 배정 슬롯(면+reach)으로 가두고, 종착(terminal)도
    // 같은 면 가장자리에서만 seed 하도록 candidate 를 거른다 → 같은 부모의 여러 자식
    // 버스가 서로 다른 슬롯에 깔려 충돌·미탭이 사라진다.
    let chestCandidates = consumerEdgeCells(terminal);
    let faceConstraints: Map<string, { face?: PortFace; reach?: number }> | undefined;
    if (parentConstraint?.face) {
      const filtered = faceEdgeCells(terminal, parentConstraint.face);
      if (filtered.length > 0) chestCandidates = filtered;
      faceConstraints = new Map(sinks.map((s) => [s.id, parentConstraint]));
    }

    const result = computeTrunkPath({
      machines: machineLikes,
      occupancy: occ,
      chestCandidates,
      config: { longReach: options.longInserter?.reach },
      terminalOccupied: true,
      sinkIds: new Set(sinks.map((s) => s.id)),
      faceConstraints,
    });

    if (!result.ok || result.path.untapped.length > 0) {
      if (AUTO_LAYOUT_COORD_DUMP) {
        console.log(
          '[autoLayout debug] clusterTrunkMergeBus\n' +
            JSON.stringify(
              {
                terminal: terminal.id,
                terminalRecipe: terminal.recipeName ?? null,
                childRecipe: childGroup[0]?.recipeName ?? null,
                childIds: childGroup.map((m) => m.id),
                children: childGroup.length,
                sinks: sinks.length,
                mode: 'fallback-independent',
                reason: result.ok ? `untapped=${result.path.untapped.length}` : result.infeasible,
              },
              null,
              2,
            ),
        );
      }
      return null;
    }

    const path = result.path;
    const emission = emitTrunk(path, {
      chestId: terminal.id,
      beltEntityName: options.beltEntityName,
      inserterEntityName: options.inserterEntityName,
      longInserterEntityName: options.longInserter?.entityName ?? options.inserterEntityName,
      mode: 'collect',
    });

    const placed = [
      ...emission.beltCells,
      ...(emission.feeder ? [emission.feeder] : []),
      ...emission.taps.map((t) => t.inserter),
    ];
    // 뒤 트렁크가 이 트렁크 셀을 피하도록 occ 에 누적.
    for (const c of placed) occ.add(cellKey(c.x, c.y));

    // from = 첫 *소스*(자식) 탭 — covered 에 sink(부모)가 섞이므로 source 만 고른다.
    const firstSource = path.covered.find((t) => t.role === 'source') ?? path.covered[0];
    const from: ContainerPort = {
      containerId: firstSource.machineId,
      cell: { ...firstSource.port },
      face: firstSource.face,
      kind: 'item',
    };
    const to: ContainerPort = {
      containerId: terminal.id,
      cell: { ...path.chestCell },
      face: terminalFace(path),
      kind: 'item',
    };

    routings.push({
      id: nextClusterTrunkId(),
      kind: 'item',
      from,
      to,
      placed,
      corridors: [],
    });

    if (AUTO_LAYOUT_COORD_DUMP) {
      console.log(
        '[autoLayout debug] clusterTrunkMergeBus\n' +
          JSON.stringify(
            {
              terminal: terminal.id,
              terminalRecipe: terminal.recipeName ?? null,
              childRecipe: childGroup[0]?.recipeName ?? null,
              childIds: childGroup.map((m) => m.id),
              children: childGroup.length,
              sinks: sinks.map((s) => s.id),
              mode: 'bus',
              beltCells: emission.beltCells.length,
              taps: emission.taps.length,
              nTrunks,
            },
            null,
            2,
          ),
      );
    }
  }

  return routings.length > 0 ? routings : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 소비자 footprint 의 *가장자리* 셀들 (트렁크 종착 후보). 클러스터-향 면의 셀이
 * centroid 근접순 정렬로 먼저 시도되며, feederSeat(가장자리+f)·trunkStart 가 빈
 * 칸인 seed 만 성장한다 (computeTrunkPath 내부). 가장자리 셀에 collect feeder 가
 * 드롭하면 곧 소비자 투입이다.
 */
function consumerEdgeCells(c: Container): { x: number; y: number }[] {
  const { x: ox, y: oy } = c.origin;
  const { w, h } = c.size;
  const cells: { x: number; y: number }[] = [];
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      const onEdge = dx === 0 || dx === w - 1 || dy === 0 || dy === h - 1;
      if (onEdge) cells.push({ x: ox + dx, y: oy + dy });
    }
  }
  return cells;
}

/**
 * 소비자 footprint 의 한 *면*(face) 가장자리 셀들 — 면 할당기가 종착(terminal)을
 * 그 면에서만 seed 하도록 chestCandidates 를 거를 때. centroid 근접순은 computeTrunkPath
 * 가 적용한다. E=오른쪽 열, W=왼쪽 열, N=위 행, S=아래 행.
 */
function faceEdgeCells(c: Container, face: PortFace): { x: number; y: number }[] {
  const { x: ox, y: oy } = c.origin;
  const { w, h } = c.size;
  const cells: { x: number; y: number }[] = [];
  if (face === 'E') for (let dy = 0; dy < h; dy++) cells.push({ x: ox + w - 1, y: oy + dy });
  else if (face === 'W') for (let dy = 0; dy < h; dy++) cells.push({ x: ox, y: oy + dy });
  else if (face === 'N') for (let dx = 0; dx < w; dx++) cells.push({ x: ox + dx, y: oy });
  else for (let dx = 0; dx < w; dx++) cells.push({ x: ox + dx, y: oy + h - 1 });
  return cells;
}

/** 결정적 정렬 키 — origin (y, x). */
function byCoord(a: Container, b: Container): number {
  return a.origin.y - b.origin.y || a.origin.x - b.origin.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** items 를 n 개의 인접 균형 그룹으로 분할 (앞 그룹이 나머지를 1개씩 더 가짐). */
function splitBalanced<T>(items: T[], n: number): T[][] {
  const groups: T[][] = [];
  const base = Math.floor(items.length / n);
  let rem = items.length % n;
  let i = 0;
  for (let g = 0; g < n; g++) {
    const size = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
    groups.push(items.slice(i, i + size));
    i += size;
  }
  return groups;
}

/** 머신 footprint 중심들의 평균(centroid). */
function centroidOf(ms: Container[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const m of ms) {
    sx += m.origin.x + m.size.w / 2;
    sy += m.origin.y + m.size.h / 2;
  }
  return { x: sx / ms.length, y: sy / ms.length };
}

/** ref 에서 (footprint 중심 기준) 맨해튼 거리가 가장 먼 머신. 동률은 byCoord 로 결정적. */
function farthestFrom(ms: Container[], ref: { x: number; y: number }): Container {
  let best = ms[0];
  let bestD = -Infinity;
  for (const m of ms) {
    const cx = m.origin.x + m.size.w / 2;
    const cy = m.origin.y + m.size.h / 2;
    const d = Math.abs(cx - ref.x) + Math.abs(cy - ref.y);
    if (d > bestD || (d === bestD && byCoord(m, best) < 0)) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

/** 종착 셀에서 트렁크 시작 셀로 향하는 면 (= 소비자 포트 바깥 방향, 메타데이터용). */
function terminalFace(path: { chestCell: { x: number; y: number }; trunkCells: { x: number; y: number }[] }): PortFace {
  const start = path.trunkCells[0];
  if (!start) return 'N';
  const vx = Math.sign(start.x - path.chestCell.x);
  const vy = Math.sign(start.y - path.chestCell.y);
  const faces: PortFace[] = ['N', 'E', 'S', 'W'];
  for (const f of faces) {
    const v = faceVector(f);
    if (v.x === vx && v.y === vy) return f;
  }
  return 'N';
}

let clusterTrunkIdCounter = 0;
function nextClusterTrunkId(): string {
  clusterTrunkIdCounter += 1;
  return `cluster-trunk-${clusterTrunkIdCounter}`;
}
