# CLAUDE.md

## 설계 지식 베이스 — `docs/`

`docs/` 는 코드만으로는 자명하지 않은 **"왜"** 를 기록한 설계 문서 모음이다(Obsidian vault 이기도 함).
진입점은 [docs/README.md](docs/README.md) — 주제별 지도(MOC)와 태그 규칙이 여기 있다.

**작업 전 참조 규칙:**

- **자동 레이아웃(auto-layout) 코드**(`frontend/src/utils/autoLayout/**`, `AutoLayoutModal.tsx`, 배치·라우팅·트렁크·채널)를
  수정·설계하기 전에 관련 문서를 먼저 읽는다:
  - 모델·전략 단일 출처: [docs/auto-layout-wizard.placement-search.md](docs/auto-layout-wizard.placement-search.md)
  - 위저드 UI/입출력: [docs/auto-layout-wizard.md](docs/auto-layout-wizard.md)
  - 알려진 한계·우선순위: [docs/auto-layout-wizard.known-limits.md](docs/auto-layout-wizard.known-limits.md)
  - 엔티티 4역할: [docs/auto-layout-wizard.entity-roles.md](docs/auto-layout-wizard.entity-roles.md)
- **Blueprint import/export, Factorio 데이터 시맨틱스**(방향 인코딩, MapPosition, 유체 상자, 메타데이터)를
  다룰 때는 [docs/README.md](docs/README.md) 의 "Factorio 데이터" / "Blueprint" 그룹에서 해당 문서를 찾아 읽는다.
- 문서와 코드가 어긋나면 **코드가 현재 사실**이다(문서는 시점 기록). 어긋남을 발견하면 문서를 갱신한다.

**새 설계 결정을 내렸으면** [docs/README.md](docs/README.md) "새 문서 작성 가이드" 형식에 맞춰 `docs/` 에 문서를 추가하고
frontmatter 태그를 단다.

## 프로젝트 메모리

`docs/memory/` 는 Claude 자동 메모리 폴더의 정션(실시간 동기)이다. 메모리는 세션마다 자동 로딩되므로
별도로 읽을 필요는 없으나, 특정 메모리가 가리키는 `docs/` 문서는 위 규칙대로 펼쳐본다.
