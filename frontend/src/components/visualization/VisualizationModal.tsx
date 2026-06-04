/**
 * Visualization — 전체화면 모달.
 *
 * 후보 적용 시 저장된 `visualizationSource` 로 `traceCandidatePath` 를 호출해
 * 선택된 후보 1개의 생성 과정을 함수 단계로 재현하고, 0.5초(사용자 지정) 간격으로
 * 재생한다. 좌측은 독립 그리드, 우측은 함수 호출 트리, 하단은 재생 컨트롤.
 */

import { useEffect, useState } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { traceCandidatePath } from '../../utils/autoLayout/containerWizard';
import type { CandidateTraceResult } from '../../utils/autoLayout/containerModel';
import VisualizationGrid from './VisualizationGrid';
import FunctionTreeSidebar from './FunctionTreeSidebar';
import PlaybackControls from './PlaybackControls';

interface VisualizationModalProps {
  onClose: () => void;
}

const DEFAULT_SPEED_MS = 500;

export default function VisualizationModal({ onClose }: VisualizationModalProps) {
  const source = useLayoutStore((s) => s.visualizationSource);

  const [trace, setTrace] = useState<CandidateTraceResult | null>(null);
  // 소스가 있으면 로딩(=기록 진행), 없으면 즉시 에러 안내.
  const [loading, setLoading] = useState(!!source);
  const [error, setError] = useState<string | null>(null);

  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(DEFAULT_SPEED_MS);

  // 트레이스 로드 — setState 는 비동기 결과(.then/.catch)에서만 호출.
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    traceCandidatePath(source.input, source.perm, source.dir)
      .then((result) => {
        if (cancelled) return;
        setTrace(result);
        setCurrent(0);
        setLoading(false);
        // 단계가 있으면 자동 재생 시작
        if (result.steps.length > 0) setPlaying(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  const steps = trace?.steps ?? [];
  const total = steps.length;
  const lastIndex = Math.max(0, total - 1);

  // 표시용 파생값 — 소스 없음은 effect 가 아니라 렌더에서 직접 처리.
  const displayError =
    error ??
    (!source
      ? '선택된 후보가 없습니다. 자동 레이아웃에서 후보를 적용한 뒤 다시 시도하세요.'
      : null);
  const displayLoading = loading && !!source && !error;

  // 재생 타이머 — speedMs 간격으로 다음 단계로. 마지막에서 정지.
  useEffect(() => {
    if (!playing || total === 0) return;
    const id = window.setInterval(() => {
      setCurrent((c) => {
        if (c >= lastIndex) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, speedMs);
    return () => window.clearInterval(id);
  }, [playing, speedMs, total, lastIndex]);

  // Esc 로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handlePlayPause() {
    if (total === 0) return;
    // 끝에서 재생 누르면 처음부터
    if (!playing && current >= lastIndex) setCurrent(0);
    setPlaying((p) => !p);
  }

  const currentStep = steps[current] ?? null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-950/95">
      {/* 헤더 */}
      <header className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-700 shrink-0">
        <span className="text-purple-300 font-bold">후보 생성 시각화</span>
        {currentStep && (
          <span className="text-xs text-gray-400 font-mono truncate">
            ▶ {currentStep.functionName}
          </span>
        )}
        <button
          onClick={onClose}
          className="ml-auto text-gray-400 hover:text-gray-200 text-xl leading-none px-2"
          title="닫기 (Esc)"
        >
          ×
        </button>
      </header>

      {/* 본문 */}
      <div className="flex-1 flex min-h-0">
        {/* 그리드 */}
        <div className="flex-1 relative min-w-0">
          {displayLoading && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
              생성 과정 기록 중…
            </div>
          )}
          {displayError && (
            <div className="absolute inset-0 flex items-center justify-center px-8">
              <div className="text-red-300 text-sm bg-red-900/20 border border-red-800 rounded-lg px-4 py-3 max-w-md text-center">
                {displayError}
              </div>
            </div>
          )}
          {!displayLoading && !displayError && (
            <>
              <VisualizationGrid
                snapshot={currentStep?.snapshot ?? null}
                camera={trace?.bbox}
                routings={trace?.routings ?? []}
              />
              <div className="absolute bottom-2 right-2 text-[10px] text-gray-500 bg-gray-900/70 rounded px-2 py-1 pointer-events-none">
                휠 = 확대/축소 · 드래그 = 이동 · 더블클릭 = 맞춤
              </div>
            </>
          )}
          {trace?.failed && !displayLoading && (
            <div className="absolute top-2 left-2 text-[11px] text-amber-300 bg-amber-900/30 border border-amber-700/50 rounded px-2 py-1">
              이 경로는 실패로 끝났습니다 (부분 과정만 표시).
            </div>
          )}
        </div>

        {/* 사이드바 */}
        <aside className="w-80 shrink-0 border-l border-gray-700 bg-gray-900/60 min-h-0">
          {!displayLoading && !displayError && (
            <FunctionTreeSidebar
              steps={steps}
              currentOrder={currentStep?.order ?? -1}
              onSelect={(order) => {
                setPlaying(false);
                setCurrent(order);
              }}
            />
          )}
        </aside>
      </div>

      {/* 컨트롤 */}
      {!displayLoading && !displayError && total > 0 && (
        <PlaybackControls
          playing={playing}
          current={current}
          total={total}
          speedMs={speedMs}
          onPlayPause={handlePlayPause}
          onPrev={() => {
            setPlaying(false);
            setCurrent((c) => Math.max(0, c - 1));
          }}
          onNext={() => {
            setPlaying(false);
            setCurrent((c) => Math.min(lastIndex, c + 1));
          }}
          onScrub={(i) => {
            setPlaying(false);
            setCurrent(i);
          }}
          onSpeedChange={setSpeedMs}
          onRestart={() => {
            setPlaying(false);
            setCurrent(0);
          }}
        />
      )}
    </div>
  );
}
