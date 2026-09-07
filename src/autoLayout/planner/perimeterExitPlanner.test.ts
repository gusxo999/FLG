import { describe, it, expect } from "vitest";
import { planPerimeterExits, type ExitContext, type ExitPortInput } from "./perimeterExitPlanner";
import type { PortFace } from "../containerModel";

/** 기본 픽스처: 모듈 몸통이 사방으로 뚫려 있다고 본다(옛 규칙 그대로 재현되는 조건). */
const ALL: PortFace[] = ["N", "S", "W", "E"];
const p = (
  x: Omit<ExitPortInput, "wayOuts"> & { wayOuts?: PortFace[] },
): ExitPortInput => ({ ...x, wayOuts: x.wayOuts ?? ALL });

// 3 열(depth 0..2), 각 열 모듈 1개, 세로 밴드 [0,9].
const ctx3 = (): ExitContext => ({
  globalY: { min: 0, max: 9 },
  maxDepth: 2,
  spansByDepth: new Map([
    [0, [{ id: "d0", top: 0, bottom: 9 }]],
    [1, [{ id: "d1", top: 0, bottom: 9 }]],
    [2, [{ id: "d2", top: 0, bottom: 9 }]],
  ]),
});

describe("planPerimeterExits", () => {
  it("N/S 변 포트 = 자기 열 직진(self), 채널 소비 0, N/S 마진 예약", () => {
    const ports: ExitPortInput[] = [
      p({ id: "a", role: "input", depth: 1, side: "N", anchorY: 0 }),
      p({ id: "b", role: "output", depth: 1, side: "S", anchorY: 9 }),
    ];
    const plan = planPerimeterExits(ports, ctx3());
    // 세로 **직진** — 축은 `exitEdge` 가 말한다(옛 `self`).
    expect(plan.assignments.map((x) => x.exitMode.kind)).toEqual(["direct", "direct"]);
    expect(plan.assignments.map((x) => x.exitEdge)).toEqual(["N", "S"]);
    // 직진은 채널을 안 먹는다.
    expect(plan.assignments.every((x) => x.entry === undefined)).toBe(true);
    expect(plan.marginNeeds).toEqual({ N: true, S: true, W: false, E: false });
  });

  it("W 변 최좌 열 = 가로 직진으로 W 마진, E 변 최우 열 = E 마진", () => {
    const ports: ExitPortInput[] = [
      p({ id: "w", role: "input", depth: 0, side: "W", anchorY: 4 }),
      p({ id: "e", role: "output", depth: 2, side: "E", anchorY: 4 }),
    ];
    const plan = planPerimeterExits(ports, ctx3());
    const byId = new Map(plan.assignments.map((a) => [a.id, a]));
    // 가로 **직진**(옛 `margin`). 어느 변인지는 `exitEdge` 하나가 답한다 —
    // 옛 `margin.edge` 는 언제나 이 값과 같아서 아무것도 더 가르지 않았다.
    expect(byId.get("w")!.exitMode).toEqual({ kind: "direct" });
    expect(byId.get("w")!.exitEdge).toBe("W");
    expect(byId.get("e")!.exitMode).toEqual({ kind: "direct" });
    expect(byId.get("e")!.exitEdge).toBe("E");
    expect(plan.marginNeeds).toEqual({ N: false, S: false, W: true, E: true });
    expect(plan.assignments.every((x) => x.entry === undefined)).toBe(true);
  });

  it("내부 열 W/E 변 = 인접 채널로 **환승**, 가까운 N/S 로 나간다", () => {
    const ports: ExitPortInput[] = [
      p({ id: "w", role: "input", depth: 1, side: "W", anchorY: 2 }), // 왼쪽 채널(depth 1), N 가까움
      p({ id: "e", role: "output", depth: 1, side: "E", anchorY: 7 }), // 오른쪽 채널(depth 2), S 가까움
    ];
    const plan = planPerimeterExits(ports, ctx3());
    const byId = new Map(plan.assignments.map((a) => [a.id, a]));
    expect(byId.get("w")!.exitMode).toEqual({ kind: "channel", depth: 1 });
    expect(byId.get("w")!.exitEdge).toBe("N"); // 가까운 변
    // 진입점 = 상자의 행 + **반대쪽 벽**(W 로 나가면 그 채널의 E 벽으로 들어온다).
    expect(byId.get("w")!.entry).toEqual({ y: 2, wall: "E" });
    expect(byId.get("e")!.exitMode).toEqual({ kind: "channel", depth: 2 });
    expect(byId.get("e")!.exitEdge).toBe("S");
    expect(byId.get("e")!.entry).toEqual({ y: 7, wall: "W" });
  });

  it("자기 열 위 형제에 막힌 N 변 = 인접 채널로 우회", () => {
    const ctx: ExitContext = {
      globalY: { min: 0, max: 12 },
      maxDepth: 1,
      spansByDepth: new Map([
        [0, [{ id: "root", top: 3, bottom: 9 }]],
        // depth 1 두 형제 세로 적층: sib0 위, sib1 아래.
        [1, [
          { id: "sib0", top: 0, bottom: 5 },
          { id: "sib1", top: 6, bottom: 12 },
        ]],
      ]),
    };
    // sib1(아래) 의 N 변 포트 → 위로 직진하면 sib0 에 막힘 → 채널 우회.
    const ports: ExitPortInput[] = [p({ id: "p", role: "output", depth: 1, side: "N", anchorY: 6 })];
    const plan = planPerimeterExits(ports, ctx);
    expect(plan.assignments[0].exitMode).toEqual({ kind: "channel", depth: 1 });
    // sib0(위) 의 N 변 포트 → 막힘 없음 → 직진.
    const top: ExitPortInput[] = [p({ id: "q", role: "output", depth: 1, side: "N", anchorY: 0 })];
    const topAsg = planPerimeterExits(top, ctx).assignments[0];
    expect(topAsg.exitMode).toEqual({ kind: "direct" });
    expect(topAsg.exitEdge).toBe("N");
  });

  it("같은 채널로 나가는 반출 둘은 **둘 다** 그 채널의 신고자가 된다", () => {
    // 폭은 여기서 안 정해진다 — 통합 장부([channelGeometryPlanner])가 도형을 배정하고
    // 그 결과(트랙 수)에서 폭이 나온다(폭 역전). 이 배정기가 답하는 것은 *"누가 어느
    // 채널로 가나"* 까지다. 옛 판은 여기서 세로 구간을 모아 폭을 셌는데, 그 계산은
    // 2026-09-08 에 사라졌다(off 모드 제거).
    const ports: ExitPortInput[] = [
      p({ id: "a", role: "input", depth: 1, side: "W", anchorY: 1 }),
      p({ id: "b", role: "input", depth: 1, side: "W", anchorY: 3 }),
    ];
    const plan = planPerimeterExits(ports, ctx3());
    expect(plan.assignments.map((x) => x.exitMode)).toEqual([
      { kind: "channel", depth: 1 },
      { kind: "channel", depth: 1 },
    ]);
    expect(plan.assignments.map((x) => x.entry!.y)).toEqual([1, 3]);
  });

  it("결정적 — id 순 안정", () => {
    const ports: ExitPortInput[] = [
      p({ id: "z", role: "input", depth: 1, side: "W", anchorY: 2 }),
      p({ id: "a", role: "output", depth: 1, side: "E", anchorY: 7 }),
    ];
    const s = (ps: ExitPortInput[]) => JSON.stringify(planPerimeterExits(ps, ctx3()).assignments);
    expect(s(ports)).toBe(s([...ports].reverse()));
  });
});

