/**
 * Visualization — TraceStep[] 를 함수 호출 트리로 변환.
 *
 * 각 단계의 `callDepth` 를 이용해 깊이 d 단계를 가장 가까운 직전 깊이 d-1 단계의
 * 자식으로 연결한다. 결과 트리는 모달의 사이드바가 "레시피 트리처럼" 그린다.
 */

import type { TraceStep } from '../containerModel';

export interface FunctionTreeNode {
  step: TraceStep;
  children: FunctionTreeNode[];
}

/** TraceStep[] → 함수 호출 트리 (최상위 노드 배열). */
export function buildFunctionTree(steps: TraceStep[]): FunctionTreeNode[] {
  const roots: FunctionTreeNode[] = [];
  // stack[d] = 현재까지 본 깊이 d 의 마지막 노드 (자식 부착 대상)
  const stack: FunctionTreeNode[] = [];

  for (const step of steps) {
    const node: FunctionTreeNode = { step, children: [] };
    const d = step.callDepth;
    if (d <= 0 || !stack[d - 1]) {
      roots.push(node);
    } else {
      stack[d - 1].children.push(node);
    }
    stack[d] = node;
    // 더 깊은 곳에 남아있던 stale 참조 제거
    stack.length = d + 1;
  }

  return roots;
}
