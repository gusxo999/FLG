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

import type {
  Area,
  Container,
  ContainerPort,
  PortKind,
  PortPair,
  RoutingAttempt,
} from './containerModel';
import { routePorts } from './containerRouting';
import { enumerateContainerPorts, resolvePortPair } from './portInference';

export interface RouteOptions {
  beltEntityName: string;
  inserterEntityName: string;
  pipeEntityName: string;
  undergroundPipeEntityName?: string;
  preferUnderground: boolean;
}

export function routeWithFallback(
  producer: Container,
  consumer: Container,
  kind: PortKind,
  area: Area,
  options: RouteOptions,
): RoutingAttempt {
  // 1. 그리디 시도
  const greedy = resolvePortPair(producer, consumer, kind);
  if (greedy) {
    const attempt = routePorts(greedy, area, options);
    if (attempt.ok) return attempt;
  }

  // 2. 모든 port 조합 enumerate, 그리디 페어는 제외 후 manhattan 거리 오름차순.
  const producerPorts = enumerateContainerPorts(producer, kind);
  const consumerPorts = enumerateContainerPorts(consumer, kind);
  if (producerPorts.length === 0 || consumerPorts.length === 0) {
    return { ok: false, reason: 'no-port-pair', tried: greedy ? [greedy] : [] };
  }

  type Cand = { pair: PortPair; dist: number };
  const candidates: Cand[] = [];
  for (const p of producerPorts) {
    for (const c of consumerPorts) {
      if (greedy && samePort(p, greedy.producer) && samePort(c, greedy.consumer)) continue;
      const dist = Math.abs(p.cell.x - c.cell.x) + Math.abs(p.cell.y - c.cell.y);
      candidates.push({ pair: { producer: p, consumer: c }, dist });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);

  const tried: PortPair[] = greedy ? [greedy] : [];
  for (const cand of candidates) {
    tried.push(cand.pair);
    const attempt = routePorts(cand.pair, area, options);
    if (attempt.ok) return attempt;
  }

  return { ok: false, reason: 'no-path', tried };
}

function samePort(a: ContainerPort, b: ContainerPort): boolean {
  return a.cell.x === b.cell.x && a.cell.y === b.cell.y;
}
