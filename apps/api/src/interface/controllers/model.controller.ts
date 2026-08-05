/**
 * 模型池的写入路由（#548）。协议适配，判断全在 `application`。
 *
 *   POST /models   接入一个模型 —— **凭据进入系统的唯一入口**
 *
 * ## 为什么只有一条，而契约里有十条
 *
 * 契约的十条**全部已签核**，缺的不是签核而是 `infrastructure`：#548 的工单写着「只差
 * controller 一层」，实测不成立——`ModelPoolRepository` / `ComplianceVocabularyReader` /
 * `ModelPoolClock` / `CredentialCipher` 在本分支之前**一个实现都没有**（只有 F49 的
 * `PgAdmissionTestRepository` 是现成的）。本分支补齐了 `registerModel` 那条链所需的四个
 * 实现，另外九条各自还缺自己的端口实现：
 *
 *   · `recordAdmissionTest` —— **端口实现（F49 的 `PgAdmissionTestRepository`）是现成的，
 *     本条却仍然没接，这是有意的**。`lint-permission-paths.mjs` 给那个仓储开的豁免，
 *     第 (d) 条逐字写着「NOTHING under src/interface/ reaches it —— 哪天加了 controller，
 *     `admission-test-gate.test.ts` 就该变红，加的人必须在那里挂上 org-admin 裁定」。
 *
 *     实测下来那条绊线**是按文件名字符串扫的**：它遍历 `src/interface/` 下每个文件，
 *     断言正文里不出现该仓储的文件名。于是有两件事同时为真——
 *       ① controller 经 DI token 注入、不 import 那个文件名，**真接了也不会红**；
 *       ② 本段注释只要把那个文件名原样写出来，**没接也会红**（这段话的第一版就是这么
 *          把自己绊倒的，所以现在绕开写）。
 *     两条都说明它断的是名字在不在文件里，而不是调用点——与今天那颗
 *     `toContain("assertProjectMember")` 命中私有方法**定义本身**的钉子同一形态。
 *
 *     绊线的意图（「加 controller 的人必须挂上 org-admin 裁定」）本 PR 其实已经满足：
 *     `requireOrgAdmin` 就在下面。但在时限内顺着一条失效的绊线去改安全豁免，
 *     是把「绿」当成「对」。故本条不接，把绊线缺陷单独上报。
 *   · `configureModel` / `probeConnectivity` —— 前者要 `RETEST_REQUIRED` 的状态回退写口，
 *     后者要一个对外拨号的出口，而 phase-1 **没有** provider gateway（`domain.md` 四）。
 *   · `enableModel` —— 缺 `ModelShapeReader` / `ModelStatusWriter` / `AdmissionAuditSink`
 *     三个实现，其中审计 sink 还没有落点表。
 *   · `listModelReferences` / `disableModel` —— 缺四类引用的枚举实现与级联写口。
 *   · `listSelectableModels` —— 端口实现不难，但候选集恒等于 `已启用`，而在 `enableModel`
 *     落地之前**没有任何模型能变成 `已启用`**，所以它今天只会稳定返回 `[]`。先接它等于
 *     交付一条永远为空的路由。
 *   · `routeModelCall` / `assembleSystemPrompt` —— 本束的安全内核，判定顺序本身是契约，
 *     不适合与本条一起塞进同一个 PR。
 *
 * ## ⚠ 池子的「列表」路由不存在，这是**上报**而不是顺手补的
 *
 * F48 的 `user_visible_behavior` 说管理台列表展示 kind / vendor / 能力标签 / 上下文窗口 /
 * 单价 / 合规属性 / 状态，而契约里**没有任何操作返回池子行**——这一点
 * `domain/model/registry.ts` 文件头早就写下并用 `POOL_LISTING_GAP` 钉住了。
 * 契约待人类签核期间 agent 不得自行加操作（`contract-design.md` §五 / ADR-020），所以
 * 前端的「能看列表」在本 PR 里**做不了**，另开 issue。
 *
 * ## 凭据（本文件的要害）
 *
 * `credential` 与 `endpoint` 只在 `registerModel.in` 里出现，**任何 `out` 都没有它们**
 * （`credential-never-echoed.test.ts` 扫描全部 57 条响应 schema）。本控制器：
 *   · 出门一律走契约 `.out.parse()`——`.strict()` 会拒掉任何多出来的键，所以即便下层
 *     哪天开始回传凭据，它也出不了这道门；
 *   · **不记请求体**。没有 `logger.log(body)`，也没有把 body 塞进异常 message 的分支。
 */
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Inject,
  Post,
  ServiceUnavailableException,
  Body,
} from "@nestjs/common";
import { agentRuntime as C } from "@repo/contracts";
import type { z } from "zod";
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
} from "../../application/identity/ports";
import {
  COMPLIANCE_VOCABULARY_READER,
  MODEL_CREDENTIAL_CIPHER,
  MODEL_POOL_CLOCK,
  MODEL_POOL_REPOSITORY,
  type ComplianceVocabularyReader,
  type ModelPoolClock,
  type ModelPoolRepository,
} from "../../application/model/ports";
import { registerModel } from "../../application/model/register-model";
import type { CredentialCipher } from "../../domain/model/credential-vault";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

