---
tags: [tooling, planning]
---

> **관련 문서:** [[변수명사전]] — 콘솔에서 **읽는** 것(플래그·진단 출력)의 사전. 이 계획은 그 옆에
> **치는** 것을 만든다 · [[belt-flow-inspection]] — 화면 조작으로만 닿던 진단의 선례

# AI 콘솔 조작 — 화면의 모든 버튼을 명령 한 줄로

## 0. 한 줄 요약

`window.flg` 를 스토어 몇 개를 찌르는 임시 도구에서 **화면 조작의 거울**로 키운다.
핵심은 명령을 많이 만드는 것이 아니라 셋이다 — **버튼과 명령이 같은 함수를 가리키게**
만들고(구조로 집행), **무엇이 있는지는 `flg.help()` 가** 답하고(문서는 카탈로그를 안 적는다),
**누르기와 같은 무게로 보기**(`flg.ui()`)를 준다.

---

## 1. 문제 — 왜 필요한가

**AI 는 화면을 못 본다.** 지금 이 저장소에서 AI 가 앱의 동작을 확인하는 길은 셋뿐이다:

1. 사용자가 스크린샷을 찍어 붙인다 → 눈대중. 메모리 `feedback_layout_check_by_dump` 가
   이미 이걸 금지하고 있다("배치는 스크린샷 눈대중 말고 좌표 덤프 + 규칙 검사로").
2. 사용자가 콘솔 로그를 복사해 붙인다 → 정확하지만, **그 로그가 나오게 만드는 조작이 손이다.**
3. 테스트를 돌린다 → 유닛 경계 안쪽만 본다. 위저드 7단계를 밟아 실행하는 경로는 안 지난다.

세 길 모두 **행동(누르기)이 사람 손에 갇혀 있다.** "3단계에서 인서터를 하나만 남기고
다시 돌려 보세요" 를 시키려면 문장으로 설명하고, 사용자가 클릭하고, 결과를 다시 복사해야
한다. 왕복 한 번에 조작 하나다.

`window.flg` 가 그 왕복을 줄이려고 만들어졌지만 **`layoutStore` 만 만진다.** 실제 화면의
조작 표면을 세어 보면:

| 표면 | 조작 수(대략) | `flg` 로 되는 것 |
|---|---|---|
| 툴바 | 9 | 되돌리기·다시실행 2 |
| 사이드바(팔레트) | 5 | 0 |
| 캔버스 | 9 | 배치·삭제·선택 4 (진짜 클릭은 아니다 — §5) |
| 자동배치 위저드 | 25+ | 배치 적용 1 |
| 모달·패널·튜토리얼 | 12 | 0 |
| 키보드 단축키 | 5 | 0 |

**원인 수준으로 적으면:** 이 앱에는 텍스트 채널이 하나뿐이고(콘솔 출력), 그건 **관측 전용**이다.
행동 채널이 없다. `flg` 는 행동 채널의 시작이지만 스토어 액션에서 멈춰 있어 **버튼이
아니라 스토어를 누른다** — 그 둘이 다른 자리가 이 앱에는 많다(§4).

---

## 2. 무엇을 만드나 — 세 부분

```
① 레지스트리     명령을 이름·인자·사전조건·라벨과 함께 등록하고, 실행을 한 줄로 기록한다
② 세 가지 노출   스토어 직접 / 컴포넌트가 등록 / 실제 이벤트 디스패치 — 버튼이 사는 자리에 따라
③ 관측           flg.ui() · flg.report() — "지금 화면이 어떤가" 를 텍스트로
```

①이 뼈대, ②가 이 계획의 **진짜 설계 판단**, ③이 없으면 ①②는 반쪽이다.

---

## 3. 명령의 모양 — 규약

### 3.1 이름은 화면 표면을 따른다

```
flg.help()                      전체 목록 (그룹별)
flg.help('wizard')              그룹 상세 — 인자·현재 사용 가능 여부·화면 라벨

flg.toolbar.*    상단 툴바
flg.sidebar.*    좌측 팔레트
flg.canvas.*     캔버스 위 조작 (진짜 포인터 경로)
flg.grid.*       그리드 직접 조작 (클릭을 안 거친다 — §5 에서 구분)
flg.wizard.*     우측 자동배치 위저드 (7단계 전부)
flg.inspect.*    정보 모달·모듈 패널·라우팅 모달
flg.flags.*      디버그 토글 (COORD DUMP · ENTITY IDS)
flg.key(...)     키보드 단축키
flg.scenario.*   매크로 — **버튼이 아니다**(§8)
```

**평면 14개를 그룹으로 옮긴다.** `state()`·`entities()`·`undo()`·`redo()`·`help()` 만
최상위에 남긴다(표면을 안 가리는 것들). 나머지 옛 이름은 지운다 — 사용자는 한 명이고
`flg.help()` 가 새 이름을 가르친다. 별칭을 남기면 두 이름이 문서와 로그에 섞인다.

