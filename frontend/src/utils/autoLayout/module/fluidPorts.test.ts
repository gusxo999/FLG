/**
 * fluidPorts — 회전 각도를 **데이터에서** 고르는 부분.
 *
 * 이게 틀리면 유체 입구가 엉뚱한 면을 보고, 파이프가 머신에 안 닿는다(머신이 굶는다).
 * 그런데 증상은 "파이프는 깔렸는데 안 돌아간다"라 조용하다 — 그래서 따로 못 박는다.
 *
 * → docs/auto-layout-wizard.trunk-pipe.md §3 / §6
 */
import { describe, it, expect } from "vitest";
import { chooseMachineDirection, fluidPortSlots } from "./fluidPorts";
import type { Entity } from "../../../store/gameDataStore";

/**
 * 화학 공장 꼴 3×3 — 유체 **입력 2개가 N 면**, **출력 2개가 S 면**.
 * `positions` 는 게임데이터가 이미 N/E/S/W 로 돌려 둔 배열이다(export-gamedata.lua).
 * 중심 기준 경계 좌표라 N 입력은 y=-2, 시계 90° 돌면 x=+2 로 간다.
 */
const chemicalPlant = {
  name: "chemical-plant",
  fluid_boxes: [
    {
      index: 1,
      production_type: "input",
      connections: [{ positions: [
        { x: -1, y: -2 }, // N (direction 0)
        { x: 2, y: -1 },  // E (direction 4)
        { x: 1, y: 2 },   // S (direction 8)
        { x: -2, y: 1 },  // W (direction 12)
      ] }],
    },
    {
      index: 2,
      production_type: "output",
      connections: [{ positions: [
        { x: -1, y: 2 },  // N 기준 S 면
        { x: -2, y: -1 }, // E 로 돌리면 W 면
        { x: 1, y: -2 },
        { x: 2, y: 1 },
      ] }],
    },
  ],
} as unknown as Entity;

const SIZE = { w: 3, h: 3 };

describe("fluidPorts — 유체 입구가 어느 면에 오나", () => {
  it("안 돌리면(0) 입력은 N, 출력은 S — 프로토타입 그대로", () => {
    const slots = fluidPortSlots(chemicalPlant, SIZE, 0);
    expect(slots.map((s) => `${s.productionType}:${s.face}`)).toEqual(["input:N", "output:S"]);
  });

  it("시계 90°(4) 돌리면 입력이 E, 출력이 W — 우리 규칙과 같은 방향", () => {
    // 이게 트렁크 파이프의 전제다: 기둥에서 N/S 는 이웃 머신에 막히고 W/E 만 노출된다.
    const slots = fluidPortSlots(chemicalPlant, SIZE, 4);
    expect(slots.map((s) => `${s.productionType}:${s.face}`)).toEqual(["input:E", "output:W"]);
  });

  it("입력을 E 면으로 받으려면 어느 각도냐 → 데이터가 4 라고 답한다", () => {
    const chosen = chooseMachineDirection(chemicalPlant, SIZE, "petroleum-gas", "E", "input");
    expect(chosen).not.toBeNull();
    expect(chosen!.direction).toBe(4);
    expect(chosen!.slot.face).toBe("E");
    expect(chosen!.slot.productionType).toBe("input");
  });

  it("유체 상자가 아예 없는 머신이면 null — 지어내지 않는다", () => {
    const furnace = { name: "electric-furnace" } as unknown as Entity;
    expect(chooseMachineDirection(furnace, SIZE, "water", "E", "input")).toBeNull();
  });

  it("filter 가 걸린 상자를 우선한다 — 같은 면에 상자가 여럿일 때", () => {
    // 입력 상자 두 개가 다 E 에 오는데, 하나만 이 유체를 받는다.
    const twoInputs = {
      name: "two-input",
      fluid_boxes: [
        {
          index: 1, production_type: "input", filter: "water",
          connections: [{ positions: [{ x: -1, y: -2 }, { x: 2, y: -1 }, { x: 1, y: 2 }, { x: -2, y: 1 }] }],
        },
        {
          index: 2, production_type: "input", filter: "steam",
          connections: [{ positions: [{ x: 1, y: -2 }, { x: 2, y: 1 }, { x: -1, y: 2 }, { x: -2, y: -1 }] }],
        },
      ],
    } as unknown as Entity;

    const steam = chooseMachineDirection(twoInputs, SIZE, "steam", "E", "input");
    // 등장 순서로는 water 상자가 먼저지만, filter 가 맞는 steam 상자를 골라야 한다.
    expect(steam!.slot.filter).toBe("steam");
    expect(steam!.slot.face).toBe("E");

    const water = chooseMachineDirection(twoInputs, SIZE, "water", "E", "input");
    expect(water!.slot.filter).toBe("water");
  });
});
