/**
 * 모듈 B — 외부 컨테이너 배치 (외부 영역).
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §3 / Q23 / Q24.
 *
 * 외부 입력/출력에 필요한 무한상자 (`infinity-chest`) 와 무한파이프
 * (`infinity-pipe`) 를 외부 좌표계 (0, 0) 부터 1×1 단위로 *줄지어* 배치.
 * 첫 컨테이너는 (0, 0), 두 번째는 (1, 0), 세 번째는 (2, 0) ... 가로 방향 default.
 *
 * 통합 직전 (= 모든 머신 배치 + 내부 라우팅 끝난 후) 사용자가 드래그로
 * 위치를 자유롭게 조정할 수 있다 — 그 결과로 본 함수의 좌표가 덮어써진다
 * (placement-search §8.3, Q24 b).
 */

import { EntityType, createEmptyCell } from '../../types/layout';
import type { Direction, GridCell } from '../../types/layout';
import type {
  Area,
  Container,
  ContainerKind,
  PlaceExternalContainer,
  PlacedCell,
} from './containerModel';

/**
 * 외부 컨테이너 1개를 외부 영역의 다음 빈 셀에 배치.
 *
 * 좌표 부여: 이미 placed 된 외부 컨테이너 수를 n 이라 할 때 다음 위치 = (n, 0).
 * 사용자 드래그가 통합 직전에 일어나면 본 함수의 좌표는 덮어써진다 (Q24 b).
 *
 * spec.content 는 컨테이너의 `content` 필드에 저장되어 후속 라우팅·블루프린트
 * export 단계에서 port.kind 매칭 / `infinity_settings.filters` 작성에 쓰인다.
 *
 * id 는 외부에서 주입할 수 있도록 spec.id 받지 않고 본 함수가 생성 — 다른
 * 모듈과 동일한 패턴 (ContainerWizard 가 unique id 를 발급할 때 본 함수도
 * 이를 호출 시 id-prefix 로 받게 하려면 시그니처 확장 필요).
 */
export const placeExternalContainer: PlaceExternalContainer = (
  spec: { kind: 'infinity-chest' | 'infinity-pipe'; entityName: string; content: string },
  external: Area,
): Container => {
  const n = external.containers.length;
  const container: Container = {
    id: nextExternalId(spec.kind, n),
    kind: spec.kind,
    entityName: spec.entityName,
    origin: { x: n, y: 0 },
    size: { w: 1, h: 1 },
    content: spec.content,
  };

  external.containers.push(container);
  external.placed.push(makeExternalCell(container));
  external.bbox = expandBbox(external.bbox, container.origin.x, container.origin.y, 1, 1);
  return container;
};

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function nextExternalId(kind: ContainerKind, n: number): string {
  return `ext-${kind === 'infinity-chest' ? 'chest' : 'pipe'}-${n}`;
}

function makeExternalCell(c: Container): PlacedCell {
  const cell: GridCell = {
    ...createEmptyCell(),
    entityId: c.id,
    entityName: c.entityName,
    entityType: c.kind === 'infinity-chest' ? EntityType.InfinityChest : EntityType.InfinityPipe,
    direction: 0 satisfies Direction,
    tileOffset: { x: 0, y: 0 },
    isOrigin: true,
  };
  return { x: c.origin.x, y: c.origin.y, cell };
}

function expandBbox(
  bbox: Area['bbox'],
  x: number,
  y: number,
  w: number,
  h: number,
): NonNullable<Area['bbox']> {
  if (!bbox) return { x, y, w, h };
  const minX = Math.min(bbox.x, x);
  const minY = Math.min(bbox.y, y);
  const maxX = Math.max(bbox.x + bbox.w, x + w);
  const maxY = Math.max(bbox.y + bbox.h, y + h);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
