import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useGameDataStore } from '../store/gameDataStore';
import type {
  Area,
  Container,
  ContainerPort,
  PortKind,
  Routing,
  RoutingAttempt,
} from '../utils/autoLayout/containerModel';
import type { RecipeTreeNode } from '../utils/autoLayout/types';
import {
  expandRecipeTree,
  assignMinimumCounts,
} from '../utils/autoLayout/recipeTree';
import { computeContainerCounts } from '../utils/autoLayout/containerCounts';
import {
  placeMachine,
  placeRootMachine,
} from '../utils/autoLayout/machinePlacer';
import { placeExternalContainer } from '../utils/autoLayout/externalPlacer';
import {
  enumerateContainerPorts,
  resolvePortPair,
} from '../utils/autoLayout/portInference';
import { commitRouting } from '../utils/autoLayout/containerRouting';
import {
  routeWithFallback,
  type RouteOptions,
} from '../utils/autoLayout/routeFallback';
import {
  wrapExternalsAroundPerimeter,
  cloneArea,
  cloneRouting,
} from '../utils/autoLayout/areaUnification';
import { beltLaneThroughput } from '../utils/autoLayout/inserterThroughput';
import { EntityType } from '../types/layout';
import type { Direction, GridCell } from '../types/layout';

interface Props {
  targetRecipe: string;
  externalIngredients: Set<string>;
  selectedMachines: Set<string>;
  selectedInserters: Set<string>;
  selectedBelts: Set<string>;
  selectedUndergroundPipes: Set<string>;
  /** 외부에서 끌어올린 playground 상태 — 모달 옆 그리드 패널과 공유 */
  playground: Playground;
  setPlayground: (next: Playground) => void;
  setHighlightCells: (next: Set<string>) => void;
  /** enumerateContainerPorts 결과 시각화 setter — 값은 GridPanel 가 별도로 읽음 */
  setPortOverlay: (next: ContainerPort[]) => void;
  /** 각 함수 카드 결과 — 히스토리 패널과 함께 공유 */
  results: Record<string, RunResult>;
  setResults: (next: Record<string, RunResult>) => void;
  /** 실행 직전 스냅샷 push — 모달에서 정의해 두면 히스토리 패널과 동일 history 공유 */
  pushHistory: (label: string) => void;
  /** 전체 디버그 세션 초기화 — playground/history/results 모두 비움 */
  resetAll: () => void;
}

export interface Playground {
  internal: Area;
  external: Area;
  routings: Routing[];
  pendingRoutings: Routing[]; // routeWithFallback 결과 — commitRouting 대기 중
}

interface CellKey {
  x: number;
  y: number;
  entityName: string;
}

interface GridDiff {
  before: number;
  after: number;
  added: CellKey[];
  removed: CellKey[];
}

export interface RunResult {
  ok: boolean;
  summary: string;
  detail?: unknown;
  diff?: GridDiff;
}

/** 실행 직전 상태 스냅샷 — undo 시 복원 단위 */
export interface HistoryEntry {
  id: number;
  label: string;
  playground: Playground;
  highlightCells: Set<string>;
  results: Record<string, RunResult>;
  portOverlay: ContainerPort[];
}

export const PIPE_PER_SEC = 100; // 1차 구현 fluid 처리량 상수
export const HISTORY_CAP = 50;
let containerSeqCounter = 0;
const nextContainerSeq = () => {
  containerSeqCounter += 1;
  return containerSeqCounter;
};

export function emptyPlayground(): Playground {
  return {
    internal: { kind: 'internal', containers: [], placed: [] },
    external: { kind: 'external', containers: [], placed: [] },
    routings: [],
    pendingRoutings: [],
  };
}

export function clonePlayground(pg: Playground): Playground {
  return {
    internal: cloneArea(pg.internal),
    external: cloneArea(pg.external),
    routings: pg.routings.map(cloneRouting),
    pendingRoutings: pg.pendingRoutings.map(cloneRouting),
  };
}

function snapshotPlaced(area: Area): Map<string, CellKey> {
  const map = new Map<string, CellKey>();
  for (const p of area.placed) {
    map.set(`${p.x},${p.y}`, { x: p.x, y: p.y, entityName: p.cell.entityName ?? '' });
  }
  return map;
}

function diffAreas(beforeI: Area, afterI: Area, beforeE: Area, afterE: Area): GridDiff {
  const before = snapshotPlaced(beforeI);
  for (const [k, v] of snapshotPlaced(beforeE)) before.set(k, v);
  const after = snapshotPlaced(afterI);
  for (const [k, v] of snapshotPlaced(afterE)) after.set(k, v);

  const added: CellKey[] = [];
  const removed: CellKey[] = [];
  for (const [k, v] of after) if (!before.has(k)) added.push(v);
  for (const [k, v] of before) if (!after.has(k)) removed.push(v);
  return { before: before.size, after: after.size, added, removed };
}

