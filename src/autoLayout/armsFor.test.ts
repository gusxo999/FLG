/**
 * **팔 개수의 출처는 하나여야 하고, 그 출처는 `깊이 → 처리량` 함수다**
 * ([armsFor], 2026-08-15 — 계획서 §16).
 *
 * 이 수를 세 곳이 쓴다 — 머신을 몇 대 놓을지([machineSpeedFraction]), 팔을 몇 개 놓을지
 * ([requiredInserterCount]), 한 벨트에 몇 개 앉힐지(그릇). 세 곳이 **각자 유도**하던 시절에
 * 규칙을 두 곳에서만 바꾸자 나머지 하나가 옛 값에 남아 서로 다른 속도를 믿었다(2026-07-23).
 * **"출처는 하나" 는 그대로다** — 바뀐 것은 그 출처가 **스칼라에서 함수로** 넓어진 것뿐이다.
 *
 * ## 옛 보장 둘을 뒤집었다 (2026-08-15)
 *
 * 옛 `tapCapacity(inserters)` 는 *"reach 1 중 가장 빠른 것"* 이라는 **스칼라**였고, 그 근거는
 * *"좌석에는 reach 1 만 앉는다"* 였다. 다중 깊이 탭이 그 전제를 깨뜨렸는데 **세는 쪽만 옛
 * 전제에 남아** 깊은 벨트를 쓰는 줄이 조용히 굶었다(계획서 §15). 그래서 이 파일의 옛 두
 * 보장 — *"긴팔은 후보가 아니다"*, *"긴팔이 있든 없든 답이 같다"* — 은 이제 **거짓이어야** 한다.
 *
 * 어긋나는 방향에 따라 증상이 갈리고, **빠르게 세는 쪽이 더 위험하다**:
 *  - 느리게 셈 → 팔 과다 → 면 넘침·벨트 포화·머신 과다. 폴백으로 **드러난다**.
 *  - 빠르게 셈 → 팔 부족 → 배치는 "성공"이라 보고하고 **게임에 넣어야 안다**.
 */
import { describe, it, expect } from "vitest";
import { armsFor, inserterForReach, type SpecInserter } from "./buildSpec";
import { machineSpeedFraction } from "./wizardUtils";
import type { Entity, Recipe } from "../UI/store/gameDataStore";

/** 실측 모드팩 값 — fast 10/s, long-handed 1.2/s (8배 차이). */
const FAST: SpecInserter = { entityName: "fast-inserter", reach: 1, throughput: 10 };
const LONG: SpecInserter = { entityName: "long-handed-inserter", reach: 2, throughput: 1.2 };

describe("inserterForReach — 벨트 칸이 인서터를 지목한다", () => {
  it("reach 로 찾는다 — `clusterBeltDepth = 1 + reach` 의 역방향", () => {
    expect(inserterForReach([FAST, LONG], 1)).toBe(FAST);
    expect(inserterForReach([FAST, LONG], 2)).toBe(LONG);
  });

  it("같은 reach 가 여럿이면 가장 빠른 것 (규칙 1)", () => {
    const slow: SpecInserter = { entityName: "inserter", reach: 1, throughput: 2.4 };
    expect(inserterForReach([slow, FAST], 1)).toBe(FAST);
  });

  it("없는 reach 는 undefined — 지어내지 않는다", () => {
    expect(inserterForReach([FAST], 2)).toBeUndefined();
    expect(inserterForReach([FAST, LONG], undefined)).toBeUndefined();
  });
});

