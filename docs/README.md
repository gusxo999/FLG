---
tags: [moc]
---

# 개발 문서 — Map of Content

구현 결정과 데이터 구조 분석을 기록하는 디렉토리입니다.
코드만으로는 자명하지 않은 **"왜"**를 남기는 것이 목적입니다.

> 이 문서는 Obsidian **진입점(MOC, Map of Content)** 입니다. 주제별로 문서를 묶어두었고,
> 각 문서 상단의 태그(`#auto-layout`, `#factorio-data` 등)로도 탐색할 수 있습니다.
> 그래프 뷰를 열면 문서 간 연결이 태그별 색상으로 보입니다.

> 📖 **[용어 사전 (Glossary)](용어사전.md)** — 이 vault 에 등장하는 모든 **도메인 용어**의 단일 정의 출처.
> 각 문서 본문에서 용어가 처음 나올 때 사전 항목으로 링크됩니다.
>
> 🔧 **[변수명 사전 (Debug Flags)](변수명사전.md)** — **디버그 플래그와 진단 출력**의 정리.
> "새 경로가 왜 안 켜졌지?" 를 화면이 아니라 **콘솔 로그로** 알아내는 법이 여기 있습니다.
> 용어 사전과 나눈 이유: 저건 사람이 대화할 때 쓰는 말, 이건 켜고 끄거나 콘솔에서 읽는 것.

---

## 🧭 주제별 지도

> **디렉토리가 곧 분류다.** 2026-08-02 부터 문서는 폴더로 나뉘고, `auto-layout/` 은
> **코드 트리의 거울**이다 — 코드 폴더의 `CLAUDE.md` 가 같은 이름의 문서 폴더를 가리키므로
> 그 코드를 건드리면 해당 문서가 자동으로 시야에 들어온다.
> 폴더 경계의 정의는 [code-folders](auto-layout/common/code-folders.md) 의 **두 축**이다.

```
docs/
├ auto-layout/  ← frontend/src/utils/autoLayout/ 의 거울
│   ├ common/     전략 무관 — 전부가 본다
│   ├ module/     모듈 안쪽 (형제를 모른다)
│   ├ link/       모듈과 모듈의 연결
│   ├ channel/    모듈 사이 통로 예약
│   └ perimeter/  전역 외곽 반출
├ factorio/     게임 데이터·시맨틱스 (코드 대응 없음)
├ blueprint/    import/export
└ deferred/     보류·폐기 — 다음 시도가 같은 함정에 안 빠지게
```

### 🏗️ 레이아웃 자동완성 `#auto-layout`

레시피 → 머신/투입기/벨트 자동 배치. **부모: [wizard](auto-layout/wizard.md)**

> **현행(2026-07-26):** 실행 경로는 **모듈 파이프라인 단일 경로**다 —
> `layeredWizard.runLayeredWizard`(트리 전개·머신 선정) → `moduleWizard.tryRunModulePipeline`(배치 전부).
> 폴백할 옛 경로가 없어, 실패하면 `RejectReason` 이 그대로 UI 실패 라벨로 나온다.
>
> 아래에서 **[역사]** 는 코드에 없는 것을 설명하는 문서다 — 왜 그렇게 안 하는지의 논거로만 읽는다.

#### `common/` — 전략 무관, 전부가 본다

| 문서 | 주제 |
|------|------|
| [code-folders](auto-layout/common/code-folders.md) | **폴더가 무엇을 말하나** — 두 축(계층 × 관심사) · 현재 트리 · 검증 명령. **auto-layout 코드를 건드리기 전에 먼저 읽는다** |
| [placement-search](auto-layout/common/placement-search.md) | **모델 단일 출처** — 컨테이너 모델(불변) + 정합성 조건(C/O/M). Part II 의 S-LAYER 흐름은 삭제됨 |
| [entity-roles](auto-layout/common/entity-roles.md) | 엔티티 4분류 (변환기 / 핸드오프 / 고체운반 / 액체운반) |
| [known-limits](auto-layout/common/known-limits.md) | 알려진 약점·한계 9건 + 우선순위(P1~P3) |
| [priority-ordering](auto-layout/common/priority-ordering.md) | 배치·라우팅 순서 결정점 등록부 |
| [tech-tree-resolution](auto-layout/common/tech-tree-resolution.md) | 선택한 머신/레시피의 필요 기술 closure 산출 (배치 이전 단계) |

