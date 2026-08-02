import { describe, it, expect } from 'vitest';
import { createEmptyCell, EntityType } from '../../../types/layout';
import type { Area, PlacedCell } from '../containerModel';
import {
  collectBeltFlow,
  dijkstraWithJumps,
  type DijkstraInput,
} from './containerRouting';
import { cellKey } from '../util/helper';

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처
// ─────────────────────────────────────────────────────────────────────────────

function beltCell(
  x: number,
  y: number,
  direction: number,
  opts: { underground?: 'input' | 'output' } = {},
): PlacedCell {
  return {
    x,
    y,
    cell: {
      ...createEmptyCell(),
      entityType: opts.underground ? EntityType.UndergroundBelt : EntityType.Belt,
      direction: direction as PlacedCell['cell']['direction'],
      undergroundType: opts.underground,
    },
  };
}

function areaWith(cells: PlacedCell[]): Area {
  return { kind: 'internal', containers: [], placed: cells, undergroundCorridors: [] };
}

const baseInput = (over: Partial<DijkstraInput>): DijkstraInput => ({
  start: { x: 0, y: 0 },
  end: { x: 0, y: 4 },
  blocked: new Set<string>(),
  corridors: [],
  maxJumpDistance: 0,
  blockGroup: 'transport-belt',
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// collectBeltFlow — 타일 + 지표 출력 칸 수집
// ─────────────────────────────────────────────────────────────────────────────

describe('collectBeltFlow', () => {
  it('일반 벨트는 진행 방향 앞 칸을 sinkTarget 으로 만든다', () => {
    // 벨트 (5,5) dir=4(E) → 타일 "5,5", 출력 칸 "6,5".
    const flow = collectBeltFlow([areaWith([beltCell(5, 5, 4)])]);
    expect(flow.tiles.has(cellKey(5, 5))).toBe(true);
    expect(flow.sinkTargets.has(cellKey(6, 5))).toBe(true);
  });

  it('지하벨트 출구는 출력 칸이 있고, 입구는 없다', () => {
    // 출구 (3,3) dir=8(S) → 출력 "3,4". 입구 (2,2) dir=8 → 출력 없음.
    const flow = collectBeltFlow([
      areaWith([
        beltCell(3, 3, 8, { underground: 'output' }),
        beltCell(2, 2, 8, { underground: 'input' }),
      ]),
    ]);
    expect(flow.tiles.has(cellKey(3, 3))).toBe(true);
    expect(flow.sinkTargets.has(cellKey(3, 4))).toBe(true);
    // 입구 타일은 점유로 잡히되(내가 거기로 흘려보내는 것 차단), 지표 출력은 없다.
    expect(flow.tiles.has(cellKey(2, 2))).toBe(true);
    expect(flow.sinkTargets.has(cellKey(2, 3))).toBe(false);
  });

  it('벨트가 아닌 엔티티는 무시한다', () => {
    const inserter: PlacedCell = {
      x: 1,
      y: 1,
      cell: { ...createEmptyCell(), entityType: EntityType.Inserter, direction: 0 },
    };
    const flow = collectBeltFlow([areaWith([inserter])]);
    expect(flow.tiles.size).toBe(0);
    expect(flow.sinkTargets.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// dijkstraWithJumps — 흐름-인접 합류 가드
// ─────────────────────────────────────────────────────────────────────────────

describe('dijkstraWithJumps — beltFlow 가드', () => {
  it('외부 벨트가 흘려보내는 칸(sinkTarget)을 피해 우회한다', () => {
    // (0,0)→(0,4) 직선 경로는 (0,2)를 지난다. 외부 벨트가 (0,2)로 토출 →
    // (0,2)에 벨트를 놓으면 합류 → 가드가 우회시켜야 한다.
    const flow = { tiles: new Set<string>(), sinkTargets: new Set([cellKey(0, 2)]) };
    const result = dijkstraWithJumps(baseInput({ beltFlow: flow }));
    expect(result).not.toBeNull();
    if (!result) return;
    const onConflict = result.cells.some((c) => c.x === 0 && c.y === 2);
    expect(onConflict).toBe(false);
  });

  it('가드 없이는 동일 경로가 그 칸을 그대로 지난다(대조군)', () => {
    const result = dijkstraWithJumps(baseInput({}));
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.cells.some((c) => c.x === 0 && c.y === 2)).toBe(true);
  });

  it('합류가 start/end 에서만 일어나면 null(폴백 위임)', () => {
    // end (0,4) 가 외부 벨트 출력 칸 → 차단 불가 → 이 페어 포기.
    const flow = { tiles: new Set<string>(), sinkTargets: new Set([cellKey(0, 4)]) };
    expect(dijkstraWithJumps(baseInput({ beltFlow: flow }))).toBeNull();
  });

  it('내 벨트 출력이 외부 벨트 타일로 떨어지면 그 셀을 피한다', () => {
    // 직선 경로의 (0,1)은 (0,2)로 흐른다. (0,2)가 외부 벨트 타일이면 합류 →
    // (0,1)을 차단·우회. 단 end(0,4)는 그대로 도달.
    const flow = { tiles: new Set([cellKey(0, 2)]), sinkTargets: new Set<string>() };
    const result = dijkstraWithJumps(baseInput({ end: { x: 0, y: 6 }, beltFlow: flow }));
    expect(result).not.toBeNull();
    if (!result) return;
    // (0,2)로 흘려보내는 직진 인접(=(0,1)에서 (0,2)로)이 경로에 없어야 한다.
    const feedsForeign = result.cells.some((c, i) => {
      const n = result.cells[i + 1];
      return n && c.x === 0 && c.y === 1 && n.x === 0 && n.y === 2;
    });
    expect(feedsForeign).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// dijkstraWithJumps — bounds (단일 외곽 링 불변식)
// ─────────────────────────────────────────────────────────────────────────────

describe('dijkstraWithJumps — bounds 제약', () => {
  it('bounds 안 직선 경로는 그대로 통과한다', () => {
    // (0,0)→(0,4), bounds 가 x=[-1,1] 이면 직선(x=0)은 모두 안에 있음.
    const result = dijkstraWithJumps(
      baseInput({ bounds: { x0: -1, y0: 0, x1: 1, y1: 4 } }),
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.cells.every((c) => c.x >= -1 && c.x <= 1 && c.y >= 0 && c.y <= 4)).toBe(true);
  });

  it('bounds 밖으로만 우회 가능하면 null (지상)', () => {
    // (0,0)→(0,4) 직선을 (0,1),(0,2),(0,3) 으로 막고 bounds 를 x=[0,0] 한 줄로 가두면
    // 좌우 우회가 불가능 → null. (bounds 없으면 우회로 성공.)
    const blocked = new Set([cellKey(0, 1), cellKey(0, 2), cellKey(0, 3)]);
    const withBounds = dijkstraWithJumps(
      baseInput({ blocked, bounds: { x0: 0, y0: 0, x1: 0, y1: 4 } }),
    );
    expect(withBounds).toBeNull();
    // 대조군: bounds 없으면 좌/우로 우회해 도달.
    const noBounds = dijkstraWithJumps(baseInput({ blocked }));
    expect(noBounds).not.toBeNull();
  });

  it('bounds 밖으로 점프(언더그라운드)도 막는다', () => {
    // (0,0)→(10,0) 한 줄. (5,0),(6,0) 2칸 벽 + maxJumpDistance=2 → 직접 점프(거리10)
    // 불가, k=2 점프로도 벽 너머(x≥7) 착지 불가. 우회는 y≠0 한 줄을 써야만 가능.
    const blocked = new Set([cellKey(5, 0), cellKey(6, 0)]);
    // 대조군: bounds 없으면 y=±1 로 벽을 우회해 도달.
    const noBounds = dijkstraWithJumps(
      baseInput({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, blocked, maxJumpDistance: 2 }),
    );
    expect(noBounds).not.toBeNull();
    // bounds 를 y=[0,0] 한 줄로 가두면 우회 불가 + 점프 착지도 전부 막힘/밖 → null.
    const bounded = dijkstraWithJumps(
      baseInput({
        start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, blocked, maxJumpDistance: 2,
        bounds: { x0: 0, y0: 0, x1: 10, y1: 0 },
      }),
    );
    expect(bounded).toBeNull();
  });
});
