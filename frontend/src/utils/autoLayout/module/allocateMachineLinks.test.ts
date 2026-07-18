import { describe, it, expect } from "vitest";
import { allocateMachineLinks, type MachineLink } from "./allocateMachineLinks";

// 한 자식이 한 부모에게 놓은 벨트들을 [인서터 수, ...] 로 압축(사장님 예시와 대조하기 쉽게).
const beltsFor = (links: MachineLink[], from: number, to: number): number[] =>
  links.filter((l) => l.fromMachine === from && l.toMachine === to).map((l) => l.inserterCount);

const totalInserters = (links: MachineLink[], from: number): number =>
  links.filter((l) => l.fromMachine === from).reduce((s, l) => s + l.inserterCount, 0);

describe("allocateMachineLinks — 사장님 예시(용어사전) 그대로 재현", () => {
  // 자식 생산 100 · 부모 필요 60.5 · 벨트 20 · 인서터 6 → 벨트당 인서터 3개(=18).
  const links = allocateMachineLinks({
    childCount: 2,
    parentCount: 3,
    childProduction: 100,
    parentDemand: 60.5,
    item: "glass",
    inserterThroughput: 6,
    beltThroughput: 20,
  });

  it("자식1 → 부모1: [3,3,3,2] (54 + 넉넉한 12 = 66 ≥ 60.5)", () => {
    expect(beltsFor(links, 0, 0)).toEqual([3, 3, 3, 2]);
  });

  it("자식1 → 부모2: [3,2] (18 + 12 — 3개 붙이면 한도 초과라 못 붙임)", () => {
    expect(beltsFor(links, 0, 1)).toEqual([3, 2]);
  });

  it("자식1 은 인서터 16개(=96)에서 멈춘다 — 100 중 4는 버린다", () => {
    expect(totalInserters(links, 0)).toBe(16);
  });

  it("자식2 → 부모2: [3,3] (부모2 총계 30+36=66 ≥ 60.5)", () => {
    expect(beltsFor(links, 1, 1)).toEqual([3, 3]);
  });

  it("자식2 → 부모3: [3,3,3,1] (한도 16개에서 멈춘다)", () => {
    expect(beltsFor(links, 1, 2)).toEqual([3, 3, 3, 1]);
  });

  it("자식2 도 인서터 16개(=96)에서 멈춘다", () => {
    expect(totalInserters(links, 1)).toBe(16);
  });

  it("부모별 총 공급 = [66, 66, 60] (앞 부모는 넉넉히, 꼬리 부모는 살짝 굶는다)", () => {
    // **설계 사실**: 앞 부모들을 올림으로 넉넉하게 채우면 그만큼 예산이 앞으로 쏠려,
    // 마지막(꼬리) 부모가 인서터 단위 경계에서 0.5 모자란 60 에 멈춘다(60.5 필요).
    // 자식 꼬리를 버리는 것(규칙 6)과 대칭인, 부모 꼬리의 미세 부족이다. 용어사전 예시가
    // 직접 보여주는 "한도 16개에서 멈춘다"가 곧 이 지점이다. 실제로는 childCount 가 ceil
    // 로 과공급되게 잡혀(assignThroughputCounts) 이 0.5 는 대개 다음 자식이 메운다.
    const supplyTo = (pj: number) =>
      links.filter((l) => l.toMachine === pj).reduce((s, l) => s + l.inserterCount * 6, 0);
    expect([supplyTo(0), supplyTo(1), supplyTo(2)]).toEqual([66, 66, 60]);
  });

  it("자식이 나른 총량 = 자식이 만든 실효 산출(96×2) — 흐르다 새는 것 없음", () => {
    const delivered = links.reduce((s, l) => s + l.inserterCount * 6, 0);
    expect(delivered).toBe(192); // 66+66+60
  });
});

describe("allocateMachineLinks — 반올림 방향", () => {
  it("부모 채우기는 올림 — 딱 안 맞으면 인서터를 하나 더(넉넉하게)", () => {
    // 필요 6.5, 인서터 6 → 1개론 모자라니 2개(=12).
    const links = allocateMachineLinks({
      childCount: 1, parentCount: 1, childProduction: 100, parentDemand: 6.5,
      item: "x", inserterThroughput: 6, beltThroughput: 100,
    });
    expect(links).toEqual([{ fromMachine: 0, toMachine: 0, item: "x", inserterCount: 2 }]);
  });

  it("딱 떨어지면 인서터를 더 안 붙인다(부동소수 경계)", () => {
    // 필요 18 = 인서터 3개 정확히 → 4개 아님.
    const links = allocateMachineLinks({
      childCount: 1, parentCount: 1, childProduction: 100, parentDemand: 18,
      item: "x", inserterThroughput: 6, beltThroughput: 100,
    });
    expect(links).toEqual([{ fromMachine: 0, toMachine: 0, item: "x", inserterCount: 3 }]);
  });

  it("자식 비우기는 내림 — 인서터 한 개 몫 미만은 버린다", () => {
    // 자식 산출 20, 인서터 6 → floor(20/6)=3개(=18)만 나가고 2는 버린다.
    const links = allocateMachineLinks({
      childCount: 1, parentCount: 1, childProduction: 20, parentDemand: 1000,
      item: "x", inserterThroughput: 6, beltThroughput: 100,
    });
    expect(totalInserters(links, 0)).toBe(3);
  });
});

describe("allocateMachineLinks — 그릇(벨트당 인서터 상한)", () => {
  it("벨트 하나에 floor(벨트÷인서터) 개까지만", () => {
    // 벨트 20 · 인서터 6 → 3개. 부모가 아무리 많이 필요해도 한 벨트는 3개 초과 못함.
    const links = allocateMachineLinks({
      childCount: 1, parentCount: 1, childProduction: 1000, parentDemand: 100,
      item: "x", inserterThroughput: 6, beltThroughput: 20,
    });
    expect(links.every((l) => l.inserterCount <= 3)).toBe(true);
  });
});

describe("allocateMachineLinks — 방어적 경계", () => {
  it("인서터 처리량 0 이면 빈 목록(지어내지 않는다)", () => {
    expect(
      allocateMachineLinks({
        childCount: 1, parentCount: 1, childProduction: 100, parentDemand: 60,
        item: "x", inserterThroughput: 0, beltThroughput: 20,
      }),
    ).toEqual([]);
  });
});
