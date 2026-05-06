/**
 * 모듈 A — 머신 배치 (내부 영역).
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §5 / §7.2 / Q6.
 *
 * 부모 머신과 자식 머신의 상대 위치 (오른쪽 / 아래쪽) 를 받아 자식의 origin
 * 좌표를 결정한다. 부모와 *벨트 길이 ≥ 1* 만 확보하도록 인접 배치 —
 * 즉 자식과 부모 footprint 사이의 거리는 라우팅 형식의 최소 거리에 맞춘다.
 *
 * 하향식: 최상위 머신은 (5, 5) 에 배치하고 (placement-search §3 내부 영역
 * 좌표 기준점), 그 아래 자식·손자가 본 함수의 재귀 호출로 따라온다.
 */

import type { Area, Container, PlaceMachine } from './containerModel';

/**
 * 자식 머신을 부모 옆에 배치 (오른쪽 또는 아래쪽). 충돌이 발생하면 해당
 * 후보는 실패 — 오케스트레이터가 다음 perm·dir 후보로 진행한다.
 */
export const placeMachine: PlaceMachine = (
  _parent: Container,
  _child: Container,
  _dir: 'right' | 'down',
  _internal: Area,
): Container => {
  // TODO(placement-search §5 모듈 A):
  //  1. _parent.origin 과 _parent.size 로부터 _child 가 붙을 면 좌표 계산.
  //  2. _dir = 'right' → _child.origin.x = _parent.origin.x + _parent.size.w + GAP
  //                     _child.origin.y = _parent.origin.y
  //     _dir = 'down'  → _child.origin.x = _parent.origin.x
  //                     _child.origin.y = _parent.origin.y + _parent.size.h + GAP
  //     GAP = 라우팅 형식 (item: 컨테이너-투입기-벨트-투입기-컨테이너) 이
  //           들어가는 최소 거리 = 1(투입기) + 1(벨트) + 1(투입기) = 3 셀.
  //           fluid 일 경우 = 1(파이프) = 1 셀.
  //  3. 자식의 footprint 가 _internal.placed 의 셀들과 겹치면 throw — 오케스트레이터가
  //     이 실패를 catch 하여 후보를 'no-routing' / 'no-machine-match' 로 마킹.
  //  4. 충돌이 없으면 _child 를 _internal.containers 에 push 하고 _internal.placed 에
  //     머신 footprint 셀을 emit. 갱신된 _child (origin 채워진 것) 반환.
  throw new Error('machinePlacer.placeMachine: not implemented');
};

/**
 * 최상위 머신을 내부 영역 (5, 5) 에 배치하는 시작점.
 * 부모가 없는 경우 (= 트리 root) 본 함수를 사용.
 */
export function placeRootMachine(
  _machine: Container,
  _internal: Area,
): Container {
  // TODO(placement-search §3 내부 영역 / §7.2):
  //  1. _machine.origin = { x: 5, y: 5 } 로 고정.
  //  2. _internal.containers 에 push, _internal.placed 에 footprint 셀 emit.
  //  3. _machine 반환.
  throw new Error('machinePlacer.placeRootMachine: not implemented');
}
