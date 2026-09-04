/**
 * UC-17.8 B4.3 —— `buildDesignInboxItems` 单独测——过滤/编号/`body` 回退规则,
 * 不经过完整的 `listInbox`（那部分的聚合已在 `tests/inbox/list-inbox.test.ts` 覆盖）。
 */
import { describe, expect, it } from "vitest";
import { buildDesignInboxItems } from "../../src/application/inbox/inbox-projection";
import type { DesignProjectView } from "../../src/application/design-workbench/project-shared";

function designView(over: Partial<DesignProjectView> = {}): DesignProjectView {
  return {
    id: "dp-1",
    name: "项目 A",
    template: "wireframe",
    problem: "",
    criteria: [],
    frames: [],
    pushed: true,
    pushedAt: "2026-09-04T00:00:00.000Z",
    linkedFeedbackId: null,
    chat: [],
    ownerId: "u-1",
    ownerName: "张三",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    ...over,
  };
}

describe("buildDesignInboxItems", () => {
  it("未推送的项目不出现", () => {
    const out = buildDesignInboxItems([designView({ id: "dp-1", pushed: false })]);
    expect(out).toHaveLength(0);
  });

  it("stage 恒 backlog，kind 恒 design", () => {
    const out = buildDesignInboxItems([designView()]);
    expect(out[0]!.item.stage).toBe("backlog");
    expect(out[0]!.item.kind).toBe("design");
  });

  it("body 回退到 problem，都为空则 null", () => {
    const withProblem = buildDesignInboxItems([designView({ id: "dp-1", problem: "登录页崩溃" })]);
    expect(withProblem[0]!.item.body).toBe("登录页崩溃");

    const empty = buildDesignInboxItems([designView({ id: "dp-2", problem: "" })]);
    expect(empty[0]!.item.body).toBeNull();
  });

  it("reporter 取 ownerName，linkedFeedbackId 透传，resolvedByDesignId 恒 null", () => {
    const out = buildDesignInboxItems([designView({ ownerName: "李四", linkedFeedbackId: "fb-9" })]);
    expect(out[0]!.item.reporter).toBe("李四");
    expect(out[0]!.item.linkedFeedbackId).toBe("fb-9");
    expect(out[0]!.item.resolvedByDesignId).toBeNull();
  });

  it("编号 D-n 只在已推送的行里按创建顺序赋号", () => {
    const out = buildDesignInboxItems([
      designView({ id: "dp-2", createdAt: "2026-09-02T00:00:00.000Z" }),
      designView({ id: "dp-1", createdAt: "2026-09-01T00:00:00.000Z" }),
      designView({ id: "dp-3", pushed: false, createdAt: "2026-09-03T00:00:00.000Z" }),
    ]);
    const byId = new Map(out.map((k) => [k.item.id, k.item.code]));
    expect(byId.get("dp-1")).toBe("D-1");
    expect(byId.get("dp-2")).toBe("D-2");
    expect(byId.get("dp-3")).toBeUndefined();
  });
});
