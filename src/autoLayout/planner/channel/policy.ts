/**
 * **통로 관심사의 정책** — 채널 기하 장부가 **고르는** 자리 셋: 반출의 진출 변(해소 사다리 1단) · 지상 배정의
 * 순서(실패 비용 순) · 유체 폴백의 사유.
 *
 * **트랙을 잡지 않는다.** 누가 어느 트랙인지는 장부(`channelGeometryPlanner` 의 배정 단계)가 정하고, 여기는 장부에
 * 넘길 판정과 순서만 낸다. 판정 자체는 행 비교뿐이다([sameSideOfCut] — 답이 하나라 `channel/shape`).
 *
 * > **내력.** `channelGeometryPlanner.planChannelGeometry` 의 ① 블록 · ② 후보 목록 · 유체 사유 블록이었다
 * > (2026-09-15 계획 구조-2축 · 2 Step 5b).
 */

import type { DeliveryInput, DeliveryPlan, ExportInput, ExportPlan, GeometryContext, NsEdge } from "./types";
import { elbowShape, sameSideOfCut, staircaseShape, type Shape } from "./shape";

/**
 * **① 의 답** — 반출마다 진출 변 · 갇힌 아이템 납품 · 유체에 물러난 반출, 그리고 지상을 시도할 납품.
 * 뒤 단계가 이것을 받는다 — 후보([surfaceItemsOf]) · 배정 · 계획 객체 · 지하.
 */
export interface ExitSides {
  exitOf: Map<string, NsEdge>;
  cutOff: Map<string, string>;
  yieldedExports: Set<string>;
  surfaceDels: DeliveryInput[];
}

/**
 * **① 진출 변 — 해소 사다리 1단.** 반출마다 선호 변에서 시작해, 어떤 납품을 가두면 뒤집어 본다.
 * 유체 라운드가 먼저다 — 안 풀리면 **반출이 물러나고**(그 폴백 계획을 여기서 적는다), 아이템 라운드는 안 풀리면
 * 그 납품이 지하 횡단 후보가 된다.
 */
export function settleExitSides(
  deliveries: ReadonlyArray<DeliveryInput>,
  exports_: ReadonlyArray<ExportInput>,
  fluidDels: ReadonlyArray<DeliveryInput>,
  itemDels: ReadonlyArray<DeliveryInput>,
  exportPlans: Map<string, ExportPlan>,
): ExitSides {
  // ── ① 같은 쪽 판정 + 반출 재배정(사다리 1단) ──
  // 각 반출의 진출 변을 선호값으로 시작해, 어떤 납품을 가두면 뒤집어 본다.
  // 뒤집기는 "모든 납품이 새 변에서 같은 쪽"일 때만 — 다른 납품을 새로 가두지 않는다.
  const exitOf = new Map<string, NsEdge>(exports_.map((x) => [x.id, x.preferredExit]));
  /** 지상 불가로 판명난 아이템 납품 → 그 납품을 가둔 반출 id (지하 횡단 후보). */
  const cutOff = new Map<string, string>();
  /** 유체를 가둔 죄로 지상 배정을 포기한 반출 — 상자는 로컬 ring 에 남는다. */
  const yieldedExports = new Set<string>();

  const tryFlip = (d: DeliveryInput, x: ExportInput): boolean => {
    const flipped: NsEdge = exitOf.get(x.id) === "N" ? "S" : "N";
    const ok =
      sameSideOfCut(d, x, flipped) &&
      deliveries.every((d2) => cutOff.has(d2.id) || sameSideOfCut(d2, x, flipped));
    if (ok) exitOf.set(x.id, flipped);
    return ok;
  };

  // 1라운드 — 유체. 뒤집어서 안 풀리면 **반출이 물러난다**(유체가 갇히면 트리째 죽으므로).
  for (const d of fluidDels) {
    for (const x of exports_) {
      if (yieldedExports.has(x.id)) continue;
      if (sameSideOfCut(d, x, exitOf.get(x.id)!)) continue;
      if (!tryFlip(d, x)) yieldedExports.add(x.id);
    }
  }
  // 2라운드 — 아이템. 기존 그대로: 안 풀리면 그 납품이 지하 횡단 후보가 된다.
  for (const d of itemDels) {
    for (const x of exports_) {
      if (yieldedExports.has(x.id)) continue;
      if (sameSideOfCut(d, x, exitOf.get(x.id)!)) continue;
      if (!tryFlip(d, x)) cutOff.set(d.id, x.id);
    }
  }
  for (const id of yieldedExports) exportPlans.set(id, { kind: "fallback", reason: "yielded-to-fluid" });
  const surfaceDels = deliveries.filter((d) => !cutOff.has(d.id));
  return { exitOf, cutOff, yieldedExports, surfaceDels };
}