export default function AutoLayoutDebugTab(props: Props) {
  const {
    targetRecipe,
    externalIngredients,
    selectedMachines,
    selectedInserters,
    selectedBelts,
    playground,
    setPlayground,
    setHighlightCells,
    setPortOverlay,
    results,
    setResults,
    pushHistory,
    resetAll,
  } = props;

  const { recipeMap, itemToRecipe, entityMap } = useGameDataStore(
    useShallow((s) => ({
      recipeMap: s.recipeMap,
      itemToRecipe: s.itemToRecipe,
      entityMap: s.entityMap,
    })),
  );

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const allContainers = useMemo(
    () => [
      ...playground.internal.containers,
      ...playground.external.containers.filter(
        (c) => !playground.internal.containers.some((ic) => ic.id === c.id),
      ),
    ],
    [playground],
  );

  // ── 시드 헬퍼 ──────────────────────────────────────────────────────
  const firstMachineName = useMemo(
    () => Array.from(selectedMachines)[0],
    [selectedMachines],
  );
  const firstInserterName = useMemo(
    () => Array.from(selectedInserters)[0],
    [selectedInserters],
  );
  const firstBeltName = useMemo(
    () => Array.from(selectedBelts)[0],
    [selectedBelts],
  );

  const routeOptions: RouteOptions = useMemo(
    () => ({
      beltEntityName: firstBeltName ?? 'transport-belt',
      inserterEntityName: firstInserterName ?? 'inserter',
      pipeEntityName: 'pipe',
      preferUnderground: false,
    }),
    [firstBeltName, firstInserterName],
  );

  const beltThroughput = useMemo(() => {
    const e = firstBeltName ? entityMap.get(firstBeltName) : undefined;
    return beltLaneThroughput(e);
  }, [firstBeltName, entityMap]);

  // ── 전처리 함수 결과 — 입력만 정해지면 자동 도출되는 순수 변환 ──────
  const tree: RecipeTreeNode | null = useMemo(() => {
    if (!targetRecipe) return null;
    return assignMinimumCounts(
      expandRecipeTree(targetRecipe, recipeMap, itemToRecipe, externalIngredients),
    );
  }, [targetRecipe, recipeMap, itemToRecipe, externalIngredients]);

  const containerCounts = useMemo(() => {
    if (!targetRecipe || !firstMachineName || beltThroughput <= 0) return null;
    return computeContainerCounts(
      targetRecipe,
      firstMachineName,
      beltThroughput,
      PIPE_PER_SEC,
    );
  }, [targetRecipe, firstMachineName, beltThroughput]);

  function setResult(id: string, r: RunResult) {
    setResults({ ...results, [id]: r });
    setExpanded((prev) => ({ ...prev, [id]: true }));
  }

  // ── 함수 실행 헬퍼 — playground 클론 → run → diff 측정 ─────────────
  function runWithDiff(
    id: string,
    body: (pg: Playground) => { ok: boolean; summary: string; detail?: unknown } | RunResult,
  ) {
    pushHistory(id);
    const beforeInternal = cloneArea(playground.internal);
    const beforeExternal = cloneArea(playground.external);
    const next: Playground = {
      internal: cloneArea(playground.internal),
      external: cloneArea(playground.external),
      routings: [...playground.routings],
      pendingRoutings: [...playground.pendingRoutings],
    };
    try {
      const r = body(next);
      const diff = diffAreas(beforeInternal, next.internal, beforeExternal, next.external);
      setPlayground(next);
      setResult(id, { ok: r.ok, summary: r.summary, detail: r.detail, diff });
      setHighlightCells(new Set(diff.added.map((c) => `${c.x},${c.y}`)));
    } catch (e: unknown) {
      setResult(id, {
        ok: false,
        summary: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ── 1) placeRootMachine ──────────────────────────────────────────
  const canPlaceRoot = !!targetRecipe && !!firstMachineName && !!tree?.recipeName;
  function runPlaceRoot() {
    if (!canPlaceRoot) return;
    runWithDiff('placeRootMachine', (pg) => {
      const root = makeMachineContainer(tree!, firstMachineName!, entityMap);
      const placed = placeRootMachine(root, pg.internal);
      if (!placed) return { ok: false, summary: 'placement collision' };
      return {
        ok: true,
        summary: `루트 머신 배치 @ (${placed.origin.x},${placed.origin.y}), 크기 ${placed.size.w}×${placed.size.h}`,
        detail: containerSummary(placed),
      };
    });
  }

  // ── 2) placeExternalContainer ─────────────────────────────────────
  const externalIngredientsList = useMemo(() => {
    if (!tree) return [] as { name: string; type: 'item' | 'fluid' }[];
    const recipe = tree.recipeName ? recipeMap.get(tree.recipeName) : undefined;
    if (!recipe) return [];
    return recipe.ingredients
      .filter((ing) => externalIngredients.has(ing.name))
      .map((ing) => ({ name: ing.name, type: ing.type as 'item' | 'fluid' }));
  }, [tree, recipeMap, externalIngredients]);

  const [extIngredientIdx, setExtIngredientIdx] = useState(0);
  const canPlaceExternal =
    playground.internal.containers.some((c) => c.kind === 'machine') &&
    externalIngredientsList.length > 0;

  function runPlaceExternal() {
    if (!canPlaceExternal) return;
    runWithDiff('placeExternalContainer', (pg) => {
      const ing = externalIngredientsList[Math.min(extIngredientIdx, externalIngredientsList.length - 1)];
      const near = pg.internal.containers.find((c) => c.kind === 'machine');
      const chest = placeExternalContainer(
        {
          kind: ing.type === 'fluid' ? 'infinity-pipe' : 'infinity-chest',
          entityName: ing.type === 'fluid' ? 'infinity-pipe' : 'infinity-chest',
          content: ing.name,
        },
        pg.external,
        pg.internal,
        near,
      );
      return {
        ok: true,
        summary: `${ing.name} 컨테이너 ${chest.id} @ (${chest.origin.x},${chest.origin.y})`,
        detail: containerSummary(chest),
      };
    });
  }

  // ── 3) enumerateContainerPorts ────────────────────────────────────
  const [portContainerId, setPortContainerId] = useState<string>('');
  const [portKindStr, setPortKindStr] = useState<string>('item');
  const canEnumeratePorts = allContainers.length > 0;
  function runEnumeratePorts() {
    if (!canEnumeratePorts) return;
    pushHistory('enumerateContainerPorts');
    const c = allContainers.find((x) => x.id === portContainerId) ?? allContainers[0];
    const kind: PortKind = portKindStr === 'item' ? 'item' : { fluid: portKindStr.replace(/^fluid:/, '') };
    const ports = enumerateContainerPorts(c, kind);
    setPortOverlay(ports);
    setResult('enumerateContainerPorts', {
      ok: true,
      summary: `${c.id}: ${ports.length}개 port`,
      detail: ports.map((p) => ({ face: p.face, cell: p.cell, kind: p.kind })),
    });
  }

  // ── 4) resolvePortPair ────────────────────────────────────────────
  const [producerId, setProducerId] = useState<string>('');
  const [consumerId, setConsumerId] = useState<string>('');
  const [pairKindStr, setPairKindStr] = useState<string>('item');
  const canResolvePair =
    allContainers.length >= 2 && producerId !== consumerId;
  function runResolvePair() {
    if (!canResolvePair) return;
    pushHistory('resolvePortPair');
    const p = allContainers.find((x) => x.id === producerId) ?? allContainers[0];
    const c = allContainers.find((x) => x.id === consumerId) ?? allContainers[1];
    const kind: PortKind = pairKindStr === 'item' ? 'item' : { fluid: pairKindStr.replace(/^fluid:/, '') };
    const pair = resolvePortPair(p, c, kind);
    setResult('resolvePortPair', {
      ok: !!pair,
      summary: pair
        ? `${p.id}(${pair.producer.face}) → ${c.id}(${pair.consumer.face})`
        : '매칭 실패 — kind 불일치 또는 face 후보 없음',
      detail: pair,
    });
  }

  // ── 5) routeWithFallback ──────────────────────────────────────────
  const [routeProducerId, setRouteProducerId] = useState<string>('');
  const [routeConsumerId, setRouteConsumerId] = useState<string>('');
  const [routeKindStr, setRouteKindStr] = useState<string>('item');
  const canRoute =
    allContainers.length >= 2 && routeProducerId !== routeConsumerId;
  function runRoute() {
    if (!canRoute) return;
    runWithDiff('routeWithFallback', (pg) => {
      const p = findContainer(pg, routeProducerId) ?? pg.internal.containers[0];
      const c = findContainer(pg, routeConsumerId) ?? pg.internal.containers[1];
      const kind: PortKind = routeKindStr === 'item' ? 'item' : { fluid: routeKindStr.replace(/^fluid:/, '') };
      const attempt: RoutingAttempt = routeWithFallback(p, c, kind, pg.internal, routeOptions);
      if (!attempt.ok) {
        return {
          ok: false,
          summary: `라우팅 실패: ${attempt.reason}, ${attempt.tried.length} port 조합 시도`,
          detail: attempt,
        };
      }
      pg.pendingRoutings.push(attempt.routing);
      return {
        ok: true,
        summary: `라우팅 ${attempt.routing.id} 생성 (${attempt.routing.placed.length} 셀) — commitRouting 대기`,
        detail: {
          id: attempt.routing.id,
          kind: attempt.routing.kind,
          from: attempt.routing.from.cell,
          to: attempt.routing.to.cell,
          cells: attempt.routing.placed.map((cell) => ({
            x: cell.x,
            y: cell.y,
            entityName: cell.cell.entityName ?? '',
          })),
        },
      };
    });
  }

  // ── 6) commitRouting ──────────────────────────────────────────────
  const [commitIdx, setCommitIdx] = useState(0);
  const canCommit = playground.pendingRoutings.length > 0;
  function runCommit() {
    if (!canCommit) return;
    runWithDiff('commitRouting', (pg) => {
      const idx = Math.min(commitIdx, pg.pendingRoutings.length - 1);
      const routing = pg.pendingRoutings[idx];
      commitRouting(routing, pg.internal);
      pg.pendingRoutings.splice(idx, 1);
      pg.routings.push(routing);
      return {
        ok: true,
        summary: `${routing.id} commit — ${routing.placed.length} 셀 추가`,
        detail: { id: routing.id, cellCount: routing.placed.length },
      };
    });
  }

  // ── 7) placeMachine ───────────────────────────────────────────────
  const machineContainers = useMemo(
    () => playground.internal.containers.filter((c) => c.kind === 'machine'),
    [playground.internal.containers],
  );
  const childCandidates = useMemo(() => {
    if (!tree) return [] as RecipeTreeNode[];
    return tree.children.filter((c) => !c.external && c.recipeName);
  }, [tree]);
  const [parentId, setParentId] = useState<string>('');
  const [childIdx, setChildIdx] = useState(0);
  const [childDir, setChildDir] = useState<'right' | 'down'>('right');
  const canPlaceMachine =
    !!firstMachineName && machineContainers.length > 0 && childCandidates.length > 0;
  function runPlaceMachine() {
    if (!canPlaceMachine) return;
    runWithDiff('placeMachine', (pg) => {
      const parent =
        pg.internal.containers.find((c) => c.id === parentId) ?? machineContainers[0];
      const child = childCandidates[Math.min(childIdx, childCandidates.length - 1)];
      const childContainer = makeMachineContainer(child, firstMachineName!, entityMap);
      const placed = placeMachine(parent, childContainer, childDir, pg.internal);
      if (!placed) return { ok: false, summary: '배치 충돌' };
      return {
        ok: true,
        summary: `${placed.id} @ (${placed.origin.x},${placed.origin.y}), dir=${childDir}`,
        detail: containerSummary(placed),
      };
    });
  }

  // ── 8) wrapExternalsAroundPerimeter ─────────────────────────────
  const canWrap = playground.external.containers.length > 0;
  function runWrap() {
    if (!canWrap) return;
    runWithDiff('wrapExternalsAroundPerimeter', (pg) => {
      const stats = wrapExternalsAroundPerimeter(
        pg.internal,
        pg.external,
        pg.routings,
        routeOptions,
      );
      return {
        ok: true,
        summary: `relocated ${stats.relocated}, skipped ${stats.skipped}, failed ${stats.failed}`,
        detail: stats,
      };
    });
  }

  // ── 렌더 ──────────────────────────────────────────────────────────
  const seedReady = !!targetRecipe && selectedMachines.size > 0;

  return (
    <div className="space-y-3">
      <SeedSummary
        targetRecipe={targetRecipe}
        externalIngredients={externalIngredients}
        machine={firstMachineName}
        inserter={firstInserterName}
        belt={firstBeltName}
        beltThroughput={beltThroughput}
        seedReady={seedReady}
      />

      <PlaygroundState
        playground={playground}
        onReset={resetAll}
        tree={tree}
        containerCounts={containerCounts}
      />

      <div className="space-y-2">
        <FunctionCard
          n={1}
          name="placeRootMachine"
          desc="트리 루트 머신을 internal (5,5) 에 배치"
          can={canPlaceRoot}
          reason={
            !tree
              ? '1번 expandRecipeTree 먼저 실행'
              : !firstMachineName
              ? '머신 미선택'
              : !tree.recipeName
              ? '트리 루트가 외부'
              : ''
          }
          expanded={expanded.placeRootMachine}
          onToggle={() => setExpanded((p) => ({ ...p, placeRootMachine: !p.placeRootMachine }))}
          result={results.placeRootMachine}
          inputs={
            <>
              <Param label="machine" value={tree?.recipeName ?? '—'} />
              <Param label="entityName" value={firstMachineName ?? '—'} />
              <Param label="internal" value={`containers=${playground.internal.containers.length}, placed=${playground.internal.placed.length}`} />
            </>
          }
          onRun={runPlaceRoot}
        />

        <FunctionCard
          n={2}
          name="placeExternalContainer"
          desc="외부 ingredient → infinity-chest/pipe 임시 자리 배치"
          can={canPlaceExternal}
          reason={
            externalIngredientsList.length === 0
              ? '외부 ingredient 없음 (트리에서 external 토글 필요)'
              : machineContainers.length === 0
              ? '3번 placeRootMachine 먼저 실행'
              : ''
          }
          expanded={expanded.placeExternalContainer}
          onToggle={() => setExpanded((p) => ({ ...p, placeExternalContainer: !p.placeExternalContainer }))}
          result={results.placeExternalContainer}
          inputs={
            <>
              <ParamSelect
                label="ingredient"
                value={String(extIngredientIdx)}
                onChange={(v) => setExtIngredientIdx(Number(v))}
                options={externalIngredientsList.map((ing, i) => ({
                  value: String(i),
                  label: `${ing.name} (${ing.type})`,
                }))}
              />
              <Param label="near machine" value={machineContainers[0]?.id ?? '—'} />
            </>
          }
          onRun={runPlaceExternal}
        />

        <FunctionCard
          n={3}
          name="enumerateContainerPorts"
          desc="한 컨테이너의 모든 port 후보 (item: 둘레 / fluid: positions)"
          can={canEnumeratePorts}
          reason={canEnumeratePorts ? '' : '컨테이너 없음 (3 또는 4 먼저 실행)'}
          expanded={expanded.enumerateContainerPorts}
          onToggle={() => setExpanded((p) => ({ ...p, enumerateContainerPorts: !p.enumerateContainerPorts }))}
          result={results.enumerateContainerPorts}
          inputs={
            <>
              <ParamSelect
                label="container"
                value={portContainerId || allContainers[0]?.id || ''}
                onChange={setPortContainerId}
                options={allContainers.map((c) => ({ value: c.id, label: c.id }))}
              />
              <ParamSelect
                label="kind"
                value={portKindStr}
                onChange={setPortKindStr}
                options={portKindOptions(allContainers, portContainerId, recipeMap)}
              />
            </>
          }
          onRun={runEnumeratePorts}
        />

        <FunctionCard
          n={4}
          name="resolvePortPair"
          desc="두 컨테이너 그리디 port 매칭 (가장 가까운 면)"
          can={canResolvePair}
          reason={
            allContainers.length < 2
              ? '컨테이너 2개 이상 필요'
              : producerId === consumerId
              ? 'producer/consumer 가 같음'
              : ''
          }
          expanded={expanded.resolvePortPair}
          onToggle={() => setExpanded((p) => ({ ...p, resolvePortPair: !p.resolvePortPair }))}
          result={results.resolvePortPair}
          inputs={
            <>
              <ParamSelect
                label="producer"
                value={producerId || allContainers[0]?.id || ''}
                onChange={setProducerId}
                options={allContainers.map((c) => ({ value: c.id, label: c.id }))}
              />
              <ParamSelect
                label="consumer"
                value={consumerId || allContainers[1]?.id || ''}
                onChange={setConsumerId}
                options={allContainers.map((c) => ({ value: c.id, label: c.id }))}
              />
              <ParamSelect
                label="kind"
                value={pairKindStr}
                onChange={setPairKindStr}
                options={portKindOptions(allContainers, producerId, recipeMap)}
              />
            </>
          }
          onRun={runResolvePair}
        />

        <FunctionCard
          n={5}
          name="routeWithFallback"
          desc="port pair 그리디 → 실패시 모든 조합 manhattan 순. 결과는 pending"
          can={canRoute}
          reason={
            allContainers.length < 2
              ? '컨테이너 2개 이상 필요'
              : routeProducerId === routeConsumerId
              ? 'producer/consumer 가 같음'
              : ''
          }
          expanded={expanded.routeWithFallback}
          onToggle={() => setExpanded((p) => ({ ...p, routeWithFallback: !p.routeWithFallback }))}
          result={results.routeWithFallback}
          inputs={
            <>
              <ParamSelect
                label="producer"
                value={routeProducerId || allContainers[0]?.id || ''}
                onChange={setRouteProducerId}
                options={allContainers.map((c) => ({ value: c.id, label: c.id }))}
              />
              <ParamSelect
                label="consumer"
                value={routeConsumerId || allContainers[1]?.id || ''}
                onChange={setRouteConsumerId}
                options={allContainers.map((c) => ({ value: c.id, label: c.id }))}
              />
              <ParamSelect
                label="kind"
                value={routeKindStr}
                onChange={setRouteKindStr}
                options={portKindOptions(allContainers, routeProducerId, recipeMap)}
              />
              <Param label="options.belt" value={routeOptions.beltEntityName} />
              <Param label="options.inserter" value={routeOptions.inserterEntityName} />
              <Param label="options.pipe" value={routeOptions.pipeEntityName} />
            </>
          }
          onRun={runRoute}
        />

        <FunctionCard
          n={6}
          name="commitRouting"
          desc="pending 라우팅을 internal 에 commit (placed mutate)"
          can={canCommit}
          reason={canCommit ? '' : 'pending 라우팅 없음 (7번 먼저 성공)'}
          expanded={expanded.commitRouting}
          onToggle={() => setExpanded((p) => ({ ...p, commitRouting: !p.commitRouting }))}
          result={results.commitRouting}
          inputs={
            <>
              <ParamSelect
                label="routing"
                value={String(commitIdx)}
                onChange={(v) => setCommitIdx(Number(v))}
                options={playground.pendingRoutings.map((r, i) => ({
                  value: String(i),
                  label: `${r.id} (${r.placed.length} 셀)`,
                }))}
              />
            </>
          }
          onRun={runCommit}
        />

        <FunctionCard
          n={7}
          name="placeMachine"
          desc="자식 머신을 부모 옆 (right/down) 에 배치"
          can={canPlaceMachine}
          reason={
            !firstMachineName
              ? '머신 미선택'
              : machineContainers.length === 0
              ? '3번 placeRootMachine 먼저 실행'
              : childCandidates.length === 0
              ? '트리에 비-외부 자식 없음'
              : ''
          }
          expanded={expanded.placeMachine}
          onToggle={() => setExpanded((p) => ({ ...p, placeMachine: !p.placeMachine }))}
          result={results.placeMachine}
          inputs={
            <>
              <ParamSelect
                label="parent"
                value={parentId || machineContainers[0]?.id || ''}
                onChange={setParentId}
                options={machineContainers.map((c) => ({ value: c.id, label: c.id }))}
              />
              <ParamSelect
                label="child recipe"
                value={String(childIdx)}
                onChange={(v) => setChildIdx(Number(v))}
                options={childCandidates.map((c, i) => ({
                  value: String(i),
                  label: c.recipeName ?? c.itemName,
                }))}
              />
              <ParamSelect
                label="dir"
                value={childDir}
                onChange={(v) => setChildDir(v as 'right' | 'down')}
                options={[
                  { value: 'right', label: 'right' },
                  { value: 'down', label: 'down' },
                ]}
              />
            </>
          }
          onRun={runPlaceMachine}
        />

        <FunctionCard
          n={8}
          name="wrapExternalsAroundPerimeter"
          desc="후처리 — chest 들을 internal bbox perimeter ring 으로 재배치"
          can={canWrap}
          reason={canWrap ? '' : 'external 컨테이너 없음 (4번 먼저 실행)'}
          expanded={expanded.wrapExternalsAroundPerimeter}
          onToggle={() => setExpanded((p) => ({ ...p, wrapExternalsAroundPerimeter: !p.wrapExternalsAroundPerimeter }))}
          result={results.wrapExternalsAroundPerimeter}
          inputs={
            <>
              <Param label="internal containers" value={String(playground.internal.containers.length)} />
              <Param label="external containers" value={String(playground.external.containers.length)} />
              <Param label="routings" value={String(playground.routings.length)} />
            </>
          }
          onRun={runWrap}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 보조 컴포넌트
// ─────────────────────────────────────────────────────────────────────

function SeedSummary(props: {
  targetRecipe: string;
  externalIngredients: Set<string>;
  machine?: string;
  inserter?: string;
  belt?: string;
  beltThroughput: number;
  seedReady: boolean;
}) {
  return (
    <div className="bg-gray-800/40 border border-gray-700 rounded p-2 text-[11px] text-gray-300">
      <div className="font-mono flex flex-wrap gap-x-4 gap-y-0.5">
        <span><span className="text-gray-500">recipe:</span> {props.targetRecipe || '—'}</span>
        <span><span className="text-gray-500">machine:</span> {props.machine ?? '—'}</span>
        <span><span className="text-gray-500">inserter:</span> {props.inserter ?? '—'}</span>
        <span><span className="text-gray-500">belt:</span> {props.belt ?? '—'} ({props.beltThroughput.toFixed(1)}/s)</span>
        <span><span className="text-gray-500">external:</span> {props.externalIngredients.size}</span>
      </div>
      {!props.seedReady && (
        <div className="text-amber-400 mt-1">
          ⚠ 위저드 1~2 단계 (레시피 + 머신) 까지 채워야 대부분의 함수가 활성화됩니다.
        </div>
      )}
    </div>
  );
}

function PlaygroundState(props: {
  playground: Playground;
  onReset: () => void;
  tree: RecipeTreeNode | null;
  containerCounts: { inputContainers: Record<string, number>; outputContainers: Record<string, number> } | null;
}) {
  const { internal, external, routings, pendingRoutings } = props.playground;
  const stateSummary = {
    internal: {
      containers: internal.containers.length,
      placed: internal.placed.length,
      bbox: internal.bbox ?? null,
    },
    external: {
      containers: external.containers.length,
    },
    routings: routings.length,
    pendingRoutings: pendingRoutings.length,
  };
  const treeNodes = props.tree ? countTreeNodes(props.tree) : 0;
  const countsCount = props.containerCounts
    ? Object.keys(props.containerCounts.inputContainers).length +
      Object.keys(props.containerCounts.outputContainers).length
    : 0;
  return (
    <div className="bg-gray-900/60 border border-gray-700 rounded p-2 text-[11px]">
      <div className="flex items-center justify-between mb-1 gap-2">
        <span className="text-gray-400 uppercase tracking-wider text-[10px] shrink-0">Playground 상태</span>
        <button
          onClick={props.onReset}
          className="text-[10px] text-gray-500 hover:text-red-400 border border-gray-700 hover:border-red-700 rounded px-2 py-0.5"
        >
          초기화
        </button>
      </div>
      <JsonTree value={stateSummary} />

      <div className="mt-2 pt-2 border-t border-gray-800 space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-gray-500">전처리 함수 결과</div>
        <details className="text-[10px] text-gray-300">
          <summary className="cursor-pointer select-none hover:text-white">
            <span className="font-mono text-green-300">expandRecipeTree</span>{' '}
            <span className="text-gray-500">— {props.tree ? `${treeNodes}개 노드` : '레시피 미선택'}</span>
          </summary>
          <div className="mt-1">
            {props.tree ? <JsonTree value={simplifyTree(props.tree)} /> : <span className="text-gray-500">null</span>}
          </div>
        </details>
        <details className="text-[10px] text-gray-300">
          <summary className="cursor-pointer select-none hover:text-white">
            <span className="font-mono text-green-300">computeContainerCounts</span>{' '}
            <span className="text-gray-500">— {props.containerCounts ? `${countsCount}개 항목` : '입력 부족 (레시피·머신·벨트)'}</span>
          </summary>
          <div className="mt-1">
            {props.containerCounts ? <JsonTree value={props.containerCounts} /> : <span className="text-gray-500">null</span>}
          </div>
        </details>
      </div>
    </div>
  );
}

function countTreeNodes(node: RecipeTreeNode): number {
  let n = 1;
  for (const c of node.children) n += countTreeNodes(c);
  return n;
}

// ─────────────────────────────────────────────────────────────────────
// JsonTree — 객체/배열 노드마다 토글로 접고 펼 수 있는 JSON 뷰
// ─────────────────────────────────────────────────────────────────────

function JsonTree({ value }: { value: unknown }) {
  return (
    <div className="font-mono text-[10px] text-gray-200 bg-gray-950 rounded p-2 overflow-auto max-h-64 leading-snug">
      <JsonNode value={value} />
    </div>
  );
}

function JsonNode({ value }: { value: unknown }) {
  if (value === null) return <span className="text-gray-500">null</span>;
  if (value === undefined) return <span className="text-gray-500">undefined</span>;
  if (typeof value === 'string') return <span className="text-emerald-300">"{value}"</span>;
  if (typeof value === 'number') return <span className="text-amber-300">{value}</span>;
  if (typeof value === 'boolean') return <span className="text-purple-300">{String(value)}</span>;
  if (Array.isArray(value)) return <JsonArrayNode items={value} />;
  if (typeof value === 'object') return <JsonObjectNode obj={value as Record<string, unknown>} />;
  return <span>{String(value)}</span>;
}

function JsonArrayNode({ items }: { items: unknown[] }) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return <span>[]</span>;
  if (!open) {
    return (
      <span>
        <JsonToggle open={false} onClick={() => setOpen(true)} />
        [<span className="text-gray-500"> … {items.length}개 </span>]
      </span>
    );
  }
  return (
    <>
      <JsonToggle open onClick={() => setOpen(false)} />
      [
      <div className="pl-3 border-l border-gray-800/50 ml-1">
        {items.map((item, i) => (
          <div key={i}>
            <JsonNode value={item} />
            {i < items.length - 1 && <span className="text-gray-500">,</span>}
          </div>
        ))}
      </div>
      ]
    </>
  );
}

function JsonObjectNode({ obj }: { obj: Record<string, unknown> }) {
  const [open, setOpen] = useState(true);
  const entries = Object.entries(obj);
  if (entries.length === 0) return <span>{'{}'}</span>;
  if (!open) {
    return (
      <span>
        <JsonToggle open={false} onClick={() => setOpen(true)} />
        {'{'}
        <span className="text-gray-500"> … {entries.length}개 </span>
        {'}'}
      </span>
    );
  }
  return (
    <>
      <JsonToggle open onClick={() => setOpen(false)} />
      {'{'}
      <div className="pl-3 border-l border-gray-800/50 ml-1">
        {entries.map(([k, v], i) => (
          <div key={k}>
            <span className="text-cyan-300">"{k}"</span>
            <span className="text-gray-500">: </span>
            <JsonNode value={v} />
            {i < entries.length - 1 && <span className="text-gray-500">,</span>}
          </div>
        ))}
      </div>
      {'}'}
    </>
  );
}

function JsonToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-gray-500 hover:text-white mr-0.5 cursor-pointer"
    >
      {open ? '▾' : '▸'}
    </button>
  );
}

interface FunctionCardProps {
  n: number;
  name: string;
  desc: string;
  can: boolean;
  reason: string;
  expanded?: boolean;
  onToggle: () => void;
  inputs: React.ReactNode;
  result?: RunResult;
  onRun: () => void;
}

function FunctionCard(props: FunctionCardProps) {
  const dot = props.can ? 'bg-green-500' : 'bg-red-500';
  const nameColor = props.can ? 'text-green-300' : 'text-red-300';

  function handleHeaderClick() {
    // 드래그로 텍스트 선택했으면 토글 무시 — 복사 동작 보호
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    props.onToggle();
  }

  return (
    <div className="border border-gray-700 rounded bg-gray-800/30">
      <button
        type="button"
        onClick={handleHeaderClick}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-gray-800/60"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span className="text-gray-500 text-[10px] w-5">{props.n}.</span>
        <span
          className={`font-mono text-xs select-text ${nameColor}`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {props.name}
        </span>
        <span className="text-[10px] text-gray-500 ml-2 truncate">{props.desc}</span>
        {!props.can && (
          <span className="text-[10px] text-red-400 ml-auto shrink-0">{props.reason}</span>
        )}
        <span className="text-gray-600 text-[10px]">{props.expanded ? '▾' : '▸'}</span>
      </button>
      {props.expanded && (
        <div className="px-3 py-2 border-t border-gray-700 space-y-2">
          <div className="space-y-1">{props.inputs}</div>
          <div className="flex justify-end">
            <button
              disabled={!props.can}
              onClick={props.onRun}
              className={`text-xs px-3 py-1 rounded font-semibold ${
                props.can
                  ? 'bg-green-600 hover:bg-green-500 text-white'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              실행
            </button>
          </div>
          {props.result && <ResultPanel result={props.result} />}
        </div>
      )}
    </div>
  );
}

function Param({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-gray-500 font-mono w-44 shrink-0">{label}</span>
      <span className="text-gray-200 font-mono truncate">{value}</span>
    </div>
  );
}

function ParamSelect(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-gray-500 font-mono w-44 shrink-0">{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 flex-1 min-w-0"
      >
        {props.options.length === 0 && <option value="">—</option>}
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ResultPanel({ result }: { result: RunResult }) {
  return (
    <div className={`border rounded p-2 text-[11px] ${result.ok ? 'border-green-700 bg-green-900/10' : 'border-red-700 bg-red-900/10'}`}>
      <div className={`font-semibold ${result.ok ? 'text-green-300' : 'text-red-300'}`}>
        {result.ok ? '✓' : '✗'} {result.summary}
      </div>
      {result.diff && (
        <div className="mt-1 text-gray-400 font-mono text-[10px]">
          그리드: {result.diff.before} → {result.diff.after}
          {result.diff.added.length > 0 && (
            <span className="text-green-400"> (+{result.diff.added.length})</span>
          )}
          {result.diff.removed.length > 0 && (
            <span className="text-red-400"> (-{result.diff.removed.length})</span>
          )}
          {result.diff.added.length > 0 && (
            <details className="mt-0.5">
              <summary className="cursor-pointer text-gray-500">+ 추가된 셀</summary>
              <ul className="pl-3 max-h-32 overflow-y-auto">
                {result.diff.added.map((c, i) => (
                  <li key={i}>({c.x},{c.y}) {c.entityName}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {result.detail !== undefined && (
        <details className="mt-1">
          <summary className="cursor-pointer text-gray-500 text-[10px]">detail JSON</summary>
          <pre className="text-[10px] text-gray-300 max-h-48 overflow-auto bg-gray-950 p-1 rounded mt-0.5">
            {JSON.stringify(result.detail, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────

function makeMachineContainer(
  node: RecipeTreeNode,
  entityName: string,
  entityMap: Map<string, { tile_width?: number; tile_height?: number }>,
): Container {
  const entity = entityMap.get(entityName);
  const w = entity?.tile_width ?? 3;
  const h = entity?.tile_height ?? 3;
  return {
    id: `dbg-m-${node.recipeName ?? node.itemName}-${nextContainerSeq()}`,
    kind: 'machine',
    entityName,
    origin: { x: 0, y: 0 },
    size: { w, h },
    recipeName: node.recipeName,
  };
}

function containerSummary(c: Container) {
  return {
    id: c.id,
    kind: c.kind,
    entityName: c.entityName,
    origin: c.origin,
    size: c.size,
    recipeName: c.recipeName,
    content: c.content,
  };
}

function simplifyTree(node: RecipeTreeNode): unknown {
  return {
    recipeName: node.recipeName,
    itemName: node.itemName,
    external: node.external,
    machineCount: node.machineCount,
    children: node.children.map(simplifyTree),
  };
}

function findContainer(pg: Playground, id: string): Container | undefined {
  return (
    pg.internal.containers.find((c) => c.id === id) ??
    pg.external.containers.find((c) => c.id === id)
  );
}

function portKindOptions(
  containers: Container[],
  selectedId: string,
  recipeMap: Map<string, { ingredients: { name: string; type: string }[]; products: { name: string; type: string }[] }>,
): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [{ value: 'item', label: 'item' }];
  const c = containers.find((x) => x.id === selectedId);
  if (!c) return opts;
  const fluidNames = new Set<string>();
  if (c.content) fluidNames.add(c.content);
  if (c.recipeName) {
    const r = recipeMap.get(c.recipeName);
    if (r) {
      for (const ing of r.ingredients) if (ing.type === 'fluid') fluidNames.add(ing.name);
      for (const prod of r.products) if (prod.type === 'fluid') fluidNames.add(prod.name);
    }
  }
  for (const name of fluidNames) opts.push({ value: `fluid:${name}`, label: `fluid:${name}` });
  return opts;
}

// ─────────────────────────────────────────────────────────────────────
// 그리드 미리보기 — SVG 기반, viewBox 자동 계산
// ─────────────────────────────────────────────────────────────────────

export interface GridPreviewProps {
  playground: Playground;
  /** 직전 실행에서 추가된 셀 (좌표 "x,y" 형식). 노란 stroke 로 강조 */
  highlightCells: Set<string>;
  /** enumerateContainerPorts 결과 — port cell 마다 오버레이 마커 표시 */
  portOverlay?: ContainerPort[];
}

/**
 * 모달 옆에 띄울 독립 사이드 패널. GridPreview 를 모달과 같은 chrome 으로 감싼다.
 */
export function DebugGridPanel({ playground, highlightCells, portOverlay }: GridPreviewProps) {
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-80 max-h-[90vh] flex flex-col">
      <div className="px-4 pt-3 pb-2 border-b border-gray-800">
        <h3 className="text-white font-bold text-sm">디버그 그리드</h3>
        <p className="text-[10px] text-gray-500 leading-relaxed">
          좌측 함수 실행 결과가 즉시 반영됩니다.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <GridPreview
          playground={playground}
          highlightCells={highlightCells}
          portOverlay={portOverlay}
        />
      </div>
    </div>
  );
}

export interface DebugHistoryPanelProps {
  history: HistoryEntry[];
  onUndo: () => void;
}

/**
 * 실행 히스토리 사이드 패널 — DebugGridPanel 과 같은 chrome.
 * 최상단에 [↶ 실행 취소] 버튼, 아래에 최신→과거 순 리스트.
 */
export function DebugHistoryPanel({ history, onUndo }: DebugHistoryPanelProps) {
  const empty = history.length === 0;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-72 max-h-[90vh] flex flex-col">
      <div className="px-4 pt-3 pb-2 border-b border-gray-800 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-white font-bold text-sm">실행 히스토리</h3>
          <p className="text-[10px] text-gray-500">{empty ? '아직 비어있음' : `${history.length}개 항목`}</p>
        </div>
        <button
          type="button"
          onClick={onUndo}
          disabled={empty}
          className="text-xs text-amber-300 hover:text-amber-200 border border-amber-700/50 hover:border-amber-500 rounded px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:text-gray-500 disabled:border-gray-700"
          title="가장 최근 실행 취소"
        >
          ↶ 실행 취소
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {empty ? (
          <div className="text-[10px] text-gray-500 italic text-center py-12">
            함수를 실행하면 여기에
            <br />
            기록이 쌓입니다.
          </div>
        ) : (
          <ol className="text-[11px] font-mono space-y-0.5">
            {history.slice().reverse().map((h, i) => (
              <li
                key={h.id}
                className={`flex items-center gap-2 px-2 py-1 rounded ${
                  i === 0 ? 'bg-amber-900/20 border border-amber-700/40' : 'border border-transparent'
                }`}
              >
                <span className="text-gray-600 w-6 text-right shrink-0">{history.length - i}.</span>
                <span className="text-gray-200 truncate">{h.label}</span>
                {i === 0 && (
                  <span className="ml-auto text-amber-400 text-[9px] shrink-0">undo 대상</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function GridPreview({ playground, highlightCells, portOverlay }: GridPreviewProps) {
  // internal/external 의 placed 셀을 합집합으로 (chest 는 internal 에 ghost 로 있어 보통 internal 만 충분)
  const cells = useMemo(() => {
    const seen = new Set<string>();
    const all: { x: number; y: number; cell: GridCell }[] = [];
    for (const p of playground.internal.placed) {
      const k = `${p.x},${p.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(p);
    }
    for (const p of playground.external.placed) {
      const k = `${p.x},${p.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(p);
    }
    return all;
  }, [playground]);

  const bounds = useMemo(() => {
    if (cells.length === 0 && (!portOverlay || portOverlay.length === 0)) return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const c of cells) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
    // port overlay 셀도 viewBox 안에 들어오도록 포함
    if (portOverlay) {
      for (const p of portOverlay) {
        if (p.cell.x < minX) minX = p.cell.x;
        if (p.cell.y < minY) minY = p.cell.y;
        if (p.cell.x > maxX) maxX = p.cell.x;
        if (p.cell.y > maxY) maxY = p.cell.y;
      }
    }
    // 2셀 여백
    return { minX: minX - 2, minY: minY - 2, maxX: maxX + 2, maxY: maxY + 2 };
  }, [cells, portOverlay]);

  return (
    <div className="bg-gray-900/60 border border-gray-700 rounded p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-gray-400 uppercase tracking-wider text-[10px]">미리보기</span>
        <span className="text-[10px] text-gray-500">
          {cells.length === 0 ? '비어있음' : `${cells.length} 셀`}
        </span>
      </div>
      {bounds === null ? (
        <div className="text-[10px] text-gray-500 italic text-center py-12">
          함수를 실행하면 여기에
          <br />
          그리드가 그려집니다
        </div>
      ) : (
        <div className="bg-gray-950 rounded p-1 max-h-[60vh] overflow-hidden flex items-center justify-center">
          <svg
            viewBox={`${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX + 1} ${bounds.maxY - bounds.minY + 1}`}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-auto max-h-[55vh]"
            shapeRendering="crispEdges"
          >
            {/* 도트 패턴 그리드 배경 */}
            <defs>
              <pattern id="dbg-grid-dot" width="1" height="1" patternUnits="userSpaceOnUse">
                <circle cx="0.5" cy="0.5" r="0.04" fill="#374151" />
              </pattern>
            </defs>
            <rect
              x={bounds.minX}
              y={bounds.minY}
              width={bounds.maxX - bounds.minX + 1}
              height={bounds.maxY - bounds.minY + 1}
              fill="url(#dbg-grid-dot)"
            />

            {/* 머신+라우팅 bbox 점선 (chest 제외) */}
            <MachineBboxOutline playground={playground} />

            {/* 셀 */}
            {cells.map((c) => {
              const k = `${c.x},${c.y}`;
              const highlighted = highlightCells.has(k);
              return (
                <CellRect
                  key={k}
                  x={c.x}
                  y={c.y}
                  cell={c.cell}
                  highlighted={highlighted}
                />
              );
            })}

            {/* port overlay — enumerateContainerPorts 결과 */}
            {portOverlay && portOverlay.length > 0 && (
              <PortOverlay ports={portOverlay} />
            )}
          </svg>
        </div>
      )}
      <Legend showPorts={!!portOverlay && portOverlay.length > 0} />
    </div>
  );
}

/**
 * port cell 마다 컨테이너 쪽 face 변에 색 막대 + cell 중심에 작은 원.
 * - item port: 노란색
 * - fluid port: 시안색
 */
function PortOverlay({ ports }: { ports: ContainerPort[] }) {
  return (
    <>
      {ports.map((p, i) => {
        const isItem = p.kind === 'item';
        const color = isItem ? '#fde047' : '#22d3ee';
        const x = p.cell.x;
        const y = p.cell.y;
        // face 면 — 컨테이너가 있는 방향 (face 의 반대) 의 변을 강조
        const stripe = faceStripe(p.face, x, y);
        return (
          <g key={`${x},${y},${p.face},${i}`} pointerEvents="none">
            {/* port cell 외곽 강조 */}
            <rect
              x={x + 0.08}
              y={y + 0.08}
              width={0.84}
              height={0.84}
              fill="none"
              stroke={color}
              strokeWidth={0.08}
              strokeDasharray="0.15 0.08"
              rx={0.1}
            />
            {/* 컨테이너 쪽 변에 색 막대 */}
            <line
              x1={stripe.x1}
              y1={stripe.y1}
              x2={stripe.x2}
              y2={stripe.y2}
              stroke={color}
              strokeWidth={0.18}
              strokeLinecap="round"
            />
            {/* 중심 작은 원 */}
            <circle cx={x + 0.5} cy={y + 0.5} r={0.16} fill={color} stroke="#0f172a" strokeWidth={0.04} />
          </g>
        );
      })}
    </>
  );
}

/**
 * port cell 의 face 변 위치 — face 는 cell 의 *바깥* 방향이므로,
 * 컨테이너가 있는 변 = face 의 반대편 변.
 */
function faceStripe(
  face: 'N' | 'E' | 'S' | 'W',
  x: number,
  y: number,
): { x1: number; y1: number; x2: number; y2: number } {
  // port.cell 은 컨테이너 바로 바깥. 컨테이너는 face 반대 방향에 있음.
  // 즉 N face → 컨테이너는 cell 의 남쪽 → cell 의 남쪽 변에 stripe
  switch (face) {
    case 'N':
      return { x1: x + 0.15, y1: y + 0.92, x2: x + 0.85, y2: y + 0.92 };
    case 'S':
      return { x1: x + 0.15, y1: y + 0.08, x2: x + 0.85, y2: y + 0.08 };
    case 'W':
      return { x1: x + 0.92, y1: y + 0.15, x2: x + 0.92, y2: y + 0.85 };
    case 'E':
      return { x1: x + 0.08, y1: y + 0.15, x2: x + 0.08, y2: y + 0.85 };
  }
}

function MachineBboxOutline({ playground }: { playground: Playground }) {
  // chest ghost 를 제외한 머신+라우팅 bbox
  const externalIds = new Set(playground.external.containers.map((c) => c.id));
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let any = false;
  for (const p of playground.internal.placed) {
    if (p.cell.entityId && externalIds.has(p.cell.entityId)) continue;
    any = true;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!any) return null;
  return (
    <rect
      x={minX - 0.05}
      y={minY - 0.05}
      width={maxX - minX + 1 + 0.1}
      height={maxY - minY + 1 + 0.1}
      fill="none"
      stroke="#6b7280"
      strokeWidth="0.06"
      strokeDasharray="0.25 0.15"
    />
  );
}

function CellRect(props: {
  x: number;
  y: number;
  cell: GridCell;
  highlighted: boolean;
}) {
  const { x, y, cell, highlighted } = props;
  const fill = colorForCell(cell);
  const stroke = highlighted ? '#facc15' : '#0f172a';
  const strokeWidth = highlighted ? 0.12 : 0.04;
  const isInserter = cell.entityType === EntityType.Inserter;
  const isBelt = cell.entityType === EntityType.Belt;
  return (
    <g>
      <rect
        x={x + 0.05}
        y={y + 0.05}
        width={0.9}
        height={0.9}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        rx={0.08}
      />
      {(isInserter || isBelt) && <DirectionArrow x={x} y={y} dir={cell.direction} />}
    </g>
  );
}

function DirectionArrow({ x, y, dir }: { x: number; y: number; dir: Direction }) {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const r = 0.28;
  const v = directionToVector(dir);
  const tipX = cx + v.x * r;
  const tipY = cy + v.y * r;
  // 화살촉을 위한 두 보조점 — tip 에서 반대 방향으로 살짝, 좌우로 벌어진 두 점
  const backX = cx - v.x * r * 0.4;
  const backY = cy - v.y * r * 0.4;
  // perp = 수직 단위벡터
  const px = -v.y;
  const py = v.x;
  const half = 0.14;
  const wingAX = backX + px * half;
  const wingAY = backY + py * half;
  const wingBX = backX - px * half;
  const wingBY = backY - py * half;
  return (
    <polygon
      points={`${tipX},${tipY} ${wingAX},${wingAY} ${wingBX},${wingBY}`}
      fill="#0f172a"
      opacity={0.7}
    />
  );
}

function directionToVector(dir: Direction): { x: number; y: number } {
  switch (dir) {
    case 0:
      return { x: 0, y: -1 };
    case 4:
      return { x: 1, y: 0 };
    case 8:
      return { x: 0, y: 1 };
    case 12:
      return { x: -1, y: 0 };
  }
}

function colorForCell(cell: GridCell): string {
  switch (cell.entityType) {
    case EntityType.Assembler:
      return '#f97316'; // orange
    case EntityType.Furnace:
      return '#dc2626'; // red
    case EntityType.Belt:
      return '#22c55e'; // green
    case EntityType.Inserter:
      return '#eab308'; // yellow
    case EntityType.Pipe:
      return '#3b82f6'; // blue
    case EntityType.InfinityChest:
      return '#d1d5db'; // light gray
    case EntityType.InfinityPipe:
      return '#93c5fd'; // light blue
    default:
      return '#6b7280';
  }
}

function Legend({ showPorts }: { showPorts: boolean }) {
  const items: { color: string; label: string }[] = [
    { color: '#f97316', label: '머신' },
    { color: '#22c55e', label: '벨트' },
    { color: '#eab308', label: '투입기' },
    { color: '#3b82f6', label: '파이프' },
    { color: '#d1d5db', label: '무한상자' },
    { color: '#93c5fd', label: '무한파이프' },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-2 text-[10px] text-gray-400">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-1">
          <span
            className="inline-block w-2 h-2 rounded-sm border border-gray-700"
            style={{ background: it.color }}
          />
          <span>{it.label}</span>
        </div>
      ))}
      <div className="flex items-center gap-1 col-span-2 mt-0.5">
        <span className="inline-block w-2 h-2 rounded-sm border-2 border-yellow-400" />
        <span>직전 실행 추가</span>
      </div>
      {showPorts && (
        <>
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#fde047' }} />
            <span>item port</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#22d3ee' }} />
            <span>fluid port</span>
          </div>
        </>
      )}
    </div>
  );
}

export type { Props as AutoLayoutDebugTabProps };
