/**
 * issue #4179（F17 手动入口 ②）—— 记忆面板「+ 记一条」：手打一句话，走 F17 已有的「记住」确认卡
 * 路径（`cards.open(..., { kind: "remember", statement })`），不新增契约操作。
 *
 * 本组件测试只钉 `KnowledgePanel` 这一层的接线：提交后发出的是 `requestRememberStatement`
 * 请求（`lib/knowledge-graph-events.ts`），真正把它送进 `detectMemoryIntent` → `cards.open`
 * 的是订阅方 `copilotkit-v2-panel-body.tsx` 的 `send()`——那是另一层集成，不在这里断言。
 * 断言的是「请求被发出、input 被清空收起」，不是「某条 claim 被确认」。
 *
 * 与消息 hover「记住这句」（`copilotkit-v2-panel-user-message.test.tsx`）共用同一个事件，
 * 是同一个后端操作的两个前端入口（issue 原文：不新增契约操作）。
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { knowledgeGraph, type KgObject, type KgClaim } from "@repo/contracts/chat-knowledge-graph";
import { KnowledgePanel } from "@/components/chat/knowledge/knowledge-panel";
import { onRememberStatement } from "@/lib/knowledge-graph-events";
import type { ThreadKnowledge } from "@/lib/knowledge-graph-api";

const SCOPE = { kind: "chat_session", id: "thr-remember-1" } as const;

function object(id: string, kind: KgObject["kind"], name: string): KgObject {
  return { id, scope: SCOPE, kind, name, aliases: [], createdBy: "model", claimCount: 1 };
}

function claim(id: string): KgClaim {
  return {
    id, scope: SCOPE, kind: "fact", statement: "客户 B 需要中文界面。", status: "proposed", triState: "pending",
    confidence: 0.8, createdBy: "model", reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null,
    aboutObjectIds: [], supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-24T08:00:00Z",
  };
}

function knowledge(overrides: Partial<ThreadKnowledge> = {}): ThreadKnowledge {
  return knowledgeGraph.getThreadKnowledge.out.parse({
    scope: SCOPE,
    revision: 3,
    objects: [object("obj-a", "person", "王五")],
    claims: [claim("c-1")],
    edges: [],
    ingestion: { queued: 0, running: 0, failed: 0, failures: [] },
    extractionActive: true,
    canEdit: true,
    canPromote: false,
    visibility: "owner_only",
    ...overrides,
  });
}

describe("issue #4179 —— 记忆面板「+ 记一条」", () => {
  it("只在可编辑（canEdit + 有 writeActions）时出现；只读面板不画这个入口", () => {
    const writeActions = { apply: vi.fn(async () => {}) };
    const { rerender } = render(
      <KnowledgePanel status="ready" data={knowledge()} writeActions={writeActions} />,
    );
    expect(screen.getByTestId("kg-remember-quick-add-open")).toBeInTheDocument();

    rerender(<KnowledgePanel status="ready" data={knowledge({ canEdit: false })} />);
    expect(screen.queryByTestId("kg-remember-quick-add-open")).not.toBeInTheDocument();
  });

  it("展开输入框、打字、提交 ⇒ 发出 requestRememberStatement，不直接确认任何 claim；随后收起并清空", () => {
    const writeActions = { apply: vi.fn(async () => {}) };
    render(<KnowledgePanel status="ready" data={knowledge()} writeActions={writeActions} />);

    fireEvent.click(screen.getByTestId("kg-remember-quick-add-open"));
    const input = screen.getByTestId("kg-remember-quick-add-input");
    fireEvent.change(input, { target: { value: "  下周一（9/29）上线 v2  " } });

    const received: string[] = [];
    const unsubscribe = onRememberStatement((statement) => received.push(statement));
    try {
      fireEvent.click(screen.getByTestId("kg-remember-quick-add-submit"));
      // 提交只发出请求——本仓从没直接调过 `applyHumanAction`/`confirmClaims` 之类的写口。
      expect(received).toEqual(["下周一（9/29）上线 v2"]);
      expect(writeActions.apply).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
    // 表单收起、回到「+ 记一条」按钮态，下次要记再展开。
    expect(screen.getByTestId("kg-remember-quick-add-open")).toBeInTheDocument();
    expect(screen.queryByTestId("kg-remember-quick-add-input")).not.toBeInTheDocument();
  });

  it("空白文字 ⇒「记住」按钮禁用，不发请求", () => {
    const writeActions = { apply: vi.fn(async () => {}) };
    render(<KnowledgePanel status="ready" data={knowledge()} writeActions={writeActions} />);
    fireEvent.click(screen.getByTestId("kg-remember-quick-add-open"));
    fireEvent.change(screen.getByTestId("kg-remember-quick-add-input"), { target: { value: "   " } });
    expect(screen.getByTestId("kg-remember-quick-add-submit")).toBeDisabled();
  });

  it("「取消」⇒ 收起表单，不发任何请求", () => {
    const writeActions = { apply: vi.fn(async () => {}) };
    render(<KnowledgePanel status="ready" data={knowledge()} writeActions={writeActions} />);
    fireEvent.click(screen.getByTestId("kg-remember-quick-add-open"));
    fireEvent.change(screen.getByTestId("kg-remember-quick-add-input"), { target: { value: "随手记一条" } });

    const received: string[] = [];
    const unsubscribe = onRememberStatement((statement) => received.push(statement));
    try {
      fireEvent.click(screen.getByTestId("kg-remember-quick-add-cancel"));
      expect(received).toEqual([]);
    } finally {
      unsubscribe();
    }
    expect(screen.getByTestId("kg-remember-quick-add-open")).toBeInTheDocument();
  });
});