### 3.2 모든 명령은 값을 돌려주고 한 줄을 찍는다

```
[flg] wizard.next() → 'machine'
[flg] wizard.toggle('inserter','fast-inserter') → 2개 선택됨
[flg] wizard.run() … 3.4s → done · 모듈 12 · 이슈 1(warning)
[flg] toolbar.export() → 1,842자 (클립보드 아님 — 반환값을 쓰세요)
```

- **접두어 `[flg] `** 로 통일한다. 콘솔 필터 한 단어로 조작 이력만 뽑기 위해서다
  ([[변수명사전]] §B 가 `모듈 경로 포기` 로 하는 것과 같은 이유).
- **인자를 그대로 다시 찍는다.** AI 가 받은 로그만 보고 *무엇을 쳤는지* 복원할 수 있어야 한다.
- **결과는 사람이 읽는 한 줄**이지 JSON 덤프가 아니다. 덤프는 `flg.report()` 가 맡는다.

### 3.3 사전조건은 처방과 함께 거절한다

```
[flg] wizard.run() ✗ 사용 불가 — 6단계(검토) 패널이 안 떠 있습니다. flg.wizard.go('review') 를 먼저.
```

이미 `flg.apply()` 가 비슷하게 하고 있다(`'자동배치 패널이 열려 있어야 합니다'`).
그것을 **모든 명령의 규칙**으로 올린다: 사용 불가면 `available` 이 거짓이고, 메시지는
**다음에 칠 명령**을 반드시 포함한다.

> **자동으로 조건을 채우지 않는다.** `wizard.run()` 이 알아서 6단계로 이동한 뒤 실행하면
> 편하지만, 그 순간 **명령이 버튼이 아니게 된다** — 콘솔에서 되는 재현이 실제 UI 에서
> 안 되고, AI 는 사용자에게 틀린 절차를 알려주게 된다. 이동은 이동 명령이 한다.

---

## 4. 어떻게 노출하나 — 세 방식과 판정 규칙

이 앱의 버튼은 **세 자리** 중 하나에 산다. 자리마다 "누른다" 의 정직한 구현이 다르다.

| | 방식 | 판정 | 예 |
|---|---|---|---|
| **A** | **스토어 액션 직접** | `onClick` 이 스토어 액션 **하나**다 | 되돌리기(`undo`) · 언어(`setLanguage`) · 엔티티 선택(`setSelectedEntity`) · 스텝 칩(`setStep`) |
| **B** | **컴포넌트가 등록한 핸들러** | 로직이 컴포넌트 안에 있다(로컬 state·ref·파일·클립보드·복합 절차) | 내보내기(`handleExport`) · 실행(`handleRun`) · 다음(`nextStep`) · 초기화(`handleReset`) |
| **C** | **실제 이벤트 디스패치** | 리스너가 React 밖(`window`·`canvas`)에 붙어 있다 | 키보드 단축키 · 캔버스 클릭·드래그·휠 |

### 4.1 A — 스토어 액션 직접

지금 `flg` 가 하는 것. 컴포넌트를 안 건드리므로 **가장 싸고, 그래서 먼저 한다.**
`layoutStore`·`wizardStore`·`settingsStore`·`uiDebugStore`·`inspectStore`·
`moduleInspectStore`·`toastStore`·`i18nStore` 가 전부 여기로 덮인다.

**한계를 정직하게:** A 는 *버튼이 아니라 스토어*를 누른다. 버튼이 스토어 액션 하나가
아닌 순간 A 는 거짓말이 된다. 실제 사례 셋:

- **"다음"** 은 `setStep` 이 아니다. `nextStep()` 은 `shouldSkip()` 으로 후보 1개짜리
  단계를 건너뛴다. `flg.wizard.go('machine')` 과 `flg.wizard.next()` 는 **다른 명령**이어야 한다.
- **"초기화"** 는 `wizardStore.reset()` 이 아니다. `handleReset()` 은 `useAutoLayoutRunStore.clear()`
  도 함께 부른다 — 설정만 지우면 "어떤 설정으로 만든 건지 알 수 없는 배치" 가 화면에 남는다.
- **체크박스** 는 `setSelectedMachines` 가 아니다. 화면이 쓰는 것은 `effectiveMachines`
  (후보 1개면 미선택이어도 선택으로 친다)다. 콘솔에서 "지금 뭐가 선택돼 있나" 를 물으면
  **원본이 아니라 effective 를** 답해야 화면과 같다.

### 4.2 B — 컴포넌트가 등록한다 (fidelity by construction)

`registerAutoLayoutDebug` 가 이미 하는 일을 **일반화**한다.

```tsx
// Toolbar.tsx — 버튼은 그대로 handleExport 를 쓴다. 한 줄이 늘 뿐이다.
useDebugCommands('toolbar', {
  export:  handleExport,
  import:  handleImportString,
  copyLua: handleCopyLuaScript,
});
```

