import { describe, expect, it, vi } from "vitest";
import { AgentArtifactController } from "../../src/interface/controllers/agent-artifact.controller";
import { continueArtifact } from "../../src/application/artifacts-steering/continue-artifact";
import { MessageIdempotencyConflictError } from "../../src/application/chat/message-roundtrip";
import type { Principal } from "../../src/domain/principal";
vi.mock("../../src/application/artifacts-steering/continue-artifact",()=>({continueArtifact:vi.fn()}));
describe("artifact continuation HTTP contract",()=>{
  it("returns 409 for an already used request key with conflicting continuation",async()=>{
    vi.mocked(continueArtifact).mockRejectedValue(new MessageIdempotencyConflictError());
    const dependencies=[] as unknown as ConstructorParameters<typeof AgentArtifactController>;
    const controller=new AgentArtifactController(...dependencies);
    await expect(controller.continue({orgId:"org-a",userId:"user-a"} as Principal,"artifact-a",{
      basedOnVersion:2,instruction:"a different edit",clientRequestId:"12345678-1234-4234-8234-123456789abc",
    })).rejects.toMatchObject({status:409,message:"artifact_continuation_idempotency_conflict"});
    expect(continueArtifact).toHaveBeenCalled();
  });
});
