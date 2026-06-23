import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEmptyCell, EntityType } from '../../types/layout';
import { useGameDataStore, type Entity, type Recipe } from '../../store/gameDataStore';
import type { Area, Container, PendingConnection, PlacedCell } from './containerModel';
import type { RouteOptions } from './routeFallback';
import { wrapExternalsWithMerge } from './externalMergePass';
import { wrapExternalsAroundPerimeter } from './areaUnification';

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처 — 게임데이터 + 영역
// ─────────────────────────────────────────────────────────────────────────────

const RECIPE: Recipe = {
  id: 1, name: 'gear', localised_name: 'gear', category: 'crafting',
  energy_required: 0.5,
  ingredients: [{ name: 'iron-plate', amount: 1, type: 'item' }],
  products: [{ name: 'gear', amount: 1, type: 'item' }],
};

const MACHINE: Entity = { id: 1, name: 'asm', localised_name: 'asm', type: 'assembling-machine', tile_width: 3, tile_height: 3, crafting_speed: 1 } as Entity;
const BELT: Entity = { id: 2, name: 'transport-belt', localised_name: 'belt', type: 'transport-belt', tile_width: 1, tile_height: 1, belt_speed: 0.09375 } as Entity; // 45/s
const INSERTER: Entity = { id: 3, name: 'inserter', localised_name: 'ins', type: 'inserter', tile_width: 1, tile_height: 1, inserter_rotation_speed: 0.5 } as Entity; // tapCap ~8.3/s

const OPTIONS: RouteOptions = {
  beltEntityName: 'transport-belt',
  inserterEntityName: 'inserter',
  pipeEntityName: 'pipe',
  preferUnderground: false,
};

