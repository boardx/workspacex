/**
 * @repo/contracts — 契约束 `viewer-role`（phase-10-live-collaboration-orchestration，F01/F02）
 *
 * ⚠ **契约草案，尚未实现后端**：本文件随 F01/F02 一并实现前**先行落地**，
 *   供 ADR-023 第 ③ 件存在性门控（`lint-third-artifact.mjs`）与后续 sprint 引用；
 *   当前**无 controller 消费它**，`apps/api` 里没有对应路由实现。
 *   来源是 `phases/phase-10-live-collaboration-orchestration/contracts/viewer-role/usecases.md`
 *   （已签核，`design-signoff.md` status: confirmed，2026-08-20 usamshen）——本文件
 *   逐条转写该文档的 `in`/`out`/`err`，不新增未签核的字段。
 *
 * 字段名单源：`domain.md`（视角可见性矩阵）。`VIEWER_SCOPE_DENIED` 是本束新定义的错误码，
 * 全仓其余束（`module-routing`/`stage-aggregation`）复用**这一个**，不得各自另定义一个同语义码
 * （domain.md 不变量 3 / usecases.md 签核确认项）。
 */
import { z } from "zod";

/* ───────────────────────────── 实体 ───────────────────────────── */

/**
 * 当前用户能切到的一个视角选项。
 *
 * ⚠ `statusSuffix`（如 F01「缺N人」「需介入」状态后缀）本轮**只声明字段存在**：
 *   「需介入」判据全仓无来源（design-signoff.md scope_note 逐字），因此该字段允许为
 *   `null`——`null` 即前端渲染 `＊` 待补契约占位，不得由前端自己编一个字符串填充。
 *   「缺N人」的口径已由 `group-checkin` 束的 `getGroupCheckinBoard` 定义（domain.md 不变量 5：
 *   到场数据单一事实源），本字段是该口径的转发展示，不是本束重新计算。
 */
export const ViewerOption = z
  .object({
    id: z.string(),
    kind: z.enum(["stage", "group"]),
    label: z.string(),
    statusSuffix: z.string().nullable(),
  })
  .strict();

/**
 * 当前登录者在本项目里的角色。⚠ 与 `project.ts` 里多处内联的
 * `z.enum(["facilitator", "groupLead", "member", "observer"])` 同一枚举值——
 * `project.ts` 未把它导出成具名类型，本束按同样的四个字面量声明，不是另一套角色体系。
 */
export const ViewerCurrentRole = z.enum(["facilitator", "groupLead", "member", "observer"]);

/* ───────────────────────────── 操作 ───────────────────────────── */

export const operations = {
  /**
   * UC `getViewerOptions`（F01/F02，读）。
   *
   * ⚠ 服务端权威：`domain.md` 不变量 1 逐字「前端不得基于角色名在本地二次过滤数据」——
   *   `out.viewers` 就是可见集合的全集，不是「全量列表 + 前端过滤」。
   * ⚠ `userId` 服务端从会话取，**不信前端传**（usecases.md 逐字）——`in` 因此不收 `userId`。
   */
  getViewerOptions: {
    method: "GET",
    path: "/workshops/:workshopId/viewer-options",
    in: z.object({ workshopId: z.string() }).strict(),
    out: z
      .object({
        viewers: z.array(ViewerOption),
        currentRole: ViewerCurrentRole,
      })
      .strict(),
    /**
     * ⚠ 不变量 2/3/4 的机械断言点：
     *   · 组长/组员：`viewers` 只含唯一一个 `kind: "group"` 条目，`id` 等于所属分组
     *   · 观察者：`viewers` 长度为 1 且唯一条目 `kind === "stage"`
     *   · 引导师：可含 `kind: "stage"` 与全部 `kind: "group"` 条目
     */
    err: ["UNAUTHENTICATED", "PROJECT_NOT_FOUND"] as const,
  },

  /**
   * UC `getRoleScopeNote`（F02，读）。
   *
   * ⚠ 顶部提示条文案来自服务端，不是前端字典写死——usecases.md 逐字
   *   「防止漏改」：四个角色的文案只在一处（服务端）维护。
   */
  getRoleScopeNote: {
    method: "GET",
    path: "/workshops/:workshopId/viewer-role-scope-note",
    in: z.object({ workshopId: z.string() }).strict(),
    out: z
      .object({
        role: ViewerCurrentRole,
        promptText: z.string(),
      })
      .strict(),
    err: ["UNAUTHENTICATED", "PROJECT_NOT_FOUND"] as const,
  },
} as const;

/**
 * 本束共享错误码——`VIEWER_SCOPE_DENIED` 是**唯一事实源**，`module-routing`/`stage-aggregation`
 * 两束的权限拒绝路径复用这一个字面量（domain.md 不变量 3 / 两束 domain.md 各自的断言条款），
 * 不得各自重新声明一个同语义的第二个码。
 *
 * ⚠ 观察者越权直连分组详情接口（对话/访谈逐字稿）时，**这个码归属那个被访问的具体接口自己的
 *   `err` 列表**（如 `chat` 束/`interview` 束），不在本操作的 `err` 里——`getViewerOptions`
 *   本身不会因为越权访问别的接口而报错，两件事分属不同的契约操作。
 */
export const VIEWER_SCOPE_DENIED = "VIEWER_SCOPE_DENIED" as const;

/**
 * 已知契约缺口（对齐 `materials.ts`/`project.ts` `KNOWN_CONTRACT_GAPS` 惯例，
 * 缺口显式登记而非静默略过）。
 */
export const KNOWN_CONTRACT_GAPS = {
  /**
   * F01「需介入」状态后缀：全仓无判据来源（design-signoff.md scope_note 逐字），
   * `ViewerOption.statusSuffix` 允许为 `null` 就是这条缺口在类型上的落点；
   * 判据补齐前不得由实现方自造启发式规则填充这个字段。
   */
  V1_NEEDS_INTERVENTION_SUFFIX_BASIS:
    "见 design-signoff.md scope_note 与 segment-engine 束 domain.md 不变量 4（同一判据的另一处消费点，" +
    "全仓不得出现第二份『需介入』判据）；判据裁决前 statusSuffix 恒为 null",
  /**
   * 组长/观察者能否看到成员到场列表——`group-checkin` 束 `ui.md` 已标出这一格是空的，
   * 本束的视角/角色矩阵不替 `group-checkin` 束做这个可见性判断，只提供角色本身。
   */
  V2_GROUP_LEAD_OBSERVER_CHECKIN_VISIBILITY:
    "见 group-checkin 束 coverage.md 反向检查段落；本束 getViewerOptions 只回答『能看哪个视角』，" +
    "不回答『某视角内某个字段是否可见』——后者归 group-checkin 束自己的契约",
} as const;