**이 한 줄이 이 계획의 중심이다.** 버튼과 명령이 **같은 함수 객체**를 가리키므로
"버튼은 고쳤는데 명령은 옛날 동작" 이 원천적으로 안 생긴다. 남는 위험은
"버튼을 추가하고 이 맵에 안 넣었다" 하나이고, 그건 **같은 파일 안의 눈에 보이는 한 줄**이다.

> **왜 핸들러를 컴포넌트 밖으로 추출하지 않나.** 60여 개 핸들러를 액션 레이어로 빼면
> 버튼이 명령 없이는 존재할 수 없게 되어 더 강하다. 하지만 그건 UI 전체 리팩토링이고,
> 이 계획의 목적(AI 가 앱을 몰 수 있게)과 **독립적인 큰 변경**이다. 등록 훅은 그 90% 를
> 파일당 한 줄로 얻는다. 추출은 새 버튼을 쓸 때 자연스럽게, 점진적으로 한다.

**등록은 스코프 단위로 붙였다 뗀다.** 현재 `registerAutoLayoutDebug(null)` 은 언마운트 시
등록을 **통째로** 지운다 — StrictMode 이중 마운트나 두 컴포넌트가 얽히면 살아 있는 등록이
날아간다. 새 API 는 `registerCommands(scope, map)` 가 **그 스코프만** 지우는 해제자를 준다.

### 4.3 C — 실제 이벤트 디스패치

키보드 단축키의 리스너는 [App.tsx](../../src/App.tsx) 가 `window` 에 건다. 캔버스의 리스너는
[pixi-manager.ts](../../src/UI/pixi/pixi-manager.ts) 가 `canvas` 에 직접 건다("React passive 문제 없음").
**둘 다 DOM 셀렉터가 필요 없다** — 대상이 하나뿐이고 인자(키·좌표)가 곧 이벤트 필드다.

```
flg.key('r')                 → window 에 keydown 디스패치 (회전)
flg.key('z', {ctrl:true})    → 되돌리기 (App 의 핸들러를 그대로 지난다)
flg.canvas.click(x, y)       → canvas 에 pointerdown/up 디스패치 (그리드 좌표 → 캔버스 좌표 역변환)
flg.canvas.drag(x1,y1,x2,y2) → down · move* · up
```

**캔버스에서 이게 왜 중요한가.** `handlePointerDown` 의 좌클릭은 스토어 호출 하나가 아니라
**분기 6개**다 — 모듈 이름표 → 모듈 패널 / 팔레트 선택 중 점유 셀 → 정보 모달 / 빈 셀 → 배치
(중심 앵커 보정 포함) / 라우팅 선 → 연결 모달 / 벨트 셀 → 흐름 모달 / 그 외 → 사각 선택 시작.
`placeEntity(x,y)` 를 "클릭" 이라고 부르면 나머지 다섯을 통째로 건너뛴다.

그래서 **두 이름을 나눈다**:

| | 무엇 | 언제 쓰나 |
|---|---|---|
| `flg.canvas.click(x,y)` | 진짜 클릭 — 분기 전부를 지난다 | *"여기 클릭하면 뭐가 뜨나"* 를 재현할 때 |
| `flg.grid.place(x,y)` | `placeEntity` 직접 | 배치 상태만 빨리 만들 때 |

이 구분을 안 하면 AI 는 **자기가 무엇을 검증했는지 모른다.**

---

## 5. 왜 `querySelector(...).click()` 이 아닌가

가장 손쉬운 답("버튼을 찾아서 누른다")을 기각한 이유를 남긴다.

| 문제 | 실제 사례 |
|---|---|
| **라벨이 i18n** | 툴바·위저드 버튼 텍스트는 전부 `t(...)`. EN/KO 를 바꾸면 셀렉터가 죽는다 |
| **결과값이 없다** | `.click()` 은 `void`. 실패했는지, 무엇이 됐는지 로그를 따로 읽어야 한다 |
| **조건부 렌더** | 6단계 밖에서는 "레이아웃 생성" 버튼이 **DOM 에 없다.** 셀렉터는 "없음" 과 "비활성" 을 구분 못 한다 |
| **부서져도 조용하다** | 클래스명 하나 바뀌면 명령이 아무 일도 안 하고 성공한 척한다 |

**단, §4.3(C) 는 예외다.** 거기서 디스패치하는 것은 *DOM 셀렉터로 찾은 버튼*이 아니라
*리스너가 붙은 유일한 대상*(`window`·`canvas`)이고, 그 리스너가 곧 검증 대상이다.

---

## 6. 관측 — 누르기의 나머지 반쪽

명령만 있으면 AI 는 **눈 감고 버튼을 누르는 사람**이 된다. 관측이 같은 무게로 필요하다.

