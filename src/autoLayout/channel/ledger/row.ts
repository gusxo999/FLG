/**
 * 행 채널 계획 — [[용어사전#행 채널 (row channel)|행 채널]]의 트랙 배정과 높이.
 *
 * [channelPlanner](./tracks.ts) 의 **직교 짝**이다. 세로 채널이 깊이 사이를 가르며
 * **세로선(트랙)** 을 나눠 준다면, 행 채널은 같은 깊이의 모듈 행 사이를 가르며
 * **가로선(트랙)** 을 나눠 준다.
 *
 * ```
 * 세로 채널   구간 = 경로의 **y 범위**   트랙 = 열(x)   폭 = 가로 폭
 * 행 채널     구간 = 경로의 **x 범위**   트랙 = 행(y)   폭 = 세로 높이
 * ```
 *
 * 행 채널의 가로선은 언제나 열의 한쪽 변(이어지는 열 채널 쪽)까지 뻗는다 — 그래서 겹침 수가 아니라 **순서**가 답이다:
 * 끝마다 행 하나, 그 순서는 *"내 세로 진입이 남의 가로선을 지나지 않게"* 한 줄에서 나온다([planRowChannel]).
 *
 * ## 이 파일은 **순수 함수**만 낸다 — 끝(상자 x · 방향 · 들어오는 쪽) → 순서 → 트랙 → 높이
 *
 * 그 높이를 실제 배치에 먹이는 것은 `tree/shape.stackColumns` 다(누적합의 간격).
 *
 * (2026-08-18 ~ 2026-09-06 사이 이 자리에 *"순환이라 두 패스가 필요하다"* 는 절이 있었다.
 *  `topY → absPortY → 행 채널을 지나는 경로 → 행 채널 폭 → topY` 라고 적었는데 **둘째 화살표가
 *  거짓이었다** — 배정 입력 넷(면 · 모듈-로컬 x · `side` · 행 채널 신원)이 어느 것도 y 를 안 본다.
 *  그래서 배정이 `topY` **앞**에 설 수 있고, 두 패스가 필요 없다.)
 */

import { channelWidthFromTracks } from "./tracks";

/**
 * 행 채널 높이의 **하한**. 세로 채널의 `MODULE_CHANNEL_MIN` 과 짝이다.
 *
 * 값 3 은 옛 `STACK_GAP` 이었다 — 통과 경로가 0이면 `channelWidthFromTracks(0, 3) = 3` 이라
 * **상수 시절과 답이 같다.** 수요가 없는 트리는 이 계획 전후로 한 칸도 안 움직인다.
 */
export const ROW_CHANNEL_MIN = 3;

/**
 * 이 행 채널을 지나는 경로 끝 하나 — 상자에서 세로로 자기 행까지 들어와, 그 행을 따라 **열 채널 쪽**으로 가로로 간다.
 *
 * 가로선은 언제나 열의 한쪽 변까지 뻗는다 — 그래서 구간이 아니라 **상자 x 와 방향**으로 충분하다.
 */
export interface RowCrossing {
  /** 경로 끝 id — 결과 맵의 키로 그대로 돌아온다. */
  id: string;
  /**
   * **어느 쪽 모듈에서 행 채널로 들어오나** — 위 모듈이면 `"top"`, 아래면 `"bottom"`. 세로 진입이 위에서 오는지
   * 아래서 오는지가 남의 가로선을 지나나를 가른다(VLSI 채널 라우팅의 단자 위치).
   */
  side: "top" | "bottom";
  /** 상자의 x(모듈-로컬 — 같은 깊이의 모듈은 왼쪽 정렬이라 로컬 x 끼리 비교해도 답이 같다). */
  x: number;
  /**
   * **가로선이 뻗는 쪽** — 이 끝이 이어지는 열 채널이 있는 쪽이다.
   *   `W` 자식 쪽 끝 — 이 모듈이 부모에게 보내는 열 채널은 서쪽에 있다. 가로선이 `[0, x]` 를 덮는다
   *   `E` 부모 쪽 끝 — 자식에게서 받는 열 채널은 동쪽에 있다. 가로선이 `[x, 열의 동쪽 변]` 을 덮는다
   */
  toward: "W" | "E";
}

export interface RowChannelPlan {
  /** 경로 끝 id → 트랙 index(0부터, 위에서 아래로). 트랙 = 행 채널 안의 몇 번째 **행**. */
  tracks: Map<string, number>;
  /** 쓴 트랙 수 — 끝 하나에 행 하나다. */
  trackCount: number;
  /** 이 행 채널이 먹어야 하는 **높이**. 폭 역전 — 우리가 고르는 값이 아니라 배정의 결과다. */
  height: number;
  /**
   * **끝이 엇갈려 행을 못 받은 끝** — 어떤 순서로도 한쪽의 세로 진입이 다른 쪽의 가로선을 지난다(완전 교차).
   * 트랙이 없으므로 그 납품은 계획을 접고 방출이 잇는다 — 행 채널의 지하 횡단이 서기 전까지(docs/auto-layout/common/layout-models.md §3.5 3부).
   */
  dropped: string[];
}

/** 이 끝의 가로선이 x 열을 덮나. */
const covers = (c: RowCrossing, x: number): boolean => (c.toward === "W" ? x <= c.x : x >= c.x);

