/**
 * 배치 링크 — 배치 하나를 **주소 하나**에 담는다(`<앱 주소>#layout=<문자열>`).
 *
 * ## 왜 있나
 *
 * 사람에게 형태를 보일 때는 앱으로 한다 — 대화 · 문서에 2차원 글 그림을 쓰지 않는다(2026-10-16 사용자).
 * 링크가 그 글 그림의 자리를 대신한다: 링크가 배치를 **담고 있으므로** 대화나 문서에 붙여 둔 그 자리에서 누르면
 * 그때 그 배치가 뜬다. 따로 챙길 파일이 없다(`tempPlanDocs/CLI-앱/CLAUDE.md` 결정 기록).
 *
 * ## 무엇을 싣나 — 자기 완결
 *
 * 칸만으로는 못 그리고 못 잰다 — 크기 · 속도 · 집는 점은 프로토타입에 있다. 그래서 **이 배치가 쓰는 프로토타입만**
 * 함께 싣는다. 브라우저의 게임데이터가 무엇이든(없어도) 같은 화면 · 같은 가동률이 나온다. 가동률의 인서터 운반량
 * (`inserterOverrides`)과 안쪽 경계(`interiorBbox`)는 측정 조건이라 함께 간다 — 빠지면 게임 값으로 재서 다른 답이 나온다.
 *
 * **뜻은 `#` 뒤에만 있다.** 앞부분(앱 주소)은 앱을 옮기면 갈아 끼운다. `#` 뒤는 서버로 가지 않는다.
 *
 * ## 형식 버전
 *
 * `v` 를 올릴 때는 **옛 판을 읽는 코드를 남긴다** — 문서 · 대화 속 링크가 계속 열려야 한다.
 *
 * 순수 모듈이다 — 스토어를 모른다. 브라우저(`openInApp.ts`)와 CLI(`cli/`)가 함께 부른다.
 */

import pako from 'pako';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../blueprint/blueprintCodec';
import { entityTypeFromFactorioType } from '../factorio/entityCategory';
import type { Entity, GameData, Module, Recipe } from '../types/gameData';
import { createEmptyCell, createEmptyGrid, type Direction, type GridCell, type LayoutGrid } from '../types/layout';

/** 주소에서 배치를 찾는 열쇠 — `#layout=…`. */
export const LAYOUT_LINK_KEY = 'layout';

/** 칸 위에 쓰는 글 — 줄 이름(`a1`) · 가리키기(`여기`). */
export interface LayoutLinkLabel {
  x: number;
  y: number;
  text: string;
}

export interface LayoutLinkPayload {
  v: 1;
  title?: string;
  /** 이 배치가 쓰는 프로토타입만. `custom` 표시는 지운다 — 링크에서는 원천이 따로 없다. */
  entities: Entity[];
  recipes: Recipe[];
  modules?: Module[];
  /** 가동률을 잴 때의 인서터 운반량(이름 → 값). 지을 때 쓴 값과 같아야 같은 답이 나온다. */
  inserterOverrides?: Record<string, { throughput?: number; stackSize?: number }>;
  /** 블루프린트 안쪽 경계 — 이 안의 무한상자는 밖과 못 잇는다. 없으면 모든 상자를 바깥 포트로 본다. */
  interiorBbox?: { x: number; y: number; w: number; h: number } | null;
  /** 빈칸이 아닌 칸 전부 — `[x, y, 칸]`. 그리드 좌표(0 부터). */
  cells: Array<[number, number, GridCell]>;
  labels?: LayoutLinkLabel[];
}

// ─── 문자열 ↔ 배치 ───────────────────────────────────────────────────────────

/** 배치 → `#layout=` 뒤에 붙일 문자열(압축 + base64url). */
export function encodeLayoutLink(p: LayoutLinkPayload): string {
  const bytes = pako.deflate(new TextEncoder().encode(JSON.stringify(p)), { level: 9 });
  return uint8ArrayToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 앱 주소 + 배치 → 링크. 앱 주소는 `http://localhost:5173/` 처럼 `#` 앞까지. */
export function layoutLinkUrl(appBase: string, p: LayoutLinkPayload): string {
  return `${appBase.replace(/#.*$/, '')}#${LAYOUT_LINK_KEY}=${encodeLayoutLink(p)}`;
}

/** 링크 전체나 `#` 뒤 · 문자열만 받아 배치로. 못 읽으면 **까닭을 담아** 던진다. */
export function decodeLayoutLink(text: string): LayoutLinkPayload {
  const s = text.trim();
  const m = s.match(new RegExp(`[#&]${LAYOUT_LINK_KEY}=([A-Za-z0-9_-]+)`));
  const token = m ? m[1] : s.replace(new RegExp(`^${LAYOUT_LINK_KEY}=`), '');
  if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new Error(`배치 링크가 아니다 — '#${LAYOUT_LINK_KEY}=' 뒤의 문자열을 못 찾았다`);
  let json: string;
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    json = pako.inflate(base64ToUint8Array(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), { to: 'string' });
  } catch (e) {
    throw new Error(`배치 링크를 풀지 못했다 — 잘렸거나 바뀐 문자열이다 (${(e as Error).message ?? e})`);
  }
  const p = JSON.parse(json) as Partial<LayoutLinkPayload>;
  if (p.v !== 1) throw new Error(`배치 링크 형식 버전 ${String(p.v)} 을 이 앱이 모른다(아는 것: 1)`);
  if (!Array.isArray(p.cells) || !Array.isArray(p.entities) || !Array.isArray(p.recipes)) {
    throw new Error('배치 링크에 칸 · 프로토타입이 없다');
  }
  return p as LayoutLinkPayload;
}

