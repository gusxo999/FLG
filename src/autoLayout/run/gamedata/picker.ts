import type { Entity, GameDataLookup, Recipe } from "../../../types/gameData";
import type { Area, ContainerWizardInput } from "../../shared/types";
import { clusterLineRate, type MachineParamsLookup } from "../../tree/arith/recipe";
import { allocateArms } from "../../module/arith/arms";
import type { IoLine } from "../../module/types/line";
import {
  faceSeatArms, inserterForReach, maxRatePerMachinePerLine, type BuildSpec, type SpecBelt, type SpecInserter,
} from "../../shared/gamedata/spec";
import { laneCapOfTier } from "../../shared/arith/belt";

// ─── Area 유틸 ───────────────────────────────────────────────────────────────

export function makeEmptyArea(kind: Area["kind"]): Area {
  return { kind, containers: [], placed: [], undergroundCorridors: [] };
}

// ─── 머신 픽커 ───────────────────────────────────────────────────────────────

/**
 * 레시피 하나를 돌릴 머신 — 고른 머신 중 그 레시피의 분류를 처리하는 것 가운데 **제작 속도가 가장 빠른 것**.
 * 같으면 목록에서 먼저 적힌 것(2026-10-18 사용자 — *"가장 빠른 머신만 사용하는 게 방향"*, 속도는 제작 속도로 본다).
 *
 * 예전엔 목록에서 분류가 맞는 **첫** 머신이었다 — 위저드에서 클릭한 순서가 결과를 정하는 숨은 조건이었다
 * (`docs/auto-layout/common/known-limits.md` §4). 세는 쪽([makeMachineParamsLookup])과 놓는 쪽([makeMachinePicker])이
 * 이 함수 하나를 함께 부른다 — 둘이 다른 머신을 고르면 센 대수와 놓인 머신이 어긋난다.
 */
function machineForRecipe(
  recipe: Recipe,
  selectedMachines: ReadonlyArray<string>,
  entityMap: GameDataLookup["entityMap"],
): { name: string; entity: Entity } | undefined {
  let best: { name: string; entity: Entity } | undefined;
  for (const name of selectedMachines) {
    const entity = entityMap.get(name);
    if (!entity?.crafting_categories?.includes(recipe.category)) continue;
    if (!best || (entity.crafting_speed ?? 1) > (best.entity.crafting_speed ?? 1)) best = { name, entity };
  }
  return best;
}

export function makeMachinePicker(
  input: ContainerWizardInput,
  gameData: GameDataLookup,
): (recipeName: string) => { name: string } | undefined {
  return (recipeName: string) => {
    const recipe = gameData.recipeMap.get(recipeName);
    if (!recipe) return undefined;
    const m = machineForRecipe(recipe, input.selectedMachines, gameData.entityMap);
    return m ? { name: m.name } : undefined;
  };
}

/**
 * 처리량 카운트용 머신 파라미터 lookup. `makeMachinePicker` 와 같은 머신([machineForRecipe] — 가장 빠른 것)을
 * 고르고, 그 머신의 base crafting_speed 를 반환한다. 모듈은 v1 미반영(productivityMultiplier=1).
 *
 * **`carriers`(고른 인서터 · 벨트)를 주면 [굶주림 보상]이 켜진다.** 인서터 팔을 다 앉힐 자리(면 좌석 행)가
 * 없으면 머신은 그만큼만 돌므로, 그 비율을 `speedFraction` 으로 함께 낸다 →
 * `countForDemand` 가 **부족분만큼 머신을 더 놓는다**(2026-07-16 사용자 설계).
 * 안 주면 `speedFraction` 미지정 = 1 = 옛 동작(굶어도 모른 척).
 * **인서터와 벨트는 함께 온다** — 인서터가 몇 개 드는지는 몫이 벨트 몇 줄에 나뉘느냐에 달렸다([armLoadsOf]).
 *
 * `gameData` 는 부르는 쪽이 [gameDataLookupOf] 로 떼어 넘긴다 — 실행 입구와, 레시피 단계 트리가 머신 대수를
 * 미리 세는 화면(`AutoLayoutModal`)이다.
 */
export function makeMachineParamsLookup(
  selectedMachines: ReadonlyArray<string>,
  carriers: Pick<BuildSpec, "inserters" | "belts"> | undefined,
  gameData: GameDataLookup,
): MachineParamsLookup {
  // lookup 은 노드마다 여러 번 불린다(countForDemand + buildThroughput) — 경고는 조합당 한 번만.
  const warned = new Set<string>();
  return (recipeName: string) => {
    const recipe = gameData.recipeMap.get(recipeName);
    if (!recipe) return undefined;
    const m = machineForRecipe(recipe, selectedMachines, gameData.entityMap);
    if (!m) return undefined;
    const { name, entity: ent } = m;
    const craftingSpeed = ent.crafting_speed ?? 1;
    const speedFraction = carriers?.inserters.length
      ? machineSpeedFraction(recipe, ent, craftingSpeed, carriers.inserters, carriers.belts)
      : undefined;
    if (speedFraction !== undefined && !warned.has(recipeName)) {
      warned.add(recipeName);
      // 사용자에게 알려야 하는 사실: **인프라가 모자라 머신이 굶는다.** 배치는 그만큼
      // 머신을 더 놓아 총 생산량은 맞추지만, 머신 하나하나는 놀고 있다.
      // eslint-disable-next-line no-console
      console.warn(
        `[autoLayout] 인프라 부족 — ${recipeName} 을(를) ${name} 으로 돌리면 ` +
          `${Math.round(speedFraction * 100)}% 로만 돕니다. ` +
          `인서터가 이 머신의 재료·산출을 다 못 나릅니다(머신 둘레에 팔을 다 앉힐 자리가 없음). ` +
          `부족분은 머신을 더 놓아 보상합니다 — 더 빠른 인서터를 고르면 머신이 줄어듭니다.`,
      );
    }
    return { craftingSpeed, productivityMultiplier: 1, speedFraction };
  };
}

