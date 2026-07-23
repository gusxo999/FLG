import { describe, it, expect } from "vitest";
import { externalLineGroups, isInternalLink } from "./allocateMachineLinks";
import type { IoLine, SupplyCapacity } from "./clusterPortPlanner";

/**
 * **외부 줄도 [MachineLinkGroup] 이다** (2026-07-23 사장님 결정).
 *
 * 원료·완제품 줄과 자식↔부모 링크는 **같은 형제 단계**다 — 머신 면에 팔을 앉히고 벨트로
 * 나른다. 다른 건 상대가 안이냐 밖이냐 하나뿐이고, 그건 `from`/`to` 의 **빈 쪽**으로 드러난다.
 *
 * 그리고 언제나 [[ParallelBelt]](머신마다 자기 벨트)로 낸다 — 관통 한 줄로 합치는 것은
 * 좌표가 생긴 뒤의 최적화다.
 */
const lines: IoLine[] = [
  { name: "iron-plate", kind: "belt", role: "input" },
  { name: "gear", kind: "belt", role: "output" },
];

/** 머신 3대, 팔 하나가 초당 5개. iron 60/3대 = 20 → ceil(20/5) = 팔 4개/머신. */
const cap: SupplyCapacity = {
  tapCapacity: 5,
  lineRates: new Map([
    ["input:iron-plate", 60],
    ["output:gear", 30],
  ]),
};

describe("외부 줄 → MachineLinkGroup — 빈 쪽이 곧 '밖'이다", () => {
  const groups = externalLineGroups(lines, 3, cap);

  it("원료는 from 이 비고, to 에 머신이 든다", () => {
    const g = groups.filter((x) => x.item === "iron-plate");
    expect(g.every((x) => x.from.size === 0)).toBe(true); // 밖에서 온다
    expect(g.map((x) => [...x.to][0])).toEqual([[0, 4], [1, 4], [2, 4]]);
  });

  it("완제품은 to 가 비고, from 에 머신이 든다 — 원료의 거울", () => {
    const g = groups.filter((x) => x.item === "gear");
    expect(g.every((x) => x.to.size === 0)).toBe(true); // 밖으로 간다
    expect(g.map((x) => [...x.from][0])).toEqual([[0, 2], [1, 2], [2, 2]]); // 30/3=10, ceil(10/5)=2
  });

  it("밖으로 나가는 줄은 간선 신원을 안 단다 — 짝이 없다", () => {
    expect(groups.some(isInternalLink)).toBe(false);
    // 양쪽이 다 안이면 참 — 내부 링크의 모양.
    expect(isInternalLink({ item: "x", from: new Map([[0, 1]]), to: new Map([[1, 1]]) })).toBe(true);
  });
});

// **머신마다 자기 벨트** — 관통 한 줄(A)이 아니라 [[ParallelBelt]](B)로 낸다.
describe("언제나 ParallelBelt — 머신 하나짜리 그룹만 낸다", () => {
  it("머신 3대면 줄 하나가 그룹 3개가 된다 (합쳐서 하나가 아니라)", () => {
    const g = externalLineGroups([lines[0]], 3, cap);
    expect(g).toHaveLength(3);
    // 어떤 그룹도 머신을 둘 이상 건드리지 않는다 — 이게 곧 tryLinkFace 를 통과하는 조건이다.
    expect(g.every((x) => x.to.size === 1)).toBe(true);
  });

  it("신원이 줄·머신·벨트를 다 담는다 — 로그에서 어느 벨트인지 짚을 수 있게", () => {
    expect(externalLineGroups([lines[1]], 2, cap).map((x) => x.id)).toEqual([
      "ext:output:gear#m0b0",
      "ext:output:gear#m1b0",
    ]);
  });
});

