---
tags: [auto-layout, placement, routing]
---

> **부모 문서:** [auto-layout-wizard.md](../wizard.md)
> **관련 문서:** [.placement-search](placement-search.md), [.channel-geometry-reservation](../channel/channel-geometry-reservation.md),
> [[work-kinds]] — **직교하는 축**: 파일이 *무슨 종류의 일*을 하나(셈·장부·도형·정책 …).
> 이 문서가 *"어느 폴더인가"* 에 답한다면 그쪽은 *"한 파일 안에서 어디를 자르나"* 에 답한다

# auto-layout 코드 폴더 — 두 축으로 나눈다

**한 줄 요약:** `src/autoLayout/` 의 폴더는 **두 가지 질문**에 답한다 —
**축 1 계층**(계획인가 실행인가)과 **축 2 관심사**(무엇에 대한 일인가).
`planner/` ↔ `execution/` 이 계층으로 대칭이고, 그 **안에서** 관심사 이름이 반복된다.

> **2026-08-02 정정.** 이 문서는 예전에 `planner/` 를 *"모듈 사이를 조율하는 코드"* 로
> 정의했다. **코드를 조사한 결과 사실이 아니었고**, 그 정의를 근거로 삼았다가 실제로 한 번
> 잘못된 판단을 했다. 아래 §"planner 는 상위 조율 주체다" 가 정정 내용이다.

## 축 1 — 계층: 무엇을 산출하는가

| 폴더 | 산출물 | 판정 (기계적) |
|---|---|---|
| **`planner/`** | 좌표·배정 | `PlacedCell` 을 **안 만든다** |
| **`execution/`** | `PlacedCell` | **만든다** |
| **`util/`** | 순수 셈·생성자 | 계층 무관. 양쪽이 쓴다 |
| 루트 | 타입·계약, 배치 이전 단계 | 좌표를 안 다룬다 |

**판정의 적용 대상은 *파이프라인 단계*다.** 아래 셋은 셀을 만들어도 `execution/` 이 아니다:

- **생성자 라이브러리**(`shared/cells/builder`) — 만들 뿐 배치하지 않는다
- **파사드 API** — 여러 단계를 엮는 것이 책임이다

이름에 속으면 안 되는 예:

| 파일 | 인상 | 실제 |
|---|---|---|
| `planner/perimeterRouter` | 경로를 깐다 | **좌표 배열만 반환** → 계획 |
| `link/emit` | 벨트를 놓는다 | 방출을 `shared/cells/path` 에 **위임** → 계획 |
| `tree/build` | 모듈을 배치한다 | **좌표만** → 계획 |

## 축 2 — 관심사: 무엇에 대한 일인가

| 관심사 | 범위 | 판정 |
|---|---|---|
| **module** | 한 모듈 안쪽 | **형제 모듈을 모른다** |
| **link** | 모듈과 모듈의 연결 | 두 모듈의 **식별자**를 안다 |
| **channel** | 모듈 사이 통로 | 여러 연결이 **공유하는 자원**을 다룬다 |
| **perimeter** | 배치 전체의 바깥 테두리 | **전역 외곽**을 안다 |

## 축이 늘어도 **경로는 안 는다** — 판정 기준 하나

폴더가 넷인데 실제로 갈리는 축은 훨씬 많다. 그런데도 코드 경로가 안 느는 이유가 있다.

**모듈 안쪽 배치에서 실제로 갈리는 축을 세면 여덟이다(2026-08-11 실측):**

| 축 | 값 | 처리 |
|---|---|---|
| 저쪽 끝 | 안 / 밖 | **데이터** — `Link` 의 `from`/`to` **빈 쪽** |
| 역할 | 입력 / 출력 | **데이터** — `side: "from"\|"to"` + 선호 면 |
| external 여부 | 예 / 아니오 | **데이터** — 처리 **순서**만 다르다 |
| 면 방향 | W/E / N/S(gap) | **데이터** — `face` 값 |
| 유체 면 | 아님 / 점프 / 점프불가 | **데이터** — `pipeFaces` + `allowPipeFace` |
| 벨트 줄 수 | 1 / N | **데이터** — 그룹을 N개 만들면 끝 |
| **이쪽 끝** | **1대 / N대** | ⚠ **분기** — 배분기 둘 |
| **운반체** | **벨트 / 파이프** | ⚠ **분기** — 유체는 배정 자체를 안 한다 |

