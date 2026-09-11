---
tags: [factorio-data, fluid, tooling]
---

> **관련 문서:** [[fluid-box-semantics]] — 유체 상자 네 필드의 뜻 · [[ai-console]] — 콘솔로 치는 법

# 커스텀 레시피 — 사용자 어휘를 게임데이터 어휘로

> **이 문서를 읽어야 하는 때**
> - `src/factorio/customRecipe*.ts` · `customDataStore` · `CustomRecipeModal` 을 수정할 때
> - *"커스텀 머신을 만들었는데 배치가 안 선다"* 를 조사할 때 → **§4**
> - 게임데이터에 무언가를 **더 넣고 싶을** 때 → **§3 이 합류 규약이다**

## 0. 한 줄 요약

**원천은 spec, 산출은 게임데이터.** 사용자는 *"입력은 W 면 1행"* 이라 말하고, 합성기가 그걸
`{ direction, positions[4] }` 로 옮겨 `gameDataStore` 의 배열에 **진짜로** 넣는다. 그래서
소비처(레시피 트리·머신 후보·유체 배정)는 커스텀을 **모른 채로** 똑같이 동작한다.

## 1. 문제 — 레시피가 들어오는 길이 파일 하나뿐이었다

`Toolbar.handleGameDataFile` → [parseGameData](../../src/factorio/parseGameData.ts) →
`setGameData` 가 유일한 입구였다. 대가가 셋이다:

- 게임에 없는 레시피를 **못 시험한다** — 모드를 만들거나 아직 없는 조합을 배치해 보려면
  게임을 켜서 데이터를 다시 뽑아야 한다.
- AI 가 **입력을 못 만든다.** [[ai-console]] §4 가 적은 대로 *"다이얼로그는 사람 손이
  필요하다"*. 그래서 유체 2줄·큰 머신 같은 **경계 사례가 실데이터에 있어야만** 시험됐다.
- 유체 상자 **모양을 변수로 못 썼다.** 트렁크 파이프·좌석 예산은 전부 그 배치의 함수인데
  실데이터에 있는 모양만 돌려 볼 수 있었다.

## 2. 좌표 합성 — `resolveFluidConnection` 의 역함수

사용자는 **면과 행**으로 말한다. 게임데이터는 좌표를 요구한다.
[fluidPorts](../../src/autoLayout/module/fluidPorts.ts) 가 좌표에서 행을 이렇게 뽑으므로

```ts
offset = floor(w / 2 + pos.x)   // N/S 면
offset = floor(h / 2 + pos.y)   // E/W 면
```

역으로 `N×N` 머신에서 면 `F`·행 `k` 의 **회전 0 좌표**가 정해진다
([fluidBoxPosition](../../src/factorio/customRecipe.ts)):

| 면 | `direction` | 좌표 |
|---|---|---|
| N | `0` | `( k − N/2 + 0.5 , − N/2 + 0.5 )` |
| E | `4` | `( + N/2 − 0.5 , k − N/2 + 0.5 )` |
| S | `8` | `( k − N/2 + 0.5 , + N/2 − 0.5 )` |
| W | `12` | `( − N/2 + 0.5 , k − N/2 + 0.5 )` |

`positions` 네 개는 그 좌표를 `(x, y) → (−y, x)` 로 세 번 더 돌린 것이다
([rot4](../../src/factorio/customRecipe.ts)) — 화면 좌표(y 아래로 증가)에서 시계 방향이고,
그래서 `direction + 4` 와 짝이 맞는다.

> **이 식은 검증됐다.** `customRecipe.test.ts` 가 화학 공장 3×3 과 SE 랩 9×9 를 spec 으로
> 적어 합성한 뒤 **실게임 덤프와 통째로 대조**한다(fixture 출처는 `fluidPorts.test.ts`).
> 짝수 크기는 실데이터에 대조군이 없어 `resolveFluidConnection` **왕복**으로 시험한다 —
> 합성식이 그 함수의 역함수라는 주장 자체를 시험하는 것이라 대조군 없이도 증명이 된다.

### 짝수 크기에서 좌표는 반정수다

4×4 의 칸 중심은 `±0.5 · ±1.5` 다. **그래서 편집기가 좌표를 입력받지 않는다** — 반정수를
사용자에게 떠넘기면 짝수 머신에서 반드시 틀린다. 화면은 머신 **바깥 칸**을 누르게 해서
면과 행을 클릭으로 정하고, 좌표는 합성기가 만든다.

