// 짓는 법(build3)과 잣대(빠짐없는 찾기)를 옆 입구의 레인 조건(C8)을 넣고 견준다 — 판 하나 · 품목 차례 하나 · 작은 몫의 경우 하나마다 둘이 같은 답을 내나.
//   node 견주기.cjs <확정|찾기|셋> <otherDir 꼴>
//   otherDir 꼴 — 줄마다 다른 모듈 면의 방향을 어떻게 놓나
//     없음  모두 비움(다른 면이 아직 안 정해졌다 — 옆 입구는 늘 쓸 수 있고, 쓰면 다른 면을 묶는다)
//     S · N 모두 그 방향
//     반대  모두 이 면의 규칙 방향과 반대(규칙 방향으로는 옆 입구를 못 쓴다)
//     섞음  작은 몫이 있는 줄은 비움(C4 — 한 줄은 한 편에서만 묶인다), 없는 줄은 줄 번호가 짝수면 S · 홀수면 N
//   MAXN=<수> 이면 머신 수가 그 이하인 판만(잣대는 판이 안 설 때 오래 걸린다).
//   FREE=1 이면 방향이 자유인 줄(작은 몫이 없는 줄)의 방향을 짓는 법이 고르고, 잣대는 작은 몫을 지키는 방향을 다 해 본다.
'use strict';
const { K, linesOf, smallSides, ruleDirs, searchRows, solve } = require('./모델.cjs');
const { build3 } = require('./도달영역.cjs');
const { casesOf } = require('./판-묶음.cjs');

const [mode = '확정', pat = '없음'] = process.argv.slice(2);
const FREE = process.env.FREE === '1';
const t0 = Date.now();
const s = { 경우: 0, 둘다섬: 0, 둘다안섬: 0, 짓는법만: 0, 잣대만: 0, 옆입구씀: 0 };
const eg = [];
const MAXN = Number(process.env.MAXN ?? 99);
for (const [N, items] of casesOf(mode).filter(([n]) => n <= MAXN)) {
  const orders = items.length === 2 && items[0].kind !== 'pair' ? [items, [items[1], items[0]]] : [items];
  for (const its of orders) {
    const lineSets = its.map((it) => linesOf(it, N));
    const combos = lineSets.map((ls) => [...smallSides(ls)]).reduce((acc, list) => acc.flatMap((a) => list.map((x) => [...a, x])), [[]]);
    for (const combo of combos) {
      const ls = [];
      lineSets.forEach((set, k) => set.forEach((L, i) => ls.push({ ...L, small: combo[k].get(i) || [] })));
      const rule = ruleDirs(ls);
      ls.forEach((L, i) => {
        const o = pat === 'S' || pat === 'N' ? pat : pat === '반대' ? (rule[i] === 'S' ? 'N' : 'S') : pat === '섞음' && !L.small.length ? (i % 2 ? 'N' : 'S') : undefined;
        if (o) L.otherDir = o;
      });
      const b = build3(N, ls, rule, { freeDirs: FREE });
      const y = FREE ? solve(N, ls) : !!searchRows(N, ls, rule, -K, 3 * N - 1 + K);
      s.경우++;
      if (b.ok && y) s.둘다섬++; else if (!b.ok && !y) s.둘다안섬++; else if (b.ok) s.짓는법만++; else s.잣대만++;
      if (b.ok && b.sideLoaded.length) s.옆입구씀++;
      if (b.ok !== y && eg.length < 5) eg.push(`N${N} ${ls.map((L, i) => `${L.item}${L.a}-${L.b}${rule[i] === 'S' ? '↓' : '↑'}${L.otherDir ? '(다른 면 ' + L.otherDir + ')' : ''}`).join(' · ')} — 짓는 법 ${b.ok ? '섬' : '못 섬: ' + b.why} · 잣대 ${y ? '섬' : '못 섬'}`);
    }
  }
}
console.log(`# 견주기 — 판 묶음 ${mode}${MAXN < 99 ? ' · 머신 ' + MAXN + '대까지' : ''} · otherDir ${pat} · 방향 ${FREE ? '자유인 줄은 고름' : '규칙대로'} · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
console.log(s);
for (const e of eg) console.log('  어긋남: ' + e);
