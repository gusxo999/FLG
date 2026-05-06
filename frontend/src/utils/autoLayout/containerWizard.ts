/**
 * 오케스트레이터 — A↔B 사이클 + 완전 탐색.
 *
 * 단일 출처: docs/auto-layout-wizard.placement-search.md §7 / §8 / Q11 / Q20 / Q26 / Q28.
 *
 * 컨테이너 모델 v2 의 진입점. 새 위저드 입력 (`ContainerWizardInput`) 을
 * 받아 후보 트리 (`CandidateTree`) 를 생성한다.
 *
 * 알고리즘 흐름 (placement-search §7):
 *   1. 트리 펼침 + 머신 수 산정 (recipeTree.ts 의 기존 함수 재사용)
 *   2. 슬롯 수 계산 (모듈 3b)
 *   3. DFS 완전 탐색 — 자식 형제 순서 perm × 자식 위치 dir
 *      ├─ A: 머신 배치 (모듈 A)
 *      ├─ B: 그 머신의 모든 입력 라우팅 (모듈 4)
 *      ├─ §7.4 fallback (port 다른 셀 시도)
 *      └─ §7.5 종결 (성공 → 후보 / 실패 → 마킹 후 다음 perm·dir)
 *   4. 마지막에 외부 영역을 내부 영역에 통합 (사용자 드래그 직전)
 */

import type {
  CandidateTree,
  ContainerWizardInput,
  ContainerWizardResult,
  MachineNode,
  ProgressReporter,
  RunContainerWizard,
} from './containerModel';

/**
 * 새 위저드의 단일 진입점. 비동기 — 완전 탐색이 길어질 수 있으며
 * `signal` 으로 사용자 Esc 중단을 받는다.
 */
export const runContainerWizard: RunContainerWizard = async (
  _input: ContainerWizardInput,
  _hooks?: {
    onProgress?: ProgressReporter;
    signal?: AbortSignal;
  },
): Promise<ContainerWizardResult> => {
  // TODO(placement-search §7):
  //  1. recipeTree.expandRecipeTree(input.targetRecipe, ...) 로 트리 펼침.
  //  2. recipeTree.assignMinimumCounts / assignProportionalCounts 로 머신 수 산정.
  //  3. 머신별 ContainerCounts 산정 (모듈 3b: containerCounts.computeContainerCounts).
  //  4. DFS 완전 탐색:
  //      a. 루트 머신 배치 (machinePlacer.placeRootMachine).
  //      b. 루트의 외부 입력 라우팅 (모듈 B + 모듈 4).
  //      c. 자식 (= 트리의 비-external 자식 노드) 들에 대해:
  //          for perm in permutations(children):
  //            for dir in ['right', 'down']:
  //              for child c in perm:
  //                - placeMachine(parent, c, dir, internal)
  //                - 자식의 외부 입력 라우팅 + 부모와의 연결 라우팅
  //                - fallback: 라우팅 실패 시 다른 port 셀 시도
  //                  (portInference.enumerateContainerPorts 로 후보 enumerate)
  //                - 모든 fallback 실패 → FailureLeaf 마킹 후 다음 perm·dir
  //              - 모든 자식 성공 → 손자에 대해 재귀 (DFS).
  //  5. 외부 영역을 내부 영역에 통합 — 사용자 드래그 hook 호출 (UI 단의 별도 단계).
  //  6. 후보 트리 + 평탄화된 후보 배열 + 부분 결과 여부 반환.
  //
  //  중단 처리 (Q28 a):
  //   - signal.aborted 를 매 사이클마다 체크.
  //   - 중단되면 그때까지 생성된 후보를 *모두 유지* 하고 tree.aborted = true,
  //     partial = true 로 반환.
  //
  //  진행 콜백 (Q27 c):
  //   - onProgress 가 매 후보 1개 생성/실패할 때마다 호출되어 UI 가
  //     "12 블루프린트 생성됨, depth 3/5, 형제 2/6" 같은 상태를 표시.
  throw new Error('containerWizard.runContainerWizard: not implemented');
};

/**
 * 후보 트리에서 *평탄화된 성공 후보 배열* 만 추출 — UI 의 후보 갤러리 / O1
 * 점수 기반 정렬에 사용.
 */
export function flattenCandidates(_tree: CandidateTree): MachineNode[] {
  // TODO: 트리 BFS/DFS 로 leaf kind === 'candidate' 인 노드만 수집.
  //  O1 점수 (CandidateLeaf.squarenessPenalty) 오름차순 정렬 후 반환.
  throw new Error('containerWizard.flattenCandidates: not implemented');
}
