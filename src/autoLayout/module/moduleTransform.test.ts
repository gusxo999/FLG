import { describe, it, expect } from "vitest";
import { generateModule, type GeneratedModule, type ModuleInput } from "./clusterModule";
import type { IoLine } from "../planner/module/clusterPortPlanner";
import { transformModule, shiftModule, rotationToFace, type Orientation, type Rotation } from "./moduleTransform";
import { collectPipeFlow, pipeFlowConflict } from "../util/pipeFlow";
import { EntityType } from "../../types/layout";
import type { PlacedCell } from "../containerModel";

const line = (name: string, role: "input" | "output"): IoLine => ({ name, kind: "belt", role });

const copperCable: ModuleInput = {
  machine: { entityName: "assembling-machine-2", w: 3, h: 3 },
  count: 5,
  lines: [line("copper-plate", "input"), line("copper-cable", "output")],
  inserterEntityName: "inserter",
  inserters: [{ entityName: "inserter", reach: 1, throughput: 0 }],
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

// ─────────────────────────────────────────────────────────────────────────────
// 프레임 경계 회귀 못 — **여기가 비어 있어서** 결함 셋이 쌓였다
// ─────────────────────────────────────────────────────────────────────────────
//
// 기존 테스트는 전부 `generateModule` 직후(모듈-로컬)의 모듈만 본다. `shiftModule` ·
// `transformModule` 을 **한 번도 통과시키지 않아서**, 그 두 함수가 좌표 필드를 빠뜨려도
// 아무도 몰랐다. `pipeCells` 가 모듈-로컬에 남아 배치가 통째로 실패했다(2026-08-05).

describe("좌표 프레임 경계 — 옮길 것을 다 옮기나", () => {
  /** 유체 세 줄(지상 파이프 + 지하파이프 둘 다 나온다) — `trunkPipe.test.ts` 와 같은 꼴. */
  const fluidLine = (name: string, role: "input" | "output"): IoLine => ({ name, kind: "pipe", role });
  const cracking: ModuleInput = {
    machine: { entityName: "chemical-plant", w: 3, h: 3 },
    count: 3,
    lines: [fluidLine("water", "input"), fluidLine("heavy-oil", "input"), fluidLine("light-oil", "output")],
    inserterEntityName: "inserter",
    inserters: [{ entityName: "inserter", reach: 1, throughput: 0 }, { entityName: "long-handed-inserter", reach: 2, throughput: 0 }],
    beltEntityName: "transport-belt",
    fluidTrunk: {
      direction: 4,
      pipeEntityName: "pipe",
      undergroundPipeEntityName: "pipe-to-ground",
      pipeMaxUndergroundDistance: 10,
      lines: [
        { name: "water", role: "input", side: "E", fluidboxOffset: 0, rank: 0, boxIndex: 0 },
        { name: "heavy-oil", role: "input", side: "E", fluidboxOffset: 2, rank: 1, boxIndex: 1 },
        { name: "light-oil", role: "output", side: "W", fluidboxOffset: 0, rank: 0, boxIndex: 2 },
      ],
    },
  };

  it("shiftModule — pipeCells 가 정확히 (dx,dy) 만큼 따라온다", () => {
    const base = generateModule(cracking);
    expect(base.pipeCells.length, "이 못이 헛돌지 않으려면 파이프 셀이 있어야 한다").toBeGreaterThan(0);

    const dx = 37, dy = -11;
    const moved = shiftModule(base, dx, dy);
    expect(moved.pipeCells.length).toBe(base.pipeCells.length);
    for (let i = 0; i < base.pipeCells.length; i++) {
      expect({ x: moved.pipeCells[i].x, y: moved.pipeCells[i].y }).toEqual(
        { x: base.pipeCells[i].x + dx, y: base.pipeCells[i].y + dy },
      );
      // 면은 평행이동에 불변이다.
      expect(moved.pipeCells[i].connectDir).toBe(base.pipeCells[i].connectDir);
    }
  });

  it("shiftModule — 포트의 tapAnchor·cells 도 따라온다", () => {
    const base = generateModule(cracking);
    const dx = 5, dy = 9;
    const moved = shiftModule(base, dx, dy);
    const ports = [...base.inputPorts, ...base.outputPorts];
    const movedPorts = [...moved.inputPorts, ...moved.outputPorts];
    expect(ports.length).toBeGreaterThan(0);
    for (let i = 0; i < ports.length; i++) {
      expect(movedPorts[i].tapAnchor).toEqual({ x: ports[i].tapAnchor.x + dx, y: ports[i].tapAnchor.y + dy });
      expect(movedPorts[i].cells.map((c) => `${c.x},${c.y}`))
        .toEqual(ports[i].cells.map((c) => `${c.x + dx},${c.y + dy}`));
    }
  });

  /** 유체 이름만 다른 이웃 모듈 — 겹치면 **다른 유체**라 합류 가드에 걸린다. */
  const neighbour: ModuleInput = {
    ...cracking,
    lines: [
      fluidLine("sulfuric-acid", "input"),
      fluidLine("petroleum-gas", "input"),
      fluidLine("lubricant", "output"),
    ],
    fluidTrunk: {
      ...cracking.fluidTrunk!,
      lines: [
        { name: "sulfuric-acid", role: "input", side: "E", fluidboxOffset: 0, rank: 0, boxIndex: 0 },
        { name: "petroleum-gas", role: "input", side: "E", fluidboxOffset: 2, rank: 1, boxIndex: 1 },
        { name: "lubricant", role: "output", side: "W", fluidboxOffset: 0, rank: 0, boxIndex: 2 },
      ],
    },
  };

  /** `moduleWizard` 의 합류 가드와 **같은 방식**으로 검사한다. */
  const conflicts = (mods: GeneratedModule[]): string[] => {
    const pipes = mods.flatMap((m) => m.pipeCells);
    const hits: string[] = [];
    for (const mod of mods) {
      for (const fluid of new Set(mod.pipeCells.map((c) => c.fluid))) {
        const flow = collectPipeFlow({ fluidName: fluid, pipes, machines: [] });
        if (pipeFlowConflict(mod.pipeCells.filter((c) => c.fluid === fluid), flow)) hits.push(fluid);
      }
    }
    return hits;
  };

  it("**떨어뜨려 놓은 두 모듈은 서로 물지 않는다** — 2026-08-05 배치 실패가 이것이다", () => {
    // `pipeCells` 가 안 옮겨지면 두 모듈이 아무리 떨어져 있어도 파이프 셀은 원점 근처에
    // 겹쳐 쌓인다. 그러면 남남 모듈의 **다른 유체** 파이프가 같은 칸을 차지한 것으로 보여
    // 서로를 hard 위반으로 거절하고, 물러설 곳이 없어 트리 전체가 실패한다.
    const a = shiftModule(generateModule(cracking), 0, 0);
    const b = shiftModule(generateModule(neighbour), 200, 200);
    expect(conflicts([a, b])).toEqual([]);
  });

  it("회귀 못이 헛돌지 않는다 — 같은 자리면 그 두 모듈은 반드시 걸린다", () => {
    // 위 못의 대조군. `shiftModule` 을 안 태우면(= 옛 동작) 이 상태가 되고, 여기서
    // 걸리는 것이 바로 위 못이 막는 실패다.
    const a = generateModule(cracking);
    const b = generateModule(neighbour);
    expect(conflicts([a, b]).length).toBeGreaterThan(0);
  });

  it("transformModule — pipeCells 좌표와 connectDir 이 함께 돈다", () => {
    const base = generateModule(cracking);
    const rot = transformModule(base, { rotation: 90 });
    expect(rot.pipeCells.length).toBe(base.pipeCells.length);

    // 파이프 셀은 `cells` 의 파이프류 셀에 유체를 덧붙인 사본이다 — 좌표 집합이 같아야 한다.
    const pipeLike = new Set<EntityType>([
      EntityType.Pipe, EntityType.PipeUnderground, EntityType.InfinityPipe,
    ]);
    const cellKeys = new Set(
      rot.cells.filter((c) => pipeLike.has(c.cell.entityType)).map((c) => `${c.x},${c.y}`),
    );
    for (const p of rot.pipeCells) {
      expect(cellKeys.has(`${p.x},${p.y}`), `pipeCell (${p.x},${p.y}) 가 cells 와 어긋났다`).toBe(true);
    }
    // 지하파이프의 연결 방향도 90° 돌아야 한다(면이므로).
    const dirsBefore = base.pipeCells.filter((c) => c.connectDir !== undefined).map((c) => c.connectDir!);
    const dirsAfter = rot.pipeCells.filter((c) => c.connectDir !== undefined).map((c) => c.connectDir!);
    expect(dirsAfter.length).toBe(dirsBefore.length);
    expect(new Set(dirsAfter)).toEqual(new Set(dirsBefore.map((d) => ((d + 4) % 16))));
  });

  it("transformModule — 포트의 moduleWayOuts(면)도 함께 돈다", () => {
    const base = generateModule(copperCable);
    const rot = transformModule(base, { rotation: 90 });
    const ring = ["N", "E", "S", "W"] as const;
    const turned = (f: (typeof ring)[number]) => ring[(ring.indexOf(f) + 1) % 4];
    const ports = [...base.inputPorts, ...base.outputPorts];
    const rotPorts = [...rot.inputPorts, ...rot.outputPorts];
    expect(ports.some((p) => p.moduleWayOuts.length > 0), "헛돌지 않으려면 wayOut 이 있어야").toBe(true);
    for (let i = 0; i < ports.length; i++) {
      expect(rotPorts[i].moduleWayOuts).toEqual(ports[i].moduleWayOuts.map(turned));
    }
  });
});
