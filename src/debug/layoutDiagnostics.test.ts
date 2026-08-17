/**
 * 단면표와 규칙 검사를 **손으로 지은 배치**로 검증한다.
 *
 * 왜 합성 배치인가: 진짜 위저드를 돌리려면 게임데이터 전체가 필요하고, 그렇게 얻은
 * 배치는 *무엇이 정답인지* 를 테스트가 모른다. 여기서 검증하려는 것은 배치 품질이
 * 아니라 **읽는 도구가 옳게 읽나** 이므로, 결함을 하나씩 심은 작은 배치가 맞다.
 *
 * 대조군을 먼저 둔다 — 결함 없는 배치에서 위반이 0 이어야 그 뒤의 "잡았다" 가 의미 있다.
 */

import { describe, expect, it } from 'vitest';
import { EntityType, type GridCell } from '../types/layout';
import type {
  Area,
  CandidateLeaf,
  Container,
  PlacedCell,
  Routing,
} from '../autoLayout/containerModel';
import { collectModules } from '../autoLayout/moduleInspect';
import { checkLayout } from './checkRules';
import { renderFace } from './faceTable';
import { cellKey, machineBoxOf, type LayoutView } from './layoutView';

// ─────────────────────────────────────────────────────────────────────────────
// 손으로 짓는 배치
// ─────────────────────────────────────────────────────────────────────────────

const cell = (type: EntityType, id: string): GridCell => ({
  entityId: id,
  entityName: String(type),
  entityType: type,
  direction: 0,
  tileOffset: { x: 0, y: 0 },
  isOrigin: true,
});

const at = (x: number, y: number, type: EntityType, id: string): PlacedCell => ({
  x, y, cell: cell(type, id),
});

const area = (kind: Area['kind'], containers: Container[], placed: PlacedCell[]): Area => ({
  kind, containers, placed, undergroundCorridors: [],
});

const machine = (id: string, x: number, y: number): Container => ({
  id, kind: 'machine', entityName: 'assembling-machine-2',
  origin: { x, y }, size: { w: 3, h: 3 }, recipeName: 'iron-gear-wheel',
});

const chest = (id: string, x: number, y: number): Container => ({
  id, kind: 'infinity-chest', entityName: 'infinity-chest',
  origin: { x, y }, size: { w: 1, h: 1 }, content: 'iron-plate',
});

function routing(id: string, from: [string, number, number], to: [string, number, number], placed: PlacedCell[]): Routing {
  return {
    id, kind: 'item',
    from: { containerId: from[0], cell: { x: from[1], y: from[2] }, face: 'E', kind: 'item' },
    to: { containerId: to[0], cell: { x: to[1], y: to[2] }, face: 'W', kind: 'item' },
    placed, corridors: [],
  };
}

function viewOf(internal: Area, external: Area, routings: Routing[]): LayoutView {
  const leaf = {
    id: 'leaf', kind: 'candidate', children: [], label: 'test',
    internal, external, routings, squarenessPenalty: 0,
  } as CandidateLeaf;
  const containers = [...internal.containers, ...external.containers];
  const cells = new Map<string, ReturnType<LayoutView['cells']['get']> & object>();
  for (const p of [...internal.placed, ...external.placed]) {
    cells.set(cellKey(p.x, p.y), {
      x: p.x, y: p.y, type: p.cell.entityType, name: p.cell.entityName,
      entityId: p.cell.entityId, direction: p.cell.direction,
    });
  }
  return {
    leaf,
    cells: cells as LayoutView['cells'],
    modules: collectModules({ containers, routings }),
    routings,
    containers,
    bbox: { x: 0, y: 0, w: 20, h: 20 },
  };
}

/**
 * 대조군 — 머신 (10,5) 3×3 · W 면에 포트 하나.
 *
 * ```
 *   x |   6     7     8     9  | 10
 *     | CHEST Belt  Belt Inser | Assem     ← y=6
 * ```
 * 포트는 (8,6) = 머신 서쪽 d2. 그 사이 (9,6) 이 인서터라 R-도달을 만족한다.
 */
