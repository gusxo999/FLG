/**
 * 자동 레이아웃 위저드 — 컨테이너 모델 (새 모델) 패널.
 *
 * 부모 모달 ([AutoLayoutModal.tsx]) 의 review 단계에 하단 박스로 노출된다.
 *
 * ## 계산은 **버튼으로만** 시작한다 (2026-08-04)
 *
 * 예전엔 이 패널의 마운트 이펙트가 `handleRun()` 을 불렀다. 패널은 `step === 'review'`
 * 일 때만 렌더되므로 **6단계에 도달하는 모든 경로가 곧 계산 시작**이었다 — "다음" 버튼,
 * 스테퍼의 "6." 칩 직접 클릭(1~5단계를 건너뛰어도), 그리고 `wizardStore` 가 `step` 을
 * persist 하므로 **마지막이 6단계였으면 앱을 켜자마자**. 게다가 결과가 로컬 state 라
 * 단계를 벗어나면 사라져 6단계로 돌아올 때마다 재계산됐다.
 *
 * 지금은 시작점이 하나다 — 사용자가 누르는 "레이아웃 생성". 결과·진행은
 * [autoLayoutRunStore](../store/autoLayoutRunStore.ts) 가 들고 있어 단계를 옮겨도
 * 살아남고, 설정이 바뀌면 "낡음" 을 알린다.
 *
 * **후보 적용 시 동작:**
 *  - 그리드에 셀이 적용되고 비-InfinityChest/Pipe 셀의 bbox 가 layoutStore 의
 *    externalAreaBbox 로 저장된다.
 *  - pixi-manager 가 이 bbox 주변 1칸 링을 "외부 영역"으로 표시하며,
 *    해당 영역의 InfinityChest/InfinityPipe 를 드래그할 수 있다.
 *  - 후보 적용 시 위저드 설정이 초기화되지 않는다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import { useToastStore } from '../store/toastStore';
import { useGameDataStore } from '../store/gameDataStore';
import { useWizardStore } from '../store/wizardStore';
import { useAutoLayoutRunStore, signatureOf } from '../store/autoLayoutRunStore';
import {
  unifyAreas,
} from '../../autoLayout/areaUnification';
import { AUTO_LAYOUT_COORD_DUMP } from '../../autoLayout/debugFlags';
import { registerAutoLayoutDebug } from '../../debug/debugApi';
import type {
  CandidateLeaf,
  ContainerWizardInput,
  ContainerWizardResult,
} from '../../autoLayout/containerModel';
import type { RunProgress } from '../store/autoLayoutRunStore';
import type { IssueScope, LayoutIssue } from '../../autoLayout/layoutIssue';
import { useModuleInspectStore } from '../store/moduleInspectStore';

interface AutoLayoutContainerPanelProps {
  targetRecipe: string;
  /** 'min' = 노드마다 1대 / 'manual' = perTarget 개/초 처리량 기준 비례 배정 */
  countMode: 'min' | 'manual';
  /** 'manual' 모드에서 루트가 산출할 목표 처리량 (items/sec) */
  perTarget: number;
  externalIngredients: ReadonlySet<string>;
  recipeOverrides: Readonly<Record<string, string>>;
  selectedMachines: ReadonlySet<string>;
  selectedInserters: ReadonlySet<string>;
  selectedBelts: ReadonlySet<string>;
  selectedUndergroundPipes: ReadonlySet<string>;
  selectedUndergroundBelts: ReadonlySet<string>;
  onClose: () => void;
}

