---
tags: [auto-layout/channel, 분석]
---

# battery 생산 — 채널 폭 분석 (세션 기록)

> 출처: 세션 `2ef55147-fd4f-4e3d-96c7-21c004a3db51` (제목 "Battery 생산 채널 폭 분석", 2026-08-21).
> 그 세션은 사용량 한도로 끊겼고, 아래는 거기서 나온 **결론 보고 원문**이다.
> 이어서 할 작업은 이 문서를 근거로 새 세션에서 시작한다 — 세션 사본에 의존하지 않는다.

---

## 결론부터 — 세 경우의 채널 폭

`battery`(depth 0)와 `iron-plate`(depth 1) 사이의 채널은 **깊이 1의 세로 채널 하나**이고, `copper-plate` 납품도 같은 띠를 쓴다. 실제로 `packModuleTree` 를 돌려 모듈 좌표에서 잰 값:

| 배터리 생산량 | 머신 수 (plant / furnace) | 채널을 지나는 경로 | 트랙 수 | **채널 폭** |
|---|---|---|---|---|
| **1/s** | 4 / 2 (+copper 2) | 납품 2 (iron·copper) | 1 | **4** (하한) |
| **10/s** | 40 / 16 | 납품 2 | 1 | **4** (하한) |
| **100/s** | 400 / 160 | 납품 2 + **반출 레인 798** | 402 | **404** ← 파탄 |

황산(유체) 줄까지 넣으면 1/s 만 **5** 로 커진다(반출 레인 1개가 채널로 들어와 트랙 3개).

핵심 발견 두 가지를 먼저 말합니다.

1. **1/s 와 10/s 의 폭이 같은 건 우연이 아니라 구조입니다.** 지금 코드에서 채널을 지나는 납품 경로 수는 **품목당 1개로 고정**입니다 — 처리량이 10배가 되어도 트랙이 안 늘어납니다.
2. **100/s 는 채널 폭 문제가 아니라 모듈이 성립하지 않는 문제입니다.** `벨트 6줄 > 레인 W2+E2` 로 트렁크가 거절되고 다이렉트(머신마다 상자)로 물러나면서, 짝을 못 찾은 상자 1,200개가 반출 레인으로 채널에 쏟아집니다. 폭 404는 **수요에서 유도된 폭이 아니라 실패에서 유도된 폭**입니다.

---

## 0. 예약 철학 — 이 계산 전체를 지배하는 문장 셋

- **비워 두면 실패할 수 없다.** 레이어 사이에 머신이 절대 못 들어오는 빈 세로 띠를 먼저 잡고, 경계를 넘는 모든 연결을 그 안에서만 달리게 한다 → 라우팅 실패가 *정의상* 사라진다. 백트래킹이 필요 없어지는 지점이 여기다. ([s-layer-channel-reservation.md §0·§3](docs/auto-layout/channel/s-layer-channel-reservation.md))
- **폭은 우리가 정하는 값이 아니라 예약의 부산물이다(폭 역전).** 옛 순서는 `폭 → 배치 → 라우팅` 이라 막혀도 폭을 못 되돌렸다. 지금은 **트랙·행 배정을 먼저 끝내고 폭을 그 결과에서 유도**한다. ([channel-geometry-reservation.md §6](docs/auto-layout/channel/channel-geometry-reservation.md))
- **경로는 탐색하는 것이 아니라 숫자 몇 개로 그려지는 도형이다.** 납품 경로의 자유도는 *트랙 번호 하나*뿐이고(계단꼴), 그래서 충돌은 벨트를 한 칸도 깔기 전에 숫자 비교로 판정된다.

