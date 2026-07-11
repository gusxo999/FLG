import { describe, it, expect } from 'vitest';
import { EntityType } from '../../../types/layout';
import { emitTrunk } from './trunkEmit';
import { computeTrunkPath, type MachineLike, type TrunkPath } from './trunkPath';

// Direction: 0=N,4=E,8=S,12=W
const N = 0, E = 4, S = 8, W = 12;

const OPTS = {
  chestId: 'CHEST',
  beltEntityName: 'transport-belt',
  inserterEntityName: 'inserter',
  longInserterEntityName: 'long-handed-inserter',
};

describe('emitTrunk', () => {
  const path: TrunkPath = {
    trunkCells: [
      { x: 5, y: 9, dir: E },
      { x: 6, y: 9, dir: E },
      { x: 7, y: 9, dir: E },
    ],
    chestCell: { x: 3, y: 9 },
    covered: [
      { machineId: 'M1', port: { x: 5, y: 10 }, face: 'N', reach: 1, seat: { x: 5, y: 10 }, tapCell: { x: 5, y: 9 }, role: 'source' },
      { machineId: 'M2', port: { x: 8, y: 9 }, face: 'E', reach: 2, seat: { x: 8, y: 9 }, tapCell: { x: 10, y: 9 }, role: 'source' },
    ],
    untapped: ['M3'],
  };

  it('emits one belt cell per trunk cell with correct type/name/dir', () => {
    const e = emitTrunk(path, OPTS);
    expect(e.beltCells).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(e.beltCells[i].x).toBe(path.trunkCells[i].x);
      expect(e.beltCells[i].y).toBe(path.trunkCells[i].y);
      expect(e.beltCells[i].cell.entityType).toBe(EntityType.Belt);
      expect(e.beltCells[i].cell.entityName).toBe('transport-belt');
      expect(e.beltCells[i].cell.direction).toBe(path.trunkCells[i].dir);
    }
  });

  it('emits a chest feeder inserter between chest and trunk start, picking toward chest', () => {
    const e = emitTrunk(path, OPTS);
    expect(e.feeder).not.toBeNull();
    // chest (3,9) → trunkStart (5,9): f=E, feederSeat=(4,9), pickup=−f=W
    expect(e.feeder!.x).toBe(4);
    expect(e.feeder!.y).toBe(9);
    expect(e.feeder!.cell.entityType).toBe(EntityType.Inserter);
    expect(e.feeder!.cell.entityName).toBe('inserter');
    expect(e.feeder!.cell.direction).toBe(W);
  });

  it('emits a tap inserter per covered machine, long prototype for reach 2', () => {
    const e = emitTrunk(path, OPTS);
    expect(e.taps).toHaveLength(2);

    const t1 = e.taps.find((t) => t.machineId === 'M1')!;
    expect(t1.reach).toBe(1);
    expect(t1.inserter.x).toBe(5);
    expect(t1.inserter.y).toBe(10);
    expect(t1.inserter.cell.entityName).toBe('inserter');
    expect(t1.inserter.cell.entityType).toBe(EntityType.Inserter);
    expect(t1.inserter.cell.direction).toBe(N); // faceVector('N') → pickup N

    const t2 = e.taps.find((t) => t.machineId === 'M2')!;
    expect(t2.reach).toBe(2);
    expect(t2.inserter.x).toBe(8);
    expect(t2.inserter.y).toBe(9);
    expect(t2.inserter.cell.entityName).toBe('long-handed-inserter');
    expect(t2.inserter.cell.entityType).toBe(EntityType.Inserter); // type 은 둘 다 Inserter
    expect(t2.inserter.cell.direction).toBe(E); // faceVector('E') → pickup E
  });

  it('sink-role taps pick from the belt (+faceVector) even in collect mode', () => {
    // 멀티싱크 버스: source 는 머신에서 집어 belt 에 놓고(collect 반전), sink(소비자
    // 부모)는 belt 에서 집어 머신에 넣는다(반전 안 함) — 같은 collect belt 위에 공존.
    const busPath: TrunkPath = {
      trunkCells: [
        { x: 5, y: 9, dir: E },
        { x: 6, y: 9, dir: E },
      ],
      chestCell: { x: 3, y: 9 },
      covered: [
        { machineId: 'SRC', port: { x: 5, y: 10 }, face: 'N', reach: 1, seat: { x: 5, y: 10 }, tapCell: { x: 5, y: 9 }, role: 'source' },
        { machineId: 'SINK', port: { x: 6, y: 10 }, face: 'N', reach: 1, seat: { x: 6, y: 10 }, tapCell: { x: 6, y: 9 }, role: 'sink' },
      ],
      untapped: [],
    };
    const e = emitTrunk(busPath, { ...OPTS, mode: 'collect' });

    const src = e.taps.find((t) => t.machineId === 'SRC')!;
    const sink = e.taps.find((t) => t.machineId === 'SINK')!;
    expect(src.role).toBe('source');
    expect(sink.role).toBe('sink');
    // SRC(source, collect): pickup = −faceVector('N')=(0,−1) 반전 → S. 머신→belt.
    expect(src.inserter.cell.direction).toBe(S);
    // SINK(sink): pickup = +faceVector('N')=(0,−1) → N. belt→머신 (collect 무관).
    expect(sink.inserter.cell.direction).toBe(N);
  });

  it('passes untapped machines through as spursNeeded', () => {
    const e = emitTrunk(path, OPTS);
    expect(e.spursNeeded).toEqual(['M3']);
  });

  it('produces unique entityIds across all emitted cells', () => {
    const e = emitTrunk(path, OPTS);
    const ids = [
      ...e.beltCells.map((c) => c.cell.entityId),
      e.feeder!.cell.entityId,
      ...e.taps.map((t) => t.inserter.cell.entityId),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns null feeder when there are no trunk cells', () => {
    const empty: TrunkPath = { trunkCells: [], chestCell: { x: 0, y: 0 }, covered: [], untapped: [] };
    const e = emitTrunk(empty, OPTS);
    expect(e.feeder).toBeNull();
    expect(e.beltCells).toHaveLength(0);
  });

  it('collect mode mirrors supply: belt flow + all inserter pickups reversed', () => {
    const e = emitTrunk(path, { ...OPTS, mode: 'collect' });

    // 벨트 흐름 반전: E → W
    for (const b of e.beltCells) expect(b.cell.direction).toBe(W);

    // 상자 인서터(리시버): supply 의 W → collect 의 E (트렁크에서 집어 상자로)
    expect(e.feeder!.cell.direction).toBe(E);

    // 탭 픽업 반전: M1(N→S), M2(E→W)
    const t1 = e.taps.find((t) => t.machineId === 'M1')!;
    expect(t1.inserter.cell.direction).toBe(S);
    const t2 = e.taps.find((t) => t.machineId === 'M2')!;
    expect(t2.inserter.cell.direction).toBe(W);
    // 셀 위치·prototype 은 그대로 (기하 동일)
    expect(t2.inserter.cell.entityName).toBe('long-handed-inserter');
    expect(t1.inserter.x).toBe(5);
    expect(t1.inserter.y).toBe(10);
  });
});

describe('emitTrunk ∘ computeTrunkPath (composition)', () => {
  it('emits cells consistent with a computed trunk path', () => {
    const machines: MachineLike[] = [
      { id: 'M1', origin: { x: 5, y: 5 }, size: { w: 3, h: 3 } },
      { id: 'M2', origin: { x: 10, y: 5 }, size: { w: 3, h: 3 } },
    ];
    const r = computeTrunkPath({ machines, occupancy: new Set(), chestCandidates: [{ x: 3, y: 9 }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const e = emitTrunk(r.path, OPTS);
    expect(e.beltCells).toHaveLength(r.path.trunkCells.length);
    expect(e.taps.map((t) => t.machineId).sort()).toEqual(r.path.covered.map((c) => c.machineId).sort());
    expect(e.spursNeeded).toEqual(r.path.untapped);
    if (r.path.trunkCells.length > 0) expect(e.feeder).not.toBeNull();
  });
});
