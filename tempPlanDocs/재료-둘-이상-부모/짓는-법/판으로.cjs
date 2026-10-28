// 짓는 법의 세로줄(행마다 주인)을 CLI 놓기 파일로 옮긴다 — 앱에서 보이고 가동률을 잰다.
//   node 판으로.cjs <머신 수> '<품목 JSON>' <작은 몫 JSON> <앞보기 0|1> <파일 이름> [제목]
//   품목 JSON: [["Y","single",[갈리는 머신],[사이]], ...] · 작은 몫 JSON: {"Y1-3":[1], "Y3-4":[3]}(줄 이름 → 작은 몫 머신)
// 놓는 자리: 머신 x 4..6 · 세로줄 x 8 · 인서터 x 7 · 벽 x 9 · 공급 x 13..15 · 출력 x 2..3. 행 r 은 y = 5 + r.
'use strict';
const fs = require('fs');
const path = require('path');
const { linesOf, smallSides, ruleDirs, MAXD, searchRows, K } = require('./모델.cjs');
const { build2 } = require('./세로줄.cjs');
const { build3 } = require('./도달영역.cjs');

const [N, itemsJ, smallJ, look, out, title] = [Number(process.argv[2]), process.argv[3], process.argv[4], Number(process.argv[5]), process.argv[6], process.argv[7]];
const items = JSON.parse(itemsJ).map(([name, kind, splits, betweens]) => ({ name, kind, splits, betweens }));
const wantSmall = JSON.parse(smallJ);
const ITEM = { X: 'iron-gear-wheel', Y: 'copper-cable', Z: 'iron-stick', P: 'pipe', Q: 'electronic-circuit' };
const UG = { Y: 'underground-belt', R: 'fast-underground-belt', E: 'express-underground-belt' };
const Y0 = 5;
// GAPS='[1,3]' 면 그 머신 뒤에 3행 틈 — 머신 m 의 첫 행 top(m)
const GAPS = new Set(JSON.parse(process.env.GAPS || '[]'));
const geom = (() => { if (!GAPS.size) return null; const top = [null]; let r = 0; for (let m = 1; m <= N; m++) { top[m] = r; r += 3 + (GAPS.has(m) ? 3 : 0); } return { top, blocked: new Set() }; })();
const topOf = (m) => (geom ? geom.top[m] : 3 * (m - 1));
const machineOfRow = (r) => { for (let m = 1; m <= N; m++) if (r >= topOf(m) && r <= topOf(m) + 2) return m; return null; };

// 작은 몫이 바라는 대로인 줄 묶음
const lineSets = items.map((it) => linesOf(it, N));
const sideLists = lineSets.map((ls) => [...smallSides(ls)]);
const combos = sideLists.reduce((acc, list) => acc.flatMap((a) => list.map((s) => [...a, s])), [[]]);
let lines = null;
for (const combo of combos) {
  const ls = [];
  lineSets.forEach((set, k) => set.forEach((L, i) => ls.push({ ...L, small: combo[k].get(i) || [] })));
  if (ls.every((L) => JSON.stringify(L.small) === JSON.stringify(wantSmall[`${L.item}${L.a}-${L.b}`] || []))) { lines = ls; break; }
}
if (!lines) throw new Error('그 작은 몫의 묶음이 없다');
// LINEINFO='{"X1-2":{"amount":15,"halfLane":false}}' — 줄마다 양 · 레인 하나로 되나(양-방법.cjs 가 낸 것) · FREE=1 이면 방향이 자유인 줄의 방향을 짓는 법이 고른다
const LINEINFO = JSON.parse(process.env.LINEINFO || '{}');
lines.forEach((L) => Object.assign(L, LINEINFO[`${L.item}${L.a}-${L.b}`] || {}));
let dirs = ruleDirs(lines);
// SOURCE=search 면 잣대(찾기)의 답을 판으로 — 짓는 법이 못 지은 판의 답을 보이려고
const res = process.env.SOURCE === 'search'
  ? (() => { const o = searchRows(N, lines, dirs, -K, 3 * N - 1 + K); return { ok: !!o, why: '찾기도 못 했다', owner: o || new Map() }; })()
  : process.env.BUILDER === '3' ? build3(N, lines, dirs, { look: isNaN(Number(process.env.LOOK3)) ? (process.env.LOOK3 ?? look) : Number(process.env.LOOK3), geom, forceTop: process.env.FORCETOP ? JSON.parse(process.env.FORCETOP) : undefined, freeDirs: process.env.FREE === '1' }) : build2(N, lines, dirs, look);
