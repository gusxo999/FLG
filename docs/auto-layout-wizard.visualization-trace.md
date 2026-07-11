---
tags: [auto-layout, visualization]
---

# 자동완성 위저드 — 후보 생성 시각화 트레이스 체크포인트

> **부모 문서:** [auto-layout-wizard.md](auto-layout-wizard.md) — 위저드 인터페이스
> **관련 문서:** [.placement-search](auto-layout-wizard.placement-search.md) — 배치/전략, [.s-layer-channel-reservation](auto-layout-wizard.s-layer-channel-reservation.md) — 채널 예약

## 한 줄 요약

시각화 모달의 단계 목록 = **자동 스택트레이스가 아니라, 현재 전략 `S-LAYER`([layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts))의 코드에 손으로 심어둔 `emit(라벨, { internal, external })` 마커(phase 체크포인트) 집합**이다. `emit` 에 **영역(`areas`)을 함께 넘긴 호출만** 한 단계로 기록된다. 영역 없이 진행률만 알리는 `emit` 은 트리에 안 뜨는 게 정상이다.

> **이력:** 과거 본 문서는 폐기된 `containerWizard.ts` 의 `reportFn`/`recurseMachine`/`traceCandidatePath`/`buildSingleAttempt`(S-EXH 재귀) 기준이었다. 그 파일들은 존재하지 않으며, 현재 트레이스는 `layeredWizard.ts` 의 평탄(flat) `emit` 으로 동작한다 — 전면 재작성됨 (2026-06-09).

---

## 1. 배경 — 시각화는 무엇을 재생하는가

시각화는 **적용된 후보 1개의 생성 과정을 phase 단계별로 녹화 후 재생**한다. S-LAYER 는 결정적 단일 패스라 별도 재현 경로가 필요 없다 — `traceLayeredPath(input)` 가 **`runLayeredWizard` 를 레코더 ON 으로 1회 실행**하면 그 실행 자체가 곧 후보의 생성 과정이다.

- 트레이스 진입: [layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts) `traceLayeredPath`
- 재생 UI: [components/visualization/](../frontend/src/components/visualization/) (`VisualizationModal.tsx` 가 단계를 0.5초 간격 재생)

각 체크포인트에서 *그 시점의 영역 스냅샷* 을 기록한다. 따라서 트리에 뜨는 것은 "실제 호출된 모든 함수" 가 아니라 "녹화 대상으로 지정한 phase 마커" 다.

---

## 2. 핵심 규칙 — 한 단계가 나타나는 조건

한 phase 가 트리에 한 단계로 나타나려면 **두 조건을 모두** 만족해야 한다:

1. **그 지점에 `emit(라벨, { internal, external })` 호출이 있다** — `areas` 를 함께 넘긴 호출만 스냅샷이 기록된다.
2. **레코더가 켜져 있다** — `traceLayeredPath` 가 모듈 전역 `layeredRecorder` 를 세팅한 동안 실행될 때만 기록된다(일반 실행에서는 진행률 UI 만).

레코더 훅(요약, [layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts) `makeEmitter`):

```ts
function makeEmitter(cb) {
  return (name, areas?) => {
    cb?.({ currentFunction: name, ... });   // (1) 진행률 UI 표시 (항상)
    if (layeredRecorder && areas) {          // (2) 레코딩 — areas 넘긴 호출만
      layeredRecorder.steps.push({
        order: layeredRecorder.steps.length,
        functionName: name,
        callDepth: 0,                        // S-LAYER 는 평탄 (§4)
        snapshot: captureSnapshot(areas.internal, areas.external),
      });
    }
  };
}
```

> **직렬화 락:** `layeredRecorder` 가 모듈 전역이라 동시 실행(React StrictMode 이중 effect 등)이 서로를 덮어쓸 수 있다. `traceLayeredPath` 는 `layeredTraceLock` 으로 한 번에 하나만 실행한다.

---

## 3. `emit` 의 정체 — 왜 이 지점들만 마커가 있나

`emit` 은 시각화 전용이 아니라 위저드의 **"현재 처리 중인 phase" 표시 훅**이며 두 목적을 겸한다:

1. **진행률 UI** — 자동 레이아웃 패널의 `▶ currentFunction` 인디케이터(`onProgress` 콜백).
2. **(시각화) 스냅샷 레코딩** — `areas` 를 넘긴 호출에 한해 단계로 기록.

