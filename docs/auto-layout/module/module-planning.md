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

[`ModulePortPlan`](../../../frontend/src/autoLayout/planner/module/planModulePorts.ts) 에는
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

## 6. 구현 위치

| 단계 | 파일 | 심볼 |
|---|---|---|
| 진입점 | `planner/module/planModulePorts.ts` | `planModulePorts` · `ModulePortPlan` |
| ① 링크 면 | `planner/module/linkPlanner.ts` | `allocateLinkFaces` · `spillLinkFacesToGap` · `commitLinkFace` · `gapRowsFromPlans` |
| ③ 나머지 줄 | `planner/module/clusterPortPlanner.ts` | `insertingPlanner` · `planClusterPorts` |
| 좌표 입히기 | `module/clusterModule.ts` | `placeLinkSeats` (덧셈만) |
| 방출 | `execution/module/emitModule.ts` | `emitOutputLinks` · `emitInputLinks` · `emitTapInserting` · `emitTrunkPipe` · `emitDirectInserting` |

## 7. 함정

**"여기서 자리를 좀 더 찾아보면"** — 방출 단계에는 **탐색이 없어야 한다.** 자리가 없으면
만들어 내지 말고 `unroutedLines` 로 정직하게 실패시킨다. 방출기가 자리를 고르기 시작하면
계획이 두 곳으로 갈리고, §1 의 버그가 다른 얼굴로 돌아온다.

**팔 개수는 협상 대상이 아니다.** 레시피·머신·인서터가 정하는 물리량이라, 자리가 모자란다고
줄여 놓으면 **머신이 조용히 굶는다**(2026-07-16 실측: 초당 8개를 먹는 머신에 0.667개짜리
인서터 하나). 못 놓는다고 말하는 쪽이 맞다.

**테스트가 통과해도 그 분기를 안 지났을 수 있다.** `packModuleTree` 경로는 rate 조건이 안
맞으면 링크를 **아예 안 만든다**(포트의 `linkId` 가 전부 비어 있으면 그 신호다). 링크 배정을
바꿨다면 `generateModule` 에 링크 그룹을 직접 넣은 시나리오로 확인한다 — 2026-08-02 에
448개가 전부 통과하는데 바꾼 분기는 한 번도 안 지나는 상황이 실제로 있었다.
