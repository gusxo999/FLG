/**
 * allocateArms — **팔을 자리 안에서 나눠 앉히고, 머신이 몇 %로 도는지 답한다.**
 *
 * 머신은 **가장 굶는 줄의 속도로만** 돈다. 그래서 팔이 모자랄 때 어디에 주느냐가 곧 머신
 * 속도다 — 최선은 가장 굶는 줄에 주는 것이다.
 *
 * 예전엔 자리가 모자라면 줄여서 놓고 **"성공"이라 보고**했다(조용히 굶는 배치). 이제는
 * 줄여 놓은 결과가 몇 %인지 계산해 호출부가 **머신을 더 놓고 경고**할 수 있게 한다
 * (2026-07-16 사용자 설계).
 */
import { describe, it, expect } from "vitest";
import { allocateArms, type IoLine } from "./clusterPortPlanner";
import type { SpecInserter } from "../../buildSpec";

const inL = (n: string): IoLine => ({ name: n, kind: "belt", role: "input" });
const outL = (n: string): IoLine => ({ name: n, kind: "belt", role: "output" });
const pipeL = (n: string): IoLine => ({ name: n, kind: "pipe", role: "input" });

/** 줄별 머신 1대의 초당 수요를 Map 으로 준다. 없으면 수량 미상. */
const rates = (m: Record<string, number>) => (l: IoLine) => m[`${l.role}:${l.name}`];

/** 좌석에 앉는 팔 — `reach 1`(다이렉트 폴백의 모델). 처리량만 다르게 준다. */
const ins = (throughput: number): SpecInserter => ({ entityName: "i", reach: 1, throughput });

describe("allocateArms — 자리가 넉넉할 때", () => {
  it("굶지 않을 만큼만 앉히고 남는 자리는 안 쓴다", () => {
    // a 는 초당 4개 필요, 팔 하나가 2개 → 팔 2개면 충분. z 는 초당 2개 → 팔 1개.
    const r = allocateArms([inL("a"), outL("z")], rates({ "input:a": 4, "output:z": 2 }), ins(2), 10);
    expect(r.speedFraction).toBe(1);
    expect(r.armsByLine.get("input:a")).toBe(2);
    expect(r.armsByLine.get("output:z")).toBe(1);
  });

  it("유체 줄은 대상이 아니다 — 인서터가 없다", () => {
    const r = allocateArms([inL("a"), pipeL("water")], rates({ "input:a": 2 }), ins(2), 5);
    expect(r.armsByLine.has("input:water")).toBe(false);
    expect(r.speedFraction).toBe(1);
  });

  it("수량을 모르는 줄은 팔 1개 — 모르는 걸로 굶었다고 단정하지 않는다", () => {
    const r = allocateArms([inL("a"), inL("b")], rates({ "input:a": 2 }), ins(2), 8);
    expect(r.armsByLine.get("input:b")).toBe(1);
    expect(r.speedFraction).toBe(1);
  });
});

describe("allocateArms — 자리가 모자랄 때 (굶주림)", () => {
  it("모자라면 비율을 정직하게 낸다 — 4팔이 필요한데 2행뿐이면 절반", () => {
    // a: 초당 8개 필요, 팔 하나가 2개 → 팔 4개 필요. 자리는 2행뿐.
    const r = allocateArms([inL("a")], rates({ "input:a": 8 }), ins(2), 2);
    expect(r.armsByLine.get("input:a")).toBe(2);
    expect(r.speedFraction).toBe(0.5); // 2팔 × 2 = 4 / 8 = 절반
  });

  it("**가장 굶는 줄**에 다음 팔을 준다 — 머신을 붙잡고 있는 건 그 줄이다", () => {
    // a 는 초당 8(팔 4개 필요), b 는 초당 2(팔 1개면 충분). 자리 4행.
    // 순진하게 반씩 주면(2/2) a 가 절반이라 머신도 절반. a 에 몰아주면 3/1 → 75%.
    const r = allocateArms([inL("a"), inL("b")], rates({ "input:a": 8, "input:b": 2 }), ins(2), 4);
    expect(r.armsByLine.get("input:a")).toBe(3);
    expect(r.armsByLine.get("input:b")).toBe(1);
    expect(r.speedFraction).toBe(0.75);
  });

  it("[불변식] 앉힌 팔의 합은 자리를 넘지 않는다", () => {
    for (let rows = 2; rows <= 12; rows++) {
      const r = allocateArms(
        [inL("a"), inL("b"), outL("z")],
        rates({ "input:a": 20, "input:b": 6, "output:z": 9 }),
        ins(1.2),
        rows,
      );
      const sum = [...r.armsByLine.values()].reduce((s, v) => s + v, 0);
      expect(sum, `자리 ${rows}`).toBeLessThanOrEqual(rows);
    }
  });

  it("[불변식] 자리가 늘면 비율이 나빠지지 않는다 (단조)", () => {
    let prev = 0;
    for (let rows = 3; rows <= 20; rows++) {
      const f = allocateArms(
        [inL("a"), inL("b"), outL("z")],
        rates({ "input:a": 20, "input:b": 6, "output:z": 9 }),
        ins(1.2),
        rows,
      ).speedFraction;
      expect(f, `자리 ${rows}`).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it("자리가 충분해지면 정확히 1 에서 멈춘다 — 그 위로는 안 늘어난다", () => {
    // a 20/1.2 → 17팔, b 6/1.2 → 5팔, z 9/1.2 → 8팔. 합 30.
    const enough = allocateArms(
      [inL("a"), inL("b"), outL("z")],
      rates({ "input:a": 20, "input:b": 6, "output:z": 9 }),
      ins(1.2),
      30,
    );
    expect(enough.speedFraction).toBe(1);
    const sum = [...enough.armsByLine.values()].reduce((s, v) => s + v, 0);
    expect(sum).toBeLessThanOrEqual(30);
  });
});

describe("allocateArms — 아예 불가능한 경우", () => {
  it("줄마다 팔 하나씩도 못 앉히면 0 — 이 머신으론 이 레시피가 불가능하다", () => {
    const r = allocateArms([inL("a"), inL("b"), outL("z")], rates({}), ins(2), 2); // 3줄 > 2행
    expect(r.speedFraction).toBe(0);
    expect(r.armsByLine.size).toBe(0);
  });

  it("인서터 처리량이 0 이면 0 — 데이터가 없으면 지어내지 않는다", () => {
    const r = allocateArms([inL("a")], rates({ "input:a": 5 }), ins(0), 10);
    expect(r.speedFraction).toBe(0);
  });
});
