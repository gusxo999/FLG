// **전 파이프라인 대조 시험 — 계획 구조-2축 · 2 (Step 2 · 3). 계획 폴더에만 산다(src 에 커밋하지 않는다).**
// 쓰는 법: src/autoLayout/zzStepDump.test.ts 로 복사해 돌리고 **지운다**(계획서 §4.3 검증).
//   STEP_DUMP=<출력.json> [STEP_FLAGS=ladder|opposite|direct|nomerge] npx vitest run src/autoLayout/zzStepDump.test.ts
// runLayeredWizard 를 합성 게임데이터로 돌려 결과 전체(issue 순서 · Area · Routing · 실패 그림 · runStats)를 직렬화한다.
// STEP_DUMP 가 없으면 아무것도 안 쓴다 — 전체 시험에 섞여 돌아도 무해하다. 32 픽스처.
// import 는 계획 2 동안 경로가 안 바뀌는 것뿐이다(store 재수출 · layeredWizard · runStats · containerModel · debugFlags).
import { it, vi } from 'vitest';
import fs from 'fs';
import { useGameDataStore, type Entity, type GameData, type Recipe } from '../UI/store/gameDataStore';
import { runLayeredWizard } from './layeredWizard';
import { readRunStats } from '../debug/runStats';
import type { ContainerWizardInput } from './shared/types';
import { setAutoLayoutLinkLadder, setAutoLayoutLinkOppositeFace, setAutoLayoutLinkDirect, setAutoLayoutLaneMerge } from './shared/flags';

const item = (name: string, amount = 1) => ({ name, amount, type: 'item' as const });
const fluid = (name: string, amount = 10, fluidbox_index?: number) =>
  ({ name, amount, type: 'fluid' as const, ...(fluidbox_index ? { fluidbox_index } : {}) });
const recipe = (name: string, category: string, ingredients: Recipe['ingredients'], products: Recipe['products'], energy = 1): Recipe =>
  ({ name, category, energy_required: energy, enabled: true, ingredients, products }) as Recipe;

const E = (e: Record<string, unknown>) => e as unknown as Entity;
const assembler = (name: string, cats: string[], w = 3, h = 3) =>
  E({ name, type: 'assembling-machine', tile_width: w, tile_height: h, crafting_speed: 1, crafting_categories: cats });

// 화학 공장 — fluidPorts.test 의 실측 모양 그대로(입력 N · 출력 S 모서리)
const chemBoxes = [
  { index: 1, production_type: 'input', connections: [{ direction: 0, positions: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }] }] },
  { index: 2, production_type: 'input', connections: [{ direction: 0, positions: [{ x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }] }] },
  { index: 3, production_type: 'output', connections: [{ direction: 8, positions: [{ x: -1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }] }] },
  { index: 4, production_type: 'output', connections: [{ direction: 8, positions: [{ x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }] }] },
];
const chemPlant = (name = 'chemical-plant', w = 3, h = 3) =>
  E({ name, type: 'assembling-machine', tile_width: w, tile_height: h, crafting_speed: 1, crafting_categories: ['chemistry'], fluid_boxes: chemBoxes });

const BASE_ENTITIES: Entity[] = [
  assembler('assembler', ['crafting']),
  chemPlant(),
  chemPlant('tall-chem', 3, 4),
  assembler('dry-chem', ['chemistry-dry']),
  E({ name: 'inserter', type: 'inserter', tile_width: 1, tile_height: 1, inserter_pickup_position: { x: 0, y: -1 }, inserter_rotation_speed: 0.014 }),
  E({ name: 'fast-inserter', type: 'inserter', tile_width: 1, tile_height: 1, inserter_pickup_position: { x: 0, y: -1 }, inserter_rotation_speed: 0.04 }),
  E({ name: 'long-handed-inserter', type: 'inserter', tile_width: 1, tile_height: 1, inserter_pickup_position: { x: 0, y: -2 }, inserter_rotation_speed: 0.02 }),
  E({ name: 'transport-belt', type: 'transport-belt', tile_width: 1, tile_height: 1, belt_speed: 0.03125 }),
  E({ name: 'fast-transport-belt', type: 'transport-belt', tile_width: 1, tile_height: 1, belt_speed: 0.0625 }),
  E({ name: 'underground-belt', type: 'underground-belt', tile_width: 1, tile_height: 1, belt_speed: 0.03125, max_underground_distance: 5 }),
  E({ name: 'pipe', type: 'pipe', tile_width: 1, tile_height: 1 }),
  E({ name: 'pipe-to-ground', type: 'pipe-to-ground', tile_width: 1, tile_height: 1, max_underground_distance: 10,
    fluid_boxes: [{ connections: [{ connection_type: 'underground', max_underground_distance: 10 }] }] }),
  E({ name: 'short-pipe-to-ground', type: 'pipe-to-ground', tile_width: 1, tile_height: 1, max_underground_distance: 1,
    fluid_boxes: [{ connections: [{ connection_type: 'underground', max_underground_distance: 1 }] }] }),
];

