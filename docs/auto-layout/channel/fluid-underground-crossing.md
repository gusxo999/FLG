---
tags: [auto-layout, fluid, routing, placement, planning]
aliases: [유체지하횡단, fluid-underground-crossing]
---

# 유체 지하 횡단을 장부 안으로 — 설계 계획서 (방식 A)

> **부모 문서:** [[fluid-hop-reservation]] §6 "잔여 결정" 의 (가) 안
> **관련:** [[channel-geometry-reservation]] · [[pipe-semantics]]

> **상태(2026-07-25): 설계 계획 — 미구현.** 조사(§1)는 코드 실측 완료.

## 0. 한 줄 요약

유체가 다른 유체를 **지하파이프로 건너게** 하고, 그 건넘까지 장부가 계획한다.
페어링 규칙은 새로 만들지 않는다 — 라우터에 이미 있는 것을 장부로 끌어올린다.

---

## 1. 조사 결과 — 뭐가 이미 있고 뭐가 없나

### 1.1 페어링 규칙은 이미 있다. 30줄짜리 순수 함수다

지하파이프가 서로 짝을 가로채는 문제는 라우터에서 이미 풀려 있다
([containerRouting.ts:1175](../frontend/src/utils/autoLayout/containerRouting.ts#L1175)):

```
충돌 규칙: 같은 axis · 같은 line 위에서 interval 이 strict disjoint 여야 함.
(= 한 corridor 의 endpoint 가 다른 corridor 의 open interior 에 끼는 모든 케이스 거부)
```

`UndergroundCorridor = { axis: 'h'|'v', line, range: [a,b], blockGroup, kind }`.
파이프는 프로토타입 무관 단일 그룹(`PIPE_BLOCK_GROUP = "pipe-to-ground"`), 벨트는
프로토타입별 그룹(다른 티어는 독립).

**그러므로 이 작업은 "페어링 모델 설계"가 아니다. "있는 규칙을 장부에서도 부르기"다.**

### 1.2 장부의 행은 이미 절대 좌표다 — 열 원점 하나면 다리가 놓인다

장부 좌표계는 (열, 행)이고, 주석대로 "행 = abs y". 추상인 건 **열뿐**이다.
열↔절대 x 변환은 호출자가 갖고 있다
([modulePacking.ts:683](../frontend/src/utils/autoLayout/planner/modulePacking.ts#L683)):

```ts
const tx = (t: number) => channelStartX(seed.depth) + 1 + t;
```

트랙 간격이 1타일이므로, **트랙 0의 절대 x 하나**만 넘기면 장부가 자기 좌표를 절대
좌표로 복원할 수 있다. 장부의 추상화를 깨지 않는다 — 원점만 알려 주는 것이다.

> 앞선 계획서에서 "모듈 내부 지하파이프를 장부 좌표계로 끌어오는 게 이 작업의 실제 무게"
> 라고 적었는데, **과대평가였다.** 행이 이미 절대라 다리가 숫자 하나다.

### 1.3 모듈 내부 지하파이프는 corridor 기록이 **아예 없다** — 선행 결함

`pipeJumpToClusterPipe` 는 머신 유체 상자 행에서 지하파이프 쌍을 놓는다
([clusterModule.ts:1706-1731](../frontend/src/utils/autoLayout/module/clusterModule.ts#L1706-L1731)).
그런데 `GeneratedModule` 에 `corridors` 필드가 없고, `clusterModule` 은 corridor 를 한 번도
만들지 않는다.

`routeModuleHops` 의 corridor 목록은 **빈 배열에서 시작해 홉 경로 것만 쌓인다**
([moduleHop.ts:208](../frontend/src/utils/autoLayout/planner/moduleHop.ts#L208)).
모듈 셀은 `base`(점유)에는 들어가지만 corridor 로는 안 들어간다.

**즉 지금도 홉의 파이프 점프가 모듈 내부 지하파이프의 짝을 끊을 수 있다.** 이 결함은 이
기능과 독립이며, 이 기능을 넣으면 더 자주 드러난다.

### 1.4 장부는 벨트에 대해서도 페어링을 모델링한 적 없다

`placeWithJumps` 는 겹침만 본다. corridor 검사가 없다. 아이템에서 대체로 무해했던 이유:

- 벨트 blockGroup 은 프로토타입별이라 간섭 범위가 좁다.
- 한 납품 안의 연속 점프는 사이에 빈 칸을 두게 되어 있어(출구 선택 규칙) 구간이 겹치지 않는다.
- 서로 다른 납품의 가로 점프는 포트 행이 달라 같은 line 에 잘 안 놓인다.

유체는 셋 다 성립하지 않는다 — 그룹이 전역이고, 모듈 내부 점프와 행을 공유할 수 있다.
그래서 **검사를 붙이면 아이템도 공짜로 안전해진다**(§5 D6).

---

## 2. 설계

### 2.1 좌표 다리 — `GeometryContext.trackX0`

```ts
export interface GeometryContext {
  // ...
  /**
   * 트랙 0의 절대 x. 주면 장부가 자기 (열,행)을 절대 좌표로 복원해 corridor 규칙을
   * 절대 좌표에서 적용한다. 없으면 지하 페어링 검사를 건너뛴다(기존 동작).
   */
  trackX0?: number;
  /** 이미 존재하는 지하 통로(절대 좌표). 계획 점프가 이것들과 짝을 다투면 안 된다. */
  existingCorridors?: ReadonlyArray<UndergroundCorridor>;
  /** 유체 점프 거리 상한. `maxJump`(벨트)와 별개 — 파이프는 프로토타입이 다르다. */
  maxJumpPipe?: number;
}
```

호출자(`modulePacking`)가 `tx(0)` 을 그대로 넘긴다. 가상 열(-1, capCol)도 같은 식으로
변환되며, capCol 이 채널 밖으로 새는 문제는 기존 규칙(입구 금지)이 이미 막는다.

### 2.2 corridor 원장 — 계획 중에도 누적한다

장부는 배정하며 점프를 만든다. 그 점프들이 서로 짝을 다투면 안 되므로, `placedShapes` 와
나란히 **corridor 목록**을 들고 다닌다:

```
corridorLedger = [...ctx.existingCorridors] ++ (지금까지 계획한 점프에서 만든 corridor)
```

새 점프 후보 하나를 받아들이기 전에 `isJumpAllowed(from, to, 같은 그룹 corridor)` 로 검사한다.
`isJumpAllowed` 는 `containerRouting` 에서 **export 만 하면 그대로 쓴다**(지금은 파일 내부 함수).

### 2.3 `placeWithJumps` 를 유체까지 — 세 곳만 다르다

지금은 아이템 전용이다. 유체를 받으려면:

| 항목 | 아이템 | 유체 |
|---|---|---|
| 막힘 판정 | 점유 칸 | 점유 칸 **+ 다른 유체 halo** — 그래야 출구가 halo 밖으로 밀린다 |
| 점프 거리 | `maxJump` | `maxJumpPipe` |
| 페어링 그룹 | 벨트 프로토타입 | `"pipe-to-ground"`(전역) |

**출구 선택 규칙은 그대로 쓴다.** 기존 규칙이 "막힌 칸을 다 지나 다음 칸도 안 막힌 첫 빈 칸"
을 고르므로, 막힘에 halo 를 포함시키면 **자동으로 halo 밖으로 나간다**. 알고리즘을 안 고친다.

그리고 ③ 단계 안에서도 **유체를 먼저** 돌린다 — §4.3 의 실패 비용 순이 여기서도 유지된다.

### 2.4 모듈 내부 지하파이프를 corridor 로 기록 (§1.3 결함 수리)

`GeneratedModule` 에 `corridors: UndergroundCorridor[]` 를 추가하고, `emitTrunkPipe` 가
`pipeJumpMode` 로 놓는 쌍마다 corridor 를 하나 만든다(쌍을 아는 자리에서 만드는 게 유일하게
안전하다 — 나중에 셀에서 역추적하면 어느 입구와 어느 출구가 짝인지 알 수 없다).

`packModuleTree` 가 그걸 모아 `PackResult.corridors` 로 올리고, 둘이 쓴다:
- 장부 — `ctx.existingCorridors`
- `routeModuleHops` — corridor 초기값(지금은 빈 배열, §1.3)

### 2.5 halo 와 터널 입구 — 보수적으로 둔다

게임에서 지하파이프 입구는 **자기 축 한 쪽에만** 표면 연결이 있어, 건너뛴 파이프와 안 닿는다.
그런데 `pipeFlow` 는 터널 입구도 일반 파이프로 보고 네 이웃을 다 막는다
([pipeFlow.ts:65](../frontend/src/utils/autoLayout/module/pipeFlow.ts#L65)).

**이 보수성을 유지한다.** 넓게 뛰면 되고(파이프 점프 거리는 보통 10), 완화하려면 방향까지
모델링해야 하는데 그 대가로 얻는 건 몇 칸의 조밀함뿐이다. 완화는 별도 작업(§6).

---

## 3. 작업 단계

| 단계 | 내용 | 완료 판정 |
|---|---|---|
| **A-0** | `isJumpAllowed` export + 단위 테스트로 규칙 고정 | 규칙이 문서 §1.1 과 일치함을 테스트가 보증 |
| **A-1** | `GeneratedModule.corridors` + `emitTrunkPipe` 가 쌍마다 기록 | `pipeJumpMode` 켜진 모듈이 corridor 를 낸다 |
| **A-2** | `PackResult.corridors` 로 올리고 `routeModuleHops` 초기값으로 사용 | 홉 점프가 모듈 내부 짝을 못 끊는다 (**§1.3 결함 수리, 단독 가치**) |
| **A-3** | `GeometryContext` 에 `trackX0`·`existingCorridors`·`maxJumpPipe` | tsc 통과. 호출자가 `tx(0)` 을 넘긴다 |
| **A-4** | 장부의 corridor 원장 + 점프 후보 검증 | 같은 행에서 짝을 다투는 두 점프가 배정되지 않는 테스트 |
| **A-5** | `placeWithJumps` 유체 지원(halo 막힘 + `maxJumpPipe` + 파이프 그룹), ③에서 유체 우선 | **서로 다른 유체 두 줄 교차가 계획된다** — `fluid-unplannable` 이 안 난다 |
| **A-6** | 회귀 | 521 테스트 유지 + `wood ← water` 실패 0 |

**A-2 는 단독으로 가치가 있다** — 이 기능을 안 넣어도 고쳐야 할 결함이다. 별도 커밋으로 낸다.

---

## 4. 이 설계가 틀릴 수 있는 곳

- **장부의 추상 열이 실제 채널 폭보다 넓을 때.** 장부는 배정 결과에서 폭을 유도한다(폭 역전).
  절대 x 로 페어링을 보려면 트랙이 실제로 1타일 간격이어야 하는데, 폭이 확정되기 **전에**
  검사하는 셈이다. 트랙 간격은 정의상 1타일이므로 성립하지만, 이 가정이 깨지면 검사가
  헛돈다 → A-4 에 "트랙 간격 1타일" 을 명시적으로 단언하는 테스트를 둔다.
- **`existingCorridors` 가 채널 밖 좌표를 가진다.** 정상이다 — corridor 규칙은 같은 line 의
  구간 비교라 채널 안팎을 안 가린다. 다만 열 변환 없이 **절대 좌표 그대로** 비교해야 한다.
- **유체가 지하로 갈 수 있게 되면 §4.3 우선순위의 근거가 약해진다.** "유체는 못 비키니까
  먼저" 였는데 이제 비킬 수 있다. 그래도 순서는 유지한다 — 지상이 지하보다 싸고, 실패
  비용은 여전히 유체가 가장 크다.

## 5. 결정이 필요한 항목

| # | 항목 | 선택지 | 권고 |
|---|---|---|---|
| **D4** | 터널 입구 halo 면제 | (a) 보수적 유지 (b) 방향 모델링해 완화 | **(a)** — 얻는 건 몇 칸, 드는 건 방향 모델 |
| **D5** | A-2(모듈 corridor 기록)를 언제 | (a) 선행 독립 커밋 (b) 이 작업에 포함 | **(a)** — 단독 결함 수리다. 이 기능이 엎어져도 남아야 한다 |
| **D6** | 아이템 지하 횡단도 corridor 검증 | (a) 함께 적용 (b) 유체만 | **(a)** — 같은 코드로 공짜고, 지금 무검증인 게 정상은 아니다 |

## 6. 스코프 밖

- **터널 입구 방향 모델링**(D4 (b)) — halo 완화. 조밀함이 실제로 부족해지면 그때.
- **반출 경로의 지하** — `perimeterRouter` 는 지상 전용이다. 별개 설계.
- **다-유체 모듈** — 여전히 모듈당 유체 1줄.
