# autoLayout/ — 자동 배치

폴더는 **두 축**으로 나뉜다. 정의와 현재 트리는
[docs/code-folders.md](../../../../docs/auto-layout/common/code-folders.md) 가 단일 출처다.

```
축 1 계층    planner/ (안 놓는다)  ↔  execution/ (PlacedCell 을 만든다)
축 2 관심사   module(형제를 모른다) · link(두 모듈의 식별자) ·
             channel(공유 자원) · perimeter(전역 외곽)
```

## 실행 경로는 하나다 — 폴백할 옛 경로는 없다

```
layeredWizard.runLayeredWizard          ← 레시피 트리 전개 + 머신 선정까지만
  └ planner/moduleWizard.tryRunModulePipeline   ← 배치 전부
      → 성공: CandidateLeaf 1개
      → 실패: RejectReason (그 문구가 UI 실패 라벨로 그대로 나간다)
```

**실패는 삼키지 않는다.** 콘솔 `[autoLayout] 모듈 경로 포기 [<kind>]: <detail>` 이 단일 출처다.

## 읽지 말 것

`manualEdit/` — 드래그·수동 편집 격리 구역. **호출자 0**, 타입검사·테스트 제외.
무엇을 하려던 기능인지는 그 폴더의 `README.md` 에 있다.

## 검증 (함정 있음)

```powershell
cd frontend
npx tsc -p tsconfig.app.json --noEmit   # 반드시 -p. 인자 없는 tsc 는 0개 검사하고 조용히 성공
npx vitest run
```

기준선 **타입 0 · 41파일 448테스트.** 배치를 바꾸는 변경은 여기에 더해 **좌표 덤프 전후
비교**로 확인하고, **바꾼 분기가 실제로 불렸는지**를 먼저 본다 — 448개가 전부 통과하는데
바꾼 분기는 한 번도 안 지나는 상황이 실제로 있었다(2026-08-02).

## 하위 `CLAUDE.md`

`planner/` · `module/` · `execution/` · `manualEdit/` 에 각각 있다. 그 폴더 파일을 열면 함께 들어온다.

## 문서는 코드 트리의 거울이다

```
frontend/src/utils/autoLayout/planner/module/   ↔   docs/auto-layout/module/
                              planner/link/     ↔   docs/auto-layout/link/
                              planner/perimeter/↔   docs/auto-layout/perimeter/
                              (channel 관련)     ↔   docs/auto-layout/channel/
```

전략 무관 문서는 `docs/auto-layout/common/` 에 있다 — 그중
[code-folders](../../../../docs/auto-layout/common/code-folders.md) 가 폴더 경계의 단일 출처다.
