/**
 * AG02 —— starter-pack toolPolicy 放宽为能力分类（03-agent-role.md R3 ②，ADR-120 #2）。
 * `AgentStarterPackEntry.toolPolicy` 只接受能力分类字符串；凭证对象、token、供应商 ID、URL 一律拒绝。
 */
import { describe, expect, it } from "vitest";
import { agentRole as R, wave2Runtime as W } from "../../src/index";

const entry = (toolPolicy: unknown) => ({
  stableName: "research-agent",
  name: "Research Agent",
  semanticVersion: "1.0.0",
  instructions: "Research carefully.",
  instructionDigest: "a".repeat(64),
  skillVersions: [],
  modelProvider: "dashscope",
  modelId: "qwen-plus",
  toolPolicy,
});

const ACCEPT: unknown[] = [[], ["knowledge.search"], ["knowledge.search", "crm.read", "mail.send"], ["doc-store.read"]];
const REJECT: unknown[] = [
  [{ token: "x" }], ["Knowledge.Search"], ["https://api.openai.com"], ["openai"], ["sk-abc123"],
  ["knowledge."], [""], [1], [null], "knowledge.search", ["a." + "b".repeat(70)],
  Array.from({ length: 65 }, (_, i) => `cat.c${i}`),
];

describe("AG02 StarterPackToolPolicy", () => {
  it.each(ACCEPT.map((v) => ({ v })))("accepts capability categories $v", ({ v }) => {
    expect(R.StarterPackToolPolicy.safeParse(v).success).toBe(true);
    expect(W.AgentStarterPackEntry.safeParse(entry(v)).success).toBe(true);
  });

  it.each(REJECT.map((v) => ({ v })))("rejects non-category value $v", ({ v }) => {
    expect(R.StarterPackToolPolicy.safeParse(v).success).toBe(false);
    expect(W.AgentStarterPackEntry.safeParse(entry(v)).success).toBe(false);
  });

  it("entry toolPolicy is the same schema as StarterPackToolPolicy (single source)", () => {
    expect(W.AgentStarterPackEntry.shape.toolPolicy).toBe(R.StarterPackToolPolicy);
  });

  it("rejection points at the toolPolicy field path", () => {
    const r = W.AgentStarterPackEntry.safeParse(entry([{ token: "x" }]));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path.slice(0, 2)).toEqual(["toolPolicy", 0]);
  });
});