function cleanLayout(): LayoutView {
  const m = machine('n0-gear-m0', 10, 5);
  const c = chest('chest-0', 6, 6);
  const machineCells: PlacedCell[] = [];
  for (let dy = 0; dy < 3; dy++)
    for (let dx = 0; dx < 3; dx++)
      machineCells.push(at(10 + dx, 5 + dy, EntityType.Assembler, 'n0-gear-m0'));

  const route: PlacedCell[] = [
    at(7, 6, EntityType.Belt, 'r0'),
    at(8, 6, EntityType.Belt, 'r0'),
    at(9, 6, EntityType.Inserter, 'r0'),
  ];
  return viewOf(
    area('internal', [m], [...machineCells, ...route]),
    area('external', [c], [at(6, 6, EntityType.InfinityChest, 'chest-0')]),
    [routing('r0', ['chest-0', 6, 6], ['n0-gear-m0', 8, 6], route)],
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe('checkLayout — 대조군', () => {
  it('결함 없는 배치는 위반 0', () => {
    expect(checkLayout(cleanLayout())).toEqual([]);
  });

  it('끝점이 상자인 라우팅을 R-무우회로 오탐하지 않는다', () => {
    // 자기 끝점 상자는 감아도 된다 — 실제로 벨트가 상자를 둘러 들어간다.
    const v = cleanLayout();
    const r = v.routings[0];
    (r.placed as PlacedCell[]).push(
      at(5, 6, EntityType.Belt, 'r0'),
      at(6, 5, EntityType.Belt, 'r0'),
      at(6, 7, EntityType.Belt, 'r0'),
    );
    expect(checkLayout(v).filter((x) => x.rule === 'R-무우회')).toEqual([]);
  });
});

describe('checkLayout — 결함을 하나씩', () => {
  it('R-연속: 벨트가 끊기면 조각이 아니라 **틈**을 짚는다', () => {
    const v = cleanLayout();
    // (8,6) 을 지워 (7,6) 이 본체(9,6 인서터)에서 떨어지게 한다 = 2026-08-17 결함 A 모양.
    v.cells.delete(cellKey(8, 6));
    const hits = checkLayout(v).filter((x) => x.rule === 'R-연속');
    expect(hits).toHaveLength(1);
    // 어느 조각이 잘못인지는 알 수 없다 — 확실한 것은 이 둘 사이가 비었다는 것뿐.
    expect(hits[0].cells).toEqual([{ x: 7, y: 6 }, { x: 9, y: 6 }]);
    expect(hits[0].detail).toContain('틈 (7,6)↔(9,6)');
  });

  it('R-연속: 지하벨트 짝은 끊긴 것으로 안 센다', () => {
    const m = machine('n0-gear-m0', 10, 5);
    const route: PlacedCell[] = [
      at(3, 6, EntityType.UndergroundBelt, 'r0'),
      // 3..8 은 지하 통과 — 셀이 없다.
      at(8, 6, EntityType.UndergroundBelt, 'r0'),
      at(9, 6, EntityType.Inserter, 'r0'),
    ];
    const v = viewOf(
      area('internal', [m], route),
      area('external', [], []),
      [routing('r0', ['chest-0', 3, 6], ['n0-gear-m0', 8, 6], route)],
    );
    expect(checkLayout(v).filter((x) => x.rule === 'R-연속')).toEqual([]);
  });

  it('R-도달: 포트와 머신 사이가 비면 잡는다', () => {
    const v = cleanLayout();
    v.cells.delete(cellKey(9, 6)); // 인서터 자리를 비운다
    const hits = checkLayout(v).filter((x) => x.rule === 'R-도달');
    expect(hits).toHaveLength(1);
    expect(hits[0].detail).toContain('비었다');
  });

  it('R-도달: 사이가 인서터가 아니면 잡는다', () => {
    const v = cleanLayout();
    v.cells.set(cellKey(9, 6), {
      x: 9, y: 6, type: EntityType.Belt, name: 'belt', entityId: 'r0', direction: 0,
    });
    const hits = checkLayout(v).filter((x) => x.rule === 'R-도달');
    expect(hits).toHaveLength(1);
    expect(hits[0].detail).toContain('인서터가 없다');
  });

  it('R-겹침: 한 칸을 다른 엔티티가 덮으면 잡는다', () => {
    const v = cleanLayout();
    v.leaf.internal.placed.push(at(8, 6, EntityType.Inserter, '다른아이디'));
    const hits = checkLayout(v).filter((x) => x.rule === 'R-겹침');
    expect(hits).toHaveLength(1);
    expect(hits[0].cells).toEqual([{ x: 8, y: 6 }]);
  });

  it('R-무우회: 남의 상자를 세 면 감으면 잡는다', () => {
    const v = cleanLayout();
    (v.containers as Container[]).push(chest('남의상자', 3, 6));
    const r = v.routings[0];
    (r.placed as PlacedCell[]).push(
      at(2, 6, EntityType.Belt, 'r0'),
      at(3, 5, EntityType.Belt, 'r0'),
      at(3, 7, EntityType.Belt, 'r0'),
    );
    const hits = checkLayout(v).filter((x) => x.rule === 'R-무우회');
    expect(hits).toHaveLength(1);
    expect(hits[0].detail).toContain('남의상자');
  });

  it('두 면만 감는 것(모퉁이)은 위반이 아니다', () => {
    const v = cleanLayout();
    (v.containers as Container[]).push(chest('남의상자', 3, 6));
    const r = v.routings[0];
    (r.placed as PlacedCell[]).push(at(2, 6, EntityType.Belt, 'r0'), at(3, 5, EntityType.Belt, 'r0'));
    expect(checkLayout(v).filter((x) => x.rule === 'R-무우회')).toEqual([]);
  });
});

describe('renderFace', () => {
  it('깊이와 절대 좌표를 함께 찍고, 머신을 표 오른쪽에 둔다', () => {
    const v = cleanLayout();
    const table = renderFace(v, 'n0-gear-m0', 'W', { depth: 4, margin: 0 });

    expect(table).toContain('머신 블록 (10,5) 3×3 · 면 W');
    expect(table).toContain('d1 = x9'); // 머신 서쪽 첫 칸
    expect(table).toMatch(/d4\s+d3\s+d2\s+d1/); // 먼 쪽 → 가까운 쪽
    // y=6 행: x6=CHEST x7=Belt x8=Belt x9=Inser | 머신
    const row = table.split('\n').find((l) => l.trimStart().startsWith('6'))!;
    expect(row).toMatch(/CHEST\s+Belt\s+Belt\s+Inser\s+\|\s+Assem/);
  });

  it('포트를 면·깊이와 함께 나열한다', () => {
    const table = renderFace(cleanLayout(), 'n0-gear-m0', 'W');
    expect(table).toContain('포트 W (1개)');
    expect(table).toContain('(8,6) d2');
  });

  it('모듈을 못 찾으면 있는 모듈 목록을 대신 낸다', () => {
    const out = renderFace(cleanLayout(), '없는모듈', 'W');
    expect(out).toContain('없음');
    expect(out).toContain('n0-gear');
  });

  it('레시피 이름으로도 찾힌다 — 내부 id 를 외울 수 없다', () => {
    const out = renderFace(cleanLayout(), 'iron-gear-wheel', 'W');
    expect(out).toContain('모듈 n0-gear');
  });
});

describe('machineBoxOf', () => {
  it('포트가 아니라 **머신 footprint** 만으로 면을 잰다', () => {
    // ModuleInfo.bbox 는 포트 (8,6) 을 삼켜 x=8 부터다. 면 기준은 그러면 안 된다.
    const v = cleanLayout();
    expect(v.modules[0].key).toBe('n0-gear'); // 머신 id 에서 -m0 을 뗀 것
    expect(v.modules[0].bbox.x).toBe(8);
    expect(machineBoxOf(v, 'n0-gear')).toEqual({ x: 10, y: 5, w: 3, h: 3 });
  });
});
