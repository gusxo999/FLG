import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light';
export type GridOverlay = 'none' | 'lines' | 'dots';

interface Settings {
  theme: Theme;
  gridOverlay: GridOverlay;
  showEntityLabels: boolean;
  showRecipeIcons: boolean;
  /** Tile size in pixels at zoom=1 */
  baseTileSize: number;
  /** Whether to snap entities to grid automatically */
  snapToGrid: boolean;
  /** Show chunk boundaries (32x32 tile chunks) */
  showChunkBoundaries: boolean;
  /** Sidebar width in pixels */
  sidebarWidth: number;
}

interface SettingsState extends Settings {
  setTheme: (theme: Theme) => void;
  setGridOverlay: (overlay: GridOverlay) => void;
  toggleEntityLabels: () => void;
  toggleRecipeIcons: () => void;
  setBaseTileSize: (size: number) => void;
  toggleSnapToGrid: () => void;
  toggleChunkBoundaries: () => void;
  setSidebarWidth: (px: number) => void;
  resetToDefaults: () => void;
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  gridOverlay: 'lines',
  showEntityLabels: true,
  showRecipeIcons: true,
  baseTileSize: 32,
  snapToGrid: true,
  showChunkBoundaries: false,
  sidebarWidth: 256,
};

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 600;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,

      setTheme: (theme) => set({ theme }),
      setGridOverlay: (gridOverlay) => set({ gridOverlay }),
      toggleEntityLabels: () =>
        set((s) => ({ showEntityLabels: !s.showEntityLabels })),
      toggleRecipeIcons: () =>
        set((s) => ({ showRecipeIcons: !s.showRecipeIcons })),
      setBaseTileSize: (baseTileSize) => set({ baseTileSize }),
      toggleSnapToGrid: () => set((s) => ({ snapToGrid: !s.snapToGrid })),
      toggleChunkBoundaries: () =>
        set((s) => ({ showChunkBoundaries: !s.showChunkBoundaries })),
      setSidebarWidth: (px) =>
        set({ sidebarWidth: Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, px)) }),
      resetToDefaults: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'factorio-layout-settings',
    }
  )
);