/**
 * 이 머신이 이 레시피를 **몇 %로 돌 수 있나** — 팔을 앉힐 자리가 모자라면 1 미만.
 *
 * 자리 = **W/E 두 면의 좌석 행**(= 머신 높이 × 2). 기둥에서 N/S 면은 옆 머신 몸통이라
 * 못 쓴다(`MODULE_ROW_GAP = 0` — [modulePacking] 의 nsExposure 가 count=1 만 예외로 둔다).
 *
 * 14행(두 면 합)을 쓸 수 있는 건 한 줄의 팔이 **W/E 를 넘나들 수 있기** 때문이다
 * ([PortPlannerInput.seatRowsPerFace] — 2026-07-17). 그 전엔 배분기가 줄 하나를 면 하나에
 * 붙박아서 이 수가 **낙관 상한**이었다(비율이 "된다"고 해도 모듈이 좌석 예산에서 거절 → 옛 경로).
 *
 * 팔 개수는 **머신 수와 무관**하므로(머신 한 대의 몫에서 나온다 — [armLoadsOf]) 이 비율도 머신 수와 무관하다 —
 * 그래서 머신 수를 정하기 **전에** 계산할 수 있다(순환 없음).
 *
 * **벨트를 함께 받는다**(2026-10-06). 팔 개수는 몫이 벨트 몇 줄에 나뉘느냐에 달렸다 — 벨트 한 줄의 상한이
 * 인서터 운반량의 정수배가 아니면 줄마다 따로 올려야 줄에 실제로 다는 수와 맞는다. 예전엔 이 함수가 벨트를 몰라서,
 * 벨트의 한도를 인서터 값에 미리 깎아 넣어(`makeBuildSpec`) 대신했다.
 *
 * **두 곳이 이 함수를 함께 읽는다** — [makeMachineParamsLookup](머신 **수**를 늘려 보상)과
 * [tryRunModulePipeline](배분기에 줄 **수요**를 넘김). 둘이 다른 속도를 믿으면 보상은 80%로
 * 머신을 늘려놓고 배분기는 100% 수요의 팔을 요구해 **좌석에서 거절**당한다(2026-07-17 실측:
 * kr-sand 가 13+5팔 > 14행으로 옛 경로 폴백. 80%면 10+4=14로 정확히 앉는다).
 */
export function machineSpeedFraction(
  recipe: Recipe,
  ent: Entity,
  craftingSpeed: number,
  inserters: ReadonlyArray<SpecInserter>,
  /** 고른 벨트들(빠른 것부터 — [BuildSpec.belts]). 가장 빠른 것의 한 줄이 몫을 자르는 단위다. */
  belts: ReadonlyArray<SpecBelt>,
): number | undefined {
  // 예전엔 여기서 `min` 을 **자체 계산**했는데, 그 규칙이 moduleWizard 에서 바뀌자
  // **여기만 옛 값에 남아** 둘이 다른 속도를 믿게 됐다(2026-07-23 실측: 팔 3개면 되는
  // 7×7 머신을 "80% 로만 돈다"고 보고 머신을 더 놓았다). 바로 이 함수의 머리말이
  // 경고하던 상태다 — 유도를 여기서 없애 구조적으로 못 어긋나게 한다.
  //
  // **`reach 1` 인 이유는 [allocateArms] 머리말에 있다** — 다이렉트가 항상 유효한 폴백이고
  // 다이렉트의 팔은 언제나 `reach 1` 이라서다. 탭이 깊은 벨트로 팔을 더 쓰면 배분기가
  // 그 자리에서 거절해 다이렉트로 물러난다(계획서 §16).
  const seatInserter = inserterForReach(inserters, 1);
  if (!seatInserter) return undefined; // 데이터 없음 — 지어내지 않는다.

  const params = { craftingSpeed, productivityMultiplier: 1 }; // 전속력 기준 수요로 잰다
  const lines: IoLine[] = [
    ...recipe.ingredients.map((i) => ({
      name: i.name,
      kind: (i.type === "fluid" ? "pipe" : "belt") as IoLine["kind"],
      role: "input" as const,
    })),
    ...recipe.products.map((p) => ({
      name: p.name,
      kind: (p.type === "fluid" ? "pipe" : "belt") as IoLine["kind"],
      role: "output" as const,
    })),
  ];
  const faceCells = ent.tile_height ?? 1;
  const rowBudget = faceCells * 2; // W/E 두 면
  const { speedFraction } = allocateArms(
    lines,
    (l) => clusterLineRate(recipe, l.role, l.name, 1, params), // 머신 1대 = 머신당
    seatInserter,
    rowBudget,
    // 붓기와 같은 낙관으로 유체 행을 0 으로 둔다 — 이 시점엔 그 줄이 어느 면에 앉을지 모른다([faceSeatArms]).
    maxRatePerMachinePerLine(laneCapOfTier(belts[0]), faceSeatArms(faceCells, 0), seatInserter),
  );
  // 0 = 줄마다 팔 하나씩도 못 앉힌다 → 이 머신으론 불가능. 비율로 표현할 수 없으니
  // undefined 로 두고(옛 동작) 배치 단계가 정직하게 실패하게 둔다.
  return speedFraction > 0 && speedFraction < 1 ? speedFraction : undefined;
}
