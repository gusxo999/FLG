/**
 * snapshots — 배치 결과를 **이름 붙여 저장하고 나중에 견준다.**
 *
 * ## 왜 필요한가
 *
 * *"이게 회귀인가, 더 나은 배치의 부작용인가"* 를 판정하려고 2026-08-17 세션은
 * **작업 트리를 `git stash` 하고 새로고침해 다시 생성**했다. 작업 유실 위험이 있고 느리다.
 *
 * 코드 두 버전을 비교하는 데는 여전히 git 이 필요하다. 그러나 **같은 코드에서 입력만
 * 바꾼 비교**(지하벨트 유무·머신 수·레인 수)는 앱 안에서 끝나야 한다. 그리고 코드
 * 비교조차, *저장이 새로고침을 견디면* stash → 새로고침 → 재생성 한 번으로 끝난다 —
 * 그래서 localStorage 에 넣는다.
 *
 * ## 무엇을 담나 — 셀 전부가 아니라 **비교 가능한 요약**
 *
 * 100KB 짜리 셀 배열을 두 벌 들고 diff 하면 그 결과도 100KB 다. 담는 것은 *바뀌면
 * 반드시 알아야 하는 것*뿐이다: 크기·카운터·모듈별 포트 자리·위반 목록.
 */

import { checkLayout } from './checkRules';
import { cellHistogram } from './faceTable';
import { machineBoxOf, type LayoutView } from './layoutView';
import { readRunStats, type DeliveryCounters, type PerimeterCounters } from './runStats';
import { useAutoLayoutRunStore } from '../UI/store/autoLayoutRunStore';

const STORAGE_KEY = 'flg-snapshots';

interface PortDigest {
  x: number;
  y: number;
  role: 'input' | 'output';
  side: string;
  item: string;
}

export interface LayoutDigest {
  label: string;
  at: number;
  signature: string | null;
  cells: number;
  penalty: number;
  bbox: { x: number; y: number; w: number; h: number };
  histogram: Record<string, number>;
  delivery: DeliveryCounters | null;
  perimeter: PerimeterCounters | null;
  issues: string[];
  violations: string[];
  modules: Array<{
    key: string;
    recipe: string | null;
    machineCount: number;
    box: { x: number; y: number; w: number; h: number } | null;
    ports: PortDigest[];
  }>;
}

function load(): Record<string, LayoutDigest> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, LayoutDigest>) : {};
  } catch {
    return {};
  }
}

function save(all: Record<string, LayoutDigest>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    console.warn('[flg] 스냅샷 저장 실패 — localStorage 용량 초과일 수 있다. flg.snapshots(true) 로 비운다.');
  }
}

