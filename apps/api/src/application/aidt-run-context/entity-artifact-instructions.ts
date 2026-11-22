const outputFormat: Readonly<Record<string, string>> = {
  "aidt-empathize": "学生写下并核对访谈问题后，用 aidt-interview-guide 围栏给一份当前受访者的问题清单，纯文本，每行一问，至多 1000 字。实访发现必须来自学生记录。",
  "aidt-define": "资料足够时，用 aidt-definition 围栏给一份 JSON 草稿。kind 为 persona、hmw 或 surprise，与当前实体一致。可用字段为 name、situation、behavior、need、limits、text、rationale、status、priorBelief、observation、interpretation、unknowns、cardIds、personaIds、surpriseIds。引用只能使用已提供的实体标识。",
  "aidt-ideate": "当前实体有 brainstorm 时，只使用该已保存场次的 HMW、brainstorm.activity.methodKey 与 methodGuide，不能从其他场次取方法或擅自改选。先按当前 activity.methodGuide.startPrompt 等待学生贡献自己的第一轮内容；尚无学生点子或活动材料时，不输出 aidt-ideas，不编造成员意见或替学生完成首轮。学生已有内容后，按当前 activity.methodGuide.description 的具体策略协作发散；若方法需要的经历、角色观点或成员点子缺失，先请学生补充。仅提供鼓励式追问，不打分或否定淘汰，不自动分类、投票或选择；角色假设与类比不是实地证据。仅使用实际已有的聊天和上传能力，不宣称系统新增匿名收集或实时协作。根据 targetCount 和 generatedCount 仅补充尚缺的不同候选，不用同义改写凑数。每轮新增点子用 aidt-ideas JSON 围栏输出 {sessionId,candidates:[{title,description}]}，sessionId 只取当前 entityId，描述两三句。候选是待学生判断的草稿，筛选时引导学生比较和说明理由，禁止代选。缺失当前场次的方法记录时请先核对，不默认自由联想。非头脑风暴场次下，点子足够明确时，用独立一行的标题「描述单草稿」并在下方给当前点子的两三句核心描述。依据学生讨论写作，保留未验证之处。",
  "aidt-prototype": "资料足够时，用 aidt-prototype 围栏给一份 JSON 草稿，可用字段为 verificationQuestion、beforeTestBelief、verificationBasis、verificationLimits、type、situation、task、touchpoints、operations、requirements。字段值为不超过 400 字的字符串。省略未知项和任何版本标识。",
  "aidt-iterate": "测试计划足够具体时，用 aidt-test-plan 围栏给一份 JSON 草稿，包含当前 entityId、task，可加 situation。只有学生提供测试所得及反思时，用 aidt-test-result 围栏给一份 JSON 草稿，至少包含当前 entityId、task、reflection。可用 participant、situation、sourceLocation、said、did、interpretation、evidenceGap、decision（pending/adopted/declined）、decisionReason，以及 round（understandingChangeStatus、afterTestBelief、understandingEvidence、unresolvedQuestions、returnStep、returnReason、nextAction）。问卷和受访者陈述只支持自报或理解，静态原型不能据此证明付款、耗时等实际行为。没有获得授权并可定位的直接观察记录时，did 留空并写入证据缺口。",
  "dt-summarize-project": "材料足够时，在对话回复中整理一份 Markdown 报告草稿。明确标记待核对的来源、分歧和下一步。",
};

export function aidtEntityArtifactInstructions(skillStableName: string): string {
  const format = outputFormat[skillStableName];
  if (!format) return "";
  return `\n\n学生询问先前步骤时，优先回答引用链所载的真实研究问题、对象和场景，并使用材料中的 href 以「第几步 · V几」链接所引用的版本。只引用记录中实际存在的内容，遗失时说明缺少哪项，可回到来源核对。使用中文教学用语。仅在需要推进讨论时向学生提出一个简短问题。学生提供了足够内容时，从当前实体的对话整理可审阅草稿，等待学生点击确认。问候、缺少材料或仅回答「继续」时请追问，保持产物为空。不要代填确认、编造事实或替学生保存。格式：${format}`;
}
