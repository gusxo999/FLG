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
 * AUTO_LAYOUT_MODULE_PIPELINE — 조각 5 하이브리드 배선 스위치.
 *
 * true 면 `runLayeredWizard` 가 **트리 전체가 simple-item(유체 0·미탭 0·홉 성공)** 일 때
 * generateModule+packModuleTree+routeModuleHops 자족 모듈 경로를 타고, 아니면 옛 경로로
 * 폴백한다. false(기본)면 항상 옛 경로 — 회귀 0.
 *
 * 목적: 자식 클러스터를 부모-무시 모듈로 생성해 "자식 == 루트" 를 라이브에서 실현.
 * planner(clusterPortPlanner) 배선으로 포트가 W/E 두 면에 결정적 배정되어 1:1 붕괴를
 * 일으키던 옛 경로(clusterTrunkMerge·externalMergePass)를 대체한다. fluid·미탭·홉 실패
 * 트리는 여전히 자동 폴백(회귀 0). setAutoLayoutModulePipeline(false) 로 끌 수 있다.
 */
export let AUTO_LAYOUT_MODULE_PIPELINE = true;

export function setAutoLayoutModulePipeline(v: boolean): void {
  AUTO_LAYOUT_MODULE_PIPELINE = v;
}
