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
결정하지 않는 넷(**타입 · 어댑터 · 찍기 · 조율**). 그리고 **파일이 커지는 것과 종류가 섞이는 것은
같은 현상**이다: 결정하는 종류를 셋 이상 겸한 파일 일곱은 **전부 500줄이 넘고**, 종류 하나만
담은 파일은 335줄을 넘지 않는다(타입·조율 제외).

## 1. 문제 — 폴더 축만으로는 판정이 서지 않았다

[[code-folders]] 의 두 축(계층 × 관심사)은 **파일이 어느 폴더인가**에 답한다. 그런데 그 축으로는
답이 안 나오거나 갈리는 자리가 실제로 있었다.

| 실물 | 무엇이 갈렸나 |
|---|---|
| `module/shape/ways.ts` | code-folders 는 *"무엇을 아는가로 판정한다"* 고 적었는데, V1 이관은 *"소비처가 planner 뿐"* 으로 판정했다. 그 결과 `module/` → `planner/` 상향 import 둘이 남아 있다([clusterModule](../../../src/autoLayout/module/build.ts) 의 `finishModule` · [moduleTransform](../../../src/autoLayout/module/shape/transform.ts) 의 `bodyColumnsOf`) |
| "좌석 배정" | 한 이름 아래 성질이 다른 다섯이 있다 — 장부 · 가격표 · 적합성 · 청구 · 정책. 그래서 `tryLinkFace` 가 `forceEnd`·`preferEnd`·`preferDepth` 라는 **정책 인자 셋**을 들고 있다 |
| 포트 칸 도형 | 같은 도형이 계획과 방출에 **두 벌** 있었고, 둘을 붙들고 있는 것이 줄 번호를 적은 주석뿐이었다. 2026-09-12 에 [linkShape](../../../src/autoLayout/module/shape/link.ts) 로 합쳤다 — **종류를 물었더니 답이 나온 자리**다(도형은 도형끼리) |

셋 다 *"이 코드가 **무슨 종류의 일**을 하는가"* 를 묻지 않아서 생겼다. 폴더 축과 직교하는 축이
하나 더 필요하다.

## 2. 결정하는 일 넷

| 종류 | 무엇인가 | 기계적 판정 | 예 |
|---|---|---|---|
| **셈** | 자원도 좌표도 없는 순수 유도 | **답이 하나다** — 자원도 좌표도 안 본다 | `beltThroughput` · `allocateArms` · `allocateFlows` · `flowEnd`·`trunkEndKey`(문자열을 내지만 답은 하나) |
| **장부** | 자원의 상태 · 질의 · 청구 | **상태를 갖는다** | `faceTable`(좌석표) · `channelGeometryPlanner`(트랙) · `directRay`(직진) · `buildOccupancy` |
| **도형** | 배정 → 먹는 칸과 셀 모양 | **좌표를 낸다** | `clusterLayout` · `moduleTransform` · `routeShape` · `perimeterRouter` · `layoutRegions` |
| **정책** | 순서 · 선호 · 동률 · 실패 처방 | **대안 중에서 고른다** | 배정 순서(스도쿠 정렬) · 선호 면 · 넘김 순서 · 출구 배정 |

**셈과 정책의 경계**가 가장 자주 흐려진다. 판정은 *"대안이 있었나"* 다 — `armsFor` 는 답이 하나라
셈이고, `link/policy.productsOf` 는 다산출 레시피에서 부모가 먹는 것으로 고르므로 정책이다. (이 자리의 옛 예 —
*"`edgeLinkGroups` 는 배선 형태 셋 중에서 고르므로 정책이 섞여 있다"* — 는 2026-08-22 재설계로 낡았다. 그 머리말이
*"형태를 고르는 `if` 가 없다"* 고 적는다. 같은 오판이 `module/arith/link` 를 *"셈 · 정책"* 으로 세게 했다 — 종류 하나다.)

## 3. 결정하지 않는 일 넷

