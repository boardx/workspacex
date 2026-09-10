import { ApiError } from "@/lib/api-client";

/**
 * 待发送消息队列（`workbench-server-queue` 面板）失败时**用户看见的那句话**。
 *
 * 为什么要有这个文件（issue #3317）：人类在 devapp 上生成 pptx，执行到第 7 分钟，
 * composer 下方冒出一个孤零零的 `http_502`。追下去发现 `use-thread-message-queue.ts`
 * 的四个 catch 全都是 `cause.message` 直出，而 `ApiError` 在拿不到 JSON 信封时
 * （网关吐的是 HTML，`JSON.parse` 失败 ⇒ `reasonCode === null`）message 恰好就是
 * `` `http_${status}` ``（`api-client.ts` 的 `super(reasonCode ?? \`http_${status}\`)`）。
 *
 * 也就是说：这条错误出口**完全绕过**了 #3280 建的成因枚举通道
 * （`copilotkit-v2-failure-banner.ts` / `copilotkit-v2-error-copy.ts`），
 * 不是走了它落进兜底分支——整条链上没有 import 过任何文案模块。它守着的两条 e2e
 * 判据（`chat-path-f1-failure-cause-distinguishable.spec.ts`）只钉在
 * `copilotkit-v2-error` 横幅上，对这个 `<p role="alert">` 零覆盖。
 *
 * 本模块是这条出口的**唯一**文案来源。每一句都必须回答用户当场会问的四件事：
 *   ① 哪一步失败了；② 为什么；③ 在途任务与已生成的产物还在不在；④ 要不要我做什么。
 * 「有 error 字段」不是判据——裸状态码能轻松通过那种断言。判据钉在渲染出来的那
 * 句话上，见 `tests/ui/workbench-queue-failure-copy.test.tsx`。
 */
export type QueueFailureStep = "read" | "enqueue" | "cancel" | "edit";

const STEP_LABEL: Record<QueueFailureStep, string> = {
  read: "读取待发送消息列表",
  enqueue: "把这条消息加入待发送队列",
  cancel: "撤回这条待发送消息",
  edit: "修改这条待发送消息",
};

/** 这一步失败后要用户做什么。read 会自己重试，写操作要用户再点一次。 */
const STEP_NEXT_ACTION: Record<QueueFailureStep, string> = {
  read: "列表会自动重试，你不用做什么",
  enqueue: "草稿已经保留，请再发一次",
  cancel: "请再点一次撤回",
  edit: "改动没有保存，请再试一次",
};

/**
 * 在途任务与产物是否受影响。队列面板是 composer 的附属面板，它的读写失败与
 * 正在执行的那个 run 是两条独立链路——这句话就是用来回答「我这 7 分钟白跑了吗」。
 */
const RUN_UNAFFECTED = "正在执行的任务和已经生成的产物不受影响";

/** 网关/代理级失败：请求根本没走到应用，或者应用的响应在中间层被掐断。 */
function isGatewayFailure(failure: ApiError): boolean {
  if (failure.status === 502 || failure.status === 503 || failure.status === 504) return true;
  // 5xx 且正文不是 JSON（`rawBody` 只在解析失败那条路径上有值）⇒ 回话的不是本应用。
  return failure.status >= 500 && failure.reasonCode === null && failure.rawBody !== undefined;
}

export function describeQueueFailure(step: QueueFailureStep, cause: unknown): string {
  const label = STEP_LABEL[step];
  const next = STEP_NEXT_ACTION[step];
  if (cause instanceof ApiError) {
    if (isGatewayFailure(cause)) {
      return `${label}失败：网关暂时中断了这次请求（HTTP ${cause.status}），不是这次任务本身出错。${RUN_UNAFFECTED}，${next}。`;
    }
    if (cause.status === 401 || cause.status === 403) {
      return `${label}失败：当前身份没有通过服务端校验（${cause.reasonCode ?? `HTTP ${cause.status}`}）。${RUN_UNAFFECTED}，请重新登录后再试。`;
    }
    if (cause.reasonCode !== null) {
      return `${label}失败：服务端拒绝了这次请求（${cause.reasonCode}，HTTP ${cause.status}）。${RUN_UNAFFECTED}，${next}。`;
    }
    return `${label}失败：服务端回了 HTTP ${cause.status}，没有给出具体原因。${RUN_UNAFFECTED}，${next}。`;
  }
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return `${label}失败：这次请求没有完成（${cause.message}）。${RUN_UNAFFECTED}，${next}。`;
  }
  return `${label}失败：没有拿到失败原因。${RUN_UNAFFECTED}，${next}。`;
}

/**
 * 反证用的判据（**导出**，让断言与实现共用同一个「裸码」定义，避免第二份副本）：
 * 一句合格的失败文案不得整体等于一个裸状态码，也不得只是一个协议码而没有任何人话。
 */
export const BARE_STATUS_CODE_PATTERN = /^\s*(?:http_\d{3}|HTTP ?\d{3}|\d{3})\s*$/;
