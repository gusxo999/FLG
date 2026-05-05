import type { GridCell, Direction } from '../../types/layout';
import { EntityType } from '../../types/layout';
import { entityTypeFromFactorioType } from '../entityCategory';
import type { Entity, Recipe } from '../../store/gameDataStore';
import { nanoid } from '../../store/nanoid';
import type { RecipeTreeNode } from './types';
import type { PlacedCell } from './placedCell';
import {
  inserterThroughput,
  beltLaneThroughput,
  type InserterOverride,
} from './inserterThroughput';

/**
 * 12-슬롯 모델 기반 placer.
 *
 * 한 머신(3×3) 둘레의 12 셀에 슬롯 1~12 번호를 부여하고, 입력은 낮은 번호부터 / 출력은 높은
 * 번호부터 채운다. 한 슬롯은 인서터 1셀 + 벨트 stub 1셀 = 총 2 셀이지만, **둘 다 머신 인접
 * 1줄(인서터) + 그 바깥 1줄(벨트 stub)** 로 면 바깥 방향으로 펼쳐진다.
 *
 * 슬롯 번호 (외부 라인이 꼬이지 않도록 사전 정렬):
 *
 *           1  2  3
 *         ┌─────────┐
 *      4  │         │  7
 *      5  │  M M M  │  8
 *      6  │  M M M  │  9
 *         │  M M M  │
 *         └─────────┘
 *          10 11 12
 *
 * 자세한 모델 설명은 docs/auto-layout-wizard.placement-search.md §3 M1 참조.
 */

export interface SlotPlacerInput {
  /** 머신 노드 — 머신 1대당 1개 unit */
  units: ReadonlyArray<{
    node: RecipeTreeNode;
    machine: Entity;
  }>;
  /** 사용할 인서터 / 벨트 — 가장 좋은(처리량 큰) 후보 한 개 */
  inserter?: Entity;
  belt?: Entity;
  inserterOverride?: InserterOverride;
  region: { x: number; y: number; w: number; h: number };
}

export interface SlotMachineLayout {
  node: RecipeTreeNode;
  recipeName: string;
  machine: Entity;
  /** 머신 origin (좌상단) */
  machineX: number;
  machineY: number;
  /** 입력 슬롯들 — 각 슬롯의 belt stub 좌표 + 운반할 ingredient 이름 */
  inputBeltStubs: Array<{ x: number; y: number; itemName: string; direction: Direction }>;
  /** 출력 슬롯들 — 각 슬롯의 belt stub 좌표 + 운반할 product 이름 */
  outputBeltStubs: Array<{ x: number; y: number; itemName: string; direction: Direction }>;
}

export interface SlotPlacerOutput {
  placed: PlacedCell[];
  layouts: SlotMachineLayout[];
  unitsPlaced: number;
  usedRegion?: { x: number; y: number; w: number; h: number };
  /** 슬롯이 12개를 초과해 본 모델로 수용 불가한 머신 수 */
  oversizedUnits: number;
}

/**
 * 한 머신의 12 슬롯 좌표 — (slotIdx 1..12) → { 인서터(머신 인접) 셀, 벨트 stub 셀, 방향 }.
 * 좌표는 (machineX, machineY) 가 머신 origin(좌상단) 일 때의 절대 좌표.
 *
 * 모든 방향은 면(side) 의 *바깥 방향* (outwardDir) 에서 파생:
 *   - 인서터 direction = 인서터 암(arm)이 향하는 방향 = **픽업 방향**.
 *     - 입력 슬롯: 벨트(바깥)에서 픽업 → 머신(안)에 드랍 → direction = outwardDir.
 *     - 출력 슬롯: 머신(안)에서 픽업 → 벨트(바깥)에 드랍 → direction = inwardDir.
 *   - 벨트 stub direction = 외부 라인 진행 방향:
 *     - 입력 stub: 머신쪽으로 흐름 → direction = inwardDir.
 *     - 출력 stub: 머신 바깥으로 흐름 → direction = outwardDir.
 */
