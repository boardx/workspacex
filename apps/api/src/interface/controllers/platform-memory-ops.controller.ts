/**
 * Phase 18 S8（#4365）—— 平台级记忆运维：抽取 SLO（只读）、记忆整合开关（默认关）、现在整合一次。
 * 契约束 `packages/contracts/src/chat-knowledge-graph.ts`：
 *
 *   GET  /platform/knowledge-graph/extraction-slo
 *   GET  /platform/knowledge-graph/consolidation-setting
 *   PUT  /platform/knowledge-graph/consolidation-setting
 *   POST /platform/knowledge-graph/consolidation/run
 *
 * 鉴权同 `PlatformExtractionSettingController`（类级 `PlatformOperatorGuard`，读写同一道门，理由见那个文件头注）。
 * 单开一个 controller：那个文件只管部署抽取开关一件事，这里的三件是 S8 新加的运维面，分开放 review 与回滚都清楚。
 *
 * 这几条都**不回任何人的记忆内容**：SLO 只有数字；「现在整合一次」只回计数（整合改了谁的哪一条，只有本人在自己的
 * 大脑页看得到——`KnowledgeConsolidationController`）。
 */
import { Body, ConflictException, Controller, Get, HttpCode, Inject, Optional, Post, Put, UseGuards } from "@nestjs/common";
import { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import { newKgId } from "../../application/knowledge-graph/ids";
import { runConsolidationPass } from "../../application/knowledge-graph/consolidate-memory";
import { KG_EXTRACTION_SLO_RECORDER, type ExtractionSloRecorder } from "../../application/knowledge-graph/extraction-slo-recorder";
import {
  KG_CONSOLIDATION_PORT, KG_EXTRACTION_GATE_MODEL, KG_EXTRACTION_SLO_COUNTS_PORT, KG_EXTRACTION_SLO_THRESHOLDS,
  KgConsolidationError, type KgConsolidationPort, type KgExtractionSloCountsPort,
} from "../../application/knowledge-graph/s8-ports";
import type { WorthinessModelPort } from "../../application/knowledge-graph/extraction-gate";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import type { ExtractionSloThresholds } from "../../domain/knowledge-graph/extraction-slo";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { PlatformOperatorGuard } from "../guards/platform-operator.guard";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const SET_PLATFORM_CONSOLIDATION_SETTING_SCHEMA = KG.knowledgeGraph.setPlatformConsolidationSetting.in;
type SetConsolidationBody = z.infer<typeof SET_PLATFORM_CONSOLIDATION_SETTING_SCHEMA>;

@Controller()
@UseGuards(PlatformOperatorGuard)
export class PlatformMemoryOpsController {
  constructor(
    @Inject(KG_EXTRACTION_SLO_RECORDER) private readonly slo: ExtractionSloRecorder,
    @Inject(KG_EXTRACTION_SLO_COUNTS_PORT) private readonly counts: KgExtractionSloCountsPort,
    @Inject(KG_EXTRACTION_SLO_THRESHOLDS) private readonly thresholds: ExtractionSloThresholds,
    @Inject(KG_CONSOLIDATION_PORT) private readonly consolidation: KgConsolidationPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
    @Optional() @Inject(KG_EXTRACTION_GATE_MODEL) private readonly gateModel?: WorthinessModelPort | null,
  ) {}

  @Get(KG.knowledgeGraph.getPlatformExtractionSlo.path)
  async extractionSlo(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const q = await this.counts.counts();
    const w = this.slo.window();
    const g = this.slo.gate();
    return KG.knowledgeGraph.getPlatformExtractionSlo.out.parse({
      ...w, ...q,
      gate: { ...g, gateModelEnabled: this.gateModel !== undefined && this.gateModel !== null },
      thresholds: this.thresholds,
      alerts: this.slo.evaluate(q.stuckLeases, this.thresholds),
    });
  }

  @Get(KG.knowledgeGraph.getPlatformConsolidationSetting.path)
  async getConsolidation(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    return KG.knowledgeGraph.getPlatformConsolidationSetting.out.parse({ enabled: await this.consolidation.getEnabled() });
  }

  @Put(KG.knowledgeGraph.setPlatformConsolidationSetting.path)
  async setConsolidation(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(SET_PLATFORM_CONSOLIDATION_SETTING_SCHEMA)) body: SetConsolidationBody,
  ) {
    assertPrincipal(principal);
    const enabled = await this.consolidation.setEnabled(body.enabled);
    this.logger.info("kg consolidation setting changed", { traceId: "kg-consolidation", enabled, by: principal.userId });
    return KG.knowledgeGraph.setPlatformConsolidationSetting.out.parse({ enabled });
  }

  @Post(KG.knowledgeGraph.runPlatformConsolidation.path)
  @HttpCode(200)
  async runNow(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    try {
      const out = await runConsolidationPass({ consolidation: this.consolidation, logger: this.logger, newRunId: () => newKgId("csl") });
      return KG.knowledgeGraph.runPlatformConsolidation.out.parse(out);
    } catch (e) {
      if (e instanceof KgConsolidationError && e.code === "KG_CONSOLIDATION_DISABLED") throw new ConflictException({ reasonCode: e.code });
      throw e;
    }
  }
}
