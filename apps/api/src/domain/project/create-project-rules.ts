/**
 * F117 —— `createProject` 的三条纯判断，住在最内层。
 *
 * 放在 domain 而不是 application 的理由：这三条各自都有一个**已裁决的出处**，
 * 而 application 那一层还要知道仓储、事务、DI。判断混在事务代码里之后，
 * 「谁能建」这条边只能靠读一遍 `create-project.ts` 才能确认——而它会被测的是
 * 「调用成功了吗」，不是「这条边长什么样」。
 *
 *   ① 谁能建      U-4 裁 A：只有组织角色 `lead`；`admin` 也不能
 *   ② kind 闭集   契约 `ProjectKind` 三值，与 DB CHECK 成员逐个相等
 *   ③ 幂等指纹    uc-00-1 E5 的字面意思：「同一次创建请求」= 同样的五元组
 *
 * ⚠ 这里**没有**「给创建者授予项目角色」这一步，缺了是结论不是遗漏：
 *   Q-4② 裁「`lead` 对自建未加入的项目持管理权、不持内容读取权」。
 *   若创建即授角色，那条边的两端就不存在了，「管理员不是超级用户」（D-18）随之破掉。
 *   ⇒ 反向断言写在 `tests/project/create-project-org-role-gate.test.ts`：
 *     建完立刻以创建者身份判权，必须拿到 `NO_PROJECT_ROLE`。
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
 * **只有 `lead`**（U-4 裁 A，D-11「创建与管理项目」逐字）。
 *
 * ⚠ `admin` 落在 false 上是这条裁决的**全部内容**，不是顺带：
 *   管理员的权是治理不是参与（D-18 同向）。写成 `role !== "consultant"` 之类的
 *   排除式，`admin` 就会静默地被放进来，而所有正向断言依旧全绿。
 */
export function canCreateProject(orgRole: OrgRole | null): boolean {
  return orgRole === "lead";
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
