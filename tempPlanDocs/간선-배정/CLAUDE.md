> 상태: **진행 중** — Step 1~5 완료. **되먹임 0 · `generateModule` 1회.**
> **Step 6 만 남았고 D2·D5 합의 대기**(계획서 §5).
> (2026-08-29 재구성. 옛 이름 `포트자리-순서` 를 대체한다)

# 간선-배정 — 공통 컨텍스트

**한 문장:** 링크 배정의 **루프 축을 모듈에서 간선으로** 바꿔, 링크의 **양끝을 한 자리에서**
정하게 한다. 그러면 되먹임 둘이 **구조적으로** 사라진다.

## 착수 전 반드시 읽을 것

- `docs/auto-layout/module/module-planning.md` **§4.6** — 포트 위치를 정하는 것 전부
- 같은 문서 **§4.5** — 면 좌석표(`FaceTable`)
- `docs/auto-layout/link/machine-link.md` — 사다리 1단 · **무엇을 재나**
- 코드: `planner/module/linkPlanner.ts`(배정) · `planner/module/planModulePorts.ts`(①②③③′
  순서) · `planner/modulePacking.ts`(P0~P7) · `module/clusterModule.ts:260`(계획/방출 경계)

## 실측을 전제로 하지 않는다

단계마다 다는 *불변*은 **기전**이다 — 코드를 읽어 확인되는 것이지 실물 트리에서 수를
재서 확인하는 것이 아니다. 실측은 **개념으로 못 가르는 것이 남았을 때의 최후 수단**이다.

## 이 계획이 **하지 않는** 것

- **좌표를 보는 것.** 모듈은 여전히 위치를 모른다 — *"자기 모듈만 본다"* 는 **좌표**에
  대한 규율로 남긴다. 바뀌는 것은 **링크**에 대한 규율뿐이다.
- **`FaceTable` · `tryLinkFace` · `commitLinkFace` 의 내부.** 루프 축만 바꾼다.
- **fan-out**(한 머신에 벨트 여럿) — `allocateFlows`·`createLinks` 의 몫이다.
  이 계획의 축은 **트렁크 ↔ 다이렉트**다(계획서 §0).
- **사다리 2·3단**(gap · 다이렉트) · `insertingPlanner` 통합 · 채널/납품 알고리즘.

## 공통 전제 (썩는지 감시할 것)

| 전제 | 확인 방법 | 확인일 |
|---|---|---|
| `planModulePorts` 는 방출을 안 하는 순수 함수다 | `clusterModule.ts:260` 아래가 전부 방출 | 2026-08-29 ✔ |
| ① → ③ 전달이 `seatRowsUsed` 하나로 좁다 | `planModulePorts.ts:287` · `clusterPortPlanner.ts:220` | 2026-08-29 ✔ |
| `FaceTable` 은 값이다(복사 가능) | `faceTable.ts` `copyFaceTable` | 2026-08-29 ✔ |
| 기준선 = 타입 0 · **52파일 631테스트 · 기존 실패 2건**(trunkPipe 유체 면) | `npx tsc -p tsconfig.app.json --noEmit` · `npx vitest run` | 2026-08-29 ✔ |
