/**
 * machineLinkGroup — **이 클러스터의 벨트 한 줄**을 나타내는 자료 구조와 그 조립·판독.
 *
 * ## 왜 `module/` 인가 — 형제를 모른다
 * 여기 있는 것은 전부 **로컬 머신 index → 팔 수**만 안다. 상대 클러스터의 대수도, 좌표도,
 * 모양도 안 들어온다. 그래서 축 2 판정(*"module = 형제 모듈을 모른다"*)을 통과한다.
 *
 * **`id` 만 예외이고, 그 예외가 좁은 것이 요점이다.** `id` 는 간선의 양끝을 아는
 * `planner/modulePacking.linkGroupId` 가 만들어 얹는 **불투명 토큰**이고, 이 폴더와
 * `execution/` 은 그것을 **복사만 한다 — 파싱하는 코드가 0 이다.** 파싱하는 순간 모듈이
 * 형제를 알게 되므로, 그 0 을 유지하는 것이 모듈↔링크 분리의 실질이다.
 *
 * ## 상대는 안일 수도, 밖일 수도 있다 (2026-07-23 정의 확장)
 * 예전엔 "자식 머신 → 부모 머신"만 가리켰다. 그런데 **원료·완제품 줄(모듈 밖과 주고받는
 * 것)도 물리적으로 똑같은 일**이다 — 머신 면에 팔을 앉히고 벨트로 나른다. 다른 건 상대가
 * 안(부모·자식 머신)이냐 밖(무한상자)이냐 하나뿐이라 **같은 구조로 다룬다**:
 *
 * | | `from` | `to` |
 * |---|---|---|
 * | 내부 링크(자식→부모) | 자식 머신 | 부모 머신들 |
 * | 외부 입력(원료) | **빔** = 밖에서 온다 | 이 클러스터 머신들 |
 * | 외부 출력(완제품) | 이 클러스터 머신들 | **빔** = 밖으로 간다 |
 *
 * 그래서 좌석 예산·면 배정을 **한 장부**로 셀 수 있다.
 *
 * ## 형제를 아는 절반은 여기 없다
 * *"어느 기계 쌍을 몇 벨트로 잇나"* 는 두 클러스터의 대수를 봐야 정해지므로
 * [planner/link/allocateMachineLinks](../planner/link/allocateMachineLinks.ts) 소관이다.
 * 두 파일은 **서로를 import 하지 않는다** — 한 파일에 있던 시절엔 그 경계가 안 보여
 * `module/` 이 `planner/link/` 를 부르고 `planner/link/` 가 다시 `module/` 을 부르는
 * 왕복 간선이 있었다(2026-08-02 해소).
 */

import { requiredInserterCount, type IoLine, type SupplyCapacity } from "../planner/module/clusterPortPlanner";
import { inserterForReach, type SpecInserter } from "../buildSpec";

/**
 * **벨트 하나** — 이 클러스터의 머신들이 상대와 주고받는 물리 벨트 하나 = 포트 한 쌍.
 *
 * ## 왜 목적지마다 벨트를 따로 내나
 * **v1 은 링크 하나가 곧 그룹 하나다**(2026-07-22). 여러 목적지를 한 벨트에 묶으면 그 벨트가
 * 부모 머신 여럿을 **관통**해야 하고, 그러려면 그 머신들이 **붙어 있어야** 한다
 * ([[용어사전#ColumnCluster]]). 채널 트랙 하나를 아끼려고 클러스터 형태 전체를 저당 잡히는
 * 거래라 v1 에서는 안 한다.
 *
 * `from`/`to` 가 Map 인 이유: 병합을 되살리거나(여러 목적지) 외부 줄을 담을 때(전 머신)
 * 자료 구조를 다시 안 바꾸려는 것이다. 내부 링크 v1 에서는 양쪽 다 항목 하나씩이다.
 */
