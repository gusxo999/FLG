/**
 * Visualization — 재생 컨트롤 바.
 * 재생/일시정지 · 이전/다음 스텝 · 스크럽 슬라이더 · 속도(초/단계, 기본 0.5).
 */

interface PlaybackControlsProps {
  playing: boolean;
  current: number;
  total: number;
  /** 한 단계 간격 (ms) */
  speedMs: number;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onScrub: (index: number) => void;
  onSpeedChange: (ms: number) => void;
  onRestart: () => void;
}

export default function PlaybackControls({
  playing,
  current,
  total,
  speedMs,
  onPlayPause,
  onPrev,
  onNext,
  onScrub,
  onSpeedChange,
  onRestart,
}: PlaybackControlsProps) {
  const last = Math.max(0, total - 1);
  const atEnd = current >= last;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-t border-gray-700">
      <button
        onClick={onRestart}
        title="처음으로"
        className="toolbar-btn px-2"
      >
        ⏮
      </button>
      <button
        onClick={onPrev}
        disabled={current <= 0}
        title="이전 단계"
        className="toolbar-btn px-2 disabled:opacity-30"
      >
        ◀
      </button>
      <button
        onClick={onPlayPause}
        title={playing ? '일시정지' : '재생'}
        className="bg-purple-600 hover:bg-purple-500 text-white font-semibold px-4 py-1.5 rounded-lg min-w-[80px]"
      >
        {playing ? '⏸ 정지' : atEnd ? '↻ 다시' : '▶ 재생'}
      </button>
      <button
        onClick={onNext}
        disabled={atEnd}
        title="다음 단계"
        className="toolbar-btn px-2 disabled:opacity-30"
      >
        ▶
      </button>

      <div className="flex-1 flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={last}
          value={current}
          onChange={(e) => onScrub(Number(e.target.value))}
          className="w-full accent-purple-500"
        />
        <span className="text-xs text-gray-400 font-mono tabular-nums whitespace-nowrap">
          {total === 0 ? '0 / 0' : `${current + 1} / ${total}`}
        </span>
      </div>

      <label className="flex items-center gap-1.5 text-xs text-gray-400 whitespace-nowrap">
        속도
        <input
          type="number"
          min={0.05}
          max={5}
          step={0.05}
          value={(speedMs / 1000).toFixed(2)}
          onChange={(e) => {
            const sec = Number(e.target.value);
            if (Number.isFinite(sec) && sec >= 0.05) onSpeedChange(Math.round(sec * 1000));
          }}
          className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100 text-xs font-mono focus:outline-none focus:border-purple-500"
        />
        초/단계
      </label>
    </div>
  );
}
