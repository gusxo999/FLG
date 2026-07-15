---
tags: [auto-layout, placement, routing]
---

# 자동완성 위저드 — 알려진 약점 및 한계

> **부모 문서:** [auto-layout-wizard.md](auto-layout-wizard.md) — 위저드 인터페이스
> **관련 문서:** [.placement-search](auto-layout-wizard.placement-search.md), [.s-layer-channel-reservation](auto-layout-wizard.s-layer-channel-reservation.md), [.entity-roles](auto-layout-wizard.entity-roles.md)

본 문서는 **현재 구현 전략 `S-LAYER`** ([layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts)) 가 제공하지 못하는 것을 정확히 기록한다. 각 항목에 (1) 증상, (2) 원인(코드), (3) 해결 방향, (4) 우선순위.

> 우선순위: **P0** 다음 마일스톤 / **P1** 베타 진입 전 / **P2** 정상 동작 시 개선 / **P3** 장기 백로그.
> 항목이 해결되면 해당 절을 삭제하고 우선순위 표를 갱신한다.
>
> **이력:** 과거 known-limits 는 폐기된 *둘레 슬롯 모델* / S-EXH(`containerWizard.ts`) 기준이었고 "fluid 미지원(P0)" 등은 현 코드와 맞지 않아 본 문서로 전면 재작성됨 (2026-06-09). fluid 는 현재 1:1 파이프로 라우팅된다(§6 참고).

---

## 1. 클러스터 형태가 세로 기둥(column) 고정

**우선순위: P1**

