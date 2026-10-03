/** Positive history references retain context; explicit prohibitions do not request recall. */
function requestsConversationReference(text: string): boolean {
  const references = text.matchAll(/(结合|参考|根据|联系|回顾|继续).{0,12}(历史|上次|之前|先前|记忆|对话)/g);
  return [...references].some((match) => !/(不|不要|无需|禁止)(再|去)?$/.test(text.slice(Math.max(0, match.index! - 6), match.index)));
}

/** Only self-contained, read-only role questions use fixed configuration without personal context.
 * Stored conversation/memory remains intact; mixed actions and references keep their context.
 */
export function isReadOnlyRoleIntroduction(text: string): boolean {
  const input = text.trim();
  if (requestsConversationReference(input)) return false;
  if (/^(你是谁|你能做什么|你可以做什么|介绍一下你(?:自己)?)[？?。！!]*$/.test(input)) return true;
  const match = /^(?:验收\s+D\d{3}[：:]\s*)?请(?:准确)?介绍你的角色背景[、，,]([\s\S]*)先不要执行任务或调用外部系统[。]*$/.exec(input);
  if (!match) return false;
  // Do not turn "introduce yourself, then create/send/analyse ..." into a read-only request.
  return !/(生成|创建|新建|保存|写入|发送|删除|分析|检索|搜索|执行|调用|启动|发起|发布|部署|修改|更新|上传|下载|附件)/.test(match[1]!);
}


/** Honor explicitly bounded inline evidence without discarding stored conversation state. */
export function isContextIndependentRequest(text: string): boolean {
  if (isReadOnlyRoleIntroduction(text)) return true;
  return /仅使用以下(?:合成)?资料/.test(text)
    && /^\[[A-Z]\d+(?:[，,][^\]\r\n]+)?\]/m.test(text)
    && !requestsConversationReference(text);
}
