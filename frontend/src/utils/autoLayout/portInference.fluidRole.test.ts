/**
 * 유체 상자 **용도**(production_type) 를 지키는가.
 *
 * 유체 상자는 재료를 받는 칸과 결과물을 뱉는 칸이 **물리적으로 다른 칸**이다(화학 공장:
 * 입력은 N면, 출력은 S면). 이걸 안 보고 "가장 가까운 면"만 고르면 재료 파이프가 **출력 칸에
 * 꽂힌다** — 파이프는 멀쩡히 이어져 있고 그림도 정상이라 **조용히 머신이 굶는다**.
 *
 * 2026-07-13 실측: petroleum-gas 가 plastic-bar 화학 공장의 S면(출력 칸)으로 들어갔다.
 * 그때 무한파이프가 머신 **아래쪽**에 있어서, 거리로만 고르면 S면이 이겼다.
 *
 * → docs/fluid-box-semantics.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useGameDataStore } from "../../store/gameDataStore";
import { enumerateContainerPorts, resolvePortPair } from "./portInference";
import type { Container } from "./containerModel";

/**
 * 화학 공장 3×3 — 실측 게임데이터 모양. 유체 입력은 N면, 출력은 S면(회전 0 기준).
 *
 * 좌표 `(-1,-1)` 은 머신 **안쪽 왼위 모서리 칸**이라 좌표만으론 면을 못 정한다.
 * 면은 `direction` 이 답한다(입력 0=N, 출력 8=S). → module/fluidPorts.ts 머리말
 */
const CHEM = {
  name: "chemical-plant",
  fluid_boxes: [
    { index: 1, production_type: "input", connections: [{ direction: 0, positions: [{ x: -1, y: -1 }] }] },
    { index: 2, production_type: "output", connections: [{ direction: 8, positions: [{ x: -1, y: 1 }] }] },
  ],
};

beforeEach(() => {
  vi.spyOn(useGameDataStore, "getState").mockReturnValue({
    recipeMap: new Map(),
    entityMap: new Map([["chemical-plant", CHEM]]),
  } as unknown as ReturnType<typeof useGameDataStore.getState>);
});
afterEach(() => { vi.restoreAllMocks(); });

const machine: Container = {
  id: "m0", kind: "machine", entityName: "chemical-plant",
  origin: { x: 10, y: 10 }, size: { w: 3, h: 3 },
};
/** 공급 무한파이프를 머신 **아래**에 둔다 — 거리로만 고르면 출력면(S)이 이기는 배치. */
const supplyPipe: Container = {
  id: "p0", kind: "infinity-pipe", entityName: "infinity-pipe",
  origin: { x: 11, y: 16 }, size: { w: 1, h: 1 },
  content: "petroleum-gas", role: "input",
};
const GAS = { fluid: "petroleum-gas" };

describe("유체 포트 — 재료는 입력 칸에만 꽂힌다", () => {
  it("머신이 소비자면 입력(N) 칸만 후보 — 출력 칸은 빠진다", () => {
    const ports = enumerateContainerPorts(machine, GAS, "consumer");
    expect(ports.map((p) => p.face)).toEqual(["N"]);
  });

  it("머신이 생산자면 출력(S) 칸만 후보", () => {
    const ports = enumerateContainerPorts(machine, GAS, "producer");
    expect(ports.map((p) => p.face)).toEqual(["S"]);
  });

  it("공급 파이프가 아래에 있어도 재료는 **위쪽 입력 칸**으로 간다 — 거리에 지지 않는다", () => {
    // 이게 이 테스트의 요점이다. 역할을 안 보면 가까운 S면(출력 칸)이 뽑힌다.
    const pair = resolvePortPair(supplyPipe, machine, GAS);
    expect(pair).not.toBeNull();
    expect(pair!.consumer.face).toBe("N");
    expect(pair!.consumer.cell).toEqual({ x: 10, y: 9 }); // 머신 위 한 칸
  });

  it("역할을 안 주면 안 거른다 — 없는 정보로 후보를 지우지 않는다", () => {
    // 파이프·펌프처럼 production_type 이 없는 엔티티가 있어서, 미지정은 통과가 안전하다.
    const ports = enumerateContainerPorts(machine, GAS);
    expect(ports.map((p) => p.face).sort()).toEqual(["N", "S"]);
  });
});
