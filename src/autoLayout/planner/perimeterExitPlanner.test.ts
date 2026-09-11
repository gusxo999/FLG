import { describe, it, expect } from "vitest";
import { planPerimeterExits, type ExitContext, type ExitPortInput } from "./perimeterExitPlanner";
import type { PortFace } from "../containerModel";

/** 기본 픽스처: 모듈 몸통이 사방으로 뚫려 있다고 본다(옛 규칙 그대로 재현되는 조건). */
const ALL: PortFace[] = ["N", "S", "W", "E"];
const p = (
  x: Omit<ExitPortInput, "wayOuts" | "moduleId" | "localX">
    & { wayOuts?: PortFace[]; moduleId?: string; localX?: number },
): ExitPortInput => ({
  ...x,
  wayOuts: x.wayOuts ?? ALL,
  // 열마다 모듈 하나인 픽스처라 모듈 id 는 깊이에서 나온다.
  moduleId: x.moduleId ?? `d${x.depth}`,
  localX: x.localX ?? 0,
});

// 3 열(depth 0..2), 각 열 모듈 1개, 세로 밴드 [0,9].
const ctx3 = (): ExitContext => ({
  globalY: { min: 0, max: 9 },
  maxDepth: 2,
  grid: {
    orderByDepth: new Map([[0, ["d0"]], [1, ["d1"]], [2, ["d2"]]]),
    maxDepth: 2,
  },
  rowChannelReach: new Map(), // 행 채널 수요 없음 = 관통이 언제나 열려 있다
  // 열마다 모듈 하나뿐인 픽스처라 세로 광선이 남의 모듈을 만날 일이 없다.
  moduleBodyColumns: new Map(),
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

  it("자기 열 위 형제에 막힌 N 변 = 인접 채널로 환승", () => {
    // **순번이 막힘을 말한다** — 광선이 위로 훑다 남의 모듈을 만나면 그 방향은 끝.
    // 좌표(top/bottom)를 안 쓴다: 열 안의 순서가 곧 위아래 순서다(4a 누적합 + 4c 하한 복원).
    const ctx: ExitContext = {
      globalY: { min: 0, max: 12 },
      maxDepth: 1,
      grid: {
        orderByDepth: new Map([[0, ["root"]], [1, ["sib0", "sib1"]]]), // sib0 위, sib1 아래
        maxDepth: 1,
      },
      rowChannelReach: new Map(),
      // **요약이 없으면 막힌 것으로 친다** — 이 검사는 그 보수 갈래다.
      moduleBodyColumns: new Map(),
    };
    // sib1(아래) 의 N 변 포트 → 위로 쏘면 sib0 을 만난다 → 환승.
    const ports: ExitPortInput[] = [
      p({ id: "p", moduleId: "sib1", role: "output", depth: 1, side: "N", anchorY: 6 }),
    ];
    const plan = planPerimeterExits(ports, ctx);
    expect(plan.assignments[0].exitMode).toEqual({ kind: "channel", depth: 1 });
    // sib0(위) 의 N 변 포트 → 위엔 마진 행 채널과 바깥뿐 → 직진.
    const top: ExitPortInput[] = [
      p({ id: "q", moduleId: "sib0", role: "output", depth: 1, side: "N", anchorY: 0 }),
    ];
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

  it("**관통** — 세로 직진이 행 채널의 가로 트랙을 밟으면 직진이 아니다", () => {
    // 행 채널은 **가로줄**을 파는데 세로 직진은 세로로 지난다 → **살 게 없다.**
    // 남는 질문은 하나 — *"내가 설 그 한 열이 비었나?"* 가로 트랙은 전부
    // *상자 → 열의 서쪽 변(로컬 0)* 이라 구간이 `[0, x2]` 다.
    const ctx: ExitContext = {
      globalY: { min: 0, max: 9 },
      maxDepth: 2,
      grid: { orderByDepth: new Map([[0, ["d0"]], [1, ["d1"]], [2, ["d2"]]]), maxDepth: 2 },
      // d1 의 **북쪽** 행 채널을 지나는 납품이 로컬 x 0..5 를 덮는다.
      rowChannelReach: new Map([["1:below:d1", 5]]),
      moduleBodyColumns: new Map(),
    };
    const inside = planPerimeterExits(
      [p({ id: "in", role: "input", depth: 1, side: "N", anchorY: 0, localX: 3 })],
      ctx,
    ).assignments[0];
    expect(inside.exitMode).toEqual({ kind: "channel", depth: 1 }); // 밟는다 → 환승

    const outside = planPerimeterExits(
      [p({ id: "out", role: "input", depth: 1, side: "N", anchorY: 0, localX: 6 })],
      ctx,
    ).assignments[0];
    expect(outside.exitMode).toEqual({ kind: "direct" }); // 가로 트랙 **동쪽** — 안 밟는다
    expect(outside.exitEdge).toBe("N");
  });

  it("관통 검사는 **그 통로의 수요만** 본다 — 반대쪽 행 채널은 상관없다", () => {
    const ctx: ExitContext = {
      globalY: { min: 0, max: 9 },
      maxDepth: 2,
      grid: { orderByDepth: new Map([[0, ["d0"]], [1, ["d1"]], [2, ["d2"]]]), maxDepth: 2 },
      // **남쪽** 행 채널에만 수요가 있다.
      rowChannelReach: new Map([["1:above:d1", 9]]),
      moduleBodyColumns: new Map(),
    };
    const north = planPerimeterExits(
      [p({ id: "n", role: "input", depth: 1, side: "N", anchorY: 0, localX: 3 })],
      ctx,
    ).assignments[0];
    expect(north.exitMode).toEqual({ kind: "direct" }); // 북쪽은 비어 있다

    const south = planPerimeterExits(
      [p({ id: "s", role: "output", depth: 1, side: "S", anchorY: 9, localX: 3 })],
      ctx,
    ).assignments[0];
    expect(south.exitMode).toEqual({ kind: "channel", depth: 1 }); // 남쪽은 밟는다
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
    expect(a.options.every((o) => o.exitMode.kind === "direct")).toBe(true);
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
    expect(a.options.length).toBeGreaterThan(1); // 자유도가 남아 있다(강등 가능)
    // 평평한 확정 필드는 `options[0]` 의 복사본이다 — 그 하나만 통합 장부에 간다.
    expect(a.exitMode).toEqual(a.options[0].exitMode);
    expect(a.exitEdge).toBe(a.options[0].exitEdge);
    expect(a.entry).toEqual(a.options[0].entry);
  });
});

describe("직진 장부 — 자리를 안 사는 경로도 등록은 해야 한다", () => {
  /**
   * 끝 열(깊이 0)이라 가로 직진이 산다. 세로 직진과 **직교**하고 둘 다 자리를 안 사므로,
   * 장부가 없으면 서로를 못 본다 — 방출에서야 알고 그때는 남은 수가 포기뿐이다.
   *
   * ```
   *        ║  ← 세로 직진 (로컬 열 2, 행 8 에서 위로)
   *   ←────╫─────   ← 가로 직진 (행 5, 로컬 열 4 에서 서로).  칸 (2,5) 에서 만난다
   *        ║
   * ```
   */
  const endCol = (): ExitContext => ({
    globalY: { min: 0, max: 9 },
    maxDepth: 2,
    grid: { orderByDepth: new Map([[0, ["d0"]], [1, ["d1"]], [2, ["d2"]]]), maxDepth: 2 },
    rowChannelReach: new Map(),
    moduleBodyColumns: new Map(),
  });

  it("겹치는 직진 후보는 **만들지 않는다** — 뒤에 온 쪽이 환승으로 간다", () => {
    const plan = planPerimeterExits(
      [
        p({ id: "a", moduleId: "d0", role: "input", depth: 0, side: "W", anchorY: 5, localX: 4 }),
        p({ id: "b", moduleId: "d0", role: "output", depth: 0, side: "N", anchorY: 8, localX: 2 }),
      ],
      endCol(),
    );
    const byId = new Map(plan.assignments.map((x) => [x.id, x]));
    // 후보 수가 같아 `id` 로 갈린다 — a 가 먼저 W 로 선을 긋는다.
    expect(byId.get("a")!.exitMode).toEqual({ kind: "direct" });
    expect(byId.get("a")!.exitEdge).toBe("W");
    // b 의 N 직진은 그 선을 밟는다 → **후보가 안 만들어지고** 환승이 확정된다.
    // (옛 동작: 그대로 확정됐다가 방출에서 `straight blocked` → skip → 상자가 안 나간다.)
    expect(byId.get("b")!.exitMode).toEqual({ kind: "channel", depth: 1 });
  });

  it("낙선 기록 — 누가 어느 자리를 누구에게 뺏겼나", () => {
    const plan = planPerimeterExits(
      [
        p({ id: "a", moduleId: "d0", role: "input", depth: 0, side: "W", anchorY: 5, localX: 4 }),
        p({ id: "b", moduleId: "d0", role: "output", depth: 0, side: "N", anchorY: 8, localX: 2 }),
      ],
      endCol(),
    );
    expect(plan.demotions).toEqual([
      { id: "b", droppedEdge: "N", blockedBy: "a", cell: "0:2,5" },
    ]);
  });

  it("순회는 **후보가 적은 상자부터** — 강등할 데가 없는 쪽이 먼저 고른다", () => {
    // b 는 N 밖에 못 나간다(wayOuts) → 후보가 **하나**. a 는 다섯이다.
    // `id` 순이면 a 가 먼저 W 를 가져가고 b 는 갈 곳이 없어 방출에서 skip 된다.
    const plan = planPerimeterExits(
      [
        p({ id: "a", moduleId: "d0", role: "input", depth: 0, side: "W", anchorY: 5, localX: 4 }),
        p({ id: "b", moduleId: "d0", role: "output", depth: 0, side: "N", anchorY: 8, localX: 2, wayOuts: ["N"] }),
      ],
      endCol(),
    );
    const byId = new Map(plan.assignments.map((x) => [x.id, x]));
    expect(byId.get("b")!.options).toHaveLength(1); // 자유도 0 — 이 상자가 먼저다
    expect(byId.get("b")!.exitEdge).toBe("N"); // 그래서 자기 유일한 길을 지킨다
    // 밀린 쪽은 a 다 — W 를 잃고 다음 후보로 내려간다(N 직진, 열이 달라 안 겹친다).
    expect(byId.get("a")!.exitEdge).toBe("N");
    expect(plan.demotions.map((d) => [d.id, d.droppedEdge])).toEqual([["a", "W"]]);
  });

  it("**강등할 데가 없으면 오늘 그대로 둔다** — 배정을 없애지 않는다", () => {
    // 단일 열(maxDepth 0) — 열 채널이 **아예 없어** 모든 반출이 직진이다.
    // 게다가 둘 다 N 으로만 나갈 수 있어 후보가 하나씩뿐이다.
    const single: ExitContext = {
      globalY: { min: 0, max: 9 },
      maxDepth: 0,
      grid: { orderByDepth: new Map([[0, ["d0"]]]), maxDepth: 0 },
      rowChannelReach: new Map(),
      moduleBodyColumns: new Map(),
    };
    const plan = planPerimeterExits(
      [
        p({ id: "b", moduleId: "d0", role: "output", depth: 0, side: "N", anchorY: 8, localX: 2, wayOuts: ["N"] }),
        p({ id: "c", moduleId: "d0", role: "output", depth: 0, side: "N", anchorY: 3, localX: 2, wayOuts: ["N"] }),
      ],
      single,
    );
    // 같은 열 · 같은 방향이라 **반드시 겹친다** — 그런데 c 에겐 내려갈 후보가 없다.
    expect(plan.demotions.map((d) => d.id)).toEqual(["c"]);
    // 그래도 배정은 남는다. 여기서 지우면 **확정 skip** 이라 오늘보다 나쁘다.
    const c = plan.assignments.find((x) => x.id === "c")!;
    expect(c.exitMode).toEqual({ kind: "direct" });
    expect(c.exitEdge).toBe("N");
  });

  it("기전 — 겹치는 직진 쌍이 없으면 확정은 언제나 `options[0]` 이고 낙선도 0", () => {
    const plan = planPerimeterExits(
      [
        p({ id: "n", role: "input", depth: 1, side: "N", anchorY: 0, localX: 0 }),
        p({ id: "s", role: "output", depth: 1, side: "S", anchorY: 9, localX: 0 }),
        p({ id: "w", role: "input", depth: 0, side: "W", anchorY: 4, localX: 0 }),
        p({ id: "e", role: "output", depth: 2, side: "E", anchorY: 4, localX: 0 }),
      ],
      ctx3(),
    );
    expect(plan.demotions).toEqual([]);
    for (const a of plan.assignments) {
      expect(a.exitEdge).toBe(a.options[0].exitEdge);
      expect(a.exitMode).toEqual(a.options[0].exitMode);
    }
  });
});

describe("모듈 정밀 판정 — 블랙박스에게 「네 열이 비었나」를 묻는다", () => {
  /** 한 열에 형제 둘: sib0 위, sib1 아래. sib1 의 N 직진이 sib0 을 지나야 한다. */
  const siblings = (sib0Body: number[]): ExitContext => ({
    globalY: { min: 0, max: 12 },
    maxDepth: 1,
    grid: { orderByDepth: new Map([[0, ["root"]], [1, ["sib0", "sib1"]]]), maxDepth: 1 },
    rowChannelReach: new Map(),
    moduleBodyColumns: new Map([["sib0", new Set(sib0Body)], ["sib1", new Set(sib0Body)]]),
  });

  const upward = (localX: number) =>
    p({ id: "u", moduleId: "sib1", role: "output", depth: 1, side: "N", anchorY: 6, localX });

  it("몸통이 안 먹는 열이면 **지나간다** — 옛 판정은 여기서 무조건 막았다", () => {
    // sib0 의 몸통은 로컬 열 0~4 만 먹는다. 열 7 로 올라가는 직진은 뚫린 길이다.
    const a = planPerimeterExits([upward(7)], siblings([0, 1, 2, 3, 4])).assignments[0];
    expect(a.exitMode).toEqual({ kind: "direct" });
    expect(a.exitEdge).toBe("N");
  });

  it("몸통이 먹는 열이면 여전히 막힌다 — 협상 불가는 그대로다", () => {
    const a = planPerimeterExits([upward(3)], siblings([0, 1, 2, 3, 4])).assignments[0];
    expect(a.exitMode).toEqual({ kind: "channel", depth: 1 });
  });

  it("요약이 없으면 **막힌 것으로 친다** — 정확도를 잃을지언정 없는 자리를 뚫지 않는다", () => {
    const ctx = siblings([0, 1, 2, 3, 4]);
    const blind: ExitContext = { ...ctx, moduleBodyColumns: new Map() };
    expect(planPerimeterExits([upward(7)], blind).assignments[0].exitMode)
      .toEqual({ kind: "channel", depth: 1 });
  });

  /**
   * **2026-09-08 의 함정이 여기 있다.** 모듈 정밀 판정만 켰더니 `oneToOneGuarantee ②` 가
   * 6건 깨졌다 — 세로 직진이 남의 모듈의 빈 열을 뚫자, 그 칸을 비었다고 믿던 **가로 직진**이
   * 방출에서 막혔다(`straight blocked to E`). 둘 다 자리를 안 사서 서로를 못 봤다.
   *
   * 이제는 장부가 배정 시점에 잡는다 — 진 쪽의 대가가 **skip 에서 폭으로** 바뀐다.
   */
  it("뚫린 열로 나가려는 세로 직진이 **가로 직진과 만나면** 환승으로 내려간다", () => {
    const ctx = siblings([0, 1, 2, 3, 4]);
    const plan = planPerimeterExits(
      [
        // sib0 의 열 7 은 비어 있다 → sib1 의 N 직진이 새로 후보가 된다(정밀 판정).
        upward(7),
        // 그런데 sib0 의 상자가 그 위쪽 행에서 **동쪽으로** 직진한다. 끝 열이라 E 가 산다.
        // 나갈 길이 이것뿐이라(wayOuts) 후보가 하나 — **먼저 고른다.**
        p({ id: "h", moduleId: "sib0", role: "input", depth: 1, side: "E", anchorY: 2, localX: 5, wayOuts: ["E"] }),
      ],
      ctx,
    );
    const byId = new Map(plan.assignments.map((x) => [x.id, x]));
    expect(byId.get("h")!.exitMode).toEqual({ kind: "direct" }); // 가로 직진이 자리를 지킨다
    expect(byId.get("h")!.exitEdge).toBe("E");
    expect(byId.get("u")!.exitMode).toEqual({ kind: "channel", depth: 1 }); // 세로가 내려간다
    expect(plan.demotions.map((d) => [d.id, d.droppedEdge, d.blockedBy]))
      .toEqual([["u", "N", "h"]]);
  });
});

describe("막힌 상자 계측 — **강등이 못 세는 것**을 센다", () => {
  /**
   * 왜 별도 계측인가: 강등(`demotions`)은 *"직진이 막혔다"* 를 세지 *"갈 데가 없다"* 를
   * 안 센다. 그리고 후보가 0인 상자는 강등 루프에 **들어가기도 전에** 걸러지므로
   * (`cands` 필터) 강등 기록에 **원리적으로** 안 나온다. `tempPlanDocs/통로-갈아타기/` 의
   * 착수 조건이 바로 그 수라, 여기서 안 세면 아무 데도 안 남는다.
   */

  /** 한 열에 형제 둘(a 위, b 아래) — b 의 N 직진이 a 를 지나야 한다. `maxDepth` 로 끝 열 여부를 가른다. */
  const stack = (maxDepth: number): ExitContext => ({
    globalY: { min: 0, max: 12 },
    maxDepth,
    grid: {
      orderByDepth: new Map(
        [[0, ["d0"]], [1, ["a", "b"]], [2, ["d2"]]].slice(0, maxDepth + 1) as [number, string[]][],
      ),
      maxDepth,
    },
    rowChannelReach: new Map(),
    moduleBodyColumns: new Map(), // 요약 없음 = 막힌 것으로 친다
  });

  /** N 으로만 나갈 수 있는데 위 형제에 막힌 상자 — 후보가 하나도 안 선다. */
  const stuck = p({ id: "x", moduleId: "b", role: "output", depth: 1, side: "N", anchorY: 6, wayOuts: ["N"] });

  it("후보 0 — 배정이 없어 방출이 `no exit assignment` 로 skip 하는 자리", () => {
    const plan = planPerimeterExits([stuck], stack(2));
    expect(plan.assignments).toEqual([]); // 오늘 동작 그대로 — 예약 0, 계획된 skip
    expect(plan.demotions).toEqual([]); // **강등엔 안 나온다** — 이게 별도 계측의 이유다
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0].kind).toBe("noOption");
    expect(plan.blocked[0].canEnterRowChannel).toBe(true); // N 이 열려 있다 → 행 채널에 들어갈 수 있다
    // 왜 넷이 다 떨어졌나가 한 줄에 남는다 — 수만으로는 무엇을 지어야 하는지 못 묻는다.
    expect(plan.blocked[0].why).toContain("direct:N=요약없음(a)");
    expect(plan.blocked[0].why).toContain("channel:W=모듈몸통(wayOuts)");
  });

  it("**홉이 조각을 가른다** — 중간 깊이는 2홉, 끝 열은 1홉", () => {
    // 열이 셋이면 깊이 1 은 중간 → 행 채널을 타도 옆 열 채널에서 **갈아타야** 한다.
    expect(planPerimeterExits([stuck], stack(2)).blocked[0].hops).toBe(2);
    // 열이 둘이면 깊이 1 이 끝 열 → 그 행 채널의 동쪽이 바깥 마진이라 **1홉**이다.
    expect(planPerimeterExits([stuck], stack(1)).blocked[0].hops).toBe(1);
  });

  it("N/S 가 둘 다 막히면 행 채널로도 못 구한다 — 다른 계획의 몫", () => {
    const noWay = p({ id: "z", moduleId: "b", role: "output", depth: 1, side: "N", anchorY: 6, wayOuts: [] });
    const b = planPerimeterExits([noWay], stack(2)).blocked[0];
    expect(b.canEnterRowChannel).toBe(false);
    expect(b.hops).toBe(null);
  });

  it("강행 — 후보가 **전부** 강등돼 `options[0]` 으로 밀린 자리도 막힘이다", () => {
    // 단일 열(maxDepth 0): 채널이 없어 강등할 데가 없다. 같은 열·같은 방향이라 반드시 겹친다.
    const single: ExitContext = {
      globalY: { min: 0, max: 12 },
      maxDepth: 0,
      grid: { orderByDepth: new Map([[0, ["d0"]]]), maxDepth: 0 },
      rowChannelReach: new Map(),
      moduleBodyColumns: new Map(),
    };
    const plan = planPerimeterExits(
      [
        p({ id: "b", moduleId: "d0", role: "output", depth: 0, side: "N", anchorY: 8, localX: 2, wayOuts: ["N"] }),
        p({ id: "c", moduleId: "d0", role: "output", depth: 0, side: "N", anchorY: 3, localX: 2, wayOuts: ["N"] }),
      ],
      single,
    );
    // 배정은 남는다(오늘 동작 그대로) — 그런데 방출에서 `straight blocked` 로 막힌다.
    expect(plan.assignments.map((a) => a.id)).toEqual(["b", "c"]);
    expect(plan.blocked.map((x) => [x.id, x.kind, x.hops])).toEqual([["c", "forced", 1]]);
    expect(plan.blocked[0].why).toContain("강행=N");
  });

  it("기전 — 나갈 길을 받은 상자는 막힘에 안 실린다(빈 배열이 정상)", () => {
    const plan = planPerimeterExits(
      [
        p({ id: "n", role: "input", depth: 1, side: "N", anchorY: 0, localX: 0 }),
        p({ id: "w", role: "input", depth: 0, side: "W", anchorY: 4, localX: 0 }),
        p({ id: "e", role: "output", depth: 2, side: "E", anchorY: 4, localX: 0 }),
      ],
      ctx3(),
    );
    expect(plan.blocked).toEqual([]);
  });
});
