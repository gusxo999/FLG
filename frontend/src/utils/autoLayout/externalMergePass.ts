/**
 * 공유 무한상자 병합 패스 — 오케스트레이션 (Phase 2 ④ 단위, 부수효과 포함).
 *
 * 단일 출처: 계획서 "트렁크 벨트 셀 경로 계산 — 그리디 성장".
 *
 * 기존 `wrapExternalsAroundPerimeter` 는 (머신, 외부재료) 쌍마다 무한상자 1개를
 * 1:1 로 배치·라우팅한다. 본 패스는 같은 외부 품목을 쓰는 가까운 머신들을
 * **무한상자 1개 + 트렁크 벨트 1줄 + 머신별 탭 인서터**로 묶는다.
 *
 *   그룹화(③) → 트렁크 경로(①) → 셀 방출(②) → .placed 에 commit
 *
 * 입력(chest→machine)·출력(machine→chest) 둘 다 처리한다(출력은 collect 모드).
 * 병합에 실패하거나(트렁크 불가/일부 머신 미탭) 단독·fluid 인 연결은 기존
 * `wrapExternalsAroundPerimeter` 1:1 경로로 그대로 넘긴다 ("실패하면 기존 동작").
 *
 * v1 범위 (사용자 결정):
 *   - 직접 탭(reach-1 일반 인서터)만. long inserter·스퍼는 후속.
 *   - 트렁크 셀을 .placed 에 직접 commit (Routing 객체 미생성) → 청사진 export·
 *     렌더링 정상. 병합 상자 드래그 재라우팅은 후속(목표: 상자→첫 머신 구간만).
 */

import { productYield, useGameDataStore, type Entity, type Recipe } from '../../store/gameDataStore';
import {
  computeMachineFootprintBbox,
  wrapExternalsAroundPerimeter,
  placeConnectionsOnRing,
  growRingPerSide,
  boundsOfCells,
} from './areaUnification';
import { AUTO_LAYOUT_COORD_DUMP } from './debugFlags';
import { buildOccupancy, collectBeltFlow } from './containerRouting';
import type { Area, ContainerPort, PendingConnection, PortFace, Routing } from './containerModel';
import { makeContainerCell } from './util/cellBuilder';
import { beltThroughput } from './beltThroughput';
import { inserterThroughput } from './inserterThroughput';
import {
  computeIngredientDemand,
  groupConnections,
  type MergeCandidate,
  type MergeGroup,
} from './mergeGrouping';
import { emitTrunk } from './module/trunkEmit';
import { computeTrunkPath, type MachineLike } from './module/trunkPath';
import type { RouteOptions } from './routeFallback';

/** 그룹 1개의 최대 머신 수 (용량과 별개의 안전 cap). */
export const DEFAULT_MAX_TAPS = 6;

export interface MergeConfig {
  enabled: boolean;
  maxTaps: number;
}

export const DEFAULT_MERGE_CONFIG: MergeConfig = {
  enabled: false,
  maxTaps: DEFAULT_MAX_TAPS,
};

/** 모듈 토글 — `AUTO_LAYOUT_COORD_DUMP` 와 같은 패턴. UI/콘솔 런타임 on/off. 기본 ON. */
export let AUTO_LAYOUT_MERGE_BOXES = true;

export function setAutoLayoutMergeBoxes(v: boolean): void {
  AUTO_LAYOUT_MERGE_BOXES = v;
}

type Role = 'input' | 'output';

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `wrapExternalsAroundPerimeter` 의 병합 버전. 시그니처 호환(+cfg) —
 * `buildSingleAttempt` 가 플래그에 따라 둘 중 하나를 호출한다.
 */
