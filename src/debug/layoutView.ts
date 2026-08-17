/**
 * layoutView — 마지막 배치 결과를 **좌표로 물어볼 수 있는 모양**으로 만든다.
 *
 * 콘솔 진단이 필요로 하는 것은 언제나 셋이다: *이 칸에 뭐가 있나* · *이 모듈의 머신은
 * 어디까지인가* · *어느 면에 어떤 포트가 붙었나*. `CandidateLeaf` 는 그 답을 다 갖고
 * 있지만 배열 다섯 개에 흩어져 있어, 매번 훑는 코드를 [faceTable]·[checkRules]·
 * `report()` 가 각자 쓰게 된다. 여기서 한 번만 짓는다.
 *
 * ## 그리드가 아니라 결과를 본다
 *
 * `layoutStore.grid` 를 읽으면 **적용된 것만** 보인다 — 6단계 패널이 안 떠 있으면 실행
 * 결과가 그리드에 안 올라가고(적용은 패널의 이펙트가 한다), 사용자가 손으로 고친 셀이
 * 섞이기도 한다. 진단 대상은 *위저드가 만든 것*이므로 결과 leaf 를 본다.
 *
 * **좌표는 그리드 좌표다.** `appliedLayout` 은 이미 넘어와 있고, 아직 적용 전이면
 * `unifyLeaf` 로 여기서 넘긴다 — 읽는 쪽은 프레임을 신경 쓰지 않는다.
 */

import { unifyLeaf } from '../autoLayout/areaUnification';
import type {
  CandidateLeaf,
  Container,
  PlacedCell,
  Routing,
} from '../autoLayout/containerModel';
import { collectModules, type ModuleInfo } from '../autoLayout/moduleInspect';
import { useAutoLayoutRunStore } from '../UI/store/autoLayoutRunStore';
import { EntityType } from '../types/layout';

export type Face = 'W' | 'E' | 'N' | 'S';

export interface ViewCell {
  x: number;
  y: number;
  type: EntityType;
  name: string | null;
  entityId: string | null;
  direction: number;
}

export interface LayoutView {
  leaf: CandidateLeaf;
  /** "x,y" → 셀. internal ∪ external 의 placed 전부. */
  cells: Map<string, ViewCell>;
  modules: ModuleInfo[];
  routings: readonly Routing[];
  containers: readonly Container[];
  /** 모든 placed 셀의 외접 사각형. */
  bbox: { x: number; y: number; w: number; h: number };
}

export const cellKey = (x: number, y: number): string => `${x},${y}`;

/**
 * 지금 볼 수 있는 배치. 없으면 null.
 *
 * 우선순위: **적용된 배치** → 아직 적용 안 된 실행 결과. 둘 다 없으면 안 돌렸거나
 * 실패한 것이다(실패는 배치가 아니라 스냅샷을 남긴다 — `report()` 가 그쪽을 본다).
 */
export function currentLeaf(): CandidateLeaf | null {
  const s = useAutoLayoutRunStore.getState();
  if (s.appliedLayout) return s.appliedLayout;
  const raw = s.result?.tree.candidates[0];
  return raw ? unifyLeaf(raw).leaf : null;
}

let memoKey: CandidateLeaf | null = null;
let memoVal: LayoutView | null = null;

/** 현재 배치의 뷰. 같은 배치면 같은 객체를 돌려준다(모듈 수집 메모가 살아 있게). */
export function currentView(): LayoutView | null {
  const leaf = currentLeaf();
  if (!leaf) return null;
  if (leaf === memoKey && memoVal) return memoVal;

  const cells = new Map<string, ViewCell>();
  const add = (p: PlacedCell) => {
    cells.set(cellKey(p.x, p.y), {
      x: p.x,
      y: p.y,
      type: p.cell.entityType,
      name: p.cell.entityName,
      entityId: p.cell.entityId,
      direction: p.cell.direction,
    });
  };
  for (const p of leaf.internal.placed) add(p);
  for (const p of leaf.external.placed) add(p);

  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const c of cells.values()) {
    if (c.x < x1) x1 = c.x;
    if (c.y < y1) y1 = c.y;
    if (c.x + 1 > x2) x2 = c.x + 1;
    if (c.y + 1 > y2) y2 = c.y + 1;
  }
  const bbox = Number.isFinite(x1)
    ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
    : { x: 0, y: 0, w: 0, h: 0 };

  const containers = [...leaf.internal.containers, ...leaf.external.containers];
  memoKey = leaf;
  memoVal = {
    leaf,
    cells,
    modules: collectModules({ containers, routings: leaf.routings }),
    routings: leaf.routings,
    containers,
    bbox,
  };
  return memoVal;
}

