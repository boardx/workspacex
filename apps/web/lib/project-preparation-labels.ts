import type { z } from "zod";
import type { templates, project } from "@repo/contracts";

type Group = z.infer<typeof templates.Group>;
type InterviewSubject = z.infer<typeof templates.InterviewSubject>;
type AgendaSegment = z.infer<typeof project.AgendaSegment>;

// Pure display metadata; API modules reexport the unchanged labels for compatibility.
export const INTERVIEW_SUBJECT_COLUMNS: ReadonlyArray<{
  key: keyof Omit<InterviewSubject, "subjectId">;
  label: string;
}> = [
  { key: "name", label: "对象" },
  { key: "role", label: "部门角色" },
  { key: "contact", label: "联系方式" },
  { key: "focus", label: "背景与要问什么" },
  { key: "method", label: "方式" },
  { key: "status", label: "状态" },
];

export const GROUP_STATUS_LABEL: Record<Group["status"], string> = {
  "recording-ready": "录音就绪",
  "short-n": "缺人",
  "needs-intervention": "需介入",
};

export const AGENDA_SEGMENT_STATE_LABEL: Record<AgendaSegment["state"], string> = {
  pending: "待开始",
  active: "进行中",
  closed: "已结束",
  skipped: "已跳过",
};
