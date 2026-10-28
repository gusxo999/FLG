// 짓는 법(셋째 판)이 지었는데 잣대가 거절한 판 — 행마다와 거절 까닭
'use strict';
const { K, linesOf, smallSides, ruleDirs, MAXD } = require('./모델.cjs');
const { build3 } = require('./도달영역.cjs');
const { casesOf } = require('./세로줄.cjs');
const mode = process.argv[2] || '찾기', limit = Number(process.argv[3] || 1);
let shown = 0;
for (const [N, items] of casesOf(mode)) {
  const lineSets = items.map((it) => linesOf(it, N));
  const sideLists = lineSets.map((ls) => [...smallSides(ls)]);
  const combos = sideLists.reduce((acc, list) => acc.flatMap((a) => list.map((s) => [...a, s])), [[]]);
  for (const combo of combos) {
    const lines = []; lineSets.forEach((set, k) => set.forEach((L, i) => lines.push({ ...L, small: combo[k].get(i) || [] })));
    const dirs = ruleDirs(lines);
    const res = build3(N, lines, dirs);
    if (res.ok || !res.why.startsWith('잣대')) continue;
    // finalCheck 의 걸음을 까닭과 함께 다시
    const owner = res.owner, names = res.names;
    console.log(`== N${N} ${names.join(' · ')}`);
    for (let r = -K; r <= 3 * N - 1 + K; r++) console.log(`   행 ${String(r).padStart(3)} 머신 ${r >= 0 && r < 3 * N ? Math.floor(r / 3) + 1 : ' '}  ${owner.has(r) ? names[owner.get(r)] : '.'}`);
    const cells = new Map(); const segs = []; const endCell = [];
    lines.forEach((L, i) => {
      const rows = [...owner].filter(([, o]) => o === i).map(([r]) => r).sort((a, b) => a - b);
      const flow = dirs[i] === 'S' ? rows : rows.slice().reverse(), step = dirs[i] === 'S' ? 1 : -1;
      const rs = []; for (const r of flow) { if (rs.length && rs[rs.length - 1].at(-1) + step === r) rs[rs.length - 1].push(r); else rs.push([r]); }
      for (let j = 1; j < rs.length - 1; j++) if (rs[j].length < 2) console.log(`   ✗ ${names[i]} 가운데 덩어리 한 칸 ${rs[j]}`);
      if (rs.length > 1 && rs[0].length === 1 && L.kind === 'pair') console.log(`   ✗ ${names[i]} 짝 첫 덩어리 한 칸`);
      rs.forEach((c, j) => { c.forEach((r) => cells.set(r, { line: i, role: 'belt' })); if (j > 0) cells.get(c[0]).role = 'exit'; if (j < rs.length - 1) cells.get(c.at(-1)).role = 'entrance'; if (j < rs.length - 1) segs.push({ from: c.at(-1), to: rs[j + 1][0], dir: dirs[i], line: i }); });
      endCell[i] = flow.at(-1);
    });
    const outs = (c) => c.role === 'belt' || c.role === 'exit', accepts = (c) => c.role === 'belt' || c.role === 'entrance' || c.role === 'blocker';
    for (const [r, A] of [...cells].sort((a, b) => a[0] - b[0])) {
      const B = cells.get(r + 1); if (!B || B.line === A.line) continue;
      if (dirs[A.line] === 'S' && outs(A) && dirs[B.line] === 'S' && accepts(B)) { if (endCell[A.line] === r && A.role === 'belt') A.role = 'blocker'; else console.log(`   ✗ 새기 ↓ 행 ${r}→${r + 1} ${names[A.line]}(${A.role}) → ${names[B.line]}(${B.role})`); }
      if (dirs[B.line] === 'N' && outs(B) && dirs[A.line] === 'N' && accepts(A)) { if (endCell[B.line] === r + 1 && B.role === 'belt') B.role = 'blocker'; else console.log(`   ✗ 새기 ↑ 행 ${r + 1}→${r} ${names[B.line]}(${B.role}) → ${names[A.line]}(${A.role})`); }
    }
    console.log(`   땅속 ${segs.map((s) => names[s.line] + ' ' + s.from + '→' + s.to).join(' · ')}`);
    if (++shown >= limit) process.exit(0);
  }
}
