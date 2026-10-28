// 6 단계 보기(2026-10-28) — 부모 4/s × 6 이 X · Y 를 함께 받고, 둘 다 자식 11/s × 3 · 줄 둘.
//   node 6단계-보기.cjs
// 품목마다 걸친 머신이 하나인 꼴은 여섯이다(앞 판은 정확히 반의 두 읽기를 따로 세어 12 라 적었다 — 내력 2026-10-28)(부모 3 · 부모 4 에서 작은 몫이 줄 1 · 줄 2 / 자식 2 의 걸침이 묶은 다른 면의 방향 줄 1 · 줄 2).
// X 여섯 × Y 여섯을 짓는 법(build3 · 방향이 자유인 줄은 짓는 법이 고른다)으로 함께 지어 본다. O — 섰다 · × — 서는 배열이 없다.
// 자식 주는 면은 못 짓는다(U6) — 이 표는 부모 받는 면만이다.
const D = __dirname + '/짓는-법';
const { linesOf, smallSides, ruleDirs } = require(D + '/모델.cjs');
const { build3 } = require(D + '/도달영역.cjs');
const N = 6;
// 꼴 — 부모 면이 받는 것만: 부모 쪽 걸친 머신과 작은 몫의 줄, 또는 자식 쪽 걸침이 묶은 다른 면의 방향
const T = {
  'P3·줄1': (n) => ({ it: [n, 'single', [3], []], small: { [`${n}1-3`]: [3] } }),
  'P3·줄2': (n) => ({ it: [n, 'single', [3], []], small: { [`${n}3-6`]: [3] } }),
  'P4·줄1': (n) => ({ it: [n, 'single', [4], []], small: { [`${n}1-4`]: [4] } }),
  'P4·줄2': (n) => ({ it: [n, 'single', [4], []], small: { [`${n}4-6`]: [4] } }),
  '자식2·줄1': (n) => ({ it: [n, 'single', [], [3]], small: {}, other: { [`${n}1-3`]: 'S' } }),
  '자식2·줄2': (n) => ({ it: [n, 'single', [], [3]], small: {}, other: { [`${n}4-6`]: 'N' } }),
};
function tryBuild(tx, ty) {
  const a = T[tx]('X'), b = T[ty]('Y');
  const items = [a.it, b.it].map(([name, kind, splits, betweens]) => ({ name, kind, splits, betweens }));
  const want = { ...a.small, ...b.small }, other = { ...(a.other || {}), ...(b.other || {}) };
  const sets = items.map((it) => linesOf(it, N));
  const lists = sets.map((ls) => [...smallSides(ls)]);
  const combos = lists.reduce((acc, l) => acc.flatMap((x) => l.map((s) => [...x, s])), [[]]);
  for (const c of combos) {
    const ls = [];
    sets.forEach((set, k) => set.forEach((L, i) => ls.push({ ...L, small: c[k].get(i) || [] })));
    if (!ls.every((L) => JSON.stringify(L.small) === JSON.stringify(want[`${L.item}${L.a}-${L.b}`] || []))) continue;
    ls.forEach((L) => { const o = other[`${L.item}${L.a}-${L.b}`]; if (o) L.otherDir = o; });
    const r = build3(N, ls, ruleDirs(ls), { freeDirs: true });
    return r.ok ? 'O' : '×';
  }
  return '없음';
}
const names = Object.keys(T);
console.log('X \ Y | ' + names.join(' | '));
for (const x of names) console.log(x + ' | ' + names.map((y) => tryBuild(x, y)).join(' | '));
