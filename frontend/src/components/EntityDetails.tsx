import { useMemo, useState } from 'react';
import type { Entity, FluidBoxInfo, Module, Recipe } from '../store/gameDataStore';
import { useGameDataStore } from '../store/gameDataStore';
import { useLayoutStore } from '../store/layoutStore';
import type { ModuleSlot } from '../types/layout';
import { useT } from '../i18n';
import { applyEffectsToMachine, sumModuleEffects } from '../utils/moduleEffects';
import { formatSurfaceConditions } from '../utils/surfaceConditions';

interface Props {
  entity: Entity | null;
  /** 배치된 instance의 cell.entityId. set 되어 있으면 레시피 바인딩 UI 노출. */
  instanceId?: string | null;
}

/**
 * 엔티티의 모든 필드를 카테고리별로 표시하는 패널.
 * 필드가 undefined면 해당 row를 숨긴다.
 */
export default function EntityDetails({ entity, instanceId }: Props) {
  const t = useT();

  if (!entity) {
    return (
      <div className="px-3 py-2 text-xs text-gray-500 text-center">
        {t('sidebar.details.noSelection')}
      </div>
    );
  }

  return (
    <div className="px-3 py-2 space-y-2 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-white font-semibold truncate">
          {entity.localised_name || entity.name}
        </span>
      </div>
      <div className="text-gray-500 text-[10px] font-mono truncate">{entity.name}</div>

      {/* 인스턴스 편집: 레시피 바인딩 (crafting machine 한정) */}
      {instanceId && entity.crafting_categories && entity.crafting_categories.length > 0 && (
        <RecipeBinding instanceId={instanceId} entity={entity} />
      )}

      {/* 인스턴스 편집: 모듈 슬롯 (module_slots > 0인 엔티티 한정) */}
      {instanceId && entity.module_slots !== undefined && entity.module_slots > 0 && (
        <ModuleBinding instanceId={instanceId} entity={entity} />
      )}

      <div className="pt-1 border-t border-gray-700 space-y-0.5">
        <Row label={t('sidebar.details.type')} value={entity.type} />
        <Row
          label={t('sidebar.details.size')}
          value={`${entity.tile_width} × ${entity.tile_height} ${t('sidebar.details.tiles')}`}
        />

        {entity.surface_conditions !== undefined && (
          <Row
            label={t('sidebar.details.surfaces')}
            value={formatSurfaceConditions(
              entity.surface_conditions,
              t('sidebar.details.surfacesAll'),
              t('sidebar.details.surfacesNone'),
            )}
            title={entity.surface_conditions
              .map((c) => `${c.property}${c.min !== undefined ? ` ≥ ${c.min}` : ''}${c.max !== undefined ? ` ≤ ${c.max}` : ''}`)
              .join(' · ')}
          />
        )}

        {entity.allowed_module_categories && entity.allowed_module_categories.length > 0 && (
          <Row
            label={t('sidebar.details.moduleCategories')}
            value={entity.allowed_module_categories.join(', ')}
          />
        )}

        {entity.crafting_speed !== undefined && (
          <Row
            label={t('sidebar.details.craftingSpeed')}
            value={`${entity.crafting_speed}×`}
          />
        )}
        {entity.crafting_categories && entity.crafting_categories.length > 0 && (
          <Row
            label={t('sidebar.details.craftingCategories')}
            value={entity.crafting_categories.join(', ')}
          />
        )}
        {entity.module_slots !== undefined && entity.module_slots > 0 && (
          <Row label={t('sidebar.details.moduleSlots')} value={String(entity.module_slots)} />
        )}
        {entity.allowed_effects && entity.allowed_effects.length > 0 && (
          <Row
            label={t('sidebar.details.allowedEffects')}
            value={entity.allowed_effects.join(', ')}
          />
        )}

        {entity.researching_speed !== undefined && (
          <Row
            label={t('sidebar.details.researchingSpeed')}
            value={`${entity.researching_speed}×`}
          />
        )}
        {entity.lab_inputs && entity.lab_inputs.length > 0 && (
          <Row
            label={t('sidebar.details.labInputs')}
            value={`${entity.lab_inputs.length}종`}
            title={entity.lab_inputs.join(', ')}
          />
        )}

        {entity.mining_speed !== undefined && (
          <Row label={t('sidebar.details.miningSpeed')} value={`${entity.mining_speed}×`} />
        )}
        {entity.resource_categories && entity.resource_categories.length > 0 && (
          <Row
            label={t('sidebar.details.resourceCategories')}
            value={entity.resource_categories.join(', ')}
          />
        )}
        {entity.resource_searching_radius !== undefined && (
          <Row
            label={t('sidebar.details.resourceSearchingRadius')}
            value={`${entity.resource_searching_radius.toFixed(2)} ${t('sidebar.details.tiles')}`}
          />
        )}
        {entity.vector_to_place_result && typeof entity.vector_to_place_result.x === 'number' && (
          <Row
            label={t('sidebar.details.vectorToPlaceResult')}
            value={`(${entity.vector_to_place_result.x.toFixed(1)}, ${entity.vector_to_place_result.y.toFixed(1)})`}
          />
        )}

        {entity.belt_speed !== undefined && (
          <Row
            label={t('sidebar.details.beltSpeed')}
            value={`${(entity.belt_speed * 480).toFixed(1)} items/s`}
            title={`${entity.belt_speed} tiles/tick`}
          />
        )}
        {entity.max_underground_distance !== undefined && (
          <Row
            label={t('sidebar.details.maxUndergroundDistance')}
            value={`${entity.max_underground_distance} ${t('sidebar.details.tiles')}`}
          />
        )}

        {entity.inserter_pickup_position && typeof entity.inserter_pickup_position.x === 'number' && (
          <Row
            label={t('sidebar.details.inserterPickup')}
            value={`(${entity.inserter_pickup_position.x.toFixed(1)}, ${entity.inserter_pickup_position.y.toFixed(1)})`}
          />
        )}
        {entity.inserter_drop_position && typeof entity.inserter_drop_position.x === 'number' && (
          <Row
            label={t('sidebar.details.inserterDrop')}
            value={`(${entity.inserter_drop_position.x.toFixed(1)}, ${entity.inserter_drop_position.y.toFixed(1)})`}
          />
        )}
        {entity.inserter_extension_speed !== undefined && (
          <Row
            label={t('sidebar.details.inserterExtensionSpeed')}
            value={entity.inserter_extension_speed.toFixed(4)}
          />
        )}
        {entity.inserter_rotation_speed !== undefined && (
          <Row
            label={t('sidebar.details.inserterRotationSpeed')}
            value={entity.inserter_rotation_speed.toFixed(4)}
          />
        )}

        {entity.pumping_speed !== undefined && (
          <Row
            label={t('sidebar.details.pumpingSpeed')}
            value={`${(entity.pumping_speed * 60).toFixed(0)} /s`}
            title={`${entity.pumping_speed} /tick`}
          />
        )}

        {entity.supply_area_distance !== undefined && (
          <Row
            label={t('sidebar.details.supplyAreaDistance')}
            value={`${entity.supply_area_distance} ${t('sidebar.details.tiles')}`}
          />
        )}
        {entity.max_wire_distance !== undefined && (
          <Row
            label={t('sidebar.details.maxWireDistance')}
            value={`${entity.max_wire_distance} ${t('sidebar.details.tiles')}`}
          />
        )}
        {entity.max_power_output !== undefined && (
          <Row
            label={t('sidebar.details.maxPowerOutput')}
            value={formatEnergy(entity.max_power_output)}
          />
        )}
        {entity.fluid_usage_per_tick !== undefined && (
          <Row
            label={t('sidebar.details.fluidUsagePerTick')}
            value={`${(entity.fluid_usage_per_tick * 60).toFixed(2)} /s`}
            title={`${entity.fluid_usage_per_tick} /tick`}
          />
        )}
        {entity.target_temperature !== undefined && (
          <Row
            label={t('sidebar.details.targetTemperature')}
            value={`${entity.target_temperature}°C`}
          />
        )}

        {entity.distribution_effectivity !== undefined && (
          <Row
            label={t('sidebar.details.distributionEffectivity')}
            value={`${(entity.distribution_effectivity * 100).toFixed(0)}%`}
          />
        )}

        {entity.logistic_radius !== undefined && (
          <Row
            label={t('sidebar.details.logisticRadius')}
            value={`${entity.logistic_radius} ${t('sidebar.details.tiles')}`}
          />
        )}
        {entity.construction_radius !== undefined && (
          <Row
            label={t('sidebar.details.constructionRadius')}
            value={`${entity.construction_radius} ${t('sidebar.details.tiles')}`}
          />
        )}

        {entity.inventory_size !== undefined && entity.inventory_size > 0 && (
          <Row label={t('sidebar.details.inventorySize')} value={String(entity.inventory_size)} />
        )}

        {entity.energy_usage !== undefined && entity.energy_usage > 0 && (
          <Row
            label={t('sidebar.details.energyUsage')}
            value={formatEnergy((entity.energy_usage ?? 0) + (entity.energy_drain ?? 0))}
            title={`active ${entity.energy_usage} + drain ${entity.energy_drain ?? 0} J/tick`}
          />
        )}
        {entity.energy_drain !== undefined && entity.energy_drain > 0 && (
          <Row
            label={t('sidebar.details.energyDrain')}
            value={formatEnergy(entity.energy_drain)}
            title={`${entity.energy_drain} J/tick (idle)`}
          />
        )}
      </div>

      {/* Fluid boxes section */}
      {entity.fluid_boxes && entity.fluid_boxes.length > 0 && (
        <div className="pt-1 border-t border-gray-700">
          <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-1">
            {t('sidebar.details.fluidBoxes')} ({entity.fluid_boxes.length})
          </div>
          <div className="space-y-1.5">
            {entity.fluid_boxes.map((fb) => (
              <FluidBoxRow key={fb.index} fb={fb} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FluidBoxRow({ fb }: { fb: FluidBoxInfo }) {
  const t = useT();
  // 대표 flow_direction은 연결 단위(정확한 파이프 흐름)를 우선 사용하고,
  // 없으면 fluidbox의 production_type(레시피 슬롯 용도)을 fallback으로 쓴다.
  const effectiveFlow = fb.connections[0]?.flow_direction ?? fb.production_type;
  const prodType = productionTypeLabel(effectiveFlow, t);
  const prodColor = productionTypeColor(effectiveFlow);

  return (
    <div className="bg-gray-900/60 rounded px-2 py-1 space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`font-semibold ${prodColor}`}>
          #{fb.index} · {prodType}
        </span>
        {fb.volume !== undefined && (
          <span className="text-gray-500">{fb.volume} {t('sidebar.details.fluidBoxVolume')}</span>
        )}
      </div>
      {fb.filter && (
        <div className="text-gray-500">
          {t('sidebar.details.fluidBoxFilter')}: <span className="text-gray-300">{fb.filter}</span>
        </div>
      )}
      {fb.connections.length > 0 && (
        <div className="text-gray-500 flex flex-wrap gap-x-2 gap-y-0.5">
          <span>{t('sidebar.details.fluidBoxConnections')}:</span>
          {fb.connections.map((c, i) => {
            const n = c.positions?.[0];
            const tag: string[] = [];
            if (n) tag.push(`(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
            if (c.connection_type === 'underground') {
              tag.push(`${t('sidebar.details.underground')}${c.max_underground_distance ? ` ≤${c.max_underground_distance}` : ''}`);
            }
            if (c.connection_type === 'linked') tag.push(t('sidebar.details.linkedConnection'));
            return (
              <span key={i} className="text-gray-300">
                {tag.join(' ')}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function productionTypeLabel(
  pt: string | undefined,
  t: (k: string) => string
): string {
  switch (pt) {
    case 'input': return t('sidebar.details.fluidBoxInput');
    case 'output': return t('sidebar.details.fluidBoxOutput');
    case 'input-output': return t('sidebar.details.fluidBoxInputOutput');
    default: return t('sidebar.details.fluidBoxNone');
  }
}

function productionTypeColor(pt: string | undefined): string {
  switch (pt) {
    case 'input': return 'text-sky-400';
    case 'output': return 'text-orange-400';
    case 'input-output': return 'text-purple-400';
    default: return 'text-gray-500';
  }
}

/**
 * 배치된 instance의 모듈 슬롯 편집 UI.
 * - 슬롯 개수 = entity.module_slots
 * - 각 슬롯은 클릭 시 모듈 셀렉터 팝오버 노출
 * - allowed_effects 필터로 적합한 모듈만 보여줌
 */
function ModuleBinding({ instanceId, entity }: { instanceId: string; entity: Entity }) {
  const t = useT();
  const slotCount = entity.module_slots ?? 0;
  const grid = useLayoutStore((s) => s.grid);
  const setCellModule = useLayoutStore.getState().setCellModule;
  const getModulesAllowedFor = useGameDataStore((s) => s.getModulesAllowedFor);
  const moduleMap = useGameDataStore((s) => s.moduleMap);

  const cell = useMemo(
    () => grid.cells.find((c) => c.entityId === instanceId),
    [grid, instanceId],
  );
  const currentRecipe = cell?.recipe;

  const currentModules = useMemo<Array<ModuleSlot | null>>(() => {
    const arr: Array<ModuleSlot | null> = cell?.modules ? [...cell.modules] : [];
    while (arr.length < slotCount) arr.push(null);
    arr.length = slotCount;
    return arr;
  }, [cell, slotCount]);

  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const allowed = useMemo(
    () => getModulesAllowedFor(entity.name, currentRecipe),
    [entity.name, currentRecipe, getModulesAllowedFor],
  );
  const matched = useMemo<Module[]>(() => {
    if (!query.trim()) return allowed;
    const q = query.toLowerCase();
    return allowed.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.localised_name?.toLowerCase().includes(q) ?? false) ||
        (m.category?.toLowerCase().includes(q) ?? false),
    );
  }, [allowed, query]);

  function pick(slotIndex: number, mod: Module | null) {
    setCellModule(instanceId, slotIndex, mod ? { name: mod.name } : null, slotCount);
    setOpenSlot(null);
    setQuery('');
  }

  if (allowed.length === 0) {
    // 모듈 데이터가 비어 있음 → 게임 데이터를 다시 export 받아야 한다는 안내
    return (
      <div className="bg-gray-800/70 border border-gray-700 rounded p-2 space-y-1">
        <span className="text-gray-400 text-[10px] uppercase tracking-wide">
          {t('sidebar.details.modules')}
        </span>
        <div className="text-gray-500 text-[11px]">
          {t('sidebar.details.modulesNoData')}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/70 border border-gray-700 rounded p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-400 text-[10px] uppercase tracking-wide">
          {t('sidebar.details.modules')} ({slotCount})
        </span>
      </div>

      {/* 슬롯 그리드 — 항상 slotCount개 노출 */}
      <div className="grid grid-cols-4 gap-1">
        {currentModules.map((slot, idx) => {
          const mod = slot ? moduleMap.get(slot.name) : null;
          const label = mod?.localised_name || slot?.name || '+';
          const isFilled = !!slot;
          return (
            <button
              key={idx}
              onClick={() => setOpenSlot(openSlot === idx ? null : idx)}
              title={isFilled ? slot!.name : t('sidebar.details.moduleAddSlot')}
              className={`h-9 rounded border text-[10px] truncate px-1 transition-colors ${
                isFilled
                  ? 'bg-orange-700/40 border-orange-600/50 text-orange-100 hover:bg-orange-700/60'
                  : 'bg-gray-900/40 border-gray-700 text-gray-500 hover:bg-gray-700'
              } ${openSlot === idx ? 'ring-2 ring-blue-400' : ''}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* 셀렉터 팝오버 */}
      {openSlot !== null && (
        <div className="space-y-1 pt-1">
          <div className="flex items-center gap-1">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('sidebar.search')}
              className="flex-1 bg-gray-900 text-white text-xs px-2 py-1 rounded border border-gray-700 focus:outline-none focus:border-orange-500"
            />
            {currentModules[openSlot] && (
              <button
                onClick={() => pick(openSlot, null)}
                className="text-[10px] text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-900/50"
              >
                {t('sidebar.details.moduleClear')}
              </button>
            )}
          </div>
          <div className="max-h-40 overflow-y-auto space-y-0.5 bg-gray-900/40 rounded p-1">
            {matched.length === 0 && (
              <div className="text-gray-500 text-[10px] text-center py-2">
                {t('sidebar.noResults')}
              </div>
            )}
            {matched.slice(0, 60).map((m) => {
              const isCurrent = currentModules[openSlot]?.name === m.name;
              return (
                <button
                  key={m.name}
                  onClick={() => pick(openSlot, m)}
                  className={`w-full text-left px-2 py-1 rounded text-[11px] transition-colors ${
                    isCurrent
                      ? 'bg-orange-700 text-white'
                      : 'text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  <div className="truncate">{m.localised_name || m.name}</div>
                  <div className="text-gray-500 text-[9px] truncate">
                    {m.category ?? '—'}
                    {typeof m.tier === 'number' ? ` · T${m.tier}` : ''}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 배치된 crafting machine에 레시피를 바인딩하는 UI.
 * 카테고리가 일치하는 레시피만 노출하고, 검색으로 좁힐 수 있다.
 */
function RecipeBinding({ instanceId, entity }: { instanceId: string; entity: Entity }) {
  const t = useT();
  const recipes = useGameDataStore((s) => s.recipes);
  const grid = useLayoutStore((s) => s.grid);
  const setCellRecipe = useLayoutStore.getState().setCellRecipe;

  const currentRecipe = useMemo(() => {
    const cell = grid.cells.find((c) => c.entityId === instanceId);
    return cell?.recipe;
  }, [grid, instanceId]);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const allowedCategories = new Set(entity.crafting_categories ?? []);
  const matched: Recipe[] = useMemo(() => {
    const pool = recipes.filter((r) => allowedCategories.has(r.category));
    if (!query.trim()) return pool;
    const q = query.toLowerCase();
    return pool.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.localised_name?.toLowerCase().includes(q) ?? false)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipes, query, entity.crafting_categories?.join(',')]);

  const currentRecipeObj = currentRecipe
    ? recipes.find((r) => r.name === currentRecipe)
    : undefined;

  return (
    <div className="bg-gray-800/70 border border-gray-700 rounded p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-400 text-[10px] uppercase tracking-wide">
          {t('sidebar.details.recipe')}
        </span>
        {currentRecipe && (
          <button
            onClick={() => setCellRecipe(instanceId, undefined)}
            className="text-[10px] text-red-400 hover:text-red-300"
          >
            {t('sidebar.details.recipeClear')}
          </button>
        )}
      </div>

      {currentRecipe ? (
        <>
          <div className="flex items-center justify-between gap-2 px-2 py-1 bg-orange-700/30 border border-orange-600/40 rounded">
            <span className="text-orange-200 truncate">
              {currentRecipeObj?.localised_name || currentRecipe}
            </span>
            <button
              onClick={() => setOpen((v) => !v)}
              className="text-[10px] text-gray-300 hover:text-white shrink-0 px-1.5 py-0.5 bg-gray-700/60 rounded"
            >
              {t('sidebar.details.recipeChange')}
            </button>
          </div>
          {currentRecipeObj && (
            <RecipeDetails
              recipe={currentRecipeObj}
              machine={entity}
              instanceId={instanceId}
            />
          )}
        </>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="w-full text-left px-2 py-1 bg-gray-900/60 hover:bg-gray-700 border border-gray-700 rounded text-gray-400"
        >
          {t('sidebar.details.recipeSelect')}
        </button>
      )}

      {open && (
        <div className="space-y-1">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('sidebar.search')}
            className="w-full bg-gray-900 text-white text-xs px-2 py-1 rounded border border-gray-700 focus:outline-none focus:border-orange-500"
          />
          <div className="max-h-48 overflow-y-auto space-y-0.5 bg-gray-900/40 rounded p-1">
            {matched.length === 0 && (
              <div className="text-gray-500 text-[10px] text-center py-2">
                {t('sidebar.noResults')}
              </div>
            )}
            {matched.slice(0, 100).map((r) => {
              const isSelected = r.name === currentRecipe;
              return (
                <button
                  key={r.id}
                  onClick={() => {
                    setCellRecipe(instanceId, r.name);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={`w-full text-left px-2 py-1 rounded text-[11px] transition-colors ${
                    isSelected
                      ? 'bg-orange-700 text-white'
                      : 'text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  <div className="truncate">{r.localised_name || r.name}</div>
                  <div className="text-gray-500 text-[9px] truncate">
                    {r.category} · {r.energy_required}s
                  </div>
                </button>
              );
            })}
            {matched.length > 100 && (
              <div className="text-gray-500 text-[10px] text-center py-1">
                {t('sidebar.moreResults', { count: matched.length - 100 })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 선택된 레시피의 재료/생산물/제작시간을 표시한다.
 * 배치된 인스턴스의 modules 슬롯이 있으면 effects를 합산해 effective 값에 반영.
 */
function RecipeDetails({
  recipe,
  machine,
  instanceId,
}: {
  recipe: Recipe;
  machine: Entity;
  instanceId: string;
}) {
  const t = useT();
  const grid = useLayoutStore((s) => s.grid);
  const moduleMap = useGameDataStore((s) => s.moduleMap);

  const cellModules = useMemo(() => {
    const cell = grid.cells.find((c) => c.entityId === instanceId);
    return cell?.modules;
  }, [grid, instanceId]);

  const baseSpeed = machine.crafting_speed && machine.crafting_speed > 0 ? machine.crafting_speed : 1;
  const baseEnergy = (machine.energy_usage ?? 0) + (machine.energy_drain ?? 0);
  const baseTime = recipe.energy_required;

  const bonuses = useMemo(() => sumModuleEffects(cellModules, moduleMap), [cellModules, moduleMap]);
  const eff = applyEffectsToMachine(baseSpeed, baseEnergy, bonuses);
  const effectiveTime = baseTime / eff.craftingSpeed;
  const hasModuleEffects =
    bonuses.speed !== 0 ||
    bonuses.productivity !== 0 ||
    bonuses.consumption !== 0 ||
    bonuses.pollution !== 0 ||
    bonuses.quality !== 0;

  return (
    <div className="space-y-2 pt-1">
      <RecipeIOList
        title={t('sidebar.details.recipeIngredients')}
        items={recipe.ingredients}
        accent="text-sky-300"
      />
      <RecipeIOList
        title={t('sidebar.details.recipeProducts')}
        items={recipe.products}
        accent="text-emerald-300"
        showRate
        effectiveTime={effectiveTime}
        productivityMultiplier={eff.productivityMultiplier}
        rateSuffix={t('sidebar.details.recipeOutputPerSec')}
      />
      <div className="border-t border-gray-700/60 pt-1 space-y-0.5">
        <Row label={t('sidebar.details.recipeCraftingTime')} value={`${baseTime}s`} />
        <Row
          label={t('sidebar.details.recipeEffectiveTime')}
          value={`${effectiveTime.toFixed(2)}s`}
          title={`${baseTime}s ÷ ${eff.craftingSpeed.toFixed(3)}× = ${effectiveTime.toFixed(4)}s`}
        />
        {recipe.surface_conditions && recipe.surface_conditions.length > 0 && (
          <Row
            label={t('sidebar.details.recipeSurfaces')}
            value={formatSurfaceConditions(
              recipe.surface_conditions,
              t('sidebar.details.surfacesAll'),
              t('sidebar.details.surfacesNone'),
            )}
            title={recipe.surface_conditions
              .map((c) => `${c.property}${c.min !== undefined ? ` ≥ ${c.min}` : ''}${c.max !== undefined ? ` ≤ ${c.max}` : ''}`)
              .join(' · ')}
          />
        )}
        {recipe.allowed_module_categories && recipe.allowed_module_categories.length > 0 && (
          <Row
            label={t('sidebar.details.recipeAllowedModules')}
            value={recipe.allowed_module_categories.join(', ')}
          />
        )}
        {hasModuleEffects && (
          <ModuleEffectsRow
            baseSpeed={baseSpeed}
            effectiveSpeed={eff.craftingSpeed}
            baseEnergyJoulesPerTick={baseEnergy}
            effectiveEnergyJoulesPerTick={eff.energyUsage}
            bonuses={bonuses}
          />
        )}
      </div>
    </div>
  );
}

function ModuleEffectsRow({
  baseSpeed,
  effectiveSpeed,
  baseEnergyJoulesPerTick,
  effectiveEnergyJoulesPerTick,
  bonuses,
}: {
  baseSpeed: number;
  effectiveSpeed: number;
  baseEnergyJoulesPerTick: number;
  effectiveEnergyJoulesPerTick: number;
  bonuses: { speed: number; productivity: number; consumption: number; pollution: number; quality: number };
}) {
  const t = useT();
  const speedDelta = effectiveSpeed - baseSpeed;
  return (
    <div className="mt-1 pt-1 border-t border-orange-700/30 space-y-0.5">
      <div className="text-orange-300 text-[10px] uppercase tracking-wide">
        {t('sidebar.details.modules')}
      </div>
      <Row
        label={t('sidebar.details.craftingSpeed')}
        value={`${baseSpeed.toFixed(2)}× → ${effectiveSpeed.toFixed(2)}× (${formatSign(speedDelta)})`}
      />
      {bonuses.productivity !== 0 && (
        <Row label="Productivity" value={`${formatPct(bonuses.productivity)}`} />
      )}
      {bonuses.consumption !== 0 && (
        <Row
          label={t('sidebar.details.energyUsage')}
          value={`${formatEnergy(baseEnergyJoulesPerTick)} → ${formatEnergy(effectiveEnergyJoulesPerTick)} (${formatPct(bonuses.consumption)})`}
        />
      )}
      {bonuses.pollution !== 0 && (
        <Row label="Pollution" value={formatPct(bonuses.pollution)} />
      )}
      {bonuses.quality !== 0 && (
        <Row label="Quality" value={formatPct(bonuses.quality)} />
      )}
    </div>
  );
}

function formatSign(v: number): string {
  return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
}
function formatPct(ratio: number): string {
  const pct = ratio * 100;
  return pct >= 0 ? `+${pct.toFixed(0)}%` : `${pct.toFixed(0)}%`;
}

interface RecipeIO {
  name: string;
  amount: number;
  type: 'item' | 'fluid';
  probability?: number;
}

function RecipeIOList({
  title,
  items,
  accent,
  showRate,
  effectiveTime,
  productivityMultiplier,
  rateSuffix,
}: {
  title: string;
  items: RecipeIO[];
  accent: string;
  showRate?: boolean;
  effectiveTime?: number;
  /** 산출물에만 곱하는 productivity multiplier (재료에는 영향 없음) */
  productivityMultiplier?: number;
  rateSuffix?: string;
}) {
  const t = useT();
  if (items.length === 0) {
    return (
      <div>
        <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-1">{title}</div>
        <div className="text-gray-500 text-[11px] italic px-1">—</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-1">{title}</div>
      <ul className="space-y-0.5">
        {items.map((it, idx) => {
          const prob = it.probability ?? 1;
          const prodMul = showRate ? (productivityMultiplier ?? 1) : 1;
          const expected = it.amount * prob * prodMul;
          const perSec = showRate && effectiveTime ? expected / effectiveTime : null;
          return (
            <li
              key={`${it.name}-${idx}`}
              className="flex items-baseline justify-between gap-2 px-1 py-0.5 rounded bg-gray-900/40"
            >
              <span className="flex items-baseline gap-1 truncate min-w-0">
                {it.type === 'fluid' && (
                  <span className="text-[9px] uppercase tracking-wide text-sky-400 shrink-0">
                    {t('sidebar.details.recipeFluid')}
                  </span>
                )}
                <span className="text-gray-200 truncate">{it.name}</span>
                {prob !== 1 && (
                  <span
                    className="text-yellow-400 text-[10px] shrink-0"
                    title={t('sidebar.details.recipeProbability')}
                  >
                    ({(prob * 100).toFixed(0)}%)
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right">
                <span className={`${accent} font-mono`}>×{it.amount}</span>
                {perSec !== null && (
                  <span className="ml-1 text-[10px] text-gray-400 font-mono">
                    {perSec.toFixed(perSec >= 10 ? 1 : 2)}
                    {rateSuffix}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Row({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2" title={title}>
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-200 text-right truncate">{value}</span>
    </div>
  );
}

/**
 * 런타임 API의 energy_usage / max_power_output은 J/tick (1초 = 60 tick).
 * 게임 UI 표시값은 W = J/s = J/tick × 60.
 */
function formatEnergy(joulesPerTick: number): string {
  const watts = joulesPerTick * 60;
  if (watts >= 1_000_000) return `${(watts / 1_000_000).toFixed(2)} MW`;
  if (watts >= 1_000) return `${(watts / 1_000).toFixed(1)} kW`;
  return `${watts.toFixed(0)} W`;
}
