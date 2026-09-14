/**
 * **트리 관심사의 도형** — 모듈의 세로 자리(topY) · 가로 자리(colX) · 절대 배치 · 절대 포트로 난 납품.
 *
 * 순서는 트리가 이미 정했다(`tree/arith.treeIndexOf`). 여기는 그 순서를 **좌표로 옮기기만** 한다 —
 * 좌표로 다시 정렬하지 않는다.
 *
 * > **내력.** `modulePacking.packModuleTree` 의 `4a)`·`4b)`·`4c)` · `6)` · `7)` 블록이었다
 * > (2026-09-14 계획 구조-2축 · 2 Step 3c-3).
 */

import type { GeneratedModule, ModulePort } from "../../module/types/module";
import { moduleExtent, shiftModule, type Orientation } from "../../module/moduleTransform";
import { ROW_CHANNEL_MIN } from "../rowChannelPlanner";
import type { DeliverySpec, ModulePlacement, NodeSpec, RowChannel } from "./types";
import type { TreeIndex } from "./arith";
import type { DeliveryPairing } from "../link/arith";

type Oriented = ReadonlyMap<string, { module: GeneratedModule; orientation: Orientation }>;

/**
 * **⑥ 세로 자리 — 열마다 누적합. 간격은 전부 행 채널 높이다.**
 *
 *    `colX[d] = colX[d-1] + 열폭 + 채널폭` 의 **세로 판**이다. 열 하나가 순번 0부터
 *    누적합이고, 더하는 것은 **모듈 높이 + 그 아래 행 채널의 높이**뿐 — 상수가 없다.
 *    예전엔 `STACK_GAP = 3` 이 간격이었고 행 채널이 모자라면 경로가 탐색으로 떨어졌다.
 */
export function stackColumns(
  tree: Pick<TreeIndex, "childIdsByParent" | "orderByDepth">,
  oriented: Oriented,
  rowChannels: readonly RowChannel[],
): Map<string, number> {
  const { childIdsByParent, orderByDepth } = tree;
  const heightOf = (id: string): number => moduleExtent(oriented.get(id)!.module).h;
  const heightBelow = new Map<string, number>();
  for (const b of rowChannels)
    if (b.kind === "between") heightBelow.set(`${b.depth}:${b.above}`, b.height);
  /** 순번 `i` 다음에 오는 행 채널의 높이 — 이것이 곧 다음 모듈까지의 간격이다. */
  const gapBelow = (depth: number, id: string): number =>
    heightBelow.get(`${depth}:${id}`) ?? ROW_CHANNEL_MIN;

  // (가) **누적합** — 순번 → 행. 좌표는 이 식 하나에서 나온다.
  const topY = new Map<string, number>();
  const stack = (): void => {
    for (const [depth, ids] of orderByDepth) {
      let y = 0;
      for (const id of ids) {
        topY.set(id, y);
        y += heightOf(id) + gapBelow(depth, id);
      }
    }
  };
  stack();

  // (나) **중앙 정렬 — 순번 공간에서**(2026-09-06 사장님 지시로 index 판으로 다시 세움).
  //
  //     부모를 자식들 곁에 두면 납품의 세로 구간이 짧아지고, 그만큼 세로 채널의 트랙이
  //     줄어 **채널이 좁아진다**. 그 이득은 버리지 않는다.
  //
  //     **옛 tidy-tree 와 무엇이 다른가** — 옛 판은 잎을 전역 커서에 상수(`STACK_GAP`)
  //     간격으로 쌓아 **좌표를 먼저 만들고** 부모를 그 좌표의 중점에 놓았다. 그래서 간격이
  //     행 채널과 무관했다. 지금은 자리를 (가) 의 누적합이 만들고, 이 단계는 **부모를 옮기기만**
  //     한다 — 옮긴 뒤 (다) 가 누적합 하한을 되살리므로 행 채널보다 좁아질 수 없다.
  //
  //     깊은 열부터 올라간다: 자식이 먼저 서야 부모가 맞출 수 있다.
  const depths = [...orderByDepth.keys()].sort((a, b) => b - a);
  for (const d of depths) {
    for (const id of orderByDepth.get(d) ?? []) {
      const kids = childIdsByParent.get(id) ?? [];
      if (kids.length === 0) continue;
      const lo = Math.min(...kids.map((k) => topY.get(k)!));
      const hi = Math.max(...kids.map((k) => topY.get(k)! + heightOf(k)));
      topY.set(id, Math.round((lo + hi) / 2 - heightOf(id) / 2));
    }
  }

  // (다) **누적합 하한 복원** — (나) 가 부모를 옮겨 이웃과 가까워졌을 수 있다.
  //     순서는 트리([treeIndexOf])가 정했으므로 **좌표로 다시 정렬하지 않는다.** 위에서부터 아래로만 민다.
  for (const [depth, ids] of orderByDepth) {
    let prevBottom = -Infinity;
    let prevId: string | undefined;
    for (const id of ids) {
      let t = topY.get(id)!;
      if (prevId !== undefined) t = Math.max(t, prevBottom + gapBelow(depth, prevId));
      topY.set(id, t);
      prevBottom = t + heightOf(id);
      prevId = id;
    }
  }
  return topY;
}

/** 모듈-로컬 행 → **절대 행**. `topY` 가 선 뒤에만 된다. */
export function absPortYOf(topY: ReadonlyMap<string, number>, oriented: Oriented): (id: string, anchorY: number) => number {
  return (id: string, anchorY: number): number =>
    anchorY + topY.get(id)! - moduleExtent(oriented.get(id)!.module).y;
}

