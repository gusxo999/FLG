import { describe, it, expect } from "vitest";
import { edgeLinkGroups, edgeFlows, type NodeSpec, type PackConfig } from "./modulePacking";
import type { IoLine } from "./module/clusterPortPlanner";
import { groupRate } from "../module/link";

// edgeFlows 는 논리 어댑터 — spec 의 **클러스터 전체** rate 를 대수로 나눠 머신당으로
// 만든 뒤 allocateFlows 로 넘긴다. 그 나눗셈이 맞는지가 이 테스트의 핵심이다.

const line = (name: string, role: "input" | "output"): IoLine => ({ name, kind: "belt", role });

const spec = (
  id: string,
  count: number,
  lines: IoLine[],
  lineRates: Record<string, number>,
  parentId?: string,
): NodeSpec => ({
  id,
  depth: parentId ? 1 : 0,
  parentId,
  machine: { entityName: "m", w: 7, h: 7 },
  count,
  lines,
  supplyCapacity: { lineRates: new Map(Object.entries(lineRates)) },
});

// 인서터 6 · 벨트 20 → 용어사전 예시와 같은 수치.
const config: PackConfig = {
  inserterEntityName: "i",
  inserters: [{ entityName: "i", reach: 1, throughput: 6 }],
  beltEntityName: "b",
  belts: [{ entityName: "b", throughput: 20 }],
};

describe("edgeFlows — 클러스터 rate ÷ 대수 → 용어사전 예시 재현", () => {
  // 자식 2대가 총 200 산출(머신당 100), 부모 3대가 총 181.5 필요(머신당 60.5).
  const child = spec("c", 2, [line("glass", "output")], { "output:glass": 200 });
  const parent = spec("p", 3, [line("glass", "input")], { "input:glass": 181.5 }, "c");
  const links = edgeFlows(child, parent, "glass", config)!;

  const flow = (from: number, to: number) =>
    links.filter((l) => l.fromMachine === from && l.toMachine === to).map((l) => l.rate);

  it("어댑터가 흐름을 낸다(rate 있으니 undefined 아님)", () => {
    expect(links).toBeDefined();
  });

  it("÷대수 가 맞으면 순수 함수와 동일한 결과가 나온다", () => {
    // 머신당 산출 200÷2=100, 머신당 필요 181.5÷3=60.5 → 순수 함수 테스트와 같은 흐름 넷.
    expect(flow(0, 0)).toEqual([60.5]);
    expect(flow(0, 1)).toEqual([39.5]);
    expect(flow(1, 1)).toEqual([21]);
    expect(flow(1, 2)).toEqual([60.5]);
  });

  it("벨트 줄 수는 `determineBeltCount(총 수요)` **이상**이다", () => {
    // 총 181.5 · 벨트 20 → 벨트 축만 보면 10줄(9×20 + 나머지 1.5).
    // **좌석 축이 줄을 더 부를 수 있다**: 부모 한 대가 60.5 를 먹는데 한 줄이 그 머신에게
    // 줄 수 있는 최대는 `좌석 7 × 팔 6 = 42` 라, 그 부모는 최소 두 줄에서 받아야 한다.
    // 두 축은 서로 유도되지 않는다 — 그래서 등호가 아니라 하한이다.
    const groups = edgeLinkGroups(child, parent, "glass", config)!;
    expect(groups.length).toBeGreaterThanOrEqual(10);
  });

  it("어느 줄도 벨트 처리량을 넘게 싣지 않는다", () => {
    const groups = edgeLinkGroups(child, parent, "glass", config)!;
    for (const g of groups) expect(groupRate(g) ?? 0).toBeLessThanOrEqual(20 + 1e-9);
  });

  it("접어도 총량이 보존된다 — 흐르다 새는 것이 없다", () => {
    const groups = edgeLinkGroups(child, parent, "glass", config)!;
    const carried = groups.reduce((s, g) => s + (groupRate(g) ?? 0), 0);
    expect(carried).toBeCloseTo(181.5, 9);
  });
});

