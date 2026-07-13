/**
 * 라우팅 fallback — 그리디 매칭 실패 시 다른 port 셀 시도.
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §7.4.
 *
 * 두 컨테이너 사이에 라우팅을 깔되, `resolvePortPair` 의 그리디 결정이 실패하면
 * 모든 port 조합을 manhattan 거리 오름차순으로 시도한다. 어느 조합이라도
 * 라우팅 성공하면 그 라우팅 반환. 모두 실패하면 ok=false + 시도 목록.
 *
 * `routePorts` 자체는 area 를 mutate 하지 않으므로 (`commitRouting` 이 따로)
 * 시도 중에 영역 상태를 더럽히지 않는다.
 *
 * 본 함수는 오케스트레이터 (`containerWizard`) 와 통합 단계 (`areaUnification`
 * 의 드래그 재시도) 양쪽에서 사용된다.
 */

import { useGameDataStore, type Entity } from '../../store/gameDataStore';
import type {
  Area,
  Container,
  ContainerPort,
  ContainerWizardInput,
  PortFace,
  PortKind,
  PortPair,
  RoutingAttempt,
} from './containerModel';
import { routePorts, routeItemMulti } from './containerRouting';
import { faceVector } from './util/helper';
import { inserterReach } from './inserterThroughput';
import { enumerateContainerPorts, resolvePortPair } from './portInference';

export interface RouteOptions {
  beltEntityName: string;
  inserterEntityName: string;
  /**
   * 긴팔(long inserter) 엔티티 + 집기 거리. 트렁크 병합이 앞 belt 를 건너뛰어
   * 뒷 belt 를 탭하는 2번째 레인에 쓴다(용량 4). 사용자가 reach≥2 인서터를 하나도
   * 안 골랐으면 undefined — 긴팔 미사용(reach-1 만). 거리(reach)는 처리량처럼
   * prototype 데이터(`inserter_pickup_position`)에서 산출해 흐른다.
   */
  longInserter?: { entityName: string; reach: number };
  pipeEntityName: string;
  undergroundPipeEntityName?: string;
  undergroundBeltEntityName?: string;
  /** 지하파이프 입출구 좌표 차이 한계. undefined / 0 이면 점프 비활성. */
  pipeMaxUndergroundDistance?: number;
  /** 지하벨트 입출구 좌표 차이 한계. undefined / 0 이면 점프 비활성. */
  beltMaxUndergroundDistance?: number;
  preferUnderground: boolean;
  /**
   * 지상 벨트 꺾임 1회당 추가 cost. 양수면 꺾임이 적은(더 곧은) 경로를 선호한다 —
   * 계단/대각처럼 보이는 벨트를 줄이고, 상자 같은 장애물을 *우회* 하기보다 *직진 점프*
   * 로 넘긴다. 외부상자 드래그 재라우팅에서 가독성 향상용으로만 켠다. 미지정/0 이면
   * 기존 동작(꺾임 무비용). item 벨트 경로에만 적용(파이프 라우팅은 무관).
   */
  turnPenalty?: number;
  /** 탭 인서터(=inserterEntityName)의 사용자 처리량/묶음 보정. 병합 용량 계산용. */
  inserterOverride?: { throughput?: number; stackSize?: number };
  /**
   * 라우팅 허용 영역 (포함 경계). 주어지면 모든 belt/pipe 경로가 이 직사각형 안에
   * 머문다 — perimeter ring 의 단일 외곽선 불변식(ring 바깥 누출 금지). wrap 패스가
   * 현재 ring 직사각형으로 설정한다. 미지정이면 제약 없음(드래그 재라우팅 등 기존 동작).
   */
  routingBounds?: { x0: number; y0: number; x1: number; y1: number };
  /**
   * perimeter ring 게이트웨이 제약 — ring 위 외부상자는 *내부향 한 면* 으로만
   * 포트(인서터)를 노출한다(서벽→E, 동벽→W, 북벽→S, 남벽→N). 지정 시 해당
   * `containerId` 의 후보 포트를 `face` 한 면으로 좁혀, 벽과 나란한 수직 인서터를
   * 막고 상자↔내부 라우팅을 동–서/남–북 수평·수직축으로 정렬한다. 머신이 1칸
   * 간격으로 인접하면 이 면의 포트 셀이 머신 포트 셀과 일치 → 단일 인서터 직접
   * 투입(코너 케이스)이 자동 형성된다. 미지정이면 4면 전부(기존 동작).
   */
  inwardPortFace?: { containerId: string; face: PortFace };
}

