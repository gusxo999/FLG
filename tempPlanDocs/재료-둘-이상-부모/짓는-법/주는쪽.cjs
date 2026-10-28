// 출력과 입력이 한 세로줄 — 첫 품목(X)을 주는 줄(출력 · 흐름의 끝 칸에서 옆으로 나간다)로, 둘째(Y)를 받는 줄로. 짓는 법과 잣대를 견준다.
//   node 주는쪽.cjs <머신 수 최대>
'use strict';
const { K, linesOf, smallSides, ruleDirs, searchRows, solve } = require('./모델.cjs');
const FREE = process.env.FREE === '1';   // 방향이 자유인 줄의 방향도 고른다(짓는 법) · 잣대는 방향을 다 해 본다
const { build3 } = require('./도달영역.cjs');
const { casesOf } = require('./세로줄.cjs');
const maxN = Number(process.argv[2] || 4);
const look = process.env.LOOK ?? 99;
const t0 = Date.now();
const byN = new Map(); const misses = [];
for (const [N, items0] of casesOf('찾기')) {
  if (N > maxN || items0[0].kind !== 'single') continue;
  const items = items0.map((it, k) => (k === 0 ? { ...it, give: true } : it));
  const lineSets = items.map((it) => linesOf(it, N));
  const combos = lineSets.map((ls) => [...smallSides(ls)]).reduce((acc, list) => acc.flatMap((a) => list.map((s) => [...a, s])), [[]]);
  let y = true, c = true;
  for (const combo of combos) {
    const ls = []; lineSets.forEach((set, k) => set.forEach((L, i) => ls.push({ ...L, small: combo[k].get(i) || [], give: !!items[k].give })));
    const dirs = ruleDirs(ls);
    if (c && !build3(N, ls, dirs, { look, freeDirs: FREE }).ok) c = false;
    if (y && !(FREE ? solve(N, ls, false) : searchRows(N, ls, dirs, -K, 3 * N - 1 + K))) y = false;
    if (!y && !c) break;
  }
  const t = byN.get(N) || [0, 0, 0, 0]; t[0]++; if (y) t[1]++; if (c) t[2]++; if (c && !y) t[3]++; byN.set(N, t);
  if (y && !c && misses.length < 4) misses.push({ N, items: items.map((i) => [i.name, i.give ? '줌' : '받음', i.splits, i.betweens]) });
}
console.log(`출력(X) + 입력(Y) 한 세로줄${FREE ? ' · 방향도 고름' : ''}`);
for (const [N, [n, y, c, bad]] of byN) console.log(`  머신 ${N}대: ${n} 판 — 잣대가 놓음 ${y} · 짓는 법이 지음 ${c}${bad ? ` · 짓는 법만(틀림) ${bad}` : ''}`);
for (const m of misses) console.log(`    놓침: N${m.N} ${JSON.stringify(m.items)}`);
console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}초`);
