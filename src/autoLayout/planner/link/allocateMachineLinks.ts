/**
 * allocateMachineLinks — 자식 머신들의 산출을 부모 머신들에게 나눠 주는 순수 함수.
 *
 * 단일 출처: docs/용어사전.md#allocateMachineLinks (사장님 명명·규칙 확정 2026-07-17).
 *
 * ## 무엇을 정하나
 * 자식 클러스터(같은 레시피 머신 N대)의 산출을 부모 클러스터(M대)에게 어떻게 흘려보낼지,
 * **[MachineLink] 목록**으로 낸다. MachineLink 하나 = **자식 머신 하나 → 부모 머신 하나로 가는,
 * 인서터 n개가 채우는 벨트 하나**. 포트 개수·gap 폭·짝짓기는 전부 이 목록에서 **유도된다** —
 * 반대가 아니다(옛 `pairDeliveryPorts` 의 index-zip 을 대체할 예정).
 *
 * ## 두 손가락이 각자 자기 줄을 훑는 물 붓기
 * 자식 손가락은 위에서 아래로 머신을 훑고, 부모 손가락도 위에서 아래로 훑는다. 지금 부모를
 * 채우다가 자식이 **인서터 한도**를 다 쓰면 다음 자식으로, 부모가 **필요량**을 다 채우면 다음
 * 부모로 넘어간다. 한 자식이 여러 부모를, 한 부모가 여러 자식을 만날 수 있다(자식≠부모 개수가
 * 정상 — 흐름이지 짝짓기가 아니다).
 *
 * ## 반올림 방향이 역할마다 반대다 (규칙 5 vs 6)
 *  - **부모 채우기 = 올림(ceil)**: 딱 안 맞으면 인서터를 하나 더 붙여 **넉넉하게**. 모자라면
 *    부모가 굶는다.
 *  - **자식 비우기 = 내림(floor)**: 남은 산출이 인서터 한 개 몫이 안 되면 **버린다**. 넘치게
 *    주면 없는 걸 나른다고 주장하게 되고, 그 순간 "부모가 안 굶는다"를 국소적으로 증명할 수
 *    없다(인서터들이 서로 경쟁하는데 누가 얼마 가져갈지는 우리가 못 정한다).
 *
 * 두 방향은 `min(그릇, 부모올림, 자식내림)` 한 줄에서 자동으로 절충된다.
 *
 * ## 여기 없는 것 — 한 클러스터만 아는 절반
 * [MachineLinkGroup]·`makeLink`·`readLinkRole`·`externalLineGroups` 는
 * [module/machineLinkGroup](../../module/machineLinkGroup.ts) 에 있다. 그것들은 **로컬 머신
 * index + 팔 수**만 알아 형제를 모르므로 `link` 가 아니라 `module` 관심사다.
 *
 * **이 파일은 아무것도 import 하지 않는다.** 두 절반이 한 파일에 있던 시절엔 경계가 안 보여
 * `module/` 이 `planner/link/` 를 부르고 `planner/link/` 가 다시 `module/` 을 부르는 왕복
 * 간선이 있었다(2026-08-02 해소). 이 파일이 순수한 산술로 남아 있는 한 그 간선은 안 돌아온다.
 */

/** 자식 머신 하나 → 부모 머신 하나로 가는, 인서터 n개가 채우는 벨트 하나. */
export interface MachineLink {
  /** 자식 머신 인덱스(배치 순서 = 위에서 아래로). */
  fromMachine: number;
  /** 부모 머신 인덱스(배치 순서). */
  toMachine: number;
  /** 운반 품목. */
  item: string;
  /**
   * 이 벨트에 붙는 인서터 개수. **실제 운반량은 안 들고 다닌다** —
   * `inserterCount × 인서터 처리량` 으로 언제든 유도된다.
   */
  inserterCount: number;
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
  /** 인서터 하나의 초당 처리량(items/sec). */
  inserterThroughput: number;
  /** 벨트 하나의 초당 최대 운반량(items/sec). 벨트당 인서터 수의 상한을 정한다. */
  beltThroughput: number;
}

// 부동소수 비교 여유. 부모 필요량이 60.5 같은 분수라 정수 나눗셈 경계에서 흔들린다.
const EPS = 1e-9;

/**
 * 그릇(규칙 3) — 벨트 하나에 붙일 수 있는 인서터 수. [allocateMachineLinks] 가 링크를
 * 쪼갤 때 쓴다.
 *
 * **상한이지 명령이 아니다.** "이 이상 실으면 벨트가 넘친다"까지만 말한다 — "여유가 있으면
 * 합쳐라"는 여기서 안 나온다(그건 대가가 따로 있는 정책이다).
 */
export function maxInsertersPerBelt(beltThroughput: number, inserterThroughput: number): number {
  return Math.max(1, Math.floor(beltThroughput / inserterThroughput + EPS));
}

/**
 * 자식 산출을 부모에게 나눠 [MachineLink] 목록으로 낸다. 순수 함수(입력만으로 결정).
 *
 * 자식·부모 손가락이 각자 위에서 아래로 훑으며 규칙 5(부모 올림)·6(자식 내림)으로 벨트를
 * 하나씩 놓는다. 자식이 인서터 한도(= `floor(산출 ÷ 인서터)`)를 다 쓰면 그 머신은 잔량을
 * 버리고 다음 자식으로 넘어간다 → 꼬리 하나만 빼고 모든 자식이 같은 실효 산출에서 멈춘다.
 */
export function allocateMachineLinks(input: AllocateMachineLinksInput): MachineLink[] {
  const { childProduction, parentDemand, item, inserterThroughput: tp, beltThroughput } = input;
  const links: MachineLink[] = [];
  if (tp <= 0) return links; // 인서터 처리량 미상 — 지어내지 않는다.

  // 그릇(규칙 3) — 벨트 한 줄이 실어 나를 수 있는 양.
  const maxPerBelt = maxInsertersPerBelt(beltThroughput, tp);

  // 각 머신의 남은 예산. 자식 = 아직 안 뺀 산출, 부모 = 아직 안 채운 필요량.
  const childLeft = Array.from({ length: Math.max(1, input.childCount) }, () => childProduction);
  const parentNeed = Array.from({ length: Math.max(1, input.parentCount) }, () => parentDemand);

  let ci = 0; // 자식 손가락 — 부모를 넘나들어도 유지된다(한 자식이 여러 부모를 먹인다).
  for (let pj = 0; pj < parentNeed.length; pj++) {
    while (parentNeed[pj] > EPS) {
      if (ci >= childLeft.length) return links; // 자식이 다 떨어짐(대수가 맞으면 안 옴).
      // 자식 비우기(내림): 남은 산출로 채울 수 있는 인서터 수. 인서터 한 개 몫이 안 되면 0.
      const canFloor = Math.floor(childLeft[ci] / tp + EPS);
      if (canFloor <= 0) {
        ci++; // 자투리(<1개 몫)는 버린다 — 이 자식은 여기서 멈춘다(규칙 6).
        continue;
      }
      // 부모 채우기(올림): 남은 필요량을 넉넉하게 덮는 인서터 수(규칙 5).
      const needCeil = Math.ceil(parentNeed[pj] / tp - EPS);
      const insPerBelt = Math.min(maxPerBelt, needCeil, canFloor);
      const supply = insPerBelt * tp;
      links.push({ fromMachine: ci, toMachine: pj, item, inserterCount: insPerBelt });
      childLeft[ci] -= supply;
      parentNeed[pj] -= supply;
    }
  }
  return links;
}
