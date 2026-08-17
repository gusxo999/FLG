/**
 * 콘솔 디버그 API — 브라우저 콘솔(`window.flg`)에서 앱을 **치고 읽는다.**
 *
 * `installLayoutDebugApi()` 를 진입점에서 한 번 부르면 `window.flg` 가 생긴다.
 * 명령 목록의 단일 출처는 `flg.help()` 다 — 문서에 카탈로그를 적지 않는다(런타임이
 * 대신 답할 수 있는 것은 문서에 안 담는다는 [[변수명사전]] 의 범위 규칙).
 *
 * ## 이 파일이 하는 일은 조립뿐
 *
 * | 무엇 | 어디 |
 * |---|---|
 * | 등록·로그·저널·사전조건 | [registry](registry.ts) |
 * | 실행 1회 (`flg.run`) | [runLayout](runLayout.ts) |
 * | 결과를 좌표로 묻기 | [layoutView](layoutView.ts) |
 * | 단면표 (`flg.face`) | [faceTable](faceTable.ts) |
 * | 규칙 검사 (`flg.check`) | [checkRules](checkRules.ts) |
 * | 이름 붙여 저장·비교 | [snapshots](snapshots.ts) |
 * | 한 덩어리 보고서 | [report](report.ts) |
 *
 * ## 규약
 *
 *  - 모든 명령은 **값을 돌려주고 한 줄을 찍는다** — `[flg] <이름>(<인자>) → <결과>`.
 *  - 못 쓰는 명령은 **다음에 칠 명령**과 함께 거절한다.
 *  - 긴 산출물(단면표·보고서)은 **문자열을 반환**한다. `copy(flg.report())` 로 통째로 복사.
 */

import {
  AUTO_LAYOUT_CHANNEL_GEOMETRY,
  AUTO_LAYOUT_COORD_DUMP,
  AUTO_LAYOUT_PERIMETER_PASS,
  setAutoLayoutChannelGeometry,
  setAutoLayoutCoordDump,
  setAutoLayoutPerimeterPass,
} from '../autoLayout/debugFlags';
import type { CandidateLeaf } from '../autoLayout/containerModel';
import { useAutoLayoutRunStore } from '../UI/store/autoLayoutRunStore';
import { useLayoutStore } from '../UI/store/layoutStore';
import { useUiDebugStore } from '../UI/store/uiDebugStore';
import { useWizardStore, WIZARD_STEPS, type WizardStep } from '../UI/store/wizardStore';
import { checkLayout, formatViolations } from './checkRules';
import { cellHistogram, listModules, renderFace, type FaceOptions } from './faceTable';
import { currentView, type Face } from './layoutView';
import { buildReport, screenState } from './report';
import {
  clearJournal,
  defineGroup,
  dynamicHandler,
  hasScope,
  listCommands,
  readJournal,
  registerCommands,
} from './registry';
import { runLayout, type RunOverrides } from './runLayout';
import {
  clearSnapshots,
  diffDigests,
  digestOf,
  getSnapshot,
  listSnapshots,
  putSnapshot,
} from './snapshots';

// ─────────────────────────────────────────────────────────────────────────────
// 6단계 패널 등록 — 컴포넌트 안에 사는 핸들러의 유일한 통로
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 자동배치 결과 = **배치 하나**.
 *
 * 예전엔 `getCandidates(): CandidateLeaf[]` + `apply(index)` 였다. 위저드가 후보를 언제나
 * 한 개만 내므로(`layeredWizard`) 그 배열은 길이가 0 아니면 1 이었고, index 인자는 항상 0
 * 이었다. 화면에서 후보 선택을 없앨 때(2026-08-04) 콘솔 API 도 같이 접었다.
 */
interface AutoLayoutRegistry {
  getLayout: () => CandidateLeaf | null;
  applyLayout: (leaf: CandidateLeaf) => void;
}

const PANEL = 'autoLayoutPanel';
let disposePanel: (() => void) | null = null;

/**
 * AutoLayoutContainerPanel 이 마운트 동안 현재 결과 + 적용 핸들러를 등록.
 *
 * **스코프 단위로 뗀다.** 예전엔 `null` 을 넘기면 등록이 통째로 지워졌다 — 두 컴포넌트가
 * 얽히거나 StrictMode 이중 마운트가 나면 살아 있는 등록이 날아간다.
 */
export function registerAutoLayoutDebug(reg: AutoLayoutRegistry | null): void {
  disposePanel?.();
  disposePanel = null;
  if (!reg) return;
  disposePanel = registerCommands(PANEL, {
    getLayout: reg.getLayout as (...a: never[]) => unknown,
    applyLayout: reg.applyLayout as (...a: never[]) => unknown,
  });
}

