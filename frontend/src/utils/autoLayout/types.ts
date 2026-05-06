/**
 * 레시피 트리의 한 노드. 사용자가 선택한 타깃 레시피를 루트로 하여,
 * 그 재료의 첫 매칭 레시피를 자식으로 가지는 BFS 트리.
 *
 * 컨테이너 모델의 wizard 입출력 타입은 [containerModel.ts](./containerModel.ts) 에 별도로 정의.
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
