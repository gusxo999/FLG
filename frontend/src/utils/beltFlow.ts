/**
 * beltFlow — 그리드에 배치된 벨트 셀 한 칸의 "정적 흐름량" 분석.
 *
 * 클릭한 벨트 셀에서 상류(벨트 그래프 역방향)를 전부 수집한 뒤, 소스(드랍 인서터)
 * 부터 전방으로 누적해 그 셀을 지나는 items/sec 를 계산한다. 인서터 지점마다
 * 투입(+)/제거(−)가 반영되므로 구간별 흐름량이 달라진다.
 *
 * 모델 (정적 정상상태 추정 — 시뮬레이션 아님):
 *  - 인서터 기여량 = min(인서터 처리량, 머신 레시피 생산/소비율).
 *    상자(무한상자 포함)는 무한 공급/회수 → 인서터 처리량이 곧 기여량.
 *    머신인데 레시피를 모르면(용광로 자동 레시피 등) 인서터 처리량으로 폴백.
 *  - 각 벨트 셀의 유출량은 그 벨트 용량(beltThroughput)으로 클램프.
 *  - 인서터 방향 규약 = Factorio: direction 이 *픽업* 방향(향한 쪽에서 집고
 *    반대쪽에 놓는다). 픽업/드랍 셀은 프로토타입 `inserter_pickup_position` /
 *    `inserter_drop_position` 을 direction 만큼 회전해 얻는다(렌더러와 동일 규약,
 *    pixi-draw-entity 참조). 프로토타입이 없으면 reach(inserterReach) 폴백.
 *  - 벨트 연결: 뒤/옆에서 유입(side-load 포함), 정면 마주보기는 불가.
 *    지하벨트 input→output 페어는 같은 방향·같은 entityName 의 최근접 출구.
 *  - 한 벨트 = 1품목 가정(현 앱 제약). 서로 다른 품목이 관측되면 items 에 모두 담는다.
 *  - 분배기(Splitter)는 셀 단위 직진 통과로 근사(분할 비율 미모델링).
 */

import {
  EntityType,
  getCell,
  type Direction,
  type GridCell,
  type LayoutGrid,
} from '../types/layout';
import type { Entity, Module, Recipe } from '../store/gameDataStore';
import type { InfinitySettings } from '../types/blueprint';
import { beltThroughput } from './autoLayout/beltThroughput';
import { inserterThroughput, inserterReach } from './autoLayout/inserterThroughput';
import { sumModuleEffects, applyEffectsToMachine } from './moduleEffects';

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

export interface BeltFlowCtx {
  entityMap: Map<string, Entity>;
  recipeMap: Map<string, Recipe>;
  moduleMap: Map<string, Module>;
  /** 위저드의 인서터 보정(entityName 키) — 있으면 처리량 계산에 반영. */
  inserterOverrides?: Record<string, { throughput?: number; stackSize?: number }>;
}

/** 클릭한 셀에 직접 닿는 인서터 접점 1개. */
export interface BeltTap {
  /** 인서터 셀 좌표. */
  x: number;
  y: number;
  /** drop = 벨트에 투입(+), pick = 벨트에서 제거(−). */
  kind: 'drop' | 'pick';
  /** 적용된 items/sec (인서터·머신 중 작은 쪽). */
  rate: number;
  inserterName: string;
  /** 인서터 반대편(머신/상자) entityName. 비어 있으면 null. */
  peerName: string | null;
  /** 이 접점이 나르는 품목(소스 쪽에서만 유도 가능). */
  item: string | null;
  /** 머신 레시피율을 못 구해 인서터 처리량으로 폴백했는지. */
  machineRateUnknown: boolean;
}

