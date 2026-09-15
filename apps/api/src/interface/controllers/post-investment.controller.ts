/**
 * `/agent/team4` 投后管理报告 Agent —— ad-hoc MVP，单独 controller。
 *
 * 独立成一个 controller 而不是挂在 `FeedbackController` 之类现成的 controller 上，
 * 理由同 `feedback.controller.ts` 头注："主语不同、依赖的仓储不同"——这条路由甚至
 * 没有仓储，唯一依赖是模型调用端口，挂在任何一个业务 controller 上都会让那个
 * controller 平白多背一个不相关的依赖。
 *
 * 这是**临时 agent**（人类已确认后续会删除，见
 * `docs/adhoc/team4-post-investment-agent-mvp-backlog.md`），走 ad-hoc 流程，
 * 不是 phase feature——不建仓储、不落库、不接 Skill 挂载。
 */
import { Body, Controller, HttpCode, HttpStatus, Inject, Post, ServiceUnavailableException } from "@nestjs/common";
import { postInvestmentReport as C } from "@repo/contracts";
import {
  analyzePostInvestmentMaterial,
  PostInvestmentAnalysisFailedError,
} from "../../application/post-investment/analyze-post-investment-material";
import { MODEL_CALL_PORT, type ModelCallPort } from "../../application/agent-run/ports";
import {
  FEEDBACK_STRUCTURE_MODEL_CONFIG,
  type FeedbackStructureModelConfig,
} from "../../application/feedback/structure-feedback-draft";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const ANALYZE_POST_INVESTMENT_MATERIAL_SCHEMA = C.operations.analyzePostInvestmentMaterial.in;
type AnalyzeBody = ReturnType<typeof ANALYZE_POST_INVESTMENT_MATERIAL_SCHEMA.parse>;

@Controller()
export class PostInvestmentController {
  constructor(
    @Inject(MODEL_CALL_PORT) private readonly modelCall: ModelCallPort,
    // MVP 复用既有的 `FEEDBACK_STRUCTURE_MODEL_CONFIG` 绑定，不新配一套模型选型——
    // 这个 Agent 要被删，不值得为它单独占一条模型路由配置项。
    @Inject(FEEDBACK_STRUCTURE_MODEL_CONFIG) private readonly analysisModel: FeedbackStructureModelConfig,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  /**
   * 测试 A 的最小闭环：任何登录用户可用（同 `submitFeedback` 的宽松先例，见其头注），
   * 未登录直接被鉴权层拦成 401——这个 Agent 不做组织级持久化，不需要更细的角色判定。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/post-investment/analyze")
  async analyze(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(ANALYZE_POST_INVESTMENT_MATERIAL_SCHEMA)) body: AnalyzeBody,
  ) {
    assertPrincipal(principal);
    try {
      return await analyzePostInvestmentMaterial(
        {
          model: this.modelCall,
          analysisModel: this.analysisModel,
          log: (message, detail) => this.logger.info(message, { ...detail, traceId: "post-investment-analyze" }),
        },
        { text: body.text },
      );
    } catch (e) {
      if (e instanceof PostInvestmentAnalysisFailedError) {
        throw new ServiceUnavailableException({ reasonCode: "ANALYSIS_FAILED" });
      }
      throw e;
    }
  }
}
