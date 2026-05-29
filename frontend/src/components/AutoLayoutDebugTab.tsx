import { useState } from 'react';
import {
  AUTO_LAYOUT_COORD_DUMP,
  setAutoLayoutCoordDump,
} from '../utils/autoLayout/debugFlags';

/**
 * 디버그 탭 — 자동 배치 좌표 덤프(COORD DUMP) on/off 토글만 제공.
 * 코드에서 AUTO_LAYOUT_COORD_DUMP 를 직접 수정하지 않고 런타임으로 끄고 켤 수 있다.
 */
export default function AutoLayoutDebugTab() {
  const [dumpEnabled, setDumpEnabled] = useState(AUTO_LAYOUT_COORD_DUMP);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <button
          onClick={() => {
            const next = !dumpEnabled;
            setAutoLayoutCoordDump(next);
            setDumpEnabled(next);
          }}
          className={`shrink-0 text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
            dumpEnabled
              ? 'bg-amber-900/60 border-amber-600 text-amber-300 hover:bg-amber-800/60'
              : 'bg-gray-800/40 border-gray-600 text-gray-500 hover:border-gray-400 hover:text-gray-400'
          }`}
        >
          COORD DUMP {dumpEnabled ? 'ON' : 'OFF'}
        </button>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          켜면 자동 배치가 실행될 때 내부 좌표·배치 데이터가 브라우저 콘솔에
          JSON 으로 출력됩니다. 배치 결과를 분석할 때만 켜고, 평소에는 로그
          노이즈를 줄이기 위해 꺼두세요.
        </p>
      </div>
    </div>
  );
}
