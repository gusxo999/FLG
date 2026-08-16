import { describe, it, expect } from "vitest";
import { packModuleTree, moduleExtent, type NodeSpec, type PackConfig } from "../planner/modulePacking";
import { routeDeliveryRoutes } from "../planner/deliveryRoute";
import { rePathToPerimeter } from "./modulePerimeterPass";
import { PERIMETER_MARGIN, faceVector } from "../util/helper";
import { seatIsBeltFeeder } from "../planner/deliveryRoute";
import type { IoLine } from "../planner/module/clusterPortPlanner";
import { EntityType } from "../../types/layout";

const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });
const M = { entityName: "assembling-machine-2", w: 3, h: 3 };

const config: PackConfig = {
  inserterEntityName: "inserter",
  inserters: [{ entityName: "i", reach: 1, throughput: 0 }, { entityName: "long-handed-inserter", reach: 2, throughput: 0 }],
  beltEntityName: "transport-belt",
};

// 3-depth: root ← mid ← leaf. root/mid 각각 raw 입력 1개 + 자식-공급 입력 1개.
const specs: NodeSpec[] = [
  { id: "root", depth: 0, machine: M, count: 4, lines: [inL("rawA"), inL("midOut"), outL("rootOut")] },
  { id: "mid", depth: 1, parentId: "root", machine: M, count: 3, lines: [inL("rawB"), inL("leafOut"), outL("midOut")] },
  { id: "leaf", depth: 2, parentId: "mid", machine: M, count: 2, lines: [inL("rawC"), outL("leafOut")] },
];

function survivingChests(pack: ReturnType<typeof packModuleTree>, stripped: Set<string>) {
  const out: { id: string; origin: { x: number; y: number }; role?: string }[] = [];
  for (const pl of pack.placements)
    for (const c of pl.module.chests)
      if (!stripped.has(c.id)) out.push({ id: c.id, origin: { ...c.origin }, role: c.role });
  return out;
}

/** 모듈 union(마진 제외) = 전역 외곽 변 기준. */
function moduleUnion(pack: ReturnType<typeof packModuleTree>): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of pack.placements) {
    const e = moduleExtent(pl.module);
    minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + e.w - 1); maxY = Math.max(maxY, e.y + e.h - 1);
  }
  return { minX, minY, maxX, maxY };
}

function onEdge(p: { x: number; y: number }, u: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  return p.x <= u.minX || p.x >= u.maxX || p.y <= u.minY || p.y >= u.maxY;
}

/** 순수 결과 적용 후의 유효 셀 = (mod.cells − droppedCellKeys) + addedCells. moduleWizard 어댑터 동형. */
function effectiveCells(
  pack: ReturnType<typeof packModuleTree>,
  res: ReturnType<typeof rePathToPerimeter>,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const pl of pack.placements)
    for (const c of pl.module.cells)
      if (!res.droppedCellKeys.has(`${c.x},${c.y}`)) out.push({ x: c.x, y: c.y });
  for (const c of res.addedCells) out.push({ x: c.x, y: c.y });
  return out;
}

