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
 *  - runModuleWizard              : `[팔·벨트 상한]` — 줄마다 벨트 줄 수·실린 양·팔 개수·면 좌석을 나란히.
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
 * **`false`(현재 기본) 면 짝짓기 자체가 안 돈다** — `sharedLineId` 가 아무 줄에도 안 붙어 아래 모든
 * 갈래가 도달 불가가 된다. 즉 끄면 **합류 이전 동작 그대로**다(대조군을 그렇게 잰다).
 *
 * ## 기본을 다시 껐다 (2026-10-06 사용자 — *"기본값을 비활성화로 바꿔주세요"*)
 *
 * 켜는 법은 `flg.flags.laneMerge(true)` · 디버그 탭의 `레인 합류` 버튼이다. 켠 채로 두면 걸리는 자리가 둘 남아 있다:
 *
 * ```
 * 합쳐진 줄의 받는 쪽   받는 모듈에서 그 줄의 벨트가 인서터 행을 다 잇지 못한다 — 집을 칸이 빈 인서터가 남는다
 *                      (2026-10-06 `tree/build.laneMerge.test` 의 판: 꺼짐 0 · 켜짐 2). 배치는 성공으로 나온다 —
 *                      찾는 자리는 `flg.report()` 가동률 줄의 `끊김` · `flg.flow.breaks()` 다
 * 짝의 끝              짝은 같은 끝으로 나가야 한 행에서 만난다(`link/policy/seat`). 두 줄을 쓰는 머신을 그 줄들
 *                      모두에서 맨 끝에 세우려면(용어사전 §split belt 할당량 문제 — 구현 전) 두 줄이 서로 다른
 *                      끝으로 흘러야 한다 — 둘이 부딪힌다
 * ```
 *
 * ## 2026-09-04 에 기본을 켰던 근거 — 켰을 때 무엇이 서는가
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
export let AUTO_LAYOUT_LANE_MERGE = false;

export function setAutoLayoutLaneMerge(v: boolean): void {
  AUTO_LAYOUT_LANE_MERGE = v;
}

/**
 * AUTO_LAYOUT_LINK_OPPOSITE_FACE — **링크 넘침이 반대 옆면을 본다**
 * (`tempPlanDocs/재료-둘-이상-부모/judgements.md` J14).
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
 * (`linkDepthNeed` 의 눈금 `"direct"`).
 *
 * 밸브는 진작 뚫려 있었다(`edgeLinkGroups(…, perBeltLine?: EdgeMachinesPerBeltLine)`) — **주는 사람이
 * 없었을 뿐이다.** `true` 면 [linkDepthNeed] 가 `"free"` 가 아니라고 판정한 부모로 가는
 * 간선에 `{ side: "to", machinesPerBeltLine: 1 }` 을 준다. 그러면 그 줄은 **부모 머신마다 한 토막**이 되고,
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
 * 아니다(`tempPlanDocs/재료-둘-이상-부모/judgements.md` J14).
 *
 * **그리고 이 플래그는 사다리가 아니다** — 넘치는 부모에 다이렉트를 **무조건** 적용한다.
 * *"반대 면으로 먼저 해 보고 그래도 안 되면"* 은 아직 아무도 안 만들었다.
 */
export let AUTO_LAYOUT_LINK_DIRECT = false;

export function setAutoLayoutLinkDirect(v: boolean): void {
  AUTO_LAYOUT_LINK_DIRECT = v;
}

/**
 * AUTO_LAYOUT_SEAT_PICK — **인서터 행 고르기** 스위치(`module/policy/link.seatRowsOf`).
 *
 * `true`(기본) 면 옆면에서 규칙 둘이 선다(스도쿠 원리 — 뒤에 올 줄의 자리를 가장 적게 뺏는 행).
 * `false` 면 옛 규칙이다 — 옆면(W/E)은 빈 좌석을 **앞에서부터** k 개.
 *
 * ```
 * 자리-1  포트 쪽 끝부터 붙여 앉는다    흐름 끝이 S 면 아래부터. 기둥 끝 포트가 기둥 **밖**으로 나가
 *                                      표의 칸을 안 먹는다. gap 면은 이미 이 규칙이다
 * 자리-2  쓸 수 없는 행은 고르기 전에 거른다
 *                                      그 행의 내 깊이 칸에 남의 칸이 있으면 · 끝 머신에서 그 행에 설
 *                                      포트 칸이 막혔으면 건너뛴다. 같은 깊이의 다른 행이 다음 깊이보다
 *                                      먼저다 — 다음 깊이는 대개 팔이 길어 좌석을 더 먹는다
 * ```
 *
 * 이미 앉은 줄의 인서터는 옮기지 않는다(자리-3) — 옮기면 그것을 보고 비켜 간 줄의 판단이 틀어진다.
 *
 * **기본을 켰다**(2026-09-24 사용자 — *"셋다 켜주세요"*, 지하 횡단 · 순서 규칙과 함께). 대조(합성 32 픽스처)에서 이슈가 는
 * 픽스처는 없었고 성공한 배치의 질도 그대로였다. **다만 `AUTO_LAYOUT_LINK_DIRECT` 실험 판에서는 되던 배치 둘이 깨진다** —
 * 한 머신짜리 줄이 포트 쪽 끝(흐름 S 면 아래 행)에 앉아 여러 머신을 잇는 줄의 **머신 사이 통로**를 막는다
 * (`tempPlanDocs/재료-둘-이상-부모/judgements.md` J-통로).
 *
 * **끄면 옛 동작 그대로다** — 기전: 꺼짐이면 `seatRowsOf` 가 옛 규칙(앞에서 k 개)을 낸다. 끄는 법은 `flg.flags.seatPick(false)`.
 */
