---
tags: [auto-layout, placement, routing]
---

> **부모 문서:** [auto-layout-wizard.md](auto-layout-wizard.md)
> **관련 문서:** [.channel-geometry-reservation](auto-layout-wizard.channel-geometry-reservation.md) — 예약 철학의 본문,
> [.ns-face-relief](auto-layout-wizard.ns-face-relief.md) — 코너 어깨 상자가 생기는 경위

# moduleWayOuts — "이 상자가 방을 빠져나갈 수 있는 문은 어느 쪽인가"

## 0. 한 줄 요약

반출 경로 예약이 **모듈 몸통에 막힌 방향을 예약**하는 바람에, 방출 단계가 탐색으로 우회해야
했고(예약 철학 위반) 예약된 채널 트랙은 아무도 안 써서 **폭만 낭비**됐다. 모듈이 포트마다
**`moduleWayOuts`** (= 자기 몸통에 안 막히고 나갈 수 있는 방향들)를 답해주게 하고, 예약이
그 방향만 고르게 해서 **탐색을 제거하고 낭비를 없앴다.**

## 1. 문제 — 예약이 거짓말을 하고 있었다

[[용어사전#채널 (channel)|채널]](모듈 사이 복도)의 **폭은 그 안을 지날 벨트 수(트랙 수)만큼 미리 예약**해서 정해진다.
예약의 목적은 "깔기 전에 자리를 잡아 나중에 막히는 일을 없애는 것"이다
([.channel-geometry-reservation §1](auto-layout-wizard.channel-geometry-reservation.md)).

그런데 반출 경로 예약([`perimeterLanePlanner`](../frontend/src/utils/autoLayout/planner/perimeterLanePlanner.ts))은
상자의 **`meta.side`**(포트 계획기가 배정한 레인 면) 만 보고 출구를 정했다. 모듈 내부는
안 본다는 원칙(블랙박스) 때문이다. 문제는 **그 방향이 실제로 뚫려 있는지 아무도 확인하지
않았다**는 것이다.

**실측 사례 (advanced-circuit 동형, count=2):**

```
       n0 몸통                   채널 depth1
   ┌──────────┐  x=7   x=8   │  ...  x=10  │
   │  머신    │   │      │   │       T     │   T = 예약된 트랙(x=10)
   │ (3,10)   │   │      │   │       T     │
   │ (3,13)   │   │      │   │       T     │
   └──────────┘   │      │   │       T     │
  y=16            ▣──✗───█───·───────T     │   ▣ = copper-cable 상자 (7,16)
                        ▲                      █ = electronic-circuit 의 트렁크 (8,16)
                   가로 진입이 형제 트렁크에 막힘
  y=17            ↓  ← 남쪽은 12칸 완전히 열려 있다
  ...             ↓
```

- copper-cable 상자는 **코너 어깨**에 앉는다(`face=S` 인데 `meta.side=E`). count≥2 기둥에서
  트렁크가 레인을 따라 자라며 상자가 끝면으로 밀려난 결과다([.ns-face-relief](auto-layout-wizard.ns-face-relief.md)).
- 예약기는 `side=E` 만 보고 **"동쪽 채널로 우회"** 로 배정하고, 채널에 트랙 x=10 을 잡아
  **복도를 한 칸 넓혔다.**
- 그런데 동쪽으로 가는 가로 진입은 **형제 포트(electronic-circuit)의 세로 트렁크**에 막혀 있다.
  (자기 트렁크가 아니다 — 같은 레인의 바깥쪽 형제다.)
- 결과: 방출 단계가 예약을 못 쓰고 **탐색(routeAuto)으로 우회**해 남쪽으로 내보냈고,
  예약된 트랙 x=10 은 **영원히 빈 채** 남아 폭만 낭비됐다.

**핵심 진단:** 정보가 없어서가 아니었다. `planLanes` 가 불리는 시점엔 **모듈들이 이미 생성돼
있고**([`modulePacking.ts`](../frontend/src/utils/autoLayout/planner/modulePacking.ts) —
`planLanes(specs, oriented, …)`), 막힘은 **전적으로 모듈 내부 성질**이라 채널 위치(colX)를
몰라도 판정할 수 있었다. 예약기가 **일부러 안 보고 있었을 뿐**이다.

## 2. 결정 — 모듈이 자기 자신에 대해 답한다

블랙박스 원칙을 깨지 않으면서 정보를 얻는 방법: **planner 가 모듈 안을 들여다보는 게 아니라,
모듈에게 물어본다.**

> **`moduleWayOuts`** (사용자 명명) — 어떤 포트의 반출 벨트가 **자기 모듈 몸통**(머신 + 자기/
> 형제 포트의 트렁크·인서터·상자)에 막히지 않고 밖으로 빠져나갈 수 있는 **방향들**.

비유하면: 모듈은 방이고 상자는 그 방의 벽에 붙어 있다. 물건을 복도로 빼내려면 방 밖으로
나가는 길이 있어야 하는데, **방 안의 다른 짐이 그 길을 막고 있을 수 있다.** 그래서 상자마다
"이 상자가 방을 빠져나갈 수 있는 문이 어느 쪽에 나 있는가"를 미리 적어둔다.

**계산:** anchor 에서 네 방향으로 각각 직선을 쏴, 모듈 몸통 extent 를 벗어날 때까지 자기 셀에
한 번도 안 막히면 그 방향이 들어간다. 모듈-로컬로 계산해도 **방향은 평행이동 불변**이라
절대좌표에서 그대로 유효하다.

**상자 ghost·인서터도 장애물로 센다** — 재배치 때 그 두 칸은 belt 로 다시 깔리므로
(`modulePerimeterPass` 가 `path=[feeder, anchor, …]` 로 재사용) 여전히 점유 상태다.

## 3. 출구 선택은 자유도다 — 하나로 못박지 않는다

예약기는 이제 각 상자마다 **쓸 수 있는 출구 후보(`LaneOption[]`)** 를 나열하고
`options[0]` 을 기본 확정으로 삼는다. 모든 후보는 `wayOut ∈ moduleWayOuts` 를 만족한다.

**왜 후보를 남기나 (사용자 지시):** 출구 선택 자체는 어느 걸 골라도 정합성이 안 깨지는
**자유도**다. 나중에 더 **까다로운 제약**을 가진 쪽(절단선이 납품 경로를 가둠, 채널 트랙
부족 등)이 **양보를 요구**할 수 있으므로, planner 가 미리 하나로 못박아 자유도를 없애면 안 된다.
느슨한 결정은 느슨하게 두고, 제약이 센 쪽이 먼저 고르게 한다(스도쿠 원리 —
[.priority-ordering](auto-layout-wizard.priority-ordering.md)).

`LaneAssignment` 의 평평한 필드(`exitEdge`/`host`/`interval`/`entry`)는 **현재 확정**이고,
`options` 가 **남은 자유도**다. 장부가 제약 때문에 다른 후보로 양보시킬 수 있다.

> 현재 상태: 자유도는 **표현·보존**되고 있으나(후보 목록), 장부가 아직 이 목록에서 능동적으로
> 고르지는 않는다. 장부의 기존 해소 사다리(진출 변 N↔S 뒤집기)는 `wayOut`(W/E 가로 진입
> 방향)을 바꾸지 않으므로 불변식을 깨지 않는다. **장부가 후보에서 양보(예: 트랙 부족 시
> 채널 후보 → 마진 후보)하도록 배선하는 것은 후속 과제.**

**폭은 확정된 출구 하나만 반영한다** — 안 쓸 후보를 위해 채널을 넓히지 않는다.
나갈 길이 하나도 없는 상자는 **배정을 안 만든다**(예약 0 · 계획된 skip) — 못 쓸 경로를
예약해 폭만 먹는 것보다 정직하다.

## 4. 탐색 폴백 제거

예약이 **뚫린 방향만** 고르고 채널 구간은 장부가 비워두므로, **예약된 경로는 항상 방출 가능**
하다. 따라서 [`modulePerimeterPass`](../frontend/src/utils/autoLayout/planner/modulePerimeterPass.ts)
의 탐색 폴백(routeAuto)을 **제거**했다. 이제 hint 재생 실패는 "탐색으로 우회할 일"이 아니라
**예약 불변식이 깨졌다는 신호**다 — 그 상자만 skip 하고 사유를 남긴다(가짜 물류 금지).

## 5. 검증 (2026-07-11)

불변식 테스트: [`reservationEmittable.test.ts`](../frontend/src/utils/autoLayout/planner/reservationEmittable.test.ts)
— "예약(hint) 재생만으로 모든 상자가 방출된다" + "배정된 출구의 진출 방향은 항상 wayOuts 안".
[`moduleWayOuts.test.ts`](../frontend/src/utils/autoLayout/module/moduleWayOuts.test.ts) — 독립
재계산 일치 + "자기 face 방향은 항상 나갈 수 있다".

advanced-circuit 동형 트리, count 1~8 실측:

| counts | 복도 폭(bbox w) 이전 → 이후 | skip | 예약만으로 방출 | 채널 쓰는 상자 |
|---|---|---|---|---|
| 1/1/1 | 32 → 32 | 0 | 7/7 | 1 |
| 2/2/2 | **24 → 23** | 0 | 7/7 | 2 → 1 |
| 4/4/2 | **25 → 24** | 0 | 7/7 | 2 → 1 |
| 6/4/2 | **25 → 24** | 0 | 7/7 | 2 → 1 |
| 8/6/4 | **25 → 24** | 0 | 7/7 | 2 → 1 |

낭비가 있던 모든 케이스에서 **복도가 1칸 좁아졌고**, 탐색 없이 skip 0. 골든 스냅샷 불변
(1/1/1 은 E 가 원래 뚫려 있어 배정이 안 바뀐다). 전체 244 green / tsc clean.

## 6. 구현 위치

| 단계 | 파일 | 구현 |
|---|---|---|
| 산출 | [`clusterModule.ts`](../frontend/src/utils/autoLayout/module/clusterModule.ts) | `ModulePort.moduleWayOuts` + `fillModuleWayOuts` — 전 포트 emit 후(몸통 확정 후) 일괄 계산 |
| 전달 | [`modulePacking.ts`](../frontend/src/utils/autoLayout/planner/modulePacking.ts) | `shiftModule` 이 포트 재구성 시 보존(평행이동 불변), `planLanes` 가 `LanePortInput.wayOuts` 로 전달 |
| 소비 | [`perimeterLanePlanner.ts`](../frontend/src/utils/autoLayout/planner/perimeterLanePlanner.ts) | `LaneOption` + `enumerateOptions` — 뚫린 방향만 후보화, 폭은 확정 하나만 반영 |
| 방출 | [`modulePerimeterPass.ts`](../frontend/src/utils/autoLayout/planner/modulePerimeterPass.ts) | 탐색 폴백 제거 — 예약 재생만 |

## 7. 함정 (다음 사람에게)

- `shiftModule`(modulePacking)은 `ModulePort` 를 **명시 필드로 재구성**한다. 포트에 필드를
  추가하면 **여기도 반드시 추가**해야 한다 — 안 그러면 런타임에 `undefined` 로 조용히 사라진다.
- `moduleTransform.ts` 의 `xfPort`/`shiftPort` 도 같은 문제를 갖고 있으나 **죽은 코드**이고
  (프로덕션 미사용) **tsc 가 아예 포함조차 안 한다**(테스트에서만 도달 — 이 저장소는 tsc 가
  테스트 파일을 검사하지 않는다). 되살릴 땐 필드 누락부터 고쳐야 한다.
