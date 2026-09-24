/**
 * **순서 규칙** — 트리의 모든 간선에서 단위를 모아 합류 쌍 → 부모 쪽 방문 수 → 오늘 순서로 세운다
 * (`byConstraint` · `seatInOrder`, 결정표 결-10). 범위가 요점이다 — 한 부모 벽에 오는 **서로 다른 간선**의 줄이 함께 선다.
 *
 * 사례: 부모 하나(머신 3대)에 자식 둘. DFS 앞 간선이 부모 머신 하나만 먹이는 짧은 줄, 뒤 간선이 세 대를 다 먹이는 관통 줄.
 * 오늘 순서면 짧은 줄의 옆 포트가 관통 줄이 앉을 깊이에 못을 박아 관통 줄이 못 앉는다. 순서 규칙이면 관통 줄이 먼저 앉는다.
 */
import { describe, it, expect } from "vitest";
import { byConstraint, edgeResult, edgeUnits, openEdge, seatInOrder, seatLinkEdge } from "./seat";
import { openFaceSeating } from "../../module/policy/seat";
import type { Link } from "../../module/types/line";
import type { ModuleInput } from "../../module/types/module";

const base = (count: number): ModuleInput => ({
  machine: { entityName: "assembling-machine-3", w: 3, h: 3 }, count, inserterEntityName: "inserter",
  lines: [],
  inserters: [
    { entityName: "inserter", reach: 1, throughput: 2.4 },
    { entityName: "long-handed-inserter", reach: 2, throughput: 1.2 },
  ],
  beltEntityName: "transport-belt",
});
/** 자식 머신 0 → 부모 머신들. 부모 쪽은 머신마다 팔 하나. */
const line = (id: string, item: string, parents: number[]): Link => ({
  id, item,
  from: new Map([[0, 1]]), to: new Map(parents.map((m) => [m, 1])),
  carries: parents.map((m) => ({ from: 0, to: m, rate: 0.5 })),
});

const scene = () => {
  const parent = openFaceSeating(base(3), 3);
  const short = { child: openFaceSeating(base(1), 1), groups: [line("c1→p:a#0", "a", [1])] };
  const through = { child: openFaceSeating(base(1), 1), groups: [line("c2→p:b#0", "b", [0, 1, 2])] };
  return { parent, short, through };
};

describe("순서 비교", () => {
  it("합류 쌍이 먼저, 그다음 부모 쪽 방문 수가 큰 것", () => {
    const u = (n: number, pair = false) => ({ lines: [line("x", "x", [...Array(n).keys()])], pair });
    expect(byConstraint(u(1, true), u(3))).toBeLessThan(0);
    expect(byConstraint(u(3), u(1))).toBeLessThan(0);
    expect(byConstraint(u(2), u(2))).toBe(0); // 같으면 부르는 쪽의 안정 정렬이 오늘 순서를 지킨다
  });
});

describe("부모 하나에 자식 둘 — 짧은 줄이 DFS 앞", () => {
  it("대조군 — 오늘 순서(간선마다 차례로)면 관통 줄이 짧은 줄의 못에 막혀 부모 쪽에 못 앉는다", () => {
    const { parent, short, through } = scene();
    const r1 = seatLinkEdge(short.child, parent, short.groups, { split: false });
    const r2 = seatLinkEdge(through.child, parent, through.groups, { split: false });
    expect(r1.toSeats[0]?.clusterBeltDepth).toBe(2);
    expect(r2.toSeats[0]).toBeUndefined();
    expect(r2.toWhy[0].some((w) => w.clusterBeltDepth === 3 && w.blockedRows?.includes(3))).toBe(true);
  });

  it("순서 규칙이면 관통 줄이 먼저 d2 에 앉고, 짧은 줄은 d3 으로 비켜 둘 다 앉는다 — 결과는 간선 순서로 읽는다", () => {
    const { parent, short, through } = scene();
    const e1 = openEdge(short.child, parent, short.groups, { split: false });
    const e2 = openEdge(through.child, parent, through.groups, { split: false });
    expect(edgeUnits(e1)).toHaveLength(1);
    seatInOrder([e1, e2]);
    const [r1, r2] = [edgeResult(e1), edgeResult(e2)];
    expect(r2.toSeats[0]?.clusterBeltDepth).toBe(2);
    expect(r2.toSeats[0]?.portEnd).toBe("N"); // 관통 — 기둥 끝 포트
    expect(r1.toSeats[0]?.clusterBeltDepth).toBe(3);
    expect(r1.groups.map((g) => g.item)).toEqual(["a"]);
    expect(r2.groups.map((g) => g.item)).toEqual(["b"]);
  });
});
