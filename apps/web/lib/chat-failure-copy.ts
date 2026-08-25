import { ApiError } from "@/lib/api-client";

/**
 * 会话/编制写操作失败的用户可见文案。
 *
 * 抽成单一事实源是 issue #2052（CK-P7）逼出来的：CopilotKit v2 外壳现在也要做编制
 * 增删，而这份措辞原本私有在 `chat-read-screen.tsx` 里。两条轨道各写一份，同一个
 * `VERSION_CHANGED` 就会有两句不一样的话——那正是本仓「同一事实不得声明在两处」
 * 要挡的东西。措辞逐字保持不变（旧轨道的 UI 测试断言的就是这些字）。
 */
export function describeMutateFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.reasonCode === "NO_WRITE_ROLE") return "当前身份没有会话写权限（NO_WRITE_ROLE）。";
    if (failure.reasonCode === "VERSION_CHANGED") return "这条会话已被其他人修改（VERSION_CHANGED），请刷新后重试。";
    if (failure.reasonCode === "TITLE_INVALID") return "标题不合法（TITLE_INVALID）。";
    if (failure.reasonCode === "THREAD_ARCHIVED_READONLY") return "会话已归档，只读（THREAD_ARCHIVED_READONLY）。";
    return `${failure.reasonCode ?? "操作失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "操作失败，请稍后重试。";
}
