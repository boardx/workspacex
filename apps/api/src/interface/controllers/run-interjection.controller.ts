import { timingSafeEqual } from "node:crypto";
import { BadRequestException, Body, Controller, Headers, Inject, NotFoundException, Param, Post, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { InterjectionPollInput, InterjectionPollOutput } from "@repo/contracts/run-control";
import { Public } from "../public.decorator";
import { toOrgId } from "../../domain/org-id";
import { AGENT_RUN_STORE, type AgentRunStore } from "../../application/agent-run/ports";
import { INTERJECTION_STORE, type InterjectionStore } from "../../application/agent-run/interjection-store";
import { TOOL_PERMISSION_GRANT_STORE, type ToolPermissionGrantStore } from "../../application/agent-run/tool-permission-grants";

/** Same fail-closed service identity as the existing subtask callback. Tenant/run
 * ownership is checked before touching the queue; this is not a browser endpoint. */
@Controller()
export class RunInterjectionController {
  constructor(
    @Inject(AGENT_RUN_STORE) private readonly runs: AgentRunStore,
    @Inject(INTERJECTION_STORE) private readonly queue: InterjectionStore,
    @Inject(TOOL_PERMISSION_GRANT_STORE) private readonly grants: ToolPermissionGrantStore,
  ) {}

  @Public()
  @Post("/internal/agent-runs/:runId/interjections/poll")
  async poll(@Headers("x-deep-agent-internal-key") key: string | undefined,
    @Param("runId") runId: string, @Body() body: unknown) {
    const expected = Buffer.from((process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY ?? "").trim());
    const provided = Buffer.from(key ?? "");
    if (!expected.length || expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new UnauthorizedException("run_control_unauthorized");
    }
    const parsed = InterjectionPollInput.safeParse(body);
    if (!parsed.success) throw new BadRequestException("invalid_interjection_poll");
    const orgId = toOrgId(parsed.data.orgId);
    if (!await this.runs.findLocator(orgId, runId)) throw new NotFoundException("run_not_found");
    if (!this.queue.pollForKernel) throw new ServiceUnavailableException("live_interjections_unavailable");
    const interjections = await this.queue.pollForKernel(orgId, runId, parsed.data.acknowledgedIds);
    // Revocation must finish before returning updated intent to the model. Repeating
    // it after a lost response is conservative; never retain old-direction run grants.
    if (interjections.some((value) => value.classification === "direction_change")) {
      await this.grants.revokeAllForRun(orgId, runId);
    }
    return InterjectionPollOutput.parse({ interjections, cancelRequested: await this.queue.isCancelRequested?.(orgId, runId) ?? false, pauseRequested: await this.queue.isPauseRequested?.(orgId, runId) ?? false });
  }
}
