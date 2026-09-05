# 행채널-모델 — 상태와 고유 컨텍스트

> 상태: **진행 중** — Step 0·1·2 ✅ · **Step 3·4 ✅**(2026-09-04) · Step 5 삭제 · Step 6 방향.
>
> **Step 3 — 띠 밖으로 안 밀어낸다.** 마진은 트랙이 넘치면 바깥으로 자라고(`fitRowChannel`),
> `between` 은 못 자라므로 **삼키지 않고** `row-channel-short` 로 보고한다.
> **오늘 넘치는 띠는 없다 — 배치는 한 칸도 안 바뀐다.** 이 갈래는 안전망이다.
>
> **Step 4 — 세로 진입까지 안 부딪히게.** `RowCrossing.side` 를 넣고 **전순서**로 배정한다
> (위에서 오는 것이 아래에서 오는 것보다 언제나 위 행). 서쪽 끝이 공통(`x1: 0`)이라
> **트랙은 안 늘고 순서만 바뀐다.** 순환이 없어 `J-교차` 의 ⓑ·ⓒ 는 문이 닫혔다.
>
> **Step 5(환승)는 삭제했다 — 이미 되어 있었다.** 소유는 세로 채널, 이용자는 기둥 끝
> 포트 경로, 구현은 `seed.fromRowChannel → buildPlannedChain`. 관문이 이미 충족이었다.
>
> **실측했다(2026-09-04): `delivery-dijkstra-fallback` 이 통째로 사라졌다.**
> 합류 ON 에서 `planned 3 / dijkstra 2` → **`planned 5 / dijkstra 0`**, 이슈 2 → 1.
> 대가는 셀 513 → 520(계단꼴이 지름길보다 조금 길다).
>
> **다음은 Step 6** — 남은 경고 `perimeter-skip`(상자 4개)이 그 몫이다.
> **납품 라우터는 여전히 안 건드린다** — 고칠 것이 남았는지는 Step 6 뒤에 다시 잰다.
>
> **정정 둘:**
> ① 갱신안 §1.4 의 *"이미 띠 밖으로 밀어내고 있다"* 는 **틀렸다** — `높이 3 → 수요 4` 는
> `trackCount + 2` 의 여유이고 트랙 2개는 3칸에 들어간다. 넘치려면 트랙 4개 이상이라야 한다.
> ② 커밋 `d35eca4` 의 *"배치가 한 칸도 안 바뀐다"* 도 **틀렸다** — Step 3 갈래는 안 돌았지만
> Step 4 의 순서 바꾸기가 배치를 움직였다(셀 513 → 520).

**[[용어사전#행 채널 (row channel)|행 채널]]에 계획 모델을 준다.** 이름은 2026-07-11 부터
있었지만(세로 채널과 **같은 커밋**) 계획하는 코드가 없어, 폭이 `STACK_GAP` 상수로 우연히
생기고 아무도 예약하지 않는다. 계획서는 [행채널-모델.md](행채널-모델.md).

**트렁크벨트-경로모델과 독립이다** — 저쪽은 모듈 **안쪽**(레인·좌석·형태), 이쪽은 모듈
**사이**(통로). 다만 저쪽의 `portEnd`(기둥 끝 포트)가 이 통로를 쓰겠다고 선언한 상태라,
**이 계획이 먼저 끝나야 저쪽 ㉮ 가 의미를 갖는다**(§1.2).

## 이 폴더의 어휘 — 맨 **"띠" = 행 채널**

[[용어사전#띠 (band)|띠]]는 **유(類)** 라 원래 종을 안 가리킨다(세로 띠 = 채널, 가로 띠 = 행 채널).
**이 폴더 안에서만** 맨 "띠" 를 행 채널로 읽는다 — 주제가 행 채널 하나뿐이라 모호하지 않다.
**밖으로 나가는 글(`docs/`·커밋 메시지)에는 이 약속이 안 따라간다** — 거기선 종 이름을 쓴다.

## 착수 전 반드시 읽을 것

| 무엇 | 왜 |
|---|---|
| [docs/layout-models.md](../../docs/auto-layout/common/layout-models.md) | **모델 다섯의 경계.** ⑤가 이 계획의 대상(빈자리)이고, ③과의 접점이 §3 |
| [docs/channel-geometry-reservation.md](../../docs/auto-layout/channel/channel-geometry-reservation.md) §2·§3 | 세로 채널의 본문. **전치할 원본**이다. 특히 §3 표(고정/자유/도형) |
| `planner/channelGeometryPlanner.ts` — `staircaseShape` · `elbowShape` | 도형의 실물. `hseg(startY, track, capCol)` 이 **환승의 접점**이다(§3) |
| `planner/channelPlanner.ts` — `assignTracksLeftEdge` | **축과 무관한 순수 알고리즘.** 그대로 쓴다 — 다시 만들지 않는다 |
| `planner/modulePacking.ts` — `deliverySeeds` 루프(≈900) · `seed.startY = fb.row` | **수요가 생기는 자리**. `port.face !== N/S → continue` 가 소비자를 가른다 |
| `planner/deliveryRoute.ts` — `buildPlannedChain` 의 `if (g.fromRowChannel) push(s)` | 장부에 없는 **세로 진입 다리**를 그리는 유일한 줄 |
| `planner/modulePacking.ts` — `STACK_GAP` · `layoutY` · `colX/colWidth` | 띠의 위치·폭이 지금 어떻게 정해지나(상수 3). 폭 역전을 여기 이식한다 |
| [docs/용어사전.md](../../docs/용어사전.md) `행 채널` · `채널` | 정의와 직교 짝 관계. **역할과 사고까지 미리 적혀 있다** |

## 하지 않는 것

- **세로 채널 모델을 재설계하지 않는다.** 계단꼴·절단선·같은 쪽 판정은 그대로다.
  바뀌는 것은 *"`startY` 가 어디서 오나"* 뿐이다(§3).
- **모듈 안쪽을 안 건드린다** — 포트 면 결정(`portEnd`)은 트렁크벨트-경로모델 소관.
- **DAG(한 자식 여러 부모)로 안 간다.** 행 채널은 통로이고 DAG 는 연결 관계다.
- **격자(2D 클러스터)로 안 간다.** → 그쪽 계획이 섰다: `tempPlanDocs/격자-클러스터/`
  (그 계획서 §4 가 접점 셋을 적는다 — `innerRowChannel` 은 W/E 로 나가 **독립**,
  `innerColumnChannel` 은 N/S 로 나가므로 **이 계획이 선행**)

## 실제로 밟은 함정

(착수 후 채운다. 계획서를 지울 때 여기 남은 것만 `docs/` 로 옮긴다.)
