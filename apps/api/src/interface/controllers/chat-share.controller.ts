import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Header, HttpCode, Inject, NotFoundException, Param, PayloadTooLargeException, Post, ServiceUnavailableException } from "@nestjs/common";
import { chatShare as C } from "@repo/contracts";
import { CHAT_SHARE_SERVICE, ChatShareService, ShareChangedError, ShareEmptyError, ShareTooLargeError, ShareUnavailableError } from "../../application/chat/share-chat";
import { ThreadNotVisibleError } from "../../application/chat/get-thread";
import { AuthzUnavailableError } from "../../application/chat/resolve-visibility";
import { ObjectMissingError } from "../../application/chat/get-attachment-content";
import { toOrgId } from "../../domain/org-id";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { Public } from "../public.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

@Controller()
export class ChatShareController {
  constructor(@Inject(CHAT_SHARE_SERVICE) private readonly service: ChatShareService) {}
  private actor(principal: Principal, threadId: string) {
    assertPrincipal(principal);
    return { userId: principal.userId, orgId: toOrgId(principal.orgId), threadId };
  }
  private async respond<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (error) {
      if (error instanceof ThreadNotVisibleError) throw new NotFoundException();
      if (error instanceof ShareChangedError) throw new ConflictException({ reasonCode: "SHARE_PREVIEW_CHANGED" });
      if (error instanceof ShareTooLargeError) throw new PayloadTooLargeException({ reasonCode: "SHARE_TOO_LARGE" });
      if (error instanceof ShareEmptyError) throw new BadRequestException({ reasonCode: "SHARE_EMPTY" });
      if (error instanceof ShareUnavailableError || error instanceof ObjectMissingError || error instanceof AuthzUnavailableError) throw new ServiceUnavailableException();
      throw error;
    }
  }
  @Get(C.paths.preview)
  @Header("Cache-Control", "no-store")
  preview(@CurrentPrincipal() p: Principal, @Param("threadId") threadId: string) {
    return this.respond(() => this.service.preview(this.actor(p, threadId)));
  }
  @Post(C.paths.manage)
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() p: Principal, @Param("threadId") threadId: string, @Body(new ZodBodyPipe(C.CreateInput)) body: { revision: string }) {
    return this.respond(() => this.service.create(this.actor(p, threadId), body.revision));
  }
  @Get(C.paths.manage)
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() p: Principal, @Param("threadId") threadId: string) {
    return this.respond(() => this.service.list(this.actor(p, threadId)));
  }
  @Delete(C.paths.revoke)
  @HttpCode(204)
  revoke(@CurrentPrincipal() p: Principal, @Param("threadId") threadId: string, @Param("shareId") shareId: string) {
    return this.respond(() => this.service.revoke(this.actor(p, threadId), shareId));
  }
  @Public()
  @Get(C.paths.read)
  @Header("Cache-Control", "no-store, max-age=0")
  @Header("X-Robots-Tag", "noindex, nofollow, noarchive")
  @Header("Referrer-Policy", "no-referrer")
  read(@Param("token") token: string) {
    return this.respond(() => this.service.read(token));
  }
}
