import { describe, it, expect } from 'vitest';
import { tryMergeClusterOutput, tryMergeClusterOutputBus } from './clusterTrunkMerge';
import type { Area, Container, PlacedCell } from './containerModel';
import type { RouteOptions } from './routeFallback';

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처
// ─────────────────────────────────────────────────────────────────────────────

const machine = (id: string, x: number, y: number, w = 3, h = 3): Container => ({
  id,
  kind: 'machine',
  entityName: 'assembling-machine-2',
  origin: { x, y },
  size: { w, h },
  recipeName: 'r',
});

const options: RouteOptions = {
  beltEntityName: 'transport-belt',
  inserterEntityName: 'inserter',
  // BuildSpec 필수 필드 — 위 두 이름과 **같은 엔티티**여야 한다(세는 쪽과 놓는 쪽이 어긋나면
  // 조용히 굶는다, buildSpec.ts 주석). 이 테스트들은 라우팅만 보므로 대표 티어 하나면 족하다.
  belts: [{ entityName: 'transport-belt', throughput: 15 }],
  inserters: [{ entityName: 'inserter', reach: 1, throughput: 0.83 }],
  pipeEntityName: 'pipe',
  preferUnderground: false,
};

const emptyArea = (kind: Area['kind']): Area => ({
  kind,
  containers: [],
  placed: [],
  undergroundCorridors: [],
});

/** 컨테이너 footprint 셀을 area.placed 에 점유로 추가 (buildOccupancy 는 x,y 만 읽음). */
function blockFootprint(area: Area, c: Container): void {
  for (let dx = 0; dx < c.size.w; dx++) {
    for (let dy = 0; dy < c.size.h; dy++) {
      area.placed.push({ x: c.origin.x + dx, y: c.origin.y + dy, cell: {} as PlacedCell['cell'] });
    }
  }
}

/** 머신 줄 + 그 아래 소비자. 기본 레이아웃: M1(5,5) M2(10,5) 3×3, 소비자(5,11) 3×3. */
function scene(extraBlocked: [number, number][] = []) {
  const machines = [machine('M1', 5, 5), machine('M2', 10, 5)];
  const consumer = machine('C', 5, 11);
  consumer.recipeName = 'consumer';
  const internal = emptyArea('internal');
  const external = emptyArea('external');
  for (const m of machines) blockFootprint(internal, m);
  blockFootprint(internal, consumer);
  for (const [x, y] of extraBlocked) {
    internal.placed.push({ x, y, cell: {} as PlacedCell['cell'] });
  }
  return { machines, consumer, internal, external };
}

const countByEntity = (placed: PlacedCell[], name: string) =>
  placed.filter((p) => p.cell.entityName === name).length;

// ─────────────────────────────────────────────────────────────────────────────
// 병합 성공
// ─────────────────────────────────────────────────────────────────────────────

