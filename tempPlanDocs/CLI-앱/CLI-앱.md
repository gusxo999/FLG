---
tags: [tooling, 계획]
---

# CLI 앱 — 계획서

> 작성 2026-10-16 · 승인 대기. 이 문서의 *CLI* 는 터미널에서 명령으로 돌리는 프로그램이다(`npm run flg -- run …` 처럼 친다).
> 이 문서에서만 쓰는 이름 셋 — **핵심**(CLI 와 브라우저가 함께 부르는 계산 함수들) · **작업 폴더**(`.flg/`) · **보기 파일**(사람에게 보일
> 배치를 담은 파일). 이름은 §5 에서 정한다.

## 0. 한 장 요약

**문제.** AI 가 배치를 만들고 재는 일의 대부분을 하는데, 앱을 모는 길이 브라우저 콘솔(`window.flg`) 하나다. 그래서 넷이 막힌다.

| 막힌 것 | 지금 |
|---|---|
| 브라우저가 붙어야 한다 | 브라우저 확장이나 playwright 가 있어야 명령을 친다. 2026-10-16 세션도 중간에 연결이 끊긴 채 일했다 |
| 게임데이터가 브라우저 안에만 있다 | localStorage `factorio-game-data`. 다른 프로그램이 못 읽는다 |
| 배치를 하나만 기억한다 | localStorage `factorio-layout-store` 에 그리드 하나. 판을 놓을 때마다 앞의 것이 지워진다 |
| 사람에게 형태를 보일 길이 없다 | 2차원 글 그림을 쓰지 않기로 했다(2026-10-16). 앱으로 보여야 하는데 AI 가 만든 배치를 앱에 띄우려면 판마다 콘솔 스크립트를 짰다(`판-*.js`) |

**구조.** 계산은 한 곳(핵심)에만 둔다. 그 위에 손이 둘이다.

| | 누가 | 무엇을 | 상태를 어디에 |
|---|---|---|---|
| CLI | AI | 게임데이터 읽기 · 실행 · 결과 묻기 · 손으로 만든 배치 놓기 · 보기 파일 쓰기 | 작업 폴더의 파일 |
| 브라우저 앱 | 사람 | 화면 · 손 편집 · 보기 파일을 링크로 열기 | 지금처럼 localStorage. 보기 모드는 따로 |

**사람에게 보이는 길.** CLI 가 보기 파일을 쓰고 링크를 낸다 — `http://localhost:5173/?view=<이름>`. 앱이 그 파일을 읽어 띄운다. 보기 파일이
그 배치의 단일 출처다 — AI 가 묻는 대상과 사람이 보는 화면이 같은 파일에서 나온다.

## 1. 지금 무엇이 있나 — 조사(2026-10-16)

### 1.1 이미 브라우저 없이 도는 것

| 사실 | 근거 |
|---|---|
| 게임데이터 → 배치 실행 → 그리드 → 가동률이 node 에서 돈다 | `src/autoLayout/run/splitBelt.test.ts` · `src/analysis/flow/pipeline.test.ts` — vitest 의 node 환경(`vitest.config.ts`). 브라우저 없음 |
| 배치 실행은 게임데이터를 스토어에서 **한 번** 읽는다 | `layered.ts` 82행 `gameDataLookupOf(useGameDataStore.getState())`. 그 뒤로는 넘겨받은 값만 쓴다. Zustand 스토어는 node 에서도 만들어진다 |
| 결과를 그리드 좌표로 넘기는 일은 순수 함수다 | `autoLayout/shared/frames.unifyLeaf` |
| 가동률은 순수 함수다 | `analysis/flow/build.analyzeLayout(grid, ctx)` — 2026-10-16 `tempPlanDocs/형태-표기/검사.ts` 가 브라우저 없이 돌렸다 |
| 게임데이터 해석 · 커스텀 합성은 순수 함수다 | `factorio/parseGameData.parseGameData` · `factorio/customRecipe.compileCustomData` |
| 실행에 무작위가 없다 | `src/autoLayout` 에 `Math.random` 이 없다. 시각은 이벤트 루프 양보 간격에만 쓴다(`layered.ts` 225 · 241행). 같은 입력이면 같은 배치 |
| 결과는 JSON 으로 적을 수 있다 | `autoLayout/shared/types.ts` 에서 `Set`/`Map` 은 입력의 `internalIngredients` 하나뿐이다(배열로 바꿔 적는다) |
| 기동 시간 | `npx vite-node` 로 게임데이터 스토어 · 실행 · 단면표 · 가동률 모듈을 불러오는 데 2.7초(그중 불러오기 0.9초) — 2026-10-16 잰 값 |
| 개발 서버가 저장소의 파일을 그대로 내준다 | 점으로 시작하는 폴더도 — `.flg-probe/t.json` 을 만들어 `curl` 로 200 을 받고 지웠다(2026-10-16) |

