/**
 * 자동 배치 **실행 1회**의 수명 — 시작·진행·결과·오류를 담는다.
 *
 * ## 왜 store 인가 (컴포넌트 state 가 아니라)
 *
 * 결과가 [AutoLayoutContainerPanel](../components/AutoLayoutContainerPanel.tsx) 의 로컬
 * `useState` 였을 때, 패널은 `step === 'review'` 일 때만 렌더되는 조건부 컴포넌트라
 * **단계를 벗어나는 순간 결과가 사라졌다.** 그래서 6단계로 돌아올 때마다 처음부터
 * 다시 계산할 수밖에 없었고, 그 재계산이 "진입 = 자동 실행" 과 한 쌍으로 묶여 있었다.
 *
 * 실행을 store 로 올리면 셋이 동시에 풀린다:
 *  - 설정을 고치러 2단계에 갔다 와도 **직전 결과가 그대로** 있다.
 *  - 계산이 도는 중에 단계를 옮겨도 계산이 **안 죽는다**(끝나면 여기 들어온다).
 *  - "언제 도나" 를 사용자가 정한다 — 진입이 아니라 [run] 호출이 유일한 시작점이다.
 *
 * ## 무엇이 여기 없나
 *
 * **후보를 그리드에 적용하는 일**은 여기 없다(패널이 한다). 적용은 `layoutStore` 를
 * 크게 건드리고 좌표 덤프·토스트를 동반하는 *화면 동작*이라, 실행 결과를 보관하는
 * 이 store 의 관심사가 아니다.
 */

import { create } from 'zustand';
import { useLayoutStore } from './layoutStore';
import { runLayeredWizard } from '../../autoLayout/layeredWizard';
import type {
  CandidateLeaf,
  ContainerWizardInput,
  ContainerWizardResult,
} from '../../autoLayout/containerModel';
import {
  collectModules,
  overlayFromLayout,
  overlayFromSnapshot,
  type ModuleSource,
  type OverlayLine,
  type OverlayModule,
} from '../../autoLayout/moduleInspect';
import type { LayoutIssue, LayoutSnapshot } from '../../autoLayout/layoutIssue';

/**
 * 진행 스냅샷 — `ProgressReporter` 가 넘기는 것과 같은 모양.
 * (`containerModel` 의 콜백 인자 타입을 UI 가 이름으로 부를 수 있게 뽑아 둔 것.)
 */
export interface RunProgress {
  depth: number;
  siblingIndex: number;
  siblingTotal: number;
  candidatesGenerated: number;
  failuresGenerated: number;
  /** wizard 가 현재 실행 중인 phase / 함수 이름 (실시간) */
  currentFunction?: string;
  /** 누적 시도 횟수 */
  attempts?: number;
}

/**
 *  - `idle`    — 아직 안 돌렸다(또는 위저드 초기화됨). 6단계의 **정상 초기 상태**다.
 *  - `running` — 도는 중. 단계를 벗어나도 계속 돈다.
 *  - `done`    — 끝났다. `result.ok` 가 성공/실패를 가른다(오류와는 다르다).
 *  - `error`   — 예외로 죽었다. `result` 는 없다.
 */
export type RunStatus = 'idle' | 'running' | 'done' | 'error';

interface AutoLayoutRunState {
  status: RunStatus;
  result: ContainerWizardResult | null;
  error: string | null;
  progress: RunProgress | null;
  /**
   * 지금 담긴 결과를 **만들어 낸 입력의 서명**([signatureOf]).
   * 현재 위저드 설정의 서명과 다르면 화면이 "설정이 바뀌었다" 를 알린다 —
   * 결과가 살아남는 대신 **낡을 수 있게** 됐으므로 이 비교가 필요해졌다.
   */
  signature: string | null;
  /** 실행 시작 시각(ms). 경과 시간 표시용. 안 돌고 있으면 null. */
  startedAt: number | null;
  /**
   * 이 결과를 **그리드에 적용했나.**
   *
   * 후보 선택이 사라진 뒤 적용은 자동이지만, 적용하는 주체는 패널이고 패널은 6단계에서만
   * 산다. 실행 중에 단계를 옮기면 결과가 **패널 없이** 도착한다 — 그 결과를 6단계로 돌아온
   * 뒤에 적용해야 하고, 그때 "이미 적용했나" 를 컴포넌트 ref 로는 알 수 없다(리마운트로
   * 초기화된다). 그래서 결과와 같은 자리에 둔다.
   */
  applied: boolean;
  /**
   * **그리드에 올라간 배치 — 캔버스 오버레이의 단일 출처.**
   *
   * 모듈 테두리·이름표·포트 강조·연결선은 그리드 셀만으로는 못 그린다(어느 셀이 한
   * 모듈인지, 어느 라우팅이 어디를 잇는지가 셀에 안 적혀 있다). 예전엔 그 정보를
   * `layoutStore.routingEditSession` 이 날랐는데 그것을 **만드는 코드가 사라져** 오버레이가
   * 통째로 죽어 있었다 — 이제 여기가 그 자리다.
   *
   * `offset` 은 `unifyAreas` 가 낸 값(레이아웃 좌표 → 그리드 좌표). 적용할 때만 정해지므로
   * leaf 와 한 쌍으로 묶어 둔다.
   */
  appliedLayout: { leaf: CandidateLeaf; offset: { x: number; y: number } } | null;