### 6.1 `flg.ui()` — 지금 화면을 텍스트로

스크린샷의 대체물. 픽셀이 아니라 **상태와 가용성**을 찍는다.

```
[flg] 화면
  게임데이터   loaded · 레시피 1,231 · 엔티티 842
  그리드       256×256 · 엔티티 87 · 선택 0 · undo 3/redo 0
  팔레트       assembling-machine-2 · N
  위저드       4단계(벨트) · 타깃 iron-gear-wheel · min
               머신 1 · 인서터 2 · 벨트 1 · 지하벨트 1 · 파이프 0
  실행         done (3.4s) · 이슈 1 warning · 적용됨
  열린 것      없음        (모달·패널·튜토리얼·토스트)
  버튼         다음 ✓ / 이전 ✓ / 레이아웃 생성 ✗(6단계 아님)
```

마지막 줄이 핵심이다 — **비활성 버튼과 그 사유**. `canRun` 같은 판정이 화면에서는
`disabled` 와 `title` 로만 보이는데, 그게 AI 가 가장 자주 막히는 자리다.

### 6.2 `flg.report()` — 한 덩어리로 복사

왕복 비용의 대부분은 **사용자가 여러 곳을 복사하는 일**이다. 하나로 합친다:

```js
copy(flg.report())   // devtools 의 copy() 로 클립보드에 통째로
```

담기는 것: `flg.ui()` + 최근 명령 저널 + `state()` + 마지막 실행의 이슈 목록 +
COORD DUMP 가 켜져 있었으면 그 요약. **AI 가 다음 판단에 필요한 전부**를 한 번에.

### 6.3 저널

모든 명령 실행을 링버퍼(최근 50)에 남긴다 — 시각·이름·인자·결과. `flg.report()` 가 이걸
싣는다. **왜 필요한가:** 사용자가 여러 명령을 치고 마지막 화면만 복사하면, AI 는
*어떤 순서로 무엇을 쳤는지* 모른 채 결과만 본다. 실패 재현에서 순서가 곧 원인이다.

---

## 7. 화면 전수 — 무엇이 명령이 되나

착수 시 이 표가 체크리스트다. **방식** 열은 §4 의 A/B/C.

### 툴바 — [Toolbar.tsx](../../src/UI/components/Toolbar.tsx)

| 화면 | 명령 | 방식 | 비고 |
|---|---|---|---|
| 📋 Lua 복사 | `toolbar.copyLua()` | B | 클립보드 실패해도 **문자열을 반환**한다 |
| 게임데이터 불러오기 | `toolbar.loadGameData(json)` | B | 파일 다이얼로그는 못 연다 → **페이로드를 받는다**(§9) |
| 로드 실패 배지 | `toolbar.gameDataError()` | B | 로컬 state 모달 |
| 가져오기 | `toolbar.import(str)` · `toolbar.importOpen()` | B | 모달 경유와 직행을 나눈다 |
| 내보내기 | `toolbar.export()` | B | 다운로드 + **문자열 반환**(현재는 다운로드만) |
| 되돌리기·다시실행·전체삭제 | `undo()` `redo()` `grid.clear()` | A | |
| EN · 한국어 | `toolbar.lang('ko')` | A | `useI18nStore` |

### 사이드바 — [Sidebar.tsx](../../src/UI/components/Sidebar.tsx)

| 화면 | 명령 | 방식 |
|---|---|---|
| 카테고리 탭 | `sidebar.tab('assembler')` | B (로컬 `activeTab`) |
| 검색 | `sidebar.search('belt')` → 걸린 목록 반환 | B (로컬 `filter`) |
| 항목 클릭 | `sidebar.pick(name)` | A |
| ⓘ 상세 | `inspect.entity(name)` | A |
| 폭 드래그·더블클릭 | `sidebar.width(px)` | A |

### 캔버스 — [pixi-manager.ts](../../src/UI/pixi/pixi-manager.ts)

| 화면 | 명령 | 방식 |
|---|---|---|
| 좌클릭 (분기 6개) | `canvas.click(x,y)` | C |
| 드래그 배치·드래그 선택 | `canvas.drag(x1,y1,x2,y2)` | C |
| 우클릭·휠클릭 팬 | `canvas.pan(dx,dy)` | A |
| 휠 줌 | `canvas.zoom(d)` | A |
| hover (모듈·연결선 강조) | `canvas.hover(x,y)` | C |
| 셀 직접 배치·제거·이동 | `grid.place/remove/move` | A |
| 사각 선택·삭제 | `grid.selectRect/deleteSelected` | A |

### 위저드 — [AutoLayoutModal.tsx](../../src/UI/components/AutoLayoutModal.tsx) · [AutoLayoutContainerPanel.tsx](../../src/UI/components/AutoLayoutContainerPanel.tsx)

