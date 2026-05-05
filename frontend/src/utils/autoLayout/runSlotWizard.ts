import type { Entity, Recipe } from '../../store/gameDataStore';
import {
  expandRecipeTree,
  flattenTree,
  assignMinimumCounts,
  assignProportionalCounts,
} from './recipeTree';
import { recipeHasFluid, type PlacedCell } from './placedCell';
import { buildOccupancy, routeBelt } from './router';
import { packUnitsBySlot, type SlotMachineLayout } from './slotPlacer';
import type {
  WizardInput,
  WizardResult,
  WizardWarning,
  RecipeTreeNode,
} from './types';

interface RunDeps {
  recipeMap: Map<string, Recipe>;
  itemToRecipe: Map<string, string>;
  entityMap: Map<string, Entity>;
  pickMachineForRecipe: (recipeName: string, selected: ReadonlyArray<string>) => Entity | undefined;
}

/**
 * 둘레 슬롯 모델 기반 자동완성 wizard.
 *
 * 기존 PoC (runAutoLayoutWizard) 와 별도 진입점. 머신 두 개 케이스를 1차 타깃으로 한 구현으로,
 * 단일 머신 슬롯 모델이 다중 머신으로 자연스럽게 확장된 형태:
 *   - 각 머신을 가로로 나란히 배치 (slotPlacer 가 처리)
 *   - producer 의 output stub → consumer 의 input stub 을 itemName 으로 매칭해 router 호출
 *
 * 이 wizard 는 fluid 레시피 / 다단계 트리 / 회전 머신 / 공유 슬롯 (O3) 을 다루지 않는다.
 * 머신 두 개 직렬 (A → B) 시나리오를 1차 타깃으로 작성됐으나 **실측 동작은 검증되지 않음**.
 */
export function runSlotAutoLayoutWizard(input: WizardInput, deps: RunDeps): WizardResult {
  const warnings: WizardWarning[] = [];
  const { recipeMap, itemToRecipe, entityMap, pickMachineForRecipe } = deps;

  // 1) 레시피 트리
  let tree: RecipeTreeNode = expandRecipeTree(
    input.targetRecipe,
    recipeMap,
    itemToRecipe,
    input.externalIngredients,
  );

  // 2) 머신 수
  const craftingSpeedFor = (recipeName: string): number | undefined =>
    pickMachineForRecipe(recipeName, input.selectedMachines)?.crafting_speed;

  tree =
    input.countMode === 'min'
      ? assignMinimumCounts(tree)
      : assignProportionalCounts(
          tree,
          Math.max(1, input.countMode.perTarget),
          recipeMap,
          craftingSpeedFor,
        );

  // 3) 머신 매핑 + fluid 검사
  let hasFluidWarn = false;
  const unitNodes: Array<{ node: RecipeTreeNode; machine: Entity }> = [];
  for (const node of flattenTree(tree)) {
    if (node.external || !node.recipeName) continue;
    if (node.machineCount <= 0) continue;
    if (!hasFluidWarn && recipeHasFluid(recipeMap.get(node.recipeName))) {
      warnings.push({
        code: 'fluid-recipe-not-supported',
        message: 'Fluid I/O 라인은 12-슬롯 모델 범위 외 — 머신만 배치, 파이프 라인 미구현',
        context: { recipe: node.recipeName },
      });
      hasFluidWarn = true;
    }
    const machine = pickMachineForRecipe(node.recipeName, input.selectedMachines);
    if (!machine) {
      warnings.push({
        code: 'no-machine-for-recipe',
        message: `${node.recipeName} 카테고리를 처리할 수 있는 머신이 선택되지 않았습니다`,
        context: { recipe: node.recipeName },
      });
      continue;
    }
    for (let i = 0; i < node.machineCount; i++) {
      unitNodes.push({ node, machine });
    }
  }

  if (input.selectedInserters.length === 0) {
    warnings.push({
      code: 'no-inserter-selected',
      message: '인서터가 선택되지 않아 입출력 인서터 없이 머신만 배치됩니다',
    });
  }
  if (input.selectedBelts.length === 0) {
    warnings.push({
      code: 'no-belt-selected',
      message: '벨트가 선택되지 않아 입출력 벨트 없이 머신만 배치됩니다',
    });
  }

  // 4) 가장 좋은 인서터/벨트 선택 (사용자 선택 첫 번째)
  const inserter = pickPrimary(input.primaryInserter, input.selectedInserters, entityMap);
  const belt = pickPrimary(input.primaryBelt, input.selectedBelts, entityMap);
  const inserterOv = inserter
    ? input.inserterOverrides?.[inserter.name]
    : undefined;

  // 5) 슬롯 placer
  const pack = packUnitsBySlot({
    units: unitNodes,
    region: input.region,
    inserter,
    belt,
    inserterOverride: inserterOv,
  });

  if (pack.unitsPlaced < unitNodes.length) {
    warnings.push({
      code: 'partial-region-overflow',
      message: `영역이 부족하여 ${pack.unitsPlaced}/${unitNodes.length} 머신만 배치됨`,
      context: { placed: pack.unitsPlaced, required: unitNodes.length },
    });
  }
  if (pack.oversizedUnits > 0) {
    warnings.push({
      code: 'partial-region-overflow',
      message: `슬롯 12개를 초과하는 머신 ${pack.oversizedUnits}개는 본 모델로 수용 불가`,
      context: { count: pack.oversizedUnits },
    });
  }

  // 6) 라우팅 — producer.outputBeltStubs ↔ consumer.inputBeltStubs (itemName 매칭)
  const allCells: PlacedCell[] = [...pack.placed];
  const routesFailed: string[] = [];

  if (belt && pack.layouts.length > 1) {
    const occ = buildOccupancy(allCells);
    const routes = collectSlotRoutes(pack.layouts);
    for (const route of routes) {
      const result = routeBelt(
        { from: route.from, to: route.to, itemName: route.itemName, beltName: belt.name },
        input.region,
        occ,
      );
      if (!result.ok) {
        routesFailed.push(`${route.fromRecipe} → ${route.toRecipe} (${route.itemName})`);
      } else {
        allCells.push(...result.added);
      }
    }
  }

  if (routesFailed.length > 0) {
    warnings.push({
      code: 'route-failed',
      message: `벨트 경로를 찾지 못한 연결: ${routesFailed.join(', ')}`,
      context: { count: routesFailed.length },
    });
  }

  const ok =
    pack.unitsPlaced === unitNodes.length &&
    unitNodes.length > 0 &&
    routesFailed.length === 0 &&
    !warnings.some((w) => w.code === 'no-machine-for-recipe');

  return {
    ok,
    tree,
    placement: allCells.map((p) => p.cell),
    placedWithCoords: allCells,
    usedRegion: pack.usedRegion,
    machinesPlaced: pack.unitsPlaced,
    machinesRequired: unitNodes.length,
    warnings,
    logs: [],
  };
}

