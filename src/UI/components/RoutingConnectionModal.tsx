import { useEffect } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import type { RoutingSessionRouting } from '../store/layoutStore';
import type { Container } from '../../autoLayout/containerModel';

interface Props {
  open: boolean;
  onClose: () => void;
}

function kindLabel(kind: Container['kind']): string {
  if (kind === 'machine') return '조립기계';
  if (kind === 'infinity-chest') return '무한 상자';
  return '무한 파이프';
}

function portKindLabel(portKind: RoutingSessionRouting['portKind']): string {
  if (portKind === 'item') return '아이템 (벨트)';
  if (typeof portKind === 'object' && 'fluid' in portKind) return `유체 — ${portKind.fluid}`;
  return String(portKind);
}

function ioRole(
  routing: RoutingSessionRouting,
  container: Container,
  extIds: Set<string>,
): string | null {
  if (!extIds.has(container.id)) return null;
  return container.id === routing.fromContainerId ? '입력 (Input)' : '출력 (Output)';
}

function ContainerCard({
  container,
  role,
  label,
}: {
  container: Container;
  role: string | null;
  label: string;
}) {
  const isExternal = container.kind !== 'machine';
  const borderColor = isExternal
    ? role === '입력 (Input)'
      ? 'border-blue-600'
      : 'border-red-600'
    : 'border-teal-600';
  const badgeColor = isExternal
    ? role === '입력 (Input)'
      ? 'bg-blue-900 text-blue-300'
      : 'bg-red-900 text-red-300'
    : 'bg-teal-900 text-teal-300';

  return (
    <div className={`rounded-lg border ${borderColor} bg-gray-800 p-3 flex flex-col gap-1.5`}>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badgeColor} uppercase tracking-wide`}>
          {kindLabel(container.kind)}
        </span>
        {role && (
          <span className="text-[10px] text-gray-400">{role}</span>
        )}
        <span className="ml-auto text-[10px] text-gray-500">{label}</span>
      </div>

      <div className="text-xs text-gray-200 font-mono truncate" title={container.entityName}>
        {container.entityName}
      </div>

      {container.recipeName && (
        <div className="text-[11px] text-orange-300">
          레시피: <span className="font-medium">{container.recipeName}</span>
        </div>
      )}

      {container.content && (
        <div className="text-[11px] text-yellow-300">
          내용물: <span className="font-medium">{container.content}</span>
        </div>
      )}

      <div className="text-[10px] text-gray-500 mt-0.5">
        위치 ({container.origin.x}, {container.origin.y}) &nbsp;|&nbsp;
        크기 {container.size.w}×{container.size.h}
      </div>
    </div>
  );
}

export default function RoutingConnectionModal({ open, onClose }: Props) {
  const session = useLayoutStore((s) => s.routingEditSession);
  const selectedRoutingId = useLayoutStore((s) => s.selectedRoutingId);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || !session || !selectedRoutingId) return null;

  const routing = session.routings.find((r) => r.id === selectedRoutingId);
  if (!routing) return null;

  const containerMap = new Map(session.containers.map((c) => [c.id, c]));
  const fromC = containerMap.get(routing.fromContainerId);
  const toC   = containerMap.get(routing.toContainerId);
  if (!fromC || !toC) return null;

  const extIds = new Set(session.containers.filter((c) => c.kind !== 'machine').map((c) => c.id));
  const fromRole = ioRole(routing, fromC, extIds);
  const toRole   = ioRole(routing, toC,   extIds);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 flex flex-col overflow-hidden"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700 bg-gray-950">
          <h2 className="text-white font-bold text-sm flex items-center gap-2">
            <span className="text-purple-400">⇌</span>
            연결선 정보
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* 전송 종류 */}
        <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/60 text-[11px] text-gray-400 flex items-center gap-2">
          <span className="text-gray-600">전송 방식</span>
          <span className="text-white font-medium">{portKindLabel(routing.portKind)}</span>
        </div>

        {/* 컨테이너 카드 */}
        <div className="p-4 flex flex-col gap-2">
          <ContainerCard container={fromC} role={fromRole} label="From" />

          <div className="text-center text-gray-600 text-lg leading-none select-none">↓</div>

          <ContainerCard container={toC} role={toRole} label="To" />
        </div>
      </div>
    </div>
  );
}
