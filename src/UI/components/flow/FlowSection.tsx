/**
 * 정보 모달의 **흐름** 섹션 — 머신이면 가동률, 벨트면 그 칸의 레인별 흐름.
 *
 * 둘 다 그리드를 **한 번** 푼 결과(`flowStore.currentFlow`)를 읽는다. 예전 벨트 흐름 섹션은 누를 때마다
 * 그 칸의 상류만 따로 더했고(`analysis/beltFlow`, 삭제), 머신의 초당 산출은 레시피 섹션이 **정격**만
 * 보여 줬다. 둘을 한 범주로 모은 것이 이 파일이다 — 정격은 여기서 실제와 나란히 선다.
 */

import type { ReactNode } from 'react';
import { machineVerdictAt } from '../../../analysis/flow/build';
import type { BeltCellFlow, FlowResult, LaneFlow, MachineVerdict } from '../../../analysis/flow/types';
import { useT } from '../../i18n/index';
import { useCurrentFlow } from '../../store/flowStore';
import { useInspectStore } from '../../store/inspectStore';
import { useLayoutStore } from '../../store/layoutStore';

/** items/sec — 소수 둘째 자리까지, 뒤 0 제거. */
export function fmtRate(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  return n.toFixed(2).replace(/\.?0+$/, '');
}

type T = ReturnType<typeof useT>;

/** 모자란 한 줄 — 화면의 "왜". */
export function limitLabel(v: MachineVerdict, t: T): string | null {
  if (!v.limit) return null;
  const key = v.limit.side === 'input'
    ? (v.limit.by === 'arms' ? 'inputArms' : 'inputBelt')
    : (v.limit.by === 'arms' ? 'outputArms' : 'outputBelt');
  return t(`flow.limit.${key}`, { item: v.limit.item });
}

/**
 * 인스턴스 하나의 흐름 섹션. 캔버스에서 누른 칸이 있으면 그 칸으로, 없으면 인스턴스 id 로 origin 을
 * 찾는다(빈손 모드 머신 클릭은 칸 좌표를 안 싣는다).
 */
export default function FlowSection({ instanceId }: { instanceId: string }) {
  const result = useCurrentFlow();
  const cell = useInspectStore((s) => s.cell);
  const grid = useLayoutStore((s) => s.grid);

  let at = cell;
  if (!at || (!result.belts.has(`${at.x},${at.y}`) && !machineVerdictAt(result, at.x, at.y))) {
    const i = grid.cells.findIndex((c) => c.entityId === instanceId && c.isOrigin);
    at = i >= 0 ? { x: i % grid.width, y: Math.floor(i / grid.width) } : null;
  }
  if (!at) return null;

  const belt = result.belts.get(`${at.x},${at.y}`);
  if (belt) return <BeltFlowView belt={belt} result={result} />;
  const v = machineVerdictAt(result, at.x, at.y);
  if (v) return <MachineFlowView v={v} result={result} />;
  return null;
}

