/**
 * faceTable — 모듈 한 면의 **단면표**를 문자열로 낸다.
 *
 * ## 왜 이게 필요한가 (2026-08-17 실측)
 *
 * 그날 결함 두 개를 잡아낸 것은 스크린샷도 100KB JSON 도 아니고 **표 한 장**이었다 —
 * 한 면의 칸을 깊이 × 행으로 늘어놓으니 벨트 줄의 구멍이 바로 보였다. 문제는 그 표를
 * AI 가 콘솔 덤프를 파이썬으로 파싱해 만들었다는 것이다. 결정적인 산출물이라면
 * **앱이 낸다.**
 *
 * ## 좌표와 깊이를 함께 찍는다
 *
 * `d1` 은 머신 면 바로 바깥 칸이다. 진단은 깊이로 말하고(`d2 에 구멍`), 고칠 때는
 * 절대 좌표가 필요하다(`(10,6)`). 둘 중 하나만 있으면 그 환산을 손으로 하게 된다 —
 * 그날 실제로 했다.
 */

import { EntityType } from '../types/layout';
import {
  abbrev,
  cellKey,
  findModule,
  machineBoxOf,
  type Face,
  type LayoutView,
} from './layoutView';

const W = 6; // 칸 폭(약칭 5글자 + 공백 1)
const pad = (s: string): string => s.padStart(W);

export interface FaceOptions {
  /** 머신 면에서 몇 칸까지 볼까. 기본 5. */
  depth?: number;
  /** 머신 행/열 범위 바깥으로 몇 칸 더 볼까(어깨 칸 확인용). 기본 1. */
  margin?: number;
}

/**
 * 한 면의 단면표. 모듈을 못 찾으면 후보 목록을 대신 낸다 —
 * 키를 정확히 모르는 것이 이 명령의 가장 흔한 실패다.
 */
