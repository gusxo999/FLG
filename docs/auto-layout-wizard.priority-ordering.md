---
tags: [auto-layout, placement, routing]
---

# 우선순위 정리 — 배치·라우팅의 모든 순서 결정점

> **부모 문서:** [auto-layout-wizard.placement-search.md](auto-layout-wizard.placement-search.md)
> **관련 문서:** [.known-limits](auto-layout-wizard.known-limits.md), [.entity-roles](entity-roles.md)
> **목적:** 자동 레이아웃 파이프라인 곳곳에 흩어진 "무엇을 먼저 하나" 결정을 한곳에 모아, 각각이 **정합성 보장(불변)** 인지 **품질 최적화(교체 가능)** 인지 분류한다.

---

## 0. 왜 따로 정리하나

우선순위는 단일 모듈의 문제가 아니다. **배치(머신·외부상자 위치 선정)** 와 **라우팅(경로·포트·운반체 선택)** 양쪽에 독립적으로 존재하고, 종류가 다르다:

- **배치의 우선순위 = 패킹 품질.** place-then-grow 구조([placement-search §3 단일 링 불변식](auto-layout-wizard.placement-search.md))에서 한 연결이 실패하면 링이 통째로 커진다. 따라서 "누구를 먼저 놓나"가 최종 bbox 크기를 좌우한다.
- **라우팅의 우선순위 = 비용·성공.** 어느 포트·어느 경로·어느 운반체를 먼저 시도하느냐가 belt 길이·꺾임·성공 여부를 좌우한다.

---

## 1. 두 가지 지배 원리

