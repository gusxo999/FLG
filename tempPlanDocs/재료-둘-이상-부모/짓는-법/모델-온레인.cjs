// 세로줄-전수.cjs 의 모델 부분(1~257행)을 그대로 옮겨 모듈로 쓴다 — 짓는 법(세로줄.cjs)의 잣대. 원본은 ../세로줄-전수.cjs
// 세로줄 하나(팔 길이 1 · 받는 쪽)에 품목의 줄들이 놓이는지를 빠짐없이 센다 — 면-나누는-규칙.md §4.4 의 근거.
//   node 세로줄-전수.cjs 확정          규칙만으로(찾기 없음) 짓는다 — 품목마다 줄 둘까지 · 머신 2~8대(0.1초)
//   node 세로줄-전수.cjs 찾기          놓을 수 있나를 빠짐없이 찾는다 — 품목마다 끊는 자리 둘까지 · 머신 2~6대(약 7분)
//   node 세로줄-전수.cjs 규칙 [묶음] N  규칙의 칸 + 기둥 밖만 찾기 — 줄 셋까지(묶음 = 칸 하나 벨트를 그 줄 안에서 묶는 판)
//   node 세로줄-전수.cjs 분류          규칙이 못 지은 판을 품목마다 줄 수로 가른다
//   node 세로줄-전수.cjs 진단 · 비교     못 지은 판에서 방향 · 칸 가운데 무엇이 모자랐나 · 규칙의 칸과 찾은 칸을 나란히
//
// 모델(게임 규칙 — 형태-전수.md §1 · §12.2):
//   행마다 땅 위 칸 하나. 줄은 흐르는 쪽으로 땅 위 칸의 덩어리들을 잇고, 덩어리 사이는 지하벨트(끝 칸이 입구 · 다음 덩어리 첫 칸이 출구).
//   가운데 덩어리는 칸 둘 이상(출구 다음 입구). 첫 덩어리가 칸 하나면 그 칸은 옆에서 붙인 입구라 레인 하나만 받는다(짝은 안 된다).
//   지하벨트 종류 셋 — 노랑 5 · 빨강 7 · 파랑 9 칸. 같은 종류 · 같은 방향의 구간은 겹치지 않는다. 막는 칸 = 짝 없는 입구.
//   줄의 첫 칸은 옆에서 들어오거나(팔 길이 1 이면 바깥 칸이 언제나 빈다) 모델 경계에서 곧게 들어온다.
//   벨트 · 출구는 앞 칸으로 내보낸다. 벨트 · 입구는 뒤에서 받는다. 출구의 뒤 · 입구의 앞은 덮개라 안 이어진다. 마주 보는 벨트는 안 건넨다.
//   머신마다 행 셋 · 행마다 인서터 하나(한 칸 · 한 품목). 줄은 마지막 머신의 행에서 끝난다.
//   요구 3 — 갈리는 머신은 작은 몫을 받는 줄에서 마지막이다. 한 줄이 양 끝에서 다 작은 몫을 받지는 않는다(끊는 규칙).
// 기둥 밖은 위 · 아래 K 행. 줄의 흐르는 방향은 요구 3 을 지키는 것 가운데 아무것이나 — 하나라도 서면 선다고 본다.
'use strict';
const K = 3;
const MAXD = { Y: 5, R: 7, E: 9 };
const TYPES = ['Y', 'R', 'E'];

// ── 줄 만들기 ───────────────────────────────────────────────────────────
// 품목: { name, kind: 'single'|'pair', splits: [머신], betweens: [m (m 과 m+1 사이)] }
function linesOf(item, N) {
  const cuts = [...item.splits.map((m) => ({ m, t: 'split' })), ...item.betweens.map((m) => ({ m, t: 'between' }))].sort((a, b) => a.m - b.m || (a.t === 'split' ? -1 : 1));
  const lines = [];
  let start = 1;
  for (const c of cuts) {
    lines.push({ item: item.name, kind: item.kind, a: start, b: c.m, endCut: c });
    start = c.t === 'split' ? c.m : c.m + 1;
  }
  lines.push({ item: item.name, kind: item.kind, a: start, b: N, endCut: null });
  for (let i = 0; i < lines.length; i++) lines[i].startCut = i === 0 ? null : lines[i - 1].endCut;
  return lines;
}

