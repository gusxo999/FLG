---
tags: [auto-layout]
---

> **부모 문서:** [wizard](../wizard.md)
> **관련 문서:** [[code-folders]] — 오늘의 **폴더** 경계(계층 × 관심사) · [[layout-models]] — 공간 축 ·
> [[pipeline-lifecycle]] — 시간 축

# 일의 종류 — 이 코드에는 **여덟 가지 일**이 있다

> **이 문서를 읽어야 하는 때**
> - 새 파일을 어디에 둘지, 큰 파일을 **어디서 자를지** 정할 때
> - *"이 함수가 하는 일이 하나인가"* 를 판정할 때
> - 파일 하나가 500줄을 넘어갈 때 → **§5 를 먼저 본다**
> - 폴더 구조를 다시 그리자는 생각이 들 때 → §7 과 `tempPlanDocs/구조-2축/`

## 0. 한 줄 요약

이 저장소의 코드는 **여덟 종류**의 일로 되어 있다 — 결정하는 넷(**셈 · 장부 · 도형 · 정책**)과
결정하지 않는 넷(**낱말 · 어댑터 · 찍기 · 조율**). 그리고 **파일이 커지는 것과 종류가 섞이는 것은
같은 현상**이다: 결정하는 종류를 셋 이상 겸한 파일 일곱은 **전부 500줄이 넘고**, 종류 하나만
담은 파일은 335줄을 넘지 않는다(낱말·조율 제외).

## 1. 문제 — 폴더 축만으로는 판정이 서지 않았다

[[code-folders]] 의 두 축(계층 × 관심사)은 **파일이 어느 폴더인가**에 답한다. 그런데 그 축으로는
답이 안 나오거나 갈리는 자리가 실제로 있었다.

| 실물 | 무엇이 갈렸나 |
|---|---|
| `planner/perimeter/wayOuts.ts` | code-folders 는 *"무엇을 아는가로 판정한다"* 고 적었는데, V1 이관은 *"소비처가 planner 뿐"* 으로 판정했다. 그 결과 `module/` → `planner/` 상향 import 둘이 남아 있다([clusterModule.ts:37](../../../src/autoLayout/module/clusterModule.ts) · [moduleTransform.ts:23](../../../src/autoLayout/module/moduleTransform.ts)) |
| "좌석 배정" | 한 이름 아래 성질이 다른 다섯이 있다 — 장부 · 가격표 · 적합성 · 청구 · 정책. 그래서 `tryLinkFace` 가 `forceEnd`·`preferEnd`·`preferDepth` 라는 **정책 인자 셋**을 들고 있다 |
| 포트 칸 도형 | 같은 도형이 계획([linkPlanner.ts `portCells`](../../../src/autoLayout/planner/module/linkPlanner.ts))과 방출([emitModule.ts](../../../src/autoLayout/execution/module/emitModule.ts))에 **두 벌** 있고, 둘을 붙들고 있는 것은 줄 번호를 적은 주석뿐이다 |

셋 다 *"이 코드가 **무슨 종류의 일**을 하는가"* 를 묻지 않아서 생겼다. 폴더 축과 직교하는 축이
하나 더 필요하다.

## 2. 결정하는 일 넷

| 종류 | 무엇인가 | 기계적 판정 | 예 |
|---|---|---|---|
| **셈** | 자원도 좌표도 없는 순수 산술 | 숫자만 낸다 | `beltThroughput` · `allocateArms` · `allocateFlows` |
| **장부** | 자원의 상태 · 질의 · 청구 | **상태를 갖는다** | `faceTable`(좌석표) · `channelGeometryPlanner`(트랙) · `directRay`(직진) · `buildOccupancy` |
| **도형** | 배정 → 먹는 칸과 셀 모양 | **좌표를 낸다** | `clusterLayout` · `moduleTransform` · `routeShape` · `perimeterRouter` · `layoutRegions` |
| **정책** | 순서 · 선호 · 동률 · 실패 처방 | **대안 중에서 고른다** | 배정 순서(스도쿠 정렬) · 선호 면 · 넘김 순서 · 출구 배정 |

**셈과 정책의 경계**가 가장 자주 흐려진다. 판정은 *"대안이 있었나"* 다 — `armsFor` 는 답이 하나라
셈이고, `edgeLinkGroups` 는 배선 형태 셋 중에서 고르므로 정책이 섞여 있다.