describe("rePathToPerimeter", () => {
  it("순수 — pack 미변형(chest.origin·mod.cells 그대로), 이사 결과는 relocations 로 반환", () => {
    // 예약 on — 채널이 lane 만큼 넓어져야 channel-host 상자도 통로가 난다.
    const pack = packModuleTree(specs, { ...config, reservePerimeterLanes: true });
    const delivery = routeDeliveryRoutes(pack, { beltEntityName: "transport-belt" });
    expect(delivery.failures).toBe(0);

    const u = moduleUnion(pack);
    const survBefore = survivingChests(pack, delivery.strippedChestIds);
    // 재배치 전: 적어도 하나는 내부(전역 외곽이 아님).
    expect(survBefore.some((c) => !onEdge(c.origin, u))).toBe(true);
    const cellsBefore = JSON.stringify(pack.placements.map((pl) => pl.module.cells.length));

    const res = rePathToPerimeter(pack, delivery.strippedChestIds, delivery.cells, {
      beltEntityName: "transport-belt",
      inserterEntityName: "inserter",
    });
    expect(res.ok).toBe(true);
    expect(res.relocated).toBeGreaterThan(0);
    expect(res.relocated + res.skipped).toBe(survBefore.length);
    expect(res.relocations.length).toBe(res.relocated);

    // 순수성: pack 은 한 셀도 바뀌지 않았다(chest.origin·mod.cells 길이 불변).
    expect(survivingChests(pack, delivery.strippedChestIds)).toEqual(survBefore);
    expect(JSON.stringify(pack.placements.map((pl) => pl.module.cells.length))).toBe(cellsBefore);

    // 이사한 상자의 새 origin(relocations)은 전역 외곽에서 [PERIMETER_MARGIN] 칸 바깥 변에
    // 앉는다([modulePerimeterPass.perimeterOf]). 마진이 2인 이유: 벨트 1칸 + 인서터 1칸 —
    // 상자 자리 인서터는 머신을 먹이는 상주 인서터라 벨트로 재사용할 수 없다.
    const m = PERIMETER_MARGIN;
    for (const r of res.relocations) {
      const onOuter =
        r.origin.y === u.minY - m || r.origin.y === u.maxY + m ||
        r.origin.x === u.minX - m || r.origin.x === u.maxX + m;
      expect(onOuter, `${r.chestId} @(${r.origin.x},${r.origin.y}) not on outer perimeter`).toBe(true);
    }
  });

  it("유효 셀 겹침 0 — 적용(drop+add) 후에도 좌표 고유", () => {
    const pack = packModuleTree(specs, config);
    const delivery = routeDeliveryRoutes(pack, { beltEntityName: "transport-belt" });
    const res = rePathToPerimeter(pack, delivery.strippedChestIds, delivery.cells, {
      beltEntityName: "transport-belt",
      inserterEntityName: "inserter",
    });
    const seen = new Set<string>();
    for (const c of effectiveCells(pack, res)) {
      const k = `${c.x},${c.y}`;
      expect(seen.has(k), `중복 ${k}`).toBe(false);
      seen.add(k);
    }
  });

  it("이사 상자 — addedCells 에 새 origin InfinityChest, 옛 chest 자리는 droppedCellKeys", () => {
    const pack = packModuleTree(specs, config);
    const delivery = routeDeliveryRoutes(pack, { beltEntityName: "transport-belt" });
    const survBefore = new Map(survivingChests(pack, delivery.strippedChestIds).map((c) => [c.id, c.origin]));
    const res = rePathToPerimeter(pack, delivery.strippedChestIds, delivery.cells, {
      beltEntityName: "transport-belt",
      inserterEntityName: "inserter",
    });
    // addedCells 의 InfinityChest 위치 = 대응 relocation.origin.
    const addedChestAt = new Map<string, { x: number; y: number }>();
    for (const c of res.addedCells)
      if (c.cell.entityType === EntityType.InfinityChest) addedChestAt.set(c.cell.entityId ?? "", { x: c.x, y: c.y });
    for (const r of res.relocations) {
      expect(addedChestAt.get(r.chestId)).toEqual(r.origin);
      // 옛 chest 자리(origin)는 떼어낼 좌표에 포함.
      const old = survBefore.get(r.chestId)!;
      expect(res.droppedCellKeys.has(`${old.x},${old.y}`)).toBe(true);
    }
    // 상자마다 **anchor(옛 상자 자리)는 반드시** 떼고, 좌석은 종류에 따라 갈린다:
    //  - belt→상자 피더(링크/트렁크): 좌석도 떼서 belt 로 메운다(anchor + seat = 2칸).
    //  - 머신 투입 인서터(다이렉트 1:1): 좌석은 유지(anchor 1칸).
    // 따라서 뗀 칸 수는 [relocated, 2×relocated] 사이다. (좌석까지 떼는 걸 콕 집어 보는
    // 것은 아래 "belt→상자 피더 좌석을 뗀다" 전용 테스트.)
    expect(res.droppedCellKeys.size).toBeGreaterThanOrEqual(res.relocated);
    expect(res.droppedCellKeys.size).toBeLessThanOrEqual(res.relocated * 2);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // **belt→상자 피더 좌석을 뗀다** (2026-07-23).
  //
  // 포트는 `트렁크벨트 — 좌석(인서터) — 상자` 다. 상자를 외곽으로 이사하면 좌석 뒤에도
  // belt(이사 경로)가 붙어 좌석이 **belt→belt** 가 된다 — 하는 일 없이 처리량만 인서터
  // 속도로 깎는다(실측: kr-glass 20/s 가 좌석+feeder 2개 직렬로 10/s 병목). 그래서 좌석도
  // 떼고 그 자리를 belt 로 메워야 한다. deliveryRoute 이 모듈↔모듈 납품 경로에서 이미 하는 것과 같은
  // 판정([seatIsBeltFeeder])을 이사 pass 도 써야 한다.
  //
  // 되돌려 확인: modulePerimeterPass 의 `stripSeat` 를 지우면 seat 이 droppedCellKeys 에서
  // 빠지고 그 자리에 belt 가 안 깔려 이 테스트가 깨진다(= 인서터 2개 직렬이 남는다).
  // ───────────────────────────────────────────────────────────────────────────
  it("belt→상자 피더 좌석을 belt 로 대체한다 — 인서터 2개 직렬 병목 제거", () => {
    const pack = packModuleTree(specs, config);
    const delivery = routeDeliveryRoutes(pack, { beltEntityName: "transport-belt" });

    // 이사 전: 살아남는 상자마다 그 포트의 좌석 좌표와 피더 여부를 기록한다.
    const seatOf = new Map<string, { x: number; y: number; feeder: boolean }>();
    for (const pl of pack.placements)
      for (const port of [...pl.module.inputPorts, ...pl.module.outputPorts]) {
        if (delivery.strippedChestIds.has(port.chest.id)) continue;
        const fv = faceVector(port.face);
        seatOf.set(port.chest.id, {
          x: port.anchor.x - fv.x,
          y: port.anchor.y - fv.y,
          feeder: seatIsBeltFeeder(port),
        });
      }

    const res = rePathToPerimeter(pack, delivery.strippedChestIds, delivery.cells, {
      beltEntityName: "transport-belt",
      inserterEntityName: "inserter",
    });

    const beltAt = new Set(
      res.addedCells
        .filter((c) => c.cell.entityType === EntityType.Belt || c.cell.entityType === EntityType.UndergroundBelt)
        .map((c) => `${c.x},${c.y}`),
    );

    let checkedFeeder = 0;
    for (const r of res.relocations) {
      const s = seatOf.get(r.chestId);
      if (!s || !s.feeder) continue; // 다이렉트(머신 투입) 좌석은 유지가 정상 — 대상 아님
      checkedFeeder++;
      const key = `${s.x},${s.y}`;
      expect(res.droppedCellKeys.has(key), `좌석 ${key} 를 떼야 한다`).toBe(true);
      expect(beltAt.has(key), `좌석 ${key} 자리를 belt 로 메워야 한다`).toBe(true);
    }
    // 이 셋업(throughput 미지정 → 옛 트렁크 방출)은 belt 포트가 전부 피더라, 최소 하나는
    // 검증돼야 한다 — 0 이면 판정 자체가 죽은 것이라 이 테스트가 계측기 노릇을 못 한다.
    expect(checkedFeeder).toBeGreaterThan(0);
  });

  it("결정적 — 같은 입력 → 같은 relocations", () => {
    const run = () => {
      const pack = packModuleTree(specs, config);
      const delivery = routeDeliveryRoutes(pack, { beltEntityName: "transport-belt" });
      const res = rePathToPerimeter(pack, delivery.strippedChestIds, delivery.cells, {
        beltEntityName: "transport-belt",
        inserterEntityName: "inserter",
      });
      return JSON.stringify(res.relocations.map((r) => [r.chestId, r.origin]));
    };
    expect(run()).toEqual(run());
  });

  it("count≥2 코너 어깨(face=N/S) 상자가 채널로 우회한다 — 그 사유의 skip 이 0", () => {
    // 분기 트리 n0←{n1,n2}, count=2. count≥2 기둥에선 트렁크가 레인을 따라 수평으로
    // 자라 상자가 코너 어깨(face=N/S, metaSide=E/W)에 앉는다. 옛 코드는 이 상자의 채널
    // 우회를 fv.x=0 로 무조건 거부(`N/S-side channel divert unsupported`)했고, 예약된
    // 채널 트랙이 자기 트렁크를 관통하는 상자(copper-cable)도 skip 됐다. laneX 구동 +
    // auto 폴백으로 전부 열린 외곽(대개 face 직진)으로 나가야 한다.
    const bin = (name: string, amount: number): IoLine => ({ name, kind: "belt", role: "input", amount });
    const bout = (name: string, amount: number): IoLine => ({ name, kind: "belt", role: "output", amount });
    const M3 = { entityName: "assembling-machine-3", w: 3, h: 3 };
    const branch: NodeSpec[] = [
      { id: "n0", depth: 0, machine: M3, count: 2, lines: [bin("copper-cable", 4), bin("electronic-circuit", 2), bin("kr-components", 2), bout("advanced-circuit", 1)] },
      { id: "n1", depth: 1, parentId: "n0", machine: M3, count: 2, lines: [bin("plastic-bar", 4), bin("kr-silicon", 2), bin("kr-glass", 2), bout("kr-components", 4)] },
      { id: "n2", depth: 1, parentId: "n0", machine: M3, count: 2, lines: [bin("copper-cable", 3), bin("stone-tablet", 1), bout("electronic-circuit", 2)] },
    ];
    const pack = packModuleTree(branch, { ...config, reservePerimeterLanes: true, channelGeometry: true });
    const delivery = routeDeliveryRoutes(pack, { beltEntityName: "transport-belt" });
    expect(delivery.failures).toBe(0);
    const res = rePathToPerimeter(pack, delivery.strippedChestIds, delivery.cells, {
      beltEntityName: "transport-belt",
      inserterEntityName: "inserter",
    });
    expect(res.relocated).toBeGreaterThan(0);
    // 이 테스트가 만들어진 결함: 어깨 상자의 채널 우회를 `fv.x === 0` 으로 무조건 거부했다.
    expect(res.skips.filter((k) => /N\/S-side channel divert/.test(k.reason))).toEqual([]);
    // 적용 후 유효 셀 겹침 0.
    const seen = new Set<string>();
    for (const c of effectiveCells(pack, res)) {
      const k = `${c.x},${c.y}`;
      expect(seen.has(k), `중복 ${k}`).toBe(false);
      seen.add(k);
    }
  });
});
