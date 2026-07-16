---
tags: [auto-layout, fluid, module, hop]
aliases: [유체홉, fluid-hop]
---

# 유체 홉 — 자식 유체 출력 → 부모 유체 입력 (새 경로)

> 관련: [[auto-layout-wizard.trunk-pipe]] · [[pipe-semantics]] · [[용어사전]] (ClusterPipe / pipeJumpToClusterPipe)

> **상태(2026-07-16): 메커니즘은 구현됐으나 `현재 도달 불가(dead code)`.** 브라우저 실측에서
> 드러났다 — **레시피 트리가 유체 자식 노드를 만들 수 없어서** 이 코드로 들어오는 입력이 애초에
> 생성되지 않는다(아래 [입구가 막혀 있다](#입구가-막혀-있다-2026-07-16-실측)). 337 green 은
> **합성 트리를 직접 넣어** 나온 결과다. 다-유체는 설계대로 옛 경로 유지.

## 입구가 막혀 있다 (2026-07-16 실측)

`gameDataStore` 가 `itemToRecipe`·`recipesByProduct` 를 만들 때 **유체 산출물을 버린다**:

```js
if (!isRecipeSelectable(r)) continue;   // 개발자용·미해금 레시피 제외 (의도된 필터)
for (const p of r.products) {
  if (p.type !== 'item') continue;      // ← 유체 산출물을 통째로 버린다
```

그래서 `expandIngredient('water')` 는 `itemToRecipe.get('water')` 가 `undefined` 라 **무조건
`external: true`** 가 된다 → **유체는 레시피 트리에서 자식이 될 수 없다** → "자식이 유체를 만들어
부모가 쓰는" 트리가 안 생긴다 → 이 문서의 모든 코드가 실행되지 않는다. `recipeOverrides` 우회도
불가하다(대체 제작법 UI 는 `!isExternal` 일 때만 뜬다).

**필드 점검 결과(실데이터 2661 레시피):** `products.type` 은 `item`(3011)·`fluid`(459) **두 값뿐**이다.
즉 이 줄은 **유체만** 거른다. 의도했던 "개발자용 아이템 제외" 는 바로 위 `isRecipeSelectable`
(`enabled === true || recipeToTech.has(...)`) 이 이미 하고 있다 — 개발자용 아이템도 `type: 'item'`
이라 이 필터를 그냥 통과한다.

**왜 이렇게 됐나:** `itemToRecipe` 의 문서화된 목적은 **머신 기술 추적**(`items_to_place_this[0]` →
레시피 → 기술)이고, 그 용도엔 유체가 필요 없어 배제가 **정당했다**. 문제는 `recipesByProduct` 가
주석에 "**레시피 트리에서** 제작법을 고를 때 후보로 쓴다" 라고 명시돼 있는데도 **같은 루프의 item
필터를 상속**한 것이다. 좁은 전제("머신은 아이템이다")가 조용히 다른 제약("유체는 자식이 될 수
없다")으로 승격됐다. (도입 시점은 `cc9f21f` initial baseline 이라 그 이전 이력은 추적 불가.)

**v1 범위는 실재한다** — 실데이터에서 "유체 입력 0 + 유체 출력 1"(자식 후보) **78개**, "유체 입력 1 +
유체 출력 0"(부모 후보) **313개**, 실제로 이어지는 체인 **77개**. 예: `kr-water-from-atmosphere`
(입력 없음 → water) → `concrete`(water + 아이템 → 콘크리트), 둘 다 정사각형 머신. **범위가 없는 게
아니라 위저드가 그 문을 안 연다.**

**여는 방법(미착수, 설계 필요):** 필터를 그냥 빼면 유체가 **기본 자체 생산**으로 펼쳐져 기존
레이아웃·골든이 광범위하게 바뀐다(concrete 에 물 생산 라인이 자동으로 딸려 붙는다). **유체는 기본
외부 공급을 유지하고 사용자가 토글할 때만 펼치는** 설계가 필요하다.

## 왜 이 문서

유체 트리는 지금 **새 모듈 경로에서 거절 → 옛 경로**로 간다. 옛 경로(`routeFluid`, dijkstra)는
유체 홉을 **이미** 처리한다. 그래서 이 작업은 "불가능을 가능하게"가 아니라 **옛 경로 → 새 경로
이주(parity)**다. 잣대는 하나: **퇴보 0**.

## 불편한 현실 — 유체 레시피는 대부분 다-유체

면은 넷(W/E/N/S)뿐인데 정유는 유체 상자만 5개다(원유+물 → 중유+경유+가스). 게다가 회전은
**모든 상자를 함께 돌린다** — 유체 하나를 한 면에 맞추면 나머지는 프로토타입이 정한 자리로
흩어진다. 그래서 **다-유체는 별개의 큰 문제**이고, v1 에서 열지 않는다.

## v1 범위 (2026-07-15 사용자 승인)

- **모듈당 유체 1줄** — 입력 1 **또는** 출력 1(둘 다는 아직). 다-유체 머신(정유·크래킹·황산·
  화학공장 다중)은 **옛 경로 유지**.
- **이중 면**(한 모듈 유체 in+out 동시)은 v1 밖.
- 덮는 것: "자식이 유체 1개를 만들어 부모가 쓰는 체인"이라는 실재 부분집합.

## 왜 퇴보 함정이 있나 — (a)만 하면 안 된다

- **(a) 유체 출력 반출** = 머신 유체 산출 → 무한파이프(출력 포트).
- **(b) 유체 홉** = 자식 출력 포트 → 부모 입력 포트, pipe-to-pipe.

자식-공급 유체를 새 경로로 끌어오면서 (b)를 안 하면, 출력·입력 포트가 **연결 안 된 무한파이프
두 개**(가짜 물류)가 된다 — 옛 경로는 이어줬으니 퇴보. 그래서 **(a)+(b) 한 몸**. (루트 유체
출력은 부모가 없어 (a)만으로 안전하지만, v1 은 둘을 함께 낸다.)

## 결정 (D1~D5)

| # | 결정 | 근거 |
|---|---|---|
| D1 | **모듈당 유체 1줄** | 다-유체 4면·회전 얽힘은 별도 문제. 단일-유체 체인이 실재 부분집합 |
| D2 | 유체 출력 emit = **기존 ClusterPipe/스파인 재사용** | 파이프 emit 은 role 을 흐름으로만 구분·포트를 infinity-pipe 로 끝냄 → 출력도 대칭. 유일 수정: `fluidboxOffset` 을 **그 줄 역할의 상자** 기준으로 |
| D3 | **`routeFluidHops` 신설**(아이템 홉과 형제) | 파이프는 인서터 없음(좌석 제거 없음)·방향 없음(인접만으로 연결) → 아이템 홉보다 단순. 두 무한파이프를 떼고 pipe 경로로 잇는다 |
| D4 | `chooseMachineDirection` **재사용**(role="output", wantFace="W") | 출력 유체를 부모 쪽(W)에 맞추는 회전을 고름 |
| D5 | planner: 유체 줄 → **그 줄 역할 면**(입력 E / 출력 W = `pipeSide`) | `pipeSide` 가 이미 그 역할 면. 단일 유체라 면 충돌 없음 |

## 이미 되어 있는 것 (재사용)

- **packModuleTree 는 유체 홉 쌍을 이미 만든다** — `pairHopPorts` 는 **이름 기반**이라 유체 포트도
  짝짓는다(HopSpec.item = 유체 이름). `hopSeeds.eligible`(out W · in E)도 그대로 맞는다.
- **유체 포트 식별** = `port.chest.kind === "infinity-pipe"`.
- **합류 가드** = `collectPipeFlow`/`PipeFlow`(다른 유체 hard, 같은 유체 허용). 홉 경로도 이걸 장애물로.
- **점프 emit**(fluidboxPipeCell/ClusterPipeTapCell)은 role-무관 기하라 출력도 그대로.

## 구현 지점

1. `moduleWizard` 적격성: 유체 1줄(in/out) 허용, 2줄+ 거절(다-유체), 출력이면 side=W·출력 상자·
   role=output, **자식-공급 유체 입력 거절 제거**(이제 홉이 잇는다).
2. `routeModuleHops` 호출부: 홉을 **아이템/유체로 가른다**. 유체 홉은 `routeFluidHops` 로 —
   두 무한파이프(자식 출력 sink + 부모 입력 source)를 떼고 자식 ClusterPipe 끝 → 부모 ClusterPipe
   끝을 파이프 경로(dijkstra+점프, pipe 셀)로 잇는다. 장애물 = occupancy + 다른-유체 hard 셀.
3. `clusterModule` emit: 변경 최소 — `fluidboxOffset` 이 그 줄 역할의 상자를 가리키게만.
4. **합류 가드 정정**(구현 중 발견) — `collectPipeFlow` 이 출력 상자를 "무조건 hard"로 막아서
   유체 출력 모듈이 **자기 소스에서 거절**당했다. 정정: **이 유체를 내는 출력 상자는 허용**(소스,
   같은 유체 병합 무해), **다른 유체 출력만 hard**. `recipeFluids.products` 로 판별.
5. `routeModuleHops` 는 유체 홉이면 `pipeFlowConflict` 로 걸러진 **다른-유체 hard 셀**을 장애물로
   받아 다른 유체에 안 닿게 한다(moduleWizard 가 `fluidBlocked` 로 넘김).

## 이미 되어 있던 것 (재사용, 구현 중 확인)

- **유체 반출**(루트 유체 출력 → 외곽/무한파이프)은 `modulePerimeterPass` 가 이미 처리한다
  (`isFluid`·`layPipePath`·파이프 가드). 적격성 게이트만 열면 그 경로로 흐른다.

## v1 이 빼는 것 (옛 경로 유지)

- 다-유체 머신(정유·크래킹·황산·화학공장 다중).
- 이중 면(한 모듈 유체 in+out 동시).
- 유체 Parallel/MixedItem.
- 지하 파이프 일반 라우팅(홉은 pipeJumpToClusterPipe 한 모양뿐).