// ─── 그리드 ↔ 배치 ───────────────────────────────────────────────────────────

const stripCustom = <T extends object>(o: T): T => {
  if (!('custom' in o)) return o;
  const { custom: _custom, ...rest } = o as T & { custom?: unknown };
  void _custom;
  return rest as T;
};

/**
 * 그리드 → 배치. 쓰인 이름의 프로토타입 · 레시피 · 모듈을 `lookup` 에서 골라 싣는다.
 * `lookup` 에 없는 이름은 `missing` 으로 돌려준다 — 조용히 빼지 않는다(그 칸은 그려도 못 잰다).
 */
export function payloadFromGrid(
  grid: Readonly<LayoutGrid>,
  lookup: { entityMap: Map<string, Entity>; recipeMap: Map<string, Recipe>; moduleMap: Map<string, Module> },
  extras: Pick<LayoutLinkPayload, 'title' | 'inserterOverrides' | 'interiorBbox' | 'labels'> = {},
): { payload: LayoutLinkPayload; missing: string[] } {
  const cells: LayoutLinkPayload['cells'] = [];
  const entityNames = new Set<string>();
  const recipeNames = new Set<string>();
  const moduleNames = new Set<string>();
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const c = grid.cells[y * grid.width + x];
      if (!c?.entityId) continue;
      cells.push([x, y, c]);
      if (c.entityName) entityNames.add(c.entityName);
      if (c.recipe) recipeNames.add(c.recipe);
      for (const m of c.modules ?? []) if (m) moduleNames.add(m.name);
    }
  }
  // 인서터 운반량은 이 배치에 놓인 이름만 — 위저드에는 다른 판의 보정이 남아 있을 수 있다.
  const overrides = Object.fromEntries(
    Object.entries(extras.inserterOverrides ?? {}).filter(([name]) => entityNames.has(name)),
  );
  const missing: string[] = [];
  const pick = <T extends object>(names: Set<string>, map: Map<string, T>): T[] =>
    [...names].sort().flatMap((n) => {
      const v = map.get(n);
      if (!v) missing.push(n);
      return v ? [stripCustom(v)] : [];
    });
  const payload: LayoutLinkPayload = {
    v: 1,
    ...(extras.title ? { title: extras.title } : {}),
    entities: pick(entityNames, lookup.entityMap),
    recipes: pick(recipeNames, lookup.recipeMap),
    ...(moduleNames.size > 0 ? { modules: pick(moduleNames, lookup.moduleMap) } : {}),
    ...(Object.keys(overrides).length > 0 ? { inserterOverrides: overrides } : {}),
    ...(extras.interiorBbox ? { interiorBbox: extras.interiorBbox } : {}),
    cells,
    ...(extras.labels && extras.labels.length > 0 ? { labels: extras.labels } : {}),
  };
  return { payload, missing };
}

/**
 * 배치 → 그리드. 크기는 칸이 다 들어가고 오른쪽 · 아래에 한 칸 여유. 음수 좌표나 한 칸에 두 칸이 오면 던진다
 * — 잘라 내면 *"열었는데 칸 몇 개가 사라진"* 배치가 된다.
 */
export function gridFromPayload(p: Readonly<LayoutLinkPayload>): LayoutGrid {
  let w = 1;
  let h = 1;
  for (const [x, y] of p.cells) {
    if (x < 0 || y < 0) throw new Error(`음수 좌표 칸 (${x},${y}) — 좌표는 0 부터다`);
    w = Math.max(w, x + 2);
    h = Math.max(h, y + 2);
  }
  const grid = createEmptyGrid(w, h);
  const seen = new Set<number>();
  for (const [x, y, cell] of p.cells) {
    const i = y * w + x;
    if (seen.has(i)) throw new Error(`한 칸에 둘 — (${x},${y})`);
    seen.add(i);
    grid.cells[i] = cell;
  }
  return grid;
}

