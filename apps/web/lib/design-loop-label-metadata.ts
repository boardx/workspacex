import type { designWorkbench, inbox } from "@repo/contracts";
import type { z } from "zod";

type ProjectTemplate = z.infer<typeof designWorkbench.ProjectTemplate>;
export type InboxKind = z.infer<typeof inbox.InboxKind>;
export type InboxStage = z.infer<typeof inbox.InboxStage>;

// Pure display metadata shared by dictionaries and API compatibility exports.
export const PROJECT_TEMPLATE_LABEL: Record<ProjectTemplate, string> = {
  mobile: "移动端设计",
  ui: "UI 原型",
  // design-delta `novice-workbench-list`：普通用户评测集把「线框图」列为术语（第一次来的业务人员不认得）。
  // 只改展示名，存储值仍是 `wireframe`。
  wireframe: "草图",
};

export const INBOX_STAGE_LABEL: Record<InboxStage, string> = {
  backlog: "待处理",
  doing: "进行中",
  done: "已完成",
  archived: "不做",
};

export const INBOX_KIND_LABEL: Record<InboxKind, string> = {
  feedback: "反馈（需求 / 缺陷）",
  exception: "系统异常",
  design: "设计方案",
};