// 갈리는 머신마다 작은 몫이 위 줄(u)인가 아래 줄(d)인가 — 한 줄이 양 끝에서 다 받지 않게
function* smallSides(lines) {
  const splitIdx = [];
  for (let i = 0; i < lines.length - 1; i++) if (lines[i].endCut.t === 'split') splitIdx.push(i);
  const n = splitIdx.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const small = new Map(); // 줄 번호 → 작은 몫을 받는 머신들
    let ok = true;
    for (let k = 0; k < n; k++) {
      const i = splitIdx[k];
      const li = mask & (1 << k) ? i + 1 : i; // 아래 줄 · 위 줄
      const m = lines[i].endCut.m;
      if (!small.has(li)) small.set(li, []);
      small.get(li).push(m);
      if (small.get(li).length > 1) ok = false;
    }
    if (ok) yield small;
  }
}

// ── 한 판 찾기 ──────────────────────────────────────────────────────────
function solve(N, lines, wantExample) {
  const R0 = -K, R1 = 3 * N - 1 + K; // 행 범위
  const nL = lines.length;
  // 방향의 모든 조합 가운데 요구 3 을 지키는 것
  const dirsList = [];
  for (let mask = 0; mask < 1 << nL; mask++) {
    const dirs = lines.map((_, i) => (mask & (1 << i) ? 'N' : 'S'));
    let ok = true;
    for (let i = 0; i < nL; i++) {
      const L = lines[i], last = dirs[i] === 'S' ? L.b : L.a;
      for (const m of L.small || []) if (m !== last) ok = false;
    }
    if (ok) dirsList.push(dirs);
  }
  for (const dirs of dirsList) {
    const res = searchRows(N, lines, dirs, R0, R1);
    if (res) return wantExample ? { dirs, owner: res } : true;
  }
  return false;
}

function searchRows(N, lines, dirs, R0, R1) {
  const nL = lines.length;
  const need = lines.map((L) => (L.kind === 'pair' ? 2 : 1));
  const covers = (i, m) => lines[i].a <= m && m <= lines[i].b;
  const allowed = (i, r) => (dirs[i] === 'S' ? r <= 3 * lines[i].b - 1 : r >= 3 * (lines[i].a - 1));
  const owner = new Map();
  const lastG = new Array(nL).fill(null);   // 마지막 땅 위 행
  const runLen = new Array(nL).fill(0);     // 지금 덩어리 길이
  const runs = new Array(nL).fill(0);       // 닫힌 덩어리 수 + 열린 것
  const firstRunLen = new Array(nL).fill(0);

  function rec(r) {
    if (r > R1) return finalCheck(N, lines, dirs, owner) ? new Map(owner) : null;
    const opts = [-1];
    for (let i = 0; i < nL; i++) if (allowed(i, r)) opts.push(i);
    for (const o of opts) {
      // 들일 수 있나 — 덩어리 규칙
      const save = o >= 0 ? [lastG[o], runLen[o], runs[o], firstRunLen[o]] : null;
      if (o >= 0) {
        if (lastG[o] === null) { runs[o] = 1; runLen[o] = 1; }
        else if (lastG[o] === r - 1) runLen[o]++;
        else {
          // 새 덩어리 — 닫힌 덩어리가 맨 위 덩어리가 아니면 둘 이상이어야
          if (runs[o] >= 2 && runLen[o] < 2) { restore(o, save); continue; }
          if (r - lastG[o] > 9) { restore(o, save); continue; }
          if (runs[o] === 1) firstRunLen[o] = runLen[o];
          runs[o]++; runLen[o] = 1;
        }
        lastG[o] = r;
        owner.set(r, o);
      }
      // 머신의 마지막 행이면 집는 칸 수를 본다
      let ok = true;
      if (r >= 0 && r < 3 * N && r % 3 === 2) {
        const m = Math.floor(r / 3) + 1;
        for (let i = 0; i < nL && ok; i++) {
          if (!covers(i, m)) continue;
          let c = 0;
          for (let q = r - 2; q <= r; q++) if (owner.get(q) === i) c++;
          if (c < need[i]) ok = false;
        }
      }
      if (ok) { const got = rec(r + 1); if (got) return got; }
      if (o >= 0) { owner.delete(r); restore(o, save); }
    }
    return null;
  }
  function restore(o, s) { [lastG[o], runLen[o], runs[o], firstRunLen[o]] = s; }
  return rec(R0);
}

