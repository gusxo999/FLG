---
tags: [auto-layout, placement, routing]
---

> **부모 문서:** [auto-layout-wizard.md](../wizard.md)
> **관련 문서:** [.placement-search](placement-search.md), [.channel-geometry-reservation](../channel/channel-geometry-reservation.md),
> [[work-kinds]] — **직교하는 축**: 파일이 *무슨 종류의 일*을 하나(셈·장부·도형·정책 …).
> 이 문서가 *"어느 폴더인가"* 에 답한다면 그쪽은 *"한 파일 안에서 어디를 자르나"* 에 답한다

# auto-layout 코드 폴더 — **폴더는 관심사, 파일 이름은 종류**

**한 줄 요약:** `src/autoLayout/` 의 **폴더는 하나만** 답한다 — *"무엇에 대한 일인가"*.
*"계획인가 실행인가"* 는 폴더가 아니라 **파일 이름**이 든다(`emit.ts` 만 셀을 만든다).

> **2026-09-16 개정 — `planner/` 와 `execution/` 이 없어졌다**(구조-2축 계획 3).
> 예전에는 폴더가 두 축(계층 × 관심사)을 함께 말했고, 그래서 같은 관심사(`module`)가
> **세 폴더**에 흩어졌다. 실측이 그 대가를 말한다 — 2~12파일 커밋 61개 중 **한 폴더에서
> 끝난 것이 15개**뿐이었고, 함께 바뀐 파일 쌍의 **74%가 폴더 경계를 넘었다.**
> 계층은 축으로서 틀린 것이 아니라 **폴더로 표현할 축이 아니었다.**

## 축 1 — 폴더: 무엇에 대한 일인가

| 폴더 | 범위 | 판정 |
|---|---|---|
| **`run/`** | 한 번의 실행 전체 (입력 → 후보) | 진입점과 그 단계들. **스토어를 읽는 유일한 곳** |
| **`tree/`** | 무엇을 몇 대 · 트리를 어떻게 앉히나 | 모듈 **트리 전체**를 안다 |
| **`module/`** | 한 모듈 안쪽 | **형제 모듈을 모른다** |
| **`link/`** | 모듈과 모듈의 연결 | 두 모듈의 **식별자**를 안다 |
| **`channel/`** | 모듈 사이 통로 | 여러 연결이 **공유하는 자원**을 다룬다 |
| **`perimeter/`** | 배치 전체의 바깥 테두리 | **전역 외곽**을 안다 |
| **`shared/`** | 관심사가 없는 것 | 위 여섯 중 **아무것도 import 하지 않는다** |

## 축 2 — 파일 이름: 무슨 종류의 일인가

```
types   타입          arith  셈        ledger  장부      shape  도형
policy  정책          emit   찍기      build   조율      late   늦은 결정
gamedata 어댑터 (prototype·게임데이터 해석)
```

판정은 [[work-kinds]] 가 단일 출처다. **한 종류가 300줄을 넘으면 그 파일을 폴더로 승격**하고,
그때 파일 이름은 **주제**가 맡는다(`module/arith/link.ts` · `channel/ledger/row.ts`).

**계층은 이 축 안에 있다.** *"`PlacedCell` 을 만드는가"* 는 이제 폴더가 아니라 이름이 답한다 —
`emit` 이 만들고 나머지는 안 만든다. 이름에 속으면 안 되는 예는 그대로다:

| 파일 | 인상 | 실제 |
|---|---|---|
| `perimeter/shape/router` | 경로를 깐다 | **좌표 배열만 반환** |
| `link/emit` | 벨트를 놓는다 | 방출을 `shared/cells/path` 에 **위임** |
| `tree/build` | 모듈을 배치한다 | **좌표만** |
| `shared/cells/builder` | 셀을 만든다 | **생성자 라이브러리** — 만들 뿐 자리를 안 고른다 |

## import 규칙 다섯 — 이 구조가 만드는 것

| 규칙 | 무엇을 지키나 |
|---|---|
| `shape` → `ledger` **금지** | **도형이 자원 상태를 모른다.** 계획과 방출이 같은 함수를 부를 수 있는 근거 |
| `emit` → `policy` **금지** | 찍기는 고르지 않는다 |
| `shared/*` → 관심사 폴더 **금지** | 공용은 위를 모른다 |
| `module` → `link`·`channel`·`perimeter` **금지** | 관심사 경계 |
| 스토어는 **진입점**(`run/build/layered.ts`)**만** | 게임데이터는 입구에서 한 번 읽어 넘긴다 |

**오늘 위반은 하나다** — `shared/pipeFlow` 가 `module/gamedata.fluidPortSlots` 를 런타임으로
부른다. 그 함수는 prototype 해석(**어댑터**)이라 `shared/gamedata/` 소속이고, `module/gamedata.ts`
를 어댑터와 정책으로 가르면 사라진다. 검사를 eslint 로 옮기는 일은 구조-2축 계획 4 다.

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

