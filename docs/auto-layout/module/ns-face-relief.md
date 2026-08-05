---
tags: [auto-layout, placement, routing]
---

# 노출 N/S 면 완화 — count=1 클러스터의 raw 입력 슬롯

> **부모 문서:** [auto-layout-wizard.placement-search.md](../common/placement-search.md) — 모델·전략 단일 출처

---

## 0. 한 줄 요약

count=1(퇴화 기둥) 모듈의 **raw 입력**은 W/E 레인이 넘칠 때 W-spill 대신 **노출된
끝면(N/S)의 레인**을 받는다(E → N/S → W) — 상자가 부모-납품 경로가 붐비는 채널 쪽에 태어나
⑥C perimeter 재배치에서 갇히는 문제(kr-glass 사례)의 원인 치료.

## 1. 문제/배경

모듈 파이프라인의 슬롯 배정([clusterPortPlanner](../../../src/autoLayout/planner/module/clusterPortPlanner.ts))은
기둥 클러스터 가정 하에 **W/E 두 면만** 썼다. 레인은 기둥 축을 따라 달려야 N대
전부를 서빙하므로 N/S(축의 끝면)는 스케일이 안 되기 때문이다. 그러나 count=1이면
이 논리가 퇴화한다 — 4면이 전부 동등한데 관례상 2면을 버리고, 입력 3개 레시피에서
마지막 입력이 W로 spill 된다.

**실측 사례 (advanced-circuit 트리, 2026-07-07):** kr-electronic-components(count=1)의
kr-glass 입력이 W depth3/긴팔로 spill → 상자가 W면 anchor 에 생성 → 같은 모듈의 출력
납품 경로가 채널의 모듈-인접 열을 관통(row 전체 차단) → ⑥C 채널 스캔 16오프셋 전부 첫 칸에서
실패(`no free lane track in channel`) → 상자가 블루프린트 내부에 잔류.

## 2. 결정

1. **허용 범위 — count=1의 raw 입력만.** 내부 간선(납품 경로로 대체될 라인)·출력은 W/E
   유지(납품 경로 기하·합성 로직 무변경). count≥2 끝머신 개방은 "전 머신 공급" 불변식이
   깨져 별도 스퍼 설계가 필요 — 기각.
2. **풀 순서 — E → 노출 N/S → W.** 기존 E 배정 불변(diff 최소), W-spill 만 최후로.
   N/S 최우선안은 E-마진 직출도 이미 싼 탈출이라 실익 없이 diff 만 커져 기각.
3. **노출 판정 — 열의 끝 + 그 방향 전역 마진.** depth 열 내 세로 순서는 tidy-tree 가
   DFS 방문 순서를 보존하므로 **좌표 확정 전에** 트리 구조에서 유도한다(순환 없음).
   열의 첫 모듈=N, 마지막=S, 단독=둘 다. 중간 모듈(위아래가 형제)은 미지원.
