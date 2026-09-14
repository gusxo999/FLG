/**
 * **형태 판독** — 다이렉트·트렁크·관통은 붓기가 **정한** 것이고, 여기서는 그것을 *읽는다*.
 *
 * 이 파일이 지키는 것은 셋이다:
 *  1. **동치 불변식** — 명단(`from`/`to`)으로 읽은 형태와 적재 목록(`carries`)으로 읽은 형태가
 *     같다. 둘은 서로 다른 세 곳이 만든다(`makeLink`·`edgeLinkGroups`·`externalLineGroups`)
 *     — 어긋나면 팔 수와 적재량이 조용히 갈린다.
 *  2. **현행 동작 보존** — `count = 1` 은 관통이 아니다(전부 관통이 되면 포트가 기둥 끝으로 몰린다).
 *  3. **계수기가 진짜 배치를 센다** — 픽스처가 아니라 실제 생산자(`edgeLinkGroups`)가 낸
 *     그룹으로 센다. 손으로 만든 그룹만 세면 생산자가 바뀔 때 계수기가 조용히 거짓말한다.
 */
import { describe, it, expect } from "vitest";
import {
  beltLineForm, flowsOn, machinesOn, externalLineGroups, spansAllMachines, summarizeBeltForms,
} from "./link";
import type { IoLine, Link, LinkCarry } from "./types/line";
import { edgeLinkGroups } from "../planner/modulePacking";
import type { NodeSpec, PackConfig } from "../planner/tree/types";


const line = (name: string, role: "input" | "output"): IoLine => ({ name, kind: "belt", role });

/**
 * 판독만 보는 테스트라 줄을 **리터럴로** 짓는다 — 만드는 쪽([createLinks])을 끌어들이면
 * 판독의 실패인지 붓기의 실패인지 갈리지 않는다. "빈 쪽 = 밖" 규약의 왕복은
 * `link.outside.test.ts` 가 따로 지킨다.
 */
const link = (o: {
  from?: [number, number][]; to?: [number, number][];
  carries?: LinkCarry[]; belt?: string;
}): Link => ({
  item: "glass",
  from: new Map(o.from ?? []),
  to: new Map(o.to ?? []),
  carries: o.carries,
  beltEntityName: "belt" in o ? o.belt : "b",
});

const spec = (
  id: string, count: number, lines: IoLine[], lineRates: Record<string, number>, parentId?: string,
): NodeSpec => ({
  id, depth: parentId ? 1 : 0, parentId,
  machine: { entityName: "m", w: 7, h: 7 },
  count, lines,
  supplyCapacity: { lineRates: new Map(Object.entries(lineRates)) },
});

const config: PackConfig = {
  inserterEntityName: "i",
  inserters: [{ entityName: "i", reach: 1, throughput: 6 }],
  beltEntityName: "b",
  belts: [{ entityName: "b", throughput: 20 }],
};

/** 명단이 말하는 형태 ↔ 적재 목록이 말하는 형태. 이 둘이 갈리면 자료가 어긋난 것이다. */
const agrees = (g: Link): boolean => {
  const byRoster = beltLineForm(g);
  const flows = flowsOn(g);
  if (flows === undefined) return true; // 수량 미상 — 적재 목록이 아무 말도 안 한다
  return byRoster === (flows === 1 ? "direct" : "trunk");
};

describe("판독 — 명단과 적재 목록이 같은 형태를 말한다", () => {
  it("밖으로 나가는 줄: 머신 하나면 다이렉트, 여럿이면 트렁크", () => {
    const one = link({ from: [[0, 2]], carries: [{ from: 0, rate: 15 }] });
    const many = link({ from: [[0, 2], [1, 2]], carries: [{ from: 0, rate: 15 }, { from: 1, rate: 15 }] });
    expect(beltLineForm(one)).toBe("direct");
    expect(beltLineForm(many)).toBe("trunk");
    expect([one, many].every(agrees)).toBe(true);
  });

  it("빈 쪽은 0 이다 — 상대가 모듈 밖이라 셀 머신이 없다", () => {
    const out = link({ from: [[0, 2]] });
    expect(machinesOn(out, "from")).toBe(1);
    expect(machinesOn(out, "to")).toBe(0);
  });

  it("externalLineGroups 가 낸 줄 전부가 동치를 지킨다", () => {
    const groups = externalLineGroups(
      [line("iron-plate", "input"), line("glass", "output")],
      4,
      { lineRates: new Map([["input:iron-plate", 12], ["output:glass", 8]]) },
      config.inserters,
      undefined,
      { belts: config.belts },
    );
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every(agrees)).toBe(true);
  });

  it("edgeLinkGroups(진짜 붓기)가 낸 줄 전부가 동치를 지킨다", () => {
    const child = spec("c", 2, [line("glass", "output")], { "output:glass": 200 });
    const parent = spec("p", 3, [line("glass", "input")], { "input:glass": 181.5 }, "c");
    const groups = edgeLinkGroups(child, parent, "glass", config)!;
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every(agrees)).toBe(true);
  });
});