const panelClosed = (): string | null =>
  hasScope(PANEL) ? null : '6단계(검토) 패널이 안 떠 있습니다 — flg.wizard.go("review") 를 먼저.';

// ─────────────────────────────────────────────────────────────────────────────
// 조회 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 그리드의 origin 셀 목록 — id/타입/좌표 참조용.
 *
 * 예전엔 `layout` 열(= 그리드 좌표 − `containerOriginOffset`)도 냈다. 그 오프셋을 나르던
 * `routingEditSession` 이 영구 null 이라 **항상 (0,0) 으로 읽혔고**, 그리드 좌표를 레이아웃
 * 좌표인 척 내보내고 있었다. 좌표 프레임이 하나로 합쳐진 지금은 그 열 자체가 없다.
 */
function listEntities() {
  const { grid } = useLayoutStore.getState();
  const out: Array<{
    id: string; type: string; name: string | null;
    grid: { x: number; y: number }; dir: number;
  }> = [];
  for (let i = 0; i < grid.cells.length; i++) {
    const c = grid.cells[i];
    if (!c.entityId || !c.isOrigin) continue;
    out.push({
      id: c.entityId,
      type: String(c.entityType),
      name: c.entityName,
      grid: { x: i % grid.width, y: Math.floor(i / grid.width) },
      dir: c.direction,
    });
  }
  return out;
}

/** 배치가 있어야 하는 명령의 사전조건. */
const noLayout = (): string | null =>
  currentView() ? null : '배치 없음 — await flg.run() 을 먼저.';

