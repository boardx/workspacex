import { blueprintFlowPart1ZhCN, blueprintFlowPart1En } from "./blueprint-flow-parts/part-01";
import { blueprintFlowPart2ZhCN, blueprintFlowPart2En } from "./blueprint-flow-parts/part-02";
import { blueprintFlowPart3ZhCN, blueprintFlowPart3En } from "./blueprint-flow-parts/part-03";
import { blueprintFlowPart4ZhCN, blueprintFlowPart4En } from "./blueprint-flow-parts/part-04";
import { blueprintFlowPart5ZhCN, blueprintFlowPart5En } from "./blueprint-flow-parts/part-05";
export const blueprintFlowZhCN = {
  ...blueprintFlowPart1ZhCN,
  ...blueprintFlowPart2ZhCN,
  ...blueprintFlowPart3ZhCN,
  ...blueprintFlowPart4ZhCN,
  ...blueprintFlowPart5ZhCN,
} as const;
export const blueprintFlowEn: Record<keyof typeof blueprintFlowZhCN, string> = {
  ...blueprintFlowPart1En,
  ...blueprintFlowPart2En,
  ...blueprintFlowPart3En,
  ...blueprintFlowPart4En,
  ...blueprintFlowPart5En,
};
