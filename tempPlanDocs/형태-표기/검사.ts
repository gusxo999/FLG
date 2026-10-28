/**
 * 형태 표기 글 하나를 브라우저 없이 검사한다 — 저장소 루트에서:
 *   npx vite-node tempPlanDocs/형태-표기/검사.ts <글 파일>
 *
 * 1. 글을 칸 목록으로 바꾼다(표기 오류).
 * 2. 게임 규칙으로 본다(지하 짝 · 흘려 넣기 · 인서터 끝) · 줄마다 머신에서 하는 일.
 * 3. 앱의 가동률 검사(`analysis/flow`)를 그대로 돌린다 — 게임 데이터는 합성(아래 ENTITIES).
 * 4. 줄 이름과 레인의 품목이 맞나(한 줄에 다른 품목이 섞였나).
 * 5. 칸 목록을 다시 글로 — 처음 글과 같은지(왕복). 그리고 줄 이름을 지운 칸 목록에서 이름을 다시 붙여 글로(앱 그리드를 글로 바꾸는 길).
 */
import { readFileSync } from 'node:fs';
import { parse, check, render, nameLines, token, type Placed } from './형태표기';
import { analyzeLayout } from '../../src/analysis/flow/build';
import { createEmptyGrid, type LayoutGrid } from '../../src/types/layout';
import type { Entity, Module, Recipe } from '../../src/types/gameData';

const file = process.argv[2];
if (!file) { console.log('쓰는 법: npx vite-node tempPlanDocs/형태-표기/검사.ts <글 파일>'); process.exit(1); }
const text = readFileSync(file, 'utf8');
const P = parse(text);
const C = check(P);
const out: string[] = [];
const say = (s = '') => out.push(s);

say(`# ${P.header.title || file}`);
say(`표기 오류 ${P.problems.length}`); P.problems.forEach((s) => say('  ' + s));
say(`게임 규칙에 어긋남 ${C.faults.length}`); C.faults.forEach((s) => say('  ' + s));
say(`알아 둘 것 ${C.notes.length}`); C.notes.forEach((s) => say('  ' + s));
say('줄마다 머신에서 하는 일(머신 번호는 위에서부터 0)');
for (const [line, r] of [...C.roles].sort()) say(`  ${line.padEnd(4)} ${r.io}  ${r.machines.map((x) => `${x.m} ${x.role}`).join(' · ')}`);

// 합성 게임 데이터 — 벨트 15/s(레인 7.5/s) · 인서터 0.83/s · 긴팔 1.2/s · 머신 제작 속도 1
const ent = (name: string, extra: Partial<Entity> = {}): Entity =>
  ({ id: 1, name, localised_name: name, type: 'test', tile_width: 1, tile_height: 1, ...extra }) as Entity;
const h = P.header;
const ENTITIES: Entity[] = [
  ent(h.belt, { belt_speed: 15 / 480 }),
  ...Object.values(h.underground).map((u) => ent(u.name, { belt_speed: 15 / 480 })),
  ent(h.inserter[1], { inserter_pickup_position: { x: 0, y: -1 }, inserter_drop_position: { x: 0, y: 1.2 } } as Partial<Entity>),
  ent(h.inserter[2], { inserter_pickup_position: { x: 0, y: -2 }, inserter_drop_position: { x: 0, y: 2.2 } } as Partial<Entity>),
  ent(h.machine.name, { crafting_speed: 1, tile_width: h.machine.w, tile_height: h.machine.h }),
  ent(h.chest),
];
const itemName = (l: string) => h.items.get(l) ?? l;
const RECIPES: Recipe[] = h.recipe ? [{
  id: 1, name: h.recipe.name, localised_name: h.recipe.name, category: 'crafting', energy_required: h.recipe.time,
  ingredients: h.recipe.inputs.map((l) => ({ name: itemName(l), amount: 1, type: 'item' as const })),
  products: h.recipe.outputs.map((l) => ({ name: itemName(l), amount: 1, type: 'item' as const })),
} as Recipe] : [];

const minX = Math.min(...P.placed.map((p) => p.x)), minY = Math.min(...P.placed.map((p) => p.y));
const sx = 1 - minX, sy = 1 - minY;
const W = Math.max(...P.placed.map((p) => p.x)) + sx + 2, H = Math.max(...P.placed.map((p) => p.y)) + sy + 2;
const grid: LayoutGrid = createEmptyGrid(W, H);
for (const p of P.placed) grid.cells[(p.y + sy) * W + (p.x + sx)] = p.cell;
const R = analyzeLayout(grid, {
  entityMap: new Map(ENTITIES.map((e) => [e.name, e])),
  recipeMap: new Map(RECIPES.map((r) => [r.name, r])),
  moduleMap: new Map<string, Module>(),
  inserterOverrides: { [h.inserter[1]]: { throughput: 0.83 }, [h.inserter[2]]: { throughput: 1.2 } },
});
say();
say(`가동률 — ${R.summary.total}대 · 100% ${R.summary.full} · 미달 ${R.summary.short} · 판정불가 ${R.summary.unknown}`);
for (const m of R.machines) if (m.state !== 'full') say(`  (${m.x - sx},${m.y - sy}) ${Math.round(m.u * 100)}% ${m.limit ? `${m.limit.side} ${m.limit.item} — ${m.limit.by}` : ''}`);
say(`끊김 — 닿지 않은 인서터 ${R.breaks.deadArms.length} · 마주 본 벨트 ${R.breaks.headOn.length}(마주 보게 그린 줄 끝이면 의도한 것)`);

// 줄 이름 ↔ 레인의 품목
const itemsAt = (x: number, y: number) => {
  const b = R.belts.get(`${x + sx},${y + sy}`);
  return b ? [...new Set([...b.lanes.left.items, ...b.lanes.right.items].filter((i) => i.rate > 1e-9).map((i) => i.item))] : [];
};
const wrong: string[] = [];
for (const [k, line] of P.names) {
  const [x, y] = k.split(',').map(Number);
  const want = itemName(line[0]);
  const got = itemsAt(x, y);
  if (got.some((it) => it !== want)) wrong.push(`  (${x},${y}) ${line} — ${got.join(', ')}`);
}
say(`줄 이름과 다른 품목이 실린 칸 ${wrong.length}`); wrong.forEach((s) => say(s));

// 왕복
const norm = (t: string) => {
  const Q = parse(t);
  return [...Q.toks.values()].map((v) => `${v.x - Math.min(...[...Q.toks.values()].map((u) => u.x))},${v.y - Math.min(...[...Q.toks.values()].map((u) => u.y))}:${JSON.stringify(v.t)}`).sort().join('\n');
};
const back = render(P.placed, P.names, h);
say();
say(`왕복(글 → 칸 → 글) ${norm(back) === norm(text) ? '같다' : '다르다'}`);

// 줄 이름을 지우고 다시 붙인다 — 앱 그리드에는 줄 이름이 없다
const bare: Placed[] = P.placed.map((p) => ({ ...p }));
const named = nameLines(bare, h, itemsAt);
const diff = [...P.names].filter(([k, n]) => named.get(k) !== n);
say(`이름을 지우고 다시 붙인 것 — 처음 이름과 다른 칸 ${diff.length}`);
diff.slice(0, 8).forEach(([k, n]) => say(`  (${k}) ${n} → ${named.get(k)}`));
say();
say(render(bare, named, h));
void token;
console.log(out.join('\n'));
