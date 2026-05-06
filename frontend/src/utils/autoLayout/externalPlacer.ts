/**
 * 모듈 B — 외부 컨테이너 배치 (외부 영역).
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §3 / Q23 / Q24.
 *
 * 외부 입력/출력에 필요한 무한상자 (`infinity-chest`) 와 무한파이프
 * (`infinity-pipe`) 를 외부 좌표계 (0, 0) 부터 1×1 단위로 *줄지어* 배치.
 * 첫 컨테이너는 (0, 0), 두 번째는 (1, 0), 세 번째는 (2, 0) ... 가로 방향 default.
 *
 * 통합 직전 (= 모든 머신 배치 + 내부 라우팅 끝난 후) 사용자가 드래그로
 * 위치를 자유롭게 조정할 수 있다 — 그 결과로 본 함수의 좌표가 덮어써진다
 * (placement-search §8.3, Q24 b).
 */

import type {
  Area,
  Container,
  PlaceExternalContainer,
} from './containerModel';

/**
 * 외부 컨테이너 1개를 외부 영역의 다음 빈 셀에 배치.
 *
 * spec.content 는 무한상자/무한파이프가 흘릴 *내용물* (item 이름 또는 fluid 이름).
 * 라우팅 시점에 port 의 PortKind 와 일치 여부를 검사하는 데 쓰인다.
 */
export const placeExternalContainer: PlaceExternalContainer = (
  _spec: { kind: 'infinity-chest' | 'infinity-pipe'; entityName: string; content: string },
  _external: Area,
): Container => {
  // TODO(placement-search §3 외부 영역 / Q23 a):
  //  1. _external.containers 의 길이 n 으로부터 다음 좌표 = (n, 0).
  //  2. Container 객체 생성 (kind = _spec.kind, entityName = _spec.entityName,
  //     origin = (n, 0), size = { w: 1, h: 1 }).
  //  3. _external.containers 에 push, _external.placed 에 1×1 셀 emit.
  //  4. _external.bbox 갱신 (= max bounding rectangle).
  //  5. _spec.content 는 컨테이너 자체에 인코딩하지 않고, 이후 라우팅에서
  //     port.kind 를 통해 흘림 — 단, 최종 블루프린트의 infinity_settings 에
  //     content 가 들어가야 하므로 `Container` 가 아닌 별도 메타 (예: 외부 영역
  //     별도 map) 로 보존. 1차 구현은 `recipeName` 필드를 재활용하거나
  //     별도 contentByContainerId 맵을 만들지 결정.
  throw new Error('externalPlacer.placeExternalContainer: not implemented');
};
