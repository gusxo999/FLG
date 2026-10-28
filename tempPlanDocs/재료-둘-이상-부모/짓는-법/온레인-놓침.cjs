// 온 레인(옆에서 붙인 입구 없음)에서 짓는 법이 못 지은 판을 잣대(온 레인 모델)로 다시 — 정말 안 서나, 놓친 것인가
'use strict';
const { linesOf, smallSides, ruleDirs, K } = require('./모델.cjs');
const Y = require('./모델-온레인.cjs');
const { build3 } = require('./도달영역.cjs');
const { casesOf } = require('./세로줄.cjs');
const Nonly = Number(process.argv[2] || 5);
let miss = 0, imp = 0;
for (const [N, items] of casesOf('찾기')) {
  if (N !== Nonly) continue;
  const orders = items.length === 2 && items[0].kind !== 'pair' ? [items, [items[1], items[0]]] : [items];
  let built = false;
  for (const its of orders) {
    const ls0 = its.map((it) => linesOf(it, N));
    const combos = ls0.map((ls) => [...smallSides(ls)]).reduce((a, l) => a.flatMap((x) => l.map((s) => [...x, s])), [[]]);
    let all = true;
    for (const c of combos) { const ls = []; ls0.forEach((set, k) => set.forEach((L, i) => ls.push({ ...L, small: c[k].get(i) || [] }))); if (!build3(N, ls, ruleDirs(ls), { look: 99 }).ok) { all = false; break; } }
    if (all) { built = true; break; }
  }
  if (built) continue;
  // 잣대(온 레인 · 규칙 방향) — 작은 몫의 모든 경우가 서야 선다(잣대-규칙방향.cjs 와 같은 판정 — 첫 차례만)
  const ls0 = items.map((it) => linesOf(it, N));
  const combos = ls0.map((ls) => [...smallSides(ls)]).reduce((a, l) => a.flatMap((x) => l.map((s) => [...x, s])), [[]]);
  let yOk = true, bad = null;
  for (const c of combos) { const ls = []; ls0.forEach((set, k) => set.forEach((L, i) => ls.push({ ...L, small: c[k].get(i) || [] }))); if (!Y.searchRows(N, ls, ruleDirs(ls), -K, 3 * N - 1 + K)) { yOk = false; break; } else bad = ls; }
  if (yOk) { miss++; console.log('  놓침:', JSON.stringify(items.map((i) => [i.name, i.splits, i.betweens]))); } else imp++;
}
console.log(`  머신 ${Nonly}대 온 레인 — 짓는 법이 못 지은 판 가운데 잣대도 못 놓음 ${imp} · 짓는 법만 놓침 ${miss}`);
