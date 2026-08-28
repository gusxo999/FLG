/**
 * **[splitLinkAtRows] — 못을 피해 자른다.** 사다리 1단의 산술.
 *
 * 설계는 `docs/auto-layout/link/machine-link.md` — *자리가 없으면 링크를 토막낸다*. 여기서 잠그는 것은 셋이다:
 *
 * ```
 * ① 자름의 경계가 **못**이다        — 균등 분할이 아니다
 * ② 적재 목록이 토막마다 갈린다      — `from`/`to` 는 거기 맞춰 좁아진다
 * ③ 못이 구간 밖이면 안 쪼갠다       — 쪼갬은 공짜가 아니다(포트 +1)
 * ```
 */
import { describe, it, expect } from "vitest";
import { resolveSpanBlock, splitLinkAtRows, type Link } from "./link";

/** 부모 머신 `0..n-1` 에게 각각 `rate` 씩 주는 입력 링크 하나(팔 1개씩). */
const inputLink = (n: number, rate = 1): Link => ({
  id: "child→parent:item#0",
  item: "stone-tablet",
  from: new Map([[0, 1]]),
  to: new Map(Array.from({ length: n }, (_, i) => [i, 1] as const)),
  carries: Array.from({ length: n }, (_, i) => ({ from: 0, to: i, rate })),
});

describe("splitLinkAtRows — 자름의 경계는 못이다", () => {
  it("못 [90,180] · 머신칸 3 → 머신 30·60 **앞에서** 자른다", () => {
    // 실측(electronic-circuit)이 준 그 수다. 못은 copper-cable 둘째·셋째 토막의 포트다.
    const parts = splitLinkAtRows(inputLink(90), "to", [90, 180], 3);
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => [...p.to.keys()][0])).toEqual([0, 30, 60]);
    expect(parts.map((p) => [...p.to.keys()].at(-1))).toEqual([29, 59, 89]);
  });

  it("토막의 구간이 **못을 안 덮는다** — 그게 쪼개는 이유의 전부다", () => {
    // 이 줄은 각 머신의 **칸 1** 을 쓴다(칸 0 은 먼저 앉은 줄이 먹었다).
    // 구간 = [첫 머신 × 3 + 1 .. 끝 머신 × 3 + 1].
    const parts = splitLinkAtRows(inputLink(90), "to", [90, 180], 3);
    const spans = parts.map((p) => {
      const ms = [...p.to.keys()];
      return [ms[0] * 3 + 1, ms[ms.length - 1] * 3 + 1];
    });
    expect(spans).toEqual([[1, 88], [91, 178], [181, 268]]);
    for (const nail of [90, 180])
      for (const [lo, hi] of spans) expect(nail >= lo && nail <= hi).toBe(false);
  });

  it("적재 목록이 토막마다 갈리고 `to` 가 그에 맞춰 좁아진다", () => {
    const parts = splitLinkAtRows(inputLink(90, 0.5), "to", [90], 3);
    expect(parts).toHaveLength(2);
    expect(parts[0].carries).toHaveLength(30);
    expect(parts[1].carries).toHaveLength(60);
    // `to` 명단은 적재 목록에서 유도된다 — 둘이 갈리면 배정이 없는 머신을 가리킨다.
    for (const p of parts)
      expect([...p.to.keys()].sort((a, b) => a - b))
        .toEqual([...new Set(p.carries!.map((c) => c.to!))].sort((a, b) => a - b));
    // `from` 은 양쪽 다 자식 머신 0 하나 — 자식은 안 갈렸다.
    expect(parts.every((p) => [...p.from.keys()].join() === "0")).toBe(true);
  });

  it("신원이 토막마다 갈린다 — **양끝이 같은 객체를 보므로** 짝이 안 깨진다", () => {
    const parts = splitLinkAtRows(inputLink(90), "to", [90, 180], 3);
    expect(parts.map((p) => p.id)).toEqual([
      "child→parent:item#0/0", "child→parent:item#0/1", "child→parent:item#0/2",
    ]);
  });

  it("못이 구간 밖이면 **안 쪼갠다** — 쪼갬은 포트 +1 이라 공짜가 아니다", () => {
    // 머신 0..9(행 0..29)짜리 줄에 못이 행 90 → 자를 자리가 없다.
    const one = inputLink(10);
    expect(splitLinkAtRows(one, "to", [90], 3)).toEqual([one]);
  });

  it("못이 없거나 적재 목록이 없으면 그대로 — 지어내지 않는다", () => {
    const one = inputLink(90);
    expect(splitLinkAtRows(one, "to", [], 3)).toEqual([one]);
    const bare = { ...one, carries: undefined };
    expect(splitLinkAtRows(bare, "to", [90], 3)).toEqual([bare]);
  });

  it("머신이 하나뿐이면 그대로 — 자를 경계 자체가 없다", () => {
    const one = inputLink(1);
    expect(splitLinkAtRows(one, "to", [0, 3, 6], 3)).toEqual([one]);
  });
});

/**
 * **[resolveSpanBlock] — 쪼개기가 이 문제를 푸나.** 대리 지표(막힌 행이 적다)가 아니라
 * 기하 판정이다: *"막힌 칸 사이에 내 좌석이 들어갈 빈 자리가 있나."*
 */
describe("resolveSpanBlock — 쪼개면 실제로 앉나", () => {
  /** 머신 90대가 각자 **칸 1** 을 쓴다(칸 0 은 먼저 앉은 줄이 먹었다). */
  const seats = Array.from({ length: 90 }, (_, mi) => mi * 3 + 1);

  it("막힌 칸이 **점**이면 자른다 — 남의 포트 인서터 (실측 d3)", () => {
    // 90·180 은 ≡0 (mod 3) 이라 내 좌석(≡1)이 아니다. 그래서 사이가 빈다.
    expect(resolveSpanBlock(seats, [90, 180])).toEqual([90, 180]);
  });

  it("막힌 칸이 **구간**이면 안 자른다 — 남의 벨트 (실측 d2)", () => {
    // 내 구간이 통째로 먹혔다. 조각을 내도 그 칸이 다시 막혀 있다.
    const belt = Array.from({ length: 268 }, (_, i) => i + 1);
    expect(resolveSpanBlock(seats, belt)).toEqual([]);
  });

  it("**내 좌석 칸 자체가 막혔으면** 안 자른다 — 그 머신은 어차피 못 앉는다", () => {
    expect(resolveSpanBlock(seats, [4])).toEqual([]); // 4 = 머신 1 의 좌석
  });

  it("**조각이 못을 덮는 일은 구성상 없다** — 두 좌석 사이의 못은 거기서 이미 잘린다", () => {
    // 87·90 둘 다 좌석(≡1 mod 3)이 아니다. 조각은 [1,85] · [91,268] 이 되고 못은 그 밖이다.
    // 그래서 자를 만하다 — *"조각이 못을 덮나"* 를 따로 물을 필요가 없다는 증거다.
    expect(resolveSpanBlock(seats, [87, 90])).toEqual([87, 90]);
    for (const b of [87, 90]) {
      const inFirst = b >= 1 && b <= 85;
      const inSecond = b >= 91 && b <= 268;
      expect(inFirst || inSecond).toBe(false);
    }
  });

  it("자를 경계가 하나면 두 조각 — 그것도 자른다", () => {
    expect(resolveSpanBlock(seats, [90])).toEqual([90]);
  });

  it("막힌 행이 구간 밖이면 안 자른다 — 조각이 하나뿐이다", () => {
    expect(resolveSpanBlock(seats, [500])).toEqual([]);
    expect(resolveSpanBlock(seats, [])).toEqual([]);
  });
});
