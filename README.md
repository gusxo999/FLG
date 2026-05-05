# Factorio Layout Generator

**English** | [한국어](README.ko.md)

A browser-based tool for designing Factorio factory layouts. Place entities on a grid and export them as blueprint strings ready to use in-game.

Runs **fully client-side** with no backend server. Game data and layouts are all stored in localStorage.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Rendering | PixiJS 8 (standalone module, outside React) |
| UI | React 19 + TypeScript |
| State | Zustand (persist middleware → localStorage) |
| Styling | Tailwind CSS v4 |
| Blueprint codec | pako (zlib) + base64 |
| Build | Vite 8 |
| i18n | Lightweight custom i18n (Korean / English) |

### Architecture (Option B)

```
React (UI panels)            PixiJS (canvas rendering)
┌──────────────┐             ┌──────────────────────┐
│ Toolbar.tsx  │             │ pixi-manager.ts      │
│ Sidebar.tsx  │             │  - grid render       │
│ Tutorial.tsx │             │  - place/erase       │
│ GridCanvas   │──mount──▶   │  - hover preview     │
│  (div only)  │             │  - pan/zoom          │
└──────┬───────┘             └──────────┬───────────┘
       │                                │
       └──── zustand store ◄────────────┘
              (layoutStore, gameDataStore, settingsStore, i18nStore)
```

- **React** handles HTML UI panels only (Sidebar, Toolbar, Tutorial)
- **PixiJS** runs as a standalone module in `pixi-manager.ts`, subscribing to `zustand` directly for state changes
- Mouse events → PixiJS handlers → `zustand.getState()` / `setState()` (React not involved)

---

## Requirements

