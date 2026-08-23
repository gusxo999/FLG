# 링크 약속량 — 공통 컨텍스트

> 상태: **폐기(2026-08-22)** — 반대 전제 위에 서 있었다(*"battery 에 링크가 0인 것이 결함"*).
> 새 기준에서는 **0이 정답**이다. 후속은 [배선-형태](../배선-형태/배선-형태.md).
> 살아남은 통찰은 하나 — **장부의 단위가 팔이면 안 된다** — 이고 그쪽 Step 2 가 받았다.

**`allocateFlows` 의 자식 비우기가 링크를 0으로 만든다.** 원인은 인서터 무한이
아니라 **`약속량 = 팔 수 × 처리량` 이라는 등식**이고, 그 등식은 팔이 병목일 때만 참이다.
전체는 [링크-약속량.md](링크-약속량.md).

```
Step 1  Flow 에 약속량(rate) — 자식 비우기를 floor → min      ← 확정
Step 2  edgeLinkGroups 가 링크를 벨트 용량까지 접는다               ← 확정(1과 한 몸)
Step 3  용어사전 규칙 5·6 · machine-link.md · 진단 로그 갱신          ← 방향
```

**Step 1 만 넣으면 트리가 깨진다** — 1이 만드는 링크(1/s 5개 · 10/s 48개 · 100/s 480개)를
2가 벨트(1 · 1 · 2줄)로 접어야 채널이 산다. 둘은 순서가 있는 두 단계지 독립 커밋이 아니다.

## 착수 전 반드시 읽을 것

| 무엇 | 왜 |
|---|---|
| [docs/용어사전.md](../../docs/용어사전.md) `#allocateFlows` 규칙 1~7 | **바꾸려는 규칙의 원문.** 규칙 5·6 이 이 계획의 대상 |
| [docs/auto-layout/link/machine-link.md](../../docs/auto-layout/link/machine-link.md) — *"링크의 `toMachine` 은 … 회계다"* · *"벨트 병합은 … 우리가 사는 것"* | **Step 2 가 뒤집는 결정이 여기 적혀 있다.** 병합의 대가를 이미 센 문서 |
| `planner/link/allocateFlows.ts` 107–118 | 고칠 열 줄 |
| `buildSpec.ts` `armsFor` (119–126) | **팔 개수의 단일 출처.** `max(1, ceil)` 이 이 계획의 근거 |
| `planner/link/edgeLinks.ts` `edgeLinkGroups` (164–192) | Step 2 의 자리. 지금은 `links.map` 한 줄 |
| `module/link.ts` `Link` 머리말 | `from`/`to` 가 왜 Map 인지 — **병합을 되살리려고 남긴 자리** |
| `planner/module/linkPlanner.ts` `tryLinkFace` (255–320) | 여러 머신 그룹이 W/E 는 통과, **gap(N/S)은 아직 거절**(arms.size!==1) |
| `modulePacking.linkDeliveries.test.ts` *"작은 입력도 묶지 않는다"* (78–115) | **Step 2 가 깨는 테스트.** 사유가 주석에 있다 |
| [tempPlanDocs/battery-채널-폭-분석.md](../battery-채널-폭-분석.md) §4·§6·"뚫린 구멍" 1·3 | 이 계획이 답하는 관측. 구멍 2 는 **안 건드린다** |
| [tempPlanDocs/glass-채널-폭-분석.md](../glass-채널-폭-분석.md) §3-①·③ | **제2 트리.** battery 는 링크가 0이라 못 본 것 — 링크가 *실제로 돌 때* 무엇이 새는지(계획서 §8) |

## 하지 않는 것

- **100/s 를 고치지 않는다.** 그건 `lanes-exceed-capacity`(벨트 6줄 > 레인 W2+E2)라
  reach 3 짜리 팔이 없으면 안 풀린다 — 링크 층 밖의 문제다(분석 §5).
- **다이렉트 폴백이 반출 레인으로 채널을 먹는 것**(구멍 2)을 안 건드린다.
- **유체를 안 건드린다.** 링크는 아이템 전용이고 그 가드는 `edgeLinkGroups` 맨 앞에 있다.
- **gap(N/S) 그룹의 `arms.size !== 1` 문턱을 안 연다.** 접은 그룹은 W/E 에 앉는다.
- **머신 대수·rate 유도(`assignThroughputCounts`)를 안 건드린다.** 입력은 그대로 받는다.