| 층위 | 원리 | 한 줄 |
|---|---|---|
| **배치** | **[[용어사전#fail-first|fail-first]] (제약 큰 것 먼저)** | 여유 없는 연결이 희소 자원(셀)을 선점하게 해, 쉬운 연결이 어려운 연결을 굶기는 것을 막는다. [[용어사전#CSP|CSP]]의 [[용어사전#MRV|MRV]](Minimum Remaining Values)·bin packing decreasing 계열. |
| **라우팅** | **[[용어사전#cost-first|cost-first]] (싼 경로 먼저)** | 지상 < 지하, 가까운 포트 < 먼 포트, 깔끔한 spine < 감아도는 경로 순으로 시도. |

---

## 2. 우선순위 등록부 (모든 결정점)

> **분류:** **C** = 정합성 보장(불변, 바꾸면 안 됨) / **Q** = 품질 최적화(교체·개선 가능)

| #   | 결정점                         | 현재 기준                                               | 분류    | 코드                                                                                                                                                                 |
| --- | --------------------------- | --------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | **연결 처리 순서** (외부상자 배치)      | 삽입 순서 = DFS 노드 → 재료 → 머신, 출력은 입력 뒤                  | **Q** | [areaUnification.ts](../frontend/src/utils/autoLayout/areaUnification.ts) — 드래그 재라우팅 경로에만 남음. 위저드 본패스의 상자 배치는 P10/P11 로 대체됐다 |
| P2  | **셀 후보 정렬** (한 연결 내)        | `machine.origin`(좌상단 코너) 맨해튼 거리 오름차순, 첫 라우팅 성공 셀 채택 | **Q** | [areaUnification.ts:341](../frontend/src/utils/autoLayout/areaUnification.ts#L341)                                                                                 |
| P3  | **ring 성장 변 선택**            | 실패한 chest의 머신 최근접 변만 +1 (전체 링 성장 회피)                | **Q** | [areaUnification.ts:234](../frontend/src/utils/autoLayout/areaUnification.ts#L234)                                                                                 |
| P4  | **포트 페어 정렬** (라우팅 fallback) | 모든 포트 조합 manhattan 거리 오름차순                          | **Q** | [routeFallback.ts:143](../frontend/src/utils/autoLayout/routeFallback.ts#L143)                                                                                     |
| P5  | **멀티소스/싱크 우선 경로**           | item 초기 배치에서 후보 포트를 라우팅 출력으로 역전                     | **Q** | [routeFallback.ts:73](../frontend/src/utils/autoLayout/routeFallback.ts#L73)                                                                                       |
| P6  | **경로 탐색 cost** (Dijkstra)   | 지상 edge=1, 지하 점프=2 → 지하 우선(O2)                      | **C** | [placement-search §4.1](auto-layout-wizard.placement-search.md)                                                                                                    |
| P7  | ~~**트렁크 seed 점수**~~          | 사전식 `[untapped, 횡축 span, 트렁크 길이]` 최소 — **죽은 결정점**(2026-07-26 확인): `trunkPath`/`trunkEmit` 은 프로덕션 호출자 0 | **Q** | `module/trunkPath.ts` (자기 테스트만)                                                                                             |
| P9  | **후보 정렬 O1** (near-square)  | `\|W−H\|` 작을수록 우선 — **현재 후보 1개라 미사용**, 기록만          | **Q** | [placement-search §6 O1](auto-layout-wizard.placement-search.md)                                                                                                   |
| P10 | **채널 기하 배정 순서**            | 유체 납품 → 반출 → 아이템 납품 (**실패 비용 순**)            | **C** | [channelGeometryPlanner.ts](../frontend/src/utils/autoLayout/planner/channelGeometryPlanner.ts), [.fluid-hop-reservation §4.3](auto-layout-wizard.fluid-hop-reservation.md) |
| P11 | **홉 방출 순서**                | 유체 홉 먼저, 그다음 아이템 홉                                | **C** | [moduleHop.ts](../frontend/src/utils/autoLayout/planner/moduleHop.ts), [.fluid-hop-reservation §8.2](auto-layout-wizard.fluid-hop-reservation.md) |

### P10·P11 — "제약 센 것" 이 아니라 "실패하면 비싼 것" 먼저 (2026-07-25)

§1 의 배치 원리는 fail-first(제약 큰 것 먼저)다. 유체를 넣을 때 그걸로는 부족했다 —
유체와 아이템은 제약의 **종류**가 달라 비교가 안 된다. 대신 **밀렸을 때 잃는 것**으로 준다:

| 순위 | 경로 | 밀리면 |
|---|---|---|
| 1 | 유체 납품 | 지하로 못 도망간다(지하파이프 페어링 미모델링) → **트리 전체 실패** |
| 2 | 반출 | 상자가 로컬 ring 에 남는다 — 되돌릴 수 있는 손해 |
| 3 | 아이템 납품 | 지하 횡단이 회수한다 — 사실상 손해 없음 |

P11 은 같은 순서를 **방출 단계**에도 적용한다. 아이템 홉이 막힐 때 도는 "예약 무시
재시도"가 남의 계획 칸을 밟는데, 그게 유체 자리였으면 유체는 물러설 데가 없다.
유체가 먼저 칸을 실제로 차지하면(`hopBelts`) 그 재시도가 밟을 수 없다.

---

## 3. 핵심: 배치의 "제약" 측정 (P1)

진짜 척도 = **그 연결이 라우팅 성공하는 빈 ring 셀의 개수**(MRV). 정확하지만 셀마다 시험 라우팅이 필요해 비싸고, 셀이 소비되면 변하는 **동적** 값이다. 그래서 **싼 정적 [[용어사전#프록시 (proxy)|프록시]]**로 근사한다 — 라우팅을 돌려보지 않고 좌표·종류 검사만으로 제약의 크기를 어림잡는다.

### 3.1 코드로 검증된 프록시 요인 — fluid

머신이 노출하는 포트 셀 수는 kind마다 다르다:

- **item:** footprint 둘레 전체 `2(w+h)`개 ([itemPorts](../frontend/src/utils/autoLayout/portInference.ts#L93))
- **fluid:** `fluid_boxes[].connections[].positions`의 셀만, `fb.filter` 일치 box만 — 보통 1~2개 ([fluidPorts](../frontend/src/utils/autoLayout/portInference.ts#L116))

→ fluid 후보는 item의 **엄격한 부분집합이자 훨씬 작음** = 제약이 크다. *(이 방향성은 코드로 확인됨.)*

### 3.2 검증되지 않은 부분 (주의)

"fluid가 **항상** 1순위 제약"은 **거짓일 수 있다.** 기둥 안쪽에 끼어 N/S 면을 이웃에 뺏기고 W·E 2면만 남은 item 머신이, 가장자리에 1포트지만 그 면이 뻥 뚫린 fluid 머신보다 가용 셀이 더 적을 수 있다. 정확히는 fluid는 *MRV를 낮추는 한 요인*이지 자동 최상위가 아니다.

### 3.3 권장 프록시 (1차 — 사전식 비교)

점수 가중합이 아니라 **서열만** 정한다(가중치 튜닝 함정 회피):

```
1순위: fluid 여부        (fluid가 더 제약 큼)
2순위: 같으면, 노출 면 수  (적을수록 제약 큼)
3순위: 같으면, 머신-링 거리 (멀수록 제약 큼)
동률 : machineId → chestId 사전순 (결정성 tie-break)
```

이걸로 부족하면 **동적 MRV**(매 배치 후 남은 연결의 가용 셀 수 재계산, [[용어사전#DSATUR|DSATUR]] 동형)로 승급 — 더 정확하지만 `O(연결² × 셀 × 라우팅)`로 무겁다.

---

## 4. P2의 알려진 편향

P2는 `machine.origin`(좌상단 코너) 기준 거리라, 멀티타일 머신(3×3 조립기, 9×9 로켓사일로)에서 후보가 **NW 코너로 쏠린다.** 머신 남/동 면에 붙어야 할 상자가 북/서로 끌려가 belt가 길어지고, 가까운 면 직결 탭이 막히기도 한다.

→ 개선: 거리 기준을 **관련 면의 최근접 port 셀**(최소한 footprint 가장자리로 clamp한 거리)로 교체.

---

## 5. 결정성 불변식

모든 우선순위 정렬은 [placement-search §8 결정성](auto-layout-wizard.placement-search.md)([[용어사전#결정성 (determinism)|결정성]])을 지켜야 한다 — 난수 금지, **안정 정렬 + 명시적 [[용어사전#tie-break|tie-break]]**. 동일 입력 → 동일 출력을 보장해야 한다. 새 우선순위 키를 추가할 때 동률 처리(예: `machineId → chestId` 사전순)를 반드시 명시한다.

---

## 6. 개선 우선순위 (제안)

| 순위 | 항목 | 근거 |
|---|---|---|
| 1 | **P1 — 제약 큰 것 먼저** | 효과 최대. 링 성장↓ → bbox↓ → O1 squareness 개선. 그리디 로직 불변, 진입 전 정렬만 추가(저위험). |
| 2 | **P2 — 코너 편향 제거** | 저위험 핀포인트. `machine.origin` → 관련 면 최근접 port 셀. |
| 3 | **P4 / P7 — 비용 노출** | 라우팅 tie-break에 belt 길이·꺾임 반영. 라우팅 비용 API 노출 필요(무거움, 후순위). |

> 셋 다 정확성(best-effort 보장)은 그대로 두고 **패킹·라우팅 품질만** 개선한다. 전역 최적(이분 매칭 등)은 아니지만, fail-first 순서만으로 "쉬운 게 어려운 걸 굶기는" 최악 케이스 대부분이 사라진다.