| 종류 | 무엇인가 | 판정 | 예 |
|---|---|---|---|
| **타입** | `type`·`interface` 선언. 컴파일에 지워져 런타임에 존재하지 않는다 | **실행되지 않는다** — 계산·상태·좌표·선택이 없다. 몇 종류가 읽는지는 이 판정을 안 바꾼다(한 종류만 읽어도 타입이다) — 그건 **파일로 모아 낼 가치가 있나** 라는 별개 질문이다 — 규칙 3(한 종류가 300줄을 넘으면 폴더로 승격)이 답한다 | `containerModel`(524줄 전부 타입) · `module/types/`(`IoLine`·`Link`·`LinkFacePlan`·`ModuleInput` …) · `planner/{tree,channel,perimeter,link}/types` · `LayoutIssue` |
| **어댑터** | 게임데이터를 우리 타입으로 번역. **prototype 을 보는 유일한 층** | 지우면 게임데이터 접근이 하나 사라진다 — prototype 필드를 직접 읽는 줄이 있다 | `buildSpec.makeBuildSpec` · `fluidPorts.resolveFluidConnection` · `wizardUtils` |
| **찍기** | 도형 → 셀. 결정은 0, 대신 방향 인코딩 같은 **규약**을 안다 | 입력 도형이 같으면 출력 셀도 같다 — 고를 대안이 없다 | `cellBuilder` · `emitPath` · `machinePlacer` |
| **조율** | 순서대로 부르고 결과를 엮는다. 고르지 않고 좌표도 안 낸다 | 본문에 계산·비교·상태가 없다 — 호출과 결과 조립뿐이다 | `packModuleTree` 뼈대 · `generateModule` 본문 · `runModulePipeline` 뼈대 |

> **이 종류는 2026-09-13 까지 「낱말」이라 불렸다 — 그 이름을 버렸다.**
> 한 단어가 뜻 셋을 지고 있었다: ①`type` 선언(여기 이 종류) ②용어 위생(*"「양보」라고 쓰지
> 않는다"* — `perimeter/types.ExitOption`) ③범주 라벨(`tap`/`direct`). **한 이름에 두 뜻이
> 붙으면 안 된다는 것은 이 저장소가 다른 자리에서 스스로 집행하는 규칙인데**(`track` 을
> 걷어낸 이유가 정확히 그것이다) 정작 종류의 이름이 그걸 어겼다.
>
> 그리고 그 이름이 실제로 오분류를 불렀다 — `trunkEndKey`·`flowEnd` 두 **함수**가 *"이름을
> 정하는 일이니 낱말"* 이라는 이유로 타입 파일 목적지에 들어가 있었다. 위 판정(*실행되지
> 않는다*)에 그대로 걸린다. 둘은 **셈**이고 `module/arith/trunk.ts` 로 간다.
> ①은 **타입**, ②는 **용어**, ③은 **라벨**로 갈라 적는다.

**어댑터가 따로 서는 것이 중요하다.** 게임데이터 조회(`useGameDataStore.getState()`)가 파이프라인
안쪽 다섯 곳에 흩어져 있었고, 그 다섯이 전부 이 종류였다. 2026-09-14 **입구(`layeredWizard`) 한 곳**에서
읽어 `GameDataLookup` 으로 넘기게 모았다 — 게임데이터를 **보는** 함수는 그것을 받는 `buildSpec` ·
`wizardUtils` · `run/gamedata/tree` 뿐이다. 넘기는 일 자체도 한 단계다: `gameDataLookupOf` 가 스토어가 가진
것 중 **배치에 필요한 셋만** 떼어 낸다 — 실행 입구와 화면(레시피 단계 트리의 대수 계산)이 같은 함수로 넘긴다.

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

- [policy/port.ts](../../../src/autoLayout/module/policy/port.ts) `recordPortPlanStats` *"계측 — 관측만 한다(계산도 분기도 반환값도 안 바꾼다)"*
- [policy/link.ts](../../../src/autoLayout/module/policy/link.ts) `recordEndsAudit`(`endsDisagree`·`endsCoarse`) *"결정은 아직 `ends` 가 한다. 여기서는 두 답을 대조만 한다"*
- `perimeter/types` 의 `ExitDemotion`·`ExitBlocked` *"읽기 전용 계측이라 동작을 안 바꾼다"*
- `emitModule` 의 `netTrips` 안전망

