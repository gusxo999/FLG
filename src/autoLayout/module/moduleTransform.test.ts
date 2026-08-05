import { describe, it, expect } from "vitest";
import { generateModule, type GeneratedModule, type ModuleInput } from "./clusterModule";
import type { IoLine } from "../planner/module/clusterPortPlanner";
import { transformModule, rotationToFace, type Orientation, type Rotation } from "./moduleTransform";
import { EntityType } from "../../types/layout";
import type { PlacedCell } from "../containerModel";

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

  it("출력 포트 face 가 회전마다 +90°(N→E→S→W 순서) 순환", () => {
    // 기준 face 는 planner 슬롯 배정에 따라 정해지므로 하드코딩하지 않는다. 검증 대상은
    // transformModule 의 회전 로직 — 어느 면에서 시작하든 +90° 마다 N→E→S→W 링을 한 칸씩.
    const base = generateModule(copperCable);
    const faces = [base.outputPorts[0].face];
    let m = base;
    for (let i = 0; i < 3; i++) {
      m = transformModule(m, { rotation: 90 });
      faces.push(m.outputPorts[0].face);
    }
    const ring = ["N", "E", "S", "W"] as const;
    const start = ring.indexOf(base.outputPorts[0].face);
    const expected = [0, 1, 2, 3].map((i) => ring[(start + i) % 4]);
    expect(faces).toEqual(expected);
  });

  it("90° 에서 머신 footprint w×h → h×w (비정사각)", () => {
    const fake: GeneratedModule = {
      machines: [{ id: "m", kind: "machine", entityName: "x", origin: { x: 0, y: 0 }, size: { w: 2, h: 4 } }],
      chests: [], cells: [], ring: [], inputPorts: [], outputPorts: [],
      bbox: { x: 0, y: 0, w: 2, h: 4 }, unroutedLines: [], pipeCells: [],
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
});
