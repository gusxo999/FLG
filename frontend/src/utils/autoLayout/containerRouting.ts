/**
 * 모듈 4 — 라우팅.
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §4 / §7.4 / Q3 / Q4 / Q18.
 *
 * 두 port (producer.port, consumer.port) 사이의 운반체 체인을 BFS 로 깐다.
 * port.kind 에 따라 형식이 갈린다:
 *  - item  : 컨테이너—투입기—벨트(가변길이 ≥ 1)—투입기—컨테이너
 *  - fluid : 컨테이너—파이프 + 지하파이프—컨테이너 (투입기 없음)
 *
 * 본 모듈은 *컨테이너 모델 v2 의 라우팅* 이며, legacy `router.ts` (Lee BFS,
 * item-only) 와 별개의 파일이다 — 이름 충돌을 피하려고
 * `containerRouting.ts` 로 분리. legacy 는 새 위저드 통합 시점에 삭제.
 */

import type {
  Area,
  PortPair,
  RoutePorts,
  Routing,
  RoutingAttempt,
} from './containerModel';

/**
 * 한 port 페어에 대한 운반체 체인을 깐다. 실패 시 RoutingAttempt 의
 * ok=false 로 반환 — 오케스트레이터가 §7.4 fallback 으로 다른 port 페어 시도.
 */
export const routePorts: RoutePorts = (
  _pair: PortPair,
  _area: Area,
  _options: {
    beltEntityName: string;
    inserterEntityName: string;
    pipeEntityName: string;
    undergroundPipeEntityName?: string;
    preferUnderground: boolean;
  },
): RoutingAttempt => {
  // TODO(placement-search §4 / 모듈 4):
  //  1. _pair.producer.kind / _pair.consumer.kind 가 일치하는지 확인. 불일치 시
  //     ok:false reason:'no-port-pair'.
  //  2. _area.placed 로부터 occupancy map 빌드.
  //  3. kind 분기:
  //      - item kind:
  //          a. producer port 셀에 *바깥 방향* 으로 인서터 1개 emit.
  //          b. 그 인서터의 끝 셀부터 consumer port 끝의 인서터 시작 셀까지
  //             BFS (= 벨트 가변 길이 경로).
  //          c. 경로의 각 셀에 transport-belt emit. direction = 진행 방향.
  //          d. consumer 측 인서터 emit (consumer port 셀 바깥 방향).
  //      - fluid kind:
  //          a. producer port 셀에서 consumer port 셀까지 BFS (파이프 직결).
  //          b. preferUnderground = true 면 직선 구간을 underground 페어로
  //             치환해 사이 셀을 비움 (placement-search O2).
  //          c. 다른 fluid 의 pipe-route 와 셀 충돌 검사 (C3 mixing 방지).
  //  4. BFS 가 경로를 못 찾으면 ok:false reason:'no-path'.
  //  5. 성공 시 Routing 객체 (id, kind, from, to, placed cells, area) 반환.
  throw new Error('containerRouting.routePorts: not implemented');
};

/**
 * 한 area 의 placed cells 를 BFS occupancy map 으로 변환.
 *
 * 통과 정책 (placement-search §4 / §7.4):
 *  - machine / inserter / belt-fixed / pipe-fixed: 통과 불가.
 *  - belt-route: item routing 만 통과 가능.
 *  - pipe-route(같은 fluid): fluid routing 만 통과 가능 (다른 fluid 는 차단).
 */
export function buildOccupancy(_area: Area): unknown {
  // TODO(placement-search §4-C 의 occupancy 분류 — legacy router.ts 의 4종 분류를
  //  pipe-fixed / pipe-route 까지 6종으로 확장):
  //  - machine, inserter, belt-fixed, belt-route, pipe-fixed, pipe-route(fluid 이름 태깅).
  //  - 동일 좌표에 여러 종류가 겹치면 우선순위:
  //      machine > inserter > belt-fixed = pipe-fixed > belt-route = pipe-route.
  throw new Error('containerRouting.buildOccupancy: not implemented');
}

/**
 * 한 라우팅을 area 에 *적용* — 라우팅의 placed cells 를 area.placed 에 push,
 * area.bbox 갱신, area.containers 와의 cross-ref 무결성 검증.
 */
export function commitRouting(_routing: Routing, _area: Area): void {
  // TODO: routing.placed 의 각 cell 에 대해 area.placed 에 추가, bbox 갱신.
  throw new Error('containerRouting.commitRouting: not implemented');
}
