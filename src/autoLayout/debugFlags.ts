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
 *  - handleApplyCandidate          : 컨테이너·라우팅(레이아웃 좌표) + `unifyLeaf` 후 그리드 좌표
 *  - runModuleWizard              : `[팔·벨트 상한]` — 줄마다 팔 개수·그릇·면 좌석을 나란히.
 *                                   벨트가 포화된 배치를 봤을 때 **어느 상한이 물렸는지** 가른다.
 */
export let AUTO_LAYOUT_COORD_DUMP = true;

export function setAutoLayoutCoordDump(v: boolean): void {
  AUTO_LAYOUT_COORD_DUMP = v;
}

// AUTO_LAYOUT_MODULE_PIPELINE — 삭제됨(2026-07-25, Phase 5). 모듈 경로가 유일한 경로가
// 되어 스위치의 반대편(옛 S-LAYER)이 없어졌다. setter 는 아무도 부르지 않아 사실상 죽은
// 상수 `true` 였고, 끄면 runLayeredWizard 가 아무것도 반환하지 않는 상태였다.

/**
 * AUTO_LAYOUT_PERIMETER_PASS — 모듈 경로 후처리(modulePerimeterPass) 스위치.
 * true(기본)면 합성 후 살아남은 외부상자를 전역 perimeter 로 트렁크 spine 연장 재배치.
 * false 면 그 단계를 건너뛴다(상자가 로컬 모듈 ring 에 남음). 진단/회귀 격리용.
 */
export let AUTO_LAYOUT_PERIMETER_PASS = true;

export function setAutoLayoutPerimeterPass(v: boolean): void {
  AUTO_LAYOUT_PERIMETER_PASS = v;
}

/**
 * AUTO_LAYOUT_CHANNEL_GEOMETRY — 채널 기하 예약(통합 장부) 스위치.
 * (docs/auto-layout-wizard.channel-geometry-reservation.md)
 *
 * true(기본)면 packModuleTree 가 납품(납품 경로)·반출(lane) 경로의 트랙을 패킹 시점에 배정하고
 * (같은 쪽 판정 + 해소 사다리), 채널 폭을 그 결과에서 유도한다(폭 역전). deliveryRoute 은
 * 배정 좌표를 탐색 없이 방출하고 dijkstra 는 최후 폴백(예약 침범 금지)으로만 남는다.
 * false 면 옛 동작 — 폭만 예약 + dijkstra/스캔. 진단/회귀 격리용.
 */
export let AUTO_LAYOUT_CHANNEL_GEOMETRY = true;

export function setAutoLayoutChannelGeometry(v: boolean): void {
  AUTO_LAYOUT_CHANNEL_GEOMETRY = v;
}

/**
 * AUTO_LAYOUT_LINK_LADDER — **사다리 1단**(못을 피해 링크를 토막내기) 스위치.
 * (`docs/auto-layout/link/machine-link.md` — *자리가 없으면 링크를 토막낸다*)
 *
 * `true`(기본, 2026-08-29)면 `packModuleTree` 가 1차 생성의 **막힌 행**을 읽어, 쪼개면
 * 실제로 앉는 줄만([resolveSpanBlock]) 토막내고 다시 만든다. `false` 면 못 앉은 줄을
 * **그대로 정직하게 실패**시킨다(사다리 이전 동작) — 회귀를 가를 때 쓴다.
 *
 * **기본이 켜짐인 이유:** 이 칸이 겨냥한 문제(*막힌 칸 사이에 빈 자리가 있다*)는 실측으로
 * 풀렸고(`electronic-circuit` 이슈 2→0), 안 풀리는 것들은 켜기 전과 **똑같이** 실패한다.
 * 사다리는 아직 1단뿐이므로 **어디까지 되는지**를 알고 써야 한다 — 경계는
 * [rungOfLine] 이 실패마다 이름표로 붙이고, 그 이름표가 `unrouted-lines` 이슈 문장에 나온다.
 */
export let AUTO_LAYOUT_LINK_LADDER = true;

export function setAutoLayoutLinkLadder(v: boolean): void {
  AUTO_LAYOUT_LINK_LADDER = v;
}
