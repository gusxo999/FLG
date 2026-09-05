/**
 * checkRules — 배치가 **앱이 이미 아는 사실**을 어겼는지 본다. 위반만 낸다.
 *
 * ## 왜 앱이 검사하나
 *
 * 2026-08-17 세션에서 *"벨트가 연속인가"* 를 AI 가 파이썬으로 짜서 검사했다. 그건
 * 콘솔 덤프를 다시 파싱해 앱이 이미 갖고 있는 자료구조를 **재구성한 것**이다. 규칙이
 * 결함을 실제로 잡았다면(잡았다 — 아래 넷 중 셋이 그날 위반을 냈다) 그 검사는 도구가
 * 되어야 한다.
 *
 * ## 규칙은 넷뿐이고, 전부 실측에서 나왔다
 *
 * | 규칙 | 무엇을 본다 | 근거 |
 * |---|---|---|
 * | R-겹침   | 한 칸을 두 엔티티가 점유 | 모델 불변(정합성 조건 O) |
 * | R-연속   | 한 라우팅의 셀이 끊겼나 | 2026-08-17 결함 A |
 * | R-도달   | 포트와 머신 사이가 비었나 | 2026-08-17 결함 A |
 * | R-무우회 | 남의 상자를 ㄷ자로 감았나 | 2026-08-17 결함 B |
 *
 * **지어낸 규칙을 늘리지 않는다.** 위반을 실제로 낸 적 없는 규칙은 통과해도 아무것도
 * 증명하지 않으면서 "검사했다" 는 안심만 준다.
 */

import { EntityType } from '../types/layout';
import type { Routing } from '../autoLayout/containerModel';
import { cellKey, classOf, machineBoxOf, type Face, type LayoutView } from './layoutView';

export interface Violation {
  rule: 'R-겹침' | 'R-연속' | 'R-도달' | 'R-무우회';
  detail: string;
  cells: Array<{ x: number; y: number }>;
}

