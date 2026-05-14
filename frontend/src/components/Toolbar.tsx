import { useRef, useCallback, useState } from 'react';
import { exportBlueprint, importBlueprint } from '../utils/blueprintCodec';
import { useLayoutStore } from '../store/layoutStore';
import { useGameDataStore } from '../store/gameDataStore';
import { useToastStore } from '../store/toastStore';
import { parseGameData } from '../utils/parseGameData';
import { useI18nStore, useT } from '../i18n';
import type { BlueprintEntity } from '../types/blueprint';
import { EntityType } from '../types/layout';
import type { GridCell, Direction } from '../types/layout';
import { modulesToInsertPlans, insertPlansToModules } from '../utils/blueprintItemsCodec';
import { entityTypeFromFactorioType } from '../utils/entityCategory';
import AutoLayoutModal from './AutoLayoutModal';
// 빌드타임에 lua export 스크립트를 문자열로 번들 (단일 source-of-truth)
import luaExportScript from '../../../scripts/export-gamedata.min.lua?raw';

export default function Toolbar() {
  const t = useT();
  const language = useI18nStore((s) => s.language);
  const setLanguage = useI18nStore((s) => s.setLanguage);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const gameDataFileRef = useRef<HTMLInputElement>(null);
  const grid = useLayoutStore((s) => s.grid);
  const { fillGridFromCells, clearGrid, undo, redo } = useLayoutStore.getState();
  const gameDataLoaded = useGameDataStore((s) => s.loaded);
  const gameDataRecipeCount = useGameDataStore((s) => s.recipes.length);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importInput, setImportInput] = useState('');
  const [importError, setImportError] = useState('');
  const [gameDataStatus, setGameDataStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [gameDataError, setGameDataError] = useState('');
  const [gameDataErrorModalOpen, setGameDataErrorModalOpen] = useState(false);
  const [autoLayoutModalOpen, setAutoLayoutModalOpen] = useState(false);

  const handleExport = useCallback(() => {
    const entities: BlueprintEntity[] = [];
    let entityNumber = 1;
    const seen = new Set<string>();
    const entityMap = useGameDataStore.getState().entityMap;

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.cells[y * grid.width + x];
        if (!cell || cell.entityId === null || !cell.isOrigin) continue;
        if (seen.has(cell.entityId)) continue;
        seen.add(cell.entityId);

        // Phase 2: 모듈 → BlueprintInsertPlan[]
        const proto = cell.entityName ? entityMap.get(cell.entityName) : undefined;
        const insertPlans = modulesToInsertPlans(cell.modules, proto?.type ?? '');

        // Factorio blueprint position = 엔티티 footprint 의 기하 중심 (좌상단 + size/2)
        const tw = proto?.tile_width ?? 1;
        const th = proto?.tile_height ?? 1;

        entities.push({
          entity_number: entityNumber++,
          name: cell.entityName ?? 'assembling-machine-2',
          position: { x: x + tw / 2, y: y + th / 2 },
          direction: cell.direction,
          ...(cell.recipe ? { recipe: cell.recipe } : {}),
          ...(insertPlans ? { items: insertPlans } : {}),
          // underground-belt 의 input/output 구분 (Factorio blueprint format).
          ...(cell.undergroundType ? { type: cell.undergroundType } : {}),
          // Phase 1 passthrough
          ...(cell.quality ? { quality: cell.quality } : {}),
          ...(cell.mirror ? { mirror: cell.mirror } : {}),
          ...(cell.tags ? { tags: cell.tags } : {}),
        });
      }
    }

    const blueprintStr = exportBlueprint({
      blueprint: {
        item: 'blueprint',
        label: 'Factorio Layout Generator Export',
        entities,
        icons: [],
        // Factorio 2.0.x.x. 우리 내부 direction 이 이미 2.0 16-방향 인코딩이므로
        // 1.x version 을 박아 Factorio 가 ×2 자동 업그레이드하게 두는 hack 은 제거.
        version: 562949953421312,
      },
    });

    const blob = new Blob([blueprintStr], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'blueprint.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [grid]);

  const handleImportString = useCallback((str: string) => {
    try {
      const wrapper = importBlueprint(str.trim());
      const bp = wrapper.blueprint;
      if (!bp || !bp.entities) {
        alert('Blueprint has no entities.');
        return;
      }

      const entityMap = useGameDataStore.getState().entityMap;

      // 내부 Direction 은 Factorio 2.0 16-방향 인코딩 (cardinal 0/4/8/12).
      // 1.x 블루프린트(0..7) 는 ×2 로 업그레이드하면 정확히 2.0 의 동일 방위에 매핑됨 (정보 손실 없음).
      // 감지: version 필드가 2.0 미만이면 1.x 로 간주.
      const FACTORIO_2_VERSION = 562949953421312; // 2 << 48
      const isLegacyV1 =
        typeof bp.version === 'number' && bp.version < FACTORIO_2_VERSION;
      const normalizeDir = (d: number | undefined): Direction => {
        const raw = d ?? 0;
        const v2 = isLegacyV1 ? raw * 2 : raw;
        // cardinal 4방향만 현재 지원 — sub-cardinal(곡선 레일 등)은 가장 가까운 cardinal 로 round.
        const card = Math.round(v2 / 4) * 4;
        return (((card % 16) + 16) % 16) as Direction;
      };

      const sizeOf = (name: string) => {
        const proto = entityMap.get(name);
        return {
          tw: proto?.tile_width ?? 1,
          th: proto?.tile_height ?? 1,
          proto,
        };
      };

      // Factorio blueprint position 은 엔티티 중심 → 좌상단으로 변환
      const toTopLeft = (e: { name: string; position: { x: number; y: number } }) => {
        const { tw, th } = sizeOf(e.name);
        return {
          x: Math.round(e.position.x - tw / 2),
          y: Math.round(e.position.y - th / 2),
        };
      };

      // top-left 좌표를 한 번 계산해서 재사용 + 좌상단 정렬용 minX/minY 추적
      const placements = bp.entities.map((e) => {
        const tl = toTopLeft(e);
        const { tw, th, proto } = sizeOf(e.name);
        return { e, tl, tw, th, proto };
      });

      // 좌상단(0,0) 정렬: 모든 엔티티 footprint 의 최소 좌표를 0 으로 시프트.
      // Factorio 블루프린트는 종종 음수 좌표나 원점에서 떨어진 좌표를 가지므로,
      // import 시 항상 좌상단으로 끌어와 일관된 시작점을 보장한다.
      let minX = Infinity, minY = Infinity;
      for (const p of placements) {
        if (p.tl.x < minX) minX = p.tl.x;
        if (p.tl.y < minY) minY = p.tl.y;
      }
      if (!isFinite(minX)) { minX = 0; minY = 0; }
      for (const p of placements) {
        p.tl.x -= minX;
        p.tl.y -= minY;
      }

      let maxX = 0, maxY = 0;
      for (const p of placements) {
        if (p.tl.x + p.tw > maxX) maxX = p.tl.x + p.tw;
        if (p.tl.y + p.th > maxY) maxY = p.tl.y + p.th;
      }
      const w = Math.max(256, maxX + 4);
      const h = Math.max(256, maxY + 4);

      const cells: GridCell[] = Array.from({ length: w * h }, () => ({
        entityId: null,
        entityName: null,
        entityType: EntityType.Empty,
        direction: 0 as const,
        tileOffset: { x: 0, y: 0 },
        isOrigin: false,
      }));

      for (const { e, tl, tw, th, proto } of placements) {
        const { x, y } = tl;
        if (x < 0 || y < 0 || x + tw > w || y + th > h) continue;

        const slotCount = proto?.module_slots ?? 0;
        const modules =
          slotCount > 0 && Array.isArray(e.items)
            ? insertPlansToModules(e.items, proto?.type ?? '', slotCount)
            : undefined;

        const entityType = proto?.type
          ? entityTypeFromFactorioType(proto.type)
          : EntityType.Chest;
        const direction = normalizeDir(e.direction);
        const entityIdStr = String(e.entity_number);

        // direction 에 따른 회전 — 게임 데이터의 tile_width/height 는 N 기준
        // E(4) / W(12) 일 때만 width/height swap.
        const rotated = direction === 4 || direction === 12;
        const rw = rotated ? th : tw;
        const rh = rotated ? tw : th;

        for (let dy = 0; dy < rh; dy++) {
          for (let dx = 0; dx < rw; dx++) {
            const idx = (y + dy) * w + (x + dx);
            const isOrigin = dx === 0 && dy === 0;
            // underground-belt 의 input/output 구분만 보존. pipe-to-ground 등
            // 다른 entity 의 'input-output' / 누락된 type 은 무시.
            const undergroundType =
              isOrigin && proto?.type === 'underground-belt' && (e.type === 'input' || e.type === 'output')
                ? e.type
                : undefined;
            cells[idx] = {
              entityId: entityIdStr,
              entityName: e.name,
              entityType,
              direction,
              tileOffset: { x: dx, y: dy },
              isOrigin,
              ...(isOrigin && e.recipe ? { recipe: e.recipe } : {}),
              ...(isOrigin && modules ? { modules } : {}),
              ...(isOrigin && e.quality ? { quality: e.quality } : {}),
              ...(undergroundType ? { undergroundType } : {}),
              ...(isOrigin && e.mirror ? { mirror: e.mirror } : {}),
              ...(isOrigin && e.tags ? { tags: e.tags } : {}),
            };
          }
        }
      }

      fillGridFromCells(cells, w, h);
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
    }
  }, [fillGridFromCells]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handleImportString(reader.result as string);
    reader.readAsText(file);
    e.target.value = '';
  }, [handleImportString]);

  const openImportModal = useCallback(() => {
    setImportInput('');
    setImportError('');
    setImportModalOpen(true);
  }, []);

  const handleModalImport = useCallback(() => {
    if (!importInput.trim()) {
      setImportError(t('importModal.emptyError'));
      return;
    }
    try {
      handleImportString(importInput.trim());
      setImportModalOpen(false);
      setImportInput('');
      setImportError('');
    } catch (err) {
      setImportError((err as Error).message);
    }
  }, [importInput, handleImportString, t]);

  function friendlyGameDataError(raw: string): { summary: string; detail: string; hint: string } {
    if (raw.includes('JSON')) {
      return {
        summary: t('gameDataErrorModal.parseError.summary'),
        detail: t('gameDataErrorModal.parseError.detail'),
        hint: t('gameDataErrorModal.parseError.hint'),
      };
    }
    if (raw.includes('recipes') || raw.includes('machines')) {
      return {
        summary: t('gameDataErrorModal.formatError.summary'),
        detail: t('gameDataErrorModal.formatError.detail'),
        hint: t('gameDataErrorModal.formatError.hint'),
      };
    }
    return {
      summary: t('gameDataErrorModal.unknownError.summary'),
      detail: raw,
      hint: t('gameDataErrorModal.unknownError.hint'),
    };
  }

  const handleGameDataFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(reader.result as string);
        const gameData = parseGameData(raw);
        useGameDataStore.getState().setGameData(gameData);

        // 새로 로드된 entityMap에 없는 stale 선택은 초기화
        const layoutStore = useLayoutStore.getState();
        if (
          layoutStore.selectedEntityName &&
          !gameData.entities.some((x) => x.name === layoutStore.selectedEntityName)
        ) {
          layoutStore.setSelectedEntity(EntityType.Empty, '');
        }

        setGameDataStatus('success');
        setGameDataError('');
        setTimeout(() => setGameDataStatus('idle'), 3000);
      } catch (err) {
        setGameDataStatus('error');
        setGameDataError((err as Error).message);
        setGameDataErrorModalOpen(true);
      }
    };
    reader.readAsText(file);
  }, []);

  // Lua 스크립트 클립보드 복사
  const handleCopyLuaScript = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(luaExportScript);
      useToastStore.getState().show(t('toolbar.copyLuaSuccess'), 'success');
    } catch {
      // navigator.clipboard 실패 시 임시 textarea fallback
      try {
        const ta = document.createElement('textarea');
        ta.value = luaExportScript;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        useToastStore.getState().show(t('toolbar.copyLuaSuccess'), 'success');
      } catch {
        useToastStore.getState().show(t('toolbar.copyLuaFailed'), 'warning');
      }
    }
  }, [t]);


  return (
    <header className="flex items-center gap-2 px-4 py-2 bg-gray-900 border-b border-gray-700 shrink-0">
      <span className="text-orange-400 font-bold text-lg mr-4 whitespace-nowrap">
        Factorio Layout Generator
      </span>

      {/* Game data upload */}
      <div className="flex items-center gap-2 border-r border-gray-600 pr-3 mr-1">
        <button
          onClick={handleCopyLuaScript}
          title={t('toolbar.copyLuaTooltip')}
          aria-label={t('toolbar.copyLuaTooltip')}
          className="toolbar-btn px-2 text-base leading-none"
        >
          📋
        </button>
        <button
          onClick={() => gameDataFileRef.current?.click()}
          title={t('toolbar.loadGameDataTooltip')}
          className="toolbar-btn"
        >
          {t('toolbar.loadGameData')}
        </button>
        <input
          ref={gameDataFileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleGameDataFile}
        />
        {gameDataStatus === 'success' && (
          <span className="text-green-400 text-xs">
            ✓ {t('toolbar.recipesLoaded', { count: gameDataRecipeCount })}
          </span>
        )}
        {gameDataStatus === 'error' && (
          <button
            onClick={() => setGameDataErrorModalOpen(true)}
            className="text-red-400 text-xs hover:text-red-300 underline underline-offset-2"
          >
            ✗ {t('toolbar.loadFailed')}
          </button>
        )}
        {gameDataStatus === 'idle' && gameDataLoaded && (
          <span className="text-gray-500 text-xs">
            {t('toolbar.recipeCount', { count: gameDataRecipeCount })}
          </span>
        )}
      </div>

      {/* Blueprint actions */}
      <div className="flex items-center gap-1 border-r border-gray-600 pr-3 mr-1">
        <button
          onClick={openImportModal}
          title={t('toolbar.importTooltip')}
          className="toolbar-btn"
        >
          {t('toolbar.import')}
        </button>
        <button
          onClick={handleExport}
          title={t('toolbar.exportTooltip')}
          className="toolbar-btn"
        >
          {t('toolbar.export')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.blueprint"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Import modal */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-white font-bold text-base">{t('importModal.title')}</h2>
              <button
                onClick={() => setImportModalOpen(false)}
                className="text-gray-500 hover:text-gray-300 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <p className="text-gray-400 text-sm">
              {t('importModal.description')}
            </p>

            <textarea
              autoFocus
              value={importInput}
              onChange={(e) => { setImportInput(e.target.value); setImportError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleModalImport(); }}
              placeholder="0eNqt..."
              rows={5}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-100 text-xs font-mono resize-none focus:outline-none focus:border-orange-500"
            />

            {importError && (
              <p className="text-red-400 text-xs">{importError}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setImportModalOpen(false)}
                className="text-sm text-gray-400 hover:text-gray-200 px-4 py-1.5"
              >
                {t('importModal.cancel')}
              </button>
              <button
                onClick={handleModalImport}
                className="bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold px-5 py-1.5 rounded-lg transition-colors"
              >
                {t('importModal.import')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game data error modal */}
      {gameDataErrorModalOpen && (() => {
        const { summary, detail, hint } = friendlyGameDataError(gameDataError);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-gray-900 border border-red-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-red-400 text-xl">✗</span>
                  <h2 className="text-white font-bold text-base">{summary}</h2>
                </div>
                <button
                  onClick={() => setGameDataErrorModalOpen(false)}
                  className="text-gray-500 hover:text-gray-300 text-xl leading-none shrink-0"
                >
                  ×
                </button>
              </div>

              <p className="text-red-300 text-sm">{detail}</p>

              <div className="bg-gray-800 rounded-lg px-4 py-3 text-sm text-gray-300">
                <p className="text-gray-500 text-xs mb-1">{t('gameDataErrorModal.solution')}</p>
                {hint}
              </div>

              <div className="bg-gray-800 rounded-lg px-4 py-3 text-xs text-gray-400 space-y-1">
                <p className="text-gray-500 mb-1">{t('gameDataErrorModal.exportCommand')}</p>
                <code className="block text-[10px] text-gray-300 break-all leading-relaxed">
                  {'/c local o={recipes={},machines={}} for n,r in pairs(prototypes.recipe) do local i={} for _,v in pairs(r.ingredients) do i[#i+1]={type=v.type,name=v.name,amount=v.amount} end local p={} for _,v in pairs(r.products) do p[#p+1]={type=v.type,name=v.name,amount=v.amount,probability=v.probability} end o.recipes[#o.recipes+1]={name=n,category=r.category,energy=r.energy,enabled=r.enabled,ingredients=i,products=p} end for n,e in pairs(prototypes.entity) do if e.crafting_categories then o.machines[#o.machines+1]={name=n,type=e.type,crafting_speed=e.get_crafting_speed(),module_slots=e.module_inventory_size,energy_usage=e.energy_usage,width=e.tile_width,height=e.tile_height} end end helpers.write_file("factorio-data.json",helpers.table_to_json(o))'}
                </code>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => setGameDataErrorModalOpen(false)}
                  className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-5 py-1.5 rounded-lg transition-colors"
                >
                  {t('gameDataErrorModal.close')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit actions */}
      <div className="flex items-center gap-1 border-r border-gray-600 pr-3 mr-1">
        <button onClick={undo} title={t('toolbar.undoTooltip')} className="toolbar-btn">
          {t('toolbar.undo')}
        </button>
        <button onClick={redo} title={t('toolbar.redoTooltip')} className="toolbar-btn">
          {t('toolbar.redo')}
        </button>
        <button
          onClick={clearGrid}
          title={t('toolbar.clearTooltip')}
          className="toolbar-btn text-red-400 hover:text-red-300"
        >
          {t('toolbar.clear')}
        </button>
      </div>

      {/* Auto-layout (experimental) */}
      <div className="flex items-center gap-1 border-r border-gray-600 pr-3 mr-1">
        <button
          onClick={() => setAutoLayoutModalOpen(true)}
          title={t('toolbar.autoLayoutTooltip')}
          className="toolbar-btn text-purple-300 hover:text-purple-200"
        >
          {t('toolbar.autoLayout')}
        </button>
      </div>

      <AutoLayoutModal
        open={autoLayoutModalOpen}
        onClose={() => setAutoLayoutModalOpen(false)}
      />

      {/* Status / info */}
      <div className="ml-auto flex items-center gap-3">
        <div className="text-xs text-gray-500">
          {t('toolbar.tileCount', { width: grid.width, height: grid.height })}
        </div>

        {/* Language selector */}
        <div className="flex items-center gap-1 text-xs border border-gray-700 rounded overflow-hidden">
          <button
            onClick={() => setLanguage('en')}
            className={`px-2 py-1 transition-colors ${
              language === 'en' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            EN
          </button>
          <button
            onClick={() => setLanguage('ko')}
            className={`px-2 py-1 transition-colors ${
              language === 'ko' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            한국어
          </button>
        </div>
      </div>
    </header>
  );
}
