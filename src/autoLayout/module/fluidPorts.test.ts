/**
 * fluidPorts — 회전 각도를 **데이터에서** 고르는 부분.
 *
 * 이게 틀리면 유체 입구가 엉뚱한 면을 보고, 파이프가 머신에 안 닿는다(머신이 굶는다).
 * 그런데 증상은 "파이프는 깔렸는데 안 돌아간다"라 조용하다 — 그래서 따로 못 박는다.
 *
 * → docs/auto-layout-wizard.trunk-pipe.md §3 / §6
 */
import { describe, it, expect } from "vitest";
import {
  chooseFluidTrunkPlan,
  fluidJumpBlocker,
  fluidPortSlots,
  laneDepthCap,
  type FluidLineSpec,
} from "./fluidPorts";
import type { Entity } from "../../UI/store/gameDataStore";

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

const inputLine = (name: string, fluidboxIndex?: number): FluidLineSpec => ({ name, role: "input", fluidboxIndex });
const outputLine = (name: string, fluidboxIndex?: number): FluidLineSpec => ({ name, role: "output", fluidboxIndex });

/**
 * **`se-space-biochemical-laboratory` — 다중 유체의 기준 사례**(SE 0.7.57 원본 그대로).
 *
 * 9×9 에 유체 상자 **12개**: 입력이 W·N 에 3개씩, 출력이 E·S 에 3개씩이다. 즉 이 머신은
 * **우리 규약(출력 W · 입력 E)과 정확히 반대로 생겼고**, 180° 를 줘야 맞는다 — 각도를
 * 상수로 박으면 안 되는 이유의 실물이다(→ [[trunk-pipe]] §3).
 *
 * `positions` 는 exporter 가 N/E/S/W 로 미리 돌려 둔 배열이라, 여기서도 프로토타입 좌표를
 * `(x,y) → (−y,x)` 로 네 번 순환시켜 적는다(실데이터와 같은 모양).
 */
