---
tags: [auto-layout, placement, routing]
---

> **부모 문서:** [auto-layout-wizard.md](auto-layout-wizard.md)
> **관련 문서:** [.placement-search](auto-layout-wizard.placement-search.md), [.channel-geometry-reservation](auto-layout-wizard.channel-geometry-reservation.md)

# auto-layout 코드 폴더 — 모듈 안쪽 / 모듈 사이 / 잔손

**한 줄 요약:** `frontend/src/utils/autoLayout/` 아래 코드를 관심사별로 세 폴더로 나눴다 —
`module/`(한 모듈 안쪽만 아는 코드), `planner/`(모듈 사이를 조율하는 코드),
`util/`(둘 다 쓰는 잔손 함수). 폴더가 없는 파일은 옛 경로다.

## 문제 — 왜 나눴나

`autoLayout/` 폴더 하나에 40여 개 파일이 평평하게 쌓여 있었다. 어떤 파일이 "한 모듈 안쪽"
일이고 어떤 파일이 "여러 모듈 사이" 일인지 폴더 구조로는 전혀 보이지 않았다. 게다가 한 모듈을
만드는 핵심 파일(`clusterModule`)이 함수 하나 때문에 1218줄짜리 옛 파일(`areaUnification`)을
통째로 불러오고, 트렁크 벨트 파일(`trunkPath`/`trunkEmit`)이 1299줄짜리 옛 파일
(`containerRouting`)에 매달려 있었다. 잔손 함수 몇 개가 큰 파일에 갇혀 있던 탓이다.

## 세 폴더

### `module/` — 한 모듈 안쪽만 아는 코드

머신 N대를 한 덩어리(클러스터)로 만드는 데 필요한 전부. 이 폴더의 코드는 옛 세계를 모른다
(타입 정의 `containerModel` 과 `util/` 만 본다).

`clusterLayout`(N대를 기둥/줄 중 어떤 모양으로 세울지), `clusterPortPlanner`(입출력 줄을
어느 변·몇 칸 바깥·어떤 인서터에 붙일지), `clusterModule`(머신+트렁크+상자를 실제로 놓아
덩어리 완성), `trunkPath`(트렁크 벨트가 지나갈 칸 계산), `trunkEmit`(그 칸을 실제 벨트·
인서터로), `moduleTransform`(모듈 통째 회전 — 현재 항상 회전 없음으로 고정).

### `planner/` — 모듈 사이를 조율하는 코드

여러 덩어리를 한 청사진으로 엮는다.

`modulePacking`(덩어리들을 깊이별 열에 세로 정렬), `channelPlanner`(모듈 사이 빈 통로 폭),
`channelGeometryPlanner`(그 통로 안에서 누가 어느 세로줄), `perimeterLanePlanner`(상자가
바깥으로 나갈 길 예약), `perimeterRouter`(포트에서 바깥 변까지 벨트 모양), `moduleHop`
(자식 출력 → 부모 입력 잇기), `modulePerimeterPass`(살아남은 상자를 전체 외곽으로 이사),
`moduleWizard`(위 전부를 순서대로 엮는 진입점).

> 이름 주의: 이 폴더의 절반(`channelPlanner`·`channelGeometryPlanner`·`perimeterLanePlanner`)은
> 좌표만 계산하고 아무것도 놓지 않지만, 나머지 절반(`moduleHop`·`modulePerimeterPass`·
> `modulePacking`)은 실제로 벨트·인서터·상자를 격자에 **놓는다**. `planner` 라는 이름은
> "계획만 한다"가 아니라 **"모듈 사이 일"** 이라는 뜻으로 읽는다.

### `util/` — 둘 다 쓰는 잔손 함수 두 파일

큰 파일에 갇혀 있던, 혼자서는 큰 의미가 없지만 여기저기서 자주 쓰이는 작은 함수들을 꺼냈다.
두 무리로 갈라 파일 경계로 못 박았다.

**`util/helper.ts` — 격자 위에서 셈만 하는 함수.** 아무것도 놓지 않는다. 칸의 좌표를 받아
다른 숫자나 칸 목록을 돌려줄 뿐이다.

- `cellKey(3, 7)` → `"3,7"`. 칸 하나를 집합·사전의 열쇠로 쓰려고 문자열로.
- `faceVector("E")` → `{x:1, y:0}`. "동쪽 변" 같은 말을 "오른쪽으로 한 칸" 화살표로.
- `vectorToDirection(1, 0)` → 팩토리오가 아는 방향 숫자. 위 화살표를 게임 값으로.
- `segment(A, B)` → A에서 B까지 일직선으로 늘어선 칸들의 목록.
- `enumeratePerimeterCells(사각형)` → 그 사각형의 둘레를 안쪽 한 바퀴, 그다음 한 칸 더
  바깥 한 바퀴… 도는 칸 목록.

**`util/cellBuilder.ts` — 정해진 칸을 물건으로 채우는 함수.** 좌표와 방향이 이미 정해진 뒤
불린다. 어디에 놓을지 고르지 않고, 길도 찾지 않는다. "이 칸에 이 방향으로 벨트" 라고 하면
벨트 한 칸을 만들어 돌려줄 뿐이다.

- `makeBeltCell(칸, 흐르는 방향, 벨트 종류, 소속)` → 벨트 한 칸.
- `makeInserterCell(칸, 집어올 쪽, 인서터 종류, 소속)` → 인서터 한 칸.
- `makeContainerCell(상자, 칸)` → 무한상자/무한파이프 한 칸(안에 뭘 얼마나 채울지 딸린
  함수와 함께).