export function digestOf(view: LayoutView, label: string): LayoutDigest {
  const run = useAutoLayoutRunStore.getState();
  const stats = readRunStats();
  return {
    label,
    at: Date.now(),
    signature: run.signature,
    cells: view.cells.size,
    penalty: view.leaf.squarenessPenalty,
    bbox: view.bbox,
    histogram: cellHistogram(view),
    delivery: stats.delivery,
    perimeter: stats.perimeter,
    issues: run.issues.map((i) => `${i.severity}:${i.code}`).sort(),
    violations: checkLayout(view).map((v) => `${v.rule} ${v.detail}`).sort(),
    modules: view.modules
      .map((m) => ({
        key: m.key,
        recipe: m.recipe,
        machineCount: m.machineCount,
        box: machineBoxOf(view, m.key),
        ports: m.ports
          .map((p) => ({
            x: p.x,
            y: p.y,
            role: p.role,
            side: p.meta?.side ?? '?',
            item: p.meta?.item ?? '?',
          }))
          .sort((a, b) => a.y - b.y || a.x - b.x),
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export function putSnapshot(d: LayoutDigest): void {
  const all = load();
  all[d.label] = d;
  save(all);
}

export function getSnapshot(label: string): LayoutDigest | null {
  return load()[label] ?? null;
}

export function listSnapshots(): LayoutDigest[] {
  return Object.values(load()).sort((a, b) => b.at - a.at);
}

export function clearSnapshots(): void {
  save({});
}

// ─────────────────────────────────────────────────────────────────────────────
// diff — **차이만** 낸다
// ─────────────────────────────────────────────────────────────────────────────

function num(label: string, a: number, b: number, lines: string[]): void {
  if (a === b) return;
  const d = b - a;
  lines.push(`  ${label.padEnd(18)} ${a} → ${b}  (${d > 0 ? '+' : ''}${d})`);
}

function setDiff(label: string, a: string[], b: string[], lines: string[]): void {
  const removed = a.filter((x) => !b.includes(x));
  const added = b.filter((x) => !a.includes(x));
  if (removed.length === 0 && added.length === 0) return;
  lines.push(`  ${label}`);
  for (const x of removed) lines.push(`    − ${x}`);
  for (const x of added) lines.push(`    + ${x}`);
}

export function diffDigests(before: LayoutDigest, after: LayoutDigest): string {
  const lines: string[] = [];

  const size: string[] = [];
  num('셀 수', before.cells, after.cells, size);
  num('penalty', before.penalty, after.penalty, size);
  if (before.bbox.w !== after.bbox.w || before.bbox.h !== after.bbox.h) {
    size.push(`  bbox               ${before.bbox.w}×${before.bbox.h} → ${after.bbox.w}×${after.bbox.h}`);
  }
  if (size.length) lines.push('크기', ...size);

  const counters: string[] = [];
  const bd = before.delivery;
  const ad = after.delivery;
  if (bd && ad) {
    num('납품 planned', bd.planned, ad.planned, counters);
    num('납품 dijkstra', bd.dijkstraFallback, ad.dijkstraFallback, counters);
    num('납품 예약침범', bd.reservationOverrun, ad.reservationOverrun, counters);
    num('납품 실패', bd.failures, ad.failures, counters);
  } else if (bd !== ad) {
    counters.push(`  납품 카운터        ${bd ? '있음' : '없음'} → ${ad ? '있음' : '없음'}`);
  }
  const bp = before.perimeter;
  const ap = after.perimeter;
  if (bp && ap) {
    num('반출 relocated', bp.relocated, ap.relocated, counters);
    num('반출 skipped', bp.skipped, ap.skipped, counters);
    setDiff(
      '반출 skip 사유',
      bp.skips.map((s) => `${s.chestId}: ${s.reason}`),
      ap.skips.map((s) => `${s.chestId}: ${s.reason}`),
      counters,
    );
  }
  if (counters.length) lines.push('카운터', ...counters);

  const rest: string[] = [];
  setDiff('이슈', before.issues, after.issues, rest);
  setDiff('위반', before.violations, after.violations, rest);
  setDiff(
    '셀 종류',
    Object.entries(before.histogram).map(([k, n]) => `${k} ${n}`),
    Object.entries(after.histogram).map(([k, n]) => `${k} ${n}`),
    rest,
  );
  if (rest.length) lines.push('내용', ...rest);

  // 모듈 — 포트 자리가 움직였나. 여기가 "더 나은 배치인가" 판정의 실질이다.
  const modLines: string[] = [];
  const beforeKeys = before.modules.map((m) => m.key);
  const afterKeys = after.modules.map((m) => m.key);
  setDiff('모듈 목록', beforeKeys, afterKeys, modLines);
  for (const bm of before.modules) {
    const am = after.modules.find((m) => m.key === bm.key);
    if (!am) continue;
    const bPorts = bm.ports.map((p) => `${p.side}(${p.x},${p.y})${p.role === 'input' ? '←' : '→'}${p.item}`);
    const aPorts = am.ports.map((p) => `${p.side}(${p.x},${p.y})${p.role === 'input' ? '←' : '→'}${p.item}`);
    const boxChanged =
      JSON.stringify(bm.box) !== JSON.stringify(am.box) || bm.machineCount !== am.machineCount;
    const sub: string[] = [];
    if (boxChanged) {
      sub.push(
        `    머신 ${bm.machineCount}대 ${fmtBox(bm.box)} → ${am.machineCount}대 ${fmtBox(am.box)}`,
      );
    }
    setDiff('    포트', bPorts, aPorts, sub);
    if (sub.length) modLines.push(`  ${bm.key}`, ...sub);
  }
  if (modLines.length) lines.push('모듈', ...modLines);

  if (lines.length === 0) {
    return `'${before.label}' 와 차이 없음 (셀 ${after.cells} · penalty ${after.penalty})`;
  }
  const dt = ((after.at - before.at) / 1000).toFixed(0);
  return [`'${before.label}' → 현재 (${dt}s 뒤)`, ...lines].join('\n');
}

function fmtBox(b: { x: number; y: number; w: number; h: number } | null): string {
  return b ? `(${b.x},${b.y}) ${b.w}×${b.h}` : '없음';
}
