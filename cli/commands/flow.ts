/**
 * `flow <이름> [machines | at <x> <y> | breaks]` — 가동률. 앱 캔버스의 테두리와 **같은 함수**(`analyzeLayout`)를 부르고,
 * 콘솔(`flg.flow.*`)과 같은 글(`debug/flowView`)로 낸다. 프로토타입과 인서터 운반량은 배치에 실린 것을 쓴다.
 */

import { analyzeLayout } from '../../src/analysis/flow/build';
import { renderAt, renderBreaks, renderMachines } from '../../src/debug/flowView';
import { gridFromPayload, prototypesOf } from '../../src/layoutLink/codec';
import { EXIT, head, parseArgs, PROGRAM, readLayout, Refusal } from '../io';

export function flow(args: string[]): number {
  const { positional } = parseArgs(args);
  const [name, view = 'machines', xs, ys] = positional;
  if (!name) throw new Refusal(`쓰는 법: ${PROGRAM} flow <이름> [machines | at <x> <y> | breaks]`);
  const { payload } = readLayout(name);
  const r = analyzeLayout(gridFromPayload(payload), {
    ...prototypesOf(payload),
    inserterOverrides: payload.inserterOverrides,
    interiorBbox: payload.interiorBbox ?? null,
  });
  const s = r.summary;
  const verdict = `${s.total}대 · 100% ${s.full} · 미달 ${s.short} · 판정불가 ${s.unknown}${s.failed ? ` · 포트 실패 ${s.failed}` : ''}`;

  if (view === 'machines') {
    console.log(head('flow', name, verdict));
    console.log(renderMachines(r));
  } else if (view === 'breaks') {
    console.log(head('flow', `${name}, breaks`, verdict));
    console.log(renderBreaks(r));
  } else if (view === 'at') {
    const x = Number(xs);
    const y = Number(ys);
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Refusal(`쓰는 법: ${PROGRAM} flow ${name} at <x> <y>`);
    console.log(head('flow', `${name}, at ${x} ${y}`, verdict));
    console.log(renderAt(r, x, y));
  } else {
    throw new Refusal(`'${view}' 를 모른다 — machines · at <x> <y> · breaks`);
  }
  return s.short > 0 || s.failed > 0 ? EXIT.bad : EXIT.ok;
}