#### `module/` — 모듈 안쪽 (형제를 모른다)

| 문서 | 주제 |
|------|------|
| [trunk-redesign](auto-layout/module/trunk-redesign.md) | **[구현됨]** 새 트렁크 — "씨앗 발견"→"1:1 을 합친 결과". §10 이 `insertingPlanner`+`emitTapInserting` 으로 돈다 |
| [trunk-pipe](auto-layout/module/trunk-pipe.md) | **[구현됨]** 트렁크 파이프 — 유체를 모듈 파이프라인에. 기둥 유지 + 머신 90° 회전 |
| [ns-face-relief](auto-layout/module/ns-face-relief.md) | count=1 raw 입력의 노출 N/S 면 슬롯 (W-spill 갇힘 치료) |

#### `link/` — 모듈과 모듈의 연결

| 문서 | 주제 |
|------|------|
| [machine-link](auto-layout/link/machine-link.md) | **[설계]** 자식→부모 연결 통일 — 논리(MachineLink) vs 기하 두 층. Hop=Link, 포트=링크 끝점, gap=부산물 |
| [fluid-hop](auto-layout/link/fluid-hop.md) | **[동작]** 유체 홉 — 자식 유체 출력→부모 유체 입력(pipe-to-pipe). v1=모듈당 유체 1줄 |

#### `channel/` — 모듈 사이 통로 예약

| 문서 | 주제 |
|------|------|
| [channel-geometry-reservation](auto-layout/channel/channel-geometry-reservation.md) | 채널 예약을 폭→기하로 승격 — 납품·반출의 같은 쪽 판정 (구현 완료) |
| [fluid-hop-reservation](auto-layout/channel/fluid-hop-reservation.md) | **[구현됨]** 유체 홉을 채널 기하 예약 안으로. 인접(합류) 규칙 + 유체 지상 우선권 |
| [fluid-underground-crossing](auto-layout/channel/fluid-underground-crossing.md) | **[계획]** 유체 지하 횡단을 장부 안으로 |
| [s-layer-channel-reservation](auto-layout/channel/s-layer-channel-reservation.md) | **[역사]** S-LAYER 채널 예약 — 본체는 삭제됨. 남긴 이유 = "왜 채널을 비워 두는가" |

#### `perimeter/` — 전역 외곽 반출

| 문서 | 주제 |
|------|------|
| [perimeter-export](auto-layout/perimeter/perimeter-export.md) | **총론** — 왜 상자가 바깥에 있어야 하나 · 3단 흐름(계약/예약/방출) · 옛 탐색형을 왜 버렸나 |
| [module-way-outs](auto-layout/perimeter/module-way-outs.md) | ↳ ①단계 계약 — 모듈이 "이 상자가 나갈 수 있는 문"을 답한다 |

### 🧩 Factorio 데이터 · 시맨틱스 `#factorio-data`

Factorio API/데이터의 비직관적 동작과 그 해석.

| 문서 | 주제 |
|------|------|
| [pipe-semantics](factorio/pipe-semantics.md) | **파이프의 작동 방식 — 벨트와 항목별 대조**(방향 없음·처리량 무한·합류 가드) |
| [fluid-box-semantics](factorio/fluid-box-semantics.md) | `production_type` vs `flow_direction`, 상자의 **면**과 **받는 유체 이름** |
| [map-position-parsing](factorio/map-position-parsing.md) | MapPosition 의 keyed/positional 이중 형태와 3중 방어 정규화 |
| [direction-encoding](factorio/direction-encoding.md) | 내부 `Direction` 을 Factorio 2.0 16-방향으로 통일 (1.x ×2 업그레이드) |

