/**
 * **split belt 할당량 문제** — 두 줄 이상을 쓰는 머신이 그 줄들의 맨 끝에 섰나(판정)와, 그래서 받는 머신이
 * 다 도나(가동률)를 **한 판에서 함께** 잰다(`docs/용어사전.md` §split belt 할당량 문제).
 *
 * 판정은 줄의 구조만 읽고(`module/arith/lineOrder` — 좌석이 끝난 뒤의 방향), 가동률은 깔린 그리드를 푼다
 * (`analysis/flow`). 둘은 서로를 안 부른다 — 그래서 **어긋나면 그것이 발견이다.**
 *
 * 판은 전부 같은 사슬이다: 원료 → 중간재 → 완제품, 머신 3×3 · 제작 1초, 벨트 30/s(한 줄 15/s) · 인서터 100/s.
 * 바뀌는 것은 중간재를 주는 머신(자식) 한 대의 몫과 받는 머신(부모) 한 대의 몫뿐이다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGameDataStore, type Entity, type GameData, type Recipe } from "../../UI/store/gameDataStore";
import { runLayeredWizard } from "./build/layered";
import { readRunStats, type SplitBeltCounters } from "../../debug/runStats";
import { unifyLeaf } from "../shared/frames";
import { createEmptyGrid } from "../../types/layout";
import { analyzeLayout } from "../../analysis/flow/build";

const E = (o: object): Entity => o as unknown as Entity;
const ENTITIES: Entity[] = [
  E({ name: "test-machine", type: "assembling-machine", tile_width: 3, tile_height: 3, crafting_speed: 1, crafting_categories: ["test"] }),
  E({ name: "inserter", type: "inserter", tile_width: 1, tile_height: 1, inserter_pickup_position: { x: 0, y: -1 }, inserter_rotation_speed: 0.04 }),
  E({ name: "belt", type: "transport-belt", tile_width: 1, tile_height: 1, belt_speed: 0.0625 }), // 30/s — 한 줄 15/s
  E({ name: "underground", type: "underground-belt", tile_width: 1, tile_height: 1, belt_speed: 0.0625, max_underground_distance: 7 }),
];
const OVERRIDES = { inserter: { throughput: 100 } };

const item = (name: string, amount: number) => ({ name, amount, type: "item" as const });
const recipe = (name: string, ins: [string, number], out: number): Recipe =>
  ({ name, category: "test", energy_required: 1, enabled: true, ingredients: [item(...ins)], products: [item(name, out)] }) as Recipe;

interface Board {
  ok: boolean;
  split: SplitBeltCounters | null;
  /** 받는 머신(완제품) · 주는 머신(중간재)의 가장 낮은 가동률 — 정수 %. */
  parentWorst: number;
  childWorst: number;
  machines: { child: number; parent: number };
}

/** 자식 한 대가 `childShare`/s 를 내고 부모 한 대가 `parentShare`/s 를 쓴다. 완제품 목표는 `total`/s. */
async function board(childShare: number, parentShare: number, total: number): Promise<Board> {
  const data: GameData = {
    entities: ENTITIES,
    recipes: [recipe("mid", ["raw", childShare], childShare), recipe("final", ["mid", parentShare], parentShare)],
  };
  useGameDataStore.getState().setGameData(data);
  const res = await runLayeredWizard({
    targetRecipe: "final",
    countMode: { perTarget: total },
    internalIngredients: new Set(["mid"]),
    selectedMachines: ["test-machine"],
    selectedInserters: ["inserter"],
    selectedBelts: ["belt"],
    selectedUndergroundPipes: [],
    selectedUndergroundBelts: ["underground"],
    inserterOverrides: OVERRIDES,
    externalPortsDefault: "top-left",
  });
  const split = readRunStats().splitBelt;
  const leaf = res.tree.candidates[0];
  if (!res.ok || !leaf) return { ok: false, split, parentWorst: NaN, childWorst: NaN, machines: { child: 0, parent: 0 } };
  // 패널과 같은 길 — 그리드 좌표로 옮겨 셀을 쓰고, 방출이 끝난 그리드를 푼다.
  const u = unifyLeaf(leaf);
  let w = 0;
  let h = 0;
  for (const p of u.placed) { w = Math.max(w, p.x + 2); h = Math.max(h, p.y + 2); }
  const grid = createEmptyGrid(w, h);
  for (const p of u.placed) grid.cells[p.y * w + p.x] = p.cell;
  const gd = useGameDataStore.getState();
  const flow = analyzeLayout(grid, {
    entityMap: gd.entityMap, recipeMap: gd.recipeMap, moduleMap: gd.moduleMap,
    inserterOverrides: OVERRIDES, interiorBbox: u.internalBbox ?? null,
  });
  const of = (name: string) => flow.machines.filter((m) => m.recipe === name);
  const worst = (name: string) => Math.round(Math.min(1, ...of(name).map((m) => m.u)) * 100);
  return {
    ok: true, split, parentWorst: worst("final"), childWorst: worst("mid"),
    machines: { child: of("mid").length, parent: of("final").length },
  };
}

