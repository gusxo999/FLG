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
 *  - 트리 로그는 단순 텍스트 트리 — A 노드/분기점/leaf 라벨만 인라인 표시.
 *
 * **본 패널이 *아직* 다루지 않는 부분 (UI follow-up):**
 *  - 노드 클릭 → 부분 블루프린트 미리보기 (Q31 c).
 *  - 실패 가지 토글 (Q30 c).
 *  - 자식 머신 / 외부 포트 / 무한상자 드래그 (Q22, Q23, Q24).
 *  - 외부 영역과 내부 영역의 통합 (= merge step). 현재는 두 영역의 cells 를
 *    각자 좌표대로 그대로 그리드에 깐다.
 */

import { useRef, useState } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import { useToastStore } from '../store/toastStore';
import { runContainerWizard } from '../utils/autoLayout/containerWizard';
import type {
  CandidateLeaf,
  CandidateTree,
  ContainerWizardInput,
  ContainerWizardResult,
} from '../utils/autoLayout/containerModel';

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
  const abortRef = useRef<AbortController | null>(null);

  async function handleRun() {
    if (!props.targetRecipe) return;
    setRunning(true);
    setResult(null);
    setProgress(null);
    setError(null);

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
    const cells = [
      ...leaf.internal.placed.map((p) => ({ x: p.x, y: p.y, cell: p.cell })),
      ...leaf.external.placed.map((p) => ({ x: p.x, y: p.y, cell: p.cell })),
    ];
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
        Esc 중단 가능. 후보를 클릭하면 그리드에 적용됨. (UI 미완성 부분 多 — 트리
        로그 / 드래그 / 외부 IO 통합 follow-up)
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

      {result && <ResultPanel result={result} onApply={handleApplyCandidate} />}
    </div>
  );
}

function ResultPanel({
  result,
  onApply,
}: {
  result: ContainerWizardResult;
  onApply: (leaf: CandidateLeaf) => void;
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
            후보 ({tree.candidates.length}) — 클릭 시 그리드에 적용
          </div>
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {tree.candidates.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onApply(c)}
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

      <TreeLog tree={tree} />
    </div>
  );
}

function TreeLog({ tree }: { tree: CandidateTree }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      open={expanded}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
      className="text-[10px] text-gray-500 bg-gray-900/40 border border-gray-800 rounded px-2 py-1"
    >
      <summary className="cursor-pointer text-gray-400">
        탐색 트리 로그 (실패 가지 포함)
      </summary>
      <pre className="mt-1 leading-tight font-mono text-gray-400 whitespace-pre overflow-x-auto max-h-48">
        {renderTree(tree.root, 0)}
      </pre>
    </details>
  );
}

function renderTree(
  node: import('../utils/autoLayout/containerModel').CandidateNode,
  depth: number,
): string {
  const indent = '  '.repeat(depth);
  const prefix =
    node.kind === 'machine' ? 'M' :
    node.kind === 'branch' ? 'B' :
    node.kind === 'candidate' ? '✓' :
    '✗';
  const line = `${indent}${prefix} ${node.label}\n`;
  let out = line;
  for (const c of node.children) out += renderTree(c, depth + 1);
  return out;
}