function slotCells(machineX: number, machineY: number) {
  type Slot = {
    idx: number;
    inserterX: number;
    inserterY: number;
    beltX: number;
    beltY: number;
    /** 면 바깥 방향 (북쪽 면 = 0, 동쪽 면 = 4, 남쪽 면 = 8, 서쪽 면 = 12) */
    outwardDir: Direction;
    side: 'N' | 'S' | 'W' | 'E';
  };

  const slots: Slot[] = [];

  // 상단 (1·2·3) — 머신의 위쪽. 인서터는 y-1, 벨트는 y-2. 바깥 = 북(0).
  for (let i = 0; i < 3; i++) {
    slots.push({
      idx: 1 + i,
      inserterX: machineX + i,
      inserterY: machineY - 1,
      beltX: machineX + i,
      beltY: machineY - 2,
      outwardDir: 0,
      side: 'N',
    });
  }
  // 좌측 (4·5·6) — 머신의 왼쪽. 인서터는 x-1, 벨트는 x-2. 바깥 = 서(12).
  for (let i = 0; i < 3; i++) {
    slots.push({
      idx: 4 + i,
      inserterX: machineX - 1,
      inserterY: machineY + i,
      beltX: machineX - 2,
      beltY: machineY + i,
      outwardDir: 12,
      side: 'W',
    });
  }
  // 우측 (7·8·9) — 머신의 오른쪽. 인서터는 x+3, 벨트는 x+4. 바깥 = 동(4).
  for (let i = 0; i < 3; i++) {
    slots.push({
      idx: 7 + i,
      inserterX: machineX + 3,
      inserterY: machineY + i,
      beltX: machineX + 4,
      beltY: machineY + i,
      outwardDir: 4,
      side: 'E',
    });
  }
  // 하단 (10·11·12) — 머신의 아래쪽. 인서터는 y+3, 벨트는 y+4. 바깥 = 남(8).
  for (let i = 0; i < 3; i++) {
    slots.push({
      idx: 10 + i,
      inserterX: machineX + i,
      inserterY: machineY + 3,
      beltX: machineX + i,
      beltY: machineY + 4,
      outwardDir: 8,
      side: 'S',
    });
  }

  return slots;
}

/**
 * 한 머신에 필요한 입력/출력 슬롯 수 산정.
 * - 입력 슬롯 = ceil(재료 가짓수 / 2)  (벨트 두 lane 으로 두 재료 동시 운반 가능)
 * - 출력 슬롯 = ceil(recipe_output_throughput / 한 슬롯 1줄 처리량)
 */
export function computeSlotCounts(
  recipe: Recipe,
  machine: Entity,
  inserter: Entity | undefined,
  belt: Entity | undefined,
  inserterOv?: InserterOverride,
): { inputSlots: number; outputSlots: number } {
  const itemIngredientCount = recipe.ingredients.filter((i) => i.type === 'item').length;
  const inputSlots = Math.max(0, Math.ceil(itemIngredientCount / 2));

  // 출력 처리량 = 한 머신의 product 합 (item 만, fluid 는 본 모델 범위 외)
  const itemProducts = recipe.products.filter((p) => p.type === 'item');
  const craftingSpeed = machine.crafting_speed ?? 1;
  const energy = recipe.energy_required > 0 ? recipe.energy_required : 1;
  const totalProductPerSec = itemProducts.reduce(
    (sum, p) => sum + ((p.amount * craftingSpeed) / energy),
    0,
  );

  const insRate = inserterThroughput(inserter, inserterOv);
  const beltRate = beltLaneThroughput(belt);
  // 슬롯 1줄 처리량 = min(belt 한 lane, 인서터). belt/inserter 둘 다 0 이면 1 슬롯으로 fallback.
  const slotLine = pickPositive(insRate, beltRate);
  const outputSlots =
    itemProducts.length === 0 ? 0 : Math.max(1, Math.ceil(totalProductPerSec / slotLine));

  return { inputSlots, outputSlots };
}

function pickPositive(a: number, b: number): number {
  if (a > 0 && b > 0) return Math.min(a, b);
  if (a > 0) return a;
  if (b > 0) return b;
  return 1;
}

/**
 * 머신을 격자에 배치하면서 12-슬롯 모델로 입출력 슬롯을 채운다.
 *
 * 배치 규칙 (1차 — 머신 두 개 케이스를 위한 단순 골격):
 *  - region 안에 가로로 N개를 늘어놓는다. 머신 사이 간격은 슬롯 stub 2 셀 + 분리 padding 1 셀 = 5 칸.
 *    (머신 footprint 3 + 좌측 stub 2 = 5, 옆 머신 origin 까지 5 칸 띄움 → 두 stub 사이 1 칸 통로 확보)
 *  - 첫 머신은 region 좌상단에서 (slot stub 공간 2 칸 만큼) 안쪽으로 들어와 시작.
 *  - 슬롯 1~(inputSlots) 는 입력으로 사용, (12-outputSlots+1)~12 는 출력으로 사용.
 */
