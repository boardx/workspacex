import type { chat } from "@repo/contracts";
import type { z } from "zod";

export const ASR_DRAFT_ERROR_TEXT: Record<z.infer<typeof chat.ChatAsrDraftErrorReason>, string> = {
  CREDIT_REQUIRED: "Credit 余额或成员月度额度不足，请确认额度或联系组织管理员后继续语音输入。",
  CREDIT_ACCOUNTING_UNAVAILABLE: "计费服务暂时不可用，请稍后重试或联系管理员。",
  ASR_PROVIDER_UNAVAILABLE: "语音识别服务暂时不可用，请稍后重试。",
  ASR_NOT_CONFIGURED: "当前环境尚未配置语音转写服务，暂时无法使用语音输入，请手动输入。",
  AUDIO_FORMAT_REJECTED: "音频格式被服务拒绝，请刷新页面后重试。",
};