> 2026-09-14 까지 이 목록에 `clusterModule` 의 *"아직 아무 배치도 바꾸지 않는다"*(트렁크 틀의 링크 깊이 항)가 있었다.
> **거짓이었다** — 그 항이 ClusterPipe 깊이를 옮기고 점프를 켠다(계측: 시험 33 · 대조 5). 주석을 사실로 고치고 목록에서 뺐다.

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

500줄 이상 = 12 파일  →  그중 11개가 종류 셋 이상.
        종류 하나뿐인 것은 **하나**다: containerModel 524(타입)

        moduleWizard 913 은 2026-09-13 재분류 — 한 함수(runModulePipeline 714줄) 안에
        어댑터(:150, 조회 9곳) · 정책(:172-290 적격성·폴백) · 장부(:508-560 유체 관망) ·
        조율이 함께 있다.  옛 분류 "조율 하나"는 이 문서 §3 스스로와 어긋났다
        (§3 이 그 파일의 store 조회를 어댑터로 세어 뒀다).  → §7 **D7**
        2026-09-14 D7 해소 뒤: moduleWizard 285 (뼈대 82줄) + planner/run/ 넷 — 500줄 이상 = 10 파일

종류 하나만 담은 파일의 최대 = 335줄 (recipeTree, 셈)
```

> **위 수는 2026-09-12 분류 시점의 것이다.** 2026-09-13 계획 구조-2축 · 2 Step 1 이 module
> 관심사의 타입을 `module/types/` 로 옮긴 뒤 다시 재면(`wc -l`):
>
> ```
> linkPlanner 1037 → 793 · planModulePorts 934 → 900 · link 917 → 790 · clusterModule 611 → 350
> 500줄 이상 = 11 파일 (clusterModule 이 빠졌다).  결정 종류 셋 이상 일곱은 여전히 전부 500줄 이상
> 비테스트 파일 47 → 50  (ioLine 하나가 사라지고 types/ 셋 · arith 하나가 섰다 — 넷 다 종류 하나)
> ```
>
> 표의 분류 칸수(22·11·12·2)는 다시 매기지 않았다 — 파일마다 종류를 판정해야 하는 일이라
> 줄 수처럼 기계적으로 옮겨 적을 수 없다.
>
> **2026-09-14 계획 구조-2축 · 2 Step 3 뒤**(큰 함수 셋을 종류로 가르고 단계로 세웠다):
>
> ```
> 200줄 넘는 함수 = 4   packModuleTree 868 → 53 · planModulePorts 317 → 37 · tryLinkFace 208 → 54 가 빠졌다
>                       남은 넷: planChannelGeometry · searchWithJumps(탐색) · emitOutputLinks · emitInputLinks(D2)
> 500줄 이상 = 8 파일  linkPlanner · planModulePorts · modulePacking 이 빠지고 module/policy/seat 529 가 섰다(종류 하나)
> ```
>
> **2026-09-14 Step 4 뒤**(모듈 하나를 만드는 사슬 — 방출기 셋과 조율자를 단계로):
>
> ```
> 200줄 넘는 함수 = 2   emitOutputLinks 253 → 96 · emitInputLinks 209 → 98 이 빠졌다. 남은 둘 — planChannelGeometry · searchWithJumps(탐색)
>                       (이 줄은 처음에 둘 다 탐색이라 적었다. planChannelGeometry 는 사다리였다 — Step 5 재측정)
> 100줄 넘는 함수 = 11  emitTrunkPipe 174 → 86 · generateModule 176 → 33 이 더 빠졌다
> 500줄 이상 = 8 파일  emitModule 898 → 720 (찍기 하나 — 틀과 길은 module/shape/body 450 으로)
> ```
>
> **2026-09-15 Step 5 뒤**(남은 관심사 파일을 종류로 — 채널 사다리 · 납품 사다리 · 출구 자격):
>
> ```
> 200줄 넘는 함수 = 1   planChannelGeometry 230 → 20 이 빠졌다 — 탐색이 아니었다(탐색은 안의 search 16줄). 남은 하나가 searchWithJumps(탐색)
> 100줄 넘는 함수 = 7   routeDeliveryRoutes 159 → 18 · buildPlannedChain 106 → 97(연속성 검사 두 벌 → 한 벌) · enumerateOptions 130 → 58(자격 → perimeter/shape)이 더 빠졌다
> 500줄 이상 = 7 파일  perimeterExitPlanner 592 → 310(타입 → perimeter/types · 자격 → perimeter/shape) · channelGeometryPlanner 770 → 450(도형 → channel/shape · 정책 → channel/policy) ·
>                      deliveryRoute 717 → 59(link/ 넷으로)가 빠지고 module/shape/body 506 · link/policy 504 가 섰다 — 둘 다 종류 하나, 규칙 3 의 과녁
> ```

**단위는 파일만이 아니다.** 파일을 갈라도 함수가 안 갈라지면 안 읽힌다 —
200줄 넘는 함수가 여덟이고 최대가 `packModuleTree` **868줄** · `runModulePipeline`
**714줄**이다. 60줄 넘는 **중첩** 함수는 셋뿐(최대 87줄)이라, 큰 함수는 작은 함수를
많이 품은 것이 아니라 **본문이 그냥 길다.** 가르는 판정은 **①종류가 바뀌는 곳**(조각이
다른 파일로 간다), 그러고도 한 종류가 크면 **②단계마다 아는 것이 달라지게**(같은 파일
안의 단계로). 붙은 두 블록이 같은 것을 알면 경계가 아니고, ②가 답을 안 주면 안 가른다.
→ 목표 구조의 규칙 넷째(`tempPlanDocs/구조-2축/` §2)

> **그래서 "파일이 크다"는 증상이고 원인은 "종류가 섞였다"이다.** 줄 수 상한을 규칙으로 두는
> 대신 종류를 묻는다 — 500줄이 넘는데 종류가 하나면 그건 정상이다(오늘 실측에서
> 그런 파일은 `containerModel` 하나뿐이다 — 2026-09-14 부터 `module/policy/seat` 가 둘째다. 그 파일은
> 규칙 3(한 종류 300줄 초과 → 폴더)의 과녁이다).
>
> **다만 함수는 다르다.** 종류가 하나라도 한 함수가 700줄이면 읽히지 않는다. 파일에는
> 줄 수 상한을 두지 않고, 함수는 **시점**으로 가른다 — *"단계마다 아는 것이 달라지게"*.
> 무엇을 알아 가는지는 **함수마다 다르다**: `packModuleTree` 는 링크→모양→짝→폭→위치,
> `runModulePipeline` 은 게임데이터→머신 수→배치→경로→최종. 공통인 것은 축이 아니라
> *"한 칸 갈 때마다 모르던 것이 하나 정해진다"* 는 모양이다.

## 6. 아직 안 갈라진 자리 — 탐색

`containerRouting.dijkstraWithJumps` 는 **장부(occupancy)를 읽어 정책(비용)으로 도형(경로)을
고른다.** 셋이 한 함수에 붙어야만 성립하므로 위 여덟로 안 나뉜다.

종류로 세우지 않는 이유는 이 저장소가 탐색을 **줄여 가는 중**이기 때문이다 — 예약 철학이
*"자리를 먼저 잡고 뒤 단계는 탐색 없이 놓기만"* 이고, 런타임 소비처가 납품 사다리의 탐색 칸(`link/policy.routeOneDelivery`) 하나다.
그래서 *"세 종류가 아직 안 갈라진 자리"* 로 표시해 둔다.

**탐색은 한 곳 더 있다** — 채널 기하 장부의 배정 단계(`channelGeometryPlanner.assignSurface`) 안 백트래킹 클로저
`search`(16줄)다. 한때 둘러싼 함수 `planChannelGeometry` 전체를 탐색으로 적었는데 틀렸다 — 바깥은 칸마다 새로 아는 것이
있는 사다리였고, 2026-09-15 에 그 칸들로 갈랐다. 클로저는 같은 질문을 되풀이하므로 자기 단계 안에 그대로 산다.

## 7. 오늘 코드가 개념에 미달한 곳

[docs/CLAUDE.md](../../CLAUDE.md) 의 판정표대로, **문서를 코드에 맞추지 않고 결함으로 적는다.**

| # | 어긋남 | 실물 |
|---|---|---|
| **D8** | **링크 신원 불일치가 난다** — `PackResult.linkMismatches` 주석은 *"정상적으로 있을 수 있는 일이 아니다 … 예약 불변식이 깨진 것"* 이라 적지만, 합성 트리에서 재현된다. **원인 자리: gap 포트 칸이 어느 장부에도 없다** — 방출기의 *"구성상 발생 안 함"* 안전망이 발동해 부모의 입력 줄이 사라지고, 그래서 부모 포트가 안 난다. 어느 벨트가 그 칸을 지나는지는 아직 안 팠다 | 자식 셋이 한 부모를 먹이는 트리(`gadget` ← `widget`·`gear`·`wire`)에서 `n4-wire→n0-gadget:wire#0: no matching parent input port (child emitted, parent didn't)` — 구조-2축 계획 2 의 대조 픽스처가 찾았다(2026-09-14). 같은 날 Step 4 착수 전 계측: `emitInputLinks` 의 구간 안전망(`netTrips`)이 대조 기본 32 픽스처 중 5에서 99회 발동(시험 전체는 0), 발동이 **전부 gap(N/S) 그룹의 포트 칸이 남의 품목 벨트에 막힌 것**이다. `LINK_OPPOSITE_FACE` 에서는 `emitOutputLinks` 의 포트 안전망도 같은 모양으로 발동한다. W/E 포트로는 한 번 겪고 고친 모양이다(module-planning §4.5) |

