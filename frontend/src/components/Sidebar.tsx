import { useState, useMemo, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/shallow';
import { useGameDataStore, type Entity } from '../store/gameDataStore';
import { useLayoutStore } from '../store/layoutStore';
import { useSettingsStore } from '../store/settingsStore';
import { useInspectStore } from '../store/inspectStore';
import { useT } from '../i18n';
import {
  CATEGORIES,
  CATEGORY_TO_TYPES,
  entityTypeFromFactorioType,
  type SidebarCategory,
} from '../utils/entityCategory';
import { allowedSurfaces } from '../utils/surfaceConditions';

type TabKey = SidebarCategory;

// Factorio 2.0 16-방향 인덱스 → 라벨. cardinal 0/4/8/12 만 현재 사용.
const DIRECTION_LABELS: Record<number, string> = {
  0: 'N',  1: 'NNE', 2: 'NE', 3: 'ENE',
  4: 'E',  5: 'ESE', 6: 'SE', 7: 'SSE',
  8: 'S',  9: 'SSW', 10: 'SW', 11: 'WSW',
  12: 'W', 13: 'WNW', 14: 'NW', 15: 'NNW',
};

export default function Sidebar() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<TabKey>('assembler');
  const [filter, setFilter] = useState('');
  const inspect = useInspectStore((s) => s.inspect);

  const sidebarWidth = useSettingsStore((s) => s.sidebarWidth);
  const setSidebarWidth = useSettingsStore((s) => s.setSidebarWidth);
  const resizingRef = useRef(false);

  useEffect(() => {
    function handleMove(e: MouseEvent) {
      if (!resizingRef.current) return;
      setSidebarWidth(e.clientX);
    }
    function handleUp() {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [setSidebarWidth]);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  const {
    selectedEntityName,
    setSelectedEntity,
    selectedDirection,
  } = useLayoutStore(useShallow((s) => ({
    selectedEntityName: s.selectedEntityName,
    setSelectedEntity: s.setSelectedEntity,
    selectedDirection: s.selectedDirection,
  })));

  const { entities, entityMap, loaded } = useGameDataStore(useShallow((s) => ({
    entities: s.entities,
    entityMap: s.entityMap,
    loaded: s.loaded,
  })));

  // 현재 탭 카테고리에 속하는 엔티티 필터링
  const filteredEntities = useMemo(() => {
    const allowedTypes = new Set(CATEGORY_TO_TYPES[activeTab]);
    const pool = entities.filter((e) => allowedTypes.has(e.type));
    if (!filter) return pool;
    const q = filter.toLowerCase();
    return pool.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      (e.localised_name?.toLowerCase().includes(q) ?? false)
    );
  }, [activeTab, entities, filter]);

  const selectedEntity = selectedEntityName ? entityMap.get(selectedEntityName) ?? null : null;
  const directionLabel = DIRECTION_LABELS[selectedDirection] ?? 'N';

  const handleSelectEntity = (entity: Entity) => {
    setSelectedEntity(entityTypeFromFactorioType(entity.type), entity.name);
  };

  return (
    <aside
      className="relative flex flex-col bg-gray-900 border-r border-gray-700 shrink-0 overflow-hidden"
      style={{ width: `${sidebarWidth}px` }}
    >
      {/* 상단 고정: 선택된 엔티티 정보 */}
      <div className="border-b border-gray-700 bg-gray-800 p-2">
        <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <span className="truncate flex-1 min-w-0">
            {t('sidebar.selected')}{' '}
            <span className={selectedEntityName ? 'text-gray-200 font-medium' : 'text-gray-500 italic'}>
              {selectedEntityName || t('sidebar.noneSelected')}
            </span>
            {selectedEntityName && (
              <span className="text-gray-500 ml-1">· {directionLabel}</span>
            )}
          </span>
          <button
            onClick={() => selectedEntityName && inspect(selectedEntityName)}
            disabled={!selectedEntity}
            title={selectedEntity ? t('sidebar.details.openModal') : t('sidebar.details.noSelection')}
            className="shrink-0 text-xs w-5 h-5 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed enabled:bg-blue-700/40 enabled:text-blue-300 enabled:hover:bg-blue-600/60 enabled:hover:text-white"
          >
            ⓘ
          </button>
        </div>
      </div>

      {/* 카테고리 탭 — 그리드로 배치 */}
      <div className="grid grid-cols-3 border-b border-gray-700 text-[10px]">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveTab(cat)}
            className={`py-1.5 transition-colors ${
              activeTab === cat
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {t(`sidebar.categories.${cat}`)}
          </button>
        ))}
      </div>

      {/* 검색 */}
      <div className="p-1.5 border-b border-gray-700">
        <input
          type="text"
          placeholder={t('sidebar.search')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full bg-gray-800 text-white text-xs px-2 py-1 rounded border border-gray-700 focus:outline-none focus:border-orange-500"
        />
      </div>

      {/* 리스트 영역 */}
      <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
        {!loaded && (
          <div className="text-gray-500 text-xs text-center p-4">
            {t('sidebar.loadGamedataFirst')}
          </div>
        )}

        {loaded && filteredEntities.length === 0 && (
          <div className="text-gray-500 text-xs text-center p-4">
            {t('sidebar.noResults')}
          </div>
        )}

        {filteredEntities.map((entity) => {
          const isSelected = selectedEntityName === entity.name;
          const surfaces = allowedSurfaces(entity.surface_conditions);
          const surfaceBadge = surfaces.length === 1 && surfaces[0] === '*' ? null : surfaces.join(', ');
          return (
            <button
              key={entity.id}
              onClick={() => handleSelectEntity(entity)}
              className={`w-full flex flex-col items-start px-2 py-1.5 rounded text-xs text-left transition-colors ${
                isSelected
                  ? 'bg-orange-700 text-white'
                  : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              <span className="font-medium truncate w-full flex items-center gap-1">
                <span className="truncate">{entity.localised_name || entity.name}</span>
                {surfaceBadge && (
                  <span
                    className="shrink-0 text-[9px] px-1 rounded bg-purple-700/40 border border-purple-600/40 text-purple-200"
                    title={surfaceBadge}
                  >
                    {surfaceBadge.length > 14 ? `${surfaces.length}🪐` : surfaceBadge}
                  </span>
                )}
              </span>
              <span className="text-gray-400 text-[10px]">
                {entity.tile_width}×{entity.tile_height}
                {entity.crafting_speed !== undefined && ` · ${entity.crafting_speed}× speed`}
                {entity.belt_speed !== undefined && ` · ${(entity.belt_speed * 480).toFixed(0)} i/s`}
                {entity.mining_speed !== undefined && ` · ${entity.mining_speed}× mine`}
                {entity.max_power_output !== undefined && ` · ${formatEnergyShort(entity.max_power_output)}`}
              </span>
            </button>
          );
        })}
      </div>

      {/* 리사이저 — 오른쪽 가장자리 드래그로 폭 조절 */}
      <div
        onMouseDown={startResize}
        onDoubleClick={() => setSidebarWidth(256)}
        title={t('sidebar.resizeHandle')}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-orange-500/60 active:bg-orange-500 transition-colors"
      />
    </aside>
  );
}

/** energy 값은 J/tick. UI는 W (= J/tick × 60). */
function formatEnergyShort(joulesPerTick: number): string {
  const watts = joulesPerTick * 60;
  if (watts >= 1_000_000) return `${(watts / 1_000_000).toFixed(1)}MW`;
  if (watts >= 1_000) return `${(watts / 1_000).toFixed(0)}kW`;
  return `${watts.toFixed(0)}W`;
}
