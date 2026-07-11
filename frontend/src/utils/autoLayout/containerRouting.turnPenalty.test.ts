import { describe, it, expect } from 'vitest';
import {
  dijkstraWithJumps,
  type DijkstraInput,
  type JumpEdge,
} from './containerRouting';
import { cellKey } from './util/helper';

// ─────────────────────────────────────────────────────────────────────────────
// turnPenalty — 곧은 벨트 선호 + 장애물 직진 점프(우회 회피)
//
// 외부상자 드래그 재라우팅에서 가독성을 위해 켜는 꺾임 penalty 의 코어 동작을
// dijkstraWithJumps 수준에서 검증한다(드래그 경로가 이 옵션을 켜고 호출함).
// ─────────────────────────────────────────────────────────────────────────────

const base = (over: Partial<DijkstraInput>): DijkstraInput => ({
  blocked: new Set<string>(),
  corridors: [],
  maxJumpDistance: 0,
  blockGroup: 'transport-belt',
  jumpCostModel: 'length',
  ...over,
});

/** 결과 cells 시퀀스에서 진행 방향이 바뀌는 횟수(꺾임 수). */
function countTurns(cells: Array<{ x: number; y: number }>): number {
  const dirs: Array<{ dx: number; dy: number }> = [];
  for (let i = 1; i < cells.length; i++) {
    const dx = Math.sign(cells[i].x - cells[i - 1].x);
    const dy = Math.sign(cells[i].y - cells[i - 1].y);
    dirs.push({ dx, dy });
  }
  let turns = 0;
  for (let i = 1; i < dirs.length; i++) {
    if (dirs[i].dx !== dirs[i - 1].dx || dirs[i].dy !== dirs[i - 1].dy) turns += 1;
  }
  return turns;
}

const isJump = (e: unknown): e is JumpEdge =>
  typeof e === 'object' && e !== null && 'k' in e;

describe('dijkstraWithJumps turnPenalty', () => {
  it('penalty 를 켜면 열린 격자에서 꺾임 최소(L 자, 1회)를 고른다', () => {
    // (0,0) → (4,2): 맨해튼 경로는 길이 동일, 꺾임만 다르다(L=1, 계단=다수).
    const res = dijkstraWithJumps(
      base({ start: { x: 0, y: 0 }, end: { x: 4, y: 2 }, turnPenalty: 2 }),
    );
    expect(res).not.toBeNull();
    expect(countTurns(res!.cells)).toBe(1);
  });

  it('장애물(상자)을 만나면 우회하지 않고 직진 점프로 넘는다', () => {
    // (0,0)→(0,4) 수직선, (0,2) 에 상자. 점프 가능 + penalty → 열 x=0 유지하며 점프.
    const res = dijkstraWithJumps(
      base({
        start: { x: 0, y: 0 },
        end: { x: 0, y: 4 },
        blocked: new Set([cellKey(0, 2)]),
        maxJumpDistance: 4,
        turnPenalty: 2,
      }),
    );
    expect(res).not.toBeNull();
    // 점프 edge 가 최소 하나 — 지하로 넘었다.
    expect(res!.edges.some(isJump)).toBe(true);
    // 측면 우회 없음 — 모든 셀이 같은 열(x=0).
    expect(res!.cells.every((c) => c.x === 0)).toBe(true);
    // 직진 — 꺾임 0.
    expect(countTurns(res!.cells)).toBe(0);
  });

  it('점프가 불가능하면(maxJumpDistance=0) 우회는 여전히 허용된다', () => {
    // 같은 장애물이지만 점프 비활성 → 측면 우회(꺾임 발생)로라도 경로를 찾는다.
    // (벨트 우회는 필요 — penalty 가 우회 자체를 막지는 않는다.)
    const res = dijkstraWithJumps(
      base({
        start: { x: 0, y: 0 },
        end: { x: 0, y: 4 },
        blocked: new Set([cellKey(0, 2)]),
        maxJumpDistance: 0,
        turnPenalty: 2,
      }),
    );
    expect(res).not.toBeNull();
    expect(res!.cells.some((c) => c.x !== 0)).toBe(true); // 우회함
  });

  it('penalty 미지정이면 기존 동작(꺾임 무비용) — 경로는 여전히 찾는다', () => {
    const res = dijkstraWithJumps(
      base({ start: { x: 0, y: 0 }, end: { x: 4, y: 2 } }),
    );
    expect(res).not.toBeNull();
    // 길이(맨해튼)는 6 cells = 7 노드.
    expect(res!.cells.length).toBe(7);
  });
});