const NEIGH = [
  { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
];

/** 전체 검사. 위반이 없으면 빈 배열. */
export function checkLayout(view: LayoutView): Violation[] {
  return [
    ...checkOverlap(view),
    ...checkContinuity(view),
    ...checkReach(view),
    ...checkNoWrap(view),
  ];
}

/**
 * R-겹침 — 한 칸을 **서로 다른 엔티티**가 점유한다.
 *
 * `view.cells` 는 Map 이라 덮어써서 안 보인다. 원본 배열을 훑어야 잡힌다 —
 * 그래서 이 검사가 뷰가 아니라 leaf 를 본다.
 */
function checkOverlap(view: LayoutView): Violation[] {
  const seen = new Map<string, { id: string | null; type: EntityType }>();
  const out: Violation[] = [];
  for (const area of [view.leaf.internal, view.leaf.external]) {
    for (const p of area.placed) {
      const k = cellKey(p.x, p.y);
      const prev = seen.get(k);
      if (prev && prev.id !== p.cell.entityId) {
        out.push({
          rule: 'R-겹침',
          detail: `(${p.x},${p.y}) — ${prev.type}(${prev.id}) 위에 ${p.cell.entityType}(${p.cell.entityId})`,
          cells: [{ x: p.x, y: p.y }],
        });
      } else if (!prev) {
        seen.set(k, { id: p.cell.entityId, type: p.cell.entityType });
      }
    }
  }
  return out;
}

/**
 * R-연속 — 한 라우팅(=같은 `entityId`)의 셀이 끊겼다.
 *
 * `entityId` 는 라우팅 단위의 논리적 묶음이라 한 라우팅의 인서터·벨트·지하벨트가 같은
 * id 를 공유한다(블루프린트 export 가 이 사실 위에 서 있다). 그러니 한 id 의 셀들은
 * **연결돼 있어야** 한다 — 지하 변형은 같은 축의 짝끼리 건너뛴다.
 */
function checkContinuity(view: LayoutView): Violation[] {
  const groups = new Map<string, Array<{ x: number; y: number; type: EntityType }>>();
  for (const c of view.cells.values()) {
    if (!c.entityId) continue;
    const cls = classOf(c.type);
    if (cls !== 'carrier' && cls !== 'inserter') continue;
    const g = groups.get(c.entityId) ?? [];
    g.push({ x: c.x, y: c.y, type: c.type });
    groups.set(c.entityId, g);
  }

  const out: Violation[] = [];
  for (const [id, unsorted] of groups) {
    if (unsorted.length < 2) continue;
    // **정렬해서 시작한다.** 안 하면 어느 조각이 "본체" 가 되는지가 삽입 순서에 달려
    // 있어, 같은 결함이 실행마다 다른 칸을 짚는다.
    const cells = [...unsorted].sort((a, b) => a.y - b.y || a.x - b.x);
    const comps = components(cells);
    if (comps.length < 2) continue;

    // **조각이 아니라 틈을 짚는다.** 어느 조각이 잘못인지는 알 수 없지만, 둘 사이가
    // 비었다는 사실은 확실하다 — 사람이 볼 자리는 그 사이다.
    const gap = nearestGap(comps[0], comps.slice(1).flat());
    out.push({
      rule: 'R-연속',
      detail:
        `라우팅 ${id} 가 ${comps.length}조각으로 끊겼다`
        + ` (셀 ${cells.length}개: ${comps.map((c) => c.length).join('+')})`
        + ` — 틈 (${gap.a.x},${gap.a.y})↔(${gap.b.x},${gap.b.y})`,
      cells: [gap.a, gap.b],
    });
  }
  return out;
}

type Pt = { x: number; y: number; type: EntityType };

/** 인접 + 지하 짝(같은 행/열의 다른 지하 셀)을 간선으로 본 연결 요소들. */
function components(cells: Pt[]): Pt[][] {
  const byKey = new Map(cells.map((c) => [cellKey(c.x, c.y), c]));
  const isUnder = (c: Pt) =>
    c.type === EntityType.UndergroundBelt || c.type === EntityType.PipeUnderground;
  const undergrounds = cells.filter(isUnder);

  const seen = new Set<string>();
  const out: Pt[][] = [];
  for (const start of cells) {
    const k0 = cellKey(start.x, start.y);
    if (seen.has(k0)) continue;
    const comp: Pt[] = [];
    const queue = [start];
    seen.add(k0);
    while (queue.length) {
      const cur = queue.shift()!;
      comp.push(cur);
      for (const n of NEIGH) {
        const k = cellKey(cur.x + n.dx, cur.y + n.dy);
        const nb = byKey.get(k);
        if (nb && !seen.has(k)) {
          seen.add(k);
          queue.push(nb);
        }
      }
      if (isUnder(cur)) {
        for (const u of undergrounds) {
          if (u.x !== cur.x && u.y !== cur.y) continue;
          const k = cellKey(u.x, u.y);
          if (!seen.has(k)) {
            seen.add(k);
            queue.push(u);
          }
        }
      }
    }
    out.push(comp);
  }
  return out;
}

/** 두 조각 사이에서 가장 가까운 칸 쌍 = 틈의 양끝. */
function nearestGap(a: Pt[], b: Pt[]): { a: { x: number; y: number }; b: { x: number; y: number } } {
  let best = { a: { x: a[0].x, y: a[0].y }, b: { x: b[0].x, y: b[0].y } };
  let bestD = Infinity;
  for (const p of a) {
    for (const q of b) {
      const d = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
      if (d < bestD) {
        bestD = d;
        best = { a: { x: p.x, y: p.y }, b: { x: q.x, y: q.y } };
      }
    }
  }
  return best;
}

/**
 * R-도달 — 포트와 머신 사이가 비었거나 인서터가 없다.
 *
 * 포트는 머신 면에서 `clusterBeltDepth` 칸 바깥이다(2=일반 인서터, 3=긴팔). 그 사이 칸은
 * **전부 채워져 있어야** 하고, 아이템이면 그중 하나는 인서터여야 한다. 유체 포트는
 * 파이프가 머신에 직접 닿으므로 인서터를 안 본다.
 */
function checkReach(view: LayoutView): Violation[] {
  const out: Violation[] = [];
  for (const mod of view.modules) {
    const box = machineBoxOf(view, mod.key);
    if (!box) continue;
    for (const p of mod.ports) {
      // **면은 포트가 답한다 — 기하로 추측하지 않는다**(2026-09-04).
      //
      // [sideOf] 는 x 를 먼저 보므로, **두 축 다 박스 밖**인 포트(= 기둥 끝 포트: 열의
      // 끝을 지나 깊이만큼 바깥)를 `W`/`E` 로 찍는다. 그러면 머신이 **한 대도 없는 행**을
      // 가로로 훑고 *"사이가 비었다"* 고 외친다 — 실측 6건이 전부 그것이었다
      // (예: `n2-stone-tablet` 포트 (21,35) W, 머신 블록은 y38..40 이라 행 35 엔 아무것도 없다).
      //
      // `meta.side` 가 **단일 출처**다([[ns-face-relief]] 결정 5) — [faceTable] 도 이미
      // 그걸 먼저 본다. 기둥 끝 포트면 `N`/`S` 라 세로로 훑고, 그게 실제 벨트가 가는 길이다.
      const face = p.meta?.side ?? sideOf(box, p.x, p.y);
      if (!face) continue; // 머신 안쪽 포트(있을 수 없지만) — 판정 대상 아님
      const between = cellsBetween(box, face, p.x, p.y);
      if (between.length === 0) continue; // d1 = 머신에 직접 닿음
      // **얕은 칸은 남의 것이다 — 비어도 된다**(2026-09-04).
      //
      // 팔이 **긴팔**이면 d1 에서 d3 을 집는다 — 그 사이 d2 는 이 줄의 것이 아니고,
      // 다른 줄이 안 쓰면 **비어 있는 것이 정상**이다. 그런데 여태 *"사이가 전부 채워져야
      // 한다"* 고 봐서 멀쩡한 긴팔 포트를 위반으로 찍었다(실측: `n0` 포트 (14,21) 의
      // `(11,21)` = d2. 팔은 d1 에 있고 수집 줄은 d3 이라 d2 를 건너뛴다).
      //
      // 채워져 있어야 하는 것은 **상자에서 수집 줄까지**다 — 그게 트렁크이고, 끊기면
      // 물건이 못 나간다. 그 아래(d1 ~ 수집 줄 사이)는 팔이 넘어간다.
      const beltDepth = p.meta?.clusterBeltDepth;
      const need =
        beltDepth === undefined
          ? between
          : between.filter((c) => depthOf(box, face, c) >= beltDepth);
      const empty = need.filter((c) => !view.cells.has(cellKey(c.x, c.y)));
      if (empty.length > 0) {
        out.push({
          rule: 'R-도달',
          detail:
            `${mod.key} 포트 (${p.x},${p.y}) ${face} 와 머신 사이가 비었다`
            + ` — ${empty.map((c) => `(${c.x},${c.y})`).join(' ')}`,
          cells: empty,
        });
        continue;
      }
      const portCell = view.cells.get(cellKey(p.x, p.y));
      const isFluid =
        portCell?.type === EntityType.Pipe || portCell?.type === EntityType.PipeUnderground;
      if (isFluid) continue;
      // **인서터 요구는 「나란히 선」 포트만** (2026-09-04).
      //
      // 옆 포트는 `벨트 → 인서터 → 머신` 이 **한 직선 위**에 있다. 기둥 끝 포트는 아니다 —
      // 열의 끝을 지나 서 있어서 그 직선이 머신 행/열을 **비껴간다.** 그 줄에는 트렁크
      // 벨트만 있고, 머신을 먹이는 팔은 **수직 방향**(트렁크 옆)에 따로 앉는다.
      //
      // 그래서 여기서 인서터를 요구하면 **멀쩡한 기둥 끝 포트를 전부 위반으로 찍는다**
      // (2026-09-04 실측 4~6건이 전부 그것이었다). 채워졌나(위)는 트렁크가 끊겼는지를
      // 재므로 **모든 포트에 그대로 묻고**, 팔의 유무만 정렬된 포트로 좁힌다.
      const aligned =
        face === "W" || face === "E"
          ? p.y >= box.y && p.y < box.y + box.h
          : p.x >= box.x && p.x < box.x + box.w;
      if (!aligned) continue;
      const hasInserter = between.some((c) => {
        const cell = view.cells.get(cellKey(c.x, c.y));
        return cell !== undefined && classOf(cell.type) === 'inserter';
      });
      if (!hasInserter) {
        out.push({
          rule: 'R-도달',
          detail:
            `${mod.key} 포트 (${p.x},${p.y}) ${face} 와 머신 사이에 인서터가 없다`
            + ` — ${between.map((c) => `(${c.x},${c.y})=${view.cells.get(cellKey(c.x, c.y))?.type ?? '빈칸'}`).join(' ')}`,
          cells: between,
        });
      }
    }
  }
  return out;
}

/**
 * R-무우회 — 라우팅이 **자기 끝점이 아닌** 상자의 세 면 이상을 감았다.
 *
 * 계획을 못 쓰고 탐색으로 돈 벨트가 남의 포트 상자를 ㄷ자로 감고 들어오는 기하 —
 * `delivery-dijkstra-fallback` 경고가 말하는 바로 그 모양이다. 세 면이 기준인 이유:
 * 두 면은 모퉁이를 도는 정상 경로에서도 나온다.
 */
function checkNoWrap(view: LayoutView): Violation[] {
  const chests = view.containers.filter(
    (c) => c.kind === 'infinity-chest' || c.kind === 'infinity-pipe',
  );
  if (chests.length === 0) return [];

  const out: Violation[] = [];
  for (const r of view.routings as readonly Routing[]) {
    const path = new Set(r.placed.map((p) => cellKey(p.x, p.y)));
    if (path.size === 0) continue;
    for (const chest of chests) {
      if (chest.id === r.from.containerId || chest.id === r.to.containerId) continue;
      const wrapped = NEIGH.filter((n) =>
        path.has(cellKey(chest.origin.x + n.dx, chest.origin.y + n.dy)),
      );
      if (wrapped.length >= 3) {
        out.push({
          rule: 'R-무우회',
          detail:
            `라우팅 ${r.id}(${r.kind}) 가 상자 ${chest.id} @(${chest.origin.x},${chest.origin.y})`
            + ` 의 ${wrapped.length}면을 감았다`,
          cells: wrapped.map((n) => ({ x: chest.origin.x + n.dx, y: chest.origin.y + n.dy })),
        });
      }
    }
  }
  return out;
}

function sideOf(
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

/**
 * 그 칸이 머신 면에서 **몇 칸 바깥**인가 — d1 = 머신에 붙은 칸.
 *
 * `cellsBetween` 의 배열 순서는 면마다 다르므로(W 는 포트 쪽부터, E 는 머신 쪽부터)
 * index 로 깊이를 세면 안 된다. 좌표에서 직접 잰다.
 */
function depthOf(
  box: { x: number; y: number; w: number; h: number },
  face: Face,
  c: { x: number; y: number },
): number {
  if (face === 'W') return box.x - c.x;
  if (face === 'E') return c.x - (box.x + box.w) + 1;
  if (face === 'N') return box.y - c.y;
  return c.y - (box.y + box.h) + 1;
}

/** 포트와 머신 면 **사이**의 칸들(양끝 제외). d1 이면 빈 배열. */
function cellsBetween(
  box: { x: number; y: number; w: number; h: number },
  face: Face,
  px: number,
  py: number,
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  if (face === 'W') for (let x = px + 1; x < box.x; x++) out.push({ x, y: py });
  if (face === 'E') for (let x = box.x + box.w; x < px; x++) out.push({ x, y: py });
  if (face === 'N') for (let y = py + 1; y < box.y; y++) out.push({ x: px, y });
  if (face === 'S') for (let y = box.y + box.h; y < py; y++) out.push({ x: px, y });
  return out;
}

/** 위반을 사람이 읽을 블록으로. 통과하면 한 줄. */
export function formatViolations(v: readonly Violation[]): string {
  if (v.length === 0) return '검사 통과 — 위반 없음 (R-겹침 · R-연속 · R-도달 · R-무우회)';
  const byRule = new Map<string, Violation[]>();
  for (const x of v) byRule.set(x.rule, [...(byRule.get(x.rule) ?? []), x]);
  const parts: string[] = [`위반 ${v.length}건`];
  for (const [rule, list] of byRule) {
    parts.push(`\n[${rule}] ${list.length}건`);
    for (const x of list.slice(0, 12)) parts.push(`  ${x.detail}`);
    if (list.length > 12) parts.push(`  … 그 외 ${list.length - 12}건`);
  }
  return parts.join('\n');
}
