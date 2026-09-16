import { describe, it, expect } from "vitest";
import { planRowChannel, ROW_CHANNEL_MIN, type RowCrossing } from "./row";

// 행 채널은 세로 채널의 **직교 짝**이다. 이 파일은 그 대칭이 실제로 성립하는지 —
// 즉 같은 알고리즘이 가로축에서도 같은 답을 내는지 — 를 못 박는다.

describe("planRowChannel — 구간 겹침이 트랙 수를 정한다", () => {
  // 이 무리의 관심사는 **구간 겹침 → 트랙 수**다. 서쪽 끝이 제각각이라 전순서 갈래가
  // 아니라 옛 left-edge 로 간다 — 그 대칭이 안 깨졌는지를 여기서 못 박는다.
  const c = (id: string, x1: number, x2: number): RowCrossing => ({ id, x1, x2, side: "top" });

  it("아무도 안 지나면 트랙 0 — 높이는 하한 그대로 (오늘 배치가 안 바뀌는 근거)", () => {
    const p = planRowChannel([]);
    expect(p.trackCount).toBe(0);
    // STACK_GAP(3) 과 같은 값이라야 상수 시절과 답이 같다.
    expect(p.height).toBe(ROW_CHANNEL_MIN);
  });

  it("안 겹치는 두 구간은 **같은 트랙**을 나눠 쓴다", () => {
    const p = planRowChannel([c("a", 0, 4), c("b", 6, 9)]);
    expect(p.trackCount).toBe(1);
    expect(p.tracks.get("a")).toBe(p.tracks.get("b"));
  });

  it("겹치는 두 구간은 **다른 트랙**", () => {
    const p = planRowChannel([c("a", 0, 6), c("b", 4, 9)]);
    expect(p.trackCount).toBe(2);
    expect(p.tracks.get("a")).not.toBe(p.tracks.get("b"));
  });

  it("트랙 수 = **최대 동시 겹침**이지 경로 수가 아니다", () => {
    // 셋이 있지만 동시에 겹치는 것은 둘뿐 → 트랙 2.
    const p = planRowChannel([c("a", 0, 5), c("b", 3, 8), c("c", 10, 12)]);
    expect(p.trackCount).toBe(2);
  });

  it("높이는 배정 **결과**에서 나온다 — 폭 역전", () => {
    const many = Array.from({ length: 5 }, (_, i) => c(`x${i}`, 0, 10)); // 전부 겹친다
    const p = planRowChannel(many);
    expect(p.trackCount).toBe(5);
    expect(p.height).toBe(5 + 2); // channelWidthFromTracks
    expect(p.height).toBeGreaterThan(ROW_CHANNEL_MIN);
  });

  it("x1·x2 의 순서를 안 가린다 — 구간이지 방향이 아니다", () => {
    expect(planRowChannel([c("a", 9, 2)]).trackCount).toBe(planRowChannel([c("a", 2, 9)]).trackCount);
  });

  it("결정적 — 입력 순서를 바꿔도 같은 답", () => {
    const A = [c("a", 0, 6), c("b", 4, 9), c("c", 1, 2)];
    const B = [c("c", 1, 2), c("b", 4, 9), c("a", 0, 6)];
    const pa = planRowChannel(A);
    const pb = planRowChannel(B);
    expect(pa.trackCount).toBe(pb.trackCount);
    for (const id of ["a", "b", "c"]) expect(pa.tracks.get(id)).toBe(pb.tracks.get(id));
  });
});
