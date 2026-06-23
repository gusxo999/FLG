/**
 * Visualization — 함수 호출 트리 사이드바.
 *
 * TraceStep[] 으로 만든 호출 트리를 "레시피 트리처럼" 중첩 들여쓰기로 그린다.
 * 현재 재생 중인 단계 노드를 하이라이트하고, 클릭하면 그 단계로 점프한다.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { TraceStep } from '../../utils/autoLayout/containerModel';
import { buildFunctionTree, type FunctionTreeNode } from '../../utils/autoLayout/visualization/functionTree';

interface FunctionTreeSidebarProps {
  steps: TraceStep[];
  currentOrder: number;
  onSelect: (order: number) => void;
}

export default function FunctionTreeSidebar({
  steps,
  currentOrder,
  onSelect,
}: FunctionTreeSidebarProps) {
  const tree = useMemo(() => buildFunctionTree(steps), [steps]);

  return (
    <div className="h-full overflow-y-auto px-2 py-2 text-[12px] font-mono">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2 px-1">
        함수 호출 트리 ({steps.length} 단계)
      </div>
      {tree.map((node) => (
        <TreeRow
          key={node.step.order}
          node={node}
          depth={0}
          currentOrder={currentOrder}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  currentOrder,
  onSelect,
}: {
  node: FunctionTreeNode;
  depth: number;
  currentOrder: number;
  onSelect: (order: number) => void;
}) {
  const active = node.step.order === currentOrder;
  const rowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [active]);

  // 함수 이름에서 phase 종류를 추론해 색상 배지를 붙인다.
  const name = node.step.functionName;
  const tone = toneFor(name);

  return (
    <>
      <button
        ref={rowRef}
        onClick={() => onSelect(node.step.order)}
        style={{ paddingLeft: depth * 14 + 6 }}
        className={`w-full text-left rounded px-1.5 py-1 my-0.5 flex items-center gap-2 transition-colors ${
          active
            ? 'bg-purple-600/40 border border-purple-400 text-purple-50'
            : 'border border-transparent text-gray-300 hover:bg-gray-700/40'
        }`}
        title={name}
      >
        <span className={`text-[9px] tabular-nums shrink-0 ${active ? 'text-purple-200' : 'text-gray-600'}`}>
          {node.step.order}
        </span>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`} />
        <span className="truncate">{name}</span>
      </button>
      {node.children.map((c) => (
        <TreeRow
          key={c.step.order}
          node={c}
          depth={depth + 1}
          currentOrder={currentOrder}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function toneFor(name: string): { dot: string } {
  if (name.startsWith('coordinate') || name.startsWith('placeMachines'))
    return { dot: 'bg-blue-400' };
  if (
    name.startsWith('channelRouting') ||
    name.startsWith('planChannels') ||
    name.startsWith('trunk') ||
    name.startsWith('route')
  )
    return { dot: 'bg-amber-400' };
  if (name.startsWith('외부 연결')) return { dot: 'bg-teal-300' };
  if (name.startsWith('attach')) return { dot: 'bg-teal-400' };
  if (name.startsWith('wrapExternals')) return { dot: 'bg-green-400' };
  if (name.startsWith('layerAssignment')) return { dot: 'bg-fuchsia-400' };
  if (name === '완료') return { dot: 'bg-green-300' };
  return { dot: 'bg-gray-500' };
}
