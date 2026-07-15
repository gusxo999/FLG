import { describe, it, expect } from 'vitest';
import {
  layoutCluster,
  ROW_GAP,
  columnTapCapacity,
  pickClusterShape,
} from './clusterLayout';

describe('layoutCluster (P0 기둥)', () => {
  it('단일 머신 — positions 1개, bbox = footprint', () => {
    const c = layoutCluster({ w: 3, h: 3, count: 1 });
    expect(c.positions).toEqual([{ dx: 0, dy: 0 }]);
    expect(c.size).toEqual({ w: 3, h: 3 });
  });

  it('N=4 3×3 — 세로 기둥, 피치 h+ROW_GAP', () => {
    const c = layoutCluster({ w: 3, h: 3, count: 4 });
    // x 고정, y 가 (3+3)=6 씩 증가.
    expect(c.positions).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 6 },
      { dx: 0, dy: 12 },
      { dx: 0, dy: 18 },
    ]);
    // 높이 = 4*3 + 3*ROW_GAP = 12 + 9 = 21, 폭 = 머신 1대.
    expect(c.size).toEqual({ w: 3, h: 21 });
  });

  it('size.h 가 기존 heightOf 공식과 일치', () => {
    const meta = { w: 3, h: 3, count: 3 };
    const c = layoutCluster(meta);
    const expectedH = meta.count * meta.h + (meta.count - 1) * ROW_GAP;
    expect(c.size.h).toBe(expectedH);
  });

  it('비-3×3 footprint(보일러 3×2)도 기둥 처리', () => {
    const c = layoutCluster({ w: 3, h: 2, count: 2 });
    expect(c.positions).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 5 }, // h(2) + ROW_GAP(3) = 5
    ]);
    expect(c.size).toEqual({ w: 3, h: 7 }); // 2*2 + 1*3
  });

  it('count 0/음수는 최소 1대로 보정', () => {
    const c = layoutCluster({ w: 3, h: 3, count: 0 });
    expect(c.positions).toEqual([{ dx: 0, dy: 0 }]);
    expect(c.size).toEqual({ w: 3, h: 3 });
  });
});

describe('columnTapCapacity (탭 용량)', () => {
  it('reach {1} → 면당 1벨트 × 2면 = 2', () => {
    expect(columnTapCapacity({ reaches: [1] })).toBe(2);
  });

  it('reach {1,2} → 면당 2벨트 × 2면 = 4', () => {
    expect(columnTapCapacity({ reaches: [1, 2] })).toBe(4);
  });

  it('reach {2} 한 종 → 면당 1벨트 = 2', () => {
    expect(columnTapCapacity({ reaches: [2] })).toBe(2);
  });

  it('중복 reach 는 벨트를 못 늘린다 — {1,1} → 2', () => {
    expect(columnTapCapacity({ reaches: [1, 1] })).toBe(2);
  });

  it('reach 종류가 늘면 그만큼 — {1,2,3} → 6', () => {
    expect(columnTapCapacity({ reaches: [1, 2, 3] })).toBe(6);
  });

  it('인서터 없음 → 0', () => {
    expect(columnTapCapacity({ reaches: [] })).toBe(0);
  });
});

describe('pickClusterShape (P1 기둥 + overflow)', () => {
  const longCaps = { reaches: [1, 2] }; // 용량 4
  const regularCaps = { reaches: [1] }; // 용량 2

  it('항상 기둥을 반환', () => {
    expect(pickClusterShape({ beltDemand: 2, pipeDemand: 0 }, longCaps).shape).toBe('column');
    expect(pickClusterShape({ beltDemand: 9, pipeDemand: 0 }, longCaps).shape).toBe('column');
  });

  it('수요 ≤ 용량 → overflow=false (긴팔, 4 belt 까지)', () => {
    // copper-cable(1+1), circuit(2+1), 4-재료(4+1=5 는 초과)
    expect(pickClusterShape({ beltDemand: 2, pipeDemand: 0 }, longCaps).overflow).toBe(false);
    expect(pickClusterShape({ beltDemand: 3, pipeDemand: 0 }, longCaps).overflow).toBe(false);
    expect(pickClusterShape({ beltDemand: 4, pipeDemand: 0 }, longCaps).overflow).toBe(false);
    expect(pickClusterShape({ beltDemand: 5, pipeDemand: 0 }, longCaps).overflow).toBe(true);
  });

  it('belt+pipe 합산으로 overflow 판정(회귀 동등)', () => {
    // 유체도 belt 와 합산해 용량과 비교 — 1단계 회귀 동등(셀-정밀 판정은 후속).
    expect(pickClusterShape({ beltDemand: 2, pipeDemand: 2 }, longCaps).overflow).toBe(false);
    expect(pickClusterShape({ beltDemand: 3, pipeDemand: 2 }, longCaps).overflow).toBe(true);
  });

  it('일반 인서터(용량 2)면 3 I/O 부터 overflow', () => {
    expect(pickClusterShape({ beltDemand: 2, pipeDemand: 0 }, regularCaps).overflow).toBe(false);
    expect(pickClusterShape({ beltDemand: 3, pipeDemand: 0 }, regularCaps).overflow).toBe(true);
  });

  it('capacity 를 함께 보고', () => {
    expect(pickClusterShape({ beltDemand: 3, pipeDemand: 0 }, longCaps).capacity).toBe(4);
    expect(pickClusterShape({ beltDemand: 3, pipeDemand: 0 }, regularCaps).capacity).toBe(2);
  });
});