describe("split belt 할당량 — 판정과 가동률을 함께", () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
  });

  /** 편마다 [두 줄 이상을 남과 함께 쓰는 머신, 모든 줄에서 맨 끝, 몫이 작은 줄에서만 맨 끝, 맨 끝 아님]. */
  const standings = (r: Board) => {
    const row = (c: SplitBeltCounters["from"]) => [c.split, c.lastOnAll, c.lastOnSmaller, c.notLast];
    return { from: row(r.split!.from), to: row(r.split!.to) };
  };

  it("대조군 — 자식 5/s 여섯 → 부모 5/s 여섯: 두 줄을 쓰는 머신이 없고 전부 100%", async () => {
    const r = await board(5, 5, 30);
    expect(r.ok).toBe(true);
    expect(standings(r)).toEqual({ from: [0, 0, 0, 0], to: [0, 0, 0, 0] });
    expect(r.parentWorst).toBe(100);
    expect(r.childWorst).toBe(100);
  });

  it("주는 쪽 — 자식 10/s 셋 → 부모 6/s 다섯: 자식 둘이 몫이 작은 줄에서 맨 앞이라 부모가 모자란다", async () => {
    // 붓기 12 · 12 · 6. 자식 1 은 줄마다 2 · 8, 자식 2 는 4 · 6 을 맡는데 둘 다 작은 쪽 줄에서 먼저 싣는다 —
    // 반반 나누면 5 · 5 를 실어 그 줄의 다른 자식이 실을 자리를 먹는다.
    const r = await board(10, 6, 30);
    expect(r.machines).toEqual({ child: 3, parent: 5 });
    expect(standings(r)).toEqual({ from: [2, 0, 0, 2], to: [0, 0, 0, 0] });
    expect(r.parentWorst).toBeLessThan(100);
  });

  it("받는 쪽 — 자식 7/s 여섯 → 부모 6/s 일곱: 부모 하나가 몫이 작은 줄에서 먼저 집어 같은 줄의 끝 부모가 모자란다", async () => {
    // 줄마다 자식 둘(14/s). 부모 2 는 2 · 4, 부모 4 는 4 · 2 를 받는다. 부모 4 가 2 를 받을 줄에서 맨 앞이다.
    const r = await board(7, 6, 42);
    expect(r.machines).toEqual({ child: 6, parent: 7 });
    expect(standings(r)).toEqual({ from: [0, 0, 0, 0], to: [2, 0, 1, 1] });
    expect(r.parentWorst).toBeLessThan(100);
  });

  it("한 줄의 같은 편 양끝 — 자식 9/s 다섯 → 부모 5/s 아홉: 가운데 줄의 양끝에 두 줄을 쓰는 자식이 선다", async () => {
    // 줄 셋(15씩). 자식 1 은 6 · 3, 자식 3 은 3 · 6 — 둘 다 가운데 줄을 쓴다. 한 줄의 맨 끝은 편마다 하나뿐이라
    // 방향만으로는 둘을 다 맨 끝에 세울 수 없다(끊는 자리를 바꿔야 풀린다).
    const r = await board(9, 5, 45);
    expect(r.machines).toEqual({ child: 5, parent: 9 });
    expect(standings(r)).toEqual({ from: [2, 0, 1, 1], to: [0, 0, 0, 0] });
    expect(r.parentWorst).toBeLessThan(100);
  });

  it("몫이 벨트 한 줄보다 큰 머신 — 자식 24/s 둘 → 부모 24/s 둘: 남는 조각이 다른 쌍과 한 줄에 섞인다", async () => {
    // 붓기 15 · 15 · 15 · 3. 한 대가 혼자 두 줄 이상을 쓰는데 그중 한 줄을 이웃과 함께 쓴다.
    const r = await board(24, 24, 48);
    expect(r.machines).toEqual({ child: 2, parent: 2 });
    expect(standings(r)).toEqual({ from: [2, 1, 0, 1], to: [2, 1, 0, 1] });
    expect(r.parentWorst).toBeLessThan(100);
  });
});