> 머신 **안쪽** 칸을 누르게 하지 않은 것도 이유가 있다: 모서리 칸은 두 면에 동시에 속해
> (화학 공장의 `(-1,-1)`) 클릭만으로 면이 안 갈린다. 면은 오직 `direction` 이 답한다
> ([[fluid-box-semantics]] §세 번째 방향 필드).

## 3. 합류 — 원천은 따로, 파생은 게임데이터 안에

```
customDataStore(spec)  ──compile──▶  gameDataStore.recipes / .entities  ──persist──▶ localStorage
        ▲                                        │
        └── 편집기 · flg.custom 이 여기만 고친다     └── 소비처 전부가 여기만 읽는다 (변경 0)
```

[syncCustomData](../../src/UI/store/customDataStore.ts) **하나**가 이 화살표를 담당한다.
하는 일은 둘: `custom` 표시가 붙은 항목을 걷어내고, 지금 spec 을 합성해 다시 넣는다.
`setGameData` 가 파생 인덱스를 통째로 다시 세우므로 소비처는 아무것도 몰라도 된다.

부르는 자리는 셋이고 전부 *"게임데이터가 막 바뀐 직후"* 다:

| 언제 | 왜 |
|---|---|
| 커스텀이 바뀐 뒤 | 편집기 저장 · `flg.custom.add/remove` |
| **파일을 새로 올린 뒤** | `setGameData` 가 배열을 갈아 끼워 커스텀이 날아간다. 여기가 **재임포트에서 살아남는 지점**이다 |
| 앱 부팅 시 rehydrate 뒤 | 한쪽 저장만 실패했으면(용량 초과) 원천과 산출이 어긋난 채 떠 있다 |

### 왜 게임데이터에 **진짜로** 넣나

소비처마다 병합하는 대안을 기각했다. 병합 지점이 `recipeMap`·`entityMap`·`machines`·
`itemToRecipe`·`recipesByProduct`·`recipeToTech` … 전부라 **하나만 빠져도 조용히 다르다.**