/** 벨트 칸 하나의 흐름 — 연결선 모달처럼 인스턴스 없이 좌표만 아는 곳에서 쓴다. 벨트가 아니면 없다. */
export function BeltFlowAt({ x, y }: { x: number; y: number }) {
  const result = useCurrentFlow();
  const belt = result.belts.get(`${x},${y}`);
  return belt ? <BeltFlowView belt={belt} result={result} /> : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 머신
// ─────────────────────────────────────────────────────────────────────────────

function MachineFlowView({ v, result }: { v: MachineVerdict; result: FlowResult }) {
  const t = useT();
  const badge = v.state === 'full'
    ? { text: t('flow.machine.full'), cls: 'bg-emerald-900/50 text-emerald-300 border-emerald-700/60' }
    : v.state === 'short'
      ? { text: t('flow.machine.short', { pct: Math.min(99, Math.round(v.u * 100)) }), cls: 'bg-red-900/50 text-red-200 border-red-600/70' }
      : { text: t('flow.machine.unknown'), cls: 'bg-orange-900/40 text-orange-200 border-orange-600/60' };
  const why = limitLabel(v, t);
  const shortItem = v.limit?.item;

  return (
    <Frame title={t('flow.machine.title')} badge={badge} approx={!result.converged}>
      {why && <div className="text-red-300">✗ {why}</div>}
      {v.unknown.length > 0 && (
        <div className="text-orange-300/90 text-[11px]">
          ? {v.unknown.map((u) => t(`flow.unknown.${u}`)).join(' · ')}
        </div>
      )}
      {v.inputs.length > 0 && (
        <RateTable
          head={[t('flow.machine.ingredients'), t('flow.machine.got'), t('flow.machine.need')]}
          rows={v.inputs.map((i) => ({ item: i.item, a: i.got, b: i.need, bad: i.item === shortItem && v.limit?.side === 'input' }))}
          unit={t('flow.machine.perSec')}
        />
      )}
      {v.outputs.length > 0 && (
        <RateTable
          head={[t('flow.machine.products'), t('flow.machine.sent'), t('flow.machine.made')]}
          rows={v.outputs.map((o) => ({ item: o.item, a: o.sent, b: o.made, bad: o.item === shortItem && v.limit?.side === 'output' }))}
          unit={t('flow.machine.perSec')}
        />
      )}
      {Number.isFinite(v.craftsPerSec) && (
        <Row label={t('flow.machine.crafts')} value={`${fmtRate(v.craftsPerSec)} ${t('flow.machine.craftsUnit')}`} />
      )}
      {v.assumed && <div className="text-amber-400/80 text-[10px]">⚠ {t('flow.machine.assumed')}</div>}
    </Frame>
  );
}

function RateTable({ head, rows, unit }: {
  head: [string, string, string];
  rows: { item: string; a: number; b: number; bad: boolean }[];
  unit: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-[10px] uppercase tracking-wide text-gray-500">
        <span>{head[0]}</span>
        <span className="text-right">{head[1]}</span>
        <span className="text-right">{head[2]}</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.item}
          className={`grid grid-cols-[1fr_auto_auto] gap-x-3 font-mono text-[11px] ${r.bad ? 'text-red-300' : 'text-gray-200'}`}
        >
          <span className="truncate" title={r.item}>{r.item}</span>
          <span className="text-right">{fmtRate(r.a)}</span>
          <span className="text-right text-gray-400">{Number.isNaN(r.b) ? '?' : fmtRate(r.b)}{unit}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 벨트
// ─────────────────────────────────────────────────────────────────────────────

function BeltFlowView({ belt, result }: { belt: BeltCellFlow; result: FlowResult }) {
  const t = useT();
  const idle = belt.lanes.left.rate === 0 && belt.lanes.right.rate === 0 && belt.taps.every((x) => x.rate === 0);
  return (
    <Frame
      title={<>{t('flow.belt.title')} <span className="text-gray-500 font-normal font-mono">({belt.x}, {belt.y})</span></>}
      approx={!result.converged}
    >
      {idle && <div className="text-gray-500">{t('flow.belt.idle')}</div>}
      <LaneRow label={t('flow.belt.left')} lane={belt.lanes.left} saturated={t('flow.belt.saturated')} />
      <LaneRow label={t('flow.belt.right')} lane={belt.lanes.right} saturated={t('flow.belt.saturated')} />
      {belt.taps.length > 0 && (
        <div className="space-y-0.5 pt-0.5">
          <div className="text-gray-500">{t('flow.belt.taps')}</div>
          {belt.taps.map((tap, i) => (
            <div key={i} className="flex items-baseline justify-between gap-2 pl-2">
              <span className={tap.kind === 'drop' ? 'text-blue-400' : 'text-red-400'}>
                {tap.kind === 'drop' ? '▲' : '▼'} {t(tap.kind === 'drop' ? 'flow.belt.drop' : 'flow.belt.pick')}
                {tap.side && (
                  <span className="text-gray-500"> {t(tap.side === 'left' ? 'flow.belt.toLeft' : 'flow.belt.toRight')}</span>
                )}
              </span>
              <span className="text-gray-200 text-right truncate font-mono">
                {tap.kind === 'drop' ? '+' : '−'}{fmtRate(tap.rate)}/s
                {tap.peerName ? ` · ${tap.peerName}` : ''}
                {tap.refused > 1e-9 && (
                  <span className="text-amber-400"> · {t('flow.belt.refused', { rate: fmtRate(tap.refused) })}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {belt.mixedLane && <div className="text-amber-500/80 text-[10px]">⚠ {t('flow.belt.mixed')}</div>}
    </Frame>
  );
}

function LaneRow({ label, lane, saturated }: { label: string; lane: LaneFlow; saturated: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className={`text-right truncate font-mono ${lane.saturated ? 'text-amber-300' : 'text-gray-200'}`}>
        {fmtRate(lane.rate)} / {fmtRate(lane.capacity)}/s
        {lane.saturated && ` · ${saturated}`}
        {lane.items.length > 0 && (
          <span className="text-gray-400"> · {lane.items.map((x) => x.item).join(', ')}</span>
        )}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 공용
// ─────────────────────────────────────────────────────────────────────────────

function Frame({ title, badge, approx, children }: {
  title: ReactNode;
  badge?: { text: string; cls: string };
  approx: boolean;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="pt-1 border-t border-gray-700 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-emerald-400 font-semibold">{title}</span>
        {badge && <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.text}</span>}
      </div>
      {children}
      <div className="text-gray-600 text-[10px] leading-snug">
        {t('flow.note')}
        {approx && <span className="text-amber-500"> · {t('flow.approx')}</span>}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-200 text-right truncate">{value}</span>
    </div>
  );
}
