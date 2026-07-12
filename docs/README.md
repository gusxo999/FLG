---
tags: [moc]
---

# 개발 문서 — Map of Content

구현 결정과 데이터 구조 분석을 기록하는 디렉토리입니다.
코드만으로는 자명하지 않은 **"왜"**를 남기는 것이 목적입니다.

> 이 문서는 Obsidian **진입점(MOC, Map of Content)** 입니다. 주제별로 문서를 묶어두었고,
> 각 문서 상단의 태그(`#auto-layout`, `#factorio-data` 등)로도 탐색할 수 있습니다.
> 그래프 뷰를 열면 문서 간 연결이 태그별 색상으로 보입니다.

> 📖 **[용어 사전 (Glossary)](용어사전.md)** — 이 vault 에 등장하는 모든 도메인 용어의 단일 정의 출처.
> 각 문서 본문에서 용어가 처음 나올 때 사전 항목으로 링크됩니다.

---

## 🧭 주제별 지도

### 🏗️ 레이아웃 자동완성 (auto-layout) `#auto-layout`

레시피 → 머신/투입기/벨트 자동 배치 위저드와 그 알고리즘. **부모: [auto-layout-wizard](auto-layout-wizard.md)**

| 문서 | 주제 | 태그 |
|------|------|------|
| [auto-layout-wizard](auto-layout-wizard.md) | **[부모]** 위저드 인터페이스 (5단계 UI + 입출력 사양) | `#auto-layout` |
| [.placement-search](auto-layout-wizard.placement-search.md) | ↳ **모델·전략 단일 출처** — 컨테이너 모델(불변) + 정합성 조건(C/O/M) + 전략 레이어(현재=S-LAYER) | `#placement` `#routing` |
| [.s-layer-channel-reservation](auto-layout-wizard.s-layer-channel-reservation.md) | ↳ S-LAYER 의 레이어 간 라우팅 채널 예약 | `#placement` `#routing` |
| [.channel-geometry-reservation](auto-layout-wizard.channel-geometry-reservation.md) | ↳ 채널 예약을 폭→기하로 승격 — 납품·반출 경로의 같은 쪽 판정 (구현 완료) | `#placement` `#routing` |
| [.trunk-redesign](auto-layout-wizard.trunk-redesign.md) | ↳ **[진행]** 새 트렁크 — "씨앗 발견"→"1:1 을 합친 결과"(경계 마샬). §10 = 2026-07-12 확정 설계 | `#placement` `#routing` |
| [.trunk-pipe](auto-layout-wizard.trunk-pipe.md) | ↳ **[진행]** 트렁크 파이프 — 유체를 모듈 파이프라인에. 기둥 유지 + 머신 90° 회전, 케이스 B(파이프 넘김 레인) | `#placement` `#fluid` |
| [.one-to-one-channel-plan](auto-layout-wizard.one-to-one-channel-plan.md) | ↳ **[계획]** 1:1 의 채널 예약 결함(지상 배정 all-or-nothing)과 수리 계획 + 지하 실패 시각화 — 트렁크 복귀로 긴급성 하락 | `#placement` `#routing` |
| [.entity-roles](auto-layout-wizard.entity-roles.md) | ↳ 엔티티 4분류 (변환기 / 핸드오프 / 고체운반 / 액체운반) | `#routing` |
| [.known-limits](auto-layout-wizard.known-limits.md) | ↳ 알려진 약점·한계 + 우선순위(P0~P3) | `#placement` `#routing` |
| [.priority-ordering](auto-layout-wizard.priority-ordering.md) | ↳ 배치·라우팅 순서 결정점 등록부 (부모=placement-search) | `#placement` `#routing` |
| [.ns-face-relief](auto-layout-wizard.ns-face-relief.md) | ↳ count=1 raw 입력의 노출 N/S 면 슬롯 (E→N/S→W, W-spill 갇힘 원인 치료) | `#placement` `#routing` |
| [.module-way-outs](auto-layout-wizard.module-way-outs.md) | ↳ **moduleWayOuts** — 모듈이 "이 상자가 나갈 수 있는 문"을 답한다. 예약이 막힌 방향을 안 잡게 해 탐색 폴백 제거 + 폭 낭비 제거 | `#placement` `#routing` |
| [.control-behavior-scope](auto-layout-wizard.control-behavior-scope.md) | ↳ 추적하는 ControlBehavior 필드 범위 | `#blueprint` |
| [.visualization-trace](auto-layout-wizard.visualization-trace.md) | ↳ 후보 생성 시각화 트레이스 체크포인트 (`emit` 마커 규칙) | `#visualization` |
| [.pipeline-metrics](auto-layout-wizard.pipeline-metrics.md) | ↳ **계측기** — 같은 트리를 같은 자로 재는 도구 + 1:1 기준선 수치. 갈아타기 판정은 면적 아닌 "실패 0 + 채널 폭" | `#auto-layout` |
| [.code-folders](auto-layout-wizard.code-folders.md) | ↳ 코드 폴더 분리 — module/(모듈 안쪽) · planner/(모듈 사이) · util/(helper 셈 · cellBuilder 채우기) | `#auto-layout` |

### 🧩 Factorio 데이터 · 시맨틱스 `#factorio-data`

Factorio API/데이터의 비직관적 동작과 그 해석.