/** 导出，供 `contract-single-source.test.ts` 断言与契约是**同一个对象**而非长得像。 */
export const REGISTER_MODEL_SCHEMA = C.operations.registerModel.in;

type RegisterBody = z.infer<typeof C.operations.registerModel.in>;

@Controller()
export class ModelController {
  constructor(
    @Inject(MODEL_POOL_REPOSITORY) private readonly pool: ModelPoolRepository,
    @Inject(MODEL_CREDENTIAL_CIPHER) private readonly cipher: CredentialCipher,
    @Inject(COMPLIANCE_VOCABULARY_READER) private readonly vocabulary: ComplianceVocabularyReader,
    @Inject(MODEL_POOL_CLOCK) private readonly clock: ModelPoolClock,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
  ) {}

  /**
   * 接入一个模型，落 `待测试`。**凭据进入系统的唯一入口**。
   *
   * ⚠ 201（Nest 对 POST 的缺省）：这条真的创建了一行，与 canvas 束那四条「状态转移回 200」
   *   的理由正好相反。
   *
   * ⚠ 组织取自会话主体，**不从请求体读**——`registerModel.in` 是 `.strict()` 且没有
   *   `orgId`，塞一个进来是 400，而不是被悄悄用上去写别人的租户。
   */
  @Post("/models")
  async register(
    @Body(new ZodBodyPipe(REGISTER_MODEL_SCHEMA)) body: RegisterBody,
    @CurrentPrincipal() principal: Principal,
  ) {
    const orgId = await this.requireOrgAdmin(principal);
    return this.run(async () => {
      const result = await registerModel(orgId, body, {
        repository: this.pool,
        cipher: this.cipher,
        vocabulary: this.vocabulary,
        clock: this.clock,
      });
      if (!result.ok) {
        // 400 而不是 403：词表外的取值是一次**请求内容**问题，不是权限裁定。
        // `unknown` 回显的是管理员自己提交的值——不是披露，且少了它这个错误无法处理
        // （`register-model.ts` 的 `RegisterModelResult` 文件头逐字写了这条理由）。
        throw new BadRequestException({ reasonCode: result.code, unknown: result.unknown });
      }
      // 出门过契约的 `.strict()`：没有这一句，服务端可以发出一个契约没描述的响应体而所有
      // 门控保持绿色。对本条而言它还是凭据的**最后一道闸**——`registerModel.out` 只有
      // `{modelId, status}`，多一个 `credential` 键会在这里被 zod 拒掉。
      return C.operations.registerModel.out.parse({
        modelId: result.row.modelId,
        status: result.row.status,
      });
    });
  }

  /**
   * `NOT_ORG_ADMIN` 的唯一落点。
   *
   * `registerModel.err` 里有它，且模型池是**组织配置**——不是项目资源，所以判据是组织角色，
   * 不走 `permission-filter` 那套项目维度的裁定。
   */
  private async requireOrgAdmin(principal: Principal): Promise<string> {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const membership = await this.identity.findOrgMembership(principal.userId, orgId);
    if (membership === null || membership.orgRole !== "admin") {
      throw new ForbiddenException({ reasonCode: "NOT_ORG_ADMIN" });
    }
    return orgId;
  }

  /**
   * 下层故障 → HTTP，**一处**。
   *
   * ⚠ 不回显 `e.message`。这条路由的请求体里有凭据明文，而一个把驱动错误原样带出去的
   *   分支，正是凭据从 `INSERT` 参数里漏进响应体的那条路（`lint-error-leak` 存在的理由）。
   */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof ForbiddenException) throw e;
      // 契约的 `err` 里有 `DEPENDENCY_UNAVAILABLE`：落库失败不是一次裁定，是依赖不可用。
      throw new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    }
  }
}