- [Node.js](https://nodejs.org/) 18+

---

## Quick Start

```bash
cd frontend
npm install
npm run dev
```

| URL | Description |
|-----|-------------|
| http://localhost:5173 | Dev server |

### Build

```bash
cd frontend
npm run build     # outputs to dist/
npm run preview   # preview the production build
```

The build is fully static, so it can be deployed directly to Vercel, GitHub Pages, Netlify, etc.

---

## Language Switching

The UI supports both Korean and English. Switch instantly using the **EN / 한국어** buttons on the right side of the toolbar. Your choice is saved to localStorage and persists across visits. On first visit, the browser language is auto-detected.

Translations live in `frontend/src/i18n/`:
- [en.ts](frontend/src/i18n/en.ts) — English
- [ko.ts](frontend/src/i18n/ko.ts) — Korean
- [index.ts](frontend/src/i18n/index.ts) — `t()` function and `useT()` hook

---

## Game Data Export

To load Factorio entity/recipe data into the app:

1. Launch Factorio → load any save → open the console (`~`)
2. Paste the contents of [`scripts/export-gamedata.min.lua`](scripts/export-gamedata.min.lua) into the console
3. `%APPDATA%\Factorio\script-output\factorio-data.json` will be generated
4. In the web app, click **Load Game Data** in the toolbar and select that file

> Script source: [`scripts/export-gamedata.lua`](scripts/export-gamedata.lua) (commented, for editing)

### Extracted Fields

| Category | Entity types | Key fields |
|----------|-------------|-----------|
| Production | assembling-machine, furnace, rocket-silo | crafting_speed, crafting_categories, module_slots, allowed_effects |
| Research / Mining | lab, mining-drill | researching_speed, lab_inputs, mining_speed, resource_categories |
| Logistics | transport-belt, underground-belt, splitter, inserter, pipe, pump | belt_speed, max_underground_distance, inserter_positions |
| Power | electric-pole, solar-panel, accumulator, boiler, generator, reactor | supply_area_distance, max_wire_distance, max_power_output |
| Utility | beacon, roboport, container, logistic-container, radar, lamp | distribution_effectivity, logistic_radius, inventory_size |
| Circuit | arithmetic/decider/constant-combinator, programmable-speaker | common fields only |
| Defense | wall, gate, ammo/electric/fluid-turret | common fields only |
| Rail | straight-rail, curved-rail, train-stop | common fields only |

To add new fields, edit the relevant section in `scripts/export-gamedata.lua` and regenerate the one-liner.

---

## Blueprint Import / Export

Factorio blueprint string format:

```
"0" + base64( zlib_deflate( JSON ) )
```

- Toolbar **Export** → downloads current layout as a `.txt` blueprint file
- Toolbar **Import** → paste a blueprint string to restore it to the grid

---

## Controls

| Input | Action |
|-------|--------|
| Left click | Place entity |
| Shift + Left click | Erase entity |
| Middle click + drag | Pan |
| Scroll | Vertical pan |
| Alt + Scroll | Horizontal pan |
| Ctrl + Scroll | Zoom |
| R | Rotate direction |
| Ctrl + Z | Undo |
| Ctrl + Y | Redo |

---

## Documentation

Developer notes on implementation decisions and data model analysis live in [`docs/`](docs/README.md):

- [fluid-box-semantics.md](docs/fluid-box-semantics.md) — Why `flow_direction` (per-connection) is preferred over `production_type` (per-fluidbox) when visualising pipe I/O
- [map-position-parsing.md](docs/map-position-parsing.md) — 3-layer defensive normalisation for Factorio's ambiguous `MapPosition` shape (keyed vs positional)

---

## Project Structure

```
factorio-LayoutGenerator/
├── docs/                            # Developer design notes
│   ├── README.md                    # Document index
│   ├── fluid-box-semantics.md       # Why flow_direction > production_type for pipe viz
│   └── map-position-parsing.md      # 3-layer defense for MapPosition shape ambiguity
├── scripts/
│   ├── export-gamedata.lua          # Lua export script (commented)
│   └── export-gamedata.min.lua      # One-liner for console paste
├── frontend/
│   ├── src/
│   │   ├── i18n/
│   │   │   ├── index.ts              # Language store, t() / useT()
│   │   │   ├── ko.ts                 # Korean translations
│   │   │   └── en.ts                 # English translations
│   │   ├── pixi/
│   │   │   └── pixi-manager.ts       # PixiJS init, rendering, events
│   │   ├── components/
│   │   │   ├── GridCanvas.tsx        # PixiJS mount wrapper (div + init/destroy)
│   │   │   ├── Toolbar.tsx           # Load data, Import/Export, language switch
│   │   │   ├── Sidebar.tsx           # Entity palette + recipe/machine browser
│   │   │   └── Tutorial.tsx          # First-visit tutorial modal
│   │   ├── store/
│   │   │   ├── layoutStore.ts        # Grid state, viewport, place/erase, history
│   │   │   ├── gameDataStore.ts      # Recipe/machine data (localStorage cache)
│   │   │   ├── settingsStore.ts      # UI settings (theme, grid overlay, etc.)
│   │   │   └── nanoid.ts             # ID generation utility
│   │   ├── types/
│   │   │   ├── layout.ts             # Internal grid/entity type definitions
│   │   │   └── blueprint.ts          # Factorio blueprint JSON schema
│   │   ├── utils/
│   │   │   ├── blueprintCodec.ts     # Blueprint string encode/decode
│   │   │   └── parseGameData.ts      # Game data JSON → store format
│   │   ├── App.tsx                   # Root component + keyboard shortcuts
│   │   └── main.tsx                  # React entry point
│   ├── package.json
│   └── vite.config.ts
├── README.md                         # English README (this file)
└── README.ko.md                      # Korean README
```

---

## Data Storage

All data is stored in the browser's localStorage:

| Key | Contents | Notes |
|-----|----------|-------|
| `factorio-layout-store` | Grid, viewport, selection state | sparse-compressed (empty cells omitted) |
| `factorio-game-data` | Recipe / machine arrays | Updated on file upload |
| `factorio-layout-settings` | UI settings | Theme, grid overlay, etc. |
| `factorio-layout-i18n` | Selected language | `ko` or `en` |
| `factorio-tutorial-done` | Tutorial dismissed flag | Shown only on first visit |

The grid is 256x256 by default, and sparse serialization stores only cells that contain entities — keeping it well within the 5MB localStorage limit.
