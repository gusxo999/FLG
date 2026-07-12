---
tags: [auto-layout, placement, routing, tooling]
aliases: [계측기, pipeline-metrics, 비교 계측기]
---

> **부모 문서:** [auto-layout-wizard.md](auto-layout-wizard.md)
> **왜 만들었나:** [.trunk-redesign §10.4](auto-layout-wizard.trunk-redesign.md) — 공급 방식을
> 갈아타기 전에 **숫자로 이기는 걸 먼저 본다**.

# 파이프라인 계측기 — 같은 트리를 같은 자로 잰다

## 0. 한 줄 요약

레시피 트리 하나를 파이프라인에 통과시키고 **면적·채널 폭·벨트 수·포트 수·실패 수**를 잰다.
공급 방식([다이렉트 인서팅](용어사전.md#다이렉트-인서팅-direct-inserting) ↔
[탭 인서팅](용어사전.md#탭-인서팅-tap-inserting))을 바꿨을 때 **무엇이 좋아지고 무엇이 나빠졌는지**를
말이 아니라 수치로 남기는 것이 목적이다.

## 1. 왜 코드보다 이게 먼저인가

2026-07-10 의 대규모 리팩터가 **전량 롤백**됐다. 코드가 틀려서가 아니라 — **좋아졌다는 근거가
없어서**다. 새 트렁크도 같은 위험을 안고 있다: "합치면 좁아진다"는 직관은 그럴듯하지만
[.trunk-redesign §3](auto-layout-wizard.trunk-redesign.md) 이 보였듯 **단조적이지 않다**.

그래서 순서를 뒤집었다. **먼저 현행 수치를 박제하고, 갈아탄 뒤 같은 자로 재서 이겼는지 본다.**

> **계측기는 판단하지 않는다 — 재기만 한다.** 그래서 비용 숫자(면적·벨트 수)에는 `expect` 를
> **걸지 않는다.** 그건 트렁크가 **바꾸라고** 만드는 값이고, 못 박으면 개선이 곧 테스트 실패가 된다.
> 못 박는 것은 **결정성**(같은 입력 → 같은 숫자)뿐이다.

## 2. 재는 값 — 우선순위 순서대로

사용자가 정한 [작업 우선순위](auto-layout-wizard.trunk-redesign.md#7-작업-우선순위-사용자-결정)를
그대로 자에 새겼다. **①이 0이 아니면 ②의 숫자는 의미가 없다** — 못 만든 배치가 더 작은 건 당연하다.

### ① 물류가 성립하는가

| 값 | 뜻 |
|---|---|
| `hopFailures` | 모듈 사이 [납품 경로](용어사전.md#납품-경로-deliveryroute)를 못 깐 수 |
| `exportSkips` | 갇힌 외부 상자를 [perimeter ring](용어사전.md#perimeter-ring) 으로 못 뺀 수 |

### ② 얼마나 비싼가

| 값 | 뜻 | 트렁크가 바꿔야 할 방향 |
|---|---|---|
| `area` (`bboxW×bboxH`) | 배치 전체 넓이 | 크게 안 줄 수도 있다(§4) |
| `channelWidths[]` | depth 사이 [채널](용어사전.md#채널-channel)의 폭 | **머신 수에 안 따라 커져야 한다** ← 핵심 |
| `beltCells` / `undergroundCells` | 깔린 벨트 / 지하벨트 칸 | ↓ |
| `inserters` / `chests` | 인서터 / 무한상자 수 | 상자 ↓ (트렁크 끝 1개로 모임) |
| `ports` | 모듈 경계 포트 수 | **머신×품목 → 품목** ← 핵심 |
| `hops` (`hopsWithUnderground`) | 홉 수 (그중 지하 쓴 것) | ↓ (교차가 줄어 지하 필요도 준다) |
| `rawPorts` | 짝을 못 찾아 외부 공급/흡수로 남은 포트 | ↓ (반출 부담의 실제 출처) |

## 3. 1:1 기준선 (2026-07-12 실측)

`advanced-circuit` 동형 트리(golden·보장 테스트와 **같은 트리** — 자를 통일한다),
3×3 조립기, 지하벨트 허용(`maxJump=4`).

```
tag     상태   area          채널폭  belt  ug  ins  chest  port  hop(ug)  raw  fail(hop/skip)
1/1/1   OK     242 (22×11)   [4]      28   10   18     7     11   2(2)     7   0/0
2/2/2   FAIL   456 (24×19)   [6]      53    8   35    14     22   4(2)    14   0/1
3/3/3   FAIL   650 (26×25)   [8]     101   16   54    23     33   6(5)    21   1/2
4/4/2   FAIL   675 (27×25)   [9]     120   22   61    26     38   6(6)    26   0/3
6/4/2   FAIL   700 (28×25)   [10]    145   10   75    36     46   6(4)    34   1/7
8/6/4   FAIL  1147 (31×37)   [13]    242   70  106    50     68  10(8)    48   1/12
3/2/5   FAIL   700 (25×28)   [7]     109    2   58    27     35   5(1)    25   1/4
```

### 이 표가 확인해 준 것

**채널 폭이 머신 수에 정비례한다** — 4 → 6 → 8 → 13. 트렁크라면 품목 수가 고정이므로 폭도
고정이어야 한다. "1:1 은 채널을 감당 못 한다"가 그대로 수치로 나왔다
([교차의 불가피성](auto-layout-wizard.trunk-redesign.md#7-작업-우선순위-사용자-결정)의 귀결).

**`rawPorts` 가 진짜 부담이다.** 8/6/4 에서 포트 68 개 중 홉으로 짝지어진 건 10 개뿐이고
**48 개가 외부 공급/흡수로 남아** 전부 반출 대상이 된다. 이게 `exportSkips` 12 건의 출처다.

## 4. 함정 — 면적으로 판단하지 마라

트렁크를 넣어도 **면적은 크게 안 줄 수 있다.** 모듈 폭은 **1:1 이 오히려 더 좁고**(면당 2칸 =
인서터+상자, 탭 인서팅은 인서터+벨트로 같거나 긴팔 쓰면 3칸), 트렁크의 이득은 주로
**채널 폭 · 벨트 수 · `rawPorts` · `exportSkips`** 에서 나온다.

> **갈아타기 판정 기준: `fail 0/0` 이 되는가 + `channelWidths` 가 머신 수에 안 따라 커지는가.**
> 면적은 부수적으로만 본다.

## 5. 쓰는 법

```powershell
cd frontend
$env:VITEST_PRINT_METRICS="1"
npx vitest run src/utils/autoLayout/planner/pipelineMetrics.test.ts
```

- 측정 함수: [`pipelineMetrics.ts`](../frontend/src/utils/autoLayout/planner/pipelineMetrics.ts)
  의 `measurePipeline(specs, config, hopConfig)` — 테스트 밖(디버그 탭 등)에서도 쓸 수 있게 분리.
- 표 출력: `formatMetrics(tag, m)` — 한 줄 = 한 판. 눈으로 diff 하려고 열 순서를 고정했다.
- 기준선 테스트: [`pipelineMetrics.test.ts`](../frontend/src/utils/autoLayout/planner/pipelineMetrics.test.ts)

## 6. 아직 안 재는 것

- **처리량 충족도** — 벨트/인서터 용량 대비 실제 수요. 용량 게이트가 들어오면 추가 후보.
- **라우팅 선 가독성**(꺾임 수) — 사용자 체감이지만 수치화 기준 미정.
- **트리 다양성** — 지금은 advanced-circuit 동형 하나뿐. 유체·깊은 트리는 그 기능이 붙은 뒤.
