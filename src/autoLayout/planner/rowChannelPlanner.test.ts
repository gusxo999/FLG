import { describe, it, expect } from "vitest";
import { fitRowChannel, planRowChannel, ROW_CHANNEL_MIN, type RowCrossing } from "./rowChannelPlanner";

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

describe("fitRowChannel — 트랙이 넘치면 마진은 바깥으로 자란다", () => {
  const N = { kind: "marginN" as const, top: -3, bottom: -1 }; // 높이 3
  const S = { kind: "marginS" as const, top: 10, bottom: 12 };
  const B = { kind: "between" as const, top: 4, bottom: 6 };

  it("담기면 **한 칸도 안 움직인다** — 오늘 배치가 안 바뀌는 이유다", () => {
    for (const b of [N, S, B])
      for (const n of [0, 1, 2, 3]) expect(fitRowChannel(b, n)).toEqual({ top: b.top, bottom: b.bottom });
  });

  it("`marginN` 은 **위로** 자란다 — 아래는 모듈이라 못 간다", () => {
    // 아래 경계가 고정이라야 track 0 이 모듈에서 멀어진다(늘어난 만큼 바깥으로).
    expect(fitRowChannel(N, 5)).toEqual({ top: -5, bottom: -1 });
  });

  it("`marginS` 는 **아래로** 자란다 — 거울이다", () => {
    expect(fitRowChannel(S, 5)).toEqual({ top: 10, bottom: 14 });
  });

  it("`between` 은 **안 자란다** — 양쪽이 모듈이라 밀어야 하고, 그건 재배치다", () => {
    expect(fitRowChannel(B, 5)).toEqual({ top: 4, bottom: 6 });
  });

  it("자란 뒤에는 **모든 트랙 행이 띠 안**이다 — 이것이 이 함수의 존재 이유다", () => {
    for (const b of [N, S])
      for (const n of [4, 5, 9]) {
        const f = fitRowChannel(b, n);
        for (let t = 0; t < n; t++) {
          expect(f.top + t).toBeGreaterThanOrEqual(f.top);
          expect(f.top + t).toBeLessThanOrEqual(f.bottom);
        }
      }
  });
});

describe("planRowChannel — **세로 진입까지 안 부딪힌다** (J-교차 ⓐ)", () => {
  // 실물의 모양: 통과 경로는 전부 상자에서 **그 열의 서쪽 변(x=0)** 까지 달린다.
  // 그래서 가로 구간이 전부 겹치고, 트랙은 어차피 경로마다 하나다 — 바뀌는 것은 순서다.
  const c = (id: string, x2: number, side: "top" | "bottom"): RowCrossing =>
    ({ id, x1: 0, x2, side });

  /** 한 경로가 띠 안에서 실제로 먹는 칸 — 가로 주행 + **세로 진입**. */
  const cellsOf = (x: RowCrossing, row: number, top: number, bottom: number): string[] => {
    const out: string[] = [];
    for (let px = 0; px <= x.x2; px++) out.push(`${px},${row}`);
    if (x.side === "top") for (let y = top; y < row; y++) out.push(`${x.x2},${y}`);
    else for (let y = row + 1; y <= bottom; y++) out.push(`${x.x2},${y}`);
    return out;
  };

  const collide = (cs: RowCrossing[], rowOf: (id: string) => number, top: number, bottom: number) => {
    const seen = new Map<string, string>();
    const hits: string[] = [];
    for (const x of cs)
      for (const k of cellsOf(x, rowOf(x.id), top, bottom)) {
        const who = seen.get(k);
        if (who !== undefined && who !== x.id) hits.push(k);
        else seen.set(k, x.id);
      }
    return hits;
  };

  // 2026-09-04 실측을 재현한 모양: 위 모듈에서 하나, 아래 모듈에서 하나.
  const mixed = [c("copper", 19, "top"), c("stone", 18, "bottom")];

  it("실측 모양이 **겹치지 않는다** — `(18,26)` 이 사라진다", () => {
    const p = planRowChannel(mixed);
    const top = 0, bottom = top + p.trackCount - 1;
    expect(collide(mixed, (id) => top + p.tracks.get(id)!, top, bottom)).toEqual([]);
  });

  it("**대조군** — 순서를 뒤집으면 실제로 부딪힌다(이 테스트가 헛돌지 않는다는 증거)", () => {
    const p = planRowChannel(mixed);
    const top = 0, bottom = top + p.trackCount - 1;
    const flipped = (id: string) => bottom - (p.tracks.get(id)! - top);
    expect(collide(mixed, flipped, top, bottom).length).toBeGreaterThan(0);
  });

  it("여럿이 섞여도 겹치지 않는다 — 위 셋 · 아래 셋", () => {
    const many = [
      c("t1", 5, "top"), c("t2", 12, "top"), c("t3", 20, "top"),
      c("b1", 7, "bottom"), c("b2", 15, "bottom"), c("b3", 22, "bottom"),
    ];
    const p = planRowChannel(many);
    const top = 0, bottom = top + p.trackCount - 1;
    expect(collide(many, (id) => top + p.tracks.get(id)!, top, bottom)).toEqual([]);
  });

  it("트랙은 **안 는다** — 순서만 바꾼다(폭이 커지지 않는 근거)", () => {
    const many = [c("a", 5, "top"), c("b", 9, "bottom"), c("c", 2, "top")];
    // 서쪽 끝이 공통이라 left-edge 도 셋 다 다른 트랙을 준다.
    expect(planRowChannel(many).trackCount).toBe(3);
  });

  it("위에서 오는 것은 **언제나** 아래에서 오는 것보다 위 행", () => {
    const many = [c("t", 30, "top"), c("b", 1, "bottom")];
    const p = planRowChannel(many);
    expect(p.tracks.get("t")!).toBeLessThan(p.tracks.get("b")!);
  });

  it("서쪽 끝이 제각각이면 **보장을 안 한다** — 옛 배정 그대로(정직하게 물러선다)", () => {
    // 전순서의 근거가 "서쪽 끝 공통" 하나이므로, 아니면 겹침만 보는 left-edge 로 떨어진다.
    const p = planRowChannel([{ id: "a", x1: 0, x2: 4, side: "top" }, { id: "b", x1: 6, x2: 9, side: "bottom" }]);
    expect(p.trackCount).toBe(1); // 안 겹치니 한 트랙을 나눠 쓴다 = 옛 동작
  });
});
