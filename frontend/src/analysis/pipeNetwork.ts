/**
 * pipeNetwork.ts
 *
 * 그리드에 배치된 파이프(EntityType.Pipe / EntityType.PipeUnderground)들을
 * 연결성 기준으로 묶어 "네트워크"를 산출한다.
 *
 * 규칙
 * - 일반 파이프는 인접 4방향 모두에서 같은 family 의 파이프와 연결된다.
 * - 지하 파이프(pipe-to-ground)는 표면에서는 back side(direction 반대 방향)에서만 연결,
 *   지하에서는 direction 방향으로 max_underground_distance 까지 직선 탐색하여
 *   반대 방향(direction+4)을 가진 첫 지하 파이프와 짝을 이룬다.
 *   같은 방향의 지하 파이프가 중간에 있으면 터널을 가로막아 짝 형성을 차단한다.
 * - family: 유체 파이프(pipe + pipe-to-ground) 와 heat-pipe 는 서로 다른 family.
 *
 * 시각화에 사용하는 부산물:
 * - networkOf:   entityId → networkId
 * - colorOf:     networkId → 16진 RGB 색상
 * - surfaceLinks:    표면 인접 연결 (실 선)
 * - undergroundLinks: 지하 터널 짝 연결 (실 선)
 */

import type { Entity } from '../store/gameDataStore';
import type { Direction, LayoutGrid } from '../types/layout';
import { EntityType } from '../types/layout';

interface PipeNode {
  entityId: string;
  x: number;
  y: number;
  entityType: EntityType;
  direction: Direction;
  family: PipeFamily;
  maxUndergroundDistance: number;
}

type PipeFamily = 'fluid' | 'heat';

