import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Post, UnprocessableEntityException } from "@nestjs/common";
import { z } from "zod";
import { EnqueueMessage } from "@repo/contracts/thread-message-queue";
import { THREAD_MESSAGE_QUEUE, type ThreadMessageQueuePort, QueueNotVisibleError, QueueConflictError } from "../../application/chat/thread-message-queue";
import { AgentNotPublishedError } from "../../application/chat/message-roundtrip";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { CurrentPrincipal } from "../current-principal.decorator";
@Controller()
export class ThreadMessageQueueController {
  constructor(@Inject(THREAD_MESSAGE_QUEUE) private readonly queue:ThreadMessageQueuePort) {}
  private async guarded<T>(fn:()=>Promise<T>):Promise<T> {
    try {return await fn();} catch(error) {
      if(error instanceof QueueNotVisibleError) throw new NotFoundException();
      if(error instanceof QueueConflictError) throw new ConflictException("queue_item_conflict");
      if(error instanceof AgentNotPublishedError) throw new UnprocessableEntityException("AGENT_NOT_FOUND");
      throw error;
    }
  }
  @Get("/chat/threads/:threadId/queued-messages")
  list(@CurrentPrincipal() principal:Principal,@Param("threadId") threadId:string) {
    assertPrincipal(principal); return this.guarded(()=>this.queue.list(toOrgId(principal.orgId),principal.userId,threadId));
  }
  @Post("/chat/threads/:threadId/queued-messages")
  @HttpCode(201)
  enqueue(@CurrentPrincipal() principal:Principal,@Param("threadId") threadId:string,@Body() body:unknown) {
    assertPrincipal(principal);
    const parsed=EnqueueMessage.safeParse(body);
    if(!parsed.success) throw new BadRequestException("invalid_queued_message");
    return this.guarded(()=>this.queue.enqueue(toOrgId(principal.orgId),principal.userId,threadId,parsed.data));
  }
  @Delete("/chat/threads/:threadId/queued-messages/:id")
  cancel(@CurrentPrincipal() principal:Principal,@Param("threadId") threadId:string,@Param("id") id:string) {
    assertPrincipal(principal);
    if(!z.string().uuid().safeParse(id).success) throw new BadRequestException("invalid_queue_id");
    return this.guarded(()=>this.queue.cancel(toOrgId(principal.orgId),principal.userId,threadId,id));
  }
}
