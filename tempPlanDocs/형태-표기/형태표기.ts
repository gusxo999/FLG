/**
 * 형태 표기 — 글로 그린 배치 모양과 앱 그리드의 칸을 서로 바꾼다. 표기의 정의는 같은 폴더 CLAUDE.md.
 *
 *   parse(글)            → 칸 목록(`layoutStore.applyPlacedCells` 가 받는 모양) · 칸마다 줄 이름 · 표기 오류
 *   check(parse 결과)     → 게임 규칙으로 본 것(지하 짝 · 흘려 넣기 · 인서터 끝) · 줄마다 머신에서 하는 일
 *   render(칸 목록, 이름) → 글
 *   nameLines(칸 목록, 칸의 품목) → 이름이 없는 칸(앱 그리드)에 줄 이름을 붙인다
 *
 * 앱 콘솔(npm run dev):  const F = await import('/tempPlanDocs/형태-표기/형태표기.ts')
 *                        await F.put(글)            그리드를 비우고 놓은 뒤 가동률
 *                        copy(await F.get())         지금 그리드를 표기로
 */
import { EntityType, type Direction, type GridCell } from '../../src/types/layout';

export type Placed = { x: number; y: number; cell: GridCell };
type UgType = '노' | '빨' | '파';

const ARROW: Record<string, Direction> = { '↑': 0, '→': 4, '↓': 8, '←': 12 };
const ARROW_OF: Record<number, string> = { 0: '↑', 4: '→', 8: '↓', 12: '←' };
const VEC: Record<number, [number, number]> = { 0: [0, -1], 4: [1, 0], 8: [0, 1], 12: [-1, 0] };
const opp = (d: Direction) => ((d + 8) % 16) as Direction;
const key = (x: number, y: number) => `${x},${y}`;

export interface Header {
  title: string;
  machine: { name: string; w: number; h: number };
  recipe?: { name: string; inputs: string[]; outputs: string[]; time: number };
  /** 품목 글자 → 품목 이름 */
  items: Map<string, string>;
  belt: string;
  underground: Record<UgType, { name: string; range: number }>;
  inserter: { 1: string; 2: string };
  chest: string;
  origin: { x: number; y: number };
}

export function defaultHeader(): Header {
  return {
    title: '',
    machine: { name: 'assembling-machine-1', w: 3, h: 3 },
    items: new Map(),
    belt: 'transport-belt',
    underground: {
      노: { name: 'underground-belt', range: 5 },
      빨: { name: 'fast-underground-belt', range: 7 },
      파: { name: 'express-underground-belt', range: 9 },
    },
    inserter: { 1: 'inserter', 2: 'long-handed-inserter' },
    chest: 'infinity-chest',
    origin: { x: 0, y: 0 },
  };
}

type Tok =
  | { k: 'empty' }
  | { k: 'machine' }
  | { k: 'belt'; line: string; d: Direction }
  | { k: 'ug'; line: string; d: Direction; io: 'input' | 'output'; type: UgType }
  | { k: 'ins'; reach: 1 | 2; d: Direction } // d = 물건이 가는 쪽
  | { k: 'chest'; item?: string };

/** 칸 하나의 글. 줄 이름은 품목 글자(i 는 인서터라 뺀다) + 숫자. */
export function token(s: string): Tok | null {
  if (s === '.') return { k: 'empty' };
  if (s === '█') return { k: 'machine' };
  let m = /^i(2?)([↑→↓←])$/.exec(s);
  if (m) return { k: 'ins', reach: m[1] ? 2 : 1, d: ARROW[m[2]] };
  m = /^▣([a-hj-z])?$/.exec(s);
  if (m) return { k: 'chest', item: m[1] };
  m = /^([a-hj-z]\d*)([↑→↓←])(입|출)(노|빨|파)?$/.exec(s);
  if (m) return { k: 'ug', line: m[1], d: ARROW[m[2]], io: m[3] === '입' ? 'input' : 'output', type: (m[4] ?? '노') as UgType };
  m = /^([a-hj-z]\d*)([↑→↓←])$/.exec(s);
  if (m) return { k: 'belt', line: m[1], d: ARROW[m[2]] };
  return null;
}