즉 마커는 "머신 배치 / 채널 라우팅 / 외부 래핑" 같은 **띄엄띄엄한 phase 경계** 에만 박혀 있다. 충돌검사·bbox 갱신 같은 순수·저비용 헬퍼는 phase 경계가 아니라 마커 대상이 아니다 → 안 보인다.

---

## 4. 들여쓰기(중첩) 규칙 — 2레벨 그룹핑

S-LAYER 는 재귀가 없는 단일 패스지만, 시각화 트리는 가독성을 위해 **2레벨로 그룹핑**한다. `emit(라벨, areas, depth)` 의 세 번째 인자 `depth` 로 다음을 구분한다([makeEmitter](../frontend/src/utils/autoLayout/layeredWizard.ts) `callDepth: depth`):

- **depth 0 = phase 그룹 헤더** — `채널 라우팅`, `외부 연결`, `완료`.
- **depth 1 = 그 phase 의 루프 단위 자식 단계** — 노드/edge 별로 증분 공개된다.

호출 트리 구성([functionTree.ts](../frontend/src/utils/autoLayout/visualization/functionTree.ts) `buildFunctionTree`)의 "깊이 d 단계는 직전 d−1 단계의 자식" 규칙에 따라, depth 1 단계들은 직전 depth 0 헤더 아래로 접힌다.

두 그룹이 자식을 갖는다:

- **`channelRouting` (depth 0)** ← 내부 라우팅 그룹 헤더. 자식(depth 1):
  - `trunk · <recipe> ×N` — 6a 트렁크 병합이 성공한 노드마다 (병합 ON).
  - `route · <recipe>[i]` — 6b 1:1 폴백 채널이 깔린 edge마다.
- **`외부 연결 (external wiring)` (depth 0)** ← 외부 연결 그룹 헤더. 자식(depth 1):
  - `attachExternalInputs`, `attachRootOutput`, `wrapExternals*`.

> (구 S-EXH 는 `recurseMachine` 재귀 깊이를 `callDepth` 로 기록해 중첩 트리를 만들었다. S-LAYER 의 2레벨 그룹핑은 재귀가 아니라 `emit` 에 손으로 부여한 depth 다.)

---

## 5. 체크포인트 전체 목록

[layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts) 의 `emit` 호출 순서. `depth` 0=그룹 헤더, 1=자식. 그룹 헤더 스냅샷은 그 phase 실행 **직전** 상태, 루프 자식 스냅샷은 그 반복이 커밋된 **직후** 상태(증분 공개)다. 마지막 `완료` 가 최종 상태를 담는다.

| 라벨 | depth | `areas` 전달 | 트리 기록 | 스냅샷이 담는 시점 |
|------|:---:|:---:|:---:|--------------------|
| `expandRecipeTree` | 0 | ✗ | — | (진행률만) |
| `layerAssignment + ordering` | 0 | ✗ | — | (진행률만) |
| `planChannels (left-edge)` | 0 | ✗ | — | (진행률만) |
| `coordinate + placeMachines` | 0 | ✗ | — | (진행률만) |
| `channelRouting (left-edge track order)` | 0 | ✓ | **기록(헤더)** | 머신 배치 완료 직후, 채널 라우팅 **직전** (머신만) |
| `trunk · <recipe> ×N` | 1 | ✓ | **기록(자식)** | 6a 그 노드의 트렁크 커밋 **직후** (노드마다, 병합 ON) |
| `route · <recipe>[i]` | 1 | ✓ | **기록(자식)** | 6b 그 edge 의 1:1 채널 커밋 **직후** (성공 edge마다) |
| `외부 연결 (external wiring)` | 0 | ✓ | **기록(헤더)** | 내부 라우팅 완료 직후 |
| `attachExternalInputs` | 1 | ✓ | **기록(자식)** | 외부 입력 등록 직전 |
| `attachRootOutput` | 1 | ✓ | **기록(자식)** | 루트 출력 등록 직전 |
| `wrapExternalsWithMerge` *(병합 ON)* | 1 | ✓ | **기록(자식)** | 외부 컨테이너 perimeter 배치 직전 |
| `wrapExternalsAroundPerimeter` *(병합 OFF)* | 1 | ✓ | **기록(자식)** | 위와 동일(1:1 버전) |
| `완료` | 0 | ✓ | **기록** | **최종 완성 상태** (leaf.internal/external 전체) |

### 주의

