# CLAUDE.md

## 설계 지식 베이스 — `docs/`

`docs/` 는 코드만으로는 자명하지 않은 **"왜"** 를 기록한 설계 문서 모음이다(저장소 루트가 Obsidian vault 다).
진입점은 [docs/README.md](docs/README.md) — 주제별 지도(MOC)와 태그 규칙이 여기 있다.

**작업 전 참조 규칙:**

- **자동 레이아웃(auto-layout) 코드**(`src/autoLayout/**`, `AutoLayoutModal.tsx`, 배치·라우팅·트렁크·채널)를
  수정·설계하기 전에 **[code-folders](docs/auto-layout/common/code-folders.md)** 를 먼저 읽는다 — 폴더가 두 축
  (계층 × 관심사) 중 무엇을 말하는지, 어느 파일이 아직 그 축과 어긋나 있는지가 거기 있다.
  그다음은 건드리는 폴더의 `CLAUDE.md` 가 안내한다(`autoLayout/` · `planner/` · `module/` ·
  `execution/` · `manualEdit/` 에 각각 있고, **그 폴더 파일을 열면 함께 들어온다**).
  주제별 문서는 **`docs/auto-layout/` 가 코드 트리의 거울**이라 폴더로 찾는다
  (`common` · `module` · `link` · `channel` · `perimeter`). 지도는 [docs/README.md](docs/README.md).
- **Blueprint import/export, Factorio 데이터 시맨틱스**(방향 인코딩, MapPosition, 유체 상자, 메타데이터)를
  다룰 때는 [docs/README.md](docs/README.md) 의 "Factorio 데이터" / "Blueprint" 그룹에서 해당 문서를 찾아 읽는다.
- **문서를 쓰거나 옮길 때**는 [docs/CLAUDE.md](docs/CLAUDE.md) 가 안내한다(그 폴더를 건드리면 자동 로딩).
- 문서와 코드가 어긋나면 **코드가 현재 사실**이다. 어긋남을 발견하면 문서를 삭제만 사용해 갱신한다.

**화면 동작을 확인해야 하면 스크린샷이 아니라 콘솔이다.** `window.flg` 로 실행·단면표·규칙
검사를 명령으로 친다(`npm run dev` → `localhost:5173`). 브라우저를 몰 수 있으면 **직접**
치고, 아니면 사용자에게 `copy(flg.report())` 결과를 받는다.

```js
await flg.run()   →   copy(flg.report())   →   flg.face(모듈,'W') · flg.check()
```

목록은 `flg.help()`, 규약·괴리는 [docs/debug/ai-console.md](docs/debug/ai-console.md).
**게임데이터는 콘솔로 못 넣는다** — 파일 업로드뿐이고 localStorage 에 남는다(§정직한 괴리).

**실패는 삼키지 않는다.** 콘솔 `[autoLayout] 모듈 경로 포기 [<kind>]: <detail>` 이 사유의 단일 출처다.
사유 카탈로그는 `layoutIssue.LayoutIssue` (2026-08-04 `moduleWizard.RejectReason` 을 흡수 —
*어디가* 막혔는지와 *무엇을 고쳐야* 하는지가 문장에서 필드로 갈렸다),
읽는 법은 [docs/변수명사전.md](docs/변수명사전.md).

```powershell
npx tsc -p tsconfig.app.json --noEmit   # 반드시 -p. 인자 없는 tsc 는 0개 검사하고 조용히 성공한다
npx vitest run                          # 기준선: 타입 0 · 45파일 537테스트
```

## 프로젝트 메모리

메모리는 Claude 자동 메모리 폴더에 있고 **세션마다 자동 로딩**되므로 따로 읽지 않는다.
저장소 안에 사본은 없다(`docs/memory/` 정션은 존재하지 않는다).
