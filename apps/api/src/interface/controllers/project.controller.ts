/**
 * F117 / F122 的两条路由（UC-P1 / UC-P2）。协议适配，判断全在 `application`。
 *
 *   POST /projects   建一个容器（受全局 Guard 保护）
 *   GET  /projects   两段式列表（F122，UC-P2）：`{ member, managed }`
 *
 * ## `GET /projects` 的 `orgId` 从 query 来，不从 `principal.orgId` 来
 *
 * 与 `createProject` 同一条理由：`orgId` 不是授权依据，用例拿它去查
 * **调用者在该组织的角色**，查不到就当非管理者处理（`managed` 段为 `[]`）。
 * 之所以不直接用会话里的「当前组织」，是因为契约 `listProjects.in` 显式收
 * `orgId` 这个字段——两个来源打架时（前端在多组织间来回切换但会话还没落定），
 * 让 query 参数赢，与 `createProject.in.orgId` 同型。
 *
 * ## 🔴 这里**没有**第二条创建路由，那是本 feature 的交付物之一
 *
 * Q-1 裁 C：一条创建路径 + 蓝本可选参数。三类容器**不各开一条**
 * （`POST /workshops` / `POST /research-projects` / …），空白新建也**不另开一条**。
 * 理由与 `addProjectMember` 那条「两个入口共用同一个用例」逐字相同：
 * 另开一个接口意味着不变量要写两遍，**漏掉的那一遍不会有任何东西报警**。
 * `tests/project/create-project-atomic-two-rows.test.ts` 里两条断言把它变成会红的东西
 * （唯一的路由 + 唯一的 `INSERT INTO projects` 写点）。
 *
 * ## `orgId` 从 body 来，不从路径来
 *
 * 契约 `createProject.path` 是 `/projects`，`in` 里带 `orgId` —— 与 `inviteOrgMember`
 * 那条（路径参数 + body 回声）形状不同，所以这里没有「路径参数赢」的取舍。
 * ⚠ 但 `orgId` 仍然**不是**授权依据：用例拿它去查**调用者在该组织的角色**，
 *   查不到或不是 `lead` 一律 `ORG_ROLE_INSUFFICIENT`。请求体里写谁都改不了这一点。
 *
 * ## `provenanceEventId` 不在响应体里
 *
 * 契约 `createProject.out` 要求它，而 `ProvenanceEventType` 里没有「项目已创建」
 * 这个类型（契约自己登记的 `KNOWN_CONTRACT_GAPS.P3`）。编一个 id 让响应体好看，
 * 等于宣称写了一条审计而审计里什么都没有。理由与不选边的判断写在
 * `application/project/create-project.ts` 的文件头，并已报给签核人。
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { project as C } from "@repo/contracts";
import { createProject } from "../../application/project/create-project";
import { listProjects } from "../../application/project/list-projects";
import { ProjectError } from "../../application/project/errors";
import {
  PROJECT_LIST_REPOSITORY,
  PROJECT_REPOSITORY,
  type ProjectListRepository,
  type ProjectRepository,
} from "../../application/project/ports";
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
} from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

/** 导出，供 `contract-single-source.test.ts` 断言与契约是**同一个对象**而非长得像。 */
export const CREATE_PROJECT_SCHEMA = C.operations.createProject.in;
/** 同上，`listProjects` 的入参契约。 */
export const LIST_PROJECTS_SCHEMA = C.operations.listProjects.in;

type CreateBody = {
  orgId: string;
  name: string;
  kind: string;
  blueprintVersionId: string | null;
};

@Controller()
export class ProjectController {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly repo: ProjectRepository,
    @Inject(PROJECT_LIST_REPOSITORY) private readonly listRepo: ProjectListRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
  ) {}

  @Post("/projects")
  async create(
    @Body(new ZodBodyPipe(CREATE_PROJECT_SCHEMA)) body: CreateBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);

    try {
      const out = await createProject(
        { repo: this.repo, identity: this.identity },
        {
          orgId: toOrgId(body.orgId),
          actorId: principal.userId,
          name: body.name,
          kind: body.kind,
          blueprintVersionId: body.blueprintVersionId,
        },
      );
      // ⚠ `created` 不进响应体：契约的 `out` 是 `.strict()` 且不含它。它只是让幂等
      //   在测试里可断言（见 `application/project/ports.ts`）。把它暴露出去，
      //   前端就会拿「这次是不是新建」去分支，而重放在设计上就是不可观测的。
      return { id: out.id, kind: out.kind, status: out.status };
    } catch (e) {
      if (e instanceof ProjectError) {
        // ⚠ `INVALID_KIND` 在 HTTP 上**到不了这里**：`ZodBodyPipe` 会先用契约的
        //   三值闭集把它拦成字段级 400。留着这一支不是死代码——用例的 `kind` 收的是
        //   `string`，任何不经 HTTP 的调用方（脚本、未来的队列消费者）都走那道门，
        //   而它们抛出来的码必须与契约对得上。
        if (e.reasonCode === "INVALID_KIND") throw new BadRequestException({ reasonCode: e.reasonCode });
        if (e.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
          // 503 而不是 403：判定服务不可用**不是**一个裁定。把它渲染成拒绝，
          // 用户会去找管理员要一个他本来就有的权限。
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  @Get("/projects")
  async list(
    @Query("orgId") orgId: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    assertPrincipal(principal);
    // GET 没有 body，契约的 `in` 照样要过一遍——同 `backflow` 那条路由的理由：
    // 跳过它，`GET /projects` 就是唯一一个没有任何东西校验入参的操作。
    const input = new ZodBodyPipe(LIST_PROJECTS_SCHEMA).transform({ orgId }) as {
      orgId: string;
    };

    try {
      const out = await listProjects(
        { repo: this.listRepo, identity: this.identity },
        { orgId: toOrgId(input.orgId), actorId: principal.userId },
      );
      return out;
    } catch (e) {
      if (e instanceof ProjectError) {
        if (e.reasonCode === "AUTH_SERVICE_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: e.reasonCode });
        }
        throw new ForbiddenException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }
}
