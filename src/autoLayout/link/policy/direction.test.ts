/**
 * **줄마다 방향**(`directSplitLines`) — 붓기가 낸 줄에 *흘러야 하는 끝* 을 붙이고, 좌석이 그 끝을 지킨다.
 *
 * 잠그는 것 셋:
 * ```
 * 그런 머신이 없는 간선은 손대지 않는다      그 줄들의 방향은 오늘 규칙(형제 순번) 그대로다
 * 레인 합류의 짝은 건드리지 않는다           짝은 같은 끝으로 나가야 선다 — 끝은 합류 도형이 정한다
 * 방향이 정해진 줄은 기둥 끝을 청구하지 않는다  관통이어도 포트가 옆에 선다 — 납품의 차례를 지킨다
 * ```
 */
import { afterEach, describe, expect, it } from "vitest";
import { directSplitLines } from "./direction";
import { packModuleTree } from "../../tree/build";
import { readRunStats } from "../../../debug/runStats";
import { setAutoLayoutLaneMerge } from "../../shared/flags";
import type { IoLine, Link, LinkCarry } from "../../module/types/line";
import type { NodeSpec, PackConfig } from "../../tree/types/pack";

const line = (carries: LinkCarry[], extra: Partial<Link> = {}): Link => ({
  item: "x",
  carries,
  from: new Map(carries.filter((c) => c.from !== undefined).map((c) => [c.from!, 1])),
  to: new Map(carries.filter((c) => c.to !== undefined).map((c) => [c.to!, 1])),
  ...extra,
});

describe("directSplitLines — 줄에 흘러야 하는 끝을 얹는다", () => {
  it("두 줄을 쓰는 머신이 없는 간선은 같은 객체 그대로다", () => {
    const groups = [
      line([{ from: 0, to: 0, rate: 5 }, { from: 1, to: 0, rate: 5 }]),
      line([{ from: 2, to: 1, rate: 5 }, { from: 3, to: 1, rate: 5 }]),
    ];
    const cache = new Map([["c", groups]]);
    directSplitLines(cache);
    expect(cache.get("c")).toBe(groups);
    expect(groups.every((g) => g.requiredEnd === undefined)).toBe(true);
  });

  it("편마다 따로 얹는다 — 싣는 쪽만 갈렸으면 집는 쪽은 비어 있다", () => {
    // 자식 1 이 두 줄을 쓴다(자식 0 · 자식 2 와 함께). 부모는 아무도 두 줄을 안 쓴다.
    const cache = new Map([["c", [
      line([{ from: 0, to: 0, rate: 10 }, { from: 1, to: 1, rate: 2 }]),
      line([{ from: 1, to: 2, rate: 8 }, { from: 2, to: 3, rate: 4 }]),
    ]]]);
    directSplitLines(cache);
    expect(cache.get("c")!.map((g) => g.requiredEnd)).toEqual([{ from: "S" }, { from: "N" }]);
  });

  it("레인 합류의 짝은 건드리지 않는다 — 짝이 아닌 줄만 끝을 받는다", () => {
    const cache = new Map([["c", [
      line([{ from: 0, to: 0, rate: 10 }, { from: 1, to: 1, rate: 2 }], { sharedLineId: "c#lane0" }),
      line([{ from: 1, to: 2, rate: 8 }, { from: 2, to: 3, rate: 4 }]),
    ]]]);
    directSplitLines(cache);
    const [paired, alone] = cache.get("c")!;
    expect(paired.requiredEnd).toBeUndefined();
    expect(alone.requiredEnd).toEqual({ from: "N" });
  });
});

describe("방향이 정해진 줄은 기둥 끝을 청구하지 않는다", () => {
  afterEach(() => setAutoLayoutLaneMerge(false));

  const M = { entityName: "assembling-machine-3", w: 3, h: 3 };
  const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
  const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });
  const config: PackConfig = {
    inserterEntityName: "inserter",
    inserters: [{ entityName: "inserter", reach: 1, throughput: 100 }],
    beltEntityName: "b",
    // 벨트 90/s — 한 줄 45/s. 60/s 는 줄 둘(45 · 15)이 된다.
    belts: [{ entityName: "b", throughput: 90 }],
    reservePerimeterExits: true,
    beltMaxUndergroundDistance: 4,
  };
  /**
   * 자식 넷(15/s 씩)이 부모 둘(30/s 씩)을 먹인다. 첫 줄은 자식 0 · 1 · 2 → 부모 0 · 1 로 45/s, 둘째 줄은 자식 3 → 부모 1 로 15/s.
   * **부모 1 이 두 줄에서 받고, 첫 줄은 부모 둘을 다 지난다(관통).**
   */
  const specs: NodeSpec[] = [
    {
      id: "p", depth: 0, machine: M, count: 2,
      lines: [inL("x"), outL("y")],
      supplyCapacity: { lineRates: new Map([["input:x", 60], ["output:y", 10]]) },
    },
    {
      id: "c", depth: 1, parentId: "p", machine: M, count: 4,
      lines: [outL("x")],
      supplyCapacity: { lineRates: new Map([["output:x", 60]]) },
    },
  ];
  /** 부모가 x 를 받는 포트들과, 부모 머신들이 차지한 행의 범위. */
  const parentPorts = (tree: NodeSpec[] = specs) => {
    const pack = packModuleTree(tree, config);
    const parent = pack.placements.find((pl) => pl.id === "p")!;
    const ys = parent.module.machines.flatMap((m) => [m.origin.y, m.origin.y + m.size.h - 1]);
    return {
      top: Math.min(...ys),
      bottom: Math.max(...ys),
      ports: parent.module.inputPorts.filter((q) => q.line.name === "x"),
    };
  };

  it("부모 1 이 두 줄 모두에서 맨 끝에 서고, 관통 줄의 포트는 기둥 끝이 아니라 부모의 행 옆에 선다", () => {
    setAutoLayoutLaneMerge(false);
    const { top, bottom, ports } = parentPorts();
    expect(readRunStats().splitBelt?.to).toEqual({ split: 1, lastOnAll: 1, lastOnSmaller: 0, notLast: 0, unknown: 0, contestedLines: 0, dropped: 0 });
    expect(ports).toHaveLength(2);
    // 기둥 끝 포트면 상자가 머신 행 범위 밖(위 · 아래)에 선다. 옆 포트는 범위 안의 행에 선다.
    for (const q of ports) {
      expect(q.anchor.y, "포트가 머신 행 범위 안").toBeGreaterThanOrEqual(top);
      expect(q.anchor.y).toBeLessThanOrEqual(bottom);
    }
  });

  it("두 줄을 쓰는 머신이 없으면 관통 줄은 오늘처럼 기둥 끝에 포트를 세운다(대조군)", () => {
    setAutoLayoutLaneMerge(false);
    // 자식 둘(15/s 씩)이 부모 둘(15/s 씩)을 먹인다 — 한 줄(30/s)이 부모 둘을 다 지나고, 아무도 두 줄을 안 쓴다.
    const plain = specs.map((s) =>
      s.id === "p"
        ? { ...s, supplyCapacity: { lineRates: new Map([["input:x", 30], ["output:y", 10]]) } }
        : { ...s, count: 2, supplyCapacity: { lineRates: new Map([["output:x", 30]]) } });
    const { top, bottom, ports } = parentPorts(plain);
    expect(readRunStats().splitBelt?.to.split).toBe(0);
    expect(ports).toHaveLength(1);
    expect(ports[0].anchor.y < top || ports[0].anchor.y > bottom, "포트가 머신 행 범위 밖").toBe(true);
  });
});