export interface Parsed {
  header: Header;
  placed: Placed[];
  /** "x,y" → 줄 이름(벨트 · 지하벨트 칸) */
  names: Map<string, string>;
  /** 표기가 틀렸다 — 놓을 수 없다 */
  problems: string[];
  /** 글자 그대로의 칸(검사용) */
  toks: Map<string, { x: number; y: number; t: Tok }>;
}

function parseHeaderLine(h: Header, line: string, problems: string[]) {
  const [head, ...rest] = line.trim().split(/\s+/);
  const body = rest.join(' ');
  switch (head) {
    case '형태': h.title = body; break;
    case '머신': {
      const m = /^(\S+)\s+(\d+)x(\d+)$/.exec(body);
      if (!m) { problems.push(`머신 줄을 못 읽는다: ${line}`); break; }
      h.machine = { name: m[1], w: +m[2], h: +m[3] };
      break;
    }
    case '레시피': {
      // 레시피 <이름> 입력 a b c 출력 o 시간 2
      const m = /^(\S+)\s+입력\s+(.+?)\s+출력\s+(.+?)(?:\s+시간\s+([\d.]+))?$/.exec(body);
      if (!m) { problems.push(`레시피 줄을 못 읽는다: ${line}`); break; }
      h.recipe = { name: m[1], inputs: m[2].split(/\s+/), outputs: m[3].split(/\s+/), time: m[4] ? +m[4] : 1 };
      break;
    }
    case '품목':
      for (const p of rest) {
        const m = /^([a-hj-z])=(\S+)$/.exec(p);
        if (m) h.items.set(m[1], m[2]); else problems.push(`품목을 못 읽는다: ${p}`);
      }
      break;
    case '지하':
      for (const p of rest) {
        const m = /^(노|빨|파)=([^:\s]+)(?::(\d+))?$/.exec(p);
        if (m) h.underground[m[1] as UgType] = { name: m[2], range: m[3] ? +m[3] : h.underground[m[1] as UgType].range };
        else problems.push(`지하를 못 읽는다: ${p}`);
      }
      break;
    case '벨트': h.belt = body; break;
    case '인서터': { const [a, b] = rest; if (a) h.inserter[1] = a; if (b) h.inserter[2] = b; break; }
    case '상자': h.chest = body; break;
    case '원점': { const [x, y] = rest.map(Number); h.origin = { x, y }; break; }
    default: problems.push(`모르는 머리 줄: ${line}`);
  }
}

let idSeq = 0;
const nid = (p: string) => `${p}${idSeq++}`;