| 화면 | 명령 | 방식 | 비고 |
|---|---|---|---|
| 스텝 칩 7개 | `wizard.go(step)` | A | 스킵 단계도 클릭 가능 = 명령도 가능 |
| 다음 · 이전 | `wizard.next()` `wizard.prev()` | B | **스킵 로직 포함** |
| 초기화 | `wizard.reset()` | B | 위저드 + 실행 결과 둘 다 |
| 레시피 선택 | `wizard.recipe(name)` | A | |
| 최소/처리량 · 개수 | `wizard.mode('manual')` `wizard.perTarget(n)` | A | |
| 외부 공급 토글 | `wizard.external(item)` | A | |
| 대체 제작법 | `wizard.altRecipe(item, recipe)` | A | |
| 머신/인서터/벨트/지하벨트/파이프 체크박스 | `wizard.toggle(kind, name)` · `wizard.only(kind, name)` | A | 읽을 땐 **effective** 를 답한다(§4.1) |
| 인서터 처리량·스택 | `wizard.inserterOverride(name, {…})` | A | |
| 레이아웃 생성 | `await wizard.run()` | B | 끝날 때까지 기다리고 요약을 찍는다(§8) |
| 중단 | `wizard.abort()` | B | |
| "오래 걸림" 계속·중단 | `wizard.slow('continue'\|'abort')` | B | |
| 이슈 그룹 펼치기 | `wizard.issues()` | B | 접기 상태 대신 **전문을 반환** |
| 이슈의 "고치러 가기" | `wizard.go(fixStep)` 과 같음 | A | |
| 배치 다시 적용 | `wizard.apply()` | B | 지금의 `flg.apply()` |

### 디버그 탭 — [AutoLayoutDebugTab.tsx](../../src/UI/components/AutoLayoutDebugTab.tsx)

| 화면 | 명령 | 방식 |
|---|---|---|
| COORD DUMP | `flags.coordDump(true)` | A + **결함 수정**(§10) |
| ENTITY IDS | `flags.entityIds(true)` | A |
| (버튼 없음) | `flags.perimeterPass(b)` · `flags.channelGeometry(b)` | A — [debugFlags.ts](../../src/autoLayout/debugFlags.ts) 에 세터가 이미 있다 |

### 모달·패널·키보드

| 화면 | 명령 | 방식 |
|---|---|---|
| 엔티티 정보 모달 닫기 | `inspect.close()` | A |
| 레시피 지정·해제 | `inspect.recipe(id, name\|null)` | A |
| 모듈 슬롯 지정 | `inspect.module(id, slot, name\|null)` | A |
| 모듈 정보 패널 열기·닫기 | `inspect.module(key)` · `inspect.moduleClose()` | A |
| 라우팅 연결 모달 | `inspect.routing(id)` | A |
| 튜토리얼 | `tutorial.open/next/prev/close()` | B (로컬 state + localStorage) |
| 토스트 닫기 | `toast.dismiss(id)` · `toast.list()` | A |
| Ctrl+Z/Y · R · Esc · Delete | `key('z',{ctrl:true})` 등 | C |

---

## 8. 왕복을 줄이는 것 — 비동기와 시나리오

### 8.1 실행은 기다린다

`handleRun` 은 fire-and-forget 이지만, 콘솔에서는 **끝을 알아야** 다음 판단을 한다.

```js
await flg.wizard.run()
// [flg] wizard.run() … 3.4s → done · 모듈 12 · 이슈 1(warning: 반출 skip)
```

`autoLayoutRunStore.status` 가 `done|error` 가 될 때까지 구독하고, 끝나면 이슈 요약까지
한 줄에 담는다. 범용 대기 `await flg.until(() => …, 10_000)` 도 함께 둔다.

### 8.2 시나리오 — 매크로임을 이름으로 밝힌다

```js
await flg.scenario.auto('iron-gear-wheel')   // 레시피 → 기본 선택 → 6단계 → 실행 → 보고
```

한 줄로 전체 경로를 재현한다. **`scenario.*` 는 버튼이 아니다** — 그래서 그룹 이름을
따로 뒀다. 다른 그룹과 섞이면 "이건 UI 에도 있는 건가" 가 흐려진다. 개수를 적게 유지한다
(현재 예정: `auto` 하나).

---

## 9. 정직한 괴리 — 명령이 버튼과 다른 자리

**이 목록이 문서의 핵심 자산이다.** 나머지는 `flg.help()` 가 답하지만, 이건 못 답한다.

| 자리 | 버튼 | 명령 | 왜 |
|---|---|---|---|
| 게임데이터·블루프린트 **파일** | OS 파일 다이얼로그 | 문자열 인자 | 다이얼로그는 사람 손이 필요하다. `input.click()` 을 흉내 내도 AI 는 못 고른다 |
| **클립보드** 복사 | `navigator.clipboard` | 반환값 | 콘솔 호출은 사용자 제스처가 아니라 권한이 막힐 수 있다 |
| **내보내기** | 파일 다운로드 | 다운로드 + 문자열 | 다운로드된 파일을 AI 는 못 읽는다 |
| **드래그** | 픽셀 경로 | 시작·끝 좌표 | 중간 경로는 셀 단위로 보간한다. 픽셀 단위 경로에 의존하는 동작은 재현 대상이 아니다 |
| **폭 조절** | 마우스 드래그 | px 인자 | 결과만 같다 |