describe('tryMergeClusterOutput', () => {
  it('merges N machines into a single trunk (belts + N taps + 1 delivery inserter)', () => {
    const { machines, consumer, internal, external } = scene();
    const result = tryMergeClusterOutput(machines, consumer, internal, external, options);

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result).toHaveLength(1);

    const routing = result[0];
    expect(routing.kind).toBe('item');
    expect(routing.to.containerId).toBe('C');
    expect(machines.map((m) => m.id)).toContain(routing.from.containerId);

    // 탭 N개 + 소비자 투입(feeder) 1개 = 인서터 N+1, 벨트 ≥ 1.
    expect(countByEntity(routing.placed, 'inserter')).toBe(machines.length + 1);
    expect(countByEntity(routing.placed, 'transport-belt')).toBeGreaterThanOrEqual(1);
  });

  it('produces a collision-free cell set not overlapping machine/consumer footprints', () => {
    const { machines, consumer, internal, external } = scene();
    const result = tryMergeClusterOutput(machines, consumer, internal, external, options)!;
    const placed = result[0].placed;

    // 셀 좌표 중복 없음.
    const keys = new Set(placed.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(placed.length);

    // footprint(머신·소비자) 위에 트렁크/인서터가 없음.
    const footprint = new Set<string>();
    for (const c of [...machines, consumer]) {
      for (let dx = 0; dx < c.size.w; dx++)
        for (let dy = 0; dy < c.size.h; dy++)
          footprint.add(`${c.origin.x + dx},${c.origin.y + dy}`);
    }
    for (const p of placed) expect(footprint.has(`${p.x},${p.y}`)).toBe(false);
  });

  it('is deterministic — same input yields the same cell set', () => {
    const a = scene();
    const b = scene();
    const ra = tryMergeClusterOutput(a.machines, a.consumer, a.internal, a.external, options)!;
    const rb = tryMergeClusterOutput(b.machines, b.consumer, b.internal, b.external, options)!;
    const keys = (r: typeof ra) => r[0].placed.map((p) => `${p.x},${p.y}`).sort();
    expect(keys(ra)).toEqual(keys(rb));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 멀티싱크 버스 (여러 부모)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 부모 2대 세로 컬럼(왼쪽) + 자식 2대 세로 컬럼(오른쪽 위) — 실제 electric-motor
 * 토폴로지를 모사한 멀티싱크 버스 검증용. 트렁크는 자식을 모아 부모 컬럼을 따라
 * 내려가며 두 부모에 투입한다.
 */
function busScene() {
  const machines = [machine('M1', 10, 0), machine('M2', 10, 6)];
  const parents = [machine('P1', 0, 9), machine('P2', 0, 15)];
  for (const p of parents) p.recipeName = 'consumer';
  const internal = emptyArea('internal');
  const external = emptyArea('external');
  for (const m of [...machines, ...parents]) blockFootprint(internal, m);
  return { machines, parents, internal, external };
}

/** c footprint 둘레(거리 1) 셀 집합. */
function rimRing(c: Container): Set<string> {
  const ring = new Set<string>();
  for (let x = c.origin.x - 1; x <= c.origin.x + c.size.w; x++)
    for (let y = c.origin.y - 1; y <= c.origin.y + c.size.h; y++) {
      const inside = x >= c.origin.x && x < c.origin.x + c.size.w && y >= c.origin.y && y < c.origin.y + c.size.h;
      if (!inside) ring.add(`${x},${y}`);
    }
  return ring;
}

// 버스 토폴로지(자식이 부모 컬럼에서 떨어져 있음)는 먼 자식 탭에 긴팔(reach 2)이
// 필요하다 — 실제 위저드도 longInserter 보유 시에만 버스를 시도한다.
const busOptions: RouteOptions = {
  ...options,
  longInserter: { reach: 2, entityName: 'long-handed-inserter' },
};

describe('tryMergeClusterOutputBus', () => {
  it('feeds BOTH parents from one belt when capacity allows (nTrunks=1)', () => {
    const { machines, parents, internal, external } = busScene();
    const result = tryMergeClusterOutputBus(machines, parents, internal, external, busOptions, {
      childTotalOutput: 1,
      beltThroughputPerSec: 30, // 1 ≤ 30 → 단일 트렁크
    });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result).toHaveLength(1);

    // 두 부모 각각 둘레에 인서터가 앉아 있어야 한다(둘 다 공급).
    const inserters = result[0].placed.filter((p) => p.cell.entityName === 'inserter');
    const onP1 = inserters.some((p) => rimRing(parents[0]).has(`${p.x},${p.y}`));
    const onP2 = inserters.some((p) => rimRing(parents[1]).has(`${p.x},${p.y}`));
    expect(onP1).toBe(true);
    expect(onP2).toBe(true);
  });

  it('splits into multiple trunks when child output exceeds one belt (capacity-bound)', () => {
    const { machines, parents, internal, external } = busScene();
    const result = tryMergeClusterOutputBus(machines, parents, internal, external, busOptions, {
      childTotalOutput: 100,
      beltThroughputPerSec: 30, // ceil(100/30)=4 → min(4, 2부모, 2자식)=2 트렁크
    });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result).toHaveLength(2);
    // 두 트렁크가 서로 다른 부모를 종착으로 가진다(분배).
    const tos = result.map((r) => r.to.containerId).sort();
    expect(tos).toEqual(['P1', 'P2']);
  });

  it('returns null for fewer than 2 consumers', () => {
    const { machines, parents, internal, external } = busScene();
    expect(
      tryMergeClusterOutputBus(machines, [parents[0]], internal, external, busOptions, {
        childTotalOutput: 1,
        beltThroughputPerSec: 30,
      }),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 폴백 (null)
// ─────────────────────────────────────────────────────────────────────────────

describe('tryMergeClusterOutput fallback', () => {
  it('returns null for a single machine (nothing to merge)', () => {
    const { machines, consumer, internal, external } = scene();
    expect(
      tryMergeClusterOutput([machines[0]], consumer, internal, external, options),
    ).toBeNull();
  });

  it('returns null (all-or-nothing) when one machine cannot be directly tapped', () => {
    // M2(10,5) 둘레를 완전히 막아 직접 탭 불가 → untapped>0 → 그룹 전체 폴백.
    const ring: [number, number][] = [];
    for (let x = 9; x <= 13; x++)
      for (let y = 4; y <= 8; y++) {
        const insideM2 = x >= 10 && x <= 12 && y >= 5 && y <= 7;
        if (!insideM2) ring.push([x, y]);
      }
    const { machines, consumer, internal, external } = scene(ring);
    expect(
      tryMergeClusterOutput(machines, consumer, internal, external, options),
    ).toBeNull();
  });
});