## 예약 철학 — 자리를 먼저 잡는 주체가 하나다

*"큰 그림을 보는 주체 **하나**가 자리를 먼저 잡고, 뒤 단계는 탐색 없이 놓기만 한다."*
주체가 둘로 갈리면 *"무관한 판정이 이미 끝난 예약을 삼키는"* 종류의 버그가 난다(2026-07-21 실측).

**옛 `planner/` 폴더가 그 주체의 이름이었다.** 폴더가 없어져도 규율은 그대로다 — 오늘 그
주체는 **`run/build/` 의 뼈대 둘**이고, 관심사 폴더는 그 뼈대가 순서대로 부르는 단계다.
저장소에 남은 탐색은 **하나**(`shared/route.dijkstraWithJumps` — 납품 사다리의 탐색 칸)뿐이다.

## 현재 트리

```
autoLayout/
├ run/                         한 번의 실행 전체 — 입력에서 후보까지
│   ├ build/layered.ts           ★ 최상위 진입점. 트리 전개 + 머신 선정 · **스토어를 읽는 유일한 곳**
│   ├ build/module.ts            ★ 배치 전체 진입점 — 여덟 단계를 순서대로 부르는 뼈대
│   ├ gamedata/tree.ts           어댑터 — 트리 + 게임데이터 → NodeSpec · 유체 머신 · 사거리
│   ├ gamedata/picker.ts         어댑터 — 머신 픽커 · 머신 파라미터 조회
│   ├ policy.ts                  정책 — 받을지 물릴지 · 처방 (**LayoutIssue 를 짓는 곳**)
│   ├ ledger.ts                  장부 — 유체 관망 · 종착 구간
│   ├ emit.ts                    찍기 — CandidateLeaf(Area · Routing) · 실패 그림
│   └ *.test.ts                  통합 시험 셋 — 한 관심사가 아니라 **한 번의 실행**을 잰다
├ tree/                        무엇을 몇 대 · 트리를 어떻게 앉히나
│   ├ types/{recipe,pack}.ts     타입 — RecipeTreeNode · NodeSpec · PackConfig · PackResult
│   ├ arith/{recipe,pack}.ts     셈 — 레시피 전개 · 머신 수 · 깊이마다 순서 · 모듈 하나의 계획 입력
│   ├ shape.ts                   도형 — 세로 자리(topY) · 가로 자리(colX) · 절대 배치 · 납품 조립
│   └ build.ts                   조율 — 사슬 열(트리 → 링크 → 좌석 → 모양 → 짝 → 행 채널 → 세로 → 통로 → 가로)
├ module/                      한 모듈 안쪽 — 형제를 모른다
│   ├ types/{line,seat,module}.ts  타입 — 무엇을 나르나 · 어디에 앉나 · 무엇을 받고 내나
│   ├ arith/                     셈 — link(벨트 한 줄 = 팔 묶음) · trunk · arms · face · depth
│   ├ ledger/{face,seat}.ts      장부 — 면마다 좌석표 · 끝 · 기둥 밖 칸을 묻고 적는다
│   ├ shape/                     도형 — body(머신 좌표 위) · link(순번 축 · **계획과 방출의 단일 출처**) ·
│   │                                  cluster · transform · ways(내 몸통에 안 막히는 방향)
│   ├ policy/                    정책 — port(단일 진입점 뼈대) · seat · link · trunk
│   ├ build.ts                   조율 — generateModule 뼈대
│   ├ emit.ts                    찍기 — **이 관심사에서 셀을 만드는 유일한 파일**
│   ├ late.ts                    늦은 결정 — 흐름의 끝 칸 · 지하 종착
│   ├ gamedata.ts                어댑터 · 정책 — 유체 상자 칸 · 회전과 면 고르기. factorio 가 이 주소를 부른다
│   └ inspect.ts                 진단 — 적용된 배치에서 모듈 단위 정보를 유도(UI 셋이 쓴다)
├ link/                        모듈과 모듈을 잇는 일
│   ├ tree/types/recipe.ts                   타입 — DeliveryConfig · DeliveryRoute · DeliveryResult
│   ├ arith/{pair,flows}.ts      셈 — 포트 짝짓기 · 어느 기계 쌍을 몇 벨트로(import 0)
│   ├ ledger.ts                  장부 — 전 모듈 점유 · 계획 체인의 예약 · 깐 칸과 corridor · 뗄 것
│   ├ shape.ts                   도형 — 탐색 경계 · 뗄 칸 · 좌석 이음 · 계획 체인 · 연속성
│   ├ policy/{edge,delivery}.ts  정책 — 간선의 링크 / 납품 사다리(계획 → 탐색 → 예약 무시)
│   ├ emit.ts                    찍기 — 체인 → 벨트 · 파이프 셀
│   └ build.ts                   조율 — 한 납품씩 부르고 신원을 찍는 18줄 뼈대
├ channel/                     통로 — 여러 연결이 나눠 쓰는 자원
│   ├ tree/types/recipe.ts                   타입 — DeliveryInput · ExportInput · ChannelGeometryPlan
│   ├ ledger/                    장부 — tracks(세로) · row(행) · assign(신원·순서) · geometry(배정·지하·폭·점프)
│   ├ shape.ts                   도형 — 경로 모양 · 계단꼴 · 충돌 · materializeChannelGeometry
│   └ policy.ts                  정책 — 진출 변 · 실패 비용 순 · 유체 폴백 사유
├ perimeter/                   전역 외곽
│   ├ tree/types/recipe.ts                   타입 — ExitPortInput · ExitContext · LayoutGrid · PerimeterExitPlan
│   ├ ledger.ts                  장부 — 직진 등록(그은 선)
│   ├ shape/                     도형 — qualify(출구 자격) · rays(광선) · router(포트 → 바깥 변) · exits(입력 준비)
│   ├ policy.ts                  정책 — 선호 순서 · 자유도 적은 상자 먼저 · 강등 · 강행
│   └ late.ts                    늦은 결정 — 살아남은 상자를 전역 외곽으로 이사
└ shared/                      관심사가 없는 것 — 위를 모른다
    ├ tree/types/recipe.ts · issue.ts        Container · Port · PlacedCell · Area · LayoutIssue
    ├ grid.ts                    격자 위의 셈 — 아무것도 놓지 않는다
    ├ frames.ts                  레이아웃 좌표 → 그리드 좌표의 문(unifyLeaf)
    ├ arith/{belt,inserter}.ts   처리량
    ├ cells/{builder,path,place}.ts  찍기 — 정해진 칸을 채운다
    ├ gamedata/spec.ts           어댑터 — BuildSpec
    ├ flags.ts                   디버그 플래그
    ├ route.ts        ⚠          탐색 — 장부·정책·도형이 **안 갈린 자리**([[work-kinds]] §6)
    └ pipeFlow.ts     ⚠          파이프 합류 가드 — 위 규칙의 **유일한 위반**이 여기 있다
```

