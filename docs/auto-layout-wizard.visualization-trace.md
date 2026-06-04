# 자동완성 위저드 — 후보 생성 시각화 트레이스 체크포인트

> **부모 문서:** [auto-layout-wizard.md](auto-layout-wizard.md) — 위저드 인터페이스
> **관련 문서:** [.placement-search](auto-layout-wizard.placement-search.md) — 배치/탐색 알고리즘, [.entity-roles](auto-layout-wizard.entity-roles.md) — 엔티티 4분류

## 한 줄 요약

시각화(Visualization) 모달의 **함수 호출 트리에 나타나는 단계 = 자동 스택트레이스가 아니라, 코드에 손으로 심어둔 `reportFn(...)` 마커(체크포인트) 집합**이다. 그 지점에 마커가 있고 + 선택된 후보의 `buildSingleAttempt` 경로에서 실행될 때만 한 단계로 기록된다. 마커가 없는 순수 헬퍼는 보이지 않는 게 정상이다.

---

## 1. 배경 — 시각화는 무엇을 재생하는가

시각화 기능은 **선택(적용)된 후보 1개의 생성 과정을 함수 단계별로 녹화 후 재생**한다. `runContainerWizard`(전체 탐색: 모든 perm×dir)가 아니라, 후보가 확정한 `(perm, dir)` 한 조합으로 `buildSingleAttempt`를 **한 번만 결정적으로 재실행**(`traceCandidatePath`)하며 각 체크포인트에서 그 시점의 영역 스냅샷을 기록한다. 입력이 같으면 내부 레벨 first-success commit이 결정적이라 동일 후보가 그대로 재현된다.

- 구현: [containerWizard.ts](../frontend/src/utils/autoLayout/containerWizard.ts) `traceCandidatePath`
- 재생 UI: [components/visualization/](../frontend/src/components/visualization/)

따라서 **트리에 뜨는 것은 "실제 호출된 모든 함수"가 아니라 "녹화 대상으로 지정한 phase 마커"**다. 이 문서는 그 마커 집합과 규칙을 정리한다.

---

## 2. 핵심 규칙 — 한 단계가 나타나는 조건

한 함수가 트리에 한 단계로 나타나려면 **두 조건을 모두** 만족해야 한다:

1. **그 지점에 명시적인 `reportFn(라벨, { internal, external })` 호출이 있어야 한다** — `areas`(internal/external)를 함께 넘긴 호출만 스냅샷이 기록된다.
2. **선택된 후보의 `buildSingleAttempt` / `recurseMachine` 경로에서 실제로 실행되어야 한다** — `traceCandidatePath`는 `runContainerWizard`를 거치지 않고 `buildSingleAttempt`를 직접 호출하므로, 오케스트레이터 레벨 마커는 애초에 실행되지 않는다(아래 §6).

레코더 훅(요약):

```ts
// containerWizard.ts
async function reportFn(name, areas?) {
  emitProgress(name);                       // (1) 진행률 UI 표시
  if (traceRecorder && areas) {             // (2) 레코딩 — areas 넘긴 호출만
    traceRecorder.steps.push({
      order, functionName: name,
      callDepth: traceRecorder.callDepth,   // 중첩 깊이 (§4)
      snapshot: captureSnapshot(areas.internal, areas.external),
    });
  }
  await maybeYield();                        // (3) React paint 양보
}
```

---

## 3. `reportFn`의 정체 — 왜 이 지점들만 마커가 있나

`reportFn`은 시각화를 위해 새로 만든 게 아니라 **원래 위저드에 있던 "현재 처리 중인 phase" 표시용 훅**이다. 세 가지 목적을 겸한다:

1. **진행률 UI** — 자동 레이아웃 패널의 `▶ currentFunction` 인디케이터에 phase 이름 표시 (`emitProgress`)
2. **협조적 양보** — `maybeYield`(16ms throttle + `setTimeout 0`)로 React가 화면을 다시 그릴 틈을 줌. 동기 루프가 길어지면 UI가 멈추므로, **의미 있는 단계 경계마다** 양보 지점을 둔 것.
3. **(시각화 추가)** 스냅샷 레코딩 — `areas`를 넘긴 호출에 한해 위 레코더가 단계로 기록

