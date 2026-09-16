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
 * AUTO_LAYOUT_LINK_LADDER — **구간막힘 해소**(못을 피해 링크를 토막내기) 스위치.
 * (`docs/auto-layout/link/machine-link.md` — *자리가 없으면 링크를 토막낸다*)
 *
 * `true` 면 **배정이 못을 만난 그 자리에서** 쪼갠다([seatLinkEdge]) — 쪼개면 실제로
 * 앉는 줄만([resolveSpanBlock]). `false`(현재 기본) 면 그대로 정직하게 실패시킨다.
 *
 * **2026-08-30 기본을 다시 꺼 둔다.** 이 칸이 푸는 문제(구간막힘)의 **전제가
 * "관통이 깊다" 인데, 그 전제를 깊이 순서 규칙이 깨다** — 긴 흐름을 얙은 깊이에
 * 두면 그 포트가 기둥 끝으로 나가 못을 찍을 자리가 없어진다. 그러므로 **쓸모를
 * 먼저 재점검한다** — 꺼 둔 채로 순서 규칙을 넣고, 그래도 못 앜는 줄이 남는지를 본다.
 *
 * **2026-08-29 에 자리가 바뀌었다.** 예전엔 1차 생성 **뒤**에 `linkCache` 를 밖에서 고치고
 * 트리를 **통째로 다시 만들었다**(되먹임 B). 이제 배정 안에서 토막을 이어 앉히므로
 * 재생성이 없다.
 *
 * 사다리는 아직 이 한 칸뿐이므로 **어디까지 되는지**를 알고 써야 한다 — 경계는
 * [rungOfLine] 이 실패마다 이름표로 붙이고, 그 이름표가 `unrouted-lines` 이슈 문장에 나온다.
 * 쪼갠 횟수는 `flg.report()` 의 `면깊이 · 쪼갬 N` 으로 본다(**0이 목표다**).
 */
export let AUTO_LAYOUT_LINK_LADDER = false;

export function setAutoLayoutLinkLadder(v: boolean): void {
  AUTO_LAYOUT_LINK_LADDER = v;
}

/**
 * AUTO_LAYOUT_LANE_MERGE — **레인 합류** 스위치
 * (`docs/factorio/belt-lane-semantics.md` · `tempPlanDocs/벨트-레인/`).
 *
 * 인서터는 먼 레인 하나에만 떨구므로 **줄 하나는 벨트의 절반만 쓴다.** 그래서 45/s 수요는
 * 줄 둘이 된다. `true` 면 그 둘을 **한 물리 벨트의 좌/우 레인**에 하나씩 실어 벨트를
 * 하나로 되돌린다 — **처리량은 안 늘고 물리 벨트 수가 준다**(벨트 칸·채널 트랙·면 깊이·포트).
 *
 * **`false` 면 짝짓기 자체가 안 돈다** — `sharedLineId` 가 아무 줄에도 안 붙어 아래 모든
 * 갈래가 도달 불가가 된다. 즉 끄면 **합류 이전 동작 그대로**다(대조군을 그렇게 잰다).
 *
 * ## 기본을 켰다 (2026-09-04)
 *
 * 성립 조건 셋이 다 섰다 — 부모 면이 **한 벨트**를 쓰고(싣는 쪽 둘 · 집는 쪽 하나, 그
 * 비대칭이 핵심이다), 그 벨트의 **포트가 하나**이고(논리 포트 둘이 한 셀), 자식 출구의
 * **기둥 밖 한 행**에서 두 줄이 마주 보아 합류한다. 셋 중 하나라도 없으면 배치가 조용히
 * 틀린다 — 벨트는 이어져 있고 총량도 맞는데 **한쪽만 안 흐른다.**
 *
 * 실측(`electronic-circuit` 10/s · transport-belt · 모듈 4):
 *
 * ```
 *            셀    납품                    이슈   flg.check
 *   끄면     522   planned 7 / dijkstra 0   0     통과
 *   켜면     520   planned 5 / dijkstra 0   0     통과      ← 모든 잣대에서 낫거나 같다
 *   레인공유  후보 3 · 짝 3 · 되돌림 1(도형) · **합쳐짐 2**
 * ```
 *
 * **`합쳐짐` 만이 아낀 물리 벨트다** — `짝` 은 자격을 통과한 수라 배정·방출에서 되돌아간다.
 * 남은 `되돌림 1` 은 따르는 줄이 이끄는 줄의 깊이를 못 얻은 것이고, **자리가 진짜로
 * 없는 것**이라 정직한 포기다(합류 없이 줄 둘로 간다).
 */
export let AUTO_LAYOUT_LANE_MERGE = true;

export function setAutoLayoutLaneMerge(v: boolean): void {
  AUTO_LAYOUT_LANE_MERGE = v;
}