> **`shared/frames.ts` 는 이름에 속기 쉽다.** 드래그 기능처럼 보이지만 남은 것은
> **레이아웃 좌표 → 그리드 좌표 경계를 넘는 문**(`unifyLeaf`)이다. 드래그 부분은
> 2026-09-16 에 삭제된 `manualEdit/dragArea.ts` 로 갔었다(→ [[manual-edit]]). 좌표 프레임이 셋이라는 것과 그 경계를 넘는 규칙은
> [[용어사전#좌표 프레임 (coordinate frame)]] 이 단일 출처다.

## 두 축이 실제로 지켜지는가 — 기계적으로 확인할 수 있다

```powershell
# ① 찍기는 이름이 말한다. 셀 생성자를 부르는 파일은 다섯이고 **넷이 emit/cells** 다.
rg -l "makeContainerCell|makeInserterCell|makeBeltCell|makePipeCell" src/autoLayout -g '!*.test.ts'
#   → module/emit · link/emit · shared/cells/{builder,path} · perimeter/late ⚠

# ② module 은 형제를 모른다 — 0 이어야 한다.
rg "\.\./(\.\./)*(link|channel|perimeter)/" src/autoLayout/module -g '!*.test.ts'

# ③ shared 는 위를 모른다 — 오늘 **한 줄**(pipeFlow → module/gamedata)만 나와야 한다.
rg -n "\.\./(\.\./)*(module|link|channel|perimeter|run|tree)/" src/autoLayout/shared -g '!*.test.ts'

# ④ link/arith/flows 는 순수 배정기다 — import 가 하나도 없어야 한다.
rg "^import" src/autoLayout/link/arith/flows.ts

# ⑤ 스토어는 입구만 본다(2026-09-14).
rg -l 'UI/store' src/autoLayout -g '*.ts' -g '!*.test.ts'   # → run/build/layered 하나
```

2026-09-16 기준 다섯 다 통과한다. ①의 `perimeter/late` 와 ③의 한 줄이 **알고 둔 두 자리**다 —
전자는 늦은 결정이 곧 이사(셀을 옮겨 놓는 일)라 이름이 `emit` 이 아니고, 후자는 `module/gamedata`
의 어댑터 부분이 아직 안 갈린 결과다.

예전 두 축 시절에 어긋났던 다섯 곳은 이렇게 해소됐다(이름은 그때 것):

| # | 무엇이 문제였나 | 어떻게 |
|---|---|---|
| V1 | `fillModuleWayOuts` 의 소비처가 `planner/` 뿐인데 `module/` 에 있었다 | → `module/shape/ways.ts` |
| V2 | `allocateFlows` 가 `module/` 에 있는데 **형제를 알았다** | → `planner/link/` |
| V3 | `clusterPortPlanner`(796줄)가 **계획인데** `module/` 에 있었다 | → `planner/module/`.
그 뒤 2026-09-02 에 그 파일의 계획기 둘(`planClusterPorts`·`insertingPlanner`)이 삭제되고
남은 타입·산술이 `ioLine.ts`·`module/arith/arms.ts` 로 갈렸다(`ioLine.ts` 는 2026-09-13 `module/types/line.ts` 로) |
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
| `tree/build` 의 헬퍼 561줄 | link·perimeter·module/shape 로 분산 | 조율 로직은 366줄뿐이었고 나머지는 **다른 관심사**였다. 부르는 **순서는 그대로** 두고 정의 위치만 옮겼다(폭이 좌표를 정하고 좌표가 예약을 정하는 사슬이라 순서는 필연) |
| `module/shape/transform` | `module/` 유지 | 회전·반사·평행이동·범위는 **강체 기하**다. 아무것도 고르지 않고, `GeneratedModule` 을 아니 격자 유틸도 아니다 |
| `shared/pipeFlow` | `shared/` ⚠ | *"이 칸에 놓으면 안 되나"* 를 **판정만** 한다 — 자리를 고르지 않는다. 소비처가 모듈·납품·반출 **셋**이라 어느 관심사에도 못 둔다. `module/gamedata` 를 부르는 한 줄이 규칙 위반으로 남아 있다 |
| `shared/route` | `shared/` ⚠ | Dijkstra 는 **탐색**이고 종류가 안 갈린다([[work-kinds]] §6). 런타임 소비처는 `link/policy/delivery`(납품의 탐색 칸) 하나뿐이고, `shared/cells/path` 는 **타입만** 가져간다 |
| `run/gamedata/picker` | `run/` (shared 아님) | 머신 픽커인데 `module/arith/arms` 와 `tree/arith/recipe` 를 **부른다**. 관심사를 아는 어댑터는 입구의 것이다 |
| `module/inspect` | `module/` | 소비처가 UI 셋(렌더러 · 정보창 · 라우팅 모달)이지만 **주제는 모듈**이다 — 모듈 신원(`${moduleId}-m${j}`)의 규약에 묶여 있다 |
| `perimeter/shape/rays` | `perimeter/` | 광선은 반출의 어휘다(`perimeter/types` 를 읽는다). 행 채널 환승 자격 때문에 `channel/ledger` 도 부르지만, 그 방향의 간선은 규칙이 막지 않는다 |

**아직 안 가른 것 하나:** `channel/shape.materializeChannelGeometry` 는 납품(channel)과
반출(perimeter)을 **한 번에** 훑는다. 둘이 같은 트랙 풀을 다투기 때문이다
(`planChannelGeometry(deliveries, exports, …)` 가 둘을 함께 받는 것과 같은 이유).
관심사로 가르려면 **그 다툼을 먼저 풀어야** 한다 — 지금 가르면 배정이 갈라져 예약이 깨진다.

## `shared/` 두 파일의 경계

**`shared/grid.ts` — 격자 위에서 셈만 한다.** 아무것도 놓지 않는다.
`cellKey` · `faceVector` · `vectorToDirection` · `segment` · `faceCell` ·
`enumeratePerimeterCells` · `expandBbox` + 공유 상수(`PERIMETER_MARGIN` · `PIPE_BLOCK_GROUP`).

**`shared/cells/builder.ts` — 정해진 칸을 물건으로 채운다.** 좌표와 방향이 이미 정해진 뒤 불린다.
어디에 놓을지 고르지 않고, 길도 찾지 않는다.
`makeBeltCell` · `makeInserterCell` · `makeContainerCell`.

> 새 함수를 `shared/` 에 넣기 전 확인: 이 함수가 *"어디에 무엇을 놓을지"* 를 **고르는가**,
> 아니면 이미 고른 자리를 **채우거나 세기만** 하는가? 고른다면 관심사 폴더의 `policy` 다.

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
[perimeter/late.test.ts](../../../src/autoLayout/perimeter/late.test.ts)
의 "순수 — pack 미변형" 이 pack 이 한 셀도 안 바뀜을 단언한다.

> 남은 확인: `tryRunModulePipeline`(moduleWizard 진입점)은 gameDataStore 의존이라 단위
> 테스트가 없다 — 어댑터 적용은 등가성 추적 + 브라우저 실측으로만 확인된다.