export default function AutoLayoutContainerPanel(props: AutoLayoutContainerPanelProps) {
  const applyPlacedCells = useLayoutStore((s) => s.applyPlacedCells);
  const resetViewport = useLayoutStore((s) => s.resetViewport);
  const showToast = useToastStore((s) => s.show);
  const loaded = useGameDataStore((s) => s.loaded);
  // 사용자 인서터 처리량/묶음 보정 — 위저드 입력에 실어 라우팅·병합 용량 계산에 반영.
  const inserterOverrides = useWizardStore((s) => s.inserterOverrides);

  // 실행 1회의 수명은 store 소유 — 단계를 벗어나도 결과·진행이 살아남는다.
  const status = useAutoLayoutRunStore((s) => s.status);
  const result = useAutoLayoutRunStore((s) => s.result);
  const progress = useAutoLayoutRunStore((s) => s.progress);
  const error = useAutoLayoutRunStore((s) => s.error);
  const resultSignature = useAutoLayoutRunStore((s) => s.signature);
  const startedAt = useAutoLayoutRunStore((s) => s.startedAt);
  const applied = useAutoLayoutRunStore((s) => s.applied);
  const running = status === 'running';

  // 현재 위저드 설정으로 만들 입력 — 실행 인자이자 "낡음" 판정의 기준.
  const input: ContainerWizardInput = useMemo(
    () => ({
      targetRecipe: props.targetRecipe,
      countMode: props.countMode === 'manual' ? { perTarget: props.perTarget } : 'min',
      externalIngredients: props.externalIngredients,
      recipeOverrides: props.recipeOverrides,
      selectedMachines: Array.from(props.selectedMachines),
      selectedInserters: Array.from(props.selectedInserters),
      selectedBelts: Array.from(props.selectedBelts),
      selectedUndergroundPipes: Array.from(props.selectedUndergroundPipes),
      selectedUndergroundBelts: Array.from(props.selectedUndergroundBelts),
      inserterOverrides,
      externalPortsDefault: 'top-left',
    }),
    [
      props.targetRecipe, props.countMode, props.perTarget, props.externalIngredients,
      props.recipeOverrides, props.selectedMachines, props.selectedInserters,
      props.selectedBelts, props.selectedUndergroundPipes, props.selectedUndergroundBelts,
      inserterOverrides,
    ],
  );
  const signature = useMemo(() => signatureOf(input), [input]);
  // 돌린 적은 있는데 그 뒤로 설정이 바뀌었다 — 화면의 결과/오류가 지금 설정의 것이 아니다.
  const stale =
    !running && resultSignature !== null && resultSignature !== signature && (result !== null || error !== null);

  /**
   * 돌릴 수 있나 — **`loaded` 를 함께 본다.**
   *
   * 위저드 선택은 persist 되지만 게임데이터는 지워질 수 있다. 그러면 레시피·머신 이름만
   * 남고 `recipeMap` 이 비어, 버튼이 눌리고는 "타깃 레시피를 찾을 수 없습니다" 로 끝난다.
   * 시작점이 하나가 된 이상 그 하나가 **불가능한 실행을 걸러야** 한다.
   */
  const canRun = loaded && !!props.targetRecipe && props.selectedMachines.size > 0;

  // "오래 걸림" 안내 — 생성이 10초를 넘기면 모달로 현재 단계를 보여주고 계속할지 묻는다.
  const SLOW_THRESHOLD_MS = 10_000;
  const [slowPrompt, setSlowPrompt] = useState(false);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 다음 10초 경과 시 다시 묻도록 타이머를 (재)무장한다.
  function armSlowTimer() {
    if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
    slowTimerRef.current = setTimeout(() => {
      if (useAutoLayoutRunStore.getState().status === 'running') setSlowPrompt(true);
    }, SLOW_THRESHOLD_MS);
  }

  // 타이머는 **실행 상태를 따라간다** — 실행 중 단계를 옮겼다가 돌아와도(리마운트)
  // 다시 무장된다. 실행이 패널보다 오래 살아서 생긴 요구다.
  useEffect(() => {
    if (!running) {
      if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
      slowTimerRef.current = null;
      setSlowPrompt(false);
      return;
    }
    armSlowTimer();
    return () => {
      if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
      slowTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // 콘솔 디버그 API(flg.apply())에 현재 결과 + 적용 핸들러 등록.
  // 결과는 store 에서 그때그때 읽는다 — 등록을 결과에 맞춰 갱신할 필요가 없다.
  useEffect(() => {
    registerAutoLayoutDebug({
      getLayout: () => useAutoLayoutRunStore.getState().result?.tree.candidates[0] ?? null,
      applyLayout: handleApplyCandidate,
    });
    return () => registerAutoLayoutDebug(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * **결과가 나오면 그리드에 자동 적용한다.**
   *
   * 예전엔 후보 목록에서 사용자가 하나를 골라 클릭해야 적용됐다. 그런데 후보는 언제나
   * 한 개였으므로(`runLayeredWizard` 는 leaf 하나를 감싼다) 그 클릭은 선택이 아니라
   * **한 줄짜리 목록을 눌러 확인하는 절차**였고, 누르기 전까지 "생성했는데 화면은 그대로"
   * 인 상태가 정상으로 존재했다. 골라야 할 게 없으니 물어볼 것도 없다.
   *
   * 적용 여부를 store 가 들고 있는 이유는 [applied] 주석에 있다 — 실행 중 단계를 옮기면
   * 결과가 패널 없이 도착하고, 6단계로 돌아온 이 이펙트가 그때 적용한다.
   */
  useEffect(() => {
    if (status !== 'done' || applied) return;
    const leaf = result?.tree.candidates[0];
    if (!leaf) {
      // **실패 — 그리드는 비어 있다.** 진단 오버레이(모듈 사각형·납품 경로 선)만 뜨는데,
      // 맞출 배치가 없어 뷰포트가 엉뚱한 곳을 보고 있으면 아무것도 안 보인다.
      // 스냅샷 bbox 를 캔버스 경계로 알려 주고 기존 `resetViewport` 경로를 그대로 쓴다.
      const snap = useAutoLayoutRunStore.getState().snapshot;
      if (snap) {
        // overlayView 가 bbox 좌상단을 (1,1) 로 옮기므로 캔버스 경계도 같은 규칙으로.
        useLayoutStore.getState().setAutoLayoutCanvasBbox({
          x: 1, y: 1, w: snap.bbox.w, h: snap.bbox.h,
        });
        resetViewport();
      }
      // 실패 결과도 "처리했다" 로 표시한다 — 안 그러면 매 렌더마다 여기로 되돌아온다.
      useAutoLayoutRunStore.getState().markApplied();
      return;
    }
    handleApplyCandidate(leaf);
    useAutoLayoutRunStore.getState().markApplied();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, applied, result]);

  /**
   * 실행 — **유일한 시작점**이다. 마운트도, 단계 이동도 여기를 부르지 않는다.
   *
   * 배치 전략은 하나뿐이다 — 모듈 파이프라인(트리 전개 → generateModule → 채널 기하
   * 예약). 옛 S-LAYER 는 삭제됐다(2026-07-25).
   */
  function handleRun() {
    if (!canRun) return;
    void useAutoLayoutRunStore.getState().run(input, signature);
  }

  function handleAbort() {
    useAutoLayoutRunStore.getState().cancel();
    // 중단을 누르면 "오래 걸림" 질문을 더는 띄우지 않는다(기존 동작 유지). 계산 자체는
    // 파이프라인이 동기라 signal 을 안 보고 끝까지 돈다 — 이 버튼은 결과를 버리겠다는
    // 표시이지 계산을 멈추는 스위치가 아니다.
    if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
    slowTimerRef.current = null;
    setSlowPrompt(false);
  }

  // "오래 걸림" 모달 — 계속: 모달 닫고 다음 10초 후 다시 질문 / 중단: abort.
  function handleSlowContinue() {
    setSlowPrompt(false);
    armSlowTimer();
  }
  function handleSlowAbort() {
    handleAbort();
  }

  function applyLayoutBboxes(
    internalBbox: { x: number; y: number; w: number; h: number } | undefined,
    canvasBbox: { x: number; y: number; w: number; h: number } | undefined,
  ) {
    const store = useLayoutStore.getState();
    store.setExternalAreaBbox(internalBbox ?? null);
    store.setAutoLayoutCanvasBbox(canvasBbox ?? null);
  }

  function handleApplyCandidate(leaf: CandidateLeaf) {
    const { placed, internalBbox, canvasBbox, offset } = unifyAreas(leaf.internal, leaf.external);

    if (AUTO_LAYOUT_COORD_DUMP) {
      // 레이아웃 좌표를 dump 하기 전에 그 레이아웃이 생성된 *런타임 환경* 을 먼저 출력한다.
      // (AI 가 배치 결과만이 아니라 "어떤 레시피·머신·벨트 제약 하에서 생성됐는지" 를
      //  근거로 레이아웃의 문제를 스스로 검증할 수 있도록.)
      const gd = useGameDataStore.getState();
      // entity 이름 → 검증에 필요한 핵심 스펙만 추림. JSON.stringify 가 undefined 키를
      // 자동으로 누락하므로, 타입별로 의미 없는 필드(예: 벨트의 crafting_speed)는 표시되지 않는다.
      const entitySpec = (name: string) => {
        const e = gd.entityMap.get(name);
        if (!e) return { name, missing: true };
        return {
          name,
          type: e.type,
          tile: { w: e.tile_width, h: e.tile_height },
          crafting_speed: e.crafting_speed,
          crafting_categories: e.crafting_categories,
          module_slots: e.module_slots,
          belt_speed: e.belt_speed,
          max_underground_distance: e.max_underground_distance,
        };
      };
      // 이 레이아웃에 실제로 등장하는 레시피 집합 (컨테이너 recipeName 기준, 등장 순서 유지).
      const recipeNames: string[] = [];
      for (const c of leaf.internal.containers) {
        if (c.recipeName && !recipeNames.includes(c.recipeName)) recipeNames.push(c.recipeName);
      }
      console.log('[autoLayout debug] 환경 정보 (런타임 입력 — 레이아웃 검증용)\n' + JSON.stringify({
        target: {
          recipe: props.targetRecipe,
          countMode: props.countMode,
          perTarget: props.countMode === 'manual' ? props.perTarget : undefined,
        },
        externalIngredients: Array.from(props.externalIngredients),
        recipeOverrides: props.recipeOverrides,
        selectedMachines: Array.from(props.selectedMachines).map(entitySpec),
        selectedBelts: Array.from(props.selectedBelts).map(entitySpec),
        selectedUndergroundBelts: Array.from(props.selectedUndergroundBelts).map(entitySpec),
        selectedInserters: Array.from(props.selectedInserters).map(entitySpec),
        selectedUndergroundPipes: Array.from(props.selectedUndergroundPipes).map(entitySpec),
        recipesInLayout: recipeNames.map((name) => {
          const r = gd.recipeMap.get(name);
          if (!r) return { name, missing: true };
          return {
            name: r.name,
            category: r.category,
            energy_required: r.energy_required,
            ingredients: r.ingredients.map((i) => ({ name: i.name, amount: i.amount, type: i.type })),
            products: r.products.map((p) => ({
              name: p.name, amount: p.amount, type: p.type, probability: p.probability,
            })),
          };
        }),
      }, null, 2)
        // 위저드가 이 후보를 **만드는 동안** 찍은 진단(6번 버튼 시점에 흩어져 나오던 것)을
        // 환경 정보 로그 뒤에 붙여 **후보 클릭 한 시점**에 함께 낸다.
        + (leaf.moduleDiagnostics?.length
          ? '\n\n─── 위저드 진단 (후보 생성 시점) ───\n' + leaf.moduleDiagnostics.join('\n')
          : ''));

      console.log('[autoLayout debug] handleApplyCandidate\n' + JSON.stringify({
        'internal.containers': leaf.internal.containers.map((c) => ({
          id: c.id, kind: c.kind, entityName: c.entityName,
          origin: { ...c.origin }, size: { ...c.size },
        })),
        'external.containers': leaf.external.containers.map((c) => ({
          id: c.id, kind: c.kind, entityName: c.entityName,
          origin: { ...c.origin }, size: { ...c.size },
        })),
        'internal.placed': leaf.internal.placed.map((p) => ({
          x: p.x, y: p.y,
          entityId: p.cell.entityId, entityType: p.cell.entityType, isOrigin: p.cell.isOrigin,
        })),
        'external.placed': leaf.external.placed.map((p) => ({
          x: p.x, y: p.y,
          entityId: p.cell.entityId, entityType: p.cell.entityType,
        })),
        'routings': leaf.routings.map((r) => ({
          id: r.id, kind: r.kind,
          from: { containerId: r.from.containerId, cell: r.from.cell, kind: r.from.kind },
          to: { containerId: r.to.containerId, cell: r.to.cell, kind: r.to.kind },
          placed: r.placed.map((p) => ({
            x: p.x, y: p.y,
            entityId: p.cell.entityId, entityType: p.cell.entityType, direction: p.cell.direction,
          })),
        })),
        'unifyAreas': { internalBbox, canvasBbox },
        'placed.normalized': placed.map((p) => ({
          x: p.x, y: p.y,
          entityId: p.cell.entityId, entityType: p.cell.entityType,
        })),
      }, null, 2));
    }

    const cells = placed.map((p) => ({ x: p.x, y: p.y, cell: p.cell }));
    if (cells.length === 0) {
      showToast('빈 후보 — 적용할 셀 없음', 'warning');
      return;
    }
    // 오버레이(모듈 테두리·이름표·연결선)의 출처 등록 — **applyPlacedCells 앞에서.**
    // 그리드 변경이 렌더를 트리거하므로, 뒤에 두면 첫 프레임에 오버레이가 빠진다.
    useAutoLayoutRunStore.getState().setAppliedLayout({ leaf, offset });
    applyPlacedCells(cells);
    applyLayoutBboxes(internalBbox, canvasBbox);
    // 수동 편집(드래그 재라우팅) 비활성 — 세션을 만들지 않는다.
    // 코드는 autoLayout/manualEdit/ 에 격리돼 있고 호출자가 0 이다.
    // 세션이 항상 null 이라 드래그는 "이동만" 되고 벨트가 따라오지 않는다.
    // 재구현 계획: manualEdit/README.md
    useLayoutStore.getState().setRoutingEditMode(false);
    resetViewport();
    showToast(`컨테이너 모델 후보 적용됨 (${cells.length} 셀)`, 'success');
    // 위저드 설정 초기화하지 않음 — 사용자가 계속 설정을 유지할 수 있도록
  }

  return (
    <div className="mt-4 border-t border-purple-900/50 pt-3 space-y-2">
      {!loaded ? (
        <div className="text-[11px] text-amber-300 bg-amber-900/20 border border-amber-700/50 rounded px-2 py-1">
          게임데이터가 없습니다 — 먼저 게임데이터를 불러와주세요.
        </div>
      ) : props.selectedMachines.size === 0 && (
        <div className="text-[11px] text-amber-300 bg-amber-900/20 border border-amber-700/50 rounded px-2 py-1">
          머신이 선택되지 않았습니다 — 이전 단계로 돌아가 머신을 선택해주세요.
        </div>
      )}

      <div className="flex items-center gap-2">
        {running ? (
          <button
            onClick={handleAbort}
            title="결과를 버립니다 — 계산 자체는 끝까지 돕니다"
            className="bg-red-700 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0"
          >
            중단
          </button>
        ) : (
          <button
            onClick={handleRun}
            disabled={!canRun}
            title={
              canRun ? undefined
                : !loaded ? '게임데이터를 먼저 불러와주세요'
                : '레시피와 머신을 먼저 선택해주세요'
            }
            className="bg-purple-700 hover:bg-purple-600 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0 transition-colors"
          >
            {result || error ? '다시 생성' : '레이아웃 생성'}
          </button>
        )}
        {progress && (
          <div className="text-[11px] text-gray-400 font-mono space-y-0.5 min-w-0 flex-1">
            <div>
              depth {progress.depth} · 형제 {progress.siblingIndex}/{progress.siblingTotal}
              {progress.attempts !== undefined && (
                <>
                  {' · '}
                  <span className="text-cyan-300">시도 {progress.attempts}</span>
                </>
              )}
              {' · '}
              <span className="text-green-300">{progress.candidatesGenerated} 후보</span>
              {' / '}
              <span className="text-amber-300">{progress.failuresGenerated} 실패</span>
            </div>
            {progress.currentFunction && (
              <div className="text-purple-300 truncate" title={progress.currentFunction}>
                ▶ {progress.currentFunction}
              </div>
            )}
          </div>
        )}
      </div>

      {status === 'idle' && canRun && (
        <div className="text-[11px] text-gray-400 bg-gray-800/40 border border-gray-700 rounded px-2 py-1">
          아직 생성하지 않았습니다 — "레이아웃 생성"을 눌러 시작하세요.
        </div>
      )}

      {stale && (
        <div className="text-[11px] text-amber-300 bg-amber-900/20 border border-amber-700/50 rounded px-2 py-1">
          설정이 바뀌었습니다 — 아래 결과는 이전 설정의 것입니다. "다시 생성"을 눌러주세요.
        </div>
      )}

      {error && (
        <div className="text-xs text-red-300 bg-red-900/20 border border-red-800 rounded px-2 py-1">
          오류: {error}
        </div>
      )}

      {result && <ResultPanel result={result} />}

      {slowPrompt && running && (
        <SlowRunModal
          progress={progress}
          elapsedSec={Math.round((Date.now() - (startedAt ?? Date.now())) / 1000)}
          onContinue={handleSlowContinue}
          onAbort={handleSlowAbort}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// "오래 걸림" 모달 — 생성이 10초를 넘기면 현재 시도 중인 phase/라우팅 정보를 보여주고
// 계속 진행할지 묻는다. (생성 자체는 협조적 양보로 백그라운드에서 계속 진행 중.)
// ─────────────────────────────────────────────────────────────────────────────

function SlowRunModal({
  progress,
  elapsedSec,
  onContinue,
  onAbort,
}: {
  progress: RunProgress | null;
  elapsedSec: number;
  onContinue: () => void;
  onAbort: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-amber-700/60 bg-gray-900 shadow-2xl">
        <div className="border-b border-amber-800/50 px-4 py-3">
          <h3 className="text-sm font-semibold text-amber-300">
            자동 생성이 오래 걸리고 있습니다
          </h3>
          <p className="mt-0.5 text-[11px] text-gray-400">
            {elapsedSec}초 경과 — 복잡한 레시피·라우팅이면 정상일 수 있습니다.
          </p>
        </div>

        <div className="space-y-1.5 px-4 py-3 text-[11px] font-mono text-gray-300">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">현재 진행 상황</div>
          {progress?.currentFunction ? (
            <div className="text-purple-300 break-all">▶ {progress.currentFunction}</div>
          ) : (
            <div className="text-gray-500">초기화 중…</div>
          )}
          {progress && (
            <div className="text-gray-400">
              {progress.attempts !== undefined && (
                <>
                  <span className="text-cyan-300">단계 {progress.attempts}</span>
                  {' · '}
                </>
              )}
              <span className="text-green-300">{progress.candidatesGenerated} 후보</span>
              {' / '}
              <span className="text-amber-300">{progress.failuresGenerated} 실패</span>
              {' · '}depth {progress.depth}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-800 px-4 py-3">
          <button
            onClick={onAbort}
            className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
          >
            중단
          </button>
          <button
            onClick={onContinue}
            className="rounded-lg bg-purple-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-600"
          >
            계속 진행
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 결과 패널 — **배치 하나**의 요약
//
// ## 후보 선택은 없앴다 (2026-08-04)
//
// 여기엔 후보 리스트(클릭 시 적용 / hover 미리보기)와 탐색 트리 로그(노드 클릭 시 그
// 시점 적용)가 있었다. 둘 다 **여러 후보를 견주어 고르던 시절의 UI** 인데, 지금
// `runLayeredWizard` 는 후보를 **언제나 한 개**(성공) 또는 **0 개**(실패) 만 낸다 —
// `stats.candidatesGenerated` 는 상수 1 이고 트리는 root + leaf 두 줄이다.
//
// 그래서 리스트는 늘 한 줄, 트리 로그는 늘 두 줄이었고, 노드 클릭은 후보가 아닌 노드에서
// **항상 빈 배열**을 돌려줘 "이 시점에는 배치된 셀이 없습니다" 토스트만 띄웠다. 고를 것이
// 없는 선택지를 화면에 두면 사용자는 "다른 후보가 있는데 내가 못 찾는 건가" 를 의심한다.
//
// 배치는 결과가 나오는 즉시 그리드에 적용된다(패널의 자동 적용 이펙트).
// ─────────────────────────────────────────────────────────────────────────────

function ResultPanel({ result }: { result: ContainerWizardResult }) {
  const tree = result.tree;
  const leaf = tree.candidates[0];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px]">
        <span className={result.ok ? 'text-green-300' : 'text-yellow-300'}>
          {result.ok ? '성공 — 그리드에 적용됨' : '배치 실패'}
        </span>
        {result.partial && <span className="text-amber-300">(부분 결과 — 중단됨)</span>}
        <span className="text-gray-500">·</span>
        <span className="text-gray-400">최대 깊이 {tree.stats.deepestDepth}</span>
      </div>

      {leaf && (
        <>
          <div className="bg-gray-800/40 border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-300 font-mono">
            <div>
              <span className="text-gray-500">셀 </span>{leaf.internal.placed.length}
              <span className="text-gray-500"> · 외부상자 </span>{leaf.external.containers.length}
              <span className="text-gray-500"> · 정사각형 penalty </span>{leaf.squarenessPenalty}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">{leaf.label}</div>
          </div>
          <div className="text-[10px] text-green-400/80 bg-green-900/10 border border-green-800/40 rounded px-2 py-1">
            블루프린트 주변 1칸 외부 영역(초록색)에서 무한상자를 드래그할 수 있습니다.
          </div>
        </>
      )}

      <IssueList issues={result.issues ?? []} />
    </div>
  );
}

/**
 * 귀속별로 묶은 문제 목록.
 *
 * 그룹 머리말은 사유가 아니라 **"사용자가 할 일"** 이다 — 목록을 읽고 나서 다음 동작을
 * 다시 추론하게 만들면 진단이 절반만 한 셈이다.
 *
 * 행에 hover 하면 캔버스의 그 대상이 강조된다. **강조 상태는 캔버스와 공유**한다
 * (`moduleInspectStore`) — 목록용 강조를 따로 두면 둘이 어긋난다.
 */
const SCOPE_ADVICE: Record<IssueScope, string> = {
  입력: '해당 단계로 돌아가 고치세요',
  게임데이터: '게임데이터를 다시 불러오세요',
  모듈: '머신·인서터·벨트 선택을 조정하세요',
  링크: '예약 불변식이 깨졌습니다 — 조사가 필요합니다',
  납품경로: '배치 형태 문제입니다',
  채널: '한 채널에 유체가 겹쳤습니다',
  반출경로: '물류는 정상이고 모양만 나쁩니다',
};

const SCOPE_ORDER: IssueScope[] = [
  '입력', '게임데이터', '모듈', '링크', '납품경로', '채널', '반출경로',
];

function IssueList({ issues }: { issues: readonly LayoutIssue[] }) {
  const setStep = useWizardStore((s) => s.setStep);
  const setHovered = useModuleInspectStore((s) => s.setHovered);
  // 층 1 을 끝까지 모으면 노드 수만큼 나온다 — 기본은 첫 그룹만 펼친다.
  const [open, setOpen] = useState<Set<IssueScope>>(new Set());

  if (issues.length === 0) return null;

  const groups = SCOPE_ORDER
    .map((scope) => ({ scope, items: issues.filter((i) => i.scope === scope) }))
    .filter((g) => g.items.length > 0);

  const isOpen = (scope: IssueScope, idx: number) => open.has(scope) || (open.size === 0 && idx === 0);
  const toggle = (scope: IssueScope) => {
    const next = new Set(open);
    if (next.has(scope)) next.delete(scope);
    else next.add(scope);
    setOpen(next);
  };

  return (
    <div className="space-y-1">
      {groups.map((g, idx) => {
        const warn = g.items.every((i) => i.severity === 'warning');
        const shown = isOpen(g.scope, idx);
        return (
          <div
            key={g.scope}
            className={`rounded border ${warn
              ? 'bg-amber-900/15 border-amber-800/50'
              : 'bg-red-900/15 border-red-800/50'}`}
          >
            <button
              onClick={() => toggle(g.scope)}
              className={`w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-left ${warn ? 'text-amber-200' : 'text-red-200'}`}
            >
              <span className="opacity-60">{shown ? '▾' : '▸'}</span>
              <span className="font-semibold">{g.scope} ({g.items.length})</span>
              <span className="opacity-60 truncate">{warn ? '⚠ ' : ''}{SCOPE_ADVICE[g.scope]}</span>
            </button>
            {shown && (
              <div className="px-2 pb-1.5 space-y-1">
                {g.items.map((i, n) => (
                  <div
                    key={`${i.code}-${n}`}
                    onMouseEnter={() => setHovered({
                      moduleKey: i.target?.moduleId ?? null,
                      lineId: i.target?.deliveryKey ?? null,
                    })}
                    onMouseLeave={() => setHovered({})}
                    className={`text-[11px] leading-snug rounded px-1.5 py-1 transition-colors ${warn
                      ? 'text-amber-200 hover:bg-amber-500/10'
                      : 'text-red-200 hover:bg-red-500/10'}`}
                  >
                    <span className="opacity-70 font-mono mr-1">{i.severity === 'warning' ? '⚠' : '✗'}</span>
                    {i.detail}
                    {i.recoverable === false && i.carrier === 'fluid' && (
                      <span className="opacity-60"> — 물러설 곳이 없었습니다</span>
                    )}
                    {i.fixStep && (
                      <button
                        onClick={() => setStep(i.fixStep!)}
                        className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded border border-current/40 hover:bg-white/10"
                      >
                        {FIX_STEP_LABEL[i.fixStep]} 단계로
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const FIX_STEP_LABEL: Record<NonNullable<LayoutIssue['fixStep']>, string> = {
  recipe: '1. 레시피',
  machine: '2. 머신',
  inserter: '3. 투입기',
  belt: '4. 벨트',
  pipe: '5. 파이프',
};

