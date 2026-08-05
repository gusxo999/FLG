/**
 * moduleInspect — **실행 결과에서 모듈이 실제로 유도되는가.**
 *
 * 이 파일이 있는 이유: `collectModules` 는 실패해도 **예외를 안 낸다 — 빈 배열을 낸다.**
 * 그래서 운반체(`routingEditSession`)를 만드는 코드가 사라졌을 때
 * (manualEdit 격리, 2026-08-02) 아무도 몰랐다. 모듈 테두리·이름표·포트 강조·연결선이
 * 프로덕션에서 **한 번도 그려지지 않았고**, 이름표 클릭이 유일한 입구인 `ModuleInfoPanel`
 * 은 **열릴 방법이 없었다.** 타입도 테스트도 통과하는데 기능만 없었다.
 *
 * 그래서 여기서 **진짜 파이프라인을 돌려** 그 결과가 모듈로 풀리는지 본다.
 * 빈 배열이면 실패한다 — 조용한 죽음이 다시는 조용하지 않도록.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameDataStore, type Entity, type GameData, type Recipe } from '../UI/store/gameDataStore';
import { runLayeredWizard } from './layeredWizard';
import { unifyAreas } from './areaUnification';
import { collectModules, moduleAtCell, overlayFromLayout, overlayFromSnapshot, summarizeRoutings, type ModuleSource } from './moduleInspect';
import type { LayoutIssue, LayoutSnapshot } from './layoutIssue';
import type { CandidateLeaf, ContainerWizardInput } from './containerModel';

const item = (name: string, amount = 1) => ({ name, amount, type: 'item' as const });

const recipe = (
  name: string,
  category: string,
  ingredients: Recipe['ingredients'],
  products: Recipe['products'],
): Recipe =>
  ({ name, category, energy_required: 1, enabled: true, ingredients, products }) as Recipe;

const machine = (name: string, categories: string[]): Entity =>
  ({
    name,
    type: 'assembling-machine',
    tile_width: 3,
    tile_height: 3,
    crafting_speed: 1,
    crafting_categories: categories,
  }) as unknown as Entity;

/** 아이템만 쓰는 2단 트리 — 유체를 섞으면 무관한 이유로 깨진다. */
const DATA: GameData = {
  entities: [
    machine('assembler', ['crafting']),
    { name: 'inserter', type: 'inserter', tile_width: 1, tile_height: 1 } as unknown as Entity,
    { name: 'transport-belt', type: 'transport-belt', tile_width: 1, tile_height: 1 } as unknown as Entity,
  ],
  recipes: [
    recipe('target-item', 'crafting', [item('sub-item')], [item('target-item')]),
    recipe('sub-item', 'crafting', [item('ore')], [item('sub-item')]),
  ],
};

const INPUT: ContainerWizardInput = {
  targetRecipe: 'target-item',
  countMode: 'min',
  externalIngredients: new Set(['ore']),
  selectedMachines: ['assembler'],
  selectedInserters: ['inserter'],
  selectedBelts: ['transport-belt'],
  selectedUndergroundPipes: [],
  selectedUndergroundBelts: [],
  externalPortsDefault: 'top-left',
};

/** 패널의 `handleApplyCandidate` 와 **같은 방식**으로 운반체를 짓는다. */
function sourceOf(leaf: CandidateLeaf): ModuleSource {
  const { offset } = unifyAreas(leaf.internal, leaf.external);
  return {
    containers: [...leaf.internal.containers, ...leaf.external.containers],
    routings: leaf.routings,
    offset,
  };
}

let leaf: CandidateLeaf;

