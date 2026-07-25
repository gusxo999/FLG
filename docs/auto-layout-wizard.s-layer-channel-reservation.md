---
tags: [auto-layout, placement, routing]
---

# S-LAYER — 인접 레이어 사이 라우팅 채널 예약

> **⚠️ 상태(2026-07-25): 이 전략의 본체는 코드에서 삭제됐다** (리팩토링 Phase 3).
> tidy-tree 배치·left-edge 트랙 배정·BFS 채널 라우팅은 `layeredWizard.ts` 에 더 이상 없다.
>
> **그러나 예약 철학은 살아 있다.** 모듈 파이프라인이 이걸 **상위 호환으로 계승**했다 —
> 예약 단위가 "폭(몇 줄이 지나나)" 에서 "기하(어느 x·y 구간을 누가)" 로 올라갔다:
> [[auto-layout-wizard.channel-geometry-reservation]] 가 현행 단일 출처다.
>
> 이 문서를 남기는 이유: **왜 채널을 비워 두는가**라는 근본 논거가 여기 있고,
> 그건 새 설계에서도 그대로 유효하기 때문이다. 코드 인용은 이제 역사 기록으로 읽는다.


> **부모 문서:** [auto-layout-wizard.md](auto-layout-wizard.md) — 위저드 인터페이스
> **관련 문서:** [.placement-search](auto-layout-wizard.placement-search.md) — 배치/전략(§5.5 전략 등록부), [.entity-roles](auto-layout-wizard.entity-roles.md), [.known-limits](auto-layout-wizard.known-limits.md)

