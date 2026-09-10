/**
 * 반직선 교차 — **`toward` 를 안 보면 넷 중 둘을 틀린다.**
 *
 * 축만 보는 판정(*"같은 열이면 겹친다"*)은 **등지고 뻗는** 쌍을 겹친다고 오판한다.
 * 그래서 여기 검사는 방향 조합을 전부 돈다: 같은 방향 · 마주 봄 · 등지고 뻗음.
 */
import { describe, it, expect } from "vitest";
import { directRaysCross, crossCellKey, type DirectRay } from "./directRay";

/** 세로 직진 — 로컬 열 `c` 에 서서 절대 행 `y0` 에서 `toward` 로 뻗는다. */
const V = (c: number, y0: number, toward: "N" | "S", depth = 1): DirectRay =>
  ({ depth, axis: "V", line: c, from: y0, toward });
/** 가로 직진 — 절대 행 `r` 에 서서 로컬 열 `x0` 에서 `toward` 로 뻗는다. */
const H = (r: number, x0: number, toward: "W" | "E", depth = 1): DirectRay =>
  ({ depth, axis: "H", line: r, from: x0, toward });

describe("directRaysCross — 직교(세로 × 가로)", () => {
  // 세로는 (열 3, 행 5)에서 위로, 가로는 (행 2, 열 1)에서 동으로.
  // 만나는 칸은 (열 3, 행 2) — 세로의 사정거리 y ≤ 5 안이고 가로의 x ≥ 1 안이다.
  it("↑N × →E — 가로가 세로의 위쪽이고 세로가 가로의 동쪽이면 만난다", () => {
    expect(directRaysCross(V(3, 5, "N"), H(2, 1, "E"))).toBe(true);
  });

  it("↑N × →E — 가로가 세로 **아래**면 못 만난다 (세로는 위로만 간다)", () => {
    expect(directRaysCross(V(3, 5, "N"), H(8, 1, "E"))).toBe(false);
  });

  it("↑N × →E — 세로가 가로의 **서쪽**이면 못 만난다 (가로는 동으로만 간다)", () => {
    expect(directRaysCross(V(0, 5, "N"), H(2, 1, "E"))).toBe(false);
  });

  it("↑N × ←W — 부등식이 뒤집힌다: 세로가 가로의 **서쪽**이라야 만난다", () => {
    expect(directRaysCross(V(0, 5, "N"), H(2, 1, "W"))).toBe(true);
    expect(directRaysCross(V(3, 5, "N"), H(2, 1, "W"))).toBe(false);
  });

  it("↓S × →E / ↓S × ←W — 세로가 아래로 뻗으면 가로가 **아래**여야 만난다", () => {
    expect(directRaysCross(V(3, 5, "S"), H(8, 1, "E"))).toBe(true);
    expect(directRaysCross(V(3, 5, "S"), H(2, 1, "E"))).toBe(false);
    expect(directRaysCross(V(0, 5, "S"), H(8, 1, "W"))).toBe(true);
    expect(directRaysCross(V(0, 5, "S"), H(2, 1, "W"))).toBe(false);
  });

  it("대칭이다 — 어느 쪽을 먼저 물어도 같은 답", () => {
    const pairs: [DirectRay, DirectRay][] = [
      [V(3, 5, "N"), H(2, 1, "E")],
      [V(3, 5, "N"), H(8, 1, "E")],
      [V(0, 5, "S"), H(8, 1, "W")],
    ];
    for (const [a, b] of pairs) expect(directRaysCross(a, b)).toBe(directRaysCross(b, a));
  });
});

describe("directRaysCross — 같은 축", () => {
  it("같은 열 · **같은 방향**이면 반드시 겹친다 — 뒤에 온 쪽이 앞의 것을 부분집합으로 밟는다", () => {
    expect(directRaysCross(V(3, 5, "N"), V(3, 2, "N"))).toBe(true);
    expect(directRaysCross(V(3, 2, "N"), V(3, 5, "N"))).toBe(true);
    expect(directRaysCross(V(3, 5, "S"), V(3, 9, "S"))).toBe(true);
  });

  it("같은 열 · **마주 보고** 뻗으면 사이가 겹칠 때만 — 등지면 안 겹친다", () => {
    // N 은 y ≤ 5, S 는 y ≥ 2 → [2,5] 가 겹친다.
    expect(directRaysCross(V(3, 5, "N"), V(3, 2, "S"))).toBe(true);
    // **등지고 뻗는다**: N 은 y ≤ 2, S 는 y ≥ 5 → 겹치는 곳이 없다.
    // 축만 보는 판정이 여기서 틀린다.
    expect(directRaysCross(V(3, 2, "N"), V(3, 5, "S"))).toBe(false);
  });

  it("열이 다르면 세로끼리는 못 만난다", () => {
    expect(directRaysCross(V(3, 5, "N"), V(4, 5, "N"))).toBe(false);
  });

  it("가로끼리도 같은 규칙 — 행이 같고, 등지면 안 겹친다", () => {
    expect(directRaysCross(H(2, 1, "E"), H(2, 6, "E"))).toBe(true);
    expect(directRaysCross(H(2, 1, "E"), H(2, 6, "W"))).toBe(true); // 마주 봄
    expect(directRaysCross(H(2, 6, "E"), H(2, 1, "W"))).toBe(false); // 등짐
    expect(directRaysCross(H(2, 1, "E"), H(3, 6, "W"))).toBe(false); // 행이 다름
  });
});

describe("directRaysCross — 깊이", () => {
  it("깊이가 다르면 어떤 조합도 안 만난다 — 비교는 언제나 한 열 안이다", () => {
    expect(directRaysCross(V(3, 5, "N", 1), H(2, 1, "E", 2))).toBe(false);
    expect(directRaysCross(V(3, 5, "N", 1), V(3, 5, "N", 0))).toBe(false);
  });
});

describe("crossCellKey — 계측 열쇠", () => {
  it("직교면 만나는 칸이 하나다 — (세로의 열, 가로의 행)", () => {
    expect(crossCellKey(V(3, 5, "N"), H(2, 1, "E"))).toBe("1:3,2");
  });

  it("같은 축이면 **내 상자에서 가장 먼저 밟는 칸**이 대표다", () => {
    // 위로 가는 두 세로: 겹치는 곳은 y ≤ 2. 행 5 에서 올라가면 처음 밟는 것은 y=2.
    expect(crossCellKey(V(3, 5, "N"), V(3, 2, "N"))).toBe("1:3,2");
    // 반대로 물으면 행 2 에서 올라가는 쪽이라 자기 출발 칸이 이미 겹친다.
    expect(crossCellKey(V(3, 2, "N"), V(3, 5, "N"))).toBe("1:3,2");
    // 아래로 갈 땐 하한이 대표다.
    expect(crossCellKey(V(3, 5, "S"), V(3, 9, "S"))).toBe("1:3,9");
  });

  it("가로끼리 — 열이 대표값이고 행은 그 선의 행이다", () => {
    expect(crossCellKey(H(2, 1, "E"), H(2, 6, "E"))).toBe("1:6,2");
  });
});
