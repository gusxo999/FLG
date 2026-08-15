import { describe, it, expect } from "vitest";
import { edgeMachineLinks, type NodeSpec, type PackConfig } from "./modulePacking";
import type { IoLine } from "./module/clusterPortPlanner";

// edgeMachineLinks 는 논리 어댑터 — spec 의 **클러스터 전체** rate 를 대수로 나눠 머신당으로
// 만든 뒤 allocateMachineLinks 로 넘긴다. 그 나눗셈이 맞는지가 이 테스트의 핵심이다.

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

describe("edgeMachineLinks — 클러스터 rate ÷ 대수 → 용어사전 예시 재현", () => {
  // 자식 2대가 총 200 산출(머신당 100), 부모 3대가 총 181.5 필요(머신당 60.5).
  const child = spec("c", 2, [line("glass", "output")], { "output:glass": 200 });
  const parent = spec("p", 3, [line("glass", "input")], { "input:glass": 181.5 }, "c");
  const links = edgeMachineLinks(child, parent, "glass", config)!;

  const belts = (from: number, to: number) =>
    links.filter((l) => l.fromMachine === from && l.toMachine === to).map((l) => l.inserterCount);

  it("어댑터가 링크를 낸다(rate 있으니 undefined 아님)", () => {
    expect(links).toBeDefined();
  });

  it("÷대수 가 맞으면 순수 함수와 동일한 결과가 나온다", () => {
    expect(belts(0, 0)).toEqual([3, 3, 3, 2]);
    expect(belts(0, 1)).toEqual([3, 2]);
    expect(belts(1, 1)).toEqual([3, 3]);
    expect(belts(1, 2)).toEqual([3, 3, 3, 1]);
  });
});

describe("edgeMachineLinks — 전제 미충족이면 undefined(지어내지 않는다)", () => {
  const child = spec("c", 1, [line("x", "output")], { "output:x": 10 });
  const parent = spec("p", 1, [line("x", "input")], { "input:x": 10 }, "c");

  it("rate(supplyCapacity) 없으면 undefined", () => {
    const noRate: NodeSpec = { ...child, supplyCapacity: undefined };
    expect(edgeMachineLinks(noRate, parent, "x", config)).toBeUndefined();
  });

  // 팔 하나의 처리량 출처는 **하나뿐**이다(2026-07-23). 그 자리가 2026-08-15 에
  // `supplyCapacity.tapCapacity`(노드마다) 에서 **`PackConfig.inserters`(전역 선택)** 로
  // 옮겼다 — 인서터는 사용자가 위저드에서 한 번 고르는 것이라 노드마다 다를 수가 없고,
  // 노드에 실어 나르면 같은 사실이 노드 수만큼 복제된다(계획서 §18).
  //
  // 예전엔 `config.throughput` 에서 여기서 다시 유도했는데, moduleWizard 도 같은 값을
  // 따로 계산해 담고 있어 유도가 두 곳이었다 — 한쪽만 고쳐 조용히 어긋났다(벨트 포화).
  it("팔 처리량(config.inserters) 없으면 undefined", () => {
    const noTp: PackConfig = { ...config, inserters: [] };
    expect(edgeMachineLinks(child, parent, "x", noTp)).toBeUndefined();
  });

  it("벨트 없으면 undefined", () => {
    const noBelt: PackConfig = { ...config, belts: [] };
    expect(edgeMachineLinks(child, parent, "x", noBelt)).toBeUndefined();
  });
});
