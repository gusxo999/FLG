---
tags: [auto-layout, docs, refactor]
---

# Phase 6-0 — "조사 후 결정" 문서 7개 감사

**날짜:** 2026-07-25
**대상:** 리팩토링 계획서가 "조사 후 결정"으로 미뤄 둔 7개 문서
**방법:** 각 문서가 참조하는 심볼·파일·줄번호를 현재 코드와 대조

## 결론 표

| 문서 | 판정 | 이유 |
|---|---|---|
| [.visualization-trace](auto-layout-wizard.visualization-trace.md) | **업데이트(긴급)** | 문서가 나열한 단계 10여 개가 전부 사라짐. 실제 emit 은 2개뿐이고 그중 기록되는 건 1개 |
| [.priority-ordering](auto-layout-wizard.priority-ordering.md) | **업데이트** | 죽은 줄번호 인용 + 존재하지 않는 파일 인용. Phase 4 가 추가한 새 순서 결정점 2개가 빠져 있음 |
| [.trunk-redesign](auto-layout-wizard.trunk-redesign.md) | **업데이트(상태만)** | §10 확정 설계는 **구현됐다**. `[진행]` 딱지가 틀렸고, 일부는 machine-link 가 대체 |
| [.cluster-redesign](auto-layout-wizard.cluster-redesign.md) | **유지 + 노트** | 미구현 설계로 유효. 다만 근거로 삼은 `pickClusterShape` 가 프로덕션에서 죽었음을 명시해야 |
| [.pipeline-metrics](auto-layout-wizard.pipeline-metrics.md) | **유지 + 노트** | 도구는 살아 있으나 **부를 통로가 없다**(자기 테스트만 호출). 그 사실을 적어야 |
| [.module-way-outs](auto-layout-wizard.module-way-outs.md) | **유지** | `moduleWayOuts` 가 8개 파일에서 활발히 쓰임. 문서와 코드 일치 |
| [.one-to-one-channel-plan](auto-layout-wizard.one-to-one-channel-plan.md) | **유지(이력)** | 이미 스스로 "긴급성 하락"을 명시. 결함 분석은 channel-geometry 의 전사(前史)로 가치 있음 |

---

## 근거

### visualization-trace — 시각화가 사실상 비었다

문서는 트레이스 단계를 표로 나열한다: `layerAssignment + ordering`, `planChannels (left-edge)`,
`coordinate + placeMachines`, `channelRouting (left-edge track order)`, `trunk · <recipe> ×N`,
`route · <recipe>[i]`, `attachExternalInputs`, `attachRootOutput`, `wrapExternalsWithMerge`,
`wrapExternalsAroundPerimeter`, `gatherExternalsToPoints`.

**이 중 코드에 남은 것은 하나도 없다.** 현재 `layeredWizard.ts` 의 emit 은 둘뿐이다:

```
emit("expandRecipeTree")                       ← areas 없음 → 트리에 안 뜸
emit("완료", { internal, external })            ← 유일하게 기록되는 단계
```

문서 §"앞 4개는 areas 를 안 넘겨 트리에 안 뜬다 → 첫 기록 단계는 channelRouting" 이라는
설명 자체가 성립하지 않는다. **시각화 모달은 지금 단계 1개만 보여준다.**

Phase 3 이 S-LAYER 본체를 지우며 그 안에 심겨 있던 체크포인트가 함께 사라졌는데, 이 기능을
덮는 테스트가 없어 드러나지 않았다. 같은 기능의 `cloneArea` 파손도 Phase 5 에서야 잡혔다
([[typecheck_command]]).

> **문서 갱신만으로는 부족하다.** 모듈 파이프라인 안(`generateModule` → `packModuleTree` →
> `routeModuleHops` → `rePathToPerimeter`)에 체크포인트를 다시 심어야 기능이 돌아온다.
> 문서 수정과 별개 작업으로 등록한다(P6-6).

### priority-ordering — 등록부가 새 결정을 못 따라갔다

죽은 인용:
- P1 → `layeredWizard.ts:530` — 파일이 364줄이다. 그 코드는 Phase 3 에서 삭제됐다.
- P7 → `trunkPath.ts:232` — **그 경로에 파일이 없다**(`module/trunkPath.ts` 로 이동).

빠진 결정점 — Phase 4 가 추가한 것이고, 이 문서의 존재 이유에 정확히 해당한다:
- **채널 기하 배정 순서** = 유체 납품 → 반출 → 아이템 납품 (실패 비용 순).
  분류 **C**(정합성) — 유체가 밀리면 트리가 죽는다.
- **홉 방출 순서** = 유체 홉 먼저. 분류 **C** — 아이템의 예약 무시 재시도가 유체 자리를
  밟으면 유체는 물러설 데가 없다.

둘 다 [[auto-layout-wizard.fluid-hop-reservation]] §4.3 · §8.2 가 출처다.

### trunk-redesign — 구현됐는데 `[진행]` 이다

§10 "경계 마샬" 확정 설계(면·레인 배정이 닻 → 트렁크는 W/E 면 → 홉이 잇는다)는 지금
`clusterPortPlanner` + `emitTrunk` + `moduleHop` 으로 **돌아가고 있다**.

다만 §10.1 의 "홉 수(품목당 1)"는 이후 [[auto-layout-wizard.machine-link]] 가 간선-단위
링크로 세분화해 **대체**했다(`edgeMachineLinks` → `HopSpec.linkId`). 상태 갱신 + 그 부분에
대체 표시가 필요하다.

### cluster-redesign — 설계는 유효, 근거 코드는 죽었다

"구현 미착수" 그대로라 유지한다. 단 문서가 딛고 선 `pickClusterShape`(기둥 탭 용량 초과 →
2D 필요 판정)의 **프로덕션 호출자가 사라졌다** — 유일한 호출처가 삭제된 S-LAYER 경로였고,
지금은 정의와 자기 테스트만 남았다. 모듈 경로는 `columnTapCapacity` 를 직접 쓴다.

설계를 되살릴 때 "이미 판정기가 있다"고 오해하지 않도록 노트를 단다.

### pipeline-metrics — 도구는 있는데 부를 방법이 없다

`measurePipeline` · `formatMetrics` 는 살아 있으나 **참조하는 프로덕션 코드가 0개**다
(`pipelineMetrics.test.ts` 만 호출). `debugApi` 에도 안 걸려 있어 브라우저에서 못 부른다.

문서는 "공급 방식을 갈아타기 전에 숫자로 이기는 걸 먼저 본다"는 목적을 적고 있는데,
지금은 그 비교를 실행할 통로가 없다. 도구를 지울지 배선할지는 별개 결정 — 노트만 단다.

---

## 후속 작업 (P6-1 이후)

| # | 작업 | 트리거 |
|---|---|---|
| P6-1 | `code-folders.md` 갱신 | Phase 3 파일 목록 변화 |
| P6-2 | `auto-layout-wizard.md`·`placement-search.md` — 듀얼 경로/플래그 제거 반영 | Phase 5 |
| P6-3 | `s-layer-channel-reservation.md` 상단에 "본체 삭제됨, 철학은 channel-geometry 가 계승" 노트 | Phase 3 |
| P6-4 | 본 감사의 판정 실행(업데이트 3건 + 노트 2건) | P6-0 |
| P6-5 | `known-limits.md` — "옛 경로로 폴백" → "fallback 실패" | Phase 3 |
| **P6-6** | **시각화 체크포인트 재이식** — 문서가 아니라 **코드** 작업 | 본 감사 |

**삭제 대상 문서는 없다.** 7개 모두 유지 또는 갱신이다.