## 3. 결정하지 않는 일 넷

| 종류 | 무엇인가 | 예 |
|---|---|---|
| **낱말** | 자료형 정의. *"낱말과 산술로 가른다"* 는 이 저장소의 표현이다(2026-09-02 `clusterPortPlanner` 해체) | `containerModel`(524줄 전부 타입) · `ioLine` · `Link` · `LayoutIssue` |
| **어댑터** | 게임데이터를 우리 낱말로 번역. **prototype 을 보는 유일한 층** | `buildSpec.makeBuildSpec` · `fluidPorts.resolveFluidConnection` · `wizardUtils` |
| **찍기** | 도형 → 셀. 결정은 0, 대신 방향 인코딩 같은 **규약**을 안다 | `cellBuilder` · `emitPath` · `machinePlacer` |
| **조율** | 순서대로 부르고 결과를 엮는다. 고르지 않고 좌표도 안 낸다 | `moduleWizard` · `packModuleTree` · `generateModule` 본문 |

**어댑터가 따로 서는 것이 중요하다.** 게임데이터 조회(`useGameDataStore.getState()`)가 지금
파이프라인 안쪽 네 곳에 흩어져 있는데, 그 넷이 전부 이 종류다.

## 4. 표식 둘 — 종류가 아니라 꼬리표

### 늦은 결정 — 방출 뒤에만 가능하다

처음엔 "마감"을 아홉째 종류로 세웠다가 **철회했다.** 열어 보니 안에 든 것이 서로 달랐다.

```
resolveBeltTermini    후보 셋 중 고름(정책) + 지하벨트 셀(도형)   이웃 칸의 품목은 다 깐 뒤에만 안다
rePathToPerimeter     어디로 이사할지(정책) + 경로(도형)          모든 모듈이 놓인 뒤에만 안다
corridor 되읽기        놓인 셀에서 사실 유도(관측)                 셀이 변환된 뒤에만 정답이다
```

공통점은 *"무슨 일인가"* 가 아니라 **"언제 가능한가"** 뿐이다. 그래서 종류가 아니라 표식이다.
이 표식이 답하는 질문은 하나다 — **"왜 이건 예약으로 못 옮기나."**

### 관측 전용 — 지워도 배치가 안 바뀐다

동작을 안 바꾼다고 **코드가 스스로 선언한** 자리가 여섯이다.

- [planModulePorts.ts](../../../src/autoLayout/planner/module/planModulePorts.ts) *"계측 — 관측만 한다(계산도 분기도 반환값도 안 바꾼다)"*
- [linkPlanner.ts](../../../src/autoLayout/planner/module/linkPlanner.ts) `endsDisagree`·`endsCoarse` *"결정은 아직 `ends` 가 한다. 여기서는 두 답을 대조만 한다"*
- `perimeterExitPlanner` 의 `ExitDemotion`·`ExitBlocked` *"읽기 전용 계측이라 동작을 안 바꾼다"*
- `emitModule` 의 `netTrips` 안전망 · `clusterModule` 의 *"아직 아무 배치도 바꾸지 않는다"*

**이건 이 저장소의 작업 방식이다** — 새 모델을 넣기 전에 옛 모델과 나란히 돌려 답을 대조한다.
찾는 법은 이름 규약이다: `record*` 로 시작하는 함수가 그것이다(`debug/runStats.ts`).

## 5. 크기와 섞임은 **같은 현상**이다

`src/autoLayout` 의 비테스트 파일 47개(manualEdit 제외)를 분류한 결과다.

| | 파일 수 |
|---|---|
| 종류 하나 | 22 |
| 종류 둘 | 11 |
| **종류 셋 이상** | **12** |
| 표식만(계측·시험도구) | 2 |

그리고 **결정하는 종류**(셈·장부·도형·정책)만 세면 이렇게 갈린다.

```
결정 종류 셋 이상 =  7 파일  →  전부 500줄 이상.  예외 없다
        modulePacking 1358 · linkPlanner 1027 · planModulePorts 920 ·
        channelGeometryPlanner 771 · deliveryRoute 717 · perimeterExitPlanner 593 ·
        containerRouting 581

500줄 이상 = 12 파일  →  그중 10개가 종류 셋 이상.
        나머지 둘은 **결정하지 않는 일**만 담았다:
        moduleWizard 913(조율) · containerModel 524(낱말)

종류 하나만 담은 파일의 최대 = 335줄 (recipeTree, 셈)
```

