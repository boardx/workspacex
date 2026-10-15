import { traceIdOf } from "../middleware/trace";
import { Controller, Post, Req, Res, Inject } from "@nestjs/common";
import type { Request, Response } from "express";
import { operations } from "@repo/contracts/billing-credits";
import { Public } from "../public.decorator";
import { BillingWechatNotifyService } from "../../application/billing/billing-wechat-notify-service";
@Controller()
export class BillingWechatNotifyController {
  constructor(@Inject(BillingWechatNotifyService) private readonly service: BillingWechatNotifyService) {}
  @Public()
  @Post(operations.wechatNotify.path)
  async notify(@Req() req: Request, @Res() res: Response): Promise<void> {
    const response = await this.service.handle(req.body, req.headers, traceIdOf(req));
    res.status(response.status).json(response.body);
  }
}