const RECIPES: Recipe[] = [
  // 아이템 트리
  recipe('gear', 'crafting', [item('plate', 2)], [item('gear')]),
  recipe('widget', 'crafting', [item('gear', 2), item('plate')], [item('widget')]),
  recipe('gadget', 'crafting', [item('widget'), item('gear'), item('wire', 3), item('plate')], [item('gadget')]),
  recipe('wire', 'crafting', [item('copper')], [item('wire', 2)], 0.5),
  // 유체 트리
  recipe('plastic', 'chemistry', [fluid('petroleum', 20), item('coal')], [item('plastic', 2)]),
  recipe('sulfur', 'chemistry', [fluid('water', 30), fluid('petroleum', 30)], [item('sulfur', 2)]),
  recipe('acid', 'chemistry', [item('sulfur', 5), fluid('water', 100)], [fluid('acid', 50)]),
  recipe('battery', 'chemistry', [fluid('acid', 20), item('plate'), item('copper')], [item('battery')], 4),
  recipe('lube', 'chemistry', [fluid('heavy', 10)], [fluid('lube', 10)]),
  recipe('engine', 'chemistry', [fluid('lube', 15), fluid('acid', 15), item('gear')], [item('engine')]),
  recipe('tall-plastic', 'chemistry-tall', [fluid('petroleum', 20), item('coal')], [item('plastic', 2)]),
  recipe('dry-plastic', 'chemistry-dry', [fluid('petroleum', 20), item('coal')], [item('plastic', 2)]),
  recipe('three-fluid', 'chemistry', [fluid('water', 10), fluid('petroleum', 10), fluid('heavy', 10)], [item('tar')]),
  recipe('split-oil', 'chemistry', [fluid('heavy', 20), item('coal')], [fluid('lube', 10), fluid('acid', 10)]),
  recipe('grease', 'chemistry', [fluid('lube', 10), fluid('acid', 10)], [item('grease')]),
];
const DATA: GameData = { entities: BASE_ENTITIES, recipes: RECIPES };
// tall-chem 은 chemistry-tall 만
(DATA.entities.find((e) => e.name === 'tall-chem') as unknown as { crafting_categories: string[] }).crafting_categories = ['chemistry-tall'];

const base: ContainerWizardInput = {
  targetRecipe: 'widget',
  countMode: 'min',
  internalIngredients: new Set(),
  selectedMachines: ['assembler', 'chemical-plant', 'tall-chem', 'dry-chem'],
  selectedInserters: ['inserter', 'long-handed-inserter'],
  selectedBelts: ['transport-belt'],
  selectedUndergroundPipes: ['pipe-to-ground'],
  selectedUndergroundBelts: ['underground-belt'],
  externalPortsDefault: 'top-left',
};
const I = (o: Partial<ContainerWizardInput>): ContainerWizardInput => ({ ...base, ...o });

