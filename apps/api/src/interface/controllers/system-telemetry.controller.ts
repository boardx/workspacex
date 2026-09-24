/**
 * D9 —— 实例管理员（平台运营）读 / 改四项上报同意，读最近一次上报原样报告。
 * 契约：`instanceTelemetry.operations`。同意变更在下一个上报周期生效。
 */
import { Body, Controller, Get, Inject, Put, UseGuards } from "@nestjs/common";
import { instanceTelemetry as C } from "@repo/contracts";
import { reporterState } from "../../application/telemetry/run-telemetry-cycle";
import {
  TELEMETRY_CONFIG, TELEMETRY_STATE_REPOSITORY,
  type TelemetryConfig, type TelemetryConsent, type TelemetryStateRepository,
} from "../../application/telemetry/telemetry-ports";
import { PlatformOperatorGuard } from "../guards/platform-operator.guard";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

type SettingsOut = ReturnType<typeof C.operations.getTelemetrySettings.out.parse>;
type LastOut = ReturnType<typeof C.operations.getLastTelemetryReport.out.parse>;

@Controller()
export class SystemTelemetryController {
  constructor(
    @Inject(TELEMETRY_STATE_REPOSITORY) private readonly state: TelemetryStateRepository,
    @Inject(TELEMETRY_CONFIG) private readonly config: TelemetryConfig,
  ) {}

  private settings(consent: TelemetryConsent): SettingsOut {
    return { consent, state: reporterState(this.config), intervalSeconds: C.TELEMETRY_REPORT_INTERVAL_SECONDS };
  }

  @UseGuards(PlatformOperatorGuard)
  @Get("/system/telemetry/settings")
  async get(): Promise<SettingsOut> {
    return this.settings((await this.state.ensure()).consent);
  }

  @UseGuards(PlatformOperatorGuard)
  @Put("/system/telemetry/consent")
  async update(@Body(new ZodBodyPipe(C.operations.updateTelemetryConsent.in)) body: Partial<TelemetryConsent>): Promise<SettingsOut> {
    return this.settings(await this.state.updateConsent(body));
  }

  @UseGuards(PlatformOperatorGuard)
  @Get("/system/telemetry/last-report")
  async last(): Promise<LastOut> {
    const l = (await this.state.ensure()).last;
    if (!l) return { last: null };
    return {
      last: {
        attemptedAt: l.attemptedAt.toISOString(),
        outcome: l.outcome,
        omittedForLackOfData: [...l.omittedForLackOfData],
        report: l.report as NonNullable<LastOut["last"]>["report"],
      },
    };
  }
}
