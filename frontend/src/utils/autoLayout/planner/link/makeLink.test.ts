import { describe, it, expect } from "vitest";
import { makeLink, readLinkRole, type MachineLinkGroup } from "./allocateMachineLinks";

/**
 * **"빈 쪽 = 밖" 규약의 단일 출처** — [makeLink](만들기) / [readLinkRole](읽기) 한 쌍.
 *
 * 이 규약이 예전엔 [externalLineGroups](만들기)와 [emitTapInserting](읽기)에 각자 박혀 있었다.
 * 둘이 어긋나면 방출기가 원료를 완제품으로(또는 그 반대로) 읽어 포트가 반대편에 선다.
 * 그래서 만들기와 읽기가 **서로의 역**임을 여기서 못박는다(왕복 = 항등).
 */
const arms = new Map([[0, 3], [1, 3]]);

describe("makeLink — 빈 쪽이 곧 밖", () => {
  it("원료(input)는 from 이 비고 to 에 머신이 든다 — 밖에서 온다", () => {
    const g = makeLink("iron-plate", "input", arms);
    expect(g.item).toBe("iron-plate");
    expect(g.from.size).toBe(0);
    expect([...g.to]).toEqual([[0, 3], [1, 3]]);
  });

  it("완제품(output)은 to 가 비고 from 에 머신이 든다 — 밖으로 간다", () => {
    const g = makeLink("gear", "output", arms);
    expect(g.to.size).toBe(0);
    expect([...g.from]).toEqual([[0, 3], [1, 3]]);
  });
});

describe("readLinkRole — makeLink 의 역", () => {
  it("만들기→읽기 왕복이 항등이다 (둘이 어긋나면 여기서 빨개진다)", () => {
    for (const role of ["input", "output"] as const) {
      expect(readLinkRole(makeLink("x", role, arms))).toBe(role);
    }
  });

  it("to 에 머신 → input, from 에 머신 → output", () => {
    expect(readLinkRole({ item: "x", from: new Map(), to: arms })).toBe("input");
    expect(readLinkRole({ item: "x", from: arms, to: new Map() })).toBe("output");
  });
});

// 규약이 한 곳이라는 것 — 두 함수가 같은 판정을 쓰므로, 임의 그룹을 읽어 다시 만들면
// 같은 모양이 나온다(밖 줄에 한해). 이게 "단일 출처"의 관측 가능한 증거다.
describe("규약 단일 출처 — 읽어서 다시 만들면 같은 그룹", () => {
  it("밖 줄은 role 로 왕복해도 from/to 가 보존된다", () => {
    const original: MachineLinkGroup = { item: "x", from: new Map(), to: arms };
    const rebuilt = makeLink(original.item, readLinkRole(original), arms);
    expect([...rebuilt.to]).toEqual([...original.to]);
    expect(rebuilt.from.size).toBe(original.from.size);
  });
});
