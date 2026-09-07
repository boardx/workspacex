import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { NativeToolIdentities, nativeToolProvenance } from "../src/native-tool-identities";
import { ExecutionEvent } from "../src/execution-journal";

it("keeps the generated runtime identities and development catalog in agreement", () => {
  const generated = JSON.parse(readFileSync(new URL("../../../apps/deep-agent-service/src/deep_agent_service/generated/native_tool_identities.json", import.meta.url), "utf8"));
  expect(generated).toEqual(NativeToolIdentities);
  const catalog = JSON.parse(readFileSync(new URL("../../../docs/design/standard-capabilities/capability-catalog.json", import.meta.url), "utf8"));
  for (const descriptor of NativeToolIdentities) {
    const entries = catalog.capabilities.filter((item: { id: string }) => item.id === descriptor.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].canonical_name).toBe(descriptor.canonicalName);
    expect(descriptor.source.locator).toContain(`_create_${descriptor.canonicalName}_tool`);
  }
});

it("never attributes legacy or unknown tools to the native implementation", () => {
  expect(nativeToolProvenance("read_file", false)).toEqual({});
  expect(nativeToolProvenance("invented", true)).toEqual({});
  expect(nativeToolProvenance("delete", true)).toMatchObject({ capability: { id: "WX-T007" } });
});

it("retains validated native provenance on both public start and end events", () => {
  const common = { runId: "run", seq: 0, emittedAt: "2026-09-07T00:00:00Z", toolName: "read_file", toolCallId: "call", ...nativeToolProvenance("read_file", true) };
  expect(ExecutionEvent.parse({ ...common, kind: "tool_start", args: {} })).toMatchObject({ capability: { id: "WX-T002" } });
  expect(ExecutionEvent.parse({ ...common, kind: "tool_end", result: "text", ok: true })).toMatchObject({ capability: { id: "WX-T002" } });
  expect(ExecutionEvent.safeParse({ ...common, kind: "tool_start", args: {}, capability: { ...common.capability, id: "WX-S002" } }).success).toBe(false);
});