export function routeWithFallback(
  producer: Container,
  consumer: Container,
  kind: PortKind,
  area: Area,
  options: RouteOptions,
  external?: Area,
  /**
   * true 면 첫 성공이 아니라 *모든 후보 포트 페어를 시도해 가장 적은 셀(=가장
   * 단순)한 경로* 를 고른다. 드래그 재라우팅처럼 결과 품질이 중요한 곳에서 사용.
   * (기본 false — 위저드 초기 배치는 기존처럼 첫 성공 반환, 성능·동작 유지.)
   */
  pickBest = false,
): RoutingAttempt {
  // ring 게이트웨이 제약 — 지정된 외부상자는 내부향 한 면으로만 포트를 노출한다.
  // 머신 등 다른 컨테이너 포트는 무제약. 미지정이면 항등(기존 동작).
  const ipf = options.inwardPortFace;
  const constrainPorts = (
    c: Container,
    ports: ContainerPort[],
  ): ContainerPort[] =>
    ipf && c.id === ipf.containerId
      ? ports.filter((p) => p.face === ipf.face)
      : ports;
  // 그리디 페어가 제약면을 어기면(상자 쪽 포트가 내부향이 아니면) 폐기.
  const pairObeysConstraint = (pp: PortPair): boolean => {
    if (!ipf) return true;
    if (pp.producer.containerId === ipf.containerId && pp.producer.face !== ipf.face)
      return false;
    if (pp.consumer.containerId === ipf.containerId && pp.consumer.face !== ipf.face)
      return false;
    return true;
  };

  // 0. 멀티소스/멀티싱크 우선 경로 — item 초기 배치(pickBest=false)에서, 후보 포트를
  //    미리 고르지 않고 한 번의 Dijkstra 로 전역 최적 포트 페어를 찾는다. 실패(null)면
  //    아래 기존 그리디+enumeration 으로 폴백(코너 케이스·fluid·드래그 재라우팅 보존).
  if (kind === 'item' && !pickBest) {
    const multi = routeItemMulti(
      constrainPorts(producer, enumerateContainerPorts(producer, kind, 'producer')),
      constrainPorts(consumer, enumerateContainerPorts(consumer, kind, 'consumer')),
      area,
      options,
      external,
    );
    if (multi && multi.ok) return multi;
  }

  // 단일 외곽 링 불변식: 포트(인서터)와 그 belt 끝점이 ring 직사각형 안이어야 한다.
  // 바깥을 향한 포트는 belt 끝점이 ring 밖으로 나가는데, Dijkstra 의 endSet 예외라
  // 경로 bounds 만으론 못 막는다 → 포트 페어 단계에서 거른다. routingBounds 미지정이면
  // 항상 통과(기존 동작).
  const rb = options.routingBounds;
  const portInBounds = (p: ContainerPort): boolean => {
    if (!rb) return true;
    const within = (x: number, y: number) =>
      x >= rb.x0 && x <= rb.x1 && y >= rb.y0 && y <= rb.y1;
    if (!within(p.cell.x, p.cell.y)) return false;
    const v = faceVector(p.face);
    return within(p.cell.x + v.x, p.cell.y + v.y);
  };
  const pairInBounds = (pp: PortPair): boolean =>
    portInBounds(pp.producer) && portInBounds(pp.consumer);

  // 1. 그리디 시도
  const greedyRaw = resolvePortPair(producer, consumer, kind);
  const greedy =
    greedyRaw && pairInBounds(greedyRaw) && pairObeysConstraint(greedyRaw)
      ? greedyRaw
      : null;
  let best: RoutingAttempt | null = null;
  const bestLen = (): number =>
    best && best.ok ? best.routing.placed.length : Infinity;
  const consider = (attempt: RoutingAttempt): RoutingAttempt | null => {
    if (!attempt.ok) return null;
    if (!pickBest) return attempt; // 첫 성공 즉시 반환
    if (attempt.routing.placed.length < bestLen()) best = attempt;
    return null; // 계속 탐색
  };

  if (greedy) {
    const r = consider(routePorts(greedy, area, options, external));
    if (r) return r;
    // pickBest 이고 단일 인서터(1셀)면 더 나아질 수 없으니 조기 종료.
    if (bestLen() <= 1) return best!;
  }

  // 2. 모든 port 조합 enumerate, 그리디 페어는 제외 후 manhattan 거리 오름차순.
  // 유체는 **재료 칸과 결과물 칸이 다르다** — enumeration 폴백도 역할을 지켜야 한다.
  // 안 지키면 "어떤 조합이든 라우팅만 되면 성공"이라 재료 파이프가 출력 칸에 꽂힌다.
  const producerPorts = constrainPorts(producer, enumerateContainerPorts(producer, kind, 'producer'));
  const consumerPorts = constrainPorts(consumer, enumerateContainerPorts(consumer, kind, 'consumer'));
  if (producerPorts.length === 0 || consumerPorts.length === 0) {
    if (best !== null) return best;
    return { ok: false, reason: 'no-port-pair', tried: greedy ? [greedy] : [] };
  }


  type Cand = { pair: PortPair; dist: number };
  const candidates: Cand[] = [];
  for (const p of producerPorts) {
    if (!portInBounds(p)) continue;
    for (const c of consumerPorts) {
      if (!portInBounds(c)) continue;
      if (greedy && samePort(p, greedy.producer) && samePort(c, greedy.consumer)) continue;
      const dist = Math.abs(p.cell.x - c.cell.x) + Math.abs(p.cell.y - c.cell.y);
      candidates.push({ pair: { producer: p, consumer: c }, dist });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);

  const tried: PortPair[] = greedy ? [greedy] : [];
  for (const cand of candidates) {
    tried.push(cand.pair);
    const r = consider(routePorts(cand.pair, area, options, external));
    if (r) return r;
    if (bestLen() <= 1) return best!;
  }

  if (best !== null) return best;
  return { ok: false, reason: 'no-path', tried };
}

function samePort(a: ContainerPort, b: ContainerPort): boolean {
  return a.cell.x === b.cell.x && a.cell.y === b.cell.y;
}

// ─────────────────────────────────────────────────────────────────────────────
// 라우팅 옵션 빌더 — 위저드 입력 → RouteOptions (전략 무관 공용).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 위저드 입력으로부터 라우팅 옵션을 빌드. 사용자가 선택한 첫 underground
 * pipe / belt prototype 의 entityName 과 `max_underground_distance` 를
 * gameDataStore 에서 lookup 한다.
 *
 * 점프 비활성 (= maxDistance=0) 조건:
 *  - 사용자가 underground pipe / belt 를 하나도 선택 안 함, OR
 *  - 선택한 entity 가 prototype 사전에 없음, OR
 *  - max_underground_distance 가 0 / 미정.
 *
 * 배치 전략(S-LAYER) 진입부와 편집 파이프라인(드래그 핸들러) 양쪽에서 호출한다.
 */
export function buildRoutingOptions(input: ContainerWizardInput): RouteOptions {
  const { entityMap } = useGameDataStore.getState();
  const beltEntityName =
    input.primaryBelt ?? input.selectedBelts[0] ?? 'transport-belt';
  const inserterEntityName =
    input.primaryInserter ?? input.selectedInserters[0] ?? 'inserter';

  // 긴팔 = 사용자가 고른 인서터 중 reach≥2 인 첫 엔티티. 거리는 처리량처럼 데이터에서
  // 흐른다(inserterReach). 없으면 undefined → 트렁크가 reach-1 만 사용(오늘과 동일).
  const longInserter = (() => {
    for (const name of input.selectedInserters) {
      const reach = inserterReach(entityMap.get(name));
      if (reach >= 2) return { entityName: name, reach };
    }
    return undefined;
  })();

  const undergroundPipeEntityName = input.selectedUndergroundPipes[0];
  const undergroundBeltEntityName = input.selectedUndergroundBelts[0];

  const pipeMaxUndergroundDistance = undergroundPipeEntityName
    ? lookupPipeUndergroundDistance(entityMap.get(undergroundPipeEntityName))
    : 0;
  const beltMaxUndergroundDistance = undergroundBeltEntityName
    ? (entityMap.get(undergroundBeltEntityName)?.max_underground_distance ?? 0)
    : 0;

  return {
    beltEntityName,
    inserterEntityName,
    longInserter,
    pipeEntityName: 'pipe',
    undergroundPipeEntityName,
    undergroundBeltEntityName,
    pipeMaxUndergroundDistance,
    beltMaxUndergroundDistance,
    preferUnderground: !!(
      undergroundPipeEntityName || undergroundBeltEntityName
    ),
    inserterOverride: input.inserterOverrides?.[inserterEntityName],
  };
}

/**
 * pipe-to-ground 의 underground 거리 추출. Factorio 2.0 prototype API 가
 * connection 별 거리를 두지만 (`fluid_boxes[].connections[].max_underground_distance`),
 * 최상위 `Entity.max_underground_distance` 도 호환용으로 채워진다.
 * connection 우선, 없으면 최상위 fallback.
 */
function lookupPipeUndergroundDistance(entity: Entity | undefined): number {
  if (!entity) return 0;
  for (const fb of entity.fluid_boxes ?? []) {
    for (const c of fb.connections ?? []) {
      if (c.connection_type === 'underground' && c.max_underground_distance) {
        return c.max_underground_distance;
      }
    }
  }
  return entity.max_underground_distance ?? 0;
}