---

## 10. 이 인터페이스가 드러내는 기존 결함 3건

계획을 세우며 발견한 것들. 명령을 붙이면 **곧바로 거짓말이 되는** 자리라 함께 고친다.

1. **COORD DUMP 버튼이 화면과 어긋난다.**
   [AutoLayoutDebugTab.tsx](../../src/UI/components/AutoLayoutDebugTab.tsx) 는 모듈 상수를
   로컬 `useState(AUTO_LAYOUT_COORD_DUMP)` 로 **복사해 놓고** 그 사본으로 ON/OFF 를 그린다.
   콘솔에서 `setAutoLayoutCoordDump(true)` 를 부르면 **버튼은 계속 OFF 라고 표시한다.**
   → 플래그를 `uiDebugStore` 로 올리거나 구독하게 바꾼다.

2. **`registerAutoLayoutDebug(null)` 이 스코프를 안 본다.**
   언마운트가 등록 전체를 지운다. 스코프별 해제자로 바꾼다(§4.2).

3. **내보내기가 문자열을 안 준다.** `handleExport` 는 Blob → 다운로드까지 한 함수에서 한다.
   문자열 생성과 저장을 나눠야 명령이 값을 돌려줄 수 있다.

---

## 11. 문서화 — 카탈로그는 문서에 안 적는다

### 11.1 판정 — [docs/CLAUDE.md](../../docs/CLAUDE.md) 의 네 질문

| | 답 |
|---|---|
| Q1 프로젝트 밖에서도 참인가 | 아니다. 우리 화면 이야기다 |
| Q2 코드를 바꾸면 무효가 되나 | **그렇다** → 메모리가 아니라 `docs/` |
| Q3 이미 다루는 문서가 있나 | [[변수명사전]] 이 *"콘솔에서 읽는 것"* 을 맡는다. 이건 *"콘솔에서 치는 것"* 이라 **주제가 다르다** → 새 문서 |
| Q4 같은 사실이 두 곳에 생기나 | 생긴다(명령 목록). 그래서 **한 곳도 문서가 아니게** 한다 → 아래 |

### 11.2 목록은 `flg.help()` 가 단일 출처다

[[변수명사전]] 의 범위 규칙이 그대로 답을 준다 — *"IDE 가 대신 답할 수 있는 것은 안 담는다"*.
명령 카탈로그는 **런타임이 대신 답할 수 있다.** 문서에 60줄짜리 표를 적으면 그날부터 썩고,
썩은 표는 다음 세션을 적극적으로 오도한다.

그래서 `flg.help()` 를 문서 품질로 만든다 — 그룹·인자·**지금 사용 가능한가**·**화면 라벨**을
함께 찍는다. 라벨은 `t(...)` 로 뽑으므로 i18n·언어 설정과 자동으로 맞는다.

```
flg.wizard.next()          [다음]           ✓
flg.wizard.run()           [레이아웃 생성]  ✗ 6단계(검토)에서만
```

### 11.3 문서는 세 자리에 놓는다 — 분량 순

| 자리 | 무엇을 | 왜 거기 |
|---|---|---|
| **`docs/debug/ai-console.md`** (신설) | 왕복 규약 · 세 방식 판정 · **정직한 괴리 목록**(§9) · 명령 추가법 · `flg.help()` 가 목록의 출처라는 사실 | `docs/` 는 코드 트리의 거울이고 코드는 `src/debug/` 에 산다. `debug/` 폴더가 넷째 거울이 된다 |
| **`src/debug/CLAUDE.md`** (신설, 5줄) | 위 문서로 가는 한 줄 + "명령을 추가할 때 §4 판정을 먼저" | **도달 경로다.** 그 폴더 파일을 열면 자동 로딩된다 — [[README]] 가 말하는 "규칙이 아니라 구조" |
| **[[변수명사전]] §C** (3줄 + 링크) | *"콘솔에서 **치는** 것은 `flg` 다. 목록은 `flg.help()`, 규약은 [[ai-console]]"* | 사람이 *"콘솔에서 뭘 할 수 있지"* 를 찾을 때 **이미 여는 문서**가 거기다. 간선을 준다 |
| **루트 `CLAUDE.md`** (2줄) | *"화면 동작을 확인해야 하면 스크린샷 말고 `flg`. `flg.report()` 한 덩어리를 요청한다"* | **새 세션이 이 도구의 존재를 아는 유일한 자리.** 이게 없으면 나머지 문서는 아무도 안 연다 |