// 스토어는 persist 미들웨어가 있어 node 에서 setState 가 재귀한다 → getState 만 모킹.
beforeEach(() => {
  vi.spyOn(useGameDataStore, 'getState').mockReturnValue({
    recipeMap: new Map([['gear', RECIPE]]),
    entityMap: new Map([['asm', MACHINE], ['transport-belt', BELT], ['inserter', INSERTER]]),
  } as unknown as ReturnType<typeof useGameDataStore.getState>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function machineContainer(id: string, x: number, y: number): Container {
  return { id, kind: 'machine', entityName: 'asm', origin: { x, y }, size: { w: 3, h: 3 }, recipeName: 'gear' };
}
function chestContainer(id: string): Container {
  return { id, kind: 'infinity-chest', entityName: 'infinity-chest', origin: { x: 0, y: 0 }, size: { w: 1, h: 1 }, content: 'iron-plate' };
}
function machineCells(c: Container): PlacedCell[] {
  const out: PlacedCell[] = [];
  for (let dx = 0; dx < c.size.w; dx++) for (let dy = 0; dy < c.size.h; dy++) {
    out.push({ x: c.origin.x + dx, y: c.origin.y + dy, cell: { ...createEmptyCell(), entityId: c.id, entityName: 'asm', entityType: EntityType.Assembler, isOrigin: dx === 0 && dy === 0 } });
  }
  return out;
}

function buildAreas() {
  const m1 = machineContainer('M1', 5, 5);
  const m2 = machineContainer('M2', 10, 5);
  const internal: Area = {
    kind: 'internal',
    containers: [m1, m2],
    placed: [...machineCells(m1), ...machineCells(m2)],
    undergroundCorridors: [],
  };
  const external: Area = {
    kind: 'external',
    containers: [chestContainer('C1'), chestContainer('C2')],
    placed: [],
    undergroundCorridors: [],
  };
  const connections: PendingConnection[] = [
    { producerId: 'C1', consumerId: 'M1', kind: 'item' },
    { producerId: 'C2', consumerId: 'M2', kind: 'item' },
  ];
  return { internal, external, connections };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('wrapExternalsWithMerge', () => {
  it('merges two same-item machines into one chest + trunk when enabled', () => {
    const { internal, external, connections } = buildAreas();
    const machineCellCount = internal.placed.length;

    wrapExternalsWithMerge(internal, external, [], connections, OPTIONS, { enabled: true, maxTaps: 6 });

    // 상자 2 → 1 로 병합.
    expect(external.containers).toHaveLength(1);
    expect(external.placed).toHaveLength(1); // 대표 상자만 배치
    expect(external.placed[0].cell.entityType).toBe(EntityType.InfinityChest);

    // 트렁크 벨트 + 인서터가 internal 에 commit (머신 셀 외에 추가됨).
    const added = internal.placed.slice(machineCellCount);
    expect(added.some((p) => p.cell.entityType === EntityType.Belt)).toBe(true);
    expect(added.some((p) => p.cell.entityType === EntityType.Inserter)).toBe(true);

    // 트렁크/인서터 셀이 머신 footprint 와 안 겹침.
    const machineSet = new Set<string>();
    for (const m of [{ x: 5, y: 5 }, { x: 10, y: 5 }]) for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) machineSet.add(`${m.x + dx},${m.y + dy}`);
    for (const p of added) expect(machineSet.has(`${p.x},${p.y}`)).toBe(false);
  });

  it('merges two same-item machine OUTPUTS into one chest + collect trunk', () => {
    // 루트 클러스터 출력 경로: 머신 N대 → 같은 product 출력 chest. collect 모드 병합.
    const m1 = machineContainer('M1', 5, 5);
    const m2 = machineContainer('M2', 10, 5);
    const internal: Area = {
      kind: 'internal',
      containers: [m1, m2],
      placed: [...machineCells(m1), ...machineCells(m2)],
      undergroundCorridors: [],
    };
    const outChest = (id: string): Container => ({
      id, kind: 'infinity-chest', entityName: 'infinity-chest',
      origin: { x: 0, y: 0 }, size: { w: 1, h: 1 }, content: 'gear', role: 'output',
    });
    const external: Area = {
      kind: 'external',
      containers: [outChest('O1'), outChest('O2')],
      placed: [],
      undergroundCorridors: [],
    };
    const connections: PendingConnection[] = [
      { producerId: 'M1', consumerId: 'O1', kind: 'item' },
      { producerId: 'M2', consumerId: 'O2', kind: 'item' },
    ];
    const machineCellCount = internal.placed.length;

    wrapExternalsWithMerge(internal, external, [], connections, OPTIONS, { enabled: true, maxTaps: 6 });

    // 출력 상자 2 → 1 로 병합.
    expect(external.containers).toHaveLength(1);
    expect(external.placed).toHaveLength(1);

    // collect 트렁크 벨트 + 인서터가 commit.
    const added = internal.placed.slice(machineCellCount);
    expect(added.some((p) => p.cell.entityType === EntityType.Belt)).toBe(true);
    expect(added.some((p) => p.cell.entityType === EntityType.Inserter)).toBe(true);
  });

  it('falls back to 1:1 (two chests) when disabled', () => {
    const { internal, external, connections } = buildAreas();

    wrapExternalsWithMerge(internal, external, [], connections, OPTIONS, { enabled: false, maxTaps: 6 });

    // 병합 안 함 → 두 상자 모두 그대로 1:1 배치.
    expect(external.containers).toHaveLength(2);
    expect(external.placed).toHaveLength(2);
  });

  it('does not merge when items differ (separate buckets, both 1:1)', () => {
    const { internal, external, connections } = buildAreas();
    // C2 의 품목을 다른 것으로 → 같은 버킷이 아니라 각자 단독 → 1:1.
    external.containers[1].content = 'copper-plate';
    // copper-plate 수요 계산용으로 레시피에 재료 추가는 불필요 — demand Infinity 라도 단독이면 1:1.

    wrapExternalsWithMerge(internal, external, [], connections, OPTIONS, { enabled: true, maxTaps: 6 });

    expect(external.containers).toHaveLength(2);
    expect(external.placed).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// perimeter ring — 변별 독립 직사각형 (돌기 없음 + 돌출 없는 변은 최소 오프셋)
// ─────────────────────────────────────────────────────────────────────────────

describe('perimeter ring — 변별 독립 직사각형', () => {
  function beltCell(x: number, y: number): PlacedCell {
    return {
      x, y,
      cell: { ...createEmptyCell(), entityId: 'm2m-belt', entityName: 'transport-belt', entityType: EntityType.Belt },
    };
  }

  it('모든 상자가 단일 직사각형 둘레에 있고(돌기 없음), 돌출 없는 변은 머신에 바짝 붙는다', () => {
    // 머신-대-머신 라우팅이 *서쪽*으로만 돌출(비-상자 행). 동쪽엔 돌출 없음.
    // 기대: 서변은 그 돌출에도 불구하고 상자 행이 비어 있으므로 최소 오프셋 유지(=얇음),
    //       4개 상자 전부 하나의 직사각형 둘레(서변 x=3 / 동변 x=19)에 — 돌기 없음.
    const m1 = machineContainer('M1', 5, 6);    // x5-7 y6-8  (서)
    const m2 = machineContainer('M2', 5, 12);   // x5-7 y12-14 (서)
    const m3 = machineContainer('M3', 15, 6);   // x15-17 y6-8  (동)
    const m4 = machineContainer('M4', 15, 12);  // x15-17 y12-14 (동)
    const aN = machineContainer('AN', 10, 0);   // 북쪽 앵커 — bbox y0 확장
    const aS = machineContainer('AS', 10, 18);  // 남쪽 앵커 — bbox y1 확장
    const internal: Area = {
      kind: 'internal',
      containers: [m1, m2, m3, m4, aN, aS],
      placed: [
        ...machineCells(m1), ...machineCells(m2), ...machineCells(m3), ...machineCells(m4),
        ...machineCells(aN), ...machineCells(aS),
        // 서쪽 돌출: 상자 행(y≈7, y≈13) 사이의 비-상자 행 y=9 에 라우팅 셀.
        // 머신 footprint 서면(x=5)보다 2칸 바깥(x=3)에 위치 — 구 균일 방식이면 이 셀이
        // bbox 를 부풀려 서변 상자를 x=1 로 밀어내지만, 변별 방식은 무시한다.
        beltCell(3, 9),
      ],
      undergroundCorridors: [],
    };
    const external: Area = {
      kind: 'external',
      containers: [chestContainer('C1'), chestContainer('C2'), chestContainer('C3'), chestContainer('C4')],
      placed: [],
      undergroundCorridors: [],
    };
    const connections: PendingConnection[] = [
      { producerId: 'C1', consumerId: 'M1', kind: 'item' },
      { producerId: 'C2', consumerId: 'M2', kind: 'item' },
      { producerId: 'C3', consumerId: 'M3', kind: 'item' },
      { producerId: 'C4', consumerId: 'M4', kind: 'item' },
    ];

    const res = wrapExternalsAroundPerimeter(internal, external, [], connections, OPTIONS);

    // 통로 전원 확보.
    expect(res.failed).toBe(0);
    const chests = external.placed.filter((p) => p.cell.entityType === EntityType.InfinityChest);
    expect(chests).toHaveLength(4);

    // (1) 단일 직사각형 둘레 — 모든 상자가 min/max x 또는 y 모서리 위 (돌기 없음).
    const xs = chests.map((c) => c.x);
    const ys = chests.map((c) => c.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    for (const c of chests) {
      const onEdge = c.x === x0 || c.x === x1 || c.y === y0 || c.y === y1;
      expect(onEdge).toBe(true);
    }

    // (2) 서변은 머신 서면(x=5)에서 최소 오프셋 2칸 = x=3. 돌출(x=3,y=9)이 변을 밀어내지 않음.
    //     (구 균일 방식이면 그 돌출 때문에 서변이 x=1 로 더 멀어진다.)
    expect(x0).toBe(3);
    // (3) 동변은 머신 동면(x=17)에서 +2 = x=19.
    expect(x1).toBe(19);
  });
});