export function parse(text: string): Parsed {
  const header = defaultHeader();
  const problems: string[] = [];
  const toks = new Map<string, { x: number; y: number; t: Tok }>();
  let inGrid = false;
  let row = -1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!inGrid) {
      if (line.trim() === '칸') { inGrid = true; continue; }
      parseHeaderLine(header, line, problems);
      continue;
    }
    const parts = line.trim().split(/\s+/);
    // 행 이름 — 맨 앞 숫자는 y(원점 기준)다. 없으면 앞 행 + 1
    if (/^-?\d+$/.test(parts[0])) row = Number(parts.shift());
    else row += 1;
    parts.forEach((s, col) => {
      const t = token(s);
      const x = header.origin.x + col, y = header.origin.y + row;
      if (!t) { problems.push(`(${x},${y}) 모르는 칸 "${s}"`); return; }
      if (t.k === 'empty') return;
      if (toks.has(key(x, y))) problems.push(`(${x},${y}) 행이 겹친다`);
      toks.set(key(x, y), { x, y, t });
    });
  }

  const placed: Placed[] = [];
  const names = new Map<string, string>();
  const base = (entityName: string, entityType: EntityType, direction: Direction): GridCell => ({
    entityId: nid('f'), entityName, entityType, direction, tileOffset: { x: 0, y: 0 }, isOrigin: true,
  });

  // 머신 — █ 를 위 왼쪽부터 머신 크기만큼 묶는다
  const taken = new Set<string>();
  const machineTiles = [...toks.values()].filter((v) => v.t.k === 'machine').sort((a, b) => a.y - b.y || a.x - b.x);
  const { w: MW, h: MH, name: MN } = header.machine;
  for (const v of machineTiles) {
    if (taken.has(key(v.x, v.y))) continue;
    const block: [number, number][] = [];
    for (let dy = 0; dy < MH; dy++) for (let dx = 0; dx < MW; dx++) block.push([v.x + dx, v.y + dy]);
    if (!block.every(([x, y]) => toks.get(key(x, y))?.t.k === 'machine' && !taken.has(key(x, y)))) {
      problems.push(`(${v.x},${v.y}) █ 가 ${MW}x${MH} 로 안 묶인다`);
      continue;
    }
    const id = nid('m');
    for (const [x, y] of block) {
      taken.add(key(x, y));
      placed.push({ x, y, cell: {
        entityId: id, entityName: MN, entityType: EntityType.Assembler, direction: 0,
        tileOffset: { x: x - v.x, y: y - v.y }, isOrigin: x === v.x && y === v.y,
        recipe: x === v.x && y === v.y ? header.recipe?.name : undefined,
      } });
    }
  }

  for (const { x, y, t } of toks.values()) {
    switch (t.k) {
      case 'belt':
        placed.push({ x, y, cell: base(header.belt, EntityType.Belt, t.d) });
        names.set(key(x, y), t.line);
        break;
      case 'ug':
        placed.push({ x, y, cell: { ...base(header.underground[t.type].name, EntityType.UndergroundBelt, t.d), undergroundType: t.io } });
        names.set(key(x, y), t.line);
        break;
      case 'ins':
        // 앱의 인서터 방향은 집는 쪽이다 — 물건이 가는 쪽의 반대
        placed.push({ x, y, cell: base(header.inserter[t.reach], t.reach === 2 ? EntityType.LongInserter : EntityType.Inserter, opp(t.d)) });
        break;
      case 'chest': {
        const item = t.item ? header.items.get(t.item) : undefined;
        if (t.item && !item) problems.push(`(${x},${y}) ▣${t.item} — 품목 줄에 ${t.item} 가 없다`);
        placed.push({ x, y, cell: { ...base(header.chest, EntityType.InfinityChest, 0),
          infinitySettings: item
            ? { remove_unfiltered_items: false, filters: [{ index: 1, name: item, count: 50, mode: 'at-least' }] }
            : { remove_unfiltered_items: true, filters: [] } } as GridCell });
        break;
      }
    }
  }
  return { header, placed, names, problems, toks };
}

// ─────────────────────────────────────────────────────────────────────────────
// 검사 — 게임 규칙만으로 본다(앱의 가동률 검사와 별개)
// ─────────────────────────────────────────────────────────────────────────────

export interface Checked {
  /** 게임 규칙에 어긋난다 */
  faults: string[];
  /** 어긋나지 않지만 알아 둘 것(짝 없는 입구 · 마주 보는 끝) */
  notes: string[];
  /** 줄 이름 → 머신마다 하는 일. 머신 번호는 머신 위 왼쪽 칸의 (y, x) 순 */
  roles: Map<string, { io: '입력' | '출력' | '?'; machines: { m: number; role: string }[] }>;
}

