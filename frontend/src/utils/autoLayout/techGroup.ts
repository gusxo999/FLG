import type { Entity, Technology } from '../../store/gameDataStore';

/**
 * 자동 체크 규칙: 사용자가 한 후보(예: stack-inserter) 를 체크하면, 그 후보의 prereq closure 안에서
 * 같은 type 의 다른 엔티티들도 함께 체크된다.
 *
 * 입력:
 *   - candidates : 같은 type(예: 'inserter') 의 entity 목록
 *   - selected   : 사용자가 직접 체크한 entity 이름들
 *   - getTechForMachine : entity → 그것을 unlock 하는 기술 이름
 *   - resolvePrereqs    : 기술 → transitive prereq 집합
 *
 * 출력: selected ∪ (selected 의 prereq closure 안에서 unlock 되는 same-type 후보들).
 *
 * 이 함수는 기본 활성(enabled === true) 기술을 제외하지 않는다 — 결과는 "표시 단계의 자동 체크" 용도.
 * 실제 연구 필요 closure 가 필요하면 gameDataStore.resolveRequiredTechs 를 사용.
 */
export function expandSelectionByPrereq(params: {
  candidates: ReadonlyArray<Entity>;
  selected: ReadonlySet<string>;
  techMap: ReadonlyMap<string, Technology>;
  getTechForMachine: (entityName: string) => string | undefined;
  resolvePrereqs: (techName: string) => Set<string>;
}): Set<string> {
  const { candidates, selected, techMap, getTechForMachine, resolvePrereqs } = params;

  const result = new Set<string>(selected);

  // 모든 선택된 후보의 prereq closure 합집합 (자기 자신 포함)
  const allowedTechs = new Set<string>();
  for (const name of selected) {
    const tech = getTechForMachine(name);
    if (!tech) continue;
    allowedTechs.add(tech);
    for (const p of resolvePrereqs(tech)) allowedTechs.add(p);
  }

  // 기본 활성 기술도 자유 사용 가능 — 후보가 그 기술로 unlock 된다면 자동 체크 대상.
  for (const tech of techMap.values()) {
    if (tech.enabled === true) allowedTechs.add(tech.name);
  }

  for (const cand of candidates) {
    const tech = getTechForMachine(cand.name);
    // 기술 매핑이 없으면 (= 기본 활성) 자동 체크 대상
    if (!tech) {
      result.add(cand.name);
      continue;
    }
    if (allowedTechs.has(tech)) result.add(cand.name);
  }

  return result;
}

/**
 * 한 type 안에서 후보가 1개뿐이면 자동 선택해야 하는지 판단할 때 사용.
 */
export function shouldSkipStep(candidates: ReadonlyArray<Entity>): boolean {
  return candidates.length <= 1;
}
