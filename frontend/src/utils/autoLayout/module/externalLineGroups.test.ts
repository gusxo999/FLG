import { describe, it, expect } from "vitest";
import { externalLineGroups } from "./machineLinkGroup";
import type { IoLine, SupplyCapacity } from "../planner/module/clusterPortPlanner";

/**
 * **외부 줄도 [MachineLinkGroup] 이다** (2026-07-23 사장님 결정).
 *
 * 원료·완제품 줄과 자식↔부모 링크는 **같은 형제 단계**다 — 머신 면에 팔을 앉히고 벨트로
 * 나른다. 다른 건 상대가 안이냐 밖이냐 하나뿐이고, 그건 `from`/`to` 의 **빈 쪽**으로
 * 드러난다. 이 테스트가 지키는 것은 그 대응이지 좌표가 아니다(방출은 아직 옛 경로).
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

  it("원료는 from 이 비고, to 에 이 클러스터 머신들이 전부 든다", () => {
    const g = groups.find((x) => x.item === "iron-plate")!;
    expect(g.from.size).toBe(0); // 밖에서 온다
    expect([...g.to]).toEqual([[0, 4], [1, 4], [2, 4]]);
  });

  it("완제품은 to 가 비고, from 에 머신들이 든다 — 원료의 거울", () => {
    const g = groups.find((x) => x.item === "gear")!;
    expect(g.to.size).toBe(0); // 밖으로 간다
    expect([...g.from]).toEqual([[0, 2], [1, 2], [2, 2]]); // 30/3=10, ceil(10/5)=2
  });

  it("신원이 줄 키를 담는다 — 로그·조회가 줄과 그룹을 이어 볼 수 있게", () => {
    expect(groups.map((g) => g.id)).toEqual(["ext:input:iron-plate", "ext:output:gear"]);
  });
});

describe("그룹이 안 되는 줄 — 지어내지 않는다", () => {
  it("수량 미상이면 그룹을 안 만든다 ([edgeMachineLinks] 와 같은 문턱)", () => {
    // gear 만 rate 가 있다 — iron 은 lineRates 에 없다.
    const partial: SupplyCapacity = { tapCapacity: 5, lineRates: new Map([["output:gear", 30]]) };
    expect(externalLineGroups(lines, 3, partial).map((g) => g.item)).toEqual(["gear"]);
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
    const linked = new Set(["output:gear"]);
    expect(externalLineGroups(lines, 3, cap, linked).map((g) => g.item)).toEqual(["iron-plate"]);
  });
});

// 팔 수는 [requiredInserterCount] 하나에서 온다 — 이 함수가 자기 식을 따로 갖지 않는지.
// (이 세션에 고친 버그들의 공통 원인이 "같은 수를 두 곳이 각자 유도"였다.)
describe("팔 수는 requiredInserterCount 와 같은 값", () => {
  it("머신 수가 늘면 머신당 팔은 줄어든다 — 클러스터 rate 를 나눠 갖는다", () => {
    const one = externalLineGroups(lines, 1, cap)[0].to.get(0);
    const six = externalLineGroups(lines, 6, cap)[0].to.get(0);
    expect(one).toBe(12); // 60/1 = 60, ceil(60/5)
    expect(six).toBe(2); //  60/6 = 10, ceil(10/5)
  });

  it("아무리 적어도 팔은 1개 — 0개면 그 머신은 아예 안 돈다", () => {
    const tiny: SupplyCapacity = { tapCapacity: 5, lineRates: new Map([["input:iron-plate", 0.1]]) };
    expect(externalLineGroups(lines, 3, tiny)[0].to.get(0)).toBe(1);
  });
});