즉 마커는 처음부터 **"머신 배치 / 라우팅 / 외부 래핑"처럼 띄엄띄엄한 phase 경계**에만 박혀 있었고, 시각화는 거기에 스냅샷 기록만 얹었다. 충돌검사·bbox 갱신 같은 순수·동기·저비용 헬퍼는 phase 경계가 아니라 마커 대상이 아니었다 → 그래서 안 보인다.

---

## 4. 들여쓰기(중첩) 규칙 — `callDepth`

트리의 들여쓰기는 **실제 JS 콜스택이 아니라 `recurseMachine` 재귀 깊이**를 반영한다. `recurseMachine`를 얇은 래퍼로 감싸 진입 시 `callDepth++`, 종료 시 `callDepth--` 하고(실제 본체는 `recurseMachineImpl`), `reportFn`이 그 시점의 `callDepth`를 단계에 기록한다.

호출 트리 구성([functionTree.ts](../frontend/src/utils/autoLayout/visualization/functionTree.ts) `buildFunctionTree`)은 *"깊이 d 단계는 가장 가까운 직전 깊이 d-1 단계의 자식"* 규칙으로 `callDepth` 시퀀스를 트리로 만든다.

- depth 0 = `buildSingleAttempt` 본문(루트 배치, 외부 래핑 등) + 루트 직속 자식의 첫 진입
- depth ≥ 1 = `recurseMachine` 재귀로 들어간 자식·손자 머신의 마커

---

## 5. 체크포인트 전체 목록

`{ internal, external }`를 넘겨 **시각화 트리에 실제로 기록되는** 마커들. "스냅샷 시점"은 그 함수가 실행되기 *직전* 상태(= 직전 함수의 결과)임에 유의 — 마지막 `완료` 단계가 최종 완성 상태를 담는다.

| 라벨 | 위치(함수) | 깊이 | 스냅샷이 담는 시점 |
|------|------------|------|--------------------|
| `placeRootMachine` | `buildSingleAttempt` | 0 | 루트 머신 배치 **직전**(빈 영역). machineCount>1이면 클러스터 경로 |
| `placeMachine [<레시피>]` | `recurseMachineImpl` | ≥1 | 자식 머신을 부모 옆에 배치 **직전** |
| `routeWithFallback [<품목> → 부모]` | `recurseMachineImpl` (단일) | ≥1 | 자식→부모 라우팅 **직전**(머신은 배치됨) |
| `routeWithFallback [<품목> → 부모 (클러스터)]` | `recurseMachineImpl` (클러스터) | ≥1 | 클러스터 머신별 라우팅 **직전** |
| `recurseMachine 손자 시도 [<perm>] dir=<dir>` | `recurseMachineImpl` | ≥1 | 손자 (perm×dir) 한 조합 시도 **직전** |
| `attachExternalInputs (Phase 2)` | `buildSingleAttempt` | 0 | 모든 머신 배치 후, 외부 입력(무한상자/파이프) 등록 직전 |
| `attachRootOutput` | `buildSingleAttempt` | 0 | 루트 product 출력 등록 직전 |
| `wrapExternalsWithMerge` | `buildSingleAttempt` | 0 | (병합 ON) 공유 무한상자 병합 + 둘레 배치 직전 |
| `wrapExternalsAroundPerimeter` | `buildSingleAttempt` | 0 | (병합 OFF) 외부 컨테이너 1:1 둘레 배치 직전 |
| `완료` *(합성)* | `traceCandidatePath` | 0 | **최종 완성 상태** — leaf.internal/external 전체 |

### 주의

- **라벨은 임의 문자열**이라 실제 함수명과 꼭 일치하지 않는다. 예: `placeRootMachine` 라벨은 `buildSingleAttempt` 안의 루트 배치 phase를 가리키는 사람이 읽을 표식이며, 실제 `placeRootMachine()` 함수 호출 지점과 1:1 대응이 아니다.
- `routeWithFallback` 단일/클러스터는 머신 수(`machineCount`)에 따라 둘 중 하나만 등장한다.
- `wrapExternalsWithMerge` / `wrapExternalsAroundPerimeter`는 병합 토글(`MERGE_CONFIG.enabled`)에 따라 배타적으로 등장한다.

---

## 6. 트리에 **안** 나타나는 것들과 이유