interface SlotRoute {
  from: { x: number; y: number };
  to: { x: number; y: number };
  itemName: string;
  fromRecipe: string;
  toRecipe: string;
}

/**
 * producer 의 outputBeltStubs 와 consumer 의 inputBeltStubs 를 itemName 으로 매칭.
 * - 한 itemName 의 producer 가 여럿이면 첫 매칭만 사용 (다중 합류는 .known-limits §4)
 * - producer == consumer 면 스킵 (자기 자신 라우팅 X)
 */
function collectSlotRoutes(layouts: ReadonlyArray<SlotMachineLayout>): SlotRoute[] {
  const producerByItem = new Map<string, SlotMachineLayout>();
  for (const layout of layouts) {
    for (const stub of layout.outputBeltStubs) {
      if (!producerByItem.has(stub.itemName)) producerByItem.set(stub.itemName, layout);
    }
  }

  const out: SlotRoute[] = [];
  for (const consumer of layouts) {
    for (const stub of consumer.inputBeltStubs) {
      const producer = producerByItem.get(stub.itemName);
      if (!producer || producer === consumer) continue;
      // 첫 매칭 producer 의 outputBeltStubs 중 같은 itemName stub
      const fromStub = producer.outputBeltStubs.find((s) => s.itemName === stub.itemName);
      if (!fromStub) continue;
      out.push({
        from: { x: fromStub.x, y: fromStub.y },
        to: { x: stub.x, y: stub.y },
        itemName: stub.itemName,
        fromRecipe: producer.recipeName,
        toRecipe: consumer.recipeName,
      });
    }
  }
  return out;
}

function pickPrimary(
  primary: string | undefined,
  selected: ReadonlyArray<string>,
  entityMap: Map<string, Entity>,
): Entity | undefined {
  if (primary) {
    const e = entityMap.get(primary);
    if (e) return e;
  }
  for (const name of selected) {
    const e = entityMap.get(name);
    if (e) return e;
  }
  return undefined;
}
