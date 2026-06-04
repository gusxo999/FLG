/**
 * AUTO_LAYOUT_COORD_DUMP — AI 가 사용자의 런타임 상황을 이해할 수 있도록
 * 자동 배치 내부 좌표·배치 데이터를 콘솔에 JSON dump 한다.
 *
 * 다른 세션에서 언급할 때: "AUTO_LAYOUT_COORD_DUMP 플래그"
 *
 * UI 패널 상단의 "COORD DUMP" 버튼으로 런타임 on/off 가능.
 * setAutoLayoutCoordDump(true) 로 직접 켤 수도 있음.
 *
 * true 일 때 dump 출력 시점:
 *  - handleApplyCandidate          : 컨테이너·라우팅·정규화 좌표
 *  - wrapExternalsAroundPerimeter  : perimeter ring 배치 과정
 *  - dragExternalContainer         : 외부상자 드래그 시도·결과·드래그 후 그리드 상태
 *  - dragAssemblerGroup            : 조립기계 그룹 드래그 시도·결과·새 perimeter ring + 그리드 상태
 *  - moveAssemblerGroup            : Area 모델 경로로 갈 수 없어 grid fallback 으로 빠진 경우 한 줄
 */
export let AUTO_LAYOUT_COORD_DUMP = true;

export function setAutoLayoutCoordDump(v: boolean): void {
  AUTO_LAYOUT_COORD_DUMP = v;
}

/**
 * AUTO_LAYOUT_ALGORITHM — 자동 배치에 사용할 배치 전략(strategy) 선택.
 *
 * 다른 세션에서 언급할 때: "AUTO_LAYOUT_ALGORITHM 플래그"
 *
 *  - `'exhaustive'` (S-EXH) : 기존 알고리즘. 하향식 그리디 + perm(n!)×dir(2) 완전 탐색.
 *                             여러 후보를 squarenessPenalty 로 정렬해 반환.
 *  - `'layered'`    (S-LAYER): 계층화 DAG 레이아웃 + 채널 라우팅(Sugiyama).
 *                             레시피 깊이를 열(레이어)로, 레이어 사이에 빈 채널을
 *                             두어 라우팅을 구조적으로 보장. 결정적 단일 후보 반환.
 *                             설계: docs/auto-layout-wizard.s-layer-channel-reservation.md
 *
 * 디버그 탭의 "ALGORITHM" 토글로 런타임 전환. 토글 후 자동 배치를 다시 실행해야 반영됨.
 */
export type AutoLayoutAlgorithm = 'exhaustive' | 'layered';

export let AUTO_LAYOUT_ALGORITHM: AutoLayoutAlgorithm = 'exhaustive';

export function setAutoLayoutAlgorithm(v: AutoLayoutAlgorithm): void {
  AUTO_LAYOUT_ALGORITHM = v;
}