- **앞 4개(트리 펼침·레이어 배정·채널 계획·머신 배치)는 `areas` 를 안 넘겨 트리에 안 뜬다.** 영역이 아직 없거나(초기) 진행률 표시만 의도한 phase 이기 때문. 따라서 **트레이스의 첫 기록 단계는 `channelRouting`** 헤더이며, 그 스냅샷이 "머신은 배치됐지만 라우팅 전" 상태를 보여준다.
- `trunk·` / `route·` 자식 수는 노드·edge 수에 비례한다. 각 자식이 `internal+external` 을 deep clone 하므로(§7) 큰 트리는 단계 수·메모리가 선형 증가.
- `wrapExternalsWithMerge` / `wrapExternalsAroundPerimeter` 는 병합 토글(`merge.enabled`)에 따라 배타적으로 등장한다.
- 라벨은 사람이 읽을 표식이며 실제 함수명과 1:1 대응이 아니다.

---

## 6. 트리에 **안** 나타나는 것들과 이유

| 항목 | 왜 안 보이나 |
|------|--------------|
| 트리 펼침·레이어 배정·채널 계획·머신 배치 | `emit` 은 있으나 `areas` 를 안 넘김 (진행률 전용) |
| 충돌검사·bbox 갱신 등 순수 헬퍼 | `emit` 마커가 없음 (phase 경계 아님) |
| 트렁크 그리디 성장·시드 평가 세부 | 마커 없음 (노드 단위 `trunk·` 자식 한 단계로 묶임 — 그 안의 그리디 반복은 안 보임) |
| `routeWithFallback` 내부 port 시도 | 마커 없음 (edge 단위 `route·` 자식 한 단계로 묶임) |

요컨대 **마커가 없거나(순수 헬퍼), `areas` 를 안 넘긴(진행률 전용)** 두 경우면 트리에 안 뜬다.

---

## 7. 새 체크포인트를 추가하려면

특정 phase 를 단계로 노출하려면 그 지점에 `areas` 를 넘긴 `emit` 을 둔다:

```ts
emit(`<라벨>`, { internal, external });
```

체크리스트:

1. **`areas` 를 반드시 넘긴다** — 안 넘기면 진행률 UI 에만 뜨고 트리엔 안 잡힌다.
2. **`internal`/`external` 이 이미 생성된 이후** 에 둔다 (5단계 머신 배치 이후). 그 전 phase 는 영역이 없어 스냅샷이 무의미.
3. **호출 빈도를 의식한다** — 각 단계가 `cloneArea(internal)+cloneArea(external)` 를 deep clone 으로 보관하므로, 루프 안쪽에 많이 두면 메모리·시간이 선형 증가. 트레이스는 후보 1개라 보통은 괜찮다.

---

## 8. 곁다리 — 트리 외의 시각화 요소

함수 트리 외 요소는 각 단계 스냅샷에서 파생된다:

- **라우팅 선**: 최종 후보의 전체 라우팅 목록(`CandidateTraceResult.routings`) 중 **양 끝 컨테이너가 그 단계 스냅샷의 `containers` 에 둘 다 존재** 하는 것만 producer→consumer 선으로 그림 → 단계 진행에 따라 점진적 등장. (item=주황, fluid=청록. `TraceRouting.fluid` 로 구분)
- **카메라**: 전체 단계 합집합 bbox(`unionStepsBbox`)에 fit. 사용자 줌/팬은 단계 이동 간 유지.

---

## 구현 위치

| 관심사 | 파일 / 심볼 |
|--------|-------------|
| 레코더 훅 + 체크포인트 마커 | [layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts) `makeEmitter`, `emit`, `layeredRecorder` |
| 트레이스 진입 (레코더 ON 1회 실행) | [layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts) `traceLayeredPath`, `layeredTraceLock` |
| 스냅샷·카메라 bbox | [layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts) `captureSnapshot`, `unionStepsBbox` |
| 단계/결과 타입 | [containerModel.ts](../frontend/src/utils/autoLayout/containerModel.ts) `TraceStep`, `CandidateTraceResult`, `TraceRouting` |
| 호출 트리 구성 | [functionTree.ts](../frontend/src/utils/autoLayout/visualization/functionTree.ts) `buildFunctionTree` |
| 사이드바 렌더 | [FunctionTreeSidebar.tsx](../frontend/src/components/visualization/FunctionTreeSidebar.tsx) |
| 진입 소스 저장 | [layoutStore.ts](../frontend/src/store/layoutStore.ts) `visualizationSource` (후보 적용 시 세팅) |