/** 모든 모듈이 덮는 **전역 y 범위** — 통로 장부의 세로 경계. */
export function spanYOf(
  specs: readonly NodeSpec[],
  topY: ReadonlyMap<string, number>,
  oriented: Oriented,
): { yMin: number; yMax: number } {
  let gyMin = Infinity, gyMax = -Infinity;
  for (const s of specs) {
    const top = topY.get(s.id)!;
    gyMin = Math.min(gyMin, top);
    gyMax = Math.max(gyMax, top + moduleExtent(oriented.get(s.id)!.module).h - 1);
  }
  return { yMin: gyMin, yMax: gyMax };
}

/**
 * **⑧ 가로 자리** — 열 폭 + 채널 폭 → colX → 절대 배치. 결정적(depth 오름차순, 같은 depth 는 id 순).
 *
 * 열 폭 + 채널 폭(수요 기반) → x 좌표. 채널 d(깊이 d↔d-1)를 가로지르는 납품 경로를 세로
 *    구간 [min(자식포트y, 부모포트y), max(...)] 으로 모아 left-edge 트랙 수 = 폭의 근거.
 *    포트 abs-y = 로컬 anchor.y + (topY - ext.y) (colX 무관 → 배치 전 계산 가능). 끝 정렬
 *    (piece 4)으로 구간이 짧아 트랙↓→폭↓. channelPlanner 코드 무수정(좌표-무지).
 */
export function placeColumns(
  specs: readonly NodeSpec[],
  oriented: Oriented,
  topY: ReadonlyMap<string, number>,
  maxDepth: number,
  channelWidth: (d: number) => number,
): {
  placements: ModulePlacement[];
  absById: Map<string, GeneratedModule>;
  /** 채널 d(깊이 d↔d-1)의 서쪽 끝 x — 트랙 index 를 절대 x 로 옮기는 원점. */
  channelStartX: (d: number) => number;
} {
  const colWidth = new Array(maxDepth + 1).fill(0);
  for (const s of specs) colWidth[s.depth] = Math.max(colWidth[s.depth], moduleExtent(oriented.get(s.id)!.module).w);
  const colX = new Array(maxDepth + 1).fill(0);
  for (let d = 1; d <= maxDepth; d++) colX[d] = colX[d - 1] + colWidth[d - 1] + channelWidth(d);

  const placements: ModulePlacement[] = [];
  const absById = new Map<string, GeneratedModule>();
  for (const s of [...specs].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id))) {
    const { module, orientation } = oriented.get(s.id)!;
    const ext = moduleExtent(module);
    const y = topY.get(s.id)!;
    const abs = shiftModule(module, colX[s.depth] - ext.x, y - ext.y);
    placements.push({ id: s.id, module: abs, orientation, origin: { x: colX[s.depth], y } });
    absById.set(s.id, abs);
  }
  return { placements, absById, channelStartX: (d: number) => colX[d - 1] + colWidth[d - 1] };
}

/**
 * **⑨ 납품 경로** = 짝 단계가 이미 짝지은 쌍을 절대좌표 포트로 재구성. raw = 짝 못 지은 포트 전부
 *    (입력이면 외부 공급 무한상자, 출력이면 무한 sink) — 둘 다 perimeter 로 나가야 한다.
 */
export function assembleDeliveries(
  specs: readonly NodeSpec[],
  absById: ReadonlyMap<string, GeneratedModule>,
  pairing: Pick<DeliveryPairing, "deliveryPairs" | "pairedChestIds">,
): { deliveries: DeliverySpec[]; rawPorts: ModulePort[] } {
  const { deliveryPairs, pairedChestIds } = pairing;
  const deliveries: DeliverySpec[] = [];
  const rawPorts: ModulePort[] = [];
  const portByChestId = new Map<string, ModulePort>();
  for (const s of specs) {
    const mod = absById.get(s.id)!;
    for (const p of [...mod.inputPorts, ...mod.outputPorts]) portByChestId.set(p.chest.id, p);
  }
  /**
   * **레인 공유 — 납품은 물리 벨트마다 하나다.**
   *
   * 두 줄이 한 물리 벨트를 쓰면(`sharedLineId`) 양끝이 각각 **한 칸**이다 — 자식은 출구에서
   * 이미 합쳐졌고 부모도 한 벨트로 받는다. 그 사이를 잇는 물리 경로도 하나여야 한다.
   * 두 번째 줄까지 납품을 내면 **같은 두 칸 사이에 벨트를 두 번 깔려 든다.**
   */
  const deliveredLines = new Set<string>();
  for (const s of specs) {
    for (const [i, pr] of (deliveryPairs.get(s.id) ?? []).entries()) {
      const from = portByChestId.get(pr.outId);
      const to = portByChestId.get(pr.inId);
      if (!from || !to) continue;
      const shared = to.sharedLineId;
      if (shared !== undefined) {
        if (deliveredLines.has(shared)) continue;
        deliveredLines.add(shared);
      }
      deliveries.push({ item: pr.item, from, to, fromId: s.id, toId: s.parentId!, seq: i, linkId: pr.linkId });
    }
  }
  for (const s of specs) {
    const mod = absById.get(s.id)!;
    for (const p of [...mod.inputPorts, ...mod.outputPorts])
      if (!pairedChestIds.has(p.chest.id)) rawPorts.push(p);
  }
  return { deliveries, rawPorts };
}

/** 배치들이 덮는 틀(절대 좌표). 비었으면 0 크기. */
export function unionExtent(placements: ModulePlacement[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of placements) {
    const e = moduleExtent(pl.module);
    minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + e.w - 1); maxY = Math.max(maxY, e.y + e.h - 1);
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
