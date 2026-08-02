# execution/ — 배치 실행

**여기 있는 것은 전부 `PlacedCell` 을 만든다.** 좌표를 *정하는* 코드는 `planner/` 와
`module/` 에 있고, 여기는 정해진 배정대로 **놓기만** 한다.

## 경계선 — 기계적으로 판정한다

> **`PlacedCell` 을 만드는가?** 만들면 여기, 아니면 계획 계층.

이름에 속으면 안 되는 예:

| 파일 | 인상 | 실제 |
|---|---|---|
| `planner/perimeterRouter` | 경로를 깐다 | **좌표 배열만 반환** → 계획 |
| `planner/moduleHop` | 벨트를 놓는다 | 방출을 `emitPath` 에 **위임** → 계획 |
| `planner/modulePacking` | 모듈을 배치한다 | **좌표만** → 계획 |

**경계선의 적용 대상은 *파이프라인 단계*다.** 아래 셋은 대상이 아니다 —
셀을 만든다고 여기로 옮기지 말 것:

- **생성자 라이브러리** (`util/cellBuilder`) — 만들 뿐 배치하지 않는다
- **파사드 API** — 여러 단계를 엮는 것이 책임이다
- **수동 편집 경로** (`manualEdit/`) — 배치 파이프라인 소속이 아니다

## 파일

| 파일 | 무엇을 놓나 |
|---|---|
| `machinePlacer.ts` | 머신 footprint |
| `emitPath.ts` | Dijkstra 결과 → 벨트·파이프 셀 (`emitItemPath`·`emitFluidPath`·`commitRouting`) |
| `module/emitModule.ts` | 모듈 안쪽 구조물 (트렁크·링크·탭 인서터·유체 파이프) |
| `modulePerimeterPass.ts` | 반출 — 살아남은 상자를 전역 외곽으로 |

## 의존 방향

```
execution/ → planner/ · module/ · util/     (계획을 입력으로 받는다 — 정상)
planner/moduleWizard → execution/           (오케스트레이터 예외)
```

역방향(계획이 실행을 참조)은 **오케스트레이터뿐**이다. 그 외에 계획 계층이 여기를
import 하려 한다면 계층이 뒤집힌 것이다.

`module/clusterModule ⇄ execution/module/emitModule` 은 **런타임 한 방향**
(`clusterModule → emitModule`)이고 역방향은 `import type` 이라 순환이 아니다.
