import { useState } from 'react';
import {
  AUTO_LAYOUT_COORD_DUMP,
  setAutoLayoutCoordDump,
  AUTO_LAYOUT_ALGORITHM,
  setAutoLayoutAlgorithm,
  type AutoLayoutAlgorithm,
} from '../utils/autoLayout/debugFlags';
import {
  AUTO_LAYOUT_MERGE_BOXES,
  setAutoLayoutMergeBoxes,
} from '../utils/autoLayout/externalMergePass';

/**
 * 디버그 탭 — 자동 배치 런타임 토글.
 *  - COORD DUMP : 내부 좌표·배치 데이터를 콘솔에 JSON 으로 덤프.
 *  - MERGE BOXES: 공유 무한상자 병합 패스(트렁크 벨트) on/off.
 * 코드 상수를 직접 수정하지 않고 런타임으로 끄고 켤 수 있다.
 */
export default function AutoLayoutDebugTab() {
  const [dumpEnabled, setDumpEnabled] = useState(AUTO_LAYOUT_COORD_DUMP);
  const [mergeEnabled, setMergeEnabled] = useState(AUTO_LAYOUT_MERGE_BOXES);
  const [algorithm, setAlgorithm] = useState<AutoLayoutAlgorithm>(AUTO_LAYOUT_ALGORITHM);

  const ALGORITHMS: { value: AutoLayoutAlgorithm; label: string; desc: string }[] = [
    {
      value: 'exhaustive',
      label: 'S-EXH (완전탐색)',
      desc: '기존 알고리즘. 하향식 그리디 + perm(n!)×방향(2) 완전 탐색. 여러 후보를 정사각형 점수로 정렬해 반환합니다.',
    },
    {
      value: 'layered',
      label: 'S-LAYER (계층/채널)',
      desc: '계층화 DAG 레이아웃 + 채널 라우팅(Sugiyama). 레시피 깊이를 열(레이어)로 배치하고 레이어 사이에 빈 채널을 둬 라우팅을 구조적으로 보장합니다. 결정적 단일 후보.',
    },
  ];

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-mono">
          ALGORITHM — 배치 전략
        </div>
        <div className="flex gap-2">
          {ALGORITHMS.map((a) => (
            <button
              key={a.value}
              onClick={() => {
                setAutoLayoutAlgorithm(a.value);
                setAlgorithm(a.value);
              }}
              className={`flex-1 text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                algorithm === a.value
                  ? 'bg-purple-900/60 border-purple-500 text-purple-200'
                  : 'bg-gray-800/40 border-gray-600 text-gray-500 hover:border-gray-400 hover:text-gray-400'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          {ALGORITHMS.find((a) => a.value === algorithm)?.desc}
          {' '}전략을 바꾼 뒤 자동 배치를 다시 실행해야 반영됩니다.
        </p>
      </div>

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
    </div>
  );
}