> 전략 `[[용어사전#S-LAYER|S-LAYER]]` (계층화 [[용어사전#DAG|DAG]] 레이아웃 + 채널 라우팅, [[용어사전#Sugiyama 프레임워크|Sugiyama 프레임워크]]) 의
> **③ 채널 예약** 단계만 깊게 다룬다. 다른 단계(레이어 배정 / 레이어 내 정렬 /
> 좌표 확정 / 채널 내 라우팅)는 별도 문서로 분리.
>
> 단일 출처 후보: `docs/auto-layout-wizard.placement-search.md` §5.5 전략 등록부에
> `S-LAYER` 행을 추가하고, 본 문서를 그 전략의 채널 절로 링크.

---

## 0. 한 줄 요약

> 두 인접 [[용어사전#레이어 (layer)|레이어]] **사이에 머신을 절대 놓지 않는 빈 세로 띠(gutter)** 를 미리 비워두고,
> 그 레이어 경계를 가로지르는 **모든 연결을 이 띠 안에서만** 달리게 한다.
> [[용어사전#채널 (channel)|채널]]은 항상 비어 있으므로 **라우팅이 실패할 수 없다** (정의상).

이것이 (롤백된) 완전탐색 전략 S-EXH 의 `FailureLeaf` 백트래킹·`n!` 형제순서 폭발을 없애는 핵심
메커니즘이며, 현재 전략 S-LAYER ([layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts)) 로 구현돼 있다.

---

## 1. 용어 정의

먼저 축을 확정한다. 이 문서의 모든 "가로/세로·폭/길이" 는 아래 규약을 따른다.

- **x (가로)** = 물질 흐름 방향. **왼쪽(원자재) → 오른쪽(제품)**. 레이어 열과 채널이 x축을 따라 번갈아 놓인다.
- **y (세로)** = 머신이 레이어 안에 쌓이는 방향이자, 트랙이 달리는 방향.

따라서 채널의 **폭(W)** 은 x 크기(작다), **길이** 는 y 크기(레이어 높이만큼)다. 트랙은 1셀 폭(x)의
세로선이고 y를 따라 달리므로, 한 채널을 `k` 개 연결이 지나면 트랙이 x방향으로 `k` 개 나란히 서서 폭 `W ≥ k` 가 된다.

| 용어                                                        | 정의                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| **[[용어사전#레이어 (layer)\|레이어 (layer)]]**                     | 루트(최종 제품)로부터 같은 거리에 있는 머신들의 묶음. 한 열에 세로(y)로 쌓인다.                |
| **[[용어사전#채널 (channel)\|채널 (channel)]]**                   | 인접한 두 레이어 **사이**의, 머신이 없는 예약된 세로 띠.                             |
| **[[용어사전#트랙 (track)\|트랙 (track)]]**                       | 채널 안에서 연결 1개가 세로(y)로 달리는 1셀 폭(x)의 선. 채널 = 트랙 여러 개가 x로 나란히 선 묶음. |
| **[[용어사전#크로싱 셀 (crossing cell)\|크로싱 셀 (crossing cell)]]** | 연결이 레이어 경계를 가로(x)질러 채널로 진입/진출하는 구간.                             |
| **[[용어사전#더미 노드 (dummy node)\|더미 노드 (dummy)]]**            | 두 레이어 이상을 건너뛰는 긴 간선이 중간 레이어를 통과할 때 차지하는 자리. 머신이 아니라 "지나가는 트랙".  |

---

## 2. 한눈에 보는 그림

빨간 과학팩(`automation-science-pack`) 예시. 레시피 트리:

```
automation-science-pack         (L0, 제품)
├── copper-plate                (L1)  ← copper-ore (external)
└── iron-gear-wheel             (L1)
    └── iron-plate              (L2)  ← iron-ore (external)
```

배치 결과 (●=머신 셀, │=트랙(벨트), ═=크로싱(가로 진입), 공백=빈 채널):

```
        L2            채널 C12          L1           채널 C01        L0
   ┌─────────┐      ┌───────┐     ┌─────────┐      ┌───────┐   ┌─────────┐
 0 │● iron   │      │       │     │● gear   │      │       │   │●        │
 1 │●  plate ●═════════║         │●  wheel  ●═══════════║       │● science│
 2 │●        │      │  ║    │     │●        │      │     ║      │●  pack  │
 3 └─────────┘      │  ║    │     └─────────┘      │     ║      │●        │
 4                  │  ╚════════▶ ┌─────────┐      │     ║      │●        │
 5                  │       │     │● copper ●════════════╝      └─────────┘
 6                  │       │     │●  plate │      │       │
 7                  │       │     └─────────┘      └───────┘
                    └───────┘
   열:  x0..x2        x3..x4        x6..x8         x10..x11    x13..x16
```

읽는 법:
- `iron-plate` 산출물은 **채널 C12 안에서만** 세로(트랙)로 이동한 뒤 `iron-gear-wheel` 로 진입.
- `iron-gear-wheel`, `copper-plate` 산출물은 **채널 C01 안에서만** 이동한 뒤 `science-pack` 으로 진입.
- 머신 영역(L0/L1/L2)과 채널은 **물리적으로 분리** — 머신 사이를 비집고 라우팅할 일이 없다.

---

## 3. 채널이 푸는 문제 (현재 설계와의 대비)

### (구) S-EXH — 라우팅을 "발견"한다  *(롤백됨, 코드 없음)*

```
1. 머신을 부모 옆 빈자리에 그리디로 놓는다        (placeMachine)
2. 곧바로 BFS 로 경로를 찾아본다                  (routeWithFallback)
3. 막히면? → FailureLeaf → 다른 perm×dir 로 백트래킹  (n! × 2 폭발)
```

라우팅 가능성이 **배치 결과에 종속**되므로, 좋은 배치를 찾으려고 조합을 다 시도해야 한다.

### S-LAYER — 라우팅을 "예약"한다

```
1. 레이어 사이에 빈 채널을 먼저 비워둔다
2. 머신은 레이어 안에만, 트랙은 채널 안에만 놓는다
3. 채널은 항상 비어 있으므로 → 경로가 항상 존재 → 실패 불가
```

라우팅 가능성이 **구조에 의해 보장**되므로 [[용어사전#백트래킹|백트래킹]] 자체가 사라진다. 이것이 VLSI 의
**[[용어사전#channel routing (VLSI)|channel routing]]** 그대로다.

---

> **구현 상태 (2026-06-04):** §4·§5 의 **트랙 수 산정**은 구현 완료.
> `channelPlanner.ts` 의 `assignTracksLeftEdge` 가 left-edge interval partitioning 으로
> 채널별 최소 트랙 수를 구하고, `layeredWizard.ts` 가 `channelWidthFromTracks` 로 채널 폭을 동적 결정한다
> (고정폭 상수 대신 `CHANNEL_MIN = 3` 하한 + 트랙 수 기반 폭). 라우팅은 (depth, track, lo) 순서로 정렬해 깔되, **셀 구성
> (벨트/투입기/파이프/방향)** 은 검증된 기존 BFS 라우터(`containerRouting.routePorts`)를
> 재사용한다. 트랙 폭이 충분하므로 BFS 가 실패하지 않는다(§8 C2 의 실용 보장).
> **명시적 셀 직접 깔기(BFS 완전 제거)** 는 follow-up — 기존 Dijkstra 라우터가 지하
> 변형·방향·유체를 이미 정확히 처리하므로 재구현 리스크를 피해 보류.

## 4. 채널 폭(W) 계산 — 가장 중요한 디테일

채널 폭은 임의 상수가 아니라 **그 경계를 가로지르는 동시 연결 수**로 계산한다.
현재 코드의 `CHANNEL_MIN = 3` ([layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts)) 이 이 계산의 *하한*이다.

### 4.1 한 연결이 채널에서 쓰는 자원

| 운반 종류 | 채널 내 체인 | 최소 가로 폭 | 트랙(세로) 1개당 |
|---|---|---|---|
| **아이템** | 투입기(1) — 벨트(≥1) — 투입기(1) | 3 | 벨트 1줄 |
| **유체** | 파이프(≥1) | 1 | 파이프 1줄 |

`CHANNEL_MIN = 3` 은 정확히 아이템 체인의 최소 가로 폭(투입기+벨트+투입기)이다.
→ 채널 폭의 **바닥값**.

### 4.2 트랙 수 = 동시 연결 수

한 채널을 가로지르는 연결이 `k` 개이면, 세로(y)로 겹치지 않게 달리려면 **트랙 `k` 개**가
필요하다. §1 규약대로 트랙은 채널의 **폭(x)** 방향으로 나란히 쌓이므로, 트랙이 늘수록 폭이 커진다:

```
W(channel) = channelWidthFromTracks(trackCount, CHANNEL_MIN)
           = max(CHANNEL_MIN,      // 아이템 체인 최소(=3)
                 trackCount + 2)   // 동시 연결(트랙) 수 + 양끝 여유
```

여기서 `base_chain_width` 는 운반 종류(아이템 3 / 유체 1), `extra_tracks` 는 한 채널을
지나는 연결 수에서 1을 뺀 만큼의 여유 트랙. 더미 노드(통과 벨트)도 트랙 1개씩 차지한다.

### 4.3 워크드 예제

`science-pack` 이 L1 에서 `gear-wheel`, `copper-plate` 2개를 받는다고 하자.

```
채널 C01 을 가로지르는 연결: 2개 (gear→pack, copper→pack)  → trackCount = 2
W(C01) = max(CHANNEL_MIN, trackCount + 2) = max(3, 4) = 4
```

→ C01 은 **폭 4셀**로 예약된다. 두 연결이 각자 트랙을 잡으므로 교차 없이 진입 가능.

유체가 섞이면 (예: 한 연결이 파이프):

```
연결: gear(아이템) + lubricant(유체)
아이템 트랙 폭 3 + 유체 트랙 폭 1 = 4   (혼합 시 각 종류별로 분리 영역 권장)
```

> **설계 노트:** 1차 구현에서는 아이템/유체 트랙을 채널 안에서 **분리 영역**으로 두는 게
> 단순하다 (왼쪽 절반 아이템, 오른쪽 절반 유체). 섞으면 투입기/파이프 충돌 검사가 복잡해진다.

---

## 5. 채널 안에서 트랙 배정 (좌표 확정)

채널 폭이 정해지면, 그 채널을 지나는 연결마다 **트랙 인덱스(채널 내 가로 오프셋)** 를 배정한다.
트랙 배정은 **레이어 내 정렬 결과(세로 순서)** 를 그대로 따르면 교차가 최소가 된다 —
이것이 ② barycenter 정렬과 ③ 채널 예약이 맞물리는 지점이다.

```
채널 C01 (폭 4, x=10..13).  L1 머신 3대(위→아래: gear, copper),  L0 = pack.

       x10  x11  x12  x13
        │    │    │    │
gear ●──�───▶ │    │    │        gear 는 트랙0(x10) → pack 상단 진입
        │    │    │    │
        │    │    │    │
copper●─┼────┼───▶│    │        copper 는 트랙2(x12) → pack 하단 진입
        │    │    │    │
```

트랙 배정 규칙(1차안):
1. 연결을 **소비자(consumer) 진입 지점의 세로 위치** 순으로 정렬.
2. 위에서부터 차례로 비어 있는 가장 왼쪽 트랙을 배정 ([[용어사전#left-edge algorithm|left-edge 알고리즘]] — channel
   routing 의 고전 기법).
3. 같은 트랙을 세로 구간이 겹치지 않는 두 연결이 공유할 수 있으면 재사용(폭 절약).

> left-edge algorithm: 구간(interval)들을 시작점 순으로 정렬해 겹치지 않는 것끼리
> 같은 트랙에 모으는 그리디. 채널 폭을 최소화하는 표준 알고리즘이다.

---

## 6. 긴 간선 (더미 노드) — 채널을 "통과"하는 연결

레이어를 2개 이상 건너뛰는 연결은 중간 레이어의 채널을 **그냥 통과**한다.
이때 중간 채널에 트랙 1개를 추가로 예약한다 (= 더미 노드).

```
L0 이 L2 의 산출물을 직접 소비하는 경우:

   L2          C12              L1          C01           L0
┌──────┐    │  ┌─pass─┐    ┌──────┐    │  ║   │   ┌──────┐
│ X    ●═══════║      ║════════════════════║       │ root │
└──────┘    │  │ (더미)│    └──────┘    │  ╚══════▶│      │
            │  └──────┘                 │          └──────┘
              ↑ C12 에 통과 트랙 1개 예약(머신 아님)
```

→ 더미 트랙도 §4.2 의 트랙 수에 포함되어 채널 폭을 키운다.

> 현재 `expandRecipeTree` 는 품목을 중복 전개하는 **트리**라 긴 간선이 거의 없다.
> 공유 부분트리를 DAG 로 합치는 최적화([[project-placement-strategy-layer]] S-MEMO 방향)를
> 도입하면 이 메커니즘이 그대로 받쳐준다.

---

## 7. 처리량 모드 (한 노드 N대) 와 채널

`assignThroughputCounts` 로 노드가 N대가 되면, 레이어 안에서 **세로로 N칸을 차지하는
한 슬롯**이 된다. 채널 쪽에서 보면:

- N대의 산출물이 한 소비자로 합쳐지는 경우 → **트렁크(합류) 트랙**으로 병합. **구현됨:**
  [clusterTrunkMerge.ts](../frontend/src/utils/autoLayout/clusterTrunkMerge.ts) 가 클러스터→부모 소비자 트렁크,
  [externalMergePass.ts](../frontend/src/utils/autoLayout/externalMergePass.ts) 가 외부 상자↔머신 트렁크를 담당.
- 소비자도 M대면 → 채널이 N→M 분배(distribution) 영역이 된다. 폭이 더 필요할 수 있다.

```
L1: gear ×3                C01            L0: pack ×1
┌──────┐                │ ║              ┌──────┐
│gear 0●═══════════════════╣             │ pack │
├──────┤                │  ║   (트렁크    │      │
│gear 1●═══════════════════╣    합류)     │      │
├──────┤                │  ║              │      │
│gear 2●═══════════════════╝═════════════▶│      │
└──────┘                │                 └──────┘
```

---

## 8. 정합성 조건 (채널이 지켜야 하는 불변식)

`docs/auto-layout-wizard.placement-search.md` §6 의 C1–C3 (전략 무관 불변식)을 채널이
어떻게 자동으로 만족시키는지:

| 조건 | 내용 | 채널이 보장하는 방식 |
|---|---|---|
| **C1 (겹침 없음)** | 두 셀이 같은 좌표를 점유하지 않음 | 머신=레이어 영역, 트랙=채널 영역으로 좌표 공간이 분리 |
| **C2 (라우팅 연결성)** | 모든 producer→consumer 가 물리적으로 연결 | 채널이 항상 비어 있어 경로 존재 보장 |
| **C3 (운반 종류 일치)** | item↔item, fluid↔fluid | 채널 안 아이템/유체 트랙 영역 분리(§4.3) |

→ 채널 예약은 C1·C2 를 **구성에 의해(by construction)** 만족시킨다. 라우팅 후 검증이
아니라 배치 전 보장.

---

## 9. 의사코드

```text
function reserveChannels(layers: Layer[], edges: Edge[]) -> Channel[]:
    channels = []
    for k in 0 .. layers.length - 2:
        # 레이어 k 와 k+1 사이 경계를 가로지르는 연결 수집
        crossing = edges.filter(e => spans(e, k, k+1))

        # 긴 간선의 통과 트랙(더미)도 포함
        crossing += dummiesPassingThrough(k, k+1)

        # 종류별 분리
        itemEdges  = crossing.filter(isItem)
        fluidEdges = crossing.filter(isFluid)

        # left-edge 로 트랙 수 최소화
        itemTracks  = leftEdgeAssign(itemEdges)   # 겹치지 않는 구간끼리 트랙 공유
        fluidTracks = leftEdgeAssign(fluidEdges)

        width = max(CHANNEL_MIN,
                    itemBaseWidth(itemTracks) + fluidBaseWidth(fluidTracks))

        channels.push(Channel{ between: (k, k+1), width, tracks: itemTracks ∪ fluidTracks })
    return channels

# 좌표 확정: 레이어 폭 + 채널 폭을 왼쪽부터 누적
function assignColumns(layers, channels):
    x = 0
    for k in 0 .. layers.length - 1:
        layers[k].xStart = x
        x += layers[k].width          # 그 레이어 최대 머신 폭
        if channels[k] exists:
            channels[k].xStart = x
            x += channels[k].width
```

---

## 10. 현재 코드 매핑

| S-LAYER 요소 | 현재 코드 |
|---|---|
| 채널 폭 (하한 + 동적) | `CHANNEL_MIN = 3` 하한 + `channelWidthFromTracks` ([channelPlanner.ts](../frontend/src/utils/autoLayout/channelPlanner.ts)), 열 x 누적은 [layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts) |
| 트랙 내 벨트/투입기/파이프 깔기 | `routeWithFallback` ([routeFallback.ts](../frontend/src/utils/autoLayout/routeFallback.ts)) → `routePorts`/`commitRouting` ([containerRouting.ts](../frontend/src/utils/autoLayout/containerRouting.ts)) |
| 라우팅 실패 처리 | 백트래킹 없음 — 실패는 `routeFailures` 카운트만(채널 보장으로 사실상 미발생). `FailureLeaf` 는 머신매칭 실패 전용 |
| 트렁크 합류 | [clusterTrunkMerge.ts](../frontend/src/utils/autoLayout/clusterTrunkMerge.ts) (내부) + [externalMergePass.ts](../frontend/src/utils/autoLayout/externalMergePass.ts) (외부) |
| 머신 좌표 결정·commit | 좌표 [layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts), footprint commit `commitContainer` ([machinePlacer.ts](../frontend/src/utils/autoLayout/machinePlacer.ts)) |

---

## 11. 트레이드오프

- **장점:** 라우팅 실패 불가, `n!` 폭발 없음, 결정적(시각화 재생 유리), O(V+E)급.
- **단점:** 채널을 예약하므로 자유 패킹 대비 **면적이 다소 커진다**. 품질 기준이
  `squarenessPenalty`(미관) 수준인 현재로선 충분히 감수 가능한 교환.
- **완화책:** left-edge 트랙 공유 + 짧은 연결의 트랙 재사용으로 채널 폭을 최소화하면
  면적 손해를 줄일 수 있다.

---

## 12. 다음 문서

- `s-layer-layer-assignment.md` — longest-path 레이어 배정 + 더미 노드 삽입
- `s-layer-ordering.md` — barycenter 레이어 내 정렬 (현재는 [layeredWizard.ts](../frontend/src/utils/autoLayout/layeredWizard.ts) 의 tidy-tree `layout` 으로 처리)
- `s-layer-coordinate.md` — 레이어/채널 → `Container.origin` / `Area.placed` 확정
