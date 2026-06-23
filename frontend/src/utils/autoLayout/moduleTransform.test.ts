import { describe, it, expect } from "vitest";
import { generateModule, type GeneratedModule, type ModuleInput } from "./clusterModule";
import type { IoLine } from "./clusterPortPlanner";
import { transformModule, rotationToFace, type Orientation, type Rotation } from "./moduleTransform";
import { EntityType } from "../../types/layout";
import type { Container, PlacedCell } from "./containerModel";

const line = (name: string, role: "input" | "output"): IoLine => ({ name, kind: "belt", role });

const copperCable: ModuleInput = {
  machine: { entityName: "assembling-machine-2", w: 3, h: 3 },
  count: 5,
  lines: [line("copper-plate", "input"), line("copper-cable", "output")],
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
};

/** 회전/반사 불변 비교용 정규 서명 — 머신 footprint + 셀(좌표·종류·방향) + 포트. */
function sig(mod: GeneratedModule): string {
  const machines = mod.machines.map((m) => `M:${m.origin.x},${m.origin.y},${m.size.w}x${m.size.h}`).sort();
  const cells = mod.cells.map((c) => `${c.cell.entityType}:${c.x},${c.y}:${c.cell.direction}`).sort();
  const ports = [...mod.inputPorts, ...mod.outputPorts]
    .map((p) => `${p.line.role}:${p.face}:${p.anchor.x},${p.anchor.y}`)
    .sort();
  return JSON.stringify({ machines, cells, ports });
}

/** o 의 역방위 — 회전은 보각, 반사는 자기 자신(D4 반사는 involution). */
function inverse(o: Orientation): Orientation {
  if (o.reflect) return o;
  return { rotation: ((360 - o.rotation) % 360) as Rotation };
}

function renderRot(mod: GeneratedModule, title: string): void {
  const ARROW: Record<number, string> = { 0: "↑", 4: "→", 8: "↓", 12: "←" };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const mk = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const m of mod.machines) for (let dx = 0; dx < m.size.w; dx++) for (let dy = 0; dy < m.size.h; dy++) mk(m.origin.x + dx, m.origin.y + dy);
  for (const c of mod.cells) mk(c.x, c.y);
  const grid: string[][] = Array.from({ length: maxY - minY + 1 }, () => Array(maxX - minX + 1).fill("·"));
  const put = (x: number, y: number, ch: string) => { grid[y - minY][x - minX] = ch; };
  for (const m of mod.machines) for (let dx = 0; dx < m.size.w; dx++) for (let dy = 0; dy < m.size.h; dy++) put(m.origin.x + dx, m.origin.y + dy, "▒");
  for (const c of mod.cells) {
    const t = c.cell.entityType;
    if (t === EntityType.Belt) put(c.x, c.y, ARROW[c.cell.direction] ?? "b");
    else if (t === EntityType.Inserter) put(c.x, c.y, "i");
    else if (t === EntityType.InfinityChest) put(c.x, c.y, "C");
  }
  for (const p of mod.inputPorts) put(p.anchor.x, p.anchor.y, "▶");
  for (const p of mod.outputPorts) put(p.anchor.x, p.anchor.y, "◉");
  // eslint-disable-next-line no-console
  console.log(`\n=== ${title} ===\n출력 face: ${mod.outputPorts.map((p) => p.face).join(",")}\n` + grid.map((r) => r.join("")).join("\n"));
}

describe("transformModule (D4)", () => {
  it("왕복 — o 변환 후 역변환 = 원본 (회전·반사 모두)", () => {
    const base = generateModule(copperCable);
    const orients: Orientation[] = [
      { rotation: 90 }, { rotation: 180 }, { rotation: 270 },
      { rotation: 0, reflect: true }, { rotation: 90, reflect: true }, { rotation: 270, reflect: true },
    ];
    for (const o of orients) {
      const round = transformModule(transformModule(base, o), inverse(o));
      expect(sig(round), `왕복 실패 @ ${JSON.stringify(o)}`).toEqual(sig(base));
    }
  });

  it("회전 90° 4번 = 항등", () => {
    const base = generateModule(copperCable);
    let m = base;
    for (let i = 0; i < 4; i++) m = transformModule(m, { rotation: 90 });
    expect(sig(m)).toEqual(sig(base));
  });

  it("출력 포트 face 가 회전마다 N→E→S→W 순환", () => {
    const base = generateModule(copperCable);
    const faces = [base.outputPorts[0].face];
    let m = base;
    for (let i = 0; i < 3; i++) {
      m = transformModule(m, { rotation: 90 });
      faces.push(m.outputPorts[0].face);
    }
    expect(faces).toEqual(["N", "E", "S", "W"]);
  });

  it("90° 에서 머신 footprint w×h → h×w (비정사각)", () => {
    const fake: GeneratedModule = {
      machines: [{ id: "m", kind: "machine", entityName: "x", origin: { x: 0, y: 0 }, size: { w: 2, h: 4 } }],
      chests: [], cells: [], ring: [], inputPorts: [], outputPorts: [],
      bbox: { x: 0, y: 0, w: 2, h: 4 }, unroutedLines: [],
    };
    const r = transformModule(fake, { rotation: 90 });
    expect(r.machines[0].size).toEqual({ w: 4, h: 2 });
    expect(r.bbox).toEqual({ x: 0, y: 0, w: 4, h: 2 });
  });

  it("belt 방향이 함께 회전 — ↑(N,0) 한 셀이 90°에서 →(E,4)", () => {
    const base = generateModule(copperCable);
    const upBelt = base.cells.find((c) => c.cell.entityType === EntityType.Belt && c.cell.direction === 0);
    expect(upBelt).toBeDefined();
    const id = (upBelt as PlacedCell).cell.entityId;
    const rot = transformModule(base, { rotation: 90 });
    const moved = rot.cells.find((c) => c.cell.entityId === id)!;
    expect(moved.cell.direction).toBe(4);
  });

  it("반사 후에도 모든 belt/인서터 방향이 카디널 + 셀 충돌 0", () => {
    const r = transformModule(generateModule(copperCable), { rotation: 90, reflect: true });
    const seen = new Set<string>();
    for (const c of r.cells) {
      if (c.cell.entityType === EntityType.Belt || c.cell.entityType === EntityType.Inserter) {
        expect([0, 4, 8, 12]).toContain(c.cell.direction);
      }
      const k = `${c.x},${c.y}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it("결정적", () => {
    const base = generateModule(copperCable);
    expect(sig(transformModule(base, { rotation: 90, reflect: true })))
      .toEqual(sig(transformModule(base, { rotation: 90, reflect: true })));
  });

  it("rotationToFace — 면을 목표로 보내는 회전", () => {
    expect(rotationToFace("N", "E")).toBe(90);
    expect(rotationToFace("N", "S")).toBe(180);
    expect(rotationToFace("W", "N")).toBe(90);
    expect(rotationToFace("N", "N")).toBe(0);
  });

  it("렌더 — copper-cable 원본 vs 90° 회전", () => {
    const base = generateModule(copperCable);
    renderRot(base, "원본 (출력 W면 ↑)");
    renderRot(transformModule(base, { rotation: 90 }), "90° 회전");
  });
});
