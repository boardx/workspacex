/**
 * F117 —— `createProject` 的三条纯判断，住在最内层。
 *
 * 放在 domain 而不是 application 的理由：这三条各自都有一个**已裁决的出处**，
 * 而 application 那一层还要知道仓储、事务、DI。判断混在事务代码里之后，
 * 「谁能建」这条边只能靠读一遍 `create-project.ts` 才能确认——而它会被测的是
 * 「调用成功了吗」，不是「这条边长什么样」。
 *
 *   ① 谁能建      组织角色 `lead` 或 `admin`（2026-08-06 人类裁决 / #608，
 *                 **覆盖** U-4 裁 A 原本的「只有 `lead`、`admin` 也不能」）
 *   ② kind 闭集   契约 `ProjectKind` 三值，与 DB CHECK 成员逐个相等
 *   ③ 幂等指纹    uc-00-1 E5 的字面意思：「同一次创建请求」= 同样的五元组
 *
 * ⚠ 2026-08-16 人类裁决，推翻 Q-4②：**创建者自动获得该项目最高权限的角色**
 *   （facilitator + is_host）。原判据（本条以下保留存档）：「不给创建者授予项目角色，
 *   因为若创建即授角色，『lead 对自建未加入的项目持管理权、不持内容读取权』那条边的
 *   两端就不存在了」——人类直接推翻了这个结论。「给创建者授予项目角色」这一步不在
 *   本文件（三条纯判断没有变化），落在 `PgProjectRepository.create()`，同一事务多写
 *   一行 `project_memberships`。反向断言（建完立刻以创建者身份判权，必须**放行**）
 *   写在 `tests/project/create-project-org-role-gate.test.ts`。
 */
import { createHash } from "node:crypto";
import { project } from "@repo/contracts";
import type { z } from "zod";
import type { OrgRole } from "../identity/roles";

/** 契约的三值闭集。**引用**，不抄一份——抄一份就是本仓第十次「同一事实两处声明」。 */
export const PROJECT_KINDS = project.ProjectKind.options;

/**
 * ⚠ `z.infer<typeof project.ProjectKind>` 而**不是** `(typeof PROJECT_KINDS)[number]`。
 *
 * 两者今天推导出同一个联合类型，所以第一版写的是后者，而 `lint-contract-source`
 * 当场判它是「用字面量重新定义契约类型」——这条规则是对的：从常量数组推导，
 * 意味着有人把 `PROJECT_KINDS` 改成本地字面量数组时，类型会**跟着**变成新的字面量集合，
 * 而不是编译失败。`z.infer` 让契约成为类型的唯一出处（同 `domain/identity/roles.ts`）。
 */
export type ProjectKind = z.infer<typeof project.ProjectKind>;

/**
 * **`lead` 或 `admin`**（人类裁决 2026-08-06，**覆盖 U-4 裁 A** 的「只有 `lead`」那一半；
 * issue **#608**）。
 *
 * ## 为什么覆盖
 *
 * U-4 裁 A 原本把 `admin` 排除在外，理由是「管理员的权是治理不是参与」（D-18 同向）。
 * 那条推理没错，错的是它与**自助注册的唯一出口**互相锁死：
 *   · `bootstrapFirstUser` 落库时 `org_role` 写死 `'admin'`
 *     （`infrastructure/auth/pg-registration-repository.ts` 三处自助注册 INSERT 全部如此）；
 *   · 全仓**没有任何** `UPDATE org_memberships` —— 改组织角色的写路径不存在。
 * ⇒ 一个组织里的第一个人永远是 `admin`，永远变不成 `lead`，于是**永远建不了第一个项目**。
 *   八步核心流程第 1 步产生的用户，在第 2 步就走不下去。
 * 人类据此裁定：**admin 也能建项目**。
 *
 * ## ⚠ 这条裁决**只**覆盖「谁能建」，Q-4② 是**另一条独立裁决**（已于 2026-08-16 推翻）
 *
 * 建项目现在**会**授予创建者项目角色（facilitator）——admin 建完之后与 lead 建完之后
 * 行为仍然一致：`project_memberships` 里都多一行 facilitator，立刻判权放行。
 * 「让它能用起来」曾经的顾虑（顺手发角色会废掉 D-18）被人类裁决直接否决：
 * D-18 本身没有被推翻，只是创建者不再落在它判定的那个格子里。
 * ⇒ 正向断言在 `tests/project/bootstrap-admin-can-create-project.test.ts` 的第三个 describe。
 *
 * ⚠ 仍然**不写成排除式**（`role !== "consultant"` 之类）：那样将来枚举加第五种角色时，
 *   新角色会静默地被放进来，而所有正向断言依旧全绿。两个取值就逐个列两个。
 *
 * ⚠ **本函数还被归档/解归档复用**（`archive-project.ts` / `unarchive-project.ts`
 *   「权限同归档者，不新造角色」）⇒ 本次放宽**连带**让 `admin` 能归档/解归档项目。
 *   这是复用关系的直接后果，不是偷偷夹带；`unarchive-project.ts` 头注对此有一句说明。
 */
