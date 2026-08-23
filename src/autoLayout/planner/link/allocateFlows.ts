/**
 * allocateFlows — 자식 머신들의 산출을 부모 머신들에게 나눠 주는 순수 함수.
 *
 * 단일 출처: docs/용어사전.md#allocateFlows (사장님 명명·규칙 확정 2026-07-17,
 * **장부 단위 재정의 2026-08-22**).
 *
 * ## 무엇을 정하나 — **흐름**이지 벨트가 아니다
 * 자식 클러스터(같은 레시피 머신 N대)의 산출을 부모 클러스터(M대)에게 어떻게 흘려보낼지,
 * **[Flow] 목록**으로 낸다. Flow 하나 = **흐름 하나** = *"자식 머신 a 가 부모
 * 머신 b 에게 품목 i 를 초당 r 개 준다"*.
 *
 * **벨트가 몇 줄인지는 여기서 안 정한다.** 흐름과 벨트 줄은 M:N 이다 — 한 줄이 흐름 여럿을
 * 싣고(트렁크), 한 흐름이 줄 여럿에 쪼개진다(링크). 그 접기는 [edgeLinkGroups] 가 한다.
 *
 * ## 왜 rate 인가 (2026-08-22 사장님 확정)
 * 예전 장부의 단위는 **인서터 개수**였고, 그래서 *"팔 한 개 몫이 안 되는 자투리는 버린다"* 는
 * 규칙이 성립했다. 팔은 좌석·reach 가 정한 **기하의 산물**이라 장부의 단위가 되면 안 된다 —
 * 머신 한 대의 산출이 팔 하나 몫보다 작으면(용광로 0.625/s vs 팔 27.7/s) **아직 한 개도 안
 * 내보낸 머신에** 그 규칙이 적용되어 *"덜 돈다"* 가 아니라 **안 돈다**가 됐다. 실제로
 * battery 트리의 링크는 어떤 인서터를 골라도 **언제나 0** 이었다(2026-08-21 실측).
 *
 * 팔 개수는 반대 방향으로 유도된다: `팔 수 = ceil(그 벨트가 맡은 rate ÷ 팔 하나의 실효
 * 처리량)`. 올림은 **용량이 약속량을 덮게 하려는 것**이고 장부에는 안 흘러든다.
 *
 * ## 두 손가락이 각자 자기 줄을 훑는 물 붓기
 * 자식 손가락은 위에서 아래로 머신을 훑고, 부모 손가락도 위에서 아래로 훑는다. 지금 부모를
 * 채우다가 자식이 **다 비면** 다음 자식으로, 부모가 **다 차면** 다음 부모로 넘어간다. 한
 * 자식이 여러 부모를, 한 부모가 여러 자식을 만날 수 있다(자식≠부모 개수가 정상 — 흐름이지
 * 짝짓기가 아니다).
 *
 * **따라오는 공짜 성질 — 흐름 수열은 양끝 모두 단조다.** 두 손가락이 증가만 하므로
 * `fromMachine`·`toMachine` 이 둘 다 비감소이고, 그래서 접기(→ 벨트)가 순서를 유지하면
 * 벨트가 교차할 수 없다. 좌표는 한 번도 안 본다.
 *
 * ## 여기 없는 것 — 한 클러스터만 아는 절반
 * [Link]·`makeLink`·`readLinkRole`·`externalLineGroups` 는
 * [module/link](../../module/link.ts) 에 있다. 그것들은 **로컬 머신
 * index + 팔 수**만 알아 형제를 모르므로 `link` 가 아니라 `module` 관심사다.
 *
 * **이 파일은 아무것도 import 하지 않는다.** 두 절반이 한 파일에 있던 시절엔 경계가 안 보여
 * `module/` 이 `planner/link/` 를 부르고 `planner/link/` 가 다시 `module/` 을 부르는 왕복
 * 간선이 있었다(2026-08-02 해소). 이 파일이 순수한 산술로 남아 있는 한 그 간선은 안 돌아온다.
 */

/** **흐름 하나** — 자식 머신 하나가 부모 머신 하나에게 품목 하나를 초당 얼마씩 준다. */
export interface Flow {
  /** 자식 머신 인덱스(배치 순서 = 위에서 아래로). */
  fromMachine: number;
  /** 부모 머신 인덱스(배치 순서). */
  toMachine: number;
  /** 운반 품목. */
  item: string;
  /**
   * **초당 몇 개** — 장부의 단위. 팔 개수도 벨트 줄 수도 여기서 유도된다(반대가 아니다).
   */
  rate: number;
}

export interface AllocateMachineLinksInput {
  /** 자식 머신 대수(≥1). */
  childCount: number;
  /** 부모 머신 대수(≥1). */
  parentCount: number;
  /** 자식 머신 **한 대**의 초당 산출(items/sec). 굶주림 보상이 이미 반영된 실효 산출. */
  childProduction: number;
  /** 부모 머신 **한 대**의 초당 필요량(items/sec). */
  parentDemand: number;
  /** 운반 품목. */
  item: string;
}

// 부동소수 비교 여유. 부모 필요량이 60.5 같은 분수라 나눗셈 경계에서 흔들린다.
const EPS = 1e-9;

/**
 * 자식 산출을 부모에게 나눠 [Flow](= 흐름) 목록으로 낸다. 순수 함수(입력만으로 결정).
 *
 * 지키는 두 부등식:
 *  - **규칙 6(한도)** `Σ_부모 rate ≤ 자식 한 대의 산출` — 없는 걸 나른다고 주장하지 않는다.
 *    매 단계 `min` 이 보장하므로 구조적으로 불가능하다. **자투리를 버리지 않는다** — 있는
 *    만큼은 전부 나간다.
 *  - **규칙 5(채우기)** `Σ_자식 rate = 부모 한 대의 필요량` — 정확히 채운다. 넉넉함은 장부가
 *    아니라 **팔 수**가 산다(`ceil`).
 */
export function allocateFlows(input: AllocateMachineLinksInput): Flow[] {
  const { childProduction, parentDemand, item } = input;
  const links: Flow[] = [];
  if (!(childProduction > 0) || !(parentDemand > 0)) return links; // 미상 — 지어내지 않는다.

  // 각 머신의 남은 예산. 자식 = 아직 안 뺀 산출, 부모 = 아직 안 채운 필요량.
  const childLeft = Array.from({ length: Math.max(1, input.childCount) }, () => childProduction);
  const parentNeed = Array.from({ length: Math.max(1, input.parentCount) }, () => parentDemand);

  let ci = 0; // 자식 손가락 — 부모를 넘나들어도 유지된다(한 자식이 여러 부모를 먹인다).
  for (let pj = 0; pj < parentNeed.length; pj++) {
    while (parentNeed[pj] > EPS) {
      if (ci >= childLeft.length) return links; // 자식이 다 떨어짐(대수가 맞으면 안 옴).
      if (childLeft[ci] <= EPS) {
        ci++; // **다 비운** 자식만 넘긴다. 예전엔 "팔 한 개 몫이 안 되면" 넘겼다.
        continue;
      }
      const give = Math.min(parentNeed[pj], childLeft[ci]); // 규칙 5·6
      links.push({ fromMachine: ci, toMachine: pj, item, rate: give });
      childLeft[ci] -= give;
      parentNeed[pj] -= give;
    }
  }
  return links;
}