> **분량이 역순인 게 의도다.** 가장 많이 읽히는 자리(루트 `CLAUDE.md`)에 가장 적게 쓴다.
> 거기 표를 넣으면 매 세션 컨텍스트를 먹고, 그럼에도 반년 뒤엔 틀려 있다.

### 11.4 무엇을 **안** 쓰나

- 명령 카탈로그(§11.2)
- 사용 예시 나열 — 예시는 `flg.help()` 의 각 항목에 한 줄씩 붙인다
- 링크 검사·동기화 검사 스크립트 — [docs/CLAUDE.md](../../docs/CLAUDE.md) 의 철회 선례를 따른다

---

## 12. 단계

**Step 1 만 확정이고, 뒤는 방향이다.**

### Step 1 — 레지스트리 + **요구된 다섯** ✅ 완료 (2026-08-17)

> **착수 직전에 범위가 바뀌었다.** 원래 Step 1 은 *"A 방식으로 되는 조작을 전부 그룹으로
> 옮긴다"* 였다. [[다음작업-요구사항]] 이 그 순서를 뒤집었다 — 다음 작업(`planned = 0`)이
> 실제로 필요로 하는 것은 **버튼 60개가 아니라 명령 다섯 개**이고, 그중 셋(`face`·`check`·
> `report`)은 애초에 화면에 **없는** 기능이다. 카탈로그를 먼저 늘렸으면 정작 막힌 다섯을
> 못 덮은 채 표면만 넓혔을 것이다.
>
> 그래서 이 단계는 *"조작 표면을 옮긴다"* 가 아니라 **"막힌 다섯을 덮는다"** 가 됐다.
> 기존 14개는 그 김에 그룹으로 옮겼다(`grid.*`·`wizard.*`·`flags.*`).

| 요구 | 명령 | 구현 |
|---|---|---|
| ① 3왕복 조작 | `await flg.run({…})` | [runLayout.ts](../../src/debug/runLayout.ts) — 입력 구성·서명·대기·요약 |
| ② 100KB 출력 | `flg.face(모듈, 면)` | [faceTable.ts](../../src/debug/faceTable.ts) — 좌표와 `d1..dN` 을 **함께** |
| ③ 흩어진 카운터 | `flg.report()` | [runStats.ts](../../src/debug/runStats.ts) + [report.ts](../../src/debug/report.ts) |
| ④ `git stash` 비교 | `flg.snapshot/diff` | [snapshots.ts](../../src/debug/snapshots.ts) — localStorage 라 새로고침을 견딘다 |
| ⑤ 손으로 짠 규칙 | `flg.check()` | [checkRules.ts](../../src/debug/checkRules.ts) — 실측에서 나온 넷만 |

- **전제:** 조작 상태의 대부분은 `src/UI/store/` 의 스토어 9개 + `UI/i18n` 의 언어 스토어에
  있다 — 읽어서 확인함. 컴포넌트 로컬 state 는 `activeTab`·`filter`·`openSlot`·
  `importModalOpen`·`dumpEnabled`·튜토리얼 단계뿐이다.
- **불변(지켜짐):** 화면 코드(`src/UI/**`)를 한 줄도 안 고쳤다.
- **깨진 불변 하나 — 정직하게:** *"자동 배치 코드를 안 건드린다"* 는 못 지켰다.
  `moduleWizard.ts` 에 **기록 호출 3줄**이 늘었다(`beginRunStats`·`recordDeliveryStats`·
  `recordPerimeterStats`). 이유는 §5 의 발견이다 — 카운터가 **이미 계산되고 있는데 밖으로
  나오는 길이 `LayoutIssue.detail` 문장뿐**이었다. 계산·분기·반환값은 그대로이고 관측만
  붙었다. 대안(숫자를 `CandidateLeaf` 까지 실어 올리기)은 배치 모델에 진단 필드를 심는 일이라
  더 크다.
- **관문(열림):** *"명령을 치고 → `flg.report()` 를 복사받아 → 다음 명령을 정한다"* 가
  성립한다. 남은 단계는 표면을 늘리는 일이다.

**착수해 보니 달랐던 것 두 가지**

1. **요구 ③의 "모듈 미라우팅" 은 셀 필요가 없었다.** `unroutedLines` 가 하나라도 있으면
   `moduleWizard` 가 `unrouted-lines` 이슈를 내고 **abort 한다** — 성공한 배치의
   미라우팅은 구조적으로 0 이다. 그래서 숫자를 세는 대신 `report()` 에 그 사실을 적고,
   자리를 **면별 레인 점유**(`W d2←iron-ore · E d2→concrete`)로 채웠다. 채널 조사에서
   실제로 묻는 것이 그쪽이다.