> **D8 을 고칠 사람에게 — 가장 먼저 볼 곳은 `emitInputLinks` 의 구간 안전망이다.** 대조 기본 32 픽스처에서 99회
> 발동하고(시험 전체는 0) 발동이 전부 gap 포트 칸이다. 구조를 옮기는 일(구조-2축)은 그 수를 **바꾸지 않아야 한다** —
> 덤프의 `netTrips` 가 그 계수기다. 옮긴 뒤 수가 달라졌으면 옮기다가 무언가를 깬 것이다.
>
> **방출 칸을 세는 계측기를 새로 만든다면:** *놓으려 한 칸*과 *실제로 놓은 칸*은 다르다. 입력 방출기는 재사용일 때도
> `path` 를 만든 뒤 **버린다**(`beltCells = reuse ? reuse.beltCells : path.map(…)`). 그 버린 경로를 "쓴 칸" 으로 세면
> 계측기 자신이 틀린다 — 2026-09-12 도형 대조에서 불일치 13칸 중 4칸이 그 착시였다.

> **2026-09-14 에 D2 를 지웠다 — 결함이 아니었다.** **D2**(방출이 고른다 — *"두 면이 다 차면 그 줄을 포기하고, 좌석이
> 막히면 폴백한다"*)는 방출기를 단계로 가른 뒤 §2 의 판정(*"대안이 있었나"*)으로 `unroutedLines.push` 여섯 자리를 다시 봤다.
> **고르는 자리는 0 이다** — 둘은 배정이 없는 그룹을 못 앉은 줄로 **받아 적고**(계획이 좌석을 못 줬고 사유도 계획에 있다),
> 넷은 대안 없이 줄을 내는 **안전망**이다(출력 벨트·포트 칸 · 입력 좌석 · 입력 구간 · 유체 기둥 끊김). 그중 실제로 발동하는
> 둘(입력 구간 · 출력 포트)은 결함이 맞지만 *"고른다"* 가 아니라 **D8 의 원인 자리**다 — 거기로 옮겨 적었다.

> **2026-09-14 에 D7 이 닫혔다.** **D7**(조율자가 조율만 하지 않는다 — `runModulePipeline` 714줄이 게임데이터를
> 읽고 · 트리를 거절하고 · 유체 관망을 쌓고 · 셀을 놓았다)은 게임데이터를 입구에서 한 번 읽어 넘기고, 함수를
> **아는 것이 자라는 여덟 단계**로 가른 뒤 종류를 [planner/run/](../../../src/autoLayout/run/) 넷(`gamedata` ·
> `policy` · `ledger` · `emit`)으로 보내 닫혔다. 뼈대는 82줄이고 게임데이터·issue·셀을 직접 안 만진다. 전 파이프라인
> 대조 픽스처 32개의 결과(issue 순서 · Area · Routing · 실패 그림 · 진단 로그)가 **바이트 단위로 같다.**

> **2026-09-13 에 D4 가 닫혔다.** **D4**(런타임 순환 — `execution/CLAUDE.md` 가 `clusterModule ⇄
> emitModule` 역방향을 *"import type 이라 순환이 아니다"* 라 적었지만 `emitModule` 이 `trunkEndKey`
> 를 런타임으로 가져왔다)는 **소유권 판단은 옳고 주소가 틀린** 경우였다 — 6줄짜리 셈 하나가
> 조율자 파일에 얹혀 있었다. 타입을 [module/types/](../../../src/autoLayout/module/types/) 로,
> `trunkEndKey`·`flowEnd` 를 [module/arith/trunk](../../../src/autoLayout/module/arith/trunk.ts) 로 옮기자
> `autoLayout` 의 런타임 순환이 **1 → 0**, `execution/module → planner/module` 간선이 **2 → 0** 이 됐다.
> 좌표는 픽스처 다섯에서 **바이트 단위로 같다.**

> **2026-09-12 에 넷이 닫혔다.** **D1**(도형이 두 벌)은 [linkShape](../../../src/autoLayout/module/shape/link.ts)
> 로 합쳤고 — 계획의 청구·검사와 방출이 같은 함수에서 답을 받는다(축은 호출자의 것) — 그때
> 낡은 주석 **D3** 도 함께 지웠다. 실측: 4모듈 배치에서 좌표 **차이 없음** · 도형대조 84/84.
> 도형 대조 계측이 **D5**(합류 여부를 계획과 방출이 다른
> 근거로 판정 → 유령 예약 + 조용한 굶주림)와 **D6**(합류 리드의 기둥 밖 세 칸이 어느 장부에도
> 없음)를 찾아냈고 같은 날 고쳤다. 판정 주체를 배정 하나로 모은 결과가 `LinkFacePlan.mergeRole`
> · `sharesBelt` 다.

**방출 안전망에는 계수기가 없는 것이 셋 있다** — 입력 좌석 막힘 · 유체 기둥 끊김 · 점프 칸 막힘(`pipeJumpCells` 의
`continue` 는 그 머신의 점프만 **말없이** 건너뛴다). `netTrips` 를 세는 것은 출력 · 입력의 검사 둘뿐이라, 나머지 셋의
*"구성상 발생 안 함"* 은 발동해도 수로 안 드러난다(2026-09-14 계측에서는 셋 다 대조 0 · 끊김만 시험 2).

## 8. 폴더는 아직 이 축을 안 따른다

**오늘의 폴더 경계는 여전히 [[code-folders]] 가 단일 출처다.** 이 문서는 *"코드가 무슨 종류의
일로 되어 있나"* 만 말하고, 폴더를 다시 그리는 일은 아직 안 했다.

목표 구조(폴더 = 관심사 × 파일 = 종류)와 그 이관 계획은 `tempPlanDocs/구조-2축/` 에 있다.
그 계획이 실행되면 이 문서가 아니라 [[code-folders]] 가 새 트리의 단일 출처가 된다.
