import type { GridCell } from '../../types/layout';

/**
 * 레시피 트리의 한 노드. 사용자가 선택한 타깃 레시피를 루트로 하여,
 * 그 재료의 첫 매칭 레시피를 자식으로 가지는 BFS 트리.
 */
export interface RecipeTreeNode {
  /** 이 노드가 만들어내는 레시피 이름. 외부 공급(external) 노드면 undefined */
  recipeName?: string;
  /** 이 노드가 산출하는 아이템 이름 (root 가 아닌 노드에서는 부모의 ingredient 이름) */
  itemName: string;
  /** 외부에서 공급받기로 한 leaf 노드 — 자체 생산하지 않음 */
  external: boolean;
  /** 자식(이 레시피의 ingredient 들이 펼쳐진 노드들) */
  children: RecipeTreeNode[];
  /** 1단계 카운트 모드에서 산출된 머신 대수 (외부 노드는 0) */
  machineCount: number;
}

/**
 * 위저드 입력 — UI 의 5단계가 모이면 이 객체로 합쳐 algorithm 에 전달.
 */
export interface WizardInput {
  /** 1단계 */
  targetRecipe: string;
  countMode: 'min' | { perTarget: number };
  externalIngredients: ReadonlySet<string>;

  /** 2단계 — 사용자가 체크한 머신 entity 이름들 */
  selectedMachines: ReadonlyArray<string>;

  /** 3단계 — inserter entity 이름 + 인서터별 stack 사이즈 (미반영, 보존만) */
  selectedInserters: ReadonlyArray<string>;
  inserterStackSize?: Record<string, number>;
  /** 입력/출력에 우선 사용할 인서터. 없으면 selectedInserters[0] */
  primaryInserter?: string;
  /**
   * 인서터별 사용자 override.
   * - throughput (items/s) 입력 시 stackSize 는 무시.
   * - throughput 비어 있으면 stackSize 로 자동 계산.
   * - 둘 다 비어 있으면 기본 추정 (stackSize=1).
   * 자세한 모델은 utils/autoLayout/inserterThroughput.ts 참조.
   */
  inserterOverrides?: Record<string, { throughput?: number; stackSize?: number }>;

  /** 4단계 */
  selectedBelts: ReadonlyArray<string>;
  primaryBelt?: string;

  /** 5단계 — 지하 파이프 entity 이름들 (현재 알고리즘은 사용 안 함, 보존만) */
  selectedUndergroundPipes: ReadonlyArray<string>;

  /** 배치 영역. 캔버스 드래그 또는 폼 입력 */
  region: { x: number; y: number; w: number; h: number };
}

export interface WizardWarning {
  code:
    | 'no-machine-for-recipe'
    | 'partial-region-overflow'
    | 'no-inserter-selected'
    | 'no-belt-selected'
    | 'fluid-recipe-not-supported'
    | 'route-failed';
  message: string;
  context?: Record<string, string | number>;
}

export interface PlacedCellWithCoord {
  x: number;
  y: number;
  cell: GridCell;
}

export interface WizardResult {
  ok: boolean;
  /** 트리(=계산된 머신 수까지 채워진) */
  tree: RecipeTreeNode;
  /** 그리드에 새로 채울 셀들 (좌표 없음 — 미리보기 / 카운트 용). */
  placement: GridCell[];
  /** 그리드에 적용할 좌표 페어. apply 단계에서 layoutStore.applyPlacedCells 로 그대로 전달. */
  placedWithCoords: PlacedCellWithCoord[];
  /** 사용된 영역의 최소 bounding box (좌상단 x,y와 실제 폭/높이) */
  usedRegion?: { x: number; y: number; w: number; h: number };
  /** 배치된 머신 수 (성공 + 부분) */
  machinesPlaced: number;
  /** 트리 전체에서 요구되는 머신 수 합계 */
  machinesRequired: number;
  warnings: WizardWarning[];
}
