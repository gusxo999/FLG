import { describe, it, expect } from "vitest";
import { generateModule, type ModuleInput } from "../../module/clusterModule";
import type { MachineLinkGroup } from "../../module/machineLinkGroup";
import { EntityType } from "../../../types/layout";

// 입력 fan-in 방출 — [emitOutputLinks] 의 거울.
//
// v1 은 **링크 하나 = 벨트 하나**라 벨트가 남의 머신 행을 관통하는 일이 없다.
// 관통이 없으니 그룹끼리 depth 를 다툴 일도 없어, 행 구간만 안 겹치면
// **같은 depth 를 그냥 나눠 쓴다**.
const M = { entityName: "assembling-machine-3", w: 3, h: 3 };

/** 머신 여럿을 맡는 그룹 — **트렁크**다. 벨트 하나가 세 머신의 좌석을 함께 먹인다. */
const spanning: MachineLinkGroup[] = [
  {
    item: "x",
    from: new Map([[0, 3]]),
    to: new Map([[0, 1], [1, 1], [2, 1]]),
  },
];

const base: ModuleInput = {
  machine: M,
  count: 3,
  lines: [{ name: "x", kind: "belt", role: "input" }],
  inserterEntityName: "inserter",
  inserters: [{ entityName: "inserter", reach: 1, throughput: 0 }, { entityName: "long-handed-inserter", reach: 2, throughput: 0 }],
  beltEntityName: "transport-belt",
  inputLinks: spanning,
};

