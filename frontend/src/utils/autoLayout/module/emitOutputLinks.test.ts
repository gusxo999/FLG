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

// 2026-07-19 등재했던 갭의 회귀 테스트 — 링크 방출이 tap 분기 안에만 있어서, 링크 없는 줄이
// 좌석을 넘겨 모듈이 direct 로 떨어지면 **링크 포트가 통째로 사라졌다**(자식 direct + 부모 tap
// → 포트 모양이 어긋나 홉이 샘). 이제 링크 방출은 모드 판정 **이전에, 무관하게** 돈다.
describe("링크 방출은 tap/direct 판정과 무관하다", () => {
  const mod = generateModule({
    machine: M,
    count: 1,
    lines: [
      { name: "heavy", kind: "belt", role: "input" }, // 좌석 초과 유발(링크 없음)
      { name: "gear", kind: "belt", role: "output" }, // 링크 줄
    ],
    inserterEntityName: "inserter",
    beltEntityName: "transport-belt",
    longInserter: { entityName: "long-handed-inserter", reach: 2 },
    throughput: { normal: 6, long: 6 },
    belts: [{ entityName: "transport-belt", throughput: 20 }],
    supplyCapacity: {
      tapCapacity: 6,
      lineRates: new Map([["input:heavy", 60], ["output:gear", 6]]), // heavy = 팔 10개 → 좌석 초과
    },
    outputLinks: [[{ fromMachine: 0, toMachine: 0, item: "gear", inserterCount: 1 }]],
  });

  it("링크 없는 줄이 좌석을 넘겨 모듈은 direct 로 떨어진다", () => {
    expect(mod.supply?.mode).toBe("direct");
  });

  it("그래도 링크 출력 포트는 그대로 나온다 — 개수만이 아니라 **모양**이 링크다", () => {
    const gear = mod.outputPorts.filter((p) => p.line.name === "gear");
    expect(gear).toHaveLength(1);
    // 개수로는 옛 버그를 못 잡는다 — 옛 코드도 direct 방출로 gear 포트를 하나 냈다.
    // 구분은 모양: 링크 포트는 **자기 벨트**를 갖고(anchor 는 그 벨트 바깥 2칸),
    // 다이렉트 포트는 벨트가 없다(cells: []).
    expect(gear[0].cells.length).toBeGreaterThan(0);
  });

  it("링크가 먼저 먹은 좌석을 나머지 줄이 안 밟는다 (셀 충돌 0)", () => {
    const seen = new Set<string>();
    let dup = 0;
    for (const c of mod.cells) {
      const k = `${c.x},${c.y}`;
      if (seen.has(k)) dup++;
      seen.add(k);
    }
    expect(dup).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 면 넘나들기(거대 출력) — 머신 하나의 한 면에는 인서터가 h개까지만 앉는다(d1 칸이 그것뿐).
// 팔이 그보다 많으면 **N/S(gap)** 로 넘어간다. 반대 옆면(E)이 아닌 이유: E 로 넘기면 벨트가
// 채널 반대쪽에서 출발해 **되돌아올 길이 없다**. gap 으로 넘기면 가로 벨트가 서쪽 변까지 와서
// 90° 꺾이고, 그 꺾이는 칸이 곧 평범한 W 포트다.
// ─────────────────────────────────────────────────────────────────────────────

const linkedBase = {
  machine: M,
  count: 2,
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
  throughput: { normal: 2.4, long: 1.2 },
  belts: [{ entityName: "transport-belt", throughput: 15 }],
};

describe("거대 출력 — W면이 차면 gap 으로 넘어간다", () => {
  // 머신 0 에서 팔 5개(그룹 3 + 그룹 2). W면 좌석은 h=3 뿐 → 둘째 그룹은 아래 gap 으로.
  const mod = generateModule({
    ...linkedBase,
    lines: [{ name: "gear", kind: "belt", role: "output" }],
    outputLinks: [
      [{ fromMachine: 0, toMachine: 0, item: "gear", inserterCount: 3 }],
      [{ fromMachine: 0, toMachine: 1, item: "gear", inserterCount: 2 }],
    ],
  } as ModuleInput);

  it("두 그룹 다 살아남는다 (넘친 쪽을 버리지 않는다)", () => {
    expect(mod.outputPorts).toHaveLength(2);
    expect(mod.unroutedLines).toHaveLength(0);
  });

  it("둘 다 W 로 나간다 — gap 그룹도 모서리에서 꺾여 평범한 W 포트가 된다", () => {
    expect(mod.outputPorts.map((p) => p.face)).toEqual(["W", "W"]);
    expect(mod.outputPorts.map((p) => p.meta.side)).toEqual(["W", "W"]);
  });

  it("팔 합은 언제나 total (3+2)", () => {
    expect(mod.outputPorts.map((p) => p.cells.length)).toEqual([3, 2]);
  });

  it("gap 이 열린다 — 머신 두 대가 더 이상 밀착이 아니다", () => {
    const [m0, m1] = mod.machines;
    expect(m1.origin.y - (m0.origin.y + m0.size.h)).toBe(2); // 좌석 1줄 + 가로 벨트 1줄
  });

  it("gap 포트는 gap 행에 선다 (머신 행이 아니다)", () => {
    const [m0] = mod.machines;
    const corner = mod.outputPorts[1];
    expect(corner.anchor.y).toBeGreaterThanOrEqual(m0.origin.y + m0.size.h);
  });

  it("셀 좌표가 겹치지 않는다", () => {
    const seen = new Set<string>();
    let dup = 0;
    for (const c of mod.cells) {
      const k = `${c.x},${c.y}`;
      if (seen.has(k)) dup++;
      seen.add(k);
    }
    expect(dup).toBe(0);
  });
});

// 넘침이 **남의 선호 면**을 먼저 먹으면 안 된다 — 배정은 ① 양쪽의 선호 면 ② 남은 gap 순이다.
describe("넘침은 남의 선호 면을 먼저 먹지 않는다", () => {
  const mod = generateModule({
    ...linkedBase,
    lines: [
      { name: "gear", kind: "belt", role: "output" },
      { name: "iron", kind: "belt", role: "input" },
    ],
    outputLinks: [
      [{ fromMachine: 0, toMachine: 0, item: "gear", inserterCount: 3 }],
      [{ fromMachine: 0, toMachine: 1, item: "gear", inserterCount: 2 }], // W 초과분
    ],
    inputLinks: [[{ fromMachine: 9, toMachine: 0, item: "iron", inserterCount: 3 }]],
  } as ModuleInput);

  it("입력은 선호 면(E)을 그대로 얻는다", () => {
    const iron = mod.inputPorts.filter((p) => p.line.name === "iron");
    expect(iron).toHaveLength(1);
    expect(iron[0].face).toBe("E");
    expect(iron[0].cells.length).toBe(3);
  });

  it("출력 넘침은 gap 으로 가고 아무도 안 굶는다", () => {
    expect(mod.outputPorts).toHaveLength(2);
    expect(mod.unroutedLines).toHaveLength(0);
  });
});
