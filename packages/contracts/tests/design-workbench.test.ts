/**
 * `design-workbench` 契约束（UC-17.8 B4.1）——三件事：
 *   1. `DesignProject` 形状正反例：`.strict()` 拒多余键、`ownerName` 可空、`chat` turn 边界。
 *   2. 常量导出：`DESIGN_PROJECT_INITIAL_CRITERIA` / `DESIGN_PROJECT_INITIAL_FRAMES` 是三值/三值。
 *   3. `operations` 的 `in`/`out` 边界：`name` 长度、`inboxCode` 前缀、错误码闭集。
 */
import { describe, expect, it } from "vitest";
import * as dw from "../src/design-workbench";

describe("常量", () => {
  it("验收标准固定三条", () => {
    expect(dw.DESIGN_PROJECT_INITIAL_CRITERIA).toHaveLength(3);
  });
  it("画布页默认三页", () => {
    expect(dw.DESIGN_PROJECT_INITIAL_FRAMES).toEqual(["草稿页 1", "草稿页 2", "草稿页 3"]);
  });
  it("引导语与回执非空", () => {
    expect(dw.DESIGN_WORKBENCH_CHAT_INTRO.length).toBeGreaterThan(0);
    expect(dw.DESIGN_WORKBENCH_CHAT_REPLY.length).toBeGreaterThan(0);
  });
});

const project: dw.DesignProject = {
  id: "dp-1",
  name: "反馈导出流程重设计",
  template: "wireframe",
  problem: "导出按钮点击无响应，需要重新设计交互反馈",
  criteria: [...dw.DESIGN_PROJECT_INITIAL_CRITERIA],
  frames: [...dw.DESIGN_PROJECT_INITIAL_FRAMES],
  pushed: false,
  pushedAt: null,
  linkedFeedbackId: "fb-1",
  chat: [],
  ownerId: "u-1",
  ownerName: "李四",
  createdAt: "2026-09-04T08:00:00.000Z",
  updatedAt: "2026-09-04T08:00:00.000Z",
};

describe("DesignProject -- 正例", () => {
  it("基本形状", () => {
    expect(dw.DesignProject.safeParse(project).success).toBe(true);
  });
  it("problem 可空字符串", () => {
    expect(dw.DesignProject.safeParse({ ...project, problem: "" }).success).toBe(true);
  });
  it("linkedFeedbackId 为 null（不是深化出来的项目）", () => {
    expect(dw.DesignProject.safeParse({ ...project, linkedFeedbackId: null }).success).toBe(true);
  });
  it("ownerName 为 null（owner 已不可查）", () => {
    expect(dw.DesignProject.safeParse({ ...project, ownerName: null }).success).toBe(true);
  });
  it("已推送：pushed=true 且 pushedAt 非 null", () => {
    expect(
      dw.DesignProject.safeParse({ ...project, pushed: true, pushedAt: "2026-09-04T09:00:00.000Z" }).success,
    ).toBe(true);
  });
  it("chat 带有效轮次", () => {
    expect(
      dw.DesignProject.safeParse({
        ...project,
        chat: [
          { role: "user", text: "先做移动端", at: "2026-09-04T08:01:00.000Z" },
          { role: "ai", text: dw.DESIGN_WORKBENCH_CHAT_REPLY, at: "2026-09-04T08:01:01.000Z" },
        ],
      }).success,
    ).toBe(true);
  });
  it("三种模板都合法", () => {
    for (const template of ["mobile", "ui", "wireframe"] as const) {
      expect(dw.DesignProject.safeParse({ ...project, template }).success, template).toBe(true);
    }
  });
});

describe("DesignProject -- 反例", () => {
  it("strict：多一个未声明的键即拒", () => {
    expect(dw.DesignProject.safeParse({ ...project, tags: [] }).success).toBe(false);
  });
  it("name 为空拒；超过 200 字拒", () => {
    expect(dw.DesignProject.safeParse({ ...project, name: "" }).success).toBe(false);
    expect(dw.DesignProject.safeParse({ ...project, name: "x".repeat(201) }).success).toBe(false);
  });
  it("template 不在闭集里即拒", () => {
    expect(dw.DesignProject.safeParse({ ...project, template: "canvas" }).success).toBe(false);
  });
  it("chat turn 缺字段或 role 不在枚举里即拒", () => {
    expect(
      dw.DesignProject.safeParse({ ...project, chat: [{ role: "bot", text: "x", at: "2026-09-04T08:00:00.000Z" }] })
        .success,
    ).toBe(false);
    expect(
      dw.DesignProject.safeParse({ ...project, chat: [{ role: "user", text: "" , at: "2026-09-04T08:00:00.000Z" }] })
        .success,
    ).toBe(false);
  });
  it("缺任何一个必填键即拒（linkedFeedbackId 必须显式给 null，不能省略）", () => {
    const { linkedFeedbackId: _omit, ...rest } = project;
    expect(dw.DesignProject.safeParse(rest).success).toBe(false);
  });
});

