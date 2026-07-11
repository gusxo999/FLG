import { describe, it, expect } from "vitest";
import {
  assignTracksLeftEdge,
  channelWidthFromTracks,
  crossingCount,
  type Interval,
} from "./channelPlanner";

describe("channelPlanner — left-edge 트랙 배정", () => {
  it("겹치지 않는 구간은 한 트랙을 공유한다", () => {
    const intervals: Interval[] = [
      { lo: 0, hi: 2 },
      { lo: 3, hi: 5 }, // 첫 구간(hi=2)이 끝난 뒤 시작 → 같은 트랙
      { lo: 6, hi: 8 },
    ];
    const { trackCount } = assignTracksLeftEdge(intervals);
    expect(trackCount).toBe(1);
    // A안(단순 카운트)은 3으로 과대 추정 → B안이 더 좁다.
    expect(crossingCount(intervals)).toBe(3);
  });

  it("완전히 겹치는 구간은 각자 트랙을 가진다 (= 최대 동시 겹침 수)", () => {
    const intervals: Interval[] = [
      { lo: 0, hi: 10 },
      { lo: 1, hi: 9 },
      { lo: 2, hi: 8 },
    ];
    const { trackCount } = assignTracksLeftEdge(intervals);
    expect(trackCount).toBe(3);
  });

  it("부분 겹침 — 최대 동시 겹침 수만큼만 트랙을 쓴다", () => {
    // 타임라인:  [0,4] [2,6] [5,9]
    //  - [0,4] 와 [2,6] 은 겹침(2 트랙)
    //  - [5,9] 는 [0,4] 가 끝난 뒤라 트랙0 재사용 가능 → 총 2 트랙
    const intervals: Interval[] = [
      { lo: 0, hi: 4 },
      { lo: 2, hi: 6 },
      { lo: 5, hi: 9 },
    ];
    const { tracks, trackCount } = assignTracksLeftEdge(intervals);
    expect(trackCount).toBe(2);
    expect(tracks).toHaveLength(3);
  });

  it("입력 순서대로 트랙 인덱스를 돌려준다", () => {
    const intervals: Interval[] = [
      { lo: 10, hi: 20 }, // 인덱스 0 — 늦게 시작
      { lo: 0, hi: 5 }, // 인덱스 1 — 일찍 시작
    ];
    const { tracks } = assignTracksLeftEdge(intervals);
    // 정렬은 내부에서만; 반환 배열은 입력 인덱스 정렬.
    expect(tracks).toHaveLength(2);
    // 둘은 겹치지 않으므로 같은 트랙(0) 공유.
    expect(tracks[0]).toBe(0);
    expect(tracks[1]).toBe(0);
  });

  it("빈 입력 → 트랙 0개", () => {
    expect(assignTracksLeftEdge([]).trackCount).toBe(0);
  });

  it("채널 폭 = max(하한, 트랙수+2)", () => {
    expect(channelWidthFromTracks(0, 3)).toBe(3); // 크로싱 없음 → 하한
    expect(channelWidthFromTracks(1, 3)).toBe(3); // 1+2=3, 하한과 동일
    expect(channelWidthFromTracks(2, 3)).toBe(4); // 2+2=4
    expect(channelWidthFromTracks(5, 3)).toBe(7); // 5+2=7
  });
});
