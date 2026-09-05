/**
 * report — **한 덩어리로 복사할 수 있는 진단 보고서.**
 *
 * ## 왜 하나로 합치나
 *
 * 왕복 비용의 대부분은 사용자가 여러 곳을 복사하는 일이다. 2026-08-17 세션에서 한 번의
 * 판단에 필요했던 것만 세도 다섯 자리였다 — 화면 상태 · 납품 카운터 · 반출 skip 사유 ·
 * 이슈 목록 · 규칙 위반. 그중 `planned = 0` 은 콘솔 로그를 정규식으로 긁다가 **우연히**
 * 나왔다. 카운터가 한 줄로 나왔으면 첫 턴에 봤을 것이다.
 *
 * ```js
 * copy(flg.report())   // devtools 의 copy() 로 통째로 클립보드에
 * ```
 */

import {
  AUTO_LAYOUT_CHANNEL_GEOMETRY,
  AUTO_LAYOUT_COORD_DUMP,
  AUTO_LAYOUT_PERIMETER_PASS,
} from '../autoLayout/debugFlags';
import { useAutoLayoutRunStore } from '../UI/store/autoLayoutRunStore';
import { useGameDataStore } from '../UI/store/gameDataStore';
import { useLayoutStore } from '../UI/store/layoutStore';
import { useWizardStore } from '../UI/store/wizardStore';
import { checkLayout, formatViolations } from './checkRules';
import { currentView, type LayoutView } from './layoutView';
import { formatJournal, hasScope } from './registry';
import { readRunStats } from './runStats';

const line = (label: string, body: string): string => `${`─ ${label}`.padEnd(10)}${body}`;
const sub = (body: string): string => `${' '.repeat(12)}${body}`;

/**
 * 지금 화면이 어떤 상태인가 — **스크린샷의 대체물**.
 * 픽셀이 아니라 상태와 **가용성**을 찍는다. 비활성 버튼과 그 사유가 가장 자주 막히는 자리다.
 */
export function screenState(): string {
  const gd = useGameDataStore.getState();
  const w = useWizardStore.getState();
  const run = useAutoLayoutRunStore.getState();
  const grid = useLayoutStore.getState();

  const origins = grid.grid.cells.filter((c) => c.entityId && c.isOrigin).length;
  const panel = hasScope('autoLayoutPanel');
  const canRun = gd.loaded && !!w.targetRecipe && w.selectedMachines.length > 0;

  return [
    line('게임데이터', gd.loaded ? `loaded · 레시피 ${gd.recipes.length} · 엔티티 ${gd.entities.length}` : '없음'),
    line('그리드', `${grid.grid.width}×${grid.grid.height} · 엔티티 ${origins} · 선택 ${grid.selectedEntityIds.size}`
      + ` · undo ${grid.undoStack.length}/redo ${grid.redoStack.length}`),
    line('위저드', `${w.step} · 타깃 ${w.targetRecipe || '없음'} · ${w.countMode}`
      + (w.countMode === 'manual' ? `(${w.perTarget}/s)` : '')),
    sub(`머신 ${w.selectedMachines.length} · 인서터 ${w.selectedInserters.length} · 벨트 ${w.selectedBelts.length}`
      + ` · 지하벨트 ${w.selectedUndergroundBelts.length} · 파이프 ${w.selectedPipes.length}`),
    line('실행', `${run.status}${run.error ? ` — ${run.error}` : ''} · 적용 ${run.applied ? '됨' : '안 됨'}`),
    line('버튼', `레이아웃 생성 ${canRun ? '✓' : '✗(' + (!gd.loaded ? '게임데이터 없음' : !w.targetRecipe ? '타깃 없음' : '머신 미선택') + ')'}`
      + ` · 6단계 패널 ${panel ? '떠 있음' : '닫힘 — flg.wizard.go("review")'}`),
  ].join('\n');
}

/**
 * 모듈별 **면별 깊이 점유** — `W d2←iron-ore d3←water · E d2→concrete`.
 *
 * 채널·납품 조사에서 가장 자주 묻는 것이 *"이 모듈이 어느 면 몇 번 깊이를 쓰나"* 인데,
 * 그 답은 포트마다 흩어져 있다(`ModulePortMeta.side`·`clusterBeltDepth`). 한 줄로 접어 둔다.
 */
function moduleDepths(view: LayoutView): string[] {
  return view.modules.map((m) => {
    const bySide = new Map<string, string[]>();
    for (const p of [...m.ports].sort((a, b) => (a.meta?.clusterBeltDepth ?? 0) - (b.meta?.clusterBeltDepth ?? 0))) {
      const side = p.meta?.side ?? '?';
      const d = p.meta?.clusterBeltDepth !== undefined ? `d${p.meta.clusterBeltDepth}` : 'd?';
      const arrow = p.role === 'input' ? '←' : '→';
      bySide.set(side, [...(bySide.get(side) ?? []), `${d}${arrow}${p.meta?.item ?? '?'}`]);
    }
    const faces = [...bySide.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([side, list]) => `${side} ${list.join(' ')}`)
      .join(' · ');
    return `${m.key.padEnd(18)} ${faces || '포트 없음'}`;
  });
}

