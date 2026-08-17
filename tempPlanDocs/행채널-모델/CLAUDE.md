# 행채널-모델 — 상태와 고유 컨텍스트

> 상태: **승인 대기**

**[[용어사전#행 채널 (row channel)|행 채널]]에 계획 모델을 준다.** 이름은 2026-07-11 부터
있었지만(세로 채널과 **같은 커밋**) 계획하는 코드가 없어, 폭이 `STACK_GAP` 상수로 우연히
생기고 아무도 예약하지 않는다. 계획서는 [행채널-모델.md](행채널-모델.md).

**트렁크벨트-경로모델과 독립이다** — 저쪽은 모듈 **안쪽**(레인·좌석·형태), 이쪽은 모듈
**사이**(통로). 다만 저쪽의 `portEnd`(기둥 끝 포트)가 이 통로를 쓰겠다고 선언한 상태라,
**이 계획이 먼저 끝나야 저쪽 ㉮ 가 의미를 갖는다**(§1.2).

## 착수 전 반드시 읽을 것

| 무엇 | 왜 |
|---|---|
| [docs/layout-models.md](../../docs/auto-layout/common/layout-models.md) | **모델 다섯의 경계.** ⑤가 이 계획의 대상(빈자리)이고, ③과의 접점이 §3 |
| [docs/channel-geometry-reservation.md](../../docs/auto-layout/channel/channel-geometry-reservation.md) §2·§3 | 세로 채널의 본문. **전치할 원본**이다. 특히 §3 표(고정/자유/도형) |
| `planner/channelGeometryPlanner.ts` — `staircaseShape` · `elbowShape` | 도형의 실물. `hseg(startY, track, capCol)` 이 **환승의 접점**이다(§3) |
| `planner/channelPlanner.ts` — `assignTracksLeftEdge` | **축과 무관한 순수 알고리즘.** 그대로 쓴다 — 다시 만들지 않는다 |
| `planner/modulePacking.ts` — `STACK_GAP` · `layoutY` · `colX/colWidth` | 띠의 위치·폭이 지금 어떻게 정해지나(상수 3). 폭 역전을 여기 이식한다 |
| [docs/용어사전.md](../../docs/용어사전.md) `행 채널` · `채널` | 정의와 직교 짝 관계. **역할과 사고까지 미리 적혀 있다** |

## 하지 않는 것

- **세로 채널 모델을 재설계하지 않는다.** 계단꼴·절단선·같은 쪽 판정은 그대로다.
  바뀌는 것은 *"`startY` 가 어디서 오나"* 뿐이다(§3).
- **모듈 안쪽을 안 건드린다** — 포트 면 결정(`portEnd`)은 트렁크벨트-경로모델 소관.
- **DAG(한 자식 여러 부모)로 안 간다.** 행 채널은 통로이고 DAG 는 연결 관계다.
- **격자(2D 클러스터)로 안 간다.**

## 실제로 밟은 함정

(착수 후 채운다. 계획서를 지울 때 여기 남은 것만 `docs/` 로 옮긴다.)
