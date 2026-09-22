/**
 * 흐름 분석의 어댑터 — **프로토타입을 보는 유일한 층**.
 *
 * 저울은 계획기와 같은 것을 쓴다(`arith/belt` · `arith/inserter`). 검사가 계획과 다른 저울을
 * 쓰면 둘이 어긋날 때 어느 쪽이 틀렸는지 못 가린다 — 인서터 처리량이 게임보다 ~4% 낙관인
 * 것까지 같이 물려받는 것이 그 값이다(`arith/inserter.ts` 머리말).
 */

import { EntityType, type Direction, type GridCell } from '../../types/layout';
import { productYield, type Entity } from '../../types/gameData';
import type { InfinitySettings } from '../../types/blueprint';
import { beltThroughput } from '../../autoLayout/shared/arith/belt';
import { inserterReach, inserterThroughput } from '../../autoLayout/shared/arith/inserter';
import { applyEffectsToMachine, sumModuleEffects } from '../../factorio/moduleEffects';
import type { FlowCtx, UnknownReason } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// 방향 (direction-encoding.md — 0=N · 4=E · 8=S · 12=W, 그리드는 y 가 아래로)
// ─────────────────────────────────────────────────────────────────────────────

export function dirVec(d: Direction): { x: number; y: number } {
  switch (d) {
    case 4: return { x: 1, y: 0 };
    case 8: return { x: 0, y: 1 };
    case 12: return { x: -1, y: 0 };
    default: return { x: 0, y: -1 };
  }
}