**증상:**
- 같은 레시피 N대([[용어사전#클러스터 (cluster)|클러스터]])가 **무조건 한 열에 세로로만** 쌓인다.
- 입출력 포트가 많거나(재료 4종+ 등) **다중 fluid** 인 레시피(정유소 등)는 한 열에서 필요한 면을 다 확보하지 못해 트렁크 병합 실패·1:1 폴백·미관 저하가 발생.

**원인:**
- [layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts) 5단계가 `origin.x = colX[depth]` 고정, `origin.y` 만 증가시켜 배치. 행/격자/머신+레인 타일 등 다른 형태가 없다.
- [[용어사전#기둥 (column)|기둥]]에서 안쪽 머신은 N/S 면을 이웃에게 뺏기고 W·E 면만 남는다([[용어사전#포트 기하|포트 기하]] 한계).

**해결 방향:**
1. **포트 수요 → 형태 선택기(shape selector)**: 노드별 needW/needE/needNS(면별 강제 포트 수 + fluidbox 고정면)를 산정해 컬럼 사다리에 안 들어오면 행/격자로 승급.
2. 파급: 좌표 배치(4·5)·채널 계획(4c·4d)·트렁크 시드([trunkPath.ts](../frontend/src/utils/autoLayout/trunkPath.ts))에 모두 반영 필요 → §2(gap)를 먼저 정리한 뒤 형태 확장 권장.

---

## 2. 클러스터 세로 간격 `ROW_GAP` 이 포트와 무관하게 고정(3)

**우선순위: P2**

**증상:**
- 기둥 내 머신 사이가 항상 3칸 비어 세로 피치가 머신 높이의 2배(3×3 기준 6칸) → 면적 낭비.
- 옆면 트렁크/가로 채널은 세로 간격을 쓰지 않으므로 이 3칸은 대부분 빈칸으로 남는다.

**원인:**
- [layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts) `ROW_GAP = 3` 상수(인서터+벨트+인서터 최악값에서 유래). 실제 필요한 gap = "그 머신의 입출력 포트를 모두 제공하는 최소값" 인데 이를 산정하지 않는다.

**해결 방향:**
- **포트-버짓 기반 `rowGapOf(node)`**: needW/needE/needNS 로 gap 사다리(0=W·E만 / 1=인서터 / 2=+벨트레인 / 3=양면공유) 중 최소를 선택. 병합 여부는 needNS 계산의 입력으로만 사용.
- §1(형태)과 같은 문제의 두 축(세로 gap ↔ 형태). 컬럼 적응 gap → 형태 일반화 순서.

---

## 3. 트렁크 병합 v1 한계 — reach-1 · all-or-nothing · 스퍼 미구현

**우선순위: P2**

**증상:**
- 클러스터/외부 트렁크에서 머신 1대라도 직접 탭에 실패하면 **그룹 전체가 1:1 로 폴백**.
- 둘러싸여 직접 탭이 불가한 머신(`untapped`)을 우회 연결하는 스퍼가 없어 그냥 1:1.
- fluid 클러스터는 트렁크 병합 대상이 아님(아이템 전용 게이트) → 항상 1:1 파이프.

**원인:**
- [clusterTrunkMerge.ts](../frontend/src/utils/autoLayout/clusterTrunkMerge.ts) / [externalMergePass.ts](../frontend/src/utils/autoLayout/externalMergePass.ts) v1 가 `allowLongInserter:false`(reach-1) + `untapped>0 면 통째 폴백`. [trunkEmit.ts](../frontend/src/utils/autoLayout/trunkEmit.ts) `spursNeeded` 는 채워지지만 오케스트레이션이 소비하지 않음.

**해결 방향:**
1. `untapped` 머신용 스퍼(routeItem) 배치 → 부분 병합 허용.
2. reach-2(long inserter) 탭 활성화 검토(`allowLongInserter`).
3. fluid 트렁크(파이프 합류) 별도 설계.

---

## 4. collect 트렁크 코너 방향 반전 잠복 버그

**우선순위: P2 (정확성)**

**증상:**
- *굽은(bent)* collect 트렁크에서 코너 셀의 벨트 흐름 방향이 어긋날 수 있다. 현재 시드 로직이 직선 spine 을 강하게 선호해 거의 발현되지 않지만, 불규칙 레이아웃에서 가능.

**원인:**
- [trunkEmit.ts](../frontend/src/utils/autoLayout/trunkEmit.ts) collect 반전이 셀별 `reverseDir(c.dir)` 를 쓰는데, 굽은 경로의 코너 셀은 이 단순 반전이 경로를 벗어난 방향을 가리킨다.

**해결 방향:**
- 시프트 기반 반전: `dir = i===0 ? reverseDir(dirOf(f)) : reverseDir(path.trunkCells[i-1].dir)` 로 한 칸 당겨 반전.

---

## 5. 라우팅 occupancy 가 모든 셀 통과 불가 (belt/pipe mixing 미구현)

**우선순위: P2**

**증상:**
- 이미 깔린 벨트/파이프 위로 다른 라우팅이 지나갈 수 없다(벨트 2-lane 혼류, 같은 fluid 파이프 공유 불가).
- 채널/공간을 실제보다 보수적으로 점유 → 면적 증가, 빡빡한 경우 우회 길이 증가.

**원인:**
- [containerRouting.ts](../frontend/src/utils/autoLayout/containerRouting.ts) `buildOccupancy` 가 1차 단순화로 모든 placed 셀을 blocked 처리(주석에 명시).

**해결 방향:**
- belt-route 셀에 운반 item 종류 태깅 → 같은/호환 종류 통과 허용. fluid 는 같은 fluid 파이프 공유. C3 mixing 검사와 함께 도입.

---

## 6. 머신 회전 미지원 · fluidbox 고정면 제약

**우선순위: P2**

**증상:**
- 머신을 회전 배치하는 의도 표현 불가(항상 direction 0=N).
- fluid 입출력은 prototype 의 `fluid_boxes` 가 정의한 **고정 면 셀** 에만 닿을 수 있어, 기둥 클러스터에서 다중 fluid 머신을 서빙하기 어렵다(§1 과 연동).

**원인:**
- 배치가 회전을 결정 변수로 풀지 않음(0 고정). [portInference.ts](../frontend/src/utils/autoLayout/portInference.ts) `fluidPorts` 가 회전 0 positions 만 사용.

**참고(이미 해결된 인접 항목):**
- *머신 footprint 다양화* 는 지원됨 — [layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts) 가 `entity.tile_width/tile_height` 를 그대로 size 로 써 비-3×3(보일러 3×2, 사일로 9×9 등)도 배치된다. 다만 `EntityType` 매핑은 단순화(무한상자/파이프 외 전부 Assembler 타입, [machinePlacer.ts](../frontend/src/utils/autoLayout/machinePlacer.ts) `machineEntityType`).

**해결 방향:**
- 회전 4방향 후보 + fluidbox 회전별 positions 사용. §1 형태 선택기와 함께.

---

## 7. 카테고리당 첫 매칭 머신만 사용

**우선순위: P3**

**증상:**
- 조립기 1·2·3 을 모두 체크해도 카테고리에 맞는 **선택 목록상 첫 머신** 만 모든 노드에 사용. "후반만 조립기3" 같은 의도 표현 불가.

**원인:**
- [wizardUtils.ts](../frontend/src/utils/autoLayout/wizardUtils.ts) `makeMachinePicker` / `makeMachineParamsLookup` 가 `selectedMachines` 를 순회하며 `crafting_categories.includes(category)` 첫 일치 반환. 우선순위·레시피별 매핑·속도 정렬 없음.

**해결 방향:**
1. 머신 선택 UI 에 우선순위(drag-reorder) 또는 레시피별 매핑.
2. 기본 정렬 `crafting_speed` 내림차순.

---

## 8. 인서터 처리량·모듈이 머신 수 산정에 미반영

**우선순위: P3**

**증상:**
- 인서터가 bottleneck 이어도 처리량 모드의 머신 *대수* 는 머신 crafting_speed 만으로 산정 → 인서터/벨트 한계 무시.
- 모듈(생산성/속도)은 전혀 모델링 안 됨.

**원인:**
- [wizardUtils.ts](../frontend/src/utils/autoLayout/wizardUtils.ts) `makeMachineParamsLookup` 가 `craftingSpeed` 만 사용, `productivityMultiplier=1` 고정.
- 인서터 처리량 보정([inserterThroughput.ts](../frontend/src/utils/autoLayout/inserterThroughput.ts))은 *트렁크 용량 게이트*(§3)에는 흐르지만 머신 수에는 미반영.

**해결 방향:**
- 카운트 산정이 `min(machine_rate, inserter_rate)` 를 effective rate 로 사용 + 모듈 multiplier 입력.

---

## 9. 후보 1개만 생성 (탐색·선택 없음)

**우선순위: P3**

**증상:**
- S-LAYER 는 결정적 단일 패스라 **후보를 1개만** 반환. 사용자가 여러 배치를 비교·선택할 수 없다.
- [[용어사전#O1|O1]](정사각형 근접)은 [[용어사전#squarenessPenalty|`squarenessPenalty`]] 로 *계산만* 되고 선택에 쓰이지 않는다.

**원인:**
- 설계상 단일 패스([placement-search.md](auto-layout-wizard.placement-search.md) §8). 다수 후보 전략(S-EXH/S-MEMO/S-DP)은 미구현.

**해결 방향:**
- 형태/순서 변주를 소수 생성하는 전략 추가, 또는 사용자 드래그로 사후 조정(드래그는 별도 기능).

---

## 10. 다중 부모 공유 자식 미처리

**우선순위: P3**

**증상:**
- 같은 ingredient 를 여러 부모가 요청해도 트리가 품목을 중복 전개해 각자 별도 라인을 만든다(공유 합류 없음).

**원인:**
- 트리 펼침이 DAG 가 아닌 트리. 공유 자식은 명시적 비-목표([placement-search.md](auto-layout-wizard.placement-search.md) §10.1).

**해결 방향:**
- DAG 합류(허브) 도입 시 채널의 더미/트렁크 메커니즘이 받쳐줌([s-layer-channel-reservation.md](auto-layout-wizard.s-layer-channel-reservation.md) §6).

---

## 11. 결정성 fuzz 테스트 부재

**우선순위: P3**

**증상:**
- 전 과정이 [[용어사전#결정성 (determinism)|결정적]]이라고 주장하지만 (입력→출력) snapshot 회귀/[[용어사전#fuzz 테스트|퍼즈 테스트]]가 없다. 단위 테스트는 trunkPath·mergeGrouping·channelPlanner 등 모듈 레벨만 존재.

**해결 방향:**
- `runLayeredWizard` 전체에 대한 입력→placed 스냅샷 회귀 테스트 추가.

---

## 12. Deprecated Dijkstra Guard — 옛 경로의 파이프는 합류 가드를 안 거친다

**우선순위: P2**

**증상:**

파이프는 벨트와 달리 **방향이 없다.** 닿기만 하면 남의 관망과 그냥 합쳐진다. 그래서 두 가지가 조용히 망가질 수 있다:

- **오염** — 다른 유체의 파이프가 옆을 스치면 두 관망이 한 관망이 된다.
- **유실** — 남의 머신 **출력** 유체 상자를 스치면 그 머신의 생산물이 이쪽 관망으로 빨려 나간다.

둘 다 그림상으론 멀쩡하고 라우팅도 "성공"으로 보고된다. 머신만 굶는다.

이걸 막는 가드([[용어사전#PipeFlow / collectPipeFlow|PipeFlow / collectPipeFlow]])는 **새 모듈 파이프라인에만** 걸려 있다. 옛 경로의 유체 라우팅([`emitFluidPath`](../frontend/src/utils/autoLayout/containerRouting.ts) — Dijkstra 로 파이프를 깐다)은 **무방비**다.

**왜 일부러 놔뒀나:**

옛 경로는 폐기 대상인데 골든 스냅샷이 걸려 있어, 손대면 아이템 배치까지 회귀 위험을 진다. 새 경로가 옛 경로를 완전히 흡수하면 이 항목은 통째로 사라진다.

**찾는 법:**

코드와 이 문서에 **`Deprecated Dijkstra Guard`** 라는 같은 표식이 박혀 있다. 유체 배치에서 원인 모를 오염·유실이 보이면 이 단어로 grep 하면 무방비인 자리가 전부 나온다.

---

## 우선순위 별 정리

| 우선순위 | 항목 |
|----------|------|
| **P1** | §1 클러스터 형태 기둥 고정 |
| **P2** | §2 ROW_GAP 고정 · §3 트렁크 v1 한계 · §4 collect 코너 버그 · §5 belt/pipe mixing · §6 회전/fluid면 · §12 Deprecated Dijkstra Guard |
| **P3** | §7 첫매칭 머신 · §8 인서터/모듈 미반영 · §9 단일 후보 · §10 공유 자식 · §11 결정성 테스트 |
