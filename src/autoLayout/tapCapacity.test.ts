/**
 * **팔 하나의 처리량은 출처가 하나여야 한다** ([tapCapacity], 2026-07-23).
 *
 * 이 수를 세 곳이 쓴다 — 머신을 몇 대 놓을지([machineSpeedFraction]), 팔을 몇 개 놓을지
 * ([requiredInserterCount]), 한 벨트에 몇 개 앉힐지(그릇). 세 곳이 **각자 유도**하던 시절에
 * 규칙을 두 곳에서만 바꾸자 나머지 하나가 옛 값에 남아 서로 다른 속도를 믿었다.
 *
 * 어긋나는 방향에 따라 증상이 갈리고, **빠르게 세는 쪽이 더 위험하다**:
 *  - 느리게 셈 → 팔 과다 → 면 넘침·벨트 포화·머신 과다. 폴백으로 **드러난다**.
 *  - 빠르게 셈 → 팔 부족 → 배치는 "성공"이라 보고하고 **게임에 넣어야 안다**.
 */
import { describe, it, expect } from "vitest";
import { tapCapacity, type SpecInserter } from "./buildSpec";
import { machineSpeedFraction } from "./wizardUtils";
import type { Entity, Recipe } from "../UI/store/gameDataStore";

/** 실측 모드팩 값 — fast 10/s, long-handed 1.2/s (8배 차이). */
const FAST: SpecInserter = { entityName: "fast-inserter", reach: 1, throughput: 10 };
const LONG: SpecInserter = { entityName: "long-handed-inserter", reach: 2, throughput: 1.2 };

describe("tapCapacity — 앉는 팔의 처리량", () => {
  it("reach 1 중 가장 빠른 것을 낸다 — 긴팔은 d2 를 아예 못 집으므로 후보가 아니다", () => {
    expect(tapCapacity([FAST, LONG])).toBe(10);
  });

  it("느린 reach-1 이 섞여 있어도 빠른 쪽 (규칙 1)", () => {
    const slow: SpecInserter = { entityName: "inserter", reach: 1, throughput: 2.4 };
    expect(tapCapacity([slow, FAST])).toBe(10);
  });

  it("min 을 쓰지 않는다 — 이게 8배 오차의 원인이었다", () => {
    expect(tapCapacity([FAST, LONG])).not.toBe(1.2);
  });

  it("데이터 없으면 undefined — 지어내지 않는다", () => {
    expect(tapCapacity([])).toBeUndefined();
    expect(tapCapacity([{ entityName: "x", reach: 1, throughput: 0 }])).toBeUndefined();
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

  it("긴팔이 목록에 있든 없든 답이 같다 — 긴팔은 이 좌석에 앉지 않는다", () => {
    const withLong = machineSpeedFraction(krSand, pulveriser, SPEED, [FAST, LONG]);
    const without = machineSpeedFraction(krSand, pulveriser, SPEED, [FAST]);
    expect(withLong).toBe(without);
  });

  it("진짜로 자리가 모자라면 여전히 정직하게 비율을 낸다", () => {
    // 1×1 머신(좌석 2행)에 아주 빠른 레시피 → 팔이 2개를 넘는다.
    const tiny = { tile_height: 1, tile_width: 1 } as Entity;
    const f = machineSpeedFraction(krSand, tiny, 20, [FAST]);
    expect(f).toBeDefined();
    expect(f!).toBeLessThan(1);
  });
});