describe("armsFor — 팔 개수는 *어느 인서터가 앉느냐* 의 함수다", () => {
  it("같은 수요라도 팔이 느리면 팔이 더 든다 — **옛 보장의 반대**", () => {
    expect(armsFor(20, FAST)).toBe(2); // 20 ÷ 10
    expect(armsFor(20, LONG)).toBe(17); // 20 ÷ 1.2 → 8배 이상
  });

  it("정확히 나누어떨어지면 팔이 하나 더 붙지 않는다 (부동소수 여유)", () => {
    expect(armsFor(30, FAST)).toBe(3);
    // 0.1 + 0.2 = 0.30000000000000004 → ÷0.1 = 3.0000000000000004. 여유가 없으면 4가 된다.
    expect(armsFor(0.1 + 0.2, { entityName: "x", reach: 1, throughput: 0.1 })).toBe(3);
  });

  it("데이터가 없으면 undefined — 지어내지 않는다", () => {
    expect(armsFor(undefined, FAST)).toBeUndefined();
    expect(armsFor(20, undefined)).toBeUndefined();
    expect(armsFor(20, { entityName: "x", reach: 1, throughput: 0 })).toBeUndefined();
  });

  it("수요가 팔 하나보다 작아도 최소 1 — 0팔짜리 줄은 없다", () => {
    expect(armsFor(0.1, FAST)).toBe(1);
  });

  /**
   * **계획서 §17.3 불변 1** — reach 종류가 1종뿐인 입력에서는 이 함수가 상수 하나를 쓰는
   * 것과 같아 **다른 답을 낼 수 없다**. 모델을 갈아 끼워도 그런 입력의 산출물은 그대로다.
   */
  it("[불변] reach 가 1종뿐이면 어느 슬롯을 골라도 답이 같다", () => {
    const only = [FAST];
    for (const rate of [1, 7, 20, 45.5]) {
      const viaLookup = armsFor(rate, inserterForReach(only, 1));
      expect(armsFor(rate, FAST)).toBe(viaLookup);
    }
    expect(inserterForReach(only, 2)).toBeUndefined(); // 고를 다른 슬롯이 아예 없다
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 실측(2026-07-23 브라우저)에서 잡힌 그 자리.
//
//   [autoLayout] 인프라 부족 — kr-sand 을(를) se-pulveriser 으로 돌리면 80% 로만 돈다.
//
// se-pulveriser 는 7×7 이라 W/E 두 면에 좌석이 **14행**이다. 실제 필요한 팔은 3개뿐인데
// "80%"가 나온 건 이 함수가 팔 하나를 **1.2/s** 로 보고 있었기 때문이다(min 자체 계산).
// 그 결과가 머신 수 부풀리기였다.
//
// **이 함수가 `reach 1` 을 쓰는 것은 낙관이 아니다** — 다이렉트가 언제나 유효한 폴백이고
// 다이렉트의 팔은 항상 `reach 1` 이기 때문이다(상자가 `d2`, 팔이 `d1`). 탭이 깊은 벨트를
// 써서 팔이 더 들면 배분기가 **그 자리에서** 거절해 다이렉트로 물러난다(계획서 §16).
// ─────────────────────────────────────────────────────────────────────────────
describe("machineSpeedFraction — 자리가 넉넉하면 굶었다고 하지 않는다", () => {
  const pulveriser = { tile_height: 7, tile_width: 7 } as Entity;
  /** kr-sand: 1초에 stone 3 → kr-sand 5. crafting_speed 2 → 초당 stone 6 / sand 10. */
  const krSand = {
    name: "kr-sand",
    energy_required: 1,
    ingredients: [{ name: "stone", amount: 3, type: "item" }],
    products: [{ name: "kr-sand", amount: 5, type: "item", probability: 1 }],
  } as unknown as Recipe;

  // crafting_speed 4 → 초당 stone 12 / sand 20.
  //   팔 하나를 10/s 로 보면  2 + 2 =  4개  → 14행에 넉넉히 앉는다.
  //   팔 하나를 1.2/s 로 보면 10 + 17 = 27개 → 14행을 한참 넘겨 "굶는다"고 답한다.
  // 두 답이 확실히 갈리는 자리를 골랐다 — 경계에 걸치면 옛 코드로 되돌려도 테스트가
  // 통과해 버려(실제로 한 번 그랬다) 계측기 노릇을 못 한다.
  const SPEED = 4;

  it("7×7 머신에 팔 4개 — 14행이 있으니 100% 로 돈다 (undefined = 굶지 않음)", () => {
    expect(machineSpeedFraction(krSand, pulveriser, SPEED, [FAST, LONG])).toBeUndefined();
  });

  it("긴팔이 목록에 있든 없든 답이 같다 — 이 함수는 **폴백(다이렉트)** 을 모델한다", () => {
    const withLong = machineSpeedFraction(krSand, pulveriser, SPEED, [FAST, LONG]);
    const without = machineSpeedFraction(krSand, pulveriser, SPEED, [FAST]);
    expect(withLong).toBe(without);
  });

  it("reach 1 을 하나도 안 고르면 답할 수 없다 — 좌석에 앉을 팔이 없다", () => {
    expect(machineSpeedFraction(krSand, pulveriser, SPEED, [LONG])).toBeUndefined();
  });

  it("진짜로 자리가 모자라면 여전히 정직하게 비율을 낸다", () => {
    // 1×1 머신(좌석 2행)에 아주 빠른 레시피 → 팔이 2개를 넘는다.
    const tiny = { tile_height: 1, tile_width: 1 } as Entity;
    const f = machineSpeedFraction(krSand, tiny, 20, [FAST]);
    expect(f).toBeDefined();
    expect(f!).toBeLessThan(1);
  });
});