const owner = res.owner;
if (res.dirs) dirs = res.dirs;
const names = lines.map((L, i) => `${L.item}${L.a}-${L.b}${dirs[i] === 'S' ? '↓' : '↑'}`);

// 칸의 역할 — 흐르는 차례로 덩어리를 자르고, 덩어리 사이는 땅속(입구 → 출구)
const role = new Map(); // r → { i, kind: belt|entrance|exit|blocker }
const segs = [];
const endRow = [];
lines.forEach((L, i) => {
  const rows = [...owner].filter(([, o]) => o === i).map(([r]) => r).sort((a, b) => a - b);
  if (!rows.length) return;
  const flow = dirs[i] === 'S' ? rows : rows.slice().reverse();
  const step = dirs[i] === 'S' ? 1 : -1;
  const ch = [];
  for (const r of flow) { if (ch.length && ch[ch.length - 1].at(-1) + step === r) ch[ch.length - 1].push(r); else ch.push([r]); }
  ch.forEach((c, j) => {
    c.forEach((r) => role.set(r, { i, kind: 'belt' }));
    if (j > 0) role.get(c[0]).kind = 'exit';
    if (j < ch.length - 1) role.get(c.at(-1)).kind = 'entrance';
    if (j < ch.length - 1) segs.push({ from: c.at(-1), to: ch[j + 1][0], dir: dirs[i], line: i });
  });
  endRow[i] = flow.at(-1);
});
// 막는 칸 — 같은 방향으로 미는 끝이 벨트면 짝 없는 입구로
const blockers = [];
const outs = (c) => c.kind === 'belt' || c.kind === 'exit';
const accepts = (c) => c.kind === 'belt' || c.kind === 'entrance' || c.kind === 'blocker';
for (const [r, A] of [...role].sort((a, b) => a[0] - b[0])) {
  const B = role.get(r + 1);
  if (!B || B.i === A.i) continue;
  if (dirs[A.i] === 'S' && outs(A) && dirs[B.i] === 'S' && accepts(B) && endRow[A.i] === r && A.kind === 'belt') { A.kind = 'blocker'; blockers.push({ at: r, dir: 'S', line: A.i }); }
  if (dirs[B.i] === 'N' && outs(B) && dirs[A.i] === 'N' && accepts(A) && endRow[B.i] === r + 1 && B.kind === 'belt') { B.kind = 'blocker'; blockers.push({ at: r + 1, dir: 'N', line: B.i }); }
}
// 지하벨트 종류 — 같은 종류 · 같은 방향 구간이 겹치지 않고, 막는 칸이 그 방향 사거리 안의 같은 종류 출구와 짝을 짓지 않게
const typeOf = new Map();
const objs = [...segs.map((s) => ({ ...s, k: 'seg', lo: Math.min(s.from, s.to), hi: Math.max(s.from, s.to), len: Math.abs(s.to - s.from) })), ...blockers.map((b) => ({ ...b, k: 'blk' }))];
const T = Object.keys(MAXD);
const tt = new Array(objs.length);
function okT(k) {
  const a = objs[k];
  if (a.k === 'seg' && a.len > MAXD[tt[k]]) return false;
  for (let j = 0; j < k; j++) {
    const b = objs[j];
    if (tt[j] !== tt[k] || a.dir !== b.dir) continue;
    if (a.k === 'seg' && b.k === 'seg' && a.lo <= b.hi && b.lo <= a.hi) return false;
    const [sg, bl] = a.k === 'seg' ? [a, b] : [b, a];
    if (sg.k === 'seg' && bl.k === 'blk') {
      if (sg.lo <= bl.at && bl.at <= sg.hi) return false;
      const d = bl.dir === 'S' ? 1 : -1, dist = (sg.to - bl.at) * d;
      if (dist > 0 && dist <= MAXD[tt[k]]) return false;
    }
  }
  return true;
}
function rec(k) { if (k === objs.length) return true; for (const t of T) { tt[k] = t; if (okT(k) && rec(k + 1)) return true; } return false; }
if (!rec(0)) throw new Error('지하벨트 종류를 못 나눈다');
objs.forEach((o, k) => { if (o.k === 'seg') { typeOf.set(o.from, tt[k]); typeOf.set(o.to, tt[k]); } else typeOf.set(o.at, tt[k]); });

