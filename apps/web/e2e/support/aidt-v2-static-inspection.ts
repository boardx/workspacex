/** QA inspection of stored static HTML only; never a claim about real user behaviour. */
export function inspectAidtStoredHtml(html: string, linkCount = 0) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/gu, "");
  const visible = withoutComments.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/giu, "").replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
  const numberZoneExamplePresent = /(?:示例\s*)?\d+\s*(?:→|➜|->|对应|号.{0,8})(?:\s*[A-ZＡ-Ｚ甲乙丙丁])\s*(?:分区|区)/u.test(visible);
  const scriptedOrLinked = /<script\b|\son[a-z]+\s*=|\bdata-goto\s*=|(?:href|src)\s*=\s*["']?javascript:/iu.test(withoutComments) || linkCount > 0;
  return { visible, numberZoneExamplePresent, scriptedOrLinked,
    findings: [numberZoneExamplePresent ? "存在号码分区示例文本，尚需人工核对含义" : "无号码分区映射（未找到可见号码到分区对应文本）",
      scriptedOrLinked ? "存在脚本或跳转配置，需另验交互" : "按钮无交互（未配置脚本、事件或跳转）"],
    realUserTestConducted: false as const, semanticHumanReview: "required" as const };
}
