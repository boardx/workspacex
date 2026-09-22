/**
 * 议程环节 ↔ skill 绑定的两条路由（#1468，canvas 束 F102/F107）。协议适配，判定全在
 * `application`。
 *
 *   POST /canvas/agenda-segments/:agendaSegmentId/skill-bindings   加挂 skill（引导师）
 *   GET  /canvas/agenda-segments/:agendaSegmentId/skills           左栏第三区白名单
 *
 * ## 为什么是一个新控制器，而不是塞进 `canvas-template.controller.ts`
 *
 * 那个文件的文件头逐字说它是「canvas **模板注册表**的七条路由」，而这两条读写的是
 * skill 绑定那张表，与模板注册表没有共享的读写路径。塞进去等于让一份已经说清楚自己
 * 管什么的文件头当场作废（同 `application/canvas/segment-skill-ports.ts` 不挂在
 * `CanvasTemplateRepository` 上的理由）。
 *
 * ## ⚠ 这一束里**没有实现** `runSegmentSkill`，这不是遗漏
 *
 * 契约第六节的三条里，`bindSkillToSegment` / `listSegmentSkills` 在本 PR 落地，
 * `runSegmentSkill`（`POST /canvas/agenda-segments/:id/skill-runs`）**没有**：它的 `out`
 * 是 `{taskId, roundId}`、`err` 含 `CONTEXT_PACK_UNAVAILABLE`，也就是说它要的是一个
 * 「取 Context Pack → 起后台任务 → 落 AI 轮次」的运行时，而不是又一条 CRUD 路由。
 * 在没有那套东西的情况下回一个编出来的 `taskId`，比没有这条路由更坏：调用方会拿它去
 * 轮询一个永远不会完成的任务。缺口逐条写在 PR 正文与 #1468。
 *
 * ## 勘探结论：「蓝本设计阶段的议程环节」有真实来源，但**不是本束这个 key space**
 *
 * #1468 正文要求先勘探清楚再动手，结论写在这里，省得下一个人重走一遍：
 *
 * 1. 蓝本（未套用到具体项目）阶段的议程环节**确实存在**，来源是
 *    `domain/templates/agenda-segment-table.ts`——时长档位驱动（半天 7 / 一天 11 /
 *    两天 14 / 三天 19），key 与标题是**占位**（`converge-1`「收敛环节 1」），
 *    真实名称是该文件头逐字登记的数据缺口。
 * 2. 但**没有任何已实现的读路径能列出它们**：`listBlueprints` 只回
 *    `agendaSegmentCount`（一个数，不是清单）；唯一返回清单的契约操作
 *    `templates.previewParticipantView`（`GET /blueprints/:id/participant-view`，
 *    `out.visibleAgendaSegments`）有 application 用例、**没有 controller 路由**。
 * 3. 更要紧的是 id：蓝本阶段的 `agendaSegmentId` 是**定义 id**，套用蓝本时才被
 *    `INSERT INTO agenda_segments (..., agenda_segment_definition_id, ...)` 写成项目里
 *    一行真实环节、并拿到另一个 id（`seg-…`）。而本束契约的绑定操作全部钉在
 *    `agenda_segments` 的行 id 上（迁移里的复合外键就是这条）。
 *
 * ⇒ 所以 `apps/web/components/canvas/segment-binding.tsx`（蓝本设计器那一屏）**本 PR 没有
 *   去 mock**：它要的不是这两条路由，而是 ① 一条列出蓝本阶段环节的读路径，
 *   ② 一个「按定义 id 绑定」的契约面——后者是**契约问题，不是实现缺口**，
 *   #1468 正文逐字要求不要在本 issue 里顺手发明它。本 PR 交付的是契约**已经**按
 *   `agenda_segments` 行 id 签核的那一半：项目内、已实例化环节的 skill 绑定与读取。
 *
 * ## 状态码映射（`run()` 一处，不各写 catch）
 *
 * · `ROLE_INSUFFICIENT`（bind）/ `NO_PROJECT_ROLE`（list）→ 403，两者都在各自契约的
 *   `err` 联合里，带 `reasonCode` 出门是契约允许的分支依据。
 * · `DEPENDENCY_UNAVAILABLE` → 503：依赖不可用不是一次权限裁定。
 * · 环节不存在 → **裸 404**，不带 `reasonCode`：两条操作的 `err` 里都没有对应的码，
 *   硬塞一个最像的，前端就会按那个码分支，而那个码在契约里说的是另一件事
 *   （同 `canvas-template.controller.ts` / `canvas-instance.controller.ts` 对
 *   `CanvasSegmentNotFoundError` 的处置，逐字同型）。
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import { canvas as C } from "@repo/contracts";
import type { z } from "zod";
import { ID_FACTORY, type IdFactory } from "../../application/artifact/ports";
import { bindSkillToSegment } from "../../application/canvas/bind-skill-to-segment";
import { CanvasError } from "../../application/canvas/errors";
import { listSegmentSkills } from "../../application/canvas/list-segment-skills";
import { CanvasSegmentNotFoundError } from "../../application/canvas/segment-binding-errors";
import {
  CANVAS_SEGMENT_SKILL_REPOSITORY,
  type CanvasSegmentSkillRepository,
} from "../../application/canvas/segment-skill-ports";
import {
  CANVAS_TEMPLATE_REPOSITORY,
  type CanvasTemplateRepository,
} from "../../application/canvas/template-ports";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

/** 导出，供 contract-single-source 类测试断言与契约是**同一个对象**而非长得像。 */
export const BIND_SKILL_TO_SEGMENT_SCHEMA = C.operations.bindSkillToSegment.in;
export const LIST_SEGMENT_SKILLS_SCHEMA = C.operations.listSegmentSkills.in;

