import { describe, it, expect } from "vitest";
import { generateModule, type ModuleInput } from "./clusterModule";
import { groupLinkBelts, type MachineLink } from "./allocateMachineLinks";

// 출력 fan-out 방출 검증 — 링크 그룹(=벨트) 단위로 "머신당·목적지별" belt 가 갈라 나온다.
// count≥2, W/E 에 앉는 중간 출력 케이스. 그룹핑은 packModuleTree(edgeLinkGroups)가 하므로
// 여기선 같은 함수(groupLinkBelts)로 직접 만들어 넣는다.

const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

// 자식 2대. 머신0 이 부모0·부모1 로 갈라 낸다(fan-out).
//   머신0 → 부모0 (팔1), 머신0 → 부모1 (팔1)  → cap 3 이라 한 벨트로 묶임(트렁크 공유)
//   머신1 → 부모1 (팔1)                        → 자기 벨트
const flat: MachineLink[] = [
  { fromMachine: 0, toMachine: 0, item: "gear", inserterCount: 1 },
  { fromMachine: 0, toMachine: 1, item: "gear", inserterCount: 1 },
  { fromMachine: 1, toMachine: 1, item: "gear", inserterCount: 1 },
];
const groups = groupLinkBelts(flat, 3); // [[c0→p0, c0→p1], [c1→p1]]

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
  outputLinks: groups,
};

describe("emitOutputLinks — 출력 fan-out (그룹=벨트)", () => {
  const mod = generateModule(base);

  it("그룹핑: 같은 자식 머신의 작은 링크들이 한 벨트로 묶인다", () => {
    expect(groups.map((g) => g.length)).toEqual([2, 1]);
  });

  it("그룹마다 출력 포트 하나 (옛 트렁크였다면 gear 포트 1개뿐)", () => {
    expect(mod.outputPorts).toHaveLength(2);
  });

  it("포트가 전부 W면으로 나간다 (부모 쪽으로 꺾임)", () => {
    expect(mod.outputPorts.every((p) => p.face === "W")).toBe(true);
  });

  it("두 벨트가 서로 다른 행에서 나간다", () => {
    const ys = mod.outputPorts.map((p) => p.anchor.y);
    expect(new Set(ys).size).toBe(2);
  });

  it("머신0 벨트는 팔 2개(그룹 합), 머신1 벨트는 팔 1개", () => {
    // 벨트 셀 수 = 팔 수(연속 좌석 k행을 덮는 세로 belt).
    expect(mod.outputPorts.map((p) => p.cells.length).sort()).toEqual([1, 2]);
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