export interface MachineLinkGroup {
  /**
   * **지정 짝의 토큰 — 비어 있는 것이 뜻을 갖는다.**
   *
   * ```
   * 있다   이 포트는 형제 모듈의 **저** 포트와 이어져야 한다.  바꿔 끼우면 틀린다
   * 없다   같은 품목이면 **아무거나** 이어도 된다(교환 가능)
   * ```
   *
   * [pairDeliveryPorts] 가 이 유무로 갈린다 — 있으면 토큰 조회, 없으면 위치-zip. 그래서
   * *"식별자가 있으면 편하겠지"* 로 채우면 **알고리즘의 갈래가 조용히 바뀐다**(2026-08-17 실측:
   * 채운 줄이 납품 경로를 통째로 잃었다).
   *
   * **채우는 곳은 [linkGroupId] 하나뿐이다.** 지정이 존재하는 조건은 *"외부냐 내부냐"* 가 아니라
   * **"[allocateMachineLinks] 가 머신 단위로 배정했나"** 다 — 배정이 없으면 지킬 것도 없으므로
   * 교환 가능이고, 그때는 비워 두는 것이 **정답**이지 정보 부족이 아니다.
   *
   * 값 자체는 **불투명 토큰**이다. 간선의 양끝(자식·부모 노드 id)을 아는 호출자
   * (`planner/modulePacking`)가 채우고, 이 폴더는 **파싱하지 않는다**.
   */
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
 * `find…` 가 아니다 — 다른 링크를 **찾는** 건 [pairDeliveryPorts] 의 일이고, 이건 이 그룹 자신의
 * **속성**을 읽을 뿐이다.
 */
export function readLinkRole(group: MachineLinkGroup): "input" | "output" {
  return group.to.size > 0 ? "input" : "output";
}

/**
 * **외부 줄(원료·완제품)을 [MachineLinkGroup] 으로 낸다** — 2026-07-23 결정.
 *
 * ## 왜 같은 구조인가
 * 모듈 밖과 주고받는 줄도 물리적으로 링크와 **똑같은 일**이다: 머신 면에 팔을 앉히고
 * 벨트 한 줄로 나른다. 다른 건 상대가 안(부모·자식 머신)이냐 밖(무한상자)이냐 하나뿐이라,
 * [MachineLinkGroup] 의 빈 쪽으로 표현된다.
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
 * ## 묶은 그룹 ↔ 쪼갠 그룹 — **공급 방식이 곧 이 선택이다** (2026-08-05)
 *
 * 같은 줄을 두 모양으로 낼 수 있고, 그 둘이 정확히 두 공급 방식이다:
 *
 * | | 그룹 | 벨트 | 한 면에 몇 줄 | 포트 |
 * |---|---|---|---|---|
 * | **묶은 것**(기본) | 줄 하나 = 그룹 하나, 담당 = 전 머신 | 여러 머신이 **나눠 집는** 한 줄 | 팔 길이 종류 수 | 품목당 1 |
 * | **쪼갠 것**(`perMachine`) | 줄 하나 = 그룹 **n개**, 담당 = 머신 하나씩 | 머신마다 **자기 벨트** | 그 면의 둘레 칸 수 | 머신 × 품목 |
 *
 * 쪼개면 [tryLinkFace] 의 *"그룹 하나 = 머신 하나"* 문턱을 통과한다 — 그래서 **위/아래(gap)로
 * 넘기는 능력이 따라온다.** 기둥 축과 수직인 가로 벨트는 자기가 닿는 머신 한 대만 먹일 수
 * 있는데, 쪼갠 그룹은 애초에 한 대짜리라 그 제약에 걸릴 것이 없기 때문이다.
 *
 * @param linkedKeys 이미 내부 링크가 있는 줄의 키(`${role}:${name}`) — 두 번 세지 않는다.
 * @param opts.perMachine 머신마다 그룹 하나씩 낸다(기본 false = 전 머신 한 그룹).
 */
export function externalLineGroups(
  lines: ReadonlyArray<IoLine>,
  machineCount: number,
  cap: SupplyCapacity,
  /**
   * 고른 인서터들 — **여기 팔은 언제나 `reach 1`** 이지만(아래) 목록으로 받는다.
   * 처리량을 스칼라로 접으면 그 접힘이 다시 두 번째 출처가 된다(계획서 §18).
   */
  inserters: ReadonlyArray<SpecInserter>,
  linkedKeys?: ReadonlySet<string>,
  opts?: { perMachine?: boolean },
): MachineLinkGroup[] {
  const n = Math.max(1, machineCount);
  const groups: MachineLinkGroup[] = [];
  // **여기서 나는 그룹은 신원(`id`)을 안 단다 — 두 모양 다.**
  //
  // [MachineLinkGroup.id] 는 *"이 포트는 형제 모듈의 **저** 포트와 짝"* 이라는 **지정 짝**을
  // 뜻하고, 그 지정은 [allocateMachineLinks] 가 머신 단위로 배정했을 때만 존재한다. 원료·완제품
  // 줄은 그 배정을 안 거치므로 **교환 가능**이고, [pairDeliveryPorts] 는 그때 위치-zip 으로
  // 짝짓는다 — 신원이 있으면 조회 갈래로 빠져 짝을 못 찾고 불변식 위반으로 보고한다.
  //
  // 예전엔 묶은 그룹에만 `ext:${role}:${item}` 을 얹었다. 자식의 `ext:output:X` 와 부모의
  // `ext:input:X` 가 **절대 안 맞으므로** 그 줄은 납품 경로를 통째로 잃는다. 옛 탭 경로가
  // 이 줄들을 신원 없이 내보내 우연히 가려 주고 있었고, 아이템 방출이 한 경로로 합쳐지면서
  // (계획서 §19-④) 전부 발현했다(2026-08-17).
  for (const line of lines) {
    // 유체는 팔로 나르지 않는다 — 트렁크 파이프의 일이라 벨트 장부에 안 올린다.
    if (line.kind !== "belt") continue;
    const key = `${line.role}:${line.name}`;
    if (linkedKeys?.has(key)) continue;
    // **여기 팔은 언제나 `reach 1`** — 기계별 포트(다이렉트)의 인서터는 상자와 머신 **양쪽에
    // 인접**해야 하므로 상자가 `d2`, 팔이 `d1` 이다. 탭처럼 깊은 벨트를 집을 일이 없다
    // (계획서 §16). 그래서 이 호출만은 슬롯을 안 물어도 된다.
    const known = requiredInserterCount(line, n, cap, inserterForReach(inserters, 1));
    // **수량 미상이면 팔 1개** — 두 모양 모두. 이 경우의 관례는 이미 *"판정 보류 = 1"* 이다
    // ([PlannedLine.requiredInserterCount] 소비처가 전부 그렇게 읽는다). 지어낸 수가 아니라
    // **기존 관례를 그대로 따르는 것**이다.
    //
    // 예전엔 **묶은 그룹만** 안 만들었다 — *"벨트 한 줄에 실릴 부하를 모르는 채로 만들면 부하
    // 계산이 거짓말을 시작한다"* 는 이유였고, 그때는 안 만들어도 **옛 탭 경로가 그 줄을 맡았다.**
    // 그 경로가 사라진 지금(2026-08-16, 계획서 §19-④) 안 만들면 **그 줄이 통째로 사라진다** —
    // 거짓말보다 나쁘다. 부하 축은 `beltCapacity` 가 따로 거절하고, 그건 수량을 알 때만 켜진다.
    const arms = known ?? 1;
    if (opts?.perMachine) {
      for (let i = 0; i < n; i++) {
        groups.push(makeLink(line.name, line.role, new Map([[i, arms]])));
      }
      continue;
    }
    const mine = new Map<number, number>();
    for (let i = 0; i < n; i++) mine.set(i, arms);
    groups.push(makeLink(line.name, line.role, mine));
  }
  return groups;
}
