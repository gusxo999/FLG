# CLAUDE.md

## 설계 지식 베이스 — `docs/`

`docs/` 는 코드만으로는 자명하지 않은 **"왜"** 를 기록한 설계 문서 모음이다(저장소 루트가 Obsidian vault 다).
진입점은 [docs/README.md](docs/README.md) — 주제별 지도(MOC)와 태그 규칙이 여기 있다.

**작업 전 참조 규칙:**

- **자동 레이아웃(auto-layout) 코드**(`src/autoLayout/**`, `AutoLayoutModal.tsx`, 배치·라우팅·트렁크·채널)를
  수정·설계하기 전에 **[code-folders](docs/auto-layout/common/code-folders.md)** 를 먼저 읽는다 — **폴더는 관심사,
  파일 이름은 일의 종류**이고, 어느 파일이 아직 그 축과 어긋나 있는지가 거기 있다.
  그다음은 건드리는 폴더의 `CLAUDE.md` 가 안내한다(`autoLayout/` · `module/` · `shared/` ·
  `channel/` 에 각각 있고, **그 폴더 파일을 열면 함께 들어온다**). **`planner/` · `execution/` ·
  `manualEdit/` 는 없어졌다**(2026-09-16 — 폴더는 관심사만 말한다).
  주제별 문서는 **`docs/auto-layout/` 가 코드 트리의 거울**이라 폴더로 찾는다
  (`common` · `module` · `link` · `channel` · `perimeter`). 지도는 [docs/README.md](docs/README.md).
- **Blueprint import/export, Factorio 데이터 시맨틱스**(방향 인코딩, MapPosition, 유체 상자, 메타데이터)를
  다룰 때는 [docs/README.md](docs/README.md) 의 "Factorio 데이터" / "Blueprint" 그룹에서 해당 문서를 찾아 읽는다.
- **문서를 쓰거나 옮길 때**는 [docs/CLAUDE.md](docs/CLAUDE.md) 가 안내한다(그 폴더를 건드리면 자동 로딩).
- 문서와 코드가 어긋나면 — 코드는 **"지금 무엇이 일어나는가"의 단일 출처**이지 **"무엇이어야 하는가"의
  출처가 아니다.** 어긋남을 보면 어느 쪽이 어긋났는지 **먼저 판정한다** — 문서가 낡았으면 갱신하고,
  **코드가 개념에 미달한 것이면 문서를 고치지 않고 결함으로 적는다**(판정표는 [docs/CLAUDE.md](docs/CLAUDE.md)).

**화면 동작을 확인해야 하면 스크린샷이 아니라 콘솔이다.** `window.flg` 로 실행·단면표·규칙
검사를 명령으로 친다(`npm run dev` → `localhost:5173`). 브라우저를 몰 수 있으면 **직접**
치고, 아니면 사용자에게 `copy(flg.report())` 결과를 받는다.

```js
await flg.run()   →   copy(flg.report())   →   flg.face(모듈,'W') · flg.check() · flg.flow.machines()
```

목록은 `flg.help()`, 규약·괴리는 [docs/debug/ai-console.md](docs/debug/ai-console.md).
**게임 프로토타입은 콘솔로 못 넣는다** — 파일 업로드뿐이고 localStorage 에 남는다(§정직한 괴리).
다만 **커스텀 레시피·머신은 콘솔로 넣는다**(`flg.custom.add` · `flg.custom.map`) — 게임에 없는
레시피나 유체 상자 배치를 실데이터 없이 시험하는 길이다([custom-recipe](docs/factorio/custom-recipe.md)).

**배치 모양(형태)을 사람에게 보일 때는 앱으로 한다 — 대화 · 문서에 2차원 글 그림을 쓰지 않는다**(2026-10-16 사용자 방향).
길은 CLI `factoriolayoutgen` 의 **배치 링크**다(2026-10-18 — 지금은 형태 토론에 필요한 만큼만 있다):

```powershell
node factoriolayoutgen.mjs place <놓기 파일> --as <이름>   # 손으로 만든 배치 · 쓰는 프로토타입을 함께 — 파일 모양은 cli/commands/place.ts 머리
node factoriolayoutgen.mjs flow <이름> [at x y | breaks]   # 가동률 — 앱 캔버스와 같은 함수
node factoriolayoutgen.mjs link <이름> --open              # 사람에게 보인다 — 이 컴퓨터의 브라우저에 바로(앱은 npm run dev 의 localhost:5173)
node factoriolayoutgen.mjs link --clipboard --as <이름>     # 사람이 화면에서 손보고 「링크 복사」 한 것을 클립보드에서 받는다
```

**링크 문자열을 손으로 옮겨 적지 않는다** — 천 자가 넘어 옮기면 틀린다(2026-10-19 실측: 1544자 중 한 글자가 바뀌어 안 풀렸다).
사람에게는 `--open`(또는 클립보드에 넣는 `--copy`), 받을 때는 `--clipboard`.

링크는 배치와 거기 쓰인 프로토타입 · 인서터 운반량을 담는다 — 브라우저의 게임데이터와 상관없이 같은 화면 · 같은 가동률이다.
링크로 연 탭은 저장하지 않는다(사용자의 배치를 안 덮는다). **칸 설명**(`labels`)으로 줄 이름을 붙이고 칸을 가리킨다 —
캔버스는 칸 안의 번호와 자리가 나는 글만 그리고, 전문은 왼쪽 아래 목록 · 정보 모달 아래 창에 있다. 사람도 고치고 새로 쓴다(「링크 복사」에 실린다).
정한 것과 남은 일은 [tempPlanDocs/CLI-앱/CLAUDE.md](tempPlanDocs/CLI-앱/CLAUDE.md) 의 결정 기록.

**실패는 삼키지 않는다.** 콘솔 `[autoLayout] 모듈 경로 포기 [<kind>]: <detail>` 이 사유의 단일 출처다.
사유 카탈로그는 `src/autoLayout/shared/issue.ts` 의 `LayoutIssue` (2026-08-04 `moduleWizard.RejectReason` 을 흡수 —
*어디가* 막혔는지와 *무엇을 고쳐야* 하는지가 문장에서 필드로 갈렸다),
읽는 법은 [docs/변수명사전.md](docs/변수명사전.md).

```powershell
npx tsc -p tsconfig.app.json --noEmit   # 반드시 -p. 인자 없는 tsc 는 0개 검사하고 조용히 성공한다
npx tsc -p tsconfig.cli.json --noEmit   # CLI(cli/) — Node 타입을 켠 설정. 앱 빌드는 이것을 검사하지 않는다
npx vitest run                          # 기준선: 타입 0 · 82파일 1052테스트 (**2건은 기존 실패** — trunkPipe 유체 면)
```
