import { describe, expect, it } from "vitest";
import { planBundles, type LaneBudgetInput } from "./laneBudget";
import type { IoLine } from "./ioLine";

/**
 * **레인 예산** — 관통을 *공짜일 때만* 산다는 규칙 하나를 잰다.
 * 모델은 `docs/auto-layout/module/trunk-assignment.md` §4.2.
 *
 * 여기서 못 박는 것은 **수** 하나다: *"몇 줄이 관통을 살 수 있나."* 자리·행·좌표는 안 본다 —
 * 그게 이 계산이 배정보다 **앞에** 설 수 있는 이유다.
 */

const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });
const BELT = [{ entityName: "transport-belt", throughput: 15 }];

/** `lanesOf` 를 면마다 같은 수로 — `R` 은 서로 다른 reach 개수라 두 면이 대개 같다. */
const run = (
  lines: readonly IoLine[],
  R: number,
  extra: Partial<LaneBudgetInput> = {},
): Map<string, number> =>
  planBundles({
    lines,
    count: 4,
    belts: BELT,
    // 수요를 안 주면 `g_max = N` — 옛 탭 동작이고, 레인 예산이 거기서부터 깎는다.
    lanesOf: () => R,
    ...extra,
  });

const g = (m: Map<string, number>, key: string): number => m.get(key)!;

describe("레인 예산 — 관통은 공짜일 때만 산다", () => {
  it("`R=1` · 입력1+출력1 → **둘 다 관통** (kr-sand 꼴)", () => {
    // 레인 2개(W1+E1)에 줄 2개. 아무도 `g=1` 이 아니므로 공용 레인을 예약할 것도 없다.
    const m = run([outL("kr-sand"), inL("stone")], 1);
    expect(g(m, "output:kr-sand")).toBe(4);
    expect(g(m, "input:stone")).toBe(4);
  });

  it("`R=1` · 줄 셋 → **전부 다이렉트** — 하나만 내려도 예약이 켜져 나머지가 못 산다", () => {
    // 관통 3 > 레인 2 → 하나 내린다. 그 순간 `g=1` 줄이 생겨 면마다 공용 레인을 예약하므로
    // 예산이 `2 − 2 = 0` 이 되고, 남은 둘도 따라 내려간다. **연쇄가 규칙의 핵심이다.**
    const m = run([outL("out"), inL("a"), inL("b")], 1);
    expect([...m.values()]).toEqual([1, 1, 1]);
  });

  it("`R=2` · 줄 넷 → **전부 관통** (electric-motor 꼴)", () => {
    // 레인 4개(W2+E2)에 줄 4개가 정확히 들어간다. 면마다 세면 E 의 두 레인만 보고 둘을
    // 내리게 되는데, 넘침이 반대 면으로 넘어가므로 **모듈 전체로 세는 것이 맞다**.
    const m = run([outL("out"), inL("a"), inL("b"), inL("c")], 2);
    expect([...m.values()]).toEqual([4, 4, 4, 4]);
  });

  it("**부분 트렁크가 산다** — 한 줄이 처리량 때문에 `g=1` 이어도 나머지는 관통", () => {
    // 벨트 15/s, 머신 4대. `a` 는 대당 20/s 라 `g_max = 1`(한 줄이 한 대도 못 채운다).
    // 그래서 예약이 처음부터 켜지고 예산은 `4 − 2 = 2` — 관통 둘이 그 안에 든다.
    const m = run([outL("out"), inL("a"), inL("b")], 2, {
      lineRates: new Map([["input:a", 80]]), // 80/4 = 20/s > 벨트 15
    });
    expect(g(m, "input:a")).toBe(1); // 처리량이 정한 상한
    expect(g(m, "output:out")).toBe(4); // 예산 안이라 관통 유지
    expect(g(m, "input:b")).toBe(4);
  });

  it("내리는 것은 **우선순위가 낮은 줄부터** — 출력이 마지막까지 관통을 지킨다", () => {
    // 레인 4 · `heavy` 가 처리량 때문에 이미 `g=1` → 예약이 처음부터 켜져 예산은 `4−2 = 2`.
    // 관통 후보 셋(out·fed·raw)이 둘로 깎이므로 **딱 하나**가 내려간다 — 그게 누구냐가 요점이다.
    const m = run([outL("out"), inL("fed"), inL("raw"), inL("heavy")], 2, {
      lineRates: new Map([["input:heavy", 80]]), // 80/4 = 20/s > 벨트 15 → g_max = 1
    });
    expect(g(m, "input:raw")).toBe(1); // 원료 입력이 먼저 내려간다
    expect(g(m, "output:out")).toBe(4); // 출력은 지킨다
    expect(g(m, "input:fed")).toBe(4);
  });

  it("링크가 먹은 레인은 **빼고 센다** — 계획이 두 번 세지 않는다", () => {
    const free = run([outL("out"), inL("a")], 2);
    const taken = run([outL("out"), inL("a")], 2, {
      // W·E 각각 관통 링크 둘씩 = 레인 4개를 이미 다 먹었다.
      taken: () => ({ spanning: 2, direct: false }),
    });
    expect([...free.values()]).toEqual([4, 4]);
    expect([...taken.values()]).toEqual([1, 1]);
  });

  it("레인이 0인 면은 **면 수에서도 빠진다** — 없는 자리를 예약하지 않는다", () => {
    // W 만 레인 2, E 는 0(유체가 다 먹었다). 예약은 한 면 몫이라 예산 `2 − 1 = 1`.
    const m = run([outL("out"), inL("a"), inL("b")], 0, {
      lanesOf: (f) => (f === "W" ? 2 : 0),
    });
    expect(g(m, "output:out")).toBe(4); // 하나는 관통이 선다
    expect(g(m, "input:a")).toBe(1);
    expect(g(m, "input:b")).toBe(1);
  });
});