export function wrapExternalsWithMerge(
  internal: Area,
  external: Area,
  routings: Routing[],
  connections: PendingConnection[],
  options: RouteOptions,
  cfg: MergeConfig,
): { placed: number; failed: number } {
  const _t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  let _attempts = 0;
  // 비활성이거나 머신이 없으면 기존 1:1 경로 그대로.
  const machineBbox = computeMachineFootprintBbox(internal);
  if (!cfg.enabled || !machineBbox) {
    return wrapExternalsAroundPerimeter(internal, external, routings, connections, options);
  }

  const { recipeMap, entityMap } = useGameDataStore.getState();
  const externalIds = new Set(external.containers.map((c) => c.id));

  // 용량 (데이터 없으면 Infinity = 개수 cap 만 적용).
  const beltCap = beltThroughput(entityMap.get(options.beltEntityName)) || Infinity;
  const tapCap = inserterThroughput(entityMap.get(options.inserterEntityName), options.inserterOverride) || Infinity;
  const groupCfg = { maxTaps: cfg.maxTaps, beltCapacity: beltCap, tapCapacity: tapCap };

  // 연결 분류: 입력 후보 · 출력 후보 · passthrough(fluid/기타). ring 과 무관하므로 1회만.
  const inputCands: MergeCandidate[] = [];
  const outputCands: MergeCandidate[] = [];
  const baseLeftover: PendingConnection[] = [];

  for (const conn of connections) {
    if (conn.kind !== 'item') {
      baseLeftover.push(conn);
      continue;
    }
    const prodIsChest = externalIds.has(conn.producerId);
    const consIsChest = externalIds.has(conn.consumerId);
    if (prodIsChest && !consIsChest) {
      const cand = makeInputCandidate(conn, internal, external, recipeMap, entityMap);
      if (cand) inputCands.push(cand);
      else baseLeftover.push(conn);
    } else if (consIsChest && !prodIsChest) {
      const cand = makeOutputCandidate(conn, internal, external, recipeMap, entityMap);
      if (cand) outputCands.push(cand);
      else baseLeftover.push(conn);
    } else {
      baseLeftover.push(conn);
    }
  }

  const inputGroups = groupConnections(inputCands, groupCfg);
  const outputGroups = groupConnections(outputCands, groupCfg);

  // 변별 독립 직사각형 + 변별 성장. trunk(대표 상자)와 leftover(1:1 상자)가 *같은*
  // 직사각형 둘레를 공유하고, 통로를 못 뚫은 chest 의 머신 최근접 변만 한 칸씩 밀린다.
  // 돌출 없는 변은 머신에 바짝 붙은 채 유지 → 그 변의 띠가 최소(2칸)로 얇아진다.
  // 결과는 항상 직사각형(돌기 없음). 머신 footprint bbox 기준.
  //
  // trunk(`tryMergeGroup`)는 흡수된 상자를 containers 에서 drop 하고 대표 상자 origin 을
  // 옮기므로, 시도마다 pristine 컨테이너 배열 + chest origin 을 복원해야 재시도가 깨끗하다.
  const pristineExt = [...external.containers];
  const pristineInt = [...internal.containers];
  const chestOrigins = new Map<string, { x: number; y: number }>();
  for (const c of pristineExt) {
    if (c.kind === 'infinity-chest' || c.kind === 'infinity-pipe') {
      chestOrigins.set(c.id, { ...c.origin });
    }
  }
  const snap = {
    internal: internal.placed.length,
    external: external.placed.length,
    routings: routings.length,
    corridors: internal.undergroundCorridors.length,
  };

  const { chosen, final } = growRingPerSide(
    machineBbox,
    (id) =>
      internal.containers.find((c) => c.id === id) ??
      external.containers.find((c) => c.id === id),
    () => {
      // 매 시도 전: pristine 컨테이너/origin + 외부 패스 진입 배열 길이로 복원.
      external.containers = [...pristineExt];
      internal.containers = [...pristineInt];
      for (const [id, o] of chestOrigins) {
        const ce = external.containers.find((c) => c.id === id);
        const ci = internal.containers.find((c) => c.id === id);
        if (ce) ce.origin = { ...o };
        if (ci) ci.origin = { ...o };
      }
      internal.placed.length = snap.internal;
      external.placed.length = snap.external;
      routings.length = snap.routings;
      internal.undergroundCorridors.length = snap.corridors;
    },
    (ringCells) => {
      _attempts += 1;
      const leftover: PendingConnection[] = [...baseLeftover];
      const logs: GroupLog[] = [];
      processGroups(inputGroups, 'input', internal, external, ringCells, options, leftover, logs, routings);
      processGroups(outputGroups, 'output', internal, external, ringCells, options, leftover, logs, routings);
      // 병합 안 된(단독·트렁크실패·passthrough) 연결은 같은 직사각형 위에서 1:1.
      const ext = placeConnectionsOnRing(internal, external, routings, leftover, options, ringCells);
      return {
        failed: ext.failed,
        failedMachineIds: ext.failedMachineIds,
        placedCount: external.placed.length,
        logs,
        leftoverCount: leftover.length,
      };
    },
  );

  const result = { placed: final.placedCount, failed: final.failed };

  if (AUTO_LAYOUT_COORD_DUMP) {
    const _ms = ((typeof performance !== 'undefined' ? performance : Date).now() - _t0);
    console.log('[autoLayout debug] externalMergePass\n' + JSON.stringify({
      perf: { ms: Math.round(_ms), ringAttempts: _attempts },
      capacity: { beltCap, tapCap, maxTaps: cfg.maxTaps },
      inputCands: inputCands.length, outputCands: outputCands.length,
      chosenOffsets: chosen,
      groups: final.logs, leftover: final.leftoverCount, summary: result,
    }, null, 2));
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 그룹 처리
// ─────────────────────────────────────────────────────────────────────────────

interface GroupLog {
  content: string;
  role: Role;
  size: number;
  mode: 'trunk' | 'fallback-1:1';
  /** 1:1 폴백 사유 (mode==='fallback-1:1'). 'demand>tapCap' | 'trunk:<infeasible>' | 'untapped=N' | 'single-consumer'. */
  reason?: string;
  /** 그룹 내 머신 레시피(중복 제거) — 어떤 레시피의 폴백인지. */
  recipes?: string[];
  /** 그룹 내 머신 컨테이너 id (= 클러스터) — 어느 클러스터인지. */
  machineIds?: string[];
}

/** 그룹 멤버의 distinct 레시피 목록 (로깅용). */
function distinctRecipes(members: MergeCandidate[]): string[] {
  return [...new Set(members.map((m) => m.recipeName))];
}

function processGroups(
  groups: MergeGroup[],
  role: Role,
  internal: Area,
  external: Area,
  perimeter: { x: number; y: number }[],
  options: RouteOptions,
  leftover: PendingConnection[],
  logs: GroupLog[],
  routings: Routing[],
): void {
  for (const group of groups) {
    let trunkReason: string | undefined;
    if (group.members.length >= 2) {
      const merged = tryMergeGroup(group, role, internal, external, perimeter, options, routings);
      if (merged.ok) {
        logs.push({
          content: group.content, role, size: group.members.length, mode: 'trunk',
          recipes: distinctRecipes(group.members),
          machineIds: group.members.map((m) => m.machineId),
        });
        continue;
      }
      trunkReason = `trunk:${merged.reason}`;
    }
    // 단독 그룹(용량 초과 1:1 강제) 또는 트렁크 실패 → 1:1.
    for (const m of group.members) leftover.push(m.connection);
    if (AUTO_LAYOUT_COORD_DUMP) {
      logs.push({
        content: group.content, role, size: group.members.length, mode: 'fallback-1:1',
        reason: trunkReason ?? group.reason ?? 'single-consumer',
        recipes: distinctRecipes(group.members),
        machineIds: group.members.map((m) => m.machineId),
      });
    }
  }
}

/**
 * 한 그룹을 트렁크로 묶어 commit. 성공 시 true(연결들이 처리됨), 실패 시 false
 * (호출자가 1:1 leftover 로). v1: 모든 머신이 직접 탭될 때(untapped 없음)만 성공.
 */
function tryMergeGroup(
  group: MergeGroup,
  role: Role,
  internal: Area,
  external: Area,
  perimeter: { x: number; y: number }[],
  options: RouteOptions,
  routings: Routing[],
): { ok: true } | { ok: false; reason: string } {
  const repChestId = role === 'input' ? group.members[0].connection.producerId : group.members[0].connection.consumerId;
  const chest = external.containers.find((c) => c.id === repChestId);
  if (!chest) return { ok: false, reason: 'no-chest' };

  const machineIdOf = (c: MergeCandidate) =>
    role === 'input' ? c.connection.consumerId : c.connection.producerId;

  const machines: MachineLike[] = [];
  for (const m of group.members) {
    const mc = internal.containers.find((c) => c.id === machineIdOf(m));
    if (!mc) return { ok: false, reason: 'no-machine' };
    machines.push({ id: mc.id, origin: { ...mc.origin }, size: { ...mc.size } });
  }

  // occupancy + 외부 벨트 수신 칸 차단 — 트렁크 벨트가 타 라우팅 벨트의 출력 칸 위에
  // 놓여 그 스트림을 받지(합류하지) 않도록 한다(벨트 흐름 인접 합류 방지).
  const occupancy = buildOccupancy(internal, external);
  for (const k of collectBeltFlow([internal, external]).sinkTargets) occupancy.add(k);
  const result = computeTrunkPath({
    machines,
    occupancy,
    chestCandidates: perimeter,
    config: { longReach: options.longInserter?.reach }, // 긴팔 보유 시 reach≥2 탭 허용
    // 단일 외곽 링 불변식: 트렁크도 현재 ring 직사각형(= perimeter bbox) 밖으로 못 나간다.
    bounds: perimeter.length > 0 ? boundsOfCells(perimeter) : undefined,
  });
  // v1 "무조건 성공" 가정 — 일부라도 직접 탭 안 되면 통째로 1:1 폴백.
  if (!result.ok) return { ok: false, reason: result.infeasible };
  if (result.path.untapped.length > 0) {
    if (AUTO_LAYOUT_COORD_DUMP) {
      console.log('[autoLayout debug] trunk untapped\n' + JSON.stringify({
        role, content: chest.content, longReach: options.longInserter?.reach,
        untappedInfo: result.path.untappedInfo,
      }, null, 2));
    }
    return { ok: false, reason: `untapped=${result.path.untapped.length}` };
  }

  const emission = emitTrunk(result.path, {
    chestId: chest.id,
    beltEntityName: options.beltEntityName,
    inserterEntityName: options.inserterEntityName,
    longInserterEntityName: options.longInserter?.entityName ?? options.inserterEntityName,
    mode: role === 'input' ? 'supply' : 'collect',
  });

  // commit — 트렁크 belt·인서터는 internal, 대표 상자는 external.
  for (const c of emission.beltCells) internal.placed.push(c);
  if (emission.feeder) internal.placed.push(emission.feeder);
  for (const t of emission.taps) internal.placed.push(t.inserter);

  chest.origin = { ...result.path.chestCell };
  external.placed.push(makeContainerCell(chest, result.path.chestCell));

  // 트렁크를 Routing 객체로도 등록한다. 셀을 .placed 에만 넣으면 belt 타일은
  // 그려지지만 라우팅 편집 모드의 *라우팅 선*(hover/클릭/드래그 대상)이 안 생긴다
  // — 선·히트테스트가 `routingEditSession.routings`(= area routings) 만 순회하기
  // 때문. 대표 머신 ↔ 대표 상자 한 쌍으로 묶고, 트렁크가 깐 모든 셀을 placed 로 단다.
  // (한쪽 끝이 상자라 machine↔machine 부모-자식으로 오인되지 않는다.)
  const placed = [
    ...emission.beltCells,
    ...(emission.feeder ? [emission.feeder] : []),
    ...emission.taps.map((t) => t.inserter),
  ];
  if (placed.length > 0 && result.path.covered.length > 0) {
    const firstTap = result.path.covered[0];
    const machinePort: ContainerPort = {
      containerId: firstTap.machineId,
      cell: { ...firstTap.port },
      face: firstTap.face,
      kind: 'item',
    };
    const startCell = result.path.trunkCells[0];
    const fx = startCell ? Math.sign(startCell.x - result.path.chestCell.x) : 0;
    const fy = startCell ? Math.sign(startCell.y - result.path.chestCell.y) : 0;
    const chestFace: PortFace = fx === 1 ? 'E' : fx === -1 ? 'W' : fy === 1 ? 'S' : 'N';
    const chestPort: ContainerPort = {
      containerId: chest.id,
      cell: { ...result.path.chestCell },
      face: chestFace,
      kind: 'item',
    };
    // supply(입력): 상자→머신, collect(출력): 머신→상자.
    const [from, to] = role === 'input' ? [chestPort, machinePort] : [machinePort, chestPort];
    routings.push({ id: `${chest.id}#trunk`, kind: 'item', from, to, placed, corridors: [] });
  }

  // 흡수된 나머지 상자 제거 (아직 배치 전이라 containers 에서만).
  const dropIds = group.members
    .map((m) => (role === 'input' ? m.connection.producerId : m.connection.consumerId))
    .filter((id) => id !== repChestId);
  if (dropIds.length > 0) {
    const drop = new Set(dropIds);
    external.containers = external.containers.filter((c) => !drop.has(c.id));
    internal.containers = internal.containers.filter((c) => !drop.has(c.id));
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 후보 생성
// ─────────────────────────────────────────────────────────────────────────────

function makeInputCandidate(
  conn: PendingConnection,
  internal: Area,
  external: Area,
  recipeMap: Map<string, Recipe>,
  entityMap: Map<string, Entity>,
): MergeCandidate | null {
  const chest = external.containers.find((c) => c.id === conn.producerId);
  const machine = internal.containers.find((c) => c.id === conn.consumerId);
  if (!chest?.content || !machine?.recipeName) return null;
  const demand = computeIngredientDemand(recipeMap.get(machine.recipeName), entityMap.get(machine.entityName), chest.content);
  return { connection: conn, content: chest.content, demand, pos: { ...machine.origin }, machineId: machine.id, recipeName: machine.recipeName };
}

function makeOutputCandidate(
  conn: PendingConnection,
  internal: Area,
  external: Area,
  recipeMap: Map<string, Recipe>,
  entityMap: Map<string, Entity>,
): MergeCandidate | null {
  const machine = internal.containers.find((c) => c.id === conn.producerId);
  const chest = external.containers.find((c) => c.id === conn.consumerId);
  if (!chest?.content || !machine?.recipeName) return null;
  const demand = computeProductDemand(recipeMap.get(machine.recipeName), entityMap.get(machine.entityName), chest.content);
  return { connection: conn, content: chest.content, demand, pos: { ...machine.origin }, machineId: machine.id, recipeName: machine.recipeName };
}

/** 한 머신이 특정 product 를 생산하는 속도 (items/sec). 수요 모델의 출력 버전. */
function computeProductDemand(
  recipe: Recipe | undefined,
  machineEntity: Entity | undefined,
  productName: string,
): number {
  if (!recipe || !machineEntity) return Infinity;
  const speed = machineEntity.crafting_speed;
  if (!speed || speed <= 0) return Infinity;
  if (!recipe.energy_required || recipe.energy_required <= 0) return Infinity;
  const prod = recipe.products.find((p) => p.name === productName);
  if (!prod) return Infinity;
  const y = productYield(prod); // 범위/확률 산출물의 기대 수율. 수량 미상이면 undefined.
  if (y === undefined) return Infinity; // 이 파일의 "모르면 Infinity"(판정 보류) 규약.
  return (speed / recipe.energy_required) * y;
}
