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
 * **본 패널이 *아직* 다루지 않는 부분 (UI follow-up):**
 *  - 노드 클릭 → 그리드에 부분 블루프린트 적용 (현재는 후보 리스트의 클릭만 지원).
 *  - 실패 가지 토글 (Q30 c).
 *  - 자식 머신 / 외부 포트 / 무한상자 드래그 (Q22, Q23, Q24).
 *  - 외부 영역과 내부 영역의 통합 (= merge step). 현재는 두 영역의 cells 를
 *    각자 좌표대로 그대로 그리드에 깐다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLayoutStore } from '../store/layoutStore';
import { useToastStore } from '../store/toastStore';
import { runContainerWizard } from '../utils/autoLayout/containerWizard';
import { unifyAreas } from '../utils/autoLayout/areaUnification';
import type {
  AreaSnapshot,
  CandidateLeaf,
  CandidateNode,
  CandidateTree,
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
}: {
  result: ContainerWizardResult;
  onApply: (leaf: CandidateLeaf) => void;
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