describe("createProject.in", () => {
  const schema = dw.operations.createProject.in;
  it("最小合法输入", () => {
    expect(schema.safeParse({ name: "新项目", template: "ui" }).success).toBe(true);
  });
  it("带 problem 与 linkedFeedbackId", () => {
    expect(
      schema.safeParse({ name: "新项目", template: "mobile", problem: "背景", linkedFeedbackId: "fb-9" }).success,
    ).toBe(true);
  });
  it("name 为空拒；缺 template 拒", () => {
    expect(schema.safeParse({ name: "", template: "ui" }).success).toBe(false);
    expect(schema.safeParse({ name: "x" }).success).toBe(false);
  });
  it("不接受 criteria/frames/chat（服务端填，前端传了即拒）", () => {
    expect(schema.safeParse({ name: "x", template: "ui", criteria: [] }).success).toBe(false);
    expect(schema.safeParse({ name: "x", template: "ui", frames: [] }).success).toBe(false);
    expect(schema.safeParse({ name: "x", template: "ui", chat: [] }).success).toBe(false);
  });
});

describe("listMyProjects.in", () => {
  const schema = dw.operations.listMyProjects.in;
  it("空 query 合法", () => {
    expect(schema.safeParse({}).success).toBe(true);
  });
  it("q 超过 200 字拒", () => {
    expect(schema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });
});

describe("updateProject.in", () => {
  const schema = dw.operations.updateProject.in;
  it("只改 name", () => {
    expect(schema.safeParse({ projectId: "dp-1", name: "改名了" }).success).toBe(true);
  });
  it("不接受 criteria/frames/chat", () => {
    expect(schema.safeParse({ projectId: "dp-1", criteria: [] }).success).toBe(false);
  });
  it("name 传空字符串拒（即便是可选字段，传了就要满足 min(1)）", () => {
    expect(schema.safeParse({ projectId: "dp-1", name: "" }).success).toBe(false);
  });
});

describe("appendProjectChat.in", () => {
  const schema = dw.operations.appendProjectChat.in;
  it("合法输入", () => {
    expect(schema.safeParse({ projectId: "dp-1", text: "先做移动端" }).success).toBe(true);
  });
  it("text 为空拒；超过 4000 字拒", () => {
    expect(schema.safeParse({ projectId: "dp-1", text: "" }).success).toBe(false);
    expect(schema.safeParse({ projectId: "dp-1", text: "x".repeat(4001) }).success).toBe(false);
  });
});

describe("pushToInbox", () => {
  it("in：note 可选", () => {
    const schema = dw.operations.pushToInbox.in;
    expect(schema.safeParse({ projectId: "dp-1" }).success).toBe(true);
    expect(schema.safeParse({ projectId: "dp-1", note: "给工程的说明" }).success).toBe(true);
  });
  it("out：inboxCode 必须是 D-n 形状", () => {
    const schema = dw.operations.pushToInbox.out;
    expect(schema.safeParse({ project, inboxCode: "D-2" }).success).toBe(true);
    expect(schema.safeParse({ project, inboxCode: "B-2" }).success).toBe(false);
    expect(schema.safeParse({ project, inboxCode: "D2" }).success).toBe(false);
  });
  it("错误码里没有 ALREADY_PUSHED（幂等 = upsert，见文件头）", () => {
    expect(dw.DesignWorkbenchError.options).not.toContain("ALREADY_PUSHED");
  });
});

describe("deepenFeedback", () => {
  it("in：只接 feedbackId，多传别的字段拒（不接受调用方拼 name/problem/template）", () => {
    const schema = dw.operations.deepenFeedback.in;
    expect(schema.safeParse({ feedbackId: "fb-1" }).success).toBe(true);
    expect(schema.safeParse({ feedbackId: "fb-1", name: "自己拼的标题" }).success).toBe(false);
  });
  it("out：project + created 布尔（幂等命中已存在项目时 created=false）", () => {
    const schema = dw.operations.deepenFeedback.out;
    expect(schema.safeParse({ project, created: true }).success).toBe(true);
    expect(schema.safeParse({ project, created: false }).success).toBe(true);
    expect(schema.safeParse({ project }).success).toBe(false);
  });
  it("错误码里没有 NOT_PROJECT_OWNER：命中已有项目时不判断请求者是不是 owner", () => {
    expect([...dw.operations.deepenFeedback.err]).not.toContain("NOT_PROJECT_OWNER");
  });
  it("route 挂在 /feedback 命名空间下（B4.4 backlog 原文路径）", () => {
    expect(dw.operations.deepenFeedback.path).toBe("/feedback/:feedbackId/deepen");
  });
});

describe("错误码闭集：每个操作的 err 都在 DesignWorkbenchError 里", () => {
  it("逐操作校验", () => {
    for (const op of Object.values(dw.operations)) {
      for (const e of op.err) expect(dw.DesignWorkbenchError.options).toContain(e);
    }
  });
  it("NOT_PROJECT_OWNER 存在（仅 owner 可改/删/推送/发消息）", () => {
    expect(dw.DesignWorkbenchError.options).toContain("NOT_PROJECT_OWNER");
  });
});
