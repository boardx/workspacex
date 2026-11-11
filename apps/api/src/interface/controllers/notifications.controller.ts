import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post } from "@nestjs/common";
import { NotificationId, NotificationReadInput, NotificationReadOutput } from "@repo/contracts/notifications";
import { NOTIFICATION_CENTER, type NotificationCenter } from "../../application/notifications/notification-center";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
@Controller("/notifications")
export class NotificationsController {
  constructor(@Inject(NOTIFICATION_CENTER) private readonly center: NotificationCenter) {}
  @Get()
  list(@CurrentPrincipal() principal: Principal | null) {
    assertPrincipal(principal);
    return this.center.list(principal);
  }
  @Get("/:id")
  async get(@CurrentPrincipal() principal: Principal | null, @Param("id") rawId: string) {
    assertPrincipal(principal);
    const id = NotificationId.safeParse(rawId);
    if (!id.success) throw new NotFoundException();
    const notification = await this.center.get(principal, id.data);
    if (!notification) throw new NotFoundException();
    return notification;
  }
  @Post("/read") @HttpCode(200)
  async markRead(@CurrentPrincipal() principal: Principal | null, @Body() body: unknown) {
    assertPrincipal(principal);
    const input = NotificationReadInput.safeParse(body ?? {});
    if (!input.success) throw new BadRequestException("invalid_notification_read");
    return NotificationReadOutput.parse(await this.center.markRead(principal, input.data));
  }
}
