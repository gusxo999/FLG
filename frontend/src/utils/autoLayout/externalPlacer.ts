/**
 * 모듈 B — 외부 컨테이너 등록 (배치 지연).
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §3 / §7.1.
 *
 * `placeExternalContainer` 는 무한상자/무한파이프를 두 영역의 containers 에만
 * 등록한다. ghost cell · placed · bbox 는 추가하지 않는다.
 *
 * 실제 perimeter 배치 + 라우팅은 모든 머신 배치 완료 후
 * `wrapExternalsAroundPerimeter` (areaUnification) 이 전담한다.
 */

import { EntityType, createEmptyCell } from "../../types/layout";
import type { Direction, GridCell } from "../../types/layout";
import type { InfinitySettings, InfinityPipeSettings } from "../../types/blueprint";
import type {
  Area,
  Container,
  ContainerKind,
  PlacedCell,
} from "./containerModel";

/**
 * 외부 컨테이너 1개를 두 영역의 containers 에 등록한다.
 *
 * ghost cell / placed / bbox 는 `wrapExternalsAroundPerimeter` 가 추가한다.
 * spec.content 는 후속 라우팅·블루프린트 export 단계에서 사용된다.
 */
export function placeExternalContainer(
  spec: {
    kind: "infinity-chest" | "infinity-pipe";
    entityName: string;
    content: string;
    /** 입력(공급)/출력(회수) 역할 — export 시 infinity_settings 필터 모드 결정. */
    role?: "input" | "output";
  },
  external: Area,
  internal: Area,
): Container {
  const idx = external.containers.length;

  const container: Container = {
    id: nextExternalId(spec.kind, idx),
    kind: spec.kind,
    entityName: spec.entityName,
    origin: { x: 0, y: 0 }, // wrapExternalsAroundPerimeter 이 최종 위치로 덮어쓴다.
    size: { w: 1, h: 1 },
    content: spec.content,
    role: spec.role,
  };

  external.containers.push(container);
  internal.containers.push(container);

  return container;
}

// ─────────────────────────────────────────────────────────────────────────────
// 셀 / id / bbox 헬퍼 (areaUnification 에서도 import 해 사용)
// ─────────────────────────────────────────────────────────────────────────────

function nextExternalId(kind: ContainerKind, n: number): string {
  return `ext-${kind === "infinity-chest" ? "chest" : "pipe"}-${n}`;
}

/**
 * 컨테이너 셀 1개 생성. `at` 좌표에 박아넣음.
 */
export function makeContainerCell(
  c: Container,
  at: { x: number; y: number },
): PlacedCell {
  const cell: GridCell = {
    ...createEmptyCell(),
    entityId: c.id,
    entityName: c.entityName,
    entityType:
      c.kind === "infinity-chest"
        ? EntityType.InfinityChest
        : EntityType.InfinityPipe,
    direction: 0 satisfies Direction,
    tileOffset: { x: 0, y: 0 },
    isOrigin: true,
    ...(c.content && c.kind !== "machine"
      ? {
          infinitySettings:
            c.kind === "infinity-chest"
              ? buildInfinitySettings(c.content, c.role)
              : buildPipeInfinitySettings(c.content, c.role),
        }
      : {}),
  };
  return { x: at.x, y: at.y, cell };
}

/** 무한상자 1개가 유지할 공급 아이템 수량 (입력 상자 `at-least` 필터 기본값). */
const DEFAULT_SUPPLY_COUNT = 100;

/**
 * 무한상자의 `content` + 역할로부터 블루프린트 `infinity_settings` 를 합성한다.
 *  - 입력(공급) 상자: `at-least` 로 항상 채워 머신이 끌어가게 함.
 *  - 출력(회수) 상자: `at-most 0` + remove_unfiltered_items 로 무한 sink.
 *  - 역할 미상: 공급으로 간주.
 */
function buildInfinitySettings(
  item: string,
  role: "input" | "output" | undefined,
): InfinitySettings {
  if (role === "output") {
    return {
      remove_unfiltered_items: true,
      filters: [{ name: item, count: 0, mode: "at-most", index: 1 }],
    };
  }
  return {
    remove_unfiltered_items: false,
    filters: [{ name: item, count: DEFAULT_SUPPLY_COUNT, mode: "at-least", index: 1 }],
  };
}

/**
 * 무한파이프의 `content`(유체) + 역할로부터 블루프린트 `infinity_settings` 를 합성한다.
 * 무한상자와 대칭 의미를 갖되, 파이프 전용 모양(단일 유체 + percentage)을 쓴다.
 *  - 입력(공급) 파이프: `at-least` + 가득(100%) — 머신이 항상 끌어가게 함.
 *  - 출력(회수) 파이프: `at-most` + 빈(0%) — 무한 sink.
 *  - 역할 미상: 공급으로 간주.
 */
function buildPipeInfinitySettings(
  fluid: string,
  role: "input" | "output" | undefined,
): InfinityPipeSettings {
  if (role === "output") {
    return { name: fluid, percentage: 0, mode: "at-most" };
  }
  return { name: fluid, percentage: 1, mode: "at-least" };
}

export function expandBbox(
  bbox: Area["bbox"],
  x: number,
  y: number,
  w: number,
  h: number,
): NonNullable<Area["bbox"]> {
  if (!bbox) return { x, y, w, h };
  const minX = Math.min(bbox.x, x);
  const minY = Math.min(bbox.y, y);
  const maxX = Math.max(bbox.x + bbox.w, x + w);
  const maxY = Math.max(bbox.y + bbox.h, y + h);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