// **관통이 열렸다** (2026-08-16 — 계획서 §19).
//
// 예전엔 `tryLinkFace` 가 `arms.size !== 1` 로 이런 그룹을 통째로 거절했다. 사유는 *"관통하는
// 순간 다른 그룹과 depth 를 다퉈야 한다"* 였는데, **W/E 면에서는 그 다툼이 없다**: 나가는
// 방향이 면과 수직이라 벨트가 자기 좌석 구간만 덮고 끝에서 꺾으므로, 여러 그룹이 같은 깊이를
// **행으로 나눠 쓴다**. 아래 두 번째 describe 가 그 성질을 따로 못 박는다.
//
// 그래서 이 그룹은 이제 **트렁크로 앉는다** — 벨트 하나 · 포트 하나 · 머신마다 좌석 하나.
describe("머신 여럿을 맡는 그룹 — 트렁크로 앉는다", () => {
  const mod = generateModule(base);

  it("벨트 하나에 포트 하나 — 다이렉트였다면 셋이었다", () => {
    expect(mod.unroutedLines).toHaveLength(0);
    expect(mod.inputPorts).toHaveLength(1);
  });

  it("머신마다 탭 인서터가 하나씩 — 세 대가 같은 벨트에서 집는다", () => {
    const inserters = mod.cells.filter((c) => c.cell.entityType === EntityType.Inserter);
    // 탭 3개 + 포트 인서터 1개(벨트 → 상자).
    expect(inserters).toHaveLength(4);
  });

  it("벨트가 세 머신의 좌석 행을 모두 덮는다 — 구멍이 있으면 뒤쪽이 굶는다", () => {
    const belts = mod.cells.filter((c) => c.cell.entityType === EntityType.Belt);
    const col = new Set(belts.map((c) => c.x));
    expect(col.size, "트렁크는 한 열(레인)에 선다").toBe(1);
    const ys = belts.map((c) => c.y).sort((a, b) => a - b);
    // 연속이어야 한다 — 끊기면 그 너머는 아무도 못 잡는다(계획서 §3 조건 ⑤).
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBe(1);
    const seats = mod.cells.filter((c) => c.cell.entityType === EntityType.Inserter).map((c) => c.y);
    for (const m of mod.machines) {
      const seat = seats.find((y) => y >= m.origin.y && y < m.origin.y + m.size.h);
      expect(seat, `머신 ${m.id} 의 좌석`).toBeDefined();
      expect(ys).toContain(seat!); // 그 좌석 행에 벨트가 있다
    }
  });

  it("셀이 겹치지 않는다", () => {
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

describe("머신마다 자기 벨트 — 여럿이 같은 깊이를 나눠 쓴다", () => {
  const disjoint: MachineLinkGroup[] = [
    { item: "x", from: new Map([[0, 1]]), to: new Map([[0, 1]]) },
    { item: "x", from: new Map([[1, 1]]), to: new Map([[1, 1]]) },
  ];
  const mod = generateModule({ ...base, inputLinks: disjoint });

  it("둘 다 기본 레인(d=2) — 행이 안 겹치니 다툴 게 없다", () => {
    expect(mod.unroutedLines).toHaveLength(0);
    expect(mod.inputPorts).toHaveLength(2);
    expect(mod.inputPorts.every((p) => p.meta.laneDepth === 2)).toBe(true);
  });

  // 순서 우선(문서 체크리스트 "(나)") — 입력 쪽도 정렬 없이 그룹 배열 순서 그대로 좌석
  // 행에 앉는다(emitOutputLinks.test.ts 의 같은 불변식, 입력 방향에서 확인).
  it("그룹 배열 순서 = 좌석 행 순서 — 정렬 없이 그대로", () => {
    const rows = mod.inputPorts.map((p) => p.anchor.y);
    const sorted = [...rows].sort((a, b) => a - b);
    expect(rows).toEqual(sorted);
  });
});

// **[[ParallelBelt]] — 막힌 면, 입력 쪽** — [emitOutputLinks] 의 거울. 입력의 포트는 **동쪽**이라 좌석도
// 동쪽부터 채운다: 그래야 포트에 가까운 그룹이 얕은 줄을 쓰고, 먼 그룹의 줄이 가까운 그룹의
// 열 위를 밟지 않는다(출력은 포트가 서쪽이라 서→동으로 채운다).
describe("ParallelBelt(막힌 면, 입력) — 한 면에 벨트 여러 줄, 합류 없음", () => {
  const linked = {
    machine: M,
    count: 2,
    inserterEntityName: "inserter",
    inserters: [{ entityName: "inserter", reach: 1, throughput: 0 }, { entityName: "long-handed-inserter", reach: 2, throughput: 0 }],
    beltEntityName: "transport-belt",
    lines: [{ name: "x", kind: "belt", role: "input" as const }],
  };
  // 머신0 의 E면(3행)을 첫 그룹이 채우고, 넘친 그룹 **둘**이 같은 gap 면(S)으로 간다.
  const mod = generateModule({
    ...linked,
    inputLinks: [
      { item: "x", from: new Map([[0, 3]]), to: new Map([[0, 3]]) }, // E 를 채움
      { item: "x", from: new Map([[1, 1]]), to: new Map([[0, 1]]) }, // → gap 1번째
      { item: "x", from: new Map([[2, 1]]), to: new Map([[0, 1]]) }, // → gap 2번째
    ],
  } as ModuleInput);

  it("셋 다 살아남는다 — 예전엔 입력 gap 이 면당 한 줄이라 셋째가 거절됐다", () => {
    expect(mod.inputPorts).toHaveLength(3);
    expect(mod.unroutedLines).toHaveLength(0);
  });

  it("gap 두 그룹이 서로 다른 줄에 선다 — 합류하지 않는다", () => {
    const [, a, b] = mod.inputPorts;
    expect(Math.abs(a.anchor.y - b.anchor.y)).toBe(1);
  });

  it("좌석을 동쪽부터 채운다 — 첫 gap 그룹이 더 동쪽에 앉는다", () => {
    // 벨트의 **동쪽 끝**으로는 못 잰다 — 자기 줄로 내려간 그룹도 반출 줄이 동쪽 변까지 가므로
    // 둘 다 같은 값이 나온다. 좌석이 어디까지 뻗었나(= 서쪽 끝)를 봐야 순서가 드러난다.
    const [, a, b] = mod.inputPorts;
    const westmost = (p: (typeof mod.inputPorts)[number]) => Math.min(...p.cells.map((c) => c.x));
    expect(westmost(a)).toBeGreaterThan(westmost(b));
  });

  it("포트는 둘 다 클러스터 동쪽 변 밖에 선다", () => {
    const east = mod.machines[0].origin.x + mod.machines[0].size.w - 1;
    for (const p of mod.inputPorts.slice(1)) expect(p.anchor.x).toBeGreaterThan(east);
  });

  it("셀이 겹치지 않는다", () => {
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
