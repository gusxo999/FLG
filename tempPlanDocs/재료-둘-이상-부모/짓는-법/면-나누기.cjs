// 면 나누기와 끊기 — 받는 모듈의 두 옆면(서 W · 동 E). 입력 품목은 모두 동쪽을 바란다(자식이 동쪽 — 지금 코드의 선호 면).
// 서쪽에는 이 모듈의 출력(주는 줄 하나)이 먼저 선다. 면마다 머신 한 대에 인서터 칸 셋(SEATS). 양은 /s · 벨트 15/s.
//
// 방법 A  — 지금 코드처럼: 가득 채워 끊고, 품목 차례대로 동쪽에 앉힌다. 칸이 모자라면 앉지 못한다(링크는 반대 면을 안 본다 → 틈으로 간다).
// 방법 A′ — A 에 반대 면을 켠 것: 동쪽이 안 되면 서쪽.
// 방법 B  — 면 규칙 §3.2: 가득 채워 끊고, 걸치는 품목부터 동쪽 · 안 되면 서쪽.
// 방법 C  — 면 나누기와 끊기를 함께(수로만): 품목마다 면 둘 × 면마다 칸 수 안의 끊기(방법 5)를 다 보고 대가로 고른다.
//          대가 차례 두 가지 — C벨트: 벨트를 안 늘리는 것 먼저(반대 면 < 벨트 한 줄 더) · C반대: 반대 면을 안 쓰는 것 먼저(벨트 한 줄 더 < 반대 면).
// 고른 줄로 면마다 짓는 법(끝까지 · 방향 자유)을 돌려 자리로도 서나 본다.
//
//   node 면-나누기.cjs <머신 수> <판 수> [품목 수 2|3]
'use strict';
const { linesOf, ruleDirs } = require('./모델.cjs');
const { build3 } = require('./도달영역.cjs');
const { linesOfCuts, allCuts, pour, total, C, EPS } = require('./양-방법.cjs');
const SEATS = Number(process.env.SEATS || 3);

function seatsOk(N, lineLists) {
  const per = new Array(N + 1).fill(0);
  for (const ls of lineLists) for (const L of ls) for (let m = L.a; m <= L.b; m++) per[m]++;
  if (!per.slice(1).every((v) => v <= SEATS)) return false;
  // RULE3=1 — 한 면에 품목 셋이면 그 가운데 하나 이상은 줄마다 머신 두 대 이하(출입구-규칙 ⑤ 의 셈 — 세 대짜리 줄은 안 선다)
  if (process.env.RULE3 === '1' && lineLists.length >= 3 && !lineLists.some((ls) => ls.every((L) => L.b - L.a + 1 <= 2))) return false;
  return true;
}
const straddles = (ls) => ls.reduce((s, L, i) => s + (i && ls[i - 1].b === L.a ? 1 : 0), 0);
const outputLine = (N) => { const [L] = linesOf({ name: 'O', kind: 'single', splits: [], betweens: [] }, N); return { ...L, small: [], give: true, amount: 1.5 * N }; };