export let AUTO_LAYOUT_SEAT_PICK = true;

export function setAutoLayoutSeatPick(v: boolean): void {
  AUTO_LAYOUT_SEAT_PICK = v;
}

/**
 * AUTO_LAYOUT_LINK_DIVE — **지하 횡단** 스위치(`module/policy/link.diveRelief`).
 *
 * `true` 면 옆면(W/E)의 줄이 막힌 칸을 **땅속으로 비켜 간다** — 자르지도 다른 면으로 넘기지도 않고:
 *
 * ```
 * 도착한 줄의 벨트가 남의 포트(못) 위를 지나야 한다   → 도착한 줄이 그 행을 지하 횡단한다
 * 도착한 줄의 포트가 먼저 깔린 벨트 위에 서야 한다     → 먼저 앉은 줄이 그 행을 땅속으로 내준다
 * ```
 *
 * 서는 조건(T1~T4): 지하벨트를 골랐고 그 줄의 운반량을 감당한다 · 몸통이 인서터 행이 아니다 · 입출구가 그 줄의
 * 구간 안쪽이고 물리 거리가 사거리 안이다 · 종착 입구가 같은 열 앞쪽에서 짝이 되지 않는다(종착이 종류를 바꾼다).
 * 합류 쌍은 지하 횡단하지 않는다. 규칙은 `docs/auto-layout/module/trunk-blocked.md` §1 · §4.
 *
 * **기본을 켰다**(2026-09-24 사용자 — *"셋다 켜주세요"*).
 * **끄거나 지하벨트를 안 고르면 옛 동작 그대로다** — 기전: 지하 종류가 없으면 제안에 터널도 먼저 앉은 줄의 지하 횡단도 안 생긴다.
 * 끄는 법은 `flg.flags.linkDive(false)`.
 */
export let AUTO_LAYOUT_LINK_DIVE = true;

export function setAutoLayoutLinkDive(v: boolean): void {
  AUTO_LAYOUT_LINK_DIVE = v;
}

/**
 * AUTO_LAYOUT_LINK_ORDER — **링크 줄의 앉는 순서** 스위치(`link/policy/seat.byConstraint` · `tree/build.seatTree`).
 *
 * `true`(기본) 면 **트리의 모든 간선**에서 단위(줄 하나 · 합류 쌍)를 모아 한 줄로 세운다.
 * `false` 면 옛 순서다 — 간선마다(트리 DFS 전위) 그 간선의 줄을 합류 쌍 → 도착 순으로 앉힌다:
 *
 * ```
 * ① 부모 쪽 방문 수     큰 것 먼저 — 그 줄이 부모 기둥에서 지나는 머신 수(자유도가 낮다)
 * ② 같으면 합류 쌍 먼저  기둥 끝 + 비켜 가는 열이라야 도형이 선다
 * ③ 같으면 오늘 순서    간선 DFS 전위 · 간선 안 순서
 * ```
 *
 * 범위가 요점이다 — 한 부모 벽에 오는 **서로 다른 간선**의 줄이 함께 줄을 선다. 간선 안에서만 세우면 먼저 온 간선의
 * 짧은 줄이 뒤 간선의 관통 줄 깊이에 못을 박는 일이 그대로 남는다. 앉히는 순서와 적는 순서는 다르다 — 결과는
 * 간선 순서로 적는다(방출이 index 로 짝을 찾는다).
 *
 * **기본을 켰다**(2026-09-24 사용자 — *"셋다 켜주세요"*).
 * **끄면 옛 동작 그대로다** — 기전: 꺼짐이면 옛 간선 루프(`seatLinkEdge`)를 부른다. 비교 함수를 0 으로 두는 것으로는
 * 안 된다 — 합류 쌍 열쇠가 간선을 넘어 다른 간선의 줄보다 앞당겨지기 때문이다. 끄는 법은 `flg.flags.linkOrder(false)`.
 */
export let AUTO_LAYOUT_LINK_ORDER = true;

export function setAutoLayoutLinkOrder(v: boolean): void {
  AUTO_LAYOUT_LINK_ORDER = v;
}
