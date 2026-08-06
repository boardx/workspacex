/**
 * #595 段 2 —— 让 `/admin/skills/url-imports` **从 HTTP 可达**。
 *
 * ## 这一刀之前，整条链只能从测试里调用
 *
 * 段 1 + 段 2 交付了两道 SSRF 门、取回层、用例、pg 仓储、以及一条钉住
 * 「生产绑了哪个取回器」的机械门控——**没有任何 HTTP 入口**。
 * ⚠ 那意味着 42 条断言证明的是「如果有人调用它，它会正确」，
 *   而**没有人调用它**。这与 #595 反证④（摘掉调用点，测函数的 18 条全绿）
 *   是同一个形状，只是这次缺的是最上面那一层。
 *
 * ## ⚠ 契约面是草案，**尚未经人类签核**（ADR-023）
 *
 * 路径、字段名、错误码全部来自 `packages/contracts` 的 `importSkillFromUrl`，
 * 那里逐字标注未签核。⛔ 本文件**不重新声明任何字段名**，就是为了让签核改得动。
 *
 * ## 本文件承担的**唯一**安全判定：`localOnlyOrg` 从哪来
 *
 * 其余安全判定都在下面（授权在用例、SSRF 在取回层）。但 `ImportUrlPolicy.localOnlyOrg`
 * 是**装配参数**——`composeImportSkillFromUrlDeps` 原样透传它，谁传谁负责。
 *
 * ⚠ 传错的后果不对称，两个方向都很糟：
 *   · 恒 `false` ⇒ personal-local 组织的出站承诺（I-9）在导入这条路上**消失**，
 *     而两道门、十四条反证、以及绑定守卫**一条都不会红**（它们不决定这个值）。
 *   · 恒 `true`  ⇒ 普通组织的导入**全部失败**。
 *
 * ⇒ 它必须**逐请求**由该组织的 `kind` 推出，且必须走 `isLocalOrg`——
 *   ⛔ 不许写 `kind === "personal-local"`：那个字面量在 `src/` 下出现即构建失败
 *   （`local-org-invisible-to-admin.test.ts`），因为这条判定漂移过三份副本，
 *   而它决定的是「数据会不会离开这台机器」。
 *
 * ⚠ 用 `findOrganization(orgId).kind`，**不是** `modelPolicy`、也不是 dataScope。
 *   `resolveModelConstraintRule` 那三条里只有第一条（`isLocalOrg`）是 I-9 的出站承诺；
 *   另外两条（机密数据 / self-hosted-only 策略）说的是**模型调用**去哪，
 *   不是「服务端能不能替这个组织发一个出站 HTTPS 请求」。把它们混进来会让
 *   一个处理机密数据的普通组织连导入 skill 都做不了，那不是 I-9 要的东西。
 */
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpStatus,
  Inject,
  Post,
  Res,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Response } from "express";
import { wave2Runtime as C } from "@repo/contracts";
import {
  importSkillFromUrl,
  IMPORT_SKILL_FROM_URL_DEPS_FACTORY,
  type ImportSkillFromUrlDepsFactory,
} from "../../application/skill-import/import-skill-from-url";
import { ImportSkillFromUrlError } from "../../application/skill-import/url-import-draft";
import { ImportSourceRefusedError } from "../../domain/skill/import-source";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { isLocalOrg } from "../../domain/identity/local-org";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

type ImportBody = ReturnType<typeof C.operations.importSkillFromUrl.in.parse>;

/**
 * 用例层拒绝码 → HTTP 状态。
 *
 * ⚠ 每一个码都**保留自己的身份**（`reasonCode`），不合并成一个笼统的 400。
 *   一个只回 `status >= 400` 的实现今天本来就绿——这正是 #595 反复撞到的空转形状。
 */
const USE_CASE_STATUS: Record<string, number> = {
  IMPORT_NOT_ORG_ADMIN: HttpStatus.FORBIDDEN,
  IMPORT_CONTENT_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
  IMPORT_NAME_CONFLICT: HttpStatus.CONFLICT,
  IMPORT_IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
};

@Controller()
export class SkillUrlImportController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(IMPORT_SKILL_FROM_URL_DEPS_FACTORY)
    private readonly composeDeps: ImportSkillFromUrlDepsFactory,
  ) {}

  @Post("/admin/skills/url-imports")
  async import(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(C.operations.importSkillFromUrl.in)) body: ImportBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertPrincipal(principal);

    const orgId = toOrgId(principal.orgId);
    const organization = await this.identities.findOrganization(orgId);
    /**
     * ⚠ 组织查不到时**拒绝**，不是「当成普通组织继续」。
     *   缺省成 `localOnlyOrg: false` 会让一个查不到的组织拿到比查得到的组织**更宽**的
     *   出站权限——故障方向必须是收紧。
     */
    if (organization === null) {
      throw new ForbiddenException({ reasonCode: "IMPORT_NOT_ORG_ADMIN" });
    }

    const deps = this.composeDeps({ localOnlyOrg: isLocalOrg(organization.kind) });

    try {
      const result = await importSkillFromUrl(
        { orgId: principal.orgId, actorId: principal.userId, ...body },
        deps,
      );
      // 回放不是新建：同一个 idempotencyKey 第二次提交没有产生任何新资源。
      response.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
      return C.operations.importSkillFromUrl.out.parse(result);
    } catch (error) {
      if (error instanceof ImportSkillFromUrlError) {
        const status = USE_CASE_STATUS[error.code];
        if (status === HttpStatus.FORBIDDEN) throw new ForbiddenException({ reasonCode: error.code });
        if (status === HttpStatus.CONFLICT) throw new ConflictException({ reasonCode: error.code });
        throw new UnprocessableEntityException({ reasonCode: error.code });
      }
      /**
       * 取回层的拒绝（两道 SSRF 门 / 协议 / 凭据 / 体积 / 重定向 / 超时）。
       *
       * ⚠ 这些**必须**以自己的码出现在响应里。把它们压成一个笼统的 400，
       *   「被 SSRF 门拦下」与「你 URL 打错了」就无法区分，
       *   而前者是**服务端替你做了一次安全判定**，调用方有权知道。
       */
      if (error instanceof ImportSourceRefusedError) {
        if (error.code === "IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG") {
          throw new ForbiddenException({ reasonCode: error.code });
        }
        throw new UnprocessableEntityException({ reasonCode: error.code });
      }
      throw error;
    }
  }
}
