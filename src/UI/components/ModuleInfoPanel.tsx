/**
 * ModuleInfoPanel — 그리드에서 선택된 "모듈"(자족 클러스터)의 정보를 보여주는
 * 비차단 플로팅 패널. 모듈 이름표(레시피 라벨) 클릭이 useModuleInspectStore.open(key)
 * 를 호출해 열린다. 모달이 아니라 캔버스 위에 떠 있어, 열어둔 채로 그 모듈을 계속
 * 편집/드래그할 수 있다.
 *
 * 데이터는 collectModules()(적용된 배치에서 유도) + recipeMap/entityMap 로 조합.
 */

import { useEffect, type ReactNode } from 'react';
import { useModuleInspectStore } from '../store/moduleInspectStore';
import { useAutoLayoutRunStore, overlayView } from '../store/autoLayoutRunStore';
import { useGameDataStore } from '../store/gameDataStore';
import { type ModulePortCell } from '../../autoLayout/moduleInspect';
import { useWizardStore } from '../store/wizardStore';
import type { LayoutIssue } from '../../autoLayout/layoutIssue';

export default function ModuleInfoPanel() {
  const moduleKey = useModuleInspectStore((s) => s.moduleKey);
  const close = useModuleInspectStore((s) => s.close);
  // 적용된 배치가 바뀌면(재생성·초기화) 재계산.
  const appliedLayout = useAutoLayoutRunStore((s) => s.appliedLayout);
  const recipeMap = useGameDataStore((s) => s.recipeMap);
  const entityMap = useGameDataStore((s) => s.entityMap);

  useEffect(() => {
    if (!moduleKey) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moduleKey, close]);

  // 배치가 사라지면(재생성 시작·초기화) 패널도 닫는다.
  useEffect(() => {
    if (moduleKey && !appliedLayout) close();
  }, [moduleKey, appliedLayout, close]);

  if (!moduleKey) return null;

  // 성공·실패 공용 목록 — 실패한 모듈도 **정상과 같은 경로로** 열린다.
  const mod = overlayView().modules.find((m) => m.key === moduleKey);
  if (!mod) return null;

  const recipe = mod.recipe ? recipeMap.get(mod.recipe) : undefined;
  const machineLabel = mod.machineEntityName
    ? (entityMap.get(mod.machineEntityName)?.localised_name || mod.machineEntityName)
    : '—';
  const title = recipe?.localised_name || mod.recipe || mod.key;

  const inputPorts = mod.ports.filter((p) => p.role === 'input').length;
  const outputPorts = mod.ports.filter((p) => p.role === 'output').length;
  const bad = mod.status === 'problem';

  return (
    <div className={`absolute top-3 right-3 z-40 w-80 bg-gray-900/95 border rounded-lg shadow-2xl text-xs overflow-hidden pointer-events-auto flex flex-col max-h-[calc(100vh-8rem)] ${bad ? 'border-red-600/70' : 'border-amber-600/70'}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-950 shrink-0">
        <h3 className={`font-bold flex items-center gap-1.5 truncate ${bad ? 'text-red-300' : 'text-amber-300'}`}>
          <span className={`w-2 h-2 rounded-sm shrink-0 ${bad ? 'bg-red-400' : 'bg-amber-400'}`} />
          <span className="truncate" title={title}>{title}</span>
        </h3>
        <button
          onClick={close}
          className="text-gray-500 hover:text-gray-200 text-lg leading-none shrink-0 ml-2"
          title="닫기 (Esc)"
        >
          ×
        </button>
      </div>

      <div className="px-3 py-2.5 space-y-2 text-gray-300 overflow-y-auto">
        <IssueSection issues={mod.issues} />

        <Row label="레시피" value={mod.recipe ?? '—'} mono />
        <Row label="머신" value={`${machineLabel} × ${mod.machineCount}`} />
        <Row label="포트" value={
          <span>
            <span className="text-blue-400">입력 {inputPorts}</span>
            <span className="text-gray-600"> · </span>
            <span className="text-red-400">출력 {outputPorts}</span>
          </span>
        } />

        {recipe && recipe.ingredients.length > 0 && (
          <ItemList title="입력 품목" color="text-blue-300" items={recipe.ingredients} />
        )}
        {recipe && recipe.products.length > 0 && (
          <ItemList title="출력 품목" color="text-red-300" items={recipe.products} />
        )}

        {mod.ports.length > 0 && (
          <div className="pt-1 border-t border-gray-800">
            <div className="text-amber-300 font-semibold mb-1">포트 산출 근거</div>
            <div className="space-y-1.5">
              {mod.ports.map((p, i) => (
                <PortCard key={i} port={p} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 포트 하나의 산출 근거 카드 — 좌표(현재 라우팅 끝점, 그리드) + 생성 시점 결정
 * (planner 슬롯 3축: 면/레인/인서터, 끝 선호, 트렁크 seed 점수). meta 없는 포트
 * (비모듈 폴백 경로)는 좌표만 표시.
 */
function PortCard({ port }: { port: ModulePortCell }) {
  const m = port.meta;
  const isInput = port.role === 'input';
  const roleColor = isInput ? 'text-blue-400' : 'text-red-400';
  const borderColor = isInput ? 'border-blue-900/60' : 'border-red-900/60';
  return (
    <div className={`rounded border ${borderColor} bg-gray-950/60 px-2 py-1.5 space-y-1`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`${roleColor} font-semibold shrink-0`}>{isInput ? '▸ 입력' : '◂ 출력'}</span>
        <span className="font-mono text-[11px] text-gray-200 truncate" title={m?.item ?? ''}>
          {m?.item ?? '(메타 없음)'}
        </span>
      </div>
      <MiniRow k="포트 셀" v={`(${port.x}, ${port.y})`} />
      <MiniRow k="상대 끝점" v={`(${port.peer.x}, ${port.peer.y})`} title={port.peerId} />
      {m && (
        <>
          <MiniRow
            k="슬롯 배정"
            v={`면 ${m.side} · 레인 depth ${m.laneDepth} · ${m.inserter === 'long' ? '긴팔' : '일반'} 인서터`}
          />
          {m.amount !== undefined && <MiniRow k="운반량" v={`${m.amount}/craft (레인 매칭 수요)`} />}
          <MiniRow
            k="끝 선호"
            v={m.endPreference ? (m.endPreference === 'min' ? 'min (위)' : 'max (아래)') : '없음'}
          />
        </>
      )}
    </div>
  );
}

function MiniRow({ k, v, title }: { k: string; v: string; title?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-gray-500 w-14 shrink-0">{k}</span>
      <span className="font-mono text-[11px] text-gray-300 truncate" title={title ?? v}>{v}</span>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-gray-500 w-10 shrink-0">{label}</span>
      <span className={`text-gray-200 truncate ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</span>
    </div>
  );
}

function ItemList({
  title, color, items,
}: {
  title: string;
  color: string;
  /** 재료 또는 산출물. 산출물은 범위 수량(amount_min/max)이라 amount 가 없을 수 있다. */
  items: { name: string; amount?: number; type: 'item' | 'fluid' }[];
}) {
  return (
    <div className="pt-1 border-t border-gray-800">
      <div className={`${color} font-semibold mb-1`}>{title}</div>
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={`${it.type}:${it.name}`} className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-gray-300 truncate" title={it.name}>
              {it.type === 'fluid' ? '🜄 ' : ''}{it.name}
            </span>
            <span className="text-gray-500 shrink-0">×{it.amount ?? '?'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 이 모듈에 걸린 문제 — **처방까지 함께** 보여준다.
 *
 * `fixStep` 이 있으면 그 위저드 단계로 바로 보낸다. 사유만 보여 주고 "어디로 가서
 * 뭘 고치라" 를 안 말하면, 목록을 읽고도 다음 동작을 사용자가 다시 추론해야 한다.
 */
function IssueSection({ issues }: { issues: readonly LayoutIssue[] }) {
  const setStep = useWizardStore((s) => s.setStep);
  if (issues.length === 0) return null;
  return (
    <div className="space-y-1">
      {issues.map((i, n) => {
        const warn = i.severity === 'warning';
        return (
          <div
            key={`${i.code}-${n}`}
            className={`rounded px-2 py-1.5 border ${warn
              ? 'bg-amber-900/20 border-amber-700/50 text-amber-200'
              : 'bg-red-900/20 border-red-700/50 text-red-200'}`}
          >
            <div className="flex items-start gap-1.5">
              <span className="shrink-0 font-mono opacity-70">{warn ? '⚠' : '✗'}</span>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider opacity-60">{i.scope}</div>
                <div className="leading-snug break-words">{i.detail}</div>
                {i.recoverable === false && i.carrier === 'fluid' && (
                  <div className="text-[10px] opacity-60 mt-0.5">물러설 곳이 없었습니다 — 유체는 탐색 폴백이 없습니다.</div>
                )}
              </div>
            </div>
            {i.fixStep && (
              <button
                onClick={() => setStep(i.fixStep!)}
                className="mt-1.5 text-[10px] px-2 py-0.5 rounded border border-current/40 hover:bg-white/10 transition-colors"
              >
                {FIX_STEP_LABEL[i.fixStep]} 단계로
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

const FIX_STEP_LABEL: Record<NonNullable<LayoutIssue['fixStep']>, string> = {
  recipe: '1. 레시피',
  machine: '2. 머신',
  inserter: '3. 투입기',
  belt: '4. 벨트',
  pipe: '5. 파이프',
};