### 1.2 브라우저에 묶인 것

| 자리 | 무엇에 묶였나 | CLI 에서 |
|---|---|---|
| 콘솔 명령 55개(`debugApi.ts` — grid 9 · wizard 5 · flags 11 · flow 4 · custom 10 · 최상위 16) | 대부분 스토어를 읽어 입력을 모은다 | 아래 1.3 으로 가른다 |
| `currentView()`(`layoutView.ts`) | `autoLayoutRunStore` 의 결과 | 결과 파일에서 같은 뷰를 짓는다 |
| `currentFlow()`(`flowStore.ts`) | `layoutStore.grid` · 게임데이터 · 위저드의 인서터 보정 | 같은 셋을 파일에서 모아 `analyzeLayout` |
| `buildReport()`(`report.ts`) | 스토어 넷 · 패널 등록 여부 · 명령 이력 · `runStats` | 입력을 인자로 받게 고친다. 화면 상태 줄(`screenState`)은 브라우저에만 |
| `runLayout()`(`runLayout.ts`) | 위저드 스토어 → 입력 · 실행 스토어 · 패널 적용 대기 | 입력 파일 → `runLayeredWizard` 직접 |
| 블루프린트 ↔ 칸 | `Toolbar.tsx` 컴포넌트 안(`handleExport` · `handleImportString`) | 컴포넌트 밖으로 꺼내야 부를 수 있다(단계 3 에서 필요해질 때) |
| 게임데이터 파일 읽기 | `Toolbar.tsx` `handleGameDataFile` — 파일 대화상자 | 파일 경로를 받는다 |
| 결과를 그리드에 올리기 | 6단계 패널의 React 이펙트(`AutoLayoutContainerPanel.handleApplyCandidate`) | 필요 없다 — CLI 는 결과 파일을 바로 읽는다 |