### 📦 Blueprint import/export `#blueprint`

| 문서 | 주제 |
|------|------|
| [metadata-coverage](blueprint/metadata-coverage.md) | export 메타데이터 커버리지 — 현재 → 전체 단계별 계획 + 체크리스트 |
| [control-behavior-scope](blueprint/control-behavior-scope.md) | 추적하는 ControlBehavior 필드 범위 |

### 🔍 검사 · 진단 `#visualization`

| 문서 | 주제 |
|------|------|
| [belt-flow-inspection](belt-flow-inspection.md) | 벨트 셀 클릭 → 운반 품목·items/sec. 세션이 아니라 **그리드 정적 분석**이라 수동 배치도 동작 |

### 🚧 보류 · 폐기 결정 `#deferred`

시도했으나 보류/폐기한 항목. **다음 시도가 같은 함정에 빠지지 않도록** 기록.

| 문서 | 주제 |
|------|------|
| [icon-mapping](deferred/icon-mapping.md) | 엔티티 아이콘 매핑 — 런타임 API 의도적 차단 (보류) |
| [surface-restriction-limits](deferred/surface-restriction-limits.md) | 표면 제약 자동 판단 포기 → 사용자가 직접 머신 선택 |
| [parametrized-blueprints-deferred](deferred/parametrized-blueprints-deferred.md) | parameter-0~9 placeholder 처리 보류 |
| [pipeline-metrics](deferred/pipeline-metrics.md) | **[이력]** 계측기 — 도구는 삭제됨. 남긴 건 1:1 기준선 **실측 수치** |

---

## 도큐먼트 명명 규칙 — 디렉토리가 관계를 말한다

**2026-08-02 개정: dot-notation 폐지.** 예전엔 파일명 접두어로 부모–자식을 표현했다
(`auto-layout-wizard.placement-search.md`). 정렬된 목록에서 부모 아래 자식이 모이게 하려던
것인데, **디렉토리가 그 일을 더 잘 한다** — 게다가 접두어는 폴더 이름과 중복이 된다.

```
auto-layout-wizard.placement-search.md   →  auto-layout/common/placement-search.md
auto-layout-wizard.module-way-outs.md    →  auto-layout/perimeter/module-way-outs.md
```

**어느 폴더인가는 [code-folders](auto-layout/common/code-folders.md) 의 두 축으로 판정한다.**
문서가 코드 폴더에 대응하면 그 거울로 두고, 대응이 없으면 주제로 둔다(`factorio/`·`blueprint/`).
사전과 MOC 는 전역이라 최상위에 남는다.

**파일명은 짧게, 관계는 서두 박스가 말한다:**

```markdown
> **부모 문서:** [wizard.md](../wizard.md)
> **관련 문서:** [module-way-outs](module-way-outs.md) — ①단계 계약 상세 · …
```

> **`[[위키링크]]` 는 이름으로 찾으므로 폴더 이동에 안 깨진다.** 대신 **이름을 바꾸면 깨진다** —
> 이번 개정에서 115군데를 고쳤다. 반대로 `](상대경로.md)` 는 폴더 이동에 깨지고 이름 변경에도
> 깨진다(168군데 재계산). 새 문서를 만들 때 **문서끼리는 `[[위키링크]]`** 를 쓰면 나중이 싸다.

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
| `#deferred` | 보류·폐기된 결정 |
| `#glossary` | 용어 사전 |
| `#moc` | 이 진입점 문서 · 용어 사전 |
| `#module` `#hop` | auto-layout 하위 보조 태그 — 모듈 안쪽 · 홉 세부 |
| `#planning` | 미구현 설계 계획서 |
| `#tooling` | 계측기·개발 도구 |
| `#visualization` | 배치 결과 검사·진단 표시 |

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
