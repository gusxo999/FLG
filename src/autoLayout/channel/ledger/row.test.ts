import { describe, it, expect } from "vitest";
import { planRowChannel, ROW_CHANNEL_MIN, type RowCrossing } from "./row";

// 행 채널의 판정은 한 줄이다 — **내 세로 진입이 남의 가로선을 지나지 않게.** 가로선은 열의 한쪽 변까지 뻗는다:
// 자식 쪽 끝은 서쪽(`W` — `[0, x]`), 부모 쪽 끝은 동쪽(`E` — `[x, 동쪽 변]`). 2026-10-02 까지 부모 쪽도 서쪽으로 적었다.

const c = (id: string, side: "top" | "bottom", x: number, toward: "W" | "E"): RowCrossing => ({ id, side, x, toward });
const order = (p: ReturnType<typeof planRowChannel>) =>
  [...p.tracks.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);

/** 행 순서(위 → 아래)에서 한 끝의 세로 진입이 남의 가로선을 지나나 — 실제 도형으로 센다. */
function meetings(cs: readonly RowCrossing[], rows: ReadonlyMap<string, number>): number {
  const covers = (h: RowCrossing, x: number) => (h.toward === "W" ? x <= h.x : x >= h.x);
  let n = 0;
  for (const a of cs)
    for (const b of cs) {
      if (a === b || !rows.has(a.id) || !rows.has(b.id)) continue;
      const ra = rows.get(a.id)!;
      const rb = rows.get(b.id)!;
      // a 의 세로 진입이 지나는 행 — 위에서 오면 a 의 행보다 위 전부, 아래서 오면 아래 전부
      const passes = a.side === "top" ? rb < ra : rb > ra;
      if (passes && covers(b, a.x)) n++;
    }
  return n;
}

describe("planRowChannel — 끝마다 행 하나, 순서가 만남을 없앤다", () => {
  it("아무도 안 지나면 트랙 0 — 높이는 하한 그대로", () => {
    const p = planRowChannel([]);
    expect(p.trackCount).toBe(0);
    expect(p.height).toBe(ROW_CHANNEL_MIN);
    expect(p.dropped).toEqual([]);
  });

  it("서쪽으로만 가면 오늘 규칙 그대로 — 위에서 오는 것이 위 · 위쪽 무리는 서쪽부터 · 아래쪽 무리는 동쪽부터", () => {
    const p = planRowChannel([c("t1", "top", 6, "W"), c("t2", "top", 2, "W"), c("b1", "bottom", 1, "W"), c("b2", "bottom", 5, "W")]);
    expect(order(p)).toEqual(["t2", "t1", "b2", "b1"]);
    expect(p.dropped).toEqual([]);
  });

  it("동쪽으로만 가면 그 거울 — 위쪽 무리는 동쪽부터 · 아래쪽 무리는 서쪽부터", () => {
    const p = planRowChannel([c("t1", "top", 6, "E"), c("t2", "top", 2, "E"), c("b1", "bottom", 1, "E"), c("b2", "bottom", 5, "E")]);
    expect(order(p)).toEqual(["t1", "t2", "b1", "b2"]);
  });

  it("부모 쪽 끝 둘이 아래서 오면 서쪽 상자가 위 행 — Step 2 합성 사례(가스 x 10 · 석탄 x 6)", () => {
    // 옛 판은 둘 다 서쪽으로 간다고 보고 가스(동쪽)에 위 행을 줬다 — 가스의 진입 기둥이 석탄의 가로선 [6, 동쪽 변] 을 지났다.
    const cs = [c("gas", "bottom", 10, "E"), c("coal", "bottom", 6, "E")];
    const p = planRowChannel(cs);
    expect(order(p)).toEqual(["coal", "gas"]);
    expect(meetings(cs, p.tracks)).toBe(0);
  });

  it("방향이 섞여도 서로 안 덮으면 둘 다 앉는다", () => {
    // 동쪽으로 가는 상자(x 8)가 서쪽으로 가는 상자(x 3)보다 동쪽 — 두 가로선이 안 겹치고 서로의 기둥도 안 덮는다.
    const cs = [c("in", "top", 8, "E"), c("out", "top", 3, "W")];
    const p = planRowChannel(cs);
    expect(p.dropped).toEqual([]);
    expect(meetings(cs, p.tracks)).toBe(0);
  });

  it("같은 쪽 · 반대 방향 · 동쪽으로 가는 상자가 서쪽에 있으면 완전 교차 — 하나는 행을 못 받는다", () => {
    // in 의 가로선 [2, 동쪽] 이 out 의 기둥(x 6)을 덮고, out 의 가로선 [0, 6] 이 in 의 기둥(x 2)을 덮는다.
    const cs = [c("in", "top", 2, "E"), c("out", "top", 6, "W")];
    const p = planRowChannel(cs);
    expect(p.dropped).toEqual(["out"]); // 상대 수가 같으면 id 뒤쪽
    expect(p.trackCount).toBe(1);
  });

  it("완전 교차 상대가 많은 끝이 빠진다 — 나머지는 앉는다", () => {
    const cs = [c("a", "top", 2, "E"), c("b", "top", 6, "W"), c("c", "top", 7, "W")];
    const p = planRowChannel(cs);
    expect(p.dropped).toEqual(["a"]);
    expect(meetings(cs, p.tracks)).toBe(0);
  });

  it("작은 판 전수 — 앉은 끝끼리 만남 0 · 빠지는 것은 어떤 순서로도 안 되는 판뿐", () => {
    const all: RowCrossing[] = [];
    for (const side of ["top", "bottom"] as const)
      for (const toward of ["W", "E"] as const) for (let x = 0; x < 4; x++) all.push(c(`${side}${toward}${x}`, side, x, toward));
    const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
    const solvable = (cs: RowCrossing[]) =>
      perms(cs).some((p) => meetings(cs, new Map(p.map((x, i) => [x.id, i]))) === 0);
    let boards = 0;
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++)
        for (let k = j + 1; k < all.length; k++) {
          const cs = [all[i], all[j], all[k]];
          // 같은 쪽 · 같은 x 는 한 상자다 — 납품은 하나뿐이다. 레인 합류도 수요는 하나만 적는다(`tree/build.laneMerge.test` 가
          // 잠근다 — 2026-10-02 까지 납품을 안 만드는 줄도 수요를 적어 바로 이 모양이 실제 입력에 있었다)
          if (new Set(cs.map((q) => `${q.side}${q.x}`)).size < cs.length) continue;
          boards++;
          const p = planRowChannel(cs);
          expect(meetings(cs, p.tracks), cs.map((q) => q.id).join(" ")).toBe(0);
          if (p.dropped.length > 0) expect(solvable(cs), cs.map((q) => q.id).join(" ")).toBe(false);
          else expect(p.trackCount).toBe(3);
        }
    expect(boards).toBeGreaterThan(100);
  });

  it("높이는 배정 결과에서 나온다 — 끝 다섯이면 트랙 다섯", () => {
    const p = planRowChannel(Array.from({ length: 5 }, (_, i) => c(`x${i}`, "top", i, "W")));
    expect(p.trackCount).toBe(5);
    expect(p.height).toBe(5 + 2); // channelWidthFromTracks
  });

  it("결정적 — 입력 순서를 바꿔도 같은 답", () => {
    const A = [c("a", "top", 2, "E"), c("b", "bottom", 4, "W"), c("c", "top", 5, "W")];
    const B = [A[2], A[0], A[1]];
    expect([...planRowChannel(A).tracks]).toEqual([...planRowChannel(B).tracks]);
  });
});
