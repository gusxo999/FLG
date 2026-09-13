/**
 * **[rungOfLine] — 미완성 기능의 *경계*를 이름표로 잠근다.**
 *
 * 사다리는 1단(쪼개기)뿐이다. 남은 실패는 **당연히 있고**, 물어야 할 것은 *"몇 개 남았나"*
 * 가 아니라 *"어느 칸의 몫인가"* 다(`docs/auto-layout/link/machine-link.md` — *무엇을 재나*).
 * 여기서 잠그는 것은 그 대응이다:
 *
 * ```
 * 막힌 칸이 **점**  → span-blocked  1단이 푼다
 * 막힌 칸이 **구간** → seat-blocked  2·3단의 몫 (이 칸의 실패가 아니다)
 * ```
 */
import { describe, it, expect } from "vitest";
import { rungOfLine, summarizeRungs } from "./linkPlanner";
import type { DepthShortage } from "../../module/types/seat";

/** 머신 90대가 각자 **칸 1** 을 쓴다 — 실측(electronic-circuit)의 `stone-tablet` 이 이 꼴이다. */
const seatRows = Array.from({ length: 90 }, (_, mi) => mi * 3 + 1);
const belt = Array.from({ length: 268 }, (_, i) => i + 1);

const at = (w: Partial<DepthShortage>): DepthShortage =>
  ({ face: "W", clusterBeltDepth: 3, ...w });

describe("rungOfLine — 이 실패는 어느 칸의 몫인가", () => {
  it("막힌 칸이 **점**이면 `span-blocked` — 1단이 맡는다 (실측 d3: 못 90·180)", () => {
    expect(rungOfLine([at({ seatRows, blockedRows: [90, 180] })])).toBe("span-blocked");
  });

  it("막힌 칸이 **구간**이면 `seat-blocked` — 2·3단의 몫이다 (실측 d2: 남의 벨트)", () => {
    expect(rungOfLine([at({ clusterBeltDepth: 2, seatRows, blockedRows: belt })])).toBe("seat-blocked");
  });

  it("좌석 예산이 모자라면 `seat-budget` — 자를 것이 있고 없고의 문제가 아니다", () => {
    expect(rungOfLine([at({ seats: { need: 4, budget: 3 } })])).toBe("seat-budget");
  });

  it("벨트는 지나가는데 포트 칸이 막히면 `port-blocked` — 1단의 몫이나 아직 안 만들었다", () => {
    expect(rungOfLine([at({ blockedPort: [[7, 4]] })])).toBe("port-blocked");
  });

  it("후보가 갈리면 **가장 싼 칸**이 맡는다 — 하나라도 쪼개지면 1단의 일이다", () => {
    expect(rungOfLine([
      at({ clusterBeltDepth: 2, seatRows, blockedRows: belt }),   // seat-blocked
      at({ clusterBeltDepth: 3, seatRows, blockedRows: [90] }),   // span-blocked
    ])).toBe("span-blocked");
  });

  it("후보가 없으면 이름표도 없다 — 사유를 지어내지 않는다", () => {
    expect(rungOfLine([])).toBeUndefined();
  });
});

describe("summarizeRungs — 모듈 한 개의 경계를 한 문장으로", () => {
  it("**교착별로** 세고, 풀 수 있는 것부터 적는다(화면 말로)", () => {
    const m = new Map<string, DepthShortage[]>([
      ["a→b:x#0", [at({ clusterBeltDepth: 2, seatRows, blockedRows: belt })]],
      ["a→b:y#0", [at({ clusterBeltDepth: 2, seatRows, blockedRows: belt })]],
      ["a→b:z#0", [at({ seatRows, blockedRows: [90, 180] })]],
    ]);
    expect(summarizeRungs(m)).toBe("구간막힘 1 · 좌석막힘 2");
  });

  it("빈 표는 문장이 없다 — 화면에 없는 사유를 만들지 않는다", () => {
    expect(summarizeRungs(new Map())).toBeUndefined();
    expect(summarizeRungs(new Map([["a→b:x#0", []]]))).toBeUndefined();
  });
});
