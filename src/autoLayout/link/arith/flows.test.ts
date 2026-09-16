import { describe, it, expect } from "vitest";
import { allocateFlows, type Flow } from "./flows";

// ─────────────────────────────────────────────────────────────────────────────
// **2026-08-22 재작성.** 예전 이 파일은 사장님 예시를 `[3,3,3,2]` 같은 **팔 개수 스냅샷**으로
// 잠그고 있었다. 장부의 단위가 팔에서 rate 로 바뀌었으므로 그 수들은 더 이상 뜻이 없다 —
// 통과시키려고 숫자만 갈아 끼우지 않고, **무엇을 지키려던 테스트였나**로 다시 적는다.
//
//   규칙 6(한도)   Σ_부모 흐름 ≤ 자식 한 대의 산출        없는 걸 나른다고 주장하지 않는다
//   규칙 5(채우기) Σ_자식 흐름 = 부모 한 대의 필요량      부모가 굶지 않는다
//   단조성        흐름 수열이 양끝 모두 비감소            벨트 교차가 표현 불가능하다
// ─────────────────────────────────────────────────────────────────────────────

const from = (links: Flow[], ci: number): number =>
  links.filter((l) => l.fromMachine === ci).reduce((s, l) => s + l.rate, 0);
const to = (links: Flow[], pj: number): number =>
  links.filter((l) => l.toMachine === pj).reduce((s, l) => s + l.rate, 0);
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe("allocateFlows — 사장님 예시(자식 2×100, 부모 3×60.5)", () => {
  const links = allocateFlows({
    childCount: 2, parentCount: 3, childProduction: 100, parentDemand: 60.5, item: "glass",
  });

  it("흐름은 (자식, 부모, rate) 넷 — 물 붓기가 두 손가락으로 훑은 그대로", () => {
    expect(links).toEqual([
      { fromMachine: 0, toMachine: 0, item: "glass", rate: 60.5 },
      { fromMachine: 0, toMachine: 1, item: "glass", rate: 39.5 },
      { fromMachine: 1, toMachine: 1, item: "glass", rate: 21 },
      { fromMachine: 1, toMachine: 2, item: "glass", rate: 60.5 },
    ]);
  });

  it("규칙 5 — 부모별 공급이 **정확히** 필요량이다(꼬리 부모도 안 굶는다)", () => {
    // 옛 장부는 `[66, 66, 60]` 이었다 — 앞 부모를 팔 단위로 넉넉히 채우다 예산이 앞으로
    // 쏠려 꼬리가 0.5 모자랐다. 넉넉함은 이제 **팔 수**가 사고 장부는 정확하다.
    for (const pj of [0, 1, 2]) near(to(links, pj), 60.5);
  });

  it("규칙 6 — 자식이 자기 산출 이상을 약속하지 않는다", () => {
    near(from(links, 0), 100); // 첫 자식은 전부 나간다 — **버리는 자투리가 없다**
    near(from(links, 1), 81.5); // 남은 18.5 는 과잉생산이라 갈 곳이 없을 뿐이다
    for (const ci of [0, 1]) expect(from(links, ci)).toBeLessThanOrEqual(100 + 1e-9);
  });
});

describe("allocateFlows — 자투리를 버리지 않는다 (battery 대조군)", () => {
  // 용광로 한 대의 산출 0.625/s. 옛 규칙은 `floor(0.625 ÷ 팔 27.7) = 0` 으로 **전부** 버려
  // 이 트리의 링크가 언제나 0이었다(2026-08-21 실측). 장부가 rate 면 그런 자리가 없다.
  const links = allocateFlows({
    childCount: 2, parentCount: 4, childProduction: 0.625, parentDemand: 0.25, item: "iron-plate",
  });

  it("아주 작은 산출도 흐름이 난다", () => {
    expect(links.length).toBeGreaterThan(0);
  });

  it("부모 넷이 전부 0.25 를 받는다", () => {
    for (const pj of [0, 1, 2, 3]) near(to(links, pj), 0.25);
  });

  it("자식이 만든 것을 넘겨 약속하지 않는다", () => {
    for (const ci of [0, 1]) expect(from(links, ci)).toBeLessThanOrEqual(0.625 + 1e-9);
  });
});

describe("allocateFlows — 방어적 경계", () => {
  it("산출을 모르면 빈 목록(지어내지 않는다)", () => {
    expect(allocateFlows({
      childCount: 1, parentCount: 1, childProduction: 0, parentDemand: 60, item: "x",
    })).toEqual([]);
  });

  it("필요량을 모르면 빈 목록", () => {
    expect(allocateFlows({
      childCount: 1, parentCount: 1, childProduction: 100, parentDemand: 0, item: "x",
    })).toEqual([]);
  });

  it("자식이 모자라면 있는 만큼만 내고 멈춘다(부모가 남아도 지어내지 않는다)", () => {
    const links = allocateFlows({
      childCount: 1, parentCount: 3, childProduction: 10, parentDemand: 60.5, item: "x",
    });
    near(links.reduce((s, l) => s + l.rate, 0), 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 순서 — 채널 교차는 **애초에 표현될 수 없다**
//
// 물 붓기의 두 손가락은 **둘 다 위에서 아래로만** 간다: 부모 손가락 `pj` 는 바깥 루프라
// 되돌아오지 않고, 자식 손가락 `ci` 도 증가만 한다(다 비운 자식만 넘어간다). 그래서 흐름
// 수열은 **양끝 모두 단조**이고, 접기(→ 벨트)가 그 순서를 유지하는 한 벨트도 교차할 수 없다.
// 좌표는 한 번도 안 봤다 — **인덱스 순서가 곧 Y 순서**이기 때문이다.
// ─────────────────────────────────────────────────────────────────────────────
describe("흐름 수열은 양끝 모두 단조 — 교차가 표현 불가능하다", () => {
  const cases = [
    { childCount: 2, parentCount: 3, childProduction: 100, parentDemand: 60.5 },
    { childCount: 3, parentCount: 2, childProduction: 40, parentDemand: 55 },
    { childCount: 1, parentCount: 4, childProduction: 200, parentDemand: 45 },
    { childCount: 5, parentCount: 1, childProduction: 12, parentDemand: 55 },
    { childCount: 4, parentCount: 4, childProduction: 37, parentDemand: 37 },
    { childCount: 160, parentCount: 400, childProduction: 0.625, parentDemand: 0.25 },
  ];

  it.each(cases)("childCount=$childCount parentCount=$parentCount 에서 단조", (c) => {
    const links = allocateFlows({ ...c, item: "x" });
    expect(links.length).toBeGreaterThan(0);
    for (let i = 1; i < links.length; i++) {
      expect(links[i].fromMachine).toBeGreaterThanOrEqual(links[i - 1].fromMachine);
      expect(links[i].toMachine).toBeGreaterThanOrEqual(links[i - 1].toMachine);
    }
  });
});
