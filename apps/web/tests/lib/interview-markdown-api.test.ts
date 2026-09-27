import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initializeInterviewMarkdown, loadInterviewMarkdown, saveInterviewMarkdown, confirmInterviewMarkdown, generateInterviewMarkdown, uploadInterviewMarkdownAttachment } from "@/lib/interview-markdown-api";

const markdown = "# 需求\r\n\r\n中文 🧪 `a_b`\r\n| 问题 | 场景 |\r\n| --- | --- |\r\n| 备课 | 教师 |\r\n";
const envelope = { interviewId: "itv-md-ui", revisionId: "revision-ui", version: 4,
  documents: [{ documentId: "document-ui", step: "intake", version: 2, markdown,
    contentHash: "a".repeat(64), evidenceMode: "simulated", references: [] }],
  states: [{ documentId: "document-ui", status: "draft", failure: null }] };
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4100"); vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", ""); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("empty legacy source is hydrated by explicit versioned initialization", async () => {
  const writes: unknown[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST") { expect(url).toContain("/markdown/initialize"); writes.push(JSON.parse(String(init.body))); return new Response(JSON.stringify(envelope)); }
    return new Response(JSON.stringify({ ...envelope, documents: [], states: [] }));
  });
  expect((await initializeInterviewMarkdown("itv-md-ui")).documents[0]?.markdown).toBe(markdown);
  expect(writes).toEqual([{ expectedVersion: 4 }]);
});

it("importsTextAsMarkdown preserves raw bytes through the draft API", async () => {
  let captured: RequestInit | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    captured = init;
    return new Response(JSON.stringify(envelope), { status: 201 });
  });
  const saved = await saveInterviewMarkdown("itv-md-ui", "intake", { markdown, expectedVersion: 3, expectedDocumentVersion: 1 });
  expect(JSON.parse(String(captured?.body))).toEqual({ markdown, expectedVersion: 3, expectedDocumentVersion: 1 });
  expect(saved.documents[0]?.markdown).toBe(markdown);
});

it("loads and validates the source envelope instead of a legacy research JSON projection", async () => {
  let path = "";
  vi.stubGlobal("fetch", async (url: string) => { path = new URL(url).pathname; return new Response(JSON.stringify(envelope)); });
  expect((await loadInterviewMarkdown("itv-md-ui")).documents[0]?.markdown).toBe(markdown);
  expect(path).toBe("/interviews/digital/itv-md-ui/markdown");
});

it("confirmation and generation send versions only, not client evidence or research copies", async () => {
  const writes: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => { writes.push(JSON.parse(String(init.body))); return new Response(JSON.stringify(envelope)); });
  await confirmInterviewMarkdown("itv-md-ui", "intake", { expectedVersion: 4, expectedDocumentVersion: 2 });
  await generateInterviewMarkdown("itv-md-ui", "analysis", { expectedVersion: 5, expectedDocumentVersion: 0 });
  expect(writes).toEqual([{ expectedVersion: 4, expectedDocumentVersion: 2 }, { expectedVersion: 5, expectedDocumentVersion: 0 }]);
});

it("rejects a malformed source response instead of silently rendering partial metadata", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ...envelope, documents: [{ ...envelope.documents[0], evidenceMode: "approved" }] })));
  await expect(loadInterviewMarkdown("itv-md-ui")).rejects.toThrow();
});
it("uploads original bytes as multipart and receives canonical draft without implicit confirmation", async () => {
  const original = { assetId: "asset-file", filename: "需求.csv", mime: "text/csv", bytes: 5, sha256: "a".repeat(64) };
  const file = new File(["a,b\n1"], original.filename, { type: original.mime });
  const request = vi.fn(async (url: string, init: RequestInit) => {
    expect(new URL(url).pathname).toBe("/interviews/digital/itv-md-ui/markdown/attachments");
    expect(new URL(url).searchParams.get("expectedVersion")).toBe("4");
    expect(new URL(url).searchParams.get("expectedDocumentVersion")).toBe("2");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBe(file);
    expect(init.headers).not.toHaveProperty("Content-Type");
    return new Response(JSON.stringify({ source: envelope, original }));
  });
  vi.stubGlobal("fetch", request);
  const result = await uploadInterviewMarkdownAttachment("itv-md-ui", file, { expectedVersion: 4, expectedDocumentVersion: 2 });
  expect(result.source.documents[0]?.markdown).toBe(markdown);
  expect(result.source.states[0]?.status).toBe("draft");
  expect(request).toHaveBeenCalledTimes(1);
});