| 문서 | 주제 | 태그 |
|------|------|------|
| [fluid-box-semantics](fluid-box-semantics.md) | 유체 상자의 `production_type` vs `flow_direction` 차이 및 앱의 선택 | `#fluid` |
| [map-position-parsing](map-position-parsing.md) | MapPosition 의 keyed/positional 이중 형태 문제와 3중 방어 정규화 | `#blueprint` |
| [direction-encoding](direction-encoding.md) | 내부 `Direction` 을 Factorio 2.0 16-방향 인코딩으로 통일 (1.x ×2 자동 업그레이드) | `#blueprint` |
| [tech-tree-resolution](tech-tree-resolution.md) | 선택한 머신/레시피의 필요 기술 closure 자동 산출 | `#auto-layout` |
| [belt-flow-inspection](belt-flow-inspection.md) | 벨트 셀 클릭 흐름량 검사 — 그리드 정적 분석, 인서터 지점별 증감 | `#visualization` `#factorio-data` |

### 📦 Blueprint import/export `#blueprint`

블루프린트 왕복(round-trip)의 메타데이터 커버리지.

| 문서 | 주제 | 태그 |
|------|------|------|
| [blueprint-metadata-coverage](blueprint-metadata-coverage.md) | export 메타데이터 커버리지 — 현재(4필드+recipe) → 전체 단계별 계획 + 체크리스트 | `#blueprint` |

### 🚧 보류 · 폐기 결정 `#deferred`

시도했으나 보류/폐기한 항목. **다음 시도가 같은 함정에 빠지지 않도록** 기록.

| 문서 | 주제 | 태그 |
|------|------|------|
| [icon-mapping](icon-mapping.md) | 엔티티 아이콘 매핑 — 런타임 API 의도적 차단, 모드 우회 부적절 (보류) | `#factorio-data` |
| [surface-restriction-limits](surface-restriction-limits.md) | 우주/지상 표면 제약 자동 판단 포기 → 사용자가 직접 머신 선택 | `#factorio-data` `#auto-layout` |
| [parametrized-blueprints-deferred](parametrized-blueprints-deferred.md) | parameter-0~9 placeholder 처리 보류 (향후 parametrized blueprint 기능과 함께) | `#blueprint` |

---

## 도큐먼트 명명 규칙 — 부모/자식

복합 기능의 경우 **dot-notation** 으로 부모 → 자식 관계를 파일명에 드러낸다:

```
auto-layout-wizard.md                          ← 부모 (기능 자체)
auto-layout-wizard.algorithm.md                ← ↳ 자식: 알고리즘 작동 방식
auto-layout-wizard.known-limits.md             ← ↳ 자식: 알려진 한계
auto-layout-wizard.control-behavior-scope.md   ← ↳ 자식: 추적 범위
```

**Why:** 정렬된 파일 목록에서 부모 바로 아래에 자식들이 모여 부모-자식 관계가 한눈에 보인다. 테스트 파일
`foo.test.ts` 와 같은 패턴.

**자식 문서의 서두**에는 부모 문서와 같은 묶음의 다른 문서들을 안내하는 박스를 넣어, 어느 묶음에 속한 문서인지
즉시 알 수 있게 한다:

```markdown
> **부모 문서:** [auto-layout-wizard.md](auto-layout-wizard.md)
> **관련 문서:** [.algorithm](...), [.binary-search](...), ...
```

## 태그 규칙 (Obsidian)

각 문서 최상단 frontmatter 에 주제 태그를 단다. 그래프 뷰·태그 패널 탐색용.

| 태그 | 의미 |
|------|------|
| `#auto-layout` | 레이아웃 자동완성 위저드 묶음 |
| `#placement` | 머신·외부상자 배치 |
| `#routing` | 벨트/파이프 경로 탐색 |
| `#blueprint` | 블루프린트 import/export/메타데이터 |
| `#factorio-data` | Factorio API·데이터 시맨틱스 |
| `#fluid` | 유체 관련 |
| `#visualization` | 후보 생성 시각화 |
| `#deferred` | 보류·폐기된 결정 |
| `#glossary` | 용어 사전 |
| `#moc` | 이 진입점 문서 · 용어 사전 |

## 폐기 결정 정책

문서·코드·기능을 "폐기" 로 표시하거나 삭제할 때:

1. **사용자가 명시적으로 폐기를 요청한 항목만 폐기 대상.** 인접 개념까지 함께 폐기로 묶지 않는다.
2. **인접 개념의 폐기는 별도 사용자 확인** 받은 뒤에만 진행. 묻지 않고 확장 해석하지 않는다.
3. **폐기 사유는 결정 시점에 기록.** 사후 추궁 받았을 때 정당화하지 않는다.

## 새 문서 작성 가이드

다음 경우에 문서를 추가한다:

1. **Factorio API의 비직관적 동작** — 여러 필드가 겹치거나 모순되는 경우의 해석
2. **아키텍처 결정** — 왜 Option A가 아닌 B를 선택했는가 (예: React+PixiJS 분리)
3. **데이터 모델의 숨은 제약** — 필터 규칙의 근거, 검증에 쓴 데이터

각 문서는 다음을 포함해야 한다:

- **한 줄 요약** — 결론을 먼저
- **문제/배경** — 왜 이 결정이 필요했는가
- **실데이터 근거** — 이론이 아닌 경험적 검증
- **대안 검토** — 다른 선택지를 왜 기각했는가
- **구현 위치** — 코드 어느 파일/함수에 반영됐는가
- **frontmatter 태그** — 위 태그 규칙표에서 골라 최상단에 추가
