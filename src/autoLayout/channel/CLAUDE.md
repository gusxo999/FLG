# channel/ — 여러 연결이 나눠 쓰는 자원

**판정 한 줄: 이 폴더는 공유 자원의 청구를 다룬다.** 트랙 하나를 둘이 못 쓴다는 것,
그 다툼을 계획 시점에 끝낸다는 것이 전부다. 읽을 문서는 `docs/auto-layout/channel/`.

## `ledger/` 가 폴더인 이유 — 합치면 런타임 순환이다

```
ledger/tracks.ts    세로 채널 — 구간을 트랙으로 (left-edge interval partitioning)
ledger/row.ts       행 채널 — 그 직교 짝 (구간 = x 범위 · 트랙 = 행)
ledger/assign.ts    행 채널 신원 · 세로 순서 · 트랙 배정
ledger/geometry.ts  배정 · 지하 청구 · 폭 예약 · 점프 (상태를 갖는다)
```

`assign.planChannels` 가 `geometry` 의 함수를 **부른다.** 넷을 한 파일로 합치면 그 호출이
파일 안으로 들어오면서 `ledger ⇄ geometry` 런타임 순환이 된다(계획 2 Step 5 발견 5-2).
**폴더는 그 순환을 안 만들면서 넷이 한 종류임을 말한다.**

## 안 가르는 자리 — 외곽과 같은 트랙 풀

`shape.materializeChannelGeometry` 는 납품(channel)과 반출(perimeter)을 **한 번에** 훑는다.
둘이 **같은 트랙 풀을 다투기** 때문이고, `ledger/geometry.planChannelGeometry` 가 `deliveries`
와 `exports` 를 함께 받는 것도 같은 이유다. 관심사로 가르려면 **그 다툼을 먼저 풀어야 한다** —
가르는 것이 먼저가 아니다.