type BindSkillBody = z.infer<typeof C.operations.bindSkillToSegment.in>;

@Controller()
export class CanvasSegmentSkillController {
  constructor(
    @Inject(CANVAS_SEGMENT_SKILL_REPOSITORY) private readonly skills: CanvasSegmentSkillRepository,
    @Inject(CANVAS_TEMPLATE_REPOSITORY) private readonly templates: CanvasTemplateRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly decisions: DecisionIdFactory,
    @Inject(ID_FACTORY) private readonly ids: IdFactory,
  ) {}

  /**
   * ⚠ 200 而不是 Nest 对 POST 的缺省 201：同一个 skill 第二次绑定**不创建**任何资源
   *   （改的是既有那一行的 `runMode`，见 `segment-skill-ports.ts` 的端口注释），
   *   而同一条路由按「这次真建了吗」切状态码，调用方就得实现两套分支。
   *   契约 `out` 也只有 `{bindingId}`，没有 `Location`／资源自描述——201 会承诺一个
   *   本操作没有提供的东西（同 `bindTemplate` 回 200 的理由）。
   */
  @HttpCode(HttpStatus.OK)
  @Post("/canvas/agenda-segments/:agendaSegmentId/skill-bindings")
  async bindSkill(
    @Param("agendaSegmentId") agendaSegmentId: string,
    @Body(new ZodBodyPipe(BIND_SKILL_TO_SEGMENT_SCHEMA)) body: BindSkillBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    // 路径参数与 body 打架时拒绝，不静默挑一个（同 `bindTemplate`）。
    if (agendaSegmentId !== body.agendaSegmentId) {
      throw new BadRequestException("agenda_segment_id_mismatch");
    }
    return this.run(async () =>
      // 出门也过契约的 `.strict()`：没有这一句，服务端可以发出一个契约没描述的响应体
      // 而所有门控保持绿色。
      C.operations.bindSkillToSegment.out.parse(
        await bindSkillToSegment(
          {
            auth: { repo: this.identity, ids: this.decisions },
            templates: this.templates,
            skills: this.skills,
            // 复用 `ID_FACTORY` 而不是在用例里 `randomUUID()`：id 要可预测才断言得了
            // （同 `bindTemplate` 的 `cvbind`）。
            newBindingId: () => this.ids.next("cvskill"),
          },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            agendaSegmentId: body.agendaSegmentId,
            skillKey: body.skillKey,
            runMode: body.runMode,
          },
        ),
      ),
    );
  }

  @Get("/canvas/agenda-segments/:agendaSegmentId/skills")
  async listSkills(
    @Param("agendaSegmentId") agendaSegmentId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    // GET 也过契约校验（同 `canvas-instance.controller.ts` 的 `getSource`）：跳过它，
    // 这条就是唯一一个没有任何东西校验入参的 canvas 操作。
    const input = new ZodBodyPipe(LIST_SEGMENT_SKILLS_SCHEMA).transform({ agendaSegmentId }) as
      z.infer<typeof C.operations.listSegmentSkills.in>;

    return this.run(async () =>
      C.operations.listSegmentSkills.out.parse(
        await listSegmentSkills(
          {
            auth: { repo: this.identity, ids: this.decisions },
            templates: this.templates,
            skills: this.skills,
          },
          {
            userId: principal.userId,
            orgId: principal.orgId,
            agendaSegmentId: input.agendaSegmentId,
          },
        ),
      ),
    );
  }

  /** 应用层错误 → HTTP，**一处**（见文件头映射表）。 */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CanvasError) {
        if (e.reasonCode === "DEPENDENCY_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        // ROLE_INSUFFICIENT / NO_PROJECT_ROLE —— 都是权限裁定。
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      if (e instanceof CanvasSegmentNotFoundError) {
        throw new NotFoundException("agenda_segment_not_found");
      }
      throw e;
    }
  }
}