export function packUnitsBySlot(input: SlotPlacerInput): SlotPlacerOutput {
  const { units, region, inserter, belt, inserterOverride } = input;

  const placed: PlacedCell[] = [];
  const layouts: SlotMachineLayout[] = [];
  let oversizedUnits = 0;

  // 좌측 padding 2 칸 (좌측 슬롯 stub 공간), 상단 padding 2 칸 (상단 슬롯 stub 공간)
  const SLOT_PAD = 2;
  const MACHINE_W = 3;
  const STEP_X = MACHINE_W + SLOT_PAD; // 두 머신 origin 사이 거리. 좌/우 stub 중첩 없음 + 1칸 통로.

  let curX = region.x + SLOT_PAD;
  const curY = region.y + SLOT_PAD;
  let maxRight = region.x;
  let maxBottom = region.y;

  for (const unit of units) {
    if (curX + MACHINE_W + SLOT_PAD > region.x + region.w) break; // 가로 영역 부족
    if (curY + MACHINE_W + SLOT_PAD > region.y + region.h) break;

    const recipe = unit.node.recipeName;
    if (!recipe) continue;

    const { inputSlots, outputSlots } = computeSlotCountsFromUnit(
      unit.node,
      unit.machine,
      inserter,
      belt,
      inserterOverride,
    );

    if (inputSlots + outputSlots > 12) {
      oversizedUnits++;
      continue;
    }

    const machineId = nanoid();
    const machineType = entityTypeFromFactorioType(unit.machine.type);

    // 머신 footprint 3×3
    for (let dy = 0; dy < MACHINE_W; dy++) {
      for (let dx = 0; dx < MACHINE_W; dx++) {
        const isOrigin = dx === 0 && dy === 0;
        placed.push({
          x: curX + dx,
          y: curY + dy,
          cell: {
            entityId: machineId,
            entityName: unit.machine.name,
            entityType: machineType,
            direction: 0,
            tileOffset: { x: dx, y: dy },
            isOrigin,
            recipe: isOrigin ? recipe : undefined,
          },
        });
      }
    }

    // 슬롯 좌표
    const slots = slotCells(curX, curY);
    const inputBeltStubs: SlotMachineLayout['inputBeltStubs'] = [];
    const outputBeltStubs: SlotMachineLayout['outputBeltStubs'] = [];

    // 레시피 재료 — 외부든 내부든 입력 슬롯은 필요 (외부면 외부 입력 라인)
    const ingredientNames = unit.node.children.map((c) => c.itemName);
    // 재료 가짓수가 children 으로는 부족할 수 있으니, recipe 의 item ingredient 이름을 사용한다.
    // 호출자에서 recipeMap 으로 채워주는 형태가 더 깨끗하지만, 단일 머신 케이스에선 unit.node.children
    // 의 itemName 만으로 충분.

    // 입력 슬롯: 1, 2, 3, ... (inputSlots 개) — 각 슬롯이 두 lane 으로 최대 2개 재료 운반.
    // 1차 단순화: 한 슬롯 한 재료. 필요 슬롯 수 = ingredientNames.length 로 계산하되,
    // 위에서 ceil(N/2) 로 계산했으므로 슬롯 1개당 2개 재료 묶음을 짊어진다.
    const ingredientsForSlot: string[][] = [];
    for (let i = 0; i < ingredientNames.length; i += 2) {
      ingredientsForSlot.push(ingredientNames.slice(i, i + 2));
    }

    for (let i = 0; i < inputSlots; i++) {
      const slot = slots[i]; // slotIdx i+1
      // 입력 슬롯:
      //   - 인서터 픽업 = 벨트(바깥), 드랍 = 머신(안). 인서터 direction(픽업쪽) = 바깥(outwardDir).
      //   - belt stub direction = 이 셀에서 머신쪽으로 흐름 = 안쪽(inwardDir).
      const inserterDir = slot.outwardDir;
      const beltDir = oppositeDirection(slot.outwardDir);
      if (inserter) {
        placed.push(
          makePlaced(
            slot.inserterX,
            slot.inserterY,
            inserter.name,
            EntityType.Inserter,
            inserterDir,
          ),
        );
      }
      if (belt) {
        placed.push(
          makePlaced(slot.beltX, slot.beltY, belt.name, EntityType.Belt, beltDir),
        );
        // 운반 ingredient 이름 (한 slot 당 최대 2 종)
        const ings = ingredientsForSlot[i] ?? [];
        for (const ingName of ings) {
          inputBeltStubs.push({
            x: slot.beltX,
            y: slot.beltY,
            itemName: ingName,
            direction: beltDir,
          });
        }
      }
    }

    // 출력 슬롯: 12, 11, 10, ... (outputSlots 개)
    const productNames = (unit.node.recipeName
      ? recipeProductsForNode(unit.node, unit.machine)
      : []
    ).filter((n) => !!n);

    for (let i = 0; i < outputSlots; i++) {
      const slot = slots[12 - 1 - i];
      // 출력 슬롯:
      //   - 인서터 픽업 = 머신(안), 드랍 = 벨트(바깥). 인서터 direction(픽업쪽) = 안쪽(inwardDir).
      //   - belt stub direction = 이 셀에서 머신 바깥으로 흐름 = outwardDir.
      const inserterDir = oppositeDirection(slot.outwardDir);
      const beltDir = slot.outwardDir;
      if (inserter) {
        placed.push(
          makePlaced(
            slot.inserterX,
            slot.inserterY,
            inserter.name,
            EntityType.Inserter,
            inserterDir,
          ),
        );
      }
      if (belt) {
        placed.push(makePlaced(slot.beltX, slot.beltY, belt.name, EntityType.Belt, beltDir));
        const productName = productNames[0] ?? unit.node.itemName;
        outputBeltStubs.push({
          x: slot.beltX,
          y: slot.beltY,
          itemName: productName,
          direction: beltDir,
        });
      }
    }

    layouts.push({
      node: unit.node,
      recipeName: recipe,
      machine: unit.machine,
      machineX: curX,
      machineY: curY,
      inputBeltStubs,
      outputBeltStubs,
    });

    maxRight = Math.max(maxRight, curX + MACHINE_W + SLOT_PAD);
    maxBottom = Math.max(maxBottom, curY + MACHINE_W + SLOT_PAD);

    curX += STEP_X;
  }

  return {
    placed,
    layouts,
    unitsPlaced: layouts.length,
    usedRegion:
      layouts.length > 0
        ? { x: region.x, y: region.y, w: maxRight - region.x, h: maxBottom - region.y }
        : undefined,
    oversizedUnits,
  };
}