describe("planPerimeterExits — moduleWayOuts 제약", () => {
  it("불변식: 확정된 출구의 모듈 진출 방향은 항상 wayOuts 안에 있다", () => {
    // 방향을 하나씩 막아 가며 전수 확인.
    for (const blocked of ["N", "S", "W", "E"] as PortFace[]) {
      const wayOuts = ALL.filter((d) => d !== blocked);
      for (const side of ["N", "S", "W", "E"] as const)
        for (const depth of [0, 1, 2])
          for (const anchorY of [1, 5, 8]) {
            const plan = planPerimeterExits(
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
    const plan = planPerimeterExits(
      [p({ id: "cc", role: "input", depth: 1, side: "E", anchorY: 8, wayOuts: ["S"] })],
      ctx3(),
    );
    const a = plan.assignments[0];
    expect(a.exitMode).toEqual({ kind: "direct" });
    expect(a.exitEdge).toBe("S");
    // 후보가 전부 직진이다 = 채널을 하나도 안 먹는다 = 폭 낭비 0.
    expect(a.options.every((o) => !o.usesChannelTrack)).toBe(true);
  });

  it("E 가 뚫려 있으면 옛 규칙대로 채널 우회 (회귀 없음)", () => {
    const plan = planPerimeterExits(
      [p({ id: "cc", role: "input", depth: 1, side: "E", anchorY: 8 })],
      ctx3(),
    );
    expect(plan.assignments[0].exitMode).toEqual({ kind: "channel", depth: 2 });
  });

  it("나갈 길이 없으면 배정 자체를 안 만든다 (예약 0 · 계획된 skip)", () => {
    // depth 1(양쪽 다 채널) 인데 사방이 다 막힌 상자.
    const plan = planPerimeterExits(
      [p({ id: "dead", role: "input", depth: 1, side: "E", anchorY: 5, wayOuts: [] })],
      ctx3(),
    );
    expect(plan.assignments).toHaveLength(0);
    expect(plan.marginNeeds).toEqual({ N: false, S: false, W: false, E: false });
  });

  it("확정은 하나다 — 후보가 여럿이어도 장부에 가는 것은 `options[0]` 뿐", () => {
    // 사방 뚫린 내부 열 W 변 상자 — 후보는 여럿(직진·환승 섞여)이지만 **확정은 하나**다.
    // 안 쓸 후보를 위해 채널을 넓히던 옛 낭비가 여기서 사라졌다.
    const plan = planPerimeterExits(
      [p({ id: "w", role: "input", depth: 1, side: "W", anchorY: 2 })],
      ctx3(),
    );
    const a = plan.assignments[0];
    expect(a.options.length).toBeGreaterThan(1); // 자유도가 남아 있다(양보 가능)
    // 평평한 확정 필드는 `options[0]` 의 복사본이다 — 그 하나만 통합 장부에 간다.
    expect(a.exitMode).toEqual(a.options[0].exitMode);
    expect(a.exitEdge).toBe(a.options[0].exitEdge);
    expect(a.entry).toEqual(a.options[0].entry);
  });
});
