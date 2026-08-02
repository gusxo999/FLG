/**
 * allocateMachineLinks — 자식 머신들의 산출을 부모 머신들에게 나눠 주는 순수 함수.
 *
 * 단일 출처: docs/용어사전.md#allocateMachineLinks (사장님 명명·규칙 확정 2026-07-17).
 *
 * ## 무엇을 정하나
 * 자식 클러스터(같은 레시피 머신 N대)의 산출을 부모 클러스터(M대)에게 어떻게 흘려보낼지,
 * **[MachineLink] 목록**으로 낸다. MachineLink 하나 = **자식 머신 하나 → 부모 머신 하나로 가는,
 * 인서터 n개가 채우는 벨트 하나**. 포트 개수·gap 폭·짝짓기는 전부 이 목록에서 **유도된다** —
 * 반대가 아니다(옛 `pairHopPorts` 의 index-zip 을 대체할 예정).
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
 */

import { requiredInserterCount, type IoLine, type SupplyCapacity } from "../../module/clusterPortPlanner";

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

/**
 * **벨트 하나** — 이 클러스터의 머신들이 상대와 주고받는 물리 벨트 하나 = 포트 한 쌍.
 *
 * ## 상대는 안일 수도, 밖일 수도 있다 (2026-07-23 사장님 결정 — 정의 확장)
 * 예전엔 "자식 머신 → 부모 머신"만 가리켰다. 그런데 **원료·완제품 줄(모듈 밖과 주고받는
 * 것)도 물리적으로 똑같은 일**이다 — 머신 면에 팔을 앉히고 벨트로 나른다. 다른 건 상대가
 * 안(부모·자식 머신)이냐 밖(무한상자)이냐 하나뿐이라, **같은 구조로 다룬다**:
 *
 * | | `from` | `to` |
 * |---|---|---|
 * | 내부 링크(자식→부모) | 자식 머신 | 부모 머신들 |
 * | 외부 입력(원료) | **빔** = 밖에서 온다 | 이 클러스터 머신들 |
 * | 외부 출력(완제품) | 이 클러스터 머신들 | **빔** = 밖으로 간다 |
 *
 * 그래서 좌석 예산·면 배정을 **한 장부**로 셀 수 있다(예전엔 링크와 외부 줄이 각자 세고
 * `seatRowsUsed` 로 손수 조율했다).
 *
 * ## 왜 목적지마다 벨트를 따로 내나
 * **v1 은 링크 하나가 곧 그룹 하나다**(2026-07-22). 여러 목적지를 한 벨트에 묶으면 그 벨트가
 * 부모 머신 여럿을 **관통**해야 하고, 그러려면 그 머신들이 **붙어 있어야** 한다
 * ([[용어사전#ColumnCluster]]). 채널 트랙 하나를 아끼려고 클러스터 형태 전체를 저당 잡히는
 * 거래라 v1 에서는 안 한다.
 *
 * `from`/`to` 가 Map 인 이유: 병합을 되살리거나(여러 목적지) 외부 줄을 담을 때(전 머신)
 * 자료 구조를 다시 안 바꾸려는 것이다. 내부 링크 v1 에서는 양쪽 다 항목 하나씩이다.
 *
 * `id` 는 간선의 양끝(자식·부모 노드 id)을 아는 호출자([edgeLinkGroups])가 채운다.
 */
export interface MachineLinkGroup {
  /** 그룹 신원([linkGroupId]) — 이 벨트로 난 포트의 [ModulePort.linkId] 가 그대로 든다. */
  id?: string;
  /** 운반 품목. */
  item: string;
  /**
   * 이 벨트에 물건을 **내놓는** 머신 → 그 머신이 쓰는 팔 수.
   * **비어 있으면 물건이 모듈 밖에서 온다**(= 외부 입력 줄: 원료).
   */
  from: Map<number, number>;
  /**
   * 이 벨트에서 물건을 **받는** 머신 → 그 머신이 쓰는 팔 수.
   * **비어 있으면 물건이 모듈 밖으로 나간다**(= 외부 출력 줄: 완제품).
   */
  to: Map<number, number>;
}

/**
 * **밖과 주고받는 줄을 [MachineLinkGroup] 하나로 조립한다** — "빈 쪽 = 밖" 규약의 단일 출처.
 *
 * 이 규약이 예전엔 여러 곳(만드는 [externalLineGroups], 읽는 [emitTapInserting])에 흩어져
 * 있었다. 같은 규약을 두 곳이 각자 알면 한쪽만 바뀌어도 조용히 어긋난다 — 그래서 만들기
 * ([makeLink])와 읽기([readLinkRole])를 여기 한 쌍으로 모은다.
 *
 * `make…` 는 이 프로젝트의 **저수준 조립** 관습이다([makeBeltCell]·[makeLinkPortChest] 등) —
 * 그룹 하나를 조립할 뿐, [allocateMachineLinks]·[edgeMachineLinks] 같은 **유도**와 층이 다르다.
 *
 *  - **원료(input)**: 밖에서 온다 → `from` 이 비고, `to` 에 이 머신들.
 *  - **완제품(output)**: 밖으로 간다 → `to` 가 비고, `from` 에 이 머신들.
 */