const CASES: Array<[string, ContainerWizardInput]> = [
  ['item-min', I({ targetRecipe: 'widget', internalIngredients: new Set(['gear']) })],
  ['item-rate', I({ targetRecipe: 'widget', internalIngredients: new Set(['gear']), countMode: { perTarget: 3 } })],
  ['item-deep', I({ targetRecipe: 'gadget', internalIngredients: new Set(['gear', 'widget', 'wire']), countMode: { perTarget: 2 } })],
  ['item-deep-heavy', I({ targetRecipe: 'gadget', internalIngredients: new Set(['gear', 'widget', 'wire']), countMode: { perTarget: 12 } })],
  ['item-no-ug', I({ targetRecipe: 'gadget', internalIngredients: new Set(['gear', 'widget', 'wire']), countMode: { perTarget: 4 }, selectedUndergroundBelts: [] })],
  ['item-fast', I({ targetRecipe: 'gadget', internalIngredients: new Set(['gear', 'widget', 'wire']), countMode: { perTarget: 6 }, selectedInserters: ['fast-inserter', 'long-handed-inserter'], selectedBelts: ['transport-belt', 'fast-transport-belt'] })],
  ['item-one-inserter-heavy', I({ targetRecipe: 'gadget', internalIngredients: new Set(['gear', 'widget', 'wire']), countMode: { perTarget: 40 }, selectedInserters: ['inserter'] })],
  ['no-belt', I({ selectedBelts: [] })],
  ['no-inserter', I({ selectedInserters: [] })],
  ['no-both', I({ selectedBelts: [], selectedInserters: [] })],
  ['fluid-plastic', I({ targetRecipe: 'plastic', countMode: { perTarget: 2 } })],
  ['fluid-sulfur-2in', I({ targetRecipe: 'sulfur', countMode: { perTarget: 2 } })],
  ['fluid-sulfur-no-ug', I({ targetRecipe: 'sulfur', selectedUndergroundPipes: [] })],
  ['fluid-sulfur-short-ug', I({ targetRecipe: 'sulfur', selectedUndergroundPipes: ['short-pipe-to-ground'] })],
  ['fluid-acid-chain', I({ targetRecipe: 'battery', internalIngredients: new Set(['acid', 'sulfur']), countMode: { perTarget: 1 } })],
  ['fluid-engine-two-fluid-children', I({ targetRecipe: 'engine', internalIngredients: new Set(['lube', 'acid', 'sulfur', 'gear']), countMode: { perTarget: 1 } })],
  ['fluid-non-square', I({ targetRecipe: 'tall-plastic' })],
  ['fluid-no-boxes', I({ targetRecipe: 'dry-plastic' })],
  ['term-long-ug', I({ targetRecipe: 'gadget', internalIngredients: new Set(['gear', 'widget']), countMode: { perTarget: 3 }, selectedInserters: ['long-handed-inserter'] })],
  ['term-long-no-ug', I({ targetRecipe: 'gadget', internalIngredients: new Set(['gear', 'widget']), countMode: { perTarget: 3 }, selectedInserters: ['long-handed-inserter'], selectedUndergroundBelts: [] })],
  ['term-mixed-no-ug', I({ targetRecipe: 'widget', internalIngredients: new Set(['gear']), countMode: { perTarget: 8 }, selectedInserters: ['inserter', 'long-handed-inserter'], selectedUndergroundBelts: [] })],
  ['term-mixed-ug', I({ targetRecipe: 'widget', internalIngredients: new Set(['gear']), countMode: { perTarget: 8 } })],
  ['fluid-three', I({ targetRecipe: 'three-fluid' })],
  ['fluid-split-grease', I({ targetRecipe: 'grease', internalIngredients: new Set(['lube', 'acid']), selectedInserters: ['inserter'] })],
  ['fluid-engine-short-arms', I({ targetRecipe: 'engine', internalIngredients: new Set(['lube', 'acid', 'sulfur', 'gear']), selectedInserters: ['inserter'] })],
  ['fluid-acid-heavy', I({ targetRecipe: 'battery', internalIngredients: new Set(['acid', 'sulfur']), countMode: { perTarget: 4 } })],
  ['term-widget-solo-ug', I({ targetRecipe: 'widget', countMode: { perTarget: 10 } })],
  ['term-widget-solo-no-ug', I({ targetRecipe: 'widget', countMode: { perTarget: 10 }, selectedUndergroundBelts: [] })],
  ['term-gadget-solo-ug', I({ targetRecipe: 'gadget', countMode: { perTarget: 6 } })],
  ['term-gadget-solo-no-ug', I({ targetRecipe: 'gadget', countMode: { perTarget: 6 }, selectedUndergroundBelts: [] })],
  ['term-gadget-solo-fast', I({ targetRecipe: 'gadget', countMode: { perTarget: 14 }, selectedInserters: ['fast-inserter', 'long-handed-inserter'], selectedBelts: ['fast-transport-belt'], selectedUndergroundBelts: [] })],
  ['fluid-plastic-long-only', I({ targetRecipe: 'plastic', selectedInserters: ['long-handed-inserter'], countMode: { perTarget: 4 } })],
];

const replacer = (_k: string, v: unknown) => {
  if (typeof v === 'function') return undefined;
  if (_k === 'startedAt') return undefined; // 시각 — 실행마다 다르다
  if (v instanceof Map) return ['Map', [...v.entries()]];
  if (v instanceof Set) return ['Set', [...v]];
  return v;
};

it('step2 전 파이프라인 덤프', async () => {
  const out = process.env.STEP_DUMP;
  if (!out) return;
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  const flags = (process.env.STEP_FLAGS ?? '').split(',');
  if (flags.includes('ladder')) setAutoLayoutLinkLadder(true);
  if (flags.includes('opposite')) setAutoLayoutLinkOppositeFace(true);
  if (flags.includes('direct')) { setAutoLayoutLinkDirect(true); setAutoLayoutLaneMerge(false); }
  if (flags.includes('nomerge')) setAutoLayoutLaneMerge(false);
  useGameDataStore.getState().setGameData(DATA);
  const dump: Record<string, unknown> = {};
  const coverage: string[] = [];
  const quiet = { log: console.log, warn: console.warn, info: console.info };
  console.log = () => {}; console.warn = () => {}; console.info = () => {};
  try {
    for (const [name, input] of CASES) {
      const res = await runLayeredWizard(input);
      const stats = readRunStats();
      dump[name] = { res, stats };
      const codes = (res.issues ?? []).map((i) => `${i.severity === 'warning' ? 'W:' : ''}${i.code}`);
      const leaf = res.ok ? res.tree.candidates[0] : undefined;
      const fluidRoutings = leaf ? leaf.routings.filter((r) => r.kind === 'fluid').length : 0;
      coverage.push(`${name.padEnd(34)} ok=${res.ok} issues=[${codes.join(',')}] routings=${leaf?.routings.length ?? '-'} fluidRoutings=${fluidRoutings} diag=${leaf?.moduleDiagnostics?.length ?? 0} snapshot=${res.snapshot ? 'y' : 'n'}`);
    }
  } finally {
    console.log = quiet.log; console.warn = quiet.warn; console.info = quiet.info;
  }
  fs.writeFileSync(out, JSON.stringify(dump, replacer, 1), 'utf8');
  fs.writeFileSync(out + '.coverage.txt', coverage.join('\n') + '\n', 'utf8');
});
