import { describe, it, expect } from "vitest";
import { planPerimeterLanes, type LaneContext, type LanePortInput } from "./perimeterLanePlanner";
import { assignTracksLeftEdge } from "./channelPlanner";
import type { PortFace } from "../containerModel";

/** 기본 픽스처: 모듈 몸통이 사방으로 뚫려 있다고 본다(옛 규칙 그대로 재현되는 조건). */
const ALL: PortFace[] = ["N", "S", "W", "E"];
const p = (
  x: Omit<LanePortInput, "wayOuts"> & { wayOuts?: PortFace[] },
): LanePortInput => ({ ...x, wayOuts: x.wayOuts ?? ALL });

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
      p({ id: "a", role: "input", depth: 1, side: "N", anchorY: 0 }),
      p({ id: "b", role: "output", depth: 1, side: "S", anchorY: 9 }),
    ];
    const plan = planPerimeterLanes(ports, ctx3());
    expect(plan.assignments.map((x) => x.host.kind)).toEqual(["self", "self"]);
    expect(plan.channelLaneIntervals.size).toBe(0);
    expect(plan.marginNeeds).toEqual({ N: true, S: true, W: false, E: false });
  });

  it("W 변 최좌 열 = 바깥 W 마진, E 변 최우 열 = 바깥 E 마진", () => {
    const ports: LanePortInput[] = [
      p({ id: "w", role: "input", depth: 0, side: "W", anchorY: 4 }),
      p({ id: "e", role: "output", depth: 2, side: "E", anchorY: 4 }),
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
      p({ id: "w", role: "input", depth: 1, side: "W", anchorY: 2 }), // 왼쪽 채널(depth 1), N 가까움
      p({ id: "e", role: "output", depth: 1, side: "E", anchorY: 7 }), // 오른쪽 채널(depth 2), S 가까움
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
    const ports: LanePortInput[] = [p({ id: "p", role: "output", depth: 1, side: "N", anchorY: 6 })];
    const plan = planPerimeterLanes(ports, ctx);
    expect(plan.assignments[0].host).toEqual({ kind: "channel", depth: 1 });
    // sib0(위) 의 N 변 포트 → 막힘 없음 → self.
    const top: LanePortInput[] = [p({ id: "q", role: "output", depth: 1, side: "N", anchorY: 0 })];
    expect(planPerimeterLanes(top, ctx).assignments[0].host).toEqual({ kind: "self" });
  });

  it("같은 채널의 lane 구간은 홉 구간과 합쳐 트랙 산정 가능(겹치면 트랙↑)", () => {
    // 두 lane 이 같은 채널(depth 1) 로 겹치는 세로 구간 → 트랙 2.
    const ports: LanePortInput[] = [
      p({ id: "a", role: "input", depth: 1, side: "W", anchorY: 1 }), // N: [0,1]
      p({ id: "b", role: "input", depth: 1, side: "W", anchorY: 3 }), // N: [0,3] — a 와 겹침
    ];
    const plan = planPerimeterLanes(ports, ctx3());
    const laneIvs = plan.channelLaneIntervals.get(1)!;
    const hopIvs = [{ lo: 0, hi: 2 }]; // 가상 홉 구간
    const combined = assignTracksLeftEdge([...hopIvs, ...laneIvs]);
    expect(combined.trackCount).toBe(3); // 홉+2 lane 전부 [0,·] 겹침
  });

  it("결정적 — id 순 안정", () => {
    const ports: LanePortInput[] = [
      p({ id: "z", role: "input", depth: 1, side: "W", anchorY: 2 }),
      p({ id: "a", role: "output", depth: 1, side: "E", anchorY: 7 }),
    ];
    const s = (ps: LanePortInput[]) => JSON.stringify(planPerimeterLanes(ps, ctx3()).assignments);
    expect(s(ports)).toBe(s([...ports].reverse()));
  });
});

