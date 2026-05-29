/**
 * 자동 레이아웃 위저드 — 컨테이너 모델 (새 모델) 패널.
 *
 * 부모 모달 ([AutoLayoutModal.tsx]) 의 review 단계에 하단 박스로 노출되는
 * *대체* 진입점. 사용자가 토글로 새 모델을 켜면 본 패널이 활성화되어
 * `runContainerWizard` 를 호출하고 결과 후보 트리를 표시한다.
 *
 * **후보 적용 시 동작:**
 *  - 그리드에 셀이 적용되고 비-InfinityChest/Pipe 셀의 bbox 가 layoutStore 의
 *    externalAreaBbox 로 저장된다.
 *  - pixi-manager 가 이 bbox 주변 1칸 링을 "외부 영역"으로 표시하며,
 *    해당 영역의 InfinityChest/InfinityPipe 를 드래그할 수 있다.
 *  - 후보 적용 시 위저드 설정이 초기화되지 않는다.
 */

import { useEffect, useRef, useState } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import type { RoutingEditSession, RoutingSessionRouting } from '../store/layoutStore';
import { useToastStore } from '../store/toastStore';
import { runContainerWizard, buildRoutingOptions } from '../utils/autoLayout/containerWizard';
import {
  unifyAreas,
} from '../utils/autoLayout/areaUnification';
import { AUTO_LAYOUT_COORD_DUMP } from '../utils/autoLayout/debugFlags';
import { registerAutoLayoutDebug } from '../utils/debugApi';
import type {
  AreaSnapshot,
  CandidateLeaf,
  CandidateNode,
  CandidateTree,
  ContainerWizardInput,
  ContainerWizardResult,
  PlacedCell,
} from '../utils/autoLayout/containerModel';

interface AutoLayoutContainerPanelProps {
  targetRecipe: string;
  externalIngredients: ReadonlySet<string>;
  selectedMachines: ReadonlySet<string>;
  selectedInserters: ReadonlySet<string>;
  selectedBelts: ReadonlySet<string>;
  selectedUndergroundPipes: ReadonlySet<string>;
  selectedUndergroundBelts: ReadonlySet<string>;
  onClose: () => void;
}

interface ProgressSnapshot {
  depth: number;
  siblingIndex: number;
  siblingTotal: number;
  candidatesGenerated: number;
  failuresGenerated: number;
  /** wizard 가 현재 실행 중인 phase / 함수 이름 (실시간) */
  currentFunction?: string;
  /** 누적 시도 횟수 */
  attempts?: number;
}

