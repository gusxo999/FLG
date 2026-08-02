/**
 * 인서터 처리량 모델 — **바닐라 앵커 검산 + 범위 안정성.**
 *
 * `items/s = 60 × rotation_speed × stack` 은 보정값이 아니라 **틱 정의에서 유도**된다:
 * rotation_speed 는 틱당 회전수, 한 번 나르려면 왕복(2스윙 = 1턴) = `1/rotation_speed` 틱,
 * 초당 60틱 → 초당 왕복 = `60 × rotation_speed`.
 *
 * **왜 이 파일이 필요한가.** 예전 K(≈16.67)는 "bulk 12스택 = 8/s" 라는 **틀린 앵커** 하나에서
 * 나왔고(실제 ≈ 27.7), 그래서 모든 인서터가 3~3.5배 느렸다. 그 값이
 * [requiredInserterCount](planner/module/clusterPortPlanner.ts) 로 흘러 **어떤 머신으로도 kr-glass 를
 * 못 짓게** 만들었다(2026-07-16 실측). 앵커가 조용히 틀리는 걸 여기서 막는다.
 *
 * **K 범위는 넓다** — 모드 인서터·고급 인서터·스택 보너스. 그래서 특정 값이 아니라 **식의
 * 성질**(선형·단조·0 처리)을 못 박는다. 사용자: "K값의 범위가 넓어도 안정적으로 상황을
 * 처리하는 것이 중요하다"(2026-07-16).
 */
import { describe, it, expect } from 'vitest';
import { inserterThroughput, defaultInserterThroughput, inserterReach } from './inserterThroughput';
import type { Entity } from '../../store/gameDataStore';

const ins = (rot: number | undefined, pickup?: { x: number; y: number }): Entity =>
  ({
    name: 'x',
    type: 'inserter',
    inserter_rotation_speed: rot,
    inserter_pickup_position: pickup,
  }) as unknown as Entity;

describe('inserterThroughput — 바닐라 앵커', () => {
  // 왼쪽 = 게임데이터의 rotation_speed, 오른쪽 = 게임 실측 items/s.
  // 이 식은 팔 뻗는 시간을 안 세므로 실측보다 조금 높게 나온다 → 허용 오차를 그만큼 둔다.
  const anchors: [string, number, number][] = [
    ['inserter', 0.014, 0.83],
    ['long-handed-inserter', 0.02, 1.2],
    ['fast-inserter', 0.04, 2.31],
  ];

  for (const [name, rot, real] of anchors) {
    it(`${name}: rot ${rot} → 게임 실측 ${real}/s 와 5% 안에서 맞는다`, () => {
      const got = inserterThroughput(ins(rot));
      expect(Math.abs(got - real) / real, `${got} vs ${real}`).toBeLessThan(0.05);
    });
  }

  it('bulk-inserter: 스택 12 → 약 27.7/s (옛 앵커는 여기서 8 이라고 했다 — 3.5배 틀렸다)', () => {
    const got = inserterThroughput(ins(0.04), { stackSize: 12 });
    expect(Math.abs(got - 27.7) / 27.7).toBeLessThan(0.05);
  });
});

describe('inserterThroughput — 식의 성질 (K 범위가 넓어도 안정)', () => {
  it('rotation_speed 에 선형 — 2배 빠른 인서터는 2배 나른다', () => {
    expect(inserterThroughput(ins(0.08))).toBeCloseTo(inserterThroughput(ins(0.04)) * 2);
  });

  it('stack 에 선형 — 한 번에 12개면 12배', () => {
    expect(inserterThroughput(ins(0.04), { stackSize: 12 })).toBeCloseTo(
      inserterThroughput(ins(0.04)) * 12,
    );
  });

  it('단조 — 회전이 빠를수록 처리량이 크다 (모드 값이 어디 있든)', () => {
    const rots = [0.001, 0.014, 0.02, 0.04, 0.06, 0.5, 5];
    const tps = rots.map((r) => inserterThroughput(ins(r)));
    for (let i = 1; i < tps.length; i++) expect(tps[i]).toBeGreaterThan(tps[i - 1]);
  });

  it('아주 느린 모드 인서터도 0 이 아니다 — 0 이면 소비처가 나눗셈에서 무한대를 본다', () => {
    expect(inserterThroughput(ins(0.001))).toBeGreaterThan(0);
  });

  it('데이터가 없으면 0 — 지어내지 않는다', () => {
    expect(inserterThroughput(undefined)).toBe(0);
    expect(inserterThroughput(ins(undefined))).toBe(0);
    expect(inserterThroughput(ins(0))).toBe(0);
  });

  it('override throughput 이 최우선 — stack 은 무시된다', () => {
    expect(inserterThroughput(ins(0.04), { throughput: 99, stackSize: 12 })).toBe(99);
    // 0 이하 override 는 무시하고 추정으로 되돌아간다.
    expect(inserterThroughput(ins(0.04), { throughput: 0 })).toBeCloseTo(2.4);
  });

  it('defaultInserterThroughput = stack 1 추정(placeholder 표시용)', () => {
    expect(defaultInserterThroughput(ins(0.04))).toBeCloseTo(2.4);
  });
});

describe('inserterReach — 프로토타입이 정한다(이름 무관)', () => {
  it('pickup 좌표의 최대 절대성분 반올림 — 일반 1, 긴팔 2', () => {
    expect(inserterReach(ins(0.04, { x: 0, y: -1 }))).toBe(1);
    expect(inserterReach(ins(0.02, { x: 0, y: -2 }))).toBe(2);
  });

  it('데이터가 없으면 1', () => {
    expect(inserterReach(ins(0.04))).toBe(1);
    expect(inserterReach(undefined)).toBe(1);
  });
});
