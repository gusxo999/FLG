/**
 * **인서터에 붙은 수는 사용자가 정한 운반량 하나이고, 인서터 수를 세는 식도 하나다**(2026-10-06 사용자).
 *
 * 2026-08-22 ~ 10-06 에는 [makeBuildSpec] 이 인서터 운반량을 `min(사용자 값, 벨트 한 줄의 상한)` 으로 깎아 넣었다.
 * 머신 대수를 어림하는 쪽이 벨트를 몰라서였다. 지금은 어림이 벨트 한 줄의 상한을 직접 받고([armLoadsOf]),
 * *인서터 하나가 벨트 한 줄보다 많이 나를 수 없다* 는 사실은 줄에 실린 양이 지킨다.
 */
import { describe, it, expect } from "vitest";
import type { Entity, GameDataLookup } from "../../../types/gameData";
import type { ContainerWizardInput } from "../types";
import {
  armLoadsOf, armsFor, armsForShare, makeBuildSpec, maxRatePerMachinePerLine, type SpecInserter,
} from "./spec";

const ins = (throughput: number): SpecInserter => ({ entityName: "i", reach: 1, throughput });

describe("makeBuildSpec — 인서터 운반량은 사용자가 정한 값 그대로다", () => {
  const gameData = {
    entityMap: new Map<string, Entity>([
      ["inserter", { name: "inserter", type: "inserter", inserter_pickup_position: { x: 0, y: -1 }, inserter_rotation_speed: 0.014 } as unknown as Entity],
      ["fast-belt", { name: "fast-belt", type: "transport-belt", belt_speed: 0.0625 } /* 30/s — 한 줄 15/s */ as unknown as Entity],
    ]),
  } as unknown as GameDataLookup;
  const input = (throughput: number): ContainerWizardInput => ({
    targetRecipe: "x",
    countMode: "min",
    internalIngredients: new Set<string>(),
    selectedMachines: [],
    selectedInserters: ["inserter"],
    selectedBelts: ["fast-belt"],
    selectedUndergroundPipes: [],
    selectedUndergroundBelts: [],
    externalPortsDefault: "top-left",
    inserterOverrides: { inserter: { throughput } },
  });

  it("벨트 한 줄(15/s)보다 큰 값도 깎지 않는다", () => {
    expect(makeBuildSpec(input(100), gameData).inserters[0].throughput).toBe(100);
  });

  it("벨트 한 줄보다 작은 값도 그대로다(대조군)", () => {
    expect(makeBuildSpec(input(12), gameData).inserters[0].throughput).toBe(12);
  });
});

describe("maxRatePerMachinePerLine — 벨트 한 줄이 머신 한 대와 주고받는 최대", () => {
  it("인서터가 빠르면 벨트 한 줄의 상한이 정한다", () => {
    expect(maxRatePerMachinePerLine(15, 3, ins(100))).toBe(15);
  });

  it("인서터가 느리면 면 좌석 수 × 인서터 운반량이 정한다 — 인서터가 양을 정하는 유일한 자리", () => {
    expect(maxRatePerMachinePerLine(15, 3, ins(2))).toBe(6);
  });

  it("모듈 밖인 끝은 좌석이 없다 — 벨트만 본다", () => {
    expect(maxRatePerMachinePerLine(15, undefined, ins(2))).toBe(15);
  });
});

describe("armLoadsOf — 몫을 줄마다 자르고 줄마다 올린다", () => {
  it("인서터가 벨트 한 줄보다 빠르면 줄마다 하나다 — 인서터 값을 아무리 키워도 같다", () => {
    for (const tp of [15, 100, Infinity]) expect(armLoadsOf(30, 15, ins(tp)), `인서터 ${tp}/s`).toEqual([15, 15]);
    expect(armsForShare(40, 15, ins(100))).toBe(3); // 15 · 15 · 10
  });

  it("벨트 한 줄의 상한이 인서터 운반량의 정수배가 아니면 통째로 올린 수보다 많다", () => {
    // 인서터 12/s · 한 줄 15/s · 몫 30/s. 통째로 올리면 3개(36 ≥ 30)인데, 줄 둘에 15씩 실으려면 줄마다 2개다.
    expect(armsFor(30, ins(12))).toBe(3);
    expect(armLoadsOf(30, 15, ins(12))).toEqual([12, 12, 3, 3]);
  });

  it("정수배면 통째로 올린 수와 같다(대조군)", () => {
    expect(armsForShare(30, 15, ins(5))).toBe(armsFor(30, ins(5)));
    expect(armsForShare(30, 15, ins(7.5))).toBe(armsFor(30, ins(7.5)));
  });

  it("면 좌석이 벨트 한 줄보다 먼저 막으면 그 양으로 자른다 — 통째로 올린 수와 같다(대조군)", () => {
    const perLine = maxRatePerMachinePerLine(15, 3, ins(2)); // 6/s
    expect(armLoadsOf(15, perLine, ins(2))).toHaveLength(armsFor(15, ins(2))!); // 6 · 6 · 3 → 3 + 3 + 2
  });

  it("정확히 나누어떨어지는 몫에 팔이 하나 더 붙지 않는다", () => {
    // 3 × 2.4 = 7.199999999999999 — 여유가 없으면 넷이 된다(2026-10-05 실측: 머신 한 대가 더 놓였다).
    expect(armsForShare(7.2, maxRatePerMachinePerLine(15, 3, ins(2.4)), ins(2.4))).toBe(3);
  });

  it("몫이 0 이어도 줄 하나에 팔 하나 — 0팔짜리 줄은 없다", () => {
    expect(armLoadsOf(0, 15, ins(5))).toEqual([0]);
  });

  it("모르면 undefined — 지어내지 않는다", () => {
    expect(armLoadsOf(undefined, 15, ins(5))).toBeUndefined();
    expect(armLoadsOf(30, 15, undefined)).toBeUndefined();
    expect(armLoadsOf(30, 15, ins(0))).toBeUndefined();
  });
});
