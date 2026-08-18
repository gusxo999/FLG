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
 * **결정적이다** — 입력 순서와 무관하게 같은 답을 내려고 id 로 먼저 정렬한다
 * (`assignTracksLeftEdge` 는 입력 순서를 보존하지만, 동점일 때 그 순서가 답을 가른다).
 */
export function planRowChannel(crossings: ReadonlyArray<RowCrossing>): RowChannelPlan {
  const sorted = [...crossings].sort((a, b) => a.id.localeCompare(b.id));
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