function needView() {
  const v = currentView();
  if (!v) throw new Error('배치 없음');
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// 그룹
// ─────────────────────────────────────────────────────────────────────────────

const grid = defineGroup('grid', {
  place: {
    label: '캔버스 좌클릭(빈 칸)', usage: '(x, y)',
    desc: 'placeEntity 직접 — 캔버스 클릭의 여섯 분기를 안 지난다',
    fn: (x: number, y: number) => useLayoutStore.getState().placeEntity(x, y),
  },
  remove: {
    usage: '(x, y)', fn: (x: number, y: number) => useLayoutStore.getState().removeEntity(x, y),
  },
  move: {
    usage: '(id, x, y)',
    fn: (id: string, x: number, y: number) => useLayoutStore.getState().moveEntityById(id, x, y),
  },
  select: {
    usage: '(...ids)',
    fn: (...ids: string[]) => {
      useLayoutStore.setState({ selectedEntityIds: new Set(ids) });
      return ids.length;
    },
  },
  selectRect: {
    usage: '(x1, y1, x2, y2)',
    fn: (x1: number, y1: number, x2: number, y2: number) => {
      useLayoutStore.getState().selectEntitiesInRect(x1, y1, x2, y2);
      return useLayoutStore.getState().selectedEntityIds.size;
    },
  },
  clearSelection: { fn: () => useLayoutStore.getState().clearMultiSelection() },
  deleteSelected: {
    label: 'Delete 키',
    fn: () => {
      const n = useLayoutStore.getState().selectedEntityIds.size;
      useLayoutStore.getState().deleteSelectedEntities();
      return `${n}개 삭제`;
    },
  },
  deleteById: {
    usage: '(...ids)',
    fn: (...ids: string[]) => {
      useLayoutStore.setState({ selectedEntityIds: new Set(ids) });
      useLayoutStore.getState().deleteSelectedEntities();
      return `${ids.length}개 삭제`;
    },
  },
  clear: { label: '툴바 전체삭제', fn: () => useLayoutStore.getState().clearGrid() },
});

const wizard = defineGroup('wizard', {
  go: {
    label: '스테퍼 칸 클릭', usage: "('recipe'|'machine'|'inserter'|'belt'|'pipe'|'review'|'debug')",
    desc: '스킵 로직 없이 그 단계로 — 화면의 스테퍼 칸 클릭과 같다',
    fn: (step: WizardStep) => {
      if (!WIZARD_STEPS.includes(step)) throw new Error(`단계 이름이 아니다: ${step} (${WIZARD_STEPS.join('|')})`);
      useWizardStore.getState().setStep(step);
      return step;
    },
  },
  layout: {
    desc: '현재 결과 요약(패널 등록 기준)',
    available: panelClosed,
    fn: () => {
      const leaf = (dynamicHandler(PANEL, 'getLayout') as (() => CandidateLeaf | null) | null)?.();
      if (!leaf) return '배치 결과 없음 — await flg.run() 을 먼저';
      return {
        machines: leaf.internal.containers.filter((x) => x.kind === 'machine').length,
        externals: leaf.external.containers.length,
        routings: leaf.routings.length,
      };
    },
  },
  apply: {
    label: '(결과 자동 적용의 수동 재실행)',
    available: panelClosed,
    fn: () => {
      const leaf = (dynamicHandler(PANEL, 'getLayout') as (() => CandidateLeaf | null) | null)?.();
      if (!leaf) return '배치 결과 없음';
      (dynamicHandler(PANEL, 'applyLayout') as ((l: CandidateLeaf) => void))(leaf);
      return '재적용';
    },
  },
  abort: {
    label: '중단',
    fn: () => useAutoLayoutRunStore.getState().cancel(),
  },
  reset: {
    label: '초기화',
    desc: '위저드 설정 + 실행 결과를 함께 버린다(화면의 초기화와 같다)',
    fn: () => {
      useWizardStore.getState().reset();
      useAutoLayoutRunStore.getState().clear();
    },
  },
});

const flags = defineGroup('flags', {
  coordDump: {
    label: 'COORD DUMP', usage: '(true|false)',
    fn: (v: boolean) => {
      setAutoLayoutCoordDump(v);
      return v ? 'ON' : 'OFF';
    },
  },
  entityIds: {
    label: 'ENTITY IDS', usage: '(true|false)',
    fn: (v: boolean) => {
      useUiDebugStore.getState().setShowEntityDebugInfo(v);
      return v ? 'ON' : 'OFF';
    },
  },
  perimeterPass: {
    usage: '(true|false)', desc: '화면에 버튼이 없는 플래그',
    fn: (v: boolean) => {
      setAutoLayoutPerimeterPass(v);
      return v ? 'ON' : 'OFF';
    },
  },
  channelGeometry: {
    usage: '(true|false)', desc: '화면에 버튼이 없는 플래그 — 채널 기하 예약',
    fn: (v: boolean) => {
      setAutoLayoutChannelGeometry(v);
      return v ? 'ON' : 'OFF';
    },
  },
  show: {
    fn: () => ({
      coordDump: AUTO_LAYOUT_COORD_DUMP,
      perimeterPass: AUTO_LAYOUT_PERIMETER_PASS,
      channelGeometry: AUTO_LAYOUT_CHANNEL_GEOMETRY,
      entityIds: useUiDebugStore.getState().showEntityDebugInfo,
    }),
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 최상위 — 표면을 안 가리키는 것들
// ─────────────────────────────────────────────────────────────────────────────

const top = defineGroup('', {
  help: {
    usage: "(그룹이름?)",
    fn: (group?: string) => {
      console.log(renderHelp(group));
      return undefined;
    },
  },
  run: {
    label: '레이아웃 생성', usage: '({ target?, mode?, perTarget?, machines?, … })',
    desc: '위저드 설정 그대로(또는 덮어써서) 생성. await 로 끝을 기다린다',
    fn: (ov?: RunOverrides) => runLayout(ov ?? {}),
  },
  report: {
    desc: '한 덩어리 보고서 — copy(flg.report()) 로 복사',
    fn: () => {
      const s = buildReport();
      console.log(s);
      return s;
    },
  },
  ui: {
    desc: '지금 화면 상태(스크린샷 대체)',
    fn: () => {
      const s = screenState();
      console.log(s);
      return s;
    },
  },
  face: {
    usage: "(모듈, 'W'|'E'|'N'|'S', { depth?, margin? })",
    desc: '모듈 한 면의 단면표. 인자 없이 부르면 모듈 목록',
    available: noLayout,
    fn: (mod?: string, face: Face = 'W', opts?: FaceOptions) => {
      const view = needView();
      const s = mod ? renderFace(view, mod, face, opts) : listModules(view);
      console.log(s);
      return s;
    },
  },
  check: {
    desc: '규칙 검사 — 위반만 낸다 (R-겹침·R-연속·R-도달·R-무우회)',
    available: noLayout,
    fn: () => {
      const s = formatViolations(checkLayout(needView()));
      console.log(s);
      return s;
    },
  },
  snapshot: {
    usage: "('이름')", desc: '현재 배치를 이름 붙여 저장(새로고침을 견딘다)',
    available: noLayout,
    fn: (label = 'before') => {
      const d = digestOf(needView(), label);
      putSnapshot(d);
      return `'${label}' 저장 — 셀 ${d.cells} · penalty ${d.penalty}`;
    },
  },
  diff: {
    usage: "('이름')", desc: '저장한 것과 현재의 **차이만**',
    available: noLayout,
    fn: (label = 'before') => {
      const before = getSnapshot(label);
      if (!before) {
        const have = listSnapshots().map((d) => d.label);
        throw new Error(`'${label}' 없음. 저장된 것: ${have.join(', ') || '(없음)'}`);
      }
      const s = diffDigests(before, digestOf(needView(), '현재'));
      console.log(s);
      return s;
    },
  },
  snapshots: {
    usage: '(clear?)',
    fn: (clear = false) => {
      if (clear) {
        clearSnapshots();
        return '비움';
      }
      return listSnapshots().map((d) => `${d.label} · 셀 ${d.cells} · ${new Date(d.at).toLocaleString('ko-KR')}`);
    },
  },
  state: {
    fn: () => {
      const s = useLayoutStore.getState();
      return {
        selected: [...s.selectedEntityIds],
        selectedEntityName: s.selectedEntityName,
        selectedRoutingId: s.selectedRoutingId,
        externalAreaBbox: s.externalAreaBbox,
        autoLayoutCanvasBbox: s.autoLayoutCanvasBbox,
        undo: s.undoStack.length,
        redo: s.redoStack.length,
        entityCount: listEntities().length,
      };
    },
  },
  entities: {
    fn: () => {
      const e = listEntities();
      console.table?.(e.map((x) => ({ id: x.id, type: x.type, gx: x.grid.x, gy: x.grid.y, dir: x.dir })));
      return e;
    },
  },
  cells: {
    desc: '결과 배치의 셀 종류 히스토그램',
    available: noLayout,
    fn: () => cellHistogram(needView()),
  },
  undo: { label: '되돌리기', fn: () => useLayoutStore.getState().undo() },
  redo: { label: '다시실행', fn: () => useLayoutStore.getState().redo() },
  until: {
    usage: '(조건함수, ms?)', desc: '조건이 참이 될 때까지 기다린다',
    fn: async (pred: () => boolean, ms = 10_000) => {
      const t0 = performance.now();
      while (!pred()) {
        if (performance.now() - t0 > ms) throw new Error(`until: ${ms}ms 안에 조건이 안 참이 됐다`);
        await new Promise((r) => setTimeout(r, 30));
      }
      return true;
    },
  },
  journal: {
    usage: '(clear?)',
    fn: (clear = false) => {
      if (clear) {
        clearJournal();
        return '비움';
      }
      return readJournal();
    },
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// help — **명령 목록의 단일 출처**
// ─────────────────────────────────────────────────────────────────────────────

function renderHelp(only?: string): string {
  const rows = listCommands().filter((c) => !only || c.name.startsWith(`${only}.`) || (only === '' && !c.name.includes('.')));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const g = r.name.includes('.') ? r.name.split('.')[0] : '(최상위)';
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  const out: string[] = ['flg — 콘솔 디버그 API   (flg.help("wizard") 로 그룹만)'];
  for (const [g, list] of groups) {
    out.push('', `[${g}]`);
    for (const { name, spec } of list) {
      const blocked = spec.available?.() ?? null;
      const mark = blocked === null ? '✓' : '✗';
      const sig = `flg.${name}${spec.usage ?? '()'}`;
      const note = [spec.label ? `[${spec.label}]` : '', spec.desc ?? ''].filter(Boolean).join(' ');
      out.push(`  ${mark} ${sig.padEnd(46)} ${note}`);
      if (blocked !== null) out.push(`      └ ${blocked}`);
    }
  }
  out.push(
    '',
    '자주 쓰는 흐름:',
    "  await flg.run()                  현재 설정으로 생성 (덮어쓰기: { target:'concrete', machines:['assembling-machine-3'] })",
    '  copy(flg.report())               카운터·이슈·위반·명령이력을 한 덩어리로',
    "  flg.face('n0-concrete', 'W')     한 면의 단면표 (인자 없이 부르면 모듈 목록)",
    '  flg.check()                      규칙 위반만',
    "  flg.snapshot('before') … flg.diff('before')   같은 코드에서 입력만 바꾼 비교",
    '',
    '머신 **대수**는 직접 못 정한다 — 화면에 그런 입력이 없다. { perTarget: n } 이 처리량 기준으로 유도한다.',
  );
  return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 설치
// ─────────────────────────────────────────────────────────────────────────────

export type FlgApi = typeof top & {
  grid: typeof grid;
  wizard: typeof wizard;
  flags: typeof flags;
  store: typeof useLayoutStore;
};

export function installLayoutDebugApi(): void {
  const api = { ...top, grid, wizard, flags, store: useLayoutStore } as FlgApi;
  (window as unknown as { flg: FlgApi }).flg = api;
  console.log('[flg] 콘솔 디버그 API 설치됨. flg.help() 로 명령 목록.');
}
