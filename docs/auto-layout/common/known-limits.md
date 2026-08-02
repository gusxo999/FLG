---
tags: [auto-layout, placement, routing]
---

# 자동완성 위저드 — 알려진 약점 및 한계

> **부모 문서:** [auto-layout-wizard.md](../wizard.md) — 위저드 인터페이스
> **관련 문서:** [.placement-search](placement-search.md), [.s-layer-channel-reservation](../channel/s-layer-channel-reservation.md), [.entity-roles](entity-roles.md)

본 문서는 **현재 구현**(모듈 파이프라인 — [planner/moduleWizard.ts](../frontend/src/utils/autoLayout/planner/moduleWizard.ts), 진입점은 [layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts)) 가 제공하지 못하는 것을 정확히 기록한다. 각 항목에 (1) 증상, (2) 원인(코드), (3) 해결 방향, (4) 우선순위.

> 우선순위: **P0** 다음 마일스톤 / **P1** 베타 진입 전 / **P2** 정상 동작 시 개선 / **P3** 장기 백로그.
> 항목이 해결되면 해당 절을 삭제하고 우선순위 표를 갱신한다.
>
> **이력:** 과거 known-limits 는 폐기된 *둘레 슬롯 모델* / S-EXH(`containerWizard.ts`) 기준이었고 "fluid 미지원(P0)" 등은 현 코드와 맞지 않아 본 문서로 전면 재작성됨 (2026-06-09). fluid 는 현재 모듈 파이프라인의 트렁크 파이프 + 유체 홉으로 처리된다 ([[fluid-hop]] · [[trunk-pipe]]).

---

## 1. 클러스터 형태가 세로 기둥(column) 고정

**우선순위: P1**

