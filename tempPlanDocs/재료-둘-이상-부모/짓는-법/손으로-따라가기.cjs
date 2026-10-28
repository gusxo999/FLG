// 도달 가능 영역 배열 고르기를 손으로 따라가기 — 판 하나를 단위마다 풀어 적는다(사용자 2026-10-22: 실제 예시가 나올 때마다 손으로 따라갈 가이드).
//   node 손으로-따라가기.cjs <머신 수> '<품목 JSON>' '<작은 몫 JSON>'
//   품목 JSON · 작은 몫 JSON 은 판으로.cjs 와 같다 — 같은 판을 판으로.cjs 로 놓으면 행 r 이 판의 y = 5 + r 이다.
//   FULLLANE=1 이면 줄마다 양이 반 레인을 넘는다(옆에서 붙인 입구를 못 쓴다). 앞보기는 끝까지(정한 것).
//
// 단위마다 적는 것:
//   1. 후보 — 단위의 행마다 주인(줄 하나 또는 빈칸)을 정한 배열을 모두 만든다.
//   2. 거르기 — 게임 규칙에 걸리는 배열을 까닭별로 센다.
//   3. 값 차례 — 남은 배열을 값이 낮은 차례로 늘어놓는다.
//   4. 끝까지 채울 길 — 그 차례대로 물어 처음 통과하는 배열을 고른다. 통과 못 한 배열은
//      "이것을 고르고 앞을 안 보고 계속 지으면 어디서 막히나" 를 함께 적는다(막히는 자리의 한 예).
'use strict';
const { linesOf, smallSides, ruleDirs } = require('./모델.cjs');
const { build3, unitsOf } = require('./도달영역.cjs');
const [N, itemsJ, smallJ] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const items = JSON.parse(itemsJ).map(([name, kind, splits, betweens]) => ({ name, kind, splits, betweens }));
const want = JSON.parse(smallJ || '{}');
const lineSets = items.map((it) => linesOf(it, N));
const combos = lineSets.map((ls) => [...smallSides(ls)]).reduce((acc, list) => acc.flatMap((a) => list.map((s) => [...a, s])), [[]]);
let lines;
for (const combo of combos) {
  const ls = []; lineSets.forEach((set, k) => set.forEach((L, i) => ls.push({ ...L, small: combo[k].get(i) || [] })));
  if (ls.every((L) => JSON.stringify(L.small) === JSON.stringify(want[`${L.item}${L.a}-${L.b}`] || []))) { lines = ls; break; }
}
if (!lines) { console.log('작은 몫 JSON 에 맞는 경우가 없다 — 갈리는 머신마다 작은 몫을 받는 줄을 하나씩 적는다'); process.exit(1); }
// LINEINFO · FREE 는 판으로.cjs 와 같다(줄마다 양 · 레인 하나로 되나 · 방향이 자유인 줄의 방향을 짓는 법이 고른다)
const LINEINFO = JSON.parse(process.env.LINEINFO || '{}');
lines.forEach((L) => Object.assign(L, LINEINFO[`${L.item}${L.a}-${L.b}`] || {}));
let dirs = ruleDirs(lines);
const trace = [];
const res = build3(N, lines, dirs, { trace, freeDirs: process.env.FREE === '1' });
const dirs0 = dirs.slice();
if (res.dirs) dirs = res.dirs;
const nm = (i) => `${lines[i].item}${lines[i].a}-${lines[i].b}${dirs[i] === 'S' ? '↓' : '↑'}`;
const show = (arr) => arr.map((o) => (o < 0 ? '빈칸' : nm(o))).join(' / ');
const { us } = unitsOf(N, null);
const mark = (c) => `[${show(c.arr)}]${c.D.length ? ` 미룸 ${c.D.map(nm).join(',')}` : ''}`;

console.log(`줄 ${lines.map((_, i) => nm(i)).join(' · ')}${process.env.FULLLANE === '1' ? ' — 줄마다 양이 반 레인을 넘는다(첫 덩어리 두 칸 이상)' : ''}`);
console.log('값: 옆에서 붙인 입구(레인 하나) 10 · 줄의 범위 밖 행 5 · 필요보다 많은 칸 3 · 막는 칸 1 — 낮을수록 먼저\n');
const picks = [];
let unitTitle = null;
for (const t of trace) {
  if (t.rejects) {
    const byWhy = new Map(); for (const r of t.rejects) byWhy.set(r.why, (byWhy.get(r.why) || 0) + 1);
    const rw = us[t.u].rows;
    console.log(`== 단위 ${t.u}: ${t.kind} · 행 ${rw[0]} ~ ${rw[rw.length - 1]}(판 y ${rw[0] + 5} ~ ${rw[rw.length - 1] + 5}) — 후보 ${t.rejects.length + t.ranked.length} 가지`);
    for (const [w, n] of [...byWhy].sort((a, b) => b[1] - a[1])) console.log(`   거름 ${String(n).padStart(3)} — ${w}`);
    console.log(`   남은 것 ${t.ranked.length} 가지(값 차례): ${t.ranked.slice(0, 6).map((c, k) => `${k + 1}) ${mark(c)} 값 ${c.sc}`).join('  ')}${t.ranked.length > 6 ? ' …' : ''}`);
    continue;
  }
  if (t.ok) {
    console.log(`   → ${mark(t)} 값 ${t.sc}: 끝까지 채울 길이 있다 — 고른다\n`);
    picks[t.u] = { arr: t.arr, D: t.D };
  } else {
    const force = picks.slice(); force[t.u] = { arr: t.arr, D: t.D };
    const r = build3(N, lines, dirs0, { look: 0, force, freeDirs: process.env.FREE === '1' });
    console.log(`   ✗ ${mark(t)} 값 ${t.sc}: 끝까지 채울 길이 없다 — 이것을 고르고 앞을 안 보고 지으면 ${r.ok ? '끝까지 가지만 잣대가 거절한다' : r.why.replace(': ', ' 에서 ')}`);
  }
}
console.log(res.ok ? '다 지었다' : `못 지었다 — ${res.why}`);
