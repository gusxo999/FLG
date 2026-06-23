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

describe("planClusterPorts — 1단계(아이템만)", () => {
  it("빈 입력 → ok, 빈 배정", () => {
    const plan = planClusterPorts({ lines: [], caps: longCaps, perimeterNearSide: "W" });
    expect(plan).toEqual({ ok: true, lines: [] });
  });

  it("유체 줄이 있으면 complex 위임(미구현)", () => {
    const plan = planClusterPorts({
      lines: [item("iron", "input"), fluid("water", "input")],
      caps: longCaps,
      perimeterNearSide: "W",
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("pipe-not-yet-supported");
  });

  it("긴팔 보유 → 면당 2레인, 4 belt 까지 배정", () => {
    const lines = [
      item("a", "input"),
      item("b", "input"),
      item("c", "output"),
      item("d", "output"),
    ];
    const plan = planClusterPorts({ lines, caps: longCaps, perimeterNearSide: "W" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lines).toHaveLength(4);
    // near 면(W) 먼저 2레인(2칸 일반, 3칸 긴팔), 그다음 far 면(E).
    expect(plan.lines.map((l) => l.side)).toEqual(["W", "W", "E", "E"]);
    expect(plan.lines.map((l) => l.depth)).toEqual([2, 3, 2, 3]);
    expect(plan.lines.map((l) => l.inserter)).toEqual(["normal", "long", "normal", "long"]);
  });

  it("긴팔 보유 → 5 belt 는 용량(4) 초과 → complex", () => {
    const lines = Array.from({ length: 5 }, (_, i) => item(`x${i}`, "input"));
    const plan = planClusterPorts({ lines, caps: longCaps, perimeterNearSide: "W" });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("belt-demand-exceeds-capacity");
  });

  it("일반만 → 면당 1레인(2칸), 2 belt 까지", () => {
    const ok = planClusterPorts({
      lines: [item("a", "input"), item("b", "output")],
      caps: regularCaps,
      perimeterNearSide: "E",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.lines.map((l) => l.side)).toEqual(["E", "W"]); // near=E 먼저
      expect(ok.lines.map((l) => l.depth)).toEqual([2, 2]);
      expect(ok.lines.every((l) => l.inserter === "normal")).toBe(true);
    }
    const over = planClusterPorts({
      lines: [item("a", "input"), item("b", "input"), item("c", "output")],
      caps: regularCaps,
      perimeterNearSide: "E",
    });
    expect(over.ok).toBe(false);
  });

  it("인서터 없음 + 아이템 필요 → complex", () => {
    const plan = planClusterPorts({
      lines: [item("a", "input")],
      caps: noCaps,
      perimeterNearSide: "W",
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("no-inserter");
  });

  it("배정 순서 — 입력 먼저, 그다음 출력(등장 순서)", () => {
    const lines = [item("out1", "output"), item("in1", "input"), item("in2", "input")];
    const plan = planClusterPorts({ lines, caps: longCaps, perimeterNearSide: "W" });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.lines.map((l) => l.line.name)).toEqual(["in1", "in2", "out1"]);
    }
  });

  it("슬롯 합계가 columnTapCapacity 와 일치(둘 다=4, 일반만=2)", () => {
    const fourOk = planClusterPorts({
      lines: Array.from({ length: 4 }, (_, i) => item(`x${i}`, "input")),
      caps: longCaps,
      perimeterNearSide: "W",
    });
    expect(fourOk.ok).toBe(true);
    const twoOk = planClusterPorts({
      lines: Array.from({ length: 2 }, (_, i) => item(`x${i}`, "input")),
      caps: regularCaps,
      perimeterNearSide: "W",
    });
    expect(twoOk.ok).toBe(true);
  });
});
