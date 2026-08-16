/**
 * UC-P1 `createProject` —— **本仓创建项目容器的唯一一条路径**（Q-1 裁 C）。
 *
 * ## 「一条路径」是一条可断言的性质，不是一句话
 *
 * 它由三件东西共同成立，缺任何一件都会退化成「大家都从这里走」的约定：
 *   ① 只有一个 `INSERT INTO projects` 的写点（`infrastructure/project/pg-project-repository.ts`）
 *   ② 只有一条创建路由（`POST /projects`）
 *   ③ 组织角色的判定在**本函数**里，不由调用方传进来
 * ③ 是最容易被写反的一件：`inviteOrgMember` 那条路径把 `actorOrgRole` 当入参收，
 * 于是「谁能邀请」这条边的正确性取决于**每一个**调用方都先去查一次库。多一个控制器，
 * 就多一次「传错角色」的机会，而传错的那次不会有任何东西报警。
 * ⇒ 这里收的是 `actorId`，角色自己查。想绕过这道门就必须绕过整个函数，
 *   而 ①② 两条断言会当场看见那件事（`tests/project/create-project-atomic-two-rows.test.ts`）。
 *
 * ## 刻意不做的三件事
 *
 * 1. **不给创建者授予任何项目角色**（Q-4②）。若创建即授角色，
 *    「lead 对自建未加入的项目持管理权、不持内容读取权」那条边的两端就不存在了。
 * 2. **不写应用层的「组织已停用」码**。那是 PG RESTRICTIVE 策略拒写（I-P28），
 *    断言在数据库层；在这里补一个 `if` 就是同一条规则的第二处声明。
 * 3. **不发明每段议程环节的时长**。见下方「BP-08」一节。
 *
 * ## BP-08（人类 2026-08-16 裁：最小闭环 B）—— `blueprintVersionId` 从"原样落库"
 * 换成"真的用它做点什么"
 *
 * U-5 裁 B（可补套、只填空缺）定的是**补套**那一侧；创建时"蓝本不合法该怎么报错"
 * 此前确实无出处（`create-project.ts` 旧版头注原话），BP-08 补上了：契约 delta
 * （`design-deltas/createproject-blueprint-error-codes/`，人类 2026-08-16 确认）给
 * `createProject.err` 加了五个与 `templates.TemplateError` 同码同义的码，本函数在
 * `blueprintVersionId` 非 null 时真正校验并抛出。
 *
 * **范围收得比"六类初始化"字面意思窄**（人类两轮裁决明确的最小闭环）：
 *   · 权限口径**不变**——仍是 `canCreateProject`（lead-or-admin，#608），不整体调用
 *     `templates` 束的 `applyBlueprintUseCase()`（那条用例带着自己的 `canApplyBlueprint`
 *     lead-only 判断，与这里不是同一条边——只复用它的纯函数/仓储层，不复用它的编排）。
 *   · 档位读**活表**当前 `duration_tier`，不是版本快照（快照从未冻结过档位，
 *     `KNOWN_CONTRACT_GAPS.T15`）。
 *   · 六类初始化摘要（`initialized`）仍用 `planSixCategoryInit` 计算、六类计数与
 *     `getInitializationPreview` 同源，但**真实写入本轮只有 `blueprint_bindings`
 *     一行**（记录"套用过"这一事实，表/列已就绪，零新增存储）——议程环节等五类
 *     暂不落地真实行，逐段时长无出处，见 `KNOWN_CONTRACT_GAPS.P10`。
 *
 * ## 🔴 `provenanceEventId` 没有被返回，这是一个**未解决的契约矛盾**，不是省略
 *
 * 契约 `createProject.out` 要求 `provenanceEventId: z.string()`（非空），
 * 而共享契约 `provenance.ProvenanceEventType` 里**没有**「项目已创建」这个类型
 * ——这一点契约自己已经登记为 `KNOWN_CONTRACT_GAPS.P3`。
 *
 * 三条路都不通，所以本函数一条都不选：
 *   · 给枚举加成员 = **修订已签核的 `provenance` 共享束**，agent 不许做（同 P8 的先例）；
 *   · 借用一个现成的类型（`role-changed` 最近）= 往 append-only 的审计流里写一条
 *     语义是错的记录，而审计流的价值全部来自「里面的每一条都当真」；
 *   · 编一个假 id 返回 = 让响应体符合契约而审计里什么都没有，
 *     那是「全绿但空转」的教科书形状。
 * ⇒ 本函数返回 `{ id, kind, status }`，**少一个字段**，并由
 *   `tests/project/create-project-atomic-two-rows.test.ts` 里一条断言把这个矛盾钉住：
 *   `ProvenanceEventType` 一旦长出项目生命周期的成员，那条断言当场变红，
 *   接手的人会被带到这里来补写入 + 补字段。原样报给签核人，本 feature 不选边。
 */
import type { OrgId } from "../../domain/org-id";
import {
  canCreateProject,
  creationFingerprint,
  isProjectKind,
} from "../../domain/project/create-project-rules";
import { planSixCategoryInit } from "../../domain/templates/apply-blueprint-init";
import type { IdentityRepository } from "../identity/ports";
import { ProjectError } from "./errors";
import type { BlueprintReferenceRepository, CreatedProject, ProjectRepository } from "./ports";
import { BlueprintBindingFailedError } from "./ports";

