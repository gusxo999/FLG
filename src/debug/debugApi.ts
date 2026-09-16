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
 * | 단면표 (`flg.face`) | [faceTable](module/ledger/face.ts) |
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
  AUTO_LAYOUT_COORD_DUMP,
  AUTO_LAYOUT_PERIMETER_PASS,
  setAutoLayoutLinkLadder,
  AUTO_LAYOUT_LINK_LADDER,
  setAutoLayoutLinkOppositeFace,
  AUTO_LAYOUT_LINK_OPPOSITE_FACE,
  setAutoLayoutLinkDirect,
  AUTO_LAYOUT_LINK_DIRECT,
  setAutoLayoutCoordDump,
  setAutoLayoutPerimeterPass,
  setAutoLayoutLaneMerge,
} from '../autoLayout/shared/flags';
import type { CandidateLeaf } from '../autoLayout/shared/types';
import type { CustomDataSpec } from '../factorio/customRecipe';
import { validateCustomData } from '../factorio/customRecipeValidate';
import { gameDataContext, useCustomDataStore } from '../UI/store/customDataStore';
import { useAutoLayoutRunStore } from '../UI/store/autoLayoutRunStore';
import { useLayoutStore } from '../UI/store/layoutStore';
import { useUiDebugStore } from '../UI/store/uiDebugStore';
import { useWizardStore, WIZARD_STEPS, type WizardStep } from '../UI/store/wizardStore';
import { checkLayout, formatViolations } from './checkRules';
import {
  customTemplate,
  renderCustomMachine,
  renderFit,
  renderIssues,
  renderSummary,
} from './customData';
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
  laneMerge: {
    label: '레인 합류', usage: '(true|false)',
    desc: '줄 둘을 한 벨트의 좌/우 레인으로 — **미완성이라 기본 꺼짐**. 짝 수는 report 의 `레인공유`',
    fn: (v: boolean) => {
      setAutoLayoutLaneMerge(v);
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
  linkLadder: {
    usage: '(true|false)',
    desc: '화면에 버튼이 없는 플래그 — 사다리 1단(못을 피해 링크 토막내기). 기본 OFF',
    fn: (v: boolean) => {
      setAutoLayoutLinkLadder(v);
      return v ? 'ON' : 'OFF';
    },
  },
  linkOppositeFace: {
    usage: '(true|false)',
    desc: '화면에 버튼이 없는 플래그 — 링크 넘침이 **반대 옆면**을 본다(gap 앞에). 기본 OFF. '
      + '대가는 납품 경로 우회 — report 의 `납품`·`링크눈금` 줄로 대조한다',
    fn: (v: boolean) => {
      setAutoLayoutLinkOppositeFace(v);
      return v ? 'ON' : 'OFF';
    },
  },
  linkDirect: {
    usage: '(true|false)',
    desc: '화면에 버튼이 없는 플래그 — 넘치는 부모의 링크 입력을 **g=1**(다이렉트)로. 기본 OFF. '
      + '대가는 포트 c배 — report 의 `형태`(포트·이용률)로 대조한다',
    fn: (v: boolean) => {
      setAutoLayoutLinkDirect(v);
      return v ? 'ON' : 'OFF';
    },
  },
  show: {
    fn: () => ({
      coordDump: AUTO_LAYOUT_COORD_DUMP,
      perimeterPass: AUTO_LAYOUT_PERIMETER_PASS,
      linkLadder: AUTO_LAYOUT_LINK_LADDER,
      linkOppositeFace: AUTO_LAYOUT_LINK_OPPOSITE_FACE,
      linkDirect: AUTO_LAYOUT_LINK_DIRECT,
      entityIds: useUiDebugStore.getState().showEntityDebugInfo,
    }),
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 커스텀 레시피 — **게임데이터를 콘솔로 넣는 유일한 길**
//
// 나머지 게임데이터는 여전히 파일 업로드뿐이다(ai-console.md §4). 커스텀만 예외인 이유는
// 원천이 파일이 아니라 우리가 만든 spec 이기 때문이다 — 다이얼로그가 낄 자리가 없다.
//
// 검증·합성·합류는 전부 스토어 아래(customRecipe · customRecipeValidate · customDataStore)에
// 있다. 그래서 이 명령들은 **방식 A**(스토어 직행)로 정직하다 — 편집기 버튼과 같은 함수를
// 부르고, 패널이 안 떠 있어도 같은 일이 일어난다.
// ─────────────────────────────────────────────────────────────────────────────

/** 이름 하나로 머신·레시피 어느 쪽이든 찾는다 — 사용자는 둘을 구분해 외우지 않는다. */
function findCustom(name: string) {
  const { machines, recipes } = useCustomDataStore.getState().data;
  return {
    machine: machines.find((m) => m.name === name),
    recipe: recipes.find((r) => r.name === name),
  };
}

/** 이 레시피를 맡는 커스텀 머신들 — `map`/`check` 가 짝을 지을 때. */
function machinesFor(recipe: { category: string }) {
  return useCustomDataStore.getState().data.machines.filter((m) =>
    m.craftingCategories.includes(recipe.category),
  );
}

const custom = defineGroup('custom', {
  template: {
    usage: '(size?)',
    desc: '채워 넣을 spec 뼈대 — 입력·출력이 마주보는 성립 예다. 여기서 시작한다',
    fn: (size = 3) => customTemplate(size),
  },
  add: {
    label: '커스텀 레시피 [저장]',
    usage: '({ machines?, recipes? })',
    desc: '검증 → 합성 → 게임데이터 합류. 이름이 같으면 덮어쓴다(= 편집)',
    fn: (spec: Partial<CustomDataSpec>) => {
      const rejects = useCustomDataStore.getState().merge(spec);
      if (rejects.length > 0) throw new Error(`\n${renderIssues(rejects)}`);
      const { machines, recipes } = useCustomDataStore.getState().data;
      return `머신 ${machines.length} · 레시피 ${recipes.length}`;
    },
  },
  check: {
    usage: '(이름?)',
    desc: '저장 안 하고 판정만. 이름을 주면 그 레시피의 유체 적합까지',
    fn: (name?: string) => {
      const state = useCustomDataStore.getState().data;
      const out: string[] = [renderIssues(validateCustomData(state, gameDataContext()))];
      if (name) {
        const { machine, recipe } = findCustom(name);
        if (!machine && !recipe) throw new Error(`커스텀에 그런 이름이 없다: ${name}`);
        if (recipe) for (const m of machinesFor(recipe)) out.push('', ...renderFit(m, recipe));
        if (machine) {
          for (const r of state.recipes.filter((x) => machine.craftingCategories.includes(x.category))) {
            out.push('', ...renderFit(machine, r));
          }
        }
      }
      const s = out.join('\n');
      console.log(s);
      return s;
    },
  },
  map: {
    usage: '(머신이름?)',
    desc: '발자국 그림 — 어느 면 어느 행에 유체 상자가 앉았나 (회전 0 기준)',
    available: () =>
      useCustomDataStore.getState().data.machines.length > 0
        ? null
        : '커스텀 머신이 없습니다 — flg.custom.add(flg.custom.template()) 를 먼저.',
    fn: (name?: string) => {
      const { machines, recipes } = useCustomDataStore.getState().data;
      const targets = name ? machines.filter((m) => m.name === name) : machines;
      if (targets.length === 0) throw new Error(`커스텀 머신이 아니다: ${name}`);
      const s = targets
        .map((m) =>
          renderCustomMachine(
            m,
            recipes.filter((r) => m.craftingCategories.includes(r.category)),
          ),
        )
        .join('\n\n');
      console.log(s);
      return s;
    },
  },
  list: {
    desc: '커스텀 전부 요약 + 판정',
    fn: () => {
      const s = renderSummary(useCustomDataStore.getState().data, gameDataContext());
      console.log(s);
      return s;
    },
  },
  get: {
    usage: '(이름)',
    desc: 'spec 원본 — 고쳐서 flg.custom.add() 로 되돌린다',
    fn: (name: string) => {
      const { machine, recipe } = findCustom(name);
      if (!machine && !recipe) throw new Error(`커스텀에 그런 이름이 없다: ${name}`);
      return machine ?? recipe;
    },
  },
  remove: {
    label: '커스텀 목록 [삭제]', usage: '(이름)',
    fn: (name: string) => {
      const store = useCustomDataStore.getState();
      const removed = [
        store.removeMachine(name) ? '머신' : null,
        store.removeRecipe(name) ? '레시피' : null,
      ].filter(Boolean);
      if (removed.length === 0) throw new Error(`커스텀에 그런 이름이 없다: ${name}`);
      return `${removed.join('·')} 삭제`;
    },
  },
  clear: {
    label: '커스텀 목록 [전체 삭제]',
    fn: () => {
      useCustomDataStore.getState().clear();
      return '비움';
    },
  },
  export: {
    // 파일이 아니라 **문자열**이다 — 다운로드된 파일을 AI 는 못 읽는다(ai-console.md §4).
    desc: 'spec 한 벌을 JSON 문자열로 — copy(flg.custom.export()) 로 복사',
    fn: () => JSON.stringify(useCustomDataStore.getState().data, null, 2),
  },
  import: {
    usage: '(json문자열 | 객체)',
    desc: '한 벌을 통째로 교체. 검증에 걸리면 아무것도 안 바꾼다',
    fn: (json: string | CustomDataSpec) => {
      const spec = typeof json === 'string' ? (JSON.parse(json) as CustomDataSpec) : json;
      const rejects = useCustomDataStore.getState().replace({
        machines: spec.machines ?? [],
        recipes: spec.recipes ?? [],
      });
      if (rejects.length > 0) throw new Error(`\n${renderIssues(rejects)}`);
      return `머신 ${spec.machines?.length ?? 0} · 레시피 ${spec.recipes?.length ?? 0}`;
    },
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
    '게임에 없는 레시피를 만들어 시험하려면:',
    '  flg.custom.add(flg.custom.template(3))   뼈대 그대로 넣어 본다',
    "  flg.custom.map()                         유체 상자가 어느 면 어느 행에 앉았나",
    "  flg.custom.check('my-thing')             회전이 성립하나 · 남는 칸은 어디인가",
    '  나머지 게임데이터는 여전히 파일 업로드뿐이다 — 커스텀만 콘솔로 들어간다.',
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
  custom: typeof custom;
  store: typeof useLayoutStore;
};

export function installLayoutDebugApi(): void {
  const api = { ...top, grid, wizard, flags, custom, store: useLayoutStore } as FlgApi;
  (window as unknown as { flg: FlgApi }).flg = api;
  console.log('[flg] 콘솔 디버그 API 설치됨. flg.help() 로 명령 목록.');
}