export function buildReport(): string {
  const run = useAutoLayoutRunStore.getState();
  const stats = readRunStats();
  const view = currentView();
  const out: string[] = [`[flg] 보고 — ${new Date().toLocaleString('ko-KR')}`, ''];

  out.push(screenState(), '');

  const d = stats.delivery;
  out.push(
    line(
      '납품',
      d
        ? `planned ${d.planned} / dijkstra ${d.dijkstraFallback} / 예약침범 ${d.reservationOverrun}`
          + ` / 실패 ${d.failures}  (총 ${d.routes})`
        : '단계 미도달 — 그 전에 거절됐다',
    ),
  );

  // **배선 형태** — 이 배치가 무엇을 깔았나. 이용률이 낮은데 줄이 많으면 그게 낭비의 얼굴이다
  // (glass 100/s: 필요 5줄 자리에 54줄, 줄당 8%). 그 사실을 예전엔 손으로 세야 알았다.
  const bf = stats.beltForms;
  out.push(
    line(
      '형태',
      bf
        ? `트렁크 ${bf.trunk} · 다이렉트 ${bf.direct} · 관통 ${bf.spanning}`
          + ` · 최대 fan-out ${bf.fanOutMax}`
          + (bf.capacity > 0
            ? ` · 이용률 ${Math.round((bf.loaded / bf.capacity) * 100)}%`
              + ` (${bf.loaded.toFixed(1)}/${bf.capacity.toFixed(0)}/s)`
            : '')
          + (bf.unpourable > 0 ? ` · 붓기불가 ${bf.unpourable}줄` : '')
          + (bf.overloaded > 0 ? `  ← **과적재 ${bf.overloaded}줄**(못 나른다)` : '')
        : '단계 미도달 — 벨트 줄을 만들기 전에 거절됐다',
    ),
  );

  // **면 깊이** — 좌석표 계획. 읽는 법: `깊은줄` 은 긴팔이 값을 하는 정도이고(정상),
  // **`안전망 > 0` 이 유일한 경보**다 — 포트 칸 다툼이 배정을 빠져나가 방출까지 갔다는 뜻.
  const fl = stats.faceDepths;
  out.push(
    line(
      '면깊이',
      `옆면 배정 ${fl.assignments} · 후보2+ ${fl.multiDepthFace}`
        + ` · **깊은줄 ${fl.deepBelt}**`
        + (fl.deepBeltOtherArm > 0 ? ` (다른 팔 ${fl.deepBeltOtherArm})` : '')
        + (fl.splits > 0 ? ` · 쪼갬 ${fl.splits}` : '')
        + (fl.netTrips > 0 ? `  ← **안전망 ${fl.netTrips}회**(포트 칸이 장부에 없다)` : ''),
    ),
  );

  // **못 앉은 줄의 사유** — 사다리가 읽을 것을 사람도 읽는다. "막힌 행"이 자름의 경계다.
  for (const w of fl.shortages) out.push(sub(w));

  // **링크 눈금** — 링크가 앉으려면 무엇을 풀어야 하나(`linkDepthNeed`).
  // 읽는 법: 오늘 코드는 `free` 밖에 못 하므로 **`free` 가 아닌 수 = 오늘 실패하는 모듈 수**다.
  // `tempPlanDocs/부분-링크/` J14(손잡이 기본값)의 입력이 이 분포다.
  const ln = fl.linkNeed;
  const ln_who = fl.linkNeedWho;
  const needSum = ln['opposite-face'] + ln.direct + ln['depth-starved'];
  if (ln.free + needSum > 0) {
    out.push(
      line(
        '링크눈금',
        `앉는다 ${ln.free}`
          + (needSum > 0
            ? `  ← **넘침 ${needSum}**`
              + ` (반대면 ${ln['opposite-face']} · 다이렉트 ${ln.direct}`
              + ` · 깊이없음 ${ln['depth-starved']})`
            : ''),
      ),
    );
    for (const w of ln_who) out.push(sub(w));
  }

  // **레인 공유** — 벨트 한 줄에 두 품목(좌/우 레인).
  //
  // **관문 넷을 갈라 센다.** 예전엔 `짝` 하나만 내고 *"짝 하나 = 아낀 벨트 하나"* 라고
  // 읽었는데 **거짓이었다** — 2026-09-04 실측에서 짝 3에 실제로 줄어든 납품은 **하나**였다.
  // 자격을 통과해도 배정이 도형을 못 세우거나(되돌림) 방출에서 칸이 막힌다.
  //
  // ```
  // 후보    갈린 줄에서 고른 쌍            (짝짓기 이전)
  // 짝      자격 넷 통과                   (양 · 티어)
  // 되돌림  배정이 자리를 못 맞춤 — 싣는 쪽 도형 / 집는 쪽 좌석
  // 합쳐짐  **셀까지 갔다 = 아낀 물리 벨트**  ← 이 수 하나만 값이다
  // ```
  const ls = stats.laneShare;
  out.push(
    line(
      '레인공유',
      ls.candidates === 0
        ? '후보 0 — 레인을 넘어 **갈린 줄**이 없다(또는 `레인 합류` 플래그가 꺼짐)'
        : `후보 ${ls.candidates} · 짝 ${ls.pairs}`
          + (ls.rejected > 0 ? ` · 자격미달 ${ls.rejected}(양)` : '')
          + (ls.unshared.shape + ls.unshared.seats > 0
            ? ` · 되돌림 ${ls.unshared.shape + ls.unshared.seats}`
              + `(도형 ${ls.unshared.shape} · 좌석 ${ls.unshared.seats})`
            : '')
          + ` · **합쳐짐 ${ls.merged}**  — 아낀 물리 벨트`,
    ),
  );

  const rc = stats.rowChannels;
  out.push(
    line(
      '행채널',
      rc
        ? `띠 ${rc.count}개 · **통과 수요 ${rc.needs.length}건**`
          + (rc.short.length > 0 ? ` · **자리 못 받음 ${rc.short.length}**` : '')
          + (rc.needs.length === 0 ? '  (0이면 이 트리엔 행채널이 필요 없다)' : '')
        : '단계 미도달',
    ),
  );
  if (rc) {
    for (const b of rc.bands) out.push(sub(b));
    for (const n of rc.needs) out.push(sub(`수요 ${n}`));
    // **관문**(`행채널-모델` Step 3) — 이 줄이 안 나오는 것이 성공이다.
    for (const x of rc.short) out.push(sub(`**부족** ${x}`));
  }

  const p = stats.perimeter;
  out.push(
    line(
      '반출',
      p
        ? `relocated ${p.relocated} / skipped ${p.skipped}`
        : AUTO_LAYOUT_PERIMETER_PASS
          ? '단계 미도달'
          : '꺼짐 (AUTO_LAYOUT_PERIMETER_PASS=false)',
    ),
  );
  if (p) for (const s of p.skips) out.push(sub(`${s.chestId}: ${s.reason}`));

  if (view) {
    const machines = view.containers.filter((c) => c.kind === 'machine').length;
    const ports = view.modules.reduce((n, m) => n + m.ports.length, 0);
    // **미라우팅(unroutedLines)은 성공 배치에 있을 수 없다** — 하나라도 있으면
    // `moduleWizard` 가 `unrouted-lines` 이슈를 내고 abort 한다. 그래서 세지 않고,
    // 대신 위 "이슈" 절에서 보인다. 여기 실을 값은 **면별 깊이 점유**다.
    out.push(line('모듈', `${view.modules.length}개 · 머신 ${machines}대 · 포트 ${ports}`));
    for (const l of moduleDepths(view)) out.push(sub(l));
    out.push(
      line('크기', `셀 ${view.cells.size} · penalty ${view.leaf.squarenessPenalty}`
        + ` · bbox ${view.bbox.w}×${view.bbox.h} @(${view.bbox.x},${view.bbox.y})`),
    );
  } else {
    out.push(line('배치', run.snapshot ? '없음 — 실패 스냅샷만 있다' : '없음 — flg.run() 을 먼저'));
    if (run.snapshot) {
      out.push(sub(`스냅샷 모듈 ${run.snapshot.modules.length}개 · bbox ${run.snapshot.bbox.w}×${run.snapshot.bbox.h}`));
    }
  }

  out.push(line('이슈', run.issues.length ? `${run.issues.length}건` : '없음'));
  for (const i of run.issues) out.push(sub(`[${i.severity}] ${i.code} — ${i.detail}`));

  if (view) {
    const v = checkLayout(view);
    out.push(line('검사', v.length ? `위반 ${v.length}건` : '통과'));
    if (v.length) for (const s of formatViolations(v).split('\n').slice(1)) out.push(sub(s.trim()));
  }

  out.push(
    line('플래그', `COORD_DUMP ${flag(AUTO_LAYOUT_COORD_DUMP)} · PERIMETER_PASS ${flag(AUTO_LAYOUT_PERIMETER_PASS)}`
      + ` · CHANNEL_GEOMETRY ${flag(AUTO_LAYOUT_CHANNEL_GEOMETRY)}`),
  );
  out.push('', '─ 최근 명령', formatJournal());
  return out.join('\n');
}

const flag = (b: boolean): string => (b ? 'ON' : 'OFF');
