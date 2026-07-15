/**
 * pipeFlow — 파이프 합류 가드.
 *
 * 검증 대상은 두 가지 사실이다:
 *  1. 파이프는 **방향이 없다** → 남의 관 네 이웃이 전부 금지 칸이다.
 *  2. 파이프 처리량은 **무한이다** → **같은 유체**는 닿아도 무해하므로 안 막는다.
 * 그리고 머신 유체 상자는 **연결 칸 하나**만 막는다(벽 전체가 아니다) — 그 칸이 어디인지는
 * 좌표가 아니라 `PipeConnection.direction` 이 정한다.
 */

import { describe, expect, it } from "vitest";
import type { Entity } from "../../../store/gameDataStore";
import { collectPipeFlow, pipeFlowConflict, type PipeFlowMachine } from "./pipeFlow";

/**
 * 화학 공장 모형(3×3). 실데이터와 같은 모양:
 *  - 입력 상자 2개 — 둘 다 **N 면**(`direction: 0`), 좌표는 안쪽 **모서리 칸**(|x|=|y|).
 *  - 출력 상자 2개 — 둘 다 **S 면**(`direction: 8`).
 *  - `filter` 없음 → 받는 유체 이름은 **레시피**가 정한다.
 * positions 는 N/E/S/W 네 회전을 미리 돌려 둔 배열(export 단계에서 생성).
 */
function chemicalPlant(): Entity {
  const rot = (x: number, y: number) => [
    { x, y }, // 0 (N)
    { x: -y, y: x }, // 4 (E)
    { x: -x, y: -y }, // 8 (S)
    { x: y, y: -x }, // 12 (W)
  ];
  return {
    name: "chemical-plant",
    type: "assembling-machine",
    fluid_boxes: [
      { index: 1, production_type: "input", connections: [{ positions: rot(-1, -1), direction: 0 }] },
      { index: 2, production_type: "input", connections: [{ positions: rot(1, -1), direction: 0 }] },
      { index: 3, production_type: "output", connections: [{ positions: rot(-1, 1), direction: 8 }] },
      { index: 4, production_type: "output", connections: [{ positions: rot(1, 1), direction: 8 }] },
    ],
  } as unknown as Entity;
}

/** plastic-bar 를 굽는 화학 공장 — 유체 재료 1개(석유 가스), 유체 산출물 없음. */
function plasticBarMachine(origin = { x: 0, y: 0 }, direction = 4): PipeFlowMachine {
  return {
    origin,
    size: { w: 3, h: 3 },
    direction: direction as PipeFlowMachine["direction"],
    entity: chemicalPlant(),
    // fluidbox_index 미지정 → 석유 가스는 **입력 상자 둘 다** 받는다.
    recipeFluids: { ingredients: [{ name: "petroleum-gas" }], products: [] },
  };
}

const key = (x: number, y: number) => `${x},${y}`;

describe("collectPipeFlow — 남의 파이프", () => {
  it("다른 유체의 파이프는 셀 자신 + 네 이웃이 전부 hard 금지 칸이다 (파이프엔 방향이 없다)", () => {
    const flow = collectPipeFlow({
      fluidName: "water",
      pipes: [{ x: 5, y: 5, fluid: "petroleum-gas" }],
      machines: [],
    });
    for (const k of [key(5, 5), key(5, 4), key(6, 5), key(5, 6), key(4, 5)])
      expect(flow.blockedTilesHard.has(k)).toBe(true);
    expect(flow.blockedTilesHard.has(key(6, 6))).toBe(false); // 대각선은 안 닿는다.
  });

  it("같은 유체의 파이프는 **아예 안 막는다** — 처리량이 무한이라 합쳐져도 손해가 없다", () => {
    const flow = collectPipeFlow({
      fluidName: "water",
      pipes: [{ x: 5, y: 5, fluid: "water" }],
      machines: [],
    });
    expect(flow.blockedTilesHard.size).toBe(0);
    expect(flow.blockedTilesSoft.size).toBe(0);
  });
});