4. **용량 게이트 불변.** N/S 는 배치를 개선할 뿐, W/E 로 불가능하던 레시피를
   가능하게 하지 않는다(complex 판정 보수 유지).

   > **2026-08-05 — 이 결정은 [[용어사전#탭 인서팅 (Tap Inserting)|탭]]에만 남는다.**
   > 근거는 *"기둥 축과 수직인 벨트는 끝 머신 한 대만 서빙한다"* 였고, 그건 **벨트를 여러
   > 머신이 나눠 쓸 때만** 참이다. [[용어사전#기계별 포트 (구 "다이렉트 인서팅")|기계별 포트]]는
   > 줄을 머신마다 쪼개므로 가로 벨트가 한 대만 먹여도 아무 문제가 없다 — 그래서 그 경로는
   > **W/E 가 다 차면 gap 으로 넘어간다**(링크가 원래 하던 `spillLinkFacesToGap` 을 그대로 탄다).
   > 탭은 여전히 W/E 뿐이고, 여기 §2의 `nsExposure`(count=1 완화)도 탭 경로 그대로다.
   > → [[machine-link]] · `clusterModule.test.ts` "W/E 가 다 차면 위/아래로 넘어가고…"
5. **⑥A 변 판정 = `meta.side` 단일 출처.** N/S 레인의 chest 는 트렁크가 레인을 따라
   수평으로 자라 **코너 어깨**(x·y 둘 다 bbox 밖)에 앉을 수 있어, 기하 추측(X변 우선)이
   W/E 로 오분류 → self-N 직진 대신 채널 우회로 배정되는 낭비/실패. planner 슬롯을
   그대로 쓴다.

## 3. 실데이터 근거

같은 트리 실측(min count, 3모듈 전부 count=1): kr-glass 슬롯 W3/긴팔 → **N2/일반**,
⑥A 배정 channel(실패) → **self-N**, 상자 최종 위치 = 전역 N perimeter 행(직진 1칸,
jog 0). skip 3→2(합성 골든 기준), 후보 penalty 22→20.

## 4. 구현 위치

- [clusterPortPlanner.ts](../../../src/autoLayout/planner/module/clusterPortPlanner.ts) —
  `PlannedSide`(W/E/N/S), `IoLine.external`, `PortPlannerInput.nsFaces`, 입력 풀 소비
  순서(E→N/S→W), depth 재배정 루프 N/S 포함.
- [clusterModule.ts](../../../src/autoLayout/module/clusterModule.ts) —
  `ModuleInput.nsExposure` → planner `nsFaces` 전달. 트렁크는 기존 faceConstraints
  경로 그대로(N/S 면 탭은 `tapCandidates` 가 원래 지원).
- [modulePacking.ts](../../../src/autoLayout/planner/modulePacking.ts) —
  `nsExposureOf`(DFS 열-내 서열), `toModuleInput` 의 external 마킹(childFed 판정),
  `planLanes` 의 변 판정을 `meta.side` 로 교체.
- [containerModel.ts](../../../src/autoLayout/containerModel.ts) —
  `ModulePortMeta.side` 확장('W'|'E'|'N'|'S').

## 5. 남은 것 (이 문서 범위 밖)

- **조각 C(납품 경로 지하벨트) 완료(2026-07-08):** 납품 경로 emit 을 `execution/emitPath.emitItemPath`
  (edge-aware)로 통일하고 `maxJump` 를 config 게이트로 재활성 — 점프 경로가 지하벨트
  입/출구로 materialize 되고 corridor 가 납품 경로 간 누적·Area 에 기록된다. 정책: `'length'`
  비용(지상 우선, 점프=충돌 회피 전용) + 양 끝 셀 점프 방향 강제(`requiredStartJump`=
  트렁크 유입 +fv / `requiredEndJump`=유출 −fv — 누수·half-lane 방지). 탐색 자체는
  entrance/exit-straight 를 원래 보장. [deliveryRoute.ts](../../../src/autoLayout/planner/deliveryRoute.ts).
  **브라우저 실측(2026-07-08, advanced-circuit):** min(3대) — kr-glass N perimeter self 직진
  유지, skip 1(copper-cable channel), 회귀 없음. 처리량 20/초(64대) — 후보 성공(penalty=82,
  실패 0), 상자 7 중 5 재배치 / skip 2 는 전부 `N/S-side channel divert unsupported`
  (n0 copper-cable·n1 kr-glass, 둘 다 S면 channel — count≥2 라 본 문서의 N/S 완화 비적용).
  지하벨트 실사용 0 — 두 트리 모두 납품 경로 지상 경로가 뚫려 있어 `'length'` 정책대로 점프가
  선택되지 않음(점프 동작 자체는 벽 주입 단위 테스트로 검증). 즉 C 는 예비 능력으로
  대기 상태이고, 처리량 모드의 kr-glass 갇힘은 조각 B 가 치료 대상.
- **⑥C+ (조각 B) — 해결(2026-07-11):** count≥2 기둥의 끝단 상자(face N/S)가 채널 우회
  미지원으로 skip 되던 문제를 방출 단계에서 두 부분으로 치료했다. **planner 는 그대로**
  (planPerimeterLanes 는 여전히 meta.side 로 배정) — 좌표 확정 전이라 어느 방향이 뚫렸는지
  알 수 없기 때문. 대신 occ 를 아는 ⑥C 방출기를 고쳤다:
  1. **laneX 구동 jog**([perimeterRouter.ts](../../../src/autoLayout/planner/perimeterRouter.ts)):
     채널 반출의 가로 진입 방향을 `port.face` 의 fv.x 대신 확정된 `laneX−anchor.x` 부호로
     정한다. face 가 N/S(fv.x=0)여도 laneX 가 있으면 elbow 를 그대로 재생 — 옛
     `N/S-side channel divert unsupported` 무조건 거부 제거(kr-glass 류 해소).
  2. **auto 폴백**([modulePerimeterPass.ts](../../../src/autoLayout/execution/modulePerimeterPass.ts)):
     예약 배정이 실제로 막힌 경우(코너 어깨 상자의 채널 우회가 **자기 트렁크를 관통** —
     planner 가 못 본 충돌, copper-cable 사례) hint 없는 auto 탐색으로 폴백해 열린 변(대개
     face 직진)으로 내보낸다. 납품 경로의 dijkstra 최후폴백과 대칭이고, skip 을 재배치로만 바꿔
     겹침 0·회귀 0. 실측(advanced-circuit 동형, count 1~8): 상자 7개 전부 재배치, skip 0.
  - **남은 trade-off:** copper-cable 의 예약된 채널 트랙은 auto 폴백이 다른 변으로 나가면
    **쓰이지 않고 폭만 낭비**된다. planner 가 뚫린 face 를 먼저 고르는 근본 치료는 좌표 후
    점유를 봐야 가능 — 후속 과제. 회귀 테스트: [modulePerimeterPass.test.ts](../../../src/autoLayout/execution/modulePerimeterPass.test.ts) "count≥2 코너 어깨".
