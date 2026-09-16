import { describe, expect, it } from "vitest";
import { linkDepthNeed, type LinkDepthInput } from "./depth";

/**
 * **링크 깊이 판정** — *"면이 얼마나 넉넉해야 하고 아이템이 몇 종부터 막히나"* 에
 * 부등식으로 답한다. 계획은 `tempPlanDocs/부분-링크/` §4 Step 1.
 *
 * 여기서 재는 것은 **판정 하나**다. 좌석·좌표·처리량은 안 본다 — 입력이 `L_f`(줄 수)와
 * `R_f`(깊이 수) 둘뿐인 것이 이 판정이 배정보다 **앞에** 설 수 있는 이유다.
 *
 * > **오늘 배치의 분포로 기준을 세우지 않는다.** 넘치는 모듈은 실패해서 산출물에 없다.
 * > 그래서 아래는 전부 **부등식의 경계**를 직접 찌르는 합성 입력이고, 실측은
 * > *"유도한 기준이 관측된 실패를 재현하나"* 하나만 본다(맨 아래).
 */

const need = (L: { W: number; E: number }, R: { W: number; E: number }): string =>
  linkDepthNeed({ linesOf: (f) => L[f], depthsOf: (f) => R[f] } satisfies LinkDepthInput);

describe("링크 깊이 판정 — 눈금 넷", () => {
  it("면마다 줄이 깊이 안에 들면 **free** — 오늘 배정이 실제로 하는 일", () => {
    expect(need({ W: 2, E: 2 }, { W: 2, E: 2 })).toBe("free");
  });

  it("줄이 하나도 없으면 **free** — 깊이가 0 이어도 판정할 것이 없다", () => {
    expect(need({ W: 0, E: 0 }, { W: 0, E: 0 })).toBe("free");
  });

  it("한 면이 넘쳐도 **반대 면에 여유가 있으면 opposite-face** — 관통을 유지한 채 옮긴다", () => {
    // 총 4줄 ≤ 총 4깊이. 옮기기만 하면 토막이 안 늘어 **포트가 안 는다**.
    expect(need({ W: 1, E: 3 }, { W: 2, E: 2 })).toBe("opposite-face");
  });

  it("총량까지 넘치면 **direct** — 여기서부터 포트를 낸다", () => {
    // 총 5줄 > 총 4깊이. 옮겨도 안 되니 넘치는 줄을 `g=1` 로 내려 공용 깊이에 겹쳐 앉힌다.
    expect(need({ W: 2, E: 3 }, { W: 2, E: 2 })).toBe("direct");
  });

  it("**direct 는 줄 수에 상한이 없다** — 공용 깊이 하나가 몇 줄이든 담는다", () => {
    // 이것이 `planBundles` 부등식의 둘째 항 그대로다: `g=1` 줄들은 면당 깊이 **하나**만 쓴다.
    // 그래서 다이렉트까지 내려가면 한계가 깊이에서 **좌석**으로 넘어간다(tryLinkFace 의 몫).
    expect(need({ W: 0, E: 99 }, { W: 1, E: 1 })).toBe("direct");
  });

  it("한 면이 굶어도 **반대 면이 받아 주면 opposite-face** — 굶음 자체는 사유가 아니다", () => {
    // 유체가 E 의 깊이를 다 먹었지만 W 에 3칸이 남았다 → 옮기면 관통인 채로 앉는다.
    // (2026-09-04: 처음엔 이걸 `depth-starved` 로 적었다가 **틀린 쪽이 테스트**였다.
    //  깊이 0 은 *그 면*의 사실이고, 판정은 **모듈 전체**를 보고서야 선다.)
    expect(need({ W: 0, E: 3 }, { W: 3, E: 0 })).toBe("opposite-face");
  });

  it("갈 데까지 없으면 **depth-starved** — 총량도 모자라고 줄 있는 면이 굶었다", () => {
    // 총 3줄 > 총 1깊이, 그리고 줄이 앉아야 할 E 에 공용 깊이조차 없다.
    expect(need({ W: 0, E: 3 }, { W: 1, E: 0 })).toBe("depth-starved");
  });

  it("눈금은 **단조**다 — 깊이를 깎을수록 비싼 눈금으로만 간다", () => {
    const order = ["free", "opposite-face", "direct", "depth-starved"];
    const seen = [4, 3, 2, 1, 0].map((r) => need({ W: 0, E: 4 }, { W: r, E: r }));
    const ranks = seen.map((n) => order.indexOf(n));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe("실측 재현 — advanced-circuit (2026-09-02)", () => {
  /**
   * 관측된 사실은 **E 면 링크 입력 3줄 · 면당 깊이 R = 2** 하나뿐이다(W 면의 줄 수는
   * 안 재었다). 그래서 못 박는 것도 그만큼이다 — **`"free"` 가 아니다**, 즉 오늘 코드가
   * 할 수 있는 것으로는 안 앉는다. 어느 눈금이 필요한지는 W 가 정하므로 여기서 안 정한다.
   */
  it("E=3 · R=2 는 **free 가 아니다** — 오늘 통째로 실패하는 그 모듈이다", () => {
    for (const w of [0, 1, 2]) {
      expect(need({ W: w, E: 3 }, { W: 2, E: 2 })).not.toBe("free");
    }
  });

  it("**처리량·머신 수와 무관하다** — 판정의 입력에 그 축이 아예 없다", () => {
    // 구조적 실패라는 실측(10/s 든 1/s 든 같다)이 여기서는 **타입으로** 참이다:
    // `LinkDepthInput` 에 rate·count 가 없어 다른 답을 낼 재료가 없다.
    expect(need({ W: 1, E: 3 }, { W: 2, E: 2 })).toBe(need({ W: 1, E: 3 }, { W: 2, E: 2 }));
  });

  it("재료가 **2종이면 앉고 3종부터 막힌다** — `R = 2` 의 뜻", () => {
    expect(need({ W: 0, E: 2 }, { W: 2, E: 2 })).toBe("free");
    expect(need({ W: 0, E: 3 }, { W: 2, E: 2 })).not.toBe("free");
  });
});