export default function AutoLayoutContainerPanel(props: AutoLayoutContainerPanelProps) {
  const applyPlacedCells = useLayoutStore((s) => s.applyPlacedCells);
  const setPreviewCells = useLayoutStore((s) => s.setPreviewCells);
  const setAutoLayoutRunning = useLayoutStore((s) => s.setAutoLayoutRunning);
  const resetViewport = useLayoutStore((s) => s.resetViewport);
  const showToast = useToastStore((s) => s.show);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ContainerWizardResult | null>(null);
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // review 단계 진입 시 자동 실행 (파이프 선택까지 완료된 시점)
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStartedRef.current && props.targetRecipe && props.selectedMachines.size > 0) {
      autoStartedRef.current = true;
      handleRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 콘솔 디버그 API(flg.candidates() / flg.apply())에 현재 후보 + 적용 핸들러 등록.
  useEffect(() => {
    registerAutoLayoutDebug({
      getCandidates: () => result?.tree.candidates ?? [],
      applyCandidate: handleApplyCandidate,
    });
    return () => registerAutoLayoutDebug(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  async function handleRun() {
    if (!props.targetRecipe) return;
    setRunning(true);
    setAutoLayoutRunning(true);
    setResult(null);
    setProgress(null);
    setError(null);
    setPreviewCells(null);
    useLayoutStore.getState().setExternalAreaBbox(null);
    useLayoutStore.getState().setAutoLayoutCanvasBbox(null);

    const input: ContainerWizardInput = {
      targetRecipe: props.targetRecipe,
      countMode: 'min',
      externalIngredients: props.externalIngredients,
      selectedMachines: Array.from(props.selectedMachines),
      selectedInserters: Array.from(props.selectedInserters),
      selectedBelts: Array.from(props.selectedBelts),
      selectedUndergroundPipes: Array.from(props.selectedUndergroundPipes),
      selectedUndergroundBelts: Array.from(props.selectedUndergroundBelts),
      externalPortsDefault: 'top-left',
    };

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const r = await runContainerWizard(input, {
        signal: ctrl.signal,
        onProgress: (snap) => setProgress(snap),
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setAutoLayoutRunning(false);
      abortRef.current = null;
    }
  }

  function handleAbort() {
    abortRef.current?.abort();
  }

  function applyLayoutBboxes(
    internalBbox: { x: number; y: number; w: number; h: number } | undefined,
    canvasBbox: { x: number; y: number; w: number; h: number } | undefined,
  ) {
    const store = useLayoutStore.getState();
    store.setExternalAreaBbox(internalBbox ?? null);
    store.setAutoLayoutCanvasBbox(canvasBbox ?? null);
  }

  function buildSessionFromLeaf(
    leaf: CandidateLeaf,
    containerOriginOffset: { x: number; y: number },
  ): RoutingEditSession {
    const allContainers = [...leaf.internal.containers, ...leaf.external.containers];
    const machineIdSet = new Set(leaf.internal.containers.filter(c => c.kind === 'machine').map(c => c.id));

    const machineParent: Record<string, string | null> = {};
    const machineChildren: Record<string, string[]> = {};
    for (const c of leaf.internal.containers) {
      if (c.kind === 'machine') { machineParent[c.id] = null; machineChildren[c.id] = []; }
    }

    const routings: RoutingSessionRouting[] = leaf.routings.map(r => ({
      id: r.id,
      portKind: r.from.kind,
      fromContainerId: r.from.containerId,
      toContainerId: r.to.containerId,
    }));

    for (const r of leaf.routings) {
      const fi = r.from.containerId, ti = r.to.containerId;
      if (machineIdSet.has(fi) && machineIdSet.has(ti)) {
        machineParent[fi] = ti;
        if (!machineChildren[ti].includes(fi)) machineChildren[ti].push(fi);
      }
    }

    const input: ContainerWizardInput = {
      targetRecipe: props.targetRecipe,
      countMode: 'min',
      externalIngredients: props.externalIngredients,
      selectedMachines: Array.from(props.selectedMachines),
      selectedInserters: Array.from(props.selectedInserters),
      selectedBelts: Array.from(props.selectedBelts),
      selectedUndergroundPipes: Array.from(props.selectedUndergroundPipes),
      selectedUndergroundBelts: Array.from(props.selectedUndergroundBelts),
      externalPortsDefault: 'top-left',
    };

    return { containers: allContainers, routings, machineParent, machineChildren, routeOptions: buildRoutingOptions(input), containerOriginOffset };
  }

  function handleApplyCandidate(leaf: CandidateLeaf) {
    const { placed, internalBbox, canvasBbox } = unifyAreas(leaf.internal, leaf.external);

    if (AUTO_LAYOUT_COORD_DUMP) {
      console.log('[autoLayout debug] handleApplyCandidate\n' + JSON.stringify({
        'internal.containers': leaf.internal.containers.map((c) => ({
          id: c.id, kind: c.kind, entityName: c.entityName,
          origin: { ...c.origin }, size: { ...c.size },
        })),
        'external.containers': leaf.external.containers.map((c) => ({
          id: c.id, kind: c.kind, entityName: c.entityName,
          origin: { ...c.origin }, size: { ...c.size },
        })),
        'internal.placed': leaf.internal.placed.map((p) => ({
          x: p.x, y: p.y,
          entityId: p.cell.entityId, entityType: p.cell.entityType, isOrigin: p.cell.isOrigin,
        })),
        'external.placed': leaf.external.placed.map((p) => ({
          x: p.x, y: p.y,
          entityId: p.cell.entityId, entityType: p.cell.entityType,
        })),
        'routings': leaf.routings.map((r) => ({
          id: r.id, kind: r.kind,
          from: { containerId: r.from.containerId, cell: r.from.cell, kind: r.from.kind },
          to: { containerId: r.to.containerId, cell: r.to.cell, kind: r.to.kind },
          placed: r.placed.map((p) => ({
            x: p.x, y: p.y,
            entityId: p.cell.entityId, entityType: p.cell.entityType, direction: p.cell.direction,
          })),
        })),
        'unifyAreas': { internalBbox, canvasBbox },
        'placed.normalized': placed.map((p) => ({
          x: p.x, y: p.y,
          entityId: p.cell.entityId, entityType: p.cell.entityType,
        })),
      }, null, 2));
    }

    const cells = placed.map((p) => ({ x: p.x, y: p.y, cell: p.cell }));
    if (cells.length === 0) {
      showToast('빈 후보 — 적용할 셀 없음', 'warning');
      return;
    }
    // container.origin (layout space) → 그리드 좌표 오프셋 계산.
    // unifyAreas는 셀을 (internalBbox.x, internalBbox.y) 로 이동시키지만
    // container.origin은 그대로이므로 이 값이 기본 오프셋이 된다.
    // applyPlacedCells 내부에서도 음수 좌표 정규화를 하므로 그 sx/sy도 포함한다.
    let minCellX = 0, minCellY = 0;
    for (const { x, y } of cells) {
      if (x < minCellX) minCellX = x;
      if (y < minCellY) minCellY = y;
    }
    const containerOriginOffset = {
      x: (internalBbox?.x ?? 0) + Math.max(0, -minCellX),
      y: (internalBbox?.y ?? 0) + Math.max(0, -minCellY),
    };
    applyPlacedCells(cells);
    applyLayoutBboxes(internalBbox, canvasBbox);
    useLayoutStore.getState().setRoutingEditSession({
      ...buildSessionFromLeaf(leaf, containerOriginOffset),
      liveArea: { internal: leaf.internal, external: leaf.external, routings: leaf.routings },
    });
    useLayoutStore.getState().setRoutingEditMode(false);
    resetViewport();
    showToast(`컨테이너 모델 후보 적용됨 (${cells.length} 셀)`, 'success');
    // 위저드 설정 초기화하지 않음 — 사용자가 계속 설정을 유지할 수 있도록
  }

  /**
   * 탐색 트리의 임의 노드를 클릭했을 때 — 그 시점의 스냅샷을 실제 그리드에 적용.
   */
  function handleApplyNode(node: CandidateNode) {
    const { placed, internalBbox, canvasBbox } = extractCellsForNode(node);
    const cells = placed.map((p) => ({ x: p.x, y: p.y, cell: p.cell }));
    if (cells.length === 0) {
      showToast('이 시점에는 배치된 셀이 없습니다', 'warning');
      return;
    }
    applyPlacedCells(cells);
    applyLayoutBboxes(internalBbox, canvasBbox);
    resetViewport();
    const kindLabel =
      node.kind === 'candidate' ? '✓ 후보' :
      node.kind === 'failure' ? '✗ 실패 시점' :
      node.kind === 'machine' ? 'M 머신 처리 시점' :
      'B 시도 직전 시점';
    showToast(`${kindLabel} 적용됨 (${cells.length} 셀)`, 'success');
    // 위저드 설정 초기화하지 않음
  }

  return (
    <div className="mt-4 border-t border-purple-900/50 pt-3 space-y-2">
      {props.selectedMachines.size === 0 && (
        <div className="text-[11px] text-amber-300 bg-amber-900/20 border border-amber-700/50 rounded px-2 py-1">
          머신이 선택되지 않았습니다 — 이전 단계로 돌아가 머신을 선택해주세요.
        </div>
      )}

      <div className="flex items-center gap-2">
        {running && (
          <button
            onClick={handleAbort}
            className="bg-red-700 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
          >
            중단 (Esc)
          </button>
        )}
        {progress && (
          <div className="text-[11px] text-gray-400 font-mono space-y-0.5 min-w-0 flex-1">
            <div>
              depth {progress.depth} · 형제 {progress.siblingIndex}/{progress.siblingTotal}
              {progress.attempts !== undefined && (
                <>
                  {' · '}
                  <span className="text-cyan-300">시도 {progress.attempts}</span>
                </>
              )}
              {' · '}
              <span className="text-green-300">{progress.candidatesGenerated} 후보</span>
              {' / '}
              <span className="text-amber-300">{progress.failuresGenerated} 실패</span>
            </div>
            {progress.currentFunction && (
              <div className="text-purple-300 truncate" title={progress.currentFunction}>
                ▶ {progress.currentFunction}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-300 bg-red-900/20 border border-red-800 rounded px-2 py-1">
          오류: {error}
        </div>
      )}

      {result && (
        <ResultPanel
          result={result}
          onApply={handleApplyCandidate}
          onApplyNode={handleApplyNode}
          onHover={(node) => {
            if (!node) { setPreviewCells(null); return; }
            const { placed } = extractCellsForNode(node);
            setPreviewCells(placed.map((p) => ({ x: p.x, y: p.y, cell: p.cell })));
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 결과 패널 — 후보 리스트 + 트리 로그
// ─────────────────────────────────────────────────────────────────────────────

function ResultPanel({
  result,
  onApply,
  onApplyNode,
  onHover,
}: {
  result: ContainerWizardResult;
  onApply: (leaf: CandidateLeaf) => void;
  onApplyNode: (node: CandidateNode) => void;
  onHover: (node: CandidateNode | null) => void;
}) {
  const tree = result.tree;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px]">
        <span className={result.ok ? 'text-green-300' : 'text-yellow-300'}>
          {result.ok ? '성공' : '후보 없음'}
        </span>
        {result.partial && <span className="text-amber-300">(부분 결과 — Esc 중단)</span>}
        <span className="text-gray-500">·</span>
        <span className="text-gray-400">
          후보 {tree.stats.candidatesGenerated} / 실패 {tree.stats.failuresGenerated} ·
          최대 깊이 {tree.stats.deepestDepth}
        </span>
      </div>

      {tree.candidates.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">
            후보 ({tree.candidates.length}) — 클릭 시 그리드에 적용 / hover 미리보기
          </div>
          <div className="text-[10px] text-green-400/80 bg-green-900/10 border border-green-800/40 rounded px-2 py-1">
            적용 후 블루프린트 주변 1칸 외부 영역(초록색)에서 무한상자를 드래그할 수 있습니다.
          </div>
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {tree.candidates.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onApply(c)}
                  onMouseEnter={() => onHover(c)}
                  onMouseLeave={() => onHover(null)}
                  className="w-full text-left bg-gray-800/40 hover:bg-purple-900/40 border border-gray-700 hover:border-purple-600 rounded px-2 py-1 text-[11px] text-gray-200 font-mono transition-colors"
                >
                  <span className="text-purple-300">▸</span>{' '}
                  <span className="text-gray-400">penalty={c.squarenessPenalty}</span>
                  {' · '}
                  <span className="text-gray-500">internal {c.internal.placed.length} cells</span>
                  {' · '}
                  <span className="text-gray-500">external {c.external.containers.length} chests</span>
                  <div className="text-[10px] text-gray-500 mt-0.5">{c.label}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <TreeLog tree={tree} onHover={onHover} onApplyNode={onApplyNode} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 인터랙티브 트리 로그 — 각 노드 hover 시 onHover 호출
// ─────────────────────────────────────────────────────────────────────────────

function TreeLog({
  tree,
  onHover,
  onApplyNode,
}: {
  tree: CandidateTree;
  onHover: (node: CandidateNode | null) => void;
  onApplyNode: (node: CandidateNode) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      open={expanded}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
      className="text-[10px] text-gray-500 bg-gray-900/40 border border-gray-800 rounded px-2 py-1"
    >
      <summary className="cursor-pointer text-gray-400">
        탐색 트리 로그 (실패 가지 포함, hover 미리보기 / 클릭 시 그 시점 그리드 적용)
      </summary>
      <div className="mt-1 leading-tight font-mono whitespace-nowrap overflow-x-auto max-h-64">
        <TreeNodeRow node={tree.root} depth={0} onHover={onHover} onApplyNode={onApplyNode} />
      </div>
    </details>
  );
}

function TreeNodeRow({
  node,
  depth,
  onHover,
  onApplyNode,
}: {
  node: CandidateNode;
  depth: number;
  onHover: (node: CandidateNode | null) => void;
  onApplyNode: (node: CandidateNode) => void;
}) {
  const indent = '  '.repeat(depth);
  const prefix =
    node.kind === 'machine' ? 'M' :
    node.kind === 'branch' ? 'B' :
    node.kind === 'candidate' ? '✓' :
    '✗';
  const colorClass =
    node.kind === 'candidate' ? 'text-green-300' :
    node.kind === 'failure' ? 'text-red-300/80' :
    node.kind === 'machine' ? 'text-gray-300' :
    'text-gray-500';
  const lineThrough = node.kind === 'failure' ? 'line-through' : '';
  return (
    <>
      <div
        onMouseEnter={() => onHover(node)}
        onMouseLeave={() => onHover(null)}
        onClick={() => onApplyNode(node)}
        title="클릭 시 이 시점의 배치를 그리드에 적용"
        className={`${colorClass} ${lineThrough} hover:bg-purple-900/30 cursor-pointer px-1`}
      >
        <span className="text-gray-600 select-none">{indent}</span>
        <span className="font-bold mr-1">{prefix}</span>
        <span>{node.label}</span>
      </div>
      {node.children.map((c) => (
        <TreeNodeRow key={c.id} node={c} depth={depth + 1} onHover={onHover} onApplyNode={onApplyNode} />
      ))}
    </>
  );
}

/**
 * 노드 종류별로 보여줄 placed cells + internalBbox 추출.
 */
function extractCellsForNode(node: CandidateNode): { placed: PlacedCell[]; internalBbox: { x: number; y: number; w: number; h: number } | undefined; canvasBbox: { x: number; y: number; w: number; h: number } | undefined } {
  if (node.kind === 'candidate') {
    return unifyAreas(node.internal, node.external);
  }
  const snap: AreaSnapshot | undefined = node.snapshot;
  if (!snap) return { placed: [], internalBbox: undefined, canvasBbox: undefined };
  return unifyAreas(snap.internal, snap.external);
}

