# autoLayout/ — 자동 배치

**폴더는 관심사, 파일 이름은 일의 종류.** 정의와 현재 트리는
[docs/code-folders.md](../../docs/auto-layout/common/code-folders.md) 가 단일 출처이고,
종류 여덟의 판정은 [work-kinds](../../docs/auto-layout/common/work-kinds.md) 다.

```
run/        한 번의 실행 전체 (입력 → 후보)        tree/       무엇을 몇 대 · 트리를 어떻게 앉히나
module/     모듈 안쪽 — 형제를 모른다              link/       두 모듈의 식별자를 안다
channel/    여러 연결이 나눠 쓰는 자원             perimeter/  전역 외곽
shared/     관심사가 없는 것 (타입 · 셈 · 격자 · 찍기 · 탐색)
```

**`planner/` 와 `execution/` 는 없다**(2026-09-16 · 구조-2축 계획 3). 계층은 폴더가 아니라
**파일 이름**이 말한다 — `emit.ts` 만 `PlacedCell` 을 만들고 나머지는 안 만든다.
폴더로 나눠 두었을 때 생긴 일이 이것이다: 함께 바뀌는 파일 쌍의 74%가 폴더 경계를 넘었고,
같은 관심사(`module`)가 세 폴더에 흩어져 있었다.

**폴더 말고 *모델* 을 건드릴 때는** [layout-models](../../docs/auto-layout/common/layout-models.md) —
배치 모델 넷이 각자 **무엇을 그릴 수 있고 무엇을 못 그리나**. 새 능력을 넣기 전에
*"이건 어느 모델의 일인가 · 그 모델이 그릴 수 있는 도형인가"* 를 거기서 먼저 답한다.
그걸 건너뛰면 **경계를 여는 것을 게이트를 여는 것으로 착각한다**(2026-08-18 `eligible` 실측).

## 실행 경로는 하나다 — 폴백할 옛 경로는 없다

```
run/build/layered.runLayeredWizard        ← 레시피 트리 전개 + 머신 선정까지만. **스토어를 읽는 유일한 곳**
  └ run/build/module.tryRunModulePipeline ← 배치 전부
      → 성공: CandidateLeaf 1개
      → 실패: LayoutIssue (그 문구가 UI 실패 라벨로 그대로 나간다)
```

**실패는 삼키지 않는다.** 콘솔 `[autoLayout] 모듈 경로 포기 [<kind>]: <detail>` 이 단일 출처다.
자리가 없으면 **만들어 내지 말고** 정직하게 실패시킨다 — 사유 카탈로그는 `shared/issue.ts` 이고,
그 issue 를 **짓는 곳은 `run/policy.ts` 하나**다.

## 새 파일을 어디 둘지 — 두 질문

```
① 무엇에 대한 일인가      형제를 모르면 module · 두 모듈을 알면 link
                          공유 자원이면 channel · 전역 외곽이면 perimeter
                          아무 데도 아니면 shared
② 무슨 종류의 일인가      types · arith(셈) · ledger(장부) · shape(도형)
                          policy(정책) · emit(찍기) · build(조율) · late(늦은 결정) · gamedata(어댑터)
```

한 종류가 300줄을 넘으면 **그 파일을 폴더로 승격**한다(`module/arith/` · `channel/ledger/`).
폴더 안의 파일 이름은 그때 **주제**가 맡는다(`module/types/line.ts` 가 그 꼴의 시작이다).

## 예약 철학 — 주체 하나가 먼저 잡는다

*"큰 그림을 보는 주체 **하나**가 자리를 먼저 잡고, 뒤 단계는 탐색 없이 놓기만 한다."*
주체가 둘로 갈리면 *"무관한 판정이 이미 끝난 예약을 삼키는"* 버그가 난다(2026-07-21 실측).
그래서 **찍는 코드가 자리를 고르고 있으면 그것은 계층이 새는 것**이다 — `emit` 은 고르지 않는다.

저장소에 남은 탐색은 **하나**다(`shared/route.dijkstraWithJumps` — 납품 사다리의 탐색 칸).

## 검증 (함정 있음)

```powershell
npx tsc -p tsconfig.app.json --noEmit   # 반드시 -p. 인자 없는 tsc 는 0개 검사하고 조용히 성공
npx vitest run
```

기준선 **타입 0 · 62파일 784테스트**(기존 실패 2건 — trunkPipe 유체 면). 배치를 바꾸는 변경은
여기에 더해 **좌표 덤프 전후 비교**로 확인하고, **바꾼 분기가 실제로 불렸는지**를 먼저 본다 —
전부 통과하는데 바꾼 분기는 한 번도 안 지나는 상황이 실제로 있었다(2026-08-02).

## 하위 `CLAUDE.md`

`module/` · `shared/` · `channel/` 에 있다. 그 폴더 파일을 열면 함께 들어온다.

## 문서는 코드 트리의 거울이다

```
module/ ↔ docs/auto-layout/module/     link/ ↔ .../link/     channel/ ↔ .../channel/
perimeter/ ↔ .../perimeter/            나머지 ↔ .../common/
```