**조합은 수십인데 경로는 셋이다**(링크 배분기 · 탭 배분기 · 유체 받아쓰기). 여섯 축이 데이터로 접혔기 때문이고, 접힌 기준이 이것이다:

> ## 차이가 **값**이면 데이터. 차이가 **먹는 자원의 종류**이면 분기.

- *저쪽 끝*이 접힌 이유: 상대가 안이든 밖이든 **이 모듈이 하는 일이 똑같다** — 면에 팔 k개를 앉히고 벨트 한 줄을 뽑는다. 먹는 자원(좌석 k칸)도 절차도 같다.
- *이쪽 끝*이 안 접힌 이유: 1대짜리 벨트는 **좌석 하나**만 다투는데(자기 구간만 덮고 꺾는다), N대짜리는 **좌석 + 깊이**을 다툰다(면을 따라 끝까지 달린다). **자원의 가짓수가 다르다.**

### 새 축이 들어올 때 — 세 질문

1. **먹는 자원의 *종류*가 바뀌나?** 아니면 → **데이터**(값이나 순서로 표현). 지금까지 여섯 축이 여기서 끝났다.
2. 바뀐다면 **양**인가 **가짓수**인가? 양이면 필드 값, 가짓수면 자원 축 하나 추가.
3. **절차 자체의 순서가 다른가?** 여기까지 와야 진짜 분기다. 지금 걸리는 건 **파이프 하나뿐**(배정을 안 하고 `fluid_boxes` 가 정한 답을 받아쓴다).

> **격자를 코드 구조로 착각하지 말 것.** 경우의 수는 곱해지지만 **폴더도 경로도 더해질 뿐**이어야 한다. 칸마다 경로를 만들고 싶어지면 1번 질문을 안 던진 것이다.

## `planner/` 는 "모듈 사이"가 아니라 **상위 조율 주체**다

옛 정의(*"모듈 사이를 조율하는 코드"*)가 틀린 근거:

```
module/  →  planner/   :  거의 0     ← module 은 planner 를 (사실상) 모른다
planner/ →  module/    :  다수       ← modulePacking · moduleWizard · deliveryRoute
```

의존이 사실상 단방향이고 **진입점(`moduleWizard`)도 `planner/` 에 있다.**
즉 `planner` 가 상위이고 `module`·`link`·`channel`·`perimeter` 는 **그 안의 관심사**다.
**모듈 *사이*만 조율하는 역할은 `link` 가 맡는다.**

이 구분이 중요한 이유는 예약 철학이다 — *"큰 그림을 보는 주체 **하나**가 자리를 먼저 잡고,
뒤 단계는 탐색 없이 놓기만 한다."* 그 주체가 곧 `planner/` 다. 주체가 둘로 갈리면
*"무관한 판정이 이미 끝난 예약을 삼키는"* 종류의 버그가 난다(2026-07-21 실측).

## 현재 트리

