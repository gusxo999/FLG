---
tags: [auto-layout, placement, routing]
---

> **부모 문서:** [auto-layout-wizard.md](../wizard.md)
> **관련 문서:** [.placement-search](placement-search.md), [.channel-geometry-reservation](../channel/channel-geometry-reservation.md)

# auto-layout 코드 폴더 — 두 축으로 나눈다

**한 줄 요약:** `frontend/src/autoLayout/` 의 폴더는 **두 가지 질문**에 답한다 —
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

- **생성자 라이브러리**(`util/cellBuilder`) — 만들 뿐 배치하지 않는다
- **파사드 API** — 여러 단계를 엮는 것이 책임이다
- **수동 편집 경로**(`manualEdit/`) — 배치 파이프라인 소속이 아니다

이름에 속으면 안 되는 예:

| 파일 | 인상 | 실제 |
|---|---|---|
| `planner/perimeterRouter` | 경로를 깐다 | **좌표 배열만 반환** → 계획 |
| `planner/moduleHop` | 벨트를 놓는다 | 방출을 `execution/emitPath` 에 **위임** → 계획 |
| `planner/modulePacking` | 모듈을 배치한다 | **좌표만** → 계획 |

## 축 2 — 관심사: 무엇에 대한 일인가

| 관심사 | 범위 | 판정 |
|---|---|---|
| **module** | 한 모듈 안쪽 | **형제 모듈을 모른다** |
| **link** | 모듈과 모듈의 연결 | 두 모듈의 **식별자**를 안다 |
| **channel** | 모듈 사이 통로 | 여러 연결이 **공유하는 자원**을 다룬다 |
| **perimeter** | 배치 전체의 바깥 테두리 | **전역 외곽**을 안다 |

## `planner/` 는 "모듈 사이"가 아니라 **상위 조율 주체**다

옛 정의(*"모듈 사이를 조율하는 코드"*)가 틀린 근거:

```
module/  →  planner/   :  거의 0     ← module 은 planner 를 (사실상) 모른다
planner/ →  module/    :  다수       ← modulePacking · moduleWizard · moduleHop
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
│   │   ├ planModulePorts.ts       ★ 모듈 안쪽 계획의 단일 진입점
│   │   ├ clusterPortPlanner.ts    줄 슬롯 배정 · tap/direct 판정
│   │   └ linkPlanner.ts           링크 면·순번 배정 (좌표 없음)
│   ├ link/                      모듈과 모듈을 잇는 일
│   │   ├ allocateMachineLinks.ts  어느 기계 쌍을 몇 벨트로 (import 0 — 순수 산술)
│   │   └ edgeLinks.ts             신원 생성 · 간선 링크 유도 · 포트 짝짓기
│   ├ perimeter/                 전역 외곽
│   │   ├ wayOuts.ts               모듈이 "내 몸통에 안 막히는 방향"을 답한다
│   │   └ lanes.ts                 반출 예약의 입력 준비 (프레임 확장 · 대상 포트 수집)
│   ├ moduleWizard.ts            ★ 배치 전체 진입점
│   ├ modulePacking.ts             조율자 — 모듈 배열 + 위 관심사들을 순서대로 엮는다
│   ├ channelPlanner.ts            모듈 사이 통로 폭
│   ├ channelGeometryPlanner.ts    그 통로 안에서 누가 어느 세로줄
│   ├ perimeterLanePlanner.ts      반출 출구 배정
│   ├ perimeterRouter.ts           포트 → 바깥 변 벨트 모양
│   ├ moduleHop.ts                 자식 출력 → 부모 입력 잇기
│   └ containerRouting.ts          Dijkstra · occupancy · beltFlow (계획의 탐색 도구)
├ execution/                   실행 — 계획대로 셀을 놓는다
│   ├ module/emitModule.ts         트렁크 · 링크 · 탭/다이렉트 인서터 · 유체
│   ├ emitPath.ts                  경로 → 벨트·파이프 셀
│   ├ machinePlacer.ts             머신 footprint
│   └ modulePerimeterPass.ts       살아남은 상자를 전역 외곽으로
├ module/                      한 모듈 안쪽 (형제를 모른다. 셀을 만들지 않는다)
│   ├ clusterModule.ts             모듈 생성 오케스트레이터
│   ├ machineLinkGroup.ts          벨트 한 줄 = 팔 묶음 (자료 구조 + 조립·판독)
│   ├ clusterLayout.ts             N대를 어떤 모양으로
│   ├ fluidPorts.ts                유체 면 선택
│   └ moduleTransform.ts           모듈 강체 변환 — 회전·반사·평행이동·범위
├ manualEdit/                  ★ 비활성 격리 — 호출자 0, 타입검사·테스트 제외
├ util/                        양쪽 계층이 쓰는 도구. 아무것도 고르지 않는다
│   ├ cellBuilder.ts               정해진 칸을 물건으로 채운다
│   ├ helper.ts                    격자 위에서 셈만 한다
│   └ pipeFlow.ts                  파이프 합류 가드 (판정만 — 자리를 고르지 않는다)
└ (루트)                       **배치 이전 단계** — 좌표가 없어 계층 축이 무의미하다
                               layeredWizard(최상위 진입점) · recipeTree · buildSpec ·
                               wizardUtils · beltThroughput · inserterThroughput ·
                               techGroup + containerModel(타입) · types · debugFlags ·
                               moduleInspect(진단) · areaUnification(배치 결과 표시)
```