export function canCreateProject(orgRole: OrgRole | null): boolean {
  return orgRole === "lead" || orgRole === "admin";
}

/**
 * `kind` 是否在三值闭集内。
 *
 * ⚠ 这是**第二层**，不是唯一一层。三层各有各的位置，缺一层都会留下一条能绕过的路：
 *   ① 契约 `.strict()` + `ZodBodyPipe`  —— 挡住 HTTP 入口的畸形请求（400）
 *   ② 本函数                            —— 挡住任何**不经 HTTP** 的调用方（INVALID_KIND）
 *   ③ DB `projects_kind_check`          —— 挡住任何不经 application 的写
 * 只留 ① 时，一个直接调用用例的路径能把 `'delivery'` 送到数据库门口；
 * 只留 ③ 时，调用方拿到的是 SQLSTATE 23514 而不是契约里那个码。
 */
export function isProjectKind(v: unknown): v is ProjectKind {
  return typeof v === "string" && (PROJECT_KINDS as readonly string[]).includes(v);
}

/** 一次创建请求的可识别内容。⚠ 字段集合 = 契约 `createProject.in` + 发起人，不多不少。 */
export interface CreationRequestIdentity {
  readonly orgId: string;
  readonly actorId: string;
  readonly kind: string;
  readonly name: string;
  readonly blueprintVersionId: string | null;
}

/**
 * 分隔符。**不可打印且 PostgreSQL 的 `text` 存不下**，所以它不可能出现在被拼接的五个值里。
 *
 * 用 `:` 之类的可打印字符会出事，而且是静默出事：项目名是用户输入，
 * `{name:"a:b", blueprintVersionId:null}` 与 `{name:"a", blueprintVersionId:"b"}`
 * 会拼出同一个串、算出同一枚指纹，于是两个**不同**的请求互相把对方幂等掉一个——
 * 两次调用都返回 200，没有任何东西会红。
 */
const SEP = "\u0000";

/**
 * 「同一次创建请求」的判据（uc-00-1 E5）。
 *
 * ⚠ 契约面**没有**幂等键（`KNOWN_CONTRACT_GAPS.P9` 逐字：「幂等的判据留给实现 +
 *   F117 的验收，契约面不替它编一个键」）。所以这个函数是一个**实现判断**，
 *   它的代价（同一个 lead 建不出两个同名同类同蓝本的容器）写在
 *   `migrations/0026-f117-create-project-idempotency.sql` 头部，并已报给签核人。
 *
 * ⚠ `null` 蓝本仍要显式编码：契约里 `blueprintVersionId` 是 `z.string().nullable()`，
 *   空串是一个**合法取值**，`null` 与 `""` 必须算出不同的指纹。
 */
export function creationFingerprint(req: CreationRequestIdentity): string {
  const blueprint = req.blueprintVersionId === null ? "null" : `id${req.blueprintVersionId}`;
  const parts = [req.orgId, req.actorId, req.kind, req.name, blueprint];
  return createHash("sha256").update(parts.join(SEP), "utf8").digest("hex");
}
