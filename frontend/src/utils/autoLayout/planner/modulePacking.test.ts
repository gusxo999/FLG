import { describe, it, expect } from "vitest";
import { packModuleTree, moduleExtent, type NodeSpec, type PackConfig, type PackResult } from "./modulePacking";
import type { IoLine } from "./module/clusterPortPlanner";
import { faceVector, PERIMETER_MARGIN } from "../util/helper";

const inL = (name: string): IoLine => ({ name, kind: "belt", role: "input" });
const outL = (name: string): IoLine => ({ name, kind: "belt", role: "output" });
const M = { entityName: "assembling-machine-2", w: 3, h: 3 };

// 트리: electronic-circuit(root) ← copper-cable ← copper-plate(raw)
//                                ← iron-plate(raw)
const specs: NodeSpec[] = [
  {
    id: "circuit", depth: 0, machine: M, count: 4,
    lines: [inL("iron-plate"), inL("copper-cable"), outL("electronic-circuit")],
  },
  {
    id: "coppercable", depth: 1, parentId: "circuit", machine: M, count: 5,
    lines: [inL("copper-plate"), outL("copper-cable")],
  },
];

const config: PackConfig = {
  inserterEntityName: "inserter",
  beltEntityName: "transport-belt",
  longInserter: { entityName: "long-handed-inserter", reach: 2 },
};

/** 포트가 머신 bbox 의 어느 변에 붙었나 (테스트 단언용 — 패킹 내부와 동일 규칙). */
function side(anchor: { x: number; y: number }, bbox: { x: number; y: number; w: number; h: number }): string {
  if (anchor.x < bbox.x) return "W";
  if (anchor.x >= bbox.x + bbox.w) return "E";
  if (anchor.y < bbox.y) return "N";
  return "S";
}

