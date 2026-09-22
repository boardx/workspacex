import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { NativeToolIdentities, nativeToolProvenance } from "../src/native-tool-identities";
import { ExecutionEvent } from "../src/execution-journal";

const catalog = JSON.parse(readFileSync(new URL("../../../docs/design/standard-capabilities/capability-catalog.json", import.meta.url), "utf8"));

it("keeps the generated runtime identities and development catalog in agreement", () => {
  const generated = JSON.parse(readFileSync(new URL("../../../apps/deep-agent-service/src/deep_agent_service/generated/native_tool_identities.json", import.meta.url), "utf8"));
  expect(generated).toEqual(NativeToolIdentities);
  for (const descriptor of NativeToolIdentities) {
    const entries = catalog.capabilities.filter((item: { id: string }) => item.id === descriptor.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].canonical_name).toBe(descriptor.canonicalName);
    // Upstream does not shape every tool as a `_create_<name>_tool` factory (#3014),
    // so this only holds the locator to a single module-qualified upstream symbol
    // naming the tool. Refusing a same-name in-house implementation is the runtime
    // verifier's job, not this assertion's: see the deep-agent-service counter-tests
    // in `tests/test_native_tool_identity.py`.
    expect(descriptor.source.locator).toMatch(/^[\w.]+:[\w.]+$/);
    expect(descriptor.source.locator).toContain(descriptor.canonicalName);
  }
});

it("attributes every tool the catalog sources wholly from upstream", () => {
  const upstream = catalog.capabilities
    .filter((item: { kind: string; source_refs: string[] }) => item.kind === "tool" && item.source_refs.length === 1 && item.source_refs[0] === "LC")
    .map((item: { id: string }) => item.id);
  expect(upstream).toEqual(NativeToolIdentities.map((descriptor) => descriptor.id));
});

it("never attributes legacy or unknown tools to the native implementation", () => {
  expect(nativeToolProvenance("read_file", false)).toEqual({});
  expect(nativeToolProvenance("invented", true)).toEqual({});
  expect(nativeToolProvenance("delete", true)).toMatchObject({ capability: { id: "WX-T007" } });
  expect(nativeToolProvenance("write_todos", true)).toMatchObject({ capability: { id: "WX-T009" } });
  expect(nativeToolProvenance("task", true)).toMatchObject({ capability: { id: "WX-T010" } });
});

it("retains validated native provenance on both public start and end events", () => {
  const common = { runId: "run", seq: 0, emittedAt: "2026-09-07T00:00:00Z", toolName: "read_file", toolCallId: "call", ...nativeToolProvenance("read_file", true) };
  expect(ExecutionEvent.parse({ ...common, kind: "tool_start", args: {} })).toMatchObject({ capability: { id: "WX-T002" } });
  expect(ExecutionEvent.parse({ ...common, kind: "tool_end", result: "text", ok: true })).toMatchObject({ capability: { id: "WX-T002" } });
  expect(ExecutionEvent.safeParse({ ...common, kind: "tool_start", args: {}, capability: { ...common.capability, id: "WX-S002" } }).success).toBe(false);
});