// 한 머신 몫이 한 줄에 다 안 실리면 그 머신도 여러 줄로 갈린다. **팔을 깎지 않는다.**
describe("벨트 하나에 앉는 팔 수 — 두 물리 상한의 작은 쪽", () => {
  const iron = [lines[0]];
  /** 머신 **1대**가 30/s 를 먹는다 → 팔 6개. 아래 쪼개기를 한 머신 안에서 본다. */
  const six: SupplyCapacity = { tapCapacity: 5, lineRates: new Map([["input:iron-plate", 30]]) };
  const armsPerBelt = (g: ReturnType<typeof externalLineGroups>): number[] =>
    g.map((x) => [...x.to.values()][0]);

  it("여유가 있으면 한 줄 — 벨트 45/s ÷ 팔 5/s = 한 줄에 9개까지", () => {
    expect(armsPerBelt(externalLineGroups(iron, 1, six, { beltThroughput: 45 }))).toEqual([6]);
  });

  it("벨트가 느리면 갈린다 — 15/s ÷ 5/s = 한 줄에 3개, 6개는 두 줄", () => {
    expect(armsPerBelt(externalLineGroups(iron, 1, six, { beltThroughput: 15 }))).toEqual([3, 3]);
  });

  it("면 좌석도 상한이다 — 팔은 그 면 칸 수보다 많이 못 앉는다", () => {
    expect(armsPerBelt(externalLineGroups(iron, 1, six, { seatsPerFace: 3 }))).toEqual([3, 3]);
  });

  it("둘 다 주면 작은 쪽이 이긴다", () => {
    const g = externalLineGroups(iron, 1, six, { beltThroughput: 45, seatsPerFace: 2 });
    expect(armsPerBelt(g)).toEqual([2, 2, 2]); // 좌석 2 < 그릇 9
  });

  it("상한을 하나도 모르면 안 쪼갠다 — 지어내지 않는다", () => {
    expect(armsPerBelt(externalLineGroups(iron, 1, six))).toEqual([6]);
  });

  it("깎지 않는다 — 몇 줄로 갈리든 팔 총합은 언제나 그대로", () => {
    for (const bt of [10, 15, 20, 45]) {
      const g = externalLineGroups(iron, 1, six, { beltThroughput: bt });
      expect(armsPerBelt(g).reduce((a, b) => a + b, 0)).toBe(6);
    }
  });

  it("머신마다 따로 갈린다 — 3대면 각자 자기 벨트들을 갖는다", () => {
    const heavy: SupplyCapacity = { tapCapacity: 5, lineRates: new Map([["input:iron-plate", 90]]) };
    const g = externalLineGroups(iron, 3, heavy, { beltThroughput: 15 }); // 30/대 → 팔 6 → 3+3
    expect(g.map((x) => x.id)).toEqual([
      "ext:input:iron-plate#m0b0", "ext:input:iron-plate#m0b1",
      "ext:input:iron-plate#m1b0", "ext:input:iron-plate#m1b1",
      "ext:input:iron-plate#m2b0", "ext:input:iron-plate#m2b1",
    ]);
  });
});

describe("그룹이 안 되는 줄 — 지어내지 않는다", () => {
  it("수량 미상이면 그룹을 안 만든다 ([edgeMachineLinks] 와 같은 문턱)", () => {
    const partial: SupplyCapacity = { tapCapacity: 5, lineRates: new Map([["output:gear", 30]]) };
    expect(new Set(externalLineGroups(lines, 3, partial).map((g) => g.item))).toEqual(new Set(["gear"]));
  });

  it("팔 처리량을 모르면 하나도 안 만든다", () => {
    expect(externalLineGroups(lines, 3, { lineRates: cap.lineRates })).toHaveLength(0);
  });

  it("유체는 벨트 장부에 안 올린다 — 트렁크 파이프의 일이다", () => {
    const fluid: IoLine[] = [{ name: "water", kind: "pipe", role: "input" }];
    const c: SupplyCapacity = { tapCapacity: 5, lineRates: new Map([["input:water", 60]]) };
    expect(externalLineGroups(fluid, 3, c)).toHaveLength(0);
  });

  it("이미 내부 링크가 있는 줄은 두 번 세지 않는다", () => {
    const linkedKeys = new Set(["output:gear"]);
    const g = externalLineGroups(lines, 3, cap, { linkedKeys });
    expect(new Set(g.map((x) => x.item))).toEqual(new Set(["iron-plate"]));
  });
});

// 팔 수는 [requiredInserterCount] 하나에서 온다 — 이 함수가 자기 식을 따로 갖지 않는지.
// (이 세션에 고친 버그들의 공통 원인이 "같은 수를 두 곳이 각자 유도"였다.)
describe("팔 수는 requiredInserterCount 와 같은 값", () => {
  it("머신 수가 늘면 머신당 팔은 줄어든다 — 클러스터 rate 를 나눠 갖는다", () => {
    expect([...externalLineGroups([lines[0]], 1, cap)[0].to.values()][0]).toBe(12); // 60/1, ceil(60/5)
    expect([...externalLineGroups([lines[0]], 6, cap)[0].to.values()][0]).toBe(2); //  60/6, ceil(10/5)
  });

  it("아무리 적어도 팔은 1개 — 0개면 그 머신은 아예 안 돈다", () => {
    const tiny: SupplyCapacity = { tapCapacity: 5, lineRates: new Map([["input:iron-plate", 0.1]]) };
    expect([...externalLineGroups([lines[0]], 3, tiny)[0].to.values()][0]).toBe(1);
  });
});