describe("packModuleTree", () => {
  it("출력은 W변(부모쪽), 자식-공급 입력은 E변(자식쪽)으로 정렬 — 보장 단언", () => {
    const res = packModuleTree(specs, config);
    const byId = new Map(res.placements.map((p) => [p.id, p.module]));

    const circuit = byId.get("circuit")!;
    const cable = byId.get("coppercable")!;

    // 출력은 부모쪽(W) — 생성 단계 면=역할 확정((B) 정책, 사후 회전 없음).
    expect(side(circuit.outputPorts[0].anchor, circuit.bbox)).toBe("W");
    expect(side(cable.outputPorts[0].anchor, cable.bbox)).toBe("W");

    // circuit 의 copper-cable 입력(자식-공급)은 E변(자식쪽).
    const fed = circuit.inputPorts.find((p) => p.line.name === "copper-cable")!;
    expect(side(fed.anchor, circuit.bbox)).toBe("E");
    // raw 입력 N/S 는 *약한 선호* — 출력/자식입력 정렬에 져서 항상 보장되지 않음(planner 후속).
  });

  it("1:1 형태(count=1)도 작동 — 단일 머신 부모/자식, 면=역할 유지", () => {
    // count=1 은 높이 1짜리 기둥(degenerate). 용량은 reach 기반이라 동일하게 적용.
    const oneToOne: NodeSpec[] = [
      { id: "p", depth: 0, machine: M, count: 1, lines: [inL("gear"), outL("widget")] },
      { id: "c", depth: 1, parentId: "p", machine: M, count: 1, lines: [inL("iron"), outL("gear")] },
    ];
    const res = packModuleTree(oneToOne, config);
    const byId = new Map(res.placements.map((pl) => [pl.id, pl.module]));
    const parent = byId.get("p")!;
    const child = byId.get("c")!;
    // 출력→W, 자식-공급 입력(gear)→E 가 단일 머신에서도 성립.
    expect(side(parent.outputPorts[0].anchor, parent.bbox)).toBe("W");
    expect(side(child.outputPorts[0].anchor, child.bbox)).toBe("W");
    expect(side(parent.inputPorts.find((p) => p.line.name === "gear")!.anchor, parent.bbox)).toBe("E");
    // 미탭/라우팅 실패 없음 + 홉 1개(gear).
    for (const pl of res.placements) expect(pl.module.unroutedLines).toHaveLength(0);
    expect(res.hops).toHaveLength(1);
    expect(res.hops[0].item).toBe("gear");
  });

  it("홉 페어링 = 품목 매칭, 개수 = 자식 수", () => {
    const res = packModuleTree(specs, config);
    expect(res.hops).toHaveLength(1);
    expect(res.hops[0].item).toBe("copper-cable");
    expect(res.hops[0].from.line.role).toBe("output");
    expect(res.hops[0].to.line.role).toBe("input");
    expect(res.hops[0].to.line.name).toBe("copper-cable");
    // rate 미상(옛 탭/다이렉트 경로) — 포트가 교환 가능해 linkId 가 없다. seq(위치)가 유일한 구분.
    expect(res.hops[0].linkId).toBeUndefined();
    expect(res.linkMismatches).toEqual([]);
  });

  it("raw 포트 = 짝 못 지은 포트 **전부** (child 없는 입력 + 루트 출력)", () => {
    const res = packModuleTree(specs, config);
    const names = res.rawPorts.map((p) => p.line.name).sort();
    // 입력이면 외부 공급 무한상자, 출력이면 무한 sink — **둘 다 perimeter 로 나가야 한다.**
    // 그래서 raw 는 "입력"이 아니라 "짝 없는 포트"다(루트 출력 electronic-circuit 포함).
    expect(names).toEqual(["copper-plate", "electronic-circuit", "iron-plate"]);
  });

  it("배치 겹침 0 — 모든 모듈의 placed 셀이 고유 좌표", () => {
    const res = packModuleTree(specs, config);
    const seen = new Set<string>();
    for (const pl of res.placements)
      for (const c of pl.module.cells) {
        const k = `${c.x},${c.y}`;
        expect(seen.has(k), `중복 ${k}`).toBe(false);
        seen.add(k);
      }
  });

  it("extent 가 모든 셀을 포함", () => {
    const res = packModuleTree(specs, config);
    for (const pl of res.placements) {
      const e = moduleExtent(pl.module);
      for (const c of pl.module.cells) {
        expect(c.x).toBeGreaterThanOrEqual(e.x);
        expect(c.x).toBeLessThan(e.x + e.w);
        expect(c.y).toBeGreaterThanOrEqual(e.y);
        expect(c.y).toBeLessThan(e.y + e.h);
      }
    }
  });

  it("결정적", () => {
    const a = packModuleTree(specs, config);
    const b = packModuleTree(specs, config);
    const sig = (r: PackResult) => JSON.stringify(r.placements.map((p) => [p.id, p.origin, p.orientation]));
    expect(sig(b)).toEqual(sig(a));
  });

  it("exit-lane 예약(조각 6-①) — lanePlan 항상 emit, reserve 시 bbox 마진 프레임 확장", () => {
    const off = packModuleTree(specs, config);
    const on = packModuleTree(specs, { ...config, reservePerimeterLanes: true });

    // lanePlan 은 off 경로에서도 계산돼 실린다(②③ 소비용). 살아남은 상자마다 배정 1개.
    // rawPorts 가 **루트 출력까지 포함**하므로(짝 없는 포트 전부) 여기 +1 은 없다.
    expect(off.lanePlan.assignments.length).toBeGreaterThan(0);
    expect(off.lanePlan.assignments).toHaveLength(off.rawPorts.length);

    // off 는 배치/ bbox 무변(게이트 off → 현행 유지).
    expect(off.bbox).toEqual(unionOf(off));

    // reserve 시 marginNeeds 만큼 bbox 프레임이 정확히 넓어진다.
    // 한 변당 [PERIMETER_MARGIN] 칸 — 벨트 1칸 + 인서터 1칸. 상자 자리 인서터는 머신을
    // 먹이는 상주 인서터라 벨트로 재사용할 수 없어서 2다(옛 트렁크 시절엔 1이었다).
    const m = on.lanePlan.marginNeeds;
    const g = PERIMETER_MARGIN;
    const u = unionOf(on); // 마진 제외 모듈 union
    expect(on.bbox.x).toBe(u.x - (m.W ? g : 0));
    expect(on.bbox.y).toBe(u.y - (m.N ? g : 0));
    expect(on.bbox.w).toBe(u.w + (m.W ? g : 0) + (m.E ? g : 0));
    expect(on.bbox.h).toBe(u.h + (m.N ? g : 0) + (m.S ? g : 0));
  });

  it("포트 tapAnchor(⑥B) — machine 끝점 = anchor−2·faceVector, anchor 와 겹치지 않음", () => {
    // machine-side Routing 끝점으로 anchor(=chest 자리)를 쓰면 chest 끝점과 겹쳐
    // from==to 가 된다. tapAnchor 가 항상 anchor 에서 2칸 안쪽(≠anchor)이어야 한다.
    for (const res of [packModuleTree(specs, config), packModuleTree(specs, { ...config, reservePerimeterLanes: true })])
      for (const pl of res.placements)
        for (const p of [...pl.module.inputPorts, ...pl.module.outputPorts]) {
          const fv = faceVector(p.face);
          expect(p.tapAnchor).toEqual({ x: p.anchor.x - 2 * fv.x, y: p.anchor.y - 2 * fv.y });
          expect(p.tapAnchor.x === p.anchor.x && p.tapAnchor.y === p.anchor.y).toBe(false);
        }
  });
});

/** placements 모듈 union extent (마진 제외) — bbox 마진 확장 검증용. */
function unionOf(res: PackResult): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of res.placements) {
    const e = moduleExtent(pl.module);
    minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + e.w - 1); maxY = Math.max(maxY, e.y + e.h - 1);
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
