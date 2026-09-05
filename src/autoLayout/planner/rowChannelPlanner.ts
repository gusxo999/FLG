/**
 * 행 채널 계획 — [[용어사전#행 채널 (row channel)|행 채널]]의 트랙 배정과 폭.
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
 * ## 왜 위치 반영이 여기 없나 — **순환** (2026-08-18)
 *
 * ```
 * topY → absPortY → 띠를 지나는 경로 → 띠 폭 → topY
 * ```
 *
 * 세로 채널은 이 순환을 **축을 갈라서** 피한다: y 는 상수 간격(`STACK_GAP`)으로 먼저 정하고,
 * x 만 수요에서 유도한다. 행 채널은 **같은 축**이라 그 수가 안 통한다 — 폭이 위치를 바꾸고
 * 위치가 다시 통과 경로를 바꾼다.
 *
 * 그래서 이 파일은 **순수 함수**만 낸다(구간 → 트랙 → 폭). 그 폭을 실제 배치에 먹이는 것은
 * 통과 경로를 아는 단계(환승)의 일이고, 거기서 **두 패스**(임시 간격으로 배치 → 통과 경로 계산
 * → 폭 확정 → 재배치)로 순환을 끊는다. → `tempPlanDocs/행채널-모델/` Step 3
 */

import { assignTracksLeftEdge, channelWidthFromTracks, type Interval } from "./channelPlanner";

/**
 * 행 채널 폭(높이)의 하한. 세로 채널의 `MODULE_CHANNEL_MIN` 과 짝이고, 값은
 * `STACK_GAP`(3) 과 같다 — **오늘 배치를 한 칸도 안 바꾸기 위해서다.** 통과 경로가 0이면
 * `channelWidthFromTracks(0, 3) = 3` 이라 상수 시절과 답이 같다.
 */
export const ROW_CHANNEL_MIN = 3;

/** 이 띠를 가로지르는 경로 하나 — **가로 구간**이다(세로 채널의 `Interval` 을 90° 돌린 것). */
export interface RowCrossing {
  /** 경로 id — 결과 맵의 키로 그대로 돌아온다. */
  id: string;
  /**
   * **어느 쪽 모듈에서 띠로 들어오나** — 위 모듈이면 `"top"`, 아래면 `"bottom"`.
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
  /** 경로 id → 트랙 index(0부터). 트랙 = 띠 안의 몇 번째 **행**. */
  tracks: Map<string, number>;
  /** 쓴 트랙 수 = 구간들의 최대 동시 겹침 수. */
  trackCount: number;
  /** 이 띠가 먹어야 하는 **높이**. 폭 역전 — 우리가 고르는 값이 아니라 배정의 결과다. */
  height: number;
}

/**
 * 한 띠의 트랙 배정 + 높이.
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
 * 모인다. 같은 열에 둘이 오는 경우는 없다 — 한 띠의 한쪽 단자는 **한 모듈**의 것이고
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

/**
 * **띠가 트랙을 다 담게 경계를 넓힌다** — 마진만. `between` 은 그대로 돌려준다.
 *
 * 행 매핑이 `row = top + t` 라, 트랙 수가 높이를 넘으면 그 행은 **띠 밖**을 가리킨다.
 * 마진은 밖이 비어 있으므로(그 깊이 맨 위/맨 아래 모듈의 바깥) 경계 숫자만 바꾸면 되고,
 * `between` 은 양쪽이 모듈이라 모듈을 밀어야 한다 — 그건 `topY` 를 다시 잡는 일이다.
 *
 * **`height`(= `trackCount + 2`)로 재지 않는다.** 그 +2 는 세로 채널의 **양옆 여유**인데
 * 행 매핑은 여유를 안 두므로, 그걸로 재면 트랙 2개에 높이 3인 멀쩡한 띠까지 "부족"이 된다
 * (2026-09-04 실측에서 실제로 그렇게 읽었다). **넘치는지는 트랙 수로 잰다.**
 */
export function fitRowChannel(
  band: { kind: "between" | "marginN" | "marginS"; top: number; bottom: number },
  trackCount: number,
): { top: number; bottom: number } {
  if (trackCount <= band.bottom - band.top + 1) return { top: band.top, bottom: band.bottom };
  if (band.kind === "marginN") return { top: band.bottom - (trackCount - 1), bottom: band.bottom };
  if (band.kind === "marginS") return { top: band.top, bottom: band.top + (trackCount - 1) };
  return { top: band.top, bottom: band.bottom };
}