export interface BeltFlowResult {
  /** 상류에서 관측된 품목(중복 제거). 현 앱 제약상 보통 1개. */
  items: string[];
  /** 클릭 셀에 도달하는 유입량(이 셀 투입 포함) items/sec. */
  inflow: number;
  /** 클릭 셀을 떠나는 유출량(이 셀 제거 반영, 용량 클램프) items/sec. */
  outflow: number;
  /** 클릭 셀 벨트의 용량 items/sec (0 = 프로토타입 미상). */
  capacity: number;
  /** 유출량이 용량에 걸렸는지. */
  saturated: boolean;
  /** 클릭 셀에 직접 닿는 인서터 접점들. */
  tapsAtCell: BeltTap[];
  /** 상류 전체(클릭 셀 제외)의 접점 수. */
  upstreamTaps: { drops: number; picks: number };
  /** 머신율 미상으로 인서터 처리량 폴백한 접점 수(전체). */
  machineRateUnknownCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 방향 유틸 (direction-encoding.md 규약)
// ─────────────────────────────────────────────────────────────────────────────

function dirVec(d: Direction): { x: number; y: number } {
  switch (d) {
    case 4: return { x: 1, y: 0 };   // E
    case 8: return { x: 0, y: 1 };   // S
    case 12: return { x: -1, y: 0 }; // W
    default: return { x: 0, y: -1 }; // N
  }
}

function rotateVec(v: { x: number; y: number }, d: Direction): { x: number; y: number } {
  switch (d) {
    case 4: return { x: -v.y, y: v.x };  // E (90° cw)
    case 8: return { x: -v.x, y: -v.y }; // S (180°)
    case 12: return { x: v.y, y: -v.x }; // W (270° cw)
    default: return { x: v.x, y: v.y };  // N
  }
}

const key = (x: number, y: number) => `${x},${y}`;

const BELT_LIKE = new Set<EntityType>([
  EntityType.Belt,
  EntityType.UndergroundBelt,
  EntityType.Splitter,
]);

export function isBeltLike(t: EntityType | undefined): boolean {
  return t !== undefined && BELT_LIKE.has(t);
}

const MAX_UNDERGROUND_FALLBACK = 8;

// ─────────────────────────────────────────────────────────────────────────────
// 벨트 그래프
// ─────────────────────────────────────────────────────────────────────────────

/** 벨트류 셀의 다음(하류) 셀 좌표. 지하 입구는 페어 출구로 점프. 없으면 null. */
function nextOf(grid: LayoutGrid, x: number, y: number, c: GridCell): { x: number; y: number } | null {
  const v = dirVec(c.direction);
  if (c.entityType === EntityType.UndergroundBelt && c.undergroundType === 'input') {
    // 같은 방향·같은 entityName 의 최근접 출구 탐색. 사이에 또 다른 input(같은
    // 방향·이름)이 나오면 페어가 끊긴 것(그 input 이 새 페어 시작).
    for (let k2 = 1; k2 <= MAX_UNDERGROUND_FALLBACK; k2++) {
      const nx = x + v.x * k2;
      const ny = y + v.y * k2;
      const nc = getCell(grid, nx, ny);
      if (!nc || nc.entityType !== EntityType.UndergroundBelt) continue;
      if (nc.entityName !== c.entityName || nc.direction !== c.direction) continue;
      if (nc.undergroundType === 'input') return null; // 새 페어 시작 → 끊김
      return { x: nx, y: ny };
    }
    return null;
  }
  return { x: x + v.x, y: y + v.y };
}

/**
 * v(벨트류 셀)로 유입하는 상류 벨트 셀들. 4-이웃 중 next(u)==v 이고 정면
 * 마주보기(반대 방향)가 아닌 것 + 지하 출구면 그 페어 입구.
 */
function upstreamOf(grid: LayoutGrid, x: number, y: number, c: GridCell): Array<{ x: number; y: number }> {
  const res: Array<{ x: number; y: number }> = [];
  const opp = ((c.direction + 8) % 16) as Direction;
  for (const d of [0, 4, 8, 12] as Direction[]) {
    const v = dirVec(d);
    const ux = x + v.x; // 이웃 후보
    const uy = y + v.y;
    const uc = getCell(grid, ux, uy);
    if (!uc || !isBeltLike(uc.entityType)) continue;
    if (uc.entityType === EntityType.UndergroundBelt && uc.undergroundType === 'input') {
      // 입구의 하류는 지하 페어 — 지상 이웃으로는 유입하지 않는다. (페어 출구가
      // 곧 v 인 경우는 아래 지하 출구 상류 스캔이 잡는다.)
      continue;
    }
    // 정면 마주보기(u 가 v 를 향하고 방향이 서로 반대) — 아이템 전달 불가.
    if (uc.direction === opp) continue;
    const n = nextOf(grid, ux, uy, uc);
    if (n && n.x === x && n.y === y) res.push({ x: ux, y: uy });
  }
  // 지하 출구면 페어 입구도 상류.
  if (c.entityType === EntityType.UndergroundBelt && c.undergroundType !== 'input') {
    const v = dirVec(c.direction);
    for (let k2 = 1; k2 <= MAX_UNDERGROUND_FALLBACK; k2++) {
      const ux = x - v.x * k2;
      const uy = y - v.y * k2;
      const uc = getCell(grid, ux, uy);
      if (!uc || uc.entityType !== EntityType.UndergroundBelt) continue;
      if (uc.entityName !== c.entityName || uc.direction !== c.direction) continue;
      if (uc.undergroundType === 'input') res.push({ x: ux, y: uy });
      break; // 어느 쪽이든 최근접에서 종료(출구면 페어 아님).
    }
  }
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// 인서터 접점
// ─────────────────────────────────────────────────────────────────────────────

interface TapIndexEntry extends BeltTap {
  /** 이 접점이 붙은 벨트 셀 키. */
  beltKey: string;
}

/** 머신(레시피 보유 가능 엔티티)의 특정 품목 생산/소비율 items/sec. 미상이면 null. */
function machineItemRate(
  grid: LayoutGrid,
  cell: GridCell,
  x: number,
  y: number,
  item: string | null,
  side: 'produce' | 'consume',
  ctx: BeltFlowCtx,
): { rate: number | null; item: string | null } {
  // origin 셀에 레시피/모듈이 있다.
  const origin = getCell(grid, x - cell.tileOffset.x, y - cell.tileOffset.y) ?? cell;
  const recipeName = origin.recipe;
  if (!recipeName) return { rate: null, item };
  const recipe = ctx.recipeMap.get(recipeName);
  const entity = origin.entityName ? ctx.entityMap.get(origin.entityName) : undefined;
  if (!recipe || !entity || entity.crafting_speed === undefined) return { rate: null, item };

  const eff = applyEffectsToMachine(
    entity.crafting_speed,
    0,
    sumModuleEffects(origin.modules, ctx.moduleMap),
  );
  const craftTime = Math.max(recipe.energy_required || 0.5, 1 / 60);
  const craftsPerSec = eff.craftingSpeed / craftTime;

  if (side === 'produce') {
    const prods = recipe.products.filter((p) => p.type === 'item');
    const p = item ? prods.find((q) => q.name === item) : prods[0];
    if (!p) return { rate: null, item };
    return {
      rate: craftsPerSec * p.amount * (p.probability ?? 1) * eff.productivityMultiplier,
      item: p.name,
    };
  }
  const ings = recipe.ingredients.filter((i) => i.type === 'item');
  const ing = item ? ings.find((q) => q.name === item) : ings[0];
  if (!ing) return { rate: null, item };
  return { rate: craftsPerSec * ing.amount, item: ing.name };
}

/** 상자 셀에서 품목 유도(무한상자 필터 첫 항목). */
function chestItem(cell: GridCell): string | null {
  const s = cell.infinitySettings as InfinitySettings | undefined;
  const f = s && 'filters' in s ? s.filters?.[0] : undefined;
  return f?.name ?? null;
}

const CHEST_TYPES = new Set<EntityType>([EntityType.Chest, EntityType.InfinityChest]);
const MACHINE_TYPES = new Set<EntityType>([
  EntityType.Assembler,
  EntityType.Furnace,
  EntityType.Lab,
  EntityType.MiningDrill,
]);

/**
 * 그리드 전체를 1회 스캔해 벨트에 닿는 인서터 접점 인덱스를 만든다.
 * 반환: beltKey → taps.
 */
function buildTapIndex(grid: LayoutGrid, ctx: BeltFlowCtx): Map<string, TapIndexEntry[]> {
  const idx = new Map<string, TapIndexEntry[]>();
  const push = (k: string, t: TapIndexEntry) => {
    const arr = idx.get(k);
    if (arr) arr.push(t);
    else idx.set(k, [t]);
  };

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const c = getCell(grid, x, y)!;
      if (c.entityType !== EntityType.Inserter && c.entityType !== EntityType.LongInserter) continue;
      if (!c.isOrigin) continue;
      const ent = c.entityName ? ctx.entityMap.get(c.entityName) : undefined;

      // 픽업/드랍 오프셋: 프로토타입 벡터 회전(렌더러 동일 규약) → 폴백 reach.
      const reach = inserterReach(ent);
      let pick = ent?.inserter_pickup_position
        ? rotateVec(ent.inserter_pickup_position, c.direction)
        : null;
      if (!pick || (Math.round(pick.x) === 0 && Math.round(pick.y) === 0)) {
        const v = dirVec(c.direction);
        pick = { x: v.x * reach, y: v.y * reach };
      }
      let drop = ent?.inserter_drop_position
        ? rotateVec(ent.inserter_drop_position, c.direction)
        : null;
      if (!drop || (Math.round(drop.x) === 0 && Math.round(drop.y) === 0)) {
        drop = { x: -pick.x, y: -pick.y };
      }
      const px = x + Math.round(pick.x);
      const py = y + Math.round(pick.y);
      const dx = x + Math.round(drop.x);
      const dy = y + Math.round(drop.y);
      const pc = getCell(grid, px, py);
      const dc = getCell(grid, dx, dy);

      const inserterCap = inserterThroughput(ent, ctx.inserterOverrides?.[c.entityName ?? '']);
      const cap = inserterCap > 0 ? inserterCap : Infinity;

      // 벨트에 드랍(소스): 픽업 쪽 = 머신 생산 or 상자.
      if (dc && isBeltLike(dc.entityType)) {
        let item: string | null = null;
        let machineRate: number | null = null;
        let unknown = false;
        if (pc && MACHINE_TYPES.has(pc.entityType)) {
          const r = machineItemRate(grid, pc, px, py, null, 'produce', ctx);
          item = r.item;
          machineRate = r.rate;
          unknown = r.rate === null;
        } else if (pc && CHEST_TYPES.has(pc.entityType)) {
          item = chestItem(pc);
        } else if (!pc || pc.entityType === EntityType.Empty || isBeltLike(pc.entityType)) {
          // 벨트→벨트 인서터(사이드로딩 대용) 또는 허공 — 흐름 재배치는 미모델링.
          unknown = pc ? isBeltLike(pc.entityType) : false;
        }
        const rate = Math.min(cap, machineRate ?? Infinity);
        push(key(dx, dy), {
          x, y, kind: 'drop', beltKey: key(dx, dy),
          rate: isFinite(rate) ? rate : 0,
          inserterName: c.entityName ?? '?',
          peerName: pc?.entityName ?? null,
          item,
          machineRateUnknown: unknown,
        });
      }

      // 벨트에서 픽업(싱크): 드랍 쪽 = 머신 소비 or 상자.
      if (pc && isBeltLike(pc.entityType)) {
        let item: string | null = null;
        let machineRate: number | null = null;
        let unknown = false;
        if (dc && MACHINE_TYPES.has(dc.entityType)) {
          const r = machineItemRate(grid, dc, dx, dy, null, 'consume', ctx);
          item = r.item;
          machineRate = r.rate;
          unknown = r.rate === null;
        } else if (dc && CHEST_TYPES.has(dc.entityType)) {
          item = chestItem(dc);
        }
        const rate = Math.min(cap, machineRate ?? Infinity);
        push(key(px, py), {
          x, y, kind: 'pick', beltKey: key(px, py),
          rate: isFinite(rate) ? rate : 0,
          inserterName: c.entityName ?? '?',
          peerName: dc?.entityName ?? null,
          item,
          machineRateUnknown: unknown,
        });
      }
    }
  }
  return idx;
}

