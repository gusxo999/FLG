// 온 레인(줄마다 양이 반 레인을 넘음)에서 안 서는 판이 '갈리는 머신'(두 줄에서 받는 머신)과 얼마나 관계있나 · 갈리는 머신을 경계 끊기로 옮기면 서나
process.env.FULLLANE = '1'; process.env.LOOK = '99';
const dir = './';
const M = require(dir + '모델.cjs'); const D = require(dir + '도달영역.cjs'); const { casesOf } = require(dir + '세로줄.cjs');
function stands(N, items) {
  if (M.picksPerMachine(N, items).slice(1).some((v) => v > 3)) return false;
  for (const its of [items, [items[1], items[0]]]) {
    const lineSets = its.map((it) => M.linesOf(it, N));
    const combos = lineSets.map((ls) => [...M.smallSides(ls)]).reduce((acc, list) => acc.flatMap((a) => list.map((s) => [...a, s])), [[]]);
    let all = true;
    for (const combo of combos) {
      const ls = []; lineSets.forEach((set, k) => set.forEach((L, i) => ls.push({ ...L, small: combo[k].get(i) || [] })));
      if (!D.build3(N, ls, M.ruleDirs(ls)).ok) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}
const valid = (N, it) => !it.splits.some((m) => it.betweens.includes(m) || it.betweens.includes(m - 1)) && it.betweens.every((b) => b >= 1 && b <= N - 1) && new Set(it.betweens).size === it.betweens.length;
// 갈리는 머신 m 하나를 경계 끊기(m-1|m 또는 m|m+1)로 옮긴 판들 — 줄 수는 그대로
function variants(N, it) {
  const out = [it];
  for (const m of it.splits) for (const b of [m - 1, m]) {
    const v = { ...it, splits: it.splits.filter((x) => x !== m), betweens: [...it.betweens, b].sort((p, q) => p - q) };
    if (valid(N, v)) out.push(v);
  }
  // 둘 다 옮기기
  if (it.splits.length === 2) for (const b1 of [it.splits[0] - 1, it.splits[0]]) for (const b2 of [it.splits[1] - 1, it.splits[1]]) {
    const v = { ...it, splits: [], betweens: [...it.betweens, b1, b2].sort((p, q) => p - q) };
    if (valid(N, v)) out.push(v);
  }
  return out;
}
const bySplits = new Map(); const hist = new Map(); let oneFix = 0, fails = 0, fixed = 0, mid = 0, failMid = 0; const unfixed = [];
for (const [N, items] of casesOf('찾기')) {
  if (items[0].kind === 'pair') continue;
  const S = items[0].splits.length + items[1].splits.length;
  const hasMid = items.some((it) => it.splits.length + it.betweens.length >= 2);
  const ok = stands(N, items);
  const t = bySplits.get(S) || [0, 0]; t[0]++; if (!ok) t[1]++; bySplits.set(S, t);
  if (hasMid) mid++;
  if (!ok) {
    fails++; if (hasMid) failMid++;
    // 갈리는 머신 하나만 옮겨서 서나 — 두 품목 가운데 하나의 갈리는 머신 하나
    let found = false, one = false;
    const singles = [];
    for (const [k, it] of items.entries()) for (const m of it.splits) for (const bb of [m - 1, m]) {
      const v = { ...it, splits: it.splits.filter((x) => x !== m), betweens: [...it.betweens, bb].sort((p, q) => p - q) };
      if (valid(N, v)) singles.push(k === 0 ? [v, items[1]] : [items[0], v]);
    }
    let good = 0; const goodMachines = new Set(), allMachines = new Set();
    for (const [vx, vy] of singles) { const mv = [...items[0].splits.filter((m) => !vx.splits.includes(m)).map((m) => 'X' + m), ...items[1].splits.filter((m) => !vy.splits.includes(m)).map((m) => 'Y' + m)][0]; allMachines.add(mv); if (stands(N, [vx, vy])) { good++; goodMachines.add(mv); one = true; } }
    const k = `${goodMachines.size}/${allMachines.size}`; hist.set(k, (hist.get(k) || 0) + 1);
    if (one) { oneFix++; found = true; }
    else { for (const vx of variants(N, items[0])) { for (const vy of variants(N, items[1])) { if (vx === items[0] && vy === items[1]) continue; if (stands(N, [vx, vy])) { found = true; break; } } if (found) break; } }
    if (found) fixed++; else if (unfixed.length < 5) unfixed.push([N, items.map((i) => [i.name, i.splits, i.betweens])]);
  }
}
console.log('갈리는 머신 수별 (판 · 안 섬):', JSON.stringify([...bySplits].sort()));
console.log(`안 서는 판 ${fails} · 그 가운데 가운데 줄이 있는 판 ${failMid} (가운데 줄이 있는 판 전체 ${mid})`);
console.log(`갈리는 머신을 경계 끊기로 옮기면(줄 수 그대로) 서는 판 ${fixed} / ${fails} · 그 가운데 하나만 옮겨도 서는 판 ${oneFix}`);
console.log('안 서는 판마다 (옮겨서 서게 하는 갈리는 머신 수 / 갈리는 머신 수):', JSON.stringify([...hist].sort()));
for (const u of unfixed) console.log('  안 고쳐짐', JSON.stringify(u));