> 새 함수를 `util/` 에 넣기 전 확인: 이 함수가 "어디에 무엇을 놓을지" 를 *고르는가*, 아니면
> 이미 고른 자리를 *채우거나 세기만* 하는가? 고른다면 `util/` 이 아니다.

## 폴더 밖에 남은 것 — 공용 기반 + 죽은 무리 (2026-07-25 갱신)

예전엔 "폴더 밖 = 옛 경로" 였다. **지금은 아니다** — 옛 S-LAYER 본체가 Phase 3 에서
삭제되면서, 폴더 밖 파일 대부분은 **새 경로도 쓰는 공용 기반**으로 남았고, 진짜
옛 경로는 몇 개만 죽은 채 남았다.

**공용 기반 — 살아 있다:**
`containerModel`(타입 — 32곳이 임포트), `debugFlags`, `buildSpec`, `recipeTree`,
`wizardUtils`, `types`, `beltThroughput`, `inserterThroughput`, `containerRouting`(dijkstra —
`planner/moduleHop` 이 쓴다), `areaUnification`(사용자 드래그 재라우팅), `routeFallback`,
`machinePlacer`, `externalPlacer`, `portInference`, `moduleInspect`, `techGroup`, `layeredWizard`(진입점).

**죽은 무리 — 프로덕션 호출자 0개 (2026-07-25 실측):**

| 파일/심볼 | 상태 |
|---|---|
| `clusterTrunkMerge.ts` | 임포트하는 프로덕션 코드 **0개**. 자기 테스트만 남음 |
| `externalMergePass.wrapExternalsWithMerge` | 호출자 테스트뿐. 파일에서 **플래그만** 살아 있다(디버 탭) |
| `externalGatherPass.gatherExternalsToPoints` | 같음 |
| `areaUnification.wrapExternalsAroundPerimeter` | 호출자 테스트뿐(파일 자체는 드래그로 살아 있다) |
| `mergeGrouping.ts` | `externalMergePass` 만 쓰므로 전이적으로 죽음 |
| `ContainerWizardInput.mergeSupplyBoxes` | 타입에만 있고 **읽는 코드가 없다** |

> ⚠️ 딜레마: 디버 탭(`AutoLayoutDebugTab`)의 **MERGE BOXES / GATHER BOXES 토글은 이제
> 아무 일도 안 한다.** 그 플래그를 읽던 유일한 곳이 삭제된 옛 경로였기 때문이다.
> 무리를 지울지 말지는 사용자 확인 대기(README "폐기 결정 정책" 2항).

## 검증

폴더 이동 당시: 동작 변경 0, 212개 테스트 동일 통과, 골든 스냅샷 불변.

> **함정(2026-07-25 정정):** 이 저장소에서 `npx tsc --noEmit` 은 테스트를 "검사 안 하는"
> 게 아니라 **파일을 하나도 안 본다.** 루트 `tsconfig.json` 이 `files: []` + references 구조라
> 그렇다. 반드시 **`npx tsc -b`** (= `npm run build` 앞단) 로 확인한다. 그래도 `vitest run`
> 까지 돌리는 원칙은 그대로다 — 타입은 런타임을 다 잡지 못한다.

## modulePerimeterPass 순수화 (2026-07-11 완료)

폴더 이동 당시 `modulePerimeterPass` 는 남의 모듈 내부 셀을 직접 지우고 새로 깔았다
(`mod.cells` filter+push, `port.cells`·`port.anchor`·`chest.origin` 뮤테이션). 이제
`moduleHop` 과 같은 규약으로 바꿨다 — **모듈 그래프를 건드리지 않고 설명을 반환**한다:

- `relocateChestsToPerimeter` 는 이사 **계획**만 산정하고 `PerimeterPassResult` 로 돌려준다:
  `droppedCellKeys`(뗄 옛 ghost/feeder 좌표) · `addedCells`(놓을 belt/feeder/chest 셀) ·
  `relocations`(상자별 새 origin·belts).
- 적용은 호출자 [moduleWizard](../frontend/src/utils/autoLayout/planner/moduleWizard.ts)
  가 Area 를 지을 때 한다: `mod.cells` 순회에서 droppedCellKeys 를 건너뛰고, addedCells 를
  분류(InfinityChest→external·나머지→internal)하고, external.containers·routing 끝점에
  새 origin(원본 Container 미변형=사본)과 belts 를 반영한다.

동작 변경 0(골든 스냅샷 불변). 검증: `makeContainerCell` 이 셀 위치에 `at` 만 쓰고
`chest.origin` 은 안 읽어(cellBuilder) 순수화가 셀 좌표를 안 바꾼다. 라우팅은 `port.anchor`
가 아니라 `tapAnchor`+`chest.origin` 을 읽으므로 필요한 건 새 origin·belts 뿐. 214 green/tsc
clean. 회귀: [modulePerimeterPass.test.ts](../frontend/src/utils/autoLayout/planner/modulePerimeterPass.test.ts)
"순수 — pack 미변형" 이 pack 이 한 셀도 안 바뀜을 단언.

> 남은 확인: `tryRunModulePipeline`(moduleWizard 진입점)은 gameDataStore 의존이라 단위
> 테스트가 없다 — 어댑터 적용은 등가성 추적 + 브라우저 실측으로만 확인된다.