export function makeLink(
  item: string,
  role: "input" | "output",
  arms: Map<number, number>,
): MachineLinkGroup {
  const empty = new Map<number, number>();
  return {
    item,
    from: role === "output" ? arms : empty,
    to: role === "output" ? empty : arms,
  };
}

/**
 * **밖과 주고받는 그룹의 방향을 읽는다** — [makeLink] 의 역([isInternalLink] 로 안↔안이 아님을
 * 이미 안 그룹에만 쓴다). 빈 쪽이 밖이므로, 머신이 든 쪽이 곧 역할이다:
 *  - `to` 에 머신 → **input**(밖에서 받는다 = 원료).
 *  - `from` 에 머신 → **output**(밖으로 낸다 = 완제품).
 *
 * `find…` 가 아니다 — 다른 링크를 **찾는** 건 [pairHopPorts] 의 일이고, 이건 이 그룹 자신의
 * **속성**을 읽을 뿐이다.
 */
export function readLinkRole(group: MachineLinkGroup): "input" | "output" {
  return group.to.size > 0 ? "input" : "output";
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

/**
 * **외부 줄(원료·완제품)을 [MachineLinkGroup] 으로 낸다** — 2026-07-23 사장님 결정.
 *
 * ## 왜 같은 구조인가
 * 모듈 밖과 주고받는 줄도 물리적으로 링크와 **똑같은 일**이다: 머신 면에 팔을 앉히고
 * 벨트 한 줄로 나른다. 다른 건 상대가 안(부모·자식 머신)이냐 밖(무한상자)이냐 하나뿐이라,
 * [MachineLinkGroup] 의 빈 쪽으로 표현된다:
 *
 *  - **원료(input)**: `from` 이 빔 = 밖에서 온다, `to` = 이 클러스터 머신들.
 *  - **완제품(output)**: `from` = 이 클러스터 머신들, `to` 가 빔 = 밖으로 간다.
 *
 * 그래서 "링크 있는 줄 / 없는 줄"이라는 갈래가 **자료 구조에서는 사라진다** — 남는 갈래는
 * 하나뿐이다: **수량을 아나 모르나**. 아는 줄은 여기서 그룹이 되고, 모르는 줄은 그룹이 안
 * 된다([edgeMachineLinks] 도 같은 문턱에서 `undefined` 를 낸다). 지어낸 숫자로 그룹을
 * 만들면 그 순간 벨트 부하 계산이 거짓말을 시작한다.
 *
 * ## 여기서 벨트를 쪼개지 않는다 (일부러)
 * 그룹 하나 = 벨트 하나지만, 이 함수는 **줄 하나당 그룹 하나**만 낸다. 수요가 벨트 한 줄을
 * 넘을 때 몇 줄로 늘릴지는 이미 [determineBeltCount] 와 [clusterPortPlanner] 의 배정 수가
 * 정하고 있다. 여기서 또 쪼개면 **같은 수를 두 곳이 각자 유도**하게 되고, 그게 이 세션에
 * 고친 버그들의 공통 원인이었다(tapCapacity 세 출처·배정 수 두 출처). 쪼개기를 여기로
 * 옮긴다면 저쪽에서 **빼면서** 옮겨야 한다.
 *
 * @param linkedKeys 이미 내부 링크가 있는 줄의 키(`${role}:${name}`) — 두 번 세지 않는다.
 */
export function externalLineGroups(
  lines: ReadonlyArray<IoLine>,
  machineCount: number,
  cap: SupplyCapacity,
  linkedKeys?: ReadonlySet<string>,
): MachineLinkGroup[] {
  const n = Math.max(1, machineCount);
  const groups: MachineLinkGroup[] = [];
  for (const line of lines) {
    // 유체는 팔로 나르지 않는다 — 트렁크 파이프의 일이라 벨트 장부에 안 올린다.
    if (line.kind !== "belt") continue;
    const key = `${line.role}:${line.name}`;
    if (linkedKeys?.has(key)) continue;
    const arms = requiredInserterCount(line, n, cap);
    if (arms === undefined) continue; // 수량 미상 — 그룹으로 안 만든다(옛 경로가 맡는다).
    const mine = new Map<number, number>();
    for (let i = 0; i < n; i++) mine.set(i, arms);
    // "빈 쪽 = 밖" 규약은 [makeLink] 한 곳에만 — 여기선 신원(id)만 얹는다.
    groups.push({ id: `ext:${key}`, ...makeLink(line.name, line.role, mine) });
  }
  return groups;
}
