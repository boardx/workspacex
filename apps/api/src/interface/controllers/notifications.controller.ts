import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { NotificationReadInput, NotificationReadOutput } from "@repo/contracts/notifications";
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
  @Post("/read") @HttpCode(200)
  async markRead(@CurrentPrincipal() principal: Principal | null, @Body() body: unknown) {
    assertPrincipal(principal);
    const input = NotificationReadInput.safeParse(body ?? {});
    if (!input.success) throw new BadRequestException("invalid_notification_read");
    return NotificationReadOutput.parse(await this.center.markRead(principal, input.data));
  }
}