export function check(P: Parsed): Checked {
  const faults: string[] = [];
  const notes: string[] = [];
  const at = (x: number, y: number) => P.toks.get(key(x, y))?.t;
  const isBeltish = (t: Tok | undefined): t is Extract<Tok, { k: 'belt' | 'ug' }> => !!t && (t.k === 'belt' || t.k === 'ug');

  // 머신 번호
  const machineAt = new Map<string, number>();
  const origins = P.placed.filter((p) => p.cell.entityType === EntityType.Assembler && p.cell.isOrigin).sort((a, b) => a.y - b.y || a.x - b.x);
  origins.forEach((o, i) => {
    for (const p of P.placed) if (p.cell.entityId === o.cell.entityId) machineAt.set(key(p.x, p.y), i);
  });

  // 지하 짝
  const pairOf = new Map<string, string>();
  for (const { x, y, t } of P.toks.values()) {
    if (t.k !== 'ug' || t.io !== 'input') continue;
    const [vx, vy] = VEC[t.d];
    const range = P.header.underground[t.type].range;
    let found = false;
    for (let k = 1; k <= range; k++) {
      const u = at(x + vx * k, y + vy * k);
      if (!u || u.k !== 'ug' || u.type !== t.type || u.d !== t.d) continue;
      if (u.io === 'input') { notes.push(`(${x},${y}) ${t.line} 입구 — 앞에 같은 종류 · 방향의 입구가 먼저 있어 짝이 없다. 줄이 여기서 멈춘다`); found = true; break; }
      pairOf.set(key(x, y), key(x + vx * k, y + vy * k));
      if (u.line !== t.line) faults.push(`(${x},${y}) → (${x + vx * k},${y + vy * k}) 땅속에서 줄 이름이 ${t.line} → ${u.line} 로 바뀐다`);
      found = true;
      break;
    }
    if (!found) notes.push(`(${x},${y}) ${t.line} 입구 — 사거리(${range}) 안에 짝이 없다. 줄이 여기서 멈춘다`);
  }
  const paired = new Set(pairOf.values());
  for (const { x, y, t } of P.toks.values()) {
    if (t.k === 'ug' && t.io === 'output' && !paired.has(key(x, y))) faults.push(`(${x},${y}) ${t.line} 출구 — 뒤에 짝인 입구가 없다`);
  }

  // 흘려 넣기 — 칸은 화살표가 가리키는 칸으로 흘려 넣는다(입구는 땅 위로 안 내보낸다)
  for (const { x, y, t } of P.toks.values()) {
    if (!(t.k === 'belt' || (t.k === 'ug' && t.io === 'output'))) continue;
    const [vx, vy] = VEC[t.d];
    const n = at(x + vx, y + vy);
    if (!isBeltish(n) || n.line === t.line) continue;
    const where = `(${x},${y}) ${t.line}${ARROW_OF[t.d]} → (${x + vx},${y + vy}) ${n.line}${ARROW_OF[n.d]}`;
    if (n.d === opp(t.d)) { notes.push(`${where} — 마주 봐서 안 건넨다`); continue; }
    if (n.d === t.d) {
      if (n.k === 'ug' && n.io === 'output') notes.push(`${where} — 출구의 뒤는 덮개라 안 건넨다(형태-전수 §0.4 ㄴ)`);
      else faults.push(`${where} — 뒤로 흘려 넣어 섞인다`);
      continue;
    }
    faults.push(`${where} — 옆으로 실린다`);
  }

  // 인서터 — 집는 칸 · 놓는 칸
  type Tap = { line: string; m: number; io: '입력' | '출력' };
  const taps: Tap[] = [];
  for (const { x, y, t } of P.toks.values()) {
    if (t.k !== 'ins') continue;
    const [vx, vy] = VEC[t.d];
    const pick = [x - vx * t.reach, y - vy * t.reach] as const;
    const drop = [x + vx * t.reach, y + vy * t.reach] as const;
    const pt = at(...pick), dt = at(...drop);
    if (!pt) faults.push(`(${x},${y}) 인서터 — 집는 칸 (${pick}) 이 비었다`);
    if (!dt) faults.push(`(${x},${y}) 인서터 — 놓는 칸 (${drop}) 이 비었다`);
    if (isBeltish(pt) && dt?.k === 'machine') taps.push({ line: pt.line, m: machineAt.get(key(...drop))!, io: '입력' });
    if (pt?.k === 'machine' && isBeltish(dt)) taps.push({ line: dt.line, m: machineAt.get(key(...pick))!, io: '출력' });
  }

  // 줄마다 흐름 순서 — 벨트는 화살표 쪽 이웃(같은 줄), 입구는 짝인 출구로
  const order = new Map<string, number>();
  const byLine = new Map<string, string[]>();
  for (const [k, n] of P.names) { if (!byLine.has(n)) byLine.set(n, []); byLine.get(n)!.push(k); }
  const nextOf = (k: string): string | null => {
    const v = P.toks.get(k)!; const t = v.t as Extract<Tok, { k: 'belt' | 'ug' }>;
    if (t.k === 'ug' && t.io === 'input') return pairOf.get(k) ?? null;
    const [vx, vy] = VEC[t.d]; const nk = key(v.x + vx, v.y + vy);
    return P.names.get(nk) === t.line ? nk : null;
  };
  for (const [line, ks] of byLine) {
    const hasPrev = new Set(ks.map(nextOf).filter((k): k is string => !!k));
    const heads = ks.filter((k) => !hasPrev.has(k));
    if (heads.length !== 1) notes.push(`${line} — 줄의 처음이 ${heads.length} 곳이다(갈라지거나 이어지지 않았다)`);
    for (const h of heads) {
      let k: string | null = h, i = 0;
      while (k && !order.has(k)) { order.set(k, i++); k = nextOf(k); }
    }
  }
  const roles: Checked['roles'] = new Map();
  for (const [line, ks] of byLine) {
    const ms = new Map<number, number>();
    const ios = new Set<string>();
    for (const tp of taps.filter((tp) => tp.line === line)) ios.add(tp.io);
    // 머신 m 이 이 줄에서 처음 닿는 순서
    for (const { x, y, t } of P.toks.values()) {
      if (t.k !== 'ins') continue;
      const [vx, vy] = VEC[t.d];
      const pick = key(x - vx * t.reach, y - vy * t.reach), drop = key(x + vx * t.reach, y + vy * t.reach);
      const beltKey = P.names.get(pick) === line ? pick : P.names.get(drop) === line ? drop : null;
      const mKey = beltKey === pick ? drop : pick;
      if (!beltKey || !machineAt.has(mKey)) continue;
      const m = machineAt.get(mKey)!, o = order.get(beltKey) ?? 0;
      ms.set(m, Math.min(ms.get(m) ?? Infinity, o));
    }
    const sorted = [...ms.entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
    const role = (i: number) => sorted.length === 1 ? '한 대' : i === 0 ? '시작' : i === sorted.length - 1 ? '끝' : '지나감';
    roles.set(line, { io: ios.size === 1 ? (ios.has('입력') ? '입력' : '출력') : '?', machines: sorted.map((m, i) => ({ m, role: role(i) })) });
    void ks;
  }
  return { faults, notes, roles };
}

// ─────────────────────────────────────────────────────────────────────────────
// 글로 — 칸 목록과 줄 이름에서
// ─────────────────────────────────────────────────────────────────────────────

export function tokenOf(cell: GridCell, name: string | undefined, header: Header): string {
  switch (cell.entityType) {
    case EntityType.Assembler: case EntityType.Furnace: return '█';
    case EntityType.Belt: return `${name ?? '?'}${ARROW_OF[cell.direction]}`;
    case EntityType.UndergroundBelt: {
      const type = (Object.keys(header.underground) as UgType[]).find((t) => header.underground[t].name === cell.entityName) ?? '노';
      return `${name ?? '?'}${ARROW_OF[cell.direction]}${cell.undergroundType === 'input' ? '입' : '출'}${type === '노' ? '' : type}`;
    }
    case EntityType.Inserter: return `i${ARROW_OF[opp(cell.direction)]}`;
    case EntityType.LongInserter: return `i2${ARROW_OF[opp(cell.direction)]}`;
    case EntityType.InfinityChest: {
      const s = cell.infinitySettings as { filters?: { name?: string }[]; remove_unfiltered_items?: boolean } | undefined;
      const item = s?.filters?.[0]?.name;
      const letter = item ? [...header.items].find(([, v]) => v === item)?.[0] : undefined;
      return s?.remove_unfiltered_items || !item ? '▣' : `▣${letter ?? '?'}`;
    }
    case EntityType.Empty: return '.';
    default: return '?';
  }
}

export function headerText(h: Header): string[] {
  const out: string[] = [];
  if (h.title) out.push(`형태 ${h.title}`);
  out.push(`머신 ${h.machine.name} ${h.machine.w}x${h.machine.h}`);
  if (h.recipe) out.push(`레시피 ${h.recipe.name} 입력 ${h.recipe.inputs.join(' ')} 출력 ${h.recipe.outputs.join(' ')} 시간 ${h.recipe.time}`);
  if (h.items.size) out.push(`품목 ${[...h.items].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  out.push(`원점 ${h.origin.x} ${h.origin.y}`);
  return out;
}

/** 칸 목록 → 글. 원점은 칸 목록의 위 왼쪽이다. */
export function render(placed: Placed[], names: Map<string, string>, header: Header): string {
  const xs = placed.map((p) => p.x), ys = placed.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const grid = new Map(placed.map((p) => [key(p.x, p.y), p.cell]));
  const rows: string[][] = [];
  for (let y = y0; y <= y1; y++) {
    const r: string[] = [];
    for (let x = x0; x <= x1; x++) {
      const c = grid.get(key(x, y));
      r.push(c ? tokenOf(c, names.get(key(x, y)), header) : '.');
    }
    rows.push(r);
  }
  // 한글은 화면에서 두 칸이다 — 열을 맞추려고 그렇게 센다
  const width = (s: string) => [...s].reduce((n, ch) => n + (/[가-힣]/.test(ch) ? 2 : 1), 0);
  const colW = Math.max(...rows.flat().map(width)) + 1;
  const pad = (s: string) => s + ' '.repeat(Math.max(1, colW - width(s)));
  const labW = String(y1 - y0).length + 1;
  const h = { ...header, origin: { x: x0, y: y0 } };
  return [...headerText(h), '칸',
    ...rows.map((r, i) => String(i).padStart(labW) + '  ' + r.map(pad).join('').trimEnd())].join('\n');
}

/**
 * 이름 없는 칸(앱 그리드)에 줄 이름을 붙인다. 이어진 벨트 칸을 한 줄로 묶고,
 * 그 줄이 싣는 품목의 글자를 이름으로 쓴다 — 한 머신만 먹이면 글자 + 머신 번호(b1), 같은 글자의 줄이 여럿이면 글자 + 차례.
 */
export function nameLines(placed: Placed[], header: Header, itemsAt: (x: number, y: number) => string[]): Map<string, string> {
  const cells = new Map(placed.map((p) => [key(p.x, p.y), p]));
  const beltish = (p?: Placed) => !!p && (p.cell.entityType === EntityType.Belt || p.cell.entityType === EntityType.UndergroundBelt);
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => { adj.get(a)!.push(b); adj.get(b)!.push(a); };
  for (const p of placed) if (beltish(p)) adj.set(key(p.x, p.y), []);
  for (const p of placed) {
    if (!beltish(p)) continue;
    const [vx, vy] = VEC[p.cell.direction];
    if (p.cell.entityType === EntityType.UndergroundBelt && p.cell.undergroundType === 'input') {
      const range = Object.values(header.underground).find((u) => u.name === p.cell.entityName)?.range ?? 9;
      for (let k = 1; k <= range; k++) {
        const q = cells.get(key(p.x + vx * k, p.y + vy * k));
        if (!q || q.cell.entityType !== EntityType.UndergroundBelt || q.cell.entityName !== p.cell.entityName || q.cell.direction !== p.cell.direction) continue;
        if (q.cell.undergroundType === 'output') link(key(p.x, p.y), key(q.x, q.y));
        break;
      }
      continue;
    }
    const q = cells.get(key(p.x + vx, p.y + vy));
    if (beltish(q) && q!.cell.direction !== opp(p.cell.direction)
      && !(q!.cell.entityType === EntityType.UndergroundBelt && q!.cell.undergroundType === 'output' && q!.cell.direction === p.cell.direction)) {
      link(key(p.x, p.y), key(q!.x, q!.y));
    }
  }
  // 머신 번호와 인서터가 잇는 머신
  const origins = placed.filter((p) => (p.cell.entityType === EntityType.Assembler || p.cell.entityType === EntityType.Furnace) && p.cell.isOrigin)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const machineOf = new Map<string, number>();
  origins.forEach((o, i) => { for (const p of placed) if (p.cell.entityId === o.cell.entityId) machineOf.set(key(p.x, p.y), i); });
  const comps: string[][] = [];
  const seen = new Set<string>();
  for (const k of adj.keys()) {
    if (seen.has(k)) continue;
    const comp: string[] = []; const st = [k]; seen.add(k);
    while (st.length) { const c = st.pop()!; comp.push(c); for (const n of adj.get(c)!) if (!seen.has(n)) { seen.add(n); st.push(n); } }
    comps.push(comp);
  }
  const letterOf = (item: string) => [...header.items].find(([, v]) => v === item)?.[0];
  const info = comps.map((comp) => {
    const items = new Set(comp.flatMap((k) => { const [x, y] = k.split(',').map(Number); return itemsAt(x, y); }));
    const set = new Set(comp);
    const ms = new Set<number>();
    for (const p of placed) {
      if (p.cell.entityType !== EntityType.Inserter && p.cell.entityType !== EntityType.LongInserter) continue;
      const reach = p.cell.entityType === EntityType.LongInserter ? 2 : 1;
      const [vx, vy] = VEC[p.cell.direction]; // 집는 쪽
      const pick = key(p.x + vx * reach, p.y + vy * reach), drop = key(p.x - vx * reach, p.y - vy * reach);
      if (set.has(pick) && machineOf.has(drop)) ms.add(machineOf.get(drop)!);
      if (set.has(drop) && machineOf.has(pick)) ms.add(machineOf.get(pick)!);
    }
    const letter = items.size === 1 ? letterOf([...items][0]) : undefined;
    return { comp, letter: letter ?? 'x', ms: [...ms].sort((a, b) => a - b) };
  });
  const names = new Map<string, string>();
  const count = new Map<string, number>();
  for (const c of info) count.set(c.letter, (count.get(c.letter) ?? 0) + 1);
  const seq = new Map<string, number>();
  for (const c of info.sort((a, b) => (a.ms[0] ?? 0) - (b.ms[0] ?? 0))) {
    let name = c.letter;
    if (count.get(c.letter)! > 1) {
      if (c.ms.length === 1) name = `${c.letter}${c.ms[0]}`;
      else { const n = (seq.get(c.letter) ?? 0) + 1; seq.set(c.letter, n); name = `${c.letter}${n}`; }
    }
    for (const k of c.comp) names.set(k, name);
  }
  return names;
}

// ─────────────────────────────────────────────────────────────────────────────
// 앱 콘솔 — 브라우저에서만 쓴다(스토어를 그때 불러온다)
// ─────────────────────────────────────────────────────────────────────────────

/** 글을 앱 그리드에 놓는다. 레시피 줄이 있으면 커스텀 레시피로 넣는다. at = 원점을 옮길 자리. */
export async function put(text: string, at?: { x: number; y: number }) {
  const P = parse(text);
  const C = check(P);
  for (const s of [...P.problems, ...C.faults]) console.warn('[형태]', s);
  if (P.problems.length) return { P, C };
  const w = window as unknown as { flg: any };
  const h = P.header;
  if (h.recipe) {
    const name = (l: string) => h.items.get(l) ?? l;
    w.flg.custom.add({
      machines: [{ name: h.machine.name, size: h.machine.w, craftingSpeed: 1, craftingCategories: ['custom-form'], moduleSlots: 0, fluidBoxes: [] }],
      recipes: [{ name: h.recipe.name, category: 'custom-form', energyRequired: h.recipe.time,
        ingredients: h.recipe.inputs.map((l) => ({ name: name(l), amount: 1, type: 'item' })),
        products: h.recipe.outputs.map((l) => ({ name: name(l), amount: 1, type: 'item' })) }],
    });
  }
  const dx = (at?.x ?? 2) - Math.min(...P.placed.map((p) => p.x));
  const dy = (at?.y ?? 2) - Math.min(...P.placed.map((p) => p.y));
  const { useLayoutStore } = await import('../../src/UI/store/layoutStore');
  w.flg.grid.clear();
  useLayoutStore.getState().applyPlacedCells(P.placed.map((p) => ({ x: p.x + dx, y: p.y + dy, cell: p.cell })));
  w.flg.flow.machines();
  w.flg.flow.breaks();
  return { P, C };
}

/** 지금 그리드(또는 그 안의 사각형)를 글로. 줄 이름은 가동률 검사가 낸 레인의 품목으로 붙인다. */
export async function get(x0 = 0, y0 = 0, x1 = Infinity, y1 = Infinity, header: Header = defaultHeader()) {
  const { useLayoutStore } = await import('../../src/UI/store/layoutStore');
  const { currentFlow } = await import('../../src/UI/store/flowStore');
  const { grid } = useLayoutStore.getState();
  const placed: Placed[] = [];
  for (let y = Math.max(0, y0); y <= Math.min(grid.height - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(grid.width - 1, x1); x++) {
      const c = grid.cells[y * grid.width + x];
      if (c.entityId) placed.push({ x, y, cell: c });
    }
  const flow = currentFlow();
  const itemsAt = (x: number, y: number) => {
    const b = flow.belts.get(key(x, y));
    return b ? [...b.lanes.left.items, ...b.lanes.right.items].map((i) => i.item) : [];
  };
  if (!header.items.size) {
    // 품목 글자를 a, b, c … 로 붙인다(i 는 뺀다)
    const all = new Set<string>();
    for (const b of flow.belts.values()) for (const l of [b.lanes.left, b.lanes.right]) for (const i of l.items) all.add(i.item);
    const letters = 'abcdefghjklmnopqrstuvwxyz';
    [...all].sort().forEach((it, i) => header.items.set(letters[i], it));
  }
  return render(placed, nameLines(placed, header, itemsAt), header);
}