describe("관통 판독 — count = 1 은 관통이 아니다(현행 동작 보존)", () => {
  const solo = link({ from: [[0, 2]], carries: [{ from: 0, rate: 15 }] });
  const all = link({ from: [[0, 1], [1, 1], [2, 1]] });

  it("한 대짜리 모듈에서는 거짓 — 참이면 포트가 전부 기둥 끝으로 몰린다", () => {
    expect(spansAllMachines(solo, "from", 1)).toBe(false);
  });

  it("전 머신을 만지고 대수가 둘 이상이면 참", () => {
    expect(spansAllMachines(all, "from", 3)).toBe(true);
  });

  it("한 대라도 빠지면 거짓 — 그 줄은 구간이라 포트가 옆에 설 수 있다", () => {
    expect(spansAllMachines(all, "from", 4)).toBe(false);
  });
});

describe("계수기 — 실제 붓기가 낸 줄을 센다", () => {
  const child = spec("c", 2, [line("glass", "output")], { "output:glass": 200 });
  const parent = spec("p", 3, [line("glass", "input")], { "input:glass": 181.5 }, "c");
  const groups = edgeLinkGroups(child, parent, "glass", config)!;
  const c = summarizeBeltForms(
    groups.map((group) => ({ group, fromCount: 2, toCount: 3 })),
    (name) => config.belts?.find((b) => b.entityName === name)?.throughput,
  );

  it("센 줄 수가 실제 그룹 수와 같다 — 빠뜨리는 형태가 없다", () => {
    expect(c.trunk + c.direct).toBe(groups.length);
  });

  it("이용률을 잰다 — 실린 총량이 부모 수요(181.5)와 맞는다", () => {
    expect(c.loaded).toBeCloseTo(181.5, 6);
    expect(c.capacity).toBeGreaterThan(0);
    expect(c.unpourable).toBe(0);
  });

  it("fan-out 은 한 머신이 쓰는 줄 수의 최대다", () => {
    // 자식 2대가 200 을 내고 벨트는 20/s — 한 대가 여러 줄을 쓸 수밖에 없다.
    expect(c.fanOutMax).toBeGreaterThan(1);
  });

  it("과적재를 센다 — 벨트가 못 나르는 양이 실린 줄", () => {
    // 벨트 15/s 에 40/s 를 실은 줄. 합계 이용률로는 다른 줄이 가려 버리므로 **따로** 센다.
    const over = link({ to: [[0, 9]], carries: [{ to: 0, rate: 40 }] });
    const ok = link({ to: [[0, 1]], carries: [{ to: 0, rate: 5 }] });
    const u = summarizeBeltForms(
      [over, ok].map((group) => ({ group, fromCount: 0, toCount: 1 })),
      () => 15,
    );
    expect(u.overloaded).toBe(1);
    // 합계는 45/30 = 150% 라 "넘쳤다"는 알지만 **몇 줄인지**는 못 말한다 — 그래서 둘 다 센다.
    expect(u.loaded / u.capacity).toBeGreaterThan(1);
  });

  it("벨트 티어를 모르면 이용률을 안 지어낸다 — `unpourable` 로 센다", () => {
    const noTier = link({ from: [[0, 1]], carries: [{ from: 0, rate: 5 }], belt: undefined });
    const u = summarizeBeltForms([{ group: noTier, fromCount: 1, toCount: 0 }], () => undefined);
    expect(u.unpourable).toBe(1);
    expect(u.capacity).toBe(0);
  });
});
