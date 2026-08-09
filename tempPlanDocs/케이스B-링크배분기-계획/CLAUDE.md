# 케이스B-링크배분기 — 작업 컨텍스트

> **상태: 옵션 A 완료** (2026-08-09) — 0 · 0′ · 1 · 2 · 3단계 전부.
> 남은 것은 **옵션 B**(케이스 B 본체)이고 별도 계획서로 승격해야 한다 → [judgements.md](judgements.md)

배치를 바꾸는 코드 변경이다. 실패가 **조용한** 종류라 검증 방식이 평소와 다르다 —
겹침 검사도 미배치 검사도 이 사고를 못 잡는다.

## 착수 전 반드시 읽을 것

| 무엇 | 왜 |
|---|---|
| [`planner/module/linkPlanner.ts`](../../src/autoLayout/planner/module/linkPlanner.ts) `LinkFaceContext.pipeSides` 주석 | **거절이 능력 부족이 아니라 안전 조치**임을 코드가 이미 적어 뒀다. 여기를 안 읽고 풀면 그날로 사고다 |
| [`module/clusterModule.ts`](../../src/autoLayout/module/clusterModule.ts) `buildTrunkContext` | `beltMaxOn` 이 탭 계획만 훑는다 — 이 작업의 **근본 원인** |
| [`execution/module/emitModule.ts`](../../src/autoLayout/execution/module/emitModule.ts) `emitOutputLinks` | 링크가 W/E 면에서 **깊이 4칸**(d1 좌석·d2 벨트·d3 포트 인서터·d4 상자)을 먹는다는 사실의 출처 |
| 같은 파일 `emitOutputLinks` 의 *"팔 종류는 레인 깊이와 짝이다"* 주석 | 옵션 B(케이스 B 본체)의 관문 |
| [`docs/auto-layout/module/trunk-pipe.md`](../../docs/auto-layout/module/trunk-pipe.md) | ClusterPipe 깊이 공식(§5.1)의 단일 출처 |

## 하지 않는 것

- **옵션 B(reach 도입)** — **필요성은 확정됐고 순서만 뒤다**(계획서 §4, 2026-08-09).
  이 계획서에서는 `LINK_LANE_DEPTH` 상수를 건드리지 않는다 — A 의 1단계가 B 의 안전망이라
  먼저 깔아야 한다
- **옵션 C(유체 면을 탭에 위탁)** — 2026-08-05 에 지운 구조를 되살리는 것이다
- **탭 배분기 수정** — 이 계획은 링크 배분기에만 손댄다

## 이 작업의 함정

**`pipeSides` 를 먼저 풀고 싶어진다.** 1단계(`beltMaxOn` 이 링크 깊이를 보게)가
**배치를 한 칸도 안 바꾸면서** 2단계의 안전망이 된다. 순서를 뒤집으면 검증이 사고를
못 잡는다.

**"링크 벨트는 d2 니까 파이프 d3 이면 안 겹친다"** — 틀렸다. 링크는 포트 끝까지 **d4** 를
먹는다. 벨트 깊이만 세면 두 칸을 놓친다.

**파이프 연속성은 좌표 덤프로 직접 본다.** 파이프가 끊기면 그 아래 기계가 유체를 못
받는데, 겹침도 미배치도 아니라 **테스트가 전부 통과한다**(2026-08-05 실측).

## 검증

```powershell
npx tsc -p tsconfig.app.json --noEmit   # 반드시 -p
npx vitest run                          # 기준선: 타입 0 · 44파일 518테스트
```

여기에 더해 **바꾼 분기가 실제로 불렸는지 먼저 확인한다.** `packModuleTree` 경로는 rate
조건이 안 맞으면 링크를 아예 안 만든다(포트의 `linkId` 가 전부 비어 있으면 그 신호).
링크 배정을 바꿨다면 `generateModule` 에 링크 그룹을 **직접 넣은** 시나리오로 확인한다 —
2026-08-02 에 448개가 전부 통과하는데 바꾼 분기는 한 번도 안 지난 일이 있었다.