/**
 * 한 행 채널의 트랙 배정 + 높이.
 *
 * ## 판정은 한 줄이다 — **내 세로 진입이 남의 가로선을 지나지 않게**
 *
 * 끝 A 의 세로 진입은 행 채널의 제 변(위 · 아래)부터 A 의 행까지 x_A 열을 지난다. 남의 끝 B 의 가로선이 x_A 열을 덮으면
 * B 의 행은 A 의 세로 진입 **바깥**이어야 한다 —
 *
 * ```
 * B 가 x_A 를 덮는다   A 가 위에서 온다   →  A 가 B 보다 위 행
 *                     A 가 아래서 온다   →  A 가 B 보다 아래 행
 * ```
 *
 * 이 관계를 모든 쌍에 세우면 순서 그래프가 된다. **순환이 없으면** 위상 순서가 곧 행 순서이고 만남이 0 이다. 두 끝이
 * 서로에게 반대를 요구하면(2-순환) 어떤 순서로도 한쪽이 지난다 — **완전 교차**다(열 채널의 정리 3 과 같은 꼴).
 *
 * > 가로선이 전부 **같은 쪽**(서쪽)으로 갈 때는 관계가 전순서로 모인다 — 위에서 오는 것이 언제나 위, 위쪽 무리는 서쪽에서
 * > 꺾는 것이 위, 아래쪽 무리는 그 거울(2026-09-04 J-교차 ⓐ). 이 함수는 그 규칙을 **특수형으로 포함한다** — 서쪽으로만 가는
 * > 행 채널의 답은 그 전과 같다. **그 전엔 부모 쪽 끝도 서쪽으로 간다고 적었다**(`x1: 0`) — 실제로는 동쪽 열 채널로 가서,
 * > 부모 쪽 끝이 둘 이상인 행 채널에서 순서가 거꾸로였다(2026-10-02 · docs/auto-layout/channel/channel-geometry-reservation.md §10.3).
 *
 * **동률 깨기** — 관계가 정하지 않는 쌍은 위에서 오는 것 → id 순. **결정적이다.**
 *
 * **완전 교차를 만나면** 남은 끝 중 완전 교차 상대가 가장 많은 끝을 뺀다(동률은 id 뒤쪽) — 지하 횡단의 *"상대가 많은 쪽이
 * 들어간다"* 와 같은 잣대다. 뺀 끝은 `dropped` 로 돌아가고 트랙이 없다.
 */
export function planRowChannel(crossings: ReadonlyArray<RowCrossing>): RowChannelPlan {
  const ids = [...crossings].sort((a, b) => a.id.localeCompare(b.id));
  const n = ids.length;
  /** above[i] — i 가 위에 있어야 하는 끝들. */
  const above: Set<number>[] = ids.map(() => new Set<number>());
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j || !covers(ids[j], ids[i].x)) continue;
      // j 의 가로선이 i 의 세로 진입 열을 덮는다
      if (ids[i].side === "top") above[i].add(j); // i 가 j 보다 위
      else above[j].add(i); // j 가 i 보다 위
    }
  const alive = new Set(ids.map((_, i) => i));
  const order: number[] = [];
  const dropped: string[] = [];
  /** i 가 아직 남은 끝 중 자기보다 위에 와야 할 것을 하나라도 기다리나. */
  const blocked = (i: number) => [...alive].some((j) => j !== i && above[j].has(i));
  const priority = (a: number, b: number) =>
    (ids[a].side === ids[b].side ? 0 : ids[a].side === "top" ? -1 : 1) || ids[a].id.localeCompare(ids[b].id);
  while (alive.size > 0) {
    const ready = [...alive].filter((i) => !blocked(i)).sort(priority);
    if (ready.length > 0) {
      order.push(ready[0]);
      alive.delete(ready[0]);
      continue;
    }
    // 순환 — 완전 교차 상대(서로에게 반대를 요구하는 끝)가 가장 많은 끝을 뺀다. 2-순환이 없는 긴 순환이면 관계 수로.
    const partners = (i: number) => [...alive].filter((j) => j !== i && above[i].has(j) && above[j].has(i)).length;
    const degree = (i: number) => [...alive].filter((j) => j !== i && (above[i].has(j) || above[j].has(i))).length;
    const victim = [...alive].sort(
      (a, b) => partners(b) - partners(a) || degree(b) - degree(a) || ids[b].id.localeCompare(ids[a].id),
    )[0];
    dropped.push(ids[victim].id);
    alive.delete(victim);
  }
  return {
    tracks: new Map(order.map((i, t) => [ids[i].id, t])),
    trackCount: order.length,
    height: channelWidthFromTracks(order.length, ROW_CHANNEL_MIN),
    dropped,
  };
}

/* (옛 `fitRowChannel` 은 **근거를 잃어 지웠다** — 2026-09-06. 트랙이 높이를 넘으면 마진만
   바깥으로 넓히던 미봉책이었고, `between` 은 *"모듈을 밀어야 하는데 그건 `topY` 를 다시
   잡는 일"* 이라 손을 못 댔다. 이제 **높이가 배정의 결과**라 넘칠 수가 없다 — 그 높이가
   곧 모듈 사이 간격이다(`tree/shape.stackColumns`). */
