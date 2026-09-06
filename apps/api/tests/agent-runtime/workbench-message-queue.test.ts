import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/application/chat/resolve-visibility",()=>({resolveVisibility:async()=>({kind:"allow",actor:{},thread:{}})}));
vi.mock("../../src/application/chat/message-roundtrip",()=>({acceptHumanMessage:vi.fn(),AgentNotPublishedError:class extends Error{},MessageThreadNotVisibleError:class extends Error{},MessageNoWriteRoleError:class extends Error{},MessageThreadArchivedError:class extends Error{},MessageIdempotencyConflictError:class extends Error{}}));
import { acceptHumanMessage, MessageNoWriteRoleError } from "../../src/application/chat/message-roundtrip";
import { ThreadMessageQueue } from "../../src/infrastructure/chat-queue/thread-message-queue";
import { EnqueueMessage } from "@repo/contracts/thread-message-queue";
const row={id:"12345678-1234-4234-8234-123456789abc",client_request_id:"12345678-1234-4234-8234-123456789abc",body:"next",agent_id:"agent",actor_id:"actor",thread_id:"thread",status:"pending",run_id:null,created_at:new Date(),error_code:null};
function fixture() {
  const query=vi.fn(async(sql:string)=>({rows:sql.includes("SELECT q.*")?[row]:[]}));
  const kick=vi.fn();
  const deps={db:{withoutTenant:async(fn:Function)=>fn({query:async()=>({rows:[{org_id:"org"}]})}),withTenant:async(_org:string,fn:Function)=>fn({query})},executor:{kick},logger:{error:vi.fn()}};
  return {queue:new ThreadMessageQueue(deps as unknown as ConstructorParameters<typeof ThreadMessageQueue>[0]),query,kick};
}
describe("durable next-turn queue dispatcher",()=>{
  it("accepts omitted/default agents without inventing a frontend agent identity",()=>{expect(EnqueueMessage.parse({clientRequestId:row.id,text:"next",agentId:null}).agentId).toBeNull();});
  it("dispatches through existing acceptance with the queue's stable idempotency identity",async()=>{
    vi.mocked(acceptHumanMessage).mockResolvedValue({} as never);
    const f=fixture();await f.queue.pump();
    expect(acceptHumanMessage).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({queuedMessageId:row.id,clientMessageId:row.client_request_id,userId:"actor",text:"next"}));
    expect(f.kick).toHaveBeenCalledWith("org");
  });
  it("keeps a transient delivery failure pending for restart retry",async()=>{
    vi.mocked(acceptHumanMessage).mockRejectedValue(new Error("temporary database failure"));
    const f=fixture();await f.queue.pump();
    expect(f.query.mock.calls.some(([sql])=>sql.includes("status='failed'"))).toBe(false);
  });
  it("marks revoked-write delivery failed instead of starting it",async()=>{
    vi.mocked(acceptHumanMessage).mockRejectedValue(new MessageNoWriteRoleError());
    const f=fixture();await f.queue.pump();
    expect(f.query.mock.calls.some(([sql])=>sql.includes("status='failed'"))).toBe(true);
  });
});
