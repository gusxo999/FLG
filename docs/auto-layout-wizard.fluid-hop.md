---
tags: [auto-layout, fluid, module, hop]
aliases: [유체홉, fluid-hop]
---

# 유체 홉 — 자식 유체 출력 → 부모 유체 입력 (새 경로)

> 관련: [[auto-layout-wizard.trunk-pipe]] · [[pipe-semantics]] · [[용어사전]] (ClusterPipe / pipeJumpToClusterPipe)

> **상태(2026-07-16): 실측 성공 — 살아서 동작한다.** `wood ← water` 체인으로 확인:
> **`S-LAYER(module) · 2 노드 · 1 홉 · 실패 0`**, 홉 셀은 `pipe`(벨트 아님). 그 전까지 모든
> 성공은 `0 홉` 이었다. 다-유체는 설계대로 옛 경로 유지.

> ## ⚠️ 그 뒤 링크 모델이 이걸 깨뜨렸다 — 그리고 고쳤다 (2026-07-26)
>
> 위 성공은 **링크 모델(2026-07-21~22) 도입 이전**이다. 링크가 들어오면서 유체 홉이
> 조용히 죽었고, 오늘 브라우저 실측으로 드러났다. 원인은 둘:
>
> - **자식→부모 링크에 유체 가드가 없었다.** `externalLineGroups` 에는 있는
>   `if (line.kind !== "belt") continue` 가 `edgeLinkGroups` 에는 없어서, 유체 링크가
>   인서터 팔을 배정받고(`water: 벨트 1줄, 줄당 팔 3`) `linkedKeys` 에 실려 **아이템
>   방출기**로 갔다. 트렁크 파이프 경로를 통째로 건너뛰니 유체 포트가 안 생기고, 포트가
>   없으니 홉도 없다. 게다가 가짜 팔 배정이 홉을 여러 개로 쪼개 서로 막아
>   `fluid-unplannable` 까지 냈다 — 그 거절은 **원인이 아니라 증상**이었다.
> - **`productOf` 가 첫 출력 라인만 봤다.** 다산출 자식(`barrel + sulfuric-acid`)에서
>   부산물이 잡혀 부모와 짝이 안 맞았다. 그러면 자식의 유체 출력과 부모의 유체 입력이
>   **각각 외부 무한파이프**로 떨어진다. 실측에선 그 둘이 나란히 붙어 한 관망이 됐다 —
>   `at-least 1`(항상 가득)과 `at-most 0`(항상 비움)이 같은 네트워크에.
>
> **수정 후 실측**(실게임데이터, K2+SE):
>
> | 체인 | 전 | 후 |
> |---|---|---|
> | `concrete ← kr-water-from-atmosphere` | `[fluid-unplannable] water ×2` | **1 홉**, 파이프 22칸 한 관망이 두 머신에 접함, 무한파이프 0 |
> | `battery ← empty-sulfuric-acid-barrel` | 후보는 나오나 **0 홉** + 모순된 무한파이프 2개 | **1 홉**, 20칸 한 관망, 무한파이프 0 |
>
> 회귀 테스트: `planner/modulePacking.fluidLink.test.ts`.
>
> **유체 홉을 볼 레시피 고르는 법** — 자식이 유체를 *소비하지 않고* 생산해야 한다.
> `sulfuric-acid`(물 넣고 산 뽑기)는 유체 2개라 `multi-fluid` 로 먼저 걸린다. 이 조건을
> 만족하는 (부모, 자식) 쌍은 K2+SE 기준 **1038개** 있다(배럴 비우기·얼음 녹이기 등).

## 실측 (2026-07-16)

**쓴 체인 — 이보다 단순할 수 없다:**
- **부모 `wood`** — 재료가 **`fluid:water` 하나뿐**(좌석 여유), 머신 `kr-greenhouse` 7×7 정사각형.
- **자식 `kr-water-from-atmosphere`** — **재료 없음**, 물만 낸다. `kr-atmospheric-condenser` 5×5.

**결과:** `S-LAYER(module)`(= 옛 경로 폴백이 아님) · **1 홉** · 실패 0. 홉 셀 클릭 → `pipe`.

**부적합했던 레시피 — `concrete`:** 입력이 4종(+출력 1)이라 3×3 좌석에 안 맞는다.
`seats: W 4탭 > 3행`, 덤프도 `beltDemand 4 + pipeDemand 1 = 5 > columnCapacity 4`.
**유체와 무관한 한계**(기둥 탭 용량 초과 = 2D 클러스터 미구현). 유체 홉을 볼 땐 **입력이 적은
부모**를 골라야 한다.

## 입구가 막혀 있었다 (2026-07-16, 해결됨)

> **아래는 해결된 문제의 기록이다.** 원인과 함정이 재발 방지에 쓸모 있어 남긴다.

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

**어떻게 열었나(2026-07-16 해결):** `p.type !== 'item'` 을 **제거**하고 **유체를 특별 취급하지
않기로** 했다. 근거는 "1차 자원은 데이터가 모른다" 는 것이다 — 물뿐 아니라 **철광석에도 레시피가
있다**(`kr-crush-iron-ore`, 실데이터 확인). 지금 철광석이 external 인 건 1차 자원이라서가 아니라
**우연히 레시피가 없어서**가 아니었고, 사용자가 이미 손으로 토글해 정하고 있었다
(`externalIngredients` 초기값은 `[]` 다). 그러니 **유체도 철광석과 동등하게** 두고, 1차 자원
선정은 사용자 몫으로 남긴다(도구 사용법의 일부). 앱이 추측하지 않는다.

**함께 고친 별개 버그 — 실행이 대체 제작법을 무시했다:** `layeredWizard` 가 `expandRecipeTree` 에
`recipeOverrides`(5번째 인자)를 안 넘겨, **화면에 보이는 트리와 실제 배치되는 트리가 달랐다.**
패널은 값을 넘기고 타입에도 있었는데 **읽는 쪽만** 빠져 있었다. 유체를 열자 바로 드러났다(water 를
`kr-water-from-atmosphere` 로 골라도 실행은 첫 매칭 `se-melting-water-ice` → 원유 체인 →
`basic-oil-processing 카테고리 머신 없음` 으로 실패). **`runLayeredWizard` 를 돌리는 테스트가
하나도 없어서** 살아남은 버그다 → `layeredWizard.recipeOverrides.test.ts` 로 고정했다.

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

## v1 이 빼는 것 (거절 — 폴백 없음)

- 다-유체 머신(정유·크래킹·황산·화학공장 다중).
- 이중 면(한 모듈 유체 in+out 동시).
- 유체 Parallel/MixedItem.
- 지하 파이프 일반 라우팅(홉은 pipeJumpToClusterPipe 한 모양뿐).
