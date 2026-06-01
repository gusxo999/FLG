/**
 * 병합 그룹화 — 같은 외부 품목을 쓰는 머신들을 트렁크 1개가 공급할 그룹으로 묶는다
 * (Phase 2 ③ 단위, 순수 함수).
 *
 * 단일 출처: 계획서 "트렁크 벨트 셀 경로 계산 — 그리디 성장" → 그룹화.
 *
 * 용량 모델 (트렁크 = 공유 belt + 머신별 탭 인서터):
 *   - 머신별 수요(items/sec) = (crafting_speed / energy_required) × ingredient.amount
 *   - 그룹 총수요 ≤ beltCapacity   (공유 트렁크 belt 가 합산을 감당)
 *   - 머신별 수요 ≤ tapCapacity    (한 탭 인서터가 감당)
 *   - 그룹 크기 ≤ maxTaps          (포트/실용 한계)
 *
 * 데이터가 없거나 수요 산정 불가 → 수요 Infinity → 단독 그룹(=1:1 강제, 병합 안 함).
 */

import type { Entity, Recipe } from '../../store/gameDataStore';
import type { PendingConnection } from './containerModel';

/** 한 (chest→machine) 입력 연결 + 병합 판단에 필요한 메타. */
export interface MergeCandidate {
  connection: PendingConnection;
  /** 외부 품목 이름 (chest.content). 같은 값끼리만 묶인다. */
  content: string;
  /** items/sec. Infinity 면 병합 불가(단독). */
  demand: number;
  /** 머신 origin (근접 정렬용). */
  pos: { x: number; y: number };
}

export interface MergeGroup {
  content: string;
  members: MergeCandidate[];
}

export interface GroupConfig {
  /** 그룹 1개의 최대 머신 수. */
  maxTaps: number;
  /** 공유 트렁크 belt items/sec. */
  beltCapacity: number;
  /** 한 탭 인서터 items/sec. */
  tapCapacity: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 수요
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 머신이 특정 재료를 소비하는 속도 (items/sec).
 *   craftsPerSec = crafting_speed / energy_required
 *   demand       = craftsPerSec × ingredient.amount
 * 레시피/머신/속도/시간/재료 중 하나라도 유효하지 않으면 Infinity (= 병합 불가).
 */
export function computeIngredientDemand(
  recipe: Recipe | undefined,
  machineEntity: Entity | undefined,
  ingredientName: string,
): number {
  if (!recipe || !machineEntity) return Infinity;
  const speed = machineEntity.crafting_speed;
  if (!speed || speed <= 0) return Infinity;
  if (!recipe.energy_required || recipe.energy_required <= 0) return Infinity;
  const ing = recipe.ingredients.find((i) => i.name === ingredientName);
  if (!ing) return Infinity;
  return (speed / recipe.energy_required) * ing.amount;
}

// ─────────────────────────────────────────────────────────────────────────────
// 그룹화
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 후보들을 품목별로 버킷팅 → 근접(지배축 투영순) 정렬 → 용량·maxTaps 기준 그리디
 * 청크. 한 탭이 감당 못 할 과수요 머신은 단독 그룹(1:1 강제). 결정적.
 */
export function groupConnections(candidates: MergeCandidate[], cfg: GroupConfig): MergeGroup[] {
  const buckets = new Map<string, MergeCandidate[]>();
  for (const c of candidates) {
    const b = buckets.get(c.content);
    if (b) b.push(c);
    else buckets.set(c.content, [c]);
  }

  const groups: MergeGroup[] = [];
  for (const [content, list] of buckets) {
    const sorted = sortByDominantAxis(list);
    let cur: MergeCandidate[] = [];
    let sum = 0;
    const flush = () => {
      if (cur.length > 0) {
        groups.push({ content, members: cur });
        cur = [];
        sum = 0;
      }
    };
    for (const c of sorted) {
      // 한 탭으로 감당 불가(Infinity 포함) → 단독 그룹(1:1 강제).
      if (!(c.demand <= cfg.tapCapacity)) {
        flush();
        groups.push({ content, members: [c] });
        continue;
      }
      // 현재 그룹에 넣으면 maxTaps 초과 또는 belt 용량 초과 → 새 그룹 시작.
      if (cur.length >= cfg.maxTaps || sum + c.demand > cfg.beltCapacity) {
        flush();
      }
      cur.push(c);
      sum += c.demand;
    }
    flush();
  }
  return groups;
}

/** 후보를 지배축(넓은 쪽) 투영순으로 정렬 — 근접 머신끼리 인접 청크되도록. */
function sortByDominantAxis(list: MergeCandidate[]): MergeCandidate[] {
  if (list.length <= 1) return [...list];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of list) {
    minX = Math.min(minX, c.pos.x); maxX = Math.max(maxX, c.pos.x);
    minY = Math.min(minY, c.pos.y); maxY = Math.max(maxY, c.pos.y);
  }
  const horizontal = maxX - minX >= maxY - minY;
  return [...list].sort((a, b) => {
    const pa = horizontal ? [a.pos.x, a.pos.y] : [a.pos.y, a.pos.x];
    const pb = horizontal ? [b.pos.x, b.pos.y] : [b.pos.y, b.pos.x];
    return pa[0] - pb[0] || pa[1] - pb[1];
  });
}
