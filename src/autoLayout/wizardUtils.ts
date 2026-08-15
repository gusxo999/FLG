import { useGameDataStore, type Entity, type Recipe } from "../UI/store/gameDataStore";
import type { Area, ContainerWizardInput } from "./containerModel";
import { clusterLineRate, type MachineParamsLookup } from "./recipeTree";
import { allocateArms, type IoLine } from "./planner/module/clusterPortPlanner";
import { inserterForReach, type SpecInserter } from "./buildSpec";

// ─── Area 유틸 ───────────────────────────────────────────────────────────────

export function makeEmptyArea(kind: Area["kind"]): Area {
  return { kind, containers: [], placed: [], undergroundCorridors: [] };
}

// ─── 머신 픽커 ───────────────────────────────────────────────────────────────

export function makeMachinePicker(
  input: ContainerWizardInput,
): (recipeName: string) => { name: string } | undefined {
  return (recipeName: string) => {
    const state = useGameDataStore.getState();
    const recipe = state.recipeMap.get(recipeName);
    if (!recipe) return undefined;
    for (const name of input.selectedMachines) {
      const ent = state.entityMap.get(name);
      if (ent?.crafting_categories?.includes(recipe.category)) return { name };
    }
    return undefined;
  };
}

/**
 * 처리량 카운트용 머신 파라미터 lookup. `makeMachinePicker` 와 동일하게
 * "선택된 머신 중 카테고리가 맞는 첫 머신" 을 고르고, 그 머신의 base crafting_speed 를
 * 반환한다. 모듈은 v1 미반영(productivityMultiplier=1).
 *
 * **`inserters` 를 주면 [굶주림 보상]이 켜진다.** 인서터 팔을 다 앉힐 자리(면 좌석 행)가
 * 없으면 머신은 그만큼만 돌므로, 그 비율을 `speedFraction` 으로 함께 낸다 →
 * `countForDemand` 가 **부족분만큼 머신을 더 놓는다**(2026-07-16 사용자 설계).
 * 안 주면 `speedFraction` 미지정 = 1 = 옛 동작(굶어도 모른 척).
 */
export function makeMachineParamsLookup(
  selectedMachines: ReadonlyArray<string>,
  inserters?: ReadonlyArray<SpecInserter>,
): MachineParamsLookup {
  // lookup 은 노드마다 여러 번 불린다(countForDemand + buildThroughput) — 경고는 조합당 한 번만.
  const warned = new Set<string>();
  return (recipeName: string) => {
    const state = useGameDataStore.getState();
    const recipe = state.recipeMap.get(recipeName);
    if (!recipe) return undefined;
    for (const name of selectedMachines) {
      const ent = state.entityMap.get(name);
      if (ent?.crafting_categories?.includes(recipe.category)) {
        const craftingSpeed = ent.crafting_speed ?? 1;
        const speedFraction = inserters?.length
          ? machineSpeedFraction(recipe, ent, craftingSpeed, inserters)
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
      }
    }
    return undefined;
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
 * 팔 개수는 **머신 수와 무관**하므로([requiredInserterCount]) 이 비율도 머신 수와 무관하다 —
 * 그래서 머신 수를 정하기 **전에** 계산할 수 있다(순환 없음).
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
  const rowBudget = (ent.tile_height ?? 1) * 2; // W/E 두 면
  const { speedFraction } = allocateArms(
    lines,
    (l) => clusterLineRate(recipe, l.role, l.name, 1, params), // 머신 1대 = 머신당
    seatInserter,
    rowBudget,
  );
  // 0 = 줄마다 팔 하나씩도 못 앉힌다 → 이 머신으론 불가능. 비율로 표현할 수 없으니
  // undefined 로 두고(옛 동작) 배치 단계가 정직하게 실패하게 둔다.
  return speedFraction > 0 && speedFraction < 1 ? speedFraction : undefined;
}