/**
 * 한 모듈의 **머신 블록** — 면(face)의 기준이다.
 *
 * `ModuleInfo.bbox` 를 쓰면 안 된다: 그건 포트 셀까지 삼킨 합집합이라 이미 레인을
 * 포함한다. "머신 서쪽 첫 칸" 을 세려면 머신 footprint 만의 경계가 필요하다.
 */
export function machineBoxOf(
  view: LayoutView,
  key: string,
): { x: number; y: number; w: number; h: number } | null {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const c of view.containers) {
    if (c.kind !== 'machine') continue;
    if (c.id.replace(/-m\d+$/, '') !== key) continue;
    x1 = Math.min(x1, c.origin.x);
    y1 = Math.min(y1, c.origin.y);
    x2 = Math.max(x2, c.origin.x + c.size.w);
    y2 = Math.max(y2, c.origin.y + c.size.h);
  }
  return Number.isFinite(x1) ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}

/**
 * 모듈 키를 느슨하게 찾는다 — 정확 일치 → 부분 일치 → 레시피 이름.
 * 키는 `n0-concrete` 같은 내부 id 라 손으로 정확히 치기 어렵다.
 *
 * **머신 id 를 그대로 줘도 찾힌다.** 좌표 덤프가 찍는 것은 `n0-concrete-m0` 같은 *머신*
 * id 인데 모듈 키는 거기서 `-m0` 을 뗀 것이다 — 덤프에서 복사해 붙이는 것이 가장 흔한
 * 사용이라, 그 차이로 "모듈 없음" 이 뜨면 도구가 쓸모없어진다.
 */
export function findModule(view: LayoutView, q: string): ModuleInfo | null {
  const norm = q.replace(/-m\d+$/, '');
  for (const cand of [q, norm]) {
    const exact = view.modules.find((m) => m.key === cand);
    if (exact) return exact;
  }
  const partial = view.modules.filter((m) => m.key.includes(norm));
  if (partial.length === 1) return partial[0];
  const byRecipe = view.modules.filter((m) => m.recipe === q);
  if (byRecipe.length >= 1) return byRecipe[0];
  return partial[0] ?? null;
}

/** 단면표·검사에서 셀 종류를 4분류로 — 상자 · 인서터 · 운반 · 머신. */
export type CellClass = 'machine' | 'inserter' | 'carrier' | 'chest' | 'other';

export function classOf(t: EntityType): CellClass {
  switch (t) {
    case EntityType.Assembler:
    case EntityType.Furnace:
      return 'machine';
    case EntityType.Inserter:
    case EntityType.LongInserter:
      return 'inserter';
    case EntityType.Belt:
    case EntityType.UndergroundBelt:
    case EntityType.Splitter:
    case EntityType.Pipe:
    case EntityType.PipeUnderground:
      return 'carrier';
    case EntityType.Chest:
    case EntityType.InfinityChest:
    case EntityType.InfinityPipe:
      return 'chest';
    default:
      return 'other';
  }
}

/** 단면표에 쓸 5글자 약칭. 대문자 = 외부(무한) 상자/파이프. */
export function abbrev(t: EntityType): string {
  const map: Partial<Record<EntityType, string>> = {
    [EntityType.Belt]: 'Belt',
    [EntityType.UndergroundBelt]: 'UgBlt',
    [EntityType.Splitter]: 'Split',
    [EntityType.Assembler]: 'Assem',
    [EntityType.Furnace]: 'Furn',
    [EntityType.Pipe]: 'Pipe',
    [EntityType.PipeUnderground]: 'UgPip',
    [EntityType.Inserter]: 'Inser',
    [EntityType.LongInserter]: 'LongI',
    [EntityType.Chest]: 'chest',
    [EntityType.InfinityChest]: 'CHEST',
    [EntityType.InfinityPipe]: 'PIPE',
  };
  return map[t] ?? String(t).slice(0, 5);
}
