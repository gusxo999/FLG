import { describe, it, expect } from "vitest";
import { packModuleTree, moduleExtent, type NodeSpec, type PackConfig, type PackResult } from "./modulePacking";
import type { IoLine } from "./clusterPortPlanner";
import { EntityType } from "../../types/layout";

const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });
const M = { entityName: "assembling-machine-2", w: 3, h: 3 };

// 트리: electronic-circuit(root) ← copper-cable ← copper-plate(raw)
//                                ← iron-plate(raw)
const specs: NodeSpec[] = [
  {
    id: "circuit", depth: 0, machine: M, count: 4,
    lines: [inL("iron-plate"), inL("copper-cable"), outL("electronic-circuit")],
  },
  {
    id: "coppercable", depth: 1, parentId: "circuit", machine: M, count: 5,
    lines: [inL("copper-plate"), outL("copper-cable")],
  },
];

const config: PackConfig = {
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
};

/** 포트가 머신 bbox 의 어느 변에 붙었나 (테스트 단언용 — 패킹 내부와 동일 규칙). */
function side(anchor: { x: number; y: number }, bbox: { x: number; y: number; w: number; h: number }): string {
  if (anchor.x < bbox.x) return "W";
  if (anchor.x >= bbox.x + bbox.w) return "E";
  if (anchor.y < bbox.y) return "N";
  return "S";
}

function render(res: PackResult): void {
  const ARROW: Record<number, string> = { 0: "↑", 4: "→", 8: "↓", 12: "←" };
  const { x: ox, y: oy, w, h } = res.bbox;
  const grid: string[][] = Array.from({ length: h }, () => Array(w).fill("·"));
  const put = (x: number, y: number, ch: string) => {
    if (x >= ox && x < ox + w && y >= oy && y < oy + h) grid[y - oy][x - ox] = ch;
  };
  for (const pl of res.placements) {
    for (const m of pl.module.machines)
      for (let dx = 0; dx < m.size.w; dx++) for (let dy = 0; dy < m.size.h; dy++) put(m.origin.x + dx, m.origin.y + dy, "▒");
    for (const c of pl.module.cells) {
      const t = c.cell.entityType;
      if (t === EntityType.Belt) put(c.x, c.y, ARROW[c.cell.direction] ?? "b");
      else if (t === EntityType.Inserter) put(c.x, c.y, "i");
      else if (t === EntityType.InfinityChest) put(c.x, c.y, "c");
    }
  }
  for (const p of res.rawPorts) put(p.anchor.x, p.anchor.y, "R"); // raw 입력
  for (const hp of res.hops) { put(hp.from.anchor.x, hp.from.anchor.y, "O"); put(hp.to.anchor.x, hp.to.anchor.y, "I"); }
  // eslint-disable-next-line no-console
  console.log(
    `\n=== 모듈 트리 패킹 (preview) ===\n` +
      `홉 ${res.hops.length}: ${res.hops.map((h) => `${h.item} O(${h.from.anchor.x},${h.from.anchor.y})→I(${h.to.anchor.x},${h.to.anchor.y})`).join(" | ")}\n` +
      `raw ${res.rawPorts.length}: ${res.rawPorts.map((p) => `${p.line.name}@(${p.anchor.x},${p.anchor.y})`).join(", ")}\n` +
      `O=자식출력 I=부모입력 R=raw  c=상자\n` +
      grid.map((r) => r.join("")).join("\n"),
  );
}

describe("packModuleTree", () => {
  it("출력은 W변(부모쪽), 자식-공급 입력은 E변(자식쪽)으로 정렬 — 보장 단언", () => {
    const res = packModuleTree(specs, config);
    const byId = new Map(res.placements.map((p) => [p.id, p.module]));

    const circuit = byId.get("circuit")!;
    const cable = byId.get("coppercable")!;

    // 출력은 부모쪽(W) — 가중치 10 지배.
    expect(side(circuit.outputPorts[0].anchor, circuit.bbox)).toBe("W");
    expect(side(cable.outputPorts[0].anchor, cable.bbox)).toBe("W");

    // circuit 의 copper-cable 입력(자식-공급)은 E변(자식쪽).
    const fed = circuit.inputPorts.find((p) => p.line.name === "copper-cable")!;
    expect(side(fed.anchor, circuit.bbox)).toBe("E");
    // raw 입력 N/S 는 *약한 선호* — 출력/자식입력 정렬에 져서 항상 보장되지 않음(planner 후속).
  });

  it("홉 페어링 = 품목 매칭, 개수 = 자식 수", () => {
    const res = packModuleTree(specs, config);
    expect(res.hops).toHaveLength(1);
    expect(res.hops[0].item).toBe("copper-cable");
    expect(res.hops[0].from.line.role).toBe("output");
    expect(res.hops[0].to.line.role).toBe("input");
    expect(res.hops[0].to.line.name).toBe("copper-cable");
  });

  it("raw 포트 = child 없는 입력 (iron-plate + copper-plate)", () => {
    const res = packModuleTree(specs, config);
    const names = res.rawPorts.map((p) => p.line.name).sort();
    expect(names).toEqual(["copper-plate", "iron-plate"]);
  });

  it("배치 겹침 0 — 모든 모듈의 placed 셀이 고유 좌표", () => {
    const res = packModuleTree(specs, config);
    const seen = new Set<string>();
    for (const pl of res.placements)
      for (const c of pl.module.cells) {
        const k = `${c.x},${c.y}`;
        expect(seen.has(k), `중복 ${k}`).toBe(false);
        seen.add(k);
      }
  });

  it("extent 가 모든 셀을 포함", () => {
    const res = packModuleTree(specs, config);
    for (const pl of res.placements) {
      const e = moduleExtent(pl.module);
      for (const c of pl.module.cells) {
        expect(c.x).toBeGreaterThanOrEqual(e.x);
        expect(c.x).toBeLessThan(e.x + e.w);
        expect(c.y).toBeGreaterThanOrEqual(e.y);
        expect(c.y).toBeLessThan(e.y + e.h);
      }
    }
  });

  it("결정적", () => {
    const a = packModuleTree(specs, config);
    const b = packModuleTree(specs, config);
    const sig = (r: PackResult) => JSON.stringify(r.placements.map((p) => [p.id, p.origin, p.orientation]));
    expect(sig(b)).toEqual(sig(a));
  });

  it("렌더 — 전체 트리", () => {
    render(packModuleTree(specs, config));
  });
});