기각 근거는 이미 코드에 있다 — `infinity-pipe` 는 프로토타입 없이 이름만 쓰는 엔티티인데,
그 때문에 `portInference` 에 `synthesizeCardinalFluidPorts` 라는 특례가 생겼다
(*"게임데이터에 prototype 자체가 export 되지 않을 수 있어 `entity.fluid_boxes` 에 의존할 수
없다"*). **프로토타입 없는 이름은 소비처마다 특례를 낳는다.**

### `custom?: true` 로 알아본다

`Recipe`/`Entity` 의 이 표시가 원천과 산출을 잇는다. 이름 규칙(`custom-` 접두사)으로
알아보는 대안은 기각했다 — 이름은 사용자가 정하고, 규칙을 어긴 이름은 **영영 못 지운다.**

## 4. 실패하면 어떻게 되나 — 저장 시점에 막는다

커스텀 머신이 파이프라인에 안 맞는 방식은 **조용하다.** 유체 상자가 엉뚱한 면에 있으면
화면도 저장도 멀쩡하고, 배치를 돌려서야 거절 사유가 나온다. 그래서
[validateCustomData](../../src/factorio/customRecipeValidate.ts) 가 판정을 만드는 시점으로 당긴다.

### 가장 센 제약 — 입력 면과 출력 면은 **마주봐야 한다**

`chooseFluidTrunkPlan` 은 네 회전을 다 시험해 *"모든 줄이 자기 역할 면(출력 W · 입력 E)에
오는 첫 방향"* 을 고른다. 회전은 상대 각도를 보존하므로:

```
입력 N · 출력 S   →  90°  ✓
입력 W · 출력 E   → 180°  ✓   (SE 랩이 이 모양)
입력 N · 출력 E   →  어떤 회전에도 안 앉는다  ✗
입력 N · 출력 N   →  같은 면                ✗
```

**이 판정을 검증기가 재현하지 않는다 — `chooseFluidTrunkPlan` 을 그대로 부른다.** 규칙이
두 벌 있으면 한쪽만 고쳐지고 다른 쪽이 조용히 틀린다(`resolveFluidConnection` 주석).
그래서 `src/factorio/` 가 `src/autoLayout/` 을 **위로 참조한다** — 뒤집힌 방향인 걸 알고
그렇게 뒀다. 규칙의 집이 하나여야 하고, 그 집은 파이프라인이다.

### 판정표

| 사유(`kind`) | 등급 | 무엇 |
|---|---|---|
| `name-taken` · `duplicate-name` · `blank-name` | 거절 | Map 은 나중 것이 **조용히** 이긴다 |
| `fluid-no-rotation` | 거절 | 위의 면 규약 |
| `fluidbox-index` | 거절 | 못박은 서수가 그 역할 상자 수를 넘는다. `fluid-no-rotation` 으로 뭉뚱그리지 않고 따로 낸다 |
| `offset-range` · `offset-clash` | 거절 | `clamp` 가 조용히 끌어당기거나, 배타 배정이 깨진다 |
| `category-orphan` | 거절 | 그 카테고리를 맡는 머신이 0 → 2단계 후보가 빈다 |
| `bad-amount` · `no-product` | 거절 | `productYield` 가 NaN 이 되면 **인서터가 조용히 0개**가 된다 |
| `no-fluid-box` | 거절 | 유체를 쓰는 레시피인데 상자가 없다 |
| `seats-tight` | **경고** | 유체가 면을 다 먹어 아이템 벨트가 못 앉는다. 유체만 쓰는 레시피는 정당하므로 **막지 않는다** |

사유는 문장이 아니라 필드다 — `kind` · `where` · `detail` · `fix`. `fix` 는 **다음에 할
일**이고, 이건 콘솔 `registry` 의 `available` 과 같은 규약이다.

## 5. 남는 한계 — 블루프린트는 게임이 거부한다

`Toolbar` 의 내보내기는 `cell.entityName` 을 **검증 없이** 블루프린트에 싣는다. 커스텀 머신
이름의 프로토타입은 게임에 없으므로 **가져오기가 통째로 거부된다.**

막지 않는다. 이 앱의 산출이 블루프린트만은 아니고, 거부는 게임에서 즉시 드러나 조용하지
않기 때문이다. 대신 내보낼 때 몇 개가 실렸는지 토스트로 말해 준다 — 나중에 알면 *왜*
거부됐는지 못 짚는다.

그 밖에 **안 채우는 것**: 아이콘(앱 전체가 안 그린다) · 기술 연동(커스텀은 항상
`enabled: true`) · 모듈 효과·표면 조건(v1 파이프라인이 안 본다) ·
`collision_box`/`items_to_place_this`(소비처가 0곳이다).

## 6. 구현 위치

| 단계 | 파일 | 심볼 |
|---|---|---|
| 원천 자료형 · 합성 | [customRecipe.ts](../../src/factorio/customRecipe.ts) | `CustomDataSpec` · `fluidBoxPosition` · `rot4` · `compileCustomData` |
| 판정 | [customRecipeValidate.ts](../../src/factorio/customRecipeValidate.ts) | `validateCustomData` · `fitFluidLines` · `CustomDataIssue` |
| 원천 보관 · 합류 | [customDataStore.ts](../../src/UI/store/customDataStore.ts) | `useCustomDataStore` · `syncCustomData` · `gameDataContext` |
| 화면 | [CustomRecipeModal.tsx](../../src/UI/components/CustomRecipeModal.tsx) · [CustomRecipeList.tsx](../../src/UI/components/CustomRecipeList.tsx) | `FluidBoxGrid` · `RotationNote` |
| 콘솔 | [customData.ts](../../src/debug/customData.ts) | `renderCustomMachine` · `renderFit` · `customTemplate` |

## 7. 함정

- **`fluidbox_index` 에 `0` 을 채우지 않는다.** 미지정이면 그 역할의 상자 **전부**에 들어갈
  수 있고, 실데이터에서 이 필드를 가진 레시피는 **둘뿐**이다([[fluid-box-semantics]]).
  편집기의 `자동` 이 그 미지정이다.
- **`flow_direction` 을 안 채운다.** 그 필드는 물리 흐름이라 용도(`production_type`)와 다른
  것을 잰다. 편집기는 용도만 물으므로 흐름에 대해 할 말이 없고, 소비처는 전부
  `flow_direction ?? production_type` 으로 읽으니 비워 두면 용도가 그대로 답이 된다.
- **머신 크기를 줄이면 범위 밖 상자를 버린다.** `clamp` 에 맡기면 사용자가 모르는 행으로
  옮겨 앉는다.
- **`enabled: true` 는 선택지가 아니다.** `isRecipeSelectable` 이 이걸 안 보면 만들어 놓고도
  콤보박스에 안 뜬다.
