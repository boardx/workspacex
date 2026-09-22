/**
 * 设计工作台的失败 → 人话（单源）。
 *
 * 迭代 27 起放在 `detail-screen.tsx` 里；迭代 28 搬到这里——属性面板与版本历史面板各自
 * 抄着一份 `err.reasonCode ?? \`http_${err.status}\`` 的老写法，在同一屏上把同一类失败
 * 说成两种话（一种是人话、两种是内部码）。同一事实不得声明在两处：三处共用这一份。
 */
import { ApiError } from "@/lib/api-client";
import { designWorkbench } from "@repo/contracts";

/**
 * 迭代 27 —— 错误码 → 人话。
 *
 * `describeFailure` 原来是 `err.reasonCode ?? \`http_${err.status}\``，也就是把**内部错误码
 * 原样端给用户**：屏上出现的是「没能发送（PROJECT_NOT_FOUND），已保留草稿」
 * 「没能推送到收件箱（http_500）」。对一个不做设计、也不看代码的人，这既不说明发生了什么，
 * 更不说明下一步该做什么——而这正是他最需要一句人话的时刻。`detail-screen` 里有 37 处用它。
 *
 * ⚠ 键集合是契约闭集 `DesignWorkbenchError`，**漏一个编译不过**——契约新增一个错误码却
 *   没给人话，会在这里当场变成 TS 错误，而不是悄悄退回到那个码本身。
 */
const ERROR_TEXT: Record<designWorkbench.DesignWorkbenchError, string> = {
  PROJECT_NOT_FOUND: "这个设计项目找不到了，可能已经被删掉",
  NAME_REQUIRED: "名字不能为空",
  NOT_PROJECT_OWNER: "这个项目不是你建的，只有建它的人能改",
  DEPENDENCY_UNAVAILABLE: "服务暂时不可用，稍后再试一次",
  VERSION_NOT_FOUND: "这一版历史记录找不到了",
  REF_IMAGE_REJECTED: "这张图没能用：换一张小一点的 PNG / JPEG / WebP",
  PROTOTYPE_PATCH_REJECTED: "这次改动没能应用到画布上",
  FEEDBACK_NOT_FOUND: "来源反馈找不到了",
  FEEDBACK_DETAIL_NOT_VISIBLE: "你没有查看这条反馈正文的权限",
  PROJECT_NOT_PUSHED: "得先把方案推送到收件箱，才能转成开发任务",
  DESIGN_ISSUE_ALREADY_EXISTS: "这个方案已经有对应的开发任务了",
  DESIGN_ISSUE_IN_PROGRESS: "正在创建开发任务，稍等一下再试",
  DESIGN_ISSUE_CREATION_FAILED: "创建开发任务失败，稍后再试一次",
  SHARE_NOT_FOUND: "这条分享链接已经失效",
  NOTHING_TO_PUBLISH: "还没有画出来的页，没什么可发布的",
};

/** HTTP 状态兜底：走到这里说明不是本束的已知错误码，仍然要给一句**能照着做**的话。 */
function httpText(status: number): string {
  if (status === 401 || status === 403) return "登录状态过期了，刷新页面重新登录";
  if (status === 404) return "要找的东西不在了";
  if (status === 429) return "操作太频繁了，等一下再试";
  if (status >= 500) return "服务器出错了，稍后再试一次";
  return "这次请求没成功，稍后再试一次";
}

export function describeFailure(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.reasonCode;
    if (code !== null && code in ERROR_TEXT) return ERROR_TEXT[code as designWorkbench.DesignWorkbenchError];
    return httpText(err.status);
  }
  if (err instanceof TypeError) return "连不上服务器，检查一下网络再试";
  // 兜底同样不端出内部细节：`String(err)` 在这里多半是一段栈或一句英文异常。
  return "出了点问题，稍后再试一次";
}