/** 지상 배정의 후보 하나 — 경로 id · 트랙마다 도형 · 트랙 상한 · 유체. */
export type SurfaceItem = { id: string; candidates: (t: number) => Shape | null; max: number; fluid?: string };

/**
 * **② 후보 — 실패 비용 순.** 유체 납품(지하로 못 도망간다 — 실패 = 트리 전체 실패) → 반출(실패해도 상자가
 * 로컬 ring 에 남는다) → 아이템 납품(실패하면 지하 횡단이 회수한다). 탐욕 폴백에서 앞선 것이 자리를 먼저
 * 가지므로 이 순서가 곧 *"누가 지상을 먼저 갖나"* 다.
 */
export function surfaceItemsOf(
  sides: ExitSides,
  exports_: ReadonlyArray<ExportInput>,
  ctx: GeometryContext,
  cap: number,
  capCol: number,
): SurfaceItem[] {
  const { exitOf, yieldedExports, surfaceDels } = sides;
  // 경로 순서: 반출(id 순) → 지상 가능한 납품(id 순). 트랙 후보는 0..T-1 오름차순.
  const delItem = (d: DeliveryInput): SurfaceItem =>
    d.startY === d.endY
      ? // 일자 수평선 — 트랙 무관, 후보 1개(t=0 로만 호출되게 max=1).
        { id: d.id, candidates: () => staircaseShape(d, 0, ctx, capCol), max: 1, fluid: d.fluid }
      : { id: d.id, candidates: (t) => staircaseShape(d, t, ctx, capCol), max: cap, fluid: d.fluid };

  // 순서 = 실패 비용 순(위 주석). 탐욕 폴백에서 앞선 것이 자리를 먼저 가진다.
  const items: SurfaceItem[] = [];
  for (const d of surfaceDels) if (d.fluid !== undefined) items.push(delItem(d));
  for (const x of exports_) {
    if (yieldedExports.has(x.id)) continue;
    const exit = exitOf.get(x.id)!;
    items.push({ id: x.id, candidates: (t) => elbowShape(x, t, exit, ctx, capCol), max: cap });
  }
  for (const d of surfaceDels) if (d.fluid === undefined) items.push(delItem(d));
  return items;
}

/** **③′ 유체 폴백의 사유** — 지상에 못 앉은 유체 납품이 거절 메시지에 실을 사유를 고른다(지하 단계 뒤에 — 앞 사유를 덮는다). */
export function nameFluidFallbacks(
  fluidDels: ReadonlyArray<DeliveryInput>,
  deliveryPlans: Map<string, DeliveryPlan>,
): void {
  // 유체가 지상에 못 앉았다면 남은 수는 없다 — 지하도(D2) 탐색 폴백도(D3) 안 준다.
  // 사유를 갈라 둔다: 소비자(moduleWizard)가 거절 메시지에 그대로 싣는다.
  for (const d of fluidDels) {
    if (deliveryPlans.get(d.id)?.kind !== "fallback") continue;
    deliveryPlans.set(d.id, { kind: "fallback", reason: "fluid-no-surface-assignment" });
  }
}
