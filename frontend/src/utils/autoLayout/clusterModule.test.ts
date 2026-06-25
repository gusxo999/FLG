import { describe, it, expect } from "vitest";
import { generateModule, type GeneratedModule, type ModuleInput } from "./clusterModule";
import type { IoLine } from "./clusterPortPlanner";
import { EntityType } from "../../types/layout";

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처
// ─────────────────────────────────────────────────────────────────────────────

const line = (name: string, role: "input" | "output"): IoLine => ({
  name,
  kind: "belt",
  role,
});

/** copper-cable 류: 입력 1(copper-plate) + 출력 1(copper-cable), 일반 인서터만(용량 2). */
const copperCable: ModuleInput = {
  machine: { entityName: "assembling-machine-2", w: 3, h: 3 },
  count: 5,
  lines: [line("copper-plate", "input"), line("copper-cable", "output")],
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
};

/** electronic-circuit 류: 입력 2 + 출력 1, 긴팔 보유(용량 4 → 면당 2레인). */
const electronicCircuit: ModuleInput = {
  machine: { entityName: "assembling-machine-2", w: 3, h: 3 },
  count: 4,
  lines: [
    line("iron-plate", "input"),
    line("copper-cable", "input"),
    line("electronic-circuit", "output"),
  ],
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
};

/** electric-motor 류: 입력 3 + 출력 1 = 정확히 용량 4(긴팔). 4스트림 스트레스. */
const electricMotor: ModuleInput = {
  machine: { entityName: "assembling-machine-2", w: 3, h: 3 },
  count: 3,
  lines: [
    line("iron-gear-wheel", "input"),
    line("copper-cable", "input"),
    line("iron-plate", "input"),
    line("electric-motor", "output"),
  ],
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
};

// ─────────────────────────────────────────────────────────────────────────────
// ASCII 렌더 — 결과물을 눈으로 보기 위한 진단 출력
// ─────────────────────────────────────────────────────────────────────────────

const BELT_ARROW: Record<number, string> = { 0: "↑", 4: "→", 8: "↓", 12: "←" };

function render(mod: GeneratedModule, title: string): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const mark = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const m of mod.machines)
    for (let dx = 0; dx < m.size.w; dx++)
      for (let dy = 0; dy < m.size.h; dy++) mark(m.origin.x + dx, m.origin.y + dy);
  for (const c of mod.cells) mark(c.x, c.y);

  const W = maxX - minX + 1, H = maxY - minY + 1;
  const grid: string[][] = Array.from({ length: H }, () => Array(W).fill("·"));
  const put = (x: number, y: number, ch: string) => { grid[y - minY][x - minX] = ch; };

  for (const m of mod.machines)
    for (let dx = 0; dx < m.size.w; dx++)
      for (let dy = 0; dy < m.size.h; dy++) put(m.origin.x + dx, m.origin.y + dy, "▒");
  for (const c of mod.cells) {
    const t = c.cell.entityType;
    if (t === EntityType.Belt) put(c.x, c.y, BELT_ARROW[c.cell.direction] ?? "b");
    else if (t === EntityType.Inserter) put(c.x, c.y, "i");
    else if (t === EntityType.InfinityChest) put(c.x, c.y, "C");
  }
  // 포트 anchor 강조.
  for (const p of mod.inputPorts) put(p.anchor.x, p.anchor.y, "▶"); // 입력
  for (const p of mod.outputPorts) put(p.anchor.x, p.anchor.y, "◉"); // 출력

  const body = grid.map((r) => r.join("")).join("\n");
  // eslint-disable-next-line no-console
  console.log(
    `\n=== ${title} ===\n` +
      `머신 ${mod.machines.length}대 | 입력포트 ${mod.inputPorts.length} | 출력포트 ${mod.outputPorts.length} | 미라우팅 ${mod.unroutedLines.length}\n` +
      `입력: ${mod.inputPorts.map((p) => `${p.line.name}@(${p.anchor.x},${p.anchor.y}) ${p.face}`).join(", ")}\n` +
      `출력: ${mod.outputPorts.map((p) => `${p.line.name}@(${p.anchor.x},${p.anchor.y}) ${p.face}`).join(", ")}\n` +
      body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────────────────────────────────────

describe("generateModule", () => {
  it("copper-cable: 입력 1 + 출력 1 모듈을 자기 ring 으로 라우팅 (용량 2)", () => {
    const mod = generateModule(copperCable);
    render(mod, "copper-cable ×5 (용량 2)");

    expect(mod.machines).toHaveLength(5);
    expect(mod.unroutedLines).toHaveLength(0);
    expect(mod.outputPorts).toHaveLength(1);
    expect(mod.inputPorts).toHaveLength(1);

    const ringSet = new Set(mod.ring.map((c) => `${c.x},${c.y}`));
    for (const p of [...mod.inputPorts, ...mod.outputPorts]) {
      expect(ringSet.has(`${p.anchor.x},${p.anchor.y}`)).toBe(true);
    }
  });

  it("electronic-circuit: 입력 2 + 출력 1, 긴팔로 면당 2레인 (용량 4)", () => {
    const mod = generateModule(electronicCircuit);
    render(mod, "electronic-circuit ×4 (용량 4, 긴팔)");

    expect(mod.unroutedLines).toHaveLength(0);
    expect(mod.inputPorts).toHaveLength(2);
    expect(mod.outputPorts).toHaveLength(1);
  });

  it("electric-motor: 입력 3 + 출력 1 = 4스트림 (용량 4 정확히)", () => {
    const mod = generateModule(electricMotor);
    render(mod, "electric-motor ×3 (4스트림, 용량 4)");

    expect(mod.unroutedLines).toHaveLength(0);
    expect(mod.inputPorts).toHaveLength(3);
    expect(mod.outputPorts).toHaveLength(1);
  });

  it("셀 좌표 충돌 0 — 모든 placed 셀이 고유 좌표", () => {
    for (const input of [copperCable, electronicCircuit]) {
      const mod = generateModule(input);
      const seen = new Set<string>();
      for (const c of mod.cells) {
        const k = `${c.x},${c.y}`;
        expect(seen.has(k), `중복 셀 ${k} in ${input.lines[0].name}`).toBe(false);
        seen.add(k);
      }
    }
  });

  it("결정적 — 같은 입력은 같은 셀/포트", () => {
    const a = generateModule(copperCable);
    const b = generateModule(copperCable);
    expect(JSON.stringify(b.cells)).toEqual(JSON.stringify(a.cells));
    expect(JSON.stringify(b.outputPorts.map((p) => p.anchor))).toEqual(
      JSON.stringify(a.outputPorts.map((p) => p.anchor)),
    );
  });

  it("포트 anchor 와 머신 footprint 는 겹치지 않는다", () => {
    const mod = generateModule(electronicCircuit);
    const machineCells = new Set<string>();
    for (const m of mod.machines)
      for (let dx = 0; dx < m.size.w; dx++)
        for (let dy = 0; dy < m.size.h; dy++)
          machineCells.add(`${m.origin.x + dx},${m.origin.y + dy}`);
    for (const p of [...mod.inputPorts, ...mod.outputPorts]) {
      expect(machineCells.has(`${p.anchor.x},${p.anchor.y}`)).toBe(false);
    }
  });
});
