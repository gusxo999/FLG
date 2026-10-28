// 쓰는 법: node 옆입구-레인.cjs <놓기 폴더>   (예: ../재료-둘-이상-부모/놓기) — 견적서 S6
// 놓기 파일마다 — 옆에서 벨트가 붙은 지하벨트 입구 · 출구가 들이는 레인과, 그 줄의 물건이 실린 레인을 견준다.
// 게임 사실: 입구는 뒤쪽 반(방향의 반대쪽)에 닿는 레인만, 출구는 앞쪽 반에 닿는 레인만 들인다(belt-lane-semantics §4 · 사용자 2026-10-08 · 10-15).
// 인서터: 옆에서 놓으면 먼 레인 · 나란히 놓으면 놓는 방향의 오른쪽(사용자 2026-10-25 — 벨트가 인서터에서 멀어지는 판으로 확인).
const fs = require('fs'), path = require('path');
const V = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' }, RIGHT = { N: 'E', E: 'S', S: 'W', W: 'N' };
const relLane = (beltDir, absSide) => (absSide === RIGHT[beltDir] ? 'R' : absSide === OPP[RIGHT[beltDir]] ? 'L' : '?');
const isBelt = (p) => p && (p.name === 'belt' || /underground/.test(p.name));
const range = (n) => (/express/.test(n) ? 9 : /fast/.test(n) ? 7 : 5);

function check(file) {
  const f = JSON.parse(fs.readFileSync(file, 'utf8'));
  const at = new Map(); for (const p of f.place || []) at.set(`${p.x},${p.y}`, p);
  const get = (x, y) => at.get(`${x},${y}`);
  const pointsInto = (p, x, y) => isBelt(p) && !(p.ug === 'input') && p.x + V[p.dir][0] === x && p.y + V[p.dir][1] === y;
  // 인서터가 이 칸에 놓나 → 놓는 방향
  const dropsOn = (x, y) => {
    const out = [];
    for (const p of f.place || []) {
      if (!/inserter/.test(p.name)) continue;
      const r = /long/.test(p.name) ? 2 : 1, d = OPP[p.dir]; // dir = 집는 쪽 → 놓는 방향은 반대
      if (p.x + V[d][0] * r === x && p.y + V[d][1] * r === y) out.push(d);
    }
    return out;
  };
  // 칸 c 에서 위로 거슬러 올라가며 물건이 실린 레인(c 의 방향 기준 L/R)을 모은다
  function lanesAt(c, depth = 0) {
    if (depth > 200) return { lanes: new Set(), note: '깊다' };
    const lanes = new Set(); let note = '';
    for (const d of dropsOn(c.x, c.y)) lanes.add(d === c.dir || d === OPP[c.dir] ? relLane(c.dir, RIGHT[d]) : relLane(c.dir, d));
    // 거슬러 오를 칸
    let ups = [];
    if (c.ug === 'output') {
      for (let k = 1; k <= range(c.name); k++) {
        const q = get(c.x - V[c.dir][0] * k, c.y - V[c.dir][1] * k);
        if (q && q.name === c.name && q.ug === 'input' && q.dir === c.dir) { ups = [{ q, kind: 'tunnel' }]; break; }
      }
    } else {
      for (const s of ['N', 'E', 'S', 'W']) {
        const q = get(c.x - V[s][0], c.y - V[s][1]);
        if (q && pointsInto(q, c.x, c.y) || (q && q.ug === 'output' && q.x + V[q.dir][0] === c.x && q.y + V[q.dir][1] === c.y)) ups.push({ q, kind: q.dir === c.dir ? 'back' : 'side' });
      }
    }
    if (ups.length > 1) note = `유입 ${ups.length}개 — 접힘(안 따라감)`;
    if (ups.length === 1) {
      const { q, kind } = ups[0];
      const sub = lanesAt(q, depth + 1);
      if (sub.note) note = sub.note;
      if (kind === 'side' && c.ug) note = note || '옆 입구 위에 또 옆 입구';
      for (const l of sub.lanes) lanes.add(l); // 직진 · 곡선 · 땅속은 왼쪽 · 오른쪽을 지킨다
    }
    return { lanes, note };
  }
  const rows = [];
  for (const u of f.place || []) {
    if (!/underground/.test(u.name) || !u.ug) continue;
    for (const s of ['N', 'E', 'S', 'W']) {
      const fd = get(u.x + V[s][0], u.y + V[s][1]);
      if (!fd || !pointsInto(fd, u.x, u.y) || fd.dir === u.dir || fd.dir === OPP[u.dir]) continue;
      // 들이는 레인의 절대 쪽: 입구 = 방향의 반대쪽 반 · 출구 = 방향 쪽 반
      const passSide = u.ug === 'input' ? OPP[u.dir] : u.dir;
      const pass = relLane(fd.dir, passSide);
      const { lanes, note } = lanesAt(fd);
      const loaded = [...lanes].join('') || '없음';
      const ok = lanes.size === 0 ? '?' : lanes.size === 1 && lanes.has(pass) ? '지나감' : !lanes.has(pass) ? '**멈춤**' : '일부 멈춤';
      rows.push(`  (${u.x},${u.y}) ${u.ug === 'input' ? '입구' : '출구'} ${u.dir} ← 옆 벨트 ${fd.dir} · 들이는 레인 ${pass} · 물건 ${loaded} → ${ok}${note ? ' · ' + note : ''}`);
    }
  }
  return rows;
}

const dir = process.argv[2];
for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'kit.json')) {
  let rows; try { rows = check(path.join(dir, name)); } catch (e) { rows = ['  읽기 실패 ' + e.message]; }
  if (rows.length) console.log(name + '\n' + rows.join('\n'));
}