function rotateVec(v: { x: number; y: number }, d: Direction): { x: number; y: number } {
  switch (d) {
    case 4: return { x: -v.y, y: v.x };
    case 8: return { x: -v.x, y: -v.y };
    case 12: return { x: v.y, y: -v.x };
    default: return { x: v.x, y: v.y };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 인서터
// ─────────────────────────────────────────────────────────────────────────────

export interface InserterReachCells {
  pick: { x: number; y: number };
  drop: { x: number; y: number };
}

/**
 * 인서터가 집는 칸과 놓는 칸. **direction 은 픽업 방향이다**(향한 쪽에서 집고 반대쪽에 놓는다).
 * 프로토타입 벡터를 direction 만큼 돌린다(렌더러 `pixi-draw-entity` 와 같은 규약) — 없으면
 * `inserterReach` 폴백.
 */
export function inserterCells(x: number, y: number, dir: Direction, ent: Entity | undefined): InserterReachCells {
  const reach = inserterReach(ent);
  let pick = ent?.inserter_pickup_position ? rotateVec(ent.inserter_pickup_position, dir) : null;
  if (!pick || (Math.round(pick.x) === 0 && Math.round(pick.y) === 0)) {
    const v = dirVec(dir);
    pick = { x: v.x * reach, y: v.y * reach };
  }
  let drop = ent?.inserter_drop_position ? rotateVec(ent.inserter_drop_position, dir) : null;
  if (!drop || (Math.round(drop.x) === 0 && Math.round(drop.y) === 0)) {
    drop = { x: -pick.x, y: -pick.y };
  }
  return {
    pick: { x: x + Math.round(pick.x), y: y + Math.round(pick.y) },
    drop: { x: x + Math.round(drop.x), y: y + Math.round(drop.y) },
  };
}

/** 인서터 처리량(/s). 저울이 없으면 `known: false` 이고 값은 Infinity(낙관). */
export function inserterCap(name: string | null, ctx: FlowCtx): { cap: number; known: boolean } {
  const ent = name ? ctx.entityMap.get(name) : undefined;
  const cap = inserterThroughput(ent, name ? ctx.inserterOverrides?.[name] : undefined);
  return cap > 0 ? { cap, known: true } : { cap: Infinity, known: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// 벨트
// ─────────────────────────────────────────────────────────────────────────────

/** 레인 하나의 용량(/s) = 벨트 처리량의 절반. 저울이 없으면 Infinity(낙관). */
export function laneCap(name: string | null, ctx: FlowCtx): { cap: number; known: boolean } {
  const full = beltThroughput(name ? ctx.entityMap.get(name) : undefined);
  return full > 0 ? { cap: full / 2, known: true } : { cap: Infinity, known: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// 머신
// ─────────────────────────────────────────────────────────────────────────────

export const MACHINE_TYPES: ReadonlySet<string> = new Set<string>([
  EntityType.Assembler,
  EntityType.Furnace,
  EntityType.Lab,
  EntityType.MiningDrill,
]);

export interface MachineRates {
  recipe: string;
  craftsPerSec: number;
  /** 아이템 재료 → 정격 필요량(/s). */
  needs: Map<string, number>;
  /** 아이템 산출 → 정격 생산량(/s). 수율을 모르면 그 품목은 **빠지고** `yield` 사유가 붙는다. */
  makes: Map<string, number>;
  /** 수율을 모르는 아이템 산출 — 흐름에는 싣되(낙관) 비율 판정에서는 뺀다. */
  unknownYield: Set<string>;
  /** 유체 재료 → 정격 필요량(/s). */
  needsFluid: Map<string, number>;
  /** 유체 산출 → 정격 생산량(/s). 수율을 모르면 빠진다(`yield`). */
  makesFluid: Map<string, number>;
  /** 레시피의 유체 줄 — 유체 상자 배정(`fluidbox_index`)을 [fluid](fluid.ts) 가 읽는다. */
  fluidIngredients: { name: string; fluidbox_index?: number }[];
  fluidProducts: { name: string; fluidbox_index?: number }[];
  reasons: UnknownReason[];
}

/**
 * origin 칸의 레시피·모듈로 정격을 낸다. 율을 아예 모르면 사유 하나를 낸다.
 *
 * 정격 제작 수 = 제작 속도(모듈 반영) ÷ `energy_required`. 산출은 기대 수율 × 생산성 배수.
 */
export function machineRates(origin: GridCell, ctx: FlowCtx): MachineRates | UnknownReason {
  if (origin.entityType === EntityType.Lab || origin.entityType === EntityType.MiningDrill) return 'kind';
  const recipe = origin.recipe ? ctx.recipeMap.get(origin.recipe) : undefined;
  const entity = origin.entityName ? ctx.entityMap.get(origin.entityName) : undefined;
  if (!recipe || !entity || entity.crafting_speed === undefined) return 'no-recipe';

  const eff = applyEffectsToMachine(entity.crafting_speed, 0, sumModuleEffects(origin.modules, ctx.moduleMap));
  const craftTime = Math.max(recipe.energy_required || 0.5, 1 / 60);
  const craftsPerSec = eff.craftingSpeed / craftTime;

  const reasons: UnknownReason[] = [];
  const needs = new Map<string, number>();
  const needsFluid = new Map<string, number>();
  const fluidIngredients: MachineRates['fluidIngredients'] = [];
  for (const ing of recipe.ingredients) {
    const into = ing.type === 'fluid' ? needsFluid : needs;
    into.set(ing.name, (into.get(ing.name) ?? 0) + craftsPerSec * ing.amount);
    if (ing.type === 'fluid') fluidIngredients.push({ name: ing.name, fluidbox_index: ing.fluidbox_index });
  }
  const makes = new Map<string, number>();
  const makesFluid = new Map<string, number>();
  const fluidProducts: MachineRates['fluidProducts'] = [];
  const unknownYield = new Set<string>();
  for (const p of recipe.products) {
    if (p.type === 'fluid') fluidProducts.push({ name: p.name, fluidbox_index: p.fluidbox_index });
    const y = productYield(p);
    if (y === undefined) {
      if (p.type === 'item') unknownYield.add(p.name);
      if (!reasons.includes('yield')) reasons.push('yield');
      continue;
    }
    const into = p.type === 'fluid' ? makesFluid : makes;
    into.set(p.name, (into.get(p.name) ?? 0) + craftsPerSec * y * eff.productivityMultiplier);
  }
  return {
    recipe: recipe.name, craftsPerSec, needs, makes, unknownYield,
    needsFluid, makesFluid, fluidIngredients, fluidProducts, reasons,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 상자
// ─────────────────────────────────────────────────────────────────────────────

export interface ChestRole {
  /** 무한 공급하는 품목(`at-least`·`exactly` 필터, 개수 > 0). */
  supply: Set<string>;
  /** 무엇이든 무한 회수(`remove_unfiltered_items`). */
  sinkAll: boolean;
  /** 이 품목은 무한 회수(`at-most` 필터). */
  sinkItems: Set<string>;
  /** 공급도 회수도 아니다 — 들어온 만큼만 나간다(보통 상자 · 설정 없는 무한상자). */
  relay: boolean;
}

/**
 * 상자의 역할. 자동 배치가 합성하는 설정(`cells/builder.buildInfinitySettings`)과 게임의
 * 의미를 그대로 따른다 — **설정 없는 무한상자는 회수가 아니다**(게임에서 차면 막힌다).
 */
export function chestRole(cell: GridCell): ChestRole {
  const role: ChestRole = { supply: new Set(), sinkAll: false, sinkItems: new Set(), relay: false };
  if (cell.entityType === EntityType.InfinityChest) {
    const s = cell.infinitySettings as InfinitySettings | undefined;
    if (s && 'remove_unfiltered_items' in s && s.remove_unfiltered_items) role.sinkAll = true;
    for (const f of (s && 'filters' in s ? s.filters : undefined) ?? []) {
      if (!f.name) continue;
      const mode = f.mode ?? 'at-least';
      if ((mode === 'at-least' || mode === 'exactly') && (f.count ?? 1) > 0) role.supply.add(f.name);
      if (mode === 'at-most' || mode === 'exactly') role.sinkItems.add(f.name);
    }
  }
  role.relay = !role.sinkAll && role.supply.size === 0 && role.sinkItems.size === 0;
  return role;
}

/** 인서터가 드나드는 상자 — 무한상자 · 보통 컨테이너. 조합기 같은 `Chest` 매핑은 뺀다. */
export function isContainer(cell: GridCell, ctx: FlowCtx): boolean {
  if (cell.entityType === EntityType.InfinityChest) return true;
  if (cell.entityType !== EntityType.Chest) return false;
  const t = cell.entityName ? ctx.entityMap.get(cell.entityName)?.type : undefined;
  return t === undefined || t === 'container' || t === 'logistic-container' || t === 'linked-container';
}
