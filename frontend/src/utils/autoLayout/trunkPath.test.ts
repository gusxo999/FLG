import { describe, it, expect } from 'vitest';
import {
  computeTrunkPath,
  tapCandidates,
  findBeltSubPath,
  type MachineLike,
  type TrunkCell,
} from './trunkPath';

// Direction 상수 (types/layout: 0=N,4=E,8=S,12=W)
const N = 0, E = 4, S = 8, W = 12;

const machine = (id: string, x: number, y: number, w = 3, h = 3): MachineLike => ({
  id,
  origin: { x, y },
  size: { w, h },
});

const occOf = (...cells: [number, number][]) => new Set(cells.map(([x, y]) => `${x},${y}`));

// ─────────────────────────────────────────────────────────────────────────────
// tapCandidates
// ─────────────────────────────────────────────────────────────────────────────

describe('tapCandidates', () => {
  it('emits normal + long per perimeter port when all free', () => {
    const m = machine('m', 5, 5); // 3×3, 둘레 12셀
    const cands = tapCandidates(m, new Set());
    expect(cands).toHaveLength(24); // 12 포트 × {normal, long}

    // N 면 port (5,4): normal seat=rim1=(5,4), tap=rim2=(5,3)
    const n1 = cands.find((c) => c.face === 'N' && c.reach === 1 && c.port.x === 5 && c.port.y === 4)!;
    expect(n1.seat).toEqual({ x: 5, y: 4 });
    expect(n1.tapCell).toEqual({ x: 5, y: 3 });

    // N 면 port (5,4): long seat=rim2=(5,3), tap=rim4=(5,1)
    const n2 = cands.find((c) => c.face === 'N' && c.reach === 2 && c.port.x === 5 && c.port.y === 4)!;
    expect(n2.seat).toEqual({ x: 5, y: 3 });
    expect(n2.tapCell).toEqual({ x: 5, y: 1 });
  });

  it('drops candidates whose seat or tap cell is occupied', () => {
    const m = machine('m', 5, 5);
    // (5,3) 차단 → normal N@(5,4)의 tap, long N@(5,4)의 seat 둘 다 무효 → -2
    const cands = tapCandidates(m, occOf([5, 3]));
    expect(cands).toHaveLength(22);
    expect(cands.some((c) => c.tapCell.x === 5 && c.tapCell.y === 3)).toBe(false);
  });

  it('allows tap cell to coincide with the current trunk head', () => {
    const m = machine('m', 5, 5);
    const head = { x: 5, y: 3 }; // N@(5,4) normal 의 tap
    // head 가 occ 에 있어도 head 면 tap 허용.
    const cands = tapCandidates(m, occOf([5, 3]), head);
    const n1 = cands.find((c) => c.face === 'N' && c.reach === 1 && c.port.x === 5 && c.port.y === 4);
    expect(n1).toBeTruthy();
    expect(n1!.tapCell).toEqual({ x: 5, y: 3 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findBeltSubPath
// ─────────────────────────────────────────────────────────────────────────────

const seatFar = { x: -99, y: -99 }; // 경로와 안 겹치는 seat

describe('findBeltSubPath', () => {
  it('lays a straight run continuing the head direction (0 bends)', () => {
    const path = findBeltSubPath({ x: 0, y: 0 }, E, { x: 3, y: 0 }, new Set(), seatFar)!;
    expect(path.cells.map((c) => [c.x, c.y, c.dir])).toEqual([
      [1, 0, E], [2, 0, E], [3, 0, E],
    ]);
    expect(path.firstDir).toBe(E);
    expect(path.lastDir).toBe(E);
    expect(path.internalBends).toBe(0);
  });

  it('returns an empty path when target == head', () => {
    const path = findBeltSubPath({ x: 2, y: 2 }, S, { x: 2, y: 2 }, new Set(), seatFar)!;
    expect(path.cells).toHaveLength(0);
  });

  it('prefers the L orientation that keeps the head direction (fewer bends)', () => {
    // head 방향 E. target (3,2). HV(가로먼저)는 head 방향 유지 → 총 꺾임 1.
    const path = findBeltSubPath({ x: 0, y: 0 }, E, { x: 3, y: 2 }, new Set(), seatFar)!;
    expect(path.firstDir).toBe(E);
    expect(path.lastDir).toBe(S);
    expect(path.internalBends).toBe(1);
    expect(path.cells).toEqual([
      { x: 1, y: 0, dir: E },
      { x: 2, y: 0, dir: E },
      { x: 3, y: 0, dir: S }, // 코너 — 흐름이 S 로 꺾임
      { x: 3, y: 1, dir: S },
      { x: 3, y: 2, dir: S },
    ]);
  });

  it('falls back to the other L orientation when the first is blocked', () => {
    // HV 경로(가로먼저)의 (1,0)을 막으면 VH(세로먼저)로.
    const occ = occOf([1, 0]);
    const path = findBeltSubPath({ x: 0, y: 0 }, E, { x: 2, y: 2 }, occ, seatFar)!;
    expect(path.firstDir).toBe(S); // 세로 먼저
    expect(path.lastDir).toBe(E);
  });

  it('returns null when every variant is blocked', () => {
    // 두 L 코너 진입 셀을 모두 막음: (1,0)=HV 첫칸, (0,1)=VH 첫칸.
    const occ = occOf([1, 0], [0, 1]);
    const path = findBeltSubPath({ x: 0, y: 0 }, E, { x: 2, y: 2 }, occ, seatFar);
    expect(path).toBeNull();
  });

  it('rejects a path that would run over the inserter seat', () => {
    // 직선 경로 (1,0)..(3,0) 위에 seat (2,0) 을 놓으면 무효.
    const path = findBeltSubPath({ x: 0, y: 0 }, E, { x: 3, y: 0 }, new Set(), { x: 2, y: 0 });
    expect(path).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeTrunkPath (통합)
// ─────────────────────────────────────────────────────────────────────────────

/** trunkCells 가 연속(맨해튼 1 간격)이고 각 셀 dir 이 다음 셀을 가리키는지. */
function assertContinuous(cells: TrunkCell[]) {
  const vec: Record<number, [number, number]> = { [N]: [0, -1], [E]: [1, 0], [S]: [0, 1], [W]: [-1, 0] };
  for (let i = 0; i < cells.length - 1; i++) {
    const a = cells[i];
    const b = cells[i + 1];
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
    const [dx, dy] = vec[a.dir];
    expect({ x: a.x + dx, y: a.y + dy }).toEqual({ x: b.x, y: b.y });
  }
}

describe('computeTrunkPath', () => {
  it('fails with no machines', () => {
    const r = computeTrunkPath({ machines: [], occupancy: new Set(), chestCandidates: [{ x: 0, y: 0 }] });
    expect(r.ok).toBe(false);
  });

  it('grows a single trunk line tapping a row of machines from below', () => {
    // M1(5..7), M2(10..12), y5-7. chest 남서쪽, 트렁크는 y9 (S 포트 seat=y8).
    const machines = [machine('M1', 5, 5), machine('M2', 10, 5)];
    const r = computeTrunkPath({
      machines,
      occupancy: new Set(),
      chestCandidates: [{ x: 3, y: 9 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.path.covered.map((c) => c.machineId).sort()).toEqual(['M1', 'M2']);
    expect(r.path.untapped).toHaveLength(0);
    assertContinuous(r.path.trunkCells);

    // 트렁크 셀이 머신 footprint 나 seat 위에 있으면 안 됨.
    const machineCells = new Set<string>();
    for (const m of machines) {
      for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++)
        machineCells.add(`${m.origin.x + dx},${m.origin.y + dy}`);
    }
    const seatCells = new Set(r.path.covered.map((c) => `${c.seat.x},${c.seat.y}`));
    for (const c of r.path.trunkCells) {
      expect(machineCells.has(`${c.x},${c.y}`)).toBe(false);
      expect(seatCells.has(`${c.x},${c.y}`)).toBe(false);
    }
  });

  it('uses a different face when the natural one is blocked (port freedom)', () => {
    // 단일 머신. chest 가 남쪽에서 접근(자연스러운 면 = S)하지만, S 포트 줄(y8)과
    // 그 tap 줄(y9)을 전부 막아 S 탭 차단 → E/W/N 다른 면으로 우회 탭해야 covered.
    const m = machine('M', 5, 5);
    const blockedSouth = occOf([5, 8], [6, 8], [7, 8], [5, 9], [6, 9], [7, 9]);
    const r = computeTrunkPath({
      machines: [m],
      occupancy: blockedSouth,
      chestCandidates: [{ x: 6, y: 12 }], // 남쪽 → 자연 접근면은 S
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path.covered).toHaveLength(1);
    expect(r.path.covered[0].face).not.toBe('S');
  });

  it('leaves a fully-boxed machine untapped (deferred to spur)', () => {
    // 머신 둘레를 완전히 막아 어떤 직접 탭도 불가 → untapped.
    const m = machine('M', 5, 5);
    const ring: [number, number][] = [];
    for (let x = 3; x <= 9; x++) for (let y = 3; y <= 9; y++) {
      const insideFootprint = x >= 5 && x <= 7 && y >= 5 && y <= 7;
      if (!insideFootprint) ring.push([x, y]);
    }
    const r = computeTrunkPath({
      machines: [m],
      occupancy: occOf(...ring),
      chestCandidates: [{ x: 0, y: 6 }],
    });
    // chest seed 는 멀리 있어 성공하지만, 머신은 직접 탭 불가 → untapped.
    if (r.ok) {
      expect(r.path.untapped).toContain('M');
      expect(r.path.covered).toHaveLength(0);
    }
  });
});
