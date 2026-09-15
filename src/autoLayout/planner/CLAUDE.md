# planner/ — 배치 계획

**여기 있는 것은 아무것도 놓지 않는다.** `PlacedCell` 을 만들면 `execution/` 이다.

## `planner` 는 "모듈 사이"가 아니다

옛 `docs/code-folders.md` 가 그렇게 정의했으나 **사실이 아니다**(2026-08-02 정정).
`planner` 는 **상위 조율 주체**이고, `module`·`link`·`channel`·`perimeter` 가 그 안의
관심사다. **모듈 *사이*만 조율하는 역할은 `link/` 가 맡는다.**

이유는 예약 철학이다 — *"큰 그림을 보는 주체 **하나**가 자리를 먼저 잡고, 뒤 단계는
탐색 없이 놓기만 한다."* 주체가 둘로 갈리면 *"무관한 판정이 이미 끝난 예약을 삼키는"*
버그가 난다(2026-07-21 실측).

## 하위 폴더 = 관심사

| 폴더 | 판정 | 내용 | 문서 |
|---|---|---|---|
| `module/` | **형제 모듈을 모른다** | `planModulePorts`(단일 진입점) · 정책 `linkPlanner` · 장부 `ledger`(+ 표의 모양 `faceTable`) · 셈 `arith`·`depthBudget`·`allocateArms` — 옛 이름과 규칙 2 이름이 나란하다(계획 3 이 접는다) | `docs/auto-layout/module/` |
| `link/` | 두 모듈의 **식별자**를 안다 | 타입 `types`(DeliveryConfig · DeliveryResult) · `allocateFlows` · `edgeLinks` · 정책 `policy`(edgeLinksOf) · 셈 `arith`(pairDeliveries) | `docs/auto-layout/link/` |
| `tree/` | **모듈 트리 전체**를 안다 — 조율자(`modulePacking`)가 받고 내는 것 | `types`(NodeSpec · PackConfig · PackResult) · 셈 `arith`(treeIndexOf · moduleInputOf) · 도형 `shape`(stackColumns · placeColumns) | `docs/auto-layout/common/layout-models.md` |
| `channel/` | **여러 연결이 나눠 쓰는 자원**을 안다 | 타입 `types`(DeliveryInput · ExportInput · ChannelGeometryPlan) · 장부 `ledger`(rowChannelsOf · planChannels) · 도형 `shape`(materializeChannelGeometry · 추상 셀 모델) · 정책 `policy`(settleExitSides · surfaceItemsOf) — 평면의 `channel*Planner` 는 계획 3 이 옮긴다(`channelGeometryPlanner` 는 트랙 장부 + 뼈대로 남았다 — `ledger.planChannels` 가 그 함수를 불러 거기로 옮기면 런타임 순환) | `docs/auto-layout/channel/` |
| `perimeter/` | **전역 외곽**을 안다 | 타입 `types`(ExitPortInput · ExitContext · PerimeterExitPlan) · `wayOuts` · `exits` · 직진 장부 `directRay` | `docs/auto-layout/perimeter/` |
| `run/` | **한 번의 실행 전체**(입력 → 후보) | `gamedata`(어댑터) · `policy`(LayoutIssue 를 짓는 곳) · `ledger`(유체 관망·종착 구간) · `emit`(CandidateLeaf) — 뼈대는 `moduleWizard` | `docs/auto-layout/common/work-kinds.md` |
| (평면) | 조율·통로·탐색 | `moduleWizard`(진입점) · `modulePacking` · `channel*` · `perimeter*Planner` · `deliveryRoute` · `containerRouting` | `docs/auto-layout/channel/` |

**문서 폴더가 코드 폴더의 거울이다** — 위 표의 오른쪽 폴더를 열면 그 관심사의 설계 문서가 다 있다.

## 새 파일을 여기 둘지 판정

1. `PlacedCell` 을 만드나? → 만들면 `execution/`
2. 형제 모듈을 아나? → 모르면 `module/`, 알면 `link/`
3. 여러 연결이 공유하는 자원인가? → `channel`
4. 전역 외곽을 아나? → `perimeter/`

## 실패는 삼키지 않는다

자리가 없으면 **만들어 내지 말고** 정직하게 실패시킨다. 실패 사유의 카탈로그는
`layoutIssue.LayoutIssue` 이고(2026-08-04 `RejectReason` 을 흡수), 그 issue 를 **짓는 곳은 `run/policy.ts` 하나**다.
`moduleWizard` 뼈대는 받은 것을 정해진 자리에 쌓고 관문만 세운다 — 경고가 오류 관문 앞에 쌓이면 배치가 통째로 물러난다.

## `link/` 는 아무것도 import 하지 않는다

`allocateFlows` 는 *"어느 기계 쌍을 몇 벨트로 잇나"* 만 답하는 순수 산술이다.
벨트 한 줄의 자료 구조(`Link`)는 로컬 머신 index + 팔 수만 알아
**`module/link.ts`** 에 있다 — 한 파일에 있던 시절엔 `module/ ⇄ planner/link/`
왕복 간선이 생겼다(2026-08-02 해소). 이 파일이 순수하게 남아 있는 한 그 간선은 안 돌아온다.