> **그래서 "파일이 크다"는 증상이고 원인은 "종류가 섞였다"이다.** 줄 수 상한을 규칙으로 두는
> 대신 종류를 묻는다 — 500줄이 넘는데 종류가 하나면(조율·낱말) 그건 정상이다.

## 6. 아직 안 갈라진 자리 — 탐색

`containerRouting.dijkstraWithJumps` 는 **장부(occupancy)를 읽어 정책(비용)으로 도형(경로)을
고른다.** 셋이 한 함수에 붙어야만 성립하므로 위 여덟로 안 나뉜다.

종류로 세우지 않는 이유는 이 저장소가 탐색을 **줄여 가는 중**이기 때문이다 — 예약 철학이
*"자리를 먼저 잡고 뒤 단계는 탐색 없이 놓기만"* 이고, 런타임 소비처가 `deliveryRoute` 하나다.
그래서 *"세 종류가 아직 안 갈라진 자리"* 로 표시해 둔다.

## 7. 오늘 코드가 개념에 미달한 곳

[docs/CLAUDE.md](../../CLAUDE.md) 의 판정표대로, **문서를 코드에 맞추지 않고 결함으로 적는다.**

| # | 어긋남 | 실물 |
|---|---|---|
| **D1** | **도형이 두 벌이다** — 계획과 방출이 같은 모양을 각자 계산한다 | `linkPlanner.portCells` 의 주석이 `emitModule.ts:66`·`:214`·`:381` 을 **줄 번호로** 인용한다. 바로 옆 `splitByTable` 은 *"검사와 청구가 같은 함수를 부르게 해서 둘이 갈리지 않게 한다"* 고 적는데, 그 원칙이 계획–방출 **사이**에는 적용돼 있지 않다 |
| **D2** | **방출이 고른다** — `emitModule` 머리말은 *"자리를 고르지 않는다"* 고 적지만, 두 면이 다 차면 그 줄을 포기하고(`unroutedLines`), 좌석이 막히면 폴백한다 | `emitModule.ts` 의 `unroutedLines.push` **여섯 곳** · `netTrips` 계측 |
| **D3** | **모순된 주석** — *"깊이는 막히면 다음 후보로"*(553) 와 *"깊이는 배정이 정해 들고 온 값이다 — 여기선 탐색하지 않는다"*(564) 가 열한 줄 간격으로 있다 | 탐색이 계획으로 옮겨 가며 남은 자국 |
| **D4** | **런타임 순환** — `execution/CLAUDE.md` 는 `clusterModule ⇄ emitModule` 역방향이 `import type` 이라 순환이 아니라고 적지만, `emitModule` 이 `trunkEndKey` 를 런타임으로 가져온다 | `emitModule.ts:45` |

> **2026-09-12 에 둘이 닫혔다.** 도형 대조 계측이 **D5**(합류 여부를 계획과 방출이 다른
> 근거로 판정 → 유령 예약 + 조용한 굶주림)와 **D6**(합류 리드의 기둥 밖 세 칸이 어느 장부에도
> 없음)를 찾아냈고 같은 날 고쳤다. 판정 주체를 배정 하나로 모은 결과가 `LinkFacePlan.mergeRole`
> · `sharesBelt` 다. → `tempPlanDocs/구조-2축/1-도형-단일출처/` §2단계

D1 이 나머지의 뿌리다 — 도형이 한 벌이면 D2 의 발견이 대부분 계획 단계로 올라간다.

## 8. 폴더는 아직 이 축을 안 따른다

**오늘의 폴더 경계는 여전히 [[code-folders]] 가 단일 출처다.** 이 문서는 *"코드가 무슨 종류의
일로 되어 있나"* 만 말하고, 폴더를 다시 그리는 일은 아직 안 했다.

목표 구조(폴더 = 관심사 × 파일 = 종류)와 그 이관 계획은 `tempPlanDocs/구조-2축/` 에 있다.
그 계획이 실행되면 이 문서가 아니라 [[code-folders]] 가 새 트리의 단일 출처가 된다.
