---
tags: [auto-layout, placement, module]
---

> **부모 문서:** [wizard.md](../wizard.md)
> **관련 문서:** [[machine-link]] — 링크가 *무엇인가* · [[trunk-redesign]] — 탭 인서팅 판정의 내용 ·
> [[trunk-pipe]] — 유체 줄이 끼어드는 지점 · [[code-folders]] — 이 계층이 어느 폴더인가

# 모듈 안쪽 계획 — 자리를 정하는 주체는 하나다

> **이 문서를 읽어야 하는 때**
> - `planner/module/planModulePorts.ts` · `linkPlanner.ts` · `clusterPortPlanner.ts` 를 수정할 때
> - `module/clusterModule.generateModule` 의 **순서**를 바꾸고 싶을 때
> - `ModulePortPlan` · `rest.ok` · `slotIndex` · `rowGaps` 를 건드릴 때
> - 링크 포트가 **통째로 사라지는** 증상을 조사할 때
> - *"여기서 자리를 좀 더 찾아보면 되지 않나"* 라는 생각이 들 때 → **§1 을 먼저 읽을 것**

## 0. 한 줄 요약

한 모듈의 **모든 자리 배정은 `planModulePorts` 한 함수 안에서, 좌표가 생기기 전에** 끝난다.
그 뒤 `generateModule` 이 하는 일은 좌표를 **더하는 것**과 셀을 **놓는 것**뿐이다 — 탐색이 없다.

## 1. 문제 — 주체가 둘이면 조율이 흩어진다

예약 철학은 *"큰 그림을 보는 **주체 하나**가 먼저 자리를 잡고, 뒤 단계는 탐색 없이 놓기만
한다"* 이다. 그런데 그 주체가 오랫동안 **둘**이었다:

