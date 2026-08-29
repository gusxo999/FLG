> 상태: **승인 대기** (2026-08-29 재구성. 옛 이름 `포트자리-순서` 를 대체한다)

# 간선-배정 — 공통 컨텍스트

**한 문장:** 링크 배정의 **루프 축을 모듈에서 간선으로** 바꿔, 링크의 **양끝을 한 자리에서**
정하게 한다. 그러면 되먹임 둘이 **구조적으로** 사라진다.

## 폴더 구성 — 계획 하나 + **사실 문서 셋**

```
간선-배정.md      ← 계획서. 정의 · 목표 상태 · 6단계
조사-되먹임.md    ← 사실: 파이프라인 전체의 고리 전수(둘) · 판정 절차
조사-짝.md        ← 사실: Link 생애 주기 · P0~P7 시점표 · 왜 거리가 아니라 교차인가
조사-순서.md      ← 사실: 먼저/늦게 온 그룹이 먹는 자리 · 못이 생기는 기전
```

**셋은 계획이 아니라 조사 결과다.** 계획이 폐기돼도 사실은 남으므로, 실행이 끝나면
`docs/` 로 옮길지 판정한다(`docs/CLAUDE.md` Q2 — *코드를 바꿔야만 무효가 되나*).

## 착수 전 반드시 읽을 것

- `docs/auto-layout/module/module-planning.md` **§4.6** — 포트 위치를 정하는 것 전부
- 같은 문서 **§4.5** — 면 좌석표(`FaceTable`)
- `docs/auto-layout/link/machine-link.md` — 사다리 1단 · **무엇을 재나**
- 코드: `planner/module/linkPlanner.ts`(배정) · `planner/module/planModulePorts.ts`(①②③③′
  순서) · `planner/modulePacking.ts`(P0~P7) · `module/clusterModule.ts:260`(계획/방출 경계)

## 이 계획이 **하지 않는** 것

- **좌표를 보는 것.** 모듈은 여전히 위치를 모른다 — *"자기 모듈만 본다"* 는 **좌표**에
  대한 규율로 남긴다. 바뀌는 것은 **링크**에 대한 규율뿐이다.
- **`FaceTable` · `tryLinkFace` · `commitLinkFace` 의 내부.** 루프 축만 바꾼다.
- **사다리 2·3단**(gap · 다이렉트) · `insertingPlanner` 통합 · 채널/납품 알고리즘.

## 공통 전제 (썩는지 감시할 것)

| 전제 | 확인 방법 | 확인일 |
|---|---|---|
| `planModulePorts` 는 방출을 안 하는 순수 함수다 | `clusterModule.ts:260` 아래가 전부 방출 | 2026-08-29 ✔ |
| ① → ③ 전달이 `seatRowsUsed` 하나로 좁다 | `planModulePorts.ts:287` · `clusterPortPlanner.ts:220` | 2026-08-29 ✔ |
| `FaceTable` 은 값이다(복사 가능) | `faceTable.ts` `copyFaceTable` | 2026-08-29 ✔ |
| 되먹임은 **둘**이고 둘 다 `gen` 으로 닫힌다 | `조사-되먹임.md` | 2026-08-29 ✔ |
| 기준선 = 타입 0 · **52파일 631테스트 · 기존 실패 2건**(trunkPipe 유체 면) | `npx tsc -p tsconfig.app.json --noEmit` · `npx vitest run` | 2026-08-29 ✔ |
