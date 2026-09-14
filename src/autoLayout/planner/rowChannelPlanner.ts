/**
 * 행 채널 계획 — [[용어사전#행 채널 (row channel)|행 채널]]의 트랙 배정과 높이.
 *
 * [channelPlanner](channelPlanner.ts) 의 **직교 짝**이다. 세로 채널이 깊이 사이를 가르며
 * **세로선(트랙)** 을 나눠 준다면, 행 채널은 같은 깊이의 모듈 행 사이를 가르며
 * **가로선(트랙)** 을 나눠 준다.
 *
 * ```
 * 세로 채널   구간 = 경로의 **y 범위**   트랙 = 열(x)   폭 = 가로 폭
 * 행 채널     구간 = 경로의 **x 범위**   트랙 = 행(y)   폭 = 세로 높이
 * ```
 *
 * **알고리즘은 축과 무관하다** — `assignTracksLeftEdge` 를 그대로 쓴다. 이 파일이 하는 일은
 * *"무엇이 구간인가"* 를 가로축으로 읽어 주고, 폭 공식을 행 채널의 하한으로 감싸는 것뿐이다.
 *
 * ## 이 파일은 **순수 함수**만 낸다 — 구간 → 트랙 → 높이
 *
 * 그 높이를 실제 배치에 먹이는 것은 `tree/shape.stackColumns` 다(누적합의 간격).
 *
 * (2026-08-18 ~ 2026-09-06 사이 이 자리에 *"순환이라 두 패스가 필요하다"* 는 절이 있었다.
 *  `topY → absPortY → 행 채널을 지나는 경로 → 행 채널 폭 → topY` 라고 적었는데 **둘째 화살표가
 *  거짓이었다** — 배정 입력 넷(면 · 모듈-로컬 x · `side` · 행 채널 신원)이 어느 것도 y 를 안 본다.
 *  그래서 배정이 `topY` **앞**에 설 수 있고, 두 패스가 필요 없다.)
 */

import { assignTracksLeftEdge, channelWidthFromTracks, type Interval } from "./channelPlanner";

/**
 * 행 채널 높이의 **하한**. 세로 채널의 `MODULE_CHANNEL_MIN` 과 짝이다.
 *
 * 값 3 은 옛 `STACK_GAP` 이었다 — 통과 경로가 0이면 `channelWidthFromTracks(0, 3) = 3` 이라
 * **상수 시절과 답이 같다.** 수요가 없는 트리는 이 계획 전후로 한 칸도 안 움직인다.
 */
export const ROW_CHANNEL_MIN = 3;

/** 이 행 채널을 가로지르는 경로 하나 — **가로 구간**이다(세로 채널의 `Interval` 을 90° 돌린 것). */
export interface RowCrossing {
  /** 경로 id — 결과 맵의 키로 그대로 돌아온다. */
  id: string;
  /**
   * **어느 쪽 모듈에서 행 채널로 들어오나** — 위 모듈이면 `"top"`, 아래면 `"bottom"`.
   *
   * 가로 구간만으로는 교차를 못 막는다. 경로에는 포트에서 배정받은 행까지 내려오는
   * **세로 진입**이 반드시 있고, 그것이 남의 가로선을 가로지른다 — 그 세로선이 위에서
   * 오는지 아래서 오는지가 순서를 정한다(VLSI 채널 라우팅의 단자 위치).
   */
  side: "top" | "bottom";
  /** 가로 구간의 양 끝 x. 순서는 상관없다. */
  x1: number;
  x2: number;
}

export interface RowChannelPlan {
  /** 경로 id → 트랙 index(0부터). 트랙 = 행 채널 안의 몇 번째 **행**. */
  tracks: Map<string, number>;
  /** 쓴 트랙 수 = 구간들의 최대 동시 겹침 수. */
  trackCount: number;
  /** 이 행 채널이 먹어야 하는 **높이**. 폭 역전 — 우리가 고르는 값이 아니라 배정의 결과다. */
  height: number;
}