describe("collectPipeFlow — 남의 머신 유체 상자", () => {
  it("출력 상자의 연결 칸은 hard 다 — 같은 유체라도 남의 생산물이 내 관망으로 샌다", () => {
    // direction 4(시계 90°) → 입력(dir 0)은 E 면, 출력(dir 8)은 W 면.
    const m = plasticBarMachine({ x: 0, y: 0 }, 4);
    const flow = collectPipeFlow({ fluidName: "petroleum-gas", pipes: [], machines: [m] });
    // 출력 = W 면 → 머신 바로 서쪽 열(x = -1). 두 상자 → 두 칸.
    expect(flow.blockedTilesHard.has(key(-1, 0))).toBe(true);
    expect(flow.blockedTilesHard.has(key(-1, 2))).toBe(true);
  });

  it("이 유체를 받는 입력 상자는 안 막는다 — 트렁크 파이프가 지나가라고 만든 칸이다", () => {
    const m = plasticBarMachine({ x: 0, y: 0 }, 4);
    const flow = collectPipeFlow({ fluidName: "petroleum-gas", pipes: [], machines: [m] });
    // 입력 = E 면 → 머신 바로 동쪽 열(x = 3). fluidbox_index 미지정이라 **두 상자 모두** 받는다.
    expect(flow.blockedTilesHard.has(key(3, 0))).toBe(false);
    expect(flow.blockedTilesSoft.has(key(3, 0))).toBe(false);
    expect(flow.blockedTilesSoft.has(key(3, 2))).toBe(false);
  });

  it("다른 유체가 그 입력 상자에 닿는 건 soft 다 — 머신이 스스로 거르므로 물류는 안 망가진다", () => {
    const m = plasticBarMachine({ x: 0, y: 0 }, 4);
    const flow = collectPipeFlow({ fluidName: "water", pipes: [], machines: [m] });
    expect(flow.blockedTilesSoft.has(key(3, 0))).toBe(true);
    expect(flow.blockedTilesSoft.has(key(3, 2))).toBe(true);
    expect(flow.blockedTilesHard.has(key(3, 0))).toBe(false);
  });

  it("머신 벽 전체가 아니라 **연결 칸만** 막는다", () => {
    const m = plasticBarMachine({ x: 0, y: 0 }, 4);
    const flow = collectPipeFlow({ fluidName: "water", pipes: [], machines: [m] });
    // E 면 가운데 칸(3,1)엔 유체 상자가 없다 → 파이프가 지나가도 머신과 안 이어진다.
    expect(flow.blockedTilesSoft.has(key(3, 1))).toBe(false);
    expect(flow.blockedTilesHard.has(key(3, 1))).toBe(false);
    // N 면은 회전 뒤 유체 상자가 하나도 없다.
    expect(flow.blockedTilesHard.has(key(1, -1))).toBe(false);
  });

  it("fluidbox_index 가 지정되면 그 번호의 상자 하나만 그 유체를 받는다", () => {
    const m = plasticBarMachine({ x: 0, y: 0 }, 4);
    // 같은 화학 공장, 다만 레시피가 "석유 가스는 **1번** 입력 상자로" 라고 못박은 경우.
    m.recipeFluids = { ingredients: [{ name: "petroleum-gas", fluidbox_index: 1 }], products: [] };
    const flow = collectPipeFlow({ fluidName: "petroleum-gas", pipes: [], machines: [m] });
    expect(flow.blockedTilesSoft.has(key(3, 0))).toBe(false); // 1번 상자 — 받는다.
    expect(flow.blockedTilesSoft.has(key(3, 2))).toBe(true); // 2번 상자 — 이 유체를 안 받는다.
  });

  it("유체 상자가 없는 머신(조립기)은 아무 칸도 안 만든다", () => {
    const flow = collectPipeFlow({
      fluidName: "water",
      pipes: [],
      machines: [
        {
          origin: { x: 0, y: 0 },
          size: { w: 3, h: 3 },
          direction: 0,
          entity: { name: "assembling-machine-2" } as unknown as Entity,
          recipeFluids: { ingredients: [], products: [] },
        },
      ],
    });
    expect(flow.blockedTilesHard.size).toBe(0);
    expect(flow.blockedTilesSoft.size).toBe(0);
  });
});

describe("pipeFlowConflict", () => {
  const flow = collectPipeFlow({
    fluidName: "water",
    pipes: [{ x: 5, y: 5, fluid: "petroleum-gas" }],
    machines: [plasticBarMachine({ x: 0, y: 0 }, 4)],
  });

  it("금지 칸을 밟는 첫 칸과 규칙 등급을 돌려준다", () => {
    const hit = pipeFlowConflict([{ x: 9, y: 9 }, { x: 4, y: 5 }], flow);
    expect(hit).toEqual({ cell: { x: 4, y: 5 }, rule: "hard" });
  });

  it("안 밟으면 null", () => {
    expect(pipeFlowConflict([{ x: 9, y: 9 }, { x: 8, y: 2 }], flow)).toBeNull();
  });

  it("soft 가드는 해제할 수 있다 — 해제해도 hard 는 그대로 지킨다", () => {
    const softCell = [{ x: 3, y: 0 }]; // 석유 가스 입력 상자 — 물 파이프엔 soft.
    expect(pipeFlowConflict(softCell, flow)?.rule).toBe("soft");
    expect(pipeFlowConflict(softCell, flow, false)).toBeNull();
    expect(pipeFlowConflict([{ x: 5, y: 5 }], flow, false)?.rule).toBe("hard");
  });
});