/** 배치에 실린 프로토타입 — 가동률 검사(`analyzeLayout`)가 받는 모양. */
export function prototypesOf(p: Readonly<LayoutLinkPayload>): {
  entityMap: Map<string, Entity>;
  recipeMap: Map<string, Recipe>;
  moduleMap: Map<string, Module>;
} {
  return {
    entityMap: new Map(p.entities.map((e) => [e.name, e])),
    recipeMap: new Map(p.recipes.map((r) => [r.name, r])),
    moduleMap: new Map((p.modules ?? []).map((m) => [m.name, m])),
  };
}

/** 배치에 실린 프로토타입 — 브라우저 게임데이터 스토어(`setGameData`)가 받는 모양. */
export function gameDataOf(p: Readonly<LayoutLinkPayload>): GameData {
  return {
    entities: p.entities.map(stripCustom),
    recipes: p.recipes.map(stripCustom),
    modules: p.modules ?? [],
    technologies: [],
  };
}

// ─── 손으로 놓기 ─────────────────────────────────────────────────────────────

/** 엔티티 하나를 놓는 말 — 칸 단위가 아니라 엔티티 단위(머신은 위 왼쪽 한 번). */
export interface Placement {
  x: number;
  y: number;
  name: string;
  /** 0 · 4 · 8 · 12 (북 · 동 · 남 · 서) 또는 'N' · 'E' · 'S' · 'W'. 인서터는 **집는 쪽**이다(앱 · 게임 규약). */
  dir?: Direction | 'N' | 'E' | 'S' | 'W';
  recipe?: string;
  /** 지하벨트 · 지하파이프의 입구 · 출구. */
  ug?: 'input' | 'output';
  /** 무한상자 — 이 품목들을 내준다. */
  supply?: string[];
  /** 무한상자 — 들어오는 것을 다 버린다. */
  sink?: boolean;
}

const DIR: Record<string, Direction> = { N: 0, E: 4, S: 8, W: 12 };

/**
 * 엔티티 단위의 놓기 → 칸. 머신 크기는 프로토타입의 `tile_width` · `tile_height`(동 · 서를 보면 둘을 바꾼다 —
 * `factorio/entitySize.getEntitySizeRotated` 와 같은 규칙). 칸 종류는 사이드바 놓기와 같은 매핑
 * (`factorio/entityCategory.entityTypeFromFactorioType`).
 */
export function cellsOfPlacements(
  placements: ReadonlyArray<Placement>,
  entityMap: Map<string, Entity>,
): { cells: LayoutLinkPayload['cells']; problems: string[] } {
  const cells: LayoutLinkPayload['cells'] = [];
  const problems: string[] = [];
  placements.forEach((pl, i) => {
    const proto = entityMap.get(pl.name);
    if (!proto) {
      problems.push(`${i}번 (${pl.x},${pl.y}) ${pl.name} — 프로토타입이 없다`);
      return;
    }
    const dir: Direction = typeof pl.dir === 'string' ? DIR[pl.dir] : (pl.dir ?? 0);
    if (dir === undefined) {
      problems.push(`${i}번 (${pl.x},${pl.y}) ${pl.name} — 방향 '${String(pl.dir)}' 을 모른다(N · E · S · W 또는 0 · 4 · 8 · 12)`);
      return;
    }
    const turned = dir === 4 || dir === 12;
    const w = (turned ? proto.tile_height : proto.tile_width) || 1;
    const h = (turned ? proto.tile_width : proto.tile_height) || 1;
    const entityType = entityTypeFromFactorioType(proto.type);
    const infinitySettings = pl.sink
      ? { remove_unfiltered_items: true, filters: [] }
      : pl.supply?.length
        ? {
            remove_unfiltered_items: false,
            filters: pl.supply.map((name, k) => ({ index: k + 1, name, count: 100, mode: 'at-least' as const })),
          }
        : undefined;
    const id = `${pl.name}#${i}`;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const cell: GridCell = {
          ...createEmptyCell(),
          entityId: id,
          entityName: pl.name,
          entityType,
          direction: dir,
          tileOffset: { x: dx, y: dy },
          isOrigin: dx === 0 && dy === 0,
          ...(pl.recipe ? { recipe: pl.recipe } : {}),
          ...(pl.ug ? { undergroundType: pl.ug } : {}),
          ...(infinitySettings ? { infinitySettings } : {}),
        };
        cells.push([pl.x + dx, pl.y + dy, cell]);
      }
    }
  });
  return { cells, problems };
}
