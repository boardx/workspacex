/**
 * 契约束 `viewer-role`（phase-10 F02）— ③ API 契约（**唯一事实源**）
 *
 * `design-signoff.md` 已签核（2026-08-20，usamshen）；`design-coherence.md` 阶段一致性
 * 复核同日通过。签核正文③『支撑材料』写明本文件此前不存在，「签核通过后开工时的第一件
 * 产出」——这是本轮 F02 的产出。
 *
 * ## 为什么不复用 `templates.getProjectGrouping`
 *
 * 那个端点服务 `apps/web/components/project/tab-prep.tsx`（F950，筹备阶段）的
 * `GroupingBlock`——facilitator/groupLead/member 明确设计成看到**全量**分组名单
 * （该文件头注释原话：「内部协作视图」）。而这里（`tab-live.tsx`，现场协作视角切换器）
 * 需要的是**角色收窄**：组长/组员只看自己那组，观察者不看任何一组
 * （`viewer-role/domain.md` 不变量 2/3/4）。两者可见性语义互斥，共用一个端点会让其中
 * 一边的合法行为被另一边的安全要求削掉——所以这里新开一个独立只读端点，不是重复造轮子。
 *
 * `Group` 复用 `templates.ts` 的既有 schema（同一个实体，不重新声明字段）。
 */
import { z } from "zod";
import { ProjectRole } from "./identity";
import { Group } from "./templates";

/** 视角选项：`"stage"` = 主持台·全场（引导师/观察者可见）；其余 = 某个真实分组。 */
export const ViewerOption = z.discriminatedUnion("kind", [
  z.object({ id: z.literal("stage"), kind: z.literal("stage"), label: z.string() }).strict(),
  z.object({ id: z.string(), kind: z.literal("group"), label: z.string(), group: Group }).strict(),
]);

export const operations = {
  /**
   * `tab-live.tsx` 视角切换器的服务端权威数据源（domain.md 不变量 1：
   * 「视角可见性判定只在服务端执行一次；前端不得基于角色名在本地二次过滤数据」）。
   *
   * `in.requestedViewerId` 可选——调用方想切到某个具体视角（`"stage"` 或某个
   * `groupId`）时带上；不传只读取角色范围内的选项列表。越权（不在返回的 `viewers`
   * 范围内）⇒ `VIEWER_SCOPE_DENIED`（403），不是 200 + 猜不到内容的空响应。
   */
  getViewerOptions: {
    method: "GET",
    path: "/projects/:projectId/viewer-options",
    in: z.object({ projectId: z.string(), requestedViewerId: z.string().optional() }).strict(),
    out: z
      .object({
        role: ProjectRole,
        viewers: z.array(ViewerOption),
        /** 顶部提示条文案，按角色区分（不是所有角色都显示『你有全部权限』那句话）。 */
        promptText: z.string(),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "VIEWER_SCOPE_DENIED", "DEPENDENCY_UNAVAILABLE"] as const,
  },
} as const;
