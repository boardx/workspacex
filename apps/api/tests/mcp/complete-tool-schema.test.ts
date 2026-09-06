import { describe, expect, it } from "vitest";
import { discoverMcpTools, fingerprint, toContractTool } from "../../src/application/mcp/discover-tools";
import { createInMemoryMcpToolStore } from "../../src/infrastructure/mcp/in-memory-mcp-tool-store";
import type { DiscoveredTool } from "../../src/application/mcp/ports";
const base: DiscoveredTool = { name: "search", signature: "search(filter) -> object", sideEffect: "只读",
  description: "Search records", inputSchema: { type: "object", properties: { filter: { type: "object", properties: { limit: { type: "integer", maximum: 10 } } } } },
  outputSchema: { type: "object", properties: { result: { type: "string" } } } };

describe("WX-E005 complete schema fingerprint", () => {
  it.each(["type", "nested", "output", "description"])("detects %s changes without renamed arguments and closes prior authorization", async kind => {
    const store = createInMemoryMcpToolStore();
    await store.replace("mcp-test",[toContractTool("mcp-test",base,"全体成员")]);
    const changed = { ...structuredClone(base) };
    if (kind === "type") changed.inputSchema = { ...base.inputSchema, properties: { filter: { type: "string" } } };
    if (kind === "nested") changed.inputSchema = { type: "object", properties: { filter: { type: "object", properties: { limit: { type: "integer", maximum: 20 } } } } };
    if (kind === "output") changed.outputSchema = { type: "object", properties: { result: { type: "number" } } };
    if (kind === "description") changed.description = "Changed description";
    const result = await discoverMcpTools({ store,gateway: { listTools: async () => [changed] } },{ serverId: "mcp-test",endpoint: "https://example.test" });
    expect(result.signatureChanged).toEqual(["mcp:test.search"]);
    expect(result.tools[0]!.authScope).toBe("未开放");
  });
  it("recursive object-key reordering preserves fingerprint and authorization", async () => {
    const reorder = (v: unknown): unknown => Array.isArray(v) ? v.map(reorder) : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).reverse().map(([k,x]) => [k,reorder(x)])) : v;
    const changed = reorder(base) as DiscoveredTool;
    expect(toContractTool("mcp-test",changed).schemaFingerprint).toBe(toContractTool("mcp-test",base).schemaFingerprint);
    const store = createInMemoryMcpToolStore();
    await store.replace("mcp-test",[toContractTool("mcp-test",base,"全体成员")]);
    const result = await discoverMcpTools({ store,gateway: { listTools: async () => [changed] } },{ serverId: "mcp-test",endpoint: "https://example.test" });
    expect(result.signatureChanged).toEqual([]);
    expect(result.tools[0]!.authScope).toBe("全体成员");
  });
  it("legacy records remain visibly incomplete and upgraded rediscovery requires authorization", async () => {
    const store = createInMemoryMcpToolStore();
    const legacy = { ...toContractTool("mcp-test",{ name: base.name,signature: base.signature,sideEffect: base.sideEffect },"全体成员"),schemaFingerprint: "old-16-byte-hash" };
    expect(legacy).not.toHaveProperty("inputSchema");
    await store.replace("mcp-test",[legacy]);
    const result = await discoverMcpTools({ store,gateway: { listTools: async () => [base] } },{ serverId: "mcp-test",endpoint: "https://example.test" });
    expect(result.tools[0]!.inputSchema).toEqual(base.inputSchema);
    expect(result.tools[0]!.authScope).toBe("未开放");
    expect(result.signatureChanged).toEqual([legacy.fullName]);
    expect(fingerprint("x()","只读")).toMatch(/^v2:[a-f0-9]{64}$/);
  });
});
