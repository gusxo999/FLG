import { describe, it, expect } from "vitest";
import {
  planClusterPorts,
  type IoLine,
  type PortPlannerCaps,
} from "./clusterPortPlanner";

const longCaps: PortPlannerCaps = { hasNormal: true, hasLong: true }; // 면당 2레인 = 4
const regularCaps: PortPlannerCaps = { hasNormal: true, hasLong: false }; // 면당 1레인 = 2
const noCaps: PortPlannerCaps = { hasNormal: false, hasLong: false };

function item(name: string, role: "input" | "output"): IoLine {
  return { name, kind: "belt", role };
}
function fluid(name: string, role: "input" | "output"): IoLine {
  return { name, kind: "pipe", role };
}

describe("planClusterPorts — (B) 정책(출력 출력면 먼저, 입력 반대 면·넘침 잔여)", () => {
  it("빈 입력 → ok, 빈 배정", () => {
    const plan = planClusterPorts({ lines: [], caps: longCaps, outputSide: "W" });
    expect(plan).toEqual({ ok: true, lines: [] });
  });

  // ── 트렁크 파이프(유체) — docs/auto-layout-wizard.trunk-pipe.md ──

  it("유체 줄인데 pipeSide 가 없으면 complex — 면은 우리가 못 고른다", () => {
    // 유체가 붙을 면은 머신 fluid_box 가 정한다. 호출자가 회전을 풀어 pipeSide 를 넘겨야
    // 한다 — 못 풀었으면 지어내지 않고 옛 경로로 위임한다.
    const plan = planClusterPorts({
      lines: [item("iron", "input"), fluid("water", "input")],
      caps: longCaps,
      outputSide: "W",
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("pipe-side-unresolved");
  });

  it("다이렉트 인서팅은 유체를 못 다룬다 — 인서터로 유체를 옮길 수 없다", () => {
    const plan = planClusterPorts({
      lines: [fluid("water", "input")],
      caps: longCaps,
      outputSide: "W",
      pipeSide: "E",
      slotsPerFace: { WE: 3, NS: 3 }, // 1:1(다이렉트) 모드
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("fluid-requires-trunk-pipe");
  });

  it("유체 = depth 1 · 인서터 없음. 그 면의 아이템은 케이스 B(긴팔 d=4) 한 줄뿐", () => {
    // 화학 공장 꼴: 유체 입력 1 + 아이템 입력 1 + 아이템 출력 1.
    const lines = [
      fluid("petroleum-gas", "input"),
      item("coal", "input"),
      item("plastic-bar", "output"),
    ];
    const plan = planClusterPorts({ lines, caps: longCaps, outputSide: "W", pipeSide: "E" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const by = (n: string) => plan.lines.find((l) => l.line.name === n)!;

    // 파이프: E 면(머신이 정함), depth 1(머신에 닿아야 한다), 인서터 없음.
    expect(by("petroleum-gas")).toMatchObject({ side: "E", depth: 1, inserter: undefined });
    // 아이템 입력도 입력면(E) — 다만 depth 1 이 파이프라 케이스 B 로 밀린다.
    expect(by("coal")).toMatchObject({ side: "E", depth: 4, inserter: "long" });
    // 출력은 평소대로 출력면(W) 가까운 레인.
    expect(by("plastic-bar")).toMatchObject({ side: "W", depth: 2, inserter: "normal" });
  });

  it("파이프 면은 아이템 레인이 하나뿐 — 둘째 아이템 입력은 출력면으로 밀린다", () => {
    const lines = [
      fluid("petroleum-gas", "input"),
      item("coal", "input"),
      item("iron-plate", "input"),
      item("thing", "output"),
    ];
    const plan = planClusterPorts({ lines, caps: longCaps, outputSide: "W", pipeSide: "E" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const sides = plan.lines.map((l) => `${l.line.name}:${l.side}${l.depth}`);
    // E 면 레인은 케이스 B 하나뿐 → coal 이 쓰고, iron-plate 는 W 잔여 레인으로.
    expect(sides).toEqual([
      "petroleum-gas:E1",
      "coal:E4",
      "iron-plate:W3",
      "thing:W2",
    ]);
  });

  it("긴팔이 없으면 파이프 면에 아이템을 못 놓는다 — 케이스 B 는 긴팔 전용", () => {
    // 일반 인서터는 depth 1 에 앉아야 하는데 그 자리가 파이프다.
    const lines = [fluid("water", "input"), item("a", "input"), item("b", "input"), item("c", "output")];
    const plan = planClusterPorts({ lines, caps: regularCaps, outputSide: "W", pipeSide: "E" });
    // W 면 레인 1개(일반) 뿐 → 아이템 3줄을 못 담는다.
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("belt-demand-exceeds-capacity");
  });

  it("긴팔 보유 → 출력=W(near→far), 입력=E(near→far)", () => {
    const lines = [
      item("a", "input"),
      item("b", "input"),
      item("c", "output"),
      item("d", "output"),
    ];
    const plan = planClusterPorts({ lines, caps: longCaps, outputSide: "W" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lines).toHaveLength(4);
    // 등장 순서 [a-in, b-in, c-out, d-out]:
    //  출력(c,d) → W near(2)/far(3), 입력(a,b) → E near(2)/far(3).
    expect(plan.lines.map((l) => l.side)).toEqual(["E", "E", "W", "W"]);
    expect(plan.lines.map((l) => l.depth)).toEqual([2, 3, 2, 3]);
    expect(plan.lines.map((l) => l.inserter)).toEqual(["normal", "long", "normal", "long"]);
  });

  it("(B) 출력은 항상 출력면 확보 — 입력 3개는 E 채우고 넘치면 W 잔여로", () => {
    const lines = [
      item("out", "output"),
      item("i1", "input"),
      item("i2", "input"),
      item("i3", "input"),
    ];
    const plan = planClusterPorts({ lines, caps: longCaps, outputSide: "W" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const byName = new Map(plan.lines.map((l) => [l.line.name, l]));
    expect(byName.get("out")!.side).toBe("W"); // 출력 W 보장
    expect(byName.get("i1")!.side).toBe("E");
    expect(byName.get("i2")!.side).toBe("E");
    expect(byName.get("i3")!.side).toBe("W"); // E(2칸) 초과 → W 잔여로 흘림
  });

  it("긴팔 보유 → 5 belt 는 용량(4) 초과 → complex", () => {
    const lines = Array.from({ length: 5 }, (_, i) => item(`x${i}`, "input"));
    const plan = planClusterPorts({ lines, caps: longCaps, outputSide: "W" });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("belt-demand-exceeds-capacity");
  });

  it("일반만 → 면당 1레인(2칸): 출력=W, 입력=E", () => {
    const ok = planClusterPorts({
      lines: [item("a", "input"), item("b", "output")],
      caps: regularCaps,
      outputSide: "W",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.lines.map((l) => l.side)).toEqual(["E", "W"]); // a-in→E, b-out→W
      expect(ok.lines.map((l) => l.depth)).toEqual([2, 2]);
      expect(ok.lines.every((l) => l.inserter === "normal")).toBe(true);
    }
    const over = planClusterPorts({
      lines: [item("a", "input"), item("b", "input"), item("c", "output")],
      caps: regularCaps,
      outputSide: "W",
    });
    expect(over.ok).toBe(false); // 총 3 > 용량 2
  });

  it("인서터 없음 + 아이템 필요 → complex", () => {
    const plan = planClusterPorts({
      lines: [item("a", "input")],
      caps: noCaps,
      outputSide: "W",
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("no-inserter");
  });

  it("결과는 등장 순서를 보존한다", () => {
    const lines = [item("out1", "output"), item("in1", "input"), item("in2", "input")];
    const plan = planClusterPorts({ lines, caps: longCaps, outputSide: "W" });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.lines.map((l) => l.line.name)).toEqual(["out1", "in1", "in2"]);
    }
  });

  it("(piece 3) depth=운반량순 — 고수요 라인이 고용량 슬롯(머신 가까이)에", () => {
    const lines: IoLine[] = [
      { name: "lo", kind: "belt", role: "input", amount: 1 },
      { name: "hi", kind: "belt", role: "input", amount: 10 },
    ];
    const plan = planClusterPorts({ lines, caps: longCaps, outputSide: "W", throughput: { normal: 30, long: 8 } });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const byName = new Map(plan.lines.map((l) => [l.line.name, l]));
    // 둘 다 입력 → E 면. normal(30) > long(8) 이므로 고수요(hi) → normal/depth2, 저수요(lo) → long/depth3.
    expect(byName.get("hi")!.depth).toBe(2);
    expect(byName.get("hi")!.inserter).toBe("normal");
    expect(byName.get("lo")!.depth).toBe(3);
    expect(byName.get("lo")!.inserter).toBe("long");
  });

  it("(piece 3) reach 가정 안 함 — long throughput 이 크면 고수요가 long(far)으로", () => {
    const lines: IoLine[] = [
      { name: "hi", kind: "belt", role: "input", amount: 10 },
      { name: "lo", kind: "belt", role: "input", amount: 1 },
    ];
    const plan = planClusterPorts({ lines, caps: longCaps, outputSide: "W", throughput: { normal: 5, long: 40 } });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const byName = new Map(plan.lines.map((l) => [l.line.name, l]));
    expect(byName.get("hi")!.inserter).toBe("long"); // long 이 고용량 → 고수요가 long
    expect(byName.get("lo")!.inserter).toBe("normal");
  });

  it("슬롯 합계가 columnTapCapacity 와 일치(둘 다=4, 일반만=2)", () => {
    const fourOk = planClusterPorts({
      lines: Array.from({ length: 4 }, (_, i) => item(`x${i}`, "input")),
      caps: longCaps,
      outputSide: "W",
    });
    expect(fourOk.ok).toBe(true);
    const twoOk = planClusterPorts({
      lines: Array.from({ length: 2 }, (_, i) => item(`x${i}`, "input")),
      caps: regularCaps,
      outputSide: "W",
    });
    expect(twoOk.ok).toBe(true);
  });
});

describe("planClusterPorts — 노출 N/S 완화 (E → N/S → W)", () => {
  const ext = (name: string): IoLine => ({ name, kind: "belt", role: "input", external: true });

  it("external 3번째 입력은 W-spill 대신 노출 N 레인으로", () => {
    const lines = [item("out", "output"), ext("i1"), ext("i2"), ext("i3")];
    const plan = planClusterPorts({ lines, caps: longCaps, outputSide: "W", nsFaces: ["N"] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const byName = new Map(plan.lines.map((l) => [l.line.name, l]));
    expect(byName.get("out")!.side).toBe("W");
    expect(byName.get("i1")!.side).toBe("E");
    expect(byName.get("i2")!.side).toBe("E");
    expect(byName.get("i3")!.side).toBe("N"); // W 잔여 대신 노출 N (near 레인부터)
    expect(byName.get("i3")!.depth).toBe(2);
    expect(byName.get("i3")!.inserter).toBe("normal");
  });

  it("내부(external 아님) 입력이 자식 쪽 면(E)을 먼저 갖고, external 이 밀려난다", () => {
    const lines = [item("out", "output"), ext("i1"), ext("i2"), item("hop", "input")];
    const plan = planClusterPorts({ lines, caps: longCaps, outputSide: "W", nsFaces: ["N"] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const byName = new Map(plan.lines.map((l) => [l.line.name, l]));

    // 자식-공급(홉) 입력은 **자식 쪽 면(E)** 을 갖는다. 등장 순서상 마지막이지만 먼저 배정된다.
    // 이게 밀려나 출력면(W)에 태어나면 그 홉이 모듈을 빙 돌아와 다른 포트의 탈출로를 끊는다
    // (2026-07-12 실측: 반출 skip 3건의 원인).
    expect(byName.get("hop")!.side).toBe("E");

    // 홉 기하 불변: 자식-공급 입력은 **절대 N/S 에 앉지 않는다**(홉은 W/E 축으로만 오간다).
    expect(["W", "E"]).toContain(byName.get("hop")!.side);

    // 밀려나는 건 external 쪽 — 홉이 없어 perimeter 로 나가면 그만이라 안전하다.
    expect(["N", "W"]).toContain(byName.get("i2")!.side);
  });

  it("nsFaces 미지정 → 기존 동작(external 이어도 W 잔여)", () => {
    const lines = [item("out", "output"), ext("i1"), ext("i2"), ext("i3")];
    const plan = planClusterPorts({ lines, caps: longCaps, outputSide: "W" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lines.find((l) => l.line.name === "i3")!.side).toBe("W");
  });

  it("N/S 는 용량 게이트에 안 들어간다 — 5 belt 는 nsFaces 있어도 complex", () => {
    const lines = Array.from({ length: 5 }, (_, i) => ext(`x${i}`));
    const plan = planClusterPorts({ lines, caps: longCaps, outputSide: "W", nsFaces: ["N", "S"] });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("belt-demand-exceeds-capacity");
  });

  it("N 소진 후 다음 노출 면(S) 소비, 그다음에야 W", () => {
    // 출력이 W2 를 점유. external 입력 3개: E2, E3 다음 N2 (N 레인 near 부터).
    // N 은 nsFaces=["N"] 하나뿐이지만 레인이 2개(N2, N3)라 4번째 입력도 N3 로 간다.
    const lines = [item("out", "output"), ext("i1"), ext("i2"), ext("i3")];
    const planNS = planClusterPorts({ lines, caps: longCaps, outputSide: "W", nsFaces: ["N", "S"] });
    expect(planNS.ok).toBe(true);
    if (!planNS.ok) return;
    expect(planNS.lines.find((l) => l.line.name === "i3")!.side).toBe("N");
  });
});
