> 상태: **승인 대기** (2026-09-01 작성 · 2026-09-01 **범위 재설정**)

# 계획-배정-개념정리 — 공통 컨텍스트

**한 문장:** 자동 배치의 **모든 기능**이 *"무엇을 수로 세고, 무엇을 자리로 적나"* 를 각자
다르게 갈라 놨다. 그 경계를 **전수로 적고**, 순환을 끊는 처방을 **공통 규칙**으로 세운다.

## 범위 재설정 (2026-09-01)

> **처음엔 모듈 경로 하나만 봤다.** 그래서 계획이 *"낡은 `planClusterPorts` 를 지운다"* 로
> 좁아졌다 — 그건 **개념 정리가 아니라 변경**이다. 삭제는 원래 주인인 `부분-트렁크` ⑤ 로
> 돌려보내고, 이 계획은 **일곱 기능의 전수 정리**를 맡는다(`조사-기능별-계획배정.md`).

```
이 계획이 낸다   기능마다의 경계표  +  순환 처방 셋  +  공통 규칙
이 계획이 안 낸다  코드 변경.  변경은 각 기능의 계획이 가져간다
```

**끝나면 `docs/auto-layout/common/` 으로 옮긴다** — 코드를 바꿔야 무효가 되는 **사실**이므로
(`docs/CLAUDE.md` Q2 통과). `layout-models.md` 의 자매 문서다:
그쪽이 *"무엇을 그릴 수 있나"* 면, 이쪽은 ***"언제 정하나"*** 다.

## 착수 전 반드시 읽을 것

- **`조사-기능별-계획배정.md`**(이 폴더) — 일곱 기능 전수표와 처방 셋. **먼저 읽는다**
- **`docs/auto-layout/common/layout-models.md`** §2(모델마다) · §3.5(자원과 우선권)
- **`docs/auto-layout/common/code-folders.md`** — 축 1 이 이미 **계획 vs 실행**이다
- **`docs/auto-layout/module/trunk-assignment.md`** §0 구현 상태 · §3 배정 여섯 단계 · TR1
- `docs/auto-layout/module/module-planning.md` §4.5(면 좌석표) · §4.6(포트 위치) ·
  **§5(남는 비대칭 — 장부 낟알이 다르다)**
- 코드 — **머리말 주석이 설계 의도의 단일 출처다.** 본문보다 먼저 읽는다
  - 처방 1: `planner/channelPlanner.ts` · `planner/perimeterLanePlanner.ts`
  - 처방 2: `planner/channelGeometryPlanner.ts` (폭 역전)
  - 처방 3: `planner/rowChannelPlanner.ts` (순환 · 축 가르기 · 두 패스)
  - 처방 없음: `planner/module/planModulePorts.ts` · `module/link.ts`

## 이 계획이 **하지 않는** 것

- **코드 변경 전부** — 이 계획의 산출은 문서다
- **`planClusterPorts` 삭제** — `부분-트렁크` ⑤ 의 몫. 조사만 `조사-planClusterPorts.md` 에 남긴다
- **방출** — 좌표 단계의 경계는 `code-folders.md` 축 1 이 이미 맡는다
- **gap 능력 확장**(가로 벨트가 머신 여러 대) — 격자 클러스터의 몫, 범위 밖

## 실측을 전제로 하지 않는다

단계마다 다는 *불변*은 **기전**이다 — 코드를 읽어 확인되는 것. 실측은 개념으로 못 가르는
것이 남았을 때의 최후 수단이다.

## 공통 전제 (썩는지 감시할 것)

| 전제 | 확인 방법 | 확인일 |
|---|---|---|
| 채널·반출은 **폭까지만** 세고 트랙 index 는 라우터가 정한다 | `channelPlanner` · `perimeterLanePlanner` 머리말 | 2026-09-01 ✔ |
| 채널 기하는 **배정을 먼저 하고 폭을 결과로** 낸다(폭 역전) | `channelGeometryPlanner` 머리말 §6 | 2026-09-01 ✔ |
| 행 채널은 **순환**을 알고 두 패스로 끊기로 적어 뒀다 | `rowChannelPlanner` 머리말 | 2026-09-01 ✔ |
| 벨트는 **자기 좌석 구간만** 덮고 끝에서 꺾는다 → 행이 안 겹치면 레인 공유 | `LinkFacePlan.laneDepth` 머리말 · `laneClear` | 2026-09-01 ✔ |
| 팔 수는 `g` 와 **무관**하다 | `armsFromCarries` | 2026-08-31 ✔ |
| `PlannedLine[]`(지도 A 의 산출)은 **아무도 안 읽는다** | `rest: { ok:true, lines: [] }` | 2026-08-30 ✔ |
| gap 은 `g = 1` 만 받는다 | `tryLinkFace` 의 `machinesOn !== 1` | 2026-08-30 ✔ |
| 기준선 = 타입 0 · **53파일 647테스트 · 기존 실패 2건**(trunkPipe 유체 면) | `npx tsc -p tsconfig.app.json --noEmit` · `npx vitest run` | 2026-08-31 ✔ |