describe('moduleInspect — 실행 결과가 모듈로 풀린다', () => {

  beforeEach(async () => {
    // gameDataStore 가 persist(localStorage) 를 쓴다. 테스트 환경엔 없어서 스텁한다.
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    useGameDataStore.getState().setGameData(DATA);

    const res = await runLayeredWizard(INPUT);
    expect(res.tree.candidates.length).toBeGreaterThan(0);
    leaf = res.tree.candidates[0];
  });

  it('모듈이 **하나 이상** 나온다 — 빈 배열이면 오버레이가 통째로 죽은 것이다', () => {
    const mods = collectModules(sourceOf(leaf));
    expect(mods.length).toBeGreaterThan(0);
  });

  it('트리의 레시피마다 모듈이 하나씩 — 머신 id 접두사로 묶인다', () => {
    const mods = collectModules(sourceOf(leaf));
    const recipes = mods.map((m) => m.recipe).sort();
    expect(recipes).toEqual(['sub-item', 'target-item']);
    for (const m of mods) {
      expect(m.machineCount).toBeGreaterThan(0);
      expect(m.machineEntityName).toBe('assembler');
      expect(m.bbox.w).toBeGreaterThan(0);
      expect(m.bbox.h).toBeGreaterThan(0);
    }
  });

  it('라우팅이 포트로 풀린다 — 포트가 0 이면 연결선·포트 강조가 안 그려진다', () => {
    const mods = collectModules(sourceOf(leaf));
    const totalPorts = mods.reduce((n, m) => n + m.ports.length, 0);
    expect(totalPorts).toBeGreaterThan(0);
    // 포트는 항상 모듈 테두리 안이어야 한다(bbox 를 포트로 확장하므로 구성적 보장).
    for (const m of mods) {
      for (const p of m.ports) {
        expect(p.x).toBeGreaterThanOrEqual(m.bbox.x);
        expect(p.y).toBeGreaterThanOrEqual(m.bbox.y);
        expect(p.x).toBeLessThan(m.bbox.x + m.bbox.w);
        expect(p.y).toBeLessThan(m.bbox.y + m.bbox.h);
      }
    }
  });

  it('moduleAtCell 이 모듈 안의 칸을 짚는다 — 본체 hover 의 근거', () => {
    const mods = collectModules(sourceOf(leaf));
    const target = mods[0];
    const inside = moduleAtCell(target.bbox.x, target.bbox.y, mods);
    expect(inside?.key).toBe(target.key);
    // 배치에서 충분히 먼 칸은 어느 모듈도 아니다.
    expect(moduleAtCell(-9999, -9999, mods)).toBeNull();
  });

  it('summarizeRoutings 가 끝점 식별자를 그대로 옮긴다', () => {
    const src = sourceOf(leaf);
    const sums = summarizeRoutings(src.routings);
    expect(sums.length).toBe(src.routings.length);
    for (let i = 0; i < sums.length; i++) {
      expect(sums[i].id).toBe(src.routings[i].id);
      expect(sums[i].fromContainerId).toBe(src.routings[i].from.containerId);
      expect(sums[i].toContainerId).toBe(src.routings[i].to.containerId);
    }
  });

  it('운반체가 없으면 빈 배열 — 아직 안 돌렸거나 실패한 상태', () => {
    expect(collectModules(null)).toEqual([]);
  });

  it('같은 운반체면 같은 결과 객체 — 마우스 이동마다 재계산하지 않는다', () => {
    const src = sourceOf(leaf);
    expect(collectModules(src)).toBe(collectModules(src));
  });
});

describe('오버레이 정규화 — 성공과 실패가 같은 모양', () => {
  const issue = (over: Partial<LayoutIssue> = {}): LayoutIssue => ({
    code: 'x', scope: '모듈', severity: 'error', recoverable: false, detail: 'd', ...over,
  });

  it('성공 배치의 모듈은 issue 가 없으면 ok', () => {
    const mods = overlayFromLayout(collectModules(sourceOf(leaf)), []);
    expect(mods.length).toBeGreaterThan(0);
    expect(mods.every((m) => m.status === 'ok')).toBe(true);
    expect(mods.every((m) => m.issues.length === 0)).toBe(true);
  });

  it('그 모듈을 가리키는 error 가 있으면 problem — 남의 issue 는 안 묻는다', () => {
    const base = collectModules(sourceOf(leaf));
    const target = base[0].key;
    const mods = overlayFromLayout(base, [
      issue({ target: { moduleId: target } }),
      issue({ target: { moduleId: 'someone-else' } }),
    ]);
    expect(mods.find((m) => m.key === target)!.status).toBe('problem');
    for (const m of mods) {
      if (m.key !== target) expect(m.status).toBe('ok');
    }
  });

  it('경고만 있으면 problem 이 아니다 — 배치는 섰다', () => {
    const base = collectModules(sourceOf(leaf));
    const mods = overlayFromLayout(base, [
      issue({ severity: 'warning', target: { moduleId: base[0].key } }),
    ]);
    expect(mods[0].status).toBe('ok');
    expect(mods[0].issues.length).toBe(1);
  });

  it('실패 스냅샷도 같은 모양 — 좌표는 offset 이 옮긴다', () => {
    const snapshot: LayoutSnapshot = {
      modules: [{
        id: 'n0-x', entityName: 'assembler', machineCount: 2,
        bbox: { x: 5, y: 7, w: 3, h: 3 }, status: 'problem',
      }],
      deliveries: [{ key: 'k1', item: 'iron', from: { x: 5, y: 7 }, to: { x: 9, y: 7 }, ok: false }],
      bbox: { x: 5, y: 7, w: 8, h: 3 },
    };
    const { modules, lines } = overlayFromSnapshot(
      snapshot, [issue({ target: { moduleId: 'n0-x' } })], { x: -4, y: -6 },
    );
    expect(modules[0].bbox).toEqual({ x: 1, y: 1, w: 3, h: 3 });
    expect(modules[0].status).toBe('problem');
    expect(modules[0].issues.length).toBe(1);
    // 포트는 없다 — 라우팅까지 못 갔다.
    expect(modules[0].ports).toEqual([]);
    expect(lines[0]).toMatchObject({ id: 'k1', ok: false, from: { x: 1, y: 1 }, to: { x: 5, y: 1 } });
  });

  it('실패 모듈도 moduleAtCell 로 잡힌다 — 클릭 입구가 같다', () => {
    const snapshot: LayoutSnapshot = {
      modules: [{
        id: 'n0-x', entityName: 'assembler', machineCount: 1,
        bbox: { x: 0, y: 0, w: 3, h: 3 }, status: 'problem',
      }],
      deliveries: [],
      bbox: { x: 0, y: 0, w: 3, h: 3 },
    };
    const { modules } = overlayFromSnapshot(snapshot, [], { x: 1, y: 1 });
    expect(moduleAtCell(2, 2, modules)?.key).toBe('n0-x');
    expect(moduleAtCell(99, 99, modules)).toBeNull();
  });
});