  /**
   * **왜 안 됐나(또는 무엇이 아쉬운가).** 실패면 `error` 들, 성공이어도 `warning` 이 있을 수 있다
   * (반출 skip). 단일 출처는 `autoLayout/layoutIssue`.
   */
  issues: LayoutIssue[];
  /** 실패를 짚기 위한 그림 — 배치가 아니다. `pack` 까지 갔던 실패에만 있다. */
  snapshot: LayoutSnapshot | null;

  /** 실행 1회. 이미 돌고 있으면 아무것도 안 한다(중복 실행 방지). */
  run: (input: ContainerWizardInput, signature: string) => Promise<void>;
  /** 사용자 중단 요청. */
  cancel: () => void;
  /** 그리드 적용 완료 표시 — 같은 결과를 두 번 적용하지 않게. */
  markApplied: () => void;
  /** 오버레이가 그릴 배치 등록. `applyPlacedCells` **앞에서** 불러야 첫 렌더부터 반영된다. */
  setAppliedLayout: (v: { leaf: CandidateLeaf; offset: { x: number; y: number } }) => void;
  /** 결과 폐기 — 위저드 초기화와 함께 불린다. */
  clear: () => void;
}

/** [overlaySource] 메모 — 같은 배치면 **같은 객체**를 돌려준다(아래 주석). */
let overlayMemoKey: AutoLayoutRunState['appliedLayout'] = null;
let overlayMemoVal: ModuleSource | null = null;

/**
 * 캔버스 오버레이가 읽을 운반체. React 밖(pixi 렌더러)에서도 부르므로 훅이 아니다.
 * 배치가 없으면 `null` → `collectModules(null)` 이 빈 배열을 낸다.
 *
 * **같은 배치면 같은 객체를 돌려준다.** 이 함수는 렌더마다, 그리고 **마우스가 움직일
 * 때마다**(`moduleAtCell` 히트테스트) 불린다. 매번 새 배열을 만들면 하위 메모
 * ([collectModules])가 전부 무효화돼 큰 배치에서 마우스 이동이 무거워진다.
 */
export function overlaySource(): ModuleSource | null {
  const applied = useAutoLayoutRunStore.getState().appliedLayout;
  if (applied === overlayMemoKey) return overlayMemoVal;
  overlayMemoKey = applied;
  overlayMemoVal = applied
    ? {
        // 머신(모듈 유도)과 외부 상자/파이프(연결선 끝점·I/O 색)를 함께 넘긴다.
        containers: [...applied.leaf.internal.containers, ...applied.leaf.external.containers],
        routings: applied.leaf.routings,
        offset: applied.offset,
      }
    : null;
  return overlayMemoVal;
}

/**
 * **캔버스가 그릴 것 하나** — 성공이든 실패든 같은 모양이다.
 *
 * 성공: 적용된 배치에서 모듈을 유도하고 경고를 얹는다(선은 렌더러가 라우팅 경로를 따라
 * 직접 그린다 — 실제 셀을 알기 때문).
 * 실패: 스냅샷에서 같은 모양을 만든다(선은 양끝만 아는 직선).
 *
 * 실패 스냅샷은 **레이아웃 좌표**다. 그리드가 비어 있어 `unifyAreas` 의 offset 이 없으므로
 * bbox 좌상단이 (1,1) 에 오도록 옮긴다 — 성공 배치의 정규화와 같은 여백 규칙이다.
 */