```
autoLayout/
├ planner/                     계획 — 조율 주체. 아무것도 놓지 않는다
│   ├ module/                    한 모듈 안쪽 계획
│   │   ├ planModulePorts.ts       ★ 모듈 안쪽 계획의 단일 진입점 — 순서만 쥐는 뼈대
│   │   ├ policy.ts                정책 — 모듈 축(링크 · 나머지 줄 · 처방)과 간선 축(seatLinkEdge)에서 고른다
│   │   ├ allocateArms.ts          팔 산술(requiredInserterCount·allocateArms)
│   │   ├ depthBudget.ts            깊이 예산 — 줄마다 `g` 를 정한다
│   │   ├ linkPlanner.ts           정책 — 링크 면 · 끝 · 깊이 순서를 고른다 (좌표 없음)
│   │   ├ ledger.ts                장부 — 면마다 좌석표 · 끝 · 기둥 밖 칸을 묻고 적는다
│   │   ├ faceTable.ts             장부의 모양 — 표 한 장 (행 번호 · 주인)
│   │   └ arith.ts                 셈 — 깊이 목록 · gap 폭 · 빠져나가는 옆면 · 옆면 최대 깊이
│   ├ link/                      모듈과 모듈을 잇는 일
│   │   ├ types.ts                 타입 — 납품의 설정과 결과 (DeliveryConfig · DeliveryResult · DeliveryRoute)
│   │   ├ allocateFlows.ts  어느 기계 쌍을 몇 벨트로 (import 0 — 순수 산술)
│   │   ├ edgeLinks.ts             신원 생성 · 간선 링크 유도 · 포트 짝짓기
│   │   ├ policy.ts                정책 — 간선마다 산출물 · 끝 · 줄 · 레인 짝 · 다시 붓기 (edgeLinksOf) · 납품 사다리(fluidFirst · chooseRoute · routeOneDelivery)
│   │   ├ ledger.ts                장부 — 전 모듈 점유 · 계획 체인의 예약 · 깐 칸과 corridor · 뗄 것 · 계수 (plannedChainClear · recordRoute)
│   │   ├ shape.ts                 도형 — 탐색 경계 · 뗄 칸 · 좌석 이음 · 계획 체인 · 연속성 (buildPlannedChain)
│   │   ├ emit.ts                  찍기 — 납품 체인 → 벨트 · 파이프 셀 (finishChain · finishFluidChain)
│   │   └ arith.ts                 셈 — 생성된 두 모듈의 포트 짝짓기 (pairDeliveries)
│   ├ tree/                      모듈 트리 전체 — 조율자(modulePacking)가 받고 내는 것
│   │   ├ types.ts                 타입 — NodeSpec · PackConfig · PackResult 와 그 필드들
│   │   ├ arith.ts                 셈 — 부모·자식 · 깊이마다 순서(DFS 한 번) · 모듈 하나의 계획 입력
│   │   └ shape.ts                 도형 — 세로 자리(topY) · 가로 자리(colX) · 절대 배치 · 납품 조립
│   ├ channel/                   통로 — 여러 연결이 나눠 쓰는 자원
│   │   ├ types.ts                 타입 — 채널 기하 장부의 입력과 결과 (DeliveryInput · ExportInput · GeometryContext · ChannelGeometryPlan)
│   │   ├ ledger.ts                장부 — 행 채널 신원·트랙·높이 (rowChannelsOf) · 세로 채널 트랙 (planChannels)
│   │   ├ policy.ts                정책 — 반출의 진출 변(해소 사다리 1단) · 지상 배정 순서(실패 비용 순) · 유체 폴백 사유
│   │   └ shape.ts                 도형 — 행 채널 칸 범위 · 납품 끝의 절대 행 · materializeChannelGeometry · 추상 셀 모델(경로 모양 · 충돌 · 셀 순서열 · 같은 쪽 판정)
│   ├ perimeter/                 전역 외곽
│   │   ├ types.ts                 타입 — 반출 출구 배정의 입력과 결과 (ExitPortInput · ExitContext · LayoutGrid · PerimeterExitPlan)
│   │   ├ shape.ts                 도형 — 출구의 자격: 직진 후보인가 · 환승할 열 채널이 있나 (directOptionOf · channelEntryOf — 광선에 묻는다)
│   │   ├ wayOuts.ts               모듈이 "내 몸통에 안 막히는 방향"을 답한다
│   │   └ exits.ts                 반출 배정의 입력 준비 (프레임 확장 · 대상 포트 수집)
│   ├ run/                       한 번의 실행 전체 — 종류마다 한 파일
│   │   ├ gamedata.ts              어댑터 — 트리 + 게임데이터 → NodeSpec · 유체 머신 · 사거리
│   │   ├ policy.ts                정책 — 받을지 물릴지 · 처방 (planner 안에서 LayoutIssue 를 짓는 곳 — 입구 layeredWizard 도 넷을 짓는다)
│   │   ├ ledger.ts                장부 — 유체 관망 · 종착 구간
│   │   └ emit.ts                  찍기 — CandidateLeaf(Area · Routing) · 실패 그림
│   ├ moduleWizard.ts            ★ 배치 전체 진입점 — run/ 을 여덟 단계로 부르는 뼈대
│   ├ modulePacking.ts             조율자 — 사슬 열(트리 → 링크 → 좌석 → 모양 → 짝 → 행 채널 → 세로 → 통로 → 가로 → 결과)을 순서대로 엮는 뼈대
│   ├ channelPlanner.ts            모듈 사이 통로 폭
│   ├ channelGeometryPlanner.ts    장부 — 그 통로 안에서 누가 어느 세로줄(배정 · 지하 청구 · 폭 예약) + 사다리 순서만 쥐는 뼈대
│   ├ perimeterExitPlanner.ts      정책 — 반출 출구 배정: 선호 순서 · 후보가 적은 상자부터 · 직진 강등(국소 장부 `laid`) · 막힘 기록
│   ├ perimeterRouter.ts           포트 → 바깥 변 벨트 모양
│   ├ deliveryRoute.ts             조율 — 자식 출력 → 부모 입력 잇기. 납품 사다리를 한 납품씩 부르고 신원을 찍는 뼈대
│   └ containerRouting.ts          Dijkstra · occupancy · beltFlow (계획의 탐색 도구)
├ execution/                   실행 — 계획대로 셀을 놓는다
│   ├ module/emitModule.ts         링크 줄(싣는 쪽 · 집는 쪽) · 유체 기둥의 셀을 놓는다 — 틀과 길은 module/shape/body 에서 받는다
│   ├ module/beltTerminus.ts      흐름의 끝 칸 — 합류를 피할 방향 / 지하 종착
│   ├ emitPath.ts                  경로 → 벨트·파이프 셀
│   ├ machinePlacer.ts             머신 footprint
│   └ modulePerimeterPass.ts       살아남은 상자를 전역 외곽으로
├ module/                      한 모듈 안쪽 (형제를 모른다. 셀을 만들지 않는다)
│   ├ types/                       타입 — 계획·조율·방출이 함께 읽는다. 실행되는 것이 없다
│   │   ├ line.ts                    무엇을 나르나 — IoLine · PlannedLine · SupplyCapacity · Link
│   │   ├ seat.ts                    어디에 앉나  — LinkFacePlan · LinkSeats · DepthShortage · LinkFaceStage
│   │   └ module.ts                  무엇을 받고 내나 — ModuleInput · GeneratedModule · ModulePort · BeltTerminus
│   ├ arith.ts                     셈 — trunkEndKey · flowEnd (방출과 계획이 함께 부른다) · 유체 점프 예산 · 막힘 · 벨트 깊이 상한 · 유체 줄 조회
│   ├ clusterModule.ts             조율 — generateModule 뼈대(계획 → 몸통 → 장부 → 링크 줄 → 나머지 줄 → 유체 줄 → 마무리)
│   ├ policy.ts                    정책 — 트렁크 틀(유체 기둥이 점프하나 · ClusterPipe 깊이)
│   ├ link.ts          벨트 한 줄 = 팔 묶음 (조립·판독)
│   ├ linkShape.ts                 도형 — 배정 → 먹는 칸 · 셀 (청구와 방출의 단일 출처 · 순번 축)
│   ├ shape.ts                     도형 — 머신 좌표 위: 몸통 · 좌석 좌표 · 기둥 틀 · 링크 틀 · 길 · 포트 끝점 · 유체 틀 · 포트의 경계 기하(납품 · 반출이 부른다)
│   ├ clusterLayout.ts             N대를 어떤 모양으로
│   ├ fluidPorts.ts                어댑터 · 정책 — 유체 상자 칸 · 연결 해석 · 회전과 면 고르기(chooseFluidTrunkPlan). factorio 가 이 주소를 부른다
│   └ moduleTransform.ts           모듈 강체 변환 — 회전·반사·평행이동·범위
├ util/                        양쪽 계층이 쓰는 도구. 아무것도 고르지 않는다
│   ├ cellBuilder.ts               정해진 칸을 물건으로 채운다
│   ├ helper.ts                    격자 위에서 셈만 한다
│   └ pipeFlow.ts                  파이프 합류 가드 (판정만 — 자리를 고르지 않는다)
└ (루트)                       **배치 이전 단계** — 좌표가 없어 계층 축이 무의미하다
                               layeredWizard(최상위 진입점 · **게임데이터를 읽는 유일한 곳**) · recipeTree · buildSpec ·
                               wizardUtils · beltThroughput · inserterThroughput
                               + containerModel(타입) · types · debugFlags ·
                               moduleInspect(진단) · areaUnification(배치 결과 표시)
```