// 다 채운 뒤 — 덩어리 · 칸의 종류 · 이웃 칸 · 지하벨트 종류
function finalCheck(N, lines, dirs, owner) {
  const nL = lines.length;
  const cells = new Map(); // 행 → { line, role }
  const segs = [];         // { from, to, dir } — 입구 행에서 출구 행
  const endCell = [];
  for (let i = 0; i < nL; i++) {
    const rows = [...owner.entries()].filter(([, o]) => o === i).map(([r]) => r).sort((a, b) => a - b);
    if (!rows.length) return false;
    const flow = dirs[i] === 'S' ? rows : rows.slice().reverse();
    const step = dirs[i] === 'S' ? 1 : -1;
    const rs = [];
    for (const r of flow) { if (rs.length && rs[rs.length - 1].at(-1) + step === r) rs[rs.length - 1].push(r); else rs.push([r]); }
    for (let j = 1; j < rs.length - 1; j++) if (rs[j].length < 2) return false;
    if (rs.length > 1 && rs[0].length === 1) return false; // 온 레인 — 옆에서 붙인 입구(레인 하나)를 안 쓴다 // 옆에서 붙인 입구는 레인 하나
    for (let j = 0; j < rs.length; j++) {
      for (const r of rs[j]) cells.set(r, { line: i, role: 'belt' });
      if (j > 0) cells.get(rs[j][0]).role = 'exit';
      if (j < rs.length - 1) cells.get(rs[j].at(-1)).role = 'entrance';
      if (j < rs.length - 1) segs.push({ from: rs[j].at(-1), to: rs[j + 1][0], dir: dirs[i], line: i });
    }
    endCell[i] = flow.at(-1);
  }
  const outs = (c) => c.role === 'belt' || c.role === 'exit';
  const accepts = (c) => c.role === 'belt' || c.role === 'entrance' || c.role === 'blocker';
  const blockers = [];
  for (const [r, A] of cells) {
    const B = cells.get(r + 1);
    if (!B || B.line === A.line) continue;
    // 아래로 흐르는 A 가 아래 칸의 B(아래로 흐르고 뒤에서 받는)로 흘려 넣나
    if (dirs[A.line] === 'S' && outs(A) && dirs[B.line] === 'S' && accepts(B)) {
      if (endCell[A.line] === r && A.role === 'belt') { A.role = 'blocker'; blockers.push({ at: r, dir: 'S' }); } else return false;
    }
    // 위로 흐르는 B 가 위 칸의 A(위로 흐르고 뒤에서 받는)로 흘려 넣나
    if (dirs[B.line] === 'N' && outs(B) && dirs[A.line] === 'N' && accepts(A)) {
      if (endCell[B.line] === r + 1 && B.role === 'belt') { B.role = 'blocker'; blockers.push({ at: r + 1, dir: 'N' }); } else return false;
    }
  }
  return assignTypes(segs, blockers, lines);
}