export function overlayView(): { modules: OverlayModule[]; lines: OverlayLine[] } {
  const s = useAutoLayoutRunStore.getState();
  if (s.appliedLayout) {
    return { modules: overlayFromLayout(collectModules(overlaySource()), s.issues), lines: [] };
  }
  if (s.snapshot) {
    const off = { x: 1 - s.snapshot.bbox.x, y: 1 - s.snapshot.bbox.y };
    return overlayFromSnapshot(s.snapshot, s.issues, off);
  }
  return { modules: [], lines: [] };
}

/** 실행 중인 abort 컨트롤러. store 상태가 아니다(렌더와 무관). */
let activeController: AbortController | null = null;

/**
 * 위저드 입력의 **서명** — 같은 설정이면 같은 문자열.
 *
 * Set/객체는 순회 순서가 흔들리므로 전부 정렬한다. 정렬을 빼먹으면 설정을 바꾸지
 * 않았는데도 "낡음" 배지가 뜬다.
 */
export function signatureOf(input: ContainerWizardInput): string {
  const sorted = (v: ReadonlyArray<string> | ReadonlySet<string>): string[] => [...v].sort();
  const overrides = input.recipeOverrides ?? {};
  const ins = input.inserterOverrides ?? {};
  return JSON.stringify([
    input.targetRecipe,
    input.countMode,
    sorted(input.externalIngredients),
    Object.keys(overrides).sort().map((k) => [k, overrides[k]]),
    sorted(input.selectedMachines),
    sorted(input.selectedInserters),
    sorted(input.selectedBelts),
    sorted(input.selectedUndergroundPipes),
    sorted(input.selectedUndergroundBelts),
    // 값 객체의 키 순서(merge 로 흔들린다)에 안 걸리게 필드를 펴서 적는다.
    Object.keys(ins).sort().map((k) => [k, ins[k]?.throughput ?? null, ins[k]?.stackSize ?? null]),
  ]);
}

export const useAutoLayoutRunStore = create<AutoLayoutRunState>()((set, get) => ({
  status: 'idle',
  result: null,
  error: null,
  progress: null,
  signature: null,
  startedAt: null,
  applied: false,
  appliedLayout: null,
  issues: [],
  snapshot: null,

  run: async (input, signature) => {
    if (get().status === 'running') return;

    const ctrl = new AbortController();
    activeController = ctrl;
    // 오버레이 출처를 **그리드를 비우기 전에** 끊는다 — 순서가 뒤집히면 clearGrid 가
    // 부른 렌더가 빈 그리드 위에 옛 배치의 테두리·연결선을 그린다.
    set({
      status: 'running',
      result: null,
      error: null,
      progress: null,
      signature,
      startedAt: Date.now(),
      applied: false,
      appliedLayout: null,
      issues: [],
      snapshot: null,
    });

    // **기존 배치를 통째로 지우고 시작한다.**
    //
    // `applyPlacedCells` 는 덮어쓰기 *병합*이라, 지우지 않으면 새 배치가 안 덮는 자리에
    // 옛 셀이 남는다 — 두 실행의 조각이 섞인, 어느 쪽도 아닌 그림이 된다. 자동 적용이
    // 되면서 매 실행마다 그렇게 되므로 여기서 끊는다.
    //
    // 실패해도 그리드는 빈 채로 남는다. 그게 맞다 — 실패한 실행의 부분 배치는 **어느
    // 모듈이 막혔는지 알아내기 위한 것**이지 갖다 쓰라고 있는 게 아니다.
    // `clearGrid` 는 히스토리를 쌓으므로 되돌리기로 직전 배치를 복구할 수 있다.
    const layout = useLayoutStore.getState();
    layout.clearGrid();
    layout.setAutoLayoutRunning(true);

    try {
      const r = await runLayeredWizard(input, {
        signal: ctrl.signal,
        onProgress: (snap) => set({ progress: snap }),
      });
      set({ status: 'done', result: r, issues: r.issues ?? [], snapshot: r.snapshot ?? null });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (activeController === ctrl) activeController = null;
      // 패널이 언마운트된 채 끝나도 전역 "처리중" 표시는 반드시 꺼야 한다 —
      // 그래서 이 정리가 컴포넌트가 아니라 여기 있다.
      useLayoutStore.getState().setAutoLayoutRunning(false);
    }
  },

  cancel: () => {
    activeController?.abort();
  },

  markApplied: () => set({ applied: true }),

  setAppliedLayout: (v) => set({ appliedLayout: v }),

  clear: () => {
    activeController?.abort();
    activeController = null;
    set({
      status: 'idle', result: null, error: null, progress: null,
      signature: null, startedAt: null, applied: false, appliedLayout: null,
      issues: [], snapshot: null,
    });
  },
}));
