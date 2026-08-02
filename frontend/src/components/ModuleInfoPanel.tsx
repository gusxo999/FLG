/**
 * ModuleInfoPanel — 그리드에서 선택된 "모듈"(자족 클러스터)의 정보를 보여주는
 * 비차단 플로팅 패널. 모듈 이름표(레시피 라벨) 클릭이 useModuleInspectStore.open(key)
 * 를 호출해 열린다. 모달이 아니라 캔버스 위에 떠 있어, 열어둔 채로 그 모듈을 계속
 * 편집/드래그할 수 있다.
 *
 * 데이터는 collectModules()(routingEditSession 유도) + recipeMap/entityMap 로 조합.
 */

import { useEffect, type ReactNode } from 'react';
import { useModuleInspectStore } from '../store/moduleInspectStore';
import { useLayoutStore } from '../store/layoutStore';
import { useGameDataStore } from '../store/gameDataStore';
import { collectModules, type ModulePortCell } from '../autoLayout/moduleInspect';

export default function ModuleInfoPanel() {
  const moduleKey = useModuleInspectStore((s) => s.moduleKey);
  const close = useModuleInspectStore((s) => s.close);
  // routingEditSession 변경 시 재계산(드래그·재적용 반영).
  const session = useLayoutStore((s) => s.routingEditSession);
  const recipeMap = useGameDataStore((s) => s.recipeMap);
  const entityMap = useGameDataStore((s) => s.entityMap);

  useEffect(() => {
    if (!moduleKey) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moduleKey, close]);

  // 세션이 사라지면(레이아웃 초기화) 패널도 닫는다.
  useEffect(() => {
    if (moduleKey && !session) close();
  }, [moduleKey, session, close]);

  if (!moduleKey) return null;

  const mod = collectModules().find((m) => m.key === moduleKey);
  if (!mod) return null;

  const recipe = mod.recipe ? recipeMap.get(mod.recipe) : undefined;
  const machineLabel = mod.machineEntityName
    ? (entityMap.get(mod.machineEntityName)?.localised_name || mod.machineEntityName)
    : '—';
  const title = recipe?.localised_name || mod.recipe || mod.key;

  const inputPorts = mod.ports.filter((p) => p.role === 'input').length;
  const outputPorts = mod.ports.filter((p) => p.role === 'output').length;

  return (
    <div className="absolute top-3 right-3 z-40 w-80 bg-gray-900/95 border border-amber-600/70 rounded-lg shadow-2xl text-xs overflow-hidden pointer-events-auto flex flex-col max-h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-950 shrink-0">
        <h3 className="text-amber-300 font-bold flex items-center gap-1.5 truncate">
          <span className="w-2 h-2 rounded-sm bg-amber-400 shrink-0" />
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
