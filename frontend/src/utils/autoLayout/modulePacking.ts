/**
 * modulePacking — 모듈 트리를 좌우 계층형으로 패킹한다 (조각 3, 순수·무배선).
 *
 * 단일 출처: 본 설계안(클러스터 모듈화 — 합성/패킹).
 *
 * 각 노드를 [clusterModule.generateModule] 로 부모-무시 생성한 뒤, D4 8방위 중
 * **변(side) 정렬 점수 최대**로 [moduleTransform.transformModule] 회전/반사해 출력이
 * 부모(왼쪽=W)를, 자식-공급 입력이 자식(오른쪽=E)을, raw 입력이 perimeter(N/S)를
 * 향하게 한다. 그다음 depth 열 × 세로 stack 으로 배치(**preview** — 최종 위치는 조각 5
 * 에서 기존 tidy-tree/채널 재사용)하고, 부모↔자식 입력 포트를 품목 매칭해 홉 스펙을 낸다.
 *
 * ## 변(side) vs face
 * generateModule 은 포트 `face` 를 트렁크 *축* 방향으로 준다(기둥이면 포트가 북단에 모여
 * 전부 'N'). 좌우 트리에서 의미 있는 건 포트가 클러스터의 **어느 변**(W/E/N/S)에 붙었나
 * 이므로, anchor 위치를 머신 bbox 와 비교해 변을 판정한다(X변 우선). face 정의는 불변.
 *
 * 무배선 — 라이브 회귀 0. 단위 테스트 + 전체 트리 ASCII 로만 검증.
 */

import { generateModule, type GeneratedModule, type ModuleInput, type ModulePort } from "./clusterModule";
import type { IoLine } from "./clusterPortPlanner";
import type { Container, PlacedCell, PortFace } from "./containerModel";
import { transformModule, type Orientation } from "./moduleTransform";

/** preview 배치 간격 — 최종은 조각 5(tidy-tree/채널)가 대체. */
const COLUMN_GAP = 4; // 열-간(채널) 여유
const STACK_GAP = 3; // 열-내 세로 여유

/** 한 노드의 패킹 입력 — recipe 에서 유도. */
export interface NodeSpec {
  id: string;
  depth: number;
  parentId?: string;
  machine: { entityName: string; w: number; h: number };
  count: number;
  /** ingredients=input, products=output. */
  lines: IoLine[];
}

export interface PackConfig {
  inserterEntityName: string;
  beltEntityName: string;
  longInserter?: { entityName: string; reach: number };
}

/** 한 노드의 최종 배치 — 절대 좌표로 옮겨진 모듈 + 적용된 방위·이동량. */
export interface ModulePlacement {
  id: string;
  module: GeneratedModule; // 절대 좌표(공유 좌표계)
  orientation: Orientation;
  origin: { x: number; y: number }; // extent 좌상단이 놓인 절대 위치
}

/** 자식 출력 포트 → 부모 입력 포트 (조각 4가 belt-to-belt 라우팅). 절대 좌표. */
export interface HopSpec {
  item: string;
  from: ModulePort; // 자식 출력
  to: ModulePort; // 부모 입력
}

export interface PackResult {
  placements: ModulePlacement[];
  hops: HopSpec[];
  /** child 없는 입력 포트 — raw(무한상자 유지). 절대 좌표. */
  rawPorts: ModulePort[];
  bbox: { x: number; y: number; w: number; h: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

export function packModuleTree(specs: NodeSpec[], config: PackConfig): PackResult {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const childIdsByParent = new Map<string, string[]>();
  for (const s of specs) {
    if (!s.parentId) continue;
    (childIdsByParent.get(s.parentId) ?? childIdsByParent.set(s.parentId, []).get(s.parentId)!).push(s.id);
  }
  /** 노드가 부모에 내보내는 품목(= 출력 라인 이름). */
  const productOf = (s: NodeSpec): string | undefined =>
    s.lines.find((l) => l.role === "output")?.name;
  /** 부모 입력 중 자식-공급인 품목 집합. */
  const childFedItems = (s: NodeSpec): Set<string> => {
    const set = new Set<string>();
    for (const cid of childIdsByParent.get(s.id) ?? []) {
      const p = productOf(byId.get(cid)!);
      if (p) set.add(p);
    }
    return set;
  };

  // 1+2) 생성 → D4 방위 점수 최대 정렬 → extent.
  const oriented = new Map<string, { module: GeneratedModule; orientation: Orientation }>();
  for (const s of specs) {
    const base = generateModule(toModuleInput(s, config));
    oriented.set(s.id, chooseOrientation(base, childFedItems(s)));
  }

  // 3) preview 배치 — depth 열(왼=root) × 세로 stack(extent 높이).
  const maxDepth = Math.max(...specs.map((s) => s.depth), 0);
  const colWidth = new Array(maxDepth + 1).fill(0);
  for (const s of specs) {
    const ext = moduleExtent(oriented.get(s.id)!.module);
    colWidth[s.depth] = Math.max(colWidth[s.depth], ext.w);
  }
  const colX = new Array(maxDepth + 1).fill(0);
  for (let d = 1; d <= maxDepth; d++) colX[d] = colX[d - 1] + colWidth[d - 1] + COLUMN_GAP;

  const placements: ModulePlacement[] = [];
  const absById = new Map<string, GeneratedModule>();
  const stackY = new Array(maxDepth + 1).fill(0);
  // 결정적: depth 오름차순, 같은 depth 는 id 순.
  for (const s of [...specs].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id))) {
    const { module, orientation } = oriented.get(s.id)!;
    const ext = moduleExtent(module);
    const origin = { x: colX[s.depth] - ext.x, y: stackY[s.depth] - ext.y };
    const abs = shiftModule(module, origin.x, origin.y);
    placements.push({ id: s.id, module: abs, orientation, origin: { x: colX[s.depth], y: stackY[s.depth] } });
    absById.set(s.id, abs);
    stackY[s.depth] += ext.h + STACK_GAP;
  }