2. **R-연속이 조각을 짚고 있었다.** 처음 구현은 BFS 시작 셀에서 닿는 쪽을 "본체" 로 보고
   나머지를 위반으로 냈는데, 어느 쪽이 본체가 되는지가 **삽입 순서에 달려** 있었다. 어느
   조각이 잘못인지는 알 수 없으므로 **틈**(가장 가까운 칸 쌍)을 짚도록 바꿨다.

**검증된 범위:** [layoutDiagnostics.test.ts](../../src/debug/layoutDiagnostics.test.ts) 14건
— 대조군(위반 0) + 결함을 하나씩 심은 네 규칙 + 단면표 정렬 + 지하벨트 짝 오탐 방지 +
자기 끝점 상자 오탐 방지. [registry.test.ts](../../src/debug/registry.test.ts) 8건 —
스코프 격리·처방 포함·저널.

**아직 안 한 것(브라우저 실측):** 진짜 배치로 한 번 돌려 봐야 한다. 합성 배치가
검증하는 것은 *읽는 도구가 옳게 읽나* 이지 *실제 배치에서 오탐이 없나* 가 아니다.
특히 **R-연속**은 납품 경로가 양끝 상자·좌석을 떼는 경우(`deliveryRoute.stripKeys`)에
오탐이 날 수 있다 — 첫 실행에서 위반이 쏟아지면 그 규칙부터 의심한다.

### Step 2 — B 방식: 등록 훅 + 위저드·툴바

`useDebugCommands(scope, map)` 를 만들고 [Toolbar.tsx](../../src/UI/components/Toolbar.tsx) ·
[AutoLayoutModal.tsx](../../src/UI/components/AutoLayoutModal.tsx) ·
[AutoLayoutContainerPanel.tsx](../../src/UI/components/AutoLayoutContainerPanel.tsx) 에 한 줄씩.
`registerAutoLayoutDebug` 를 흡수한다. `await wizard.run()` 도 여기서.

- **전제:** 위저드 사이드바는 항상 마운트, 실행 패널은 6단계에서만 — [App.tsx](../../src/App.tsx)
  와 `step === 'review'` 분기로 확인함. 그래서 사전조건 메시지(§3.3)가 실제로 필요하다.
- **관문:** 컴포넌트 안에 갇힌 절차(실행·내보내기·다음)를 콘솔이 **같은 함수로** 부를 수 있나.

### Step 3 — C 방식: 캔버스·키보드

그리드 좌표 ↔ 캔버스 좌표 역변환 + 포인터/키보드 디스패치. `canvas.click` 이
`handlePointerDown` 의 여섯 분기를 실제로 지나는지 각 분기마다 한 번씩 확인한다.

- **불변(기전으로):** 이 분기들은 `hitTestModuleLabel`·`hitTestRoutingLine` 같은 캔버스 좌표
  히트테스트를 지나므로, **좌표 역변환이 틀리면 다른 분기로 떨어진다** — 여섯을 다 태워 보는
  것 말고 통과를 증명할 방법이 없다.

### Step 4 — 나머지 표면 + 기존 결함 3건

사이드바·모달·튜토리얼·토스트. §10 의 셋을 고친다.

### Step 5 — 문서 네 자리 + `help()` 라벨

§11.3 대로. `flg.help()` 에 i18n 라벨과 가용성을 붙인다.

---

## 13. 검증

```powershell
npx tsc -p tsconfig.app.json --noEmit   # 반드시 -p
npx vitest run                          # 기준선: 타입 0 · 45파일 537테스트
```

테스트는 **레지스트리 의미론만** 추가한다 — 스코프 해제가 다른 스코프를 안 지우는가,
사전조건 거절이 처방 문구를 포함하는가, 저널이 인자를 보존하는가. 명령 하나하나에 테스트를
붙이지 않는다(스토어를 다시 테스트하는 일이 된다). 조작 표면의 진짜 검증은 **브라우저에서
`flg.report()` 를 읽는 것**이고, 그게 이 도구가 존재하는 이유다.

---

## 14. 함정

- **`placeEntity` 는 클릭이 아니다.** 중심 앵커 보정(`centerAnchorOrigin`)과 다섯 개의
  선행 분기가 캔버스 핸들러에 있다.
- **`setStep` 은 "다음" 이 아니다.** 스킵 로직이 빠진다.
- **선택 집합을 읽을 땐 `effective*`.** 원본 Set 은 후보 1개일 때 비어 있는데 화면은 선택으로 그린다.
- **`wizard.run()` 은 그리드를 먼저 비운다.** `autoLayoutRunStore.run` 이 `clearGrid()` 를
  부른다 — 콘솔에서 실행하면 손으로 만든 배치가 사라진다(되돌리기로 복구 가능).
- **`flg` 설치는 React 보다 먼저다.** [main.tsx](../../src/main.tsx) 가 렌더 전에 부른다.
  B 방식 명령은 컴포넌트가 마운트된 뒤에야 생긴다 — `help()` 가 그 차이를 보여야 한다.
