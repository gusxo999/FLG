import { describe, it, expect } from "vitest";
import { routeShape, type ChannelEndpoint } from "./channel/shape";

// 채널 세로 범위 [0,9] · 가상 E벽 열 = capCol
const ctx = { yMin: 0, yMax: 9 };
const CAP = 8;

const wall = (row: number, w: "W" | "E"): ChannelEndpoint => ({ kind: "wall", row, wall: w });
const edge = (e: "N" | "S"): ChannelEndpoint => ({ kind: "edge", edge: e });

describe("routeShape — 납품과 반출은 같은 도형이다", () => {
  it("**반출(elbow) = 납품(계단꼴) − 마지막 가로 조각**", () => {
    // 같은 시작점·같은 트랙. 도착만 벽(납품) ↔ 변(반출)으로 바꾼다.
    const 납품 = routeShape(wall(2, "E"), wall(7, "W"), 3, ctx, CAP);
    const 반출 = routeShape(wall(2, "E"), edge("S"), 3, ctx, CAP);

    // 가로 진입은 **같다**.
    expect(반출.h[0]).toEqual(납품.h[0]);
    // 납품엔 가로 **진출**이 하나 더 있다. 반출은 세로가 채널을 그대로 빠져나간다.
    expect(납품.h).toHaveLength(2);
    expect(반출.h).toHaveLength(1);
    // 세로 주행은 둘 다 하나 — 끝나는 행만 다르다(도착 벽의 행 vs 변 바깥 한 칸).
    expect(납품.v).toEqual([{ col: 3, r1: 2, r2: 7 }]);
    expect(반출.v).toEqual([{ col: 3, r1: 2, r2: 10 }]); // yMax + 1
  });

  it("`edge` 끝점의 행은 **그 변 바깥 한 칸**이다 — N 은 위, S 는 아래", () => {
    expect(routeShape(wall(4, "W"), edge("N"), 1, ctx, CAP).v).toEqual([{ col: 1, r1: -1, r2: 4 }]);
    expect(routeShape(wall(4, "W"), edge("S"), 1, ctx, CAP).v).toEqual([{ col: 1, r1: 4, r2: 10 }]);
  });

  it("진입 벽이 가로 조각의 **끝**을 정한다 — W벽은 −1, E벽은 capCol", () => {
    expect(routeShape(wall(5, "W"), edge("N"), 2, ctx, CAP).h).toEqual([{ row: 5, c1: -1, c2: 2 }]);
    expect(routeShape(wall(5, "E"), edge("N"), 2, ctx, CAP).h).toEqual([{ row: 5, c1: 2, c2: CAP }]);
  });

  it("**양 끝이 벽이고 행이 같으면 트랙을 안 먹는다** — 세로가 길이 0이라 접는다", () => {
    const s = routeShape(wall(4, "E"), wall(4, "W"), 3, ctx, CAP);
    expect(s.v).toEqual([]); // ← 세로 조각을 남기면 trackCount 가 그 열을 세어 폭이 는다
    expect(s.h).toEqual([{ row: 4, c1: -1, c2: CAP }]); // 채널 전 열을 그 행에서 가로지른다
  });

  it("한쪽이 `edge` 면 행이 같아도 **접지 않는다** — 세로가 밖으로 나가야 한다", () => {
    // 도착이 변이면 도착 행이 −1/10 이라 애초에 같아질 수 없지만, 규칙이 벽에만 걸린다는 것을 못 박는다.
    const s = routeShape(wall(-1, "E"), edge("N"), 3, ctx, CAP);
    expect(s.v).toEqual([{ col: 3, r1: -1, r2: -1 }]);
    expect(s.h).toHaveLength(1);
  });
});
