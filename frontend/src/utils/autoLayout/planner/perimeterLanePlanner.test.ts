import { describe, it, expect } from "vitest";
import { planPerimeterLanes, type LaneContext, type LanePortInput } from "./perimeterLanePlanner";
import { assignTracksLeftEdge } from "./channelPlanner";

// 3 열(depth 0..2), 각 열 모듈 1개, 세로 밴드 [0,9].
const ctx3 = (): LaneContext => ({
  globalY: { min: 0, max: 9 },
  maxDepth: 2,
  bandsByDepth: new Map([
    [0, [{ id: "d0", top: 0, bottom: 9 }]],
    [1, [{ id: "d1", top: 0, bottom: 9 }]],
    [2, [{ id: "d2", top: 0, bottom: 9 }]],
  ]),
});

describe("planPerimeterLanes", () => {
  it("N/S 변 포트 = 자기 열 직진(self), 채널 소비 0, N/S 마진 예약", () => {
    const ports: LanePortInput[] = [
      { id: "a", role: "input", depth: 1, side: "N", anchorY: 0 },
      { id: "b", role: "output", depth: 1, side: "S", anchorY: 9 },
    ];
    const plan = planPerimeterLanes(ports, ctx3());
    expect(plan.assignments.map((x) => x.host.kind)).toEqual(["self", "self"]);
    expect(plan.channelLaneIntervals.size).toBe(0);
    expect(plan.marginNeeds).toEqual({ N: true, S: true, W: false, E: false });
  });

  it("W 변 최좌 열 = 바깥 W 마진, E 변 최우 열 = 바깥 E 마진", () => {
    const ports: LanePortInput[] = [
      { id: "w", role: "input", depth: 0, side: "W", anchorY: 4 },
      { id: "e", role: "output", depth: 2, side: "E", anchorY: 4 },
    ];
    const plan = planPerimeterLanes(ports, ctx3());
    const byId = new Map(plan.assignments.map((a) => [a.id, a]));
    expect(byId.get("w")!.host).toEqual({ kind: "margin", edge: "W" });
    expect(byId.get("e")!.host).toEqual({ kind: "margin", edge: "E" });
    expect(plan.marginNeeds).toEqual({ N: false, S: false, W: true, E: true });
    expect(plan.channelLaneIntervals.size).toBe(0);
  });

  it("내부 열 W/E 변 = 인접 채널로 우회, 가까운 N/S 로 세로 구간 생성", () => {
    const ports: LanePortInput[] = [
      { id: "w", role: "input", depth: 1, side: "W", anchorY: 2 }, // 왼쪽 채널(depth 1), N 가까움
      { id: "e", role: "output", depth: 1, side: "E", anchorY: 7 }, // 오른쪽 채널(depth 2), S 가까움
    ];
    const plan = planPerimeterLanes(ports, ctx3());
    const byId = new Map(plan.assignments.map((a) => [a.id, a]));
    expect(byId.get("w")!.host).toEqual({ kind: "channel", depth: 1 });
    expect(byId.get("w")!.exitEdge).toBe("N");
    expect(byId.get("w")!.interval).toEqual({ lo: 0, hi: 2 }); // [min y..anchor]
    expect(byId.get("e")!.host).toEqual({ kind: "channel", depth: 2 });
    expect(byId.get("e")!.exitEdge).toBe("S");
    expect(byId.get("e")!.interval).toEqual({ lo: 7, hi: 9 }); // [anchor..max y]
    expect(plan.channelLaneIntervals.get(1)).toHaveLength(1);
    expect(plan.channelLaneIntervals.get(2)).toHaveLength(1);
  });

  it("자기 열 위 형제에 막힌 N 변 = 인접 채널로 우회", () => {
    const ctx: LaneContext = {
      globalY: { min: 0, max: 12 },
      maxDepth: 1,
      bandsByDepth: new Map([
        [0, [{ id: "root", top: 3, bottom: 9 }]],
        // depth 1 두 형제 세로 적층: sib0 위, sib1 아래.
        [1, [
          { id: "sib0", top: 0, bottom: 5 },
          { id: "sib1", top: 6, bottom: 12 },
        ]],
      ]),
    };
    // sib1(아래) 의 N 변 포트 → 위로 직진하면 sib0 에 막힘 → 채널 우회.
    const ports: LanePortInput[] = [{ id: "p", role: "output", depth: 1, side: "N", anchorY: 6 }];
    const plan = planPerimeterLanes(ports, ctx);
    expect(plan.assignments[0].host).toEqual({ kind: "channel", depth: 1 });
    // sib0(위) 의 N 변 포트 → 막힘 없음 → self.
    const top: LanePortInput[] = [{ id: "q", role: "output", depth: 1, side: "N", anchorY: 0 }];
    expect(planPerimeterLanes(top, ctx).assignments[0].host).toEqual({ kind: "self" });
  });

  it("같은 채널의 lane 구간은 홉 구간과 합쳐 트랙 산정 가능(겹치면 트랙↑)", () => {
    // 두 lane 이 같은 채널(depth 1) 로 겹치는 세로 구간 → 트랙 2.
    const ports: LanePortInput[] = [
      { id: "a", role: "input", depth: 1, side: "W", anchorY: 1 }, // N: [0,1]
      { id: "b", role: "input", depth: 1, side: "W", anchorY: 3 }, // N: [0,3] — a 와 겹침
    ];
    const plan = planPerimeterLanes(ports, ctx3());
    const laneIvs = plan.channelLaneIntervals.get(1)!;
    const hopIvs = [{ lo: 0, hi: 2 }]; // 가상 홉 구간
    const combined = assignTracksLeftEdge([...hopIvs, ...laneIvs]);
    expect(combined.trackCount).toBe(3); // 홉+2 lane 전부 [0,·] 겹침
  });

  it("결정적 — id 순 안정", () => {
    const ports: LanePortInput[] = [
      { id: "z", role: "input", depth: 1, side: "W", anchorY: 2 },
      { id: "a", role: "output", depth: 1, side: "E", anchorY: 7 },
    ];
    const s = (p: LanePortInput[]) => JSON.stringify(planPerimeterLanes(p, ctx3()).assignments);
    expect(s(ports)).toBe(s([...ports].reverse()));
  });
});
