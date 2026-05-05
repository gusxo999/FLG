-- =============================================================================
-- Factorio Game Data Export Script
-- =============================================================================
-- 팩토리오 콘솔(/c)에서 실행하여 엔티티 및 레시피 데이터를 JSON으로 추출합니다.
-- 출력 파일: script-output/factorio-data.json
--
-- 중요: LuaEntityPrototype의 일부 속성(target_temperature, belt_speed 등)은
-- 특정 엔티티 타입에서만 접근 가능하며, 다른 타입에서 접근 시 에러가 발생합니다.
-- 따라서 type별로 명시적 분기 처리합니다.
-- =============================================================================

local o = { entities = {}, recipes = {}, modules = {}, technologies = {} }

-- ---------------------------------------------------------------------------
-- 타입별 그룹 (분기 편의용)
-- ---------------------------------------------------------------------------
local BELT_TYPES = {
  ["transport-belt"]   = true,
  ["underground-belt"] = true,
  ["splitter"]         = true,
  ["loader"]           = true,
  ["loader-1x1"]       = true,
}

local UNDERGROUND_TYPES = {
  ["underground-belt"] = true,
  ["pipe-to-ground"]   = true,
  ["loader"]           = true,
  ["loader-1x1"]       = true,
}

local CRAFTING_TYPES = {
  ["assembling-machine"] = true,
  ["furnace"]            = true,
  ["rocket-silo"]        = true,
}

local PUMP_TYPES = {
  ["pump"]          = true,
  ["offshore-pump"] = true,
}

-- 추출 대상 전체 (카테고리별)
local ALL_TYPES = {
  -- 물류
  ["transport-belt"]=true, ["underground-belt"]=true, ["splitter"]=true,
  ["loader"]=true, ["loader-1x1"]=true, ["inserter"]=true,
  ["pipe"]=true, ["pipe-to-ground"]=true, ["pump"]=true,
  -- 생산
  ["assembling-machine"]=true, ["furnace"]=true, ["rocket-silo"]=true,
  ["lab"]=true, ["mining-drill"]=true, ["offshore-pump"]=true,
  -- 전력
  ["electric-pole"]=true, ["solar-panel"]=true, ["accumulator"]=true,
  ["boiler"]=true, ["generator"]=true, ["reactor"]=true, ["heat-pipe"]=true,
  ["fusion-reactor"]=true, ["fusion-generator"]=true,
  ["burner-generator"]=true,
  -- 유틸리티
  ["beacon"]=true, ["roboport"]=true,
  ["container"]=true, ["logistic-container"]=true, ["linked-container"]=true,
  ["radar"]=true, ["lamp"]=true,
  -- 회로
  ["arithmetic-combinator"]=true, ["decider-combinator"]=true,
  ["constant-combinator"]=true, ["programmable-speaker"]=true,
  ["selector-combinator"]=true,
  -- 방어
  ["wall"]=true, ["gate"]=true,
  ["ammo-turret"]=true, ["electric-turret"]=true, ["fluid-turret"]=true,
  -- 철도
  ["straight-rail"]=true, ["curved-rail"]=true, ["train-stop"]=true,
  ["half-diagonal-rail"]=true, ["curved-rail-a"]=true, ["curved-rail-b"]=true,
  -- Space Age
  ["agricultural-tower"]=true, ["asteroid-collector"]=true,
  ["thruster"]=true, ["space-platform-hub"]=true,
}