| 항목 | 왜 안 보이나 |
|------|--------------|
| 충돌검사, bbox 갱신 등 순수 헬퍼 | `reportFn` 마커가 없음 (phase 경계가 아님) |
| `routeWithFallback` 내부의 개별 port 시도 | 마커가 없음 (한 번의 `routeWithFallback`로 묶임) |
| 클러스터 Spring Relaxation 세부 반복 | 마커가 없음 |
| `expandRecipeTree`, `buildSingleAttempt [perm=…]`, `buildSingleAttempt [depth-0]` | `runContainerWizard`(오케스트레이터) 레벨 마커 — `traceCandidatePath`는 `buildSingleAttempt`를 **직접** 호출하므로 이 경로를 타지 않음. 게다가 `areas`도 안 넘김 |
| `emitProgress("완료")` (위저드 종료) | `reportFn`이 아니라 `emitProgress` 직접 호출 — 레코딩 경로 없음 |

요컨대 **마커가 없거나(순수 헬퍼), 트레이스 경로 밖이거나(오케스트레이터 레벨), areas를 안 넘긴(진행률 전용)** 셋 중 하나면 트리에 뜨지 않는다.

---

## 7. 새 체크포인트를 추가하려면

특정 함수를 더 잘게 보이게 하려면 그 지점에 `reportFn`을 심으면 된다:

```ts
// 예: 어떤 헬퍼의 진입을 한 단계로 노출하고 싶다면
await reportFn(`<라벨> [${child.recipeName}] @(${x},${y})`, { internal, external });
```

체크리스트:

1. **`areas`를 반드시 넘긴다** — 안 넘기면 진행률 UI에만 뜨고 시각화 트리엔 안 잡힌다.
2. **`buildSingleAttempt` / `recurseMachineImpl` 경로 안**에 둔다 — 오케스트레이터(`runContainerWizard`) 레벨에 두면 트레이스에서 실행되지 않는다.
3. **호출 빈도를 의식한다** — 루프 안쪽(예: port 시도마다)에 두면 단계 수가 수백~수천으로 폭증하고 `captureSnapshot`(deep clone) 비용도 그만큼 든다. 트레이스는 후보 1개라 보통은 괜찮지만, 과하면 재생이 둔해진다.
4. `reportFn`은 `await`로 호출한다(내부 `maybeYield`가 async).

비용 메모: 각 단계는 `cloneArea(internal) + cloneArea(external)`를 보관한다. 큰 레이아웃에서 마커를 잘게 늘리면 메모리·시간이 선형으로 증가한다.

---

## 8. 곁다리 — 트리 외의 시각화 요소

이 문서는 "함수 호출 트리"의 체크포인트만 다룬다. 시각화 그리드의 다른 요소는 체크포인트와 무관하게 **각 단계 스냅샷에서 파생**된다:

- **라우팅 선**: 최종 후보의 전체 라우팅 목록(`CandidateTraceResult.routings`) 중, 양 끝 컨테이너가 그 단계 스냅샷의 `containers`에 둘 다 존재하는 것만 producer→consumer 선으로 그림 → 단계 진행에 따라 점진적 등장. (item=주황, fluid=청록)
- **카메라**: 전체 단계 합집합 bbox(`unionStepsBbox`)에 fit, 사용자 줌/팬은 단계 이동 간 유지.

---

## 구현 위치

| 관심사 | 파일 / 심볼 |
|--------|-------------|
| 레코더 훅 + 체크포인트 마커 | [containerWizard.ts](../frontend/src/utils/autoLayout/containerWizard.ts) `reportFn`, `traceRecorder`, `recurseMachine`(깊이 래퍼) |
| 트레이스 재실행 | `traceCandidatePath` (같은 파일) |
| 단계/결과 타입 | [containerModel.ts](../frontend/src/utils/autoLayout/containerModel.ts) `TraceStep`, `CandidateTraceResult`, `TraceRouting` |
| 호출 트리 구성 | [functionTree.ts](../frontend/src/utils/autoLayout/visualization/functionTree.ts) `buildFunctionTree` |
| 사이드바 렌더 | [FunctionTreeSidebar.tsx](../frontend/src/components/visualization/FunctionTreeSidebar.tsx) |
| 진입 소스 저장 | [layoutStore.ts](../frontend/src/store/layoutStore.ts) `visualizationSource` (후보 적용 시 세팅) |
