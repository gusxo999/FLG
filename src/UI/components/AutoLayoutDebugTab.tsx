import { useState } from 'react';
import {
  AUTO_LAYOUT_COORD_DUMP,
  setAutoLayoutCoordDump,
  AUTO_LAYOUT_LINK_LADDER,
  setAutoLayoutLinkLadder,
} from '../../autoLayout/debugFlags';
import { useUiDebugStore } from '../store/uiDebugStore';

/**
 * 디버그 탭 — 자동 배치 런타임 토글.
 *  - COORD DUMP : 내부 좌표·배치 데이터를 콘솔에 JSON 으로 덤프.
 *  - 못 쪼개기  : 구간막힘 해소(사다리 1단) — **미완성 기능이라 기본이 꺼짐**이다.
 * 코드 상수를 직접 수정하지 않고 런타임으로 끄고 켤 수 있다.
 */
export default function AutoLayoutDebugTab() {
  const [dumpEnabled, setDumpEnabled] = useState(AUTO_LAYOUT_COORD_DUMP);
  const [ladder, setLadder] = useState(AUTO_LAYOUT_LINK_LADDER);
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
            const next = !ladder;
            setAutoLayoutLinkLadder(next);
            setLadder(next);
          }}
          className={`shrink-0 text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
            ladder
              ? 'bg-emerald-900/60 border-emerald-600 text-emerald-300 hover:bg-emerald-800/60'
              : 'bg-gray-800/40 border-gray-600 text-gray-500 hover:border-gray-400 hover:text-gray-400'
          }`}
        >
          못 쪼개기 {ladder ? 'ON' : 'OFF'}
        </button>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          남의 <b>포트 칸</b>(못)이 내 벨트 구간을 가로막을 때, 줄을 <b>못을 피해 토막내어</b>
          앉힙니다(사다리 1단 · 구간막힘 해소). <b>미완성 기능이라 기본은 꺼짐</b>입니다 —
          켜고 끄며 <code>flg.report()</code> 의 <b>쪼갬</b> 수와 못 앉은 줄 수를 비교하세요.
          바꾼 뒤에는 <b>자동 배치를 다시 실행</b>해야 반영됩니다.
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
