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

import { useGameDataStore, type Entity, type Recipe } from '../../store/gameDataStore';
import {
  computeMachineRoutingBbox,
  enumeratePerimeterCells,
  wrapExternalsAroundPerimeter,
} from './areaUnification';
import { AUTO_LAYOUT_COORD_DUMP } from './debugFlags';
import { buildOccupancy } from './containerRouting';
import type { Area, PendingConnection, Routing } from './containerModel';
import { makeContainerCell } from './externalPlacer';
import { beltThroughput } from './beltThroughput';
import { inserterThroughput } from './inserterThroughput';
import {
  computeIngredientDemand,
  groupConnections,
  type MergeCandidate,
  type MergeGroup,
} from './mergeGrouping';
import { emitTrunk } from './trunkEmit';
import { computeTrunkPath, type MachineLike } from './trunkPath';
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

/** 모듈 토글 — `AUTO_LAYOUT_COORD_DUMP` 와 같은 패턴. UI/콘솔 런타임 on/off. */
export let AUTO_LAYOUT_MERGE_BOXES = false;

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
): void {
  // 비활성이거나 머신이 없으면 기존 1:1 경로 그대로.
  const bbox = computeMachineRoutingBbox(internal);
  if (!cfg.enabled || !bbox) {
    wrapExternalsAroundPerimeter(internal, external, routings, connections, options);
    return;
  }

  const { recipeMap, entityMap } = useGameDataStore.getState();
  const externalIds = new Set(external.containers.map((c) => c.id));

  // 용량 (데이터 없으면 Infinity = 개수 cap 만 적용).
  const beltCap = beltThroughput(entityMap.get(options.beltEntityName)) || Infinity;
  const tapCap = inserterThroughput(entityMap.get(options.inserterEntityName)) || Infinity;
  const groupCfg = { maxTaps: cfg.maxTaps, beltCapacity: beltCap, tapCapacity: tapCap };

  // perimeter 는 머신 bbox 기준 1번만 (트렁크 commit 으로 늘어나도 chest ring 은 고정).
  const perimeter = enumeratePerimeterCells(bbox);

  // 연결 분류: 입력 후보 · 출력 후보 · passthrough(fluid/기타).
  const inputCands: MergeCandidate[] = [];
  const outputCands: MergeCandidate[] = [];
  const leftover: PendingConnection[] = [];

  for (const conn of connections) {
    if (conn.kind !== 'item') {
      leftover.push(conn);
      continue;
    }
    const prodIsChest = externalIds.has(conn.producerId);
    const consIsChest = externalIds.has(conn.consumerId);
    if (prodIsChest && !consIsChest) {
      const cand = makeInputCandidate(conn, internal, external, recipeMap, entityMap);
      if (cand) inputCands.push(cand);
      else leftover.push(conn);
    } else if (consIsChest && !prodIsChest) {
      const cand = makeOutputCandidate(conn, internal, external, recipeMap, entityMap);
      if (cand) outputCands.push(cand);
      else leftover.push(conn);
    } else {
      leftover.push(conn);
    }
  }

  const logs: GroupLog[] = [];
  processGroups(groupConnections(inputCands, groupCfg), 'input', internal, external, perimeter, options, leftover, logs);
  processGroups(groupConnections(outputCands, groupCfg), 'output', internal, external, perimeter, options, leftover, logs);

  // 병합 안 된(단독·실패·passthrough) 연결은 기존 1:1 경로로.
  wrapExternalsAroundPerimeter(internal, external, routings, leftover, options);

  if (AUTO_LAYOUT_COORD_DUMP) {
    console.log('[autoLayout debug] externalMergePass\n' + JSON.stringify({
      capacity: { beltCap, tapCap, maxTaps: cfg.maxTaps },
      inputCands: inputCands.length, outputCands: outputCands.length,
      groups: logs, leftover: leftover.length,
    }, null, 2));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 그룹 처리
// ─────────────────────────────────────────────────────────────────────────────

interface GroupLog { content: string; role: Role; size: number; mode: 'trunk' | 'fallback-1:1'; }

function processGroups(
  groups: MergeGroup[],
  role: Role,
  internal: Area,
  external: Area,
  perimeter: { x: number; y: number }[],
  options: RouteOptions,
  leftover: PendingConnection[],
  logs: GroupLog[],
): void {
  for (const group of groups) {
    if (group.members.length >= 2 && tryMergeGroup(group, role, internal, external, perimeter, options)) {
      logs.push({ content: group.content, role, size: group.members.length, mode: 'trunk' });
    } else {
      // 단독 그룹 또는 트렁크 실패 → 1:1.
      for (const m of group.members) leftover.push(m.connection);
      if (AUTO_LAYOUT_COORD_DUMP && group.members.length >= 2) {
        logs.push({ content: group.content, role, size: group.members.length, mode: 'fallback-1:1' });
      }
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
): boolean {
  const repChestId = role === 'input' ? group.members[0].connection.producerId : group.members[0].connection.consumerId;
  const chest = external.containers.find((c) => c.id === repChestId);
  if (!chest) return false;

  const machineIdOf = (c: MergeCandidate) =>
    role === 'input' ? c.connection.consumerId : c.connection.producerId;

  const machines: MachineLike[] = [];
  for (const m of group.members) {
    const mc = internal.containers.find((c) => c.id === machineIdOf(m));
    if (!mc) return false;
    machines.push({ id: mc.id, origin: { ...mc.origin }, size: { ...mc.size } });
  }

  const occupancy = buildOccupancy(internal, external);
  const result = computeTrunkPath({
    machines,
    occupancy,
    chestCandidates: perimeter,
    config: { allowLongInserter: false }, // v1: reach-1 only
  });
  // v1 "무조건 성공" 가정 — 일부라도 직접 탭 안 되면 통째로 1:1 폴백.
  if (!result.ok || result.path.untapped.length > 0) return false;

  const emission = emitTrunk(result.path, {
    chestId: chest.id,
    beltEntityName: options.beltEntityName,
    inserterEntityName: options.inserterEntityName,
    longInserterEntityName: options.inserterEntityName, // reach-1 only → 미사용
    mode: role === 'input' ? 'supply' : 'collect',
  });

  // commit — 트렁크 belt·인서터는 internal, 대표 상자는 external.
  for (const c of emission.beltCells) internal.placed.push(c);
  if (emission.feeder) internal.placed.push(emission.feeder);
  for (const t of emission.taps) internal.placed.push(t.inserter);

  chest.origin = { ...result.path.chestCell };
  external.placed.push(makeContainerCell(chest, result.path.chestCell));

  // 흡수된 나머지 상자 제거 (아직 배치 전이라 containers 에서만).
  const dropIds = group.members
    .map((m) => (role === 'input' ? m.connection.producerId : m.connection.consumerId))
    .filter((id) => id !== repChestId);
  if (dropIds.length > 0) {
    const drop = new Set(dropIds);
    external.containers = external.containers.filter((c) => !drop.has(c.id));
    internal.containers = internal.containers.filter((c) => !drop.has(c.id));
  }
  return true;
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
  return { connection: conn, content: chest.content, demand, pos: { ...machine.origin } };
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
  return { connection: conn, content: chest.content, demand, pos: { ...machine.origin } };
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
  return (speed / recipe.energy_required) * prod.amount * (prod.probability ?? 1);
}