폭 공식은 이 한 줄이 전부입니다 — [channelPlanner.ts:77](src/autoLayout/planner/channelPlanner.ts#L77), 하한은 [modulePacking.ts:49](src/autoLayout/planner/modulePacking.ts#L49):

```
채널 폭 = max(MODULE_CHANNEL_MIN(=4), trackCount + 2)
          └ 아이템 체인 최소     └ 세로줄 수 + 양끝 투입기 진입
```

즉 **알고리즘이 답해야 하는 질문은 하나입니다: 이 채널을 세로로 달리는 줄이 동시에 몇 개인가.**

---

## 1단계 — 머신 수 (`recipeTree.countForDemand`)

게임데이터에서 유도한 값:

| | 레시피 | 머신 | 1대 산출 |
|---|---|---|---|
| battery | `chemistry`, 4초, iron 1 + copper 1 + 황산 20 → 1 | chemical-plant (speed 1) | 1/4 = **0.25/s** |
| iron-plate | `smelting`, 48초, 광석 20 → 판 15 | electric-furnace (speed 2) | 15/(48/2) = **0.625/s** |

*(electric-furnace 는 `chemistry` 를 못 돌리고 chemical-plant 는 `smelting` 을 못 돌리므로 머신 매칭은 강제됩니다.)*

```
1/s   : plants = ceil(1/0.25)   = 4    → iron 수요 1/s   → furnaces = ceil(1.6)  = 2
10/s  : plants = ceil(10/0.25)  = 40   → iron 수요 10/s  → furnaces = ceil(16)   = 16
100/s : plants = ceil(100/0.25) = 400  → iron 수요 100/s → furnaces = ceil(160)  = 160
```

> 클러스터 형태는 **P0 = 세로 기둥 하나뿐**입니다([clusterLayout.ts](src/autoLayout/module/clusterLayout.ts)). 400대면 세로 1,200칸짜리 기둥 하나 — 실측에서 battery 모듈이 `y=-118..1084` 로 나온 이유입니다. 채널 *길이*는 이렇게 처리량에 비례해 폭발하지만, **폭은 별개 축**입니다.

## 2단계 — 줄별 rate (`clusterLineRate`)

폭 계산이 보는 유일한 수요는 **부모 클러스터의 줄 rate** 입니다(자식 과잉생산은 무시 — 벨트가 차면 자식이 쉰다).

| | 1/s | 10/s | 100/s |
|---|---|---|---|
| `input:iron-plate` (battery) | 1 | 10 | 100 |
| `output:iron-plate` (furnace) | 1.25 | 10 | 100 |

## 3단계 — 벨트를 몇 줄 까나 (`determineBeltCount`) ← **폭이 수요에서 유도되는 첫 지점**

규칙: 가장 빠른 벨트로 꽉 채울 수 있는 만큼 깔고, 나머지는 *그 나머지를 감당하는 가장 싼 벨트*로 덮는다. 부모는 절대 굶으면 안 되므로 합계는 늘 수요 이상 ([beltThroughput.ts:48](src/autoLayout/beltThroughput.ts#L48)). 사용 가능한 최속 벨트는 kr-superior = 0.1875×480 = **90/s**.

실측:

```
determineBeltCount(1)   = [15]        → 1줄
determineBeltCount(10)  = [15]        → 1줄
determineBeltCount(100) = [90, 15]    → 2줄   ← 여기서 갈린다
```

**같은 규칙을 자식·부모가 각자 돌려도 같은 답이 나오므로 모듈 경계에서 줄 수가 어긋날 수 없다** — 이것이 "포트 개수를 팔 개수에서 유도하지 않는다"는 설계의 실질입니다.

## 4단계 — 링크 배정 (`allocateFlows`) ← **이 트리에서는 항상 0이 나옵니다**

"자식 머신 하나 → 부모 머신 하나로 가는 벨트 하나" 를 물 붓듯 배정하는 순수 산술입니다. 반올림 방향이 역할마다 반대입니다:

- 부모 채우기 = **올림**(모자라면 굶으니까)
- 자식 비우기 = **내림**(인서터 한 개 몫이 안 되는 잔량은 버린다 — 없는 걸 나른다고 주장하지 않기 위해)

여기가 **"인서터 무한"이 코드와 부딪히는 자리**입니다. 실측:

```
childProduction(용광로 1대) = 0.625/s
tp = ∞     → 그릇 max(1, floor(90/∞)) = 1,  canFloor = floor(0.625/∞) = 0 → 링크 0개
tp = 27.7  (bulk)  → canFloor = floor(0.625/27.7) = 0 → 링크 0개
tp = 0.84  (기본 인서터, 이 모드팩 최저) → canFloor = floor(0.625/0.84) = 0 → 링크 0개
```

즉 **iron-plate 는 어떤 인서터를 골라도 링크 경로를 안 탑니다.** 용광로 1대의 초당 산출이 팔 하나 몫보다 작기 때문입니다(규칙 6이 전부 버린다). 링크가 0이면 `edgeLinkGroups` 가 `undefined` 를 내고, 포트는 **신원 없는 교환 가능 포트**로 나서 위치-zip 으로 짝지어집니다 ([edgeLinks.ts](src/autoLayout/planner/link/edgeLinks.ts)).

> 참고로 링크 경로가 살아나는 조건을 실험으로 확인했습니다: 용광로 2대에 iron 89/s 를 억지로 물리면(1대당 44.5 ≥ 27.7) 링크가 생기고 **납품 경로가 4개**로 늘어 채널 폭이 5가 됩니다. 즉 채널 폭을 실제로 키우는 축은 지금 **링크 경로 하나뿐**입니다.

## 5단계 — 트렁크(탭) vs 다이렉트 (`insertingPlanner`) ← **100/s 가 부서지는 문턱**

한 면(W/E)에 세울 수 있는 벨트 줄 수 = **고른 인서터들의 서로 다른 reach 값 개수**. 이 모드팩의 인서터 reach 는 {1, 2} 뿐이므로 **모듈 하나의 레인 용량 = 2면 × 2 = 4줄**입니다. 직접 호출해 받은 판정문:

```
1/s   (필요 3줄: iron1 + copper1 + battery1) → mode=tap
10/s  (필요 3줄)                              → mode=tap
100/s (필요 6줄: 2+2+2)                       → mode=direct
      reason: "complex: lanes-exceed-capacity (벨트 6줄 > 레인 W2+E2; 고른 인서터 reach [1,2])"
```

황산 유체를 얹어도 (지하파이프로 점프 가능하면) 1/s·10/s 는 tap 을 유지하고, 100/s 는 그대로 direct 입니다. **처방은 벨트가 아니라 "reach 3짜리 팔"** 이라고 코드가 이미 문구로 말하고 있습니다([clusterPortPlanner.ts:326-345](src/autoLayout/planner/module/clusterPortPlanner.ts#L326)).

## 6단계 — 포트 → 납품 경로 (`pairDeliveryPorts`)

여기가 **폭이 처리량에 반응하지 않는 이유**입니다. tap 모드에서 외부/트렁크 줄은 `externalLineGroups` 가 **줄 하나당 그룹 하나**만 내고(일부러 — "여기서 벨트를 쪼개지 않는다"), 그룹 하나 = 포트 하나입니다. 실측 포트 덤프:

```
100/s (레인을 6줄로 늘려 tap 을 억지로 성공시킨 실험):
   n0(battery)   ports  input:iron-plate@N ×1, input:copper-plate@S ×1, output:battery@N ×1
   n1(iron-plate) ports input:iron-ore@N ×1,   output:iron-plate@N ×1
   → 납품 경로 2개.  100/s 인데도 3단계가 고른 "2줄"이 포트로는 나오지 않는다.
```

## 7단계 — 세로 구간 → 트랙 (`assignTracksLeftEdge` / `channelGeometryPlanner`)

납품 경로 하나 = 세로 구간 `[출발 행, 도착 행]` 하나. 겹치지 않는 구간은 **같은 트랙을 공유**하고, 필요한 트랙 수 = 구간들의 최대 동시 겹침 수입니다. 실측 좌표를 그대로 넣어 확인했습니다:

```
1/s : iron y[0..2],   copper y[11..16]  → 안 겹침 → trackCount 1 → 폭 max(4,3) = 4
10/s: iron y[-10..0], copper y[53..112] → 안 겹침 → trackCount 1 → 폭 max(4,3) = 4
1/s+유체: iron[0..16], copper[3..11], 반출 lane 1 → trackCount 3 → 폭 5
```

`channelGeometry` 가 켜져 있으면 이 배정은 [channelGeometryPlanner](src/autoLayout/planner/channelGeometryPlanner.ts)가 **납품·반출을 한 장부에서** 하고(같은 쪽 판정 → 진출 변 뒤집기 → 지하 횡단 → fallback), 폭은 그 결과 `trackCount` 에서 유도됩니다 — [modulePacking.ts:770-776](src/autoLayout/planner/modulePacking.ts#L770).

## 8단계 — 100/s 에서 무슨 일이 벌어졌나

5단계에서 다이렉트로 물러나면 포트가 **머신마다** 생깁니다. 400대 × 3줄 = **1,200개**. 자식 쪽은 여전히 트렁크 포트 1개뿐이라 품목당 1쌍만 짝지어지고, 나머지 **798개(iron 399 + copper 399)** 가 짝 없는 raw 상자로 남아 전부 테두리로 나가야 합니다. 그 반출 레인들이 채널로 들어오면서:

```
== REAL 100/s: plants=400 furn=160 (116초 소요)
   n0: x=0..10   n1/n2: x=415..421
   CHANNEL = 404      deliveries=2   rawPorts=1200
```

`404 = max(4, 402+2)`. **채널이 수요가 아니라 실패를 예약한 것**입니다. 참고로 이 케이스는 계산에 116초가 걸립니다(1/s·10/s 는 각각 25ms·11ms) — 폭발이 성능에도 그대로 나타납니다.

---

## 예약 철학이 여기서 지킨 것과 뚫린 구멍

**지켜진 것**

- 폭 역전이 실제로 작동합니다. 1/s·10/s 에서 폭은 상수가 아니라 배정 결과(trackCount 1)에서 나왔고, 하한 4에 걸려 있을 뿐입니다.
- 트랙 공유(left-edge)가 값을 합니다. iron·copper 구간이 안 겹치니 **두 납품이 트랙 하나를 나눠 씁니다** — 순진한 `crossingCount`(연결당 트랙 1개)였다면 2였을 자리입니다.
- 실패가 조용하지 않습니다. 100/s 의 사유가 `lanes-exceed-capacity (벨트 6줄 > 레인 W2+E2)` 라는 **처방까지 담긴 문장**으로 남습니다.

**뚫린 구멍 셋** (셋 다 채널이 아니라 채널 *상류*에 있습니다)

1. **3단계가 고른 "2줄"이 6단계에서 포트로 안 나옵니다.** `determineBeltCount` 는 줄 수를 정하는데 `externalLineGroups` 는 줄당 그룹 하나만 냅니다. 그래서 채널 폭이 처리량에 **반응하지 않습니다** — 10/s 든 100/s 든 트랙 1개. 만약 두 줄이 각자 포트를 냈다면 트랙은 최대 4, 폭은 **6**이 됩니다(수치 확인함).
2. **다이렉트 폴백이 채널을 삼킵니다.** "다이렉트는 항상 성립하는 안전한 폴백"이라는 전제가 *모듈 안쪽*에서는 맞지만, 짝 없는 상자 798개를 만들어 **채널·테두리라는 공유 자원**에 떠넘기는 순간 안전하지 않습니다. 예약 철학의 언어로 말하면 — 폴백이 자기가 안 세는 자원을 먹습니다.
3. **`allocateFlows` 규칙 6(자식 내림)이 느린 레시피에서 항상 0을 냅니다.** 머신 1대 산출 < 팔 하나 몫이면 전부 버려집니다. 그리고 "인서터 처리량 무한"은 이 규칙 때문에 **링크를 0으로 만드는 입력**입니다(그릇도 `max(1, floor(90/∞)) = 1` 로 접힘). 무한을 넣고 싶으면 코드에서 `tp = ∞` 가 아니라 *"팔은 병목이 아니다"* 를 별도 축으로 표현해야 합니다.

---

## 이 숫자를 어떻게 얻었는지 (재현 방법)

게임데이터는 브라우저 업로드 전용이라 콘솔(`flg`)을 못 쓰므로, **moduleWizard 위 단계(머신 매칭·대수·rate·유체 트렁크)를 손으로 재현해 `NodeSpec` 을 만들고 `packModuleTree` 를 직접 호출**했습니다. 그 아래(포트 계획·링크 배정·채널 기하·폭)는 전부 실제 코드입니다. 채널 폭은 `PackResult.placements` 의 depth0 오른쪽 끝과 depth1 왼쪽 끝 사이 빈칸으로 측정했습니다. 스크래치 테스트 파일은 측정 후 지웠고, 저장소는 원래 상태입니다(`git status` 확인).

검증에 쓴 조합: 인서터 tp ∈ {∞, 27.7(bulk), 0.84(기본)}, 유체 유무, 레인 용량 4 vs 6(가상 reach 3), 그리고 링크 경로가 살아나는 대조군(89/s·용광로 2대).