// ─────────────────────────────────────────────────────────────────────────────
// 흐름 계산
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 클릭한 벨트류 셀의 흐름 분석. 벨트류가 아니면 null.
 * ctx 는 게임데이터 맵들 — 스토어에서 꺼내 넘긴다(순수 함수, 테스트 용이).
 */
export function computeBeltFlowAt(
  grid: LayoutGrid,
  gx: number,
  gy: number,
  ctx: BeltFlowCtx,
): BeltFlowResult | null {
  const target = getCell(grid, gx, gy);
  if (!target || !isBeltLike(target.entityType)) return null;

  // 1) 상류 부분그래프 수집 (클릭 셀 포함, 역방향 BFS).
  const inSet = new Set<string>([key(gx, gy)]);
  const queue: Array<{ x: number; y: number }> = [{ x: gx, y: gy }];
  const upstreams = new Map<string, Array<{ x: number; y: number }>>();
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const cc = getCell(grid, cur.x, cur.y)!;
    const ups = upstreamOf(grid, cur.x, cur.y, cc);
    upstreams.set(key(cur.x, cur.y), ups);
    for (const u of ups) {
      const uk = key(u.x, u.y);
      if (inSet.has(uk)) continue;
      inSet.add(uk);
      queue.push(u);
    }
  }

  // 2) 인서터 접점 인덱스 (그리드 1회 스캔).
  const taps = buildTapIndex(grid, ctx);

  // 3) 전방 누적 — worklist 완화. 레이아웃 벨트는 사실상 비순환이지만 순환 가드로
  //    반복 상한을 둔다.
  const flowOut = new Map<string, number>(); // 셀 유출량
  for (const k2 of inSet) flowOut.set(k2, 0);

  const calc = (k2: string): { inflow: number; out: number } => {
    const [cx, cy] = k2.split(',').map(Number);
    const cc = getCell(grid, cx, cy)!;
    let inflow = 0;
    for (const u of upstreams.get(k2) ?? []) {
      const uk = key(u.x, u.y);
      if (inSet.has(uk)) inflow += flowOut.get(uk) ?? 0;
    }
    let drops = 0;
    let picks = 0;
    for (const t of taps.get(k2) ?? []) {
      if (t.kind === 'drop') drops += t.rate;
      else picks += t.rate;
    }
    const cap = beltThroughput(cc.entityName ? ctx.entityMap.get(cc.entityName) : undefined);
    const inTotal = inflow + drops;
    const out = Math.max(0, inTotal - picks);
    return { inflow: inTotal, out: cap > 0 ? Math.min(cap, out) : out };
  };

  const maxIter = inSet.size * 4 + 8;
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (const k2 of inSet) {
      const { out } = calc(k2);
      if (Math.abs(out - (flowOut.get(k2) ?? 0)) > 1e-9) {
        flowOut.set(k2, out);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // 4) 결과 조립.
  const tk = key(gx, gy);
  const { inflow, out } = calc(tk);
  const capacity = beltThroughput(target.entityName ? ctx.entityMap.get(target.entityName) : undefined);

  const items = new Set<string>();
  let drops = 0;
  let picks = 0;
  let unknownCount = 0;
  for (const k2 of inSet) {
    for (const t of taps.get(k2) ?? []) {
      if (t.item) items.add(t.item);
      if (t.machineRateUnknown) unknownCount++;
      if (k2 !== tk) {
        if (t.kind === 'drop') drops++;
        else picks++;
      }
    }
  }

  return {
    items: [...items],
    inflow,
    outflow: out,
    capacity,
    saturated: capacity > 0 && out >= capacity - 1e-9,
    tapsAtCell: (taps.get(tk) ?? []).map(({ beltKey: _bk, ...t }) => t),
    upstreamTaps: { drops, picks },
    machineRateUnknownCount: unknownCount,
  };
}