describe("edgeLinkGroups — 형태 셋이 접기 하나에서 나온다", () => {
  // 벨트 90/s · 인서터 90/s(상한에서 접힘). 자식 1대 100/s, 부모 7대 각 15/s(총 105)
  // → 사장님 예(2026-08-22)와 같은 입력. 자식이 100 뿐이라 마지막 부모는 10 만 받는다.
  const fast: PackConfig = {
    inserterEntityName: "i",
    inserters: [{ entityName: "i", reach: 1, throughput: 90 }],
    beltEntityName: "b",
    belts: [
      { entityName: "b90", throughput: 90 },
      { entityName: "b15", throughput: 15 },
    ],
  };
  const child = spec("c", 1, [line("sand", "output")], { "output:sand": 100 });
  const parent = spec("p", 7, [line("sand", "input")], { "input:sand": 105 }, "c");
  const groups = edgeLinkGroups(child, parent, "sand", fast)!;

  it("벨트 두 줄 — 90 을 나르는 줄과 나머지를 나르는 줄", () => {
    expect(groups.map((g) => groupRate(g))).toEqual([90, 10]);
  });

  it("첫 줄은 **트렁크** — 부모 여섯이 그 한 줄에서 집는다", () => {
    expect(groups[0].to.size).toBe(6);
  });

  it("둘째 줄은 **다이렉트** — 부모 하나만 상대한다", () => {
    expect(groups[1].to.size).toBe(1);
    expect(groups[1].from.size).toBe(1);
  });

  it("적재 목록이 **흐름별로** 몇 개인지 든다 — `toMachine` 이 장부가 아니라 계약이다", () => {
    // 두 명단(`from`/`to`)만 들던 시절엔 *0번 자식이 6번·7번에게 각각 얼마씩* 인지를
    // 표현할 수 없었다. 이제 그 대응이 목록에 그대로 있다.
    expect(groups[0].carries).toEqual([
      { from: 0, to: 0, rate: 15 },
      { from: 0, to: 1, rate: 15 },
      { from: 0, to: 2, rate: 15 },
      { from: 0, to: 3, rate: 15 },
      { from: 0, to: 4, rate: 15 },
      { from: 0, to: 5, rate: 15 },
    ]);
    expect(groups[1].carries).toEqual([{ from: 0, to: 6, rate: 10 }]);
  });

  it("`from`/`to` 명단은 적재 목록에서 유도된다 — 팔은 머신마다 한 번만 올린다", () => {
    // 자식 0 은 첫 줄에 90/s 를 싣는다 → 팔 하나(90/s)로 족하다. 조각(15)마다 올렸다면 6개.
    expect([...groups[0].from]).toEqual([[0, 1]]);
    expect([...groups[0].to]).toEqual([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]);
  });

  it("벨트 티어를 그룹이 든다 — 접기가 고른 그것", () => {
    expect(groups.map((g) => g.beltEntityName)).toEqual(["b90", "b15"]);
  });

  it("**쪼갬이 아니다** — 어떤 (자식,부모) 쌍도 두 줄에 걸치지 않는다", () => {
    const pairs = groups.flatMap((g) =>
      [...g.from.keys()].flatMap((f) => [...g.to.keys()].map((t) => `${f}->${t}`)),
    );
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe("edgeFlows — 전제 미충족이면 undefined(지어내지 않는다)", () => {
  const child = spec("c", 1, [line("x", "output")], { "output:x": 10 });
  const parent = spec("p", 1, [line("x", "input")], { "input:x": 10 }, "c");

  it("rate(supplyCapacity) 없으면 undefined", () => {
    const noRate: NodeSpec = { ...child, supplyCapacity: undefined };
    expect(edgeFlows(noRate, parent, "x", config)).toBeUndefined();
  });

  // 팔 하나의 처리량 출처는 **하나뿐**이다(2026-07-23). 그 자리가 2026-08-15 에
  // `supplyCapacity.tapCapacity`(노드마다) 에서 **`PackConfig.inserters`(전역 선택)** 로
  // 옮겼다 — 인서터는 사용자가 위저드에서 한 번 고르는 것이라 노드마다 다를 수가 없고,
  // 노드에 실어 나르면 같은 사실이 노드 수만큼 복제된다(`docs/용어사전.md §BuildSpec`).
  //
  // 예전엔 `config.throughput` 에서 여기서 다시 유도했는데, moduleWizard 도 같은 값을
  // 따로 계산해 담고 있어 유도가 두 곳이었다 — 한쪽만 고쳐 조용히 어긋났다(벨트 포화).
  it("팔 처리량(config.inserters) 없으면 undefined", () => {
    const noTp: PackConfig = { ...config, inserters: [] };
    expect(edgeFlows(child, parent, "x", noTp)).toBeUndefined();
  });

  it("벨트 없으면 undefined", () => {
    const noBelt: PackConfig = { ...config, belts: [] };
    expect(edgeFlows(child, parent, "x", noBelt)).toBeUndefined();
  });
});