export function renderFace(
  view: LayoutView,
  moduleQuery: string,
  face: Face,
  opts: FaceOptions = {},
): string {
  const mod = findModule(view, moduleQuery);
  if (!mod) {
    const keys = view.modules.map((m) => `  ${m.key}${m.recipe ? ` [${m.recipe}]` : ''}`);
    return `모듈 '${moduleQuery}' 없음. 있는 모듈:\n${keys.join('\n') || '  (없음)'}`;
  }
  const box = machineBoxOf(view, mod.key);
  if (!box) return `모듈 '${mod.key}' 에 머신이 없다 — 단면을 잴 기준이 없다.`;

  const depth = Math.max(1, opts.depth ?? 5);
  const margin = Math.max(0, opts.margin ?? 1);
  const horizontal = face === 'W' || face === 'E';

  const at = (x: number, y: number): string => {
    const c = view.cells.get(cellKey(x, y));
    return c ? abbrev(c.type) : '.';
  };

  // 깊이 d(1..depth) → 그 면에서의 절대 좌표(면에 수직인 축).
  const coordAtDepth = (d: number): number => {
    switch (face) {
      case 'W': return box.x - d;
      case 'E': return box.x + box.w - 1 + d;
      case 'N': return box.y - d;
      case 'S': return box.y + box.h - 1 + d;
    }
  };
  // 면에 **평행한** 축의 범위(행 또는 열).
  const alongFrom = (horizontal ? box.y : box.x) - margin;
  const alongTo = (horizontal ? box.y + box.h : box.x + box.w) - 1 + margin;

  const head = [
    `모듈 ${mod.key}${mod.recipe ? ` · ${mod.recipe}` : ''} · 머신 ${mod.machineCount}대`
      + `${mod.machineEntityName ? ` (${mod.machineEntityName})` : ''}`,
    `머신 블록 (${box.x},${box.y}) ${box.w}×${box.h} · 면 ${face}`
      + ` · d1 = ${horizontal ? 'x' : 'y'}${coordAtDepth(1)} (머신에서 멀어질수록 d↑)`,
  ];

  const lines: string[] = [];
  // 깊이는 **먼 쪽부터** 찍어 머신이 표의 오른쪽/아래에 오게 한다 — 화면에서 보는
  // 방향과 같아야 읽는 사람이 좌우를 뒤집지 않는다(W 면은 머신이 오른쪽에 있다).
  const depths = [...Array(depth).keys()].map((i) => depth - i);

  if (horizontal) {
    const dsForRow = face === 'W' ? depths : depths.slice().reverse();
    lines.push(`${pad('x')}|${dsForRow.map((d) => pad(String(coordAtDepth(d)))).join('')} |${pad(String(face === 'W' ? box.x : box.x + box.w - 1))}`);
    lines.push(`${pad('y \\ d')}|${dsForRow.map((d) => pad(`d${d}`)).join('')} |${pad('머신')}`);
    lines.push(`${'-'.repeat(W)}+${'-'.repeat(W * depth)}-+${'-'.repeat(W)}`);
    for (let y = alongFrom; y <= alongTo; y++) {
      const inMachine = y >= box.y && y < box.y + box.h;
      const cells = dsForRow.map((d) => pad(at(coordAtDepth(d), y)));
      const machineCol = inMachine ? pad(at(face === 'W' ? box.x : box.x + box.w - 1, y)) : pad('');
      lines.push(`${pad(String(y))}|${cells.join('')} |${machineCol}`);
    }
  } else {
    const dsForCol = face === 'N' ? depths : depths.slice().reverse();
    lines.push(`${pad('d \\ x')}|${range(alongFrom, alongTo).map((x) => pad(String(x))).join('')}`);
    lines.push(`${'-'.repeat(W)}+${'-'.repeat(W * (alongTo - alongFrom + 1))}`);
    for (const d of dsForCol) {
      const y = coordAtDepth(d);
      lines.push(`${pad(`d${d} y${y}`)}|${range(alongFrom, alongTo).map((x) => pad(at(x, y))).join('')}`);
    }
    const my = face === 'N' ? box.y : box.y + box.h - 1;
    lines.push(`${'-'.repeat(W)}+${'-'.repeat(W * (alongTo - alongFrom + 1))}`);
    lines.push(`${pad(`머신 y${my}`)}|${range(alongFrom, alongTo).map((x) => pad(at(x, my))).join('')}`);
  }

  // 이 면에 붙은 포트 — planner 가 배정한 면(meta.side)이 기준이다. meta 가 없는 포트는
  // 좌표로 판정한다(옛 경로/외부 상자 직결).
  const portLines = mod.ports
    .filter((p) => (p.meta ? p.meta.side === face : sideOfCell(box, p.x, p.y) === face))
    .map((p) => {
      const d = depthOf(box, face, p.x, p.y);
      const meta = p.meta
        ? ` [${p.meta.item} d${p.meta.laneDepth}${p.meta.inserter ? ` ${p.meta.inserter}` : ''}]`
        : '';
      return `  (${p.x},${p.y}) ${d !== null ? `d${d}` : '?'} ${p.role === 'input' ? '←' : '→'} ${p.peerId}${meta}`;
    });

  return [
    ...head,
    '',
    ...lines,
    '',
    `포트 ${face} (${portLines.length}개)`,
    ...(portLines.length ? portLines : ['  (없음)']),
    '',
    '약칭: Assem=조립기 Furn=용광로 Inser/LongI=인서터 Belt/UgBlt=벨트 Pipe/UgPip=파이프',
    '      CHEST/PIPE=무한상자·무한파이프(대문자=외부) chest=일반상자 .=빈 칸',
  ].join('\n');
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/** 셀이 머신 블록의 어느 면 바깥에 있나. 안쪽이면 null. */
function sideOfCell(
  box: { x: number; y: number; w: number; h: number },
  x: number,
  y: number,
): Face | null {
  if (x < box.x) return 'W';
  if (x >= box.x + box.w) return 'E';
  if (y < box.y) return 'N';
  if (y >= box.y + box.h) return 'S';
  return null;
}

/** 그 면에서의 깊이(d1 = 면 바로 바깥). 면 안쪽이면 null. */
function depthOf(
  box: { x: number; y: number; w: number; h: number },
  face: Face,
  x: number,
  y: number,
): number | null {
  const d =
    face === 'W' ? box.x - x
    : face === 'E' ? x - (box.x + box.w - 1)
    : face === 'N' ? box.y - y
    : y - (box.y + box.h - 1);
  return d >= 1 ? d : null;
}

/** 모듈 목록 한 줄씩 — `flg.face()` 를 인자 없이 부르면 이게 나온다. */
export function listModules(view: LayoutView): string {
  if (view.modules.length === 0) return '모듈 없음.';
  return view.modules
    .map((m) => {
      const box = machineBoxOf(view, m.key);
      const faces = new Set(
        m.ports.map((p) => p.meta?.side ?? (box ? sideOfCell(box, p.x, p.y) : null)).filter(Boolean),
      );
      return `  ${m.key}${m.recipe ? ` [${m.recipe}]` : ''} · 머신 ${m.machineCount}대`
        + `${box ? ` @ (${box.x},${box.y}) ${box.w}×${box.h}` : ''}`
        + ` · 포트 ${m.ports.length} (${[...faces].join('') || '없음'})`;
    })
    .join('\n');
}

/** 셀 종류 히스토그램 — 스냅샷 비교와 report 가 쓴다. */
export function cellHistogram(view: LayoutView): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of view.cells.values()) {
    const k = String(c.type as EntityType);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
