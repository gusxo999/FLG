> 상태: **진행 중** — Step 1 ✅ · Step 2 ✅ (2026-09-03).
>
> 낱말은 되찾았다: 축은 **`clusterBeltDepth`**, 반출·채널 세로줄은 **`track`**,
> **"레인" 은 게임의 좌/우 두 줄 전용**이다. 식별자 `lane` 은 저장소에 없다
> (남은 것은 게임 레인을 말하는 자리와 이력 인용뿐 — 계획서 Step 2).
>
> **다음은 Step 3**(`laneThroughput` = 줄 용량 ÷ 2). 그 뒤 Step 4 가 첫 실물이다.

# 벨트-레인 — 공통 컨텍스트

**한 문장:** 벨트 한 줄이 실제로 가진 **좌/우 두 레인**을 모델에 들여, 45/s 한 줄이
**22.5 + 22.5** 로 서로 다른 두 품목을 나르게 한다.

이름은 이미 있다 — [용어사전 `MixedItemBelt`](../../docs/용어사전.md) (2026-07-14 사용자
명명, **미구현**). 이 폴더는 그 항목을 실물로 옮기는 일이다.

## "레인" 은 게임의 좌/우 두 줄**만** 뜻한다 — Step 2 로 되찾았다

한때 코드가 세 가지를 다 "레인"이라 불렀다: **깊이**(면에서 바깥 몇 칸) · **반출 트랙** ·
게임 레인. 용어사전이 이 충돌을 미리 경고해 뒀고(`§ClusterBelt` — *"depth 3 레인의 벨트의
오른쪽 레인 같은 말이 나와 반드시 깨진다"*), **2026-09-03 에 걷어냈다**:

```
깊이        clusterBeltDepth · claimDepth · depthClear · depthBudget.ts · DepthShortage
반출·채널   perimeterTrackPlanner.ts · TrackAssignment · trackX · perimeter/tracks.ts
레인        게임의 좌/우 두 줄. 식별자로는 안 쓴다(`side: "left" | "right"`)
```

식별자 `lane` 은 저장소에 없다. 한글 "레인"이 남은 곳은 **게임 레인을 말하는 자리**와
**삭제된 것의 이력 인용**뿐이다(계획서 Step 2 의 표).

## 착수 전 반드시 읽을 것

**문서 — 이 기능이 이미 적혀 있는 자리 넷:**

- `docs/용어사전.md` §`MixedItemBelt` · §`레인 (lane)` · §`mixing` · §`occupancy` ·
  §`split belt` (**레인과 다른 축이다** — 계획서 §1 의 표)
- `docs/auto-layout/common/entity-roles.md` §C — *"두 lane 의 의미"* 문단.
  **입력/출력 비대칭의 원문이 여기와 용어사전에 있다**
- `docs/auto-layout/common/known-limits.md` §2(P2, belt/pipe mixing) · §10(면당 깊이 부족)
- `docs/auto-layout/common/placement-search.md` §10.1 — **splitter 는 비-목표**다

**코드 — 호출 사슬 순서대로:**

- `src/autoLayout/beltThroughput.ts` — `480 = belt_speed × 2레인 × 4 × 60`.
  **오늘의 모든 용량 수치가 이미 「두 레인 합」이다**
- `src/autoLayout/module/link.ts` — `createLinks` 의 붓기(`cap: tier.throughput`) ·
  `Link.carries` 불변식(`Σ rate ≤ 그 벨트의 처리량`)
- `src/autoLayout/planner/module/linkPlanner.ts` — `LinkFacePlan.clusterBeltDepth`(= 깊이)
- `src/autoLayout/execution/module/emitModule.ts` — `emitInputLinks`(공급 줄을 까는 곳)
- `src/autoLayout/planner/deliveryRoute.ts` — `seatIsBeltFeeder`/`stripKeys`.
  **경계 인서터가 떨어져 belt→belt 가 된다** = 레인이 모듈 경계를 넘어 산다
- `src/autoLayout/planner/containerRouting.ts` — `collectBeltFlow`·`beltFlowConflictCell`.
  **오늘 「오염」이라 부르는 그 기하가 곧 레인 합류다**
- `src/analysis/beltFlow.ts` — 벨트 정적 분석. *"한 벨트 = 1품목"* 근사와 `(혼합)` 표시.
  **레인을 아는 순간 그 근사가 풀린다**(Step 5)
- `src/autoLayout/debugFlags.ts` · `src/UI/components/AutoLayoutDebugTab.tsx` —
  Step 6 의 플래그가 설 자리. 관용구는 `AUTO_LAYOUT_LINK_LADDER`(미완성 기능 = 기본 꺼짐)

## 이 계획이 **하지 않는** 것

- **출력(collect) 쪽 레인** — 기하가 불가능하다고 답한다(계획서 §4). Step 6 의
  「가까운 레인 드랍」 플래그가 그 문을 열지만, **문만 연다** — 그 위에 배치를 얹는
  것은 이 계획 밖이다.
- **지하벨트 끝에서의 사이드로드** — 되는지 모른다. 계획서 §5 가 *"합류 칸은 지상
  벨트"* 로 **막아서** 답을 몰라도 되게 한다. 불가능 판정이 아니라 조인 것이다.
- **splitter** — `placement-search` §10.1 의 비-목표. 레인 밸런서·우선순위 분배 전부.
- **known-limits §2 의 「같은 품목 합류」** — 이미 깔린 벨트에 같은 품목이 올라타는 것.
  같은 "belt mixing" 이라는 말 아래 있지만 **다른 기전**이다(합류 vs 레인 분리).
- **유체** — 파이프에 레인이 없다(`docs/factorio/pipe-semantics.md`).
- **한 줄에 셋 이상** — 레인은 둘뿐이다. 3품목은 줄을 늘린다.
- **지하벨트 티어 맞추기** — `ModulePort.beltEntityName` 이 모듈 밖에서 안 쓰이는 문제는
  `tempPlanDocs/배선-형태/` 소관이고, 레인은 그 위에 얹힌다.

## 공통 전제 (썩는지 감시할 것)

| 전제 | 확인 방법 | 확인일 |
|---|---|---|
| **레인 물리 일곱** — 드랍=먼 레인 · 픽업=양 레인 · **사이드로드 접힘** · 지하 보존 · 직진 1:1 · **곡선=유입 하나** · **여유 있어야 올라탄다** | 사장님 확정 → 계획서 §2 (Step 1 이 `docs/factorio/belt-lane-semantics.md` 로 옮긴다) | 2026-09-03 ✔ |
| 합류 칸은 **뒤 유입이 없어야** 한다(⑤⑦) — 있으면 옆 쪽이 조용히 굶는다 | 계획서 §5 의 조건 셋 | 2026-09-03 ✔ |
| 용량 수치는 전부 **두 레인 합**이다(`× 480`) | `beltThroughput.ts` 머리말 · 프로토타입 문서 `speed × 480` | 2026-09-03 ✔ |
| 링크 포트의 경계 인서터는 납품 경로가 **뗀다**(belt→belt) | `deliveryRoute.stripKeys` · `seatIsBeltFeeder` | 2026-09-03 ✔ |
| 모듈 면 벨트는 **한쪽에만** 머신이 있다(기둥 모델) | `layout-models.md` ① · `emitInputLinks` 의 `faceCell(…, d, t)` | 2026-09-03 ✔ |
| 인서터 필터는 **블루프린트로 안 나간다** — `GridCell` 에 자리가 없다 | `types/layout.ts` `GridCell` · `Toolbar.tsx` 의 export 필드 목록 | 2026-09-03 ✔ |
| 게임데이터에 `filter_count` 가 **없다** | `scripts/export-gamedata.lua` 의 `t == "inserter"` 블록 | 2026-09-03 ✔ |
| 기준선 = 타입 0 · **52파일 615테스트 · 기존 실패 2건**(trunkPipe 유체 면) | `npx tsc -p tsconfig.app.json --noEmit` · `npx vitest run` | 2026-09-03 ✔ |
