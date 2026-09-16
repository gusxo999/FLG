/**
 * CustomRecipeList — 만든 커스텀을 **보고 지우는** 자리.
 *
 * 편집기와 따로 있는 이유: 만드는 일과 관리하는 일은 들어가는 자리가 다르다. 만들기는
 * 자동배치 1단계(레시피를 고르다 없다는 걸 안 순간)에서 시작하고, 목록은 툴바에서 연다.
 *
 * 삭제는 `customDataStore` 액션 하나다 — 그래서 `flg.custom.remove` 와 같은 일을 한다.
 */

import { useEffect } from 'react';
import { useT } from '../i18n/index';
import { useCustomDataStore } from '../store/customDataStore';
import { useCustomEditorStore } from '../store/customEditorStore';
import { useToastStore } from '../store/toastStore';
import { roleOrdinals } from '../../factorio/customRecipe';

export default function CustomRecipeList() {
  const t = useT();
  const listOpen = useCustomEditorStore((s) => s.listOpen);
  const closeList = useCustomEditorStore((s) => s.closeList);
  const openEditor = useCustomEditorStore((s) => s.openEditor);
  const data = useCustomDataStore((s) => s.data);

  useEffect(() => {
    if (!listOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeList();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listOpen, closeList]);

  if (!listOpen) return null;

  const empty = data.machines.length === 0 && data.recipes.length === 0;

  const copyJson = async () => {
    const json = JSON.stringify(data, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      useToastStore.getState().show(t('customRecipe.exportedToast'), 'success');
    } catch {
      // 클립보드는 권한이 막힐 수 있다 — 그때는 콘솔로 흘리고 명령을 알려 준다.
      console.log(json);
      useToastStore.getState().show('copy(flg.custom.export())', 'warning');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={closeList}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700 bg-gray-950">
          <h2 className="text-white font-bold text-sm">{t('customRecipe.listTitle')}</h2>
          <button onClick={closeList} className="text-gray-500 hover:text-gray-200 text-xl leading-none">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {empty && <p className="text-gray-500">{t('customRecipe.listEmpty')}</p>}

          {data.recipes.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
                {t('customRecipe.listRecipes')}
              </h3>
              <ul className="space-y-1">
                {data.recipes.map((r) => (
                  <li
                    key={r.name}
                    className="flex items-center gap-2 bg-gray-800/40 border border-gray-700 rounded px-2 py-1"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-gray-200">{r.name}</div>
                      <div className="text-gray-500 truncate">
                        {r.category} · {r.energyRequired}s ·{' '}
                        {r.ingredients.map((s) => `${s.amount}×${s.name}`).join(' + ') || '—'} →{' '}
                        {r.products.map((s) => `${s.amount}×${s.name}`).join(' + ') || '—'}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        closeList();
                        openEditor({ editRecipe: r.name });
                      }}
                      className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:border-gray-500"
                    >
                      {t('customRecipe.edit')}
                    </button>
                    <button
                      onClick={() => {
                        useCustomDataStore.getState().removeRecipe(r.name);
                        useToastStore.getState().show(t('customRecipe.deletedToast'), 'success');
                      }}
                      className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-500 hover:border-red-700 hover:text-red-300"
                    >
                      {t('customRecipe.delete')}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.machines.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
                {t('customRecipe.listMachines')}
              </h3>
              <ul className="space-y-1">
                {data.machines.map((m) => {
                  const ins = roleOrdinals(m.fluidBoxes, 'input').size;
                  const outs = roleOrdinals(m.fluidBoxes, 'output').size;
                  return (
                    <li
                      key={m.name}
                      className="flex items-center gap-2 bg-gray-800/40 border border-gray-700 rounded px-2 py-1"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-gray-200">{m.name}</div>
                        <div className="text-gray-500 truncate">
                          {m.size}×{m.size} · ×{m.craftingSpeed} · {m.craftingCategories.join(', ')} ·{' '}
                          <span className="text-sky-400">{t('customRecipe.fluidBoxInput')} {ins}</span>{' '}
                          <span className="text-orange-400">{t('customRecipe.fluidBoxOutput')} {outs}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          useCustomDataStore.getState().removeMachine(m.name);
                          useToastStore.getState().show(t('customRecipe.deletedToast'), 'success');
                        }}
                        className="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-500 hover:border-red-700 hover:text-red-300"
                      >
                        {t('customRecipe.delete')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-gray-800 shrink-0">
          <button
            onClick={copyJson}
            disabled={empty}
            className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:border-gray-600 disabled:opacity-40"
          >
            {t('customRecipe.exportJson')}
          </button>
          <button
            onClick={() => {
              closeList();
              openEditor();
            }}
            className="text-xs px-4 py-1.5 rounded border border-orange-500 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20"
          >
            {t('customRecipe.open')}
          </button>
        </div>
      </div>
    </div>
  );
}
