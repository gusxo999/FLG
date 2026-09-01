# 조사 · `planClusterPorts` 의 흐름 — 안전하게 지우려면 (2026-09-01)

> **사실 문서.** 이 함수는 *모듈이 독립 단위였던 시절* 의 것이다 — 모듈 하나의 포트 위치만
> 계산하면 되던 때. 지금은 지도 B(격자)가 같은 일을 더 정확한 낟알로 한다.

## 무엇을 하나 — 단계 전수

### `planClusterPorts` (지도 A 본체)

```
1  유체 줄이 섞였으면 거절          reason: fluid-handled-by-generateModule
2  인서터를 모르면 거절             reason: no-inserter
3  슬롯 풀을 만든다                 면(W/E) × reach 종류.  + nsPool(노출 끝면)
4  줄 수가 슬롯 수를 넘으면 거절     reason: lanes-exceed-capacity
5  줄마다 슬롯 하나를 준다(takeSeat) 팔이 좌석 예산에 들어가는 슬롯 중 **팔이 가장 적은** 것
6  순서: 출력 → 자식-공급 입력 → 원료 입력
7  못 앉은 줄이 있으면 거절          reason: seats-exceed-capacity · **overflowed: 줄 목록**
8  산출: PlannedLine[]              면 · clusterBeltDepth · reach · 팔 수
```

### `insertingPlanner` (지도 A 의 껍질)

```
9   팔 개수를 먼저 구한다            requiredInserterCount — 공급 방식과 무관한 물리량
10  줄 수를 정한다                   determineBeltCount → beltLineMap
11  줄마다 최적 reach                bestReachFor
12  plan 에 팔 수를 채운다           armsOf
13  **splitIntervals**               c = 2 까지 머신을 나눈다(부분 트렁크의 옛 시도)
14  벨트 수요 초과면 거절            reason: belt: demand>beltCap
15  산출: { mode, plan } | { mode: "direct", reason, overflowed }
```

## 산출 중 **무엇이 살아 있나**

| 산출 | 읽는 곳 | 살아 있나 |
|---|---|---|
| `mode` | `planModulePorts` — `lowerAll` 판정 | ✅ |
| **`overflowed`** | `planModulePorts` — **넘친 줄만 `g=1`**(⑤-1) | ✅ **여기가 핵심** |
| `reason` | `moduleWizard` — `unrouted-lines` 이슈 문장 | ✅ 진단 |
| `plan.lines` (`PlannedLine[]`) | **없다** — `rest: { ok:true, lines: [] }` | ❌ **죽었다** |

> **그러니 13(`splitIntervals`)은 죽은 코드다.** `tapPlan.lines` 를 고치는데 그 배열이
> 버려진다. 부분 트렁크를 탭 경로에 넣으려던 시도였고, 지금은 `externalLineGroups` 의
> `bundle` 이 같은 일을 **살아 있는 경로에서** 한다.

## 지우려면 무엇을 대신해야 하나

```
① overflowed   "어느 줄이 좌석에 못 앉나"
② reason       진단 문자열
③ no-inserter  인서터 미상
④ lanes-exceed-capacity  줄 수 > 슬롯 수
```

### ③④ 는 쉽다

```
③  externalLineGroups 가 인서터를 모르면 **빈 손**으로 답하고 그 줄은 unpourableLines 로 간다
④  "면당 R줄" 은 **낡은 상한**이다(J1) — 벨트가 자기 구간만 덮는 지금은 행이 안 겹치면
    같은 깊이를 나눠 쓴다. 지우면 될 배치가 늘어난다
```

### ② 는 대체가 있다

지도 B 의 이름표(`rungOfLine` — `좌석부족`·`좌석막힘`·`구간막힘`·`포트막힘`)를 나머지 줄까지
넓히면 된다. `laneShortages` 의 키를 `id ?? "역할:품목"` 으로 넓히는 일이다(J3).

### ① 이 **진짜 걸림돌**이다 — 시점이 다르다

```
지도 A   앉히기 **전에** 안다      슬롯·좌석을 세어 미리 판정한다
지도 B   앉혀 **본 뒤에** 안다     tryLinkFace 가 실패해야 seat-budget 이 난다
```

그런데 `bundle`(= `g`)은 **붓기 인자**라 **앉히기 전에** 정해져야 한다.

```
A 를 지우면   "이 줄은 g=1" 을 앉히기 전에 알 방법이 없어진다
             → 앉혀 보고 낮추는 재시도로 돌아간다(시도 1~4 가 그것이었다)
```

**그래서 A 를 지우려면 둘 중 하나가 먼저다:**

```
(가) 지도 B 가 **앉히기 전에** 답하게 한다
     — 좌석 예산은 행 없이도 세어진다(`Σ_j 팔_j ≤ h`, 머신마다).
       즉 B 의 자료(FaceTable)로 **미리** 셀 수 있다. A 의 지도가 필요한 게 아니다
(나) `bundle` 결정을 붓기에서 떼어낸다
     — 붓기가 상한만 내고 배치가 묶음을 고른다. 구조가 더 크게 바뀐다
```

**(가)가 작다.** A 가 하는 좌석 판정은 B 의 자료로 **같은 층에서** 할 수 있고, 그러면
지도가 하나가 된다(계획서 §4).

## 그래서 지우는 순서

```
1  ④ lanes-exceed-capacity 를 지운다        낡은 상한이다(J1 확인 뒤)
2  ① 좌석 판정을 **지도 B 의 자료로** 옮긴다  FaceTable 로 미리 센다 — A 의 슬롯 모델 없이
3  ② 이름표를 나머지 줄로 넓힌다             진단이 안 사라지게
4  ③ 과 함께 planClusterPorts · insertingPlanner 를 지운다
   — 13(splitIntervals)은 죽은 코드이므로 **아무것도 대신할 필요가 없다**
```
