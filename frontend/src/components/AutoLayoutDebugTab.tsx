import { useState } from 'react';
import {
  AUTO_LAYOUT_COORD_DUMP,
  setAutoLayoutCoordDump,
} from '../utils/autoLayout/debugFlags';
import {
  AUTO_LAYOUT_MERGE_BOXES,
  setAutoLayoutMergeBoxes,
} from '../utils/autoLayout/externalMergePass';
import { useUiDebugStore } from '../store/uiDebugStore';

/**
 * 디버그 탭 — 자동 배치 런타임 토글.
 *  - COORD DUMP : 내부 좌표·배치 데이터를 콘솔에 JSON 으로 덤프.
 *  - MERGE BOXES: 공유 무한상자 병합 패스(트렁크 벨트) on/off.
 * 코드 상수를 직접 수정하지 않고 런타임으로 끄고 켤 수 있다.
 */
export default function AutoLayoutDebugTab() {
  const [dumpEnabled, setDumpEnabled] = useState(AUTO_LAYOUT_COORD_DUMP);
  const [mergeEnabled, setMergeEnabled] = useState(AUTO_LAYOUT_MERGE_BOXES);
  const showEntityDebugInfo = useUiDebugStore((s) => s.showEntityDebugInfo);
  const setShowEntityDebugInfo = useUiDebugStore((s) => s.setShowEntityDebugInfo);

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

      <div className="flex items-start gap-3">
        <button
          onClick={() => {
            const next = !mergeEnabled;
            setAutoLayoutMergeBoxes(next);
            setMergeEnabled(next);
          }}
          className={`shrink-0 text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
            mergeEnabled
              ? 'bg-emerald-900/60 border-emerald-600 text-emerald-300 hover:bg-emerald-800/60'
              : 'bg-gray-800/40 border-gray-600 text-gray-500 hover:border-gray-400 hover:text-gray-400'
          }`}
        >
          MERGE BOXES {mergeEnabled ? 'ON' : 'OFF'}
        </button>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          켜면 같은 외부 품목을 공급받는 가까운 조립기계들을, 벨트·투입기 처리량이
          감당하는 한도 내에서 하나의 무한상자 + 트렁크 벨트가 공급하도록 묶습니다.
          묶기가 불가능하면 기존 1:1 배치로 자동 폴백합니다. 토글 후 자동 배치를
          다시 실행해야 반영됩니다.
        </p>
      </div>

      <div className="flex items-start gap-3">
        <button
          onClick={() => setShowEntityDebugInfo(!showEntityDebugInfo)}
          className={`shrink-0 text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
            showEntityDebugInfo
              ? 'bg-sky-900/60 border-sky-600 text-sky-300 hover:bg-sky-800/60'
              : 'bg-gray-800/40 border-gray-600 text-gray-500 hover:border-gray-400 hover:text-gray-400'
          }`}
        >
          ENTITY IDS {showEntityDebugInfo ? 'ON' : 'OFF'}
        </button>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          켜면 엔티티 정보 모달에 인스턴스 ID·내부 이름·그리드 좌표·방향 등
          디버깅용 정보가 추가로 표시됩니다. 기본은 꺼짐(숨김)입니다.
        </p>
      </div>
    </div>
  );
}