/**
 * unit 의 노드/머신/인서터/벨트 정보로 슬롯 수를 계산.
 * recipe 가 노드 안에 직접 들어 있지 않아 호출자가 recipeMap 을 함께 넘길 수도 있지만, 1차 단순화로
 * unit.node.children 에서 ingredient 가짓수를 추정한다 — 자식 수 = item ingredient 수가 일반적.
 */
function computeSlotCountsFromUnit(
  node: RecipeTreeNode,
  machine: Entity,
  inserter: Entity | undefined,
  belt: Entity | undefined,
  inserterOv?: InserterOverride,
): { inputSlots: number; outputSlots: number } {
  // ingredient 가짓수 = children 수 (외부든 내부든 한 ingredient 당 한 자식)
  const itemIngredientCount = node.children.length;
  const inputSlots = Math.max(0, Math.ceil(itemIngredientCount / 2));

  // 출력 처리량 추정 — 정확한 값을 위해서는 recipe 객체가 필요하지만, 1차는 머신 1대 기준 1개 슬롯.
  const insRate = inserterThroughput(inserter, inserterOv);
  const beltRate = beltLaneThroughput(belt);
  const slotLine = pickPositive(insRate, beltRate);
  // 1대 머신의 가장 단순한 출력 — 머신 crafting_speed × 1 product/cycle 로 가정.
  const estProductPerSec = (machine.crafting_speed ?? 1) * 1;
  const outputSlots = Math.max(1, Math.ceil(estProductPerSec / slotLine));

  return { inputSlots, outputSlots };
}

function recipeProductsForNode(node: RecipeTreeNode, _machine: Entity): string[] {
  // node.itemName 이 부모의 ingredient 일 때 = 이 노드가 산출하는 itemName.
  // 1차 단순화: 해당 itemName 만 반환.
  return [node.itemName];
}

function oppositeDirection(d: Direction): Direction {
  switch (d) {
    case 0: return 8;
    case 4: return 12;
    case 8: return 0;
    case 12: return 4;
  }
}

function makePlaced(
  x: number,
  y: number,
  name: string,
  type: EntityType,
  direction: Direction,
): PlacedCell {
  return {
    x,
    y,
    cell: {
      entityId: nanoid(),
      entityName: name,
      entityType: type,
      direction,
      tileOffset: { x: 0, y: 0 },
      isOrigin: true,
    } as GridCell,
  };
}