| 주체 | 무엇을 배정 | 어디에 있었나 |
|---|---|---|
| 링크 면 배정 | 자식↔부모 [[machine-link\|링크]]가 앉을 면·줄 | `clusterModule` 안 |
| [[용어사전#insertingPlanner\|insertingPlanner]] | 나머지 줄(원료·완제품)이 앉을 면·레인 | `clusterPortPlanner` |

둘이 **같은 좌석을 놓고 다투므로** 손으로 조율해야 했다 — 링크 줄을 planner 입력에서 빼고,
링크가 먹은 행을 통보하고, 방출 순서까지 맞췄다. 조율이 코드 여기저기 흩어져 있으니
다음 버그가 났다:

> **순서 버그 (2026-07-21 실측).** *나머지 줄*의 tap/direct 판정이 `!plan.ok` 라는 이름으로
> 링크 방출보다 **앞**에 있었다. 그래서 **링크와 무관한 판정**이, 이미 성공해서 `layoutCluster`
> 에까지 반영된 링크 예약을 **시도조차 안 하고 통째로 버렸다.**

이건 "실수"가 아니라 **구조가 부른 것**이다. `plan` 이 *모듈 전체*를 뜻하는지 *나머지 줄*을
뜻하는지 이름으로 알 수 없었고, 그걸 알려면 두 주체의 관계를 머릿속에 들고 있어야 했다.

## 2. 어떻게 하나 — 제약이 센 쪽부터, 한 함수 안에서

```
planModulePorts(input, count)              ← 좌표가 없다
  ① 링크 면 배정      allocateLinkFaces ×2 → spillLinkFacesToGap ×2
  ② 유체 줄 조립      pipePlanned · isJumpableToClusterPipe
  ③ 나머지 줄 배정    insertingPlanner
  ④ gap 폭 산출       gapRowsFromPlans
  → ModulePortPlan

generateModule
  layoutCluster(plan.rowGaps) → machines   ← 좌표가 여기서 생긴다
  placeLinkSeats(machines, plan.linkFaces) ← 덧셈뿐
  emit*(...)                                ← 방출
```

**순서는 취향이 아니라 제약의 세기다(스도쿠 원칙).**

| 단계 | 왜 이 자리인가 |
|---|---|
| ① 링크 | **자기 기하를 스스로 갖는다** — 가장 덜 자유롭다. 나중에 앉히면 남이 이미 자리를 먹었다 |
| ② 유체 | **면을 우리가 못 고른다** — 머신 `fluid_boxes` 가 강제한다([[trunk-pipe]]). 고를 수 없는 것이 고를 수 있는 것보다 먼저다 |
| ③ 나머지 | ①②가 **남긴 예산** 안에서 고른다. 여기만 진짜 선택지가 있다 |
| ④ gap 폭 | 우리가 정하는 값이 아니라 **①의 부산물**이다 |

### 왜 ④가 마지막인데 좌표보다 먼저인가 — 닭과 달걀

gap 으로 넘어간 링크는 gap 안에 **가로 벨트**를 놓는다. 그래서
**gap 폭 = 그 gap 을 지나는 가로 벨트 수**다. 그런데 그 폭이 다시 **머신 좌표를 정한다**
(`layoutCluster` 가 머신 사이를 그만큼 벌린다).

폭이 좌표를 정하고, 폭은 배정의 부산물이다 → **배정이 좌표보다 먼저여야 한다.**
이것이 계획 전체가 좌표 없이 도는 이유다.

## 3. 좌표의 경계 — 계획은 순번까지 낸다

[`ModulePortPlan`](../../../src/autoLayout/planner/module/planModulePorts.ts) 에는
**좌표가 하나도 없다.** 링크가 쓸 자리도 *"면에서 몇 번째 칸"* 까지 계획이 끝낸다
(`LinkFacePlan.slotIndex` — 채우는 **방향**까지 거기서 정해진다).

```ts
// 좌표 단계가 하는 일 전부
const t = (isGap ? m.origin.x : m.origin.y) + slotIndex;
```

> **왜 순번까지 계획이 내나.** 예전엔 좌표 단계가 `placeLedger` 라는 **빈 장부를 새로 만들어**
> 배정이 이미 센 누적을 처음부터 다시 셌다. 같은 사실을 두 주체가 두 번 계산하면 언젠가
> 어긋난다. 지금은 장부가 배정 쪽에만 있고, 좌표 단계는 **덧셈 한 줄**이다.

## 4. 실패는 줄별로 담긴다 — `rest`

```ts
rest: { ok: true;  lines: PlannedLine[] }      // 나머지 줄의 배정
    | { ok: false; unplaced: IoLine[] }        // 못 놓은 줄들
```

이름이 요점이다. **`rest` = 링크가 아닌 줄**이고, **링크의 성패는 여기 없다** — 링크는 자기
방출에서 갈린다. 성공과 실패가 **서로 다른 자료**를 들고 있어, 방출기가 실패를 확인하지 않고
배정을 꺼내는 것이 타입으로 막힌다.

§1 의 순서 버그는 이 이름이 `!plan.ok` 였기 때문에 났다. **지금은 그 착각이 생길 자리가 없다.**

## 5. 남는 비대칭 — 정직하게

통합했지만 **장부는 여전히 둘**이다. 합치려다 못 합쳤고, 그 이유가 중요하다:

| 장부 | 열쇠 | 낟알 |
|---|---|---|
| 링크 면 배정 | `seatKey(머신, 면)` | **머신마다** |
| `insertingPlanner` | `PlannedSide` | **면마다** |

`insertingPlanner` 는 *"클러스터의 모든 머신이 같은 슬롯을 쓴다"* 를 전제로 한다 — 벨트 한 줄이
머신 여럿을 훑는 [[용어사전#탭 인서팅 (Tap Inserting)|탭 인서팅]]이 그 모델 위에 서 있다.
Map 을 그대로 넘기려면 그 모델을 뒤집어야 하므로 **하지 않았다.**

대신 `seatRowsByFace` 가 머신 축을 `max` 로 접어 낟알 차이를 흡수한다. 같은 이유로
`linkedKeys`(링크 줄을 ③ 입력에서 빼는 필터)도 남는다 — 이건 예산 조율이 아니라
*"이 줄은 자기 기하를 따로 갖는다"* 는 **사실**이다.

> **그래서 통합이 산 것은 "장부 하나"가 아니라 "주체 하나"다.** 둘 다
> `planModulePorts` 안으로 들어와, 계층을 건너는 **통보**가 아니라 한 함수 안의
> ①→③ **전달**이 됐다. 순서 버그가 날 자리는 그것만으로 사라진다.

### 배분기를 완전히 합치지 않은 이유 (2026-08-05)

2026-08-05 의 공급 모델 통합은 **원료·완제품 줄을 기계별 그룹으로 쪼개** 링크 배분기
(`allocateLinkFaces`)에 태웠다. 그 덕에 gap 스필·`emitOutputLinks`·`emitInputLinks` 를 그대로
물려받았고, 전용 방출기 `emitDirectInserting` 은 호출자가 0이 되어 사라졌다.

**남은 절반 — [[용어사전#탭 인서팅 (Tap Inserting)|탭 인서팅]](공유 벨트)은 아직 자기 배분기를
쓴다.** 착수해 보니 두 배분기가 다른 것은 그룹 개수만이 아니었다:

| | 링크 배분기 | 탭 배분기 |
|---|---|---|
| 벨트 깊이 | 상수 `LINK_LANE_DEPTH = 2` | reach 로 유도(`1+r`, [[용어사전#케이스 B (파이프 넘김 레인)\|케이스 B]]는 `2+r`) |
| 한 면의 줄 수 | 좌석 칸 수(그룹마다 자기 행) | **reach 종류 수** |
| 같은 면 둘째 줄 | `exitDepth` 로 한 칸 더 깊게([[용어사전#ParallelBelt\|ParallelBelt]]) | 수요 순 depth 재배정 |
| 유체 면 | 통째로 비켜 준다(`pipeSides`) | 케이스 B 로 깎아서 쓴다 |
| stagger·ClusterPipe 깊이 | 개념 없음 | `buildTrunkContext` 가 함께 본다 |

즉 남은 통합은 **링크 배분기에 탭 모델 전체를 가르치는 일**이고, 합격 기준이 *"공유 벨트
트리의 좌표가 한 칸도 안 바뀐다"* 라 **관측 가능한 이득 0 · 회귀 위험 전부**다. 통합의 실질
(같은 자료·같은 방출기·gap 스필)은 이미 얻었고 남은 것은 형식이므로 **하지 않았다.**

다음 중 하나가 생기면 그때가 착수 시점이다:
- 탭 경로에도 gap 이 필요해질 때(= 공유 벨트가 W/E 를 다 쓰는 레시피가 실물로 나올 때),
- 링크 벨트가 긴팔 레인(d3)을 써야 할 때 — 그때 `LINK_LANE_DEPTH` 상수가 어차피 깨진다.

#### 자료구조부터 합치는 길은 없다 (2026-08-08 검토)

*"로직은 놔두고 `LinkFacePlan` 을 확장해 탭까지 담는 타입 하나로 만들면 되지 않나"* 는
제안이 자연스럽게 나온다. **기각했다.** `undefined` 개수는 문제가 아니었고(겹치는 필드를
접으면 10개 중 3개씩, 견딜 만하다) 진짜 위험은 셋이다:

| # | 위험 | 왜 나쁜가 |
|---|---|---|
| ① | `laneDepth` ↔ `clusterBeltDepth` 가 **다른 뜻**이 된다 | 링크는 좌석이 언제나 d1, 탭은 케이스 B 면 d2. 한 필드가 그 전제를 하는 코드와 안 하는 코드 양쪽에서 읽힌다 |
| ② | **낟알이 다른데 타입이 같아진다** | `LinkFacePlan` 하나 = 기계 하나, `PlannedLine` 하나 = 줄 하나(전 기계). 가르는 건 `arms.size` 뿐인데 타입에 안 나타난다 |
| ③ | `undefined` 의 두 뜻이 겹친다 | `requiredInserterCount === undefined` 는 이미 *"수량 미상 = 판정 보류"* 다. 여기에 *"탭엔 개념이 없다"* 를 섞으면 [[용어사전#InsertingDecisionResult\|InsertingDecisionResult]] 에서 판별 유니온으로 갈랐던 실수를 되풀이한다 |

`undefined` 는 타입이 잡아 주지만 **의미 충돌은 안 잡아 준다.** 판별 유니온으로 쓰면 셋 다
막히지만 그건 *이름만 하나*고 실제로는 여전히 둘이다.

> **순서가 반대다 — 자료구조 통합은 로직 통합의 *결과*이지 *수단*이 아니다.**
> 2026-08-05 통합이 이미 증명했다: 자료구조를 먼저 합치지 않고 **그룹 낟알을 바꿔
> (`perMachine`) 같은 배분기를 태웠더니** 자료구조가 저절로 하나가 됐다.

#### 두 갈래 길 — 왜 A 가 함정인가 (2026-08-09 정리)

비슷한 일을 하는 코드가 두 벌일 때 합치는 길이 둘이다.

| | 한 일 | 결과 |
|---|---|---|
| **길 A — 자료구조부터** | 타입 둘을 하나로 합친다 | 두 로직이 **각자 자기 필드만** 채운다. 빈칸이 절반이고 **일은 여전히 둘**. 게다가 어느 필드가 어느 경우에 유효한지가 타입에 안 나타난다 |
| **길 B — 로직부터** | 한쪽이 다른 쪽 일도 하게 만든다 | 한쪽이 **호출자 0이 되어 죽고**, 그 로직만 쓰던 타입도 **같이 죽는다** |

**핵심은 이것이다 — 자료구조가 "합쳐진" 게 아니라 한쪽이 "사라졌다".**
두 자료구조가 있는 건 **증상**이고 원인은 **로직이 둘인 것**이다. 원인을 없애면 증상은 따라 죽지만, 증상만 건드리면 원인은 그대로 남고 타입이 더 나빠진다.

2026-08-05 의 실제 경로:

```
전:  원료·완제품 → IoLine → planClusterPorts(rim) → PlannedLine → emitDirectInserting
     내부 링크   → MachineLinkGroup → allocateLinkFaces → LinkFacePlan → emitOutputLinks

한 일:  자료구조를 한 글자도 안 건드리고 **입력의 낟알만** 바꿨다
        externalLineGroups(…, { perMachine: true })
        → 줄 하나(머신 3대 담당) → 그룹 3개(각 머신 1대 담당)
        → tryLinkFace 의 `arms.size !== 1` 문턱을 통과
        → **기존 배분기가 그냥 받아들였다**

후:  둘 다 → MachineLinkGroup → allocateLinkFaces → LinkFacePlan → emitOutputLinks
     그리고 rim 모드 · PlannedLine 의 그 용법 · emitDirectInserting 이 **호출자 0 → 삭제**
```

**새 추상화를 만든 것이 아니라, 기존 추상화가 받아들일 수 있는 모양으로 입력을 바꿨다.**
`perMachine` 플래그 하나가 한 일이 그것이다. → [[용어사전#낟알 (granularity)]]

다만 *"링크 쪽을 확장한다"* 는 **방향은 맞다.** 넣어야 할 것(`reach` · 가변 `laneDepth` ·
케이스 B 의 좌석 깊이)이 정확히 위 표의 차이들이므로, 이 제안은 **"링크 벨트에 탭 깊이
모델을 가르치는 일을 먼저 하자"와 같은 말**이다. 그게 되기 전엔 순서가 뒤집힌 작업이다.

### 떠난 쪽을 치웠다 (2026-08-06)

통합이 다이렉트 배정을 옮겨 간 뒤 **`insertingPlanner` 는 그 시절 모양을 하고 있었다.** 동작을
바꾸지 않고 자국만 걷어냈다:

| 무엇 | 어떻게 |
|---|---|
| 다이렉트가 `plan: {ok:true, lines:[]}` 를 달고 나갔다 | [[용어사전#InsertingDecisionResult\|InsertingDecisionResult]] 를 **판별 유니온**으로 — 다이렉트 가지에 `plan` 이 없다 |
| `PortPlannerInput.slotsPerFace` 를 아무도 안 읽었다 | 삭제. `insertingPlanner` 가 좌석 행을 **자기 인자**로 받는다 |
| 끝의 좌석 예산 재검이 **구성상 안 걸렸다** | 삭제. 예산을 배정 시점보다 후하게 잡아(`seatRowsUsed` 미차감) 틀려도 못 잡는 그물이었다 |

### 남긴 것 하나 — `rowsPerFace` 의 `max(W, E)`

`clusterPortPlanner` 613줄. **껍데기가 아니라 살아 있는 탭 로직의 결함**이라 위 정리에서 뺐다.

```ts
const linkUsedWE = Math.max(seatRowsUsed.W ?? 0, seatRowsUsed.E ?? 0);  // 더 붐비는 면 기준
const rowsPerFace = Math.max(1, seatRows.WE - linkUsedWE);              // 면 구분 없이 한 수
```

이 수는 검사용이 아니라 **`placementsOf` → `capOf` 로 들어가 배정 개수와 팔 분할을 정한다.**
배정 하나 = 벨트 한 줄 + 포트 하나이므로, 부풀면 **필요 없는 벨트·포트가 생기고** 심하면
`lanes-exceed-capacity` 로 모듈이 통째로 기계별 포트로 물러난다.

> 7×7 머신 · 링크가 W에 3행·E에 0행 · 원료 `x` 가 팔 6개. `rowsPerFace = 7−3 = 4` 라
> `ceil(6/4) = 2` 배정. 그런데 `x` 는 실제로 **E에 앉고 거기엔 7행이 통째로 비어 있다** → 1이 옳다.
> 비대칭은 예외가 아니다 — 출력 링크는 W, 입력 링크는 E 를 선호하므로 한쪽에만 링크가 있는
> 모듈이면 자동으로 어긋난다.

**왜 이렇게 짜여 있나 — 닭과 달걀.** `placementsOf` 는 `planClusterPorts` **보다 먼저** 불리고,
그 시점엔 이 줄이 어느 면에 앉을지 아직 안 정해졌다(면을 정하는 게 `planClusterPorts` 다).
그래서 면을 모르는 채 답해야 한다. 주석의 *"보수적"* 은 **절반만 맞다**: 좌석 축에서는
안전하지만(잘게 쪼개면 각각 더 쉽게 앉는다) **벨트 레인 축에서는 위험하다**(슬롯을 더 먹는다).

**세 갈래 — 어느 쪽도 우월하지 않다:**

| | 무엇 | 얻는 것 ↔ 잃는 것 |
|---|---|---|
| 낙관 | `max` → `min`(제일 빈 면 기준) | 필요 없는 벨트·포트가 사라진다 ↔ 배정이 커져 **면을 넘나들며 나눠 앉는 능력**을 잃는다(`insertingPlanner.test.ts` ⑤가 지키는 동작) |
| 현상 유지 | 주석만 정직하게 | 좌표 불변 ↔ 손해가 남는다 |
| 근치 | 배정 수 산정을 `planClusterPorts` 안으로 | 추측이 사라진다 ↔ 순환을 풀어야 한다(**배정 수를 알아야 슬롯을 뽑고, 면을 알아야 배정 수를 안다**) |

**착수 시 첫 항목은 구현이 아니라 실측이다** — *"두 면의 `seatRowsUsed` 가 다른 모듈이 몇
개이고, 그중 배정 수가 실제로 바뀌는 것이 몇 건인가."* 지금 아는 것은 메커니즘뿐이고 실물
트리의 빈도는 안 세어 봤다. 0에 가까우면 현상 유지로 끝이고, 유의미하면 낙관(싸다)과
근치(옳다) 중에 고른다.

### 또 하나의 비대칭 — 확정 **시점** (2026-08-08)

위의 것들이 *"장부를 어느 낟알로 세나"* 라면 이건 *"답이 언제 정해지나"* 다. 둘은 다른
비대칭이고, 서로 유도되지 않는다.

셀 하나의 좌표를 확정하려면 아홉 가지 질문에 답해야 한다. 좌석은 언제나 면 바깥 1칸,
벨트는 그 너머다:

```
   깊이  3     2     1     0
       [벨트][인서터][기 계]        ← 기본(reach 1)
       [벨트]      [인서터][기 계]  ← 긴팔(reach 2) — 벨트 깊이 = 1 + reach
```

**링크·다이렉트는 아홉을 전부 `planModulePorts` 에서 답한다. 탭은 다섯만 답하고 넷을
방출기가 다시 유도한다.**

| # | 질문 | 링크 · 다이렉트 | 탭 |
|---|---|---|---|
| 1 | 어느 면 | `LinkFacePlan.face` | `PlannedLine.side` |
| 2 | 어느 기계 | `arms` 의 **키** | **없음**(전 기계 암묵) |
| 3 | 팔 개수 | `arms` 의 **값** | `groupOf[key]` 조회 ∥ `requiredInserterCount` |
| 4 | 면 위 몇 번째 칸 | `slotIndex` | ⚠ `slotOnFace` — **방출 시점 누적** |
| 5 | 벨트 깊이 | `laneDepth` = 상수 2 | `clusterBeltDepth` → ⚠ `emitDepthOf()` 보정 |
| 6 | 팔 길이 | 개념 없음(항상 1) | `reach` |
| 7 | 벨트 종류 | 개념 없음(기본값) | `beltEntityName` |
| 8 | 벨트 끝 | `exitDepth`(gap 전용) | ⚠ `maxDepthAtEnd` + `lineEnds` → stagger |
| 9 | 유체 행 회피 | `pipeSides` — 면 통째 배제 | ⚠ `skipRows`/`remapRow` — **방출 시점** |

⚠ = 계획에 없고 방출기가 만든다.

**⚠ 넷이 방출에 있는 자리와 그 대가:**

| # | 어디 | 왜 거기 있나 | 대가 |
|---|---|---|---|
| 4 | `emitTapInserting.slotOnFace` | 탭 장부가 **면 단위**라 기계별 순번을 못 낸다 | **같은 수를 두 곳이 센다** |
| 5 | `buildTrunkContext.emitDepthOf` | `pipeJumpMode` 가 좌표 단계에 있다 | 계획이 자기가 정한 깊이의 최종값을 모른다 |
| 8 | `buildTrunkContext.maxDepthAtEnd` | 같은 면·같은 끝을 전부 훑어야 나온다 | 배정이 stagger 를 예측하지 못한다 |
| 9 | `emitTapInserting.skipRows` | 유체 상자 행 번호를 계획이 안 읽는다 | `commitLinkFace` 와 **같은 산술이 두 벌** |

축 4의 대가가 실물로 드러난 자리가 [`emitModule`](../../../src/autoLayout/execution/module/emitModule.ts)
의 좌석 초과 방어다 — 스스로 *"planner 용량과 어긋난 것(안전망)"* 이라 적고 있다. 링크에는
그런 방어가 없다: 세는 곳이 하나뿐이라 어긋날 데가 없기 때문이다. 2026-08-06 에 지운
`insertingPlanner` 끝의 좌석 예산 재검도 같은 뿌리였다 — 두 곳이 유도한 값을 세 번째 곳이
검사하려 했는데, 그 그물이 배정보다 후해서 **틀려도 못 잡았다.**

> **새 필드를 만들 때의 판정:** 이 축을 **계획이 답하는가 방출이 답하는가.**
> 방출이면 *왜 계획이 못 답하는지* 를 함께 적는다.

**넷을 계획으로 옮길지는 정하지 않았다.** 조사해 보니 넷 다 좌표를 안 본다 —
`buildTrunkContext` 가 `machines` 를 받는 유일한 이유는 `ext` 이고, ⚠ 넷 중 `ext` 를 쓰는
것은 하나도 없다. 즉 방출에 있는 이유는 **좌표가 필요해서가 아니라 역사적 순서**다.
그렇다고 옮겨야 한다는 뜻은 아니다: 축 4를 옮기는 것은 **탭 장부의 낟알 변경**이고,
그건 위 [[#배분기를 완전히 합치지 않은 이유 (2026-08-05)|남은 통합]]과 같은 작업이다.

**착수 시점은 위 안전망이 실제로 발동할 때다.** 발동은 곧 축 4를 두 곳이 유도한 결과가
갈렸다는 증거다. 지금까지 발동 기록은 없다.

## 6. 구현 위치

| 단계 | 파일 | 심볼 |
|---|---|---|
| 진입점 | `planner/module/planModulePorts.ts` | `planModulePorts` · `ModulePortPlan` |
| ① 링크 면 | `planner/module/linkPlanner.ts` | `allocateLinkFaces` · `spillLinkFacesToGap` · `commitLinkFace` · `gapRowsFromPlans` · `gapExitSidesFromPlans` |
| ③ 나머지 줄 | `planner/module/clusterPortPlanner.ts` | `insertingPlanner` · `planClusterPorts` |
| 좌표 입히기 | `module/clusterModule.ts` | `placeLinkSeats` (덧셈만) |
| 방출 | `execution/module/emitModule.ts` | `emitOutputLinks` · `emitInputLinks` · `emitTapInserting` · `emitTrunkPipe` |

## 7. 함정

**"여기서 자리를 좀 더 찾아보면"** — 방출 단계에는 **탐색이 없어야 한다.** 자리가 없으면
만들어 내지 말고 `unroutedLines` 로 정직하게 실패시킨다. 방출기가 자리를 고르기 시작하면
계획이 두 곳으로 갈리고, §1 의 버그가 다른 얼굴로 돌아온다.

**팔 개수는 협상 대상이 아니다.** 레시피·머신·인서터가 정하는 물리량이라, 자리가 모자란다고
줄여 놓으면 **머신이 조용히 굶는다**(2026-07-16 실측: 초당 8개를 먹는 머신에 0.667개짜리
인서터 하나). 못 놓는다고 말하는 쪽이 맞다.

**gap 스필은 유체 면과 자리를 다툰다.** gap 벨트는 옆면으로 빠져나가고(출력=서, 입력=동),
그 포트 끝이 d1·d2 를 먹는다 — 그 면에 유체가 있으면 파이프가 **점프해야** 한다
([[용어사전#pipeJumpMode|pipeJumpMode]] ④). 두 배정이 서로를 안 보고 자란 자리라
`beltMaxOn` 같은 "그 면에 벨트가 있나" 식 대리 신호는 여기서 늘 0을 답한다.

**테스트가 통과해도 그 분기를 안 지났을 수 있다.** `packModuleTree` 경로는 rate 조건이 안
맞으면 링크를 **아예 안 만든다**(포트의 `linkId` 가 전부 비어 있으면 그 신호다). 링크 배정을
바꿨다면 `generateModule` 에 링크 그룹을 직접 넣은 시나리오로 확인한다 — 2026-08-02 에
448개가 전부 통과하는데 바꾼 분기는 한 번도 안 지나는 상황이 실제로 있었다.
