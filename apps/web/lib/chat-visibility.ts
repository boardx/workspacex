/**
 * 契约 `chat.ChatVisibility`（五值）的中文标签——**按契约枚举**键入，缺键编译期红。
 *
 * ⚠ 与 `lib/mock/chat.ts` 的 `CHAT_VISIBILITY_LABEL`（mock 视图类型 `ChatVisibilityView`，第五档
 *   码是 `all-hands` 而非契约的 `plenary`，分歧登记为 `CONTRACT_DIVERGENCES.D05`）不是同一份事实：
 *   那份按原型视图类型键入、供原型期 chat 组件用；这份按已签核契约键入，供接真实数据的产品面用
 *   （项目中枢 R4 的项目对话列表）。产品路由不得 import `lib/mock/*`（ui-wiring 会把路由判回 mock）。
 */
import { chat } from "@repo/contracts";
import type { z } from "zod";

export type ChatVisibility = z.infer<typeof chat.ChatVisibility>;

export const CHAT_VISIBILITY_LABEL: Record<ChatVisibility, string> = {
  "member-private": "组员私聊",
  "group-shared": "本组共享",
  plenary: "全场",
  "team-visible": "团队可见",
  private: "私有",
};
