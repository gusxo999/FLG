// 벽의 차례를 조건으로 — 짓는 법(셋째 판)이 링크 단계가 낸 차례를 지키며 짓나. 잣대(찾기)도 같은 차례 조건으로 돌려 견준다.
//   node 차례.cjs <머신 수 최대> [차례 가짓수]     머신 2 ~ 최대 · 판마다 차례 몇 가지(제 차례 · 거꾸로 · 섞은 것)
//   차례는 줄 번호를 벽 위에서 아래로 늘어놓은 것. 줄의 벽을 건너는 행 = 흐름의 첫 칸(↓ 은 맨 위 · ↑ 은 맨 아래).
'use strict';
const M = require('./모델.cjs');
const { K, linesOf, smallSides, ruleDirs, searchRows, entriesOf, setOrder } = M;
const { build3 } = require('./도달영역.cjs');
const { casesOf } = require('./세로줄.cjs');
const maxN = Number(process.argv[2] || 4), nOrders = Number(process.argv[3] || 4);
const look = process.env.LOOK ?? 99;
let seed = 7;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const t0 = Date.now();
const tally = new Map(); // 차례 종류 → [잣대 섬, 짓는 법 섬, 짓는 법만 섬(틀림)]
const misses = [];
for (const [N, items] of casesOf('찾기')) {
  if (N > maxN) continue;
  const lineSets = items.map((it) => linesOf(it, N));
  const combos = lineSets.map((ls) => [...smallSides(ls)]).reduce((acc, list) => acc.flatMap((a) => list.map((s) => [...a, s])), [[]]);
  for (const combo of combos) {
    const lines = []; lineSets.forEach((set, k) => set.forEach((L, i) => lines.push({ ...L, small: combo[k].get(i) || [] })));
    const dirs = ruleDirs(lines);
    const free = build3(N, lines, dirs, { look });
    if (!free.ok) continue;
    const e = entriesOf(lines, dirs, free.owner);
    const natural = lines.map((_, i) => i).sort((a, b) => e[a] - e[b]);
    const orders = [['제 차례', natural], ['거꾸로', natural.slice().reverse()]];
    for (let k = 2; k < nOrders; k++) orders.push(['섞음', shuffle(natural)]);
    // 간격 — 제 차례에서 붙어 선 두 줄(벽 위 이웃)을 반드시 건너는 쌍으로 보고 두 행 이상 벌리게
    if (natural.length > 1) { const k = Math.floor(rand() * (natural.length - 1)); orders.push(['제 차례 + 간격 하나', natural, [[natural[k], natural[k + 1]]]]); }
    for (const [kind, order, gap = []] of orders) {
      setOrder({ pos: (() => { const p = []; order.forEach((i, k) => { p[i] = k; }); return p; })(), gap });
      const y = !!searchRows(N, lines, dirs, -K, 3 * N - 1 + K);
      setOrder(null);
      const c = build3(N, lines, dirs, { look, order, gap }).ok;
      const t = tally.get(kind) || [0, 0, 0, 0]; t[0]++; if (y) t[1]++; if (c) t[2]++; if (c && !y) t[3]++; tally.set(kind, t);
      if (y && !c && misses.length < 5) misses.push({ N, names: free.names, order: order.map((i) => free.names[i]) });
    }
  }
}
for (const [k, [n, y, c, bad]] of tally) console.log(`  ${k}: ${n} 번 — 잣대가 놓음 ${y} · 짓는 법이 지음 ${c}${bad ? ` · 짓는 법만 지음(틀림) ${bad}` : ''}`);
for (const m of misses) console.log(`    놓침: N${m.N} ${m.names.join(' · ')} — 차례 ${m.order.join(' / ')}`);
console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}초`);