export interface PipeLink {
  /** 한 쪽 끝의 entityId (네트워크 색 결정용) */
  fromId: string;
  /** 타일 중심 좌표 (격자 단위, 픽셀 변환은 호출 측에서) */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PipeNetworkResult {
  /** 파이프 entityId → networkId */
  networkOf: Map<string, number>;
  /** networkId → 색상 (24-bit hex) */
  colorOf: Map<number, number>;
  surfaceLinks: PipeLink[];
  undergroundLinks: PipeLink[];
  /**
   * 파이프 셀별 surface 연결 측면 집합.
   * key = `${x},${y}`, value = 연결되는 측면 방향(0/2/4/6) 집합.
   * 직사각형 형태 렌더링에서 어느 쪽으로 팔을 뻗을지 결정.
   */
  cellConnections: Map<string, Set<Direction>>;
}

const NETWORK_PALETTE: number[] = [
  0x4ec9b0, 0xff7e5f, 0xffd166, 0xc792ea, 0x82aaff,
  0xa7e22e, 0xf07178, 0x89ddff, 0xff79c6, 0xbd93f9,
  0x00bfa5, 0xff5722, 0x7c4dff, 0x40c4ff, 0xb2ff59,
];

function networkColor(networkId: number): number {
  return NETWORK_PALETTE[networkId % NETWORK_PALETTE.length];
}

function dirVec(d: Direction): { x: number; y: number } {
  switch (d) {
    case 0:  return { x: 0,  y: -1 }; // N
    case 4:  return { x: 1,  y: 0  }; // E
    case 8:  return { x: 0,  y: 1  }; // S
    case 12: return { x: -1, y: 0  }; // W
  }
}

function oppositeDir(d: Direction): Direction {
  return ((d + 8) % 16) as Direction;
}

function pipeFamilyOf(entityType: EntityType, fType: string | undefined): PipeFamily | null {
  // entity.type 우선, 게임데이터 로드 전이면 EntityType 으로 fallback.
  if (fType === 'heat-pipe') return 'heat';
  if (fType === 'pipe' || fType === 'pipe-to-ground' || fType === 'infinity-pipe') return 'fluid';
  // gameData 로드 전이면 일단 fluid 로 가정
  if (entityType === EntityType.Pipe || entityType === EntityType.PipeUnderground || entityType === EntityType.InfinityPipe) return 'fluid';
  return null;
}

/**
 * 파이프 네트워크 계산 진입점.
 * grid 의 모든 셀을 한 번 훑어 파이프 노드를 모은 뒤, 인접/터널 연결을 적용해
 * union-find 로 네트워크를 묶는다.
 */
export function computePipeNetworks(
  grid: LayoutGrid,
  entityMap: Map<string, Entity>,
): PipeNetworkResult {
  const { width, height, cells } = grid;

  const nodes = new Map<string, PipeNode>();
  /** 셀 인덱스 → 파이프 entityId (모든 점유 셀, origin 포함) */
  const cellToPipe = new Map<number, string>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const cell = cells[idx];
      if (!cell || !cell.entityId) continue;
      if (
        cell.entityType !== EntityType.Pipe &&
        cell.entityType !== EntityType.PipeUnderground
      ) continue;

      cellToPipe.set(idx, cell.entityId);

      if (cell.isOrigin && !nodes.has(cell.entityId)) {
        const entity = cell.entityName ? entityMap.get(cell.entityName) : undefined;
        const family = pipeFamilyOf(cell.entityType, entity?.type);
        if (!family) continue;
        nodes.set(cell.entityId, {
          entityId: cell.entityId,
          x, y,
          entityType: cell.entityType,
          direction: cell.direction,
          family,
          maxUndergroundDistance: entity?.max_underground_distance ?? 10,
        });
      }
    }
  }

  // ---- Union-Find ----
  const parent = new Map<string, string>();
  for (const id of nodes.keys()) parent.set(id, id);

  function find(id: string): string {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let cur = id;
    while (parent.get(cur) !== r) {
      const next = parent.get(cur)!;
      parent.set(cur, r);
      cur = next;
    }
    return r;
  }

  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  const surfaceLinks: PipeLink[] = [];
  const undergroundLinks: PipeLink[] = [];
  const cellConnections = new Map<string, Set<Direction>>();

  function addCellConn(x: number, y: number, side: Direction) {
    const k = `${x},${y}`;
    let s = cellConnections.get(k);
    if (!s) { s = new Set(); cellConnections.set(k, s); }
    s.add(side);
  }

  // ---- Surface 연결 ----
  // 노드별로 연결 가능한 측면을 결정한 뒤 그 방향의 이웃 셀이 같은 family 파이프인지 검사.
  for (const node of nodes.values()) {
    const sides: Direction[] =
      node.entityType === EntityType.Pipe
        ? [0, 4, 8, 12]
        : [node.direction];

    for (const side of sides) {
      const v = dirVec(side);
      const nx = node.x + v.x;
      const ny = node.y + v.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

      const neighborId = cellToPipe.get(ny * width + nx);
      if (!neighborId || neighborId === node.entityId) continue;

      const neighbor = nodes.get(neighborId);
      if (!neighbor || neighbor.family !== node.family) continue;

      // 이웃이 우리 쪽으로 향한 측면을 받아주는지 확인
      const incomingFromNeighbor = oppositeDir(side); // 이웃 입장에서 우리 방향
      const neighborAccepts =
        neighbor.entityType === EntityType.Pipe
          ? true
          : neighbor.direction === incomingFromNeighbor;
      if (!neighborAccepts) continue;

      union(node.entityId, neighborId);

      // 셀별 연결 측면 누적 (양쪽 모두) — 직사각형 형태 렌더링용
      addCellConn(node.x, node.y, side);
      addCellConn(nx, ny, incomingFromNeighbor);

      // 중복 방지: 사전식 비교로 한 쪽에서만 push
      if (node.entityId < neighborId) {
        surfaceLinks.push({
          fromId: node.entityId,
          x1: node.x + 0.5,
          y1: node.y + 0.5,
          x2: nx + 0.5,
          y2: ny + 0.5,
        });
      }
    }
  }

  // ---- Underground 터널 연결 ----
  // PipeUnderground 만 대상. direction 방향으로 거리 1..max 까지 직선 탐색.
  // - 같은 direction 의 PipeUnderground 가 먼저 나오면 터널 차단 (break)
  // - 반대 direction 의 PipeUnderground 가 나오면 짝 형성 후 break
  // - 다른 셀은 무시하고 통과
  for (const node of nodes.values()) {
    if (node.entityType !== EntityType.PipeUnderground) continue;

    // direction = 지상 입구가 향하는 방향. 터널은 그 반대 방향으로 진행.
    const oppDir = oppositeDir(node.direction);
    const v = dirVec(oppDir);

    for (let k = 1; k <= node.maxUndergroundDistance; k++) {
      const tx = node.x + v.x * k;
      const ty = node.y + v.y * k;
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) break;

      const otherId = cellToPipe.get(ty * width + tx);
      if (!otherId || otherId === node.entityId) continue;

      const other = nodes.get(otherId);
      if (!other) continue;
      if (other.entityType !== EntityType.PipeUnderground) continue;
      if (other.family !== node.family) continue;

      if (other.direction === oppDir) {
        // 짝 형성 (서로의 입구가 마주봄)
        union(node.entityId, otherId);
        if (node.entityId < otherId) {
          undergroundLinks.push({
            fromId: node.entityId,
            x1: node.x + 0.5,
            y1: node.y + 0.5,
            x2: tx + 0.5,
            y2: ty + 0.5,
          });
        }
        break;
      }

      if (other.direction === node.direction) {
        // 같은 방향 → 터널 차단
        break;
      }
      // 그 외(수직 방향)는 통과
    }
  }

  // ---- networkId 부여 ----
  const rootToId = new Map<string, number>();
  let nextId = 0;
  const networkOf = new Map<string, number>();
  for (const id of nodes.keys()) {
    const r = find(id);
    let nid = rootToId.get(r);
    if (nid === undefined) {
      nid = nextId++;
      rootToId.set(r, nid);
    }
    networkOf.set(id, nid);
  }

  const colorOf = new Map<number, number>();
  for (let i = 0; i < nextId; i++) colorOf.set(i, networkColor(i));

  return { networkOf, colorOf, surfaceLinks, undergroundLinks, cellConnections };
}