let TYPE_POLICY = null; // (줄) → 종류 · 막는 칸은 E
function assignTypes(segs, blockers, lines) {
  const items = [...segs.map((s) => ({ ...s, kind: 'seg', lo: Math.min(s.from, s.to), hi: Math.max(s.from, s.to), len: Math.abs(s.to - s.from) })),
    ...blockers.map((b) => ({ ...b, kind: 'blk' }))];
  const R = Math.max(...Object.values(MAXD));
  // 같은 종류일 때 서로 막을 수 있는 둘 — 같은 방향의 땅속이 겹친다 · 막는 칸이 땅속 안에 있거나 출구에서 사거리 안에 있다
  function touch(a, b) {
    if (a.dir !== b.dir) return false;
    if (a.kind === 'seg' && b.kind === 'seg') return a.lo <= b.hi && b.lo <= a.hi;
    if (a.kind === 'blk' && b.kind === 'blk') return false;
    const [s, bl] = a.kind === 'seg' ? [a, b] : [b, a];
    if (s.lo <= bl.at && bl.at <= s.hi) return true;
    const dist = (s.to - bl.at) * (bl.dir === 'S' ? 1 : -1);
    return dist > 0 && dist <= R;
  }
  // 서로 닿지 않는 무리는 따로 푼다 — 답은 같고, 일이 기둥 길이가 아니라 무리 크기에만 든다
  const n = items.length, root = items.map((_, k) => k);
  const find = (k) => (root[k] === k ? k : (root[k] = find(root[k])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (touch(items[i], items[j])) root[find(i)] = find(j);
  const groups = new Map();
  items.forEach((_, k) => { const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(k); });
  const t = new Array(n);
  function ok(ks, p) {
    const k = ks[p], a = items[k];
    if (a.kind === 'seg' && a.len > MAXD[t[k]]) return false;
    for (let q = 0; q < p; q++) {
      const j = ks[q], b = items[j];
      if (t[j] !== t[k] || a.dir !== b.dir) continue;
      if (a.kind === 'seg' && b.kind === 'seg' && a.lo <= b.hi && b.lo <= a.hi) return false;
      const [s, bl] = a.kind === 'seg' ? [a, b] : [b, a];
      if (s.kind === 'seg' && bl.kind === 'blk') {
        if (s.lo <= bl.at && bl.at <= s.hi) return false;
        const ex = s.to, d = bl.dir === 'S' ? 1 : -1, dist = (ex - bl.at) * d;
        if (dist > 0 && dist <= MAXD[t[k]]) return false; // 막는 칸이 그 출구와 짝을 짓는다
      }
    }
    return true;
  }
  function rec(ks, p) {
    if (p === ks.length) return true;
    const k = ks[p];
    const allowedT = TYPE_POLICY ? [items[k].kind === 'blk' ? 'E' : TYPE_POLICY(lines[items[k].line])] : TYPES;
    for (const ty of allowedT) { t[k] = ty; if (ok(ks, p) && rec(ks, p + 1)) return true; }
    return false;
  }
  for (const ks of groups.values()) if (!rec(ks, 0)) return false;
  return true;
}

// ── 판 묶음 ─────────────────────────────────────────────────────────────
function picksPerMachine(N, items) {
  const per = new Array(N + 1).fill(0);
  for (const it of items) for (let m = 1; m <= N; m++) per[m] += it.kind === 'pair' ? 2 : it.splits.includes(m) ? 2 : 1;
  return per;
}
function subsets(arr, maxSize) {
  const out = [[]];
  for (const x of arr) for (const s of out.slice()) if (s.length < maxSize) out.push([...s, x]);
  return out;
}
function runCase(N, items, wantExample) {
  // 작은 몫의 모든 경우 — 하나라도 안 서면 그 경우를 돌려준다
  const lineSets = items.map((it) => linesOf(it, N));
  const sideLists = lineSets.map((ls) => [...smallSides(ls)]);
  const combos = sideLists.reduce((acc, list) => acc.flatMap((a) => list.map((s) => [...a, s])), [[]]);
  let worst = null, example = null;
  for (const combo of combos) {
    const lines = [];
    lineSets.forEach((ls, k) => ls.forEach((L, i) => lines.push({ ...L, small: combo[k].get(i) || [] })));
    const got = solve(N, lines, wantExample);
    if (!got) { worst = { lines }; break; }
    if (wantExample && !example) example = { lines, ...got };
  }
  return { ok: !worst, worst, example };
}

function show(N, ex) {
  const { lines, dirs, owner } = ex;
  const names = lines.map((L, i) => `${L.item}${L.a}-${L.b}${dirs[i] === 'S' ? '↓' : '↑'}`);
  const out = [];
  for (let r = -K; r <= 3 * N - 1 + K; r++) {
    const o = owner.get(r);
    const m = r >= 0 && r < 3 * N ? Math.floor(r / 3) + 1 : '';
    out.push(`  행 ${String(r).padStart(3)}  머신 ${String(m).padStart(1)}  ${o === undefined ? '.' : names[o]}`);
  }
  return out.join('\n');
}

// ── 규칙으로 짓기 — 면-나누는-규칙.md §2 의 무늬 + 머신마다 바꾸기 ──────────────
// 방향(규칙 §3.4): 품목마다 맨 위 줄 ↓ · 맨 아래 줄 ↑ · 가운데 줄은 그 줄에서 작은 몫을 받는 끝 쪽(없으면 ↓). 줄이 하나면 ↓.
function ruleDirs(lines) {
  const byItem = new Map();
  lines.forEach((L, i) => { if (!byItem.has(L.item)) byItem.set(L.item, []); byItem.get(L.item).push(i); });
  const dirs = new Array(lines.length);
  for (const idx of byItem.values()) {
    idx.sort((p, q) => lines[p].a - lines[q].a);
    idx.forEach((i, k) => {
      const L = lines[i];
      if (k === 0) dirs[i] = 'S';
      else if (k === idx.length - 1) dirs[i] = 'N';
      else dirs[i] = (L.small || []).includes(L.a) ? 'N' : 'S';
    });
  }
  return dirs;
}
// 땅 위 칸(규칙 §2 + 바꾸기): 머신을 둘씩 묶어 칸 하나 벨트(O)가 묶음 가운데 두 행, 칸 둘 벨트(T)가 나머지.

module.exports = { K, MAXD, TYPES, linesOf, smallSides, solve, searchRows, finalCheck, assignTypes, picksPerMachine, subsets, runCase, show, ruleDirs, setTypePolicy: (f) => { TYPE_POLICY = f; } };
