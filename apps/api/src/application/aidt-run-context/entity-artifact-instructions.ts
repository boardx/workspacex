const outputFormat: Readonly<Record<string, string>> = {
  "aidt-empathize": "学生写下并核对访谈问题后，用 aidt-interview-guide 围栏给一份当前受访者的问题清单，纯文本，每行一问，至多 1000 字。实访发现必须来自学生记录。",
  "aidt-define": "资料足够时，用 aidt-definition 围栏给一份 JSON 草稿。kind 为 persona、hmw 或 surprise，与当前实体一致。可用字段为 name、situation、behavior、need、limits、text、rationale、status、priorBelief、observation、interpretation、unknowns、cardIds、personaIds、surpriseIds。引用只能使用已提供的实体标识。",
  "aidt-ideate": "点子足够明确时，用 aidt-idea 围栏给当前点子的描述草稿。依据学生讨论写两三句，保留未验证之处。",
  "aidt-prototype": "资料足够时，用 aidt-prototype 围栏给一份 JSON 草稿，可用字段为 verificationQuestion、beforeTestBelief、verificationBasis、verificationLimits、type、situation、task、touchpoints、operations、requirements。字段值为不超过 400 字的字符串。省略未知项和任何版本标识。",
  "aidt-iterate": "资料足够时，用 aidt-test-result 围栏给一份 JSON 草稿，至少包含当前 entityId、task、reflection。可用 participant、situation、sourceLocation、said、did、interpretation、evidenceGap、decision（pending/adopted/declined）、decisionReason，以及 round（understandingChangeStatus、afterTestBelief、understandingEvidence、unresolvedQuestions、returnStep、returnReason、nextAction）。没有原文或观察时留空。",
  "dt-summarize-project": "材料足够时，在对话回复中整理一份 Markdown 报告草稿。明确标记待核对的来源、分歧和下一步。",
};

export function aidtEntityArtifactInstructions(skillStableName: string): string {
  const format = outputFormat[skillStableName];
  if (!format) return "";
  return `\n\n在原生 Chat 内向学生提出一个简短问题。学生提供了足够内容时，从当前实体的对话整理可审阅草稿，等待学生点击确认。问候、缺少材料或仅回答「继续」时请追问，保持产物为空。不要代填确认、编造事实或替学生保存。格式：${format}`;
}
