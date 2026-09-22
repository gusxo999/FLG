/**
 * 가동률 요약 — 캔버스 칩과 모듈 패널의 한 줄.
 *
 * 테두리를 끄고 켜는 곳이 여기 하나다(`flowStore.showMachines`). 칩은 그리드에 머신이 있을 때만
 * 뜬다 — 자동 배치 결과든 손으로 놓은 것이든 같다(분석이 그리드를 보므로).
 */

import type { FlowResult } from '../../../analysis/flow/types';
import { useT } from '../../i18n/index';
import { useCurrentFlow, useFlowStore } from '../../store/flowStore';
import { useGameDataStore } from '../../store/gameDataStore';

export default function FlowSummary() {
  const t = useT();
  const result = useCurrentFlow();
  const loaded = useGameDataStore((s) => s.loaded);
  const show = useFlowStore((s) => s.showMachines);
  const setShow = useFlowStore((s) => s.setShowMachines);
  const s = result.summary;
  if (s.total === 0) return null;

  return (
    <div
      className="absolute top-2 left-2 z-30 flex items-center gap-2 bg-gray-950/85 border border-gray-700 rounded-lg px-2.5 py-1 text-xs shadow-lg pointer-events-auto"
      title={t('flow.summary.tooltip')}
    >
      <span className="text-gray-400 font-semibold">{t('flow.summary.title')}</span>
      {!loaded ? (
        <span className="text-gray-500">{t('flow.summary.noData')}</span>
      ) : (
        <>
          <span className="text-gray-300">{t('flow.summary.machines', { n: s.total })}</span>
          {s.short === 0 && s.unknown === 0 && (
            <span className="text-emerald-400">{t('flow.summary.allFull')}</span>
          )}
          {s.short > 0 && (
            <span className="text-red-300 font-semibold">✗ {t('flow.summary.short', { n: s.short })}</span>
          )}
          {s.unknown > 0 && (
            <span className="text-orange-300">? {t('flow.summary.unknown', { n: s.unknown })}</span>
          )}
          {!result.converged && <span className="text-amber-500">{t('flow.approx')}</span>}
          <button
            onClick={() => setShow(!show)}
            className={`ml-1 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${
              show
                ? 'border-red-700/60 text-red-200 bg-red-900/30 hover:bg-red-900/50'
                : 'border-gray-600 text-gray-400 hover:text-gray-200'
            }`}
          >
            {show ? t('flow.summary.hide') : t('flow.summary.show')}
          </button>
        </>
      )}
    </div>
  );
}

/** 모듈 패널의 한 줄 — 그 모듈 bbox 안에 origin 이 있는 머신들의 판정. */
export function ModuleFlowRow({ bbox }: { bbox: { x: number; y: number; w: number; h: number } }) {
  const t = useT();
  const result = useCurrentFlow();
  const inside = machinesIn(result, bbox);
  if (inside.length === 0) return null;
  const short = inside.filter((v) => v.state === 'short').length;
  const unknown = inside.filter((v) => v.state === 'unknown').length;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-gray-500 w-10 shrink-0">{t('flow.module.label')}</span>
      <span className={short > 0 ? 'text-red-300' : 'text-emerald-300'}>
        {t('flow.module.value', { n: inside.length, short })}
        {unknown > 0 && <span className="text-orange-300">{t('flow.module.unknownPart', { unknown })}</span>}
      </span>
    </div>
  );
}

function machinesIn(r: FlowResult, b: { x: number; y: number; w: number; h: number }) {
  return r.machines.filter((v) => v.x >= b.x && v.x < b.x + b.w && v.y >= b.y && v.y < b.y + b.h);
}