/**
 * AUTO_LAYOUT_LINK_OPPOSITE_FACE — **링크 넘침이 반대 옆면을 본다**
 * (`tempPlanDocs/부분-링크/` §3 · `judgements.md` J14).
 *
 * 오늘 링크의 넘침 경로 `spillPair` 는 `OUT=["W","S","N"]` · `IN=["E","S","N"]` 이라
 * **반대 옆면이 없다.** 그래서 선호 면의 깊이가 차면 곧장 gap 으로 가고, gap 은 `g=1` 만
 * 받으므로(`machinesOn !== 1`) 관통 줄은 **갈 곳이 없어 통째로 실패한다.**
 *
 * `true` 면 반대 면을 **gap 앞에** 넣는다 — 자매 경로가 자기 줄에 이미 쓰는 그 순서다
 * (`planner/module/policy.seatRestLines`: `["E","W","S","N"]` · `["W","E","S","N"]`).
 *
 * ## 왜 이것이 먼저인가 — **관통을 지키기 때문**
 *
 * 줄을 관통인 채로 옮기므로 토막 수 `c` 가 안 늘고, `c` 가 곧 포트 수다. 대안(`g=1` 로
 * 내리기)은 `c = N` 이라 포트를 양끝 모두 머신 수만큼 낸다([linkDepthNeed] 의 눈금 순서).
 *
 * ## 무엇이 대가인가 — **납품 경로가 모듈을 빙 돈다**
 *
 * 자매 경로의 주석이 그 대가를 적어 뒀다: *"자식-공급 입력이 W 로 밀려나면 그 줄의 납품
 * 경로가 모듈을 빙 돌아야 하고, 실제로 길이 막힌다"*(2026-08-05 실측 — 납품 1건 실패).
 * 그쪽은 **금지가 아니라 순서로** 완화했다(*"금지하면 gap 이 아무 때나 벌어진다"*).
 *
 * **그래서 기본 꺼짐이다** — 그 대가가 실물에서 얼마나 무는지를 A/B 로 재는 중이다.
 * 재는 법: `flg.flags.linkOppositeFace(true)` 후 `flg.report()` 의 **납품** 줄
 * (`계획대로` · `탐색폴백` · `실패`)과 **링크눈금** 줄을 끈 쪽과 대조한다.
 */
export let AUTO_LAYOUT_LINK_OPPOSITE_FACE = false;

export function setAutoLayoutLinkOppositeFace(v: boolean): void {
  AUTO_LAYOUT_LINK_OPPOSITE_FACE = v;
}

/**
 * AUTO_LAYOUT_LINK_DIRECT — **넘치는 부모의 링크 입력을 `g = 1` 로 내린다**
 * (`tempPlanDocs/부분-링크/` — 눈금 `"direct"`).
 *
 * 밸브는 진작 뚫려 있었다(`edgeLinkGroups(…, bundle?: EdgeBundle)`) — **주는 사람이
 * 없었을 뿐이다.** `true` 면 [linkDepthNeed] 가 `"free"` 가 아니라고 판정한 부모로 가는
 * 간선에 `{ side: "to", g: 1 }` 을 준다. 그러면 그 줄은 **부모 머신마다 한 토막**이 되고,
 * `g=1` 줄들은 면당 공용 깊이 하나를 함께 쓰므로 깊이가 몇이든 담긴다.
 *
 * ## 대가 — 포트가 `c` 배다
 *
 * 토막 수 `c = ⌈N ÷ g⌉` 가 곧 포트 수이고, **양끝 모두**다. `g=1` 은 `c = N` 이라
 * 자식에도 부모에도 머신 수만큼 포트가 난다. 그래서 [AUTO_LAYOUT_LINK_OPPOSITE_FACE] 가
 * **먼저**다 — 그쪽은 줄을 관통인 채로 옮겨 `c` 를 안 늘린다.
 *
 * ## 왜 있나 — **두 성공끼리 비교하려고**
 *
 * 반대 면만 켠 배치는 *"OFF 에서는 아예 안 서는 트리"* 라 대조군이 없다. 같은 트리를
 * 다이렉트로도 세우면 **성공 ↔ 성공**을 잴 수 있고, 그제야 납품 폴백률·포트 수가
 * 어느 쪽 탓인지 갈린다(`judgements.md` J14 의 미확정 둘).
 *
 * 재는 법: `flg.flags.linkDirect(true)` 후 `flg.report()` 의 **형태**(포트·이용률) ·
 * **납품** · **링크눈금** 줄을 반대 면 쪽과 대조한다.
 *
 * ## 첫 실측은 이쪽에 불리했다 (2026-09-04 · `advanced-circuit`)
 *
 * ```
 * 반대면만    ✅ errors 0            면깊이 배정  96 · fan-out 6  · 벨트 600/s
 * 다이렉트만  ❌ errors 1            면깊이 배정 137 · fan-out 10 · 벨트 645/s
 *                                  n2-kr-electronic-components: [input:kr-silicon]
 * ```
 *
 * **실패가 사라진 게 아니라 링크 입력에서 원료 입력으로 옮겨 갔다** — 포트를 낸 대가로
 * 면 자리를 먹어 *나머지 줄*이 못 앉는다. 그래서 이건 **최후 수단**이지 기본값 후보가
 * 아니다(`tempPlanDocs/부분-링크/judgements.md` J14).
 *
 * **그리고 이 플래그는 사다리가 아니다** — 넘치는 부모에 다이렉트를 **무조건** 적용한다.
 * *"반대 면으로 먼저 해 보고 그래도 안 되면"* 은 아직 아무도 안 만들었다.
 */
export let AUTO_LAYOUT_LINK_DIRECT = false;

export function setAutoLayoutLinkDirect(v: boolean): void {
  AUTO_LAYOUT_LINK_DIRECT = v;
}
