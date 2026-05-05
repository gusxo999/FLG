import type { SurfaceCondition } from '../store/gameDataStore';

/**
 * Space Age 기준 행성/표면별 환경 속성값 (vanilla 데이터 기준).
 * surface_conditions 의 모든 조건을 만족하는 표면을 "허용 표면"으로 본다.
 *
 * 정확한 값은 base/space-age 모드의 surface 정의에서 가져옴 (2.0.x):
 *   - Nauvis: pressure=1000, gravity=10, magnetic-field=90, solar-power=100
 *   - Vulcanus: pressure=4000, gravity=20, magnetic-field=20, solar-power=400
 *   - Fulgora: pressure=900, gravity=8, magnetic-field=200, solar-power=200
 *   - Gleba: pressure=2000, gravity=10, magnetic-field=25, solar-power=50
 *   - Aquilo: pressure=400, gravity=3, magnetic-field=100, solar-power=20
 *   - Space platform (우주): pressure=0, gravity=0, magnetic-field=0, solar-power=200
 */
export interface KnownSurface {
  key: string;
  /** 표시용 라벨 (i18n 키가 아닌 일반 이름) */
  label: string;
  properties: Record<string, number>;
}

export const KNOWN_SURFACES: KnownSurface[] = [
  {
    key: 'nauvis',
    label: 'Nauvis',
    properties: { pressure: 1000, gravity: 10, 'magnetic-field': 90, 'solar-power': 100 },
  },
  {
    key: 'vulcanus',
    label: 'Vulcanus',
    properties: { pressure: 4000, gravity: 20, 'magnetic-field': 20, 'solar-power': 400 },
  },
  {
    key: 'fulgora',
    label: 'Fulgora',
    properties: { pressure: 900, gravity: 8, 'magnetic-field': 200, 'solar-power': 200 },
  },
  {
    key: 'gleba',
    label: 'Gleba',
    properties: { pressure: 2000, gravity: 10, 'magnetic-field': 25, 'solar-power': 50 },
  },
  {
    key: 'aquilo',
    label: 'Aquilo',
    properties: { pressure: 400, gravity: 3, 'magnetic-field': 100, 'solar-power': 20 },
  },
  {
    key: 'space-platform',
    label: 'Space platform',
    properties: { pressure: 0, gravity: 0, 'magnetic-field': 0, 'solar-power': 200 },
  },
];

/**
 * 단일 표면이 surface_conditions 배열을 모두 만족하는지 검사.
 */
export function surfaceMatches(
  surface: KnownSurface,
  conditions: SurfaceCondition[] | undefined,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  for (const c of conditions) {
    const v = surface.properties[c.property];
    if (v === undefined) return false; // 알 수 없는 property → 안전하게 거부
    if (c.min !== undefined && v < c.min) return false;
    if (c.max !== undefined && v > c.max) return false;
  }
  return true;
}

/**
 * surface_conditions 를 만족하는 알려진 표면들의 라벨 목록.
 * 모든 표면 허용이면 ['*'] 반환.
 */
export function allowedSurfaces(conditions: SurfaceCondition[] | undefined): string[] {
  if (!conditions || conditions.length === 0) return ['*'];
  return KNOWN_SURFACES.filter((s) => surfaceMatches(s, conditions)).map((s) => s.label);
}

/**
 * Human-readable summary, e.g. "Vulcanus, Aquilo" 또는 "All surfaces".
 */
export function formatSurfaceConditions(
  conditions: SurfaceCondition[] | undefined,
  allLabel: string,
  noneLabel: string,
): string {
  const surfaces = allowedSurfaces(conditions);
  if (surfaces.length === 1 && surfaces[0] === '*') return allLabel;
  if (surfaces.length === 0) return noneLabel;
  return surfaces.join(', ');
}