// 품목마다 끊는 길 — 줄 수 L0 · L0 + 1
function optionsOf(name, d) {
  const L0 = Math.ceil(total(d) / C - EPS);
  const out = [];
  for (const extra of Array.from({ length: Number(process.env.EXTRA || 1) + 1 }, (_, i) => i)) for (const xs of allCuts(d, L0 + extra)) { const p = linesOfCuts(name, d, xs); if (p) out.push({ lines: p.lines, extra, st: straddles(p.lines) }); }
  const full = linesOfCuts(name, d, pour(d, L0, false));
  return { L0, out, full: full ? { lines: full.lines, extra: full.lines.length - L0, st: straddles(full.lines) } : null };
}
// 한 면에 품목 몇을 둘 때 — 칸 수 안의 끊기 가운데 벨트가 적고 · 걸친 머신이 적은 것(방법 5)
function bestOnFace(N, items, opts, fixed) {
  let best = null;
  const rec = (k, chosen) => {
    if (k === items.length) {
      const lists = [...fixed, ...chosen.map((c) => c.lines)];
      if (!seatsOk(N, lists)) return;
      const key = [chosen.reduce((s, c) => s + c.extra, 0), chosen.reduce((s, c) => s + c.st, 0)];
      if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && key[1] < best.key[1])) best = { key, chosen: chosen.slice() };
      return;
    }
    for (const o of opts[items[k]].out) { chosen.push(o); rec(k + 1, chosen); chosen.pop(); }
  };
  rec(0, []);
  return best;
}
function geometryOk(N, lines) {
  if (!lines.length) return true;
  return build3(N, lines, ruleDirs(lines), { look: 99, freeDirs: process.env.GFREE === '1' }).ok;   // 기본은 규칙 방향(빠르다)
}
function run(N, D) {
  const names = Object.keys(D), opts = Object.fromEntries(names.map((n) => [n, optionsOf(n, D[n])]));
  const O = [outputLine(N)];
  const res = {};
  // A · A′ · B — 가득 채워 끊은 줄을 앉힌다
  const seatGreedy = (order, allowW) => {
    const E = [], W = [O];
    let opposite = 0, extra = 0;
    for (const n of order) {
      const f = opts[n].full; if (!f) return { ok: false, why: '끊기 없음' };
      extra += f.extra;
      if (seatsOk(N, [...E, f.lines])) E.push(f.lines);
      else if (allowW && seatsOk(N, [...W, f.lines])) { W.push(f.lines); opposite++; }
      else return { ok: false, why: '칸 모자람 → 틈 · 그 밖' };
    }
    return { ok: true, extra, opposite, E, W };
  };
  if (process.env.ONLY !== 'C자리') {
    res.A = seatGreedy(names, false);
    res["A'"] = seatGreedy(names, true);
    const byStraddle = names.slice().sort((a, b) => (opts[b].full ? opts[b].full.st : 0) - (opts[a].full ? opts[a].full.st : 0));
    res.B = seatGreedy(byStraddle, true);
  }
  // C — 면 나누기 × 끊기
  const cands = [];
  for (let mask = 0; mask < 1 << names.length; mask++) {
    const onW = names.filter((_, i) => mask >> i & 1), onE = names.filter((_, i) => !(mask >> i & 1));
    const e = bestOnFace(N, onE, opts, []), w = bestOnFace(N, onW, opts, O.map((L) => [L]).flat().length ? [O] : []);
    if (!e || !w) continue;
    cands.push({ opposite: onW.length, extra: e.key[0] + w.key[0], st: e.key[1] + w.key[1], E: e.chosen.map((c) => c.lines), W: [O, ...w.chosen.map((c) => c.lines)] });
  }
  const pick = (cmp) => { const s = cands.slice().sort(cmp); return s.length ? { ok: true, ...s[0] } : { ok: false, why: '칸 모자람 → 틈 · 그 밖' }; };
  if (process.env.ONLY !== 'C자리') {
    res['C벨트'] = pick((p, q) => p.extra - q.extra || p.opposite - q.opposite || p.st - q.st);
    res['C반대'] = pick((p, q) => p.opposite - q.opposite || p.extra - q.extra || p.st - q.st);
  }
  // C자리 — C벨트 차례로 늘어놓고 자리로 서는 첫째(면이 자리를 보고 고르기 — 방법 4 처럼 · 많아야 TRYMAX 개)
  {
    const s = cands.slice().sort(process.env.ORDER === '반대' ? (p, q) => p.opposite - q.opposite || p.extra - q.extra || p.st - q.st : (p, q) => p.extra - q.extra || p.opposite - q.opposite || p.st - q.st);
    let got = null, tries = 0;
    for (const c of s.slice(0, Number(process.env.TRYMAX || 8))) { tries++; if (geometryOk(N, c.E.flat()) && geometryOk(N, c.W.flat())) { got = c; break; } }
    res['C자리'] = got ? { ok: true, ...got, geo: true, tries } : { ok: false, why: s.length ? `앞 ${tries} 개가 자리로 안 섬` : '칸 모자람 → 틈 · 그 밖' };
  }
  for (const k of Object.keys(res)) if (res[k].ok && res[k].geo === undefined) res[k].geo = geometryOk(N, res[k].E.flat()) && geometryOk(N, res[k].W.flat());
  return res;
}
module.exports = { run };

if (require.main === module) {
  const N = Number(process.argv[2] || 5), want = Number(process.argv[3] || 500), k = Number(process.argv[4] || 3);
  let seed = 11; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n; };
  const ranges = { X: [3, 8], Y: [2, 6], Z: [1, 5] };
  const keys = process.env.ONLY === 'C자리' ? ['C자리'] : ['A', "A'", 'B', 'C벨트', 'C반대', 'C자리'];
  const tally = Object.fromEntries(keys.map((x) => [x, {}]));
  let diff = 0, n = 0; const diffEx = [];
  while (n < want) {
    const D = {}; for (const name of Object.keys(ranges).slice(0, k)) { const [lo, w] = ranges[name]; D[name] = Array.from({ length: N }, () => lo + rnd(w)); }
    const r = run(N, D); n++;
    for (const x of keys) {
      const o = r[x];
      const label = !o.ok ? o.why : `${o.extra ? `벨트 +${o.extra}` : '벨트 그대로'} · ${o.opposite ? `반대 면 ${o.opposite}` : '동쪽만'}${o.geo ? '' : ' · 자리로 안 섬'}`;
      tally[x][label] = (tally[x][label] || 0) + 1;
    }
    const cb = r['C벨트'] || {}, co = r['C반대'] || {};
    if (cb.ok && co.ok && (cb.extra !== co.extra || cb.opposite !== co.opposite)) { diff++; if (diffEx.length < 3) diffEx.push(JSON.stringify(D)); }
  }
  console.log(`머신 ${N}대 · 입력 품목 ${k} · 판 ${n}`);
  for (const x of keys) console.log(`  ${x}: ${Object.entries(tally[x]).sort((a, b) => b[1] - a[1]).map(([l, c]) => `${l} ${c}`).join(' | ')}`);
  console.log(`  대가 차례에 따라 고름이 갈린 판: ${diff}`);
  for (const e of diffEx) console.log(`    보기 ${e}`);
}