**증상:**
- 같은 레시피 N대([[용어사전#클러스터 (cluster)|클러스터]])가 **무조건 한 열에 세로로만** 쌓인다.
- 입출력 포트가 많거나(재료 4종+ 등) **다중 fluid** 인 레시피(정유소 등)는 한 열에서 필요한 면을 다 확보하지 못해 트렁크 병합 실패·1:1 폴백·미관 저하가 발생.

**원인:**
- [module/clusterLayout.ts](../frontend/src/utils/autoLayout/module/clusterLayout.ts) `layoutCluster` 가 세로로만 쌓는다. 행/격자/머신+레인 타일 등 다른 형태가 없다.
- [[용어사전#기둥 (column)|기둥]]에서 안쪽 머신은 N/S 면을 이웃에게 뺏기고 W·E 면만 남는다([[용어사전#포트 기하|포트 기하]] 한계).

**해결 방향:**
1. **포트 수요 → 형태 선택기(shape selector)**: 노드별 needW/needE/needNS(면별 강제 포트 수 + fluidbox 고정면)를 산정해 컬럼 사다리에 안 들어오면 행/격자로 승급.
2. 파급: `modulePacking` 의 열 배치·채널 계획에 모두 반영 필요.

> **선행 조건이던 gap 문제는 해소됐다**(2026-07-25). 세로 간격은 이제 링크 면 계획에서
> 유도된다(`gapRowsFromPlans` → `layoutCluster(rowGaps)`, 기본 `MODULE_ROW_GAP = 0`).
> 형태 확장의 남은 축은 이 항목 하나다.

**실측 (2026-07-25, `plastic-bar` @ chemical-plant, 처리량 기준):**

| 목표 산출 | 머신 | 배치 크기 | 종횡비 |
|---|---|---|---|
| 1 개/초 | 1 | 13×7 | 1.9 : 1 |
| 4 개/초 | 2 | 13×10 | 1.3 : 1 |
| 8 개/초 | 4 | 13×16 | 1 : 1.2 |
| 40 개/초 | 20 | **13×64** | **1 : 4.9** |

폭은 13 에 고정된 채 높이만 선형으로 자란다. 머신 20대에서 이미 블루프린트가
64칸 세로로 늘어져 실사용이 어렵다 — 이 항목이 P1 인 이유가 수치로 확인된다.

---

## 2. 라우팅 occupancy 가 모든 셀 통과 불가 (belt/pipe mixing 미구현)

**우선순위: P2**

**증상:**
- 이미 깔린 벨트/파이프 위로 다른 라우팅이 지나갈 수 없다(벨트 2-lane 혼류, 같은 fluid 파이프 공유 불가).
- 채널/공간을 실제보다 보수적으로 점유 → 면적 증가, 빡빡한 경우 우회 길이 증가.

**원인:**
- [containerRouting.ts](../frontend/src/utils/autoLayout/containerRouting.ts) `buildOccupancy` 가 1차 단순화로 모든 placed 셀을 blocked 처리(주석에 명시).

**해결 방향:**
- belt-route 셀에 운반 item 종류 태깅 → 같은/호환 종류 통과 허용. fluid 는 같은 fluid 파이프 공유. C3 mixing 검사와 함께 도입.

---

## 3. 머신 회전이 유체에만 있다 · 아이템은 direction 0 고정

**우선순위: P2**

**증상:**
- **유체 머신은 회전한다**(2026-07-25) — `chooseMachineDirection` 이 유체 상자를 원하는 면(출력 W·입력 E)에 오게 하는 각도를 게임데이터에서 고른다. 못 맞추면 트리째 거절.
- 그러나 **아이템 전용 머신은 여전히 direction 0 고정**이다. 회전을 배치 품질(면 배분)의 자유도로 쓰지 않는다.
- fluid 입출력은 prototype 의 `fluid_boxes` 가 정의한 **고정 면 셀** 에만 닿을 수 있어, 기둥 클러스터에서 다중 fluid 머신을 서빙하기 어렵다(§1 과 연동).

**원인:**
- 유체 회전은 [module/fluidPorts.ts](../frontend/src/utils/autoLayout/module/fluidPorts.ts) `chooseMachineDirection` 이 푼다 — 단 **유체 상자를 그 면에 놓는 것**만 목표고, 아이템 면 배분은 고려하지 않는다.
- 아이템 쪽은 회전을 아예 후보로 두지 않는다.

**참고(이미 해결된 인접 항목):**
- *머신 footprint 다양화* 는 지원됨 — [layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts) 의 메타 수집이 `entity.tile_width/tile_height` 를 그대로 size 로 써 비-3×3(보일러 3×2, 사일로 9×9 등)도 배치된다. 다만 `EntityType` 매핑은 단순화(무한상자/파이프 외 전부 Assembler 타입, [machinePlacer.ts](../frontend/src/utils/autoLayout/execution/machinePlacer.ts) `machineEntityType`).

**해결 방향:**
- 아이템 머신도 회전 4방향을 후보로. 유체 회전(`chooseMachineDirection`)과 충돌하지 않게 **유체가 있는 노드는 유체가 각도를 정한다**는 현 규칙을 유지한 채 나머지 노드에만 자유도를 준다. §1 형태 선택기와 함께.

---

## 4. 카테고리당 첫 매칭 머신만 사용

**우선순위: P3**

**증상:**
- 조립기 1·2·3 을 모두 체크해도 카테고리에 맞는 **선택 목록상 첫 머신** 만 모든 노드에 사용. "후반만 조립기3" 같은 의도 표현 불가.

**원인:**
- [wizardUtils.ts](../frontend/src/utils/autoLayout/wizardUtils.ts) `makeMachinePicker` / `makeMachineParamsLookup` 가 `selectedMachines` 를 순회하며 `crafting_categories.includes(category)` 첫 일치 반환. 우선순위·레시피별 매핑·속도 정렬 없음.

**해결 방향:**
1. 머신 선택 UI 에 우선순위(drag-reorder) 또는 레시피별 매핑.
2. 기본 정렬 `crafting_speed` 내림차순.

---

## 5. 인서터 처리량·모듈이 머신 수 산정에 미반영

**우선순위: P3**

**증상:**
- 모듈(생산성/속도)은 전혀 모델링 안 됨(`productivityMultiplier = 1` 고정).

> **인서터 병목은 반영됐다**(2026-07-25). `assignThroughputCounts` 가 인서터를 함께 받아
> **굶주림 보상**을 건다 — 팔을 다 앉힐 자리가 없는 머신은 그만큼만 돌고(`speedFraction`),
> 부족분만큼 머신이 더 놓인다. 남은 건 모듈 modelling 뿐이라 항목을 그쪽으로 좁힌다.

**원인:**
- [wizardUtils.ts](../frontend/src/utils/autoLayout/wizardUtils.ts) `makeMachineParamsLookup` 가 `craftingSpeed` 만 사용, `productivityMultiplier=1` 고정.

**해결 방향:**
- 모듈 multiplier 를 `NodeMachineParams` 입력으로.

---

## 6. 후보 1개만 생성 (탐색·선택 없음)

**우선순위: P3**

**증상:**
- S-LAYER 는 결정적 단일 패스라 **후보를 1개만** 반환. 사용자가 여러 배치를 비교·선택할 수 없다.
- [[용어사전#O1|O1]](정사각형 근접)은 [[용어사전#squarenessPenalty|`squarenessPenalty`]] 로 *계산만* 되고 선택에 쓰이지 않는다.

**원인:**
- 설계상 단일 패스([placement-search.md](placement-search.md) §8). 다수 후보 전략(S-EXH/S-MEMO/S-DP)은 미구현.

**해결 방향:**
- 형태/순서 변주를 소수 생성하는 전략 추가, 또는 사용자 드래그로 사후 조정(드래그는 별도 기능).

---

## 7. 다중 부모 공유 자식 미처리

**우선순위: P3**

**증상:**
- 같은 ingredient 를 여러 부모가 요청해도 트리가 품목을 중복 전개해 각자 별도 라인을 만든다(공유 합류 없음).

**원인:**
- 트리 펼침이 DAG 가 아닌 트리. 공유 자식은 명시적 비-목표([placement-search.md](placement-search.md) §10.1).

**해결 방향:**
- DAG 합류(허브) 도입 시 채널의 더미/트렁크 메커니즘이 받쳐줌([s-layer-channel-reservation.md](../channel/s-layer-channel-reservation.md) §6).

---

## 8. 결정성 fuzz 테스트 부재

**우선순위: P3**

**증상:**
- 전 과정이 [[용어사전#결정성 (determinism)|결정적]]이라고 주장하지만 (입력→출력) snapshot 회귀/[[용어사전#fuzz 테스트|퍼즈 테스트]]가 없다. 단위 테스트는 channelPlanner·modulePacking 등 모듈 레벨만 존재.

**해결 방향:**
- `runLayeredWizard` 전체에 대한 입력→placed 스냅샷 회귀 테스트 추가.

---

## 9. Deprecated Dijkstra Guard — 드래그 재라우팅의 파이프는 합류 가드를 안 거친다

**우선순위: P2**

**증상:**

파이프는 벨트와 달리 **방향이 없다.** 닿기만 하면 남의 관망과 그냥 합쳐진다. 그래서 두 가지가 조용히 망가질 수 있다:

- **오염** — 다른 유체의 파이프가 옆을 스치면 두 관망이 한 관망이 된다.
- **유실** — 남의 머신 **출력** 유체 상자를 스치면 그 머신의 생산물이 이쪽 관망으로 빨려 나간다.

둘 다 그림상으론 멀쩡하고 라우팅도 "성공"으로 보고된다. 머신만 굶는다.

이걸 막는 가드([[용어사전#PipeFlow / collectPipeFlow|PipeFlow / collectPipeFlow]])는 **새 모듈 파이프라인에만** 걸려 있다. 옛 경로의 유체 라우팅([`emitFluidPath`](../frontend/src/utils/autoLayout/execution/emitPath.ts) — Dijkstra 로 파이프를 깐다)은 **무방비**다.

**해소됨 (2026-07-25):**

예고대로 "새 경로가 옛 경로를 완전히 흡수하면 이 항목은 통째로 사라진다" — 그렇게 됐다.
옛 S-LAYER 경로가 Phase 3 에서 삭제되면서 무방비로 파이프를 깔던 자리가 없어졌다.
유체는 이제 전부 모듈 파이프라인을 타며 `PipeFlow` 가드를 거친다. 계획 경로도 같은
지도를 본다(`plannedChainClear` 의 `fluidBlocked` —
[.fluid-hop-reservation §8.3](../channel/fluid-hop-reservation.md)).

> **다 사라진 건 아니다.** `execution/emitPath.emitFluidPath` 는 남아 있고, 사용자 드래그
> 재라우팅(`areaUnification`)이 그걸 부른다. **그 경로는 여전히 가드를 안 거친다** —
> 손으로 유체 상자를 끌어 다른 유체 관망 옆에 붙이면 조용히 오염된다. 범위가 줄었을 뿐이다.


**찾는 법:**

코드와 이 문서에 **`Deprecated Dijkstra Guard`** 라는 같은 표식이 박혀 있다. 유체 배치에서 원인 모를 오염·유실이 보이면 이 단어로 grep 하면 무방비인 자리가 전부 나온다.

---

## 우선순위 별 정리

| 우선순위 | 항목 |
|----------|------|
| **P1** | §1 클러스터 형태 기둥 고정 |
| **P2** | §2 belt/pipe mixing · §3 아이템 머신 회전 미지원 · §9 Deprecated Dijkstra Guard(드래그) |
| **P3** | §4 첫매칭 머신 · §5 모듈 미반영 · §6 단일 후보 · §7 공유 자식 · §8 결정성 테스트 |

> **해소되어 삭제된 항목 (2026-07-25 감사):**
> - ~~ROW_GAP 고정(3)~~ — 세로 간격이 링크 면 계획에서 유도된다(`gapRowsFromPlans`, 기본 0).
> - ~~트렁크 병합 v1 한계~~ — `clusterTrunkMerge`·`externalMergePass` 자체가 삭제됐다.
>   모듈 경로는 [[machine-link]] 링크 모델로 공급을 나눈다.
> - ~~collect 트렁크 코너 방향 반전 버그~~ — 처방대로 고쳐졌고, 그 뒤 씨앗 그리디
>   트렁크(`trunkEmit`) 자체가 삭제됐다(2026-07-26).
>
> 부분 해소되어 **범위를 좁힌** 항목: §3(유체는 회전한다) · §5(인서터 병목은 반영됐다) ·
> §9(옛 경로가 사라져 드래그 재라우팅만 남았다).
