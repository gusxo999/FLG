import { describe, it, expect } from "vitest";
import { shareLanes, physicalLines, type Link } from "./link";

/**
 * **레인 공유 짝짓기** — 벨트 한 줄에 두 품목을 좌/우 레인으로.
 * 모델은 `docs/factorio/belt-lane-semantics.md`, 계획은 `tempPlanDocs/벨트-레인/`.
 *
 * 여기서 재는 것은 **자격 판정**뿐이다. 실제로 두 줄이 한 벨트가 되는 기하(채널 계단꼴의
 * 합류)는 별개 단계이고, 이 함수는 *"합쳐도 되는 쌍인가"* 만 답한다.
 */

/** 줄 하나 — 품목·티어·적재만 있으면 이 함수엔 충분하다. */
const line = (item: string, rate: number, belt = "express"): Link => ({
  item,
  from: new Map([[0, 1]]),
  to: new Map([[0, 1]]),
  carries: [{ from: 0, to: 0, rate }],
  beltEntityName: belt,
});

/** express 45/s → 레인 22.5/s. 그 밖의 이름은 모른다(= 짝짓지 않는다). */
const laneCapOf = (n: string | undefined) =>
  n === "express" ? 22.5 : n === "fast" ? 15 : undefined;
const ids = (i: number) => `L#${i}`;

describe("shareLanes — 자격 넷", () => {
  it("서로 다른 품목이 둘 다 레인 용량 안이면 짝이 된다", () => {
    const a = line("iron-gear-wheel", 2);
    const b = line("copper-cable", 5);
    expect(shareLanes([a, b], laneCapOf, ids)).toBe(1);
    expect(a.sharedLineId).toBe("L#0");
    expect(b.sharedLineId).toBe("L#0");
  });

  it("**같은 품목은 안 짝짓는다** — 한 줄에 그냥 더 실으면 되는 것이지 레인이 풀 문제가 아니다", () => {
    const a = line("iron-plate", 2);
    const b = line("iron-plate", 3);
    expect(shareLanes([a, b], laneCapOf, ids)).toBe(0);
    expect(a.sharedLineId).toBeUndefined();
  });

  it("**레인 용량을 넘으면 안 짝짓는다** — 합류를 지나면 지류는 레인 하나만 쓴다(규칙 ③)", () => {
    // 30/s 는 줄(45)에는 들어가지만 레인(22.5)에는 안 들어간다. 그 차가 이 판정의 전부다.
    const a = line("iron-plate", 30);
    const b = line("copper-cable", 2);
    expect(shareLanes([a, b], laneCapOf, ids)).toBe(0);
  });

  it("경계값 22.5 는 들어간다 — 부동소수 여유가 있다", () => {
    const a = line("iron-plate", 22.5);
    const b = line("copper-cable", 22.5);
    expect(shareLanes([a, b], laneCapOf, ids)).toBe(1);
  });

  it("**티어가 다르면 안 짝짓는다** — 물리 줄이 하나이므로 티어도 하나다", () => {
    const a = line("iron-plate", 2, "express");
    const b = line("copper-cable", 2, "fast");
    expect(shareLanes([a, b], laneCapOf, ids)).toBe(0);
  });

  it("**양을 모르면 안 짝짓는다** — 없는 숫자로 벨트를 깔지 않는다", () => {
    const a: Link = { item: "iron-plate", from: new Map(), to: new Map(), beltEntityName: "express" };
    const b = line("copper-cable", 2);
    expect(shareLanes([a, b], laneCapOf, ids)).toBe(0);
  });

  it("티어를 모르면(= 기본 벨트로 떨어질 줄) 안 짝짓는다", () => {
    const a = line("iron-plate", 2, "미지의벨트");
    const b = line("copper-cable", 2, "미지의벨트");
    expect(shareLanes([a, b], laneCapOf, ids)).toBe(0);
  });
});

describe("shareLanes — 짝짓기", () => {
  it("셋이면 앞 둘이 짝이 되고 셋째는 홀로 남는다 (레인은 둘뿐이다)", () => {
    const a = line("a", 1), b = line("b", 1), c = line("c", 1);
    expect(shareLanes([a, b, c], laneCapOf, ids)).toBe(1);
    expect(a.sharedLineId).toBe("L#0");
    expect(b.sharedLineId).toBe("L#0");
    expect(c.sharedLineId).toBeUndefined();
  });

  it("넷이면 짝 둘 — 신원이 서로 다르다", () => {
    const ls = [line("a", 1), line("b", 1), line("c", 1), line("d", 1)];
    expect(shareLanes(ls, laneCapOf, ids)).toBe(2);
    expect(ls[0].sharedLineId).toBe("L#0");
    expect(ls[1].sharedLineId).toBe("L#0");
    expect(ls[2].sharedLineId).toBe("L#1");
    expect(ls[3].sharedLineId).toBe("L#1");
  });

  it("결정적 — 같은 입력이면 같은 답", () => {
    const run = () => {
      const ls = [line("a", 1), line("b", 1), line("c", 1), line("d", 1)];
      shareLanes(ls, laneCapOf, ids);
      return ls.map((l) => `${l.item}:${l.sharedLineId}`);
    };
    expect(run()).toEqual(run());
  });

  it("이미 공유 중인 줄은 다시 안 짝짓는다", () => {
    const a = line("a", 1); a.sharedLineId = "기존";
    const b = line("b", 1);
    expect(shareLanes([a, b], laneCapOf, ids)).toBe(0);
    expect(a.sharedLineId).toBe("기존");
    expect(b.sharedLineId).toBeUndefined();
  });
});

describe("physicalLines — 물리 줄 단위로 묶는다", () => {
  it("공유 쌍은 한 묶음, 나머지는 홀로 — 방출기가 이 단위로 한 번만 깐다", () => {
    const a = line("a", 1), b = line("b", 1), c = line("c", 1);
    shareLanes([a, b, c], laneCapOf, ids);
    const groups = physicalLines([a, b, c]);
    expect(groups.map((g) => g.map((l) => l.item))).toEqual([["a", "b"], ["c"]]);
  });

  it("공유가 하나도 없으면 줄 수 = 물리 줄 수 (오늘 동작)", () => {
    const ls = [line("a", 1), line("b", 1)];
    expect(physicalLines(ls)).toHaveLength(2);
  });
});