  // 4) 홉 페어링(품목 매칭) + raw 분류.
  const hops: HopSpec[] = [];
  const rawPorts: ModulePort[] = [];
  for (const s of specs) {
    const mod = absById.get(s.id)!;
    const fed = childFedItems(s);
    for (const ip of mod.inputPorts) {
      if (!fed.has(ip.line.name)) rawPorts.push(ip);
    }
    if (!s.parentId) continue;
    const product = productOf(s);
    if (!product) continue;
    const out = mod.outputPorts.find((p) => p.line.name === product);
    const parentMod = absById.get(s.parentId);
    const inp = parentMod?.inputPorts.find((p) => p.line.name === product);
    if (out && inp) hops.push({ item: product, from: out, to: inp });
  }

  return { placements, hops, rawPorts, bbox: unionExtent(placements) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 방위 선택 (D4 변 정렬 점수)
// ─────────────────────────────────────────────────────────────────────────────

const D4: Orientation[] = (() => {
  const out: Orientation[] = [];
  for (const rotation of [0, 90, 180, 270] as const)
    for (const reflect of [false, true]) out.push({ rotation, reflect });
  return out;
})();

/**
 * 8방위 중 변 정렬 점수 최대를 고른다. 출력→W(부모, 가중치 10 지배), 자식-공급 입력→E,
 * raw 입력→N/S(perimeter). 동률은 D4 순서(rotation 오름차순, reflect=false 먼저)로.
 */
export function chooseOrientation(
  base: GeneratedModule,
  childFed: Set<string>,
): { module: GeneratedModule; orientation: Orientation } {
  let best: { module: GeneratedModule; orientation: Orientation } | null = null;
  let bestScore = -Infinity;
  for (const o of D4) {
    const m = transformModule(base, o);
    const s = scoreSides(m, childFed);
    if (s > bestScore) {
      bestScore = s;
      best = { module: m, orientation: o };
    }
  }
  return best!;
}

function scoreSides(mod: GeneratedModule, childFed: Set<string>): number {
  let s = 0;
  for (const p of mod.outputPorts) {
    s += portSide(p.anchor, mod.bbox) === "W" ? 10 : 0;
  }
  for (const p of mod.inputPorts) {
    const side = portSide(p.anchor, mod.bbox);
    if (childFed.has(p.line.name)) s += side === "E" ? 1 : 0;
    else s += side === "N" || side === "S" ? 1 : 0;
  }
  return s;
}

/** 포트가 머신 bbox 의 어느 변에 붙었나 — X변(W/E) 우선, 그다음 Y변(N/S). */
function portSide(anchor: { x: number; y: number }, bbox: { x: number; y: number; w: number; h: number }): PortFace {
  if (anchor.x < bbox.x) return "W";
  if (anchor.x >= bbox.x + bbox.w) return "E";
  if (anchor.y < bbox.y) return "N";
  return "S";
}

// ─────────────────────────────────────────────────────────────────────────────
// extent / 이동 / 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/** 모듈이 차지하는 실제 범위 = 머신 footprint ∪ 모든 placed 셀(튀어나온 포트 상자 포함). */
export function moduleExtent(mod: GeneratedModule): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const mk = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const m of mod.machines) {
    mk(m.origin.x, m.origin.y);
    mk(m.origin.x + m.size.w - 1, m.origin.y + m.size.h - 1);
  }
  for (const c of mod.cells) mk(c.x, c.y);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function shiftModule(mod: GeneratedModule, dx: number, dy: number): GeneratedModule {
  const pt = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  const ctn = (c: Container): Container => ({ ...c, origin: pt(c.origin) });
  const chestById = new Map<string, Container>();
  const chests = mod.chests.map((c) => { const s = ctn(c); chestById.set(s.id, s); return s; });
  const port = (p: ModulePort): ModulePort => ({
    line: p.line, anchor: pt(p.anchor), face: p.face,
    chest: chestById.get(p.chest.id) ?? ctn(p.chest),
  });
  return {
    machines: mod.machines.map(ctn),
    chests,
    cells: mod.cells.map((c): PlacedCell => ({ x: c.x + dx, y: c.y + dy, cell: c.cell })),
    ring: mod.ring.map(pt),
    inputPorts: mod.inputPorts.map(port),
    outputPorts: mod.outputPorts.map(port),
    bbox: { x: mod.bbox.x + dx, y: mod.bbox.y + dy, w: mod.bbox.w, h: mod.bbox.h },
    unroutedLines: mod.unroutedLines,
  };
}

function unionExtent(placements: ModulePlacement[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of placements) {
    const e = moduleExtent(pl.module);
    minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + e.w - 1); maxY = Math.max(maxY, e.y + e.h - 1);
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function toModuleInput(s: NodeSpec, config: PackConfig): ModuleInput {
  return {
    machine: s.machine,
    count: s.count,
    lines: s.lines,
    inserterEntityName: config.inserterEntityName,
    beltEntityName: config.beltEntityName,
    longInserter: config.longInserter,
    idPrefix: s.id,
  };
}