**게임데이터 파일은 지금 없다** — 게임의 출력 폴더(`%APPDATA%\Factorio\script-output\`)에 `factorio-data.json` 이 없다(2026-10-16 확인).
사용자의 게임데이터는 브라우저 localStorage 에만 있다.

### 1.3 콘솔 명령을 셋으로 가르면

| 무리 | 명령 | CLI 에서 |
|---|---|---|
| 입력만 주면 계산하는 것 | `face` · `check` · `cells` · `flow.machines` · `flow.at` · `flow.breaks` · `report`(화면 줄 빼고) · `snapshot`/`diff` · `custom.*`(spec 다루기) · `flags.*`(모듈 전역 — `entityIds` 빼고) | **옮긴다** — 같은 함수를 부른다 |
| 실행 | `run` | **옮긴다** — 입력 파일로 |
| 화면에 묶인 것 | `grid.*`(화면 그리드 편집) · `wizard.go`/`apply`/`layout`(6단계 패널) · `ui` · `state` · `entities` · `undo`/`redo` · `until` · `journal` · `flags.entityIds` | 브라우저에 남는다 |

## 2. 목표

| # | 목표 | 끝났다고 보는 기준 |
|---|---|---|
| G1 | AI 가 브라우저 없이 — 게임데이터 읽기 · 실행 · 결과 묻기(보고서 · 단면표 · 규칙 · 가동률 · 칸) · 손으로 만든 배치 놓고 재기 | 아래 명령이 터미널에서 돈다 |
| G2 | 사람은 링크 하나로 그 배치를 본다 — 지금 배치를 덮지 않고, 앱의 게임데이터에 없는 머신 · 레시피도 | 사용자가 링크를 열고, 닫은 뒤 원래 배치가 그대로다 |
| G3 | 같은 입력이면 CLI 와 브라우저가 같은 답 | 계산은 핵심에만 있다. 단계마다 두 쪽의 답을 견준다 |
| G4 | 칸을 가리킨다 — 줄 이름 · 지하 짝 · 강조를 화면에 | 방향 화살표 · 인서터의 집는/놓는 점은 이미 그린다(`pixi-draw-entity` · `pixi-draw-utils.drawSingleArrow`). 없는 것만 더한다 |

## 3. 설계

### 3.1 작업 폴더 `.flg/` — 저장소 루트, git 에 안 넣는다

| 파일 | 담는 것 |
|---|---|
| `gamedata.json` | 게임데이터. 두 모양을 다 받는다 — 게임의 내보내기 원본(`parseGameData` 로 해석) · 브라우저 저장본(`factorio-game-data` 의 `state`, 이미 해석된 것) |
| `custom.json` | 커스텀 머신 · 레시피 spec(`flg.custom.export()` 와 같은 모양) |
| `runs/<이름>.json` | 실행 한 번 — 입력 · 게임데이터 지문 · 상태 · 이슈 · 결과(그리드 좌표로 넘긴 leaf) · 계수기(`runStats`) · 플래그 |
| `views/<이름>.json` | 보기 파일(§3.4) |

**파일로 두는 까닭** — 배치를 하나만 기억하는 한계가 없어진다. AI 와 사람이 같은 파일을 본다. 같은 파일로 다시 돌릴 수 있다.

**게임데이터 지문** — 게임데이터 JSON 의 해시. CLI 의 모든 출력 첫 줄과 브라우저 보고서에 찍는다. 두 쪽의 게임데이터가 다르면 같은 입력에
다른 답이 나오는데, 그때 이 줄이 다르다.

### 3.2 명령 — 첫 판은 실제로 쓴 것만

규약은 콘솔과 같다(`ai-console.md` §0 · `debugApi.ts` 머리) — 첫 줄에 결과 한 줄, 못 쓰면 다음에 칠 명령과 함께 거절, 긴 산출물은 그대로 찍는다.

| 명령 | 하는 일 | 브라우저에서는 | 부르는 핵심 |
|---|---|---|---|
| `gamedata [파일]` | 읽고 요약 + 지문. 작업 폴더에 둔다 | 툴바 업로드 | `parseGameData` · `buildDerived` |
| `custom add <spec.json>` · `list` · `check` · `map` | 커스텀 다루기 | `flg.custom.*` | `customRecipe` · `customRecipeValidate` · `customData` 의 그리기 함수 |
| `run <입력.json> --as <이름>` | 실행 → `runs/<이름>.json` · 요약 · 이슈 | `flg.run` | `runLayeredWizard` · `unifyLeaf` |
| `report <이름>` | 보고서 | `flg.report` | `buildReport`(인자 받는 판) |
| `face <이름> <모듈> <면>` | 단면표 | `flg.face` | `faceTable.renderFace` |
| `check <이름>` | 규칙 위반(R-겹침 · R-연속 · R-도달 · R-무우회) | `flg.check` | `checkRules.checkLayout` |
| `flow <이름> [machines \| at x y \| breaks]` | 가동률 · 칸 하나 · 끊김 | `flg.flow.*` | `analyzeLayout` · `flowView` |
| `diff <이름1> <이름2>` | 두 배치의 차이 | `flg.snapshot` / `diff` | `snapshots.digestOf` · `diffDigests` |
| `put <칸.json> --as <이름>` | 손으로 만든 배치(칸 데이터)를 실행 결과처럼 둔다 | 없다 — `판-*.js` 가 판마다 하던 일 | 새로 — 칸 목록 → 그리드 |
| `line <이름> [줄]` | 줄 이름 붙이기 · 한 줄 따라가기 | 없다 | `형태-표기/형태표기.ts` 의 `nameLines` 를 핵심으로 |
| `rules <이름>` | 게임 규칙 검사 — 흘려 넣기(섞임 · 옆으로 실림) · 지하 짝 · 인서터 끝 | 없다 | 같은 파일의 `check` 를 핵심으로 |
| `view <이름> [--focus x,y,w,h] [--mark x,y,글]` | 보기 파일을 쓰고 링크를 찍는다 | 없다 | 새로(§3.4) |

`run` 의 입력 파일은 콘솔 `flg.run(…)` 의 덮어쓰기 인자와 같은 모양에 위저드 설정 몇 개를 더한다 — `target` · `perTarget` · `internal` ·
`machines` · `inserters` · `belts` · `ugBelts` · `pipes` · `recipeOverrides` · `inserterOverrides` · `flags`. 후보가 하나뿐인 칸을 저절로 고르는
규칙(`runLayout.effective` · `machineCandidates`)은 핵심으로 옮겨 두 쪽이 함께 쓴다 — 화면과 명령이 다른 것을 돌리지 않게 한 그 규칙이다.

### 3.3 핵심으로 옮길 것 — 스토어를 읽는 자리를 인자로

| 자리 | 지금 | 바꾼 뒤 |
|---|---|---|
| `layoutView.currentView()` | 실행 스토어를 읽어 뷰를 짓는다 | `viewOf(leaf)` 순수 함수 + 브라우저용 감싸개(지금 이름 그대로) |
| `flowStore.currentFlow()` | 스토어 셋을 모아 `analyzeLayout` | 모으는 일만 남고 계산은 그대로 — CLI 는 파일에서 같은 셋을 모은다 |
| `report.buildReport()` | 스토어 넷 · 패널 · 이력 · 계수기를 읽는다 | 그 값들을 한 객체로 받는다. 브라우저는 스토어에서, CLI 는 결과 파일에서 채운다. 화면 상태 줄 · 명령 이력은 브라우저만 |
| `runLayout.buildInput` 의 자동 선택 | 위저드 스토어 · 게임데이터 스토어 | 게임데이터를 인자로 받는 순수 함수 |
| `layered.ts` 82행 | 스토어를 한 번 읽는다 | **그대로 둔다** — CLI 가 스토어에 게임데이터를 넣고 부른다. 자동 배치 쪽을 안 고치는 길이다 |
| `runStats`(모듈 전역 계수기) | 실행 중에 쌓인다 | 그대로 — 명령 한 번이 프로세스 한 번이라 섞이지 않는다. 실행 끝에 결과 파일에 적는다 |

**원칙** — 브라우저의 `flg` 명령은 같은 핵심 함수를 부르는 감싸개가 된다. 계산이 두 벌이 되면 G3 이 깨진다.

### 3.4 보기 파일과 링크

**보기 파일**(v1)

| 칸 | 무엇 |
|---|---|
| `version` | 형식 버전 |
| `title` · `note` | 무엇을 보이는 판인지 — 글로 |
| `gameDataFingerprint` | 만들 때의 게임데이터 지문 |
| `entities` · `recipes` | **이 배치가 쓰는 프로토타입만** 골라 싣는다 — 크기 · 종류 · 집는/놓는 점 · 속도 · 레시피 |
| `custom` | 커스텀 머신 · 레시피 spec — 게임에 없는 이름 · 크기 · 속도 |
| `cells` | 칸 목록(`applyPlacedCells` 가 받는 모양) |
| `labels` | 칸 위에 쓸 글 — 줄 이름(`a` · `b1`) |
| `marks` | 강조 — 사각형 · 화살표 · 짧은 글 |
| `focus` | 처음 보일 자리 |

**자기 완결** — 쓰는 프로토타입을 파일에 싣기 때문에, 브라우저의 게임데이터가 무엇이든 같은 화면 · 같은 가동률이 나온다. 앱의 게임데이터에
없는 머신(사용자가 짚은 한계)도 이 길로 띄운다.

**링크** — `http://localhost:5173/?view=<이름>`. 앱이 개발 서버에서 `/.flg/views/<이름>.json` 을 받아 띄운다. 링크가 짧고, 배치가 커도
길이가 안 늘고, AI 가 읽는 파일과 같다. 사용자가 처음 낸 *인코딩한 문자열을 주소에 넣는* 방식은 이 컴퓨터 밖으로 보낼 때만 쓰는 둘째 길로
둔다(§5).

**앱의 보기 모드**

| 할 일 | 까닭 |
|---|---|
| 저장 키를 따로 쓴다 — 보기 모드에서는 `layoutStore` · `customDataStore` · `gameDataStore` · `wizardStore` 가 다른 키에 쓰거나 안 쓴다 | 사용자가 기억시킨 배치 하나를 덮지 않는다. 스토어는 모듈을 불러올 때 만들어지므로, 그 전에 주소를 보고 정한다 |
| 보기 파일의 프로토타입 · 커스텀으로 게임데이터를 짓는다 | 자기 완결 |
| 화면 위에 *보기 모드 — <이름>* 과 나가기 | 지금 무엇을 보고 있는지 |
| 라벨 · 강조 · 첫 자리를 그린다 | G4. 글을 칸 위에 쓰는 그리기는 이미 있다(무한상자의 I/O · 가동률 배지 — `pixi-renderer.ts` · `pixi-draw-flow.ts`) |
| 지하 짝을 선으로 잇는다 | G4. 지금 화면은 입구 · 출구를 따로 그린다 |

**고르면 더할 것** — AI 가 보기 파일을 다시 쓰면 열린 탭이 저절로 새로 그린다(개발 서버가 파일 변경을 탭에 알린다). 단계 2 의 선택이다.

## 4. 단계 — 단계마다 따로 쓸모가 있다

| 단계 | 하는 일 | 끝났다고 보는 기준(확인) |
|---|---|---|
| **1. 머리** | CLI 뼈대(`npm run flg -- <명령>` · vite-node) · `gamedata` · `custom` · `run` · `report` · `face` · `check` · `flow` · `diff`. `report` 만 인자를 받게 고치고, 나머지는 있는 함수를 그대로 부른다 | 같은 입력을 브라우저 `flg.run` 과 CLI `run` 으로 돌려 — `report` 의 계수기 줄 · `flow machines` 글 · `check` 글이 같다(시각 · id 빼고). 게임데이터 지문이 같다 |
| **2. 보기** | `view` 명령 · 앱의 `?view=` 보기 모드(덮지 않음 · 자기 완결) · 라벨 · 강조 · 지하 짝 선 | CLI `flow` 와 브라우저의 가동률 테두리가 같은 답이다. 사용자가 링크로 열고 닫은 뒤 원래 배치 · 커스텀 · 위저드 설정이 그대로다(**이것을 첫 확인으로 한다**) |
| **3. 손 배치** | `put` · `line` · `rules`. `판-긴팔-품목12.js` 를 칸 데이터로 바꿔 `put` 으로 다시 놓는다. 블루프린트 ↔ 칸 변환을 컴포넌트 밖으로 꺼낸다(필요해지면) | 그 판이 CLI 에서 6대 100% — 2026-10-15 브라우저에서 잰 값과 같다. `rules` 가 2026-10-16 일부러 틀린 판(옆으로 실림)을 잡는다 |
| **4. 흡수** | 브라우저 `flg` 의 겹치는 명령을 핵심 호출로 바꾼다. `docs/debug/ai-console.md` 를 CLI 기준으로 고친다. 루트 `CLAUDE.md` 의 확인 절차를 CLI 로 | 겹치는 계산이 한 벌이다(`flg` 와 CLI 가 같은 함수를 부른다) |

## 5. 정할 것 — 사용자

| # | 무엇 | 길 | 권하는 것 |
|---|---|---|---|
| 1 | 게임데이터 파일을 어떻게 얻나 | (가) 게임에서 내보내기 Lua 를 다시 돌려 `script-output/factorio-data.json` (나) 브라우저 저장본을 한 번 파일로 내려받아 `.flg/gamedata.json` (다) 브라우저가 켜질 때 개발 서버로 보내 저절로 맞춘다 | (나) — 지금 브라우저가 쓰는 데이터와 같아 지문이 맞는다. (다)는 개발 서버에 받는 자리를 더해야 한다 |
| 2 | 보기 모드의 게임데이터 | 보기 파일에 실린 것만 쓴다 · 브라우저의 게임데이터 위에 얹는다 | 실린 것만 — 자기 완결이라 CLI 와 화면이 언제나 같다 |
| 3 | 링크의 모양 | 파일 이름(`?view=<이름>`) · 인코딩한 문자열을 주소에 | 파일 이름을 먼저, 문자열은 둘째 길 |
| 4 | 이름 | CLI 명령 이름(`flg` 그대로?) · 작업 폴더(`.flg/`) · *보기 파일* · *핵심* | — |

## 6. 위험

| 위험 | 막는 법 |
|---|---|
| vite-node 가 vitest 2.1.9 에 딸려 있고 vite 는 8 이다 — 버전이 엇갈리면 CLI 가 안 뜬다 | 오늘 돈다(§1.1). vite-node 를 직접 의존성으로 넣고 버전을 박는다 |
| CLI 와 브라우저의 게임데이터가 다르면 같은 입력에 다른 답 | 지문을 양쪽에 찍는다 · 보기 파일은 자기 완결 |
| 핵심으로 옮기다 브라우저 명령이 깨진다 | 단계마다 브라우저 `flg` 로 같은 답을 확인한다 |
| 보기 모드가 저장을 못 피하면 사용자의 배치를 덮는다 | 단계 2 의 첫 확인 · 저장 키를 정하는 일을 스토어가 만들어지기 전에 한다 |
| 스토어 모듈을 불러올 때 브라우저 전역을 건드린다 | 지금은 괜찮다 — i18n 은 `navigator` 가 없으면 영어로 간다. node 테스트가 같은 모듈을 이미 불러 쓴다 |
| 명령마다 2.7초 기동 | 받아들인다. 느려지면 묶어서 빌드한다 |

## 7. 지금 있는 것과의 관계

| 있는 것 | 이 계획 뒤 |
|---|---|
| `tempPlanDocs/형태-표기/검사.ts`(합성 게임데이터로 가동률) | `flow` 가 실제 게임데이터로 대신한다 |
| `형태-표기/형태표기.ts` 의 `check` · `nameLines` | 핵심으로 옮겨 `rules` · `line` 이 부른다. 2차원 글을 읽고 쓰는 `parse` · `render` 는 쓰지 않는다 |
| `재료-둘-이상-부모/판-*.js`(판마다 짠 콘솔 스크립트) | 칸 데이터 + `put` · `view` 로 바뀐다 |
| 같은 폴더의 전수 스크립트(`한면-줄셋.py` · 다른 세션의 `세로줄-전수.cjs` · `칸표-검사.cjs`) | 결과를 보기 파일로 내면 사람에게 보인다 — 각 스크립트의 일이다(이 계획 밖) |
| `docs/debug/ai-console.md` | 단계 4 에서 CLI 기준으로 고친다 |
