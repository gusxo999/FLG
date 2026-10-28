/**
 * beltNetwork.ts
 *
 * 그리드의 벨트류 칸(벨트 · 지하벨트 · 분배기)을 **물건이 서로 넘어가는 것끼리** 묶어 "벨트 망"을 낸다.
 * 화면은 한 망을 한 색으로 칠한다 — 파이프 관망 색(`pipeNetwork.ts`)의 벨트판이다.
 *
 * 규칙
 * - 지상의 이어짐은 가동률 검사와 같은 함수로 본다(`flow/graph.upstreamOf`) — 뒤에서 이어짐 · 옆에서 붙음(레인 합류).
 *   정면으로 마주 본 벨트는 잇지 않는다(물건이 안 넘어간다).
 * - 지하 짝은 화면의 터널 선과 같은 짝이다 — `flow/graph.undergroundExitOf` 에 **그 지하벨트의 사거리**를 넘긴다.
 *   가동률 검사는 사거리를 고정 8칸으로 본다(알려진 차이).
 * - 분배기는 두 칸이 한 엔티티라 한 망이다 — 두 줄을 합치고 가른다. 가동률 검사는 분배기를 칸마다 곧은 벨트로 본다.
 * - 인서터가 옮기는 것은 잇지 않는다 — 팔은 벨트 망 밖이다.
 * - 색은 이웃한 다른 망과 겹치지 않게 고른다 — 붙어 있는 두 망이 같은 색이면 이어진 것으로 읽힌다.
 */

import type { Entity } from '../UI/store/gameDataStore';
import { EntityType, type LayoutGrid } from '../types/layout';
import { isBeltLike, undergroundExitOf, upstreamOf } from './flow/graph';
import { NETWORK_PALETTE } from './pipeNetwork';

export interface BeltNetworkResult {
  /** 칸 인덱스(y * width + x) → 망 번호. 벨트류 칸만 들어 있다. */
  networkOf: Map<number, number>;
  /** 망 번호 → 색 (24-bit hex) */
  colorOf: Map<number, number>;
}

export function computeBeltNetworks(
  grid: Readonly<LayoutGrid>,
  entityMap: Map<string, Entity>,
): BeltNetworkResult {
  const { width, height, cells } = grid;

  // ---- Union-Find (칸 인덱스) ----
  const parent = new Map<number, number>();
  for (let i = 0; i < cells.length; i++) if (cells[i] && isBeltLike(cells[i].entityType)) parent.set(i, i);

  function find(i: number): number {
    let r = i;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let cur = i;
    while (parent.get(cur) !== r) {
      const next = parent.get(cur)!;
      parent.set(cur, r);
      cur = next;
    }
    return r;
  }
  function union(a: number, b: number) {
    if (!parent.has(a) || !parent.has(b)) return;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  const splitterCell = new Map<string, number>();
  for (const i of parent.keys()) {
    const c = cells[i];
    const x = i % width;
    const y = Math.floor(i / width);

    // 지상 — 뒤에서 이어짐 · 옆에서 붙음. 지하 짝은 아래에서 따로 잇는다.
    for (const u of upstreamOf(grid, x, y, c)) {
      if (!u.tunnel) union(i, u.y * width + u.x);
    }

    // 지하 짝 — 입구에서 출구로.
    if (c.entityType === EntityType.UndergroundBelt && c.undergroundType === 'input') {
      const reach = c.entityName ? entityMap.get(c.entityName)?.max_underground_distance : undefined;
      const exit = undergroundExitOf(grid, x, y, c, reach);
      if (exit) union(i, exit.y * width + exit.x);
    }

    // 분배기 — 같은 엔티티의 두 칸.
    if (c.entityType === EntityType.Splitter && c.entityId) {
      const first = splitterCell.get(c.entityId);
      if (first === undefined) splitterCell.set(c.entityId, i);
      else union(i, first);
    }
  }

  // ---- 망 번호 — 칸 순서대로 ----
  const rootToId = new Map<number, number>();
  const networkOf = new Map<number, number>();
  for (const i of [...parent.keys()].sort((a, b) => a - b)) {
    const r = find(i);
    let id = rootToId.get(r);
    if (id === undefined) {
      id = rootToId.size;
      rootToId.set(r, id);
    }
    networkOf.set(i, id);
  }

  // ---- 이웃한 망 ----
  const neighbors = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    if (!neighbors.has(b)) neighbors.set(b, new Set());
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);
  };
  for (const [i, id] of networkOf) {
    const x = i % width;
    const y = Math.floor(i / width);
    if (x + 1 < width) {
      const r = networkOf.get(i + 1);
      if (r !== undefined) link(id, r);
    }
    if (y + 1 < height) {
      const d = networkOf.get(i + width);
      if (d !== undefined) link(id, d);
    }
  }

  // ---- 색 — 망 번호 순으로, 이미 색이 정해진 이웃 망이 안 쓰는 첫 색 ----
  const P = NETWORK_PALETTE.length;
  const colorOf = new Map<number, number>();
  for (let id = 0; id < rootToId.size; id++) {
    const used = new Set<number>();
    for (const n of neighbors.get(id) ?? []) {
      const col = colorOf.get(n);
      if (col !== undefined) used.add(col);
    }
    let pick = NETWORK_PALETTE[id % P];
    for (let k = 0; k < P; k++) {
      const col = NETWORK_PALETTE[(id + k) % P];
      if (!used.has(col)) { pick = col; break; }
    }
    colorOf.set(id, pick);
  }

  return { networkOf, colorOf };
}
