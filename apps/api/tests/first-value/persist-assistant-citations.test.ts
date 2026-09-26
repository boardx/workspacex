/**
 * E3 —— assistant 回答引用的写入侧（`persist-assistant-citations.ts`）+ 价值时刻记录。
 * 纯单元：仓储用内存假件，语义同 `PgChatRepository.insertCitations` 的
 * `(org_id, message_id, idx)` 唯一 + ON CONFLICT DO NOTHING。
 */
import { describe, expect, it, vi } from "vitest";
import { FirstValueRecorder, type FirstValueFactStore } from "../../src/application/first-value/first-value-recorder";
import {
  CrossOrgCitationError, InvalidCitationError, persistAssistantCitations,
  type ChatCitationWriter, type NewAssistantCitation,
} from "../../src/application/chat/persist-assistant-citations";
import { writeBackPendingRuns } from "../../src/application/agent-run/writeback";
import type { OrgId } from "../../src/domain/org-id";

const A = "org-a" as OrgId;
const B = "org-b" as OrgId;

function memoryWriter(): ChatCitationWriter & { rows: Map<string, NewAssistantCitation> } {
  const messages = new Map<string, OrgId>([["m-a", A], ["m-b", B]]);
  const artifacts = new Map<string, OrgId>([["art-a", A], ["art-b", B]]);
  const rows = new Map<string, NewAssistantCitation>();
  return {
    rows,
    messageExists: async (org, id) => messages.get(id) === org,
    artifactExists: async (org, id) => artifacts.get(id) === org,
    insertCitations: async (org, messageId, cs) => {
      let n = 0;
      for (const c of cs) {
        const k = `${org}|${messageId}|${c.index}`;
        if (!rows.has(k)) { rows.set(k, c); n++; }
      }
      return n;
    },
  };
}
function memoryFacts(): FirstValueFactStore & { rows: Map<string, Date> } {
  const rows = new Map<string, Date>();
  return {
    rows,
    recordFirst: async (o, s, at) => { if (!rows.has(`${o}|${s}`)) rows.set(`${o}|${s}`, at); },
    listForOrg: async () => [],
  };
}
const logger = () => ({ info: vi.fn(), error: vi.fn() });
const flush = () => new Promise((r) => setTimeout(r, 0));
const cite = (over: Partial<NewAssistantCitation> = {}): NewAssistantCitation => ({
  index: 1, sourceFullName: "季度报告.pdf", anchorKind: "page", anchorPage: 3,
  anchorRange: null, anchorMessageId: null, sourceArtifactId: "art-a", ...over,
});

describe("persistAssistantCitations", () => {
  it("写入本组织引用并记录价值时刻 cited_answer_own_material", async () => {
    const citations = memoryWriter();
    const facts = memoryFacts();
    const firstValue = new FirstValueRecorder(facts, logger());
    const r = await persistAssistantCitations({ citations, firstValue }, {
      orgId: A, messageId: "m-a",
      citations: [cite(), cite({ index: 2, sourceArtifactId: null, anchorKind: "message", anchorPage: null, anchorMessageId: "m-a" })],
    });
    await flush();
    expect(r.inserted).toBe(2);
    expect([...facts.rows.keys()]).toEqual(["org-a|cited_answer_own_material"]);
  });

  it("反例：引用指向别的组织的 artifact ⇒ 整批拒绝，一行不写，不记价值时刻", async () => {
    const citations = memoryWriter();
    const facts = memoryFacts();
    const firstValue = new FirstValueRecorder(facts, logger());
    await expect(persistAssistantCitations({ citations, firstValue }, {
      orgId: A, messageId: "m-a", citations: [cite(), cite({ index: 2, sourceArtifactId: "art-b" })],
    })).rejects.toBeInstanceOf(CrossOrgCitationError);
    await flush();
    expect(citations.rows.size).toBe(0);
    expect(facts.rows.size).toBe(0);
  });

  it("反例：消息属于别的组织 ⇒ 拒绝", async () => {
    const citations = memoryWriter();
    await expect(persistAssistantCitations({ citations }, { orgId: A, messageId: "m-b", citations: [cite()] }))
      .rejects.toMatchObject({ reason: "message_not_in_org" });
    expect(citations.rows.size).toBe(0);
  });

  it("幂等：同一回答写两次，第二次不插新行，价值时刻仍是第一次的时刻", async () => {
    const citations = memoryWriter();
    const facts = memoryFacts();
    let t = Date.parse("2026-09-24T00:00:00.000Z");
    const firstValue = new FirstValueRecorder(facts, logger(), () => new Date(t));
    const input = { orgId: A, messageId: "m-a", citations: [cite()] };
    expect((await persistAssistantCitations({ citations, firstValue }, input)).inserted).toBe(1);
    await flush();
    t += 60_000;
    expect((await persistAssistantCitations({ citations, firstValue }, input)).inserted).toBe(0);
    await flush();
    expect(citations.rows.size).toBe(1);
    expect(facts.rows.get("org-a|cited_answer_own_material")!.toISOString()).toBe("2026-09-24T00:00:00.000Z");
  });

  it("没有来源 artifact 的引用不算「自己的材料」，不记价值时刻", async () => {
    const facts = memoryFacts();
    const firstValue = new FirstValueRecorder(facts, logger());
    await persistAssistantCitations({ citations: memoryWriter(), firstValue }, {
      orgId: A, messageId: "m-a", citations: [cite({ sourceArtifactId: null })],
    });
    await flush();
    expect(facts.rows.size).toBe(0);
  });

  it("反例：锚点字段与 kind 不符 / 编号重复 ⇒ InvalidCitationError", async () => {
    const citations = memoryWriter();
    await expect(persistAssistantCitations({ citations }, { orgId: A, messageId: "m-a", citations: [cite({ anchorPage: null })] }))
      .rejects.toBeInstanceOf(InvalidCitationError);
    await expect(persistAssistantCitations({ citations }, { orgId: A, messageId: "m-a", citations: [cite(), cite()] }))
      .rejects.toMatchObject({ reason: "duplicate_index" });
    expect(citations.rows.size).toBe(0);
  });
});

describe("writeBackPendingRuns × 引用写入", () => {
  function deps(citations: ChatCitationWriter) {
    const log = vi.fn();
    const commitWriteback = vi.fn(async () => ({ messageId: "m-a" }));
    const d = {
      runs: {
        claimWritebackPending: async () => [{
          runId: "r1", threadId: "t1", inputMessageId: "h1", agentId: "ag", text: "答", attempts: 0,
          citations: [cite()],
        }],
        commitWriteback,
      } as never,
      clock: { now: () => "2026-09-24T00:00:00.000Z" } as never,
      log,
      citations: { citations },
    };
    return { d, log, commitWriteback };
  }

  it("回答写回成功后把引用写进该消息", async () => {
    const citations = memoryWriter();
    const { d, commitWriteback } = deps(citations);
    await writeBackPendingRuns(d, { orgId: A });
    expect(commitWriteback).toHaveBeenCalledOnce();
    expect([...citations.rows.keys()]).toEqual(["org-a|m-a|1"]);
  });

  it("引用写入失败只记日志，不把已写好的回答变成失败", async () => {
    const citations: ChatCitationWriter = { ...memoryWriter(), insertCitations: async () => { throw new Error("boom"); } };
    const { d, log } = deps(citations);
    await writeBackPendingRuns(d, { orgId: A });
    expect(log).toHaveBeenCalledWith("assistant citation persistence failed", expect.objectContaining({ runId: "r1" }));
    expect(log).not.toHaveBeenCalledWith("agent run chat writeback failed", expect.anything());
  });
});
