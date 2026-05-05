/**
 * GridCell.modules ↔ BlueprintEntity.items 변환.
 *
 * Factorio 2.0 형식:
 *   items: [
 *     { id: { name, quality? }, items: { in_inventory: [{inventory, stack, count?}, ...] } },
 *     ...
 *   ]
 *
 * 같은 (name, quality) 모듈은 한 plan으로 묶고, 슬롯들은 in_inventory에 배열로.
 *
 * inventory ID는 entity 타입별로 다르다. 우리가 다루는 module 슬롯은 보통:
 *   assembling-machine / furnace / rocket-silo / lab → 4
 *   mining-drill                                      → 2
 *   beacon                                            → 1
 * 정확한 값은 게임 round-trip 테스트로 확정 필요.
 */

import type { BlueprintInsertPlan } from '../types/blueprint';
import type { ModuleSlot } from '../types/layout';

const MODULE_INVENTORY_BY_TYPE: Record<string, number> = {
  'assembling-machine': 4,
  'furnace': 4,
  'rocket-silo': 4,
  'lab': 3,
  'mining-drill': 2,
  'beacon': 1,
};

export function moduleInventoryIdFor(entityType: string): number {
  return MODULE_INVENTORY_BY_TYPE[entityType] ?? 4;
}

/** GridCell.modules → BlueprintInsertPlan[] */
export function modulesToInsertPlans(
  modules: Array<ModuleSlot | null> | undefined,
  entityType: string,
): BlueprintInsertPlan[] | undefined {
  if (!modules || modules.length === 0) return undefined;
  const invId = moduleInventoryIdFor(entityType);

  // (name, quality) 그룹별 슬롯 인덱스 모음
  const grouped = new Map<string, { name: string; quality?: string; stacks: number[] }>();
  modules.forEach((slot, idx) => {
    if (!slot || !slot.name) return;
    const key = `${slot.name}|${slot.quality ?? ''}`;
    let g = grouped.get(key);
    if (!g) {
      g = { name: slot.name, quality: slot.quality, stacks: [] };
      grouped.set(key, g);
    }
    g.stacks.push(idx);
  });

  if (grouped.size === 0) return undefined;

  const out: BlueprintInsertPlan[] = [];
  for (const g of grouped.values()) {
    out.push({
      id: g.quality ? { name: g.name, quality: g.quality } : { name: g.name },
      items: {
        in_inventory: g.stacks.map((stack) => ({ inventory: invId, stack })),
      },
    });
  }
  return out;
}

/** BlueprintInsertPlan[] → GridCell.modules (slotCount 만큼 정규화) */
export function insertPlansToModules(
  plans: BlueprintInsertPlan[] | undefined,
  entityType: string,
  slotCount: number,
): Array<ModuleSlot | null> | undefined {
  if (!plans || plans.length === 0 || slotCount <= 0) return undefined;
  const invId = moduleInventoryIdFor(entityType);
  const slots: Array<ModuleSlot | null> = Array.from({ length: slotCount }, () => null);

  for (const plan of plans) {
    const id = plan.id;
    const stacks = plan.items?.in_inventory ?? [];
    for (const s of stacks) {
      // 모듈 inventory만 처리 (연료 등은 passthrough에서 별도 cell 필드로 처리 예정)
      if (s.inventory !== invId) continue;
      if (s.stack < 0 || s.stack >= slotCount) continue;
      slots[s.stack] = id.quality ? { name: id.name, quality: id.quality } : { name: id.name };
    }
  }
  // 모두 빈 슬롯이면 undefined로
  if (slots.every((s) => s === null)) return undefined;
  return slots;
}