-- ---------------------------------------------------------------------------
-- 헬퍼: table의 key를 배열로 수집
-- ---------------------------------------------------------------------------
local function keys_to_array(tbl)
  if not tbl then return nil end
  local out = {}
  for k, _ in pairs(tbl) do out[#out + 1] = k end
  return out
end

-- ---------------------------------------------------------------------------
-- 헬퍼: pcall로 안전하게 속성/메서드 접근
-- ---------------------------------------------------------------------------
local function safe_get(fn)
  local ok, val = pcall(fn)
  if ok then return val end
  return nil
end

-- ---------------------------------------------------------------------------
-- 헬퍼: electric energy source의 drain (idle 소비) 추출
-- 게임 툴팁의 "Min. Consumption" = drain (J/tick)
-- 게임 툴팁의 "Max. Consumption" = energy_usage + drain
-- ---------------------------------------------------------------------------
local function extract_drain(e)
  local es = safe_get(function() return e.electric_energy_source_prototype end)
  if not es then return nil end
  return safe_get(function() return es.drain end)
end

-- ---------------------------------------------------------------------------
-- 헬퍼: MapPosition → {x, y} 정규화
-- Factorio는 {x=n, y=n} 또는 positional {[1]=n, [2]=n} 형태를 모두 쓴다.
-- ---------------------------------------------------------------------------
local function vec2(v)
  if not v or type(v) ~= "table" then return nil end
  local x = v.x
  local y = v.y
  if x == nil then x = v[1] end
  if y == nil then y = v[2] end
  if type(x) ~= "number" or type(y) ~= "number" then return nil end
  return { x = x, y = y }
end

-- ---------------------------------------------------------------------------
-- 헬퍼: fluidbox_prototypes → 연결점 정보 배열
-- 각 fluidbox의 pipe_connections에서 4방향 위치와 flow_direction 추출
-- ---------------------------------------------------------------------------
local function extract_fluid_boxes(e)
  local fbs = safe_get(function() return e.fluidbox_prototypes end)
  if not fbs or #fbs == 0 then return nil end

  local out = {}
  for i, fb in ipairs(fbs) do
    local connections = {}
    local pc = safe_get(function() return fb.pipe_connections end)
    if pc then
      for _, conn in ipairs(pc) do
        local positions = {}
        -- runtime positions는 4방향(N/E/S/W) 회전된 좌표 배열
        local pos_list = conn.positions
        if pos_list then
          for _, p in ipairs(pos_list) do
            local v = vec2(p)
            if v then positions[#positions + 1] = v end
          end
        end
        connections[#connections + 1] = {
          positions = positions,
          flow_direction = conn.flow_direction,
          connection_type = conn.connection_type,
          max_underground_distance = conn.max_underground_distance,
        }
      end
    end
    out[#out + 1] = {
      index = i,
      production_type = safe_get(function() return fb.production_type end),
      volume = safe_get(function() return fb.volume end),
      filter = safe_get(function() return fb.filter and fb.filter.name end),
      connections = connections,
    }
  end
  return out
end

-- ---------------------------------------------------------------------------
-- 엔티티 추출
-- hidden 플래그가 설정된 엔티티는 플레이어 UI에서 노출되지 않는 합성/variant
-- 엔티티들이므로 export에서 제외한다.
-- (예: se-space-elevator-energy-pole, *-grounded, *-ruin 등)
-- ---------------------------------------------------------------------------
for name, e in pairs(prototypes.entity) do
  if ALL_TYPES[e.type] and not e.hidden then
    local t = e.type

    -- === 공통 필드 ===
    local ent = {
      name        = name,
      type        = t,
      tile_width  = e.tile_width,
      tile_height = e.tile_height,
    }

    local cb = e.collision_box
    if cb then
      local lt = vec2(cb.left_top)
      local rb = vec2(cb.right_bottom)
      if lt and rb then ent.collision_box = { lt = lt, rb = rb } end
    end

    -- 모든 엔티티: idle drain (있으면)
    ent.energy_drain = extract_drain(e)

    -- 모든 엔티티: 이 엔티티를 설치하는 아이템 이름들.
    -- (예: assembling-machine-2 entity → assembling-machine-2 item)
    -- 이 아이템을 만드는 레시피를 거꾸로 찾으면, 어떤 기술이 머신을 언록하는지 추적할 수 있다.
    local itp = safe_get(function() return e.items_to_place_this end)
    if itp and #itp > 0 then
      local items = {}
      for _, it in ipairs(itp) do
        if it and it.name then items[#items + 1] = it.name end
      end
      if #items > 0 then ent.items_to_place_this = items end
    end

    -- 모든 엔티티: 설치 가능한 표면 조건 (Space Age — Nauvis/Vulcanus/Fulgora/Gleba/Aquilo + 우주 플랫폼)
    -- surface_conditions = { { property="pressure"|"gravity"|"magnetic-field"|"solar-power"|..., min=number?, max=number? }, ... }
    -- 이 조건을 만족하는 표면에서만 설치 가능. nil 또는 빈 배열이면 모든 표면 허용.
    local sc = safe_get(function() return e.surface_conditions end)
    if sc and #sc > 0 then
      local out_sc = {}
      for _, c in ipairs(sc) do
        out_sc[#out_sc + 1] = {
          property = c.property,
          min      = c.min,
          max      = c.max,
        }
      end
      ent.surface_conditions = out_sc
    end

    -- === 생산: CraftingMachine ===
    if CRAFTING_TYPES[t] then
      ent.crafting_categories = keys_to_array(e.crafting_categories)
      ent.crafting_speed      = safe_get(function() return e.get_crafting_speed() end)
      ent.module_slots        = e.module_inventory_size
      ent.energy_usage        = e.energy_usage
      ent.allowed_effects     = keys_to_array(e.allowed_effects)
      ent.allowed_module_categories = keys_to_array(safe_get(function() return e.allowed_module_categories end))
      ent.fluid_boxes         = extract_fluid_boxes(e)
    end

    -- === 생산: Lab ===
    if t == "lab" then
      local inp = {}
      if e.lab_inputs then
        for _, v in pairs(e.lab_inputs) do
          inp[#inp + 1] = (type(v) == "table" and v.name) or v
        end
      end
      ent.lab_inputs       = inp
      ent.researching_speed = safe_get(function() return e.get_researching_speed() end)
      ent.module_slots     = e.module_inventory_size
      ent.energy_usage     = e.energy_usage
      ent.allowed_effects  = keys_to_array(e.allowed_effects)
      ent.allowed_module_categories = keys_to_array(safe_get(function() return e.allowed_module_categories end))
    end

    -- === 생산: MiningDrill ===
    if t == "mining-drill" then
      ent.resource_categories = keys_to_array(e.resource_categories)
      ent.mining_speed        = e.mining_speed
      ent.module_slots        = e.module_inventory_size
      ent.energy_usage        = e.energy_usage
      ent.allowed_effects     = keys_to_array(e.allowed_effects)
      ent.allowed_module_categories = keys_to_array(safe_get(function() return e.allowed_module_categories end))
      ent.fluid_boxes         = extract_fluid_boxes(e)
      -- 채굴물 드롭 위치
      ent.vector_to_place_result = vec2(safe_get(function() return e.vector_to_place_result end))
      -- 자원 탐색 반경
      ent.resource_searching_radius = safe_get(function() return e.mining_drill_radius end)
    end

    -- === 물류: Belt 계열 ===
    if BELT_TYPES[t] then
      ent.belt_speed = e.belt_speed
    end

    -- === 물류: Underground ===
    if UNDERGROUND_TYPES[t] then
      ent.max_underground_distance = e.max_underground_distance
    end

    -- === 물류: Inserter ===
    if t == "inserter" then
      ent.inserter_pickup_position = vec2(safe_get(function() return e.inserter_pickup_position end))
      ent.inserter_drop_position   = vec2(safe_get(function() return e.inserter_drop_position end))
      ent.inserter_extension_speed = safe_get(function() return e.get_inserter_extension_speed() end)
      ent.inserter_rotation_speed  = safe_get(function() return e.get_inserter_rotation_speed() end)
    end

    -- === 물류: Pump ===
    if PUMP_TYPES[t] then
      ent.pumping_speed = safe_get(function() return e.pumping_speed end)
      ent.energy_usage  = e.energy_usage
      ent.fluid_boxes   = extract_fluid_boxes(e)
    end

    -- === 물류: Pipe / PipeToGround ===
    if t == "pipe" or t == "pipe-to-ground" then
      ent.fluid_boxes = extract_fluid_boxes(e)
    end

    -- === 전력: ElectricPole ===
    if t == "electric-pole" then
      ent.supply_area_distance = safe_get(function() return e.get_supply_area_distance() end)
      ent.max_wire_distance    = safe_get(function() return e.get_max_wire_distance() end)
    end

    -- === 전력: Generator / Solar / FusionGenerator ===
    if t == "generator" or t == "fusion-generator" or t == "burner-generator" then
      ent.max_power_output     = safe_get(function() return e.max_power_output end)
      ent.fluid_usage_per_tick = safe_get(function() return e.fluid_usage_per_tick end)
      ent.fluid_boxes          = extract_fluid_boxes(e)
    end
    if t == "solar-panel" then
      ent.max_power_output = safe_get(function() return e.max_power_output end)
    end

    -- === 전력: Boiler / FusionReactor ===
    if t == "boiler" or t == "fusion-reactor" then
      ent.target_temperature = safe_get(function() return e.target_temperature end)
      ent.energy_usage       = e.energy_usage
      ent.fluid_boxes        = extract_fluid_boxes(e)
    end

    -- === 기타: OffshorePump ===
    if t == "offshore-pump" then
      ent.fluid_boxes = extract_fluid_boxes(e)
    end

    -- === 기타: Beacon ===
    if t == "beacon" then
      ent.distribution_effectivity = e.distribution_effectivity
      ent.supply_area_distance     = safe_get(function() return e.get_supply_area_distance() end)
      ent.module_slots             = e.module_inventory_size
      ent.allowed_effects          = keys_to_array(e.allowed_effects)
      ent.allowed_module_categories = keys_to_array(safe_get(function() return e.allowed_module_categories end))
      ent.energy_usage             = e.energy_usage
    end

    -- === 기타: Roboport ===
    if t == "roboport" then
      ent.logistic_radius     = e.logistic_radius
      ent.construction_radius = e.construction_radius
    end

    -- === 기타: Chest (inventory_size) ===
    if t == "container" or t == "logistic-container" or t == "linked-container" then
      local inv = safe_get(function()
        return e.get_inventory_size(defines.inventory.chest)
      end)
      if inv and inv > 0 then ent.inventory_size = inv end
    end

    o.entities[#o.entities + 1] = ent
  end
end

-- ---------------------------------------------------------------------------
-- 레시피 추출
-- ---------------------------------------------------------------------------
for n, r in pairs(prototypes.recipe) do
  local ingredients = {}
  for _, v in pairs(r.ingredients) do
    ingredients[#ingredients + 1] = {
      type   = v.type,
      name   = v.name,
      amount = v.amount,
    }
  end

  local products = {}
  for _, v in pairs(r.products) do
    products[#products + 1] = {
      type        = v.type,
      name        = v.name,
      amount      = v.amount,
      probability = v.probability,
    }
  end

  o.recipes[#o.recipes + 1] = {
    name        = n,
    category    = r.category,
    energy      = r.energy,
    enabled     = r.enabled,
    ingredients = ingredients,
    products    = products,
    -- 레시피 단위 모듈 화이트리스트 (Space Age: 일부 레시피는 productivity 모듈 거부 등)
    allowed_module_categories = keys_to_array(safe_get(function() return r.allowed_module_categories end)),
    -- 레시피 단위 표면 조건 (Space Age: 우주에서만 가능, Vulcanus 전용 등)
    surface_conditions = (function()
      local sc = safe_get(function() return r.surface_conditions end)
      if not sc or #sc == 0 then return nil end
      local out = {}
      for _, c in ipairs(sc) do
        out[#out + 1] = { property = c.property, min = c.min, max = c.max }
      end
      return out
    end)(),
  }
end

-- ---------------------------------------------------------------------------
-- 모듈 추출 (LuaItemPrototype 중 module_effects가 있는 것만)
-- 자동완성 / 모듈 셀렉터 UI 에서 사용. category(speed/productivity/...) + tier 보존.
-- module_effects 는 ModuleEffects 테이블 (speed/productivity/consumption/pollution/quality 등)
-- 각 효과는 -1.0 ~ +n.n 범위의 비율 보너스로 머신 파라미터에 가산된다.
-- ---------------------------------------------------------------------------
for name, item in pairs(prototypes.item) do
  local effects = safe_get(function() return item.module_effects end)
  if effects then
    -- ModuleEffects: { speed=number?, productivity=number?, consumption=number?, pollution=number?, quality=number? }
    local effects_out = {}
    for _, key in ipairs({ "speed", "productivity", "consumption", "pollution", "quality" }) do
      local v = effects[key]
      if v ~= nil then effects_out[key] = v end
    end
    o.modules[#o.modules + 1] = {
      name     = name,
      category = safe_get(function() return item.category end),
      tier     = safe_get(function() return item.tier end),
      effects  = effects_out,
    }
  end
end

-- ---------------------------------------------------------------------------
-- 기술 추출 (LuaTechnologyPrototype)
-- 자동완성에서 "이 머신/레시피를 쓰려면 어떤 연구가 필요한가?" 를 풀기 위한 데이터.
--   * effects 의 type=="unlock-recipe" 항목만 뽑아 unlock_recipes 배열로.
--   * prerequisites 는 dictionary<name, LuaTechnologyPrototype> — 키만 뽑아 배열로.
--   * enabled: 게임 시작 시 활성, essential: 핵심 트리, visible_when_disabled: UI 노출.
-- 'hidden' 속성은 LuaTechnologyPrototype 에 존재하지 않는다 (visible_when_disabled / enabled 로 대체).
-- ---------------------------------------------------------------------------
for n, tech in pairs(prototypes.technology) do
  local unlock_recipes = {}
  local effects = safe_get(function() return tech.effects end)
  if effects then
    for _, ef in ipairs(effects) do
      if ef.type == "unlock-recipe" and ef.recipe then
        unlock_recipes[#unlock_recipes + 1] = ef.recipe
      end
    end
  end

  local prereqs = {}
  local pr = safe_get(function() return tech.prerequisites end)
  if pr then
    for k, _ in pairs(pr) do prereqs[#prereqs + 1] = k end
  end

  o.technologies[#o.technologies + 1] = {
    name                  = n,
    prerequisites         = prereqs,
    unlock_recipes        = unlock_recipes,
    enabled               = safe_get(function() return tech.enabled end),
    essential             = safe_get(function() return tech.essential end),
    visible_when_disabled = safe_get(function() return tech.visible_when_disabled end),
    upgrade               = safe_get(function() return tech.upgrade end),
    max_level             = safe_get(function() return tech.max_level end),
  }
end

-- ---------------------------------------------------------------------------
-- 파일 출력
-- ---------------------------------------------------------------------------
helpers.write_file("factorio-data.json", helpers.table_to_json(o))
game.print("Exported " .. #o.entities .. " entities, " .. #o.recipes .. " recipes, " .. #o.modules .. " modules, " .. #o.technologies .. " technologies")
