/**
 * 라우팅 fallback — 그리디 매칭 실패 시 다른 port 셀 시도.
 *
 * 두 컨테이너 사이에 라우팅을 깔되, `resolvePortPair` 의 그리디 결정이 실패하면
 * 모든 port 조합을 manhattan 거리 오름차순으로 시도한다. 어느 조합이라도
 * 라우팅 성공하면 그 라우팅 반환. 모두 실패하면 ok=false + 시도 목록.
 *
 * `routePorts` 자체는 area 를 mutate 하지 않으므로 (`commitRouting` 이 따로)
 * 시도 중에 영역 상태를 더럽히지 않는다.
 *
 * 본 함수는 통합 단계 (`areaUnification` 의 드래그 재시도) 와 사용자 라우팅 편집
 * (`layoutStore`) 에서 사용된다.
 */

import type {
  Area,
  Container,
  ContainerPort,
  ContainerWizardInput,
  PortKind,
  PortPair,
  RoutingAttempt,
} from '../containerModel';
import { routePorts, routeItemMulti } from './facadeRouting';
import { faceVector } from '../util/helper';
import { makeBuildSpec, type BuildSpec } from '../buildSpec';
import { enumerateContainerPorts, resolvePortPair } from './portInference';

/**
 * 옛 경로(Dijkstra 탐색)의 옵션 = [BuildSpec](./buildSpec.ts) **+ 탐색 전용 손잡이**.
 *
 * 둘을 갈라 둔 이유: BuildSpec("무엇으로 지을 수 있나")은 탐색과 무관해서 **예약 경로도**
 * 본다. 아래 필드들(`turnPenalty`·`routingBounds`·`preferUnderground`)은
 * **탐색기에게만 뜻이 있다** — 예약 경로엔 탐색이 없으므로 아무 의미가 없다.
 * 그래서 새 경로는 `RouteOptions` 가 아니라 `BuildSpec` 만 import 한다.
 */
export interface RouteOptions extends BuildSpec {
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
   * 머문다 — 단일 외곽선 불변식(레이아웃 바깥 누출 금지). 드래그 재라우팅이 현재
   * 레이아웃 직사각형으로 설정한다. 미지정이면 제약 없음.
   */
  routingBounds?: { x0: number; y0: number; x1: number; y1: number };
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
  // 0. 멀티소스/멀티싱크 우선 경로 — item 초기 배치(pickBest=false)에서, 후보 포트를
  //    미리 고르지 않고 한 번의 Dijkstra 로 전역 최적 포트 페어를 찾는다. 실패(null)면
  //    아래 기존 그리디+enumeration 으로 폴백(코너 케이스·fluid·드래그 재라우팅 보존).
  if (kind === 'item' && !pickBest) {
    const multi = routeItemMulti(
      enumerateContainerPorts(producer, kind, 'producer'),
      enumerateContainerPorts(consumer, kind, 'consumer'),
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
  const greedy = greedyRaw && pairInBounds(greedyRaw) ? greedyRaw : null;
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
  const producerPorts = enumerateContainerPorts(producer, kind, 'producer');
  const consumerPorts = enumerateContainerPorts(consumer, kind, 'consumer');
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
 * 옛 경로용 옵션 = [makeBuildSpec](./buildSpec.ts) + 탐색 전용 손잡이.
 *
 * `preferUnderground` 만 여기서 유도한다(지하 변형을 하나라도 골랐으면 켠다) — 나머지
 * 탐색 손잡이(`turnPenalty`·`routingBounds`)는 호출자가 상황에 따라 얹는다.
 *
 * **새 경로(예약)는 이 함수를 부르지 않는다** — `makeBuildSpec` 을 직접 부른다.
 */
export function buildRoutingOptions(input: ContainerWizardInput): RouteOptions {
  const spec = makeBuildSpec(input);
  return {
    ...spec,
    preferUnderground: !!(spec.undergroundPipeEntityName || spec.undergroundBeltEntityName),
  };
}
