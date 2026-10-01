/**
 * 数字访谈的产品面薄封装（项目中枢 B2-S3）：只有真实 API，不带任何 `lib/mock/*`。
 *
 * ⚠ 为什么不用 `lib/interview-api.ts`：那份还 import 着数字访谈的 mock 草稿 / 快速访谈（原型期遗留），
 *   产品路由 `/projects/[projectId]` 一旦经它间接碰到 `lib/mock/*`，`lint-ui-wiring` 就把整条路由判回
 *   「mock 豁免」（豁免名额已接近上限）。研究总览只需要「新建一条项目作用域的数字访谈草稿」，
 *   这里按契约路径单独封装。
 */
import { interview } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type CreateDigitalInterviewDraftIn = z.infer<typeof interview.operations.createDigitalInterviewDraft.in>;
export type DigitalInterviewWorkflowView = z.infer<typeof interview.operations.createDigitalInterviewDraft.out>;

export function createDigitalInterviewDraft(input: CreateDigitalInterviewDraftIn): Promise<DigitalInterviewWorkflowView> {
  return apiRequest<DigitalInterviewWorkflowView>(interview.operations.createDigitalInterviewDraft.path, { method: "POST", body: input });
}
