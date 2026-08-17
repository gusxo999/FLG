# 포트-표면-규약 — 상태와 고유 컨텍스트

> 상태: **승인 대기**

모듈은 불투명 블록인데 **포트 상자가 블록 속에 있다.** 같은 면의 더 깊은 레인이 상자를
감싸서, 바깥 주체(채널 계획)가 상자에 닿으려면 블록을 통과해야 한다. 상자를 **면 표면**으로
밀어내 그 통과를 없앤다. 계획서는 [포트-표면-규약.md](포트-표면-규약.md).

## 착수 전 반드시 읽을 것

| 무엇 | 왜 |
|---|---|
| [planner/channelGeometryPlanner.ts](../../src/autoLayout/planner/channelGeometryPlanner.ts) 머리말 + `staircaseShape` | **좌표계가 어디서 끝나는지**가 이 계획의 전부다. 진출 세그먼트가 `hseg(endY, -1, track)` — `-1` 은 W 벽 마진이고 **거기서 계획이 끝난다** |
| [planner/deliveryRoute.ts](../../src/autoLayout/planner/deliveryRoute.ts) `buildPlannedChain` | 방출은 `push(e)` 로 **상자까지** 그린다. 계획과 방출의 차이 구간이 이 계획의 대상이다 |
| [execution/module/emitModule.ts](../../src/autoLayout/execution/module/emitModule.ts) `makeLinkPortChest` | 상자 자리를 정하는 **유일한 곳**. `trunkEnd + 2·pfv` 고정 — 여기가 바뀐다 |
| [planner/module/linkPlanner.ts](../../src/autoLayout/planner/module/linkPlanner.ts) `LinkFaceContext.lanes` | 면의 **가장 깊은 점유**를 이미 아는 장부. 표면 깊이가 여기서 나온다 |
| [module/clusterModule.ts](../../src/autoLayout/module/clusterModule.ts) `moduleWayOuts` 주석 | *"모듈이 자기 자신에 대해 답한다(모듈=블랙박스)"* — 이 계획이 회복하려는 규약이 거기 적혀 있다 |
| [autoLayout/module/CLAUDE.md](../../src/autoLayout/module/CLAUDE.md) | *"모듈은 자기 ring 위에 포트를 갖는 **불투명 블록**"* — 위반된 규약의 원문 |

## 하지 않는 것

- **채널 계획에 모듈 내부를 알려주지 않는다.** `planChannelGeometry` 는 추상 (열, 행)으로
  순수하게 남는다 — 그 순수함이 이 계획의 **전제**다. 상자를 표면으로 옮기는 것은
  *계획을 넓히는 대신 사실을 바꾸는* 쪽이다.
- **트렁크벨트-경로모델의 ③(사다리)·⑤(모드 폐기)를 안 건드린다.** 다른 축이다
  (저쪽은 *벨트를 몇 개로 쪼개나*, 이쪽은 *포트가 어디 서나*).
- **채널 폭·트랙 배정을 안 고친다.** `no free lane track` 은 별개 문제로 남긴다
  ([judgements.md](judgements.md) J-폭).
- **반출(perimeter) 경로를 안 건드린다.** 상자가 표면에 서면 반출도 쉬워지지만, 그건
  결과이지 이 계획의 대상이 아니다.

## 실제로 밟은 함정

(착수 후 채운다. 계획서를 지울 때 여기 남은 것만 `docs/` 로 옮긴다.)
