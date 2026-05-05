/**
 * 그리드에 배치된 엔티티 종류 수에 따라 색상을 동적으로 부여한다.
 * - N ≤ 10: ColorBrewer 팔레트 (사람 친화적, 색맹 안전)
 * - N > 10: Golden ratio 기반 hue 분배 (인접 항목이 멀리 떨어진 색을 가짐)
 *
 * 인덱스 결정: 배치된 unique entityName을 정렬하여 안정적인 인덱스 부여.
 * 같은 엔티티는 항상 같은 색. 새 엔티티 추가 시 전체 색이 재배치될 수 있음.
 */

const COLORBREWER_10 = [
  0x4e79a7, 0xf28e2b, 0xe15759, 0x76b7b2, 0x59a14f,
  0xedc948, 0xb07aa1, 0xff9da7, 0x9c755f, 0xbab0ac,
];

const PHI = 0.618033988749895;

/** HSL (h: 0-360, s/l: 0-100) → 24-bit hex int */
function hslToHex(h: number, s: number, l: number): number {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const v = lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(v * 255);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

const FALLBACK_COLOR = 0x556677;

export function getDynamicEntityColor(
  entityName: string | null | undefined,
  sortedPlacedNames: string[],
): number {
  if (!entityName) return FALLBACK_COLOR;
  const idx = sortedPlacedNames.indexOf(entityName);
  if (idx < 0) return FALLBACK_COLOR;

  const total = sortedPlacedNames.length;
  if (total <= COLORBREWER_10.length) {
    return COLORBREWER_10[idx];
  }

  // Golden ratio hue: 인접 인덱스가 hue 공간에서 멀리 떨어지도록
  const hue = ((idx * PHI) % 1) * 360;
  return hslToHex(hue, 70, 55);
}

/** 그리드 셀 배열에서 배치된 unique entityName을 수집 후 정렬 */
export function collectPlacedEntityNames(
  cells: ReadonlyArray<{ entityName: string | null; isOrigin: boolean }>,
): string[] {
  const set = new Set<string>();
  for (const c of cells) {
    if (c.entityName && c.isOrigin) set.add(c.entityName);
  }
  return [...set].sort();
}