> **`manualEdit/` 를 읽지 말 것.** 드래그·수동 편집 코드를 격리해 둔 곳이고 **호출자가 0**
> 이다. 타입검사·테스트에서도 빠져 있다. 무엇을 하려던 기능이었는지는
> `manualEdit/README.md` 에 있다.

> **`areaUnification.ts` 는 이름에 속기 쉽다.** 드래그 기능처럼 보이지만 남은 것은
> **배치 결과를 화면 좌표로 평탄화하는 표시 경로**(`unifyAreas`)다. 드래그 부분은
> `manualEdit/dragArea.ts` 로 갔다.

## 두 축이 실제로 지켜지는가 — 기계적으로 확인할 수 있다

```powershell
# 축 1 — 계획 계층이 셀을 만들면 위반이다. 둘 다 0 이어야 한다(주석 매치 제외).
rg -c "makeContainerCell|makeInserterCell|makeBeltCell|makePipeCell" `
   frontend/src/autoLayout/module frontend/src/autoLayout/planner

# 축 2 — module 이 형제를 아는 통로. 0 이어야 한다.
rg "planner/link" frontend/src/autoLayout/module

# link 는 순수 배정기다 — import 가 하나도 없어야 한다.
rg "^import" frontend/src/autoLayout/planner/link/allocateMachineLinks.ts
```

2026-08-02 기준 셋 다 통과한다. 예전에 어긋났던 다섯 곳은 이렇게 해소됐다:

| # | 무엇이 문제였나 | 어떻게 |
|---|---|---|
| V1 | `fillModuleWayOuts` 의 소비처가 `planner/` 뿐인데 `module/` 에 있었다 | → `planner/perimeter/wayOuts.ts` |
| V2 | `allocateMachineLinks` 가 `module/` 에 있는데 **형제를 알았다** | → `planner/link/` |
| V3 | `clusterPortPlanner`(796줄)가 **계획인데** `module/` 에 있었다 | → `planner/module/` |
| V4 | 한 파일에 **두 관심사**가 있어 `module/ ⇄ planner/link/` 왕복 간선이 생겼다 | 둘로 가름 — 아래 |
| V5 | `clusterModule` 이 다이렉트 인서팅 셀을 **직접 만들었다** | → `execution/module/emitDirectInserting` |

**V4 가 왜 왕복 간선을 만들었나:** `allocateMachineLinks`(두 클러스터의 대수를 본다 = link)와
`MachineLinkGroup`·`makeLink`·`readLinkRole`·`externalLineGroups`(로컬 머신 index + 팔 수뿐
= module)가 한 파일에 있었다. 그래서 `module/` 이 그 파일을 부르고, 그 파일이 다시 `module/`
의 `requiredInserterCount` 를 불렀다. 갈라 놓으니 **두 간선이 동시에 사라졌다** —
`planner/link/allocateMachineLinks` 는 이제 아무것도 import 하지 않는 순수 산술이다.

## 자리를 정한 근거 — 판단이 갈렸던 것들

폴더가 자명하지 않았던 파일들이다. **"무엇을 아는가"로 판정했다.**

| 파일 | 어디로 | 왜 |
|---|---|---|
| `modulePacking` 의 헬퍼 561줄 | link·perimeter·moduleTransform 로 분산 | 조율 로직은 366줄뿐이었고 나머지는 **다른 관심사**였다. 부르는 **순서는 그대로** 두고 정의 위치만 옮겼다(폭이 좌표를 정하고 좌표가 예약을 정하는 사슬이라 순서는 필연) |
| `moduleTransform` | `module/` 유지 | 회전·반사·평행이동·범위는 **강체 기하**다. 아무것도 고르지 않으니 planner 가 아니고, `GeneratedModule` 을 아니 격자 유틸도 아니다 |
| `pipeFlow` | `util/` | *"이 칸에 놓으면 안 되나"* 를 **판정만** 한다 — 자리를 고르지 않는다. 게다가 소비처가 `planner/`·`execution/` 양쪽이라 어느 한 계층에 둘 수 없다 |
| `containerRouting` | `planner/` | Dijkstra 는 **계획의 도구**다. 런타임 소비처가 `planner/moduleHop` 하나뿐이고, `execution/emitPath` 는 **타입만** 가져간다(런타임 간선 아님) |
| 배치 이전 단계 6파일 | 루트 유지 | `layeredWizard`·`recipeTree`·`buildSpec`·`wizardUtils`·`beltThroughput`·`inserterThroughput`·`techGroup` 은 *"무엇을 얼마나 지을까"* 만 답한다. **좌표가 없어 계층 축이 적용되지 않는다** — 루트가 그 자리다 |

**아직 안 가른 것 하나:** `modulePacking.materializeChannelGeometry` 는 납품(channel)과
반출(perimeter)을 **한 번에** 훑는다. 둘이 같은 트랙 풀을 다투기 때문이다
(`planChannelGeometry(deliveries, exports, …)` 가 둘을 함께 받는 것과 같은 이유).
관심사로 가르려면 **그 다툼을 먼저 풀어야** 한다 — 지금 가르면 배정이 갈라져 예약이 깨진다.

## util 두 파일의 경계

**`util/helper.ts` — 격자 위에서 셈만 한다.** 아무것도 놓지 않는다.
`cellKey` · `faceVector` · `vectorToDirection` · `segment` · `faceCell` ·
`enumeratePerimeterCells` · `expandBbox` + 공유 상수(`PERIMETER_MARGIN` · `PIPE_BLOCK_GROUP`).

**`util/cellBuilder.ts` — 정해진 칸을 물건으로 채운다.** 좌표와 방향이 이미 정해진 뒤 불린다.
어디에 놓을지 고르지 않고, 길도 찾지 않는다.
`makeBeltCell` · `makeInserterCell` · `makeContainerCell`.

> 새 함수를 `util/` 에 넣기 전 확인: 이 함수가 *"어디에 무엇을 놓을지"* 를 **고르는가**,
> 아니면 이미 고른 자리를 **채우거나 세기만** 하는가? 고른다면 `util/` 이 아니다.

## 검증 방법 — 함정 있음

```powershell
cd frontend
npx tsc -p tsconfig.app.json --noEmit   # 반드시 -p. 인자 없는 tsc 는 0개 검사하고 조용히 성공한다
npx vitest run
```

기준선: **타입 에러 0 · 41파일 448테스트.** (`manualEdit/` 는 양쪽에서 제외돼 있다.)

> **테스트 통과가 "그 코드가 실행됐다"는 뜻은 아니다.** 배치를 바꾸는 변경은 좌표 덤프로
> 전후를 비교하고, **바꾼 분기가 실제로 불렸는지**를 먼저 확인한다(2026-08-02: 448개가
> 전부 통과하는데 링크 배정 분기는 한 번도 안 지나는 상황을 실제로 만났다).

## modulePerimeterPass 순수화 (2026-07-11 완료)

폴더 이동 당시 `modulePerimeterPass` 는 남의 모듈 내부 셀을 직접 지우고 새로 깔았다
(`mod.cells` filter+push, `port.cells`·`port.anchor`·`chest.origin` 뮤테이션). 이제
`moduleHop` 과 같은 규약이다 — **모듈 그래프를 건드리지 않고 설명을 반환**한다:

- 이사 **계획**만 산정하고 `PerimeterPassResult` 로 돌려준다:
  `droppedCellKeys`(뗄 옛 ghost/feeder 좌표) · `addedCells`(놓을 belt/feeder/chest 셀) ·
  `relocations`(상자별 새 origin·belts).
- 적용은 호출자 [moduleWizard](../../../frontend/src/autoLayout/planner/moduleWizard.ts)
  가 Area 를 지을 때 한다.

동작 변경 0(골든 스냅샷 불변). 회귀:
[modulePerimeterPass.test.ts](../../../frontend/src/autoLayout/execution/modulePerimeterPass.test.ts)
의 "순수 — pack 미변형" 이 pack 이 한 셀도 안 바뀜을 단언한다.

> 남은 확인: `tryRunModulePipeline`(moduleWizard 진입점)은 gameDataStore 의존이라 단위
> 테스트가 없다 — 어댑터 적용은 등가성 추적 + 브라우저 실측으로만 확인된다.