/**
 * 셀이 파이프 family 인지 빠르게 판정. 렌더 루프에서 사용.
 */
export function isPipeCell(entityType: EntityType): boolean {
  return entityType === EntityType.Pipe || entityType === EntityType.PipeUnderground;
}

/**
 * 호버 프리뷰용 — (hx, hy)에 가상의 파이프가 배치됐다고 가정하고
 * 그 셀과 4방향 인접 셀의 surface 연결 측면 집합을 반환한다.
 * 배치된 파이프와 동일한 직사각형 형태 미리보기에 사용.
 *
 * 단순화: 호버 셀 + 4 인접만 검사하므로 union-find 없이 양방향 연결 가능 여부만 판정.
 */
export function computeHoverPipeConnections(
  grid: LayoutGrid,
  entityMap: Map<string, Entity>,
  hx: number,
  hy: number,
  hoverType: EntityType,
  hoverDirection: Direction,
  hoverName: string,
): Map<string, Set<Direction>> {
  const result = new Map<string, Set<Direction>>();
  const add = (x: number, y: number, side: Direction) => {
    const k = `${x},${y}`;
    let s = result.get(k);
    if (!s) { s = new Set(); result.set(k, s); }
    s.add(side);
  };

  const hoverEntity = hoverName ? entityMap.get(hoverName) : undefined;
  const hoverFamily = pipeFamilyOf(hoverType, hoverEntity?.type);
  if (!hoverFamily) return result;

  const hoverSides: Direction[] =
    hoverType === EntityType.Pipe ? [0, 4, 8, 12] : [hoverDirection];

  for (const side of hoverSides) {
    const v = dirVec(side);
    const nx = hx + v.x;
    const ny = hy + v.y;
    if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;

    const ncell = grid.cells[ny * grid.width + nx];
    if (!ncell || !ncell.entityId) continue;
    if (ncell.entityType !== EntityType.Pipe && ncell.entityType !== EntityType.PipeUnderground) continue;

    const nEntity = ncell.entityName ? entityMap.get(ncell.entityName) : undefined;
    const nFamily = pipeFamilyOf(ncell.entityType, nEntity?.type);
    if (nFamily !== hoverFamily) continue;

    const incoming = ((side + 8) % 16) as Direction; // 이웃 입장에서 우리 방향
    const neighborAccepts =
      ncell.entityType === EntityType.Pipe
        ? true
        : ncell.direction === incoming;
    if (!neighborAccepts) continue;

    add(hx, hy, side);
    add(nx, ny, incoming);
  }

  return result;
}
