import { expect, it } from "vitest";
import { taskNoticeCopy } from "@/lib/i18n/task-notice";

it("localizes system status and keeps a Chinese conversation title", () => {
  const notice = { kind: "task", title: "用户输入 · 执行失败", body: "任务执行失败，点开查看结果。" } as const;
  expect(taskNoticeCopy(notice, "en")).toEqual({ title: "用户输入 · Failed", body: "Open the task to view the result." });
  expect(taskNoticeCopy(notice, "zh-CN")).toEqual(notice);
});
