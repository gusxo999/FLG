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
 * 화학 공장 3×3 — **실측 게임데이터 그대로**(2026-07-13 브라우저 덤프).
 *
 * 좌표는 머신 중심 기준이고 **머신 안쪽 모서리 칸**을 가리킨다. 회전 0에서 입력 상자는
 * `(-1,-1)`·`(1,-1)` = 위쪽 두 모서리, 출력은 `(-1,1)`·`(1,1)` = 아래쪽 두 모서리다.
 * `positions` 는 그 좌표를 N/E/S/W 로 돌려 둔 배열이라 `(x,y) → (−y,x)` 로 순환한다.
 *
 * **모서리라서 좌표만으론 면을 못 정한다** — `(-1,-1)` 이 위로 나가는지 왼쪽으로 나가는지
 * `|x|`·`|y|` 로는 안 갈린다. 면은 오직 `direction` 이 답한다(입력=0=N, 출력=8=S).
 * 이 fixture 를 좌표만으로 지어내면 실제 데이터와 다른 걸 시험하게 된다.
 */
const chemicalPlant = {
  name: "chemical-plant",
  fluid_boxes: [
    {
      index: 1,
      production_type: "input",
      connections: [{
        direction: 0, // 위로 나간다
        positions: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }],
      }],
    },
    {
      index: 2,
      production_type: "input",
      connections: [{
        direction: 0,
        positions: [{ x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }],
      }],
    },
    {
      index: 3,
      production_type: "output",
      connections: [{
        direction: 8, // 아래로 나간다
        positions: [{ x: -1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }],
      }],
    },
    {
      index: 4,
      production_type: "output",
      connections: [{
        direction: 8,
        positions: [{ x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }],
      }],
    },
  ],
} as unknown as Entity;

const SIZE = { w: 3, h: 3 };

describe("fluidPorts — 유체 입구가 어느 면에 오나", () => {
  it("안 돌리면(0) 입력은 N 두 칸, 출력은 S 두 칸 — 프로토타입 그대로", () => {
    const slots = fluidPortSlots(chemicalPlant, SIZE, 0);
    expect(slots.map((s) => `${s.productionType}:${s.face}${s.offset}`)).toEqual([
      "input:N0", "input:N2", "output:S0", "output:S2",
    ]);
  });

  it("시계 90°(4) 돌리면 입력이 E, 출력이 W — 우리 규칙과 같은 방향", () => {
    // 이게 트렁크 파이프의 전제다: 기둥에서 N/S 는 이웃 머신에 막히고 W/E 만 노출된다.
    const slots = fluidPortSlots(chemicalPlant, SIZE, 4);
    expect(slots.map((s) => `${s.productionType}:${s.face}${s.offset}`)).toEqual([
      "input:E0", "input:E2", "output:W0", "output:W2",
    ]);
  });

  it("면은 좌표가 아니라 direction 이 정한다 — 모서리 칸은 좌표로 안 갈린다", () => {
    // 회귀 못: 한때 `|y| ≥ |x|` 면 N/S 로 보내는 규칙을 썼다. 모서리는 |x| = |y| 라 늘
    // N/S 가 이겼고, 그래서 **어느 각도로 돌려도 E 가 안 나왔다**(트렁크 파이프가 못 섰다).
    for (const direction of [0, 4, 8, 12] as const) {
      const faces = new Set(fluidPortSlots(chemicalPlant, SIZE, direction).map((s) => s.face));
      expect(faces.size).toBe(2); // 입력 면 하나 + 출력 면 하나 — 늘 서로 반대
    }
    // direction 없는 구버전 데이터면 지어내지 않는다 — 슬롯이 아예 안 나온다.
    const legacy = {
      name: "legacy",
      fluid_boxes: [{ index: 1, production_type: "input", connections: [{ positions: [{ x: -1, y: -1 }] }] }],
    } as unknown as Entity;
    expect(fluidPortSlots(legacy, SIZE, 0)).toEqual([]);
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
          connections: [{ direction: 0, positions: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }] }],
        },
        {
          index: 2, production_type: "input", filter: "steam",
          connections: [{ direction: 0, positions: [{ x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }] }],
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