// 놓기
const place = [], labels = [];
const used = new Set();
const put = (e) => { const key = `${e.x},${e.y}`; if (used.has(key)) throw new Error(`겹침 ${key}`); used.add(key); place.push(e); };
for (let m = 1; m <= N; m++) {
  place.push({ x: 4, y: Y0 + topOf(m), name: 'plant', recipe: 'col-recipe' });
  for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) used.add(`${4 + dx},${Y0 + topOf(m) + dy}`);
  put({ x: 3, y: Y0 + topOf(m) + 1, name: 'inserter', dir: 'E' });
  put({ x: 2, y: Y0 + topOf(m) + 1, name: 'infinity-chest', sink: true });
  labels.push({ x: 5, y: Y0 + topOf(m) + 1, text: `머신 ${m}` });
}
for (const [r, c] of role) {
  const y = Y0 + r, d = dirs[c.i];
  if (c.kind === 'belt') put({ x: 8, y, name: 'belt', dir: d });
  else put({ x: 8, y, name: UG[typeOf.get(r)], dir: d, ug: c.kind === 'exit' ? 'output' : 'input' });
  const m = machineOfRow(r), L = lines[c.i];
  if (m !== null && L.a <= m && m <= L.b) put({ x: 7, y, name: 'inserter', dir: 'E' });
}
// 옆에서 들어오는 자리 — 줄마다 흐름의 첫 칸 행에서 벽을 건넌다
lines.forEach((L, i) => {
  const rows = [...owner].filter(([, o]) => o === i).map(([r]) => r).sort((a, b) => a - b);
  if (!rows.length) return;
  const first = dirs[i] === 'S' ? rows[0] : rows.at(-1), y = Y0 + first;
  for (let x = 9; x <= 13; x++) put({ x, y, name: 'belt', dir: 'W' });
  put({ x: 14, y, name: 'inserter', dir: 'E' });
  put({ x: 15, y, name: 'infinity-chest', supply: [ITEM[L.item]] });
  labels.push({ x: 9, y, text: `출입구 ${names[i]}${L.amount !== undefined ? ` ${L.amount}/s${L.halfLane ? '(레인 하나로 됨)' : ''}` : ''}${(L.small || []).length ? ` — 작은 몫 머신 ${L.small}` : ''}` });
});
const recipe = { id: 300, name: 'col-recipe', localised_name: 'col-recipe', category: 'test', energy_required: 1, enabled: true,
  ingredients: [...new Set(lines.map((L) => L.item))].map((it) => ({ name: ITEM[it], amount: 1, type: 'item' })),
  products: [{ name: 'col-out', amount: 1, type: 'item' }] };
const extra = process.env.LABELS ? JSON.parse(process.env.LABELS) : [];
const file = { title: title || out, prototypes: 'kit.json', recipes: [recipe], inserterOverrides: { inserter: { throughput: 100 } }, place, labels: [...labels, ...extra] };
const dest = path.join(__dirname, '..', '놓기', `${out}.json`);
fs.writeFileSync(dest, JSON.stringify(file, null, 1));
console.log(`${res.ok ? '지었다' : '못 지었다 — ' + res.why} → ${dest}`);
for (let r = -K; r <= topOf(N) + 2 + K; r++) { const c = role.get(r); console.log(`  행 ${String(r).padStart(2)} ${machineOfRow(r) ? '머신 ' + machineOfRow(r) : '      '}  ${c ? names[c.i] + ' ' + c.kind + (typeOf.has(r) ? '(' + typeOf.get(r) + ')' : '') : '.'}`); }
