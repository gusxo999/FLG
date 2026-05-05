# 개발 문서

구현 결정과 데이터 구조 분석을 기록하는 디렉토리입니다.
코드만으로는 자명하지 않은 **"왜"**를 남기는 것이 목적입니다.

## 문서 목록

| 문서 | 주제 | 작성일 |
|------|------|--------|
| [fluid-box-semantics.md](fluid-box-semantics.md) | 유체 상자의 `production_type`과 `flow_direction`의 차이 및 앱의 선택 | 2026-04-25 |
| [map-position-parsing.md](map-position-parsing.md) | MapPosition의 keyed/positional 이중 형태 문제와 3중 방어 정규화 전략 | 2026-04-25 |
| [icon-mapping.md](icon-mapping.md) | 엔티티 아이콘 매핑 — 두 차례 시도 후 보류. 런타임 API의 의도적 차단과 모드 우회의 부적절성 정리 | 2026-04-26 |
| [blueprint-metadata-coverage.md](blueprint-metadata-coverage.md) | Blueprint export 메타데이터 커버리지 — 현재(4필드 + recipe) → 전체(items/wires/control_behavior) 단계별 계획 + 진행 체크리스트 | 2026-04-27 |
| [auto-layout-wizard.md](auto-layout-wizard.md) | **[parent]** 레이아웃 자동완성 — 위저드(레시피→머신→투입기→벨트→지하파이프) 인터페이스 사양 | 2026-04-29 |
| [auto-layout-wizard.binary-search.md](auto-layout-wizard.binary-search.md) | ↳ 이진탐색 보조 (review 단계 하위 기능) — "최대 k" 탐색 + probe 트레이스 로그 | 2026-04-30 |
| [auto-layout-wizard.known-limits.md](auto-layout-wizard.known-limits.md) | ↳ 알려진 약점·한계 + 우선순위(P0~P3) + 해결 방향 | 2026-04-29 |
| [auto-layout-wizard.control-behavior-scope.md](auto-layout-wizard.control-behavior-scope.md) | ↳ 위저드가 추적하는 ControlBehavior 필드 범위 — in-scope / passthrough / out-of-scope | 2026-04-28 |
| [parametrized-blueprints-deferred.md](parametrized-blueprints-deferred.md) | parameter-0~9 placeholder 처리 보류 — 향후 parametrized blueprint 자동완성 기능 시 함께 다룰 예정 | 2026-04-28 |
| [direction-encoding.md](direction-encoding.md) | 내부 `Direction` 모델을 Factorio 2.0 16-방향 인코딩(0/4/8/12)으로 통일. 1.x 블루프린트는 ×2 자동 업그레이드, persist migrate 포함 | 2026-04-29 |
| [surface-restriction-limits.md](surface-restriction-limits.md) | 우주/지상 표면 제약 자동 판단 포기. 모드마다 메커니즘과 필드명이 달라 자동완성 시 사용자가 직접 머신을 선택하게 함 | 2026-04-29 |

## 도큐먼트 명명 규칙 — 부모/자식

복합 기능의 경우 **dot-notation** 으로 부모 → 자식 관계를 파일명에 드러낸다:

```
auto-layout-wizard.md                          ← 부모 (기능 자체)
auto-layout-wizard.algorithm.md                ← ↳ 자식: 알고리즘 작동 방식
auto-layout-wizard.binary-search.md            ← ↳ 자식: 하위 기능 (이진탐색)
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
