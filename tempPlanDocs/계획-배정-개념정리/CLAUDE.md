> 상태: **승인 대기** (2026-09-01 작성)

# 계획-배정-개념정리 — 공통 컨텍스트

**한 문장:** 같은 면을 보는 **지도가 둘**이고(선반 · 격자), 둘이 안 맞아 한쪽의 답이
버려진다. 지도를 **하나로** 만든다.

이 계획은 **`부분-트렁크` 의 앞에 선다** — 거기서 막힌 ⑤(모듈 판정의 산출이 접힌다)가
이 어긋남의 증상이기 때문이다.

## 착수 전 반드시 읽을 것

- **`docs/auto-layout/module/trunk-assignment.md`** — 배정 모델 본문.
  특히 **§0 구현 상태**(모델이 코드보다 앞서 있다) · §2 수요 · §3 배정 여섯 단계
- `docs/auto-layout/module/module-planning.md` §3(좌표의 경계) · §4.5(면 좌석표) ·
  §4.6(포트 위치를 정하는 것 전부) · **§5(남는 비대칭 — 장부 낟알이 다르다)**
- 코드 — 지도 A: `planner/module/clusterPortPlanner.ts`(`laneSlots` · `slotsOf` · `takeSeat`)
       · 지도 B: `planner/module/faceTable.ts` · `linkPlanner.ts`(`tryLinkFace`)
       · 두 지도가 만나는 곳: `planner/module/planModulePorts.ts`

## 이 계획이 **하지 않는** 것

- **방출** — 좌표 단계는 안 건드린다
- **gap 능력 확장**(가로 벨트가 머신 여러 대) — 격자 클러스터의 몫, 범위 밖
- **채널·납품 경로** · **유체 트렁크 파이프**

## 실측을 전제로 하지 않는다

단계마다 다는 *불변*은 **기전**이다 — 코드를 읽어 확인되는 것. 실측은 개념으로 못 가르는
것이 남았을 때의 최후 수단이다.

## 공통 전제 (썩는지 감시할 것)

| 전제 | 확인 방법 | 확인일 |
|---|---|---|
| 벨트는 **자기 좌석 구간만** 덮고 끝에서 꺾는다 → 행이 안 겹치면 레인 공유 | `LinkFacePlan.laneDepth` 머리말 · `laneClear` | 2026-09-01 ✔ |
| 팔 수는 `g` 와 **무관**하다(머신은 `g` 가 얼마든 자기 몫을 다 받는다) | `armsFromCarries` | 2026-08-31 ✔ |
| `PlannedLine[]`(지도 A 의 산출)은 **아무도 안 읽는다** | `rest: { ok:true, lines: [] }` · `rg supply.plan` | 2026-08-30 ✔ |
| gap 은 `g = 1` 만 받는다 | `tryLinkFace` 의 `machinesOn !== 1` | 2026-08-30 ✔ |
| 기준선 = 타입 0 · **53파일 645테스트 · 기존 실패 2건**(trunkPipe 유체 면) | `npx tsc -p tsconfig.app.json --noEmit` · `npx vitest run` | 2026-08-31 ✔ |
