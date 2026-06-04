import { useGameDataStore } from "../../store/gameDataStore";
import type {
  Area,
  CandidateNode,
  Container,
  ContainerWizardInput,
  Routing,
} from "./containerModel";
import type { MachineParamsLookup } from "./recipeTree";

// ─── 순열 ────────────────────────────────────────────────────────────────────

export function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const sub of permutations(rest)) {
      out.push([arr[i], ...sub]);
    }
  }
  return out;
}

// ─── Area 유틸 ───────────────────────────────────────────────────────────────

export function makeEmptyArea(kind: Area["kind"]): Area {
  return { kind, containers: [], placed: [], undergroundCorridors: [] };
}

export function cloneArea(a: Area): Area {
  return {
    kind: a.kind,
    containers: a.containers.map((c) => ({
      ...c,
      origin: { ...c.origin },
      size: { ...c.size },
    })),
    placed: a.placed.map((p) => ({
      x: p.x,
      y: p.y,
      cell: { ...p.cell, tileOffset: { ...p.cell.tileOffset } },
    })),
    bbox: a.bbox ? { ...a.bbox } : undefined,
    undergroundCorridors: a.undergroundCorridors.map((c) => ({
      ...c,
      range: [c.range[0], c.range[1]],
    })),
  };
}

export function commitAreaInPlace(target: Area, source: Area): void {
  target.containers.length = 0;
  for (const c of source.containers) target.containers.push(c);
  target.placed.length = 0;
  for (const p of source.placed) target.placed.push(p);
  target.bbox = source.bbox ? { ...source.bbox } : undefined;
  target.undergroundCorridors.length = 0;
  for (const c of source.undergroundCorridors) {
    target.undergroundCorridors.push({ ...c, range: [c.range[0], c.range[1]] });
  }
}

// ─── 트리 유틸 ───────────────────────────────────────────────────────────────

export function collectRoutingsFromTree(
  node: CandidateNode,
  out: Routing[],
): void {
  if (node.kind === "failure" || node.kind === "candidate") return;
  if (node.kind === "machine") {
    for (const r of node.routings) out.push(r);
  }
  for (const child of node.children) collectRoutingsFromTree(child, out);
}

// ─── 레이블 ──────────────────────────────────────────────────────────────────

export function labelFor(c: Container): string {
  return `${c.entityName}${c.recipeName ? ` [${c.recipeName}]` : ""} @ (${c.origin.x},${c.origin.y})`;
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
 */
export function makeMachineParamsLookup(
  selectedMachines: ReadonlyArray<string>,
): MachineParamsLookup {
  return (recipeName: string) => {
    const state = useGameDataStore.getState();
    const recipe = state.recipeMap.get(recipeName);
    if (!recipe) return undefined;
    for (const name of selectedMachines) {
      const ent = state.entityMap.get(name);
      if (ent?.crafting_categories?.includes(recipe.category)) {
        return {
          craftingSpeed: ent.crafting_speed ?? 1,
          productivityMultiplier: 1,
        };
      }
    }
    return undefined;
  };
}
