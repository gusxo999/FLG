import type { Module, ModuleEffects } from '../store/gameDataStore';
import type { ModuleSlot } from '../types/layout';

/**
 * Vanilla 모듈 효과 — Lua export 가 effects 필드를 안 보낸 legacy 데이터용 fallback.
 * 사용자가 새 export 를 적용하기 전까지 모듈 효과를 0으로 두지 않기 위함.
 * 값은 base game (Space Age 포함) 의 표준 모듈 데이터 기준.
 */
const VANILLA_EFFECTS_BY_CATEGORY_TIER: Record<string, Required<ModuleEffects>[]> = {
  // [tier-1, tier-2, tier-3]
  speed: [
    { speed: 0.2, productivity: 0, consumption: 0.5, pollution: 0, quality: 0 },
    { speed: 0.3, productivity: 0, consumption: 0.6, pollution: 0, quality: 0 },
    { speed: 0.5, productivity: 0, consumption: 0.7, pollution: 0, quality: 0 },
  ],
  productivity: [
    { speed: -0.05, productivity: 0.04, consumption: 0.4, pollution: 0.05, quality: 0 },
    { speed: -0.10, productivity: 0.06, consumption: 0.6, pollution: 0.07, quality: 0 },
    { speed: -0.15, productivity: 0.10, consumption: 0.8, pollution: 0.10, quality: 0 },
  ],
  effectivity: [
    { speed: 0, productivity: 0, consumption: -0.3, pollution: 0, quality: 0 },
    { speed: 0, productivity: 0, consumption: -0.4, pollution: 0, quality: 0 },
    { speed: 0, productivity: 0, consumption: -0.5, pollution: 0, quality: 0 },
  ],
  // Space Age
  quality: [
    { speed: -0.05, productivity: 0, consumption: 0, pollution: 0, quality: 0.01 },
    { speed: -0.05, productivity: 0, consumption: 0, pollution: 0, quality: 0.02 },
    { speed: -0.05, productivity: 0, consumption: 0, pollution: 0, quality: 0.025 },
  ],
};

/**
 * 모듈에 effects 가 비어있으면 category+tier 기반 vanilla 추정값으로 fallback.
 * effects 가 있으면 그대로 반환.
 */
export function resolveModuleEffects(mod: Module | undefined): ModuleEffects | undefined {
  if (!mod) return undefined;
  if (mod.effects && Object.keys(mod.effects).length > 0) return mod.effects;
  const cat = mod.category;
  const tier = mod.tier;
  if (!cat || !tier) return undefined;
  const tiers = VANILLA_EFFECTS_BY_CATEGORY_TIER[cat];
  if (!tiers) return undefined;
  // tier 가 1..N 범위를 벗어나면 가장 가까운 값 사용
  const idx = Math.max(0, Math.min(tiers.length - 1, tier - 1));
  return tiers[idx];
}

/**
 * 슬롯에 장착된 모듈들의 효과를 합산.
 * Factorio 룰: 각 효과(ratio)는 단순 합산 후 머신 base 값에 곱해진다.
 *   final_speed = base_speed × (1 + Σ speed_bonus)
 *   final_energy = base_energy × max(0.2, 1 + Σ consumption_bonus)
 *
 * 게임 UI 의 "효율성(Efficiency)" 모듈 = consumption 음수값이므로 별도 effect-key 가 없다.
 * 모듈에 effects 가 없으면 vanilla 추정값으로 fallback.
 */
export function sumModuleEffects(
  slots: Array<ModuleSlot | null> | undefined,
  moduleMap: Map<string, Module>,
): Required<ModuleEffects> {
  const acc: Required<ModuleEffects> = {
    speed: 0,
    productivity: 0,
    consumption: 0,
    pollution: 0,
    quality: 0,
  };
  if (!slots) return acc;
  for (const slot of slots) {
    if (!slot) continue;
    const mod = moduleMap.get(slot.name);
    const eff = resolveModuleEffects(mod);
    if (!eff) continue;
    if (eff.speed) acc.speed += eff.speed;
    if (eff.productivity) acc.productivity += eff.productivity;
    if (eff.consumption) acc.consumption += eff.consumption;
    if (eff.pollution) acc.pollution += eff.pollution;
    if (eff.quality) acc.quality += eff.quality;
  }
  return acc;
}

/**
 * 모듈 효과 적용 결과 — 머신의 effective parameter 들.
 */
export interface EffectiveMachineParams {
  /** crafting_speed × (1 + speed_bonus) */
  craftingSpeed: number;
  /** 1 + productivity_bonus (산출물 multiplier) */
  productivityMultiplier: number;
  /** energy_usage × max(0.2, 1 + consumption_bonus). Factorio 최저 20% 클램프. */
  energyUsage: number;
  /** 가산된 raw 효과들 (UI 표시용) */
  bonuses: Required<ModuleEffects>;
}

export function applyEffectsToMachine(
  baseSpeed: number,
  baseEnergy: number,
  bonuses: Required<ModuleEffects>,
): EffectiveMachineParams {
  const speedMul = Math.max(0.2, 1 + bonuses.speed);
  const energyMul = Math.max(0.2, 1 + bonuses.consumption);
  return {
    craftingSpeed: baseSpeed * speedMul,
    productivityMultiplier: 1 + bonuses.productivity,
    energyUsage: baseEnergy * energyMul,
    bonuses,
  };
}
