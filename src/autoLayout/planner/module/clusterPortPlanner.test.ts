import { describe, it, expect } from "vitest";
import { planClusterPorts, type IoLine } from "./clusterPortPlanner";
import type { SpecInserter } from "../../buildSpec";

// 고른 인서터 = reach 목록. 서로 다른 reach 하나당 ClusterBelt 한 줄(reach r → depth 1+r).
const insR = (reach: number, throughput = 0): SpecInserter => ({
  entityName: `i${reach}`,
  reach,
  throughput,
});
const longInserters = [insR(1), insR(2)]; // reach {1,2} → 면당 2벨트 = 4
const regularInserters = [insR(1)]; // reach {1} → 면당 1벨트 = 2
const noInserters: SpecInserter[] = [];

function item(name: string, role: "input" | "output"): IoLine {
  return { name, kind: "belt", role };
}
function fluid(name: string, role: "input" | "output"): IoLine {
  return { name, kind: "pipe", role };
}

describe("planClusterPorts — (B) 정책(출력 출력면 먼저, 입력 반대 면·넘침 잔여)", () => {
  it("빈 입력 → ok, 빈 배정", () => {
    const plan = planClusterPorts({ lines: [], inserters: longInserters, outputSide: "W" });
    expect(plan).toEqual({ ok: true, lines: [] });
  });

  // ── 파이프 면의 **아이템** 배치 — docs/auto-layout-wizard.trunk-pipe.md ──
  // 유체 **줄** 자체는 여기서 안 다룬다(2026-07-24, generateModule 이 맡는다 →
  // trunkPipe.test.ts "유체 관문"). 여기 남은 건 `pipeSide` 가 **아이템**을 어떻게 미느냐다.

  it("유체 줄이 들어오면 정직하게 거절 — 조용히 사라지면 그 머신이 굶는다", () => {
    const plan = planClusterPorts({
      lines: [item("iron", "input"), fluid("water", "input")],
      inserters: longInserters,
      outputSide: "W",
      pipeFaces: [{ side: "E" as const, fluidRows: 1, jumpable: false }],
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("fluid-handled-by-generateModule");
  });

  it("파이프 면의 아이템은 케이스 B(reach 2, d=4) 한 줄뿐", () => {
    // 화학 공장 꼴의 **아이템 쪽**: 파이프가 E 면 좌석을 먹은 상태(pipeSide)에서의 배치.
    const lines = [item("coal", "input"), item("plastic-bar", "output")];
    const plan = planClusterPorts({ lines, inserters: longInserters, outputSide: "W", pipeFaces: [{ side: "E" as const, fluidRows: 1, jumpable: false }] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const by = (n: string) => plan.lines.find((l) => l.line.name === n)!;

    // 아이템 입력은 입력면(E) — 다만 좌석(depth 1)이 파이프라 케이스 B(reach 2)로 밀린다.
    expect(by("coal")).toMatchObject({ side: "E", clusterBeltDepth: 4, reach: 2 });
    // 출력은 평소대로 출력면(W) 가까운 벨트.
    expect(by("plastic-bar")).toMatchObject({ side: "W", clusterBeltDepth: 2, reach: 1 });
  });

  it("파이프 면은 아이템 벨트가 하나뿐 — 둘째 아이템 입력은 출력면으로 밀린다", () => {
    const lines = [
      item("coal", "input"),
      item("iron-plate", "input"),
      item("thing", "output"),
    ];
    const plan = planClusterPorts({ lines, inserters: longInserters, outputSide: "W", pipeFaces: [{ side: "E" as const, fluidRows: 1, jumpable: false }] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const sides = plan.lines.map((l) => `${l.line.name}:${l.side}${l.clusterBeltDepth}`);
    // E 면 벨트는 케이스 B 하나뿐(reach 2) → coal 이 쓰고, iron-plate 는 W 잔여 벨트로.
    expect(sides).toEqual(["coal:E4", "iron-plate:W3", "thing:W2"]);
  });

  it("점프 가능하면 파이프 면 좌석이 살아난다 — reach 1 벨트가 그 면에 선다", () => {
    // isJumpableToClusterPipe: 파이프가 상자 칸 하나만 먹고 지하로 벨트를 넘어 ClusterPipe 로
    // 나간다 → 좌석 줄이 살아서 이 면은 일반 면과 같은 벨트 목록(케이스 B 아님).
    const lines = [item("coal", "input"), item("plastic-bar", "output")];
    const plan = planClusterPorts({
      lines,
      inserters: longInserters,
      outputSide: "W",
      pipeFaces: [{ side: "E" as const, fluidRows: 1, jumpable: true }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const by = (n: string) => plan.lines.find((l) => l.line.name === n)!;
    // 아이템 입력이 **가까운 벨트(d2, reach 1)** 로 — 케이스 B(d4, reach 2)가 아니다.
    expect(by("coal")).toMatchObject({ side: "E", clusterBeltDepth: 2, reach: 1 });
  });

  it("점프 가능 + reach {1}만: 유체 레시피가 케이스 B 없이 성립한다", () => {
    // 케이스 B 는 reach≥2 전용이라, 긴팔이 없으면 점프 없인 이 레시피가 complex 로 떨어졌다.
    const lines = [item("a", "input"), item("b", "output")];
    const plan = planClusterPorts({
      lines,
      inserters: regularInserters,
      outputSide: "W",
      pipeFaces: [{ side: "E" as const, fluidRows: 1, jumpable: true }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const by = (n: string) => plan.lines.find((l) => l.line.name === n)!;
    expect(by("a")).toMatchObject({ side: "E", clusterBeltDepth: 2, reach: 1 });
    expect(by("b")).toMatchObject({ side: "W", clusterBeltDepth: 2, reach: 1 });
  });

  it("reach≥2 인서터가 없으면 파이프 면에 아이템을 못 놓는다 — 케이스 B 는 긴팔 전용", () => {
    // reach 1 인서터는 좌석(depth 1)에 앉아야 하는데 그 자리가 파이프다.
    const lines = [item("a", "input"), item("b", "input"), item("c", "output")];
    const plan = planClusterPorts({ lines, inserters: regularInserters, outputSide: "W", pipeFaces: [{ side: "E" as const, fluidRows: 1, jumpable: false }] });
    // W 면 벨트 1개(reach 1) 뿐 → 아이템 3줄을 못 담는다.
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/^lanes-exceed-capacity/);
  });

  it("reach {1,2} → 출력=W(near→far), 입력=E(near→far)", () => {
    const lines = [
      item("a", "input"),
      item("b", "input"),
      item("c", "output"),
      item("d", "output"),
    ];
    const plan = planClusterPorts({ lines, inserters: longInserters, outputSide: "W" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lines).toHaveLength(4);
    // 등장 순서 [a-in, b-in, c-out, d-out]:
    //  출력(c,d) → W near(2)/far(3), 입력(a,b) → E near(2)/far(3).
    expect(plan.lines.map((l) => l.side)).toEqual(["E", "E", "W", "W"]);
    expect(plan.lines.map((l) => l.clusterBeltDepth)).toEqual([2, 3, 2, 3]);
    expect(plan.lines.map((l) => l.reach)).toEqual([1, 2, 1, 2]);
  });

  it("(B) 출력은 항상 출력면 확보 — 입력 3개는 E 채우고 넘치면 W 잔여로", () => {
    const lines = [
      item("out", "output"),
      item("i1", "input"),
      item("i2", "input"),
      item("i3", "input"),
    ];
    const plan = planClusterPorts({ lines, inserters: longInserters, outputSide: "W" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const byName = new Map(plan.lines.map((l) => [l.line.name, l]));
    expect(byName.get("out")!.side).toBe("W"); // 출력 W 보장
    expect(byName.get("i1")!.side).toBe("E");
    expect(byName.get("i2")!.side).toBe("E");
    expect(byName.get("i3")!.side).toBe("W"); // E(2칸) 초과 → W 잔여로 흘림
  });

  it("reach {1,2} → 5 belt 는 용량(4) 초과 → complex", () => {
    const lines = Array.from({ length: 5 }, (_, i) => item(`x${i}`, "input"));
    const plan = planClusterPorts({ lines, inserters: longInserters, outputSide: "W" });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/^lanes-exceed-capacity/);
  });

  it("reach {1} → 면당 1벨트(2칸): 출력=W, 입력=E", () => {
    const ok = planClusterPorts({
      lines: [item("a", "input"), item("b", "output")],
      inserters: regularInserters,
      outputSide: "W",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.lines.map((l) => l.side)).toEqual(["E", "W"]); // a-in→E, b-out→W
      expect(ok.lines.map((l) => l.clusterBeltDepth)).toEqual([2, 2]);
      expect(ok.lines.every((l) => l.reach === 1)).toBe(true);
    }
    const over = planClusterPorts({
      lines: [item("a", "input"), item("b", "input"), item("c", "output")],
      inserters: regularInserters,
      outputSide: "W",
    });
    expect(over.ok).toBe(false); // 총 3 > 용량 2
  });

  it("인서터 없음 + 아이템 필요 → complex", () => {
    const plan = planClusterPorts({
      lines: [item("a", "input")],
      inserters: noInserters,
      outputSide: "W",
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("no-inserter");
  });

  it("결과는 등장 순서를 보존한다", () => {
    const lines = [item("out1", "output"), item("in1", "input"), item("in2", "input")];
    const plan = planClusterPorts({ lines, inserters: longInserters, outputSide: "W" });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.lines.map((l) => l.line.name)).toEqual(["out1", "in1", "in2"]);
    }
  });

  it("(piece 3) clusterBeltDepth=운반량순 — 고수요 라인이 고용량 슬롯(머신 가까이)에", () => {
    const lines: IoLine[] = [
      { name: "lo", kind: "belt", role: "input", amount: 1 },
      { name: "hi", kind: "belt", role: "input", amount: 10 },
    ];
    // reach 1 이 throughput 30 > reach 2 의 8.
    // 팔 개수를 물을 수 있어야 슬롯을 고를 수 있다 — [insertingPlanner] 가 실제로 넘기는 것과
    // 같은 모양의 함수를 준다(`⌈수요 ÷ 그 reach 의 처리량⌉`).
    const tp = new Map([[1, 30], [2, 8]]);
    const plan = planClusterPorts({
      lines,
      inserters: [insR(1, 30), insR(2, 8)],
      outputSide: "W",
      armsAtReach: (l, _i, reach) => Math.ceil((l.amount ?? 1) / tp.get(reach)!),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const byName = new Map(plan.lines.map((l) => [l.line.name, l]));
    // 둘 다 입력 → E 면. reach1(30) > reach2(8) 이므로 고수요(hi) → reach1/depth2, 저수요(lo) → reach2/depth3.
    expect(byName.get("hi")!.clusterBeltDepth).toBe(2);
    expect(byName.get("hi")!.reach).toBe(1);
    expect(byName.get("lo")!.clusterBeltDepth).toBe(3);
    expect(byName.get("lo")!.reach).toBe(2);
  });

  it("(piece 3) reach 순서 가정 안 함 — reach 2 의 throughput 이 크면 고수요가 far(reach 2)로", () => {
    const lines: IoLine[] = [
      { name: "hi", kind: "belt", role: "input", amount: 10 },
      { name: "lo", kind: "belt", role: "input", amount: 1 },
    ];
    const tp = new Map([[1, 5], [2, 40]]);
    const plan = planClusterPorts({
      lines,
      inserters: [insR(1, 5), insR(2, 40)],
      outputSide: "W",
      armsAtReach: (l, _i, reach) => Math.ceil((l.amount ?? 1) / tp.get(reach)!),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const byName = new Map(plan.lines.map((l) => [l.line.name, l]));
    expect(byName.get("hi")!.reach).toBe(2); // reach2 가 고용량 → 고수요가 reach2(far)
    expect(byName.get("lo")!.reach).toBe(1);
  });

  it("슬롯 합계가 columnTapCapacity 와 일치(reach {1,2}=4, {1}=2)", () => {
    const fourOk = planClusterPorts({
      lines: Array.from({ length: 4 }, (_, i) => item(`x${i}`, "input")),
      inserters: longInserters,
      outputSide: "W",
    });
    expect(fourOk.ok).toBe(true);
    const twoOk = planClusterPorts({
      lines: Array.from({ length: 2 }, (_, i) => item(`x${i}`, "input")),
      inserters: regularInserters,
      outputSide: "W",
    });
    expect(twoOk.ok).toBe(true);
  });
});

describe("planClusterPorts — 노출 N/S 완화 (E → N/S → W)", () => {
  const ext = (name: string): IoLine => ({ name, kind: "belt", role: "input", external: true });

  it("external 3번째 입력은 W-spill 대신 노출 N 벨트로", () => {
    const lines = [item("out", "output"), ext("i1"), ext("i2"), ext("i3")];
    const plan = planClusterPorts({ lines, inserters: longInserters, outputSide: "W", nsFaces: ["N"] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const byName = new Map(plan.lines.map((l) => [l.line.name, l]));
    expect(byName.get("out")!.side).toBe("W");
    expect(byName.get("i1")!.side).toBe("E");
    expect(byName.get("i2")!.side).toBe("E");
    expect(byName.get("i3")!.side).toBe("N"); // W 잔여 대신 노출 N (near 벨트부터)
    expect(byName.get("i3")!.clusterBeltDepth).toBe(2);
    expect(byName.get("i3")!.reach).toBe(1);
  });

  it("내부(external 아님) 입력이 자식 쪽 면(E)을 먼저 갖고, external 이 밀려난다", () => {
    const lines = [item("out", "output"), ext("i1"), ext("i2"), item("delivery", "input")];
    const plan = planClusterPorts({ lines, inserters: longInserters, outputSide: "W", nsFaces: ["N"] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const byName = new Map(plan.lines.map((l) => [l.line.name, l]));

    // 자식-공급(납품 경로) 입력은 **자식 쪽 면(E)** 을 갖는다. 등장 순서상 마지막이지만 먼저 배정된다.
    // 이게 밀려나 출력면(W)에 태어나면 그 납품 경로가 모듈을 빙 돌아와 다른 포트의 탈출로를 끊는다
    // (2026-07-12 실측: 반출 skip 3건의 원인).
    expect(byName.get("delivery")!.side).toBe("E");

    // 납품 경로 기하 불변: 자식-공급 입력은 **절대 N/S 에 앉지 않는다**(납품 경로는 W/E 축으로만 오간다).
    expect(["W", "E"]).toContain(byName.get("delivery")!.side);

    // 밀려나는 건 external 쪽 — 납품 경로가 없어 perimeter 로 나가면 그만이라 안전하다.
    expect(["N", "W"]).toContain(byName.get("i2")!.side);
  });

  it("nsFaces 미지정 → 기존 동작(external 이어도 W 잔여)", () => {
    const lines = [item("out", "output"), ext("i1"), ext("i2"), ext("i3")];
    const plan = planClusterPorts({ lines, inserters: longInserters, outputSide: "W" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lines.find((l) => l.line.name === "i3")!.side).toBe("W");
  });

  it("N/S 는 용량 게이트에 안 들어간다 — 5 belt 는 nsFaces 있어도 complex", () => {
    const lines = Array.from({ length: 5 }, (_, i) => ext(`x${i}`));
    const plan = planClusterPorts({ lines, inserters: longInserters, outputSide: "W", nsFaces: ["N", "S"] });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/^lanes-exceed-capacity/);
  });

  it("N 소진 후 다음 노출 면(S) 소비, 그다음에야 W", () => {
    // 출력이 W2 를 점유. external 입력 3개: E2, E3 다음 N2 (N 벨트 near 부터).
    // N 은 nsFaces=["N"] 하나뿐이지만 벨트가 2개(N2, N3)라 4번째 입력도 N3 로 간다.
    const lines = [item("out", "output"), ext("i1"), ext("i2"), ext("i3")];
    const planNS = planClusterPorts({ lines, inserters: longInserters, outputSide: "W", nsFaces: ["N", "S"] });
    expect(planNS.ok).toBe(true);
    if (!planNS.ok) return;
    expect(planNS.lines.find((l) => l.line.name === "i3")!.side).toBe("N");
  });
});
