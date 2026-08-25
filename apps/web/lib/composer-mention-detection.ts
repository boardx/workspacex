/**
 * issue #2046（CK-P2）—— CopilotKit v2 composer 的 mention 检测，纯函数。
 *
 * 两种触发符：
 * - `/`：skill 挂载候选（人类 2026-08-25 裁决：v2 轨道从 `#` 改为 `/`，对齐
 *   Claude Code 习惯；旧轨道 `/chat/legacy` 保持 `#` 不动）。
 * - `@`：引用本线程已上传（已随消息发出）的附件（旧 composer
 *   `chat-live-message-panel.tsx` 的 `recomputeMentions` 同语义平移）。
 *
 * 纪律（与旧 composer 逐条对齐，加一条 `/` 专属约束）：
 * 1. 取光标前**更靠近光标**的触发符（下标更大的那个），同一时刻只有一个活跃。
 * 2. 触发符与光标之间一旦出现空白/换行，这次 mention 即结束。
 * 3. **`/` 仅在行首或前一字符为空白时生效**——路径（`src/components`）、URL
 *    （`https://…`）里的斜杠都紧跟非空白字符，不触发。`@` 不加这条约束，
 *    与旧轨道行为一致（邮箱里的 `@` 会短暂弹出候选，是旧轨道已接受的既有边界）。
 *
 * 抽成纯函数是为了让正反两例可以直接单测（`composer-mention-detection.test.ts`），
 * 不用把 850+ 行的面板组件整个渲染起来才能断言一个字符串切分规则。
 */
export type ComposerMention =
  | { readonly kind: "skill"; readonly start: number; readonly query: string }
  | { readonly kind: "attachment"; readonly start: number; readonly query: string };

export function detectComposerMention(value: string, caret: number | null): ComposerMention | null {
  if (caret === null) return null;
  const upToCaret = value.slice(0, caret);
  const slashIndex = upToCaret.lastIndexOf("/");
  const atIndex = upToCaret.lastIndexOf("@");

  const slashCandidate = slashIndex !== -1 && slashStartsMention(upToCaret, slashIndex)
    ? mentionFrom("skill", upToCaret, slashIndex)
    : null;
  const atCandidate = atIndex !== -1 ? mentionFrom("attachment", upToCaret, atIndex) : null;

  if (slashCandidate && atCandidate) {
    // 更靠近光标（下标更大）的赢——两个触发符共用同一段正文同一个光标。
    return slashCandidate.start > atCandidate.start ? slashCandidate : atCandidate;
  }
  return slashCandidate ?? atCandidate;
}

/** `/` 的误触规则：仅行首（含全文首）或前一字符为空白时才算 mention 触发。 */
function slashStartsMention(upToCaret: string, slashIndex: number): boolean {
  if (slashIndex === 0) return true;
  return /\s/.test(upToCaret[slashIndex - 1]!);
}

function mentionFrom(
  kind: ComposerMention["kind"],
  upToCaret: string,
  triggerIndex: number,
): ComposerMention | null {
  const between = upToCaret.slice(triggerIndex + 1);
  if (/\s/.test(between)) return null;
  return { kind, start: triggerIndex, query: between };
}
