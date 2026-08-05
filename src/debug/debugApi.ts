/**
 * 콘솔 디버그 API — 브라우저 콘솔(`window.flg`)에서 앱의 주요 동작을 직접 호출.
 *
 * UI 픽셀 드래그 없이 드래그/배치/삭제/undo/redo 등을 재현하기 위한 개발용 도구.
 * `installLayoutDebugApi()` 를 진입점에서 한 번 호출하면 `window.flg` 가 생긴다.
 *
 * 자동배치 결과의 재적용은 패널이 마운트된 동안 `registerAutoLayoutDebug` 로
 * 등록한 핸들러를 통해 동작한다 (패널 미마운트 시 안내 메시지).
 */

import { useLayoutStore } from '../UI/store/layoutStore';
import type { CandidateLeaf } from '../autoLayout/containerModel';

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

let autoLayoutRegistry: AutoLayoutRegistry | null = null;

/** AutoLayoutContainerPanel 이 마운트 동안 현재 결과 + 적용 핸들러를 등록. */
export function registerAutoLayoutDebug(reg: AutoLayoutRegistry | null): void {
  autoLayoutRegistry = reg;
}

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

const help = `flg — 콘솔 디버그 API
  flg.help()                      이 도움말
  flg.state()                     주요 상태 스냅샷
  flg.entities()                  그리드 origin 셀 목록 (id/타입/그리드 좌표)

  배치(자동배치 결과 — 배치는 언제나 한 개다)
  flg.layout()                    현재 배치 결과 요약 (패널 마운트 시)
  flg.apply()                     그 배치를 그리드에 다시 적용

  이동
  flg.move(id, gridX, gridY)      엔티티를 그리드 좌표로 이동 (moveEntityById)

  선택/삭제
  flg.select(...ids)              엔티티 선택
  flg.selectRect(x1,y1,x2,y2)     사각 영역 선택
  flg.clearSelection()
  flg.deleteSelected()            선택 엔티티 삭제
  flg.deleteById(...ids)          id로 선택 후 삭제

  단일 셀 배치/제거 (팔레트 선택 기준)
  flg.place(x, y)                 placeEntity
  flg.remove(x, y)                removeEntity

  히스토리
  flg.undo()   flg.redo()

  원본 스토어: flg.store (zustand). flg.store.getState() / .setState()`;

export interface FlgApi {
  store: typeof useLayoutStore;
  help(): void;
  state(): unknown;
  entities(): ReturnType<typeof listEntities>;
  layout(): unknown;
  apply(): boolean;
  move(id: string, gridX: number, gridY: number): boolean;
  select(...ids: string[]): void;
  selectRect(x1: number, y1: number, x2: number, y2: number): void;
  clearSelection(): void;
  deleteSelected(): void;
  deleteById(...ids: string[]): void;
  place(x: number, y: number): boolean;
  remove(x: number, y: number): void;
  undo(): void;
  redo(): void;
}

export function installLayoutDebugApi(): void {
  const api: FlgApi = {
    store: useLayoutStore,

    help() {
      console.log(help);
    },

    state() {
      const s = useLayoutStore.getState();
      const snap = {
        selected: [...s.selectedEntityIds],
        selectedEntityName: s.selectedEntityName,
        selectedRoutingId: s.selectedRoutingId,
        externalAreaBbox: s.externalAreaBbox,
        autoLayoutCanvasBbox: s.autoLayoutCanvasBbox,
        undo: s.undoStack.length,
        redo: s.redoStack.length,
        entityCount: listEntities().length,
      };
      console.table?.(snap);
      return snap;
    },

    entities() {
      const e = listEntities();
      console.table?.(e.map((x) => ({
        id: x.id, type: x.type, gx: x.grid.x, gy: x.grid.y, dir: x.dir,
      })));
      return e;
    },

    layout() {
      if (!autoLayoutRegistry) {
        console.warn('[flg] 결과 없음 — 자동배치 패널(검토 및 실행 단계)이 열려 있어야 합니다.');
        return null;
      }
      const leaf = autoLayoutRegistry.getLayout();
      if (!leaf) {
        console.warn('[flg] 배치 결과 없음 — "레이아웃 생성" 을 먼저 실행하세요.');
        return null;
      }
      const brief = {
        machines: leaf.internal.containers.filter((x) => x.kind === 'machine').length,
        externals: leaf.external.containers.length,
        routings: leaf.routings.length,
      };
      console.table?.(brief);
      return brief;
    },

    apply() {
      if (!autoLayoutRegistry) {
        console.warn('[flg] 적용 불가 — 자동배치 패널이 열려 있어야 합니다.');
        return false;
      }
      const leaf = autoLayoutRegistry.getLayout();
      if (!leaf) {
        console.warn('[flg] 배치 결과 없음 — "레이아웃 생성" 을 먼저 실행하세요.');
        return false;
      }
      autoLayoutRegistry.applyLayout(leaf);
      console.log('[flg] 배치 재적용.');
      return true;
    },

    move(id, gridX, gridY) {
      const ok = useLayoutStore.getState().moveEntityById(id, gridX, gridY);
      console.log(`[flg] move(${id}, ${gridX}, ${gridY}) → ${ok}`);
      return ok;
    },

    select(...ids) {
      useLayoutStore.setState({ selectedEntityIds: new Set(ids) });
      console.log(`[flg] selected ${ids.length}개`);
    },

    selectRect(x1, y1, x2, y2) {
      useLayoutStore.getState().selectEntitiesInRect(x1, y1, x2, y2);
      console.log(`[flg] selectRect → ${[...useLayoutStore.getState().selectedEntityIds].length}개`);
    },

    clearSelection() {
      useLayoutStore.getState().clearMultiSelection();
      console.log('[flg] 선택 해제');
    },

    deleteSelected() {
      const n = useLayoutStore.getState().selectedEntityIds.size;
      useLayoutStore.getState().deleteSelectedEntities();
      console.log(`[flg] 선택 ${n}개 삭제`);
    },

    deleteById(...ids) {
      useLayoutStore.setState({ selectedEntityIds: new Set(ids) });
      useLayoutStore.getState().deleteSelectedEntities();
      console.log(`[flg] ${ids.length}개 삭제: ${ids.join(', ')}`);
    },

    place(x, y) {
      const ok = useLayoutStore.getState().placeEntity(x, y);
      console.log(`[flg] place(${x}, ${y}) → ${ok}`);
      return ok;
    },

    remove(x, y) {
      useLayoutStore.getState().removeEntity(x, y);
      console.log(`[flg] remove(${x}, ${y})`);
    },

    undo() {
      useLayoutStore.getState().undo();
      console.log('[flg] undo');
    },

    redo() {
      useLayoutStore.getState().redo();
      console.log('[flg] redo');
    },
  };

  (window as unknown as { flg: FlgApi }).flg = api;
  console.log('[flg] 콘솔 디버그 API 설치됨. flg.help() 로 명령 목록 확인.');
}