describe("planPerimeterLanes — moduleWayOuts 제약", () => {
  it("불변식: 확정된 출구의 모듈 진출 방향은 항상 wayOuts 안에 있다", () => {
    // 방향을 하나씩 막아 가며 전수 확인.
    for (const blocked of ["N", "S", "W", "E"] as PortFace[]) {
      const wayOuts = ALL.filter((d) => d !== blocked);
      for (const side of ["N", "S", "W", "E"] as const)
        for (const depth of [0, 1, 2])
          for (const anchorY of [1, 5, 8]) {
            const plan = planPerimeterLanes(
              [p({ id: "x", role: "input", depth, side, anchorY, wayOuts })],
              ctx3(),
            );
            for (const a of plan.assignments) {
              expect(wayOuts, `side=${side} depth=${depth} blocked=${blocked}`).toContain(
                a.options[0].wayOut,
              );
              for (const o of a.options) expect(wayOuts).toContain(o.wayOut);
            }
          }
    }
  });

  it("코너 어깨: side=E 인데 E 가 막힘 → 채널을 예약하지 않고 뚫린 쪽으로 나간다", () => {
    // copper-cable 사례의 축소판: 내부 열(depth 1)의 E 변 상자인데, 형제 트렁크가 E 를
    // 막아 wayOuts=[S]. 옛 코드는 오른쪽 채널(depth 2)을 예약해 폭만 낭비하고 방출은
    // 탐색 폴백에 떠넘겼다. 이제는 채널을 아예 안 잡고 S 로 나가야 한다.
    const plan = planPerimeterLanes(
      [p({ id: "cc", role: "input", depth: 1, side: "E", anchorY: 8, wayOuts: ["S"] })],
      ctx3(),
    );
    const a = plan.assignments[0];
    expect(a.host).toEqual({ kind: "self" });
    expect(a.exitEdge).toBe("S");
    expect(a.options.every((o) => !o.usesChannelTrack)).toBe(true);
    // 채널 트랙을 하나도 안 먹는다 = 폭 낭비 0.
    expect(plan.channelLaneIntervals.size).toBe(0);
  });

  it("E 가 뚫려 있으면 옛 규칙대로 채널 우회 (회귀 없음)", () => {
    const plan = planPerimeterLanes(
      [p({ id: "cc", role: "input", depth: 1, side: "E", anchorY: 8 })],
      ctx3(),
    );
    expect(plan.assignments[0].host).toEqual({ kind: "channel", depth: 2 });
    expect(plan.channelLaneIntervals.get(2)).toHaveLength(1);
  });

  it("나갈 길이 없으면 배정 자체를 안 만든다 (예약 0 · 계획된 skip)", () => {
    // depth 1(양쪽 다 채널) 인데 사방이 다 막힌 상자.
    const plan = planPerimeterLanes(
      [p({ id: "dead", role: "input", depth: 1, side: "E", anchorY: 5, wayOuts: [] })],
      ctx3(),
    );
    expect(plan.assignments).toHaveLength(0);
    expect(plan.channelLaneIntervals.size).toBe(0);
    expect(plan.marginNeeds).toEqual({ N: false, S: false, W: false, E: false });
  });

  it("폭은 확정된 출구 하나만 반영한다 (안 쓸 후보를 위해 채널을 넓히지 않는다)", () => {
    // 사방 뚫린 내부 열 W 변 상자 — 후보엔 채널·self·(끝열 아니라) margin 없음 여러 개가
    // 있지만, 채널 구간은 **확정된 하나**만 들어가야 한다.
    const plan = planPerimeterLanes(
      [p({ id: "w", role: "input", depth: 1, side: "W", anchorY: 2 })],
      ctx3(),
    );
    const a = plan.assignments[0];
    expect(a.options.length).toBeGreaterThan(1); // 자유도가 남아 있다(양보 가능)
    const channelIvs = [...plan.channelLaneIntervals.values()].flat();
    expect(channelIvs).toHaveLength(1); // 확정 하나만
  });
});