> **`shared/frames.ts` 는 이름에 속기 쉽다.** 드래그 기능처럼 보이지만 남은 것은
> **레이아웃 좌표 → 그리드 좌표 경계를 넘는 문**(`unifyLeaf`)이다. 드래그 부분은
> 2026-09-16 에 삭제된 `manualEdit/dragArea.ts` 로 갔었다(→ [[manual-edit]]). 좌표 프레임이 셋이라는 것과 그 경계를 넘는 규칙은
> [[용어사전#좌표 프레임 (coordinate frame)]] 이 단일 출처다.

## 두 축이 실제로 지켜지는가 — 기계적으로 확인할 수 있다

```powershell
# 축 1 — 계획 계층이 셀을 만들면 위반이다. 둘 다 0 이어야 한다(주석 매치 제외).
rg -c "makeContainerCell|makeInserterCell|makeBeltCell|makePipeCell" `
   src/autoLayout/module src/autoLayout/planner

# 축 2 — module 이 형제를 아는 통로. 0 이어야 한다.
rg "planner/link" src/autoLayout/module

# link 는 순수 배정기다 — import 가 하나도 없어야 한다.
rg "^import" src/autoLayout/link/arith/flows.ts

# 방출기는 조율자도 계획 계층도 import 하지 않는다 — 둘 다 0 (2026-09-13 D4 해소 뒤).
rg 'from ".*(clusterModule|planner/module)' src/autoLayout/execution/module --glob '!*.test.ts'

# 게임데이터 형식은 src/types/gameData.ts — autoLayout 이 UI 스토어를 보는 곳은 입구뿐이다(2026-09-14).
rg -l 'UI/store' src/autoLayout -g '*.ts' -g '!*.test.ts'   # → layeredWizard 하나
```

2026-08-02 기준 셋 다 통과한다. 예전에 어긋났던 다섯 곳은 이렇게 해소됐다:

| # | 무엇이 문제였나 | 어떻게 |
|---|---|---|
| V1 | `fillModuleWayOuts` 의 소비처가 `planner/` 뿐인데 `module/` 에 있었다 | → `module/shape/body/ways.ts` |
| V2 | `allocateFlows` 가 `module/` 에 있는데 **형제를 알았다** | → `planner/link/` |
| V3 | `clusterPortPlanner`(796줄)가 **계획인데** `module/` 에 있었다 | → `planner/module/`.
그 뒤 2026-09-02 에 그 파일의 계획기 둘(`planClusterPorts`·`insertingPlanner`)이 삭제되고
남은 타입·산술이 `ioLine.ts`·`allocateArms.ts` 로 갈렸다(`ioLine.ts` 는 2026-09-13 `module/types/line.ts` 로) |
| V4 | 한 파일에 **두 관심사**가 있어 `module/ ⇄ planner/link/` 왕복 간선이 생겼다 | 둘로 가름 — 아래 |
| V5 | `clusterModule` 이 다이렉트 인서팅 셀을 **직접 만들었다** | → `execution/module/emitDirectInserting` |

**V4 가 왜 왕복 간선을 만들었나:** `allocateFlows`(두 클러스터의 대수를 본다 = link)와
`Link`·`makeLink`·`readLinkRole`·`externalLineGroups`(로컬 머신 index + 팔 수뿐
= module)가 한 파일에 있었다. 그래서 `module/` 이 그 파일을 부르고, 그 파일이 다시 `module/`
의 `requiredInserterCount` 를 불렀다. 갈라 놓으니 **두 간선이 동시에 사라졌다** —
`link/arith/flows` 는 이제 아무것도 import 하지 않는 순수 산술이다.

## 자리를 정한 근거 — 판단이 갈렸던 것들

폴더가 자명하지 않았던 파일들이다. **"무엇을 아는가"로 판정했다.**

| 파일 | 어디로 | 왜 |
|---|---|---|
| `modulePacking` 의 헬퍼 561줄 | link·perimeter·moduleTransform 로 분산 | 조율 로직은 366줄뿐이었고 나머지는 **다른 관심사**였다. 부르는 **순서는 그대로** 두고 정의 위치만 옮겼다(폭이 좌표를 정하고 좌표가 예약을 정하는 사슬이라 순서는 필연) |
| `moduleTransform` | `module/` 유지 | 회전·반사·평행이동·범위는 **강체 기하**다. 아무것도 고르지 않으니 planner 가 아니고, `GeneratedModule` 을 아니 격자 유틸도 아니다 |
| `pipeFlow` | `util/` | *"이 칸에 놓으면 안 되나"* 를 **판정만** 한다 — 자리를 고르지 않는다. 게다가 소비처가 `planner/`·`execution/` 양쪽이라 어느 한 계층에 둘 수 없다 |
| `containerRouting` | `planner/` | Dijkstra 는 **계획의 도구**다. 런타임 소비처가 `link/policy/delivery`(납품의 탐색 칸) 하나뿐이고, `shared/cells/path` 는 **타입만** 가져간다(런타임 간선 아님) |
| 배치 이전 단계 6파일 | 루트 유지 | `layeredWizard`·`recipeTree`·`buildSpec`·`wizardUtils`·`beltThroughput`·`inserterThroughput` 은 *"무엇을 얼마나 지을까"* 만 답한다. **좌표가 없어 계층 축이 적용되지 않는다** — 루트가 그 자리다 |

**아직 안 가른 것 하나:** `channel/shape.materializeChannelGeometry` 는 납품(channel)과
반출(perimeter)을 **한 번에** 훑는다. 둘이 같은 트랙 풀을 다투기 때문이다
(`planChannelGeometry(deliveries, exports, …)` 가 둘을 함께 받는 것과 같은 이유).
관심사로 가르려면 **그 다툼을 먼저 풀어야** 한다 — 지금 가르면 배정이 갈라져 예약이 깨진다.

## util 두 파일의 경계

**`shared/grid.ts` — 격자 위에서 셈만 한다.** 아무것도 놓지 않는다.
`cellKey` · `faceVector` · `vectorToDirection` · `segment` · `faceCell` ·
`enumeratePerimeterCells` · `expandBbox` + 공유 상수(`PERIMETER_MARGIN` · `PIPE_BLOCK_GROUP`).

**`shared/cells/builder.ts` — 정해진 칸을 물건으로 채운다.** 좌표와 방향이 이미 정해진 뒤 불린다.
어디에 놓을지 고르지 않고, 길도 찾지 않는다.
`makeBeltCell` · `makeInserterCell` · `makeContainerCell`.

> 새 함수를 `util/` 에 넣기 전 확인: 이 함수가 *"어디에 무엇을 놓을지"* 를 **고르는가**,
> 아니면 이미 고른 자리를 **채우거나 세기만** 하는가? 고른다면 `util/` 이 아니다.

## 검증 방법 — 함정 있음

```powershell
npx tsc -p tsconfig.app.json --noEmit   # 반드시 -p. 인자 없는 tsc 는 0개 검사하고 조용히 성공한다
npx vitest run
```

기준선: **타입 에러 0 · 62파일 784테스트**(기존 실패 2건 — trunkPipe 유체 면).

> **테스트 통과가 "그 코드가 실행됐다"는 뜻은 아니다.** 배치를 바꾸는 변경은 좌표 덤프로
> 전후를 비교하고, **바꾼 분기가 실제로 불렸는지**를 먼저 확인한다(2026-08-02: 448개가
> 전부 통과하는데 링크 배정 분기는 한 번도 안 지나는 상황을 실제로 만났다).

## modulePerimeterPass 순수화 (2026-07-11 완료)

폴더 이동 당시 `modulePerimeterPass` 는 남의 모듈 내부 셀을 직접 지우고 새로 깔았다
(`mod.cells` filter+push, `port.cells`·`port.anchor`·`chest.origin` 뮤테이션). 이제
`deliveryRoute` 과 같은 규약이다 — **모듈 그래프를 건드리지 않고 설명을 반환**한다:

- 이사 **계획**만 산정하고 `PerimeterPassResult` 로 돌려준다:
  `droppedCellKeys`(뗄 옛 ghost/feeder 좌표) · `addedCells`(놓을 belt/feeder/chest 셀) ·
  `relocations`(상자별 새 origin·belts).
- 적용은 호출자 [moduleWizard](../../../src/autoLayout/run/build/module.ts)
  가 Area 를 지을 때 한다.

동작 변경 0(골든 스냅샷 불변). 회귀:
[modulePerimeterPass.test.ts](../../../src/autoLayout/execution/modulePerimeterPass.test.ts)
의 "순수 — pack 미변형" 이 pack 이 한 셀도 안 바뀜을 단언한다.

> 남은 확인: `tryRunModulePipeline`(moduleWizard 진입점)은 gameDataStore 의존이라 단위
> 테스트가 없다 — 어댑터 적용은 등가성 추적 + 브라우저 실측으로만 확인된다.
