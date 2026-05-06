/**
 * 모듈 3a — port 유추 (그리디).
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §5 / §7.4 / Q21.
 *
 * 두 컨테이너 (producer, consumer) 의 *상대 위치* 를 보고 가장 가까운 면의
 * port 를 자동 선택한다. 라우팅이 실패하면 오케스트레이터가 본 함수의 결정을
 * 무시하고 다른 port 셀을 시도할 수 있다 (placement-search §7.4 fallback).
 *
 * 우선순위:
 *  1. 두 컨테이너의 origin 중심을 잇는 직선이 가장 짧게 만나는 두 면을 선택.
 *  2. 같은 면 안에서는 마주보는 셀 페어 중 가장 가까운 쌍.
 *  3. fluid kind 면 fluid_boxes positions 의 셀만 후보 — 둘레 셀 전체가
 *     아니라 *고정된 셀* 만 사용 가능.
 */

import type {
  Container,
  ContainerPort,
  PortKind,
  PortPair,
  ResolvePortPair,
} from './containerModel';

/**
 * 그리디 port 매칭. 실패 시 null (예: fluid kind 인데 한쪽 컨테이너에
 * 해당 fluid 의 fluid_boxes 가 없음).
 */
export const resolvePortPair: ResolvePortPair = (
  _producer: Container,
  _consumer: Container,
  _kind: PortKind,
): PortPair | null => {
  // TODO(placement-search §5 모듈 3a):
  //  1. _producer 의 모든 후보 port 를 _kind 기준으로 enumerate.
  //  2. _consumer 의 모든 후보 port 를 _kind 기준으로 enumerate.
  //  3. 두 컨테이너 origin 중심을 잇는 벡터 방향으로 가장 가까운 두 면을 골라
  //     해당 면의 port 만 후보로 좁힘.
  //  4. 면 안에서 마주보는 셀 페어 중 거리가 최소인 페어를 반환.
  //  5. fluid kind 면 fluid_boxes positions 안의 셀만 후보로 사용.
  throw new Error('portInference.resolvePortPair: not implemented');
};

/**
 * fallback 시도용 — 한 컨테이너의 *모든* port 를 enumerate.
 * 오케스트레이터가 router 실패 시 cross product 로 재시도.
 */
export function enumerateContainerPorts(
  _container: Container,
  _kind: PortKind,
): ContainerPort[] {
  // TODO(placement-search §7.4):
  //  - item kind: footprint 둘레의 모든 셀 (= 2(w + h) 개) 을 ContainerPort 로.
  //  - fluid:<name> kind: fluid_boxes[].connections[].positions 가 정의하는 셀만.
  //    회전은 미고려이므로 prototype 기본 회전 (= direction 0) 의 positions 만 사용.
  throw new Error('portInference.enumerateContainerPorts: not implemented');
}
