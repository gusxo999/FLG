// 양-방법.cjs 의 한 방법이 낸 줄로 판(놓기 파일)을 만든다 — 판으로.cjs 를 부른다.
//   node 양-판.cjs '<품목 JSON>' <방법 1~5> <파일 이름> [제목] [단계 번호 — 기본 마지막]
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const { method } = require('./양-방법.cjs');
const [D, w, out, title, stepArg] = [JSON.parse(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5], process.argv[6]];
process.env.FREE = process.env.FREE ?? '0';   // 판은 규칙 방향(위 끝 줄 ↓ · 아래 끝 줄 ↑ · 가운데는 작은 몫 쪽)으로 — 읽기 쉽게
const r = method(D, w);
const step = stepArg !== undefined ? r.steps[Number(stepArg)] : r.steps[r.steps.length - 1];
if (!step || !step.set) { console.log('줄이 없다'); process.exit(1); }
const lines = step.set.lines, N = D[Object.keys(D)[0]].length;
const items = Object.keys(D).map((n) => {
  const ls = lines.filter((L) => L.item === n), splits = [], betweens = [];
  for (let k = 1; k < ls.length; k++) { if (ls[k].a === ls[k - 1].b) splits.push(ls[k].a); else betweens.push(ls[k - 1].b); }
  return [n, 'single', splits, betweens];
});
const small = {}, info = {};
for (const L of lines) { const k = `${L.item}${L.a}-${L.b}`; if (L.small.length) small[k] = L.small; info[k] = { amount: Math.round(L.amount * 10) / 10, halfLane: L.halfLane }; }
const outText = execFileSync('node', [path.join(__dirname, '판으로.cjs'), String(N), JSON.stringify(items), JSON.stringify(small), '1', out, title || out],
  { env: { ...process.env, BUILDER: '3', LOOK3: '99', FREE: process.env.FREE ?? '0', LINEINFO: JSON.stringify(info) }, encoding: 'utf8' });
console.log(outText.split('\n')[0]);
// GUIDE=1 이면 같은 줄로 손으로 따라가기 풀이도 낸다
if (process.env.GUIDE === '1') console.log(execFileSync('node', [path.join(__dirname, '손으로-따라가기.cjs'), String(N), JSON.stringify(items), JSON.stringify(small)], { env: { ...process.env, FREE: process.env.FREE ?? '0', LINEINFO: JSON.stringify(info) }, encoding: 'utf8' }));
