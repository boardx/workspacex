/**
 * `GET /system/uptime` —— 运营状态屏的红绿 bar + 可用性百分比。见契约
 * `systemUptime.operations.getServiceUptimeStatus` 头注、用例
 * `application/system/get-service-uptime-status.ts`。
 */
import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { systemUptime as C } from "@repo/contracts";
import { getServiceUptimeStatus } from "../../application/system/get-service-uptime-status";
import {
  SERVICE_UPTIME_REPOSITORY, SERVICE_UPTIME_TARGET,
  type ServiceUptimeRepository, type ServiceUptimeTarget,
} from "../../application/system/uptime-ports";
import { PlatformOperatorGuard } from "../guards/platform-operator.guard";

export type GetServiceUptimeStatusOut = ReturnType<typeof C.operations.getServiceUptimeStatus.out.parse>;

@Controller()
export class SystemUptimeController {
  constructor(
    @Inject(SERVICE_UPTIME_REPOSITORY) private readonly repo: ServiceUptimeRepository,
    @Inject(SERVICE_UPTIME_TARGET) private readonly target: ServiceUptimeTarget,
  ) {}

  @UseGuards(PlatformOperatorGuard)
  @Get("/system/uptime")
  async get(): Promise<GetServiceUptimeStatusOut> {
    const { service, configured } = this.target.info();
    const out = await getServiceUptimeStatus(this.repo, service, configured);
    return { ...out, segments: [...out.segments] };
  }
}