/**
 * 한 행 채널의 트랙 배정 + 높이.
 *
 * ## 순서가 교차를 없앤다 (2026-09-04, `judgements.md` J-교차 ⓐ)
 *
 * 겹침만 보고 트랙을 나눠 주면 **가로선끼리는** 안 부딪힌다. 그런데 경로에는 포트에서
 * 자기 행까지 내려오는 **세로 진입**이 있고, 그것이 남의 가로선을 가로지른다
 * (2026-09-04 실측: 계획 체인 둘이 `(18,26)` 에서 겹쳤다 — 한쪽의 가로 × 다른 쪽의 세로).
 *
 * 서쪽 끝이 공통일 때 안 부딪히는 조건을 풀면 **전순서**가 나온다:
 *
 * ```
 * 위에서 오는 것이 아래에서 오는 것보다 **언제나 위 행**
 *   위쪽 무리   동쪽 끝이 가까운 것부터 (서쪽에서 꺾는 것이 위)
 *   아래쪽 무리 동쪽 끝이 먼 것부터     (거울)
 * ```
 *
 * 유도: 위에서 오는 A 의 세로선은 `[top, r_A)` 를 차지하고, B 의 가로선은 `r_B` 에서
 * 서쪽 끝까지 뻗는다. `x_A ≤ x_B` 면 둘은 `r_B < r_A` 일 때만 만난다 → `r_A ≤ r_B`.
 * 아래쪽은 부호가 뒤집혀 `r_A ≥ r_B`. 섞이면 양쪽 부등식이 **둘 다** *"위쪽이 위"* 로
 * 모인다. 같은 열에 둘이 오는 경우는 없다 — 한 행 채널의 한쪽 단자는 **한 모듈**의 것이고
 * 같은 x 면 같은 상자다.
 *
 * **순환이 없으므로 dogleg 도 지하도 필요 없다**(J-교차 ⓑⓒ 는 영구 보류 쪽으로 기운다).
 * 다만 그 근거는 **서쪽 끝이 공통**이라는 것 하나다 — 통과 경로가 서쪽 변까지 안 가는
 * 날이 오면 순환이 생길 수 있고, 그때 ⓑⓒ 가 살아난다. 그래서 아래 코드는 공통이
 * 아니면 **옛 left-edge 로 떨어진다**(교차 보장 없이, 오늘 동작 그대로).
 *
 * **결정적이다** — 입력 순서와 무관하게 같은 답을 내려고 id 로 먼저 정렬한다
 * (`assignTracksLeftEdge` 는 입력 순서를 보존하지만, 동점일 때 그 순서가 답을 가른다).
 */
export function planRowChannel(crossings: ReadonlyArray<RowCrossing>): RowChannelPlan {
  const sorted = [...crossings].sort((a, b) => a.id.localeCompare(b.id));
  const west = (c: RowCrossing) => Math.min(c.x1, c.x2);
  const east = (c: RowCrossing) => Math.max(c.x1, c.x2);
  // **서쪽 끝이 모두 같으면 전순서가 선다** — 그러면 교차가 0이고, 트랙도 안 는다.
  //
  // 실물이 늘 그렇다: 통과 경로는 전부 상자에서 **그 열의 서쪽 변**까지 달린다
  // (`modulePacking` 의 `x1: 0`). 그래서 구간이 전부 겹치고, left-edge 는 어차피 경로마다
  // 트랙 하나를 준다 — 여기서 바꾸는 것은 **개수가 아니라 순서**다.
  if (sorted.length > 0 && sorted.every((c) => west(c) === west(sorted[0]))) {
    const order = [
      // 위에서 내려오는 것: 서쪽에서 꺾는 것이 **위 행**
      ...sorted.filter((c) => c.side === "top").sort((a, b) => east(a) - east(b) || a.id.localeCompare(b.id)),
      // 아래에서 올라오는 것: 거울이라 **동쪽에서 꺾는 것이 위 행**
      ...sorted.filter((c) => c.side === "bottom").sort((a, b) => east(b) - east(a) || a.id.localeCompare(b.id)),
    ];
    return {
      tracks: new Map(order.map((c, i) => [c.id, i])),
      trackCount: order.length,
      height: channelWidthFromTracks(order.length, ROW_CHANNEL_MIN),
    };
  }
  const intervals: Interval[] = sorted.map((c) => ({
    lo: Math.min(c.x1, c.x2),
    hi: Math.max(c.x1, c.x2),
  }));
  const { tracks, trackCount } = assignTracksLeftEdge(intervals);
  return {
    tracks: new Map(sorted.map((c, i) => [c.id, tracks[i]])),
    trackCount,
    height: channelWidthFromTracks(trackCount, ROW_CHANNEL_MIN),
  };
}

/* (옛 `fitRowChannel` 은 **근거를 잃어 지웠다** — 2026-09-06. 트랙이 높이를 넘으면 마진만
   바깥으로 넓히던 미봉책이었고, `between` 은 *"모듈을 밀어야 하는데 그건 `topY` 를 다시
   잡는 일"* 이라 손을 못 댔다. 이제 **높이가 배정의 결과**라 넘칠 수가 없다 — 그 높이가
   곧 모듈 사이 간격이다(`tree/shape.stackColumns`). */