export interface CreateProjectDeps {
  readonly repo: ProjectRepository;
  readonly identity: IdentityRepository;
  /**
   * BP-08：`blueprintVersionId` 非 null 时必须提供——解析该端口是本函数唯一读
   * `templates` 束数据的地方。留空且 `blueprintVersionId` 非 null 时抛错（不是
   * 静默跳过校验），见函数体。可选是为了不动空白新建路径的既有调用方/测试。
   */
  readonly blueprintReference?: BlueprintReferenceRepository;
}

/** ⚠ `kind` 收的是 `string` 不是 `ProjectKind`：收窄成联合类型，INVALID_KIND 就永远等不到一个非法值。 */
export interface CreateProjectInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly name: string;
  readonly kind: string;
  readonly blueprintVersionId: string | null;
}

export async function createProject(
  deps: CreateProjectDeps,
  input: CreateProjectInput,
): Promise<CreatedProject> {
  // kind 先判：一个非法的 kind 连「谁能建」都不该消耗一次库查询，
  // 且它与调用者是谁无关——把它放在角色之后，会让 INVALID_KIND 只有 lead 才看得见。
  if (!isProjectKind(input.kind)) throw new ProjectError("INVALID_KIND");

  let orgRole: Awaited<ReturnType<IdentityRepository["findOrgMembership"]>>;
  try {
    orgRole = await deps.identity.findOrgMembership(input.actorId, input.orgId);
  } catch {
    // ⚠ 判定服务不可用**一律拒绝，不得降级放行**（契约 `AUTH_SERVICE_UNAVAILABLE` 逐字）。
    //   catch 里 return 一个「先放行、稍后补判」在这条路径上等于任何人都能建项目。
    throw new ProjectError("AUTH_SERVICE_UNAVAILABLE");
  }

  // ⚠ 2026-08-06 人类裁决 / #608：判据已从「只有 `lead`」放宽为「`lead` 或 `admin`」
  //   （覆盖 U-4 裁 A 的那一半）。**Q-4② 未被覆盖**——下面的 `repo.create` 依旧不写
  //   任何 `project_memberships` 行，admin 建完之后与 lead 建完之后行为完全一致。
  //   理由与护栏见 `domain/project/create-project-rules.ts` 的 `canCreateProject` 头注。
  //
  // 非成员与「成员但角色不够」落在同一个码上，是因为契约的 `err` 里**没有**
  // `NO_ORG_MEMBERSHIP`（`createProject.err` 恰好三个成员）。多报一个码 =
  // 让调用者能探测「这个组织里有没有我这个人」，而他本来连组织都进不去。
  if (!canCreateProject(orgRole?.orgRole ?? null)) {
    throw new ProjectError("ORG_ROLE_INSUFFICIENT");
  }

  // BP-08：blueprintVersionId 非 null 时，在写入前解析它。放在 canCreateProject 之后——
  // 「谁能建」与「传的蓝本合不合法」是两条独立的门，前者判完才值得花一次跨束查询去判后者
  // （同本函数一贯的顺序理由：与调用者是谁无关的判断不该抢在角色判断前面消耗资源，
  //  这里反过来是因为角色判断更便宜、更早能挡掉大多数非法请求）。
  let blueprintBinding: { readonly blueprintId: string } | null = null;
  let initialized: ReturnType<typeof planSixCategoryInit>["initialized"] | undefined;

  if (input.blueprintVersionId !== null) {
    if (deps.blueprintReference === undefined) {
      // 装配错误，不是用户输入错误——真实部署里 kernel.module.ts 必须注入这个端口。
      throw new Error("createProject: blueprintVersionId given but no BlueprintReferenceRepository wired");
    }
    const resolved = await deps.blueprintReference.resolve(
      input.orgId,
      input.blueprintVersionId,
      orgRole?.orgRole ?? null,
      orgRole?.teamId ?? null,
    );
    switch (resolved.kind) {
      case "not-found":
        throw new ProjectError("BLUEPRINT_NOT_FOUND");
      case "not-visible":
        throw new ProjectError("BLUEPRINT_NOT_VISIBLE");
      case "version-archived":
        throw new ProjectError("BLUEPRINT_VERSION_ARCHIVED");
      case "ok": {
        const plan = planSixCategoryInit(resolved.filledFacetKeys, resolved.tier);
        initialized = plan.initialized;
        blueprintBinding = { blueprintId: resolved.blueprintId };
        break;
      }
    }
  }

  let created: CreatedProject;
  try {
    created = await deps.repo.create({
      orgId: input.orgId,
      actorId: input.actorId,
      name: input.name,
      kind: input.kind,
      blueprintVersionId: input.blueprintVersionId,
      fingerprint: creationFingerprint({
        orgId: input.orgId,
        actorId: input.actorId,
        kind: input.kind,
        name: input.name,
        blueprintVersionId: input.blueprintVersionId,
      }),
      blueprintBinding,
    });
  } catch (e) {
    if (e instanceof BlueprintBindingFailedError) throw new ProjectError("INITIALIZATION_FAILED");
    throw e;
  }

  return initialized === undefined ? created : { ...created, initialized };
}
