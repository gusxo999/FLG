import { describe, it, expect } from "vitest";
import { generateModule, type ModuleInput } from "./clusterModule";
import type { MachineLink } from "./allocateMachineLinks";

// 출력 fan-out 방출 검증 — 링크가 있으면 출력이 "줄당 트렁크 하나"가 아니라
// "머신당·목적지별 belt"로 갈라 나온다. count≥2, W/E 에 앉는 중간 출력 케이스.

const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

// 자식 2대. 각 머신이 출력을 부모 여럿으로 갈라 낸다.
//   머신0 → 부모0 (팔1), 머신0 → 부모1 (팔1)   ← fan-out (한 머신, 두 목적지)
//   머신1 → 부모1 (팔1)
const links: MachineLink[] = [
  { fromMachine: 0, toMachine: 0, item: "gear", inserterCount: 1 },
  { fromMachine: 0, toMachine: 1, item: "gear", inserterCount: 1 },
  { fromMachine: 1, toMachine: 1, item: "gear", inserterCount: 1 },
];

const base: ModuleInput = {
  machine: M,
  count: 2,
  lines: [
    { name: "iron", kind: "belt", role: "input" },
    { name: "gear", kind: "belt", role: "output" },
  ],
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
  throughput: { normal: 2.4, long: 1.2 },
  belts: [{ entityName: "transport-belt", throughput: 15 }],
  supplyCapacity: {
    tapCapacity: 1.2,
    lineRates: new Map([
      ["input:iron", 4],
      ["output:gear", 3],
    ]),
  },
  outputLinks: links,
};

describe("emitOutputLinks — 출력 fan-out", () => {
  const mod = generateModule(base);

  it("링크마다 출력 포트 하나 (머신당·목적지별 belt = fan-out)", () => {
    // 링크 3개 → 출력 포트 3개. (옛 트렁크였다면 gear 포트 1개뿐)
    expect(mod.outputPorts).toHaveLength(3);
  });

  it("포트가 전부 W면으로 나간다 (부모 쪽으로 꺾임)", () => {
    expect(mod.outputPorts.every((p) => p.face === "W")).toBe(true);
  });

  it("머신0 이 두 포트를 낸다 (한 머신 → 두 부모, 갈림길)", () => {
    // 머신0 의 두 belt 는 서로 다른 행(base 0,1)에서 나가 anchor y 가 다르다.
    const ys = mod.outputPorts.map((p) => p.anchor.y).sort((a, b) => a - b);
    expect(new Set(ys).size).toBe(3); // 세 포트가 서로 다른 행
  });

  it("셀 좌표가 겹치지 않는다 (occupancy 충돌 0)", () => {
    const seen = new Set<string>();
    let dup = 0;
    for (const c of mod.cells) {
      const k = `${c.x},${c.y}`;
      if (seen.has(k)) dup++;
      seen.add(k);
    }
    expect(dup).toBe(0);
  });

  it("출력 줄이 unrouted 로 떨어지지 않는다 (좌석 충분)", () => {
    expect(mod.unroutedLines.filter((l) => l.role === "output")).toHaveLength(0);
  });
});
