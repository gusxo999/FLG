/**
 * flowView — 가동률 분석을 **텍스트로** 읽는다(`flg.flow`).
 *
 * 캔버스의 빨간 테두리를 AI 가 볼 방법이 없으므로, 같은 결과(`flowStore.currentFlow`)를 표로 낸다.
 * 화면과 콘솔이 **같은 함수**를 부르므로 둘이 다른 답을 낼 수 없다.
 */

import { machineVerdictAt } from '../analysis/flow/build';
import type { BeltCellFlow, FlowResult, MachineVerdict } from '../analysis/flow/types';

const pct = (u: number) => (Number.isNaN(u) ? '  ?' : `${Math.round(u * 100)}%`.padStart(4));
const rate = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '∞');

const UNKNOWN_LABEL: Record<string, string> = {
  'no-recipe': '레시피 없음',
  kind: '레시피 모델 밖(연구실·채굴기)',
  yield: '수율 미상',
  scale: '저울 없는 팔·벨트',
  fluid: '유체(아직 안 푼다)',
};

/** 한 줄 요약 — `flg.report()` 가 쓴다. */
export function flowSummaryLine(r: FlowResult): string {
  const s = r.summary;
  if (s.total === 0) return '머신 없음';
  return `${s.total}대 · 100% ${s.full} · **미달 ${s.short}** · 판정불가 ${s.unknown}`
    + (r.converged ? '' : `  ← **근사**(고정점 ${r.iterations}회 안에 못 닿음)`);
}

/** 머신 하나의 까닭 한 줄. */
export function limitText(v: MachineVerdict): string {
  if (v.state === 'unknown') return `판정 불가 — ${v.unknown.map((u) => UNKNOWN_LABEL[u] ?? u).join(' · ')}`;
  if (!v.limit) return v.unknown.length ? `(가정: ${v.unknown.map((u) => UNKNOWN_LABEL[u] ?? u).join(' · ')})` : '';
  const { side, item, by } = v.limit;
  const why = side === 'input'
    ? (by === 'arms' ? '넣는 팔이 모자란다' : '벨트가 덜 준다')
    : (by === 'arms' ? '꺼내는 팔이 모자란다' : '벨트가 안 받아 간다(정체)');
  const row = side === 'input'
    ? v.inputs.find((i) => i.item === item)
    : v.outputs.find((o) => o.item === item);
  const nums = row
    ? ('got' in row ? `${rate(row.got)}/${rate(row.need)}` : `${rate(row.sent)}/${rate(row.made)}`)
    : '';
  return `${side === 'input' ? '입력' : '출력'} ${item} ${nums} — ${why}`;
}

export function renderMachines(r: FlowResult): string {
  const out = [`가동률 — ${flowSummaryLine(r)}`];
  for (const v of r.machines) {
    const mark = v.state === 'short' ? '✗' : v.state === 'unknown' ? '?' : ' ';
    out.push(
      `${mark} (${v.x},${v.y})`.padEnd(11)
      + `${(v.recipe ?? v.entityName ?? '?').padEnd(22)} ${pct(v.u)}  ${limitText(v)}`
      + (v.assumed ? '  [추정 포함]' : ''),
    );
  }
  return out.join('\n');
}

function renderBelt(c: BeltCellFlow): string {
  const lane = (name: string, l: BeltCellFlow['lanes']['left']) =>
    `  ${name} ${rate(l.rate)}/${rate(l.capacity)}${l.saturated ? ' 포화' : ''}`
    + (l.items.length ? `  ${l.items.map((i) => `${i.item} ${rate(i.rate)}`).join(', ')}` : '');
  const out = [`벨트 (${c.x},${c.y})`, lane('왼 레인  ', c.lanes.left), lane('오른 레인', c.lanes.right)];
  for (const t of c.taps) {
    out.push(
      `  ${t.kind === 'drop' ? '넣기' : '집기'} 팔 (${t.x},${t.y}) ${t.inserterName}`
      + `${t.peerName ? ` ↔ ${t.peerName}` : ''} ${rate(t.rate)}/s`
      + (t.side ? ` → ${t.side === 'left' ? '왼' : '오른'} 레인` : '')
      + (t.refused > 1e-9 ? `  (정체로 거절 ${rate(t.refused)})` : '')
      + (t.items.length ? ` [${t.items.join(', ')}]` : ''),
    );
  }
  if (c.mixedLane) out.push('  ⚠ 한 레인에 두 품목 — 정상상태가 못 보는 막힘 위험');
  return out.join('\n');
}

function renderMachine(v: MachineVerdict): string {
  const out = [
    `머신 (${v.x},${v.y}) ${v.entityName ?? '?'} · ${v.recipe ?? '레시피 없음'} · ${pct(v.u).trim()}`
      + (Number.isFinite(v.craftsPerSec) ? ` · 정격 ${rate(v.craftsPerSec)}회/s` : ''),
  ];
  const why = limitText(v);
  if (why) out.push(`  ${why}`);
  for (const i of v.inputs) out.push(`  입력 ${i.item.padEnd(20)} 받을 수 있음 ${rate(i.got)} / 필요 ${rate(i.need)}`);
  for (const o of v.outputs) out.push(`  출력 ${o.item.padEnd(20)} 내보낼 수 있음 ${rate(o.sent)} / 생산 ${rate(o.made)}`);
  if (v.assumed) out.push('  [추정 포함] 레시피를 모르는 머신과 벨트·직결을 나눠 쓴다');
  return out.join('\n');
}

/** 칸 하나 — 벨트면 레인별 흐름, 머신이면 판정. */
export function renderAt(r: FlowResult, x: number, y: number): string {
  const belt = r.belts.get(`${x},${y}`);
  if (belt) return renderBelt(belt);
  const v = machineVerdictAt(r, x, y);
  if (v) return renderMachine(v);
  return `(${x},${y}) 는 벨트도 머신도 아니다`;
}
