/**
 * 자동 레이아웃 위저드 — 컨테이너 모델 (새 모델) 패널.
 *
 * 부모 모달 ([AutoLayoutModal.tsx]) 의 review 단계에 하단 박스로 노출되는
 * *대체* 진입점. 사용자가 토글로 새 모델을 켜면 본 패널이 활성화되어
 * `runContainerWizard` 를 호출하고 결과 후보 트리를 표시한다.
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md.
 *
 * **본 패널이 다루는 범위:**
 *  - 새 wizard 호출 + AbortSignal (Esc 중단) + 진행 상태 표시.
 *  - 후보 리스트 (squarenessPenalty 오름차순). 클릭하면 *internal + external*
 *    cells 가 그리드에 적용됨.
 *  - **인터랙티브 트리 로그** — 각 노드에 mouse hover 시 그 시점까지 배치된
 *    셀들이 작은 그리드 미리보기 popup 으로 표시된다 (success / failure 모두).
 *    각 노드는 orchestrator 가 만들 때 `snapshot` (internal+external 클론) 을
 *    가지고 있어 hover preview 는 즉시 (재계산 없이) 그릴 수 있다.
 *
 * **외부 영역 편집기 (CG2):**
 *  후보 리스트의 "📦 편집" 버튼을 누르면 그 후보의 *클론* 위에서 무한상자
 *  드래그를 시도할 수 있다. 드래그 성공 시 클론의 라우팅이 재시도되어 새
 *  자리에 라우팅이 깔리고, 실패 시 원위치로 snap-back. "이 후보에 반영"
 *  으로 클론을 원본 후보 위치에 commit, "취소" 로 클론 폐기.
 *
 * **본 패널이 *아직* 다루지 않는 부분 (UI follow-up):**
 *  - 노드 클릭 → 그리드에 부분 블루프린트 적용 (현재는 후보 리스트의 클릭만 지원).
 *  - 실패 가지 토글 (Q30 c).
 *  - 자식 머신 / 외부 포트 드래그 (Q22, Q23). 무한상자 드래그는 위 편집기에서 지원.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLayoutStore } from '../store/layoutStore';
import { useToastStore } from '../store/toastStore';
import { ROUTING_OPTIONS, runContainerWizard } from '../utils/autoLayout/containerWizard';
import {
  cloneCandidate,
  dragExternalContainer,
  unifyAreas,
} from '../utils/autoLayout/areaUnification';
import type {
  AreaSnapshot,
  CandidateLeaf,
  CandidateNode,
  CandidateTree,
  Container,
  ContainerWizardInput,
  ContainerWizardResult,
  PlacedCell,
} from '../utils/autoLayout/containerModel';
import {
  collectPlacedEntityNames,
  getDynamicEntityColor,
} from '../utils/entityColors';

interface AutoLayoutContainerPanelProps {
  targetRecipe: string;
  externalIngredients: ReadonlySet<string>;
  selectedMachines: ReadonlySet<string>;
  selectedInserters: ReadonlySet<string>;
  selectedBelts: ReadonlySet<string>;
  selectedUndergroundPipes: ReadonlySet<string>;
  onClose: () => void;
}

interface ProgressSnapshot {
  depth: number;
  siblingIndex: number;
  siblingTotal: number;
  candidatesGenerated: number;
  failuresGenerated: number;
}

export default function AutoLayoutContainerPanel(props: AutoLayoutContainerPanelProps) {
  const applyPlacedCells = useLayoutStore((s) => s.applyPlacedCells);
  const showToast = useToastStore((s) => s.show);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ContainerWizardResult | null>(null);
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoverNode, setHoverNode] = useState<CandidateNode | null>(null);
  // CG2: 외부 영역 편집 — 원본 candidate 의 *클론* 을 staging 한다. drag 가
  // 실패하면 클론은 자체 rollback 으로 원상 복구되며, "반영" 시 result.tree
  // 의 candidate 슬롯을 클론으로 교체하고 "취소" 시 클론 폐기.
  const [editing, setEditing] = useState<{ originalId: string; clone: CandidateLeaf } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function handleRun() {
    if (!props.targetRecipe) return;
    setRunning(true);
    setResult(null);
    setProgress(null);
    setError(null);
    setHoverNode(null);

    const input: ContainerWizardInput = {
      targetRecipe: props.targetRecipe,
      countMode: 'min',
      externalIngredients: props.externalIngredients,
      selectedMachines: Array.from(props.selectedMachines),
      selectedInserters: Array.from(props.selectedInserters),
      selectedBelts: Array.from(props.selectedBelts),
      selectedUndergroundPipes: Array.from(props.selectedUndergroundPipes),
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
      abortRef.current = null;
    }
  }

  function handleAbort() {
    abortRef.current?.abort();
  }

  function handleApplyCandidate(leaf: CandidateLeaf) {
    // CG2: 두 영역을 통합 좌표계로 평탄화. external.placed 는 외부 좌표계라
    // 직접 합치면 안 되며, unifyAreas 가 통합 좌표계로 평탄화한 PlacedCell[]
    // 을 반환한다 (1차 구현은 internal.placed 가 이미 통합 좌표라 그대로 복제).
    const { placed } = unifyAreas(leaf.internal, leaf.external);
    const cells = placed.map((p) => ({ x: p.x, y: p.y, cell: p.cell }));
    if (cells.length === 0) {
      showToast('빈 후보 — 적용할 셀 없음', 'warning');
      return;
    }
    applyPlacedCells(cells);
    showToast(`컨테이너 모델 후보 적용됨 (${cells.length} 셀)`, 'success');
    props.onClose();
  }

  /** 후보 리스트에서 "📦 편집" 클릭 — 그 후보의 클론을 staging. */
  function handleStartEdit(leaf: CandidateLeaf) {
    setEditing({ originalId: leaf.id, clone: cloneCandidate(leaf) });
  }

  /** 편집기에서 "이 후보에 반영" — result.tree 의 candidate 슬롯을 클론으로 교체. */
  function handleCommitEdit() {
    if (!editing || !result) return;
    // tree.candidates (평탄화 배열) 와 트리 노드 (root 하위) 모두 교체.
    const newTree: CandidateTree = {
      ...result.tree,
      candidates: result.tree.candidates.map((c) =>
        c.id === editing.originalId ? editing.clone : c,
      ),
      root: replaceCandidateInTree(result.tree.root, editing.originalId, editing.clone),
    };
    setResult({ ...result, tree: newTree });
    setEditing(null);
    showToast('외부 영역 편집을 후보에 반영했습니다', 'success');
  }

  function handleCancelEdit() {
    setEditing(null);
  }

  return (
    <div className="mt-4 border-t border-purple-900/50 pt-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-purple-300 bg-purple-900/40 border border-purple-700/50 rounded px-1.5 py-0.5">
          new model
        </span>
        <span className="text-xs text-gray-300">컨테이너 모델 (실험 — placement-search v2)</span>
      </div>
      <p className="text-[10px] text-gray-500 leading-relaxed">
        새 알고리즘. 머신과 무한상자/무한파이프를 단일 추상으로 다루며 내부/외부
        영역 분리, 자식 형제 순서 × 자식 위치 (오른쪽/아래쪽) 완전 탐색,
        Esc 중단 가능. 후보를 클릭하면 그리드에 적용. 트리 노드에 마우스를 올리면
        그 시점까지 배치된 형태가 미리보기 그리드로 떠오릅니다 (성공/실패 모두).
      </p>

      <div className="flex items-center gap-2">
        {!running ? (
          <button
            onClick={handleRun}
            disabled={!props.targetRecipe}
            className="bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
          >
            컨테이너 모델로 실행
          </button>
        ) : (
          <button
            onClick={handleAbort}
            className="bg-red-700 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
          >
            중단 (Esc)
          </button>
        )}
        {progress && (
          <span className="text-[11px] text-gray-400 font-mono">
            depth {progress.depth} · 형제 {progress.siblingIndex}/{progress.siblingTotal} ·
            {' '}
            <span className="text-green-300">{progress.candidatesGenerated} 후보</span>
            {' / '}
            <span className="text-amber-300">{progress.failuresGenerated} 실패</span>
          </span>
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
          onHover={setHoverNode}
          onEdit={handleStartEdit}
          editingId={editing?.originalId ?? null}
        />
      )}

      {editing && (
        <ExternalAreaEditor
          candidate={editing.clone}
          onCommit={handleCommitEdit}
          onCancel={handleCancelEdit}
          onApply={handleApplyCandidate}
          onToast={(msg, kind) => showToast(msg, kind)}
        />
      )}

      {hoverNode && <HoverPreviewPortal node={hoverNode} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 결과 패널 — 후보 리스트 + 트리 로그
// ─────────────────────────────────────────────────────────────────────────────

function ResultPanel({
  result,
  onApply,
  onHover,
  onEdit,
  editingId,
}: {
  result: ContainerWizardResult;
  onApply: (leaf: CandidateLeaf) => void;
  onHover: (node: CandidateNode | null) => void;
  onEdit: (leaf: CandidateLeaf) => void;
  editingId: string | null;
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
            후보 ({tree.candidates.length}) — 클릭 시 그리드에 적용 / hover 미리보기 / 📦 외부 영역 편집
          </div>
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {tree.candidates.map((c) => {
              const isEditing = editingId === c.id;
              return (
                <li key={c.id} className="flex items-stretch gap-1">
                  <button
                    onClick={() => onApply(c)}
                    onMouseEnter={() => onHover(c)}
                    onMouseLeave={() => onHover(null)}
                    className={`flex-1 text-left bg-gray-800/40 hover:bg-purple-900/40 border ${
                      isEditing ? 'border-purple-500 bg-purple-900/30' : 'border-gray-700 hover:border-purple-600'
                    } rounded px-2 py-1 text-[11px] text-gray-200 font-mono transition-colors`}
                  >
                    <span className="text-purple-300">▸</span>{' '}
                    <span className="text-gray-400">penalty={c.squarenessPenalty}</span>
                    {' · '}
                    <span className="text-gray-500">internal {c.internal.placed.length} cells</span>
                    {' · '}
                    <span className="text-gray-500">external {c.external.containers.length} chests</span>
                    <div className="text-[10px] text-gray-500 mt-0.5">{c.label}</div>
                  </button>
                  <button
                    onClick={() => onEdit(c)}
                    title="외부 영역 편집"
                    className={`px-2 text-xs rounded border ${
                      isEditing
                        ? 'bg-purple-700 border-purple-400 text-white'
                        : 'bg-gray-800 border-gray-700 hover:bg-purple-900 hover:border-purple-600 text-gray-300'
                    }`}
                  >
                    📦
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <TreeLog tree={tree} onHover={onHover} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 인터랙티브 트리 로그 — 각 노드 hover 시 onHover 호출
// ─────────────────────────────────────────────────────────────────────────────

function TreeLog({
  tree,
  onHover,
}: {
  tree: CandidateTree;
  onHover: (node: CandidateNode | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      open={expanded}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
      className="text-[10px] text-gray-500 bg-gray-900/40 border border-gray-800 rounded px-2 py-1"
    >
      <summary className="cursor-pointer text-gray-400">
        탐색 트리 로그 (실패 가지 포함, hover 시 미리보기)
      </summary>
      <div className="mt-1 leading-tight font-mono whitespace-nowrap overflow-x-auto max-h-64">
        <TreeNodeRow node={tree.root} depth={0} onHover={onHover} />
      </div>
    </details>
  );
}

function TreeNodeRow({
  node,
  depth,
  onHover,
}: {
  node: CandidateNode;
  depth: number;
  onHover: (node: CandidateNode | null) => void;
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
        className={`${colorClass} ${lineThrough} hover:bg-purple-900/30 cursor-help px-1`}
      >
        <span className="text-gray-600 select-none">{indent}</span>
        <span className="font-bold mr-1">{prefix}</span>
        <span>{node.label}</span>
      </div>
      {node.children.map((c) => (
        <TreeNodeRow key={c.id} node={c} depth={depth + 1} onHover={onHover} />
      ))}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// hover preview popup — 화면 우상단 고정. body 에 portal 로 렌더.
// ─────────────────────────────────────────────────────────────────────────────

function HoverPreviewPortal({ node }: { node: CandidateNode }) {
  const cells = useMemo(() => extractCellsForNode(node), [node]);
  const titleColor =
    node.kind === 'candidate' ? 'text-green-300' :
    node.kind === 'failure' ? 'text-red-300' :
    node.kind === 'machine' ? 'text-gray-200' :
    'text-gray-300';
  const popup = (
    <div
      className="fixed top-4 right-4 z-[1000] bg-gray-900 border border-purple-700 rounded-lg shadow-2xl p-3 pointer-events-none"
      style={{ width: 280 }}
    >
      <div className={`text-[11px] font-mono mb-2 ${titleColor} truncate`}>
        {node.kind === 'candidate' ? '✓ ' : node.kind === 'failure' ? '✗ ' : node.kind === 'machine' ? 'M ' : 'B '}
        {node.label}
      </div>
      <GridPreview cells={cells} size={252} />
      <div className="text-[10px] text-gray-500 mt-1 font-mono">
        {cells.length === 0 ? '배치된 셀 없음' : `${cells.length} 셀`}
      </div>
    </div>
  );
  return createPortal(popup, document.body);
}

/**
 * 노드 종류별로 보여줄 placed cells 추출. snapshot 이 있으면 그것을, 후보
 * leaf 면 본 필드. CG2: external.placed 는 외부 좌표계라 직접 합치면 안 되고
 * `unifyAreas` 가 통합 좌표계로 평탄화한 셀을 반환.
 */
function extractCellsForNode(node: CandidateNode): PlacedCell[] {
  if (node.kind === 'candidate') {
    return unifyAreas(node.internal, node.external).placed;
  }
  const snap: AreaSnapshot | undefined = node.snapshot;
  if (!snap) return [];
  return unifyAreas(snap.internal, snap.external).placed;
}

// ─────────────────────────────────────────────────────────────────────────────
// GridPreview — placed cells 를 작은 캔버스에 그린다.
// ─────────────────────────────────────────────────────────────────────────────

function GridPreview({ cells, size }: { cells: PlacedCell[]; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 배경
    ctx.fillStyle = '#0a0a10';
    ctx.fillRect(0, 0, size, size);

    if (cells.length === 0) {
      ctx.fillStyle = '#444';
      ctx.font = '11px monospace';
      ctx.textBaseline = 'top';
      ctx.fillText('(empty)', 6, 6);
      return;
    }

    // bbox + padding
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cells) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
    minX -= 1; minY -= 1; maxX += 1; maxY += 1;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const cellSize = Math.max(2, Math.floor(Math.min(size / w, size / h)));
    const offX = Math.floor((size - cellSize * w) / 2);
    const offY = Math.floor((size - cellSize * h) / 2);

    // grid lines (얇게)
    ctx.strokeStyle = '#1a1a25';
    ctx.lineWidth = 1;
    for (let i = 0; i <= w; i++) {
      const x = offX + i * cellSize + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, offY);
      ctx.lineTo(x, offY + h * cellSize);
      ctx.stroke();
    }
    for (let i = 0; i <= h; i++) {
      const y = offY + i * cellSize + 0.5;
      ctx.beginPath();
      ctx.moveTo(offX, y);
      ctx.lineTo(offX + w * cellSize, y);
      ctx.stroke();
    }

    // cells
    const sortedNames = collectPlacedEntityNames(cells.map((c) => c.cell));
    for (const c of cells) {
      const px = offX + (c.x - minX) * cellSize;
      const py = offY + (c.y - minY) * cellSize;
      const color = getDynamicEntityColor(c.cell.entityName, sortedNames);
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      ctx.fillRect(px, py, cellSize, cellSize);
      // origin 셀 (머신의 좌상단 등) 표시 — 작은 흰 점
      if (c.cell.isOrigin && cellSize >= 6) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(px + 1, py + 1, 2, 2);
      }
    }
  }, [cells, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="block bg-black rounded border border-gray-800"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 외부 영역 편집기 — chest 드래그 + 라우팅 재시도
// ─────────────────────────────────────────────────────────────────────────────

const EDITOR_CELL_SIZE = 32;     // 한 셀의 픽셀 크기
const EDITOR_VIEWPORT_PAD = 4;   // 외부 bbox 둘레 여유 셀 (드래그 destination 가능 범위)

/**
 * 외부 영역 편집기.
 *
 * `candidate` 는 *클론* 이며 본 컴포넌트가 dragExternalContainer 로 직접
 * mutate 한다. drag 가 실패하면 dragExternalContainer 의 rollback 으로
 * 클론은 원상 복구된다.
 *
 * UX:
 *  - 좌측 = 외부 영역 그리드 (chest 드래그 가능)
 *  - 우측 = 통합 좌표계 미리보기 (드래그 결과가 라우팅 변경으로 즉시 반영)
 *  - 하단 = 상태 라인 (마지막 시도 결과) + 버튼
 */
function ExternalAreaEditor({
  candidate,
  onCommit,
  onCancel,
  onApply,
  onToast,
}: {
  candidate: CandidateLeaf;
  onCommit: () => void;
  onCancel: () => void;
  onApply: (leaf: CandidateLeaf) => void;
  onToast: (msg: string, kind: 'success' | 'error' | 'warning' | 'info') => void;
}) {
  // 드래그 성공 시 candidate (클론) 이 직접 mutate 되므로 React 가 변경을
  // 알아채도록 version 카운터를 bump.
  const [version, setVersion] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [lastResult, setLastResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 드래그 viewport bbox — 외부 영역 bbox + padding. drag 가 외곽으로 가도
  // 그 자리가 viewport 안에 들어와야 시각적으로 확인 가능.
  const viewBbox = useMemo(() => computeEditorViewBbox(candidate.external.bbox), [candidate, version]);

  const chests = candidate.external.containers.filter((c) => c.externalOrigin);

  // contentName → color (chest 종류별로 시각 구분)
  const sortedContents = useMemo(() => {
    const set = new Set<string>();
    for (const c of chests) if (c.content) set.add(c.content);
    return [...set].sort();
  }, [chests, version]);

  // 마우스 글로벌 핸들러 — drag 중에만 활성.
  useEffect(() => {
    if (!drag) return;
    function onMove(e: MouseEvent) {
      setDrag((d) => (d ? { ...d, mouseX: e.clientX, mouseY: e.clientY } : d));
    }
    function onUp(e: MouseEvent) {
      handleDrop(e.clientX, e.clientY);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    // 의도적으로 drag.chestId 만 deps. drag 객체 자체가 매 mousemove 마다 새로
    // 만들어지면 effect 가 매번 재구독되어 이벤트가 깜빡거림. chestId 가 같으면
    // 같은 drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.chestId]);

  function handleStartDrag(chest: Container, e: React.MouseEvent) {
    if (!chest.externalOrigin) return;
    e.preventDefault();
    setDrag({
      chestId: chest.id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      mouseX: e.clientX,
      mouseY: e.clientY,
      startCellX: chest.externalOrigin.x,
      startCellY: chest.externalOrigin.y,
    });
  }

  function handleDrop(clientX: number, clientY: number) {
    const d = drag;
    setDrag(null);
    if (!d) return;
    const target = clientToCell(clientX, clientY, containerRef.current, viewBbox);
    if (!target || (target.x === d.startCellX && target.y === d.startCellY)) {
      return; // 같은 자리 / viewport 밖 — no-op
    }
    const result = dragExternalContainer(
      d.chestId,
      target,
      candidate.internal,
      candidate.external,
      candidate.routings,
      ROUTING_OPTIONS,
    );
    if (result.ok) {
      setVersion((v) => v + 1);
      setLastResult({ ok: true, msg: `→ (${target.x},${target.y}) · 라우팅 ${result.rerouted.length}개 재시도` });
      onToast('드래그 성공 — 라우팅 재시도 완료', 'success');
    } else {
      const reason = result.reason === 'collision' ? '셀 충돌' : result.reason === 'no-port-pair' ? '포트 매칭 실패' : '경로 없음';
      setLastResult({ ok: false, msg: `→ (${target.x},${target.y}) — ${reason}` });
      onToast(`드래그 실패 — ${reason}`, 'warning');
    }
  }

  // 통합 미리보기 cells
  const previewCells = useMemo(
    () => unifyAreas(candidate.internal, candidate.external).placed,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidate, version],
  );

  const gridW = viewBbox.w * EDITOR_CELL_SIZE;
  const gridH = viewBbox.h * EDITOR_CELL_SIZE;

  return (
    <div className="mt-2 border border-purple-700/60 bg-purple-950/20 rounded p-2 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-purple-200">
          📦 외부 영역 편집 — 무한상자를 드래그해서 위치를 바꿀 수 있습니다 (라우팅 자동 재시도)
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onApply(candidate)}
            className="bg-green-700 hover:bg-green-600 text-white text-[11px] px-2 py-1 rounded"
            title="현재 편집 상태 그대로 그리드에 적용"
          >
            그리드에 바로 적용
          </button>
          <button
            onClick={onCommit}
            className="bg-purple-600 hover:bg-purple-500 text-white text-[11px] px-2 py-1 rounded"
          >
            이 후보에 반영
          </button>
          <button
            onClick={onCancel}
            className="bg-gray-700 hover:bg-gray-600 text-gray-200 text-[11px] px-2 py-1 rounded"
          >
            취소
          </button>
        </div>
      </div>

      <div className="flex gap-3 items-start">
        {/* 외부 영역 그리드 */}
        <div className="flex-shrink-0">
          <div className="text-[10px] text-gray-400 mb-1">외부 좌표계 (드래그)</div>
          <div
            ref={containerRef}
            className="relative bg-gray-900 border border-gray-700 rounded overflow-hidden select-none"
            style={{ width: gridW, height: gridH }}
          >
            {/* grid lines */}
            <svg className="absolute inset-0 pointer-events-none" width={gridW} height={gridH}>
              {Array.from({ length: viewBbox.w + 1 }).map((_, i) => (
                <line
                  key={`v${i}`}
                  x1={i * EDITOR_CELL_SIZE}
                  y1={0}
                  x2={i * EDITOR_CELL_SIZE}
                  y2={gridH}
                  stroke="#262633"
                  strokeWidth={1}
                />
              ))}
              {Array.from({ length: viewBbox.h + 1 }).map((_, i) => (
                <line
                  key={`h${i}`}
                  x1={0}
                  y1={i * EDITOR_CELL_SIZE}
                  x2={gridW}
                  y2={i * EDITOR_CELL_SIZE}
                  stroke="#262633"
                  strokeWidth={1}
                />
              ))}
              {/* 좌표 (0,0) 강조 */}
              {0 - viewBbox.x >= 0 && 0 - viewBbox.x < viewBbox.w && 0 - viewBbox.y >= 0 && 0 - viewBbox.y < viewBbox.h && (
                <rect
                  x={(0 - viewBbox.x) * EDITOR_CELL_SIZE}
                  y={(0 - viewBbox.y) * EDITOR_CELL_SIZE}
                  width={EDITOR_CELL_SIZE}
                  height={EDITOR_CELL_SIZE}
                  fill="#3b1456"
                  fillOpacity={0.4}
                />
              )}
            </svg>

            {/* chests */}
            {chests.map((c) => {
              const isDragging = drag?.chestId === c.id;
              const baseX = (c.externalOrigin!.x - viewBbox.x) * EDITOR_CELL_SIZE;
              const baseY = (c.externalOrigin!.y - viewBbox.y) * EDITOR_CELL_SIZE;
              const offX = isDragging ? drag.mouseX - drag.startMouseX : 0;
              const offY = isDragging ? drag.mouseY - drag.startMouseY : 0;
              const color = c.content ? getContentColor(c.content, sortedContents) : 0x556677;
              const isPipe = c.kind === 'infinity-pipe';
              return (
                <div
                  key={c.id}
                  onMouseDown={(e) => handleStartDrag(c, e)}
                  className={`absolute ${isDragging ? 'cursor-grabbing z-50 shadow-lg ring-2 ring-purple-300' : 'cursor-grab z-10'} ${isPipe ? 'rounded-full' : 'rounded-sm'} flex items-center justify-center text-[8px] text-black/80 font-mono`}
                  style={{
                    left: baseX + offX,
                    top: baseY + offY,
                    width: EDITOR_CELL_SIZE - 2,
                    height: EDITOR_CELL_SIZE - 2,
                    margin: 1,
                    backgroundColor: `#${color.toString(16).padStart(6, '0')}`,
                    transition: isDragging ? 'none' : 'left 0.1s, top 0.1s',
                  }}
                  title={`${c.id} · ${c.content ?? ''} · 외부(${c.externalOrigin!.x},${c.externalOrigin!.y}) · 통합(${c.origin.x},${c.origin.y})`}
                >
                  {abbreviateContent(c.content)}
                </div>
              );
            })}
          </div>
        </div>

        {/* 통합 좌표계 미리보기 */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-gray-400 mb-1">통합 좌표계 미리보기 (drag 결과 라우팅 즉시 반영)</div>
          <GridPreview cells={previewCells} size={Math.max(180, gridH)} />
        </div>
      </div>

      {/* 상태 라인 */}
      <div className="text-[10px] font-mono">
        {lastResult ? (
          <span className={lastResult.ok ? 'text-green-300' : 'text-amber-300'}>
            마지막 시도: {lastResult.ok ? '✓' : '✗'} {lastResult.msg}
          </span>
        ) : (
          <span className="text-gray-500">아직 드래그 시도가 없습니다 — chest 를 끌어서 새 자리에 놓으세요.</span>
        )}
      </div>
    </div>
  );
}

interface DragState {
  chestId: string;
  startMouseX: number;
  startMouseY: number;
  mouseX: number;
  mouseY: number;
  startCellX: number;
  startCellY: number;
}

interface ViewBbox { x: number; y: number; w: number; h: number }

function computeEditorViewBbox(bbox: { x: number; y: number; w: number; h: number } | undefined): ViewBbox {
  if (!bbox) {
    return { x: -EDITOR_VIEWPORT_PAD, y: -EDITOR_VIEWPORT_PAD, w: EDITOR_VIEWPORT_PAD * 2 + 1, h: EDITOR_VIEWPORT_PAD * 2 + 1 };
  }
  return {
    x: bbox.x - EDITOR_VIEWPORT_PAD,
    y: bbox.y - EDITOR_VIEWPORT_PAD,
    w: bbox.w + EDITOR_VIEWPORT_PAD * 2,
    h: bbox.h + EDITOR_VIEWPORT_PAD * 2,
  };
}

/** clientX/Y 를 외부 좌표계 셀 좌표로 변환. viewport 밖이면 null. */
function clientToCell(
  clientX: number,
  clientY: number,
  el: HTMLElement | null,
  viewBbox: ViewBbox,
): { x: number; y: number } | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const relX = clientX - rect.left;
  const relY = clientY - rect.top;
  if (relX < 0 || relY < 0 || relX >= rect.width || relY >= rect.height) return null;
  const cellX = Math.floor(relX / EDITOR_CELL_SIZE) + viewBbox.x;
  const cellY = Math.floor(relY / EDITOR_CELL_SIZE) + viewBbox.y;
  return { x: cellX, y: cellY };
}

function getContentColor(content: string, sortedContents: string[]): number {
  return getDynamicEntityColor(content, sortedContents);
}

function abbreviateContent(content: string | undefined): string {
  if (!content) return '?';
  // "iron-plate" → "Ip", "copper-ore" → "Co". 첫 글자 대문자 + 다음 단어 첫 글자.
  const parts = content.split(/[-_ ]/);
  if (parts.length >= 2) return (parts[0][0] ?? '?').toUpperCase() + (parts[1][0] ?? '').toLowerCase();
  return content.slice(0, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// 후보 트리 안에서 candidate id 매칭 노드를 새 클론으로 교체
// ─────────────────────────────────────────────────────────────────────────────

function replaceCandidateInTree<T extends CandidateNode>(
  node: T,
  targetId: string,
  replacement: CandidateLeaf,
): T {
  if (node.kind === 'candidate' && node.id === targetId) {
    return replacement as unknown as T;
  }
  if (node.children.length === 0) return node;
  let changed = false;
  const newChildren = node.children.map((c) => {
    const r = replaceCandidateInTree(c, targetId, replacement);
    if (r !== c) changed = true;
    return r;
  });
  if (!changed) return node;
  return { ...node, children: newChildren };
}
