# CLAUDE.md

## 설계 지식 베이스 — `docs/`

`docs/` 는 코드만으로는 자명하지 않은 **"왜"** 를 기록한 설계 문서 모음이다(저장소 루트가 Obsidian vault 다).
진입점은 [docs/README.md](docs/README.md) — 주제별 지도(MOC)와 태그 규칙이 여기 있다.

**작업 전 참조 규칙:**

- **자동 레이아웃(auto-layout) 코드**(`frontend/src/utils/autoLayout/**`, `AutoLayoutModal.tsx`, 배치·라우팅·트렁크·채널)를
  수정·설계하기 전에 관련 문서를 먼저 읽는다:
  - 코드 지도(`module/` · `planner/` · `util/` 세 폴더의 경계): [docs/code-folders.md](docs/code-folders.md)
  - 컨테이너 모델·정합성 조건(전략 무관 불변 기반): [docs/auto-layout-wizard.placement-search.md](docs/auto-layout-wizard.placement-search.md) Part I
  - 자식→부모 연결 = 링크 모델: [docs/auto-layout-wizard.machine-link.md](docs/auto-layout-wizard.machine-link.md)
  - 채널 예약(기하 장부): [docs/auto-layout-wizard.channel-geometry-reservation.md](docs/auto-layout-wizard.channel-geometry-reservation.md)
  - 위저드 UI/입출력: [docs/auto-layout-wizard.md](docs/auto-layout-wizard.md)
  - 알려진 한계·우선순위: [docs/auto-layout-wizard.known-limits.md](docs/auto-layout-wizard.known-limits.md)
  - 엔티티 4역할: [docs/entity-roles.md](docs/entity-roles.md)
- **Blueprint import/export, Factorio 데이터 시맨틱스**(방향 인코딩, MapPosition, 유체 상자, 메타데이터)를
  다룰 때는 [docs/README.md](docs/README.md) 의 "Factorio 데이터" / "Blueprint" 그룹에서 해당 문서를 찾아 읽는다.
- 문서와 코드가 어긋나면 **코드가 현재 사실**이다(문서는 시점 기록). 어긋남을 발견하면 문서를 갱신한다.

## 자동 배치 실행 경로 (2026-07-26)

배치 알고리즘은 **모듈 파이프라인 단일 경로**다. 폴백할 옛 경로는 없다.

```
AutoLayoutContainerPanel
  └ layeredWizard.runLayeredWizard   ← 진입점. 레시피 트리 전개 + 머신 선정까지만
      └ planner/moduleWizard.tryRunModulePipeline   ← 배치 전부
          → 성공: CandidateLeaf 1개
          → 실패: RejectReason (그 문구가 UI 실패 라벨로 그대로 나간다)
```


**실패는 삼키지 않는다.** 콘솔 `[autoLayout] 모듈 경로 포기 [<kind>]: <detail>` 이 사유의 단일 출처다.
사유 목록은 `moduleWizard.RejectReason`, 읽는 법은 [docs/변수명사전.md](docs/변수명사전.md).

```powershell
cd frontend
npx tsc -p tsconfig.app.json --noEmit   # 또는 npx tsc -b (= npm run build 앞단)
npx vitest run
```

## 프로젝트 메모리

메모리는 Claude 자동 메모리 폴더(`~/.claude/projects/<프로젝트>/memory/`)에 있고 **세션마다 자동
로딩**되므로 따로 읽을 필요가 없다. 저장소 안에는 사본이 없다(`docs/memory/` 정션은 존재하지 않는다).
특정 메모리가 가리키는 `docs/` 문서는 위 규칙대로 펼쳐본다.