const rot4 = (x: number, y: number) => {
  const out = [{ x, y }];
  for (let i = 0; i < 3; i++) {
    const p = out[out.length - 1];
    out.push({ x: -p.y, y: p.x });
  }
  return out;
};
const labBox = (production_type: string, direction: number, x: number, y: number) => ({
  production_type,
  connections: [{ direction, positions: rot4(x, y) }],
});
const biochemicalLab = {
  name: "se-space-biochemical-laboratory",
  fluid_boxes: [
    // 입력 6개 — W 면 3(좌표 x=−4) + N 면 3(좌표 y=−4). 모드 원본 순서 그대로.
    labBox("input", 12, -4, 2),
    labBox("input", 0, -2, -4),
    labBox("input", 12, -4, 0),
    labBox("input", 0, 0, -4),
    labBox("input", 12, -4, -2),
    labBox("input", 0, 2, -4),
    // 출력 6개 — S 면 3 + E 면 3.
    labBox("output", 8, -2, 4),
    labBox("output", 4, 4, 2),
    labBox("output", 8, 0, 4),
    labBox("output", 4, 4, 0),
    labBox("output", 8, 2, 4),
    labBox("output", 4, 4, -2),
  ],
} as unknown as Entity;

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
    const plan = chooseFluidTrunkPlan(chemicalPlant, SIZE, [inputLine("petroleum-gas")]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.direction).toBe(4);
    expect(plan.lines[0]).toMatchObject({ side: "E", rank: 0 });
  });

  it("유체 상자가 아예 없는 머신이면 실패 — 지어내지 않는다", () => {
    const furnace = { name: "electric-furnace" } as unknown as Entity;
    const plan = chooseFluidTrunkPlan(furnace, SIZE, [inputLine("water")]);
    expect(plan.ok).toBe(false);
  });

  it("filter 가 걸린 유체 상자를 우선한다 — 같은 면에 유체 상자가 여럿일 때", () => {
    // 유체 입력 상자 두 개가 다 E 에 오는데, 하나만 이 유체를 받는다.
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

    // 등장 순서로는 water 유체 상자가 먼저지만, filter 가 맞는 steam 유체 상자를 골라야 한다.
    const steam = chooseFluidTrunkPlan(twoInputs, SIZE, [inputLine("steam")]);
    expect(steam.ok && steam.lines[0].boxIndex).toBe(1);
    const water = chooseFluidTrunkPlan(twoInputs, SIZE, [inputLine("water")]);
    expect(water.ok && water.lines[0].boxIndex).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 다중 유체 — **회전은 하나, 줄은 여럿**
//
// 회전이 머신 속성이라 줄마다 다를 수 없다. 그래서 판정은 "각 줄이 되나"가 아니라
// **"모든 줄이 한 각도에서 동시에 되나"** 다. 이 구분이 안 되면 각 줄은 통과하는데 배치가
// 조용히 어긋난다. → docs/auto-layout/module/trunk-pipe.md §5
// ─────────────────────────────────────────────────────────────────────────────
describe("chooseFluidTrunkPlan — 유체 줄 여럿을 한 회전에", () => {
  it("유체 입력 1 + 출력 1: 한 각도로 입력 E · 출력 W 를 동시에 만족한다", () => {
    const plan = chooseFluidTrunkPlan(chemicalPlant, SIZE, [
      inputLine("water"),
      outputLine("sulfuric-acid"),
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.direction).toBe(4); // 입력 N→E, 출력 S→W 가 같은 각도에서 성립
    expect(plan.lines.map((l) => `${l.role}:${l.side}${l.fluidboxOffset}#${l.rank}`)).toEqual([
      "input:E0#0",
      "output:W0#0",
    ]);
  });

  it("같은 면에 2줄이면 순번(rank)이 offset 오름차순으로 붙는다 — 안쪽이 rank 0", () => {
    // 여기 한때 "2줄이면 거절" 테스트가 있었다. 그 상한은 기하의 사실이 아니라 아직 안
    // 만든 것에 붙인 임시 문턱이었고, 유체 하나당 폭 2칸(탭 1 + 관 1)으로 성립하는 것이
    // 확인되어 사라졌다. 진짜 상한은 지하파이프 사거리다 → [fluidJumpBlocker].
    const plan = chooseFluidTrunkPlan(chemicalPlant, SIZE, [
      inputLine("water"),
      inputLine("light-oil"),
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // 화학 공장의 유체 입력 상자는 E 면 offset 0·2 — 안쪽(0)이 rank 0.
    expect(plan.lines.map((l) => `${l.fluidboxOffset}#${l.rank}`).sort()).toEqual(["0#0", "2#1"]);
  });

  it("**기준 사례** SE 생화학 랩: 회전 0 은 우리 규약과 정반대인데 돌리면 맞는다", () => {
    // 이 머신은 회전 0 에서 **입력이 W·N, 출력이 E·S** 로 우리 규약(출력 W · 입력 E)과
    // 정확히 반대다. 각도를 상수로 박으면 여기서 조용히 깨진다(→ [[trunk-pipe]] §3).
    expect(
      fluidPortSlots(biochemicalLab, { w: 9, h: 9 }, 0).map((s) => `${s.productionType}:${s.face}`),
    ).toEqual([
      "input:W", "input:N", "input:W", "input:N", "input:W", "input:N",
      "output:S", "output:E", "output:S", "output:E", "output:S", "output:E",
    ]);

    const plan = chooseFluidTrunkPlan(
      biochemicalLab,
      { w: 9, h: 9 },
      [inputLine("heavy-oil"), outputLine("se-space-coolant-hot")],
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // **성립하는 각도가 하나가 아니다** — 입력이 두 면(W·N)에 있어서 90°(N→E)도, 180°
    // (W→E)도 맞는다. 그래서 "정답 각도"를 못 박는 대신 **결정적으로 가장 작은 각도**를
    // 고른다는 것과, 그때 줄이 자기 역할 면에 온다는 것을 못 박는다.
    expect(plan.direction).toBe(4);
    expect(plan.lines.map((l) => `${l.role}:${l.side}${l.fluidboxOffset}`)).toEqual([
      "input:E2",
      "output:W2",
    ]);
  });

  it("유체 상자가 남으면 offset 오름차순으로 앞에서부터 고른다 — 배정과 순번이 같은 규칙", () => {
    // SE 랩은 E 면 유체 입력 상자가 3개(rows 2·4·6)인데 줄은 2개다. 셋 중 앞의 둘.
    const plan = chooseFluidTrunkPlan(
      biochemicalLab,
      { w: 9, h: 9 },
      [inputLine("heavy-oil"), inputLine("se-chemical-gel")],
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lines.map((l) => `${l.fluidboxOffset}#${l.rank}`)).toEqual(["2#0", "4#1"]);
  });

  // ── 안 쓰는 유체 상자 칸 (2026-08-05 브라우저 실측에서 나온 결함) ──────────────
  //
  // 머신이 노출하는 유체 상자가 레시피가 쓰는 것보다 많을 수 있다. 그 남는 칸을 아무도
  // 안 알려 주면 트렁크 파이프가 좌석 줄을 통째로 지나며 **거기 붙어 버리고**, 합류 가드가
  // hard 위반으로 모듈을 거절한다 — 화면엔 "물러설 곳이 없었습니다" 만 남아 원인이 안 보인다.
  // 프로토타입을 보는 자리는 여기뿐이라 여기서 세어 알려 준다.
  it("레시피가 안 쓰는 유체 상자 칸을 면별로 알려 준다 — 파이프가 비켜 갈 근거", () => {
    // 화학공장은 입력 상자가 E 면에 둘(offset 0·2)인데 battery 는 하나만 쓴다.
    const plan = chooseFluidTrunkPlan(chemicalPlant, SIZE, [inputLine("sulfuric-acid")]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lines.map((l) => `${l.side}${l.fluidboxOffset}`)).toEqual(["E0"]);
    // 안 쓴 입력 상자(E2) + 출력 상자 둘(W0·W2)이 전부 남는다.
    expect(plan.unusedFluidboxRows.E).toEqual([2]);
    expect(plan.unusedFluidboxRows.W).toEqual([0, 2]);
  });

  it("남는 칸이 없으면 빈 목록 — 없는 위험을 지어내지 않는다", () => {
    const plan = chooseFluidTrunkPlan(chemicalPlant, SIZE, [
      inputLine("water"),
      outputLine("sulfuric-acid"),
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // 입력 상자 둘 중 하나, 출력 상자 둘 중 하나만 썼다 → 각 면에 하나씩 남는다.
    expect(plan.unusedFluidboxRows).toEqual({ E: [2], W: [2] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 점프 가능 판정 — **계획과 거절이 같은 함수를 본다.**
//
// 유체가 한 줄이면 못 넘어도 옛 스파인으로 연속적 저하지만, **두 줄이면 거절**이다:
// 스파인은 좌석 줄(d1)을 기둥 전체로 먹어 둘째 줄의 유체 상자 칸을 막는다.
// → docs/auto-layout/module/trunk-pipe.md §5 · §5.1
// ─────────────────────────────────────────────────────────────────────────────
describe("fluidJumpBlocker — 이 면의 유체 n줄이 바깥으로 넘을 수 있나", () => {
  /** 3×3 머신 · 긴팔(reach 2) · 아이템 2줄 · 바닐라 지하파이프(10). */
  const budget = {
    undergroundPipeEntityName: "pipe-to-ground",
    pipeMaxUndergroundDistance: 10,
    seatRows: 3,
    beltLanes: 2,
  };

  // **식이 뒤집혔다**(2026-08-16). 예전엔 *"최악 base 를 가정한 필요 사거리"* 를 냈고, 그
  // 가정 때문에 실제로는 넘을 수 있는 면을 거절했다. 이제 사거리가 **레인 깊이의 상한**을 낸다
  // — 파이프가 먼저 답하고 아이템 레인이 그 안에 들어간다.
  it("사거리가 곧 레인 깊이 상한 — 유체 한 줄이면 사거리 그대로", () => {
    expect(laneDepthCap(1, 10)).toBe(10);
    expect(laneDepthCap(1, 2)).toBe(2); // d2 까지만 — 긴팔 레인(d3)은 안 열린다
  });

  it("유체 줄마다 상한이 2씩 준다 — 바깥 줄의 ClusterPipe 가 더 멀다", () => {
    expect(laneDepthCap(2, 10)).toBe(8);
    expect(laneDepthCap(3, 10)).toBe(6);
  });

  it("상한이 1 미만이면 그때만 거절 — 아이템을 안 놓아도 못 넘는다", () => {
    const wide = { ...budget, seatRows: 12 }; // 좌석 축을 비켜 사거리 축만 본다
    expect(laneDepthCap(6, 10)).toBe(0);
    expect(fluidJumpBlocker(6, wide)?.kind).toBe("underground-too-short");
    expect(fluidJumpBlocker(5, wide)).toBeNull(); // cap=2 — 얕은 레인은 그대로 선다
  });

  it("지하파이프를 안 골랐으면 못 넘는다 — 사거리를 따질 것도 없다", () => {
    const b = { ...budget, undergroundPipeEntityName: undefined };
    expect(fluidJumpBlocker(2, b)?.kind).toBe("no-underground");
  });

  // **문턱이 내려갔다**(2026-08-16 — 식을 뒤집었다). 예전엔 최악 base(=maxReach+1)를 가정해
  // 사거리 4 로 유체 2줄을 거절했는데, 실제로는 얕은 레인만 쓰면 넘는다. 이제 거절은
  // **아이템을 하나도 안 놓아도 못 넘을 때**(base=1)뿐이고, 그 사이는 [laneDepthCap] 이 깎는다.
  it("사거리가 모자라면 underground-too-short — 처방은 파이프 단계다", () => {
    const b = { ...budget, seatRows: 12, pipeMaxUndergroundDistance: 4 };
    expect(fluidJumpBlocker(2, b)).toBeNull(); // cap=2 — 옛 답은 거절이었다
    expect(fluidJumpBlocker(3, b)?.kind).toBe("underground-too-short"); // cap=0
  });

  it("좌석이 모자라면 seats-exhausted — 처방은 더 큰 머신이다", () => {
    // 3행에서 유체 2행을 빼면 1행 — 벨트 2줄이 안 들어간다.
    expect(fluidJumpBlocker(2, budget)?.kind).toBe("seats-exhausted");
  });

  it("**아이템이 없는 레시피는 좌석을 안 쓴다** — 경유 분해가 여기서 살아난다", () => {
    // 물 + 경유 → 경유. 아이템 줄이 0이라 그 면에 벨트가 0줄이다. 인서터 종류 수만 보던
    // 시절엔 `2 ≤ 3−2` 가 거짓이 되어 **아이템이 없는데도** 거절했다.
    expect(fluidJumpBlocker(2, { ...budget, beltLanes: 0 })).toBeNull();
  });

  it("**기준 사례** SE 랩 9×9 — E 면 유체 2줄(cryonite 변형은 3줄)이 다 통과한다", () => {
    const lab = { ...budget, seatRows: 9 };
    expect(fluidJumpBlocker(2, lab)).toBeNull(); // cap 8 · 좌석 9−2=7 ≥ 2
    expect(fluidJumpBlocker(3, lab)).toBeNull(); // cap 6 (cryonite 변형)
    // 바닐라 지하파이프(10)로 넘을 수 있는 것은 **한 면 5줄**까지다(cap 2 — 얕은 레인만).
    // 여섯째 줄은 cap 0 이라 아이템을 안 놓아도 못 넘는다.
    expect(fluidJumpBlocker(5, lab)).toBeNull();
    expect(fluidJumpBlocker(6, { ...lab, seatRows: 12 })?.kind).toBe("underground-too-short");
  });
});
