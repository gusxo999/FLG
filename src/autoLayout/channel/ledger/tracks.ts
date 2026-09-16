/**
 * 채널 계획 — S-LAYER 의 인접 레이어 사이 라우팅 채널 폭 산정.
 *
 * 단일 출처: docs/auto-layout-wizard.s-layer-channel-reservation.md §4 / §5.
 *
 * 한 채널 경계를 가로지르는 연결들을 **세로 구간(interval)** 으로 보고, 서로
 * 겹치지 않는 구간끼리 같은 **트랙(세로선)** 을 공유하도록 배정한다 (left-edge
 * interval partitioning = interval graph 채색). 필요한 트랙 수 = 그 채널의 폭.
 *
 * 두 가지 폭 산정을 모두 제공한다:
 *  - `crossingCount`     (A안) — 연결 1개당 트랙 1개. 단순 카운트. 과대 추정.
 *  - `assignTracksLeftEdge` (B안) — 겹치지 않는 구간은 트랙 공유 → **최소 트랙 수**.
 *
 * 본 모듈은 *폭/트랙 산정만* 한다. 실제 셀(벨트/투입기/파이프) 깔기는 검증된
 * 기존 라우터(`containerRouting.routePorts`)가 담당한다 — 트랙 폭이 항상 충분하므로
 * BFS 가 실패하지 않는다(문서 §3 C2 보장의 실용 버전).
 */

/** 채널을 가로지르는 한 연결의 세로 점유 구간. `lo ≤ hi`. */
export interface Interval {
  lo: number;
  hi: number;
}

/**
 * (A안) 단순 크로싱 수 — 연결 1개당 트랙 1개로 가정. 겹침 여부를 보지 않으므로
 * 항상 `intervals.length`. 비교/로그용.
 */
export function crossingCount(intervals: ReadonlyArray<Interval>): number {
  return intervals.length;
}

/**
 * (B안) left-edge 트랙 배정.
 *
 * 구간을 시작(lo) 오름차순으로 정렬해, 각 구간을 "마지막 구간이 이미 끝난(end < lo)"
 * 가장 앞 트랙에 욱여넣는다. 빈 트랙이 없으면 새 트랙을 연다. 이렇게 하면 사용한
 * 트랙 수 = 구간들의 **최대 동시 겹침 수**(interval graph 채색수) = 최소 트랙 수.
 *
 * @returns `tracks` = 입력 순서 그대로의 각 구간 트랙 인덱스(0부터),
 *          `trackCount` = 사용한 총 트랙 수.
 */
export function assignTracksLeftEdge(intervals: ReadonlyArray<Interval>): {
  tracks: number[];
  trackCount: number;
} {
  // 입력 순서를 보존하려고 (구간, 원래 인덱스) 로 정렬한다.
  const order = intervals
    .map((iv, i) => ({ iv, i }))
    .sort((a, b) => a.iv.lo - b.iv.lo || a.iv.hi - b.iv.hi);

  const trackEnds: number[] = []; // trackEnds[t] = 트랙 t 의 마지막 구간 hi
  const tracks = new Array<number>(intervals.length).fill(0);

  for (const { iv, i } of order) {
    // 이미 끝난(겹치지 않는) 가장 앞 트랙을 찾는다.
    let t = trackEnds.findIndex((end) => end < iv.lo);
    if (t === -1) {
      t = trackEnds.length;
      trackEnds.push(iv.hi);
    } else {
      trackEnds[t] = iv.hi;
    }
    tracks[i] = t;
  }

  return { tracks, trackCount: trackEnds.length };
}

/**
 * 트랙 수 → 채널의 가로 폭(셀).
 *
 * 아이템 라우팅 기준: 트랙(세로 벨트선) 사이사이 + 양 끝 투입기 진입을 고려해
 * `trackCount + 2`. 단, 아이템 체인 최소(투입기+벨트+투입기=3)인 `minGap` 을 하한으로.
 * 크로싱이 없는 채널(trackCount=0)도 최소 폭은 확보한다.
 */
export function channelWidthFromTracks(trackCount: number, minGap: number): number {
  return Math.max(minGap, trackCount + 2);
}
