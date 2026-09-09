import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { executeQueuedTrialRuns, type ExecuteTrialRunDeps } from "../../src/application/skill/execute-trial-run";
import { toOrgId } from "../../src/domain/org-id";

const file = (path: string, content: string) => ({ path, contentBase64: Buffer.from(content).toString("base64"), mediaType: "text/plain", digest: createHash("sha256").update(content).digest("hex") });
function fixture(versionId = "version-new") {
  const files = [file("SKILL.md", "Read references/value.txt"), file("references/value.txt", "only-in-reference-v2")];
  const succeed = vi.fn(), fail = vi.fn();
  const sandbox = vi.fn(async (_input: unknown) => ({ exitCode: 0, stdout: "ok", stderr: "", files: [{name:"result.txt",contentBase64:"b2s=",sizeBytes:2}], timedOut:false, durationMs:1 }));
  const complete = vi.fn(async (_input: unknown) => ({ text: "```run_script\nconsole.log('ok')\n```", tokens: 1 }));
  const deps = {
    store: { claimQueued: async () => [{ id:"trial",actorId:"actor",versionId:"version-new",sampleInput:"read reference" }], succeed, fail },
    runs: { readPinnedSkills: async () => [{versionId:"version-new",content:"Read references/value.txt", package:{skillId:"skill",versionId,files}}] },
    model: { complete }, sandbox:{run:sandbox}, objects:{putOnce:async()=>undefined},
    modelProvider:"test",modelId:"test",log:()=>undefined,
  } as unknown as ExecuteTrialRunDeps;
  return {deps,files,sandbox,complete,succeed,fail};
}
describe("fixed-version trial package mounting", () => {
  it("passes every immutable package file to the sandbox and tells the model its actual input root", async () => {
    const f=fixture(); await executeQueuedTrialRuns(f.deps,{orgId:toOrgId("org")});
    expect(f.fail).not.toHaveBeenCalled(); expect(f.succeed).toHaveBeenCalledWith(expect.objectContaining({output:"ok"}));
    expect(f.sandbox.mock.calls[0]?.[0]).toMatchObject({inputFiles:f.files.map(x=>({name:x.path,contentBase64:x.contentBase64}))});
    expect(f.complete.mock.calls[0]?.[0]).toMatchObject({system:expect.stringContaining("SKILL_SANDBOX_INPUT_DIR")});
  });
  it("rejects a package belonging to another version before model or sandbox execution", async () => {
    const f=fixture("version-old"); await executeQueuedTrialRuns(f.deps,{orgId:toOrgId("org")});
    expect(f.fail).toHaveBeenCalledWith(expect.objectContaining({code:"DEPENDENCY_UNAVAILABLE"}));
    expect(f.complete).not.toHaveBeenCalled();expect(f.sandbox).not.toHaveBeenCalled();
  });
});
